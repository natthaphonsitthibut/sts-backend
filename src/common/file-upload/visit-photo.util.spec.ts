import sharp from 'sharp';
import { BadRequestException } from '@nestjs/common';
import { processImageUpload, processVisitAttachment, processVisitPhoto } from './visit-photo.util';
import type { FileStorageAdapter } from '../../files/storage/file-storage.types';

function fakeStorage(): jest.Mocked<FileStorageAdapter> {
  return {
    kind: 'local',
    save: jest.fn().mockResolvedValue(undefined),
    saveStream: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn(),
    open: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

function multerFile(buffer: Buffer): Express.Multer.File {
  return { buffer } as Express.Multer.File;
}

function attachmentFile(buffer: Buffer, mimetype: string): Express.Multer.File {
  return { buffer, mimetype } as Express.Multer.File;
}

describe('processVisitPhoto', () => {
  it('re-encodes a real photo, strips it to a fresh buffer, and delegates the save to the injected adapter', async () => {
    const source = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
    const storage = fakeStorage();

    const filename = await processVisitPhoto(multerFile(source), storage);

    expect(filename).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(storage.save).toHaveBeenCalledTimes(1);
    const [savedBuffer, savedFilename] = storage.save.mock.calls[0];
    expect(savedFilename).toBe(filename);
    expect(Buffer.isBuffer(savedBuffer)).toBe(true);
    // Re-encoded output must not be byte-identical to the source — proves it went
    // through sharp (which also strips EXIF/GPS) rather than being saved as-is.
    expect(Buffer.compare(savedBuffer, source)).not.toBe(0);
  });

  it('rejects a non-image buffer before ever calling the storage adapter', async () => {
    const storage = fakeStorage();

    await expect(
      processVisitPhoto(multerFile(Buffer.from('not an image')), storage),
    ).rejects.toThrow(BadRequestException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects a buffer with a valid image signature but corrupt body', async () => {
    const storage = fakeStorage();
    // Real PNG magic bytes, garbage after — passes detectImageType, fails sharp.
    const corrupt = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
    ]);

    await expect(processVisitPhoto(multerFile(corrupt), storage)).rejects.toThrow(
      BadRequestException,
    );
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('stores a generic image under the requested safe directory', async () => {
    const source = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .toBuffer();
    const storage = fakeStorage();

    const storageKey = await processImageUpload(multerFile(source), storage, 'classroom-covers');

    expect(storageKey).toMatch(/^classroom-covers\/[0-9a-f]{32}\.jpg$/);
    expect(storage.save).toHaveBeenCalledWith(expect.any(Buffer), storageKey);
  });
});

describe('processVisitAttachment', () => {
  it.each([
    ['pdf', 'application/pdf', Buffer.from('%PDF-1.7\nbody')],
    [
      'doc',
      'application/msword',
      Buffer.concat([
        Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
        Buffer.from('body'),
      ]),
    ],
    [
      'docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('[Content_Types].xml word/document.xml'),
      ]),
    ],
  ])(
    'stores a signature-validated %s document under a random name',
    async (extension, mimetype, buffer) => {
      const storage = fakeStorage();

      const filename = await processVisitAttachment(attachmentFile(buffer, mimetype), storage);

      expect(filename).toMatch(new RegExp(`^[0-9a-f]{32}\\.${extension}$`));
      expect(storage.save).toHaveBeenCalledWith(buffer, filename);
    },
  );

  it('rejects a document whose declared MIME does not match its signature', async () => {
    const storage = fakeStorage();

    await expect(
      processVisitAttachment(attachmentFile(Buffer.from('not a pdf'), 'application/pdf'), storage),
    ).rejects.toThrow(BadRequestException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('rejects an image whose declared MIME does not match its signature', async () => {
    const storage = fakeStorage();
    const source = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();

    await expect(
      processVisitAttachment(attachmentFile(source, 'application/pdf'), storage),
    ).rejects.toThrow(BadRequestException);
    expect(storage.save).not.toHaveBeenCalled();
  });
});
