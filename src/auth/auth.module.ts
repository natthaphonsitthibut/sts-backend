import { Module, Global } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { AuthGuard, OptionalAuthGuard, PermissionsGuard, RolesGuard } from './auth.guard';
import { AuthActorService } from './auth-actor.service';
import { StudentAuthService } from './student-auth.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    PasswordService,
    AuthActorService,
    StudentAuthService,
    AuthGuard,
    PermissionsGuard,
    RolesGuard,
    OptionalAuthGuard,
  ],
  exports: [
    PasswordService,
    AuthActorService,
    StudentAuthService,
    AuthGuard,
    PermissionsGuard,
    RolesGuard,
    OptionalAuthGuard,
  ],
})
export class AuthModule {}
