import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as crypto from 'crypto';
import { isUUID } from 'class-validator';
import { hashToken } from '../common/utils/helpers';
import { queryDataSource } from '../database/sql-query';
import { DataSource } from 'typeorm';
import type { AuthenticatedRequestUser } from './auth.types';
import { authConfig } from '../config/auth.config';

interface StudentAuthRow extends Record<string, unknown> {
  person_uuid: string;
  FirstName: string | null;
  LastName: string | null;
  affiliation: string | null;
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

interface ActiveVirtualStudentRow extends Record<string, unknown> {
  person_uuid: string;
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

    const enrollments = await this.findCurrentStudentByPersonId(normalizedPersonId);
    if (enrollments.length === 0) {
      throw new NotFoundException('ไม่พบข้อมูลนักเรียนที่กำลังศึกษา');
    }
    const student = enrollments[0];
    const roles: string[] = [];
    const permissions = ['student-self'];
    const virtualAuthToken = this.signVirtualStudentToken({
      studentUuid: student.student_uuid,
      personUuid: student.person_uuid,
      roles,
      permissions,
    });

    return {
      id: this.buildVirtualStudentId(student.student_uuid),
      username: student.student_uuid,
      FirstName: student.FirstName,
      LastName: student.LastName,
      affiliation: student.affiliation,
      roles,
      labels: [],
      permissions,
      data_scope: { own_only: true },
      student_uuid: student.student_uuid,
      must_change_password: false,
      virtual_login: true,
      virtual_auth_token: virtualAuthToken,
      auth_source: 'THAID_MOCK' as const,
    };
  }

  async loadVirtualStudentActor(sessionToken: string): Promise<AuthenticatedRequestUser | null> {
    const payload = this.verifyVirtualStudentToken(sessionToken);
    if (!payload) {
      return null;
    }

    const activeStudent = await this.findActiveVirtualStudent(payload);
    if (!activeStudent) {
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
      person_uuid: activeStudent.person_uuid,
      auth_source: payload.source,
    };
  }

  private ensureMockModeEnabled(): void {
    if (this.authRuntimeConfig.thaidMode !== 'mock') {
      throw new ServiceUnavailableException('ThaID mock mode is disabled');
    }
  }

  private async findCurrentStudentByPersonId(personId: string): Promise<StudentAuthRow[]> {
    const result = await queryDataSource<StudentAuthRow>(
      this.dataSource,
      `
        SELECT
          person.person_uuid,
          enrollment."FirstName_Onec" AS "FirstName",
          enrollment."LastName_Onec" AS "LastName",
          school.name AS affiliation,
          enrollment.student_uuid
        FROM student_person_identifier spi
        JOIN student_person person ON person.person_uuid = spi.person_uuid
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = person.person_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        JOIN student_term enrollment
          ON enrollment.student_uuid = current_enrollment.selected_student_uuid
        LEFT JOIN schools school ON school.id = enrollment."SchoolID_Onec"
        WHERE spi.identifier_type = 'NATIONAL_ID'
          AND spi.identifier_normalized = $1
          AND spi.is_primary = TRUE
          AND person.identity_status = 'ACTIVE'
        LIMIT 1
      `,
      [personId],
    );

    return result.rows;
  }

  private async findActiveVirtualStudent(
    payload: StudentVirtualTokenPayload,
  ): Promise<ActiveVirtualStudentRow | null> {
    const result = await queryDataSource<ActiveVirtualStudentRow>(
      this.dataSource,
      `
        SELECT person.person_uuid
        FROM student_person person
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = person.person_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        WHERE current_enrollment.selected_student_uuid = $1
          AND person.identity_status = 'ACTIVE'
          AND ($2::text IS NULL OR person.person_uuid::text = $2::text)
        LIMIT 1
      `,
      [payload.studentUuid, payload.personUuid ?? null],
    );

    return result.rows[0] ?? null;
  }

  private signVirtualStudentToken(input: {
    studentUuid: string;
    personUuid: string;
    roles: string[];
    permissions: string[];
  }): string {
    const issuedAt = Date.now();
    const payload: StudentVirtualTokenPayload = {
      source: 'THAID_MOCK',
      studentUuid: input.studentUuid,
      personUuid: input.personUuid,
      roles: input.roles,
      permissions: input.permissions,
      issuedAt,
      expiresAt: issuedAt + this.authRuntimeConfig.tokenTtlSeconds * 1000,
    };
    const serialized = JSON.stringify(payload);
    const base64Payload = Buffer.from(serialized, 'utf-8').toString('base64');
    const signature = crypto
      .createHmac('sha256', this.virtualAuthSecret)
      .update(serialized)
      .digest('hex');
    return `${base64Payload}.${signature}`;
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

      if (!/^[0-9a-f]{64}$/.test(signature)) {
        return null;
      }
      const expectedSignatureBuffer = Buffer.from(expectedSignature, 'hex');
      const signatureBuffer = Buffer.from(signature, 'hex');
      if (
        expectedSignatureBuffer.length !== signatureBuffer.length ||
        !crypto.timingSafeEqual(expectedSignatureBuffer, signatureBuffer)
      ) {
        return null;
      }

      const decoded = JSON.parse(payload) as Partial<StudentVirtualTokenPayload>;
      if (
        decoded.source !== 'THAID_MOCK' ||
        typeof decoded.studentUuid !== 'string' ||
        !isUUID(decoded.studentUuid) ||
        (decoded.personUuid !== undefined &&
          (typeof decoded.personUuid !== 'string' || !isUUID(decoded.personUuid))) ||
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
