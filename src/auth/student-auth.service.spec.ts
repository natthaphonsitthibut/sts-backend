import { ConflictException, NotFoundException } from '@nestjs/common';
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
      } as never,
    ),
    queryRunner,
  };
}

describe('StudentAuthService real-account binding', () => {
  const linkedUser = {
    id: 77,
    username: '10010002-ABCDE',
    FirstName: 'สมชาย',
    LastName: 'ใจดี',
    affiliation: 'โรงเรียนทดสอบ',
    permissions: ['home', 'student-self'],
    role: 'STUDENT',
    data_scope: { own_only: true },
    must_change_password: true,
    roles: ['STUDENT'],
    labels: ['นักเรียน'],
    role_default_permissions: ['home', 'student-self'],
    student_uuid: 'student-uuid-1',
  };

  it('returns the existing generated user without leaking identity keys', async () => {
    const { service, queryRunner } = createService([linkedUser]);

    const result = await service.loginWithMockThaId('1-2345-67890-12-3');

    expect(result).toMatchObject({
      id: 77,
      username: '10010002-ABCDE',
      student_uuid: 'student-uuid-1',
      auth_source: 'THAID_MOCK',
      must_change_password: false,
    });
    expect(JSON.stringify(result)).not.toContain('person_uuid');
    expect(JSON.stringify(result)).not.toContain('virtual_auth_token');
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining("spi.identifier_type = 'NATIONAL_ID'"),
      ['1234567890123'],
      true,
    );
  });

  it('fails closed when no active generated account matches', async () => {
    const { service } = createService([]);
    await expect(service.loginWithMockThaId('1234567890123')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('fails closed when the identity matches multiple active accounts', async () => {
    const { service } = createService([linkedUser, { ...linkedUser, id: 78 }]);
    await expect(service.loginWithMockThaId('1234567890123')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
