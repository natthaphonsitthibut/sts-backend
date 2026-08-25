import {
  BadRequestException,
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
import type { Request } from 'express';
import { FilesInterceptor } from '@nestjs/platform-express';
import { TaskService } from './task.service';
import { Public } from '../auth';
import { multerConfig } from '../common/interceptors/file-upload.interceptor';
import { processVisitAttachment } from '../common/file-upload/visit-photo.util';
import { FILE_STORAGE_ADAPTER, type FileStorageAdapter } from '../files/storage/file-storage.types';
import { getHeaderValue } from './task.types';

@Public()
@Controller('api/tasks')
export class SubmissionController {
  private readonly logger = new Logger(SubmissionController.name);

  constructor(
    private readonly taskService: TaskService,
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage: FileStorageAdapter,
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

  private parseHomeVisitException(value?: string): string | null {
    const normalized = value?.trim().toUpperCase();
    if (!normalized) return null;
    if (normalized.length > 40) {
      throw new BadRequestException('กรณีพิเศษจากการลงพื้นที่ไม่ถูกต้อง');
    }
    return normalized;
  }

  private parseExecutionOutcome(value?: string): 'SUCCEEDED' | 'NOT_SUCCEEDED' {
    const normalized = value?.trim().toUpperCase();
    if (normalized !== 'SUCCEEDED' && normalized !== 'NOT_SUCCEEDED') {
      throw new BadRequestException('กรุณาเลือกผลการดำเนินงานครั้งนี้');
    }
    return normalized;
  }

  private parseOptionCode(value: string | undefined, invalidMessage: string): string | null {
    const normalized = value?.trim().toUpperCase();
    if (!normalized) return null;
    if (normalized.length > 40) {
      throw new BadRequestException(invalidMessage);
    }
    return normalized;
  }

  /**
   * Multipart repeats one field per picked value, so the same key arrives as a
   * string when a single factor is chosen and as an array when several are.
   */
  private parseOptionCodeList(value: unknown, invalidMessage: string): string[] {
    const entries = Array.isArray(value) ? value : value == null ? [] : [value];
    const codes = entries.map((entry) =>
      this.parseOptionCode(typeof entry === 'string' ? entry : undefined, invalidMessage),
    );
    if (codes.some((code) => code === null)) {
      throw new BadRequestException(invalidMessage);
    }
    return Array.from(new Set(codes as string[]));
  }

  private async cleanupStoredFiles(storageKeys: string[], context: string): Promise<void> {
    const results = await Promise.allSettled(
      storageKeys.map((storageKey) => this.storage.delete(storageKey)),
    );
    const failedCount = results.filter((result) => result.status === 'rejected').length;
    if (failedCount > 0) {
      this.logger.error(
        `[submitReport] cleanup failed context=${context} failed=${failedCount} total=${storageKeys.length}`,
      );
    }
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
    const sessionToken = getHeaderValue(req.headers['x-magic-session']);

    // Validate the public credential before persisting processed files. The
    // submission service repeats this check inside the write flow to close
    // races with expiry, completion, or an admin lock.
    await this.taskService.assertVisitSubmissionAccess(token, sessionToken);

    // Images are re-encoded to strip EXIF/GPS. Documents are signature-checked.
    // Every stored name is server-generated and raw uploads stay in memory.
    const storedKeys: string[] = [];
    const photoPaths: string[] = [];
    try {
      for (const file of files ?? []) {
        const storageKey = await processVisitAttachment(file, this.storage);
        storedKeys.push(storageKey);
        photoPaths.push(`/uploads/${storageKey}`);
      }
    } catch (error) {
      await this.cleanupStoredFiles(storedKeys, 'attachment-processing');
      throw error;
    }

    const causeDetail = body.cause_detail || body.notes || '';
    const addressChanged = this.parseBoolean(body.address_changed);
    const data = {
      task_execution_outcome_code: this.parseExecutionOutcome(body.task_execution_outcome_code),
      non_follow_up_reason_code: body.non_follow_up_reason_code?.trim().toUpperCase() || null,
      disadvantage_type_codes: this.parseOptionCodeList(
        (body as Record<string, unknown>).disadvantage_type_codes,
        'ข้อมูลความด้อยโอกาสไม่ถูกต้อง',
      ),
      disability_type_codes: this.parseOptionCodeList(
        (body as Record<string, unknown>).disability_type_codes,
        'ข้อมูลความพิการไม่ถูกต้อง',
      ),
      follow_up_problem_category_code: body.follow_up_problem_category_code,
      absence_reason_code: body.absence_reason_code?.trim().toUpperCase() || null,
      parental_status_code: this.parseOptionCode(
        body.parental_status_code,
        'สถานะของบิดา-มารดาไม่ถูกต้อง',
      ),
      guardian_type_code: this.parseOptionCode(body.guardian_type_code, 'ผู้ปกครองไม่ถูกต้อง'),
      guardian_type_detail: body.guardian_type_detail?.trim() || null,
      residence_environment_codes: this.parseOptionCodeList(
        (body as Record<string, unknown>).residence_environment_codes,
        'สภาพแวดล้อมรอบที่พักไม่ถูกต้อง',
      ),
      residence_environment_detail: body.residence_environment_detail?.trim() || null,
      cause_detail: causeDetail,
      visit_lat: this.parseOptionalNumber(body.visit_lat),
      visit_lng: this.parseOptionalNumber(body.visit_lng),
      visited_at: body.visited_at?.trim() || null,
      assisted_at: body.assisted_at?.trim() || null,
      assistance_detail: body.assistance_detail?.trim() || null,
      execution_outcome_detail: body.execution_outcome_detail?.trim() || null,
      contact_person_name: body.contact_person_name?.trim() || null,
      contact_channel_code: body.contact_channel_code?.trim().toUpperCase() || null,
      recommendation: body.recommendation,
      notes: causeDetail,
      status: body.status || 'COMPLETED',
      address_changed: addressChanged,
      home_visit_exception_code: this.parseHomeVisitException(body.home_visit_exception_code),
      updated_student_address: body.updated_student_address?.trim() || null,
      updated_address_line: body.updated_address_line?.trim() || null,
      updated_address_province: body.updated_address_province?.trim() || null,
      updated_address_district: body.updated_address_district?.trim() || null,
      updated_address_sub_district: body.updated_address_sub_district?.trim() || null,
      updated_postal_code: body.updated_postal_code?.trim() || null,
      updated_lat: this.parseOptionalNumber(body.updated_lat),
      updated_lng: this.parseOptionalNumber(body.updated_lng),
      photo_paths: photoPaths.length > 0 ? JSON.stringify(photoPaths) : null,
      case_follow_up_decision: body.case_follow_up_decision,
      case_resolution_outcome_code: body.case_resolution_outcome_code,
    };

    try {
      const result = await this.taskService.saveTaskSubmission(token, data, sessionToken);
      return { ...result, success: true };
    } catch (err: unknown) {
      await this.cleanupStoredFiles(storedKeys, 'submission-rejected');
      if (err instanceof HttpException) {
        throw err;
      }
      const message = err instanceof Error ? err.message : 'Submit failed';
      this.logger.error(`submitReport error: ${message}`);
      throw new HttpException(message, HttpStatus.BAD_REQUEST);
    }
  }
}
