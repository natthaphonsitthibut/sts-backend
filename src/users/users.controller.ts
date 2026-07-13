import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  NotFoundException,
  ParseIntPipe,
  Query,
  Req,
  Res,
  Logger,
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
  Public,
  RequirePermission,
  SessionCookieService,
  type AuthenticatedRequestUser,
} from '../auth';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { PERMISSION_CATALOG } from '../auth/permissions.constants';
import {
  BulkReissueStudentAccountsDto,
  ChangePasswordDto,
  CreateRoleGroupDto,
  CreateUserDto,
  DeactivateStudentAccountDto,
  GenerateStudentAccountsDto,
  GetUsersQueryDto,
  LoginDto,
  StudentAccountBatchCredentialQueryDto,
  StudentAccountBatchListQueryDto,
  StudentAccountBulkFilterDto,
  StudentAccountListQueryDto,
  UpdateRoleGroupDto,
  UpdateOwnProfileDto,
  UpdateUserDto,
} from './dto/users.dto';
import { RoleGroupsService } from './role-groups.service';
import { UserAuthService } from './user-auth.service';
import { PasswordMigrationService } from './password-migration.service';
import { StudentAccountBatchService } from './student-account-batch.service';
import { UserAddressRevealDto } from './dto/user-address-reveal.dto';

/**
 * Client IP for audit. Relies on `req.ip`, which Express resolves through the
 * configured `trust proxy` setting — so x-forwarded-for is only honoured when
 * we actually trust the proxy, not when a client spoofs the header.
 */
function requestIp(req: Request): string | null {
  return req.ip || null;
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' && value.length > 0 ? value : null;
}

