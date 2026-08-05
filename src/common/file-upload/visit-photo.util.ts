import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import type { FileStorageAdapter } from '../../files/storage/file-storage.types';
import { detectImageType } from './file-signature.util';

// Process an uploaded home-visit photo before it is persisted:
//  1. Validate the real image type from magic bytes (not the client MIME).
//  2. `.rotate()` bakes in EXIF orientation, then re-encoding drops ALL metadata
//     — including EXIF GPS, which on a child's home photo is sensitive PII (PDPA).
//  3. Re-encoding also neutralizes any non-image payload smuggled past the MIME
//     gate, since sharp fails on input that is not a real image.
// The raw upload stays in memory (memoryStorage) and is never written to disk
// as-is, so the original GPS-bearing file never lands in storage. Where the
// re-encoded result is persisted (local disk vs Supabase Storage) is the
// injected adapter's concern, not this function's.
export async function processImageUpload(
  file: Express.Multer.File,
  storage: FileStorageAdapter,
  directory?: string,
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
  const storageKey = directory ? `${directory.replace(/^\/+|\/+$/g, '')}/${filename}` : filename;
  await storage.save(output, storageKey);
  return storageKey;
}

export async function processVisitPhoto(
  file: Express.Multer.File,
  storage: FileStorageAdapter,
): Promise<string> {
  return processImageUpload(file, storage);
}

const PDF_SIGNATURE = Buffer.from('%PDF-');
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function startsWith(buffer: Buffer, signature: Buffer): boolean {
  return (
    buffer.length >= signature.length && buffer.subarray(0, signature.length).equals(signature)
  );
}

function isDocx(buffer: Buffer): boolean {
  if (!startsWith(buffer, ZIP_SIGNATURE)) return false;
  const archiveText = buffer.toString('latin1');
  return archiveText.includes('[Content_Types].xml') && archiveText.includes('word/');
}

/**
 * Curriculum learning-content upload (`เนื้อหาสาระการเรียนรู้`). PDF only, and the
 * magic bytes must agree with the declared MIME so a renamed executable cannot
 * ride in on `application/pdf`.
 */
export async function processCurriculumPdf(
  file: Express.Multer.File,
  storage: FileStorageAdapter,
  directory = 'curriculum-content',
): Promise<string> {
  if (file.mimetype !== 'application/pdf' || !startsWith(file.buffer, PDF_SIGNATURE)) {
    throw new BadRequestException('รองรับเฉพาะไฟล์ PDF เท่านั้น');
  }
  const filename = `${randomBytes(16).toString('hex')}.pdf`;
  const storageKey = `${directory.replace(/^\/+|\/+$/g, '')}/${filename}`;
  await storage.save(file.buffer, storageKey);
  return storageKey;
}

export async function processVisitAttachment(
  file: Express.Multer.File,
  storage: FileStorageAdapter,
): Promise<string> {
  const detectedImage = detectImageType(file.buffer);
  if (detectedImage) {
    const expectedMimeTypes: Record<typeof detectedImage, string[]> = {
      jpeg: ['image/jpeg', 'image/jpg'],
      png: ['image/png'],
      gif: ['image/gif'],
      webp: ['image/webp'],
    };
    if (!expectedMimeTypes[detectedImage].includes(file.mimetype)) {
      throw new BadRequestException('ชนิดไฟล์หรือเนื้อหาไฟล์ไม่ถูกต้อง');
    }
    return processVisitPhoto(file, storage);
  }

  let extension: '.pdf' | '.doc' | '.docx' | null = null;
  if (file.mimetype === 'application/pdf' && startsWith(file.buffer, PDF_SIGNATURE)) {
    extension = '.pdf';
  } else if (file.mimetype === 'application/msword' && startsWith(file.buffer, OLE_SIGNATURE)) {
    extension = '.doc';
  } else if (
    file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
    isDocx(file.buffer)
  ) {
    extension = '.docx';
  }

  if (!extension) {
    throw new BadRequestException('ชนิดไฟล์หรือเนื้อหาไฟล์ไม่ถูกต้อง');
  }

  const filename = `${randomBytes(16).toString('hex')}${extension}`;
  await storage.save(file.buffer, filename);
  return filename;
}
