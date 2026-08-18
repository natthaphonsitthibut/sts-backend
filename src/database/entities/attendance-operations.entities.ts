import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'school_terms' })
export class SchoolTermEntity {
  @PrimaryGeneratedColumn('increment', { name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'school_id', type: 'integer' })
  schoolId!: number;

  @Column({ name: 'academic_year', type: 'integer' })
  academicYear!: number;

  @Column({ name: 'semester', type: 'smallint' })
  semester!: number;

  @Column({ name: 'starts_on', type: 'date', nullable: true })
  startsOn!: string | null;

  @Column({ name: 'ends_on', type: 'date', nullable: true })
  endsOn!: string | null;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'DRAFT' })
  status!: string;
}

@Entity({ name: 'school_calendar_days' })
export class SchoolCalendarDayEntity {
  @PrimaryGeneratedColumn('increment', { name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'school_term_id', type: 'bigint' })
  schoolTermId!: string;

  @Column({ name: 'calendar_date', type: 'date' })
  calendarDate!: string;

  @Column({ name: 'day_type', type: 'varchar', length: 16 })
  dayType!: string;

  @Column({ name: 'reason', type: 'varchar', length: 255, nullable: true })
  reason!: string | null;

  @Column({ name: 'source', type: 'varchar', length: 16, default: 'MANUAL' })
  source!: string;
}

@Entity({ name: 'attendance_sessions' })
export class AttendanceSessionEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'school_term_id', type: 'bigint' })
  schoolTermId!: string;

  @Column({ name: 'school_id', type: 'integer' })
  schoolId!: number;

  @Column({ name: 'grade_level_id', type: 'integer' })
  gradeLevelId!: number;

  @Column({ name: 'room_id', type: 'integer' })
  roomId!: number;

  @Column({ name: 'attendance_date', type: 'date' })
  attendanceDate!: string;

  @Column({ name: 'period', type: 'integer', default: 1 })
  period!: number;

  @Column({ name: 'session_kind', type: 'varchar', length: 16, default: 'SUBJECT' })
  sessionKind!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'OPEN' })
  status!: string;

  @Column({ name: 'expected_roster_count', type: 'integer', default: 0 })
  expectedRosterCount!: number;

  @Column({ name: 'recorded_count', type: 'integer', default: 0 })
  recordedCount!: number;

  @Column({ name: 'revision', type: 'integer', default: 1 })
  revision!: number;
}
