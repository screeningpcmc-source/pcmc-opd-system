/**
 * PCMC OPD Workload & Productivity System Types
 * โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (PCMC)
 */

export type StaffPosition = 'HN' | 'RN' | 'PN' | 'NA' | 'Clerk' | 'Service Worker' | 'PCA';

export type StaffStatus = 'Active' | 'Resigned' | 'Retired';

export type WorkShift = 
  | 'ในเวลา 08:00-16:00'
  | 'นอกเวลาเย็น 16:00-20:00'
  | 'นอกเวลาวันหยุด 08:00-12:00'
  | 'OT ในเวลาราชการ 08:00-16:00';

export type LeaveType = string;

export interface StaffMember {
  staffId: string;
  name: string;
  position: StaffPosition;
  homeClinic: string;
  status: StaffStatus;
  startDate?: string; // วันที่เริ่มปฏิบัติงาน (YYYY-MM-DD)
  endDate?: string; // วันที่ลาออก/เกษียณ (YYYY-MM-DD)
}

export interface DailyWorkload {
  id: string;
  date: string; // YYYY-MM-DD
  shift: WorkShift;
  clinic: string;
  totalPt: number;
  adultPt: number;
  childPt: number;
  admit: number;
  hn: number;
  rn: number;
  pn: number;
  na: number;
  pca?: number;
  clerk: number;
  serviceWorker: number;
  note: string;
  reporter: string;
  timestamp?: string;
}

export interface LeaveRecord {
  id: string;
  startDate: string;
  endDate: string;
  staffName: string;
  position: StaffPosition;
  clinic: string;
  leaveType: LeaveType;
  days: number;
  note?: string;
}

export interface OTAttendance {
  id: string;
  date: string;
  shift: WorkShift;
  staffName: string;
  position: StaffPosition;
  homeClinic: string;
  workClinic: string;
  isExternal?: boolean; // true if substitute staff from outside OPD
  affiliation?: string; // สังกัด / หน่วยงานต้นสังกัด
}

export interface CustomHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface SystemSettings {
  nhppd: number; // default 0.4
  stdHr: number; // default 7
  annualHr: number; // default 2080
  workDays: number; // default 245
  adminEmails: string[];
  adminPin?: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  inTimeClinics?: string[];
  outTimeClinics?: string[];
  leaveTypes?: string[];
  customHolidays?: CustomHoliday[];
  autoSync?: boolean;
}

export const IN_TIME_CLINICS = [
  'กุมารเวชกรรม',
  'สูติ-นรีเวชกรรม',
  'ศัลยกรรมกระดูก',
  'เวชศาสตร์ฟื้นฟู',
  'ศัลยกรรม',
  'จักษุวิทยา',
  'ศูนย์เลสิก',
  'โสต ศอ นาสิก',
  'อายุรกรรม',
  'ตรวจโรคทั่วไป',
  'Echo',
  'AAIRC',
  'ODS',
  'ประกันสังคม',
  'หน่วยคัดกรอง'
] as const;

export const OUT_TIME_CLINICS = [
  'ตรวจโรคทั่วไป',
  'กุมารเวชกรรม',
  'สูติ-นรีเวชกรรม',
  'ศัลยกรรมกระดูก',
  'ศัลยกรรม',
  'จักษุวิทยา',
  'โสต ศอ นาสิก',
  'อายุรกรรม',
  'คลินิกหัวใจ',
  'หน่วยคัดกรอง'
] as const;

export const ALL_POSITIONS: StaffPosition[] = ['HN', 'RN', 'PN', 'NA', 'Clerk', 'Service Worker'];

export const POSITION_LABELS: Record<StaffPosition, string> = {
  HN: 'หัวหน้าพยาบาล/หัวหน้าเวร',
  RN: 'พยาบาลวิชาชีพ',
  PN: 'ผู้ช่วยพยาบาล',
  NA: 'ผู้ช่วยเหลือคนไข้',
  PCA: 'ผู้ช่วยเหลือคนไข้',
  Clerk: 'ผู้ปฏิบัติงานทั่วไป',
  'Service Worker': 'พนักงานบริการ'
};

export const formatPositionLabel = (pos: StaffPosition | string): string => {
  if (pos === 'HN') return 'หัวหน้าพยาบาล/หัวหน้าเวร';
  if (pos === 'RN') return 'พยาบาลวิชาชีพ';
  if (pos === 'PN') return 'ผู้ช่วยพยาบาล';
  if (pos === 'NA' || pos === 'PCA') return 'ผู้ช่วยเหลือคนไข้';
  if (pos === 'Clerk') return 'ผู้ปฏิบัติงานทั่วไป';
  if (pos === 'Service Worker') return 'พนักงานบริการ';
  return pos;
};

export const POSITION_SORT_ORDER: Record<StaffPosition, number> = {
  HN: 1,
  RN: 2,
  PN: 3,
  NA: 4,
  PCA: 4,
  Clerk: 5,
  'Service Worker': 6,
};

export const compareStaffByPositionAndStartDate = (
  a: Pick<StaffMember, 'position' | 'startDate' | 'name'>,
  b: Pick<StaffMember, 'position' | 'startDate' | 'name'>
): number => {
  const rankA = POSITION_SORT_ORDER[a.position] ?? 99;
  const rankB = POSITION_SORT_ORDER[b.position] ?? 99;
  if (rankA !== rankB) return rankA - rankB;

  const startA = (a.startDate || '').trim();
  const startB = (b.startDate || '').trim();
  if (startA && startB && startA !== startB) {
    return startA.localeCompare(startB);
  }
  if (startA && !startB) return -1;
  if (!startA && startB) return 1;

  return (a.name || '').localeCompare(b.name || '', 'th');
};

export const LEAVE_TYPES: LeaveType[] = [
  'ลาป่วย',
  'ลากิจ',
  'ลาพักผ่อน',
  'ลาคลอด',
  'ลาบวช',
  'ลาศึกษาต่อ',
  'ไปอบรม/ประชุม'
];

export const REGULAR_LEAVE_TYPES: LeaveType[] = [
  'ลาป่วย',
  'ลากิจ',
  'ลาพักผ่อน',
  'ลาคลอด',
  'ลาบวช',
  'ลาศึกษาต่อ'
];

export const WORKLOAD_SHIFTS: WorkShift[] = [
  'ในเวลา 08:00-16:00',
  'นอกเวลาเย็น 16:00-20:00',
  'นอกเวลาวันหยุด 08:00-12:00'
];

export const OT_SHIFTS: { value: WorkShift; label: string }[] = [
  { value: 'นอกเวลาเย็น 16:00-20:00', label: 'นอกเวลาเย็น 16:00-20:00' },
  { value: 'นอกเวลาวันหยุด 08:00-12:00', label: 'นอกเวลาวันหยุด 08:00-12:00' },
  { value: 'OT ในเวลาราชการ 08:00-16:00', label: 'OT ในเวลาราชการ 08:00-16:00 (มาปฏิบัติหน้าที่แทน)' }
];

export const SHIFTS: WorkShift[] = [
  'ในเวลา 08:00-16:00',
  'นอกเวลาเย็น 16:00-20:00',
  'นอกเวลาวันหยุด 08:00-12:00',
  'OT ในเวลาราชการ 08:00-16:00'
];

export const getEffectiveTotalPt = (
  w: Pick<DailyWorkload, 'totalPt' | 'adultPt' | 'childPt'>
): number => {
  const total = Number(w.totalPt) || 0;
  const adult = Number(w.adultPt) || 0;
  const child = Number(w.childPt) || 0;
  return Math.max(total, adult + child);
};

