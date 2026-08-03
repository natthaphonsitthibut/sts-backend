import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { multerConfig } from '../common/interceptors/file-upload.interceptor';
import {
  CreateTeacherDto,
  DeactivateTeacherDto,
  ListTeachersQueryDto,
  UpdateTeacherDto,
  UpdateTeacherPhotoDto,
} from './dto/teachers.dto';
import { TeachersService } from './teachers.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('manage-teachers')
@Controller('api/teachers')
export class TeachersController {
  constructor(private readonly service: TeachersService) {}

  @Get()
  list(@Query() query: ListTeachersQueryDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.list(query, actor);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.findOne(id, actor);
  }

  /**
   * Streams the photo through the app rather than exposing the object store:
   * on Supabase the adapter mints a short-lived signed URL and this redirects to
   * it, so the underlying object stays private.
   */
  @Get(':id/photo')
  async getPhoto(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.service.resolvePhoto(id, actor);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
  }

  @Post()
  create(@Body() body: CreateTeacherDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.create(body, actor);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateTeacherDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.update(id, body, actor);
  }

  @Patch(':id/photo')
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  updatePhoto(
    @Param('id') id: string,
    @Body() body: UpdateTeacherPhotoDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    return this.service.updatePhoto(id, actor, photo, body.removePhoto);
  }

  @Delete(':id')
  deactivate(
    @Param('id') id: string,
    @Body() body: DeactivateTeacherDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.deactivate(id, body, actor);
  }
}
