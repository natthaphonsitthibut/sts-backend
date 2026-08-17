import { BadRequestException } from '@nestjs/common';
import * as xlsx from 'xlsx';
import { lookup } from 'dns/promises';
import { AttendanceImportService } from './attendance-import.service';
import {
  ATTENDANCE_IMPORT_MAX_FILE_BYTES,
  type AttendanceImportRuntimeConfig,
} from '../config/attendance-import.config';

// Resolution is stubbed so the suite never depends on DNS being reachable; the
// private-address guard itself is exercised through the stubbed answer.
jest.mock('dns/promises', () => ({ lookup: jest.fn() }));
const lookupMock = lookup as unknown as jest.Mock;

const CONFIG: AttendanceImportRuntimeConfig = {
  allowedUrlHosts: ['docs.google.com', 'drive.google.com', '*.sharepoint.com'],
  maxFileBytes: ATTENDANCE_IMPORT_MAX_FILE_BYTES,
  maxRows: 3,
  fetchTimeoutMs: 1_000,
  maxRedirects: 2,
};

function createService(overrides: Partial<AttendanceImportRuntimeConfig> = {}) {
  return new AttendanceImportService(
    { ...CONFIG, ...overrides },
    { record: jest.fn(), list: jest.fn(), findForDownload: jest.fn() } as never,
    { save: jest.fn(), open: jest.fn() } as never,
  );
}

function workbookBuffer(rows: unknown[][]): Buffer {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(rows), 'Sheet1');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function upload(buffer: Buffer, originalname = 'attendance.xlsx'): Express.Multer.File {
  return { buffer, originalname } as Express.Multer.File;
}

