import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  CreateSubjectDto,
  SaveGradeSchoolSubjectDto,
  UpdateGradeSchoolSubjectDto,
} from './subjects.dto';

describe('CreateSubjectDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const validate = (value: { code: string; nameTh: string }) =>
    pipe.transform(value, { type: 'body', metatype: CreateSubjectDto });

  it('accepts Thai and English subject codes with digits', async () => {
    await expect(validate({ code: 'ค21101', nameTh: 'คณิตศาสตร์' })).resolves.toMatchObject({
      code: 'ค21101',
    });
    await expect(validate({ code: 'm22101', nameTh: 'Mathematics' })).resolves.toMatchObject({
      code: 'M22101',
    });
  });

  it.each([
    [{ code: 'M21/01', nameTh: 'คณิตศาสตร์' }, 'รหัสวิชาใช้ได้เฉพาะตัวอักษรไทย อังกฤษ และตัวเลข'],
    [{ code: 'A'.repeat(21), nameTh: 'คณิตศาสตร์' }, 'รหัสวิชาต้องไม่เกิน 20 ตัวอักษร'],
    [{ code: 'M22101', nameTh: 'ก'.repeat(201) }, 'ชื่อวิชาต้องไม่เกิน 200 ตัวอักษร'],
  ])('rejects invalid subject data with Thai errors', async (value, message) => {
    try {
      await validate(value);
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as { message: string[] };
      expect(response.message).toContain(message);
    }
  });

  it('keeps legacy codes editable but rejects them on creation', async () => {
    const body = {
      schoolId: 1,
      termId: 2,
      gradeLevelId: 3,
      classroomIds: [4],
      code: 'M21/01',
      nameTh: 'คณิตศาสตร์',
    };
    await expect(
      pipe.transform(body, { type: 'body', metatype: SaveGradeSchoolSubjectDto }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(body, { type: 'body', metatype: UpdateGradeSchoolSubjectDto }),
    ).resolves.toMatchObject({ code: 'M21/01' });
  });
});
