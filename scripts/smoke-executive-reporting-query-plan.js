const { NestFactory } = require('@nestjs/core');
const { DataSource } = require('typeorm');
const { AppModule } = require('../dist/app.module');
const {
  ExecutiveReportingRepository,
} = require('../dist/executive-reporting/executive-reporting.repository');

if (process.env.NODE_ENV === 'production' || !(process.env.DB_NAME || '').endsWith('_smoke')) {
  throw new Error('Refusing to run executive reporting query plan outside a _smoke database');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function captureOverviewQuery() {
  let captured;
  const dataSource = {
    createQueryRunner: () => ({
      connect: async () => undefined,
      release: async () => undefined,
      query: async (sql, params) => {
        captured = { sql, params };
        return { records: [], affected: 0 };
      },
    }),
  };
  await new ExecutiveReportingRepository(dataSource).getOverview({
    scope: { global: true },
    groupBy: 'PROVINCE',
  });
  assert(captured?.sql, 'Could not capture canonical executive overview query');
  return captured;
}

async function main() {
  const query = await captureOverviewQuery();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const dataSource = app.get(DataSource);
    const [result] = await dataSource.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
      query.params,
    );
    const plan = result['QUERY PLAN'][0];
    const root = plan.Plan;
    console.log(
      JSON.stringify({
        planningTimeMs: plan['Planning Time'],
        executionTimeMs: plan['Execution Time'],
        actualRows: root['Actual Rows'],
        sharedHitBlocks: root['Shared Hit Blocks'],
        sharedReadBlocks: root['Shared Read Blocks'],
        planNode: root['Node Type'],
      }),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
