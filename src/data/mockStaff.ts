import { StaffMember, DailyWorkload, LeaveRecord, OTAttendance, SystemSettings, LEAVE_TYPES } from '../types';

export const INITIAL_SETTINGS: SystemSettings = {
  nhppd: 0.4,
  stdHr: 7,
  annualHr: 2080,
  workDays: 245,
  adminEmails: ['screening.pcmc@gmail.com', 'admin.opd@pcmc.ac.th', 'headnurse@pcmc.ac.th'],
  adminPin: '',
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
    'หน่วยคัดกรอง'
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
  leaveTypes: [...LEAVE_TYPES],
  customHolidays: [],
  autoSync: true
};

// Production mode: start with empty data ready for real hospital records
export const INITIAL_STAFF_LIST: StaffMember[] = [];

export const INITIAL_WORKLOADS: DailyWorkload[] = [];

export const INITIAL_LEAVES: LeaveRecord[] = [];

export const INITIAL_OT: OTAttendance[] = [];
