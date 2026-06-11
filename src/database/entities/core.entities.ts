import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'schools' })
export class SchoolEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'province', type: 'text', nullable: true })
  province!: string | null;

  @Column({ name: 'district', type: 'text', nullable: true })
  district!: string | null;

  @Column({ name: 'sub_district', type: 'text', nullable: true })
  subDistrict!: string | null;
}

@Entity({ name: 'grade_levels' })
export class GradeLevelEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'label', type: 'text' })
  label!: string;

  @Column({ name: 'category', type: 'text', nullable: true })
  category!: string | null;
}

@Entity({ name: 'system_settings' })
export class SystemSettingEntity {
  @PrimaryColumn({ name: 'setting_key', type: 'text' })
  settingKey!: string;

  @Column({ name: 'setting_value', type: 'text' })
  settingValue!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'updated_at', type: 'timestamp', nullable: true })
  updatedAt!: Date | null;
}

@Entity({ name: 'schedules' })
export class ScheduleEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'grade', type: 'text', nullable: true })
  grade!: string | null;

  @Column({ name: 'room', type: 'text', nullable: true })
  room!: string | null;

  @Column({ name: 'day_of_week', type: 'integer', nullable: true })
  dayOfWeek!: number | null;

  @Column({ name: 'subject', type: 'text', nullable: true })
  subject!: string | null;

  @Column({ name: 'start_time', type: 'text', nullable: true })
  startTime!: string | null;

  @Column({ name: 'end_time', type: 'text', nullable: true })
  endTime!: string | null;

  @Column({ name: 'teacher', type: 'text', nullable: true })
  teacher!: string | null;
}

@Entity({ name: 'external_users' })
export class ExternalUserEntity {
  @PrimaryGeneratedColumn({ name: 'ExternalID' })
  externalId!: number;

  @Column({ name: 'PersonID_Onec', type: 'text', nullable: true, unique: true })
  personIdOnec!: string | null;

  @Column({ name: 'FullName', type: 'text', nullable: true })
  fullName!: string | null;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true })
  createdAt!: Date | null;
}
