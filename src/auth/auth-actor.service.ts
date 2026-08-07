import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import {
  normalizeDataScope,
  type AuthenticatedRequestUser,
  type RequestWithUser,
} from './auth.types';
import { StudentAuthService } from './student-auth.service';
import { SessionCookieService } from './session-cookie.service';

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

function resolvePermissions(permissions: unknown, defaultPermissions: unknown): string[] {
  if (Array.isArray(permissions)) {
    return Array.from(
      new Set(
        permissions.filter(
          (permission): permission is string =>
            typeof permission === 'string' && permission.trim().length > 0,
        ),
      ),
    );
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
      return await this.studentAuthService.loadVirtualStudentActor(virtualAuthToken);
    }

    return null;
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
          WHERE u.id = $1
            AND u.status = 'ACTIVE'
            AND u.role IS DISTINCT FROM 'STUDENT'
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
