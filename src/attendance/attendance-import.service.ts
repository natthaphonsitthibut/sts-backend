import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as xlsx from 'xlsx';
import { attendanceImportConfig } from '../config/attendance-import.config';
import { isXlsxBuffer, looksLikeTextBuffer } from '../common/file-upload/file-signature.util';

export type AttendanceImportSource = 'FILE' | 'URL';

export interface AttendanceImportSheet {
  source: AttendanceImportSource;
  /** Uploaded filename, or the resolved download URL for a URL import. */
  origin: string;
  headers: string[];
  rows: string[][];
  /** True when the sheet had more rows than the configured cap. */
  truncated: boolean;
}

/** Cell values arrive as strings, numbers or dates depending on the source. */
type SheetCell = string | number | boolean | Date | null | undefined;

const GOOGLE_SHEET_PATH = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)/;
const GOOGLE_DRIVE_FILE_PATH = /^\/file\/d\/([A-Za-z0-9_-]+)/;

/**
 * Turns an uploaded spreadsheet — or one behind an allowlisted share URL — into
 * plain header/row strings. Matching those rows to a roster is deliberately left
 * to the caller: the sheet is teacher-supplied data, so this service never needs
 * to read student records and no extra data leaves the server because of it.
 */
@Injectable()
export class AttendanceImportService {
  constructor(
    @Inject(attendanceImportConfig.KEY)
    private readonly config: ConfigType<typeof attendanceImportConfig>,
  ) {}

  /**
   * Records an applied import: the file (or the link it came from), the round it
   * filled and who did it. Called after the marks land, so an abandoned preview
   * never shows up as history.
   */
  parseUpload(file: Express.Multer.File): AttendanceImportSheet {
    if (!file?.buffer?.length) {
      throw new BadRequestException('ไม่พบไฟล์ที่อัปโหลด');
    }
    if (file.buffer.byteLength > this.config.maxFileBytes) {
      throw new BadRequestException(this.fileTooLargeMessage());
    }
    return {
      source: 'FILE',
      origin: file.originalname,
      ...this.readWorkbook(file.buffer),
    };
  }

  async parseUrl(rawUrl: string): Promise<AttendanceImportSheet> {
    const downloadUrl = this.resolveDownloadUrl(rawUrl);
    const buffer = await this.download(downloadUrl);
    return {
      source: 'URL',
      origin: downloadUrl.toString(),
      ...this.readWorkbook(buffer),
    };
  }

  /**
   * Share links point at a viewer page, not a file. Google exposes a documented
   * export endpoint per document id, so a plain "copy link" from Sheets/Drive
   * works without asking the teacher to publish a separate download URL.
   * OneDrive/SharePoint serve the file when `download=1` is present.
   */
  private resolveDownloadUrl(rawUrl: string): URL {
    const url = this.parseHttpsUrl(rawUrl);
    this.assertHostAllowed(url);

    if (url.hostname === 'docs.google.com') {
      const documentId = GOOGLE_SHEET_PATH.exec(url.pathname)?.[1];
      if (documentId) {
        const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${documentId}/export`);
        exportUrl.searchParams.set('format', 'xlsx');
        // A link copied while a specific tab is open carries `gid` in the hash.
        const gid = new URLSearchParams(url.hash.replace(/^#/, '')).get('gid');
        if (gid && /^\d+$/.test(gid)) exportUrl.searchParams.set('gid', gid);
        return exportUrl;
      }
    }

    if (url.hostname === 'drive.google.com') {
      const fileId = GOOGLE_DRIVE_FILE_PATH.exec(url.pathname)?.[1] ?? url.searchParams.get('id');
      if (fileId && /^[A-Za-z0-9_-]+$/.test(fileId)) {
        return new URL(
          `https://drive.usercontent.google.com/download?export=download&id=${fileId}`,
        );
      }
    }

    if (this.isOneDriveHost(url.hostname)) {
      url.searchParams.set('download', '1');
      return url;
    }

