import { NotFoundException } from '@nestjs/common';
import { StudentAuthService } from './student-auth.service';

function createService(records: Array<Record<string, unknown>>) {
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ records, affected: records.length }),
  };
  const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
  return {
    service: new StudentAuthService(
      dataSource as never,
      {
        sessionSecret: 'test-session-secret-at-least-32-characters',
        thaidMode: 'mock',
        tokenTtlSeconds: 3600,
      } as never,
    ),
    queryRunner,
  };
}

describe('StudentAuthService accountless virtual student session', () => {
  const currentEnrollment = {
    person_uuid: '10000000-0000-4000-8000-000000000001',
    FirstName: 'สมชาย',
    LastName: 'ใจดี',
    affiliation: 'โรงเรียนทดสอบ',
    student_uuid: '00000000-0000-4000-8000-000000000001',
  };

  it('returns a signed virtual session without requiring or leaking a user account', async () => {
    const { service, queryRunner } = createService([currentEnrollment]);

    const result = await service.loginWithMockThaId('1-2345-67890-12-3');

    expect(result).toMatchObject({
      student_uuid: currentEnrollment.student_uuid,
      roles: [],
      permissions: ['student-self'],
      virtual_login: true,
      auth_source: 'THAID_MOCK',
      must_change_password: false,
    });
    expect(JSON.stringify(result)).not.toContain('person_uuid');
    expect(result.virtual_auth_token).toEqual(expect.any(String));
    await expect(service.loadVirtualStudentActor(result.virtual_auth_token)).resolves.toMatchObject(
      {
        student_uuid: currentEnrollment.student_uuid,
        person_uuid: currentEnrollment.person_uuid,
        roles: [],
        permissions: ['student-self'],
        virtual_login: true,
      },
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining("spi.identifier_type = 'NATIONAL_ID'"),
      ['1234567890123'],
      true,
    );
    const queryCalls = queryRunner.query.mock.calls as Array<[string, unknown[], boolean?]>;
    const sql = queryCalls[0]?.[0] ?? '';
    expect(sql).toContain('student_current_enrollment_resolution');
    expect(sql).toContain("current_enrollment.resolution_state = 'ACTIVE'");
    expect(sql).not.toContain('JOIN users');
    expect(sql).not.toContain('"StudentStatusID_Onec" = 10');
    expect(queryCalls[1]?.[0]).toContain("current_enrollment.resolution_state = 'ACTIVE'");
    expect(queryCalls[1]?.[0]).toContain("person.identity_status = 'ACTIVE'");
  });

  it('revokes an issued virtual session when the current enrollment is no longer active', async () => {
    const { service, queryRunner } = createService([currentEnrollment]);
    const result = await service.loginWithMockThaId('1234567890123');
    queryRunner.query.mockResolvedValueOnce({ records: [], affected: 0 });

    await expect(service.loadVirtualStudentActor(result.virtual_auth_token)).resolves.toBeNull();
  });

  it('rejects a virtual session with a malformed signature before querying enrollment state', async () => {
    const { service, queryRunner } = createService([currentEnrollment]);
    const result = await service.loginWithMockThaId('1234567890123');
    queryRunner.query.mockClear();
    const [payload] = result.virtual_auth_token.split('.');

    await expect(service.loadVirtualStudentActor(`${payload}.not-hex`)).resolves.toBeNull();
    expect(queryRunner.query).not.toHaveBeenCalled();
  });

  it('fails closed when no current enrollment matches', async () => {
    const { service } = createService([]);
    await expect(service.loginWithMockThaId('1234567890123')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
