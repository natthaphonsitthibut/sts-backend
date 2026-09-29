import type { SqlQueryExecutor } from '../database/sql-query';
import { HOMEROOM_SUBJECT_CODE } from './homeroom-subject.constants';

/**
 * Keeps each classroom's โฮมรูม teachers in step with its homeroom teachers.
 *
 * A homeroom teacher teaches โฮมรูม, and teaching something this term is what
 * puts a teacher on the teacher-link page and the room in "ห้องเรียนของฉัน".
 * Every path that adds or removes a homeroom teacher (up to two per room) has
 * to call this in the same transaction, after its write.
 *
 * Only the teachers named in `formerMembershipIds` are taken off โฮมรูม, and
 * only where they are no longer homeroom: someone the school put on โฮมรูม by
 * hand from the curriculum screen stays.
 */
export async function syncHomeroomSubjectTeachers(
  executor: SqlQueryExecutor,
  input: {
    classroomIds: number[];
    formerMembershipIds: number[];
    actorId: number | null;
  },
): Promise<void> {
  if (input.classroomIds.length === 0) return;
  if (input.formerMembershipIds.length > 0) {
    await executor.query(
      `
        UPDATE classroom_subject_teachers subject_teacher
        SET assignment_status = 'INACTIVE', updated_by = $4
        FROM classroom_subjects offering
        JOIN school_subjects school_subject ON school_subject.id = offering.school_subject_id
        JOIN subjects subject
          ON subject.id = school_subject.subject_id
         AND subject.code = $3
        WHERE offering.id = subject_teacher.classroom_subject_id
          AND subject_teacher.classroom_id = ANY($1::bigint[])
          AND subject_teacher.teacher_membership_id = ANY($2::bigint[])
          AND subject_teacher.assignment_status = 'ACTIVE'
          AND subject_teacher.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM classroom_homeroom_teacher_assignments homeroom
            WHERE homeroom.classroom_id = subject_teacher.classroom_id
              AND homeroom.teacher_membership_id = subject_teacher.teacher_membership_id
          )
      `,
      [input.classroomIds, input.formerMembershipIds, HOMEROOM_SUBJECT_CODE, input.actorId],
    );
  }
  await executor.query(
    `
      INSERT INTO classroom_subject_teachers (
        school_id, classroom_id, classroom_subject_id, teacher_membership_id,
        assignment_status, created_by, updated_by
      )
      SELECT offering.school_id, offering.classroom_id, offering.id,
             homeroom.teacher_membership_id, 'ACTIVE', $3::integer, $3::integer
      FROM classroom_homeroom_teacher_assignments homeroom
      JOIN classroom_subjects offering
        ON offering.classroom_id = homeroom.classroom_id
       AND offering.school_id = homeroom.school_id
       AND offering.deleted_at IS NULL
      JOIN school_subjects school_subject ON school_subject.id = offering.school_subject_id
      JOIN subjects subject
        ON subject.id = school_subject.subject_id
       AND subject.code = $2
      WHERE homeroom.classroom_id = ANY($1::bigint[])
      ON CONFLICT (classroom_subject_id, teacher_membership_id) WHERE deleted_at IS NULL
      DO UPDATE SET assignment_status = 'ACTIVE', updated_by = EXCLUDED.updated_by
      WHERE classroom_subject_teachers.assignment_status <> 'ACTIVE'
    `,
    [input.classroomIds, HOMEROOM_SUBJECT_CODE, input.actorId],
  );
}