@Controller('api/users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly roleGroupsService: RoleGroupsService,
    private readonly userAuthService: UserAuthService,
    private readonly passwordMigrationService: PasswordMigrationService,
    private readonly sessionCookieService: SessionCookieService,
    private readonly auditLog: AuditLogService,
    private readonly studentAccountBatchService: StudentAccountBatchService,
  ) {}

  private logAuditFailure(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`${action} audit failed: ${message}`);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Get()
  async getAllUsers(
    @Query() query: GetUsersQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.getAllUsers(actor, {
      searchTerm: query.searchTerm?.trim() || undefined,
      excludeRole: query.excludeRole?.trim() || undefined,
      province: query.province?.trim() || undefined,
      district: query.district?.trim() || undefined,
      subDistrict: query.subDistrict?.trim() || undefined,
      schoolId: query.schoolId,
      gradeLevelId: query.gradeLevelId,
      room: query.room?.trim() || undefined,
      accountStatus: query.accountStatus,
      page: query.page,
      limit: query.limit,
    });
  }

  @UseGuards(AuthGuard)
  @Get('roles')
  async getRoles(@CurrentUser() actor: AuthenticatedRequestUser | undefined) {
    return await this.usersService.getRoles(actor);
  }

  @UseGuards(AuthGuard)
  @Get('permissions')
  getPermissionCatalog() {
    return { success: true, data: PERMISSION_CATALOG };
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

  @UseGuards(AuthGuard)
  @Get('me')
  async getOwnProfile(@CurrentUser() actor: AuthenticatedRequestUser | undefined) {
    return await this.usersService.getOwnProfile(actor);
  }

  @UseGuards(AuthGuard)
  @Patch('me')
  async updateOwnProfile(
    @Body() data: UpdateOwnProfileDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const result = await this.usersService.updateOwnProfile(actor, data);
    await this.auditLog.record({
      action: 'USER_PROFILE_UPDATE',
      actorUserId: resolveAuditActorId(actor),
      actorLabel: actor?.username,
      targetType: 'user',
      targetId: actor?.id ? String(actor.id) : null,
      metadata: { fields: Object.keys(data), fieldCount: Object.keys(data).length },
      ip: requestIp(req),
    });
    return result;
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Get('student-accounts')
  async listStudentAccounts(
    @Query() query: StudentAccountListQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.listStudentAccounts(actor, {
      searchTerm: query.searchTerm?.trim() || undefined,
      province: query.province?.trim() || undefined,
      district: query.district?.trim() || undefined,
      subDistrict: query.subDistrict?.trim() || undefined,
      schoolId: query.schoolId,
      grade: query.grade?.trim() || undefined,
      room: query.room,
      accountStatus: query.accountStatus,
      onlyExpired: query.onlyExpired,
      page: query.page,
      limit: query.limit,
    });
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Get(':id/detail')
  async getUserDetailById(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const user = await this.usersService.getUserDetailById(id, actor);
    if (!user) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }
    return user;
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
  @RequirePermission('manage-student-accounts')
  @Post('student-accounts/batch-jobs')
  async enqueueStudentAccountBatch(
    @Body() data: GenerateStudentAccountsDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.studentAccountBatchService.enqueue(actor, data);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Get('student-accounts/batch-jobs')
  async listStudentAccountBatches(
    @Query() query: StudentAccountBatchListQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.studentAccountBatchService.listJobs(actor, query);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Get('student-accounts/batch-jobs/:id')
  async getStudentAccountBatch(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.studentAccountBatchService.getJob(actor, id);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Post('student-accounts/batch-jobs/:id/resume')
  async resumeStudentAccountBatch(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.studentAccountBatchService.resume(actor, id);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Post('student-accounts/batch-jobs/:id/cancel')
  async cancelStudentAccountBatch(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.studentAccountBatchService.cancel(actor, id);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Post('student-accounts/batch-jobs/:id/credentials')
  async downloadStudentAccountBatchCredentials(
    @Param('id') id: string,
    @Query() query: StudentAccountBatchCredentialQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.studentAccountBatchService.downloadCredentials(actor, id, query);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Post('student-accounts/bulk-reissue-temporary-password')
  async bulkReissueStudentTemporaryPasswords(
    @Body() data: BulkReissueStudentAccountsDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const result = await this.usersService.bulkReissueStudentTemporaryPasswords(actor, data);
    const auditResults = await Promise.allSettled(
      result.credentials.map((credential) =>
        this.auditLog.record({
          action: 'STUDENT_TEMP_PASSWORD_REISSUE',
          actorUserId: resolveAuditActorId(actor),
          actorLabel: actor?.username,
          targetType: 'user',
          targetId: String(credential.userId),
          metadata: {
            op: 'bulk-reissue',
            expiresAt: credential.temporaryPasswordExpiresAt,
            schoolId: credential.schoolId,
            schoolName: credential.schoolName,
            grade: credential.grade,
            room: credential.room,
          },
          ip: requestIp(req),
        }),
      ),
    );
    for (const auditResult of auditResults) {
      if (auditResult.status === 'rejected') {
        this.logAuditFailure('STUDENT_TEMP_PASSWORD_REISSUE', auditResult.reason);
      }
    }
    return result;
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Post('student-accounts/:id/reissue-temporary-password')
  async reissueStudentTemporaryPassword(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const result = await this.usersService.reissueStudentTemporaryPassword(actor, id);
    const { auditMetadata, ...response } = result;
    try {
      await this.auditLog.record({
        action: 'STUDENT_TEMP_PASSWORD_REISSUE',
        actorUserId: resolveAuditActorId(actor),
        actorLabel: actor?.username,
        targetType: 'user',
        targetId: String(id),
        metadata: {
          expiresAt: result.temporaryPasswordExpiresAt,
          ...auditMetadata,
        },
        ip: requestIp(req),
      });
    } catch (error) {
      this.logAuditFailure('STUDENT_TEMP_PASSWORD_REISSUE', error);
    }
    return response;
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Post('student-accounts/:id/deactivate')
  async deactivateStudentAccount(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: DeactivateStudentAccountDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.deactivateStudentAccount(actor, id, data, {
      ip: requestIp(req),
    });
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-student-accounts')
  @Post('student-accounts/:id/reactivate')
  async reactivateStudentAccount(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.reactivateStudentAccount(actor, id, {
      ip: requestIp(req),
    });
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Post(':id/address-reveal')
  async revealUserAddress(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UserAddressRevealDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.revealUserAddress(id, actor, data, {
      ip: requestIp(req),
      userAgent: firstHeaderValue(req.headers['user-agent']),
      requestId: firstHeaderValue(req.headers['x-request-id']),
    });
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Post(':id/deactivate')
  async deactivateAccount(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: DeactivateStudentAccountDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.deactivateAccount(actor, id, data, {
      action: 'USER_DEACTIVATE',
      ip: requestIp(req),
    });
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Post(':id/reactivate')
  async reactivateAccount(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.reactivateAccount(actor, id, {
      action: 'USER_REACTIVATE',
      ip: requestIp(req),
    });
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
      metadata: { username: data.username, actorScope: actor?.data_scope ?? {} },
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
      metadata: { fields: Object.keys(data), actorScope: actor?.data_scope ?? {} },
      ip: requestIp(req),
    });
    return result;
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list', 'manage-users-hard-delete')
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

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Post(':id/reissue-temporary-password')
  async reissueTemporaryPassword(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    const result = await this.usersService.reissueTemporaryPassword(actor, id);
    try {
      await this.auditLog.record({
        action: 'USER_TEMP_PASSWORD_REISSUE',
        actorUserId: resolveAuditActorId(actor),
        actorLabel: actor?.username,
        targetType: 'user',
        targetId: String(id),
        metadata: { expiresAt: result.temporaryPasswordExpiresAt },
        ip: requestIp(req),
      });
    } catch (error) {
      this.logAuditFailure('USER_TEMP_PASSWORD_REISSUE', error);
    }
    return result;
  }

  @Public()
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

  @Public()
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
