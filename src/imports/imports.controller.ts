import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import type { Response } from 'express';
import { extname } from 'path';
import { AuthGuard, CurrentUser, PermissionsGuard, RequirePermission } from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import {
  BulkImportUploadDto,
  CheckSchoolsUploadDto,
  ExportImportQuarantineDto,
  ListImportQuarantineDto,
  PreviewImportUploadDto,
  ResolveImportQuarantineDto,
} from './dto/imports.dto';
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
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    return this.importsService.checkMissingSchools(file, body.mapping, actor);
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

  @Post('preview')
  @UseInterceptors(FileInterceptor('file', importMulterOptions))
  async previewImport(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: PreviewImportUploadDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    return this.importsService.previewImport(file, body.target, body.mapping, actor);
  }

  @Get('quarantine')
  listQuarantine(
    @Query() query: ListImportQuarantineDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.importsService.listQuarantine(query, actor);
  }

  @Get('quarantine-export')
  async exportQuarantine(
    @Query() query: ExportImportQuarantineDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = await this.importsService.exportQuarantine(query, actor);
    response.setHeader('content-type', 'text/csv; charset=utf-8');
    response.setHeader(
      'content-disposition',
      `attachment; filename="student-import-${query.status.toLowerCase()}.csv"`,
    );
    return csv;
  }

  @Post('quarantine/:id/resolve')
  resolveQuarantine(
    @Param('id') id: string,
    @Body() body: ResolveImportQuarantineDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.importsService.resolveQuarantine(id, body, actor);
  }

  @Get('quarantine/:id/candidates')
  listQuarantineCandidates(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.importsService.listQuarantineCandidates(id, actor);
  }
}
