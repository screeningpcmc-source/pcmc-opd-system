/**
 * PCMC OPD Workload & Productivity System Types
 * โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (PCMC)
 */

export type StaffPosition =
  | 'HN'
  | 'RN'
  | 'PN'
  | 'NA'
  | 'Clerk'
  | 'Clerk (Referral)'
  | 'Service Worker'
  | 'RN (Daily Wage)'
  | 'PN (Daily Wage)'
  | 'NA (Daily Wage)'
  | 'Clerk (Daily Wage)'
  | 'Service Worker (Daily Wage)'
  | 'PCA';

export const DAILY_WAGE_POSITIONS: StaffPosition[] = [
  'RN (Daily Wage)',
  'PN (Daily Wage)',
  'NA (Daily Wage)',
  'Clerk (Daily Wage)',
  'Service Worker (Daily Wage)',
];

export const isDailyWagePosition = (pos?: string): boolean => {
  const compact = (pos || '').trim().replace(/\s+/g, ' ');
  if (!compact) return false;
  return (
    compact === 'RN (Daily Wage)' ||
    compact === 'PN (Daily Wage)' ||
    compact === 'NA (Daily Wage)' ||
    compact === 'PCA (Daily Wage)' ||
    compact === 'Clerk (Daily Wage)' ||
    compact === 'Service Worker (Daily Wage)' ||
    compact === 'Daily Wage' ||
    compact === 'Daily Nurse' ||
    compact === 'Daily Hire' ||
    compact.includes('จ้างรายวัน')
  );
};

export const normalizeStaffPosition = (pos?: string): StaffPosition => {
  const trimmed = (pos || '').trim().replace(/\s+/g, ' ');
  if (trimmed === 'PCA') return 'NA';
  if (
    trimmed === 'RN (Daily Wage)' ||
    trimmed === 'พยาบาล(จ้างรายวัน)' ||
    trimmed === 'พยาบาล (จ้างรายวัน)' ||
    trimmed === 'พยาบาลวิชาชีพ(จ้างรายวัน)' ||
    trimmed === 'พยาบาลวิชาชีพ (จ้างรายวัน)' ||
    trimmed === 'Daily Wage' ||
    trimmed === 'Daily Nurse' ||
    trimmed === 'Daily Hire' ||
    trimmed === 'จ้างรายวัน' ||
    trimmed === 'พยาบาลจ้างรายวัน'
  ) {
    return 'RN (Daily Wage)';
  }
  if (
    trimmed === 'PN (Daily Wage)' ||
    trimmed === 'ผู้ช่วยพยาบาล(จ้างรายวัน)' ||
    trimmed === 'ผู้ช่วยพยาบาล (จ้างรายวัน)'
  ) {
    return 'PN (Daily Wage)';
  }
  if (
    trimmed === 'NA (Daily Wage)' ||
    trimmed === 'PCA (Daily Wage)' ||
    trimmed === 'ผู้ช่วยคนไข้(จ้างรายวัน)' ||
    trimmed === 'ผู้ช่วยคนไข้ (จ้างรายวัน)' ||
    trimmed === 'ผู้ช่วยเหลือคนไข้(จ้างรายวัน)' ||
    trimmed === 'ผู้ช่วยเหลือคนไข้ (จ้างรายวัน)'
  ) {
    return 'NA (Daily Wage)';
  }
  if (
    trimmed === 'Clerk (Daily Wage)' ||
    trimmed === 'ผู้ปฏิบัติงานทั่วไป(จ้างรายวัน)' ||
    trimmed === 'ผู้ปฏิบัติงานทั่วไป (จ้างรายวัน)'
  ) {
    return 'Clerk (Daily Wage)';
  }
  if (
    trimmed === 'Service Worker (Daily Wage)' ||
    trimmed === 'พนักงานบริการ(จ้างรายวัน)' ||
    trimmed === 'พนักงานบริการ (จ้างรายวัน)'
  ) {
    return 'Service Worker (Daily Wage)';
  }
  if (
    trimmed === 'Clerk (Referral)' ||
    trimmed === 'ผู้ปฏิบัติงานทั่วไป (ศูนย์รับ-ส่งต่อผู้ป่วย)' ||
    trimmed === 'ผู้ปฏิบัติงานทั่วไป(ศูนย์รับ-ส่งต่อผู้ป่วย)' ||
    trimmed === 'ผู้ปฏิบัติงานทั่วไป (ศูนย์รับ - ส่งต่อผู้ป่วย)' ||
    trimmed === 'ผู้ปฏิบัติงานทั่วไป (ศูนย์รับ-ส่งต่อ)' ||
    trimmed === 'ผู้ปฏิบัติงานทั่วไป(ศูนย์รับ-ส่งต่อ)' ||
    trimmed === 'ผู้ปฏิบัติงานทั่วไป (ศูนย์รับ-ส่งต่อผู้ป่วย • เทียบเท่า NA)' ||
    (trimmed.includes('ผู้ปฏิบัติงานทั่วไป') && trimmed.includes('ศูนย์รับ'))
  ) {
    return 'Clerk (Referral)';
  }
  if (
    trimmed === 'HN' ||
    trimmed === 'RN' ||
    trimmed === 'PN' ||
    trimmed === 'NA' ||
    trimmed === 'Clerk' ||
    trimmed === 'Service Worker'
  ) {
    return trimmed;
  }
  return 'RN';
};

