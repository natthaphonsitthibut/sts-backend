import {
  Controller,
  Post,
  Param,
  Body,
  UseInterceptors,
  UploadedFiles,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { TaskService } from './task.service';
import { multerConfig } from '../common/interceptors/file-upload.interceptor';

@Controller('api/tasks')
export class SubmissionController {
  private readonly logger = new Logger(SubmissionController.name);

  constructor(private readonly taskService: TaskService) {}

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
  ) {
    this.logger.log(`[submitReport] token=${token}, files=${files?.length || 0}`);

    const photoPaths = files?.map((f) => `/uploads/${f.filename}`) || [];

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
      const result = await this.taskService.saveTaskSubmission(token, data);
      return { ...result, success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Submit failed';
      this.logger.error(`submitReport error: ${message}`);
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }
}
