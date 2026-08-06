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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { multerConfig } from '../common/interceptors/file-upload.interceptor';
import { ThrottleLogin } from '../config/throttle.decorators';
import { AuditLogService } from '../audit-log/audit-log.service';
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
  ChangePasswordDto,
  CreateRoleGroupDto,
  CreateUserDto,
  DeactivateStudentAccountDto,
  GetUsersQueryDto,
  LoginDto,
  RoleGroupListQueryDto,
  UpdateRoleGroupDto,
  UpdateOwnProfileDto,
  UpdateUserDto,
  UpdateUserPhotoDto,
} from './dto/users.dto';
import { RoleGroupsService } from './role-groups.service';
import { UserAuthService } from './user-auth.service';
import { PasswordMigrationService } from './password-migration.service';
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
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
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
    @Query() query: RoleGroupListQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.roleGroupsService.getRoleGroups(actor, {
      searchTerm: query.searchTerm?.trim() || undefined,
      page: query.page,
      limit: query.limit,
      schoolId: query.schoolId,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
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
  @Get('me/photo')
  async getOwnPhoto(
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.usersService.resolveOwnPhoto(actor);
    // Supabase URLs minted below expire quickly; caching this redirect would
    // make the browser retry an expired token and render a broken image.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
  }

  @UseGuards(AuthGuard)
  @Patch('me/photo')
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  async updateOwnPhoto(
    @Body() data: UpdateUserPhotoDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    return await this.usersService.updateOwnPhoto(actor, photo, data.removePhoto);
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

  /**
   * Profile photo read. Goes through the app rather than a public object URL so
   * the permission check runs first; the adapter then hands back a short-lived
   * signed URL that this redirects to.
   */
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Get(':id/photo')
  async getUserPhoto(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.usersService.resolveUserPhoto(id, actor);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Patch(':id/photo')
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  async updateUserPhoto(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateUserPhotoDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    return await this.usersService.updateUserPhoto(id, actor, photo, data.removePhoto);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Post(':id/national-id-reveal')
  async revealUserNationalId(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UserAddressRevealDto,
    @Req() req: Request,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.revealUserNationalId(id, actor, data, {
      ip: requestIp(req),
      userAgent: firstHeaderValue(req.headers['user-agent']),
      requestId: firstHeaderValue(req.headers['x-request-id']),
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