describe('AttendanceImportService', () => {
  describe('recordApplied', () => {
    function createRecordService() {
      const history = { record: jest.fn().mockResolvedValue({ id: '41' }) };
      const storage = { save: jest.fn(), open: jest.fn() };
      return {
        history,
        storage,
        service: new AttendanceImportService(CONFIG, history as never, storage as never),
      };
    }

    const input = {
      schoolId: 1,
      schoolTermId: 2,
      classroomId: 3,
      attendanceDate: '2026-08-18',
      timetableSlotId: null,
      subjectId: null,
      fileName: 'attendance.xlsx',
      rowCount: 10,
      appliedCount: 9,
      importedBy: 4,
      importedByLabel: 'ผู้ใช้ ทดสอบ',
    };

    it('validates an applied URL again instead of trusting the preview request', async () => {
      const { service, history } = createRecordService();

      await expect(
        service.recordApplied({ ...input, sourceUrl: 'javascript:alert(1)' }),
      ).rejects.toThrow(BadRequestException);
      expect(history.record).not.toHaveBeenCalled();
    });

    it('stores only a normalized allowlisted HTTPS URL', async () => {
      const { service, history } = createRecordService();

      await service.recordApplied({
        ...input,
        sourceUrl: ' https://docs.google.com/spreadsheets/d/abc123/edit ',
      });

      expect(history.record).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceUrl: 'https://docs.google.com/spreadsheets/d/abc123/edit',
        }),
      );
    });

    it('rejects a request that claims both file and URL provenance', async () => {
      const { service, history, storage } = createRecordService();

      await expect(
        service.recordApplied({
          ...input,
          sourceUrl: 'https://docs.google.com/spreadsheets/d/abc123/edit',
          file: upload(workbookBuffer([['student']])),
        }),
      ).rejects.toThrow(/อย่างใดอย่างหนึ่ง/);
      expect(history.record).not.toHaveBeenCalled();
      expect(storage.save).not.toHaveBeenCalled();
    });
  });

  describe('parseUpload', () => {
    it('reads headers and trimmed rows from the first sheet', () => {
      const sheet = createService().parseUpload(
        upload(
          workbookBuffer([
            ['ลำดับ', 'รหัสประจำตัว', 'ชื่อ-นามสกุล', 'สถานะการเช็กชื่อ'],
            [1, ' 66160001 ', 'สมชาย ใจดี', 'มา'],
            [2, 66160002, 'สมหญิง ใจงาม', 'สาย'],
          ]),
        ),
      );

      expect(sheet.source).toBe('FILE');
      expect(sheet.headers).toEqual(['ลำดับ', 'รหัสประจำตัว', 'ชื่อ-นามสกุล', 'สถานะการเช็กชื่อ']);
      expect(sheet.rows).toEqual([
        ['1', '66160001', 'สมชาย ใจดี', 'มา'],
        ['2', '66160002', 'สมหญิง ใจงาม', 'สาย'],
      ]);
      expect(sheet.truncated).toBe(false);
    });

    it('drops fully blank rows and pads short rows to the header width', () => {
      const sheet = createService().parseUpload(
        upload(
          workbookBuffer([
            ['รหัสประจำตัว', 'ชื่อ-นามสกุล', 'สถานะการเช็กชื่อ'],
            ['66160001', 'สมชาย ใจดี'],
            ['', '', ''],
          ]),
        ),
      );

      expect(sheet.rows).toEqual([['66160001', 'สมชาย ใจดี', '']]);
    });

    it('flags a sheet with more rows than the cap instead of truncating silently', () => {
      const sheet = createService({ maxRows: 2 }).parseUpload(
        upload(workbookBuffer([['รหัสประจำตัว'], ['66160001'], ['66160002'], ['66160003']])),
      );

      expect(sheet.rows).toHaveLength(2);
      expect(sheet.truncated).toBe(true);
    });

    it('rejects a binary payload that is neither a spreadsheet nor text', () => {
      const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
      expect(() => createService().parseUpload(upload(binary, 'fake.csv'))).toThrow(
        BadRequestException,
      );
    });

    it('rejects an upload larger than the cap', () => {
      const service = createService({ maxFileBytes: 8 });
      expect(() => service.parseUpload(upload(workbookBuffer([['a']])))).toThrow(
        BadRequestException,
      );
    });
  });

  describe('parseUrl', () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
      fetchMock.mockReset();
      lookupMock.mockReset();
      lookupMock.mockResolvedValue([{ address: '142.250.1.1', family: 4 }]);
      global.fetch = fetchMock;
    });

    it('refuses a host that resolves to a private address', async () => {
      lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

      await expect(
        createService().parseUrl('https://docs.google.com/spreadsheets/d/abc123/edit'),
      ).rejects.toThrow(/เครือข่ายภายใน/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    function sheetResponse(buffer: Buffer): Response {
      return new Response(buffer, { status: 200 });
    }

    it('rejects a host outside the allowlist', async () => {
      await expect(createService().parseUrl('https://example.com/roster.xlsx')).rejects.toThrow(
        BadRequestException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a non-https link', async () => {
      await expect(
        createService().parseUrl('http://docs.google.com/spreadsheets/d/abc123/edit'),
      ).rejects.toThrow(BadRequestException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('turns a Google Sheets share link into its xlsx export URL', async () => {
      fetchMock.mockResolvedValue(sheetResponse(workbookBuffer([['รหัสประจำตัว'], ['66160001']])));

      const sheet = await createService().parseUrl(
        'https://docs.google.com/spreadsheets/d/abc123/edit#gid=42',
      );

      const requested = (fetchMock.mock.calls as unknown as URL[][])[0][0];
      expect(requested.toString()).toBe(
        'https://docs.google.com/spreadsheets/d/abc123/export?format=xlsx&gid=42',
      );
      expect(sheet.source).toBe('URL');
      expect(sheet.rows).toEqual([['66160001']]);
    });

    it('re-checks the allowlist on every redirect hop', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://evil.test/payload' } }),
      );

      await expect(
        createService().parseUrl('https://docs.google.com/spreadsheets/d/abc123/edit'),
      ).rejects.toThrow(BadRequestException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('stops after the configured number of redirects', async () => {
      fetchMock.mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { location: 'https://docs.google.com/spreadsheets/d/abc123/export' },
        }),
      );

      await expect(
        createService().parseUrl('https://docs.google.com/spreadsheets/d/abc123/edit'),
      ).rejects.toThrow(BadRequestException);
      expect(fetchMock).toHaveBeenCalledTimes(CONFIG.maxRedirects + 1);
    });

    it('explains that a private link needs sharing when the host answers 403', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

      await expect(
        createService().parseUrl('https://docs.google.com/spreadsheets/d/abc123/edit'),
      ).rejects.toThrow(/เปิดสิทธิ์/);
    });

    it('rejects a body larger than the cap while streaming', async () => {
      fetchMock.mockResolvedValue(sheetResponse(workbookBuffer([['รหัสประจำตัว'], ['66160001']])));

      await expect(
        createService({ maxFileBytes: 16 }).parseUrl(
          'https://docs.google.com/spreadsheets/d/abc123/edit',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
