require('dotenv/config');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run demo teacher contact seed with NODE_ENV=production');
}

const appDataSource = require('../dist/database/typeorm.datasource').default;

const AUDIT_ONLY = process.argv.includes('--audit-only');

// Rows whose account name marks them as an automated-test fixture. They read as
// "Account Lifecycle Teacher" / "Role Updated Scope Smoke" on screen, which is
// exactly the robotic look this seed exists to remove.
const FIXTURE_ACCOUNT_PATTERN = 'smoke|_test|test_|lifecycle|automated|example\\.invalid';

/**
 * Deterministic PRNG seeded per teacher id, so re-running produces the same
 * contact details instead of churning the demo data on every run.
 */
function makeRandom(seed) {
  let state = seed * 2654435761 % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

/**
 * Thai national ID with a correct mod-11 check digit. Sequential placeholders
 * like 9900010000084 are visibly synthetic; a well-formed id is not.
 */
function generateCitizenId(random) {
  // Real personal ids start 1-8; 1/3/5 dominate the population.
  const digits = [pick(random, [1, 1, 3, 3, 5, 2, 4, 6, 7, 8])];
  for (let index = 1; index < 12; index += 1) {
    digits.push(Math.floor(random() * 10));
  }
  const sum = digits.reduce((total, digit, index) => total + digit * (13 - index), 0);
  digits.push((11 - (sum % 11)) % 10);
  return digits.join('');
}

function generatePhone(random) {
  const prefix = pick(random, ['06', '08', '08', '09', '09']);
  let rest = '';
  for (let index = 0; index < 8; index += 1) rest += Math.floor(random() * 10);
  return prefix + rest;
}

const LINE_NICKNAMES = [
  'best', 'ple', 'nan', 'mint', 'aum', 'bee', 'fern', 'gift',
  'ice', 'jane', 'kong', 'mook', 'nut', 'oat', 'pare', 'view',
];

/**
 * LINE ids modelled on how people actually pick them — the account name, an
 * initial, a nickname, or a couple of trailing digits. Built from the teacher's
 * own romanised username so it stays recognisably theirs.
 */
function generateLineId(random, username) {
  // ASCII only — the account name is already romanised, whereas the teacher's
  // Thai surname is not and would produce ids like "woramet_ม".
  const base = String(username || '')
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, '')
    .replace(/^[._]+|[._]+$/g, '')
    .slice(0, 20) || 'teacher';
  const [first, second = ''] = base.split('.');
  const digits = () => String(Math.floor(random() * 90) + 10);
  const shapes = [
    () => base,
    () => `${base}${digits()}`,
    () => base.replace(/\./g, '_'),
    () => `${pick(random, LINE_NICKNAMES)}.${first}`,
    () => `${first}_${second.slice(0, 1) || pick(random, LINE_NICKNAMES)}`,
    () => `${first}${digits()}`,
  ];
  // Trim separators the length cap may have left dangling ("kriengkrai_maneerat_").
  return pick(random, shapes)().slice(0, 32).replace(/[._]+$/, '');
}

async function main() {
  await appDataSource.initialize();
  const runner = appDataSource.createQueryRunner();
  await runner.connect();

  try {
    const fixtures = await runner.query(
      `
        SELECT t.id::text AS teacher_id, u.username
        FROM teachers t
        JOIN users u ON u.id = t.linked_user_id
        WHERE u.username ~* $1
           OR COALESCE(u."FirstName", '') ~* 'smoke|lifecycle|^test$'
      `,
      [FIXTURE_ACCOUNT_PATTERN],
    );

    const targets = await runner.query(
      `
        SELECT t.id::text AS teacher_id, u.username
        FROM teachers t
        LEFT JOIN users u ON u.id = t.linked_user_id
        WHERE t.deleted_at IS NULL
        ORDER BY t.id
      `,
    );

    const fixtureIds = new Set(fixtures.map((row) => row.teacher_id));
    const seedable = targets.filter((row) => !fixtureIds.has(row.teacher_id));

    console.log(`teachers total        : ${targets.length}`);
    console.log(`automated-test rows   : ${fixtureIds.size} (to remove)`);
    console.log(`rows to fill          : ${seedable.length}`);

    if (AUDIT_ONLY) {
      console.log('audit-only: no changes written');
      return;
    }

    await runner.startTransaction();

    // Drop the fixture teachers from the registry. Their `users` rows stay put —
    // smoke suites recreate and look them up by username, and audit history
    // still references them.
    if (fixtureIds.size > 0) {
      const ids = [...fixtureIds];
      await runner.query(
        `DELETE FROM classroom_teacher_assignments
         WHERE teacher_membership_id IN (
           SELECT id FROM school_teacher_memberships WHERE teacher_id = ANY($1::bigint[])
         )`,
        [ids],
      );
      await runner.query(
        `DELETE FROM school_teacher_memberships WHERE teacher_id = ANY($1::bigint[])`,
        [ids],
      );
      await runner.query(`DELETE FROM teachers WHERE id = ANY($1::bigint[])`, [ids]);
    }

    // citizen_id carries a partial unique index, so collisions are retried rather
    // than left to abort the whole batch.
    const usedCitizenIds = new Set(
      (
        await runner.query(
          `SELECT citizen_id FROM teachers WHERE citizen_id IS NOT NULL AND deleted_at IS NULL`,
        )
      ).map((row) => row.citizen_id),
    );

    let filled = 0;
    for (const row of seedable) {
      const random = makeRandom(Number(row.teacher_id) + 7919);

      let citizenId = generateCitizenId(random);
      let guard = 0;
      while (usedCitizenIds.has(citizenId) && guard < 50) {
        citizenId = generateCitizenId(random);
        guard += 1;
      }
      usedCitizenIds.add(citizenId);

      await runner.query(
        `UPDATE teachers
         SET citizen_id = $2, phone = $3, line_id = $4
         WHERE id = $1`,
        [
          row.teacher_id,
          citizenId,
          generatePhone(random),
          generateLineId(random, row.username),
        ],
      );
      filled += 1;
    }

    await runner.commitTransaction();
    console.log(`removed automated-test teachers: ${fixtureIds.size}`);
    console.log(`filled contact details for     : ${filled}`);
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
    await appDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
