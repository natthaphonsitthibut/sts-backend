import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GoogleOidcProvider } from '../classroom-attendance-links/google-oidc.provider';
import { RedisModule } from '../redis/redis.module';
import { ScopedGoogleLoginStateStore } from './scoped-google-login-state.store';

@Module({
  imports: [AuthModule, RedisModule],
  providers: [GoogleOidcProvider, ScopedGoogleLoginStateStore],
  exports: [GoogleOidcProvider, ScopedGoogleLoginStateStore],
})
export class GoogleLoginModule {}
