import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, PermissionsGuard, RequirePermission } from '../auth';
import { BulkImportUploadDto, CheckSchoolsUploadDto } from './dto/imports.dto';
import { ImportsService } from './imports.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('import-data')
@Controller('api/imports')
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Post('check-schools')
  @UseInterceptors(FileInterceptor('file'))
  async checkSchools(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: CheckSchoolsUploadDto,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    return this.importsService.checkMissingSchools(file, body.mapping);
  }

  @Post('bulk')
  @UseInterceptors(FileInterceptor('file'))
  async importData(@UploadedFile() file: Express.Multer.File, @Body() body: BulkImportUploadDto) {
    if (!file) throw new BadRequestException('No file uploaded');

    return this.importsService.processImport(file, body.target, body.mapping, body.schools);
  }
}
