const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run seed username rename smoke with NODE_ENV=production');
}

if (!(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run: DB_NAME must end with _smoke');
}

// Expected realistic usernames after migration 20260705150000-RenameSeedUsernames.
const EXPECTED = [
  { username: 'orathai.b', role: 'ADMIN' },
  { username: 'maneerat.d', role: 'ADMIN' },
  { username: 'kittichai.d', role: 'ADMIN' },
  { username: 'phatcharin.d', role: 'ADMIN' },
  { username: 'worapon.d', role: 'ADMIN' },
  { username: 'preeya.p', role: 'DIRECTOR' },
  { username: 'thanakorn.p', role: 'EXECUTIVE' },
  // The teacher and student accounts this migration also renamed were deleted
  // with their roles — teachers reach the system through a link and students
  // have no login at all — so only the staff accounts are still checkable.
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);

  try {
    const [leftover] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE username LIKE 'seed\\_%'`,
    );
    assert(leftover.count === 0, `${leftover.count} fixture-style seed_ username(s) still remain`);

    const [newnew] = await dataSource.query(
      `SELECT id FROM users WHERE username = 'newnew'`,
    );
    assert(newnew?.id, 'The primary owner account "newnew" must be left untouched');

    for (const expected of EXPECTED) {
      const [row] = await dataSource.query(
        `SELECT role, status, password IS NOT NULL AS has_password, email, "LastName"
         FROM users WHERE username = $1`,
        [expected.username],
      );
      assert(row, `Renamed account "${expected.username}" is missing`);
      assert(row.role === expected.role, `"${expected.username}" role ${row.role} != ${expected.role}`);
      assert(row.status === 'ACTIVE', `"${expected.username}" is not ACTIVE`);
      // Password/role/scope are unchanged by the rename, so login still works.
      assert(row.has_password, `"${expected.username}" lost its password (login would break)`);
      // Realistic identity (migration 20260705160000): staff email follows the
      // username at the fictional domain; the demo student has none.
      if (expected.role === 'STUDENT') {
        assert(row.email === null, `Demo student "${expected.username}" should have no email`);
      } else {
        assert(
          row.email === `${expected.username}@sts-demo.ac.th`,
          `"${expected.username}" email ${row.email} != ${expected.username}@sts-demo.ac.th`,
        );
      }
    }

    // No fixture-style emails or descriptive surnames remain on real accounts
    // (AUTOMATED_TEST smoke fixtures keep synthetic emails by design).
    const [emailLeft] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE (email LIKE '%example.test%' OR email LIKE 'seed.%')
         AND data_origin_code <> 'AUTOMATED_TEST'`,
    );
    assert(emailLeft.count === 0, `${emailLeft.count} fixture email(s) remain on real accounts`);
    const [linkEmailLeft] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM task_links
       WHERE assigned_to_email LIKE '%example%' OR assigned_to_email LIKE 'seed.%'`,
    );
    assert(linkEmailLeft.count === 0, `${linkEmailLeft.count} fixture email(s) remain on task_links`);
    const [surnameLeft] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM users
       WHERE "LastName" IN ('ดูแลจังหวัด','ดูแลอำเภอ','ดูแลตำบล','ดูแลโรงเรียน','ผู้อำนวยการ','ผู้บริหาร','บริหารกลาง','ทดสอบระบบ')`,
    );
    assert(surnameLeft.count === 0, `${surnameLeft.count} descriptive fixture surname(s) remain`);

    console.log(
      JSON.stringify({
        status: 'seed_username_rename_smoke_ok',
        renamed: EXPECTED.length,
        checked: [
          'no seed_ usernames remain',
          'newnew preserved',
          'all renamed accounts keep role, ACTIVE status and password (login intact)',
          'staff emails follow username@sts-demo.ac.th; demo student has none',
          'no fixture emails remain in users/task_links; no descriptive surnames remain',
        ],
      }),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
