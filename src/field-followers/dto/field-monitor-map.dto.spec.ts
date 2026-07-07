import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FieldMonitorMapQueryDto, FIELD_MONITOR_MAP_MAX_STUDENTS } from './field-monitor-map.dto';

const uuid = (n: number) => `11111111-1111-4111-8111-11111111111${n}`;

describe('FieldMonitorMapQueryDto', () => {
  it('splits a comma-separated query string into an array', async () => {
    const dto = plainToInstance(FieldMonitorMapQueryDto, {
      studentUuids: `${uuid(1)},${uuid(2)}`,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.studentUuids).toEqual([uuid(1), uuid(2)]);
  });

  it('rejects an empty/missing list (400)', async () => {
    const dto = plainToInstance(FieldMonitorMapQueryDto, { studentUuids: '' });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it(`rejects more than ${FIELD_MONITOR_MAP_MAX_STUDENTS} ids (400)`, async () => {
    const many = Array.from(
      { length: FIELD_MONITOR_MAP_MAX_STUDENTS + 1 },
      (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
    ).join(',');
    const dto = plainToInstance(FieldMonitorMapQueryDto, { studentUuids: many });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-uuid entry', async () => {
    const dto = plainToInstance(FieldMonitorMapQueryDto, { studentUuids: 'not-a-uuid' });

    const errors = await validate(dto);

    expect(errors.length).toBeGreaterThan(0);
  });
});