export const isNaEquivalentPosition = (pos?: string): boolean => {
  const norm = normalizeStaffPosition(pos);
  return norm === 'NA' || norm === 'PCA' || norm === 'Clerk (Referral)' || norm === 'NA (Daily Wage)';
};

/** Maps daily-wage and equivalent special positions to their core workload bucket while keeping Staff_Master/OT role distinct. */
export const getWorkloadRolePosition = (pos?: string): StaffPosition => {
  const norm = normalizeStaffPosition(pos);
  if (norm === 'RN (Daily Wage)') return 'RN';
  if (norm === 'PN (Daily Wage)') return 'PN';
  if (norm === 'NA (Daily Wage)' || norm === 'PCA' || norm === 'Clerk (Referral)') return 'NA';
  if (norm === 'Clerk (Daily Wage)') return 'Clerk';
  if (norm === 'Service Worker (Daily Wage)') return 'Service Worker';
  return norm;
};

export type StaffStatus = 'Active' | 'Resigned' | 'Retired';

export type WorkShift = 
  | 'ในเวลา 08:00-16:00'
  | 'นอกเวลาเย็น 16:00-20:00'
  | 'นอกเวลาวันหยุด 08:00-12:00'
  | 'OT ในเวลาราชการ 08:00-16:00';

export type LeaveType = string;

export interface StaffMember {
  staffId: string;
  employeeCode?: string; // รหัสบุคลากร (ใช้ค่าเดียวกับ Staff_ID เช่น 20708302)
  name: string;
  position: StaffPosition;
  homeClinic: string;
  status: StaffStatus;
  startDate?: string; // วันที่เริ่มปฏิบัติงาน (YYYY-MM-DD)
  endDate?: string; // วันที่ลาออก/เกษียณ (YYYY-MM-DD)
}

export function isLegacyGeneratedStaffId(id?: string): boolean {
  const s = (id || '').trim();
  return !s || /^STF-/i.test(s);
}

export function isValidEmployeeCodeValue(code?: string): boolean {
  const s = (code || '').trim();
  if (!s) return false;
  if (/^STF-/i.test(s)) return false;
  if (s === 'External' || s === 'OPD' || s === '-') return false;
  return true;
}

export function getStaffEmployeeCode(
  staff?: Pick<StaffMember, 'staffId' | 'employeeCode'> | null
): string {
  if (!staff) return '';
  const emp = (staff.employeeCode || '').trim();
  if (isValidEmployeeCodeValue(emp)) return emp;
  const sid = (staff.staffId || '').trim();
  if (isValidEmployeeCodeValue(sid)) return sid;
  return '';
}

export type WorkloadRecordType = 'STANDARD' | 'PREMIUM_POOL' | 'PREMIUM_SUB';

export const PREMIUM_CLINIC_GROUP = 'ศูนย์ปัญญาภิรมย์';
export const LEGACY_PREMIUM_CLINIC_GROUP = 'คลินิกพิเศษ PREMIUM';
export const PREMIUM_POOL_CLINIC_NAME = 'ศูนย์ปัญญาภิรมย์ (กำลังคนรวม)';
export const LEGACY_PREMIUM_POOL_CLINIC_NAME = 'คลินิกพิเศษ PREMIUM (กำลังคนรวม)';

export const DEFAULT_PREMIUM_SUB_CLINICS = [
  'อายุรกรรม-Premium',
  'ศัลยกรรม-Premium',
  'จักษุวิทยา-Premium',
  'โสต ศอ นาสิก-Premium',
  'ศัลยกรรม-กระดูก-Premium',
  'เวชศาสตร์ฟื้นฟู-Premium',
  'กุมารเวชกรรม-Premium',
  'สูติ-นรีเวชกรรม-Premium',
  'คลินิกหัวใจฯ-Premium',
  'คลินิกภูมิแพ้ฯ-Premium',
  'จิตเวช-Premium',
  'เวชศาสตร์ครอบครัว-Premium',
] as const;

export const REFERRAL_CLINIC_NAME = 'ศูนย์รับ - ส่งต่อผู้ป่วย';

export type ReferralItemKey =
  | 'admitPrivate'
  | 'admitGeneral'
  | 'referIn'
  | 'referOut'
  | 'reservePrivateRoom'
  | 'cancelPrivateRoom';

export interface ReferralItemEntry {
  count: number;
  reason: string;
}

export type ReferralCenterData = Record<ReferralItemKey, ReferralItemEntry>;

export const REFERRAL_ITEM_DEFINITIONS: { key: ReferralItemKey; label: string }[] = [
  { key: 'admitPrivate', label: 'Admit พิเศษ' },
  { key: 'admitGeneral', label: 'Admit สามัญ' },
  { key: 'referIn', label: 'Refer in' },
  { key: 'referOut', label: 'Refer out' },
  { key: 'reservePrivateRoom', label: 'จองห้องพิเศษ' },
  { key: 'cancelPrivateRoom', label: 'ยกเลิกห้องพิเศษ' },
];

export function createEmptyReferralData(): ReferralCenterData {
  return {
    admitPrivate: { count: 0, reason: '' },
    admitGeneral: { count: 0, reason: '' },
    referIn: { count: 0, reason: '' },
    referOut: { count: 0, reason: '' },
    reservePrivateRoom: { count: 0, reason: '' },
    cancelPrivateRoom: { count: 0, reason: '' },
  };
}

