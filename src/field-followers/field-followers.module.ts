import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import {
  FieldFollowersController,
  PublicFollowerApplicationController,
} from './field-followers.controller';
import { FieldFollowersRepository } from './field-followers.repository';
import { FieldFollowersService } from './field-followers.service';

@Module({
  imports: [AuditLogModule],
  controllers: [PublicFollowerApplicationController, FieldFollowersController],
  providers: [FieldFollowersRepository, FieldFollowersService],
})
export class FieldFollowersModule {}
