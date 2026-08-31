import { ReleaseAppendOnlyActorReferences20260831110000 } from './migrations/20260831110000-ReleaseAppendOnlyActorReferences';

describe('ReleaseAppendOnlyActorReferences20260831110000', () => {
  async function run(direction: 'up' | 'down'): Promise<string> {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve([]);
      }),
    };
    const migration = new ReleaseAppendOnlyActorReferences20260831110000();
    await migration[direction](runner as never);
    return queries.join('\n');
  }

  it('lets each append-only log release a deleted actor and nothing else', async () => {
    const upSql = await run('up');

    for (const guard of [
      'audit_log_block_mutation',
      'pii_export_events_block_mutation',
      'prevent_data_export_job_event_mutation',
    ]) {
      expect(upSql).toContain(`CREATE OR REPLACE FUNCTION ${guard}()`);
    }
    // Only a referential action qualifies: nested, every other column
    // untouched, and the actor released rather than reassigned.
    expect(upSql.match(/pg_trigger_depth\(\) > 1/g)).toHaveLength(3);
    expect(
      upSql.match(/\(to_jsonb\(NEW\) - 'actor_user_id'\) = \(to_jsonb\(OLD\) - 'actor_user_id'\)/g),
    ).toHaveLength(3);
    expect(upSql.match(/NEW\.actor_user_id IS NULL/g)).toHaveLength(3);
    expect(upSql.match(/OLD\.actor_user_id IS NOT NULL/g)).toHaveLength(3);
    // The evidence itself still cannot be rewritten or removed.
    expect(upSql).toContain("RAISE EXCEPTION 'audit_log is append-only; % is not allowed', TG_OP");
    expect(upSql).toContain("RAISE EXCEPTION 'data_export_job_event is immutable'");
    expect(upSql).not.toContain('DROP TRIGGER');
  });

  it('restores the blanket guards on the way back down', async () => {
    const downSql = await run('down');

    expect(downSql).not.toContain('pg_trigger_depth()');
    expect(downSql).toContain(
      "RAISE EXCEPTION 'audit_log is append-only; % is not allowed', TG_OP",
    );
    expect(downSql).toContain(
      "RAISE EXCEPTION 'pii_export_events is append-only; % is not allowed', TG_OP",
    );
    expect(downSql).toContain("RAISE EXCEPTION 'data_export_job_event is immutable'");
  });
});
