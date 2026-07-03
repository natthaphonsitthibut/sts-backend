const { randomUUID } = require('crypto');
const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run current-enrollment smoke with NODE_ENV=production');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  const dataSource = app.get(DataSource);
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  try {
    const schools = await runner.query(`SELECT id FROM schools ORDER BY id LIMIT 2`);
    assert(schools.length === 2, 'Current-enrollment smoke requires at least two schools');
    const [schoolA, schoolB] = schools.map((row) => Number(row.id));
    const people = {
      active: randomUUID(),
      ambiguous: randomUUID(),
      inactive: randomUUID(),
      unresolved: randomUUID(),
    };

    await runner.query(
      `INSERT INTO student_person (person_uuid, identity_status)
       SELECT person_uuid, 'ACTIVE'
       FROM unnest($1::uuid[]) AS person_uuid`,
      [Object.values(people)],
    );

    const insertEnrollment = async ({
      personUuid,
      personId,
      year,
      semester,
      schoolId,
      statusCode,
      rawStatusCode = statusCode,
    }) => {
      await runner.query(
        `INSERT INTO student_term (
           "AcademicYear_Onec", "Semester_Onec", "SchoolID_Onec", "PersonID_Onec",
           person_uuid, "StudentStatusID_Onec", student_status_code
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [year, semester, schoolId, personId, personUuid, rawStatusCode, statusCode],
      );
    };

    await insertEnrollment({
      personUuid: people.active,
      personId: '9800000000001',
      year: 2569,
      semester: 1,
      schoolId: schoolA,
      statusCode: 10,
    });
    await insertEnrollment({
      personUuid: people.ambiguous,
      personId: '9800000000002',
      year: 2569,
      semester: 1,
      schoolId: schoolA,
      statusCode: 10,
    });
    await insertEnrollment({
      personUuid: people.ambiguous,
      personId: '9800000000002',
      year: 2569,
      semester: 1,
      schoolId: schoolB,
      statusCode: 10,
    });
    await insertEnrollment({
      personUuid: people.inactive,
      personId: '9800000000003',
      year: 2568,
      semester: 2,
      schoolId: schoolA,
      statusCode: 10,
    });
    await insertEnrollment({
      personUuid: people.inactive,
      personId: '9800000000003',
      year: 2569,
      semester: 1,
      schoolId: schoolA,
      statusCode: 20,
    });
    await insertEnrollment({
      personUuid: people.unresolved,
      personId: '9800000000004',
      year: 2569,
      semester: 1,
      schoolId: schoolA,
      statusCode: null,
      rawStatusCode: 999999,
    });

    const rows = await runner.query(
      `SELECT person_uuid::text, resolution_state, active_enrollment_count
       FROM student_current_enrollment_resolution
       WHERE person_uuid = ANY($1::uuid[])`,
      [Object.values(people)],
    );
    const states = new Map(rows.map((row) => [row.person_uuid, row.resolution_state]));
    assert(states.get(people.active) === 'ACTIVE', 'Expected one active enrollment to resolve');
    assert(
      states.get(people.ambiguous) === 'AMBIGUOUS_ACTIVE',
      'Expected two latest active enrollments to be ambiguous',
    );
    assert(
      states.get(people.inactive) === 'INACTIVE',
      'Expected newer terminal status to override older active enrollment',
    );
    assert(
      states.get(people.unresolved) === 'STATUS_UNRESOLVED',
      'Expected unknown latest status to fail closed',
    );

    console.log('current enrollment smoke passed');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await app.close();
  }
}

main().catch((error) => {
  if (error instanceof Error) {
    const code = typeof error.code === 'string' ? ` (${error.code})` : '';
    console.error(`${error.name}${code}: ${error.message || 'No error message provided'}`);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
