import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  AuthorizeClassroomExportDto,
  CreateSchoolClassroomDto,
  CreateClassroomStudentCommentDto,
  ListClassroomAttendanceHistoryDto,
  SetClassroomFavoriteDto,
  UpdateClassroomPresentationDto,
  UpdateSchoolClassroomDto,
} from './school-structure.dto';

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

  it('validates classroom favorite and presentation payloads', () => {
    expect(
      validateSync(plainToInstance(SetClassroomFavoriteDto, { isFavorite: true })),
    ).toHaveLength(0);
    expect(
      validateSync(plainToInstance(SetClassroomFavoriteDto, { isFavorite: 'true' })),
    ).not.toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(UpdateClassroomPresentationDto, {
          cardCoverColor: '#3ccf91',
          coverImagePositionX: '25',
          coverImagePositionY: '75',
          coverImageScale: '1.5',
          removeCover: 'false',
        }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(UpdateClassroomPresentationDto, {
          cardCoverColor: 'GREEN',
          coverImagePositionX: 101,
          coverImageScale: 0.5,
        }),
      ),
    ).not.toHaveLength(0);
  });

  it('trims classroom comments and rejects empty or oversized content', () => {
    const valid = plainToInstance(CreateClassroomStudentCommentDto, {
      problemCategory: 'ACADEMIC',
      concernLevelCode: 'NOTE',
      problemDescription: '  ติดตามการส่งงาน  ',
    });
    expect(validateSync(valid)).toHaveLength(0);
    expect(valid.problemDescription).toBe('ติดตามการส่งงาน');
    expect(
      validateSync(
        plainToInstance(CreateClassroomStudentCommentDto, {
          problemCategory: 'ACADEMIC',
          concernLevelCode: 'NOTE',
          problemDescription: '   ',
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(CreateClassroomStudentCommentDto, {
          problemCategory: 'ACADEMIC',
          concernLevelCode: 'NOTE',
          problemDescription: 'ก'.repeat(2001),
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(CreateClassroomStudentCommentDto, {
          problemCategory: 'UNKNOWN',
          concernLevelCode: 'NOTE',
          problemDescription: 'ติดตาม',
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(CreateClassroomStudentCommentDto, {
          problemCategory: 'ACADEMIC',
          concernLevelCode: 'URGENT',
          problemDescription: 'ติดตาม',
        }),
      ),
    ).not.toHaveLength(0);
    for (const forbiddenField of ['concernLevel', 'outcome', 'recommendation', 'caseAction']) {
      expect(
        validateSync(
          plainToInstance(CreateClassroomStudentCommentDto, {
            problemCategory: 'ACADEMIC',
            concernLevelCode: 'WATCH',
            problemDescription: 'ติดตาม',
            [forbiddenField]: 'SHOULD_NOT_EXIST',
          }),
          { forbidNonWhitelisted: true, whitelist: true },
        ),
      ).not.toHaveLength(0);
    }
  });

  it('validates classroom attendance history views and optional filters', () => {
    expect(
      validateSync(
        plainToInstance(ListClassroomAttendanceHistoryDto, {
          view: 'STUDENT',
          studentUuid: '00000000-0000-4000-8000-000000000001',
          dateFrom: '2026-07-01',
          dateTo: '2026-07-14',
          sortBy: 'recordedBy',
          sortDirection: 'asc',
        }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(ListClassroomAttendanceHistoryDto, {
          view: 'STUDENT',
          dateFrom: '01/07/2569',
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      validateSync(plainToInstance(ListClassroomAttendanceHistoryDto, { view: 'UNKNOWN' })),
    ).not.toHaveLength(0);
    expect(
      validateSync(
        plainToInstance(ListClassroomAttendanceHistoryDto, {
          view: 'DAILY',
          sortBy: 'unknown',
        }),
      ),
    ).not.toHaveLength(0);
  });

  it('accepts only calendar-date values for custom export ranges', () => {
    const build = (dateFrom: string, dateTo: string) =>
      plainToInstance(AuthorizeClassroomExportDto, {
        exportScope: 'ATTENDANCE',
        format: 'csv',
        columns: ['studentNumber'],
        dateFrom,
        dateTo,
      });

    expect(validateSync(build('2026-08-01', '2026-08-31'))).toHaveLength(0);
    expect(validateSync(build('2026-08-01T00:00:00Z', '2026-08-31T23:59:59Z'))).not.toHaveLength(0);
    expect(validateSync(build('2026-02-30', '2026-08-31'))).not.toHaveLength(0);
  });
});
