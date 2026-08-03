import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

// Cheap first gate on the declared MIME. The authoritative checks happen after
// upload in processVisitPhoto(): magic-byte validation, EXIF/GPS strip, and a
// re-encode. Files are held in memory (never written raw to disk) so an untrusted
// photo's EXIF GPS never touches the filesystem.
const ALLOWED_VISIT_ATTACHMENT_MIME = new Set([
  'image/jpeg',
  'image/jpg', // non-standard alias some clients still send for JPEG
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const imageFileFilter = (
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (!ALLOWED_VISIT_ATTACHMENT_MIME.has(file.mimetype)) {
    return callback(new BadRequestException('รองรับเฉพาะไฟล์รูปภาพ, PDF, DOC และ DOCX'), false);
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

/**
 * Curriculum content is a single PDF up to 10 MB — larger than the shared
 * attachment limit and deliberately narrower in type.
 */
export const curriculumPdfMulterConfig = {
  storage: memoryStorage(),
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (file.mimetype !== 'application/pdf') {
      return callback(new BadRequestException('รองรับเฉพาะไฟล์ PDF เท่านั้น'), false);
    }
    callback(null, true);
  },
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 16,
    fieldSize: 1 * 1024 * 1024,
  },
};
