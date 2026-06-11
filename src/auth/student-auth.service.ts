import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { ROLE_BASELINES } from '../common/utils/authorization';
import { hashToken } from '../common/utils/helpers';
import { queryDataSource } from '../database/sql-query';
import { DataSource } from 'typeorm';
import type { AuthenticatedRequestUser } from './auth.types';

interface StudentAuthRow extends Record<string, unknown> {
  PersonID_Onec: string;
  FirstName_Onec?: string | null;
  LastName_Onec?: string | null;
  school_name?: string | null;
}

interface StudentVirtualTokenPayload {
  source: 'THAID_MOCK';
  personId: string;
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
  private readonly virtualAuthSecret = process.env.AUTH_SESSION_SECRET || 'SECRET_STS_KEY';

  constructor(private readonly dataSource: DataSource) {}

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

    const virtualAuthToken = this.issueVirtualStudentToken(student.PersonID_Onec);
    const actor = this.buildStudentActor(student);

    return {
      ...actor,
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
      id: this.buildVirtualStudentId(payload.personId),
      username: payload.personId,
      roles: payload.roles,
      permissions: payload.permissions,
      data_scope: { own_only: true },
      virtual_login: true,
      PersonID_Onec: payload.personId,
      auth_source: payload.source,
    };
  }

  private ensureMockModeEnabled(): void {
    const thaidMode = (process.env.THAID_MODE || 'mock').trim().toLowerCase();
    if (thaidMode !== 'mock') {
      throw new ServiceUnavailableException('ThaID mock mode is disabled');
    }
  }

  private async findStudentByPersonId(personId: string): Promise<StudentAuthRow | null> {
    const result = await queryDataSource<StudentAuthRow>(
      this.dataSource,
      `
        SELECT
          s."PersonID_Onec",
          s."FirstName_Onec",
          s."LastName_Onec",
          sc.name AS school_name
        FROM student_term s
        LEFT JOIN schools sc ON sc.id = s."SchoolID_Onec"
        WHERE REGEXP_REPLACE(COALESCE(TRIM(s."PersonID_Onec"), ''), '[^0-9]', '', 'g') = $1
        LIMIT 1
      `,
      [personId],
    );

    return result.rows[0] || null;
  }

  private buildStudentActor(student: StudentAuthRow): AuthenticatedRequestUser & {
    FirstName: string | null;
    LastName: string | null;
    affiliation: string | null;
  } {
    return {
      id: this.buildVirtualStudentId(student.PersonID_Onec),
      username: student.PersonID_Onec,
      roles: [STUDENT_ROLE],
      permissions: [...STUDENT_PERMISSIONS],
      data_scope: { own_only: true },
      virtual_login: true,
      PersonID_Onec: student.PersonID_Onec,
      FirstName: normalizeNamePart(student.FirstName_Onec),
      LastName: normalizeNamePart(student.LastName_Onec),
      affiliation: normalizeNamePart(student.school_name),
      auth_source: 'THAID_MOCK',
    };
  }

  private issueVirtualStudentToken(personId: string): string {
    const issuedAt = Date.now();
    const payload: StudentVirtualTokenPayload = {
      source: 'THAID_MOCK',
      personId,
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
        typeof decoded.personId !== 'string' ||
        !Array.isArray(decoded.roles) ||
        !Array.isArray(decoded.permissions) ||
        typeof decoded.expiresAt !== 'number' ||
        decoded.expiresAt < Date.now()
      ) {
        return null;
      }

      return {
        source: decoded.source,
        personId: decoded.personId,
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

  private buildVirtualStudentId(personId: string): number {
    const parsed = Number.parseInt(hashToken(personId).slice(0, 8), 16);
    return Number.isFinite(parsed) && parsed > 0 ? -parsed : -1;
  }
}
