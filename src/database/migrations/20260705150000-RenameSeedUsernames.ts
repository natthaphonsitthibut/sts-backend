import type { MigrationInterface, QueryRunner } from 'typeorm';

// Owner-approved 2026-07-05: replace the fixture-looking `seed_*` login
// usernames with realistic firstname.lastinitial handles (romanised from each
// account's real Thai name in the DB). `newnew` is intentionally left untouched.
// The demo student follows the app's own generated `<schoolId>-<code>` scheme.
// Only the username changes — password, role, scope and permissions are intact,
// so every account keeps working with its existing password under the new name.
const RENAMES: Array<{ from: string; to: string }> = [
  { from: 'seed_admin', to: 'orathai.b' },
  { from: 'seed_admin_province_cm', to: 'maneerat.d' },
  { from: 'seed_admin_district_cm', to: 'kittichai.d' },
  { from: 'seed_admin_subdistrict_suthep', to: 'phatcharin.d' },
  { from: 'seed_admin_school_10010002', to: 'worapon.d' },
  { from: 'seed_director_10010002', to: 'preeya.p' },
  { from: 'seed_executive', to: 'thanakorn.p' },
  { from: 'seed_teacher_cm_p3_1', to: 'suphawadi.w' },
  { from: 'seed_teacher_cm_p6_2', to: 'chanwit.j' },
  { from: 'seed_teacher_ud_p6_1', to: 'narongsak.k' },
  { from: 'seed_student_cm_p3_1', to: '10010002-P7XKD' },
];

export class RenameSeedUsernames20260705150000 implements MigrationInterface {
  name = 'RenameSeedUsernames20260705150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { from, to } of RENAMES) {
      await queryRunner.query(`UPDATE users SET username = $1 WHERE username = $2`, [to, from]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { from, to } of RENAMES) {
      await queryRunner.query(`UPDATE users SET username = $1 WHERE username = $2`, [from, to]);
    }
  }
}
