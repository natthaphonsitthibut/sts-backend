import type { DataExportCatalogItem } from './data-export.types';

export const DATA_EXPORT_CATALOG: DataExportCatalogItem[] = [
  {
    code: 'student_roster_basic',
    label: 'รายชื่อนักเรียนพื้นฐาน',
    description:
      'รายชื่อนักเรียนตามทะเบียนปัจจุบันแบบลดข้อมูลอ่อนไหว ไม่มีเลขบัตร ที่อยู่ ช่องทางติดต่อ หรือพิกัด',
    sensitivityClass: 'OPERATIONAL',
    formats: ['CSV'],
    fieldBundles: [
      {
        code: 'basic',
        label: 'ข้อมูลพื้นฐาน',
        description: 'รหัสอ้างอิงนักเรียน ชื่อ โรงเรียน ชั้น ห้อง และสถานะการเรียน',
      },
    ],
    supportedFilters: ['province', 'district', 'subDistrict', 'schoolId', 'grade', 'room'],
    requiredPermissions: ['export-data', 'students'],
    deliveryMode: 'ASYNC_JOB',
    status: 'AVAILABLE',
  },
  {
    code: 'student_pii',
    label: 'ส่งออกข้อมูลนักเรียนที่มี PII',
    description:
      'ใช้ workflow เดิมของหน้ารายชื่อนักเรียน: purpose, approval, mask default, TTL และ one-time download',
    sensitivityClass: 'SENSITIVE_PII',
    formats: ['CSV'],
    fieldBundles: [
      {
        code: 'existing-student-pii-workflow',
        label: 'ตามคำขอส่งออกเดิม',
        description: 'field set ถูกควบคุมโดย workflow /students/export เดิม',
      },
    ],
    supportedFilters: ['studentListFilters'],
    requiredPermissions: ['export-data', 'students'],
    deliveryMode: 'EXISTING_WORKFLOW',
    workflowPath: '/students/export',
    status: 'AVAILABLE',
  },
  {
    code: 'student_risk',
    label: 'ความเสี่ยงนักเรียน',
    description:
      'ระดับความเสี่ยงและตัวชี้วัดจาก risk profile โดยไม่รวมที่อยู่ พิกัด เลขบัตร หรือข้อมูลลับ',
    sensitivityClass: 'SENSITIVE_OPERATIONAL',
    formats: ['CSV'],
    fieldBundles: [
      {
        code: 'risk-summary',
        label: 'สรุปความเสี่ยง',
        description: 'risk tier, attendance indicators, active case count และ as-of',
      },
    ],
    supportedFilters: [
      'province',
      'district',
      'subDistrict',
      'schoolId',
      'grade',
      'room',
      'riskTier',
    ],
    requiredPermissions: ['export-data', 'dashboard'],
    deliveryMode: 'ASYNC_JOB',
    status: 'AVAILABLE',
  },
  {
    code: 'attendance_summary',
    label: 'สรุปการมาเรียน',
    description: 'อัตรามา/ขาด/สายแบบ aggregate ตามช่วงเวลาและขอบเขตสิทธิ์',
    sensitivityClass: 'AGGREGATE',
    formats: ['CSV'],
    fieldBundles: [
      {
        code: 'daily-summary',
        label: 'รายวัน',
        description: 'สรุปจำนวนและอัตราตามวันโดยไม่รวมข้อมูล PII รายคน',
      },
    ],
    supportedFilters: [
      'province',
      'district',
      'subDistrict',
      'schoolId',
      'grade',
      'room',
      'dateRange',
    ],
    requiredPermissions: ['export-data', 'attendance-dashboard'],
    deliveryMode: 'ASYNC_JOB',
    status: 'AVAILABLE',
  },
  {
    code: 'case_summary',
    label: 'สรุปเคสช่วยเหลือ',
    description: 'จำนวนเคสตามสถานะ SLA พื้นที่ และช่วงเวลา โดยไม่รวมบันทึกละเอียด',
    sensitivityClass: 'AGGREGATE',
    formats: ['CSV'],
    fieldBundles: [
      {
        code: 'status-summary',
        label: 'สรุปสถานะ',
        description: 'จำนวนเคสตามสถานะและ SLA bucket',
      },
    ],
    supportedFilters: ['province', 'district', 'subDistrict', 'schoolId', 'status', 'dateRange'],
    requiredPermissions: ['export-data', 'review-cases'],
    deliveryMode: 'ASYNC_JOB',
    status: 'AVAILABLE',
  },
  {
    code: 'case_operational',
    label: 'เคสช่วยเหลือเชิงปฏิบัติการ',
    description:
      'ข้อมูลติดตามงานเคสแบบลดข้อมูลอ่อนไหว ใช้ case reference, สถานะ, due/SLA และ outcome; ไม่รวมบันทึก ที่อยู่ พิกัด หรือลิงก์ลับ',
    sensitivityClass: 'SENSITIVE_OPERATIONAL',
    formats: ['CSV'],
    fieldBundles: [
      {
        code: 'operational-minimum',
        label: 'ขั้นต่ำสำหรับปฏิบัติงาน',
        description: 'case reference, minimum student label, status, due/SLA และ outcome',
      },
    ],
    supportedFilters: ['province', 'district', 'subDistrict', 'schoolId', 'status', 'dateRange'],
    requiredPermissions: ['export-data', 'review-cases'],
    deliveryMode: 'ASYNC_JOB',
    status: 'AVAILABLE',
  },
  {
    code: 'import_quarantine',
    label: 'รายการกักกันจากการนำเข้า',
    description: 'ใช้ workflow export เดิมของ import quarantine พร้อม masked identifier และ audit',
    sensitivityClass: 'SENSITIVE_OPERATIONAL',
    formats: ['CSV'],
    fieldBundles: [
      {
        code: 'existing-quarantine-workflow',
        label: 'ตามตัวกรอง quarantine',
        description: 'field set ถูกควบคุมโดย workflow import quarantine เดิม',
      },
    ],
    supportedFilters: ['importTarget', 'status', 'reason', 'dateRange'],
    requiredPermissions: ['export-data', 'import-data'],
    deliveryMode: 'EXISTING_WORKFLOW',
    workflowPath: '/import-data/quarantine',
    status: 'AVAILABLE',
  },
];
