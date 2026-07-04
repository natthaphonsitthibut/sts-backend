import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { hashToken } from '../common/utils/helpers';
import { queryDataSource } from '../database/sql-query';
import {
  normalizeDataScope,
  type AuthenticatedRequestUser,
  type RequestWithUser,
} from './auth.types';
import * as crypto from 'crypto';
import { StudentAuthService } from './student-auth.service';
import { SessionCookieService } from './session-cookie.service';
import { authConfig } from '../config/auth.config';

interface QueryResult<T extends Record<string, unknown>> {
  rows: T[];
}

interface UserActorRow extends Record<string, unknown> {
  id: number;
  username: string;
  roles: string[] | null;
  permissions: unknown;
  data_scope?: Record<string, unknown> | null;
  PersonID_Onec?: string | null;
  person_uuid?: string | null;
  student_uuid?: string | null;
  role_default_permissions?: unknown;
}

interface MagicLinkActorRow extends Record<string, unknown> {
  id: string;
  assigned_to_email?: string | null;
  login_role?: string | null;
  login_permissions?: unknown;
  role_default_permissions?: unknown;
  login_data_scope?: Record<string, unknown> | null;
  otp_verified?: boolean | number | null;
  expires_at: string | Date;
  admin_locked?: boolean | number | null;
  status?: string | null;
  task_type?: string | null;
}

function resolvePermissions(permissions: unknown, defaultPermissions: unknown): string[] {
  const storedPermissions = Array.isArray(permissions)
    ? permissions.filter(
        (permission): permission is string =>
          typeof permission === 'string' && permission.trim().length > 0,
      )
    : [];

  if (storedPermissions.length > 0) {
    return Array.from(new Set(storedPermissions));
  }

  return Array.from(
    new Set(
      Array.isArray(defaultPermissions)
        ? defaultPermissions.filter(
            (permission): permission is string =>
              typeof permission === 'string' && permission.trim().length > 0,
          )
        : [],
    ),
  );
}

