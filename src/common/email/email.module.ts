import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Outbound mail is shared infrastructure: task-link OTP and teacher-link OTP
 * both send through it, so the provider lives here instead of inside whichever
 * feature module happened to need it first.
 */
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
