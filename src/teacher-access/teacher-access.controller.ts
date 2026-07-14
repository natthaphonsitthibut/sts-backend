import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  Public,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { resolveExternalBaseUrl } from '../common/utils/request-url';
import { appConfig } from '../config/app.config';
import { ThrottleTeacherAccess } from '../config/throttle.decorators';
import {
  IssueTeacherAccessGrantDto,
  ListTeacherAccessGrantsDto,
  RevokeTeacherAccessGrantDto,
  SaveTeacherAccessAttendanceDto,
  TeacherAccessAssignmentOptionsDto,
  TeacherAccessRosterQueryDto,
} from './dto/teacher-access.dto';
import { TEACHER_ACCESS_TOKEN_HEADER } from './teacher-access.constants';
import { TeacherAccessService } from './teacher-access.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('manage-teacher-access')
@Controller('api/teacher-access-grants')
export class TeacherAccessGrantController {
  constructor(
    private readonly service: TeacherAccessService,
    @Inject(appConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof appConfig>,
  ) {}

  @Post()
  issue(
    @Body() body: IssueTeacherAccessGrantDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.issueGrant(body, actor, baseUrl);
  }

  @Get()
  list(@Query() query: ListTeacherAccessGrantsDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.listGrants(query, actor);
  }

  @Get('assignment-options')
  assignmentOptions(
    @Query() query: TeacherAccessAssignmentOptionsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listAssignmentOptions(query, actor);
  }

  @Get(':grantId')
  detail(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.getGrant(grantId, actor);
  }

  @Post(':grantId/revoke')
  revoke(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() body: RevokeTeacherAccessGrantDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.revokeGrant(grantId, body.reason, actor);
  }

  @Post(':grantId/rotate')
  rotate(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.rotateGrant(grantId, actor, baseUrl);
  }
}

@Public()
@Controller('api/teacher-access')
export class PublicTeacherAccessController {
  constructor(private readonly service: TeacherAccessService) {}

  private token(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] || '' : value || '';
  }

  @Get('context')
  @ThrottleTeacherAccess()
  context(@Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken?: string | string[]) {
    return this.service.getPublicContext(this.token(rawToken));
  }

  @Get('roster')
  @ThrottleTeacherAccess()
  roster(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Query() query: TeacherAccessRosterQueryDto,
  ) {
    return this.service.listPublicRoster(
      this.token(rawToken),
      query.assignmentId,
      query.searchTerm?.trim() || undefined,
      query.page,
      query.limit,
    );
  }

  @Post('attendance')
  @ThrottleTeacherAccess()
  attendance(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Body() body: SaveTeacherAccessAttendanceDto,
  ) {
    return this.service.savePublicAttendance(this.token(rawToken), body);
  }
}
