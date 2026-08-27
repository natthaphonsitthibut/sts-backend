import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { ANY_PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { Readable, Writable } from 'stream';
import { FilesController } from './files.controller';
import type { FileStorageAdapter } from './storage/file-storage.types';

describe('FilesController', () => {
  const actor = {
    id: 7,
    username: 'reviewer',
    roles: ['ADMIN'],
    permissions: ['students'],
    data_scope: { school_ids: [10010004] },
  };
  const taskRepository = () => ({
    canAccessVisitAttachment: jest.fn().mockResolvedValue(true),
  });
  // A real Writable so `stream.pipe(res)` behaves as it does in Express, with
  // the header/sendFile surface the controller uses bolted on.
  const response = () => {
    const headers = new Map<string, string>();
    const sink = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    return Object.assign(sink, {
      headers,
      sendFile: jest.fn(),
      setHeader: jest.fn((name: string, value: string) => headers.set(name, value)),
    });
  };
  type TestResponse = ReturnType<typeof response>;
  const objectStorage = (): FileStorageAdapter => {
    const stream = Readable.from(['photo-bytes']);
    return {
      kind: 'private-object',
      open: jest.fn().mockResolvedValue(stream),
      resolve: jest.fn(),
    } as unknown as FileStorageAdapter;
  };
  const send = (res: TestResponse): never => res as unknown as never;

  it('exposes the protected upload route behind the canonical API prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, FilesController)).toEqual(
      expect.arrayContaining(['api/uploads', 'uploads']),
    );
  });

  // Permissions are page-bound: whoever can open the page an attachment is
  // shown on must be able to open the attachment. The visit report lives on
  // `dashboard` pages, so a stricter set here would render broken thumbnails.
  it('accepts the permission of every page that renders an attachment', () => {
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, FilesController)).toEqual(
      expect.arrayContaining(['dashboard', 'students']),
    );
  });

  it('streams a photo inline so the browser shows it instead of downloading it', async () => {
    const storage = objectStorage();
    const repository = taskRepository();
    const controller = new FilesController(storage, repository as never);
    const res = response();

    await controller.getVisitAttachment('e1f2.jpg', undefined, actor, send(res));

    expect(repository.canAccessVisitAttachment).toHaveBeenCalledWith(
      '/uploads/visit-attachments/e1f2.jpg',
      actor,
    );
    expect(storage.open).toHaveBeenCalledWith('visit-attachments/e1f2.jpg');
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="e1f2.jpg"');
    // Owner decision: minor PII must not reach the disk cache of a shared
    // staffroom machine. Serving inline does not depend on caching.
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('serves a pdf inline as well', async () => {
    const controller = new FilesController(objectStorage(), taskRepository() as never);
    const res = response();

    await controller.getVisitAttachment('report.pdf', undefined, actor, send(res));

    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="report.pdf"');
  });

  it('downloads only when the caller asks for it', async () => {
    const controller = new FilesController(objectStorage(), taskRepository() as never);
    const res = response();

    await controller.getVisitAttachment('e1f2.jpg', '1', actor, send(res));

    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="e1f2.jpg"');
  });

  it('keeps documents no browser can render as attachments', async () => {
    const controller = new FilesController(objectStorage(), taskRepository() as never);
    const res = response();

    await controller.getVisitAttachment('note.docx', undefined, actor, send(res));

    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="note.docx"');
  });

  it('serves local-disk files from the filesystem', async () => {
    const storage = {
      kind: 'local',
      open: jest.fn(),
      resolve: jest.fn().mockResolvedValue({ kind: 'local', filePath: '/uploads/e1f2.jpg' }),
    } as unknown as FileStorageAdapter;
    const controller = new FilesController(storage, taskRepository() as never);
    const res = response();

    await controller.getVisitAttachment('e1f2.jpg', undefined, actor, send(res));

    expect(storage.open).not.toHaveBeenCalled();
    expect(res.sendFile).toHaveBeenCalledWith('/uploads/e1f2.jpg');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="e1f2.jpg"');
  });

  it('stops reading the object when the reader closes the tab', async () => {
    const stream = Readable.from(['photo-bytes']);
    const storage = {
      kind: 'private-object',
      open: jest.fn().mockResolvedValue(stream),
      resolve: jest.fn(),
    } as unknown as FileStorageAdapter;
    const controller = new FilesController(storage, taskRepository() as never);
    const res = response();

    await controller.getVisitAttachment('e1f2.jpg', undefined, actor, send(res));
    expect(stream.destroyed).toBe(false);
    res.emit('close');

    expect(stream.destroyed).toBe(true);
  });

  it('returns not found when the object is missing', async () => {
    const storage = {
      kind: 'private-object',
      open: jest.fn().mockResolvedValue(null),
      resolve: jest.fn(),
    } as unknown as FileStorageAdapter;
    const controller = new FilesController(storage, taskRepository() as never);

    await expect(
      controller.getVisitAttachment('gone.jpg', undefined, actor, send(response())),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects a traversal attempt before touching storage', async () => {
    const storage = objectStorage();
    const controller = new FilesController(storage, taskRepository() as never);

    await expect(
      controller.getVisitAttachment('../secret.jpg', undefined, actor, send(response())),
    ).rejects.toThrow(BadRequestException);
    expect(storage.open).not.toHaveBeenCalled();
  });

  it('hides visit attachments outside the authenticated school scope', async () => {
    const storage = objectStorage();
    const repository = taskRepository();
    repository.canAccessVisitAttachment.mockResolvedValue(false);
    const controller = new FilesController(storage, repository as never);

    await expect(
      controller.getVisitAttachment('hidden.jpg', undefined, actor, send(response())),
    ).rejects.toThrow(NotFoundException);
    expect(storage.open).not.toHaveBeenCalled();
  });
});
