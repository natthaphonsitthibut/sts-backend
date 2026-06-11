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

    if (!user || typeof user.password !== 'string') {
      return null;
    }

    const isPasswordValid = await this.passwordService.compare(password, user.password);
    if (!isPasswordValid) {
      return null;
    }

    const { password: _password, ...safeUser } = user;
    void _password;
    return this.usersPolicyService.hydrateUserPermissions(safeUser, roleMap);
  }
}
