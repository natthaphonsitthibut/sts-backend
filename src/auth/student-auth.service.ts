import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as crypto from 'crypto';
import { ROLE_BASELINES } from './permissions.constants';
import { hashToken } from '../common/utils/helpers';
import { queryDataSource } from '../database/sql-query';
import { DataSource } from 'typeorm';
import type { AuthenticatedRequestUser } from './auth.types';
import { authConfig } from '../config/auth.config';

interface StudentAuthRow extends Record<string, unknown> {
  PersonID_Onec: string;
  student_uuid?: string | null;
  person_uuid?: string | null;
  FirstName_Onec?: string | null;
  LastName_Onec?: string | null;
  school_name?: string | null;
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

const STUDENT_ROLE = 'STUDENT';
const STUDENT_PERMISSIONS = ROLE_BASELINES.STUDENT;
const STUDENT_LABEL = 'นักเรียน';
const DEFAULT_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function normalizeNamePart(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

    const student = await this.findStudentByPersonId(normalizedPersonId);
    if (!student) {
      throw new NotFoundException('เลขบัตรนี้ยังไม่มีข้อมูลนักเรียนในระบบ');
    }

    if (!student.student_uuid) {
      throw new ServiceUnavailableException('ข้อมูลนักเรียนยังไม่มี surrogate id');
    }
    const studentUuid = student.student_uuid;
    const personUuid = student.person_uuid ?? undefined;
    const virtualAuthToken = this.issueVirtualStudentToken(studentUuid, personUuid);
    const actor = this.buildStudentActor(student, studentUuid, personUuid);

    // person_uuid is server-side context (carried in the signed token for own
    // access across enrollments) — it must not ride in the login response body.
    const { person_uuid: _personUuid, ...actorForResponse } = actor;
    void _personUuid;

    return {
      ...actorForResponse,
      labels: [STUDENT_LABEL],
      virtual_auth_token: virtualAuthToken,
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

  private async findStudentByPersonId(personId: string): Promise<StudentAuthRow | null> {
    const result = await queryDataSource<StudentAuthRow>(
      this.dataSource,
      `
        SELECT
          s."PersonID_Onec",
          s.student_uuid,
          s.person_uuid,
          s."FirstName_Onec",
          s."LastName_Onec",
          sc.name AS school_name
        FROM student_term s
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        WHERE REGEXP_REPLACE(COALESCE(TRIM(s."PersonID_Onec"), ''), '[^0-9]', '', 'g') = $1
        ORDER BY s."AcademicYear_Onec" DESC NULLS LAST, s."Semester_Onec" DESC NULLS LAST
        LIMIT 1
      `,
      [personId],
    );

    return result.rows[0] || null;
  }

  private buildStudentActor(
    student: StudentAuthRow,
    studentUuid: string,
    personUuid?: string,
  ): AuthenticatedRequestUser & {
    FirstName: string | null;
    LastName: string | null;
    affiliation: string | null;
  } {
    return {
      id: this.buildVirtualStudentId(studentUuid),
      username: studentUuid,
      roles: [STUDENT_ROLE],
      permissions: [...STUDENT_PERMISSIONS],
      data_scope: { own_only: true },
      virtual_login: true,
      student_uuid: studentUuid,
      person_uuid: personUuid,
      FirstName: normalizeNamePart(student.FirstName_Onec),
      LastName: normalizeNamePart(student.LastName_Onec),
      affiliation: normalizeNamePart(student.school_name),
      auth_source: 'THAID_MOCK',
    };
  }

  private issueVirtualStudentToken(studentUuid: string, personUuid?: string): string {
    const issuedAt = Date.now();
    const payload: StudentVirtualTokenPayload = {
      source: 'THAID_MOCK',
      studentUuid,
      personUuid,
      roles: [STUDENT_ROLE],
      permissions: [...STUDENT_PERMISSIONS],
      issuedAt,
      expiresAt: issuedAt + DEFAULT_TOKEN_TTL_MS,
    };

    const encodedPayload = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', this.virtualAuthSecret)
      .update(encodedPayload)
      .digest('hex');

    return `${Buffer.from(encodedPayload).toString('base64')}.${signature}`;
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