export function normalizeReferralData(raw?: Partial<Record<string, any>> | null): ReferralCenterData {
  const base = createEmptyReferralData();
  if (!raw || typeof raw !== 'object') return base;
  REFERRAL_ITEM_DEFINITIONS.forEach(({ key }) => {
    const entry = raw[key];
    if (entry && typeof entry === 'object') {
      const cnt = Number(entry.count);
      base[key] = {
        count: Number.isFinite(cnt) && cnt >= 0 ? cnt : 0,
        reason: typeof entry.reason === 'string' ? entry.reason.trim() : '',
      };
    }
  });
  return base;
}

export function getReferralTotalCount(data?: ReferralCenterData | null): number {
  if (!data) return 0;
  return REFERRAL_ITEM_DEFINITIONS.reduce((sum, { key }) => sum + (Number(data[key]?.count) || 0), 0);
}

export function getReferralAdmitCount(data?: ReferralCenterData | null): number {
  if (!data) return 0;
  return (Number(data.admitPrivate?.count) || 0) + (Number(data.admitGeneral?.count) || 0);
}

export function isReferralClinicName(clinic?: string): boolean {
  return (clinic || '').trim() === REFERRAL_CLINIC_NAME;
}

export type OffDutyPeriodLabel = HalfDayPeriod | 'ครึ่งเวร';

export interface OffDutyStaffEntry {
  staffName: string;
  position: StaffPosition;
  amount: 1 | 0.5;
  periodLabel?: OffDutyPeriodLabel;
  reason?: string;
}

export const OFF_DUTY_REASON_PRESETS = [
  'ยอดผู้ป่วยน้อยลง (Off เวรรายวัน)',
  'ยอดผู้ป่วยน้อยลง (Off ครึ่งเวร)',
  'ปรับลดอัตรากำลังรายวันตามปริมาณผู้ป่วย',
] as const;

export const OFF_DUTY_STAFF_REASON_PRESETS = [
  'ยอดผู้ป่วยน้อยลง (Off เวรรายวัน)',
  'ยอดผู้ป่วยน้อยลง (Off ครึ่งเวร)',
  'ปรับลดอัตรากำลังรายวันตามปริมาณผู้ป่วย',
] as const;

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
  clinicGroup?: string;
  poolId?: string;
  recordType?: WorkloadRecordType;
  referralData?: ReferralCenterData;
  isOffDuty?: boolean;
  offDutyReason?: string;
  offDutyStaff?: OffDutyStaffEntry[];
  timestamp?: string;
  lastEditedAt?: string;
  lastEditReason?: string;
  lastEditedBy?: string;
}

export function isReferralWorkload(
  w: Pick<DailyWorkload, 'clinic' | 'referralData'>
): boolean {
  return isReferralClinicName(w.clinic) || Boolean(w.referralData);
}

const REFERRAL_TAG_REGEX = /\[\[REFERRAL_JSON:([\s\S]*?)\]\]/;
const OFF_DUTY_TAG_REGEX = /\[\[OFF_DUTY_JSON:([\s\S]*?)\]\]/;
const OFF_STAFF_TAG_REGEX = /\[\[OFF_STAFF_JSON:([\s\S]*?)\]\]/;

export function stripReferralTagFromNote(note?: string): string {
  return (note || '')
    .replace(REFERRAL_TAG_REGEX, '')
    .replace(OFF_DUTY_TAG_REGEX, '')
    .replace(OFF_STAFF_TAG_REGEX, '')
    .trim();
}

export function stripAllWorkloadTagsFromNote(note?: string): string {
  return stripReferralTagFromNote(note);
}

export function normalizeOffDutyStaffEntries(raw?: any): OffDutyStaffEntry[] {
  if (!Array.isArray(raw)) return [];
  const list: OffDutyStaffEntry[] = [];
  raw.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const staffName = String(item.staffName || item.n || '').trim();
    if (!staffName) return;
    const rawPos = String(item.position || item.p || 'RN').trim();
    const amt = Number(item.amount ?? item.a) === 0.5 ? 0.5 : 1;
    const rawPeriod = String(item.periodLabel || item.l || '').trim();
    const periodLabel: OffDutyPeriodLabel =
      rawPeriod === 'ครึ่งวันเช้า' || rawPeriod === 'ครึ่งวันบ่าย' || rawPeriod === 'ครึ่งเวร'
        ? rawPeriod
        : amt === 0.5
        ? 'ครึ่งเวร'
        : '';
    const reason = String(item.reason || item.r || '').trim();
    list.push({
      staffName,
      position: normalizeStaffPosition(rawPos),
      amount: amt,
      ...(amt === 0.5 && periodLabel ? { periodLabel } : {}),
      ...(reason ? { reason } : {}),
    });
  });
  return list;
}

