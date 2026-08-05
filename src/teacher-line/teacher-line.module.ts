import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../common/email/email.module';
import { MessagingModule } from '../common/messaging/messaging.module';
import { OtpModule } from '../common/otp/otp.module';
import { RedisModule } from '../redis/redis.module';
import { TeacherLineController, TeacherLineWebhookController } from './teacher-line.controller';
import { TeacherLineRepository } from './teacher-line.repository';
import { TeacherLineService } from './teacher-line.service';
import { TeacherLineSessionStore } from './teacher-line-session.store';

@Module({
  imports: [AuthModule, AuditLogModule, EmailModule, MessagingModule, OtpModule, RedisModule],
  controllers: [TeacherLineController, TeacherLineWebhookController],
  providers: [TeacherLineRepository, TeacherLineService, TeacherLineSessionStore],
  exports: [TeacherLineService],
})
export class TeacherLineModule {}
