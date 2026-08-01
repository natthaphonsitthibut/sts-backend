import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthenticatedRequestUser, DataScope } from '../auth';
import { isUnconfiguredDataScope } from '../auth/auth.types';
import { hasPermission } from '../auth/permissions.constants';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { queryDataSource } from '../database/sql-query';
import type { AuditLogDomain, AuditLogTaskType } from './dto/audit-log.dto';
import type { AuditAction } from './dto/audit-log.dto';

export type { AuditAction } from './dto/audit-log.dto';

interface AuditQueryExecutor {
  query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[] | { rows: T[]; rowCount?: number | null }>;
}

export interface AuditLogRecordInput {
  actorUserId?: number | null;
  actorLabel?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

interface AuditActionDefinition {
  domain: AuditLogDomain;
  label: string;
  detailKeys: Array<{ key: string; label: string }>;
}

interface AuditLogRow extends Record<string, unknown> {
  id: string;
  actor_label: string | null;
  action: AuditAction;
  target_type: string | null;
  target_id: string | null;
  target_username: string | null;
  school_name: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  total_count: number | string;
}

interface SchoolScopeRow extends Record<string, unknown> {
  id: number;
  province: string | null;
  district: string | null;
  sub_district: string | null;
}

interface AuditLogListFilters {
  domain: AuditLogDomain;
  action?: AuditAction;
  searchTerm?: string;
  dateFrom?: string;
  dateTo?: string;
  province?: string;
  district?: string;
  subDistrict?: string;
  schoolId?: number;
  taskType?: AuditLogTaskType;
  targetType?: string;
  targetId?: string;
  caseId?: number;
  page?: number;
  limit?: number;
}

export interface AuditLogEntryResponse {
  id: string;
  domain: AuditLogDomain;
  action: AuditAction;
  actionLabel: string;
  actorLabel: string;
  targetType: string | null;
  targetId: string | null;
  /** Human-readable target (e.g. the affected account's username) when known. */
  targetLabel: string | null;
  createdAt: string;
  details: Array<{ label: string; value: string | number }>;
}

const ACTION_DEFINITIONS: Record<string, AuditActionDefinition> = {
  STUDENT_TEMP_PASSWORD_REISSUE: {
    domain: 'student_accounts',
    label: 'ออกรหัสชั่วคราวใหม่',
    detailKeys: [
      { key: 'expiresAt', label: 'รหัสหมดอายุ' },
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  USER_TEMP_PASSWORD_REISSUE: {
    domain: 'users',
    label: 'ออกรหัสชั่วคราวใหม่',
    detailKeys: [{ key: 'expiresAt', label: 'รหัสหมดอายุ' }],
  },
  STUDENT_ACCOUNT_BULK_GENERATE: {
    domain: 'student_accounts',
    label: 'สร้างบัญชีนักเรียนแบบชุด',
    detailKeys: [
      { key: 'createdCount', label: 'สร้างสำเร็จ' },
      { key: 'scopeLabel', label: 'ขอบเขต' },
      { key: 'province', label: 'จังหวัด' },
      { key: 'district', label: 'อำเภอ' },
      { key: 'subDistrict', label: 'ตำบล' },
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  STUDENT_ACCOUNT_DEACTIVATE: {
    domain: 'student_accounts',
    label: 'ปิดใช้งานบัญชีนักเรียน',
    detailKeys: [
      { key: 'reasonCode', label: 'รหัสเหตุผล' },
      { key: 'note', label: 'หมายเหตุ' },
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  STUDENT_ACCOUNT_REACTIVATE: {
    domain: 'student_accounts',
    label: 'เปิดใช้งานบัญชีนักเรียนอีกครั้ง',
    detailKeys: [
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  STUDENT_ACCOUNT_BATCH_ENQUEUE: {
    domain: 'student_accounts',
    label: 'สั่งสร้างบัญชีนักเรียน',
    detailKeys: [
      { key: 'totalCandidates', label: 'จำนวนที่ต้องสร้าง' },
      { key: 'scopeLabel', label: 'ขอบเขต' },
      { key: 'province', label: 'จังหวัด' },
      { key: 'district', label: 'อำเภอ' },
      { key: 'subDistrict', label: 'ตำบล' },
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  STUDENT_ACCOUNT_BATCH_COMPLETED: {
    domain: 'student_accounts',
    label: 'สร้างบัญชีนักเรียนเสร็จ',
    detailKeys: [
      { key: 'createdCount', label: 'สร้างสำเร็จ' },
      { key: 'skippedCount', label: 'ข้าม' },
      { key: 'failedCount', label: 'ล้มเหลว' },
      { key: 'scopeLabel', label: 'ขอบเขต' },
      { key: 'province', label: 'จังหวัด' },
      { key: 'district', label: 'อำเภอ' },
      { key: 'subDistrict', label: 'ตำบล' },
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  STUDENT_ACCOUNT_BATCH_FAILED: {
    domain: 'student_accounts',
    label: 'สร้างบัญชีนักเรียนไม่สำเร็จ',
    detailKeys: [
      { key: 'createdCount', label: 'สร้างสำเร็จ' },
      { key: 'skippedCount', label: 'ข้าม' },
      { key: 'failedCount', label: 'ล้มเหลว' },
      { key: 'errorSummary', label: 'สาเหตุ' },
      { key: 'scopeLabel', label: 'ขอบเขต' },
      { key: 'province', label: 'จังหวัด' },
      { key: 'district', label: 'อำเภอ' },
      { key: 'subDistrict', label: 'ตำบล' },
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  STUDENT_ACCOUNT_BATCH_RESUME: {
    domain: 'student_accounts',
    label: 'ทำงานสร้างบัญชีนักเรียนแบบชุดต่อ',
    detailKeys: [
      { key: 'previousStatus', label: 'สถานะเดิม' },
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  STUDENT_ACCOUNT_BATCH_CANCEL: {
    domain: 'student_accounts',
    label: 'ยกเลิกงานสร้างบัญชีนักเรียนแบบชุด',
    detailKeys: [
      { key: 'previousStatus', label: 'สถานะเดิม' },
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  TEACHER_ACCESS_GRANT_ISSUE: {
    domain: 'tasks',
    label: 'ออกลิงก์เข้าใช้งานครู',
    detailKeys: [
      { key: 'teacherName', label: 'ครู' },
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'expiresAt', label: 'หมดอายุ' },
    ],
  },
  TEACHER_ACCESS_GRANT_REVOKE: {
    domain: 'tasks',
    label: 'ยกเลิกลิงก์เข้าใช้งานครู',
    detailKeys: [
      { key: 'teacherName', label: 'ครู' },
      { key: 'reason', label: 'เหตุผล' },
    ],
  },
  TEACHER_ACCESS_GRANT_ROTATE: {
    domain: 'tasks',
    label: 'หมุนลิงก์เข้าใช้งานครู',
    detailKeys: [
      { key: 'teacherName', label: 'ครู' },
      { key: 'rotationCount', label: 'ครั้งที่' },
    ],
  },
  TEACHER_ACCESS_GRANT_USE: {
    domain: 'tasks',
    label: 'ใช้ลิงก์เข้าใช้งานครู',
    detailKeys: [
      { key: 'teacherName', label: 'ครู' },
      { key: 'operation', label: 'การทำงาน' },
    ],
  },
  TEACHER_ACCESS_GRANT_DENIED: {
    domain: 'tasks',
    label: 'ปฏิเสธการใช้ลิงก์ครู',
    detailKeys: [
      { key: 'teacherName', label: 'ครู' },
      { key: 'reason', label: 'เหตุผล' },
    ],
  },
  STUDENT_OBSERVATION_CREATE: {
    domain: 'students',
    label: 'บันทึกข้อสังเกตนักเรียน',
    detailKeys: [
      { key: 'concernLevel', label: 'ระดับข้อสังเกต' },
      { key: 'revision', label: 'รุ่นข้อมูล' },
    ],
  },
  STUDENT_OBSERVATION_UPDATE: {
    domain: 'students',
    label: 'แก้ไขข้อสังเกตนักเรียน',
    detailKeys: [
      { key: 'concernLevel', label: 'ระดับข้อสังเกต' },
      { key: 'revision', label: 'รุ่นข้อมูล' },
    ],
  },
  STUDENT_OBSERVATION_VIEW: {
    domain: 'students',
    label: 'ดูข้อสังเกตนักเรียน',
    detailKeys: [{ key: 'resultCount', label: 'จำนวนรายการ' }],
  },
  DATA_IMPORT: {
    domain: 'imports',
    label: 'นำเข้าข้อมูล',
    detailKeys: [
      { key: 'target', label: 'ประเภทข้อมูล' },
      { key: 'rowCount', label: 'จำนวนทั้งหมด' },
      { key: 'rowsInserted', label: 'เพิ่มใหม่' },
      { key: 'rowsUpdated', label: 'อัปเดต' },
      { key: 'rowsQuarantined', label: 'รอตรวจสอบ' },
      { key: 'rowsSkipped', label: 'ข้าม' },
    ],
  },
  IMPORT_QUARANTINE_RESOLVED: {
    domain: 'imports',
    label: 'แก้ไขรายการนำเข้าที่รอตรวจสอบ',
    detailKeys: [
      { key: 'studentName', label: 'นักเรียน' },
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'sourceRowNumber', label: 'แถวในไฟล์' },
      { key: 'academicYear', label: 'ปีการศึกษา' },
      { key: 'semester', label: 'ภาคเรียน' },
      { key: 'gradeRoom', label: 'ชั้น / ห้อง' },
      { key: 'studentStatus', label: 'สถานะนักเรียน' },
      { key: 'reasonLabel', label: 'สาเหตุที่ติดตรวจสอบ' },
      { key: 'changedFieldDetails', label: 'ข้อมูลที่แก้' },
      { key: 'changedFieldLabels', label: 'ข้อมูลที่แก้' },
      { key: 'statusLabel', label: 'สถานะ' },
    ],
  },
  IMPORT_QUARANTINE_REJECTED: {
    domain: 'imports',
    label: 'ปฏิเสธรายการนำเข้าที่รอตรวจสอบ',
    detailKeys: [
      { key: 'studentName', label: 'นักเรียน' },
      { key: 'schoolName', label: 'โรงเรียน' },
      { key: 'sourceRowNumber', label: 'แถวในไฟล์' },
      { key: 'academicYear', label: 'ปีการศึกษา' },
      { key: 'semester', label: 'ภาคเรียน' },
      { key: 'gradeRoom', label: 'ชั้น / ห้อง' },
      { key: 'studentStatus', label: 'สถานะนักเรียน' },
      { key: 'reasonLabel', label: 'สาเหตุที่ติดตรวจสอบ' },
      { key: 'note', label: 'เหตุผลที่ปฏิเสธ' },
      { key: 'statusLabel', label: 'สถานะ' },
    ],
  },
  IMPORT_QUARANTINE_EXPORT: {
    domain: 'imports',
    label: 'ดาวน์โหลดรายงานรายการนำเข้าที่รอตรวจสอบ',
    detailKeys: [
      { key: 'statusLabel', label: 'สถานะรายงาน' },
      { key: 'rowCount', label: 'จำนวนรายการ' },
      { key: 'reasonLabel', label: 'สาเหตุที่กรอง' },
      { key: 'search', label: 'คำค้น' },
      { key: 'province', label: 'จังหวัด' },
      { key: 'district', label: 'อำเภอ' },
      { key: 'subDistrict', label: 'ตำบล' },
      { key: 'schoolName', label: 'โรงเรียน' },
    ],
  },
  USER_CREATE: {
    domain: 'users',
    label: 'สร้างผู้ใช้งาน',
    detailKeys: [],
  },
  USER_UPDATE: {
    domain: 'users',
    label: 'แก้ไขผู้ใช้งาน',
    detailKeys: [{ key: 'fieldCount', label: 'จำนวนข้อมูลที่แก้' }],
  },
  USER_PROFILE_UPDATE: {
    domain: 'users',
    label: 'แก้ไขข้อมูลส่วนตัว',
    detailKeys: [{ key: 'fieldCount', label: 'จำนวนข้อมูลที่แก้' }],
  },
  USER_DELETE: {
    domain: 'users',
    label: 'ปิดหรือลบผู้ใช้งาน',
    detailKeys: [],
  },
  USER_DEACTIVATE: {
    domain: 'users',
    label: 'ปิดใช้งานผู้ใช้งาน',
    detailKeys: [
      { key: 'reasonCode', label: 'รหัสเหตุผล' },
      { key: 'note', label: 'หมายเหตุ' },
    ],
  },
  USER_REACTIVATE: {
    domain: 'users',
    label: 'เปิดใช้งานผู้ใช้งานอีกครั้ง',
    detailKeys: [],
  },
  TASK_CREATE: {
    domain: 'tasks',
    label: 'สร้างภารกิจหรือลิงก์',
    detailKeys: [
      { key: 'taskType', label: 'ประเภท' },
      { key: 'schoolId', label: 'รหัสโรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  CASE_CREATE: {
    domain: 'cases',
    label: 'เปิดเคส',
    detailKeys: [{ key: 'schoolId', label: 'รหัสโรงเรียน' }],
  },
  LINK_LOCK: {
    domain: 'login_links',
    label: 'ปิดลิงก์',
    detailKeys: [{ key: 'taskType', label: 'ประเภทลิงก์' }],
  },
  LINK_UNLOCK: {
    domain: 'login_links',
    label: 'เปิดลิงก์อีกครั้ง',
    detailKeys: [{ key: 'taskType', label: 'ประเภทลิงก์' }],
  },
  CASE_REVIEW: {
    domain: 'cases',
    label: 'ตรวจสอบเคส',
    detailKeys: [{ key: 'reviewAction', label: 'ผลการตรวจสอบ' }],
  },
  CASE_CLOSE: {
    domain: 'cases',
    label: 'ปิดเคส',
    detailKeys: [{ key: 'resolutionOutcome', label: 'ผลลัพธ์' }],
  },
  CASE_AUTO_CANCEL: {
    domain: 'cases',
    label: 'ยกเลิกเคสอัตโนมัติ',
    detailKeys: [],
  },
  CASE_RISK_SIGNAL_DETECTED: {
    domain: 'cases',
    label: 'ตรวจพบสัญญาณความเสี่ยง',
    detailKeys: [
      { key: 'signalRuleCode', label: 'กฎที่ตรวจพบ' },
      { key: 'reason', label: 'เหตุผล' },
    ],
  },
  CASE_RISK_TIER_ESCALATE: {
    domain: 'cases',
    label: 'ปรับระดับความเสี่ยงอัตโนมัติ',
    detailKeys: [
      { key: 'fromTier', label: 'จากระดับ' },
      { key: 'toTier', label: 'เป็นระดับ' },
      { key: 'consecutiveDays', label: 'จำนวนวันขาดติดต่อกัน' },
    ],
  },
  CASE_SLA_WARNING: {
    domain: 'cases',
    label: 'แจ้งเตือน SLA เคส',
    detailKeys: [
      { key: 'riskTier', label: 'ระดับความเสี่ยง' },
      { key: 'slaDueAt', label: 'กำหนดดำเนินการ' },
    ],
  },
  CASE_SLA_BREACHED: {
    domain: 'cases',
    label: 'ยกระดับเคสเกิน SLA',
    detailKeys: [
      { key: 'riskTier', label: 'ระดับความเสี่ยง' },
      { key: 'slaDueAt', label: 'กำหนดดำเนินการ' },
    ],
  },
  TASK_DELETE: {
    domain: 'tasks',
    label: 'ลบภารกิจ',
    detailKeys: [],
  },
  DELEGATION: {
    domain: 'tasks',
    label: 'ส่งต่อภารกิจ',
    detailKeys: [{ key: 'toDepth', label: 'ลำดับการส่งต่อ' }],
  },
  ATTENDANCE_SUBMIT: {
    domain: 'attendance',
    label: 'บันทึกการเช็คชื่อ',
    detailKeys: [
      { key: 'attendanceDate', label: 'วันที่' },
      { key: 'recordedCount', label: 'บันทึกแล้ว' },
      { key: 'expectedRosterCount', label: 'นักเรียนทั้งหมด' },
      { key: 'revision', label: 'ครั้งที่แก้ไข' },
    ],
  },
  ATTENDANCE_REOPEN: {
    domain: 'attendance',
    label: 'เปิดรอบเช็คชื่อเพื่อแก้ไข',
    detailKeys: [
      { key: 'attendanceDate', label: 'วันที่' },
      { key: 'revision', label: 'ครั้งที่แก้ไข' },
    ],
  },
  STUDENT_CREATE: {
    domain: 'students',
    label: 'เพิ่มข้อมูลนักเรียน',
    detailKeys: [{ key: 'fieldCount', label: 'จำนวนข้อมูลที่ส่ง' }],
  },
  STUDENT_UPDATE: {
    domain: 'students',
    label: 'แก้ไขข้อมูลนักเรียน',
    detailKeys: [{ key: 'fieldCount', label: 'จำนวนข้อมูลที่แก้' }],
  },
  STUDENT_DELETE: {
    domain: 'students',
    label: 'ลบข้อมูลนักเรียน',
    detailKeys: [{ key: 'fieldCount', label: 'จำนวนข้อมูลที่เกี่ยวข้อง' }],
  },
  CLASSROOM_DATA_EXPORT: {
    domain: 'students',
    label: 'ส่งออกข้อมูลห้องเรียน',
    detailKeys: [
      { key: 'exportScope', label: 'ขอบเขตข้อมูล' },
      { key: 'format', label: 'รูปแบบไฟล์' },
      { key: 'schoolId', label: 'โรงเรียน' },
    ],
  },
  FIELD_FOLLOWER_APPLY: {
    domain: 'field_followers',
    label: 'สมัครเป็นผู้ติดตามภาคสนาม',
    detailKeys: [{ key: 'province', label: 'จังหวัด' }],
  },
  FIELD_FOLLOWER_REVIEW: {
    domain: 'field_followers',
    label: 'ตรวจสอบผู้สมัครติดตามภาคสนาม',
    detailKeys: [
      { key: 'reviewAction', label: 'การดำเนินการ' },
      { key: 'toStatus', label: 'สถานะใหม่' },
    ],
  },
  FIELD_MAP_VIEW: {
    domain: 'field_followers',
    label: 'เปิดแผนที่เด็กเสี่ยง',
    detailKeys: [{ key: 'studentCount', label: 'จำนวนที่เลือก' }],
  },
  FOLLOWER_CAMPAIGN_CREATE: {
    domain: 'field_followers',
    label: 'สร้างลิงก์รับสมัคร อสม.',
    detailKeys: [{ key: 'name', label: 'ชื่อลิงก์' }],
  },
  FOLLOWER_CAMPAIGN_UPDATE: {
    domain: 'field_followers',
    label: 'แก้ไขลิงก์รับสมัคร อสม.',
    detailKeys: [{ key: 'fieldCount', label: 'จำนวนข้อมูลที่แก้' }],
  },
  FOLLOWER_CAMPAIGN_DELETE: {
    domain: 'field_followers',
    label: 'ปิดลิงก์รับสมัคร อสม. ถาวร',
    detailKeys: [{ key: 'name', label: 'ชื่อลิงก์' }],
  },
  FOLLOWER_CAMPAIGN_TARGETS_ADD: {
    domain: 'field_followers',
    label: 'เพิ่มเคสในแคมเปญรับสมัคร อสม.',
    detailKeys: [{ key: 'caseCount', label: 'จำนวนเคส' }],
  },
  SUBJECT_CREATE: {
    domain: 'timetable',
    label: 'เพิ่มรายวิชา',
    detailKeys: [{ key: 'code', label: 'รหัสวิชา' }],
  },
  SUBJECT_UPDATE: {
    domain: 'timetable',
    label: 'แก้ไขรายวิชา',
    detailKeys: [{ key: 'code', label: 'รหัสวิชา' }],
  },
  TIMETABLE_SLOT_CREATE: {
    domain: 'timetable',
    label: 'เพิ่มคาบสอน',
    detailKeys: [
      { key: 'dayOfWeek', label: 'วัน' },
      { key: 'period', label: 'คาบ' },
    ],
  },
  TIMETABLE_SLOT_UPDATE: {
    domain: 'timetable',
    label: 'แก้ไขคาบสอน',
    detailKeys: [
      { key: 'dayOfWeek', label: 'วัน' },
      { key: 'period', label: 'คาบ' },
    ],
  },
  TIMETABLE_SLOT_DELETE: {
    domain: 'timetable',
    label: 'ลบคาบสอน',
    detailKeys: [
      { key: 'dayOfWeek', label: 'วัน' },
      { key: 'period', label: 'คาบ' },
    ],
  },
  PERIOD_TIME_GENERATE: {
    domain: 'timetable',
    label: 'สร้างเวลาคาบเรียนอัตโนมัติ',
    detailKeys: [
      { key: 'days', label: 'วันที่สร้าง' },
      { key: 'periodsCount', label: 'จำนวนคาบ' },
    ],
  },
  PERIOD_TIME_OVERRIDE: {
    domain: 'timetable',
    label: 'แก้ไขเวลาคาบเรียนรายคาบ',
    detailKeys: [
      { key: 'dayOfWeek', label: 'วัน' },
      { key: 'period', label: 'คาบ' },
    ],
  },
};

const DOMAIN_PERMISSIONS: Record<AuditLogDomain, string[]> = {
  student_accounts: ['manage-student-accounts'],
  imports: ['import-data'],
  users: ['manage-users-list'],
  login_links: ['login-links'],
  students: ['students'],
  cases: ['review-cases'],
  tasks: ['create', 'review-cases', 'attendance-dashboard'],
  attendance: ['attendance', 'attendance-dashboard'],
  field_followers: ['field-monitor'],
  timetable: ['manage-timetable'],
};

const LINK_HISTORY_ACTIONS: AuditAction[] = [
  'TASK_CREATE',
  'TASK_DELETE',
  'LINK_LOCK',
  'LINK_UNLOCK',
  'DELEGATION',
];

const LINK_HISTORY_DOMAINS: Record<AuditLogTaskType, AuditLogDomain> = {
  ATTENDANCE: 'tasks',
  VISIT: 'tasks',
  LOGIN: 'login_links',
};

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly dataSource: DataSource) {}

  private normalizeScopeValues(value: unknown): Array<string | number> {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value.filter(
          (entry): entry is string | number =>
            (typeof entry === 'string' && entry.trim().length > 0) ||
            (typeof entry === 'number' && Number.isFinite(entry)),
        ),
      ),
    );
  }

  private async addScopeSnapshot(
    metadata: Record<string, unknown> | null | undefined,
    executor?: AuditQueryExecutor,
  ): Promise<Record<string, unknown> | null> {
    if (!metadata) {
      return null;
    }

    const sourceScope =
      metadata.scope && typeof metadata.scope === 'object' && !Array.isArray(metadata.scope)
        ? (metadata.scope as DataScope)
        : {};
    const schoolIds = this.normalizeScopeValues([
      ...this.normalizeScopeValues(sourceScope.school_ids),
      ...this.normalizeScopeValues(metadata.schoolIds),
      ...(metadata.schoolId !== null && metadata.schoolId !== undefined
        ? [metadata.schoolId as string | number]
        : []),
    ])
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0);

    const query = async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = executor
        ? await executor.query<T>(sql, params)
        : await queryDataSource<T>(this.dataSource, sql, params);
      return Array.isArray(result) ? { rows: result, rowCount: result.length } : result;
    };
    const schools =
      schoolIds.length > 0
        ? (
            await query<SchoolScopeRow>(
              `SELECT id, province, district, sub_district FROM schools WHERE id = ANY($1::int[])`,
              [schoolIds],
            )
          ).rows
        : [];
    const uniqueStrings = (values: unknown[]): string[] =>
      Array.from(
        new Set(
          values
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      );
    const scope: DataScope = {
      provinces: uniqueStrings([
        ...this.normalizeScopeValues(sourceScope.provinces),
        metadata.province,
        ...schools.map((school) => school.province),
      ]),
      districts: uniqueStrings([
        ...this.normalizeScopeValues(sourceScope.districts),
        metadata.district,
        ...schools.map((school) => school.district),
      ]),
      sub_districts: uniqueStrings([
        ...this.normalizeScopeValues(sourceScope.sub_districts),
        metadata.subDistrict,
        ...schools.map((school) => school.sub_district),
      ]),
      school_ids: schoolIds,
      grade_levels: this.normalizeScopeValues([
        ...this.normalizeScopeValues(sourceScope.grade_levels),
        ...(metadata.gradeLevelId !== null && metadata.gradeLevelId !== undefined
          ? [metadata.gradeLevelId as string | number]
          : metadata.grade !== null && metadata.grade !== undefined
            ? [metadata.grade as string | number]
            : []),
      ]),
      room_ids: this.normalizeScopeValues([
        ...this.normalizeScopeValues(sourceScope.room_ids),
        ...(metadata.roomId !== null && metadata.roomId !== undefined
          ? [metadata.roomId as string | number]
          : metadata.room !== null && metadata.room !== undefined
            ? [metadata.room as string | number]
            : []),
      ]),
      own_only: sourceScope.own_only === true ? true : undefined,
    };
    const compactScope = Object.fromEntries(
      Object.entries(scope).filter(([, value]) =>
        Array.isArray(value) ? value.length > 0 : value === true,
      ),
    );

    return Object.keys(compactScope).length > 0 ? { ...metadata, scope: compactScope } : metadata;
  }

  private assertDomainPermission(actor: AuthenticatedRequestUser, domain: AuditLogDomain): void {
    const allowed = DOMAIN_PERMISSIONS[domain].some((permission) =>
      hasPermission(actor.roles, actor.permissions, permission),
    );
    if (!allowed || actor.data_scope?.own_only === true) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูประวัติส่วนนี้');
    }
  }

  private resolveListActions(filters: {
    domain: AuditLogDomain;
    taskType?: AuditLogTaskType;
  }): AuditAction[] {
    if (filters.taskType) {
      if (LINK_HISTORY_DOMAINS[filters.taskType] !== filters.domain) {
        throw new BadRequestException('taskType ไม่ตรงกับประเภทประวัติลิงก์');
      }
      return LINK_HISTORY_ACTIONS;
    }
    return Object.entries(ACTION_DEFINITIONS)
      .filter(([, definition]) => definition.domain === filters.domain)
      .map(([action]) => action as AuditAction);
  }

  getActionOptions(
    actor: AuthenticatedRequestUser,
    filters: { domain: AuditLogDomain; taskType?: AuditLogTaskType },
  ) {
    this.assertDomainPermission(actor, filters.domain);
    const actions = this.resolveListActions(filters);
    return {
      data: actions.map((value) => ({ value, label: ACTION_DEFINITIONS[value].label })),
    };
  }

  private appendScopeConditions(
    conditions: string[],
    params: unknown[],
    actorScope: DataScope | undefined,
  ): void {
    // An unconfigured actor scope (no areas, no explicit global/own_only) must
    // never widen the audit list to every event — fail closed instead.
    if (isUnconfiguredDataScope(actorScope)) {
      conditions.push('1=0');
      return;
    }
    const scopeSql = `COALESCE(a.metadata -> 'scope', '{}'::jsonb)`;
    const appendSubset = (key: keyof Omit<DataScope, 'own_only'>, values: unknown): void => {
      const normalized = this.normalizeScopeValues(values).map(String);
      if (normalized.length === 0) {
        return;
      }
      params.push(normalized);
      const parameter = `$${params.length}`;
      conditions.push(`
        jsonb_typeof(${scopeSql} -> '${key}') = 'array'
        AND jsonb_array_length(${scopeSql} -> '${key}') > 0
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(${scopeSql} -> '${key}') AS event_scope(value)
          WHERE NOT (event_scope.value = ANY(${parameter}::text[]))
        )
      `);
    };

    appendSubset('provinces', actorScope?.provinces);
    appendSubset('districts', actorScope?.districts);
    appendSubset('sub_districts', actorScope?.sub_districts);
    appendSubset('school_ids', actorScope?.school_ids);
    appendSubset('grade_levels', actorScope?.grade_levels);
    appendSubset('room_ids', actorScope?.room_ids);
  }

  private async assertSchoolFilterAllowed(
    actor: AuthenticatedRequestUser,
    schoolId: number | undefined,
  ): Promise<void> {
    if (!schoolId) {
      return;
    }
    const actorScope = actor.data_scope || {};
    const hasRestriction =
      this.normalizeScopeValues(actorScope.provinces).length > 0 ||
      this.normalizeScopeValues(actorScope.districts).length > 0 ||
      this.normalizeScopeValues(actorScope.sub_districts).length > 0 ||
      this.normalizeScopeValues(actorScope.school_ids).length > 0;
    if (!hasRestriction) {
      return;
    }

    const school = (
      await queryDataSource<SchoolScopeRow>(
        this.dataSource,
        `SELECT id, province, district, sub_district FROM schools WHERE id = $1`,
        [schoolId],
      )
    ).rows[0];
    const contains = (allowed: unknown, value: unknown): boolean => {
      const values = this.normalizeScopeValues(allowed).map(String);
      if (values.length === 0) {
        return true;
      }
      if (typeof value !== 'string' && typeof value !== 'number') {
        return false;
      }
      return values.includes(String(value));
    };
    if (
      !school ||
      !contains(actorScope.provinces, school.province) ||
      !contains(actorScope.districts, school.district) ||
      !contains(actorScope.sub_districts, school.sub_district) ||
      !contains(actorScope.school_ids, school.id)
    ) {
      throw new ForbiddenException('โรงเรียนอยู่นอกขอบเขตข้อมูลของผู้ใช้');
    }
  }

  private toSafeDetails(
    definition: AuditActionDefinition,
    metadata: Record<string, unknown> | null,
  ): Array<{ label: string; value: string | number }> {
    if (!metadata) {
      return [];
    }

    return definition.detailKeys.flatMap(({ key, label }) => {
      if (key === 'changedFieldDetails') {
        const changedFields = metadata[key];
        if (!Array.isArray(changedFields)) return [];
        return changedFields.flatMap((field) => {
          if (!field || typeof field !== 'object' || Array.isArray(field)) return [];
          const detail = field as Record<string, unknown>;
          const fieldLabel = typeof detail.label === 'string' ? detail.label.trim() : '';
          if (!fieldLabel) return [];
          const oldValue = detail.oldValue;
          const newValue = detail.newValue;
          const isSafeValue = (value: unknown): value is string | number =>
            typeof value === 'string' || typeof value === 'number';
          return [
            ...(isSafeValue(oldValue)
              ? [{ label: `${fieldLabel} (ก่อนแก้)`, value: oldValue }]
              : []),
            ...(isSafeValue(newValue)
              ? [{ label: `${fieldLabel} (หลังแก้)`, value: newValue }]
              : []),
          ];
        });
      }
      if (key === 'changedFieldLabels' && Array.isArray(metadata.changedFieldDetails)) {
        return [];
      }
      if (key === 'schoolName') {
        const schoolName = metadata.schoolName;
        if (typeof schoolName === 'string' && schoolName.trim()) {
          return [{ label, value: schoolName }];
        }
        const schoolId = metadata.schoolId;
        return typeof schoolId === 'string' || typeof schoolId === 'number'
          ? [{ label: 'รหัสโรงเรียน', value: schoolId }]
          : [];
      }
      const value = metadata[key];
      return typeof value === 'string' || typeof value === 'number' ? [{ label, value }] : [];
    });
  }

  private withResolvedDetailMetadata(row: AuditLogRow): Record<string, unknown> | null {
    if (!row.metadata) {
      return null;
    }
    if (typeof row.school_name === 'string' && row.school_name.trim()) {
      return { ...row.metadata, schoolName: row.school_name };
    }
    return row.metadata;
  }

  private toAuditLogEntry(row: AuditLogRow): AuditLogEntryResponse {
    const definition = ACTION_DEFINITIONS[row.action];
    return {
      id: String(row.id),
      domain: definition.domain,
      action: row.action,
      actionLabel: definition.label,
      actorLabel: row.actor_label || 'ระบบ',
      targetType: row.target_type,
      targetId: row.target_id,
      targetLabel: this.extractTargetLabel(row),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(String(row.created_at)).toISOString(),
      details: this.toSafeDetails(definition, this.withResolvedDetailMetadata(row)),
    };
  }

  /**
   * The affected record's readable name (the target account's username) so the
   * list can show it in the target column instead of a bare numeric id. The
   * username is recorded in the event metadata by the write path.
   */
  private extractTargetLabel(row: AuditLogRow): string | null {
    if (typeof row.target_username === 'string' && row.target_username.trim()) {
      return row.target_username;
    }
    const username = row.metadata?.['username'];
    return typeof username === 'string' && username.trim() ? username : null;
  }

  async list(actor: AuthenticatedRequestUser, filters: AuditLogListFilters) {
    this.assertDomainPermission(actor, filters.domain);
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
      throw new BadRequestException('dateFrom ต้องไม่มากกว่า dateTo');
    }
    await this.assertSchoolFilterAllowed(actor, filters.schoolId);

    const actions = this.resolveListActions(filters);
    if (filters.action && !actions.includes(filters.action)) {
      throw new BadRequestException('action ไม่ตรงกับประเภทประวัติ');
    }
    if (filters.caseId && filters.domain !== 'cases') {
      throw new BadRequestException('caseId ใช้ได้กับประวัติเคสเท่านั้น');
    }
    if (actions.length === 0) {
      return {
        data: [],
        meta: buildPaginationMeta(resolvePage(filters.page), resolveLimit(filters.limit), 0),
      };
    }

    const conditions: string[] = [`a.data_origin_code <> 'AUTOMATED_TEST'`];
    const params: unknown[] = [];
    params.push(filters.action ? [filters.action] : actions);
    conditions.push(`a.action = ANY($${params.length}::text[])`);
    conditions.push(
      `NOT (a.action = 'STUDENT_ACCOUNT_BULK_GENERATE' AND a.metadata ->> 'createdCount' = '0')`,
    );
    if (filters.domain === 'student_accounts') {
      conditions.push(`(
        COALESCE(
          NULLIF(a.metadata ->> 'scopeLabel', ''),
          NULLIF(a.metadata ->> 'province', ''),
          NULLIF(a.metadata ->> 'district', ''),
          NULLIF(a.metadata ->> 'subDistrict', ''),
          NULLIF(a.metadata ->> 'schoolId', ''),
          NULLIF(a.metadata ->> 'grade', ''),
          NULLIF(a.metadata ->> 'room', '')
        ) IS NOT NULL
        OR COALESCE(a.metadata -> 'scope', '{}'::jsonb) <> '{}'::jsonb
      )`);
    }
    if (filters.taskType) {
      params.push(filters.taskType);
      conditions.push(`a.metadata ->> 'taskType' = $${params.length}`);
    }
    if (filters.targetType) {
      params.push(filters.targetType);
      conditions.push(`a.target_type = $${params.length}`);
    }
    if (filters.targetId) {
      params.push(filters.targetId);
      conditions.push(`a.target_id = $${params.length}`);
    }
    if (filters.caseId) {
      params.push(String(filters.caseId));
      conditions.push(`(
        (a.target_type = 'case' AND a.target_id = $${params.length})
        OR a.metadata ->> 'caseId' = $${params.length}
      )`);
    }
    // Actor-only search: the tables show who performed the action, while raw
    // target ids and English action enums are not visible anywhere to match.
    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      conditions.push(`COALESCE(a.actor_label, '') ILIKE $${params.length}`);
    }
    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      conditions.push(`a.created_at >= $${params.length}::date`);
    }
    if (filters.dateTo) {
      params.push(filters.dateTo);
      conditions.push(`a.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    const appendMetadataScopeFilter = (
      scopeKey: 'provinces' | 'districts' | 'sub_districts' | 'school_ids',
      metadataKey: 'province' | 'district' | 'subDistrict' | 'schoolId',
      value: string | undefined,
    ): void => {
      if (!value) {
        return;
      }
      params.push(value);
      const parameter = `$${params.length}`;
      const scopeArray = `CASE
        WHEN jsonb_typeof(a.metadata -> 'scope' -> '${scopeKey}') = 'array'
        THEN a.metadata -> 'scope' -> '${scopeKey}'
        ELSE '[]'::jsonb
      END`;
      conditions.push(`(
        a.metadata ->> '${metadataKey}' = ${parameter}
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(${scopeArray}) AS filter_scope(value)
          WHERE filter_scope.value = ${parameter}
        )
      )`);
    };
    appendMetadataScopeFilter('provinces', 'province', filters.province);
    appendMetadataScopeFilter('districts', 'district', filters.district);
    appendMetadataScopeFilter('sub_districts', 'subDistrict', filters.subDistrict);
    if (filters.schoolId) {
      params.push(String(filters.schoolId));
      const parameter = `$${params.length}`;
      conditions.push(`(
        a.metadata ->> 'schoolId' = ${parameter}
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(a.metadata -> 'scope' -> 'school_ids') = 'array'
              THEN a.metadata -> 'scope' -> 'school_ids'
              ELSE '[]'::jsonb
            END
          ) AS school_scope(value)
          WHERE school_scope.value = ${parameter}
        )
      )`);
    }
    this.appendScopeConditions(conditions, params, actor.data_scope);

    const page = resolvePage(filters.page);
    const limit = resolveLimit(filters.limit);
    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push((page - 1) * limit);
    const offsetParam = `$${params.length}`;
    const result = await queryDataSource<AuditLogRow>(
      this.dataSource,
      `
        SELECT
          a.id,
          a.actor_label,
          a.action,
          a.target_type,
          a.target_id,
          tu.username AS target_username,
          audit_school.name AS school_name,
          a.metadata,
          a.created_at,
          COUNT(*) OVER() AS total_count
        FROM audit_log a
        LEFT JOIN users tu
          ON a.target_type = 'user' AND a.target_id = tu.id::text
        LEFT JOIN schools audit_school
          ON NULLIF(a.metadata ->> 'schoolId', '') ~ '^[0-9]+$'
         AND audit_school.id = (a.metadata ->> 'schoolId')::int
        WHERE ${conditions.join(' AND ')}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${limitParam}
        OFFSET ${offsetParam}
      `,
      params,
    );
    const totalCount = result.rows[0] ? Number(result.rows[0].total_count) || 0 : 0;

    return {
      data: result.rows.map((row) => this.toAuditLogEntry(row)),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }

  async getById(actor: AuthenticatedRequestUser, id: string) {
    if (!/^\d+$/.test(id)) {
      throw new BadRequestException('id ไม่ถูกต้อง');
    }

    const found = (
      await queryDataSource<AuditLogRow>(
        this.dataSource,
        `
          SELECT
            a.id,
            a.actor_label,
            a.action,
            a.target_type,
            a.target_id,
            tu.username AS target_username,
            audit_school.name AS school_name,
            a.metadata,
            a.created_at,
            1 AS total_count
          FROM audit_log a
          LEFT JOIN users tu
            ON a.target_type = 'user' AND a.target_id = tu.id::text
          LEFT JOIN schools audit_school
            ON NULLIF(a.metadata ->> 'schoolId', '') ~ '^[0-9]+$'
           AND audit_school.id = (a.metadata ->> 'schoolId')::int
          WHERE a.id = $1::bigint
            AND a.data_origin_code <> 'AUTOMATED_TEST'
        `,
        [id],
      )
    ).rows[0];
    const definition = found ? ACTION_DEFINITIONS[found.action] : undefined;
    if (!found || !definition) {
      throw new NotFoundException('ไม่พบประวัติรายการนี้');
    }

    const taskType = found.metadata?.['taskType'];
    const permissionDomain =
      LINK_HISTORY_ACTIONS.includes(found.action) &&
      typeof taskType === 'string' &&
      Object.prototype.hasOwnProperty.call(LINK_HISTORY_DOMAINS, taskType)
        ? LINK_HISTORY_DOMAINS[taskType as AuditLogTaskType]
        : definition.domain;
    this.assertDomainPermission(actor, permissionDomain);

    const conditions = [`a.id = $1::bigint`, `a.data_origin_code <> 'AUTOMATED_TEST'`];
    const params: unknown[] = [id];
    if (definition.domain === 'student_accounts') {
      conditions.push(
        `NOT (a.action = 'STUDENT_ACCOUNT_BULK_GENERATE' AND a.metadata ->> 'createdCount' = '0')`,
      );
      conditions.push(`(
        COALESCE(
          NULLIF(a.metadata ->> 'scopeLabel', ''),
          NULLIF(a.metadata ->> 'province', ''),
          NULLIF(a.metadata ->> 'district', ''),
          NULLIF(a.metadata ->> 'subDistrict', ''),
          NULLIF(a.metadata ->> 'schoolId', ''),
          NULLIF(a.metadata ->> 'grade', ''),
          NULLIF(a.metadata ->> 'room', '')
        ) IS NOT NULL
        OR COALESCE(a.metadata -> 'scope', '{}'::jsonb) <> '{}'::jsonb
      )`);
    }
    this.appendScopeConditions(conditions, params, actor.data_scope);

    const scoped = (
      await queryDataSource<AuditLogRow>(
        this.dataSource,
        `
          SELECT
            a.id,
            a.actor_label,
            a.action,
            a.target_type,
            a.target_id,
            tu.username AS target_username,
            audit_school.name AS school_name,
            a.metadata,
            a.created_at,
            1 AS total_count
          FROM audit_log a
          LEFT JOIN users tu
            ON a.target_type = 'user' AND a.target_id = tu.id::text
          LEFT JOIN schools audit_school
            ON NULLIF(a.metadata ->> 'schoolId', '') ~ '^[0-9]+$'
           AND audit_school.id = (a.metadata ->> 'schoolId')::int
          WHERE ${conditions.join(' AND ')}
          LIMIT 1
        `,
        params,
      )
    ).rows[0];
    if (!scoped) {
      throw new NotFoundException('ไม่พบประวัติรายการนี้');
    }

    return { data: this.toAuditLogEntry(scoped) };
  }

  private async writeRecord(
    event: AuditLogRecordInput,
    executor?: AuditQueryExecutor,
  ): Promise<void> {
    const metadata = await this.addScopeSnapshot(event.metadata, executor);
    const query = async (sql: string, params?: unknown[]) =>
      executor
        ? await executor.query(sql, params)
        : await queryDataSource(this.dataSource, sql, params);
    await query(
      `
        INSERT INTO audit_log (
          actor_user_id,
          actor_label,
          action,
          target_type,
          target_id,
          metadata,
          ip,
          data_origin_code
        )
        VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7,
          COALESCE(
            (SELECT data_origin_code FROM users WHERE id = $1),
            'OPERATIONAL'
          )
        )
      `,
      [
        event.actorUserId ?? null,
        event.actorLabel ?? null,
        event.action,
        event.targetType ?? null,
        event.targetId ?? null,
        metadata == null ? null : JSON.stringify(metadata),
        event.ip ?? null,
      ],
    );
  }

  async record(event: AuditLogRecordInput): Promise<void> {
    try {
      await this.writeRecord(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Audit log write failed for action "${event.action}": ${message}`);
    }
  }

  async recordAtomic(event: AuditLogRecordInput, executor: AuditQueryExecutor): Promise<void> {
    await this.writeRecord(event, executor);
  }
}
