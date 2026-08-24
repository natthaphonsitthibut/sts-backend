import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { ListMasterDataQueryDto } from './master-data.dto';
import { ListStudentStatusesQueryDto } from './student-status.dto';

describe('master-data query DTOs', () => {
  it.each([ListMasterDataQueryDto, ListStudentStatusesQueryDto])(
    'preserves explicit false for %p with implicit conversion enabled',
    (Dto) => {
      const query = plainToInstance(
        Dto,
        { includeInactive: 'false' },
        {
          enableImplicitConversion: true,
        },
      );

      expect(query.includeInactive).toBe(false);
    },
  );

  it.each([ListMasterDataQueryDto, ListStudentStatusesQueryDto])(
    'parses explicit true for %p with implicit conversion enabled',
    (Dto) => {
      const query = plainToInstance(
        Dto,
        { includeInactive: 'true' },
        {
          enableImplicitConversion: true,
        },
      );

      expect(query.includeInactive).toBe(true);
    },
  );
});
