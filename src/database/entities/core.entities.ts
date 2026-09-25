import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'schools' })
export class SchoolEntity {
  @PrimaryColumn({ name: 'id', type: 'integer' })
  id!: number;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'province', type: 'text', nullable: true })
  province!: string | null;

  @Column({ name: 'district', type: 'text', nullable: true })
  district!: string | null;

  @Column({ name: 'sub_district', type: 'text', nullable: true })
  subDistrict!: string | null;

  @Column({ name: 'province_code', type: 'varchar', length: 2, nullable: true })
  provinceCode!: string | null;

  @Column({ name: 'district_code', type: 'varchar', length: 4, nullable: true })
  districtCode!: string | null;

  @Column({ name: 'sub_district_code', type: 'varchar', length: 6, nullable: true })
  subDistrictCode!: string | null;

  @Column({ name: 'school_status', type: 'varchar', length: 16, default: 'ACTIVE' })
  schoolStatus!: 'ACTIVE' | 'INACTIVE';
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
