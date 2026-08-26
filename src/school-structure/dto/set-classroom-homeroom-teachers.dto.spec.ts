import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SetClassroomHomeroomTeachersDto } from './school-structure.dto';

describe('SetClassroomHomeroomTeachersDto', () => {
  it.each([{ ids: [] }, { ids: [31] }, { ids: [31, 32] }])(
    'accepts 0-2 unique membership ids: $ids',
    async ({ ids }) => {
      const dto = plainToInstance(SetClassroomHomeroomTeachersDto, {
        teacherMembershipIds: ids,
      });
      await expect(validate(dto)).resolves.toHaveLength(0);
    },
  );

  it.each([{ ids: [31, 31] }, { ids: [31, 32, 33] }, { ids: [0] }, { ids: ['not-a-number'] }])(
    'rejects invalid membership ids: $ids',
    async ({ ids }) => {
      const dto = plainToInstance(SetClassroomHomeroomTeachersDto, {
        teacherMembershipIds: ids,
      });
      expect(await validate(dto)).not.toHaveLength(0);
    },
  );
});