export function parseWorkloadMetaFromSheetNote(rawNote?: string): {
  cleanNote: string;
  referralData?: ReferralCenterData;
  isOffDuty: boolean;
  offDutyReason?: string;
  offDutyStaff?: OffDutyStaffEntry[];
} {
  const txt = (rawNote || '').trim();
  if (!txt) return { cleanNote: '', isOffDuty: false };

  let referralData: ReferralCenterData | undefined;
  const refMatch = txt.match(REFERRAL_TAG_REGEX);
  if (refMatch) {
    try {
      referralData = normalizeReferralData(JSON.parse(refMatch[1]));
    } catch {
      referralData = undefined;
    }
  }

  let isOffDuty = false;
  let offDutyReason: string | undefined;
  const offDutyMatch = txt.match(OFF_DUTY_TAG_REGEX);
  if (offDutyMatch) {
    isOffDuty = true;
    try {
      const parsed = JSON.parse(offDutyMatch[1]);
      const r = typeof parsed?.r === 'string' ? parsed.r.trim() : typeof parsed?.reason === 'string' ? parsed.reason.trim() : '';
      if (r) offDutyReason = r;
    } catch {
      // keep isOffDuty = true
    }
  }

  let offDutyStaff: OffDutyStaffEntry[] | undefined;
  const offStaffMatch = txt.match(OFF_STAFF_TAG_REGEX);
  if (offStaffMatch) {
    try {
      const parsed = normalizeOffDutyStaffEntries(JSON.parse(offStaffMatch[1]));
      if (parsed.length > 0) offDutyStaff = parsed;
    } catch {
      offDutyStaff = undefined;
    }
  }

  const cleanNote = stripAllWorkloadTagsFromNote(txt);
  return {
    cleanNote,
    ...(referralData ? { referralData } : {}),
    isOffDuty,
    ...(offDutyReason ? { offDutyReason } : {}),
    ...(offDutyStaff && offDutyStaff.length > 0 ? { offDutyStaff } : {}),
  };
}

export function parseReferralFromSheetNote(rawNote?: string): {
  cleanNote: string;
  referralData?: ReferralCenterData;
} {
  const parsed = parseWorkloadMetaFromSheetNote(rawNote);
  return {
    cleanNote: parsed.cleanNote,
    ...(parsed.referralData ? { referralData: parsed.referralData } : {}),
  };
}

export function isOffDutyWorkload(
  w?: Pick<DailyWorkload, 'isOffDuty' | 'note'> | null
): boolean {
  if (!w) return false;
  if (w.isOffDuty) return true;
  return OFF_DUTY_TAG_REGEX.test(w.note || '');
}

export function getWorkloadOffDutyReason(
  w?: Pick<DailyWorkload, 'offDutyReason' | 'note'> | null
): string {
  if (!w) return '';
  if ((w.offDutyReason || '').trim()) return (w.offDutyReason || '').trim();
  const parsed = parseWorkloadMetaFromSheetNote(w.note);
  return parsed.offDutyReason || '';
}

export function getWorkloadOffDutyStaff(
  w?: Pick<DailyWorkload, 'offDutyStaff' | 'note'> | null
): OffDutyStaffEntry[] {
  if (!w) return [];
  if (Array.isArray(w.offDutyStaff) && w.offDutyStaff.length > 0) {
    return normalizeOffDutyStaffEntries(w.offDutyStaff);
  }
  return parseWorkloadMetaFromSheetNote(w.note).offDutyStaff || [];
}

export function getCanonicalOffDutyStaffSignature(entries?: OffDutyStaffEntry[] | null): string {
  if (!entries || entries.length === 0) return '';
  return entries
    .map(
      (e) =>
        `${(e.staffName || '').trim()}:${e.position}:${e.amount}:${(e.periodLabel || '').trim()}:${(
          e.reason || ''
        ).trim()}`
    )
    .join(';');
}

export function formatOffDutyStaffSummaryText(entries?: OffDutyStaffEntry[] | null): string {
  if (!entries || entries.length === 0) return '';
  return entries
    .map((e) => {
      const halfSuffix =
        e.amount === 0.5 ? ` 0.5 ${e.periodLabel || 'ครึ่งเวร'}` : '';
      const posSuffix = isDailyWagePosition(e.position) ? ' [รายวัน]' : '';
      const rSuffix = e.reason ? ` - ${e.reason}` : '';
      return `${e.staffName}${posSuffix} (Off เวร${halfSuffix}${rSuffix})`;
    })
    .join(', ');
}

export function formatWorkloadNoteForSheet(
  note?: string,
  referralData?: ReferralCenterData,
  offDutyMeta?: {
    isOffDuty?: boolean;
    offDutyReason?: string;
    offDutyStaff?: OffDutyStaffEntry[];
  }
): string {
  const parts: string[] = [];
  const cleaned = stripAllWorkloadTagsFromNote(note);
  if (cleaned) parts.push(cleaned);

  if (referralData) {
    const normalized = normalizeReferralData(referralData);
    const compact: Record<string, { count: number; reason: string }> = {};
    REFERRAL_ITEM_DEFINITIONS.forEach(({ key }) => {
      compact[key] = {
        count: Number(normalized[key]?.count) || 0,
        reason: (normalized[key]?.reason || '').trim(),
      };
    });
    parts.push(`[[REFERRAL_JSON:${JSON.stringify(compact)}]]`);
  }

  if (offDutyMeta?.isOffDuty) {
    const reason = (offDutyMeta.offDutyReason || '').trim();
    parts.push(`[[OFF_DUTY_JSON:${JSON.stringify({ r: reason })}]]`);
  }

  const normalizedStaff = normalizeOffDutyStaffEntries(offDutyMeta?.offDutyStaff);
  if (normalizedStaff.length > 0) {
    const compactStaff = normalizedStaff.map((s) => ({
      n: s.staffName,
      p: s.position,
      a: s.amount,
      ...(s.amount === 0.5 && s.periodLabel ? { l: s.periodLabel } : {}),
      ...(s.reason ? { r: s.reason } : {}),
    }));
    parts.push(`[[OFF_STAFF_JSON:${JSON.stringify(compactStaff)}]]`);
  }

  return parts.join(' ');
}