    return url;
  }

  private parseHttpsUrl(rawUrl: string): URL {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
    } catch {
      throw new BadRequestException('ลิงก์ไม่ถูกต้อง');
    }
    if (url.protocol !== 'https:') {
      throw new BadRequestException('รองรับเฉพาะลิงก์ https');
    }
    if (url.username || url.password) {
      throw new BadRequestException('ลิงก์ไม่ถูกต้อง');
    }
    return url;
  }

  private normalizeSourceUrl(rawUrl: string): string {
    const url = this.parseHttpsUrl(rawUrl);
    this.assertHostAllowed(url);
    return url.toString();
  }

  private isOneDriveHost(hostname: string): boolean {
    return (
      hostname === 'onedrive.live.com' ||
      hostname === '1drv.ms' ||
      hostname.endsWith('.sharepoint.com')
    );
  }

  private assertHostAllowed(url: URL): void {
    const hostname = url.hostname.toLowerCase();
    const allowed = this.config.allowedUrlHosts.some((entry) =>
      entry.startsWith('*.')
        ? hostname.endsWith(entry.slice(1)) && hostname !== entry.slice(2)
        : hostname === entry,
    );
    if (!allowed) {
      throw new BadRequestException(
        `ยังไม่รองรับลิงก์จาก ${hostname} — รองรับ ${this.config.allowedUrlHosts.join(', ')}`,
      );
    }
  }

  /**
   * Fetches the sheet while re-checking every redirect hop: an allowlisted host
   * must not be able to bounce the request onto an internal address. The resolved
   * address is verified to be public as a second layer, and the body is capped
   * while streaming so an oversized response cannot be buffered whole.
   */
  private async download(initialUrl: URL): Promise<Buffer> {
    let url = initialUrl;

    for (let hop = 0; hop <= this.config.maxRedirects; hop += 1) {
      this.assertHostAllowed(url);
      await this.assertPublicAddress(url.hostname);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.fetchTimeoutMs);
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { accept: '*/*' },
          redirect: 'manual',
          signal: controller.signal,
        });
      } catch {
        throw new BadRequestException('ดึงไฟล์จากลิงก์ไม่สำเร็จ');
      } finally {
        clearTimeout(timeout);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new BadRequestException('ดึงไฟล์จากลิงก์ไม่สำเร็จ');
        void response.body?.cancel();
        url = this.parseHttpsUrl(new URL(location, url).toString());
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new BadRequestException(
          'ลิงก์นี้ยังไม่ได้เปิดสิทธิ์ให้ผู้ที่มีลิงก์เข้าถึง กรุณาแชร์ไฟล์แบบ "ผู้ที่มีลิงก์" แล้วลองใหม่',
        );
      }
      if (!response.ok) {
        throw new BadRequestException('ดึงไฟล์จากลิงก์ไม่สำเร็จ');
      }

      const declaredLength = Number.parseInt(response.headers.get('content-length') || '', 10);
      if (Number.isInteger(declaredLength) && declaredLength > this.config.maxFileBytes) {
        void response.body?.cancel();
        throw new BadRequestException(this.fileTooLargeMessage());
      }

      return await this.readCappedBody(response);
    }

    throw new BadRequestException('ลิงก์นี้ถูกเปลี่ยนเส้นทางหลายครั้งเกินไป');
  }

  private async readCappedBody(response: Response): Promise<Buffer> {
    const body = response.body;
    if (!body) throw new BadRequestException('ดึงไฟล์จากลิงก์ไม่สำเร็จ');

    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > this.config.maxFileBytes) {
          throw new BadRequestException(this.fileTooLargeMessage());
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      void reader.cancel().catch(() => undefined);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Defence in depth against an allowlisted name resolving inward (DNS rebinding
   * or a misconfigured internal record).
   */
  private async assertPublicAddress(hostname: string): Promise<void> {
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true }).catch(() => {
          throw new BadRequestException('ดึงไฟล์จากลิงก์ไม่สำเร็จ');
        });
    if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
      throw new BadRequestException('ลิงก์นี้ชี้ไปยังเครือข่ายภายใน จึงไม่อนุญาต');
    }
  }

  private fileTooLargeMessage(): string {
    return `ไฟล์มีขนาดเกิน ${Math.round(this.config.maxFileBytes / (1024 * 1024))} MB`;
  }

  private readWorkbook(buffer: Buffer): Omit<AttendanceImportSheet, 'source' | 'origin'> {
    // Validate by content, not by the client-supplied extension: an xlsx is a
    // zip container and a csv is text.
    if (!isXlsxBuffer(buffer) && !looksLikeTextBuffer(buffer)) {
      throw new BadRequestException('ไฟล์ไม่ถูกต้อง (รองรับเฉพาะ .xlsx หรือ .csv)');
    }

    const maxRows = this.config.maxRows;
    const workbook = xlsx.read(buffer, {
      type: 'buffer',
      raw: true,
      // header row + capped data rows + 1 so an over-cap sheet is detectable
      // instead of being silently truncated.
      sheetRows: maxRows + 2,
    });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new BadRequestException('ไม่พบข้อมูลในไฟล์');
    }

    const table = xlsx.utils.sheet_to_json<SheetCell[]>(workbook.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: '',
    });
    const [headerRow, ...dataRows] = table;
    if (!headerRow) {
      throw new BadRequestException('ไม่พบข้อมูลในไฟล์');
    }

    const headers = headerRow.map((cell) => normalizeCell(cell));
    const columnCount = headers.length;
    const rows = dataRows
      .slice(0, maxRows)
      .map((row) => Array.from({ length: columnCount }, (_, index) => normalizeCell(row[index])))
      .filter((row) => row.some((cell) => cell.length > 0));

    return { headers, rows, truncated: dataRows.length > maxRows };
  }
}

function normalizeCell(cell: SheetCell): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

/** RFC 1918 / loopback / link-local / unique-local ranges, IPv4 and IPv6. */
function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase();
  if (isIP(value) === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      value === '::' ||
      value === '::1' ||
      value.startsWith('fc') ||
      value.startsWith('fd') ||
      value.startsWith('fe8') ||
      value.startsWith('fe9') ||
      value.startsWith('fea') ||
      value.startsWith('feb')
    );
  }

  const octets = value.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}
