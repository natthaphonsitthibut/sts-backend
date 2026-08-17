import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import type { ConfigType } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { AuthGuard, OptionalAuthGuard, PermissionsGuard, RolesGuard } from './auth.guard';
import { AuthActorService } from './auth-actor.service';
import { AraIdLoginService } from './araid-login.service';
import { SessionCookieService } from './session-cookie.service';
import { authConfig } from '../config/auth.config';
import { RedisModule } from '../redis/redis.module';
import { MagicSessionStoreService } from './magic-session-store.service';
import { AraIdModule } from '../araid/araid.module';
import { AraIdChallengeStore } from '../araid/araid-challenge.store';

@Global()
@Module({
  imports: [
    RedisModule,
    AraIdModule,
    JwtModule.registerAsync({
      inject: [authConfig.KEY],
      useFactory: (config: ConfigType<typeof authConfig>) => ({
        secret: config.jwtSecret,
        signOptions: { expiresIn: config.tokenTtlSeconds },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    PasswordService,
    AuthActorService,
    AraIdLoginService,
    AraIdChallengeStore,
    SessionCookieService,
    MagicSessionStoreService,
    AuthGuard,
    PermissionsGuard,
    RolesGuard,
    OptionalAuthGuard,
  ],
  exports: [
    PasswordService,
    AuthActorService,
    AraIdLoginService,
    SessionCookieService,
    MagicSessionStoreService,
    AuthGuard,
    PermissionsGuard,
    RolesGuard,
    OptionalAuthGuard,
  ],
})
export class AuthModule {}
