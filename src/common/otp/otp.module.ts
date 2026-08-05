import { Module } from '@nestjs/common';
import { RedisModule } from '../../redis/redis.module';
import { OtpStore } from './otp.store';

/**
 * Shared one-time-code state. Any feature that emails a code — teacher access
 * links, LINE account linking — verifies it through the same store so the
 * brute-force lockout is enforced identically everywhere.
 */
@Module({
  imports: [RedisModule],
  providers: [OtpStore],
  exports: [OtpStore],
})
export class OtpModule {}
