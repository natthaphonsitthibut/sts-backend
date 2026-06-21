import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { extname } from 'path';
import { AuthGuard, CurrentUser, PermissionsGuard, RequirePermission } from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import { BulkImportUploadDto, CheckSchoolsUploadDto } from './dto/imports.dto';
import { ImportsService } from './imports.service';

const ALLOWED_IMPORT_EXTENSIONS = ['.xlsx', '.csv'];

// Memory storage (default) keeps file.buffer for the parser; we only add limits
// and a type gate so an oversized or non-spreadsheet upload is rejected early.
const importMulterOptions = {
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 8,
    fieldSize: 1 * 1024 * 1024,
  },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const ext = extname(file.originalname).toLowerCase();
    if (!ALLOWED_IMPORT_EXTENSIONS.includes(ext)) {
      return callback(new BadRequestException('รองรับเฉพาะไฟล์ .xlsx หรือ .csv'), false);
    }
    callback(null, true);
  },
};

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('import-data')
@Controller('api/imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('check-schools')
  @UseInterceptors(FileInterceptor('file', importMulterOptions))
  async checkSchools(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CheckSchoolsUploadDto,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    return this.importsService.checkMissingSchools(file, body.mapping);
  }

  @Post('bulk')
  @UseInterceptors(FileInterceptor('file', importMulterOptions))
  async importData(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: BulkImportUploadDto,
    @Req() req: Request,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    return this.importsService.processImport(file, body.target, body.mapping, body.schools, actor, {
      ip: req.ip ?? null,
    });
  }
}
