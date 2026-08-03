import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard, CurrentUser, PermissionsGuard, RequirePermission } from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import { curriculumPdfMulterConfig } from '../common/interceptors/file-upload.interceptor';
import { CurriculumService } from './curriculum.service';
import {
  ListCurriculumGradesQueryDto,
  ListCurriculumSubjectsQueryDto,
  SaveCurriculumSubjectDto,
  UpdateCurriculumContentDto,
} from './dto/curriculum.dto';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('manage-curriculum')
@Controller('api/curriculum')
export class CurriculumController {
  constructor(private readonly service: CurriculumService) {}

  @Get('grades')
  listGrades(
    @Query() query: ListCurriculumGradesQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listGrades(query, actor);
  }

  @Get('subjects')
  listSubjects(
    @Query() query: ListCurriculumSubjectsQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listSubjects(query, actor);
  }

  @Get('subjects/:id')
  findSubject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.findSubject(String(id), actor);
  }

  /**
   * Streams the learning-content PDF through the app rather than exposing the
   * object store: the scope check runs first, then this redirects to the
   * adapter's short-lived signed URL.
   */
  @Get('subjects/:id/content')
  async getContent(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res() res: Response,
  ): Promise<void> {
    const { result, fileName } = await this.service.resolveContent(String(id), actor);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
  }

  @Post('subjects')
  createSubject(
    @Body() body: SaveCurriculumSubjectDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.createSubject(body, actor);
  }

  @Put('subjects/:id')
  updateSubject(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SaveCurriculumSubjectDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.updateSubject(String(id), body, actor);
  }

  @Patch('subjects/:id/content')
  @UseInterceptors(FileInterceptor('content', curriculumPdfMulterConfig))
  updateContent(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCurriculumContentDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @UploadedFile() content?: Express.Multer.File,
  ) {
    return this.service.updateContent(String(id), actor, content, body.removeContent);
  }

  @Delete('subjects/:id')
  deleteSubject(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.deleteSubject(String(id), actor);
  }
}
