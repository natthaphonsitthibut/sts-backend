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
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { UsersService } from './users.service';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  SessionCookieService,
  type AuthenticatedRequestUser,
} from '../auth';
import {
  ChangePasswordDto,
  CreateRoleGroupDto,
  CreateUserDto,
  LoginDto,
  UpdateRoleGroupDto,
  UpdateUserDto,
} from './dto/users.dto';
import { RoleGroupsService } from './role-groups.service';
import { UserAuthService } from './user-auth.service';
import { PasswordMigrationService } from './password-migration.service';

@Controller('api/users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly roleGroupsService: RoleGroupsService,
    private readonly userAuthService: UserAuthService,
    private readonly passwordMigrationService: PasswordMigrationService,
    private readonly sessionCookieService: SessionCookieService,
  ) {}

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Get()
  async getAllUsers(@CurrentUser() actor: AuthenticatedRequestUser | undefined) {
    return await this.usersService.getAllUsers(actor);
  }

  @UseGuards(AuthGuard)
  @Get('roles')
  async getRoles(@CurrentUser() actor: AuthenticatedRequestUser | undefined) {
    return await this.usersService.getRoles(actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-role-groups')
  @Get('role-groups')
  async getRoleGroups(@CurrentUser() actor: AuthenticatedRequestUser | undefined) {
    return await this.roleGroupsService.getRoleGroups(actor);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-role-groups')
  @Post('role-groups')
  async createRoleGroup(
    @Body() data: CreateRoleGroupDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.roleGroupsService.createRoleGroup(actor, data);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-role-groups')
  @Put('role-groups/:name')
  async updateRoleGroup(
    @Param('name') name: string,
    @Body() data: UpdateRoleGroupDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.roleGroupsService.updateRoleGroup(actor, name, data);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-role-groups')
  @Delete('role-groups/:name')
  async deleteRoleGroup(
    @Param('name') name: string,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.roleGroupsService.deleteRoleGroup(actor, name);
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
  @RequirePermission('manage-users-list')
  @Post()
  async createUser(
    @Body() data: CreateUserDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.createUser(actor, data);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Put(':id')
  async updateUser(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.updateUser(actor, id, data);
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-users-list')
  @Delete(':id')
  async deleteUser(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthenticatedRequestUser | undefined,
  ) {
    return await this.usersService.deleteUser(actor, id);
  }

  @Post('login')
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.userAuthService.validateUser(body.username, body.password);
    if (!user) {
      throw new UnauthorizedException('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
    }
    this.sessionCookieService.setSession(res, user.id);
    return user;
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    this.sessionCookieService.clearSession(res);
    return { success: true };
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('settings')
  @Post('migrate-passwords')
  async migratePasswords() {
    return await this.passwordMigrationService.hashExistingPasswords();
  }
}
