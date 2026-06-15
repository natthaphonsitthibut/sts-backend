import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { diskStorage } from 'multer';
import { extname } from 'path';

const imageFileFilter = (
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
    return callback(new Error('Only image files are allowed!'), false);
  }
  callback(null, true);
};

const editFileName = (
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, filename: string) => void,
) => {
  // Unguessable filename (defense-in-depth): even though access is guarded, a
  // crypto-random name avoids enumeration if a URL ever leaks. Math.random was
  // not cryptographically secure.
  const uniqueName = randomBytes(16).toString('hex');
  const fileExtName = extname(file.originalname);
  callback(null, `${uniqueName}${fileExtName}`);
};

@Injectable()
export class MulterConfigService {
  private readonly logger = new Logger(MulterConfigService.name);

  createMulterOptions() {
    return {
      storage: diskStorage({
        destination: './uploads',
        filename: editFileName,
      }),
      fileFilter: imageFileFilter,
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    };
  }
}

export const multerConfig = {
  storage: diskStorage({
    destination: './uploads',
    filename: editFileName,
  }),
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
};
