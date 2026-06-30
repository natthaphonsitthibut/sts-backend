import { Injectable } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import type { LoginDto } from './dto/users.dto';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';

@Injectable()
export class UserAuthService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly usersPolicyService: UsersPolicyService,
    private readonly passwordService: PasswordService,
  ) {}

  async validateUser(username: LoginDto['username'], password: LoginDto['password']) {
    if (
      typeof username !== 'string' ||
      username.trim().length === 0 ||
      typeof password !== 'string' ||
      password.length === 0
    ) {
      return null;
    }

    const roleMap = await this.usersPolicyService.getRoleMap();
    const user = await this.usersRepository.findUserByUsername(username.trim());

    if (!user || user.status !== 'ACTIVE' || typeof user.password !== 'string') {
      return null;
    }

    if (this.isTemporaryPasswordExpired(user)) {
      return null;
    }

    const isPasswordValid = await this.passwordService.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    const { password: _password, ...safeUser } = user;
    void _password;
    const hydratedUser = this.usersPolicyService.hydrateUserPermissions(safeUser, roleMap);
    const studentUuid = hydratedUser.roles?.includes('STUDENT')
      ? await this.usersRepository.findCurrentStudentUuidByUserId(user.id)
      : null;
    return studentUuid ? { ...hydratedUser, student_uuid: studentUuid } : hydratedUser;
  }

  private isTemporaryPasswordExpired(user: {
    must_change_password?: boolean | null;
    temporary_password_expires_at?: string | Date | null;
  }): boolean {
    if (user.must_change_password !== true || !user.temporary_password_expires_at) {
      return false;
    }

    const expiresAt = new Date(user.temporary_password_expires_at);
    return !Number.isNaN(expiresAt.getTime()) && expiresAt <= new Date();
  }
}
