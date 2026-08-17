/**
 * The one place a page is named.
 *
 * Permission ids used to live here as their own vocabulary while the sidebar
 * kept a second list of page titles, so eight of seventeen entries drifted apart
 * — an operator ticking "ดูภาพรวมและความครบถ้วนการเช็กชื่อ" had to guess it meant
 * the page called "ความครบถ้วน". One permission per page, named after the page,
 * makes that guess impossible.
 *
 * Holding a page's permission means doing everything on that page. A control
 * that appears on more than one page is reachable from every page it appears on
 * (the endpoint behind it accepts each of those pages' permissions) — the rule
 * the owner picked on 2026-08-17.
 *
 * The frontend reads this through `GET /users/permissions`; it does not keep its
 * own copy.
 */
export interface AppPageDefinition {
  /** Also the permission id. Kept stable across the rename so stored rows survive. */
  id: string;
  /** Exactly what the sidebar shows. */
  title: string;
  route: string;
  /** Sidebar section header, or null for a top-level entry. */
  group: string | null;
}

export const APP_PAGE_GROUPS = {
  data: 'จัดการข้อมูล',
  attendance: 'ระบบเช็กชื่อ',
  users: 'จัดการสิทธิ์ผู้ใช้งาน',
} as const;

export const APP_PAGES: AppPageDefinition[] = [
  { id: 'home', title: 'หน้าหลัก', route: '/', group: null },
  { id: 'dashboard', title: 'รายงานสถานะนักเรียน', route: '/student-risk-report', group: null },
  { id: 'students', title: 'รายชื่อนักเรียน', route: '/students', group: null },
  { id: 'classrooms', title: 'ห้องเรียนทั้งหมด', route: '/classrooms', group: null },
  {
    id: 'manage-school-structure',
    title: 'จัดการภาคเรียนและห้องเรียน',
    route: '/school-structure',
    group: APP_PAGE_GROUPS.data,
  },
  {
    id: 'manage-curriculum',
    title: 'จัดการข้อมูลหลักสูตร',
    route: '/curriculum',
    group: APP_PAGE_GROUPS.data,
  },
  { id: 'import-data', title: 'นำเข้าข้อมูล', route: '/import-data', group: APP_PAGE_GROUPS.data },
  { id: 'export-data', title: 'ส่งออกข้อมูล', route: '/data-exports', group: APP_PAGE_GROUPS.data },
  {
    id: 'attendance-dashboard',
    title: 'ความครบถ้วน',
    route: '/attendance-operations',
    group: APP_PAGE_GROUPS.data,
  },
  { id: 'attendance', title: 'เช็กชื่อ', route: '/attendance', group: APP_PAGE_GROUPS.attendance },
  {
    id: 'manage-teacher-access',
    title: 'จัดการลิงก์เช็กชื่อ',
    route: '/attendance-links',
    group: APP_PAGE_GROUPS.attendance,
  },
  {
    id: 'timetable',
    title: 'ตารางสอน',
    route: '/timetable',
    group: APP_PAGE_GROUPS.attendance,
  },
  {
    id: 'manage-users-list',
    title: 'จัดการผู้ใช้งาน',
    route: '/manage-users',
    group: APP_PAGE_GROUPS.users,
  },
  {
    id: 'manage-teachers',
    title: 'จัดการข้อมูลคุณครู',
    route: '/manage-teachers',
    group: APP_PAGE_GROUPS.users,
  },
  {
    id: 'manage-role-groups',
    title: 'จัดการกลุ่มเมนู',
    route: '/manage-role-groups',
    group: APP_PAGE_GROUPS.users,
  },
  { id: 'settings', title: 'ตั้งค่าระบบ', route: '/settings', group: null },
];

/**
 * Permissions that guard something real but have no page of their own.
 *
 * `audit-log` is a panel embedded in นำเข้าข้อมูล, รายชื่อนักเรียน and the link
 * detail screen. Folding it into ตั้งค่าระบบ would hide an importer's own history
 * from them, so it stays a permission while not being a page.
 */
export const NON_PAGE_PERMISSIONS: Array<{ id: string; title: string }> = [
  { id: 'audit-log', title: 'บันทึกการใช้งาน' },
];

export const GRANTABLE_PAGE_PERMISSIONS = APP_PAGES;
