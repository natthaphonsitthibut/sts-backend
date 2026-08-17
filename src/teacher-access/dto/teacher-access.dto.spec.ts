import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateTeacherAccessStudentCommentDto } from './teacher-access.dto';

describe('CreateTeacherAccessStudentCommentDto', () => {
  const validInput = {
    assignmentId: 11,
    studentUuid: '00000000-0000-4000-8000-000000000001',
    problemCategory: 'ACADEMIC',
    problemDescription: '  เรียนไม่ทันบทเรียน  ',
  };

  it('accepts a supported category and trims the description', () => {
    const dto = plainToInstance(CreateTeacherAccessStudentCommentDto, validInput);

    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.problemDescription).toBe('เรียนไม่ทันบทเรียน');
  });

  it('rejects a missing or unsupported problem category', () => {
    expect(
      validateSync(
        plainToInstance(CreateTeacherAccessStudentCommentDto, {
          ...validInput,
          problemCategory: undefined,
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(CreateTeacherAccessStudentCommentDto, {
          ...validInput,
          problemCategory: 'UNKNOWN',
        }),
      ),
    ).not.toHaveLength(0);
  });
});
