import { MigrationInterface, QueryRunner } from 'typeorm';

const SYSTEM_SETTINGS = [
  {
    key: 'SUBJECT_RISK_MIXED_ABSENCE_WINDOW_DAYS',
    value: '7',
    description: 'ช่วงวันย้อนหลังสำหรับตรวจโดดคาบแบบมาเรียนบางคาบและขาดบางคาบในวันเดียวกัน',
  },
  {
    key: 'SUBJECT_RISK_MIXED_ABSENCE_DAYS',
    value: '3',
    description: 'จำนวนวันที่พบการมาเรียนบางคาบแต่ขาดบางคาบในช่วงที่กำหนด ก่อนเปิดเคสระดับปานกลาง',
  },
  {
    key: 'SUBJECT_RISK_AVOIDANCE_WINDOW_DAYS',
    value: '30',
    description: 'ช่วงวันย้อนหลังสำหรับตรวจรูปแบบเลี่ยงวิชาเดิม',
  },
  {
    key: 'SUBJECT_RISK_AVOIDANCE_CONSECUTIVE_PERIODS',
    value: '3',
    description: 'จำนวนคาบติดกันของวิชาเดียวกันที่ขาด ก่อนเปิดเคสระดับปานกลาง',
  },
  {
    key: 'SUBJECT_RISK_AVOIDANCE_ABSENT_PERCENT',
    value: '30',
    description: 'เปอร์เซ็นต์คาบที่ขาดในวิชาเดียวกันภายในช่วงที่กำหนด ก่อนเปิดเคสระดับปานกลาง',
  },
  {
    key: 'SUBJECT_RISK_LATE_WINDOW_DAYS',
    value: '30',
    description: 'ช่วงวันย้อนหลังสำหรับตรวจการมาสายจากเช็คชื่อรายวิชา',
  },
  {
    key: 'SUBJECT_RISK_LATE_WATCH_COUNT',
    value: '5',
    description: 'จำนวนครั้งที่มาสายในช่วงที่กำหนด ก่อนแจ้งเตือนเฝ้าระวังโดยไม่เปิดเคส',
  },
  {
    key: 'CASE_RISK_TERM_ABSENCE_DAYS',
    value: '7',
    description: 'จำนวนวันขาดสะสมต่อเทอมที่เปิดเคสระดับปานกลาง',
  },
  {
    key: 'CASE_RISK_HIGH_ATTENDANCE_PERCENT',
    value: '80',
    description: 'เปอร์เซ็นต์เวลาเรียนต่ำกว่าเกณฑ์นี้ให้เปิดเคสระดับสูง',
  },
];

const NOTIFICATION_TYPE = {
  code: 'STUDENT_RISK_WATCH',
  label: 'นักเรียนเข้าเกณฑ์เฝ้าระวัง',
  permission: 'review-cases',
  sortOrder: 160,
};

export class AddSubjectRiskMonitorSettings20260708110000 implements MigrationInterface {
  name = 'AddSubjectRiskMonitorSettings20260708110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        INSERT INTO system_settings (setting_key, setting_value, description)
        VALUES ${SYSTEM_SETTINGS.map((_, index) => {
          const base = index * 3;
          return `($${base + 1}, $${base + 2}, $${base + 3})`;
        }).join(', ')}
        ON CONFLICT (setting_key) DO NOTHING
      `,
      SYSTEM_SETTINGS.flatMap((setting) => [setting.key, setting.value, setting.description]),
    );

    await queryRunner.query(
      `
        INSERT INTO notification_types (code, label_th, required_permission, sort_order)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (code) DO NOTHING
      `,
      [
        NOTIFICATION_TYPE.code,
        NOTIFICATION_TYPE.label,
        NOTIFICATION_TYPE.permission,
        NOTIFICATION_TYPE.sortOrder,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM notification_types WHERE code = $1`, [
      NOTIFICATION_TYPE.code,
    ]);
    await queryRunner.query(`DELETE FROM system_settings WHERE setting_key = ANY($1::text[])`, [
      SYSTEM_SETTINGS.map((setting) => setting.key),
    ]);
  }
}
