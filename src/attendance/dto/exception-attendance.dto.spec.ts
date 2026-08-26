import { ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { createValidationException } from '../../common/validation/validation-exception.factory';
import { CheckInStudentPhotoQueryDto } from './exception-attendance.dto';

describe('CheckInStudentPhotoQueryDto', () => {
  const metadata: ArgumentMetadata = {
    type: 'query',
    metatype: CheckInStudentPhotoQueryDto,
  };
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: createValidationException,
  });

  it('accepts the ISO photo-version cache key used by check-in clients', async () => {
    await expect(
      pipe.transform(
        {
          studentId: '7d7dfdf5-b8ef-470c-8b24-8d33f5c7e093',
          v: '2026-08-26T08:15:30.000Z',
        },
        metadata,
      ),
    ).resolves.toMatchObject({
      studentId: '7d7dfdf5-b8ef-470c-8b24-8d33f5c7e093',
      v: '2026-08-26T08:15:30.000Z',
    });
  });

  it('rejects a malformed photo-version cache key', async () => {
    await expect(
      pipe.transform(
        {
          studentId: '7d7dfdf5-b8ef-470c-8b24-8d33f5c7e093',
          v: 'not-an-iso-timestamp',
        },
        metadata,
      ),
    ).rejects.toThrow();
  });
});
