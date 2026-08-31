import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser, PermissionsGuard, RequireAnyPermission } from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import { TeachersService } from './teachers.service';
import { ListTeachersQueryDto } from './dto/teachers.dto';
import { PiiRevealDto } from '../students/dto/pii-reveal.dto';

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

@UseGuards(AuthGuard, PermissionsGuard)
// จัดการข้อมูลหลักสูตร renders these faces beside each offering, so the page
// that shows them grants the read, the same way the link page does.
@RequireAnyPermission('teachers', 'manage-teachers', 'manage-classroom-links', 'manage-subjects')
@Controller('api/teacher-profiles')
export class TeacherProfilesController {
  constructor(private readonly service: TeachersService) {}

  @Get()
  list(@Query() query: ListTeachersQueryDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.listProfiles(query, actor);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.findProfile(id, actor);
  }

  @Post(':id/pii-reveal')
  revealNationalId(
    @Param('id') id: string,
    @Body() body: PiiRevealDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.revealNationalId(id, actor, body, {
      ip: req.ip ?? null,
      userAgent: firstHeaderValue(req.headers['user-agent']),
      requestId: firstHeaderValue(req.headers['x-request-id']),
    });
  }

  /** Private storage stays hidden; object storage resolves to a short-lived signed URL. */
  @Get(':id/photo')
  async getPhoto(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.service.resolveProfilePhoto(id, actor);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
  }
}
