import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundException,
  ParseIntPipe,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ThrottleLogin } from '../config/throttle.decorators';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PaginatedSearchQueryDto } from '../common/pagination/pagination.dto';
import { UsersService } from './users.service';
import {
  AuthGuard,
  CurrentUser,
  OptionalAuthGuard,
  PermissionsGuard,
  RequirePermission,
  SessionCookieService,
  type AuthenticatedRequestUser,
} from '../auth';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import {
  ChangePasswordDto,
  CreateRoleGroupDto,
  CreateUserDto,
  GenerateStudentAccountsDto,
  GetUsersQueryDto,
  LoginDto,
  StudentAccountBulkFilterDto,
  UpdateRoleGroupDto,
  UpdateUserDto,
} from './dto/users.dto';
import { RoleGroupsService } from './role-groups.service';
import { UserAuthService } from './user-auth.service';
import { PasswordMigrationService } from './password-migration.service';

/**
 * Client IP for audit. Relies on `req.ip`, which Express resolves through the
 * configured `trust proxy` setting — so x-forwarded-for is only honoured when
 * we actually trust the proxy, not when a client spoofs the header.
 */
function requestIp(req: Request): string | null {
  return req.ip || null;
}

@Controller('api/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly roleGroupsService: RoleGroupsService,
    private readonly userAuthService: UserAuthService,
    private readonly passwordMigrationService: PasswordMigrationService,
    private readonly sessionCookieService: SessionCookieService,
    private readonly auditLog: AuditLogService,
  ) {}

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Get()
  async getAllUsers(
    @Query() query: GetUsersQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.getAllUsers(actor, {
      searchTerm: query.searchTerm?.trim() || undefined,
      province: query.province?.trim() || undefined,
      district: query.district?.trim() || undefined,
      subDistrict: query.subDistrict?.trim() || undefined,
      schoolId: query.schoolId,
      gradeLevelId: query.gradeLevelId,
      room: query.room?.trim() || undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @UseGuards(AuthGuard)
  @Get('roles')
  async getRoles(@CurrentUser() actor: AuthenticatedRequestUser | undefined) {
    return await this.usersService.getRoles(actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-role-groups')
  @Get('role-groups')
  async getRoleGroups(
    @Query() query: PaginatedSearchQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.roleGroupsService.getRoleGroups(actor, {
      searchTerm: query.searchTerm?.trim() || undefined,
      page: query.page,
      limit: query.limit,
    });
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-role-groups')
  @Post('role-groups')
  async createRoleGroup(
    @Body() data: CreateRoleGroupDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const result = await this.roleGroupsService.createRoleGroup(actor, data);
    await this.auditLog.record({
      action: 'ROLE_GROUP_CREATE',
      actorUserId: resolveAuditActorId(actor),
      actorLabel: actor?.username,
      targetType: 'role_group',
      targetId: data.name ?? null,
      metadata: { op: 'create' },
      ip: requestIp(req),
    });
    return result;
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-role-groups')
  @Put('role-groups/:name')
  async updateRoleGroup(
    @Param('name') name: string,
    @Body() data: UpdateRoleGroupDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const result = await this.roleGroupsService.updateRoleGroup(actor, name, data);
    await this.auditLog.record({
      action: 'ROLE_GROUP_UPDATE',
      actorUserId: resolveAuditActorId(actor),
      actorLabel: actor?.username,
      targetType: 'role_group',
      targetId: name,
      metadata: { op: 'update' },
      ip: requestIp(req),
    });
    return result;
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-role-groups')
  @Delete('role-groups/:name')
  async deleteRoleGroup(
    @Param('name') name: string,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const result = await this.roleGroupsService.deleteRoleGroup(actor, name);
    await this.auditLog.record({
      action: 'ROLE_GROUP_DELETE',
      actorUserId: resolveAuditActorId(actor),
      actorLabel: actor?.username,
      targetType: 'role_group',
      targetId: name,
      metadata: { op: 'delete' },
      ip: requestIp(req),
    });
    return result;
  }

  @UseGuards(AuthGuard)
  @Post('me/change-password')
  async changeOwnPassword(
    @Body() data: ChangePasswordDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.changeOwnPassword(actor, data);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Get(':id')
  async getUserById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const user = await this.usersService.getUserById(id, actor);
    if (!user) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }
    return user;
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Post('student-accounts/preview')
  async previewStudentAccounts(
    @Body() data: StudentAccountBulkFilterDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.previewStudentAccounts(actor, data);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Post('student-accounts/generate')
  async generateStudentAccounts(
    @Body() data: GenerateStudentAccountsDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const result = await this.usersService.generateStudentAccounts(actor, data);
    await this.auditLog.record({
      action: 'STUDENT_ACCOUNT_BULK_GENERATE',
      actorUserId: resolveAuditActorId(actor),
      actorLabel: actor?.username,
      targetType: 'student_accounts',
      metadata: {
        createdCount: result.createdCount,
        scopeLabel:
          !data.province && !data.district && !data.subDistrict && !data.schoolId
            ? 'ทุกโรงเรียน'
            : null,
        province: data.province ?? null,
        district: data.district ?? null,
        subDistrict: data.subDistrict ?? null,
        schoolId: data.schoolId ?? null,
        grade: data.grade ?? null,
        room: data.room ?? null,
      },
      ip: requestIp(req),
    });
    return result;
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Post()
  async createUser(
    @Body() data: CreateUserDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const result = await this.usersService.createUser(actor, data);
    await this.auditLog.record({
      action: 'USER_CREATE',
      actorUserId: resolveAuditActorId(actor),
      actorLabel: actor?.username,
      targetType: 'user',
      metadata: { username: data.username },
      ip: requestIp(req),
    });
    return result;
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Put(':id')
  async updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateUserDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const result = await this.usersService.updateUser(actor, id, data);
    await this.auditLog.record({
      action: 'USER_UPDATE',
      actorUserId: resolveAuditActorId(actor),
      actorLabel: actor?.username,
      targetType: 'user',
      targetId: String(id),
      metadata: { fields: Object.keys(data) },
      ip: requestIp(req),
    });
    return result;
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Delete(':id')
  async deleteUser(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const result = await this.usersService.deleteUser(actor, id);
    await this.auditLog.record({
      action: 'USER_DELETE',
      actorUserId: resolveAuditActorId(actor),
      actorLabel: actor?.username,
      targetType: 'user',
      targetId: String(id),
      ip: requestIp(req),
    });
    return result;
  }

  @ThrottleLogin()
  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = requestIp(req);
    const user = await this.userAuthService.validateUser(body.username, body.password);
    if (!user) {
      await this.auditLog.record({
        action: 'LOGIN_FAILED',
        actorLabel: body.username,
        ip,
      });
      throw new UnauthorizedException('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
    }
    this.sessionCookieService.setSession(res, user.id);
    await this.auditLog.record({
      action: 'LOGIN',
      actorUserId: user.id,
      actorLabel: user.username,
      ip,
    });
    return user;
  }

  @UseGuards(OptionalAuthGuard)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    this.sessionCookieService.clearSession(res);
    await this.auditLog.record({
      action: 'LOGOUT',
      actorUserId: resolveAuditActorId(actor),
      actorLabel: actor?.username,
      ip: requestIp(req),
    });
    return { success: true };
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('settings')
  @Post('migrate-passwords')
  async migratePasswords() {
    return await this.passwordMigrationService.hashExistingPasswords();
  }
}
