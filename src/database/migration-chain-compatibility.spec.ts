import { MIGRATION_BASELINE_202603_SQL } from './migration-baseline-202603';

describe('migration chain compatibility', () => {
  it('creates the legacy task-link parent column before UUID standardization', () => {
    const taskLinksTable = MIGRATION_BASELINE_202603_SQL.match(
      /CREATE TABLE IF NOT EXISTS task_links \(([\s\S]*?)\n {2}\);/,
    )?.[1];

    expect(taskLinksTable).toContain('parent_link_id TEXT REFERENCES task_links(id)');
  });
});
