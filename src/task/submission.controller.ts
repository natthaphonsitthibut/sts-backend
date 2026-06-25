import {
  Controller,
  Post,
  Param,
  Body,
  Inject,
  UseInterceptors,
  UploadedFiles,
  HttpException,
  HttpStatus,
  Logger,
  Req,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import { TaskService } from './task.service';
import { appConfig } from '../config/app.config';
import { multerConfig } from '../common/interceptors/file-upload.interceptor';
import { processVisitPhoto } from '../common/file-upload/visit-photo.util';
import { getHeaderValue } from './task.types';

@Controller('api/tasks')
export class SubmissionController {
  private readonly logger = new Logger(SubmissionController.name);

  constructor(
    private readonly taskService: TaskService,
    @Inject(appConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof appConfig>,
  ) {}

  private parseOptionalNumber(value?: string): number | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseBoolean(value?: string): boolean {
    if (typeof value !== 'string') return false;
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }

  @Post(':token/submit')
  @UseInterceptors(FilesInterceptor('photos', 5, multerConfig))
  async submitReport(
    @Param('token') token: string,
    @Body() body: Record<string, string>,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: Request,
  ) {
    this.logger.log(`[submitReport] files=${files?.length || 0}`);

    // Strip EXIF/GPS + re-encode each photo before persisting; the stored name is
    // server-generated. Raw uploads stay in memory and are never written as-is.
    const photoPaths = files?.length
      ? await Promise.all(
          files.map(
            async (f) => `/uploads/${await processVisitPhoto(f, this.runtimeConfig.uploadsDir)}`,
          ),
        )
      : [];

    const causeDetail = body.cause_detail || body.notes || '';
    const addressChanged = this.parseBoolean(body.address_changed);
    const data = {
      cause_category: body.cause_category,
      cause_detail: causeDetail,
      visit_lat: this.parseOptionalNumber(body.visit_lat),
      visit_lng: this.parseOptionalNumber(body.visit_lng),
      recommendation: body.recommendation,
      notes: causeDetail,
      status: body.status || 'COMPLETED',
      address_changed: addressChanged,
      updated_student_address: body.updated_student_address?.trim() || null,
      updated_lat: this.parseOptionalNumber(body.updated_lat),
      updated_lng: this.parseOptionalNumber(body.updated_lng),
      photo_paths: JSON.stringify(photoPaths),
    };

    try {
      const sessionToken = getHeaderValue(req.headers['x-magic-session']);
      const result = await this.taskService.saveTaskSubmission(token, data, sessionToken);
      return { ...result, success: true };
    } catch (err: unknown) {
      if (err instanceof HttpException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : 'Submit failed';
      this.logger.error(`submitReport error: ${message}`);
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }
}
