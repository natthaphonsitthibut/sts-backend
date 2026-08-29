import { extname } from 'path';
import { BadRequestException } from '@nestjs/common';
import { ATTENDANCE_IMPORT_MAX_FILE_BYTES } from '../config/attendance-import.config';

const ALLOWED_ATTENDANCE_IMPORT_EXTENSIONS = ['.xlsx', '.csv'];

/**
 * Memory storage (the default) keeps `file.buffer` for the parser. The size cap
 * is the same constant the parser enforces, so the HTTP layer and the service
 * cannot disagree about what is too large.
 */
export const attendanceImportMulterOptions = {
  limits: {
    fileSize: ATTENDANCE_IMPORT_MAX_FILE_BYTES,
    files: 1,
    // The parse call carries a url; recording an applied import also carries the
    // round it filled (school, term, classroom, date, slot, counts).
    fields: 12,
    fieldSize: 4 * 1024,
  },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const extension = extname(file.originalname).toLowerCase();
    if (!ALLOWED_ATTENDANCE_IMPORT_EXTENSIONS.includes(extension)) {
      return callback(new BadRequestException('รองรับเฉพาะไฟล์ .xlsx หรือ .csv'), false);
    }
    callback(null, true);
  },
};
