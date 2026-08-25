import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AraIdModule } from '../araid/araid.module';
import { AuthModule } from '../auth/auth.module';
import { TokenEncryptionModule } from '../common/crypto/token-encryption.module';
import { MessagingModule } from '../common/messaging/messaging.module';
import { RedisModule } from '../redis/redis.module';
import { GoogleLoginModule } from '../google-login/google-login.module';
import { TeacherLineController, TeacherLineWebhookController } from './teacher-line.controller';
import { AraIdChallengeStore } from '../araid/araid-challenge.store';
import { TeacherLineRepository } from './teacher-line.repository';
import { TeacherLineService } from './teacher-line.service';
import { TeacherLineSessionStore } from './teacher-line-session.store';

@Module({
  imports: [
    AraIdModule,
    AuthModule,
    AuditLogModule,
    MessagingModule,
    RedisModule,
    GoogleLoginModule,
    TokenEncryptionModule,
  ],
  controllers: [TeacherLineController, TeacherLineWebhookController],
  providers: [
    AraIdChallengeStore,
    TeacherLineRepository,
    TeacherLineService,
    TeacherLineSessionStore,
  ],
  exports: [TeacherLineService],
})
export class TeacherLineModule {}
