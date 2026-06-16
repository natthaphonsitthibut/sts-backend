import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { diskStorage } from 'multer';

// Canonical image MIME → stored extension. The on-disk extension is chosen by
// the server from this whitelist, never from the client-supplied filename, so a
// crafted originalname like "x.php.jpg" can't influence the stored name.
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg', // non-standard alias some clients still send for JPEG
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

const imageFileFilter = (
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (!ALLOWED_IMAGE_TYPES[file.mimetype]) {
    return callback(new BadRequestException('รองรับเฉพาะไฟล์รูปภาพ (jpg, png, gif, webp)'), false);
  }
  callback(null, true);
};

const editFileName = (
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, filename: string) => void,
) => {
  // Unguessable filename (defense-in-depth): even though access is guarded, a
  // crypto-random name avoids enumeration if a URL ever leaks. The extension
  // comes from the validated MIME whitelist, not the client-supplied filename.
  const uniqueName = randomBytes(16).toString('hex');
  const fileExtName = ALLOWED_IMAGE_TYPES[file.mimetype] ?? '';
  callback(null, `${uniqueName}${fileExtName}`);
};

export const multerConfig = {
  storage: diskStorage({
    destination: './uploads',
    filename: editFileName,
  }),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 5,
    fields: 32,
    fieldSize: 1 * 1024 * 1024,
  },
};
