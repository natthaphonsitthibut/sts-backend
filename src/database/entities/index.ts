import {
  ExternalUserEntity,
  GradeLevelEntity,
  ScheduleEntity,
  SchoolEntity,
  SystemSettingEntity,
} from './core.entities';
import {
  AssistanceMeasureEntity,
  DropoutReasonEntity,
  EducationalAreaEntity,
  RelatedAgencyEntity,
  RiskFactorEntity,
} from './master-data.entities';
import { AttendanceEntity, StudentDropoutEntity, StudentTermEntity } from './student.entities';
import {
  AttendanceSessionEntity,
  SchoolCalendarDayEntity,
  SchoolTermEntity,
} from './attendance-operations.entities';
import {
  CaseEntity,
  CaseReviewEntity,
  TaskEntity,
  TaskLinkEntity,
  TaskSubmissionEntity,
} from './task.entities';
import { RoleEntity, UserEntity } from './user.entities';

export const DATABASE_ENTITIES = [
  SchoolEntity,
  GradeLevelEntity,
  SystemSettingEntity,
  ScheduleEntity,
  ExternalUserEntity,
  CaseEntity,
  TaskEntity,
  TaskLinkEntity,
  TaskSubmissionEntity,
  CaseReviewEntity,
  StudentTermEntity,
  StudentDropoutEntity,
  AttendanceEntity,
  SchoolTermEntity,
  SchoolCalendarDayEntity,
  AttendanceSessionEntity,
  RoleEntity,
  UserEntity,
  RiskFactorEntity,
  DropoutReasonEntity,
  AssistanceMeasureEntity,
  RelatedAgencyEntity,
  EducationalAreaEntity,
];

export {
  AssistanceMeasureEntity,
  AttendanceEntity,
  AttendanceSessionEntity,
  CaseEntity,
  CaseReviewEntity,
  DropoutReasonEntity,
  EducationalAreaEntity,
  ExternalUserEntity,
  GradeLevelEntity,
  RelatedAgencyEntity,
  RiskFactorEntity,
  RoleEntity,
  ScheduleEntity,
  SchoolEntity,
  SchoolCalendarDayEntity,
  SchoolTermEntity,
  StudentDropoutEntity,
  StudentTermEntity,
  SystemSettingEntity,
  TaskEntity,
  TaskLinkEntity,
  TaskSubmissionEntity,
  UserEntity,
};
