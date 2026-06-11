import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import type { ChangePasswordDto, CreateUserDto, UpdateUserDto } from './dto/users.dto';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import type { ActorContext } from './users.types';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly usersPolicyService: UsersPolicyService,
    private readonly passwordService: PasswordService,
  ) {}

  async getAllUsers(actor?: ActorContext) {
    const roleMap = await this.usersPolicyService.getRoleMap();
    const users = (await this.usersRepository.listUsers()).map((row) =>
      this.usersPolicyService.hydrateUserPermissions(row, roleMap),
    );

    if (!actor) {
      return users;
    }

    return users.filter((user) => this.usersPolicyService.canManageUser(actor, user, roleMap));
  }

  async getUserById(id: number, actor?: ActorContext) {
    const roleMap = await this.usersPolicyService.getRoleMap();
    const row = await this.usersRepository.findUserById(id);
    if (!row) {
      return null;
    }

    const user = this.usersPolicyService.hydrateUserPermissions(row, roleMap);
    if (actor && !this.usersPolicyService.canManageUser(actor, user, roleMap)) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงข้อมูลผู้ใช้งานนี้');
    }

    return user;
  }

  async createUser(actor: ActorContext | undefined, data: CreateUserDto) {
    try {
      const currentActor = this.usersPolicyService.ensureActor(actor);
      const roleMap = await this.usersPolicyService.getRoleMap();
      await this.usersPolicyService.assertAssignablePayload(
        currentActor,
        data,
        { allowEqualRole: false },
        roleMap,
      );

      const password = data.password || this.passwordService.generateTempPassword();
      const generatedTempPassword = data.password ? undefined : password;

      const userId = await this.usersRepository.withTransaction(async (executor) => {
        const passwordHash = await this.passwordService.hash(password);
        const primaryRole = this.usersPolicyService.normalizeRole(data);

        return await this.usersRepository.createUser(
          {
            username: data.username,
            passwordHash,
            firstName: data.FirstName,
            lastName: data.LastName,
            personIdOnec: data.PersonID_Onec,
            phone: data.phone || null,
            email: data.email || null,
            affiliation: data.affiliation || null,
            status: data.status || 'ACTIVE',
            permissions: data.permissions || [],
            role: primaryRole,
            dataScope: data.data_scope || {},
            mustChangePassword: true,
          },
          executor,
        );
      });

      return {
        success: true,
        userId,
        tempPassword: generatedTempPassword || undefined,
        must_change_password: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`createUser error: ${message}`);
      throw err;
    }
  }

  async updateUser(actor: ActorContext | undefined, id: number, data: UpdateUserDto) {
    try {
      const currentActor = this.usersPolicyService.ensureActor(actor);
      const roleMap = await this.usersPolicyService.getRoleMap();
      const existingRow = await this.usersRepository.findUserById(id);

      if (!existingRow) {
        throw new NotFoundException('ไม่พบผู้ใช้งาน');
      }

      const existingUser = this.usersPolicyService.hydrateUserPermissions(existingRow, roleMap);

      if (!this.usersPolicyService.canManageUser(currentActor, existingUser, roleMap)) {
        throw new ForbiddenException('ไม่มีสิทธิ์แก้ไขผู้ใช้งานนี้');
      }

      const isSelf = currentActor.id === id;
      const existingRole = this.usersPolicyService.getPrimaryRole(existingUser);
      const requestedRole = this.usersPolicyService.normalizeRole(data);

      if (isSelf && requestedRole !== existingRole) {
        throw new ForbiddenException('ไม่สามารถเปลี่ยนตำแหน่งของบัญชีตัวเองได้');
      }

      await this.usersPolicyService.assertAssignablePayload(
        currentActor,
        data,
        { allowEqualRole: isSelf },
        roleMap,
      );

      await this.usersRepository.withTransaction(async (executor) => {
        const primaryRole = this.usersPolicyService.normalizeRole(data);
        const passwordHash = data.password
          ? await this.passwordService.hash(data.password)
          : undefined;

        await this.usersRepository.updateUser(
          {
            id,
            username: data.username ?? existingUser.username,
            passwordHash,
            firstName: data.FirstName ?? existingUser.FirstName ?? '',
            lastName: data.LastName ?? existingUser.LastName ?? '',
            personIdOnec: data.PersonID_Onec ?? existingUser.PersonID_Onec ?? '',
            phone: data.phone ?? existingUser.phone ?? null,
            email: data.email ?? existingUser.email ?? null,
            affiliation: data.affiliation ?? existingUser.affiliation ?? null,
            status: data.status ?? existingUser.status ?? 'ACTIVE',
            permissions:
              data.permissions ??
              this.usersPolicyService.normalizePermissionList(existingUser.permissions),
            role: primaryRole,
            dataScope: data.data_scope ?? existingUser.data_scope ?? {},
          },
          executor,
        );
      });

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`updateUser error: ${message}`);
      throw err;
    }
  }

  async deleteUser(actor: ActorContext | undefined, id: number) {
    try {
      const currentActor = this.usersPolicyService.ensureActor(actor);
      const roleMap = await this.usersPolicyService.getRoleMap();
      const existingRow = await this.usersRepository.findUserById(id);

      if (!existingRow) {
        throw new NotFoundException('ไม่พบข้อมูลผู้ใช้งานที่ต้องการลบ');
      }

      const existingUser = this.usersPolicyService.hydrateUserPermissions(existingRow, roleMap);

      if (currentActor.id === id) {
        throw new ForbiddenException('ไม่สามารถลบบัญชีของตัวเองได้');
      }

      if (!this.usersPolicyService.canManageUser(currentActor, existingUser, roleMap)) {
        throw new ForbiddenException('ไม่มีสิทธิ์ลบผู้ใช้งานนี้');
      }

      const rowCount = await this.usersRepository.withTransaction(async (executor) => {
        return await this.usersRepository.deleteUser(id, executor);
      });

      if (rowCount === 0) {
        throw new NotFoundException('ไม่พบข้อมูลผู้ใช้งานที่ต้องการลบ');
      }

      return { success: true, rowCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`deleteUser error: ${message}`);
      throw err;
    }
  }

  async changeOwnPassword(actor: ActorContext | undefined, data: ChangePasswordDto) {
    const currentActor = this.usersPolicyService.ensureActor(actor);
    const user = await this.usersRepository.findUserById(currentActor.id);

    if (!user) {
      throw new NotFoundException('ไม่พบผู้ใช้งาน');
    }

    const authUser = await this.usersRepository.findUserByUsername(user.username);
    if (!authUser?.password) {
      throw new NotFoundException('ไม่พบข้อมูลรหัสผ่าน');
    }

    const isCurrentPasswordValid = await this.passwordService.compare(
      data.currentPassword,
      authUser.password,
    );

    if (!isCurrentPasswordValid) {
      throw new ForbiddenException('รหัสผ่านเดิมไม่ถูกต้อง');
    }

    const passwordHash = await this.passwordService.hash(data.newPassword);
    await this.usersRepository.updatePasswordAndClearMustChange(currentActor.id, passwordHash);

    return { success: true, must_change_password: false };
  }

  async getRoles(actor?: ActorContext) {
    const definitions = await this.usersPolicyService.getRoleDefinitions();
    if (!actor) {
      return definitions;
    }

    const roleMap = new Map(definitions.map((definition) => [definition.name, definition]));
    const actorRole = this.usersPolicyService.getPrimaryRole({
      roles: actor.roles,
    });

    return definitions.filter(
      (role) =>
        role.name === actorRole ||
        (this.usersPolicyService.canManageRole(actorRole, role.name, roleMap) &&
          this.usersPolicyService.canGrantPermissions(
            actor.permissions || [],
            role.default_permissions || [],
            actorRole,
            roleMap,
          )),
    );
  }
}
