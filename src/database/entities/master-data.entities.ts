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

@Entity({ name: 'dropout_reasons' })
export class DropoutReasonEntity {
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

@Entity({ name: 'related_agencies' })
export class RelatedAgencyEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text' })
  name!: string;
}

@Entity({ name: 'educational_areas' })
export class EducationalAreaEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text' })
  name!: string;
}
