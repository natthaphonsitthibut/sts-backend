// Content-based file validation: inspect the leading bytes (magic number) of an
// uploaded buffer instead of trusting the client-supplied MIME/extension, both of
// which are trivially spoofed. Kept dependency-free on purpose — the accepted set
// is small and fixed, so a hand-rolled signature check is enough and avoids
// pulling another production dependency.

export type DetectedImageType = 'jpeg' | 'png' | 'gif' | 'webp';

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/** Real image type from magic bytes, or null when the content is not a supported image. */
export function detectImageType(buf: Buffer): DetectedImageType | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  return null;
}

/** xlsx is a zip container — it begins with a PK local-file-header signature. */
export function isXlsxBuffer(buf: Buffer): boolean {
  return (
    startsWith(buf, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(buf, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(buf, [0x50, 0x4b, 0x07, 0x08])
  );
}

/** CSV has no magic number; accept it as text when the leading bytes contain no
 * NUL byte. Enough to reject a binary payload mislabeled as .csv. */
export function looksLikeTextBuffer(buf: Buffer): boolean {
  const sample = buf.subarray(0, 8192);
  if (sample.length === 0) return false;
  return !sample.includes(0x00);
}
