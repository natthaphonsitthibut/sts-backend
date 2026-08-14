import type { QueryRunner } from 'typeorm';
import { AddAraIdData20260811120000 } from './migrations/20260811120000-AddAraIdData';

describe('AddAraIdData20260811120000', () => {
  it('creates constrained identity and profile tables with explicit indexes', async () => {
    const statements: string[] = [];
    const query = jest.fn((sql: string) => {
      statements.push(sql);
      return Promise.resolve(undefined);
    });
    const migration = new AddAraIdData20260811120000();

    await migration.up({ query } as unknown as QueryRunner);

    const sql = statements[0] ?? '';
    expect(sql).toContain('CREATE TABLE araid_identity_records');
    expect(sql).toContain("CHECK (identity_number ~ '^[0-9]{13}$')");
    expect(sql).toContain("CHECK (record_status IN ('ACTIVE', 'INACTIVE'))");
    expect(sql).toContain('FOREIGN KEY (created_by_user_id) REFERENCES users(id)');
    expect(sql).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(sql).toContain('CREATE INDEX idx_araid_identity_records_status_updated');
    expect(sql).toContain('CREATE TABLE araid_profiles');
    expect(sql).toContain('FOREIGN KEY (identity_record_id) REFERENCES araid_identity_records(id)');
    expect(sql).toContain('ON DELETE CASCADE ON UPDATE CASCADE');
  });

  it('drops the dependent profile table before identity records', async () => {
    const statements: string[] = [];
    const query = jest.fn((sql: string) => {
      statements.push(sql);
      return Promise.resolve(undefined);
    });
    const migration = new AddAraIdData20260811120000();

    await migration.down({ query } as unknown as QueryRunner);

    expect(statements).toEqual(['DROP TABLE araid_profiles', 'DROP TABLE araid_identity_records']);
  });
});
