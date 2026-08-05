import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import type { StudentStatusCategory } from '../../master-data/student-status.types';

@Entity({ name: 'student_status' })
export class StudentStatusEntity {
  @PrimaryColumn({ name: 'code', type: 'integer' })
  code!: number;

  @Column({ name: 'label_th', type: 'varchar', length: 100 })
  labelTh!: string;

  @Column({ name: 'category', type: 'varchar', length: 32 })
  category!: StudentStatusCategory;

  @Column({ name: 'is_active_for_login', type: 'boolean' })
  isActiveForLogin!: boolean;

  @Column({ name: 'is_terminal', type: 'boolean' })
  isTerminal!: boolean;

  @Column({ name: 'requires_followup', type: 'boolean' })
  requiresFollowup!: boolean;

  @Column({ name: 'is_enabled', type: 'boolean' })
  isEnabled!: boolean;

  @Column({ name: 'sort_order', type: 'smallint' })
  sortOrder!: number;

  @Column({ name: 'source_system', type: 'varchar', length: 32 })
  sourceSystem!: string;
}

@Entity({ name: 'risk_factors' })
export class RiskFactorEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'label', type: 'text' })
  label!: string;
}

@Entity({ name: 'assistance_measures' })
export class AssistanceMeasureEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'label', type: 'text' })
  label!: string;
}

@Entity({ name: 'educational_areas' })
export class EducationalAreaEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text' })
  name!: string;
}

abstract class CodedMasterDataEntity {
  @PrimaryGeneratedColumn({ name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'code', type: 'text' })
  code!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'note', type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;
}

@Entity({ name: 'school_affiliations' })
export class SchoolAffiliationEntity extends CodedMasterDataEntity {}

@Entity({ name: 'disability_types' })
export class DisabilityTypeEntity extends CodedMasterDataEntity {
  @Column({ name: 'legal_category', type: 'text', nullable: true })
  legalCategory!: string | null;
}

@Entity({ name: 'absence_reason_categories' })
export class AbsenceReasonCategoryEntity extends CodedMasterDataEntity {}

@Entity({ name: 'absence_reasons' })
export class AbsenceReasonEntity extends CodedMasterDataEntity {
  @Column({ name: 'category_id', type: 'bigint' })
  categoryId!: string;
}

@Entity({ name: 'non_follow_up_reasons' })
export class NonFollowUpReasonEntity extends CodedMasterDataEntity {}
