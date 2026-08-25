import { Module } from '@nestjs/common';
import { TeachersController } from './teachers.controller';
import { TeacherProfilesController } from './teacher-profiles.controller';
import { TeachersRepository } from './teachers.repository';
import { TeachersService } from './teachers.service';

// AuditLogModule and FileStorageModule are both @Global, so neither is imported
// here — same as SchoolStructureModule.
@Module({
  controllers: [TeachersController, TeacherProfilesController],
  providers: [TeachersRepository, TeachersService],
  exports: [TeachersRepository],
})
export class TeachersModule {}
