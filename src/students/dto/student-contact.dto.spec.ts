import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { StudentContactDto, StudentGuardianInputDto } from './update-student.dto';

describe('student contact email limits', () => {
  it.each([StudentContactDto, StudentGuardianInputDto])(
    'rejects an email above the stored 254-character limit',
    (dto) => {
      const errors = validateSync(
        plainToInstance(dto, { email: `${'a'.repeat(245)}@example.com` }),
      );
      expect(errors.find((error) => error.property === 'email')?.constraints?.maxLength).toBe(
        'อีเมลต้องไม่เกิน 254 ตัวอักษร',
      );
    },
  );
});
