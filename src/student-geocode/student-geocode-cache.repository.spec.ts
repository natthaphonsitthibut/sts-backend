import { DataSource } from 'typeorm';
import { StudentGeocodeCacheRepository } from './student-geocode-cache.repository';

describe('StudentGeocodeCacheRepository', () => {
  it('coerces lat/lng to numbers even when Postgres returns NUMERIC columns as strings', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        student_uuid: 'student-1',
        lat: '18.7883439',
        lng: '98.9852973',
        source_address_text: '123 หมู่ 1',
        geocoded_at: '2026-07-01T00:00:00.000Z',
      },
    ]);
    const queryRunner = { connect: jest.fn(), query, release: jest.fn() };
    const dataSource = { createQueryRunner: () => queryRunner } as unknown as DataSource;

    const repository = new StudentGeocodeCacheRepository(dataSource);
    const row = await repository.find('student-1');

    expect(row).not.toBeNull();
    expect(row?.lat).toBe(18.7883439);
    expect(row?.lng).toBe(98.9852973);
    expect(typeof row?.lat).toBe('number');
    expect(typeof row?.lng).toBe('number');
  });

  it('returns null when no cache row exists', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const queryRunner = { connect: jest.fn(), query, release: jest.fn() };
    const dataSource = { createQueryRunner: () => queryRunner } as unknown as DataSource;

    const repository = new StudentGeocodeCacheRepository(dataSource);
    const row = await repository.find('missing-student');

    expect(row).toBeNull();
  });
});
