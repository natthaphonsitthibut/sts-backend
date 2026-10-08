import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ListClassroomAttendanceLinksDto } from './classroom-attendance-links.dto';

describe('ListClassroomAttendanceLinksDto sorting', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (sortBy: string) =>
    pipe.transform(
      { schoolId: '1', schoolTermId: '2', sortBy, sortDirection: 'desc' },
      { type: 'query', metatype: ListClassroomAttendanceLinksDto },
    );

  it('accepts supported server-side sort keys', async () => {
    await expect(validate('classroomCount')).resolves.toMatchObject({
      sortBy: 'classroomCount',
      sortDirection: 'desc',
    });
  });

  it('rejects unsupported sort keys before reaching SQL', async () => {
    await expect(validate('membership.id; DROP TABLE users')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