@Injectable()
export class AuthActorService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly studentAuthService: StudentAuthService,
    private readonly sessionCookieService: SessionCookieService,
    @Inject(authConfig.KEY)
    private readonly authRuntimeConfig: ConfigType<typeof authConfig>,
  ) {}

  async loadRequiredUser(
    request: Pick<RequestWithUser, 'headers' | 'session'>,
  ): Promise<AuthenticatedRequestUser | null> {
    return await this.resolveRequestActor(request);
  }

  async loadOptionalUser(
    request: Pick<RequestWithUser, 'headers' | 'session'>,
  ): Promise<AuthenticatedRequestUser | null> {
    return await this.resolveRequestActor(request);
  }

  private async resolveRequestActor(
    request: Pick<RequestWithUser, 'headers' | 'session'>,
  ): Promise<AuthenticatedRequestUser | null> {
    const userId = this.extractUserId(request);
    if (userId) {
      return await this.loadUser(userId);
    }

    const virtualAuthToken = this.readHeader(request.headers, 'x-virtual-auth');
    if (virtualAuthToken) {
      return this.studentAuthService.loadVirtualStudentActor(virtualAuthToken);
    }

    const magicLinkToken = this.readHeader(request.headers, 'x-magic-link-token');
    if (!magicLinkToken) {
      return null;
    }

    const sessionToken = this.readHeader(request.headers, 'x-magic-session');
    return await this.loadMagicLinkUser(magicLinkToken, sessionToken);
  }

  private extractUserId(request: Pick<RequestWithUser, 'headers' | 'session'>): number | null {
    // Identity comes only from the server-signed httpOnly session cookie — never
    // from a client-supplied header (a forgeable `x-user-id` would be a full auth
    // bypass).
    return this.sessionCookieService.readUserId(this.readHeader(request.headers, 'cookie'));
  }

  private async loadUser(userId: number): Promise<AuthenticatedRequestUser | null> {
    try {
      const result = (await queryDataSource<UserActorRow>(
        this.dataSource,
        `
          SELECT
            u.id,
            u.username,
            CASE
              WHEN u.role IS NOT NULL THEN ARRAY[u.role]::text[]
              ELSE ARRAY[]::text[]
            END AS roles,
            u.permissions,
            u.data_scope,
            u."PersonID_Onec",
            u.person_uuid,
            current_enrollment.selected_student_uuid AS student_uuid,
            r.default_permissions AS role_default_permissions
          FROM users u
          LEFT JOIN roles r ON r.name = u.role
          LEFT JOIN student_current_enrollment_resolution current_enrollment
            ON current_enrollment.person_uuid = u.person_uuid
           AND current_enrollment.resolution_state = 'ACTIVE'
          WHERE u.id = $1 AND u.status = 'ACTIVE'
            AND (
              u.role IS DISTINCT FROM 'STUDENT'
              OR current_enrollment.selected_student_uuid IS NOT NULL
            )
        `,
        [userId],
      )) as QueryResult<UserActorRow>;

      const row = result.rows[0];
      if (!row) {
        return null;
      }

      const roles = Array.isArray(row.roles) ? row.roles : [];
      return {
        id: row.id,
        username: row.username,
        roles,
        permissions: resolvePermissions(row.permissions, row.role_default_permissions),
        data_scope: normalizeDataScope(row.data_scope) || {},
        PersonID_Onec: typeof row['PersonID_Onec'] === 'string' ? row['PersonID_Onec'] : undefined,
        person_uuid: typeof row.person_uuid === 'string' ? row.person_uuid : undefined,
        student_uuid: typeof row.student_uuid === 'string' ? row.student_uuid : undefined,
        auth_source: 'LOCAL',
      };
    } catch {
      return null;
    }
  }

  private isMagicSessionVerified(linkId: string, sessionToken?: string): boolean {
    if (!sessionToken) {
      return false;
    }

    try {
      const [base64Payload, signature] = sessionToken.split('.');
      const payload = Buffer.from(base64Payload, 'base64').toString('utf-8');
      const expectedSign = crypto
        .createHmac('sha256', this.authRuntimeConfig.sessionSecret)
        .update(payload)
        .digest('hex');

      const expectedBuf = Buffer.from(expectedSign);
      const providedBuf = Buffer.from(signature ?? '');
      if (
        expectedBuf.length !== providedBuf.length ||
        !crypto.timingSafeEqual(expectedBuf, providedBuf)
      ) {
        return false;
      }

      const data = JSON.parse(payload) as {
        link_id?: string;
        verified?: boolean;
        ts?: number;
      };

      if (data.link_id !== linkId || data.verified !== true) {
        return false;
      }

      const issuedAt = typeof data.ts === 'number' ? data.ts : 0;
      const ageMs = Date.now() - issuedAt;
      const ttlMs = this.authRuntimeConfig.magicSessionTtlSeconds * 1000;
      if (!Number.isFinite(issuedAt) || issuedAt <= 0 || ageMs > ttlMs || ageMs < 0) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  private buildVirtualUserId(linkId: string): number {
    const parsed = Number.parseInt(hashToken(linkId).slice(0, 8), 16);
    return Number.isFinite(parsed) && parsed > 0 ? -parsed : -1;
  }

  private async loadMagicLinkUser(
    rawToken: string,
    sessionToken?: string,
  ): Promise<AuthenticatedRequestUser | null> {
    try {
      const tokenHash = hashToken(rawToken);
      const result = (await queryDataSource<MagicLinkActorRow>(
        this.dataSource,
        `
          SELECT
            tl.id,
            tl.assigned_to_email,
            tl.login_role,
            tl.login_permissions,
            r.default_permissions AS role_default_permissions,
            tl.login_data_scope,
            tl.otp_verified,
            tl.expires_at,
            tl.admin_locked,
            tl.status,
            t.task_type
          FROM task_links tl
          JOIN tasks t ON t.id = tl.task_id
          LEFT JOIN roles r ON r.name = tl.login_role
          WHERE tl.token_hash = $1
            AND tl.deleted_at IS NULL
            AND t.deleted_at IS NULL
        `,
        [tokenHash],
      )) as QueryResult<MagicLinkActorRow>;

      const row = result.rows[0];
      if (!row) {
        return null;
      }

      if (row.task_type !== 'LOGIN') {
        return null;
      }
      if (row.admin_locked) {
        return null;
      }
      if (row.status !== 'ACTIVE') {
        return null;
      }
      if (new Date(row.expires_at) < new Date()) {
        return null;
      }

      const hasEmailForOtp =
        typeof row.assigned_to_email === 'string' && row.assigned_to_email.trim().length > 0;
      const otpVerified = row.otp_verified === true || row.otp_verified === 1;

      if (hasEmailForOtp && !otpVerified && !this.isMagicSessionVerified(row.id, sessionToken)) {
        return null;
      }

      const role =
        typeof row.login_role === 'string' && row.login_role.trim().length > 0
          ? row.login_role.trim()
          : 'TEACHER';

      return {
        id: this.buildVirtualUserId(row.id),
        username: row.assigned_to_email || `magic-link-${row.id}`,
        roles: [role],
        permissions: resolvePermissions(row.login_permissions, row.role_default_permissions),
        data_scope: normalizeDataScope(row.login_data_scope) || {},
        virtual_login: true,
        auth_source: 'MAGIC_LINK',
      };
    } catch {
      return null;
    }
  }

  private readHeader(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ): string | undefined {
    const value = headers[key];
    if (Array.isArray(value)) {
      return value[0];
    }
    return typeof value === 'string' ? value : undefined;
  }
}
