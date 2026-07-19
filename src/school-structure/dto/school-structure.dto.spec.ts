import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateSchoolClassroomDto, UpdateSchoolClassroomDto } from './school-structure.dto';

describe('school structure DTOs', () => {
  it.each([CreateSchoolClassroomDto, UpdateSchoolClassroomDto])(
    'accepts numeric room codes and rejects alternate room identities for %p',
    (Dto) => {
      const valid = plainToInstance(Dto, {
        schoolTermId: 21,
        gradeLevelId: 423,
        roomCode: '12',
      });
      const nonNumeric = plainToInstance(Dto, {
        schoolTermId: 21,
        gradeLevelId: 423,
        roomCode: 'ก',
      });

      expect(validateSync(valid)).toHaveLength(0);
      expect(validateSync(nonNumeric).some((error) => error.property === 'roomCode')).toBe(true);
    },
  );
});
