const dataSource = require('../dist/database/typeorm.datasource').default;

async function main() {
  await dataSource.initialize();
  try {
    await dataSource.transaction(async (manager) => {
      const [target] = await manager.query(`
        SELECT classroom.id AS classroom_id, classroom.school_id, slot.subject_id,
               slot.id AS timetable_slot_id
        FROM school_classrooms classroom
        JOIN timetable_slots slot
          ON slot.classroom_id = classroom.id
         AND slot.deleted_at IS NULL
        WHERE classroom.deleted_at IS NULL
        ORDER BY classroom.school_id, classroom.id, slot.day_of_week, slot.period
        LIMIT 1
      `);
      if (!target) throw new Error('No active classroom timetable slot is available for demo teachers');
      const teachers = await manager.query(`
        SELECT user_account.id
        FROM users user_account
        WHERE user_account.role = 'TEACHER' AND user_account.status = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM school_teacher_memberships membership
            WHERE membership.teacher_user_id = user_account.id
              AND membership.deleted_at IS NULL
          )
      `);
      for (const teacher of teachers) {
        const [membership] = await manager.query(
          `INSERT INTO school_teacher_memberships (school_id, teacher_user_id, membership_status)
           VALUES ($1, $2, 'ACTIVE') RETURNING id`,
          [target.school_id, teacher.id],
        );
        await manager.query(
          `INSERT INTO classroom_teacher_assignments
             (school_id, classroom_id, teacher_membership_id, subject_id, assignment_kind, assignment_status)
           VALUES ($1, $2, $3, $4, 'SUBJECT', 'ACTIVE')
           ON CONFLICT DO NOTHING`,
          [target.school_id, target.classroom_id, membership.id, target.subject_id],
        );
        await manager.query(
          `INSERT INTO timetable_slot_teachers (timetable_slot_id, teacher_membership_id)
           VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [target.timetable_slot_id, membership.id],
        );
      }
      console.log(`Seeded demo assignments for ${teachers.length} previously unassigned teachers.`);
    });
  } finally {
    await dataSource.destroy();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
