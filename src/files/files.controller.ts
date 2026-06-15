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
import type { ConfigType } from '@nestjs/config';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { basename, join, resolve, sep } from 'path';
import { AuthGuard, PermissionsGuard, RequirePermission } from '../auth';
import { appConfig } from '../config/app.config';

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
    @Inject(appConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof appConfig>,
  ) {}

  @Get(':filename')
  getUpload(@Param('filename') filename: string, @Res() res: Response): void {
    // Reject anything that is not a bare, safe filename (path-traversal defense).
    const safeName = basename(filename);
    if (safeName !== filename || !/^[A-Za-z0-9._-]+$/.test(safeName) || safeName.includes('..')) {
      throw new BadRequestException('Invalid file name');
    }

    const baseDir = resolve(this.runtimeConfig.uploadsDir);
    const fullPath = resolve(join(baseDir, safeName));
    // Belt-and-suspenders: the resolved path must stay inside the uploads dir.
    if (fullPath !== join(baseDir, safeName) && !fullPath.startsWith(baseDir + sep)) {
      throw new BadRequestException('Invalid file path');
    }

    if (!existsSync(fullPath)) {
      throw new NotFoundException('File not found');
    }

    res.sendFile(fullPath);
  }
}
