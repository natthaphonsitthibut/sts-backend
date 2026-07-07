import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuthenticatedRequestUser } from '../auth';
import { FieldMonitorMapRepository } from './field-monitor-map.repository';
import type { FieldMonitorMapRow } from './field-monitor-map.types';

export interface FieldMonitorMapPin {
  student_uuid: string;
  student_name: string;
  school_name: string | null;
  risk_tier: string;
  has_coordinates: boolean;
  lat: number | null;
  lng: number | null;
}

@Injectable()
export class FieldMonitorMapService {
  constructor(
    private readonly repository: FieldMonitorMapRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  async getMapPins(
    studentUuids: string[],
    actor: AuthenticatedRequestUser,
    meta: { ip: string | null },
  ): Promise<{ success: true; data: FieldMonitorMapPin[]; requestedCount: number }> {
    // own_only is gated here, not in buildDataScopeQuery (see authorization.ts) —
    // field-monitor is DIRECTOR/ADMIN-only in practice, but fail closed anyway.
    if (actor.data_scope?.own_only === true) {
      await this.recordView([], actor, meta);
      return { success: true, data: [], requestedCount: studentUuids.length };
    }

    const rows = await this.repository.getPins(studentUuids, actor.data_scope ?? {});
    const pins = rows.map((row) => this.toPin(row));
    await this.recordView(pins, actor, meta);

    return { success: true, data: pins, requestedCount: studentUuids.length };
  }

  private async recordView(
    pins: FieldMonitorMapPin[],
    actor: AuthenticatedRequestUser,
    meta: { ip: string | null },
  ): Promise<void> {
    await this.auditLog.record({
      action: 'FIELD_MAP_VIEW',
      actorUserId: actor.id,
      actorLabel: actor.username,
      targetType: 'student_risk_map',
      targetId: null,
      metadata: {
        studentCount: pins.length,
        studentUuidRefs: pins.map((pin) => pin.student_uuid),
      },
      ip: meta.ip,
    });
  }

  private toPin(row: FieldMonitorMapRow): FieldMonitorMapPin {
    const hasCoordinates = row.student_lat !== null && row.student_lng !== null;
    return {
      student_uuid: row.student_uuid,
      student_name: row.student_name,
      school_name: row.school_name,
      risk_tier: row.risk_tier,
      has_coordinates: hasCoordinates,
      lat: hasCoordinates ? row.student_lat : null,
      lng: hasCoordinates ? row.student_lng : null,
    };
  }
}
