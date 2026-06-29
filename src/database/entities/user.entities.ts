import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'roles' })
export class RoleEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'name', type: 'text', unique: true })
  name!: string;

  @Column({ name: 'label', type: 'text' })
  label!: string;

  @Column({ name: 'rank', type: 'integer', default: 0 })
  rank!: number;

  @Column({
    name: 'default_permissions',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  defaultPermissions!: string[];

  @Column({ name: 'scope_mode', type: 'text', default: 'flexible' })
  scopeMode!: string;

  @Column({ name: 'scope_policy', type: 'text', default: 'ASSIGNABLE' })
  scopePolicy!: string;

  @Column({ name: 'is_assignable', type: 'boolean', default: true })
  isAssignable!: boolean;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem!: boolean;
}

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'username', type: 'text', unique: true })
  username!: string;

  @Column({ name: 'password', type: 'text' })
  password!: string;

  @Column({ name: 'FirstName', type: 'text', nullable: true })
  firstName!: string | null;

  @Column({ name: 'LastName', type: 'text', nullable: true })
  lastName!: string | null;

  @Column({ name: 'PersonID_Onec', type: 'text', nullable: true })
  personIdOnec!: string | null;

  @Column({ name: 'phone', type: 'text', nullable: true })
  phone!: string | null;

  @Column({ name: 'email', type: 'text', nullable: true })
  email!: string | null;

  @Column({ name: 'affiliation', type: 'text', nullable: true })
  affiliation!: string | null;

  @Column({ name: 'status', type: 'text', default: 'ACTIVE' })
  status!: string;

  @Column({ name: 'permissions', type: 'jsonb', default: () => "'[]'::jsonb" })
  permissions!: string[];

  @Column({ name: 'role', type: 'text', default: 'TEACHER' })
  role!: string;

  @Column({ name: 'data_scope', type: 'jsonb', default: () => "'{}'::jsonb" })
  dataScope!: Record<string, unknown>;

  @Column({ name: 'person_uuid', type: 'uuid', nullable: true })
  personUuid!: string | null;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword!: boolean;

  @Column({ name: 'temporary_password_issued_at', type: 'timestamptz', nullable: true })
  temporaryPasswordIssuedAt!: Date | null;

  @Column({ name: 'temporary_password_expires_at', type: 'timestamptz', nullable: true })
  temporaryPasswordExpiresAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true })
  createdAt!: Date | null;
}
