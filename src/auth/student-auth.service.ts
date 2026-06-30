import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as crypto from 'crypto';
import { hashToken } from '../common/utils/helpers';
import { queryDataSource } from '../database/sql-query';
import { DataSource } from 'typeorm';
import { normalizeDataScope, type AuthenticatedRequestUser } from './auth.types';
import { authConfig } from '../config/auth.config';

interface StudentAuthRow extends Record<string, unknown> {
  id: number;
  username: string;
  FirstName: string | null;
  LastName: string | null;
  affiliation: string | null;
  permissions: unknown;
  role: string;
  data_scope: unknown;
  must_change_password: boolean | null;
  roles: string[] | null;
  labels: string[] | null;
  role_default_permissions: unknown;
  student_uuid: string;
}

interface StudentVirtualTokenPayload {
  source: 'THAID_MOCK';
  // Identity on the wire is the opaque surrogate, never the national id. The
  // PersonID stays server-side (looked up by uuid on demand) so it never rides
  // in the bearer token the client holds.
  studentUuid: string;
  // Canonical person id (stable across terms). Optional for backward compat with
  // tokens issued before B2 — verify tolerates its absence.
  personUuid?: string;
  roles: string[];
  permissions: string[];
  issuedAt: number;
  expiresAt: number;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function normalizePersonId(value: string): string {
  return value.replace(/\D/g, '').trim();
}

@Injectable()
export class StudentAuthService {
  private readonly virtualAuthSecret: string;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(authConfig.KEY)
    private readonly authRuntimeConfig: ConfigType<typeof authConfig>,
  ) {
    this.virtualAuthSecret = this.authRuntimeConfig.sessionSecret;
  }

  async loginWithMockThaId(personId: string) {
    this.ensureMockModeEnabled();
    const normalizedPersonId = normalizePersonId(personId);
    if (normalizedPersonId.length !== 13) {
      throw new BadRequestException('personId ต้องเป็นเลขบัตรประชาชน 13 หลัก');
    }

    const users = await this.findActiveStudentUsersByPersonId(normalizedPersonId);
    if (users.length === 0) {
      throw new NotFoundException('ไม่พบบัญชีนักเรียนที่พร้อมใช้งาน');
    }
    if (users.length > 1) {
      throw new ConflictException('ข้อมูลตัวตนเชื่อมกับบัญชีมากกว่าหนึ่งรายการ');
    }
    const user = users[0];
    const permissions = normalizeStringArray(user.permissions);
    const defaultPermissions = normalizeStringArray(user.role_default_permissions);

    return {
      id: user.id,
      username: user.username,
      FirstName: user.FirstName,
      LastName: user.LastName,
      affiliation: user.affiliation,
      roles: normalizeStringArray(user.roles),
      labels: normalizeStringArray(user.labels),
      permissions: permissions.length > 0 ? permissions : defaultPermissions,
      data_scope: normalizeDataScope(user.data_scope) || { own_only: true },
      student_uuid: user.student_uuid,
      must_change_password: false,
      auth_source: 'THAID_MOCK' as const,
    };
  }

  loadVirtualStudentActor(sessionToken: string): AuthenticatedRequestUser | null {
    const payload = this.verifyVirtualStudentToken(sessionToken);
    if (!payload) {
      return null;
    }

    return {
      id: this.buildVirtualStudentId(payload.studentUuid),
      username: payload.studentUuid,
      roles: payload.roles,
      permissions: payload.permissions,
      data_scope: { own_only: true },
      virtual_login: true,
      student_uuid: payload.studentUuid,
      person_uuid: payload.personUuid,
      auth_source: payload.source,
    };
  }

  private ensureMockModeEnabled(): void {
    if (this.authRuntimeConfig.thaidMode !== 'mock') {
      throw new ServiceUnavailableException('ThaID mock mode is disabled');
    }
  }

  private async findActiveStudentUsersByPersonId(personId: string): Promise<StudentAuthRow[]> {
    const result = await queryDataSource<StudentAuthRow>(
      this.dataSource,
      `
        SELECT DISTINCT ON (u.id)
          u.id,
          u.username,
          u."FirstName",
          u."LastName",
          u.affiliation,
          u.permissions,
          u.role,
          u.data_scope,
          u.must_change_password,
          ARRAY[u.role]::text[] AS roles,
          CASE WHEN r.label IS NULL THEN ARRAY[]::text[] ELSE ARRAY[r.label]::text[] END AS labels,
          r.default_permissions AS role_default_permissions,
          current_student.student_uuid
        FROM student_person_identifier spi
        JOIN student_person person ON person.person_uuid = spi.person_uuid
        JOIN users u ON u.person_uuid = person.person_uuid
        LEFT JOIN roles r ON r.name = u.role
        JOIN LATERAL (
          SELECT enrollment.student_uuid
          FROM student_term enrollment
          WHERE enrollment.person_uuid = person.person_uuid
            AND enrollment.deleted_at IS NULL
            AND enrollment."StudentStatusID_Onec" = 10
          ORDER BY enrollment."AcademicYear_Onec" DESC NULLS LAST,
                   enrollment."Semester_Onec" DESC NULLS LAST,
                   enrollment.student_uuid DESC
          LIMIT 1
        ) current_student ON true
        WHERE spi.identifier_type = 'NATIONAL_ID'
          AND spi.identifier_normalized = $1
          AND spi.is_primary = TRUE
          AND person.identity_status = 'ACTIVE'
          AND u.role = 'STUDENT'
          AND u.status = 'ACTIVE'
        ORDER BY u.id
      `,
      [personId],
    );

    return result.rows;
  }

  private verifyVirtualStudentToken(sessionToken: string): StudentVirtualTokenPayload | null {
    try {
      const [base64Payload, signature] = sessionToken.split('.');
      if (!base64Payload || !signature) {
        return null;
      }

      const payload = Buffer.from(base64Payload, 'base64').toString('utf-8');
      const expectedSignature = crypto
        .createHmac('sha256', this.virtualAuthSecret)
        .update(payload)
        .digest('hex');

      if (expectedSignature !== signature) {
        return null;
      }

      const decoded = JSON.parse(payload) as Partial<StudentVirtualTokenPayload>;
      if (
        decoded.source !== 'THAID_MOCK' ||
        typeof decoded.studentUuid !== 'string' ||
        !Array.isArray(decoded.roles) ||
        !Array.isArray(decoded.permissions) ||
        typeof decoded.expiresAt !== 'number' ||
        decoded.expiresAt < Date.now()
      ) {
        return null;
      }

      return {
        source: decoded.source,
        studentUuid: decoded.studentUuid,
        personUuid: typeof decoded.personUuid === 'string' ? decoded.personUuid : undefined,
        roles: decoded.roles.filter(
          (role): role is string => typeof role === 'string' && role.trim().length > 0,
        ),
        permissions: decoded.permissions.filter(
          (permission): permission is string =>
            typeof permission === 'string' && permission.trim().length > 0,
        ),
        issuedAt: typeof decoded.issuedAt === 'number' ? decoded.issuedAt : Date.now(),
        expiresAt: decoded.expiresAt,
      };
    } catch {
      return null;
    }
  }

  private buildVirtualStudentId(key: string): number {
    // Stable synthetic id for a virtual student. Bound it into PostgreSQL int4
    // range (it keys the reveal-window lookup, an int column) so a large hash
    // never overflows. Negative to stay clear of real users.id values.
    const parsed = Number.parseInt(hashToken(key).slice(0, 8), 16);
    const bounded = Number.isFinite(parsed) ? parsed % 0x7fffffff : 0;
    return bounded > 0 ? -bounded : -1;
  }
}