export function formatReferralSummaryText(data?: ReferralCenterData | null): string {
  if (!data) return '';
  return REFERRAL_ITEM_DEFINITIONS.map(({ key, label }) => {
    const item = data[key] || { count: 0, reason: '' };
    const cnt = Number(item.count) || 0;
    const reason = (item.reason || '').trim();
    return reason ? `${label} ${cnt} (${reason})` : `${label} ${cnt}`;
  }).join(', ');
}

export function getCanonicalReferralSignature(data?: ReferralCenterData | null): string {
  if (!data) return '';
  return REFERRAL_ITEM_DEFINITIONS.map(({ key }) => {
    const item = data[key];
    return `${key}:${Number(item?.count) || 0}:${(item?.reason || '').trim()}`;
  }).join(';');
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
  lastEditedAt?: string;
  lastEditReason?: string;
  lastEditedBy?: string;
}

export interface OTAttendance {
  id: string;
  date: string;
  shift: WorkShift;
  staffName: string;
  employeeCode?: string; // รหัสบุคลากร
  position: StaffPosition;
  homeClinic: string;
  workClinic: string;
  hours?: number; // จำนวนชั่วโมงที่ปฏิบัติงานจริง (เช่น 4, 4.5, 5, 6, 7, 8)
  isExternal?: boolean; // true if substitute staff from outside OPD
  affiliation?: string; // สังกัด / หน่วยงานต้นสังกัด
  lastEditedAt?: string;
  lastEditReason?: string;
  lastEditedBy?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: 'แก้ไขวันลา' | 'ลบวันลา' | 'แก้ไขเวร OT' | 'ลบเวร OT' | 'แก้ไขภาระงาน' | 'ลบภาระงาน';
  targetName: string;
  summary: string;
  reason: string;
  editedBy?: string;
}

export interface AdminPinEntry {
  id: string;
  ownerName: string;
  pin: string; // empty = uses built-in hashed slot code
}

export interface CustomHoliday {
  date: string; // YYYY-MM-DD
  name: string;
}

export interface SystemSettings {
  nhppd: number; // default 0.4 (all clinics except หน่วยคัดกรอง)
  screeningNhppd?: number; // default 0.1 (เฉพาะหน่วยคัดกรอง)
  stdHr: number; // default 7
  annualHr: number; // default 2080
  workDays: number; // default 245
  adminEmails: string[];
  adminPin?: string;
  primaryAdminOwner?: string;
  additionalAdminPins?: AdminPinEntry[];
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  gasUrl?: string;
  isUnlinked?: boolean;
  inTimeClinics?: string[];
  outTimeClinics?: string[];
  premiumSubClinics?: string[];
  leaveTypes?: string[];
  customHolidays?: CustomHoliday[];
  autoSync?: boolean;
  defaultCostCenter?: string;
  clinicCostCenters?: Record<string, string>;
  otHourlyRates?: Partial<Record<StaffPosition, number>>;
  otControllerName?: string;
  // LINE Messaging API Daily Patient Report Automation
  lineAutoEnabled?: boolean;
  lineAutoTime?: string; // Default '03:59' (Asia/Bangkok)
  lineAutoReportDayMode?: 'YESTERDAY' | 'TODAY' | 'LATEST_WITH_DATA';
  lineAutoShift?: 'ALL' | WorkShift;
  lineTargetId?: string;
  lineChannelTokenSet?: boolean;
  lineLastSentAt?: string;
  lineLastSentReportDate?: string;
  lineLastStatus?: string;
  lineDetectedGroupId?: string;
  lineDetectedGroupName?: string;
}

export const DEFAULT_LINE_AUTO_TIME = '03:59';
export const DEFAULT_LINE_GROUP_ID = 'C21630721218bccf814848fcf793e1746';
export type LineAutoReportDayMode = 'YESTERDAY' | 'TODAY' | 'LATEST_WITH_DATA';

export const DEFAULT_OT_COST_CENTER = '2012000000';
export const DEFAULT_OT_CONTROLLER_NAME = 'นางสาว ประภัสสร พันธุ์วา';

export const DEFAULT_OT_HOURLY_RATES: Record<StaffPosition, number> = {
  HN: 150,
  RN: 150,
  'RN (Daily Wage)': 150,
  PN: 95,
  'PN (Daily Wage)': 95,
  NA: 95,
  PCA: 95,
  'NA (Daily Wage)': 95,
  Clerk: 75,
  'Clerk (Referral)': 75,
  'Clerk (Daily Wage)': 75,
  'Service Worker': 75,
  'Service Worker (Daily Wage)': 75,
};

export function getOtHourlyRate(
  position: StaffPosition | string,
  customRates?: Partial<Record<StaffPosition, number>>
): number {
  const norm = normalizeStaffPosition(position);
  const custom = Number(customRates?.[norm]);
  if (Number.isFinite(custom) && custom > 0) return custom;
  return DEFAULT_OT_HOURLY_RATES[norm] ?? 95;
}

export function getDefaultOtHoursForShift(shift?: WorkShift | string, stdHr: number = 7): number {
  const s = (shift || '').trim();
  if (s === 'นอกเวลาเย็น 16:00-20:00' || s === 'นอกเวลาวันหยุด 08:00-12:00') {
    return 4;
  }
  if (s === 'OT ในเวลาราชการ 08:00-16:00' || s === 'ในเวลา 08:00-16:00') {
    return Number.isFinite(stdHr) && stdHr > 0 ? stdHr : 7;
  }
  return 4;
}

