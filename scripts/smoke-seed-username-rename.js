const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run seed username rename smoke with NODE_ENV=production');
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
  { username: 'suphawadi.w', role: 'TEACHER' },
  { username: 'chanwit.j', role: 'TEACHER' },
  { username: 'narongsak.k', role: 'TEACHER' },
  { username: '10010002-P7XKD', role: 'STUDENT' },
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
        `SELECT role, status, password IS NOT NULL AS has_password FROM users WHERE username = $1`,
        [expected.username],
      );
      assert(row, `Renamed account "${expected.username}" is missing`);
      assert(row.role === expected.role, `"${expected.username}" role ${row.role} != ${expected.role}`);
      assert(row.status === 'ACTIVE', `"${expected.username}" is not ACTIVE`);
      // Password/role/scope are unchanged by the rename, so login still works.
      assert(row.has_password, `"${expected.username}" lost its password (login would break)`);
    }

    console.log(
      JSON.stringify({
        status: 'seed_username_rename_smoke_ok',
        renamed: EXPECTED.length,
        checked: [
          'no seed_ usernames remain',
          'newnew preserved',
          'all renamed accounts keep role, ACTIVE status and password (login intact)',
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
