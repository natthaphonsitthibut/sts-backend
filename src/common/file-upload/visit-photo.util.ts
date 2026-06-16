import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { detectImageType } from './file-signature.util';

// Process an uploaded home-visit photo before it is persisted:
//  1. Validate the real image type from magic bytes (not the client MIME).
//  2. `.rotate()` bakes in EXIF orientation, then re-encoding drops ALL metadata
//     — including EXIF GPS, which on a child's home photo is sensitive PII (PDPA).
//  3. Re-encoding also neutralizes any non-image payload smuggled past the MIME
//     gate, since sharp fails on input that is not a real image.
// The raw upload stays in memory (memoryStorage) and is never written to disk, so
// the original GPS-bearing file never lands on the filesystem.
export async function processVisitPhoto(
  file: Express.Multer.File,
  uploadsDir: string,
): Promise<string> {
  const detected = detectImageType(file.buffer);
  if (!detected) {
    throw new BadRequestException('ไฟล์รูปไม่ถูกต้อง (รองรับ jpg, png, gif, webp)');
  }

  let output: Buffer;
  let ext: string;
  try {
    const pipeline = sharp(file.buffer, { failOn: 'error' }).rotate();
    if (detected === 'png') {
      output = await pipeline.png({ compressionLevel: 9 }).toBuffer();
      ext = '.png';
    } else if (detected === 'webp') {
      output = await pipeline.webp({ quality: 82 }).toBuffer();
      ext = '.webp';
    } else {
      // jpeg, or gif (first frame) → normalize to jpeg
      output = await pipeline.jpeg({ quality: 82 }).toBuffer();
      ext = '.jpg';
    }
  } catch {
    throw new BadRequestException('ไฟล์รูปเสียหายหรือไม่ใช่รูปภาพที่รองรับ');
  }

  const filename = `${randomBytes(16).toString('hex')}${ext}`;
  await mkdir(uploadsDir, { recursive: true });
  await writeFile(join(uploadsDir, filename), output);
  return filename;
}
