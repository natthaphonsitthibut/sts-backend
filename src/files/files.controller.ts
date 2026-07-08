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
import { AuthGuard, PermissionsGuard, RequirePermission } from '../auth';
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
  ) {}

  @Get(':filename')
  async getUpload(@Param('filename') filename: string, @Res() res: Response): Promise<void> {
    // Reject anything that is not a bare, safe filename (path-traversal defense).
    // Done here, before the adapter, since the local-disk adapter's own check
    // still relies on the caller having already ruled out traversal attempts.
    const safeName = basename(filename);
    if (safeName !== filename || !/^[A-Za-z0-9._-]+$/.test(safeName) || safeName.includes('..')) {
      throw new BadRequestException('Invalid file name');
    }

    const result = await this.storage.resolve(safeName);
    if (!result) {
      throw new NotFoundException('File not found');
    }

    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }

    res.sendFile(result.filePath);
  }
}
