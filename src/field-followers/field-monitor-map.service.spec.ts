import { AuditLogService } from '../audit-log/audit-log.service';
import { StudentGeocodeCacheService } from '../student-geocode/student-geocode-cache.service';
import { FieldMonitorMapRepository } from './field-monitor-map.repository';
import { FieldMonitorMapService } from './field-monitor-map.service';
import type { FieldMonitorMapRow } from './field-monitor-map.types';

describe('FieldMonitorMapService', () => {
  let service: FieldMonitorMapService;
  let repository: jest.Mocked<Pick<FieldMonitorMapRepository, 'getPins'>>;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let geocodeCache: jest.Mocked<Pick<StudentGeocodeCacheService, 'resolve'>>;

  const actor = {
    id: 7,
    username: 'director1',
    roles: ['DIRECTOR'],
    permissions: ['field-monitor'],
    data_scope: { school_ids: [10010002] },
  };

  function row(overrides: Partial<FieldMonitorMapRow> = {}): FieldMonitorMapRow {
    return {
      student_uuid: '11111111-1111-4111-8111-111111111111',
      student_name: 'สมชาย ใจดี',
      school_name: 'โรงเรียนทดสอบ',
      risk_tier: 'HIGH',
      student_lat: 18.79,
      student_lng: 98.98,
      ...overrides,
    };
  }

  beforeEach(() => {
    repository = { getPins: jest.fn().mockResolvedValue([row()]) };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    geocodeCache = { resolve: jest.fn().mockResolvedValue(null) };
    service = new FieldMonitorMapService(
      repository as unknown as FieldMonitorMapRepository,
      auditLog as unknown as AuditLogService,
      geocodeCache as unknown as StudentGeocodeCacheService,
    );
  });

  it('returns pins mapped from the repository and audits count + refs (no names)', async () => {
    const result = await service.getMapPins(['11111111-1111-4111-8111-111111111111'], actor, {
      ip: '127.0.0.1',
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      {
        student_uuid: '11111111-1111-4111-8111-111111111111',
        student_name: 'สมชาย ใจดี',
        school_name: 'โรงเรียนทดสอบ',
        risk_tier: 'HIGH',
        has_coordinates: true,
        is_approximate: false,
        lat: 18.79,
        lng: 98.98,
      },
    ]);
    expect(geocodeCache.resolve).not.toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FIELD_MAP_VIEW',
        actorUserId: actor.id,
        metadata: {
          studentCount: 1,
          studentUuidRefs: ['11111111-1111-4111-8111-111111111111'],
        },
      }),
    );
    const auditMetadata = auditLog.record.mock.calls[0]?.[0]?.metadata as Record<string, unknown>;
    expect(JSON.stringify(auditMetadata)).not.toContain('สมชาย');
  });

  it('marks a student with no home coordinates and no geocode fallback as has_coordinates: false', async () => {
    repository.getPins.mockResolvedValue([row({ student_lat: null, student_lng: null })]);

    const result = await service.getMapPins(['11111111-1111-4111-8111-111111111111'], actor, {
      ip: null,
    });

    expect(result.data[0]).toMatchObject({
      has_coordinates: false,
      is_approximate: false,
      lat: null,
      lng: null,
    });
  });

  it('uses the cached/geocoded approximate location when coordinates are missing', async () => {
    repository.getPins.mockResolvedValue([
      row({
        student_lat: null,
        student_lng: null,
        ProvinceNameThai_Onec: 'เชียงใหม่',
        DistrictNameThai_Onec: 'เมืองเชียงใหม่',
      }),
    ]);
    geocodeCache.resolve.mockResolvedValue({ lat: 18.8, lng: 99.0 });

    const result = await service.getMapPins(['11111111-1111-4111-8111-111111111111'], actor, {
      ip: null,
    });

    expect(geocodeCache.resolve).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      'เมืองเชียงใหม่ เชียงใหม่',
    );
    expect(result.data[0]).toMatchObject({
      has_coordinates: true,
      is_approximate: true,
      lat: 18.8,
      lng: 99.0,
    });
  });

  it('skips the geocode cache entirely when there is no registered address at all', async () => {
    repository.getPins.mockResolvedValue([row({ student_lat: null, student_lng: null })]);

    await service.getMapPins(['11111111-1111-4111-8111-111111111111'], actor, { ip: null });

    expect(geocodeCache.resolve).not.toHaveBeenCalled();
  });

  it('fails closed for an own_only scope without querying the repository', async () => {
    const ownOnlyActor = { ...actor, data_scope: { own_only: true } };

    const result = await service.getMapPins(
      ['11111111-1111-4111-8111-111111111111'],
      ownOnlyActor,
      { ip: null },
    );

    expect(result.data).toEqual([]);
    expect(repository.getPins).not.toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'FIELD_MAP_VIEW',
        metadata: { studentCount: 0, studentUuidRefs: [] },
      }),
    );
  });

  it('drops out-of-scope students silently — the repository already filtered them', async () => {
    repository.getPins.mockResolvedValue([]);

    const result = await service.getMapPins(
      ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
      actor,
      { ip: null },
    );

    expect(result.data).toEqual([]);
    expect(result.requestedCount).toBe(2);
  });
});
