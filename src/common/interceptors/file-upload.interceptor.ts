import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

// Cheap first gate on the declared MIME. The authoritative checks happen after
// upload in processVisitPhoto(): magic-byte validation, EXIF/GPS strip, and a
// re-encode. Files are held in memory (never written raw to disk) so an untrusted
// photo's EXIF GPS never touches the filesystem.
const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg', // non-standard alias some clients still send for JPEG
  'image/png',
  'image/gif',
  'image/webp',
]);

const imageFileFilter = (
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
    return callback(new BadRequestException('รองรับเฉพาะไฟล์รูปภาพ (jpg, png, gif, webp)'), false);
  }
  callback(null, true);
};

export const multerConfig = {
  storage: memoryStorage(),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 5,
    fields: 32,
    fieldSize: 1 * 1024 * 1024,
  },
};
