import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { StudentsRepository } from './students.repository';

@Module({
  imports: [AuthModule],
  controllers: [StudentsController],
  providers: [StudentsRepository, StudentsService],
})
export class StudentsModule {}
