import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'araid_identity_records' })
export class AraIdIdentityRecordEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'identity_number', type: 'char', length: 13, unique: true })
  identityNumber!: string;

  @Column({ name: 'title_th', type: 'varchar', length: 32, nullable: true })
  titleTh!: string | null;

  @Column({ name: 'given_name_th', type: 'varchar', length: 100 })
  givenNameTh!: string;

  @Column({ name: 'family_name_th', type: 'varchar', length: 100 })
  familyNameTh!: string;

  @Column({ name: 'given_name_en', type: 'varchar', length: 100, nullable: true })
  givenNameEn!: string | null;

  @Column({ name: 'family_name_en', type: 'varchar', length: 100, nullable: true })
  familyNameEn!: string | null;

  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth!: string | null;

  @Column({ name: 'gender_code', type: 'varchar', length: 16, nullable: true })
  genderCode!: 'MALE' | 'FEMALE' | 'OTHER' | null;

  @Column({ name: 'phone_number', type: 'varchar', length: 20, nullable: true })
  phoneNumber!: string | null;

  @Column({ name: 'email_address', type: 'varchar', length: 254, nullable: true })
  emailAddress!: string | null;

  @Column({ name: 'address_line', type: 'varchar', length: 255, nullable: true })
  addressLine!: string | null;

  @Column({ name: 'sub_district_name', type: 'varchar', length: 100, nullable: true })
  subDistrictName!: string | null;

  @Column({ name: 'district_name', type: 'varchar', length: 100, nullable: true })
  districtName!: string | null;

  @Column({ name: 'province_name', type: 'varchar', length: 100, nullable: true })
  provinceName!: string | null;

  @Column({ name: 'postal_code', type: 'char', length: 5, nullable: true })
  postalCode!: string | null;

  @Column({ name: 'record_status', type: 'varchar', length: 16, default: 'ACTIVE' })
  recordStatus!: 'ACTIVE' | 'INACTIVE';

  @Column({ name: 'created_by_user_id', type: 'integer' })
  createdByUserId!: number;

  @Column({ name: 'updated_by_user_id', type: 'integer' })
  updatedByUserId!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

@Entity({ name: 'araid_profiles' })
export class AraIdProfileEntity {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'identity_record_id', type: 'uuid', unique: true })
  identityRecordId!: string;

  @Column({ name: 'created_by_user_id', type: 'integer' })
  createdByUserId!: number;

  @Column({ name: 'pin_hash', type: 'varchar', length: 255 })
  pinHash!: string;

  @Column({ name: 'registration_status', type: 'varchar', length: 16, default: 'ACTIVE' })
  registrationStatus!: 'ACTIVE' | 'LOCKED' | 'REVOKED';

  @Column({ name: 'registration_method', type: 'varchar', length: 24, default: 'MANAGED' })
  registrationMethod!: 'MANAGED';

  @Column({ name: 'failed_pin_attempts', type: 'smallint', default: 0 })
  failedPinAttempts!: number;

  @Column({ name: 'pin_locked_until', type: 'timestamptz', nullable: true })
  pinLockedUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
