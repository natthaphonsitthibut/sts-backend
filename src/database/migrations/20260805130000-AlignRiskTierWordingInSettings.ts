import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Risk has three levels — เสี่ยง / เฝ้าระวัง / ปกติ — so "ความเสี่ยงสูง" is a
 * leftover from the retired five-level ladder: "สูง" only meant something while
 * เสี่ยงกลาง and เสี่ยงต่ำ existed to compare against.
 *
 * `20260804120000` seeded the old wording and has already run, so databases that
 * applied it keep the stale text. The settings catalog in code masks it in the
 * API response, which is exactly why it needs fixing here too: a description
 * that only looks right because something else overrides it is a trap for the
 * next person who reads the table.
 */
const SETTING_KEY = 'CASE_RISK_HIGH_ABSENCE_DAYS';
const CURRENT_DESCRIPTION =
  'จำนวนวันขาดเรียนสะสม (ไม่ต้องติดต่อกัน) ที่ทำให้นักเรียนเป็นความเสี่ยงและเปิดเคสอัตโนมัติ — นับเป็นวันขาดเมื่อไม่เข้าเรียนทุกคาบที่บันทึกในวันนั้น';
const PREVIOUS_DESCRIPTION =
  'จำนวนวันขาดเรียนสะสม (ไม่ต้องติดต่อกัน) ที่ทำให้นักเรียนเป็นความเสี่ยงสูงและเปิดเคสอัตโนมัติ — นับเป็นวันขาดเมื่อไม่เข้าเรียนทุกคาบที่บันทึกในวันนั้น';

export class AlignRiskTierWordingInSettings20260805130000 implements MigrationInterface {
  name = 'AlignRiskTierWordingInSettings20260805130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE system_settings SET description = $2 WHERE setting_key = $1`, [
      SETTING_KEY,
      CURRENT_DESCRIPTION,
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE system_settings SET description = $2 WHERE setting_key = $1`, [
      SETTING_KEY,
      PREVIOUS_DESCRIPTION,
    ]);
  }
}