export function formatOtPaySheetPositionLabel(pos: StaffPosition | string): string {
  const norm = normalizeStaffPosition(pos);
  if (norm === 'HN' || norm === 'RN' || norm === 'RN (Daily Wage)') return 'พยาบาล';
  if (norm === 'PN' || norm === 'PN (Daily Wage)') return 'ผู้ช่วยพยาบาล';
  if (norm === 'NA' || norm === 'PCA' || norm === 'NA (Daily Wage)') return 'ผู้ช่วยคนไข้';
  if (norm === 'Clerk' || norm === 'Clerk (Referral)' || norm === 'Clerk (Daily Wage)') return 'ผู้ปฏิบัติงานทั่วไป';
  if (norm === 'Service Worker' || norm === 'Service Worker (Daily Wage)') return 'พนักงานบริการ';
  return pos;
}

export const SCREENING_CLINIC_NAME = 'หน่วยคัดกรอง';
export const DEFAULT_SCREENING_NHPPD = 0.1;

export function isPremiumGroupName(group?: string): boolean {
  const g = (group || '').trim();
  return g === PREMIUM_CLINIC_GROUP || g === LEGACY_PREMIUM_CLINIC_GROUP;
}

export function isPremiumPoolClinicName(clinic?: string): boolean {
  const c = (clinic || '').trim();
  return c === PREMIUM_POOL_CLINIC_NAME || c === LEGACY_PREMIUM_POOL_CLINIC_NAME;
}

export function isPremiumWorkloadRecord(
  w: Pick<DailyWorkload, 'clinic' | 'clinicGroup' | 'recordType'>,
  premiumSubClinics?: string[]
): boolean {
  const clinic = (w.clinic || '').trim();
  if (w.recordType === 'PREMIUM_POOL' || w.recordType === 'PREMIUM_SUB') return true;
  if (isPremiumGroupName(w.clinicGroup)) return true;
  if (isPremiumPoolClinicName(clinic)) return true;
  if (/-Premium$/i.test(clinic)) return true;
  if (premiumSubClinics && premiumSubClinics.includes(clinic)) return true;
  if (w.recordType !== 'STANDARD' && (clinic === PREMIUM_CLINIC_GROUP || clinic === LEGACY_PREMIUM_CLINIC_GROUP)) {
    return true;
  }
  return false;
}

export function normalizeWorkloadRecord(
  w: DailyWorkload,
  premiumSubClinics?: string[]
): DailyWorkload {
  const clinic = (w.clinic || '').trim();
  const subList =
    premiumSubClinics && premiumSubClinics.length > 0
      ? premiumSubClinics
      : [...DEFAULT_PREMIUM_SUB_CLINICS];
  const fallbackPoolId = (w.poolId || '').trim() || `POOL-${w.date}-${w.shift}`;

  const parsedFromNote = parseWorkloadMetaFromSheetNote(w.note);
  const resolvedReferralData = w.referralData
    ? normalizeReferralData(w.referralData)
    : parsedFromNote.referralData;
  const resolvedIsOffDuty = Boolean(w.isOffDuty) || parsedFromNote.isOffDuty;
  const resolvedOffDutyReason =
    (w.offDutyReason || '').trim() || parsedFromNote.offDutyReason || '';
  const resolvedOffDutyStaff =
    Array.isArray(w.offDutyStaff) && w.offDutyStaff.length > 0
      ? normalizeOffDutyStaffEntries(w.offDutyStaff)
      : parsedFromNote.offDutyStaff;
  const cleanedNote = parsedFromNote.cleanNote;

  const offDutyExtras: Partial<DailyWorkload> = {
    ...(resolvedIsOffDuty ? { isOffDuty: true } : {}),
    ...(resolvedIsOffDuty && resolvedOffDutyReason
      ? { offDutyReason: resolvedOffDutyReason }
      : {}),
    ...(resolvedOffDutyStaff && resolvedOffDutyStaff.length > 0
      ? { offDutyStaff: resolvedOffDutyStaff }
      : {}),
  };

  if (w.recordType === 'PREMIUM_POOL' || isPremiumPoolClinicName(clinic)) {
    return {
      ...w,
      note: cleanedNote,
      ...(resolvedReferralData ? { referralData: resolvedReferralData } : {}),
      ...offDutyExtras,
      clinicGroup: PREMIUM_CLINIC_GROUP,
      poolId: fallbackPoolId,
      recordType: 'PREMIUM_POOL',
    };
  }

  if (
    w.recordType === 'PREMIUM_SUB' ||
    isPremiumGroupName(w.clinicGroup) ||
    /-Premium$/i.test(clinic) ||
    subList.includes(clinic)
  ) {
    return {
      ...w,
      note: cleanedNote,
      ...(resolvedReferralData ? { referralData: resolvedReferralData } : {}),
      ...offDutyExtras,
      clinicGroup: PREMIUM_CLINIC_GROUP,
      poolId: fallbackPoolId,
      recordType: 'PREMIUM_SUB',
    };
  }

  return {
    ...w,
    note: cleanedNote,
    ...(resolvedReferralData ? { referralData: resolvedReferralData } : {}),
    ...offDutyExtras,
    clinicGroup: w.clinicGroup || '',
    poolId: w.poolId || '',
    recordType: w.recordType || 'STANDARD',
  };
}

