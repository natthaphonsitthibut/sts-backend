require('dotenv/config');

const { DataSource } = require('typeorm');
const { getDatabaseConfigFromEnv } = require('../dist/config/database.config');
const { createTypeOrmOptions } = require('../dist/database/typeorm.config');
const {
  CreateStudentExitEvents20260714200000,
} = require('../dist/database/migrations/20260714200000-CreateStudentExitEvents');
const {
  RetireLegacyDropoutSchema20260714210000,
} = require('../dist/database/migrations/20260714210000-RetireLegacyDropoutSchema');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run dropout retirement smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

const SOURCE_SYSTEM = 'ONEC_LEGACY_DROPOUT';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectMigrationFailure(queryRunner, label, mutateSource) {
  const savepoint = `fixture_${label}`;
  await queryRunner.query(`SAVEPOINT ${savepoint}`);
  try {
    await mutateSource();
    await new CreateStudentExitEvents20260714200000().up(queryRunner);
    throw new Error(`${label}: migration unexpectedly succeeded`);
  } catch (error) {
    assert(
      String(error.message).includes('student_dropouts preflight failed'),
      `${label}: unexpected error: ${error.message}`,
    );
  } finally {
    await queryRunner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await queryRunner.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

async function main() {
  const dataSource = new DataSource(createTypeOrmOptions(getDatabaseConfigFromEnv()));
  await dataSource.initialize();
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  const [before] = await queryRunner.query(`
    SELECT
      to_regclass('public.student_dropouts') IS NULL AS legacy_removed,
      count(*)::int AS event_count
    FROM student_exit_events
    WHERE source_system = '${SOURCE_SYSTEM}'
  `);
  assert(before.legacy_removed, 'Expected the legacy table to be retired before smoke');
  assert(before.event_count > 0, 'Expected canonical student exit events before smoke');

  await queryRunner.startTransaction();
  try {
    const expand = new CreateStudentExitEvents20260714200000();
    const contract = new RetireLegacyDropoutSchema20260714210000();

    await contract.down(queryRunner);
    await expand.down(queryRunner);

    await expectMigrationFailure(queryRunner, 'missing_person', async () => {
      await queryRunner.query(`
        UPDATE student_dropouts
        SET person_uuid = NULL
        WHERE "PersonID_Onec" = (SELECT min("PersonID_Onec") FROM student_dropouts)
      `);
    });

    await expectMigrationFailure(queryRunner, 'missing_school', async () => {
      await queryRunner.query(`
        UPDATE student_dropouts
        SET "SchoolID_Onec" = NULL
        WHERE "PersonID_Onec" = (SELECT min("PersonID_Onec") FROM student_dropouts)
      `);
    });

    await expectMigrationFailure(queryRunner, 'duplicate_person', async () => {
      await queryRunner.query(`
        WITH ordered AS (
          SELECT "PersonID_Onec", person_uuid, row_number() OVER (ORDER BY "PersonID_Onec") AS row_number
          FROM student_dropouts
        )
        UPDATE student_dropouts target
        SET person_uuid = source.person_uuid
        FROM ordered target_row, ordered source
        WHERE target."PersonID_Onec" = target_row."PersonID_Onec"
          AND target_row.row_number = 2
          AND source.row_number = 1
      `);
    });

    await expand.up(queryRunner);
    await contract.up(queryRunner);

    const [inside] = await queryRunner.query(`
      SELECT
        to_regclass('public.student_dropouts') IS NULL AS legacy_removed,
        count(*)::int AS event_count,
        count(*) FILTER (WHERE person_uuid IS NULL OR school_id IS NULL)::int AS unmapped
      FROM student_exit_events
      WHERE source_system = '${SOURCE_SYSTEM}'
    `);
    assert(inside.legacy_removed, 'Matched fixture did not retire the legacy table');
    assert(inside.event_count === before.event_count, 'Matched fixture changed the source row count');
    assert(inside.unmapped === 0, 'Matched fixture left unexplained rows');
  } finally {
    await queryRunner.rollbackTransaction();
  }

  const [after] = await queryRunner.query(`
    SELECT
      to_regclass('public.student_dropouts') IS NULL AS legacy_removed,
      count(*)::int AS event_count
    FROM student_exit_events
    WHERE source_system = '${SOURCE_SYSTEM}'
  `);
  assert(after.legacy_removed, 'Transaction rollback restored the legacy table unexpectedly');
  assert(after.event_count === before.event_count, 'Transaction rollback changed canonical events');

  await queryRunner.release();
  await dataSource.destroy();
  console.log(
    `dropout retirement smoke passed: events=${after.event_count}, fixtures=matched/missing-person/missing-school/duplicate-person, rollback=clean`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
