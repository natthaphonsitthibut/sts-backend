import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
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

// Visit-report uploads are sensitive minor PII (home-visit photos). They used to
// be served as public static files (anyone with the URL, no login). This guarded
// controller replaces that: a request must be authenticated and hold the same
// 'students' permission that gates case/student data. Per-school scoping rides
// with the case->school mapping follow-up (cases currently carry no school_id).
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('students')
@Controller('uploads')
export class FilesController {
  constructor(
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage: FileStorageAdapter,
    private readonly taskRepository: TaskRepository,
  ) {}

  @RequirePermission('field-monitor')
  @Get('field-follower-id-cards/:filename')
  async getFieldFollowerIdCard(
    @Param('filename') filename: string,
    @Res() res: Response,
  ): Promise<void> {
    await this.sendStoredFile(filename, res);
  }

  @Get('visit-attachments/:filename')
  async getVisitAttachment(
    @Param('filename') filename: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertVisitAttachmentAccess(`/uploads/visit-attachments/${filename}`, actor);
    await this.sendStoredFile(`visit-attachments/${filename}`, res);
  }

  @Get(':filename')
  async getUpload(
    @Param('filename') filename: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res() res: Response,
  ): Promise<void> {
    await this.assertVisitAttachmentAccess(`/uploads/${filename}`, actor);
    await this.sendStoredFile(filename, res);
  }

  private async assertVisitAttachmentAccess(
    storagePath: string,
    actor: AuthenticatedRequestUser,
  ): Promise<void> {
    if (!(await this.taskRepository.canAccessVisitAttachment(storagePath, actor))) {
      throw new NotFoundException('File not found');
    }
  }

  private async sendStoredFile(storageKey: string, res: Response): Promise<void> {
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

    const result = await this.storage.resolve(storageKey);
    if (!result) {
      throw new NotFoundException('File not found');
    }

    const filename = pathSegments.at(-1)!;
    const extension = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    const contentType: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Do not cache the redirect: the private Supabase signed URL it contains
    // would expire and make a valid attachment appear broken after its TTL.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', contentType[extension] ?? 'application/octet-stream');
    if (extension === '.doc' || extension === '.docx') {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    } else {
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    }

    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }

    res.sendFile(result.filePath);
  }
}
