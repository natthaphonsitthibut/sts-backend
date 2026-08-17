import { Module } from '@nestjs/common';
import { StudentStatusController } from './student-status.controller';
import { StudentStatusRepository } from './student-status.repository';
import { StudentStatusService } from './student-status.service';

/**
 * สถานะนักเรียน only.
 *
 * The generic master-data lookup screen was retired on 2026-08-17: of the eight
 * tables it edited, five held no rows at all and two more (สังกัดโรงเรียน,
 * ประเภทความพิการ) had no foreign key and no reader anywhere in the codebase.
 * The one table that mattered — assistance measures — was never on that screen
 * but was reachable through its API, which meant the case workflow's options
 * could be rewritten from an endpoint no page used. Student statuses stay:
 * `student_term.student_status_code` points at them and all six are in use.
 */
@Module({
  controllers: [StudentStatusController],
  providers: [StudentStatusService, StudentStatusRepository],
  exports: [StudentStatusService],
})
export class MasterDataModule {}