export function getClinicNhppd(
  clinicName: string,
  settings?: Pick<SystemSettings, 'nhppd' | 'screeningNhppd'>
): number {
  const normalized = (clinicName || '').trim();
  if (normalized === SCREENING_CLINIC_NAME) {
    const val = Number(settings?.screeningNhppd);
    return val > 0 ? val : DEFAULT_SCREENING_NHPPD;
  }
  const general = Number(settings?.nhppd);
  return general > 0 ? general : 0.4;
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
  'หน่วยคัดกรอง',
  'ศูนย์รับ - ส่งต่อผู้ป่วย'
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

export const ALL_POSITIONS: StaffPosition[] = [
  'HN',
  'RN',
  'PN',
  'NA',
  'Clerk',
  'Clerk (Referral)',
  'Service Worker',
  'RN (Daily Wage)',
  'PN (Daily Wage)',
  'NA (Daily Wage)',
  'Clerk (Daily Wage)',
  'Service Worker (Daily Wage)',
];

export const POSITION_LABELS: Record<StaffPosition, string> = {
  HN: 'หัวหน้าพยาบาล/หัวหน้าเวร',
  RN: 'พยาบาลวิชาชีพ',
  PN: 'ผู้ช่วยพยาบาล',
  NA: 'ผู้ช่วยเหลือคนไข้',
  PCA: 'ผู้ช่วยเหลือคนไข้',
  Clerk: 'ผู้ปฏิบัติงานทั่วไป',
  'Clerk (Referral)': 'ผู้ปฏิบัติงานทั่วไป (ศูนย์รับ-ส่งต่อผู้ป่วย • เทียบเท่า NA)',
  'Service Worker': 'พนักงานบริการ',
  'RN (Daily Wage)': 'พยาบาล(จ้างรายวัน)',
  'PN (Daily Wage)': 'ผู้ช่วยพยาบาล(จ้างรายวัน)',
  'NA (Daily Wage)': 'ผู้ช่วยคนไข้(จ้างรายวัน)',
  'Clerk (Daily Wage)': 'ผู้ปฏิบัติงานทั่วไป(จ้างรายวัน)',
  'Service Worker (Daily Wage)': 'พนักงานบริการ(จ้างรายวัน)',
};

export const formatPositionLabel = (pos: StaffPosition | string): string => {
  if (pos === 'HN') return 'หัวหน้าพยาบาล/หัวหน้าเวร';
  if (pos === 'RN') return 'พยาบาลวิชาชีพ';
  if (pos === 'PN') return 'ผู้ช่วยพยาบาล';
  if (pos === 'NA' || pos === 'PCA') return 'ผู้ช่วยเหลือคนไข้';
  if (pos === 'Clerk') return 'ผู้ปฏิบัติงานทั่วไป';
  if (pos === 'Clerk (Referral)') return 'ผู้ปฏิบัติงานทั่วไป (ศูนย์รับ-ส่งต่อ)';
  if (pos === 'Service Worker') return 'พนักงานบริการ';
  if (pos === 'RN (Daily Wage)' || pos === 'Daily Wage' || pos === 'จ้างรายวัน') {
    return 'พยาบาล(จ้างรายวัน)';
  }
  if (pos === 'PN (Daily Wage)') return 'ผู้ช่วยพยาบาล(จ้างรายวัน)';
  if (pos === 'NA (Daily Wage)') return 'ผู้ช่วยคนไข้(จ้างรายวัน)';
  if (pos === 'Clerk (Daily Wage)') return 'ผู้ปฏิบัติงานทั่วไป(จ้างรายวัน)';
  if (pos === 'Service Worker (Daily Wage)') return 'พนักงานบริการ(จ้างรายวัน)';
  if (isDailyWagePosition(pos)) return POSITION_LABELS[normalizeStaffPosition(pos)];
  return pos;
};

export const POSITION_SORT_ORDER: Record<StaffPosition, number> = {
  HN: 1,
  RN: 2,
  PN: 3,
  NA: 4,
  PCA: 4,
  Clerk: 5,
  'Clerk (Referral)': 6,
  'Service Worker': 7,
  'RN (Daily Wage)': 8,
  'PN (Daily Wage)': 9,
  'NA (Daily Wage)': 10,
  'Clerk (Daily Wage)': 11,
  'Service Worker (Daily Wage)': 12,
};

export const compareStaffByPositionAndStartDate = (
  a: Pick<StaffMember, 'position' | 'startDate' | 'name'> & { status?: StaffStatus },
  b: Pick<StaffMember, 'position' | 'startDate' | 'name'> & { status?: StaffStatus }
): number => {
  const statusRank = (s?: StaffStatus) => (s === 'Resigned' || s === 'Retired' ? 1 : 0);
  const statDiff = statusRank(a.status) - statusRank(b.status);
  if (statDiff !== 0) return statDiff;

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

export type HalfDayPeriod = '' | 'ครึ่งวันเช้า' | 'ครึ่งวันบ่าย';

export const isTrainingLeaveType = (leaveType?: string): boolean =>
  (leaveType || '').trim() === 'ไปอบรม/ประชุม';

export function parseLeavePeriodFromNote(note?: string): HalfDayPeriod {
  const txt = (note || '').trim();
  if (!txt) return '';
  if (/ครึ่งวันเช้า/.test(txt)) return 'ครึ่งวันเช้า';
  if (/ครึ่งวันบ่าย/.test(txt)) return 'ครึ่งวันบ่าย';
  return '';
}

export function stripLeavePeriodFromNote(note?: string): string {
  return (note || '')
    .replace(/\[(ครึ่งวันเช้า|ครึ่งวันบ่าย)\]\s*/g, '')
    .replace(/\((ครึ่งวันเช้า|ครึ่งวันบ่าย)\)\s*/g, '')
    .trim();
}

export function formatLeaveNoteWithPeriod(note: string, days: number, periodLabel?: HalfDayPeriod): string {
  const cleaned = stripLeavePeriodFromNote(note);
  if (days === 0.5 && (periodLabel === 'ครึ่งวันเช้า' || periodLabel === 'ครึ่งวันบ่าย')) {
    return cleaned ? `[${periodLabel}] ${cleaned}` : `[${periodLabel}]`;
  }
  return cleaned;
}

export function parseOtWorkClinic(raw?: string): {
  clinic: string;
  amount: number;
  periodLabel: HalfDayPeriod;
  hours?: number;
} {
  let txt = (raw || '').trim();
  if (!txt) return { clinic: '', amount: 1, periodLabel: '' };

  let parsedHours: number | undefined;
  const hrMatch = txt.match(/^(.*?)\s*\((\d+(?:\.\d+)?)\s*ชม\.\)\s*$/);
  if (hrMatch) {
    const h = Number(hrMatch[2]);
    if (Number.isFinite(h) && h > 0) {
      parsedHours = h;
      txt = hrMatch[1].trim();
    }
  }

  const m = txt.match(/^(.*?)\s*\(0\.5\s*(ครึ่งวันเช้า|ครึ่งวันบ่าย|เช้า|บ่าย)\)\s*$/);
  if (m) {
    const clinic = m[1].trim();
    const p: HalfDayPeriod = m[2].includes('บ่าย') ? 'ครึ่งวันบ่าย' : 'ครึ่งวันเช้า';
    return {
      clinic,
      amount: 0.5,
      periodLabel: p,
      ...(parsedHours !== undefined ? { hours: parsedHours } : {}),
    };
  }
  return {
    clinic: txt,
    amount: 1,
    periodLabel: '',
    ...(parsedHours !== undefined ? { hours: parsedHours } : {}),
  };
}

export function formatOtWorkClinicValue(
  clinic: string,
  amount: number = 1,
  periodLabel?: HalfDayPeriod
): string {
  const parsed = parseOtWorkClinic(clinic);
  const clean = parsed.clinic;
  if (!clean) return '';
  if (amount === 0.5 && (periodLabel === 'ครึ่งวันเช้า' || periodLabel === 'ครึ่งวันบ่าย')) {
    return `${clean} (0.5 ${periodLabel})`;
  }
  return clean;
}

export function formatOtWorkClinicForSheet(
  rawWorkClinic: string,
  hours?: number,
  shift?: WorkShift | string
): string {
  const parsed = parseOtWorkClinic(rawWorkClinic);
  const baseClinic = formatOtWorkClinicValue(parsed.clinic, parsed.amount, parsed.periodLabel);
  if (!baseClinic) return '';
  const defaultHrs = getDefaultOtHoursForShift(shift);
  const effectiveHrs =
    hours !== undefined && Number.isFinite(Number(hours)) && Number(hours) > 0
      ? Number(hours)
      : parsed.hours;
  if (effectiveHrs !== undefined && Math.abs(effectiveHrs - defaultHrs) > 0.001) {
    return `${baseClinic} (${effectiveHrs} ชม.)`;
  }
  return baseClinic;
}

export function getEffectiveOtHours(
  ot: Pick<OTAttendance, 'hours' | 'shift' | 'workClinic'>,
  stdHr: number = 7
): number {
  const explicit = Number(ot.hours);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const parsed = parseOtWorkClinic(ot.workClinic);
  if (parsed.hours !== undefined && parsed.hours > 0) return parsed.hours;
  return getDefaultOtHoursForShift(ot.shift, stdHr);
}

export interface WorkloadLeavePayload {
  staffName: string;
  leaveType: LeaveType;
  days?: number;
  periodLabel?: HalfDayPeriod;
  note: string;
}

export interface WorkloadCrossCoveragePayload {
  direction?: 'outgoing' | 'incoming';
  staffName: string;
  position?: StaffPosition;
  homeClinic?: string;
  targetClinic: string;
  amount?: number;
  periodLabel?: HalfDayPeriod;
  isExternal?: boolean;
  affiliation?: string;
  shift?: WorkShift;
}

export interface WorkloadTrainingPayload {
  staffName: string;
  days?: number;
  periodLabel?: HalfDayPeriod;
  topic: string;
  note: string;
}

export function isOtDuplicateConflict(
  existing: Pick<OTAttendance, 'id' | 'date' | 'shift' | 'staffName' | 'workClinic'>,
  candidate: Pick<OTAttendance, 'date' | 'shift' | 'staffName' | 'workClinic'>,
  excludeId?: string
): boolean {
  if (excludeId && existing.id === excludeId) return false;
  const exName = (existing.staffName || '').trim().replace(/\s+/g, ' ');
  const caName = (candidate.staffName || '').trim().replace(/\s+/g, ' ');
  if (!exName || !caName || exName !== caName) return false;
  if ((existing.date || '').trim() !== (candidate.date || '').trim()) return false;
  if ((existing.shift || '').trim() !== (candidate.shift || '').trim()) return false;
  const exParsed = parseOtWorkClinic(existing.workClinic);
  const caParsed = parseOtWorkClinic(candidate.workClinic);
  if (exParsed.amount >= 1 || caParsed.amount >= 1) return true;
  if (!exParsed.periodLabel || !caParsed.periodLabel) return true;
  return exParsed.periodLabel === caParsed.periodLabel;
}
