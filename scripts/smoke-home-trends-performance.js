require('dotenv').config({ quiet: true });
const { DataSource } = require('typeorm');
const { getDatabaseConfigFromEnv } = require('../dist/config/database.config');
const { AttendanceTrendCache } = require('../dist/home-dashboard/attendance-trend-cache.service');
const { HomeDashboardRepository } = require('../dist/home-dashboard/home-dashboard.repository');

if (process.env.NODE_ENV === 'production' || !(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Performance smoke requires a non-production *_smoke database');
}
function assert(value, message) { if (!value) throw new Error(message); }
async function main() {
  const dataSource = new DataSource({ ...getDatabaseConfigFromEnv(), type: 'postgres', entities: [],
    synchronize: false, migrationsRun: false, logging: false });
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SET LOCAL statement_timeout = '120s'`);
    // Temp relations shadow only this connection's views. Public student,
    // attendance and permission data are never changed; rollback removes all.
    const [{ definition }] = await runner.query(
      `SELECT pg_get_viewdef('public.attendance_day'::regclass, true) AS definition`);
    const expanded = process.argv.includes('--expanded');
    if (expanded) {
      const [{ effective_definition }] = await runner.query(
        `SELECT pg_get_viewdef('public.attendance_effective_records'::regclass, true) AS effective_definition`);
      await runner.query(`CREATE TEMP TABLE attendance_sessions ON COMMIT DROP AS
        SELECT * FROM public.attendance_sessions WITH NO DATA`);
      await runner.query(`INSERT INTO attendance_sessions SELECT (jsonb_populate_record(NULL::attendance_sessions,
        to_jsonb(template) || jsonb_build_object('id', md5(day::text || ':' || slot.period)::uuid,
          'attendance_date', day::date, 'period', slot.period, 'status', 'SUBMITTED',
          'record_storage_mode', 'EXCEPTIONS', 'session_kind', 'SUBJECT', 'deleted_at', NULL))).*
        FROM (SELECT session.* FROM public.attendance_sessions session
          JOIN classroom_subjects offering ON offering.id = session.classroom_subject_id LIMIT 1) template
        CROSS JOIN generate_series(CURRENT_DATE - 29, CURRENT_DATE, interval '1 day') day
        CROSS JOIN generate_series(1, 6) slot(period)`);
      assert((await runner.query(`SELECT COUNT(*)::int AS count FROM attendance_sessions`))[0].count === 180,
        'expanded smoke needs one session with a valid subject offering');
      await runner.query(`CREATE TEMP TABLE attendance_session_roster ON COMMIT DROP AS
        SELECT * FROM public.attendance_session_roster WITH NO DATA`);
      await runner.query(`INSERT INTO attendance_session_roster (session_id, student_uuid, school_id)
        SELECT session.id, student.student_uuid, session.school_id FROM attendance_sessions session
        CROSS JOIN (SELECT student_uuid FROM public.student_term
          WHERE student_uuid IS NOT NULL AND deleted_at IS NULL ORDER BY student_uuid LIMIT 6000) student`);
      await runner.query(`CREATE TEMP TABLE attendance_exceptions ON COMMIT DROP AS
        SELECT * FROM public.attendance_exceptions WITH NO DATA`);
      await runner.query(`INSERT INTO attendance_exceptions (session_id, student_uuid, attendance_status_code)
        SELECT roster.session_id, roster.student_uuid,
          CASE MOD(student.ordinal, 4) WHEN 0 THEN 2
            WHEN 1 THEN CASE WHEN session.period = 1 THEN 3 ELSE 1 END
            WHEN 2 THEN 4 ELSE CASE WHEN session.period = 1 THEN 2 ELSE 1 END END::smallint
        FROM attendance_session_roster roster JOIN attendance_sessions session ON session.id = roster.session_id
        JOIN (SELECT student_uuid, ROW_NUMBER() OVER (ORDER BY student_uuid) AS ordinal
          FROM public.student_term WHERE student_uuid IS NOT NULL AND deleted_at IS NULL LIMIT 6000) student
          ON student.student_uuid = roster.student_uuid`);
      // Historic sessions make a national 30-day range selective, as production grows.
      await runner.query(`INSERT INTO attendance_sessions
        SELECT (jsonb_populate_record(NULL::attendance_sessions, to_jsonb(template) ||
          jsonb_build_object('id', md5('history:' || ordinal)::uuid,
            'attendance_date', CURRENT_DATE - 365 - ordinal))).*
        FROM (SELECT * FROM attendance_sessions LIMIT 1) template CROSS JOIN generate_series(1, 20000) ordinal`);
      await runner.query(`CREATE UNIQUE INDEX ON attendance_sessions (id)`);
      await runner.query(`CREATE UNIQUE INDEX ON attendance_session_roster (session_id, student_uuid)`);
      await runner.query(`CREATE INDEX ON attendance_session_roster (student_uuid, session_id)`);
      await runner.query(`CREATE UNIQUE INDEX ON attendance_exceptions (session_id, student_uuid)`);
      await runner.query(`CREATE INDEX idx_smoke_subject_trend_date ON attendance_sessions (attendance_date)
        WHERE deleted_at IS NULL AND record_storage_mode = 'EXCEPTIONS' AND session_kind = 'SUBJECT'
          AND status IN ('SUBMITTED', 'REOPENED')`);
      await runner.query(`ANALYZE attendance_sessions`);
      await runner.query(`ANALYZE attendance_session_roster`);
      await runner.query(`ANALYZE attendance_exceptions`);
      const indexPlan = await runner.query(`EXPLAIN (FORMAT JSON) SELECT id FROM attendance_sessions
        WHERE attendance_date BETWEEN CURRENT_DATE - 29 AND CURRENT_DATE
          AND deleted_at IS NULL AND record_storage_mode = 'EXCEPTIONS' AND session_kind = 'SUBJECT'
          AND status IN ('SUBMITTED', 'REOPENED')`);
      assert(JSON.stringify(indexPlan).includes('idx_smoke_subject_trend_date'), 'date range did not use the partial index');
      console.log('expanded session date range uses partial index with 20,000 historical sessions');
      await runner.query(`CREATE TEMP VIEW attendance_effective_records AS ${effective_definition}`);
    } else {
      await runner.query(`CREATE TEMP TABLE attendance_effective_records ON COMMIT DROP AS
        SELECT * FROM public.attendance_effective_records WITH NO DATA`);
      await runner.query(`INSERT INTO attendance_effective_records (
          "AttendanceID", student_uuid, "AttendanceDate", "AcademicYear_Onec", "Semester_Onec",
          "Period", session_kind, "AttendanceStatus", "RecordedBy", "RecordedAt"
        )
        SELECT ROW_NUMBER() OVER (), student.student_uuid, day::date, 2569, 1,
          period, 'SUBJECT',
          CASE MOD(student.ordinal, 4)
            WHEN 0 THEN 2 WHEN 1 THEN CASE WHEN period = 1 THEN 3 ELSE 1 END
            WHEN 2 THEN 4 ELSE CASE WHEN period = 1 THEN 2 ELSE 1 END
          END::smallint, 'AUTOMATED_TEST', day::timestamptz
        FROM (SELECT student_uuid, ROW_NUMBER() OVER (ORDER BY student_uuid) AS ordinal
          FROM public.student_term WHERE student_uuid IS NOT NULL AND deleted_at IS NULL LIMIT 6000) student
        CROSS JOIN generate_series(CURRENT_DATE - 29, CURRENT_DATE, interval '1 day') day
        CROSS JOIN generate_series(1, 6) period`);
      await runner.query(`CREATE INDEX ON attendance_effective_records (student_uuid, "AttendanceDate")`);
      await runner.query(`ANALYZE attendance_effective_records`);
    }
    await runner.query(`CREATE TEMP VIEW attendance_day AS ${definition}`);
    const [{ records }] = await runner.query(`SELECT COUNT(*)::int AS records FROM attendance_effective_records`);
    const [{ school_id }] = await runner.query(`SELECT "SchoolID_Onec" AS school_id FROM student_term
      WHERE student_uuid IS NOT NULL AND deleted_at IS NULL ORDER BY student_uuid LIMIT 1`);
    const [{ starts_on, ends_on }] = await runner.query(
      `SELECT (CURRENT_DATE - 29)::text AS starts_on, CURRENT_DATE::text AS ends_on`);
    // Fixture creation has a separate budget; measured reads retain a 20s guard.
    await runner.query(`SET LOCAL statement_timeout = '20s'`);
    let captured;
    let queryCount = 0;
    const repository = new HomeDashboardRepository({ createQueryRunner: () => ({
      connect: async () => undefined, release: async () => undefined,
      query: async (sql, params, structured) => {
        captured = { sql, params };
        queryCount++;
        return runner.query(sql, params, structured);
      },
    }) }, new AttendanceTrendCache());
    const actor = (data_scope) => ({ id: 0, roles: ['DIRECTOR'], permissions: ['home'], data_scope });
    const [classroom] = await runner.query(`SELECT s."SchoolID_Onec" AS school_id,
      s."GradeLevelID_Onec" AS grade_id, gl.label AS grade, s."RoomID_Onec"::text AS room
      FROM student_term s JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
      JOIN student_current_enrollment_resolution current_enrollment ON current_enrollment.person_uuid = s.person_uuid
        AND current_enrollment.selected_student_uuid = s.student_uuid AND current_enrollment.resolution_state = 'ACTIVE'
      WHERE s."RoomID_Onec" IS NOT NULL ORDER BY s.student_uuid LIMIT 1`);
    assert(classroom, 'need current grade/room fixture');
    const scenarios = [
      ['national', actor({ global: true }), { period: '30_DAYS' }],
      ['school', actor({ school_ids: [Number(school_id)] }), { period: '30_DAYS', schoolId: Number(school_id) }],
      ['grade-room', actor({ school_ids: [Number(classroom.school_id)], grade_levels: [Number(classroom.grade_id)],
        room_ids: [classroom.room] }), { period: '30_DAYS', schoolId: Number(classroom.school_id), grade: classroom.grade, room: classroom.room }],
      ['outside-room', actor({ school_ids: [Number(classroom.school_id)], room_ids: [classroom.room] }),
        { period: '30_DAYS', schoolId: Number(classroom.school_id), grade: classroom.grade, room: '__OUTSIDE_SCOPE__' }],
      ['outside-scope', actor({ school_ids: [Number(school_id) + 999999] }), { period: '30_DAYS', schoolId: Number(school_id) }],
      ['own-only', actor({ own_only: true }), { period: '30_DAYS' }],
    ];
    for (const [name, user, filters] of scenarios) {
      const optimized = await repository.getAttendanceTrend(user, filters, starts_on, ends_on);
      const { sql, params } = captured;
      const beforeWarm = queryCount;
      const warmStarted = performance.now();
      const warm = await repository.getAttendanceTrend(user, filters, starts_on, ends_on);
      const warmMs = performance.now() - warmStarted;
      assert(queryCount === beforeWarm && warm === optimized, `${name}: warm cache queried the database`);
      const cohort = sql.match(/scoped_students AS NOT MATERIALIZED \(([\s\S]*?)\), attendance_by_day AS MATERIALIZED/)[1];
      let joins = cohort.slice(cohort.indexOf('FROM student_term s')).replace(
        'FROM student_term s', `JOIN student_term s ON s.student_uuid = a.student_uuid
        JOIN student_current_enrollment_resolution current_enrollment ON current_enrollment.person_uuid = s.person_uuid
          AND current_enrollment.selected_student_uuid = s.student_uuid AND current_enrollment.resolution_state = 'ACTIVE'`);
      const range = 'a."AttendanceDate" BETWEEN $1::date AND $2::date';
      joins = joins.includes('WHERE ') ? joins.replace('WHERE ', `WHERE ${range} AND `) : `${joins} WHERE ${range}`;
      // The canonical daily view is the reference, including leave and mixed periods.
      const referenceSql = `SELECT a."AttendanceDate"::text AS key,
        COUNT(*) FILTER (WHERE a."AttendanceStatus" = 1)::int AS present,
        COUNT(*) FILTER (WHERE a."AttendanceStatus" = 2)::int AS absent,
        COUNT(*) FILTER (WHERE a."AttendanceStatus" = 3)::int AS late, COUNT(*)::int AS total
        FROM attendance_day a ${joins} GROUP BY a."AttendanceDate" ORDER BY a."AttendanceDate"`;
      const canonical = await runner.query(referenceSql, params);
      assert(JSON.stringify(optimized.map(({ key, present, absent, late, total }) =>
        ({ key, present, absent, late, total }))) === JSON.stringify(canonical), `${name}: canonical counts changed`);
      if (name === 'national' || name === 'school' || name === 'grade-room') {
        assert(optimized.length === 30 && optimized.every(row => row.total > 0), `${name}: missing attendance`);
        if (name !== 'grade-room') assert(optimized.some(row => row.present > 0 && row.absent > 0 && row.late > 0), `${name}: statuses missing`);
      } else assert(optimized.length === 0, `${name}: attendance leaked`);
      const explain = async (statement) => (await runner.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`, params))[0]['QUERY PLAN'][0];
      const before = await explain(referenceSql);
      const after = await explain(sql);
      require('node:fs').writeFileSync(`/tmp/sts-home-trends-${name}-plan.json`, JSON.stringify({ before, after }, null, 2));
      const loops = [];
      const visit = node => {
        if (node['Node Type'] === 'Aggregate') loops.push(node['Actual Loops']);
        (node.Plans || []).forEach(visit);
      };
      visit(after.Plan);
      if (name === 'national' && !expanded) {
        const repeatedMarkScans = node => (node['Relation Name'] === 'attendance_effective_records' &&
          node['Actual Loops'] > 1) || (node.Plans || []).some(repeatedMarkScans);
        assert(!repeatedMarkScans(after.Plan), 'national: attendance scanned per student');
      }
      assert(loops.every(count => count <= 1), `${name}: repeated attendance aggregation`);
      if (name === 'national') assert(after['Execution Time'] <= before['Execution Time'] * 1.5 + 100,
        'national: regression beyond materialization overhead budget');
      assert(after['Execution Time'] < 10_000, `${name}: exceeds local 10s smoke budget`);
      console.log(JSON.stringify({ expanded, name, records, days: optimized.length, warmMs,
        beforeMs: before['Execution Time'], afterMs: after['Execution Time'], aggregateLoops: loops }));
    }
    console.log('home trends parity/performance smoke passed; temp fixtures rolled back');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
