import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TaskModule } from '../task/task.module';
import { StudentGeocodeModule } from '../student-geocode/student-geocode.module';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { StudentsRepository } from './students.repository';
import { PiiExportController, PiiExportDownloadController } from './pii-export.controller';
import { PiiExportRepository } from './pii-export.repository';
import { PiiExportService } from './pii-export.service';
import { MasterDataModule } from '../master-data/master-data.module';

@Module({
  imports: [AuthModule, TaskModule, StudentGeocodeModule, MasterDataModule],
  controllers: [PiiExportController, PiiExportDownloadController, StudentsController],
  providers: [StudentsRepository, StudentsService, PiiExportRepository, PiiExportService],
  // Teacher links render the same student profile as the staff screen, so the
  // read service is shared instead of duplicated behind a guest-only query set.
  exports: [StudentsService],
})
export class StudentsModule {}
