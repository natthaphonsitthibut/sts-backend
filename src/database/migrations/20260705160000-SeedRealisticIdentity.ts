import type { MigrationInterface, QueryRunner } from 'typeorm';

// Owner-approved 2026-07-05: finish seed realism on the demo accounts.
// 1) Emails: seed.*@example.test -> firstname.l@sts-demo.ac.th (single fictional
//    institutional domain matching the renamed usernames; email transport is
//    config-gated so nothing is ever delivered). The demo student gets NULL —
//    real generated student accounts carry no email.
// 2) Surnames: replace descriptive fixture surnames (ดูแลจังหวัด, ผู้อำนวยการ, …)
//    with realistic Thai surnames, keeping FirstName intact. ปรียา reuses
//    ศรีประเสริฐ already present on her task_links rows for consistency. The demo
//    student "นักเรียน ทดสอบระบบ" is fully renamed (both parts were placeholders).
// AUTOMATED_TEST smoke fixtures keep synthetic @example.invalid emails by design
// (they are recreated by the smoke suites and hidden from operational views).
const USER_UPDATES: Array<{
  username: string;
  email: string | null;
  firstName?: string;
  lastName?: string;
  prev: { email: string; firstName: string; lastName: string };
}> = [
  {
    username: 'orathai.b',
    email: 'orathai.b@sts-demo.ac.th',
    lastName: 'ศรีสุวรรณ',
    prev: { email: 'seed.admin@example.test', firstName: 'อรทัย', lastName: 'บริหารกลาง' },
  },
  {
    username: 'maneerat.d',
    email: 'maneerat.d@sts-demo.ac.th',
    lastName: 'จันทร์เพ็ญ',
    prev: {
      email: 'seed.admin.province@example.test',
      firstName: 'มณีรัตน์',
      lastName: 'ดูแลจังหวัด',
    },
  },
  {
    username: 'kittichai.d',
    email: 'kittichai.d@sts-demo.ac.th',
    lastName: 'พงษ์พานิช',
    prev: {
      email: 'seed.admin.district@example.test',
      firstName: 'กิตติชัย',
      lastName: 'ดูแลอำเภอ',
    },
  },
  {
    username: 'phatcharin.d',
    email: 'phatcharin.d@sts-demo.ac.th',
    lastName: 'ดวงแก้ว',
    prev: {
      email: 'seed.admin.subdistrict@example.test',
      firstName: 'พัชรินทร์',
      lastName: 'ดูแลตำบล',
    },
  },
  {
    username: 'worapon.d',
    email: 'worapon.d@sts-demo.ac.th',
    lastName: 'ธรรมโชติ',
    prev: { email: 'seed.admin.school@example.test', firstName: 'วรพล', lastName: 'ดูแลโรงเรียน' },
  },
  {
    username: 'preeya.p',
    email: 'preeya.p@sts-demo.ac.th',
    lastName: 'ศรีประเสริฐ',
    prev: { email: 'seed.director@example.test', firstName: 'ปรียา', lastName: 'ผู้อำนวยการ' },
  },
  {
    username: 'thanakorn.p',
    email: 'thanakorn.p@sts-demo.ac.th',
    lastName: 'พิพัฒน์กุล',
    prev: { email: 'seed.executive@example.test', firstName: 'ธนากร', lastName: 'ผู้บริหาร' },
  },
  {
    username: 'suphawadi.w',
    email: 'suphawadi.w@sts-demo.ac.th',
    prev: { email: 'seed.teacher.p3r1@example.test', firstName: 'สุภาวดี', lastName: 'วัฒนานุกูล' },
  },
  {
    username: 'chanwit.j',
    email: 'chanwit.j@sts-demo.ac.th',
    prev: { email: 'seed.teacher.p6r2@example.test', firstName: 'ชาญวิทย์', lastName: 'ใจมั่น' },
  },
  {
    username: 'narongsak.k',
    email: 'narongsak.k@sts-demo.ac.th',
    prev: {
      email: 'seed.teacher.ud.p6r1@example.test',
      firstName: 'ณรงค์ศักดิ์',
      lastName: 'แก้วมณี',
    },
  },
  {
    username: '10010002-P7XKD',
    email: null,
    firstName: 'ณัฐพงศ์',
    lastName: 'สุขเจริญ',
    prev: { email: 'seed.student@example.test', firstName: 'นักเรียน', lastName: 'ทดสอบระบบ' },
  },
];

// Virtual magic-link assignees keep working — only the email string changes,
// never the token. ศิริพร พัฒนกิจ has no user row (virtual login only).
const LINK_EMAIL_UPDATES: Array<{ from: string; to: string }> = [
  { from: 'seed.director@example.test', to: 'preeya.p@sts-demo.ac.th' },
  { from: 'seed.teacher.p3r1@example.test', to: 'suphawadi.w@sts-demo.ac.th' },
  { from: 'seed.teacher.p6r2@example.test', to: 'chanwit.j@sts-demo.ac.th' },
  { from: 'seed.teacher.ud.p6r1@example.test', to: 'narongsak.k@sts-demo.ac.th' },
  { from: 'seed.teacher.review@example.test', to: 'siriporn.p@sts-demo.ac.th' },
];

export class SeedRealisticIdentity20260705160000 implements MigrationInterface {
  name = 'SeedRealisticIdentity20260705160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const user of USER_UPDATES) {
      await queryRunner.query(
        `UPDATE users
         SET email = $1,
             "FirstName" = COALESCE($2, "FirstName"),
             "LastName" = COALESCE($3, "LastName")
         WHERE username = $4`,
        [user.email, user.firstName ?? null, user.lastName ?? null, user.username],
      );
    }
    for (const { from, to } of LINK_EMAIL_UPDATES) {
      await queryRunner.query(
        `UPDATE task_links SET assigned_to_email = $1 WHERE assigned_to_email = $2`,
        [to, from],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { from, to } of LINK_EMAIL_UPDATES) {
      await queryRunner.query(
        `UPDATE task_links SET assigned_to_email = $1 WHERE assigned_to_email = $2`,
        [from, to],
      );
    }
    for (const user of USER_UPDATES) {
      await queryRunner.query(
        `UPDATE users
         SET email = $1, "FirstName" = $2, "LastName" = $3
         WHERE username = $4`,
        [user.prev.email, user.prev.firstName, user.prev.lastName, user.username],
      );
    }
  }
}
