import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
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
  const response = () =>
    ({
      redirect: jest.fn(),
      sendFile: jest.fn(),
      setHeader: jest.fn(),
    }) as never;

  it('exposes the protected upload route behind the canonical API prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, FilesController)).toEqual(
      expect.arrayContaining(['api/uploads', 'uploads']),
    );
  });

  it('serves visit attachments through a fresh signed redirect', async () => {
    const storage = {
      resolve: jest
        .fn()
        .mockResolvedValue({ kind: 'redirect', url: 'https://storage.example/signed' }),
    } as unknown as FileStorageAdapter;
    const repository = taskRepository();
    const controller = new FilesController(storage, repository as never);
    const res = response();

    await controller.getVisitAttachment('e1f2.jpg', actor, res);

    expect(repository.canAccessVisitAttachment).toHaveBeenCalledWith(
      '/uploads/visit-attachments/e1f2.jpg',
      actor,
    );
    expect(storage.resolve).toHaveBeenCalledWith('visit-attachments/e1f2.jpg');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://storage.example/signed');
  });

  it('rejects a traversal attempt before touching storage', async () => {
    const storage = { resolve: jest.fn() } as unknown as FileStorageAdapter;
    const controller = new FilesController(storage, taskRepository() as never);

    await expect(controller.getVisitAttachment('../secret.jpg', actor, response())).rejects.toThrow(
      BadRequestException,
    );
    expect(storage.resolve).not.toHaveBeenCalled();
  });

  it('hides visit attachments outside the authenticated school scope', async () => {
    const storage = { resolve: jest.fn() } as unknown as FileStorageAdapter;
    const repository = taskRepository();
    repository.canAccessVisitAttachment.mockResolvedValue(false);
    const controller = new FilesController(storage, repository as never);

    await expect(controller.getVisitAttachment('hidden.jpg', actor, response())).rejects.toThrow(
      NotFoundException,
    );
    expect(storage.resolve).not.toHaveBeenCalled();
  });
});
