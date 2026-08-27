import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { basename } from 'path';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { TaskRepository } from '../task/task.repository';
import { FILE_STORAGE_ADAPTER, type FileStorageAdapter } from './storage/file-storage.types';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const INLINE_VIEWABLE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

// Visit-report uploads are sensitive minor PII (home-visit photos). They used to
// be served as public static files (anyone with the URL, no login). This guarded
// controller replaces that: a request must be authenticated and hold the same
// 'students' permission that gates case/student data. Per-school scoping rides
// with the case->school mapping follow-up (cases currently carry no school_id).
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('students')
// Keep the legacy direct prefix for old clients, while `/api/uploads` is the
// canonical route used by the Vercel API rewrite and every protected-media URL
// returned to the current frontend.
@Controller(['api/uploads', 'uploads'])
export class FilesController {
  constructor(
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage: FileStorageAdapter,
    private readonly taskRepository: TaskRepository,
  ) {}

  @Get('visit-attachments/:filename')
  async getVisitAttachment(
    @Param('filename') filename: string,
    @Query('download') download: string | undefined,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertVisitAttachmentAccess(`/uploads/visit-attachments/${filename}`, actor);
    await this.sendStoredFile(`visit-attachments/${filename}`, res, download === '1');
  }

  @Get(':filename')
  async getUpload(
    @Param('filename') filename: string,
    @Query('download') download: string | undefined,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertVisitAttachmentAccess(`/uploads/${filename}`, actor);
    await this.sendStoredFile(filename, res, download === '1');
  }

  private async assertVisitAttachmentAccess(
    storagePath: string,
    actor: AuthenticatedRequestUser,
  ): Promise<void> {
    if (!(await this.taskRepository.canAccessVisitAttachment(storagePath, actor))) {
      throw new NotFoundException('File not found');
    }
  }

  private async sendStoredFile(
    storageKey: string,
    res: Response,
    forceDownload = false,
  ): Promise<void> {
    const pathSegments = storageKey.split('/');
    if (
      pathSegments.length === 0 ||
      pathSegments.some(
        (segment) =>
          !segment ||
          segment !== basename(segment) ||
          !/^[A-Za-z0-9._-]+$/.test(segment) ||
          segment.includes('..'),
      )
    ) {
      throw new BadRequestException('Invalid file name');
    }

    const filename = pathSegments.at(-1)!;
    const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream';
    // Photos and PDFs are meant to be looked at, so they are served inline and
    // only turn into a download when the caller asks for it (`?download=1`).
    // Word documents no browser can render stay attachments either way.
    const disposition =
      forceDownload || !INLINE_VIEWABLE_TYPES.has(contentType) ? 'attachment' : 'inline';

    const applyHeaders = (): void => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // These are home-visit photos of minors and the machines that open them
      // are shared staffroom computers, so the bytes must never reach the disk
      // cache: a cached copy is served without this guard ever running again.
      // Displaying inline does not depend on caching, only on the two headers
      // below. If refetching ever costs too much, add an ETag and revalidate
      // with `no-cache` — never `max-age`, which skips the server entirely.
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    };

    if (this.storage.kind === 'local') {
      const stored = await this.storage.resolve(storageKey);
      if (!stored || stored.kind !== 'local') {
        throw new NotFoundException('File not found');
      }
      applyHeaders();
      res.sendFile(stored.filePath);
      return;
    }

    // Object storage is streamed through this route rather than redirected to a
    // signed URL: a redirect is answered with the object store's own headers, so
    // objects stored before uploads sent a real Content-Type arrived as
    // application/octet-stream and every browser force-downloaded them, photos
    // included. Streaming also keeps the signed URL out of the client.
    const stream = await this.storage.open(storageKey);
    if (!stream) {
      throw new NotFoundException('File not found');
    }
    applyHeaders();
    stream.on('error', () => res.destroy());
    // A reader who closes the tab mid-download leaves the upstream object
    // response open otherwise: `pipe` unpipes on a closed destination but never
    // destroys the source, so every aborted request would hold a socket.
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}
