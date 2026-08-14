import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';
import { UsersRepository } from './users.repository';
import { UsersPolicyService } from './users-policy.service';
import { RoleGroupsService } from './role-groups.service';
import { UserAuthService } from './user-auth.service';
import { PasswordMigrationService } from './password-migration.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [
    UsersRepository,
    UsersPolicyService,
    UsersService,
    RoleGroupsService,
    UserAuthService,
    PasswordMigrationService,
  ],
  exports: [UsersService, RoleGroupsService, UserAuthService, PasswordMigrationService],
})
export class UsersModule {}
