import {
  StaffMember,
  DailyWorkload,
  LeaveRecord,
  OTAttendance,
  SystemSettings,
  LEAVE_TYPES,
  DEFAULT_PREMIUM_SUB_CLINICS,
  DEFAULT_LINE_AUTO_TIME
} from '../types';
import { DEFAULT_PRIMARY_ADMIN_OWNER, buildDefaultAdditionalAdminPins } from '../services/adminSecurity';

export const DEFAULT_SPREADSHEET_ID = '1eldsoTvmVIDsKo9BJO2_Nvzjnemi805jpla5Qdc1Ys8';
export const DEFAULT_SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${DEFAULT_SPREADSHEET_ID}/edit`;
export const DEFAULT_GAS_URL =
  'https://script.google.com/macros/s/AKfycby6HA3-VEtckDuEmppJihqeEFxFlFujzXZsic6Vtl_S7DWqZ4NUMABduHtpQvXjWIdZcQ/exec';

export const INITIAL_SETTINGS: SystemSettings = {
  nhppd: 0.4,
  screeningNhppd: 0.1,
  stdHr: 7,
  annualHr: 2080,
  workDays: 245,
  adminEmails: ['screening.pcmc@gmail.com', 'admin.opd@pcmc.ac.th', 'headnurse@pcmc.ac.th'],
  adminPin: '',
  primaryAdminOwner: DEFAULT_PRIMARY_ADMIN_OWNER,
  additionalAdminPins: buildDefaultAdditionalAdminPins(),
  spreadsheetId: DEFAULT_SPREADSHEET_ID,
  spreadsheetUrl: DEFAULT_SPREADSHEET_URL,
  gasUrl: DEFAULT_GAS_URL,
  isUnlinked: false,
  inTimeClinics: [
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
  ],
  outTimeClinics: [
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
  ],
  premiumSubClinics: [...DEFAULT_PREMIUM_SUB_CLINICS],
  leaveTypes: [...LEAVE_TYPES],
  customHolidays: [],
  autoSync: true,
  lineAutoEnabled: false,
  lineAutoTime: DEFAULT_LINE_AUTO_TIME,
  lineAutoReportDayMode: 'YESTERDAY',
  lineAutoShift: 'ALL',
  lineTargetId: '',
  lineChannelTokenSet: false,
};

// Production mode: start with empty data ready for real hospital records
export const INITIAL_STAFF_LIST: StaffMember[] = [];

export const INITIAL_WORKLOADS: DailyWorkload[] = [];

export const INITIAL_LEAVES: LeaveRecord[] = [];

export const INITIAL_OT: OTAttendance[] = [];
