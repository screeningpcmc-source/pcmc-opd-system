import {
  StaffMember,
  StaffPosition,
  StaffStatus,
  DailyWorkload,
  LeaveRecord,
  OTAttendance,
  AuditLogEntry,
  AdminPinEntry,
  SystemSettings,
  WorkShift,
  LeaveType,
  IN_TIME_CLINICS,
  OUT_TIME_CLINICS,
  DEFAULT_PREMIUM_SUB_CLINICS,
  LEAVE_TYPES,
  WorkloadRecordType,
  REFERRAL_CLINIC_NAME,
  formatWorkloadNoteForSheet,
  formatOtWorkClinicForSheet,
  formatOtWorkClinicValue,
  getCanonicalReferralSignature,
  getEffectiveOtHours,
  getEffectiveTotalPt,
  normalizeWorkloadRecord,
  normalizeStaffPosition,
  parseOtWorkClinic,
  parseWorkloadMetaFromSheetNote,
  isOffDutyWorkload,
  getWorkloadOffDutyReason,
  getWorkloadOffDutyStaff,
  getCanonicalOffDutyStaffSignature,
  DEFAULT_OT_COST_CENTER,
  DEFAULT_OT_CONTROLLER_NAME,
  getStaffEmployeeCode,
  isLegacyGeneratedStaffId,
  isValidEmployeeCodeValue,
  DEFAULT_LINE_AUTO_TIME,
  DEFAULT_LINE_GROUP_ID,
  LineAutoReportDayMode,
  LineTargetGroup,
  LineReportSchedule,
  DEFAULT_LINE_TARGET_GROUPS,
  DEFAULT_LINE_SCHEDULES,
  normalizeLineTimeString,
  LineSendFormat,
  resolveLineSendFormat,
  DEFAULT_BOOBY_OWNER_NAME,
  normalizeWorkloadDateStr,
  normalizeWorkloadShiftStr,
} from '../types';
import {
  INITIAL_STAFF_LIST,
  INITIAL_WORKLOADS,
  INITIAL_LEAVES,
  INITIAL_OT,
  INITIAL_SETTINGS
} from '../data/mockStaff';
import {
  DEFAULT_PRIMARY_ADMIN_OWNER,
  buildDefaultAdditionalAdminPins
} from './adminSecurity';

export interface AppDatabase {
  staff: StaffMember[];
  workloads: DailyWorkload[];
  leaves: LeaveRecord[];
  ot: OTAttendance[];
  auditLogs: AuditLogEntry[];
  settings: SystemSettings;
}

const STORAGE_KEY = 'pcmc_opd_system_db_v1';
const STAFF_DIRTY_KEY = 'pcmc_staff_master_dirty_v1';
const SETTINGS_DIRTY_KEY = 'pcmc_settings_dirty_v1';
const WORKLOADS_DIRTY_KEY = 'pcmc_workloads_dirty_v1';
const LEAVES_DIRTY_KEY = 'pcmc_leaves_dirty_v1';
const OT_DIRTY_KEY = 'pcmc_ot_dirty_v1';
const TOMBSTONES_STORAGE_KEY = 'pcmc_deleted_tombstones_v1';
const PENDING_OUTBOX_KEY = 'pcmc_pending_outbox_v1';
const DEMO_PURGED_KEY = 'pcmc_demo_data_purged_v1';
export const REFERRAL_CLINIC_REMOVED_KEY = 'pcmc_referral_clinic_removed_v1';

export function markReferralClinicRemovedByAdmin(removed: boolean): void {
  try {
    if (removed) {
      localStorage.setItem(REFERRAL_CLINIC_REMOVED_KEY, 'true');
    } else {
      localStorage.removeItem(REFERRAL_CLINIC_REMOVED_KEY);
    }
  } catch {
    // ignore
  }
}

function ensureReferralInClinicList(list?: string[]): string[] {
  const base = Array.isArray(list) && list.length > 0 ? [...list] : [...IN_TIME_CLINICS];
  try {
    if (localStorage.getItem(REFERRAL_CLINIC_REMOVED_KEY) === 'true') {
      return base;
    }
  } catch {
    // ignore
  }
  if (!base.includes(REFERRAL_CLINIC_NAME)) {
    base.push(REFERRAL_CLINIC_NAME);
  }
  return base;
}

function encodeWorkloadNoteForSheet(w: DailyWorkload): string {
  const isOffDuty = isOffDutyWorkload(w);
  const offDutyReason = getWorkloadOffDutyReason(w);
  const offDutyStaff = getWorkloadOffDutyStaff(w);
  return formatWorkloadNoteForSheet(w.note, w.referralData, {
    isOffDuty,
    offDutyReason,
    offDutyStaff,
  });
}

function prepareWorkloadForRemote(w: DailyWorkload): DailyWorkload {
  return {
    ...w,
    note: encodeWorkloadNoteForSheet(w),
  };
}

function prepareOtForRemote(o: OTAttendance): OTAttendance {
  return {
    ...o,
    workClinic: formatOtWorkClinicForSheet(o.workClinic, o.hours, o.shift),
    hours: getEffectiveOtHours(o),
  };
}

function buildStaffEmployeeCodesMap(staff: StaffMember[]): Record<string, string> {
  const out: Record<string, string> = {};
  (staff || []).forEach((s) => {
    const code = getStaffEmployeeCode(s);
    if (code && s.name) {
      out[code] = code;
      out[s.name.trim()] = code;
    }
  });
  return out;
}

function prepareStaffForRemote(s: StaffMember): StaffMember {
  const code = getStaffEmployeeCode(s);
  return {
    ...s,
    staffId: code || s.staffId,
    employeeCode: code || undefined,
  };
}

function prepareStaffRowForSheet(s: StaffMember): string[] {
  const code = getStaffEmployeeCode(s);
  return [
    code || s.staffId,
    s.name,
    s.position,
    s.homeClinic,
    s.status,
    s.startDate || '',
    s.endDate || '',
    code,
  ];
}

function hydrateUnifiedStaffAndOt(
  staffList: StaffMember[],
  otList: OTAttendance[],
  extraCodeMap?: Record<string, string> | null
): { staff: StaffMember[]; ot: OTAttendance[] } {
  const otCodeByName = new Map<string, string>();
  (otList || []).forEach((o) => {
    if (o.isExternal) return;
    const name = (o.staffName || '').trim();
    const code = (o.employeeCode || '').trim();
    if (name && isValidEmployeeCodeValue(code) && !otCodeByName.has(name)) {
      otCodeByName.set(name, code);
    }
  });

  const usedStaffIds = new Set<string>();
  const normalizedStaff: StaffMember[] = (staffList || []).map((s) => {
    const cleanName = (s.name || '').trim();
    const rawId = (s.staffId || '').trim();
    const directCode = getStaffEmployeeCode(s);
    const mapCode =
      (rawId && extraCodeMap?.[rawId]) ||
      (cleanName && extraCodeMap?.[cleanName]) ||
      '';
    const otCode = cleanName ? otCodeByName.get(cleanName) || '' : '';

    let chosenCode = '';
    if (isValidEmployeeCodeValue(directCode)) {
      chosenCode = directCode;
    } else if (isValidEmployeeCodeValue(mapCode)) {
      chosenCode = mapCode.trim();
    } else if (isValidEmployeeCodeValue(otCode)) {
      chosenCode = otCode.trim();
    }

    let finalStaffId = rawId || `STF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    if (chosenCode && !usedStaffIds.has(chosenCode)) {
      finalStaffId = chosenCode;
      usedStaffIds.add(chosenCode);
    } else if (chosenCode) {
      // Keep original unique fallback if another record already claimed this code
      usedStaffIds.add(finalStaffId);
    } else {
      usedStaffIds.add(finalStaffId);
    }

    return {
      ...s,
      staffId: finalStaffId,
      employeeCode: chosenCode || undefined,
      name: cleanName || s.name,
      position: normalizeStaffPosition(s.position),
    };
  });

  const staffCodeByName = new Map<string, string>();
  normalizedStaff.forEach((s) => {
    const code = getStaffEmployeeCode(s);
    const cleanName = (s.name || '').trim();
    if (cleanName && code && !staffCodeByName.has(cleanName)) {
      staffCodeByName.set(cleanName, code);
    }
  });

  const normalizedOt: OTAttendance[] = (otList || []).map((o) => {
    if (o.isExternal) return o;
    const cleanName = (o.staffName || '').trim();
    const matchedCode = cleanName ? staffCodeByName.get(cleanName) || '' : '';
    const existingCode = isValidEmployeeCodeValue(o.employeeCode)
      ? (o.employeeCode || '').trim()
      : '';
    const finalCode = matchedCode || existingCode;
    if (finalCode === (o.employeeCode || '').trim()) return o;
    return {
      ...o,
      ...(finalCode ? { employeeCode: finalCode } : { employeeCode: undefined }),
    };
  });

  return { staff: normalizedStaff, ot: normalizedOt };
}

function parseJsonRecordSafe<T = Record<string, any>>(raw?: string): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function parseJsonArraySafe<T = any>(raw?: string): T[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function parseSheetOtRecord(r: string[], fallbackId: string, staffList?: StaffMember[]): OTAttendance {
  const rawPos = (r[3] || 'RN').trim();
  const shift = String(r[1] || 'นอกเวลาเย็น 16:00-20:00').trim() as WorkShift;
  const rawWorkClinic = String(r[5] || '').trim();
  const parsedClinic = parseOtWorkClinic(rawWorkClinic);
  const cleanWorkClinic = formatOtWorkClinicValue(
    parsedClinic.clinic,
    parsedClinic.amount,
    parsedClinic.periodLabel
  );
  const colHours = Number(r[6]);
  const hours =
    Number.isFinite(colHours) && colHours > 0
      ? colHours
      : parsedClinic.hours;
  const rawCode = String(r[7] || '').trim();
  const staffName = String(r[2] || '').trim();
  const matchedStaff = staffList?.find((s) => s.name.trim() === staffName);
  const matchedStaffCode = getStaffEmployeeCode(matchedStaff);
  const employeeCode = matchedStaffCode || (isValidEmployeeCodeValue(rawCode) ? rawCode : undefined);

  return {
    id: fallbackId,
    date: String(r[0] || '').trim(),
    shift,
    staffName,
    employeeCode,
    position: normalizeStaffPosition(rawPos),
    homeClinic: String(r[4] || '').trim(),
    workClinic: cleanWorkClinic,
    ...(hours !== undefined ? { hours } : {}),
  };
}

function buildSettingsSheetRows(settings: SystemSettings, staffList?: StaffMember[]): string[][] {
  const rows: string[][] = [
    ['Key', 'Value'],
    ['NHPPD', settings.nhppd.toString()],
    ['Screening_NHPPD', (settings.screeningNhppd ?? 0.1).toString()],
    ['Std_Hr', settings.stdHr.toString()],
    ['Annual_Hr', settings.annualHr.toString()],
    ['Work_Days', settings.workDays.toString()],
    ['Admin_Emails', settings.adminEmails.join(', ')],
    ['In_Time_Clinics', (settings.inTimeClinics || []).join(', ')],
    ['Out_Time_Clinics', (settings.outTimeClinics || []).join(', ')],
    ['Premium_Sub_Clinics', (settings.premiumSubClinics || [...DEFAULT_PREMIUM_SUB_CLINICS]).join(', ')],
    ['Leave_Types', (settings.leaveTypes || [...LEAVE_TYPES]).join(', ')],
    ['Custom_Holidays', JSON.stringify(settings.customHolidays || [])],
    ['Primary_Admin_Owner', settings.primaryAdminOwner || DEFAULT_PRIMARY_ADMIN_OWNER],
    ['Additional_Admin_Pins', JSON.stringify(settings.additionalAdminPins || buildDefaultAdditionalAdminPins())],
    ['Gas_Web_App_URL', settings.gasUrl || ''],
    ['Default_Cost_Center', (settings.defaultCostCenter || DEFAULT_OT_COST_CENTER).trim()],
    ['Clinic_Cost_Centers', JSON.stringify(settings.clinicCostCenters || {})],
    ['OT_Hourly_Rates', JSON.stringify(settings.otHourlyRates || {})],
    ['OT_Controller_Name', (settings.otControllerName || DEFAULT_OT_CONTROLLER_NAME).trim()],
    ['Line_Auto_Enabled', settings.lineAutoEnabled ? 'true' : 'false'],
    ['Line_Auto_Time', normalizeLineTimeString(settings.lineAutoTime, DEFAULT_LINE_AUTO_TIME)],
    ['Line_Auto_Report_Day', settings.lineAutoReportDayMode || 'TODAY'],
    ['Line_Auto_Shift', settings.lineAutoShift || 'ในเวลา 08:00-16:00'],
    ['Line_Target_Id', (settings.lineTargetId || DEFAULT_LINE_GROUP_ID).trim()],
    ['Line_Target_Groups', JSON.stringify(settings.lineTargetGroups || DEFAULT_LINE_TARGET_GROUPS)],
    ['Line_Schedules', JSON.stringify(settings.lineSchedules || DEFAULT_LINE_SCHEDULES)],
    ['Line_Send_As_Image', settings.lineSendAsImage !== false ? 'true' : 'false'],
    ['Line_Send_Format', resolveLineSendFormat(settings.lineSendFormat, settings.lineSendAsImage)],
    ['Booby_Owner_Name', (settings.boobyOwnerName || DEFAULT_BOOBY_OWNER_NAME).trim()],
    ['Booby_Owner_User_ID', (settings.boobyOwnerUserId || '').trim()],
    ['Booby_Group_Mention_Only', settings.boobyGroupMentionOnly !== false ? 'true' : 'false'],
  ];
  const codeMap = buildStaffEmployeeCodesMap(staffList || []);
  if (Object.keys(codeMap).length > 0) {
    rows.push(['Staff_Employee_Codes', JSON.stringify(codeMap)]);
  }
  return rows;
}

export function computeChangedSettingsEntries(
  prevSettings: SystemSettings,
  nextSettings: SystemSettings
): Array<[string, string]> {
  const prevRows = buildSettingsSheetRows(prevSettings).slice(1);
  const nextRows = buildSettingsSheetRows(nextSettings).slice(1);
  const prevMap = new Map<string, string>();
  prevRows.forEach(([k, v]) => {
    if (k) prevMap.set(k, v ?? '');
  });
  const changed: Array<[string, string]> = [];
  nextRows.forEach(([k, v]) => {
    if (!k) return;
    if (prevMap.get(k) !== (v ?? '')) {
      changed.push([k, v ?? '']);
    }
  });
  if (
    typeof nextSettings.adminPin === 'string' &&
    nextSettings.adminPin.trim() &&
    nextSettings.adminPin.trim() !== (prevSettings.adminPin || '').trim()
  ) {
    changed.push(['Admin_Pin', nextSettings.adminPin.trim()]);
  }
  return changed;
}

const isDemoStaffId = (id?: string) => /^STF-\d{3}$/.test((id || '').trim());
const isDemoWorkloadId = (id?: string) => /^WL-\d{3}$/.test((id || '').trim());
const isDemoLeaveId = (id?: string) => /^LV-\d{3}$/.test((id || '').trim());
const isDemoOtId = (id?: string) => /^OT-\d{3}$/.test((id || '').trim());

type DirtyDomain = 'staff' | 'settings' | 'workloads' | 'leaves' | 'ot';

const DIRTY_KEY_MAP: Record<DirtyDomain, string> = {
  staff: STAFF_DIRTY_KEY,
  settings: SETTINGS_DIRTY_KEY,
  workloads: WORKLOADS_DIRTY_KEY,
  leaves: LEAVES_DIRTY_KEY,
  ot: OT_DIRTY_KEY,
};

function readStoredDirtyVersion(storageKey: string): number {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return 0;
    if (raw === 'true') return 1;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

const memDirtyVersions: Record<DirtyDomain, number> = {
  staff: readStoredDirtyVersion(STAFF_DIRTY_KEY),
  settings: readStoredDirtyVersion(SETTINGS_DIRTY_KEY),
  workloads: readStoredDirtyVersion(WORKLOADS_DIRTY_KEY),
  leaves: readStoredDirtyVersion(LEAVES_DIRTY_KEY),
  ot: readStoredDirtyVersion(OT_DIRTY_KEY),
};

function getDomainDirtyVersion(domain: DirtyDomain): number {
  const stored = readStoredDirtyVersion(DIRTY_KEY_MAP[domain]);
  if (stored > memDirtyVersions[domain]) {
    memDirtyVersions[domain] = stored;
  }
  return memDirtyVersions[domain];
}

function markDomainDirty(domain: DirtyDomain): number {
  const next = getDomainDirtyVersion(domain) + 1;
  memDirtyVersions[domain] = next;
  try {
    localStorage.setItem(DIRTY_KEY_MAP[domain], String(next));
  } catch {
    // ignore storage errors; in-memory version still protects current session
  }
  return next;
}

function clearDomainDirty(domain: DirtyDomain, expectedVersion?: number): void {
  const current = getDomainDirtyVersion(domain);
  if (expectedVersion !== undefined && current !== expectedVersion) {
    return;
  }
  memDirtyVersions[domain] = 0;
  try {
    localStorage.removeItem(DIRTY_KEY_MAP[domain]);
  } catch {
    // ignore
  }
}

export const getStaffMasterDirtyVersion = (): number => getDomainDirtyVersion('staff');
export const markStaffMasterDirty = (): number => markDomainDirty('staff');
export const clearStaffMasterDirty = (expectedVersion?: number): void =>
  clearDomainDirty('staff', expectedVersion);
export const isStaffMasterDirty = (): boolean => getDomainDirtyVersion('staff') > 0;

export const getSettingsDirtyVersion = (): number => getDomainDirtyVersion('settings');
export const markSettingsDirty = (): number => markDomainDirty('settings');
export const clearSettingsDirty = (expectedVersion?: number): void =>
  clearDomainDirty('settings', expectedVersion);
export const isSettingsDirty = (): boolean => getDomainDirtyVersion('settings') > 0;

export const getWorkloadsDirtyVersion = (): number => getDomainDirtyVersion('workloads');
export const markWorkloadsDirty = (): number => markDomainDirty('workloads');
export const clearWorkloadsDirty = (expectedVersion?: number): void =>
  clearDomainDirty('workloads', expectedVersion);
export const isWorkloadsDirty = (): boolean => getDomainDirtyVersion('workloads') > 0;

export const getLeavesDirtyVersion = (): number => getDomainDirtyVersion('leaves');
export const markLeavesDirty = (): number => markDomainDirty('leaves');
export const clearLeavesDirty = (expectedVersion?: number): void =>
  clearDomainDirty('leaves', expectedVersion);
export const isLeavesDirty = (): boolean => getDomainDirtyVersion('leaves') > 0;

export const getOtDirtyVersion = (): number => getDomainDirtyVersion('ot');
export const markOtDirty = (): number => markDomainDirty('ot');
export const clearOtDirty = (expectedVersion?: number): void =>
  clearDomainDirty('ot', expectedVersion);
export const isOtDirty = (): boolean => getDomainDirtyVersion('ot') > 0;

interface DeletedTombstonesState {
  workloads: Record<string, number>;
  leaves: Record<string, number>;
  ot: Record<string, number>;
}

const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function pruneExpiredTombstones(raw: Partial<DeletedTombstonesState> | null): DeletedTombstonesState {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  const cleanBucket = (bucket: unknown): Record<string, number> => {
    if (!bucket || typeof bucket !== 'object') return {};
    const out: Record<string, number> = {};
    Object.entries(bucket as Record<string, unknown>).forEach(([k, ts]) => {
      const n = Number(ts);
      if (k && Number.isFinite(n) && n >= cutoff) {
        out[k] = n;
      }
    });
    return out;
  };
  return {
    workloads: cleanBucket(raw?.workloads),
    leaves: cleanBucket(raw?.leaves),
    ot: cleanBucket(raw?.ot),
  };
}

let memTombstones: DeletedTombstonesState = (() => {
  try {
    const raw = localStorage.getItem(TOMBSTONES_STORAGE_KEY);
    if (raw) {
      return pruneExpiredTombstones(JSON.parse(raw));
    }
  } catch {
    // ignore
  }
  return { workloads: {}, leaves: {}, ot: {} };
})();

function persistTombstones(): void {
  try {
    localStorage.setItem(TOMBSTONES_STORAGE_KEY, JSON.stringify(memTombstones));
  } catch {
    // ignore
  }
}

export const getDeletedWorkloadKeySet = (): Set<string> => {
  memTombstones = pruneExpiredTombstones(memTombstones);
  return new Set(Object.keys(memTombstones.workloads));
};

export const getDeletedLeaveKeySet = (): Set<string> => {
  memTombstones = pruneExpiredTombstones(memTombstones);
  return new Set(Object.keys(memTombstones.leaves));
};

export const getDeletedOtKeySet = (): Set<string> => {
  memTombstones = pruneExpiredTombstones(memTombstones);
  return new Set(Object.keys(memTombstones.ot));
};

export const recordDeletedWorkloadTombstone = (w: DailyWorkload): void => {
  const key = getWorkloadKey(w);
  memTombstones.workloads[key] = Date.now();
  persistTombstones();
};

export const clearWorkloadTombstone = (w: DailyWorkload): void => {
  const key = getWorkloadKey(w);
  if (key in memTombstones.workloads) {
    delete memTombstones.workloads[key];
    persistTombstones();
  }
};

export const clearAllWorkloadTombstones = (): void => {
  memTombstones.workloads = {};
  persistTombstones();
};

export const recordDeletedLeaveTombstone = (l: LeaveRecord): void => {
  const key = getLeaveKey(l);
  memTombstones.leaves[key] = Date.now();
  persistTombstones();
};

export const clearLeaveTombstone = (l: LeaveRecord): void => {
  const key = getLeaveKey(l);
  if (key in memTombstones.leaves) {
    delete memTombstones.leaves[key];
    persistTombstones();
  }
};

export const clearAllLeaveTombstones = (): void => {
  memTombstones.leaves = {};
  persistTombstones();
};

export const recordDeletedOtTombstone = (o: OTAttendance): void => {
  const key = getOtKey(o);
  memTombstones.ot[key] = Date.now();
  persistTombstones();
};

export const clearOtTombstone = (o: OTAttendance): void => {
  const key = getOtKey(o);
  if (key in memTombstones.ot) {
    delete memTombstones.ot[key];
    persistTombstones();
  }
};

export const clearAllOtTombstones = (): void => {
  memTombstones.ot = {};
  persistTombstones();
};

export const clearAllTombstones = (): void => {
  memTombstones = { workloads: {}, leaves: {}, ot: {} };
  persistTombstones();
};

interface PendingOutboxState {
  workloads: DailyWorkload[];
  leaves: LeaveRecord[];
  ot: OTAttendance[];
  auditLogs: AuditLogEntry[];
}

const emptyPendingOutbox = (): PendingOutboxState => ({
  workloads: [],
  leaves: [],
  ot: [],
  auditLogs: [],
});

let memPendingOutbox: PendingOutboxState = (() => {
  try {
    const raw = localStorage.getItem(PENDING_OUTBOX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        workloads: Array.isArray(parsed?.workloads) ? parsed.workloads : [],
        leaves: Array.isArray(parsed?.leaves) ? parsed.leaves : [],
        ot: Array.isArray(parsed?.ot) ? parsed.ot : [],
        auditLogs: Array.isArray(parsed?.auditLogs) ? parsed.auditLogs : [],
      };
    }
  } catch {
    // ignore
  }
  return emptyPendingOutbox();
})();

function persistPendingOutbox(): void {
  try {
    localStorage.setItem(PENDING_OUTBOX_KEY, JSON.stringify(memPendingOutbox));
  } catch {
    // ignore storage quota errors
  }
}

function readPendingOutboxFresh(): PendingOutboxState {
  try {
    const raw = localStorage.getItem(PENDING_OUTBOX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      memPendingOutbox = {
        workloads: Array.isArray(parsed?.workloads) ? parsed.workloads : [],
        leaves: Array.isArray(parsed?.leaves) ? parsed.leaves : [],
        ot: Array.isArray(parsed?.ot) ? parsed.ot : [],
        auditLogs: Array.isArray(parsed?.auditLogs) ? parsed.auditLogs : [],
      };
    }
  } catch {
    // ignore
  }
  return memPendingOutbox;
}

export const getPendingOutboxWorkloads = (): DailyWorkload[] => [
  ...readPendingOutboxFresh().workloads,
];

export const getPendingOutboxLeaves = (): LeaveRecord[] => [
  ...readPendingOutboxFresh().leaves,
];

export const getPendingOutboxOt = (): OTAttendance[] => [
  ...readPendingOutboxFresh().ot,
];

export const getPendingOutboxAuditLogs = (): AuditLogEntry[] => [
  ...readPendingOutboxFresh().auditLogs,
];

const inFlightWorkloadSlotKeys = new Set<string>();
const activeWorkloadAppendPromises = new Set<Promise<unknown>>();

export const isWorkloadSlotInFlight = (w: DailyWorkload): boolean =>
  inFlightWorkloadSlotKeys.has(getWorkloadSlotKey(w));

export const waitForInFlightWorkloadAppends = async (): Promise<void> => {
  if (activeWorkloadAppendPromises.size === 0) return;
  try {
    await Promise.allSettled(Array.from(activeWorkloadAppendPromises));
  } catch {
    // ignore
  }
};

export const enqueuePendingOutboxWorkloads = (items: DailyWorkload[]): void => {
  if (!items || items.length === 0) return;
  const box = readPendingOutboxFresh();
  const seenIds = new Set(box.workloads.map((w) => w.id));
  const seenSlots = new Set(box.workloads.map(getWorkloadSlotKey));
  items.forEach((w) => {
    if (!w) return;
    const slotKey = getWorkloadSlotKey(w);
    if (!seenIds.has(w.id) && !seenSlots.has(slotKey)) {
      seenIds.add(w.id);
      seenSlots.add(slotKey);
      box.workloads.push(w);
    }
  });
  memPendingOutbox = box;
  persistPendingOutbox();
};

export const markWorkloadOutboxSynced = (items: DailyWorkload[]): void => {
  if (!items || items.length === 0) return;
  const box = readPendingOutboxFresh();
  const removeIds = new Set(items.map((w) => w.id).filter(Boolean));
  const removeKeys = new Set(items.map(workloadKey));
  const removeSlots = new Set(items.map(getWorkloadSlotKey));
  box.workloads = box.workloads.filter(
    (w) =>
      !removeIds.has(w.id) &&
      !removeKeys.has(workloadKey(w)) &&
      !removeSlots.has(getWorkloadSlotKey(w))
  );
  memPendingOutbox = box;
  persistPendingOutbox();
};

export const enqueuePendingOutboxLeaves = (items: LeaveRecord[]): void => {
  if (!items || items.length === 0) return;
  const box = readPendingOutboxFresh();
  const seenIds = new Set(box.leaves.map((l) => l.id));
  items.forEach((l) => {
    if (l && !seenIds.has(l.id)) {
      seenIds.add(l.id);
      box.leaves.push(l);
    }
  });
  memPendingOutbox = box;
  persistPendingOutbox();
};

export const markLeaveOutboxSynced = (items: LeaveRecord[]): void => {
  if (!items || items.length === 0) return;
  const box = readPendingOutboxFresh();
  const removeIds = new Set(items.map((l) => l.id).filter(Boolean));
  const removeKeys = new Set(items.map(leaveKey));
  box.leaves = box.leaves.filter(
    (l) => !removeIds.has(l.id) && !removeKeys.has(leaveKey(l))
  );
  memPendingOutbox = box;
  persistPendingOutbox();
};

export const enqueuePendingOutboxOt = (items: OTAttendance[]): void => {
  if (!items || items.length === 0) return;
  const box = readPendingOutboxFresh();
  const seenIds = new Set(box.ot.map((o) => o.id));
  items.forEach((o) => {
    if (o && !seenIds.has(o.id)) {
      seenIds.add(o.id);
      box.ot.push(o);
    }
  });
  memPendingOutbox = box;
  persistPendingOutbox();
};

export const markOtOutboxSynced = (items: OTAttendance[]): void => {
  if (!items || items.length === 0) return;
  const box = readPendingOutboxFresh();
  const removeIds = new Set(items.map((o) => o.id).filter(Boolean));
  const removeKeys = new Set(items.map(otKey));
  box.ot = box.ot.filter((o) => !removeIds.has(o.id) && !removeKeys.has(otKey(o)));
  memPendingOutbox = box;
  persistPendingOutbox();
};

export const enqueuePendingOutboxAuditLogs = (items: AuditLogEntry[]): void => {
  if (!items || items.length === 0) return;
  const box = readPendingOutboxFresh();
  const seenIds = new Set(box.auditLogs.map((a) => a.id));
  items.forEach((a) => {
    if (a && !seenIds.has(a.id)) {
      seenIds.add(a.id);
      box.auditLogs.push(a);
    }
  });
  memPendingOutbox = box;
  persistPendingOutbox();
};

export const markAuditOutboxSynced = (items: AuditLogEntry[]): void => {
  if (!items || items.length === 0) return;
  const box = readPendingOutboxFresh();
  const removeIds = new Set(items.map((a) => a.id).filter(Boolean));
  const removeKeys = new Set(items.map(auditLogKey));
  box.auditLogs = box.auditLogs.filter(
    (a) => !removeIds.has(a.id) && !removeKeys.has(auditLogKey(a))
  );
  memPendingOutbox = box;
  persistPendingOutbox();
};

export const clearAllPendingOutbox = (): void => {
  memPendingOutbox = emptyPendingOutbox();
  persistPendingOutbox();
};

// Short-lived optimistic protection cache (90s TTL):
// Ensures newly saved items remain immediately visible across background syncs
// even after outbox removal, preventing brief flicker/delay if remote read lags.
const RECENT_SAVED_TTL_MS = 90 * 1000;
let recentSavedWorkloads: Array<{ key: string; id: string; item: DailyWorkload; expiresAt: number }> = [];
let recentSavedLeaves: Array<{ key: string; id: string; item: LeaveRecord; expiresAt: number }> = [];
let recentSavedOt: Array<{ key: string; id: string; item: OTAttendance; expiresAt: number }> = [];

function pruneExpiredRecentSaved(): void {
  const now = Date.now();
  recentSavedWorkloads = recentSavedWorkloads.filter((x) => x.expiresAt > now);
  recentSavedLeaves = recentSavedLeaves.filter((x) => x.expiresAt > now);
  recentSavedOt = recentSavedOt.filter((x) => x.expiresAt > now);
}

export const markWorkloadsRecentlySaved = (items: DailyWorkload[]): void => {
  if (!items || items.length === 0) return;
  pruneExpiredRecentSaved();
  const expiresAt = Date.now() + RECENT_SAVED_TTL_MS;
  items.forEach((item) => {
    const key = workloadKey(item);
    recentSavedWorkloads = recentSavedWorkloads.filter((x) => x.key !== key && x.id !== item.id);
    recentSavedWorkloads.unshift({ key, id: item.id, item, expiresAt });
  });
};

export const removeWorkloadRecentlySaved = (item: DailyWorkload): void => {
  const key = workloadKey(item);
  recentSavedWorkloads = recentSavedWorkloads.filter((x) => x.key !== key && x.id !== item.id);
};

export const markLeavesRecentlySaved = (items: LeaveRecord[]): void => {
  if (!items || items.length === 0) return;
  pruneExpiredRecentSaved();
  const expiresAt = Date.now() + RECENT_SAVED_TTL_MS;
  items.forEach((item) => {
    const key = leaveKey(item);
    recentSavedLeaves = recentSavedLeaves.filter((x) => x.key !== key && x.id !== item.id);
    recentSavedLeaves.unshift({ key, id: item.id, item, expiresAt });
  });
};

export const removeLeaveRecentlySaved = (item: LeaveRecord): void => {
  const key = leaveKey(item);
  recentSavedLeaves = recentSavedLeaves.filter((x) => x.key !== key && x.id !== item.id);
};

export const markOtRecentlySaved = (items: OTAttendance[]): void => {
  if (!items || items.length === 0) return;
  pruneExpiredRecentSaved();
  const expiresAt = Date.now() + RECENT_SAVED_TTL_MS;
  items.forEach((item) => {
    const key = otKey(item);
    recentSavedOt = recentSavedOt.filter((x) => x.key !== key && x.id !== item.id);
    recentSavedOt.unshift({ key, id: item.id, item, expiresAt });
  });
};

export const removeOtRecentlySaved = (item: OTAttendance): void => {
  const key = otKey(item);
  recentSavedOt = recentSavedOt.filter((x) => x.key !== key && x.id !== item.id);
};

export const clearAllRecentlySaved = (): void => {
  recentSavedWorkloads = [];
  recentSavedLeaves = [];
  recentSavedOt = [];
};

function pruneOutboxSyncedAgainstRemote(params: {
  remoteWKeys?: Set<string>;
  remoteLKeys?: Set<string>;
  remoteOKeys?: Set<string>;
  remoteAuditKeys?: Set<string>;
}): void {
  const box = readPendingOutboxFresh();
  let changed = false;
  if (params.remoteWKeys && box.workloads.length > 0) {
    const next = box.workloads.filter((w) => !params.remoteWKeys!.has(workloadKey(w)));
    if (next.length !== box.workloads.length) {
      box.workloads = next;
      changed = true;
    }
  }
  if (params.remoteLKeys && box.leaves.length > 0) {
    const next = box.leaves.filter((l) => !params.remoteLKeys!.has(leaveKey(l)));
    if (next.length !== box.leaves.length) {
      box.leaves = next;
      changed = true;
    }
  }
  if (params.remoteOKeys && box.ot.length > 0) {
    const next = box.ot.filter((o) => !params.remoteOKeys!.has(otKey(o)));
    if (next.length !== box.ot.length) {
      box.ot = next;
      changed = true;
    }
  }
  if (params.remoteAuditKeys && box.auditLogs.length > 0) {
    const next = box.auditLogs.filter((a) => !params.remoteAuditKeys!.has(auditLogKey(a)));
    if (next.length !== box.auditLogs.length) {
      box.auditLogs = next;
      changed = true;
    }
  }
  if (changed) {
    memPendingOutbox = box;
    persistPendingOutbox();
  }
}

function normalizeAdditionalAdminPins(raw: unknown): AdminPinEntry[] {
  const defaults = buildDefaultAdditionalAdminPins();
  if (!Array.isArray(raw) || raw.length === 0) return defaults;
  return defaults.map((def, idx) => {
    const found = raw.find((item: any) => item?.id === def.id) || raw[idx];
    return {
      id: def.id,
      ownerName: typeof found?.ownerName === 'string' && found.ownerName.trim()
        ? found.ownerName.trim()
        : def.ownerName,
      pin: typeof found?.pin === 'string' ? found.pin.trim() : '',
    };
  });
}

export const loadLocalDatabase = (): AppDatabase => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const needsDemoPurge = localStorage.getItem(DEMO_PURGED_KEY) !== 'true';

      const rawStaff: StaffMember[] = parsed.staff || INITIAL_STAFF_LIST;
      const migratedStaff = (needsDemoPurge
        ? rawStaff.filter((s) => !isDemoStaffId(s.staffId))
        : rawStaff
      ).map((s: StaffMember) => ({
        ...s,
        position: normalizeStaffPosition(s.position),
      }));

      const mergedPremiumClinics =
        Array.isArray(parsed.settings?.premiumSubClinics) && parsed.settings.premiumSubClinics.length > 0
          ? parsed.settings.premiumSubClinics
          : INITIAL_SETTINGS.premiumSubClinics || [...DEFAULT_PREMIUM_SUB_CLINICS];

      const rawWorkloads: any[] = parsed.workloads || INITIAL_WORKLOADS;
      const migratedWorkloads = (needsDemoPurge
        ? rawWorkloads.filter((w) => !isDemoWorkloadId(w.id))
        : rawWorkloads
      ).map((w: any) => {
        const adult = Number(w.adultPt) || 0;
        const child = Number(w.childPt) || 0;
        const total = Math.max(Number(w.totalPt) || 0, adult + child);
        return normalizeWorkloadRecord(
          {
            ...w,
            totalPt: total,
            na: w.na !== undefined ? Number(w.na) : Number(w.pca || 0),
          },
          mergedPremiumClinics
        );
      });

      const rawLeaves: any[] = parsed.leaves || INITIAL_LEAVES;
      const migratedLeaves = (needsDemoPurge
        ? rawLeaves.filter((l) => !isDemoLeaveId(l.id))
        : rawLeaves
      ).map((l: any) => ({
        ...l,
        position: normalizeStaffPosition(l.position),
      }));

      const rawOt: any[] = parsed.ot || INITIAL_OT;
      const migratedOt = (needsDemoPurge
        ? rawOt.filter((o) => !isDemoOtId(o.id))
        : rawOt
      ).map((o: any) => ({
        ...o,
        position: normalizeStaffPosition(o.position),
      }));

      const isUnlinked = Boolean(parsed.settings?.isUnlinked);
      const storedSpreadsheetId =
        typeof parsed.settings?.spreadsheetId === 'string' ? parsed.settings.spreadsheetId.trim() : '';
      const storedSpreadsheetUrl =
        typeof parsed.settings?.spreadsheetUrl === 'string' ? parsed.settings.spreadsheetUrl.trim() : '';
      const storedGasUrl =
        typeof parsed.settings?.gasUrl === 'string' ? parsed.settings.gasUrl.trim() : '';

      const mergedSettings: SystemSettings = {
        ...INITIAL_SETTINGS,
        ...(parsed.settings || {}),
        screeningNhppd:
          Number(parsed.settings?.screeningNhppd) > 0
            ? Number(parsed.settings.screeningNhppd)
            : 0.1,
        inTimeClinics: ensureReferralInClinicList(
          Array.isArray(parsed.settings?.inTimeClinics) && parsed.settings.inTimeClinics.length > 0
            ? parsed.settings.inTimeClinics
            : INITIAL_SETTINGS.inTimeClinics
        ),
        outTimeClinics:
          Array.isArray(parsed.settings?.outTimeClinics) && parsed.settings.outTimeClinics.length > 0
            ? parsed.settings.outTimeClinics
            : INITIAL_SETTINGS.outTimeClinics,
        premiumSubClinics: mergedPremiumClinics,
        leaveTypes:
          Array.isArray(parsed.settings?.leaveTypes) && parsed.settings.leaveTypes.length > 0
            ? parsed.settings.leaveTypes
            : INITIAL_SETTINGS.leaveTypes,
        customHolidays: Array.isArray(parsed.settings?.customHolidays)
          ? parsed.settings.customHolidays
          : INITIAL_SETTINGS.customHolidays,
        primaryAdminOwner:
          typeof parsed.settings?.primaryAdminOwner === 'string' && parsed.settings.primaryAdminOwner.trim()
            ? parsed.settings.primaryAdminOwner.trim()
            : INITIAL_SETTINGS.primaryAdminOwner || DEFAULT_PRIMARY_ADMIN_OWNER,
        additionalAdminPins: normalizeAdditionalAdminPins(parsed.settings?.additionalAdminPins),
        spreadsheetId: isUnlinked
          ? undefined
          : storedSpreadsheetId || INITIAL_SETTINGS.spreadsheetId,
        spreadsheetUrl: isUnlinked
          ? undefined
          : storedSpreadsheetUrl || INITIAL_SETTINGS.spreadsheetUrl,
        gasUrl: isUnlinked ? '' : storedGasUrl || INITIAL_SETTINGS.gasUrl || '',
        isUnlinked,
        autoSync: parsed.settings?.autoSync !== undefined ? Boolean(parsed.settings.autoSync) : true,
      };

      const hydratedLocal = hydrateUnifiedStaffAndOt(migratedStaff, migratedOt);

      const cleanDb: AppDatabase = {
        staff: hydratedLocal.staff,
        workloads: deduplicateWorkloads(migratedWorkloads, mergedPremiumClinics),
        leaves: migratedLeaves,
        ot: hydratedLocal.ot,
        auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
        settings: mergedSettings,
      };

      if (needsDemoPurge) {
        localStorage.setItem(DEMO_PURGED_KEY, 'true');
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanDb));
      }

      return cleanDb;
    } else {
      localStorage.setItem(DEMO_PURGED_KEY, 'true');
    }
  } catch (err) {
    console.error('Error loading local DB:', err);
  }

  return {
    staff: INITIAL_STAFF_LIST,
    workloads: INITIAL_WORKLOADS,
    leaves: INITIAL_LEAVES,
    ot: INITIAL_OT,
    auditLogs: [],
    settings: INITIAL_SETTINGS,
  };
};

export interface ServerTombstones {
  workloads: Record<string, number>;
  leaves: Record<string, number>;
  ot: Record<string, number>;
}

export interface ServerSnapshotResponse {
  ok: boolean;
  version: number;
  updatedAt?: string;
  staleRejected?: boolean;
  unchanged?: boolean;
  db: Partial<AppDatabase>;
  tombstones?: ServerTombstones;
}

export const getAllTombstonesSnapshot = (): ServerTombstones => {
  memTombstones = pruneExpiredTombstones(memTombstones);
  return {
    workloads: { ...memTombstones.workloads },
    leaves: { ...memTombstones.leaves },
    ot: { ...memTombstones.ot },
  };
};

export const applyServerTombstonesLocally = (remoteTombstones?: Partial<ServerTombstones>): void => {
  if (!remoteTombstones) return;
  const cleanRemote = pruneExpiredTombstones(remoteTombstones);
  let changed = false;

  const mergeBucket = (
    target: Record<string, number>,
    src: Record<string, number>
  ) => {
    Object.entries(src).forEach(([k, ts]) => {
      if (!target[k] || ts > target[k]) {
        target[k] = ts;
        changed = true;
      }
    });
  };

  mergeBucket(memTombstones.workloads, cleanRemote.workloads);
  mergeBucket(memTombstones.leaves, cleanRemote.leaves);
  mergeBucket(memTombstones.ot, cleanRemote.ot);

  if (changed) {
    persistTombstones();
  }

  // Prune any outbox or recentSaved entries matching tombstones propagated from another machine
  const box = readPendingOutboxFresh();
  let boxChanged = false;
  const nextBoxW = box.workloads.filter(
    (w) => !(workloadKey(w) in memTombstones.workloads) && !(`id:${w.id}` in memTombstones.workloads)
  );
  if (nextBoxW.length !== box.workloads.length) {
    box.workloads = nextBoxW;
    boxChanged = true;
  }
  const nextBoxL = box.leaves.filter(
    (l) => !(leaveKey(l) in memTombstones.leaves) && !(`id:${l.id}` in memTombstones.leaves)
  );
  if (nextBoxL.length !== box.leaves.length) {
    box.leaves = nextBoxL;
    boxChanged = true;
  }
  const nextBoxO = box.ot.filter(
    (o) => !(otKey(o) in memTombstones.ot) && !(`id:${o.id}` in memTombstones.ot)
  );
  if (nextBoxO.length !== box.ot.length) {
    box.ot = nextBoxO;
    boxChanged = true;
  }
  if (boxChanged) {
    memPendingOutbox = box;
    persistPendingOutbox();
  }

  recentSavedWorkloads = recentSavedWorkloads.filter(
    (x) => !(x.key in memTombstones.workloads) && !(`id:${x.id}` in memTombstones.workloads)
  );
  recentSavedLeaves = recentSavedLeaves.filter(
    (x) => !(x.key in memTombstones.leaves) && !(`id:${x.id}` in memTombstones.leaves)
  );
  recentSavedOt = recentSavedOt.filter(
    (x) => !(x.key in memTombstones.ot) && !(`id:${x.id}` in memTombstones.ot)
  );
};

export const normalizeIncomingServerDb = (
  rawDb: Partial<AppDatabase> | null | undefined,
  fallbackDb: AppDatabase
): AppDatabase => {
  const src = rawDb || {};
  const rawSettings: any = src.settings && typeof src.settings === 'object' ? src.settings : {};
  const mergedPremiumClinics =
    Array.isArray(rawSettings.premiumSubClinics) && rawSettings.premiumSubClinics.length > 0
      ? rawSettings.premiumSubClinics
      : fallbackDb.settings.premiumSubClinics || [...DEFAULT_PREMIUM_SUB_CLINICS];

  const isUnlinked = Boolean(rawSettings.isUnlinked);
  const storedSheetId =
    typeof rawSettings.spreadsheetId === 'string' ? rawSettings.spreadsheetId.trim() : '';
  const storedSheetUrl =
    typeof rawSettings.spreadsheetUrl === 'string' ? rawSettings.spreadsheetUrl.trim() : '';
  const storedGasUrl =
    typeof rawSettings.gasUrl === 'string' ? rawSettings.gasUrl.trim() : '';

  const mergedSettings: SystemSettings = {
    ...INITIAL_SETTINGS,
    ...fallbackDb.settings,
    ...rawSettings,
    screeningNhppd:
      Number(rawSettings.screeningNhppd) > 0
        ? Number(rawSettings.screeningNhppd)
        : fallbackDb.settings.screeningNhppd || 0.1,
    inTimeClinics: ensureReferralInClinicList(
      Array.isArray(rawSettings.inTimeClinics) && rawSettings.inTimeClinics.length > 0
        ? rawSettings.inTimeClinics
        : fallbackDb.settings.inTimeClinics
    ),
    outTimeClinics:
      Array.isArray(rawSettings.outTimeClinics) && rawSettings.outTimeClinics.length > 0
        ? rawSettings.outTimeClinics
        : fallbackDb.settings.outTimeClinics,
    premiumSubClinics: mergedPremiumClinics,
    leaveTypes:
      Array.isArray(rawSettings.leaveTypes) && rawSettings.leaveTypes.length > 0
        ? rawSettings.leaveTypes
        : fallbackDb.settings.leaveTypes,
    customHolidays: Array.isArray(rawSettings.customHolidays)
      ? rawSettings.customHolidays
      : fallbackDb.settings.customHolidays || [],
    primaryAdminOwner:
      typeof rawSettings.primaryAdminOwner === 'string' && rawSettings.primaryAdminOwner.trim()
        ? rawSettings.primaryAdminOwner.trim()
        : fallbackDb.settings.primaryAdminOwner || DEFAULT_PRIMARY_ADMIN_OWNER,
    additionalAdminPins: normalizeAdditionalAdminPins(
      rawSettings.additionalAdminPins || fallbackDb.settings.additionalAdminPins
    ),
    spreadsheetId: isUnlinked
      ? undefined
      : storedSheetId || fallbackDb.settings.spreadsheetId || INITIAL_SETTINGS.spreadsheetId,
    spreadsheetUrl: isUnlinked
      ? undefined
      : storedSheetUrl || fallbackDb.settings.spreadsheetUrl || INITIAL_SETTINGS.spreadsheetUrl,
    gasUrl: isUnlinked
      ? ''
      : storedGasUrl || fallbackDb.settings.gasUrl || INITIAL_SETTINGS.gasUrl || '',
    isUnlinked,
    autoSync:
      rawSettings.autoSync !== undefined
        ? Boolean(rawSettings.autoSync)
        : fallbackDb.settings.autoSync !== false,
  };

  const rawStaff = Array.isArray(src.staff) ? src.staff : fallbackDb.staff;
  const rawWorkloads = Array.isArray(src.workloads) ? src.workloads : fallbackDb.workloads;
  const rawLeaves = Array.isArray(src.leaves) ? src.leaves : fallbackDb.leaves;
  const rawOt = Array.isArray(src.ot) ? src.ot : fallbackDb.ot;

  const migratedWorkloads = rawWorkloads.map((w: any) => {
    const adult = Number(w.adultPt) || 0;
    const child = Number(w.childPt) || 0;
    const total = Math.max(Number(w.totalPt) || 0, adult + child);
    return normalizeWorkloadRecord(
      {
        ...w,
        totalPt: total,
        na: w.na !== undefined ? Number(w.na) : Number(w.pca || 0),
      },
      mergedPremiumClinics
    );
  });

  const migratedLeaves = rawLeaves.map((l: any) => ({
    ...l,
    position: normalizeStaffPosition(l.position),
  }));

  const migratedOt = rawOt.map((o: any) => ({
    ...o,
    position: normalizeStaffPosition(o.position),
  }));

  const hydrated = hydrateUnifiedStaffAndOt(
    rawStaff.map((s: StaffMember) => ({ ...s, position: normalizeStaffPosition(s.position) })),
    migratedOt
  );

  return {
    staff: hydrated.staff,
    workloads: deduplicateWorkloads(migratedWorkloads, mergedPremiumClinics),
    leaves: migratedLeaves,
    ot: hydrated.ot,
    auditLogs: Array.isArray(src.auditLogs) ? src.auditLogs : fallbackDb.auditLogs || [],
    settings: mergedSettings,
  };
};

export const fetchServerDatabaseSnapshot = async (): Promise<ServerSnapshotResponse | null> => {
  try {
    const res = await fetch('/api/db', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerSnapshotResponse;
    return data && data.ok ? data : null;
  } catch {
    return null;
  }
};

export const pushServerMutation = async (params: {
  clientId: string;
  action: string;
  payload: any;
}): Promise<ServerSnapshotResponse | null> => {
  try {
    const res = await fetch('/api/db/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerSnapshotResponse;
    return data && data.ok ? data : null;
  } catch {
    return null;
  }
};

export const pushServerSync = async (params: {
  clientId: string;
  baseVersion?: number;
  forceOverwrite?: boolean;
  mergeFromRemote?: boolean;
  db: AppDatabase;
}): Promise<ServerSnapshotResponse | null> => {
  try {
    const res = await fetch('/api/db/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: params.clientId,
        baseVersion: params.baseVersion,
        forceOverwrite: params.forceOverwrite,
        mergeFromRemote: params.mergeFromRemote,
        db: params.db,
        tombstones: getAllTombstonesSnapshot(),
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ServerSnapshotResponse;
    return data && data.ok ? data : null;
  } catch {
    return null;
  }
};

export const saveLocalDatabase = (db: AppDatabase): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (err) {
    console.error('Error saving local DB:', err);
    try {
      const trimmedDb: AppDatabase = {
        ...db,
        auditLogs: (db.auditLogs || []).slice(0, 150),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedDb));
    } catch (retryErr) {
      console.error('Retry saving trimmed local DB failed:', retryErr);
    }
  }
};

function parseSheetsApiError(errorText: string, defaultPrefix: string): Error {
  let friendlyMsg = '';
  try {
    const parsedErr = JSON.parse(errorText);
    const errMsg = parsedErr?.error?.message || '';
    if (errorText.includes('SERVICE_DISABLED')) {
      friendlyMsg =
        'ยังไม่ได้เปิดใช้งาน Google Sheets API ใน Google Cloud Console กรุณากดเปิดใช้งาน "Google Sheets API" (และ "Google Drive API") ในโปรเจกต์ของคุณ แล้วรอ 1-2 นาทีแล้วลองใหม่อีกครั้ง';
    } else if (parsedErr?.error?.code === 401 || parsedErr?.error?.status === 'UNAUTHENTICATED') {
      friendlyMsg = 'ไม่สามารถซิงค์ผ่านโทเคนเดิมได้ กรุณาใช้ Web App URL (/exec) จาก Code.gs เพื่อซิงค์โดยไม่ต้อง Sign in Google';
    } else if (parsedErr?.error?.code === 403 || parsedErr?.error?.status === 'PERMISSION_DENIED') {
      friendlyMsg = `ไม่มีสิทธิ์เข้าถึง Google Sheets นี้ (${errMsg || 'กรุณาตรวจสอบสิทธิ์การแก้ไขชีท'})`;
    } else if (parsedErr?.error?.code === 404) {
      friendlyMsg = 'ไม่พบ Google Sheets ตามลิงก์/ID ที่ระบุ กรุณาตรวจสอบว่าลิงก์ถูกต้องและไม่ถูกลบ';
    } else if (errMsg) {
      friendlyMsg = `${defaultPrefix}: ${errMsg}`;
    }
  } catch {
    // Fallback
  }
  return new Error(friendlyMsg || `${defaultPrefix}: ${errorText}`);
}

const REQUIRED_SHEETS = [
  'Staff_Master',
  'Daily_Workload',
  'Leave_Records',
  'OT_Attendance',
  'Settings',
  'Audit_Logs',
] as const;

/**
 * Ensures all required tabs exist in an already-linked Google Spreadsheet
 */
export const ensureSpreadsheetTabs = async (
  accessToken: string,
  spreadsheetId: string
): Promise<void> => {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties.title`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!metaRes.ok) {
    const errText = await metaRes.text();
    throw parseSheetsApiError(errText, 'ไม่สามารถเปิดอ่านข้อมูล Google Sheets');
  }

  const meta = await metaRes.json();
  const existingTitles = new Set<string>(
    (meta.sheets || []).map((s: any) => String(s?.properties?.title || ''))
  );

  const missingSheets = REQUIRED_SHEETS.filter((name) => !existingTitles.has(name));
  if (missingSheets.length > 0) {
    const batchRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: missingSheets.map((title) => ({
            addSheet: {
              properties: {
                title,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          })),
        }),
      }
    );

    if (!batchRes.ok) {
      const errText = await batchRes.text();
      throw parseSheetsApiError(errText, 'สร้างแท็บชีทเพิ่มเติมไม่สำเร็จ');
    }
  }
};

/**
 * Creates a brand-new Google Spreadsheet with the 5 sheets when none is linked yet
 */
export const createGoogleSpreadsheet = async (
  accessToken: string,
  staffList: StaffMember[],
  settings: SystemSettings
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> => {
  const requestBody = {
    properties: {
      title: 'PCMC_OPD_Database_โรงพยาบาลชลประทาน',
      timeZone: 'Asia/Bangkok',
    },
    sheets: REQUIRED_SHEETS.map((title) => ({
      properties: { title, gridProperties: { frozenRowCount: 1 } },
    })),
  };

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    throw parseSheetsApiError(errorText, 'สร้าง Google Sheets ไม่สำเร็จ');
  }

  const createdData = await createRes.json();
  const spreadsheetId = createdData.spreadsheetId;
  const spreadsheetUrl = createdData.spreadsheetUrl;

  const staffRows = staffList.map(prepareStaffRowForSheet);
  const settingsRows = buildSettingsSheetRows(settings, staffList);

  const batchUpdateValues = {
    valueInputOption: 'USER_ENTERED',
    data: [
      {
        range: 'Staff_Master!A1:H',
        values: [
          ['Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status', 'Start_Date', 'End_Date', 'Employee_Code'],
          ...staffRows,
        ],
      },
      {
        range: 'Daily_Workload!A1:R1',
        values: [
          [
            'Date',
            'Shift',
            'Clinic',
            'Total_Pt',
            'Adult_Pt',
            'Child_Pt',
            'Admit',
            'HN',
            'RN',
            'PN',
            'NA',
            'Clerk',
            'Service_Worker',
            'Note',
            'Reporter',
            'Clinic_Group',
            'Pool_ID',
            'Record_Type',
          ],
        ],
      },
      {
        range: 'Leave_Records!A1:H1',
        values: [['Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note']],
      },
      {
        range: 'OT_Attendance!A1:H1',
        values: [['Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic', 'Hours', 'Employee_Code']],
      },
      {
        range: `Settings!A1:B${settingsRows.length}`,
        values: settingsRows,
      },
      {
        range: 'Audit_Logs!A1:F1',
        values: [['Timestamp', 'Action', 'Target_Name', 'Summary', 'Reason', 'Edited_By']],
      },
    ],
  };

  const populateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batchUpdateValues),
    }
  );

  if (!populateRes.ok) {
    console.warn('Initial data populate warning, spreadsheet created:', spreadsheetId);
  }

  clearStaffMasterDirty();
  return { spreadsheetId, spreadsheetUrl };
};

/**
 * Overwrites Staff_Master sheet cleanly with the latest Admin roster (Add / Delete / Status change)
 */
export const syncStaffMasterToSheet = async (
  accessToken: string,
  spreadsheetId: string,
  staffList: StaffMember[]
): Promise<boolean> => {
  try {
    await ensureSpreadsheetTabs(accessToken, spreadsheetId);

    const bodyRows = staffList.map(prepareStaffRowForSheet);

    const clearRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('Staff_Master!A2:H')}:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!clearRes.ok) {
      const errText = await clearRes.text();
      throw parseSheetsApiError(errText, 'ล้างข้อมูลชีท Staff_Master ไม่สำเร็จ');
    }

    if (bodyRows.length > 0) {
      const putRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`Staff_Master!A2:H${bodyRows.length + 1}`)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: bodyRows }),
        }
      );
      if (!putRes.ok) {
        const errText = await putRes.text();
        throw parseSheetsApiError(errText, 'บันทึกชีท Staff_Master ไม่สำเร็จ');
      }
    }

    clearStaffMasterDirty();
    return true;
  } catch (err) {
    console.error('Failed to sync Staff_Master:', err);
    return false;
  }
};

export function getWorkloadKey(w: DailyWorkload): string {
  const parsedNote = parseWorkloadMetaFromSheetNote(w.note);
  const effectiveNote = parsedNote.cleanNote;
  const effectiveReferral = w.referralData || parsedNote.referralData;
  const refSig = getCanonicalReferralSignature(effectiveReferral);
  const effectiveIsOffDuty = Boolean(w.isOffDuty) || parsedNote.isOffDuty;
  const effectiveOffReason = (w.offDutyReason || '').trim() || parsedNote.offDutyReason || '';
  const effectiveOffStaff = getWorkloadOffDutyStaff(w);
  const offStaffSig = getCanonicalOffDutyStaffSignature(effectiveOffStaff);
  const parts: Array<string | number> = [
    (w.date || '').trim(),
    (w.shift || '').trim(),
    (w.clinic || '').trim(),
    getEffectiveTotalPt(w),
    Number(w.adultPt || 0),
    Number(w.childPt || 0),
    Number(w.admit || 0),
    Number(w.hn || 0),
    Number(w.rn || 0),
    Number(w.pn || 0),
    Number(w.na !== undefined ? w.na : (w.pca || 0)),
    Number(w.clerk || 0),
    Number(w.serviceWorker || 0),
    effectiveNote,
    (w.reporter || '').trim(),
    (w.clinicGroup || '').trim(),
    (w.recordType || 'STANDARD').trim(),
  ];
  if (refSig) {
    parts.push(refSig);
  }
  if (effectiveIsOffDuty) {
    parts.push(`OFF:${effectiveOffReason}`);
  }
  if (offStaffSig) {
    parts.push(`OFFS:${offStaffSig}`);
  }
  return parts.join('|');
}

export function getWorkloadSlotKey(w: DailyWorkload): string {
  const normDate = normalizeWorkloadDateStr(w?.date) || String(w?.date || '').trim();
  const normShift = normalizeWorkloadShiftStr(w?.shift);
  const normClinic = String(w?.clinic || '').trim();
  const recGroup =
    w?.recordType === 'PREMIUM_SUB' || w?.recordType === 'PREMIUM_POOL'
      ? w.recordType
      : 'STANDARD';
  return `${normDate}|${normShift}|${normClinic}|${recGroup}`;
}

export function deduplicateWorkloads(
  items: DailyWorkload[],
  premiumSubClinics?: string[]
): DailyWorkload[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const bySlot = new Map<string, DailyWorkload>();
  for (const rawItem of items) {
    if (!rawItem || !rawItem.date || !rawItem.clinic) continue;
    const item = normalizeWorkloadRecord(
      { ...rawItem, totalPt: getEffectiveTotalPt(rawItem) },
      premiumSubClinics
    );
    const slotKey = getWorkloadSlotKey(item);
    const existing = bySlot.get(slotKey);
    if (!existing) {
      bySlot.set(slotKey, item);
      continue;
    }
    const existingEdited = Boolean(existing.lastEditedAt);
    const itemEdited = Boolean(item.lastEditedAt);
    if (itemEdited && !existingEdited) {
      bySlot.set(slotKey, item);
    } else if (itemEdited && existingEdited && String(item.lastEditedAt) > String(existing.lastEditedAt)) {
      bySlot.set(slotKey, item);
    }
  }
  return Array.from(bySlot.values());
}

function workloadKey(w: DailyWorkload): string {
  return getWorkloadKey(w);
}

export function getLeaveKey(l: LeaveRecord): string {
  return [
    (l.startDate || '').trim(),
    (l.endDate || l.startDate || '').trim(),
    (l.staffName || '').trim(),
    (l.clinic || '').trim(),
    (l.leaveType || '').trim(),
    Number(l.days || 1),
    (l.note || '').trim(),
  ].join('|');
}

function leaveKey(l: LeaveRecord): string {
  return getLeaveKey(l);
}

export function getOtKey(o: OTAttendance): string {
  const parsedClinic = parseOtWorkClinic(o.workClinic);
  const normalizedWorkClinic = formatOtWorkClinicValue(
    parsedClinic.clinic,
    parsedClinic.amount,
    parsedClinic.periodLabel
  );
  const effHours = getEffectiveOtHours(o);
  return [
    (o.date || '').trim(),
    (o.shift || '').trim(),
    (o.staffName || '').trim(),
    (o.homeClinic || '').trim(),
    normalizedWorkClinic,
    String(effHours),
  ].join('|');
}

function otKey(o: OTAttendance): string {
  return getOtKey(o);
}

function auditLogKey(a: AuditLogEntry): string {
  return [
    (a.timestamp || '').trim(),
    (a.action || '').trim(),
    (a.targetName || '').trim(),
    (a.reason || '').trim(),
  ].join('|');
}

/**
 * Full 2-way Sync with an existing Google Spreadsheet (never creates a duplicate spreadsheet)
 */
export const syncAllWithGoogleSheet = async (
  accessToken: string,
  spreadsheetId: string,
  db: AppDatabase,
  options?: { pushLocalStaff?: boolean }
): Promise<{
  mergedDb: AppDatabase;
  pushedWorkloads: number;
  pulledWorkloads: number;
  staffCount: number;
}> => {
  await ensureSpreadsheetTabs(accessToken, spreadsheetId);

  const batchGetRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?ranges=${encodeURIComponent(
      'Staff_Master!A:H'
    )}&ranges=${encodeURIComponent('Daily_Workload!A:R')}&ranges=${encodeURIComponent(
      'Leave_Records!A:H'
    )}&ranges=${encodeURIComponent('OT_Attendance!A:H')}&ranges=${encodeURIComponent(
      'Settings!A:B'
    )}&ranges=${encodeURIComponent('Audit_Logs!A:F')}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!batchGetRes.ok) {
    const errText = await batchGetRes.text();
    throw parseSheetsApiError(errText, 'อ่านข้อมูลจาก Google Sheets ไม่สำเร็จ');
  }

  const batchData = await batchGetRes.json();
  const valueRanges = batchData.valueRanges || [];

  const staffRawRows: string[][] = valueRanges[0]?.values || [];
  const workloadRawRows: string[][] = valueRanges[1]?.values || [];
  const leaveRawRows: string[][] = valueRanges[2]?.values || [];
  const otRawRows: string[][] = valueRanges[3]?.values || [];
  const settingsRawRows: string[][] = valueRanges[4]?.values || [];
  const auditRawRows: string[][] = valueRanges[5]?.values || [];

  const earlySettingsMap: Record<string, string> = {};
  settingsRawRows.slice(1).forEach((r) => {
    if (r[0]) earlySettingsMap[String(r[0]).trim()] = String(r[1] || '').trim();
  });
  const remoteStaffCodeMap = parseJsonRecordSafe<Record<string, string>>(
    earlySettingsMap['Staff_Employee_Codes']
  );

  // 1. Parse Staff_Master from sheet
  const sheetStaffRows = staffRawRows
    .slice(1)
    .filter((r) => (r[1] || '').trim().length > 0)
    .map((r, idx): StaffMember => {
      const rawPos = (r[2] || 'RN').trim();
      const pos = normalizeStaffPosition(rawPos);
      const rawStatus = (r[4] || 'Active').trim();
      const status: StaffStatus =
        rawStatus === 'Resigned' || rawStatus === 'Retired' ? rawStatus : 'Active';
      const rawColA = (r[0] || `STF-GS-${idx + 1}`).trim();
      const name = (r[1] || '').trim();
      const colCode = (r[7] || '').trim();
      const prevMatch = db.staff.find((s) => s.staffId === rawColA || s.name.trim() === name);
      const resolvedCode =
        (isValidEmployeeCodeValue(colCode) ? colCode : '') ||
        (!isLegacyGeneratedStaffId(rawColA) ? rawColA : '') ||
        remoteStaffCodeMap?.[rawColA] ||
        remoteStaffCodeMap?.[name] ||
        getStaffEmployeeCode(prevMatch);
      const staffId = isValidEmployeeCodeValue(resolvedCode) ? resolvedCode : rawColA;
      return {
        staffId,
        employeeCode: isValidEmployeeCodeValue(resolvedCode) ? resolvedCode : undefined,
        name,
        position: pos,
        homeClinic: (r[3] || '').trim(),
        status,
        startDate: (r[5] || '').trim() || undefined,
        endDate: (r[6] || '').trim() || undefined,
      };
    });

  const baseFinalStaff =
    isStaffMasterDirty() || options?.pushLocalStaff || sheetStaffRows.length === 0
      ? db.staff
      : sheetStaffRows;

  // 2. Parse Daily_Workload from sheet & merge with local
  const sheetWorkloads: DailyWorkload[] = workloadRawRows
    .slice(1)
    .filter((r) => (r[0] || '').trim() && (r[2] || '').trim())
    .map((r, idx) => {
      const adultPt = Number(r[4] || 0);
      const childPt = Number(r[5] || 0);
      const totalPt = Math.max(Number(r[3] || 0), adultPt + childPt);
      const rawRecordType = String(r[17] || '').trim();
      const recordType: WorkloadRecordType | undefined =
        rawRecordType === 'PREMIUM_POOL' || rawRecordType === 'PREMIUM_SUB' || rawRecordType === 'STANDARD'
          ? rawRecordType
          : undefined;
      return normalizeWorkloadRecord(
        {
          id: `REC-GS-${Date.now()}-${idx}`,
          date: String(r[0] || '').trim(),
          shift: String(r[1] || 'ในเวลา 08:00-16:00').trim() as WorkShift,
          clinic: String(r[2] || '').trim(),
          totalPt,
          adultPt,
          childPt,
          admit: Number(r[6] || 0),
          hn: Number(r[7] || 0),
          rn: Number(r[8] || 0),
          pn: Number(r[9] || 0),
          na: Number(r[10] || 0),
          clerk: Number(r[11] || 0),
          serviceWorker: Number(r[12] || 0),
          note: String(r[13] || '').trim(),
          reporter: String(r[14] || '').trim(),
          clinicGroup: String(r[15] || '').trim() || undefined,
          poolId: String(r[16] || '').trim() || undefined,
          recordType,
        },
        db.settings.premiumSubClinics
      );
    });

  const shouldOverwriteWorkloads = isWorkloadsDirty();
  const sheetWKeys = new Set(sheetWorkloads.map(workloadKey));
  const sheetWSlots = new Set(sheetWorkloads.map(getWorkloadSlotKey));
  const localWKeys = new Set(db.workloads.map(workloadKey));
  pruneOutboxSyncedAgainstRemote({ remoteWKeys: sheetWKeys });

  const workloadsToPush = shouldOverwriteWorkloads
    ? []
    : getPendingOutboxWorkloads().filter(
        (w) =>
          !sheetWKeys.has(workloadKey(w)) &&
          !sheetWSlots.has(getWorkloadSlotKey(w)) &&
          !isWorkloadSlotInFlight(w)
      );
  const workloadsPulled = shouldOverwriteWorkloads
    ? []
    : sheetWorkloads.filter((w) => !localWKeys.has(workloadKey(w)));

  const existingWorkloadQueue = new Map<string, DailyWorkload[]>();
  db.workloads.forEach((w) => {
    const k = workloadKey(w);
    const arr = existingWorkloadQueue.get(k);
    if (arr) arr.push(w);
    else existingWorkloadQueue.set(k, [w]);
  });

  const mergedWorkloads = deduplicateWorkloads(
    shouldOverwriteWorkloads
      ? db.workloads
      : [
          ...workloadsToPush,
          ...sheetWorkloads.map((sw) => {
            const matches = existingWorkloadQueue.get(workloadKey(sw));
            const prev = matches && matches.length > 0 ? matches.shift() : undefined;
            if (!prev) return sw;
            return {
              ...sw,
              id: prev.id,
              lastEditedAt: prev.lastEditedAt,
              lastEditReason: prev.lastEditReason,
              lastEditedBy: prev.lastEditedBy,
            };
          }),
        ],
    db.settings.premiumSubClinics
  ).sort((a, b) => b.date.localeCompare(a.date));

  // 3. Parse Leave_Records from sheet & merge cleanly (Sheet + Pending Outbox)
  const sheetLeaves: LeaveRecord[] = leaveRawRows
    .slice(1)
    .filter((r) => (r[0] || '').trim() && (r[2] || '').trim())
    .map((r, idx) => {
      const rawPos = (r[3] || 'RN').trim();
      return {
        id: `LV-GS-${Date.now()}-${idx}`,
        startDate: String(r[0] || '').trim(),
        endDate: String(r[1] || r[0] || '').trim(),
        staffName: String(r[2] || '').trim(),
        position: normalizeStaffPosition(rawPos),
        clinic: String(r[4] || '').trim(),
        leaveType: (String(r[5] || 'ลาป่วย').trim()) as LeaveType,
        days: Number(r[6] || 1),
        note: String(r[7] || '').trim(),
      };
    });

  const shouldOverwriteLeaves = isLeavesDirty();
  const sheetLKeys = new Set(sheetLeaves.map(leaveKey));
  pruneOutboxSyncedAgainstRemote({ remoteLKeys: sheetLKeys });
  const leavesToPush = shouldOverwriteLeaves
    ? []
    : getPendingOutboxLeaves().filter((l) => !sheetLKeys.has(leaveKey(l)));

  const existingLeaveQueue = new Map<string, LeaveRecord[]>();
  db.leaves.forEach((l) => {
    const k = leaveKey(l);
    const arr = existingLeaveQueue.get(k);
    if (arr) arr.push(l);
    else existingLeaveQueue.set(k, [l]);
  });

  const mergedLeaves = (
    shouldOverwriteLeaves
      ? db.leaves
      : [
          ...leavesToPush,
          ...sheetLeaves.map((sl) => {
            const matches = existingLeaveQueue.get(leaveKey(sl));
            const prev = matches && matches.length > 0 ? matches.shift() : undefined;
            if (!prev) return sl;
            return {
              ...sl,
              id: prev.id,
              lastEditedAt: prev.lastEditedAt,
              lastEditReason: prev.lastEditReason,
              lastEditedBy: prev.lastEditedBy,
            };
          }),
        ]
  ).sort((a, b) => b.startDate.localeCompare(a.startDate));

  // 4. Parse OT_Attendance from sheet & merge cleanly (Sheet + Pending Outbox)
  const sheetOt: OTAttendance[] = otRawRows
    .slice(1)
    .filter((r) => (r[0] || '').trim() && (r[2] || '').trim())
    .map((r, idx) => parseSheetOtRecord(r, `OT-GS-${Date.now()}-${idx}`, baseFinalStaff));

  const shouldOverwriteOt = isOtDirty();
  const sheetOKeys = new Set(sheetOt.map(otKey));
  pruneOutboxSyncedAgainstRemote({ remoteOKeys: sheetOKeys });
  const otToPush = shouldOverwriteOt
    ? []
    : getPendingOutboxOt().filter((o) => !sheetOKeys.has(otKey(o)));

  const existingOtQueue = new Map<string, OTAttendance[]>();
  db.ot.forEach((o) => {
    const k = otKey(o);
    const arr = existingOtQueue.get(k);
    if (arr) arr.push(o);
    else existingOtQueue.set(k, [o]);
  });

  const rawMergedOt = (
    shouldOverwriteOt
      ? db.ot
      : [
          ...otToPush,
          ...sheetOt.map((so) => {
            const matches = existingOtQueue.get(otKey(so));
            const prev = matches && matches.length > 0 ? matches.shift() : undefined;
            if (!prev) return so;
            return {
              ...so,
              id: prev.id,
              hours: so.hours ?? prev.hours,
              employeeCode: so.employeeCode || prev.employeeCode,
              isExternal: prev.isExternal,
              affiliation: prev.affiliation,
              lastEditedAt: prev.lastEditedAt,
              lastEditReason: prev.lastEditReason,
              lastEditedBy: prev.lastEditedBy,
            };
          }),
        ]
  ).sort((a, b) => b.date.localeCompare(a.date));

  const hydratedOAuth = hydrateUnifiedStaffAndOt(baseFinalStaff, rawMergedOt, remoteStaffCodeMap);
  const finalStaff = hydratedOAuth.staff;
  const mergedOt = hydratedOAuth.ot;
  const remoteNeedsStaffIdUpgrade = staffRawRows
    .slice(1)
    .filter((r) => (r[1] || '').trim().length > 0)
    .some((r) => {
      const rawColA = (r[0] || '').trim();
      const rawName = (r[1] || '').trim();
      const rawColH = (r[7] || '').trim();
      const matched = finalStaff.find((s) => s.name.trim() === rawName);
      const targetCode = getStaffEmployeeCode(matched);
      return Boolean(targetCode && (rawColA !== targetCode || rawColH !== targetCode));
    });
  const shouldPushStaff = Boolean(
    options?.pushLocalStaff ||
      isStaffMasterDirty() ||
      sheetStaffRows.length === 0 ||
      remoteNeedsStaffIdUpgrade
  );

  // 4.5 Parse Audit_Logs from sheet & merge with pending outbox audits
  const sheetAuditLogs: AuditLogEntry[] = auditRawRows
    .slice(1)
    .filter((r) => (r[0] || '').trim() && (r[1] || '').trim())
    .map((r, idx) => ({
      id: `AUD-GS-${Date.now()}-${idx}`,
      timestamp: String(r[0] || '').trim(),
      action: String(r[1] || 'แก้ไขวันลา').trim() as AuditLogEntry['action'],
      targetName: String(r[2] || '').trim(),
      summary: String(r[3] || '').trim(),
      reason: String(r[4] || '').trim(),
      editedBy: String(r[5] || '').trim() || undefined,
    }));

  const sheetAuditKeys = new Set(sheetAuditLogs.map(auditLogKey));
  pruneOutboxSyncedAgainstRemote({ remoteAuditKeys: sheetAuditKeys });
  const auditLogsToPush = getPendingOutboxAuditLogs().filter(
    (a) => !sheetAuditKeys.has(auditLogKey(a))
  );
  const existingAuditMap = new Map<string, AuditLogEntry>();
  (db.auditLogs || []).forEach((a) => {
    const k = auditLogKey(a);
    if (!existingAuditMap.has(k)) existingAuditMap.set(k, a);
  });
  const mergedAuditLogs = [
    ...auditLogsToPush,
    ...sheetAuditLogs.map((sa) => {
      const prev = existingAuditMap.get(auditLogKey(sa));
      return prev ? { ...sa, id: prev.id } : sa;
    }),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // 5. Parse or Push Settings
  const settingsMap: Record<string, string> = {};
  settingsRawRows.slice(1).forEach((r) => {
    if (r[0]) settingsMap[String(r[0]).trim()] = String(r[1] || '').trim();
  });

  const settingsDirty = isSettingsDirty();
  const parsedRemoteHolidays = (() => {
    try {
      const raw = settingsMap['Custom_Holidays'];
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore malformed JSON
    }
    return [];
  })();

  const parsedRemoteAdminPins = (() => {
    try {
      const raw = settingsMap['Additional_Admin_Pins'];
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return normalizeAdditionalAdminPins(parsed);
      }
    } catch {
      // ignore malformed JSON
    }
    return null;
  })();

  const finalSettings: SystemSettings = {
    ...db.settings,
    nhppd: settingsDirty
      ? Number(db.settings.nhppd) || 0.4
      : Number(settingsMap['NHPPD']) || Number(db.settings.nhppd) || 0.4,
    screeningNhppd: settingsDirty
      ? Number(db.settings.screeningNhppd) || 0.1
      : Number(settingsMap['Screening_NHPPD']) || Number(db.settings.screeningNhppd) || 0.1,
    stdHr: db.settings.stdHr || Number(settingsMap['Std_Hr']) || 7,
    annualHr: db.settings.annualHr || Number(settingsMap['Annual_Hr']) || 2080,
    workDays: db.settings.workDays || Number(settingsMap['Work_Days']) || 245,
    inTimeClinics: ensureReferralInClinicList(
      db.settings.inTimeClinics && db.settings.inTimeClinics.length > 0
        ? db.settings.inTimeClinics
        : settingsMap['In_Time_Clinics']
        ? settingsMap['In_Time_Clinics'].split(',').map((s) => s.trim()).filter(Boolean)
        : [...IN_TIME_CLINICS]
    ),
    outTimeClinics:
      db.settings.outTimeClinics && db.settings.outTimeClinics.length > 0
        ? db.settings.outTimeClinics
        : settingsMap['Out_Time_Clinics']
        ? settingsMap['Out_Time_Clinics'].split(',').map((s) => s.trim()).filter(Boolean)
        : [...OUT_TIME_CLINICS],
    premiumSubClinics: settingsDirty
      ? db.settings.premiumSubClinics && db.settings.premiumSubClinics.length > 0
        ? db.settings.premiumSubClinics
        : [...DEFAULT_PREMIUM_SUB_CLINICS]
      : settingsMap['Premium_Sub_Clinics']
      ? settingsMap['Premium_Sub_Clinics'].split(',').map((s) => s.trim()).filter(Boolean)
      : db.settings.premiumSubClinics && db.settings.premiumSubClinics.length > 0
      ? db.settings.premiumSubClinics
      : [...DEFAULT_PREMIUM_SUB_CLINICS],
    leaveTypes:
      db.settings.leaveTypes && db.settings.leaveTypes.length > 0
        ? db.settings.leaveTypes
        : settingsMap['Leave_Types']
        ? settingsMap['Leave_Types'].split(',').map((s) => s.trim()).filter(Boolean)
        : [...LEAVE_TYPES],
    customHolidays: settingsDirty
      ? db.settings.customHolidays || []
      : db.settings.customHolidays && db.settings.customHolidays.length > 0
      ? db.settings.customHolidays
      : parsedRemoteHolidays,
    primaryAdminOwner: settingsDirty
      ? db.settings.primaryAdminOwner || DEFAULT_PRIMARY_ADMIN_OWNER
      : settingsMap['Primary_Admin_Owner'] ||
        db.settings.primaryAdminOwner ||
        DEFAULT_PRIMARY_ADMIN_OWNER,
    additionalAdminPins: settingsDirty
      ? normalizeAdditionalAdminPins(db.settings.additionalAdminPins)
      : parsedRemoteAdminPins || normalizeAdditionalAdminPins(db.settings.additionalAdminPins),
    gasUrl: settingsDirty
      ? db.settings.gasUrl || ''
      : db.settings.gasUrl || settingsMap['Gas_Web_App_URL'] || '',
    defaultCostCenter: settingsDirty
      ? db.settings.defaultCostCenter || DEFAULT_OT_COST_CENTER
      : settingsMap['Default_Cost_Center'] ||
        db.settings.defaultCostCenter ||
        DEFAULT_OT_COST_CENTER,
    clinicCostCenters: settingsDirty
      ? db.settings.clinicCostCenters || {}
      : parseJsonRecordSafe<Record<string, string>>(settingsMap['Clinic_Cost_Centers']) ||
        db.settings.clinicCostCenters ||
        {},
    otHourlyRates: settingsDirty
      ? db.settings.otHourlyRates || {}
      : parseJsonRecordSafe<Partial<Record<StaffPosition, number>>>(settingsMap['OT_Hourly_Rates']) ||
        db.settings.otHourlyRates ||
        {},
    otControllerName: settingsDirty
      ? db.settings.otControllerName || DEFAULT_OT_CONTROLLER_NAME
      : settingsMap['OT_Controller_Name'] ||
        db.settings.otControllerName ||
        DEFAULT_OT_CONTROLLER_NAME,
    lineAutoEnabled: settingsDirty
      ? Boolean(db.settings.lineAutoEnabled)
      : settingsMap['Line_Auto_Enabled'] !== undefined
      ? settingsMap['Line_Auto_Enabled'].toLowerCase() === 'true'
      : Boolean(db.settings.lineAutoEnabled),
    lineAutoTime: normalizeLineTimeString(
      settingsDirty
        ? db.settings.lineAutoTime
        : settingsMap['Line_Auto_Time'] || db.settings.lineAutoTime,
      DEFAULT_LINE_AUTO_TIME
    ),
    lineAutoReportDayMode: ((): LineAutoReportDayMode => {
      const raw = settingsDirty
        ? db.settings.lineAutoReportDayMode
        : settingsMap['Line_Auto_Report_Day'] || db.settings.lineAutoReportDayMode;
      return raw === 'YESTERDAY' || raw === 'LATEST_WITH_DATA' ? raw : 'TODAY';
    })(),
    lineAutoShift: settingsDirty
      ? db.settings.lineAutoShift || 'ในเวลา 08:00-16:00'
      : ((settingsMap['Line_Auto_Shift'] as 'ALL' | WorkShift) ||
          db.settings.lineAutoShift ||
          'ในเวลา 08:00-16:00'),
    lineTargetId: settingsDirty
      ? db.settings.lineTargetId || DEFAULT_LINE_GROUP_ID
      : settingsMap['Line_Target_Id'] !== undefined && settingsMap['Line_Target_Id'] !== ''
      ? settingsMap['Line_Target_Id']
      : db.settings.lineTargetId || DEFAULT_LINE_GROUP_ID,
    lineTargetGroups: settingsDirty
      ? db.settings.lineTargetGroups || DEFAULT_LINE_TARGET_GROUPS
      : parseJsonArraySafe<LineTargetGroup>(settingsMap['Line_Target_Groups']) ||
        db.settings.lineTargetGroups ||
        DEFAULT_LINE_TARGET_GROUPS,
    lineSchedules: ((): LineReportSchedule[] => {
      const rawArr = settingsDirty
        ? db.settings.lineSchedules
        : parseJsonArraySafe<LineReportSchedule>(settingsMap['Line_Schedules']) ||
          db.settings.lineSchedules;
      const list = rawArr && rawArr.length > 0 ? rawArr : DEFAULT_LINE_SCHEDULES;
      return list.map((s) => ({
        ...s,
        time: normalizeLineTimeString(s.time, DEFAULT_LINE_AUTO_TIME),
      }));
    })(),
    lineSendAsImage: settingsDirty
      ? db.settings.lineSendAsImage !== false
      : settingsMap['Line_Send_As_Image'] !== undefined
      ? settingsMap['Line_Send_As_Image'].toLowerCase() !== 'false'
      : db.settings.lineSendAsImage !== false,
    lineSendFormat: settingsDirty
      ? resolveLineSendFormat(db.settings.lineSendFormat, db.settings.lineSendAsImage)
      : resolveLineSendFormat(
          settingsMap['Line_Send_Format'],
          settingsMap['Line_Send_As_Image'] !== undefined
            ? settingsMap['Line_Send_As_Image'].toLowerCase() !== 'false'
            : db.settings.lineSendAsImage
        ),
    lineChannelTokenSet:
      settingsMap['Line_Channel_Token_Set'] !== undefined
        ? settingsMap['Line_Channel_Token_Set'].toLowerCase() === 'true'
        : Boolean(db.settings.lineChannelTokenSet),
    lineLastSentAt:
      settingsMap['Line_Last_Sent_At'] !== undefined
        ? settingsMap['Line_Last_Sent_At']
        : db.settings.lineLastSentAt,
    lineLastSentReportDate:
      settingsMap['Line_Last_Sent_Report_Date'] !== undefined
        ? settingsMap['Line_Last_Sent_Report_Date']
        : db.settings.lineLastSentReportDate,
    lineLastStatus:
      settingsMap['Line_Last_Status'] !== undefined
        ? settingsMap['Line_Last_Status']
        : db.settings.lineLastStatus,
    lineDetectedGroupId:
      settingsMap['Line_Detected_Group_ID'] !== undefined
        ? settingsMap['Line_Detected_Group_ID']
        : db.settings.lineDetectedGroupId,
    lineDetectedGroupName:
      settingsMap['Line_Detected_Group_Name'] !== undefined
        ? settingsMap['Line_Detected_Group_Name']
        : db.settings.lineDetectedGroupName,
    boobyOwnerName: settingsDirty
      ? db.settings.boobyOwnerName || DEFAULT_BOOBY_OWNER_NAME
      : settingsMap['Booby_Owner_Name'] || db.settings.boobyOwnerName || DEFAULT_BOOBY_OWNER_NAME,
    boobyOwnerUserId: settingsDirty
      ? db.settings.boobyOwnerUserId || ''
      : settingsMap['Booby_Owner_User_ID'] !== undefined
      ? settingsMap['Booby_Owner_User_ID']
      : db.settings.boobyOwnerUserId || '',
    boobyGroupMentionOnly: settingsDirty
      ? db.settings.boobyGroupMentionOnly !== false
      : settingsMap['Booby_Group_Mention_Only'] !== undefined
      ? settingsMap['Booby_Group_Mention_Only'].toLowerCase() !== 'false'
      : db.settings.boobyGroupMentionOnly !== false,
  };

  // 6. Push headers + updated tabs back to Google Sheets cleanly
  const writeData: { range: string; values: (string | number)[][] }[] = [];

  if (shouldPushStaff) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Staff_Master!A:H:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    writeData.push({
      range: 'Staff_Master!A1:H',
      values: [
        ['Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status', 'Start_Date', 'End_Date', 'Employee_Code'],
        ...finalStaff.map(prepareStaffRowForSheet),
      ],
    });
  }

  if (shouldOverwriteWorkloads) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Daily_Workload!A:R:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    writeData.push({
      range: 'Daily_Workload!A1:R',
      values: [
        [
          'Date',
          'Shift',
          'Clinic',
          'Total_Pt',
          'Adult_Pt',
          'Child_Pt',
          'Admit',
          'HN',
          'RN',
          'PN',
          'NA',
          'Clerk',
          'Service_Worker',
          'Note',
          'Reporter',
          'Clinic_Group',
          'Pool_ID',
          'Record_Type',
        ],
        ...mergedWorkloads.map((w) => [
          w.date,
          w.shift,
          w.clinic,
          getEffectiveTotalPt(w),
          w.adultPt,
          w.childPt,
          w.admit,
          w.hn,
          w.rn,
          w.pn,
          w.na ?? w.pca ?? 0,
          w.clerk,
          w.serviceWorker,
          encodeWorkloadNoteForSheet(w),
          w.reporter,
          w.clinicGroup || '',
          w.poolId || '',
          w.recordType || 'STANDARD',
        ]),
      ],
    });
  } else if (workloadRawRows.length === 0) {
    writeData.push({
      range: 'Daily_Workload!A1:R1',
      values: [
        [
          'Date',
          'Shift',
          'Clinic',
          'Total_Pt',
          'Adult_Pt',
          'Child_Pt',
          'Admit',
          'HN',
          'RN',
          'PN',
          'NA',
          'Clerk',
          'Service_Worker',
          'Note',
          'Reporter',
          'Clinic_Group',
          'Pool_ID',
          'Record_Type',
        ],
      ],
    });
  }

  if (shouldOverwriteLeaves) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Leave_Records!A:H:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    writeData.push({
      range: 'Leave_Records!A1:H',
      values: [
        ['Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note'],
        ...mergedLeaves.map((l) => [
          l.startDate,
          l.endDate,
          l.staffName,
          l.position,
          l.clinic,
          l.leaveType,
          l.days,
          l.note || '',
        ]),
      ],
    });
  } else if (leaveRawRows.length === 0) {
    writeData.push({
      range: 'Leave_Records!A1:H1',
      values: [['Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note']],
    });
  }

  if (shouldOverwriteOt) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/OT_Attendance!A:H:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    writeData.push({
      range: 'OT_Attendance!A1:H',
      values: [
        ['Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic', 'Hours', 'Employee_Code'],
        ...mergedOt.map((o) => [
          o.date,
          o.shift,
          o.staffName,
          o.position,
          o.homeClinic,
          formatOtWorkClinicForSheet(o.workClinic, o.hours, o.shift),
          getEffectiveOtHours(o),
          o.employeeCode || '',
        ]),
      ],
    });
  } else if (otRawRows.length === 0) {
    writeData.push({
      range: 'OT_Attendance!A1:H1',
      values: [['Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic', 'Hours', 'Employee_Code']],
    });
  }

  if (auditRawRows.length === 0) {
    writeData.push({
      range: 'Audit_Logs!A1:F1',
      values: [['Timestamp', 'Action', 'Target_Name', 'Summary', 'Reason', 'Edited_By']],
    });
  }

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Settings!A:B:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const fullSettingsRows = buildSettingsSheetRows(finalSettings, finalStaff);
  writeData.push({
    range: `Settings!A1:B${fullSettingsRows.length}`,
    values: fullSettingsRows,
  });

  if (writeData.length > 0) {
    const batchWriteRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'USER_ENTERED',
          data: writeData,
        }),
      }
    );
    if (!batchWriteRes.ok) {
      const errText = await batchWriteRes.text();
      throw parseSheetsApiError(errText, 'อัปเดตข้อมูลไปยัง Google Sheets ไม่สำเร็จ');
    }
  }

  // Append missing local transaction rows
  if (workloadsToPush.length > 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Daily_Workload!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: workloadsToPush.map((w) => [
            w.date,
            w.shift,
            w.clinic,
            getEffectiveTotalPt(w),
            w.adultPt,
            w.childPt,
            w.admit,
            w.hn,
            w.rn,
            w.pn,
            w.na ?? w.pca ?? 0,
            w.clerk,
            w.serviceWorker,
            encodeWorkloadNoteForSheet(w),
            w.reporter,
            w.clinicGroup || '',
            w.poolId || '',
            w.recordType || 'STANDARD',
          ]),
        }),
      }
    );
  }

  if (leavesToPush.length > 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Leave_Records!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: leavesToPush.map((l) => [
            l.startDate,
            l.endDate,
            l.staffName,
            l.position,
            l.clinic,
            l.leaveType,
            l.days,
            l.note || '',
          ]),
        }),
      }
    );
  }

  if (otToPush.length > 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/OT_Attendance!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: otToPush.map((o) => [
            o.date,
            o.shift,
            o.staffName,
            o.position,
            o.homeClinic,
            formatOtWorkClinicForSheet(o.workClinic, o.hours, o.shift),
            getEffectiveOtHours(o),
            o.employeeCode || '',
          ]),
        }),
      }
    );
  }

  if (auditLogsToPush.length > 0) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Audit_Logs!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: auditLogsToPush.map((a) => [
            a.timestamp,
            a.action,
            a.targetName,
            a.summary,
            a.reason,
            a.editedBy || '',
          ]),
        }),
      }
    );
  }

  clearStaffMasterDirty();
  clearSettingsDirty();
  clearWorkloadsDirty();
  clearLeavesDirty();
  clearOtDirty();
  if (workloadsToPush.length > 0) markWorkloadOutboxSynced(workloadsToPush);
  if (leavesToPush.length > 0) markLeaveOutboxSynced(leavesToPush);
  if (otToPush.length > 0) markOtOutboxSynced(otToPush);
  if (auditLogsToPush.length > 0) markAuditOutboxSynced(auditLogsToPush);
  if (shouldOverwriteWorkloads) clearAllWorkloadTombstones();
  if (shouldOverwriteLeaves) clearAllLeaveTombstones();
  if (shouldOverwriteOt) clearAllOtTombstones();

  return {
    mergedDb: {
      staff: finalStaff,
      workloads: mergedWorkloads,
      leaves: mergedLeaves,
      ot: mergedOt,
      auditLogs: mergedAuditLogs,
      settings: finalSettings,
    },
    pushedWorkloads: workloadsToPush.length,
    pulledWorkloads: workloadsPulled.length,
    staffCount: finalStaff.length,
  };
};

/**
 * Appends a daily workload entry to Google Sheets
 */
export const appendDailyWorkloadToSheet = async (
  accessToken: string,
  spreadsheetId: string,
  entryOrEntries: DailyWorkload | DailyWorkload[]
): Promise<boolean> => {
  try {
    const entries = Array.isArray(entryOrEntries) ? entryOrEntries : [entryOrEntries];
    if (entries.length === 0) return true;
    const rows = entries.map((entry) => [
      entry.date,
      entry.shift,
      entry.clinic,
      getEffectiveTotalPt(entry),
      entry.adultPt,
      entry.childPt,
      entry.admit,
      entry.hn,
      entry.rn,
      entry.pn,
      entry.na ?? entry.pca ?? 0,
      entry.clerk,
      entry.serviceWorker,
      encodeWorkloadNoteForSheet(entry),
      entry.reporter,
      entry.clinicGroup || '',
      entry.poolId || '',
      entry.recordType || 'STANDARD',
    ]);

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Daily_Workload!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: rows }),
      }
    );
    return res.ok;
  } catch (err) {
    console.error('Failed to append daily workload to sheet:', err);
    return false;
  }
};

/**
 * Appends a leave record to Google Sheets
 */
export const appendLeaveToSheet = async (
  accessToken: string,
  spreadsheetId: string,
  leave: LeaveRecord
): Promise<boolean> => {
  try {
    const row = [
      leave.startDate,
      leave.endDate,
      leave.staffName,
      leave.position,
      leave.clinic,
      leave.leaveType,
      leave.days,
      leave.note || '',
    ];

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Leave_Records!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [row] }),
      }
    );
    return res.ok;
  } catch (err) {
    console.error('Failed to append leave to sheet:', err);
    return false;
  }
};

/**
 * Appends an OT record to Google Sheets
 */
export const appendOTToSheet = async (
  accessToken: string,
  spreadsheetId: string,
  ot: OTAttendance
): Promise<boolean> => {
  try {
    const row = [
      ot.date,
      ot.shift,
      ot.staffName,
      ot.position,
      ot.homeClinic,
      formatOtWorkClinicForSheet(ot.workClinic, ot.hours, ot.shift),
      getEffectiveOtHours(ot),
      ot.employeeCode || '',
    ];

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/OT_Attendance!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [row] }),
      }
    );
    return res.ok;
  } catch (err) {
    console.error('Failed to append OT to sheet:', err);
    return false;
  }
};

/**
 * Appends an audit log entry to Google Sheets (Audit_Logs tab)
 */
export const appendAuditLogToSheet = async (
  accessToken: string,
  spreadsheetId: string,
  entry: AuditLogEntry
): Promise<boolean> => {
  try {
    const row = [
      entry.timestamp,
      entry.action,
      entry.targetName,
      entry.summary,
      entry.reason,
      entry.editedBy || '',
    ];

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Audit_Logs!A1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: [row] }),
      }
    );
    return res.ok;
  } catch (err) {
    console.error('Failed to append audit log to sheet:', err);
    return false;
  }
};

/**
 * Grants anyone-with-link READ-ONLY permission on the spreadsheet when Admin shares the link,
 * allowing shared OPD staff to view staff master & schedules automatically without login.
 */
export const ensureSheetAnyoneReaderPermission = async (
  accessToken: string,
  spreadsheetId: string
): Promise<boolean> => {
  if (!accessToken || !spreadsheetId) return false;
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}/permissions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone',
        }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
};

function formatGvizCell(cell: any): string {
  if (!cell || cell.v === null || cell.v === undefined) return '';
  if (typeof cell.v === 'string') {
    const dateMatch = cell.v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
    if (dateMatch) {
      const y = Number(dateMatch[1]);
      const m = Number(dateMatch[2]) + 1;
      const d = Number(dateMatch[3]);
      if (dateMatch[4] !== undefined && y < 1900) {
        return String(cell.f || cell.v);
      }
      return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    return cell.v;
  }
  if (typeof cell.f === 'string' && /^\d{4}-\d{2}-\d{2}/.test(cell.f.trim())) {
    return cell.f.trim();
  }
  return String(cell.v);
}

async function fetchGvizSheetRows(spreadsheetId: string, sheetName: string): Promise<string[][] | null> {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
      spreadsheetId
    )}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheetName)}&_ts=${Date.now()}`;
    const res = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.trim().startsWith('<') || !text.includes('setResponse(')) {
      return null;
    }
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (startIdx < 0 || endIdx <= startIdx) return null;
    const parsed = JSON.parse(text.slice(startIdx, endIdx + 1));
    if (parsed.status === 'error' || !parsed.table) return null;
    const rows: any[] = Array.isArray(parsed.table.rows) ? parsed.table.rows : [];
    return rows.map((row) =>
      (Array.isArray(row.c) ? row.c : []).map((cell: any) => formatGvizCell(cell))
    );
  } catch {
    return null;
  }
}

interface MergeRemoteExtraOptions {
  justPushedWorkloads?: DailyWorkload[];
  justPushedLeaves?: LeaveRecord[];
  justPushedOt?: OTAttendance[];
  justPushedAudits?: AuditLogEntry[];
}

function mergeRemoteDataRows(
  params: {
    staffRows: string[][] | null;
    workloadRows: string[][] | null;
    leaveRows: string[][] | null;
    otRows: string[][] | null;
    settingsRows: string[][] | null;
    auditRows: string[][] | null;
  },
  db: AppDatabase,
  extra?: MergeRemoteExtraOptions
): AppDatabase {
  const settingsMap: Record<string, string> = {};
  (params.settingsRows || []).forEach((r) => {
    if (r[0]) settingsMap[String(r[0]).trim()] = String(r[1] || '').trim();
  });
  const remoteStaffCodeMap = parseJsonRecordSafe<Record<string, string>>(
    settingsMap['Staff_Employee_Codes']
  );

  const sheetStaff: StaffMember[] = (params.staffRows || [])
    .filter((r) => (r[1] || '').trim().length > 0)
    .map((r, idx) => {
      const rawPos = (r[2] || 'RN').trim();
      const pos = normalizeStaffPosition(rawPos);
      const rawStatus = (r[4] || 'Active').trim();
      const status: StaffStatus =
        rawStatus === 'Resigned' || rawStatus === 'Retired' ? rawStatus : 'Active';
      const rawColA = (r[0] || `STF-GS-${idx + 1}`).trim();
      const name = (r[1] || '').trim();
      const colCode = (r[7] || '').trim();
      const prevMatch = db.staff.find((s) => s.staffId === rawColA || s.name.trim() === name);
      const resolvedCode =
        (isValidEmployeeCodeValue(colCode) ? colCode : '') ||
        (!isLegacyGeneratedStaffId(rawColA) ? rawColA : '') ||
        remoteStaffCodeMap?.[rawColA] ||
        remoteStaffCodeMap?.[name] ||
        getStaffEmployeeCode(prevMatch);
      const staffId = isValidEmployeeCodeValue(resolvedCode) ? resolvedCode : rawColA;
      return {
        staffId,
        employeeCode: isValidEmployeeCodeValue(resolvedCode) ? resolvedCode : undefined,
        name,
        position: pos,
        homeClinic: (r[3] || '').trim(),
        status,
        startDate: (r[5] || '').trim() || undefined,
        endDate: (r[6] || '').trim() || undefined,
      };
    });

  const baseFinalStaff = isStaffMasterDirty() ? db.staff : sheetStaff.length > 0 ? sheetStaff : db.staff;
  const remotePremiumClinics = settingsMap['Premium_Sub_Clinics']
    ? settingsMap['Premium_Sub_Clinics'].split(',').map((s) => s.trim()).filter(Boolean)
    : db.settings.premiumSubClinics;

  const deletedWKeys = getDeletedWorkloadKeySet();
  let mergedWorkloads: DailyWorkload[];
  if (isWorkloadsDirty() || params.workloadRows === null) {
    mergedWorkloads = [...db.workloads];
  } else {
    const existingWorkloadQueue = new Map<string, DailyWorkload[]>();
    db.workloads.forEach((w) => {
      const k = workloadKey(w);
      const arr = existingWorkloadQueue.get(k);
      if (arr) arr.push(w);
      else existingWorkloadQueue.set(k, [w]);
    });

    const sheetWorkloads: DailyWorkload[] = params.workloadRows
      .filter((r) => (r[0] || '').trim() && (r[2] || '').trim())
      .map((r, idx) => {
        const adultPt = Number(r[4] || 0);
        const childPt = Number(r[5] || 0);
        const totalPt = Math.max(Number(r[3] || 0), adultPt + childPt);
        const rawRecordType = String(r[17] || '').trim();
        const recordType: WorkloadRecordType | undefined =
          rawRecordType === 'PREMIUM_POOL' || rawRecordType === 'PREMIUM_SUB' || rawRecordType === 'STANDARD'
            ? rawRecordType
            : undefined;
        const normalized = normalizeWorkloadRecord(
          {
            id: `REC-GS-${Date.now()}-${idx}`,
            date: String(r[0] || '').trim(),
            shift: String(r[1] || 'ในเวลา 08:00-16:00').trim() as WorkShift,
            clinic: String(r[2] || '').trim(),
            totalPt,
            adultPt,
            childPt,
            admit: Number(r[6] || 0),
            hn: Number(r[7] || 0),
            rn: Number(r[8] || 0),
            pn: Number(r[9] || 0),
            na: Number(r[10] || 0),
            clerk: Number(r[11] || 0),
            serviceWorker: Number(r[12] || 0),
            note: String(r[13] || '').trim(),
            reporter: String(r[14] || '').trim(),
            clinicGroup: String(r[15] || '').trim() || undefined,
            poolId: String(r[16] || '').trim() || undefined,
            recordType,
          },
          remotePremiumClinics
        );
        const matches = existingWorkloadQueue.get(workloadKey(normalized));
        const prev = matches && matches.length > 0 ? matches.shift() : undefined;
        if (!prev) return normalized;
        return {
          ...normalized,
          id: prev.id,
          lastEditedAt: prev.lastEditedAt,
          lastEditReason: prev.lastEditReason,
          lastEditedBy: prev.lastEditedBy,
        };
      })
      .filter((w) => !deletedWKeys.has(workloadKey(w)));

    const sheetWKeys = new Set(sheetWorkloads.map(workloadKey));
    pruneOutboxSyncedAgainstRemote({ remoteWKeys: sheetWKeys });

    pruneExpiredRecentSaved();
    recentSavedWorkloads = recentSavedWorkloads.filter((x) => !sheetWKeys.has(x.key));

    const outboxAndJustPushedW: DailyWorkload[] = [];
    const seenPendingW = new Set<string>();
    [
      ...getPendingOutboxWorkloads(),
      ...(extra?.justPushedWorkloads || []),
      ...recentSavedWorkloads.map((x) => x.item),
    ].forEach((w) => {
      const normalized = normalizeWorkloadRecord(
        { ...w, totalPt: getEffectiveTotalPt(w) },
        remotePremiumClinics
      );
      const k = workloadKey(normalized);
      if (!deletedWKeys.has(k) && !sheetWKeys.has(k) && !seenPendingW.has(w.id || k)) {
        seenPendingW.add(w.id || k);
        outboxAndJustPushedW.push(normalized);
      }
    });

    mergedWorkloads = deduplicateWorkloads(
      [...outboxAndJustPushedW, ...sheetWorkloads],
      remotePremiumClinics
    ).sort((a, b) => b.date.localeCompare(a.date));
  }

  const deletedLKeys = getDeletedLeaveKeySet();
  let mergedLeaves: LeaveRecord[];
  if (isLeavesDirty() || params.leaveRows === null) {
    mergedLeaves = [...db.leaves];
  } else {
    const existingLeaveQueue = new Map<string, LeaveRecord[]>();
    db.leaves.forEach((l) => {
      const k = leaveKey(l);
      const arr = existingLeaveQueue.get(k);
      if (arr) arr.push(l);
      else existingLeaveQueue.set(k, [l]);
    });

    const sheetLeaves: LeaveRecord[] = params.leaveRows
      .filter((r) => (r[0] || '').trim() && (r[2] || '').trim())
      .map((r, idx) => {
        const rawPos = (r[3] || 'RN').trim();
        const item: LeaveRecord = {
          id: `LV-GS-${Date.now()}-${idx}`,
          startDate: String(r[0] || '').trim(),
          endDate: String(r[1] || r[0] || '').trim(),
          staffName: String(r[2] || '').trim(),
          position: normalizeStaffPosition(rawPos),
          clinic: String(r[4] || '').trim(),
          leaveType: String(r[5] || 'ลาป่วย').trim() as LeaveType,
          days: Number(r[6] || 1),
          note: String(r[7] || '').trim(),
        };
        const matches = existingLeaveQueue.get(leaveKey(item));
        const prev = matches && matches.length > 0 ? matches.shift() : undefined;
        if (!prev) return item;
        return {
          ...item,
          id: prev.id,
          lastEditedAt: prev.lastEditedAt,
          lastEditReason: prev.lastEditReason,
          lastEditedBy: prev.lastEditedBy,
        };
      })
      .filter((l) => !deletedLKeys.has(leaveKey(l)));

    const sheetLKeys = new Set(sheetLeaves.map(leaveKey));
    pruneOutboxSyncedAgainstRemote({ remoteLKeys: sheetLKeys });

    pruneExpiredRecentSaved();
    recentSavedLeaves = recentSavedLeaves.filter((x) => !sheetLKeys.has(x.key));

    const outboxAndJustPushedL: LeaveRecord[] = [];
    const seenPendingL = new Set<string>();
    [
      ...getPendingOutboxLeaves(),
      ...(extra?.justPushedLeaves || []),
      ...recentSavedLeaves.map((x) => x.item),
    ].forEach((l) => {
      const k = leaveKey(l);
      if (!deletedLKeys.has(k) && !sheetLKeys.has(k) && !seenPendingL.has(l.id || k)) {
        seenPendingL.add(l.id || k);
        outboxAndJustPushedL.push(l);
      }
    });

    mergedLeaves = [...outboxAndJustPushedL, ...sheetLeaves].sort((a, b) =>
      b.startDate.localeCompare(a.startDate)
    );
  }

  const deletedOKeys = getDeletedOtKeySet();
  let rawMergedOt: OTAttendance[];
  if (isOtDirty() || params.otRows === null) {
    rawMergedOt = [...db.ot];
  } else {
    const existingOtQueue = new Map<string, OTAttendance[]>();
    db.ot.forEach((o) => {
      const k = otKey(o);
      const arr = existingOtQueue.get(k);
      if (arr) arr.push(o);
      else existingOtQueue.set(k, [o]);
    });

    const sheetOt: OTAttendance[] = params.otRows
      .filter((r) => (r[0] || '').trim() && (r[2] || '').trim())
      .map((r, idx) => {
        const item = parseSheetOtRecord(r, `OT-GS-${Date.now()}-${idx}`, baseFinalStaff);
        const matches = existingOtQueue.get(otKey(item));
        const prev = matches && matches.length > 0 ? matches.shift() : undefined;
        if (!prev) return item;
        return {
          ...item,
          id: prev.id,
          hours: item.hours ?? prev.hours,
          employeeCode: item.employeeCode || prev.employeeCode,
          isExternal: prev.isExternal,
          affiliation: prev.affiliation,
          lastEditedAt: prev.lastEditedAt,
          lastEditReason: prev.lastEditReason,
          lastEditedBy: prev.lastEditedBy,
        };
      })
      .filter((o) => !deletedOKeys.has(otKey(o)));

    const sheetOKeys = new Set(sheetOt.map(otKey));
    pruneOutboxSyncedAgainstRemote({ remoteOKeys: sheetOKeys });

    pruneExpiredRecentSaved();
    recentSavedOt = recentSavedOt.filter((x) => !sheetOKeys.has(x.key));

    const outboxAndJustPushedO: OTAttendance[] = [];
    const seenPendingO = new Set<string>();
    [
      ...getPendingOutboxOt(),
      ...(extra?.justPushedOt || []),
      ...recentSavedOt.map((x) => x.item),
    ].forEach((o) => {
      const k = otKey(o);
      if (!deletedOKeys.has(k) && !sheetOKeys.has(k) && !seenPendingO.has(o.id || k)) {
        seenPendingO.add(o.id || k);
        outboxAndJustPushedO.push(o);
      }
    });

    rawMergedOt = [...outboxAndJustPushedO, ...sheetOt].sort((a, b) => b.date.localeCompare(a.date));
  }

  const hydratedMerge = hydrateUnifiedStaffAndOt(baseFinalStaff, rawMergedOt, remoteStaffCodeMap);
  const finalStaff = hydratedMerge.staff;
  const mergedOt = hydratedMerge.ot;

  let mergedAuditLogs: AuditLogEntry[];
  if (params.auditRows === null) {
    mergedAuditLogs = [...(db.auditLogs || [])];
  } else {
    const existingAuditMap = new Map<string, AuditLogEntry>();
    (db.auditLogs || []).forEach((a) => {
      const k = auditLogKey(a);
      if (!existingAuditMap.has(k)) existingAuditMap.set(k, a);
    });

    const sheetAuditLogs: AuditLogEntry[] = params.auditRows
      .filter((r) => (r[0] || '').trim() && (r[1] || '').trim())
      .map((r, idx) => {
        const entry: AuditLogEntry = {
          id: `AUD-GS-${Date.now()}-${idx}`,
          timestamp: String(r[0] || '').trim(),
          action: String(r[1] || 'แก้ไขวันลา').trim() as AuditLogEntry['action'],
          targetName: String(r[2] || '').trim(),
          summary: String(r[3] || '').trim(),
          reason: String(r[4] || '').trim(),
          editedBy: String(r[5] || '').trim() || undefined,
        };
        const prev = existingAuditMap.get(auditLogKey(entry));
        return prev ? { ...entry, id: prev.id } : entry;
      });

    const sheetAuditKeys = new Set(sheetAuditLogs.map(auditLogKey));
    pruneOutboxSyncedAgainstRemote({ remoteAuditKeys: sheetAuditKeys });

    const outboxAndJustPushedA: AuditLogEntry[] = [];
    const seenPendingA = new Set<string>();
    [...getPendingOutboxAuditLogs(), ...(extra?.justPushedAudits || [])].forEach((a) => {
      const k = auditLogKey(a);
      if (!sheetAuditKeys.has(k) && !seenPendingA.has(k)) {
        seenPendingA.add(k);
        outboxAndJustPushedA.push(a);
      }
    });

    mergedAuditLogs = [...outboxAndJustPushedA, ...sheetAuditLogs].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
  }

  const settingsDirty = isSettingsDirty();
  const parsedHolidays = (() => {
    try {
      const raw = settingsMap['Custom_Holidays'];
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) return p;
      }
    } catch {
      // ignore
    }
    return null;
  })();

  const parsedPins = (() => {
    try {
      const raw = settingsMap['Additional_Admin_Pins'];
      if (raw) {
        const p = JSON.parse(raw);
        if (Array.isArray(p)) return normalizeAdditionalAdminPins(p);
      }
    } catch {
      // ignore
    }
    return null;
  })();

  const finalSettings: SystemSettings = {
    ...db.settings,
    nhppd: settingsDirty
      ? Number(db.settings.nhppd) || 0.4
      : Number(settingsMap['NHPPD']) || db.settings.nhppd || 0.4,
    screeningNhppd: settingsDirty
      ? Number(db.settings.screeningNhppd) || 0.1
      : Number(settingsMap['Screening_NHPPD']) || db.settings.screeningNhppd || 0.1,
    stdHr: settingsDirty
      ? Number(db.settings.stdHr) || 7
      : Number(settingsMap['Std_Hr']) || db.settings.stdHr || 7,
    annualHr: settingsDirty
      ? Number(db.settings.annualHr) || 2080
      : Number(settingsMap['Annual_Hr']) || db.settings.annualHr || 2080,
    workDays: settingsDirty
      ? Number(db.settings.workDays) || 245
      : Number(settingsMap['Work_Days']) || db.settings.workDays || 245,
    inTimeClinics: ensureReferralInClinicList(
      settingsDirty
        ? db.settings.inTimeClinics
        : settingsMap['In_Time_Clinics']
        ? settingsMap['In_Time_Clinics'].split(',').map((s) => s.trim()).filter(Boolean)
        : db.settings.inTimeClinics
    ),
    outTimeClinics: settingsDirty
      ? db.settings.outTimeClinics
      : settingsMap['Out_Time_Clinics']
      ? settingsMap['Out_Time_Clinics'].split(',').map((s) => s.trim()).filter(Boolean)
      : db.settings.outTimeClinics,
    premiumSubClinics: settingsDirty
      ? db.settings.premiumSubClinics && db.settings.premiumSubClinics.length > 0
        ? db.settings.premiumSubClinics
        : [...DEFAULT_PREMIUM_SUB_CLINICS]
      : settingsMap['Premium_Sub_Clinics']
      ? settingsMap['Premium_Sub_Clinics'].split(',').map((s) => s.trim()).filter(Boolean)
      : db.settings.premiumSubClinics && db.settings.premiumSubClinics.length > 0
      ? db.settings.premiumSubClinics
      : [...DEFAULT_PREMIUM_SUB_CLINICS],
    leaveTypes: settingsDirty
      ? db.settings.leaveTypes
      : settingsMap['Leave_Types']
      ? settingsMap['Leave_Types'].split(',').map((s) => s.trim()).filter(Boolean)
      : db.settings.leaveTypes,
    customHolidays: settingsDirty
      ? db.settings.customHolidays || []
      : parsedHolidays || db.settings.customHolidays || [],
    primaryAdminOwner: settingsDirty
      ? db.settings.primaryAdminOwner || DEFAULT_PRIMARY_ADMIN_OWNER
      : settingsMap['Primary_Admin_Owner'] ||
        db.settings.primaryAdminOwner ||
        DEFAULT_PRIMARY_ADMIN_OWNER,
    additionalAdminPins: settingsDirty
      ? normalizeAdditionalAdminPins(db.settings.additionalAdminPins)
      : parsedPins || normalizeAdditionalAdminPins(db.settings.additionalAdminPins),
    gasUrl: db.settings.isUnlinked
      ? ''
      : settingsDirty
      ? db.settings.gasUrl || INITIAL_SETTINGS.gasUrl || ''
      : db.settings.gasUrl || settingsMap['Gas_Web_App_URL'] || INITIAL_SETTINGS.gasUrl || '',
    defaultCostCenter: settingsDirty
      ? db.settings.defaultCostCenter || DEFAULT_OT_COST_CENTER
      : settingsMap['Default_Cost_Center'] ||
        db.settings.defaultCostCenter ||
        DEFAULT_OT_COST_CENTER,
    clinicCostCenters: settingsDirty
      ? db.settings.clinicCostCenters || {}
      : parseJsonRecordSafe<Record<string, string>>(settingsMap['Clinic_Cost_Centers']) ||
        db.settings.clinicCostCenters ||
        {},
    otHourlyRates: settingsDirty
      ? db.settings.otHourlyRates || {}
      : parseJsonRecordSafe<Partial<Record<StaffPosition, number>>>(settingsMap['OT_Hourly_Rates']) ||
        db.settings.otHourlyRates ||
        {},
    otControllerName: settingsDirty
      ? db.settings.otControllerName || DEFAULT_OT_CONTROLLER_NAME
      : settingsMap['OT_Controller_Name'] ||
        db.settings.otControllerName ||
        DEFAULT_OT_CONTROLLER_NAME,
    lineAutoEnabled: settingsDirty
      ? Boolean(db.settings.lineAutoEnabled)
      : settingsMap['Line_Auto_Enabled'] !== undefined
      ? settingsMap['Line_Auto_Enabled'].toLowerCase() === 'true'
      : Boolean(db.settings.lineAutoEnabled),
    lineAutoTime: normalizeLineTimeString(
      settingsDirty
        ? db.settings.lineAutoTime
        : settingsMap['Line_Auto_Time'] || db.settings.lineAutoTime,
      DEFAULT_LINE_AUTO_TIME
    ),
    lineAutoReportDayMode: ((): LineAutoReportDayMode => {
      const raw = settingsDirty
        ? db.settings.lineAutoReportDayMode
        : settingsMap['Line_Auto_Report_Day'] || db.settings.lineAutoReportDayMode;
      return raw === 'YESTERDAY' || raw === 'LATEST_WITH_DATA' ? raw : 'TODAY';
    })(),
    lineAutoShift: settingsDirty
      ? db.settings.lineAutoShift || 'ในเวลา 08:00-16:00'
      : ((settingsMap['Line_Auto_Shift'] as 'ALL' | WorkShift) ||
          db.settings.lineAutoShift ||
          'ในเวลา 08:00-16:00'),
    lineTargetId: settingsDirty
      ? db.settings.lineTargetId || DEFAULT_LINE_GROUP_ID
      : settingsMap['Line_Target_Id'] !== undefined && settingsMap['Line_Target_Id'] !== ''
      ? settingsMap['Line_Target_Id']
      : db.settings.lineTargetId || DEFAULT_LINE_GROUP_ID,
    lineTargetGroups: settingsDirty
      ? db.settings.lineTargetGroups || DEFAULT_LINE_TARGET_GROUPS
      : parseJsonArraySafe<LineTargetGroup>(settingsMap['Line_Target_Groups']) ||
        db.settings.lineTargetGroups ||
        DEFAULT_LINE_TARGET_GROUPS,
    lineSchedules: ((): LineReportSchedule[] => {
      const rawArr = settingsDirty
        ? db.settings.lineSchedules
        : parseJsonArraySafe<LineReportSchedule>(settingsMap['Line_Schedules']) ||
          db.settings.lineSchedules;
      const list = rawArr && rawArr.length > 0 ? rawArr : DEFAULT_LINE_SCHEDULES;
      return list.map((s) => ({
        ...s,
        time: normalizeLineTimeString(s.time, DEFAULT_LINE_AUTO_TIME),
      }));
    })(),
    lineSendAsImage: settingsDirty
      ? db.settings.lineSendAsImage !== false
      : settingsMap['Line_Send_As_Image'] !== undefined
      ? settingsMap['Line_Send_As_Image'].toLowerCase() !== 'false'
      : db.settings.lineSendAsImage !== false,
    lineSendFormat: settingsDirty
      ? resolveLineSendFormat(db.settings.lineSendFormat, db.settings.lineSendAsImage)
      : resolveLineSendFormat(
          settingsMap['Line_Send_Format'],
          settingsMap['Line_Send_As_Image'] !== undefined
            ? settingsMap['Line_Send_As_Image'].toLowerCase() !== 'false'
            : db.settings.lineSendAsImage
        ),
    lineChannelTokenSet:
      settingsMap['Line_Channel_Token_Set'] !== undefined
        ? settingsMap['Line_Channel_Token_Set'].toLowerCase() === 'true'
        : Boolean(db.settings.lineChannelTokenSet),
    lineLastSentAt:
      settingsMap['Line_Last_Sent_At'] !== undefined
        ? settingsMap['Line_Last_Sent_At']
        : db.settings.lineLastSentAt,
    lineLastSentReportDate:
      settingsMap['Line_Last_Sent_Report_Date'] !== undefined
        ? settingsMap['Line_Last_Sent_Report_Date']
        : db.settings.lineLastSentReportDate,
    lineLastStatus:
      settingsMap['Line_Last_Status'] !== undefined
        ? settingsMap['Line_Last_Status']
        : db.settings.lineLastStatus,
    lineDetectedGroupId:
      settingsMap['Line_Detected_Group_ID'] !== undefined
        ? settingsMap['Line_Detected_Group_ID']
        : db.settings.lineDetectedGroupId,
    lineDetectedGroupName:
      settingsMap['Line_Detected_Group_Name'] !== undefined
        ? settingsMap['Line_Detected_Group_Name']
        : db.settings.lineDetectedGroupName,
    boobyOwnerName: settingsDirty
      ? db.settings.boobyOwnerName || DEFAULT_BOOBY_OWNER_NAME
      : settingsMap['Booby_Owner_Name'] || db.settings.boobyOwnerName || DEFAULT_BOOBY_OWNER_NAME,
    boobyOwnerUserId: settingsDirty
      ? db.settings.boobyOwnerUserId || ''
      : settingsMap['Booby_Owner_User_ID'] !== undefined
      ? settingsMap['Booby_Owner_User_ID']
      : db.settings.boobyOwnerUserId || '',
    boobyGroupMentionOnly: settingsDirty
      ? db.settings.boobyGroupMentionOnly !== false
      : settingsMap['Booby_Group_Mention_Only'] !== undefined
      ? settingsMap['Booby_Group_Mention_Only'].toLowerCase() !== 'false'
      : db.settings.boobyGroupMentionOnly !== false,
  };

  return {
    staff: finalStaff,
    workloads: mergedWorkloads,
    leaves: mergedLeaves,
    ot: mergedOt,
    auditLogs: mergedAuditLogs,
    settings: finalSettings,
  };
}

/**
 * Reads all tabs from a shared Google Sheet without OAuth (via GViz public JSON feed).
 * Works whenever the Sheet allows "Anyone with the link" to view.
 */
export const readPublicGoogleSheet = async (
  spreadsheetId: string,
  db: AppDatabase
): Promise<{ accessible: boolean; mergedDb: AppDatabase }> => {
  const [staffRows, workloadRows, leaveRows, otRows, settingsRows, auditRows] = await Promise.all([
    fetchGvizSheetRows(spreadsheetId, 'Staff_Master'),
    fetchGvizSheetRows(spreadsheetId, 'Daily_Workload'),
    fetchGvizSheetRows(spreadsheetId, 'Leave_Records'),
    fetchGvizSheetRows(spreadsheetId, 'OT_Attendance'),
    fetchGvizSheetRows(spreadsheetId, 'Settings'),
    fetchGvizSheetRows(spreadsheetId, 'Audit_Logs'),
  ]);

  if (!staffRows && !settingsRows && !workloadRows && !leaveRows && !otRows) {
    return { accessible: false, mergedDb: db };
  }

  const mergedDb = mergeRemoteDataRows(
    {
      staffRows,
      workloadRows,
      leaveRows,
      otRows,
      settingsRows,
      auditRows,
    },
    db
  );

  return { accessible: true, mergedDb };
};

/**
 * Reads all tabs via an Apps Script Web App URL (zero Google login needed).
 */
export const readViaAppsScript = async (
  gasUrl: string,
  db: AppDatabase
): Promise<{ accessible: boolean; mergedDb: AppDatabase }> => {
  try {
    const sep = gasUrl.includes('?') ? '&' : '?';
    const res = await fetch(`${gasUrl}${sep}action=readAll&_ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return { accessible: false, mergedDb: db };
    const data = await res.json();
    if (!data || data.success === false) return { accessible: false, mergedDb: db };

    const mergedDb = mergeRemoteDataRows(
      {
        staffRows: Array.isArray(data.staffRows) ? data.staffRows : [],
        workloadRows: Array.isArray(data.workloadRows) ? data.workloadRows : [],
        leaveRows: Array.isArray(data.leaveRows) ? data.leaveRows : [],
        otRows: Array.isArray(data.otRows) ? data.otRows : [],
        settingsRows: Array.isArray(data.settingsRows) ? data.settingsRows : [],
        auditRows: Array.isArray(data.auditRows) ? data.auditRows : [],
      },
      db
    );
    const resolvedSheetId = mergedDb.settings.spreadsheetId || String(data.spreadsheetId || '').trim();
    return {
      accessible: true,
      mergedDb: {
        ...mergedDb,
        settings: {
          ...mergedDb.settings,
          spreadsheetId: resolvedSheetId || undefined,
          spreadsheetUrl:
            mergedDb.settings.spreadsheetUrl ||
            (resolvedSheetId ? `https://docs.google.com/spreadsheets/d/${resolvedSheetId}/edit` : undefined),
          gasUrl: mergedDb.settings.gasUrl || String(data.gasUrl || gasUrl).trim(),
        },
      },
    };
  } catch {
    return { accessible: false, mergedDb: db };
  }
};

/**
 * Appends new data-entry records ONLY (no edit/delete) via Apps Script Web App URL.
 */
export const appendViaAppsScript = async (
  gasUrl: string,
  action: 'appendWorkload' | 'appendLeave' | 'appendOT',
  payload: unknown
): Promise<boolean> => {
  const claimedWorkloadSlots: string[] = [];
  if (action === 'appendWorkload') {
    const rawItems = (Array.isArray(payload) ? payload : [payload]) as DailyWorkload[];
    const uniqueItems: DailyWorkload[] = [];
    const seenBatchSlots = new Set<string>();
    for (const item of rawItems) {
      if (!item || !item.date || !item.clinic) continue;
      const slot = getWorkloadSlotKey(item);
      if (seenBatchSlots.has(slot) || inFlightWorkloadSlotKeys.has(slot)) {
        continue;
      }
      seenBatchSlots.add(slot);
      inFlightWorkloadSlotKeys.add(slot);
      claimedWorkloadSlots.push(slot);
      uniqueItems.push(item);
    }
    if (uniqueItems.length === 0) {
      // Nothing new to append because an append for this slot is already in flight
      return true;
    }
    payload = Array.isArray(payload) ? uniqueItems : uniqueItems[0];
  }

  const runPromise = (async (): Promise<boolean> => {
    try {
      const normalizedPayload =
        action === 'appendWorkload'
          ? Array.isArray(payload)
            ? (payload as DailyWorkload[]).map(prepareWorkloadForRemote)
            : prepareWorkloadForRemote(payload as DailyWorkload)
          : action === 'appendOT'
          ? Array.isArray(payload)
            ? (payload as OTAttendance[]).map(prepareOtForRemote)
            : prepareOtForRemote(payload as OTAttendance)
          : payload;
      const bodyObj =
        action === 'appendWorkload'
          ? {
              action,
              payload: normalizedPayload,
              records: Array.isArray(normalizedPayload) ? normalizedPayload : [normalizedPayload],
            }
          : { action, payload: normalizedPayload };
      const res = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(bodyObj),
      });
      const rawText = await res.text();
      if (!res.ok) {
        console.error(`Apps Script HTTP ${res.status} for ${action}:`, rawText.slice(0, 300));
        return false;
      }
      try {
        const data = JSON.parse(rawText);
        if (!data?.success) {
          console.error(`Apps Script rejected ${action}:`, data);
        }
        return Boolean(data?.success);
      } catch {
        console.error(`Non-JSON response from Apps Script for ${action} (check Web App permission = Anyone):`, rawText.slice(0, 300));
        return false;
      }
    } catch (err) {
      console.error(`Failed to ${action} via Apps Script:`, err);
      return false;
    } finally {
      claimedWorkloadSlots.forEach((slot) => inFlightWorkloadSlotKeys.delete(slot));
    }
  })();

  if (action === 'appendWorkload') {
    activeWorkloadAppendPromises.add(runPromise);
    runPromise.finally(() => activeWorkloadAppendPromises.delete(runPromise));
  }

  return await runPromise;
};

export const hasPendingAdminDirtyFlags = (): boolean =>
  isStaffMasterDirty() ||
  isSettingsDirty() ||
  isWorkloadsDirty() ||
  isLeavesDirty() ||
  isOtDirty();

/**
 * 2-Way Apps Script sync for general OPD staff (zero Google Sign-In, zero Admin PIN):
 * - Treats Google Sheets as authoritative single source of truth across all clients
 * - Pushes ONLY unsent local records queued in PendingOutbox (never re-uploads deleted/edited rows)
 */
export const syncPublicViaAppsScript = async (
  gasUrl: string,
  db: AppDatabase
): Promise<{
  accessible: boolean;
  mergedDb: AppDatabase;
  pushedCount: number;
  needsStaffIdUpgrade?: boolean;
}> => {
  try {
    // Wait for any in-flight direct workload appends before reading remote Sheet to prevent double-append race!
    await waitForInFlightWorkloadAppends();

    const sep = gasUrl.includes('?') ? '&' : '?';
    const res = await fetch(`${gasUrl}${sep}action=readAll&_ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return { accessible: false, mergedDb: db, pushedCount: 0 };
    const data = await res.json();
    if (!data || data.success === false) return { accessible: false, mergedDb: db, pushedCount: 0 };

    const deletedWKeys = getDeletedWorkloadKeySet();
    const deletedLKeys = getDeletedLeaveKeySet();
    const deletedOKeys = getDeletedOtKeySet();

    const remoteWorkloads = parseRemoteWorkloadsOnly(
      data.workloadRows,
      db.settings.premiumSubClinics
    ).filter((w: DailyWorkload) => !deletedWKeys.has(workloadKey(w)));

    const remoteLeaves = parseRemoteLeavesOnly(data.leaveRows).filter(
      (l: LeaveRecord) => !deletedLKeys.has(leaveKey(l))
    );

    const remoteOt = parseRemoteOtOnly(data.otRows).filter(
      (o: OTAttendance) => !deletedOKeys.has(otKey(o))
    );

    const remoteWKeys = new Set(remoteWorkloads.map(workloadKey));
    const remoteWSlots = new Set(remoteWorkloads.map(getWorkloadSlotKey));
    const remoteLKeys = new Set(remoteLeaves.map(leaveKey));
    const remoteOKeys = new Set(remoteOt.map(otKey));

    // Prune any outbox records that already arrived in Google Sheets
    pruneOutboxSyncedAgainstRemote({ remoteWKeys, remoteLKeys, remoteOKeys });

    const workloadsToPush = !isWorkloadsDirty()
      ? getPendingOutboxWorkloads().filter(
          (w) =>
            !deletedWKeys.has(workloadKey(w)) &&
            !remoteWKeys.has(workloadKey(w)) &&
            !remoteWSlots.has(getWorkloadSlotKey(w)) &&
            !isWorkloadSlotInFlight(w)
        )
      : [];
    const leavesToPush = !isLeavesDirty()
      ? getPendingOutboxLeaves().filter(
          (l) => !deletedLKeys.has(leaveKey(l)) && !remoteLKeys.has(leaveKey(l))
        )
      : [];
    const otToPush = !isOtDirty()
      ? getPendingOutboxOt().filter(
          (o) => !deletedOKeys.has(otKey(o)) && !remoteOKeys.has(otKey(o))
        )
      : [];

    let pushedCount = 0;
    let justPushedWorkloads: DailyWorkload[] = [];
    let justPushedLeaves: LeaveRecord[] = [];
    let justPushedOt: OTAttendance[] = [];

    if (workloadsToPush.length > 0) {
      if (await appendViaAppsScript(gasUrl, 'appendWorkload', workloadsToPush)) {
        pushedCount += workloadsToPush.length;
        justPushedWorkloads = workloadsToPush;
        markWorkloadOutboxSynced(workloadsToPush);
      }
    }
    if (leavesToPush.length > 0) {
      if (await appendViaAppsScript(gasUrl, 'appendLeave', leavesToPush)) {
        pushedCount += leavesToPush.length;
        justPushedLeaves = leavesToPush;
        markLeaveOutboxSynced(leavesToPush);
      }
    }
    if (otToPush.length > 0) {
      if (await appendViaAppsScript(gasUrl, 'appendOT', otToPush)) {
        pushedCount += otToPush.length;
        justPushedOt = otToPush;
        markOtOutboxSynced(otToPush);
      }
    }

    const mergedDb = mergeRemoteDataRows(
      {
        staffRows: Array.isArray(data.staffRows) ? data.staffRows : [],
        workloadRows: Array.isArray(data.workloadRows) ? data.workloadRows : [],
        leaveRows: Array.isArray(data.leaveRows) ? data.leaveRows : [],
        otRows: Array.isArray(data.otRows) ? data.otRows : [],
        settingsRows: Array.isArray(data.settingsRows) ? data.settingsRows : [],
        auditRows: Array.isArray(data.auditRows) ? data.auditRows : [],
      },
      db,
      {
        justPushedWorkloads,
        justPushedLeaves,
        justPushedOt,
      }
    );
    const resolvedSheetId =
      mergedDb.settings.spreadsheetId || String(data.spreadsheetId || '').trim();
    const needsStaffIdUpgrade =
      Array.isArray(data.staffRows) &&
      data.staffRows.some((r: string[]) => {
        const rawColA = String(r[0] || '').trim();
        const rawName = String(r[1] || '').trim();
        const rawColH = String(r[7] || '').trim();
        if (!rawName) return false;
        const matched = mergedDb.staff.find((s) => s.name.trim() === rawName);
        const targetCode = getStaffEmployeeCode(matched);
        return Boolean(targetCode && (rawColA !== targetCode || rawColH !== targetCode));
      });

    return {
      accessible: true,
      pushedCount,
      needsStaffIdUpgrade,
      mergedDb: {
        ...mergedDb,
        settings: {
          ...mergedDb.settings,
          spreadsheetId: resolvedSheetId || undefined,
          spreadsheetUrl:
            mergedDb.settings.spreadsheetUrl ||
            (resolvedSheetId
              ? `https://docs.google.com/spreadsheets/d/${resolvedSheetId}/edit`
              : undefined),
          gasUrl: mergedDb.settings.gasUrl || String(data.gasUrl || gasUrl).trim(),
        },
      },
    };
  } catch {
    return { accessible: false, mergedDb: db, pushedCount: 0 };
  }
};

function parseRemoteWorkloadsOnly(
  workloadRows: unknown,
  premiumSubClinics?: string[]
): DailyWorkload[] {
  if (!Array.isArray(workloadRows)) return [];
  return workloadRows
    .filter((r: string[]) => (r[0] || '').trim() && (r[2] || '').trim())
    .map((r: string[], idx: number) => {
      const adultPt = Number(r[4] || 0);
      const childPt = Number(r[5] || 0);
      const rawRecordType = String(r[17] || '').trim();
      const recordType: WorkloadRecordType | undefined =
        rawRecordType === 'PREMIUM_POOL' || rawRecordType === 'PREMIUM_SUB' || rawRecordType === 'STANDARD'
          ? rawRecordType
          : undefined;
      return normalizeWorkloadRecord(
        {
          id: `REC-CHK-${idx}`,
          date: String(r[0] || '').trim(),
          shift: String(r[1] || 'ในเวลา 08:00-16:00').trim() as WorkShift,
          clinic: String(r[2] || '').trim(),
          totalPt: Math.max(Number(r[3] || 0), adultPt + childPt),
          adultPt,
          childPt,
          admit: Number(r[6] || 0),
          hn: Number(r[7] || 0),
          rn: Number(r[8] || 0),
          pn: Number(r[9] || 0),
          na: Number(r[10] || 0),
          clerk: Number(r[11] || 0),
          serviceWorker: Number(r[12] || 0),
          note: String(r[13] || '').trim(),
          reporter: String(r[14] || '').trim(),
          clinicGroup: String(r[15] || '').trim() || undefined,
          poolId: String(r[16] || '').trim() || undefined,
          recordType,
        },
        premiumSubClinics
      );
    });
}

function parseRemoteLeavesOnly(leaveRows: unknown): LeaveRecord[] {
  if (!Array.isArray(leaveRows)) return [];
  return leaveRows
    .filter((r: string[]) => (r[0] || '').trim() && (r[2] || '').trim())
    .map((r: string[], idx: number) => {
      const rawPos = (r[3] || 'RN').trim();
      return {
        id: `LV-CHK-${idx}`,
        startDate: String(r[0] || '').trim(),
        endDate: String(r[1] || r[0] || '').trim(),
        staffName: String(r[2] || '').trim(),
        position: normalizeStaffPosition(rawPos),
        clinic: String(r[4] || '').trim(),
        leaveType: String(r[5] || 'ลาป่วย').trim() as LeaveType,
        days: Number(r[6] || 1),
        note: String(r[7] || '').trim(),
      };
    });
}

function parseRemoteOtOnly(otRows: unknown): OTAttendance[] {
  if (!Array.isArray(otRows)) return [];
  return otRows
    .filter((r: string[]) => (r[0] || '').trim() && (r[2] || '').trim())
    .map((r: string[], idx: number) => parseSheetOtRecord(r, `OT-CHK-${idx}`));
}

/**
 * Direct immediate Admin overwrite for a specific modified table via Apps Script Web App URL.
 * Bypasses GET pre-sync and verifies the remote sheet reflects the exact overwrite/deletion.
 */
export const pushAdminTableViaAppsScript = async (params: {
  gasUrl: string;
  adminPin: string;
  table: DirtyDomain;
  db: AppDatabase;
  auditEntry?: AuditLogEntry;
  expectedDirtyVersion: number;
}): Promise<{ ok: boolean; error?: string }> => {
  const { gasUrl, adminPin, table, db, auditEntry, expectedDirtyVersion } = params;
  if (!gasUrl || !adminPin) {
    return { ok: false, error: 'ไม่มี Web App URL หรือรหัส Admin PIN' };
  }

  try {
    const payload: Record<string, unknown> = {
      dirty: {
        staff: table === 'staff',
        settings: table === 'settings',
        workloads: table === 'workloads',
        leaves: table === 'leaves',
        ot: table === 'ot',
      },
    };
    if (table === 'staff') {
      payload.staff = db.staff.map(prepareStaffForRemote);
    }
    if (table === 'workloads') payload.workloads = db.workloads.map(prepareWorkloadForRemote);
    if (table === 'leaves') payload.leaves = db.leaves;
    if (table === 'ot') payload.ot = db.ot.map(prepareOtForRemote);
    if (table === 'settings') {
      payload.settings = {
        ...db.settings,
        staffEmployeeCodes: buildStaffEmployeeCodesMap(db.staff),
      };
    }
    if (auditEntry) payload.auditLogs = [auditEntry];

    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'syncAdminAll',
        adminPin,
        payload,
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    if (!data || data.success === false) {
      return { ok: false, error: String(data?.error || 'Apps Script ปฏิเสธการบันทึก') };
    }

    if (table === 'workloads' && Array.isArray(data.workloadRows)) {
      const remoteParsed = parseRemoteWorkloadsOnly(
        data.workloadRows,
        db.settings.premiumSubClinics
      );
      const deletedSet = getDeletedWorkloadKeySet();
      const stillHasDeleted = remoteParsed.some((r) => deletedSet.has(workloadKey(r)));
      if (stillHasDeleted || remoteParsed.length !== db.workloads.length) {
        return {
          ok: false,
          error: 'Google Sheet ยังคืนค่ารายการเดิมหลังลบ/แก้ไข กรุณาอัปเดตและ Deploy Code.gs เวอร์ชันล่าสุด',
        };
      }
      clearWorkloadsDirty(expectedDirtyVersion);
      if (getWorkloadsDirtyVersion() === 0) {
        clearAllWorkloadTombstones();
      }
    } else if (table === 'leaves' && Array.isArray(data.leaveRows)) {
      const remoteParsed = parseRemoteLeavesOnly(data.leaveRows);
      const deletedSet = getDeletedLeaveKeySet();
      const stillHasDeleted = remoteParsed.some((r) => deletedSet.has(leaveKey(r)));
      if (stillHasDeleted || remoteParsed.length !== db.leaves.length) {
        return {
          ok: false,
          error: 'Google Sheet ยังคืนค่าวันลาเดิมหลังลบ/แก้ไข กรุณาอัปเดตและ Deploy Code.gs เวอร์ชันล่าสุด',
        };
      }
      clearLeavesDirty(expectedDirtyVersion);
      if (getLeavesDirtyVersion() === 0) {
        clearAllLeaveTombstones();
      }
    } else if (table === 'ot' && Array.isArray(data.otRows)) {
      const remoteParsed = parseRemoteOtOnly(data.otRows);
      const deletedSet = getDeletedOtKeySet();
      const stillHasDeleted = remoteParsed.some((r) => deletedSet.has(otKey(r)));
      if (stillHasDeleted || remoteParsed.length !== db.ot.length) {
        return {
          ok: false,
          error: 'Google Sheet ยังคืนค่ารายการ OT เดิมหลังลบ/แก้ไข กรุณาอัปเดตและ Deploy Code.gs เวอร์ชันล่าสุด',
        };
      }
      clearOtDirty(expectedDirtyVersion);
      if (getOtDirtyVersion() === 0) {
        clearAllOtTombstones();
      }
    } else if (table === 'staff') {
      clearStaffMasterDirty(expectedDirtyVersion);
    } else if (table === 'settings') {
      clearSettingsDirty(expectedDirtyVersion);
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'Network error') };
  }
};

/**
 * Direct immediate Admin overwrite for a specific modified table via Google OAuth API.
 */
export const pushAdminTableViaOAuth = async (params: {
  accessToken: string;
  spreadsheetId: string;
  table: DirtyDomain;
  db: AppDatabase;
  auditEntry?: AuditLogEntry;
  expectedDirtyVersion: number;
}): Promise<{ ok: boolean; error?: string }> => {
  const { accessToken, spreadsheetId, table, db, auditEntry, expectedDirtyVersion } = params;
  try {
    await ensureSpreadsheetTabs(accessToken, spreadsheetId);

    const clearAndPut = async (
      clearRange: string,
      putRange: string,
      values: (string | number)[][]
    ) => {
      const clearRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(clearRange)}:clear`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!clearRes.ok) {
        throw parseSheetsApiError(await clearRes.text(), 'ล้างข้อมูลเดิมในชีทไม่สำเร็จ');
      }
      const putRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(putRange)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values }),
        }
      );
      if (!putRes.ok) {
        throw parseSheetsApiError(await putRes.text(), 'บันทึกทับลงชีทไม่สำเร็จ');
      }
    };

    if (table === 'workloads') {
      const bodyRows = db.workloads.map((w) => [
        w.date,
        w.shift,
        w.clinic,
        getEffectiveTotalPt(w),
        w.adultPt,
        w.childPt,
        w.admit,
        w.hn,
        w.rn,
        w.pn,
        w.na ?? w.pca ?? 0,
        w.clerk,
        w.serviceWorker,
        encodeWorkloadNoteForSheet(w),
        w.reporter,
        w.clinicGroup || '',
        w.poolId || '',
        w.recordType || 'STANDARD',
      ]);
      await clearAndPut('Daily_Workload!A2:R', `Daily_Workload!A2:R${bodyRows.length + 1}`, bodyRows);
      clearWorkloadsDirty(expectedDirtyVersion);
      if (getWorkloadsDirtyVersion() === 0) clearAllWorkloadTombstones();
    } else if (table === 'leaves') {
      const bodyRows = db.leaves.map((l) => [
        l.startDate,
        l.endDate,
        l.staffName,
        l.position,
        l.clinic,
        l.leaveType,
        l.days,
        l.note || '',
      ]);
      await clearAndPut('Leave_Records!A2:H', `Leave_Records!A2:H${bodyRows.length + 1}`, bodyRows);
      clearLeavesDirty(expectedDirtyVersion);
      if (getLeavesDirtyVersion() === 0) clearAllLeaveTombstones();
    } else if (table === 'ot') {
      const bodyRows = db.ot.map((o) => [
        o.date,
        o.shift,
        o.staffName,
        o.position,
        o.homeClinic,
        formatOtWorkClinicForSheet(o.workClinic, o.hours, o.shift),
        getEffectiveOtHours(o),
        o.employeeCode || '',
      ]);
      await clearAndPut('OT_Attendance!A2:H', `OT_Attendance!A2:H${bodyRows.length + 1}`, bodyRows);
      clearOtDirty(expectedDirtyVersion);
      if (getOtDirtyVersion() === 0) clearAllOtTombstones();
    } else if (table === 'staff') {
      const ok = await syncStaffMasterToSheet(accessToken, spreadsheetId, db.staff);
      if (!ok) return { ok: false, error: 'อัปเดต Staff_Master ไม่สำเร็จ' };
      clearStaffMasterDirty(expectedDirtyVersion);
    } else if (table === 'settings') {
      const bodyRows = buildSettingsSheetRows(db.settings, db.staff).slice(1);
      await clearAndPut('Settings!A2:B', `Settings!A2:B${bodyRows.length + 1}`, bodyRows);
      clearSettingsDirty(expectedDirtyVersion);
    }

    if (auditEntry) {
      await appendAuditLogToSheet(accessToken, spreadsheetId, auditEntry);
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'OAuth write error') };
  }
};

/**
 * Atomic targeted single-row Admin Edit/Delete via Apps Script Web App URL.
 * Serialized under LockService on Code.gs so concurrent clinic saves from other devices are never lost.
 * Falls back cleanly to a fresh Read-Modify-Write over syncAdminAll if deployed Code.gs is an older version.
 */
export const pushTargetedAdminRowMutationViaAppsScript = async (params: {
  gasUrl: string;
  adminPin: string;
  action: 'updateWorkload' | 'deleteWorkload' | 'updateLeave' | 'deleteLeave' | 'updateOT' | 'deleteOT';
  table: 'workloads' | 'leaves' | 'ot';
  target: DailyWorkload | LeaveRecord | OTAttendance;
  updated?: DailyWorkload | LeaveRecord | OTAttendance;
  db: AppDatabase;
  auditEntry: AuditLogEntry;
  expectedDirtyVersion: number;
  insertIfMissing?: boolean;
}): Promise<{
  ok: boolean;
  notFound?: boolean;
  error?: string;
  syncedDb?: AppDatabase;
}> => {
  const {
    gasUrl,
    adminPin,
    action,
    table,
    target,
    updated,
    db,
    auditEntry,
    expectedDirtyVersion,
    insertIfMissing,
  } = params;
  if (!gasUrl || !adminPin) {
    return { ok: false, error: 'ไม่มี Web App URL หรือรหัส Admin PIN' };
  }

  const buildSyncedDbFromPayload = (
    data: any,
    sourceDb: AppDatabase,
    pendingAudits?: AuditLogEntry[]
  ): AppDatabase => {
    const merged = mergeRemoteDataRows(
      {
        staffRows: Array.isArray(data.staffRows) ? data.staffRows : [],
        workloadRows: Array.isArray(data.workloadRows) ? data.workloadRows : [],
        leaveRows: Array.isArray(data.leaveRows) ? data.leaveRows : [],
        otRows: Array.isArray(data.otRows) ? data.otRows : [],
        settingsRows: Array.isArray(data.settingsRows) ? data.settingsRows : [],
        auditRows: Array.isArray(data.auditRows) ? data.auditRows : [],
      },
      sourceDb,
      pendingAudits ? { justPushedAudits: pendingAudits } : undefined
    );
    const resolvedSheetId =
      merged.settings.spreadsheetId || String(data.spreadsheetId || '').trim();
    return {
      ...merged,
      settings: {
        ...merged.settings,
        spreadsheetId: resolvedSheetId || undefined,
        spreadsheetUrl:
          merged.settings.spreadsheetUrl ||
          (resolvedSheetId ? `https://docs.google.com/spreadsheets/d/${resolvedSheetId}/edit` : undefined),
        gasUrl: merged.settings.gasUrl || String(data.gasUrl || gasUrl).trim(),
      },
    };
  };

  try {
    const serializedTarget =
      table === 'workloads'
        ? prepareWorkloadForRemote(target as DailyWorkload)
        : table === 'ot'
        ? prepareOtForRemote(target as OTAttendance)
        : target;
    const serializedUpdated =
      updated && table === 'workloads'
        ? prepareWorkloadForRemote(updated as DailyWorkload)
        : updated && table === 'ot'
        ? prepareOtForRemote(updated as OTAttendance)
        : updated;

    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action,
        adminPin,
        payload: {
          target: serializedTarget,
          updated: serializedUpdated,
          auditEntry,
          ...(insertIfMissing ? { insertIfMissing: true } : {}),
        },
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();

    // Case 1: New Code.gs responded to targeted endpoint
    if (data && data.targeted === true) {
      if (data.notFound) {
        if (table === 'workloads') {
          clearWorkloadsDirty(expectedDirtyVersion);
          clearWorkloadTombstone(target as DailyWorkload);
        } else if (table === 'leaves') {
          clearLeavesDirty(expectedDirtyVersion);
          clearLeaveTombstone(target as LeaveRecord);
        } else {
          clearOtDirty(expectedDirtyVersion);
          clearOtTombstone(target as OTAttendance);
        }
        const syncedDb = buildSyncedDbFromPayload(data, db);
        return {
          ok: false,
          notFound: true,
          error: String(data.error || 'ไม่พบรายการเดิมใน Google Sheets'),
          syncedDb,
        };
      }

      if (data.success === false) {
        return { ok: false, error: String(data.error || 'Apps Script ปฏิเสธการบันทึก') };
      }

      if (table === 'workloads') {
        clearWorkloadsDirty(expectedDirtyVersion);
        if (getWorkloadsDirtyVersion() === 0) clearAllWorkloadTombstones();
      } else if (table === 'leaves') {
        clearLeavesDirty(expectedDirtyVersion);
        if (getLeavesDirtyVersion() === 0) clearAllLeaveTombstones();
      } else {
        clearOtDirty(expectedDirtyVersion);
        if (getOtDirtyVersion() === 0) clearAllOtTombstones();
      }
      markAuditOutboxSynced([auditEntry]);

      const syncedDb = buildSyncedDbFromPayload(data, db, [auditEntry]);
      return { ok: true, syncedDb };
    }

    // Case 2: PIN rejected or explicit failure unrelated to missing targeted route
    const errText = String(data?.error || '');
    const isUnsupportedActionFallback =
      data && data.success === false && errText.includes('สงวนสิทธิ์');
    if (data && data.success === false && !isUnsupportedActionFallback) {
      return { ok: false, error: errText || 'Apps Script ปฏิเสธการบันทึก' };
    }

    // Case 3: Older Code.gs deployed — perform safe Read-Modify-Write on freshest remote rows
    const sep = gasUrl.includes('?') ? '&' : '?';
    const freshRes = await fetch(`${gasUrl}${sep}action=readAll&_ts=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!freshRes.ok) {
      return { ok: false, error: `HTTP ${freshRes.status}` };
    }
    const freshData = await freshRes.json();
    if (!freshData || freshData.success === false) {
      return { ok: false, error: String(freshData?.error || 'อ่านข้อมูลล่าสุดจากชีทไม่สำเร็จ') };
    }

    let nextTableRows: unknown[] = [];
    if (table === 'workloads') {
      const remoteList = parseRemoteWorkloadsOnly(
        freshData.workloadRows,
        db.settings.premiumSubClinics
      );
      const targetFullKey = workloadKey(target as DailyWorkload);
      const matchIdx = remoteList.findIndex((w) => workloadKey(w) === targetFullKey);
      if (action === 'updateWorkload' && updated) {
        if (matchIdx >= 0) {
          remoteList[matchIdx] = updated as DailyWorkload;
        } else {
          remoteList.unshift(updated as DailyWorkload);
        }
      } else if (matchIdx >= 0) {
        remoteList.splice(matchIdx, 1);
      }
      nextTableRows = remoteList.map(prepareWorkloadForRemote);
    } else if (table === 'leaves') {
      const remoteList = parseRemoteLeavesOnly(freshData.leaveRows);
      const targetFullKey = leaveKey(target as LeaveRecord);
      const matchIdx = remoteList.findIndex((l) => leaveKey(l) === targetFullKey);
      if (action === 'updateLeave' && updated) {
        if (matchIdx >= 0) {
          remoteList[matchIdx] = updated as LeaveRecord;
        } else {
          remoteList.unshift(updated as LeaveRecord);
        }
      } else if (matchIdx >= 0) {
        remoteList.splice(matchIdx, 1);
      }
      nextTableRows = remoteList;
    } else {
      const remoteList = parseRemoteOtOnly(freshData.otRows);
      const targetFullKey = otKey(target as OTAttendance);
      const matchIdx = remoteList.findIndex((o) => otKey(o) === targetFullKey);
      if (action === 'updateOT' && updated) {
        if (matchIdx >= 0) {
          remoteList[matchIdx] = updated as OTAttendance;
        } else {
          remoteList.unshift(updated as OTAttendance);
        }
      } else if (matchIdx >= 0) {
        remoteList.splice(matchIdx, 1);
      }
      nextTableRows = remoteList.map(prepareOtForRemote);
    }

    const rmwRes = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'syncAdminAll',
        adminPin,
        payload: {
          dirty: {
            staff: false,
            settings: false,
            workloads: table === 'workloads',
            leaves: table === 'leaves',
            ot: table === 'ot',
          },
          [table]: nextTableRows,
          auditLogs: [auditEntry],
        },
      }),
    });

    if (!rmwRes.ok) {
      return { ok: false, error: `HTTP ${rmwRes.status}` };
    }
    const rmwData = await rmwRes.json();
    if (!rmwData || rmwData.success === false) {
      return { ok: false, error: String(rmwData?.error || 'Apps Script ปฏิเสธการบันทึก') };
    }

    if (table === 'workloads' && Array.isArray(rmwData.workloadRows)) {
      const remoteParsed = parseRemoteWorkloadsOnly(
        rmwData.workloadRows,
        db.settings.premiumSubClinics
      );
      const deletedSet = getDeletedWorkloadKeySet();
      if (remoteParsed.some((r) => deletedSet.has(workloadKey(r)))) {
        return {
          ok: false,
          error: 'Google Sheet ยังคืนค่ารายการเดิมหลังลบ/แก้ไข กรุณาอัปเดตและ Deploy Code.gs เวอร์ชันล่าสุด',
        };
      }
      clearWorkloadsDirty(expectedDirtyVersion);
      if (getWorkloadsDirtyVersion() === 0) clearAllWorkloadTombstones();
    } else if (table === 'leaves' && Array.isArray(rmwData.leaveRows)) {
      const remoteParsed = parseRemoteLeavesOnly(rmwData.leaveRows);
      const deletedSet = getDeletedLeaveKeySet();
      if (remoteParsed.some((r) => deletedSet.has(leaveKey(r)))) {
        return {
          ok: false,
          error: 'Google Sheet ยังคืนค่าวันลาเดิมหลังลบ/แก้ไข กรุณาอัปเดตและ Deploy Code.gs เวอร์ชันล่าสุด',
        };
      }
      clearLeavesDirty(expectedDirtyVersion);
      if (getLeavesDirtyVersion() === 0) clearAllLeaveTombstones();
    } else if (table === 'ot' && Array.isArray(rmwData.otRows)) {
      const remoteParsed = parseRemoteOtOnly(rmwData.otRows);
      const deletedSet = getDeletedOtKeySet();
      if (remoteParsed.some((r) => deletedSet.has(otKey(r)))) {
        return {
          ok: false,
          error: 'Google Sheet ยังคืนค่ารายการ OT เดิมหลังลบ/แก้ไข กรุณาอัปเดตและ Deploy Code.gs เวอร์ชันล่าสุด',
        };
      }
      clearOtDirty(expectedDirtyVersion);
      if (getOtDirtyVersion() === 0) clearAllOtTombstones();
    }
    markAuditOutboxSynced([auditEntry]);

    const syncedDb = buildSyncedDbFromPayload(rmwData, db, [auditEntry]);
    return { ok: true, syncedDb };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'Network error') };
  }
};

/**
 * Targeted single-row Admin Staff mutation via Apps Script Web App URL.
 * Updates/inserts/deletes ONLY the affected Staff_Master row (and matching OT rows' name/code cells).
 */
export const pushTargetedAdminStaffMutationViaAppsScript = async (params: {
  gasUrl: string;
  adminPin: string;
  action: 'addStaff' | 'updateStaff' | 'deleteStaff';
  target?: StaffMember;
  updated?: StaffMember;
  previousStaffId?: string;
  propagateOt?: boolean;
  insertIfMissing?: boolean;
  db: AppDatabase;
  auditEntry?: AuditLogEntry;
  expectedDirtyVersion: number;
  expectedOtDirtyVersion?: number | null;
}): Promise<{
  ok: boolean;
  notFound?: boolean;
  error?: string;
  syncedDb?: AppDatabase;
}> => {
  const {
    gasUrl,
    adminPin,
    action,
    target,
    updated,
    previousStaffId,
    propagateOt,
    insertIfMissing,
    db,
    auditEntry,
    expectedDirtyVersion,
    expectedOtDirtyVersion,
  } = params;
  if (!gasUrl || !adminPin) {
    return { ok: false, error: 'ไม่มี Web App URL หรือรหัส Admin PIN' };
  }

  const buildSyncedDb = (data: any): AppDatabase => {
    const merged = mergeRemoteDataRows(
      {
        staffRows: Array.isArray(data.staffRows) ? data.staffRows : [],
        workloadRows: Array.isArray(data.workloadRows) ? data.workloadRows : [],
        leaveRows: Array.isArray(data.leaveRows) ? data.leaveRows : [],
        otRows: Array.isArray(data.otRows) ? data.otRows : [],
        settingsRows: Array.isArray(data.settingsRows) ? data.settingsRows : [],
        auditRows: Array.isArray(data.auditRows) ? data.auditRows : [],
      },
      db,
      auditEntry ? { justPushedAudits: [auditEntry] } : undefined
    );
    const resolvedSheetId =
      merged.settings.spreadsheetId || String(data.spreadsheetId || '').trim();
    return {
      ...merged,
      settings: {
        ...merged.settings,
        spreadsheetId: resolvedSheetId || undefined,
        spreadsheetUrl:
          merged.settings.spreadsheetUrl ||
          (resolvedSheetId ? `https://docs.google.com/spreadsheets/d/${resolvedSheetId}/edit` : undefined),
        gasUrl: merged.settings.gasUrl || String(data.gasUrl || gasUrl).trim(),
      },
    };
  };

  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action,
        adminPin,
        payload: {
          ...(target ? { target: prepareStaffForRemote(target) } : {}),
          ...(updated ? { updated: prepareStaffForRemote(updated) } : {}),
          ...(previousStaffId ? { previousStaffId } : {}),
          ...(propagateOt ? { propagateOt: true } : {}),
          ...(insertIfMissing ? { insertIfMissing: true } : {}),
          ...(auditEntry ? { auditEntry } : {}),
        },
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();

    if (data && data.targeted === true) {
      if (data.notFound) {
        clearStaffMasterDirty(expectedDirtyVersion);
        return {
          ok: false,
          notFound: true,
          error: String(data.error || 'ไม่พบรายชื่อบุคลากรเดิมใน Google Sheets'),
          syncedDb: buildSyncedDb(data),
        };
      }
      if (data.success === false) {
        return { ok: false, error: String(data.error || 'Apps Script ปฏิเสธการบันทึก') };
      }
      clearStaffMasterDirty(expectedDirtyVersion);
      if (propagateOt && expectedOtDirtyVersion !== undefined && expectedOtDirtyVersion !== null) {
        clearOtDirty(expectedOtDirtyVersion);
      }
      if (auditEntry) markAuditOutboxSynced([auditEntry]);
      return { ok: true, syncedDb: buildSyncedDb(data) };
    }

    const errText = String(data?.error || '');
    const isUnsupportedActionFallback =
      data && data.success === false && errText.includes('สงวนสิทธิ์');
    if (data && data.success === false && !isUnsupportedActionFallback) {
      return { ok: false, error: errText || 'Apps Script ปฏิเสธการบันทึก' };
    }

    // Fallback for older Code.gs without targeted staff route: send via syncAdminAll for staff (never touch settings)
    const fallbackRes = await pushAdminTableViaAppsScript({
      gasUrl,
      adminPin,
      table: 'staff',
      db,
      auditEntry,
      expectedDirtyVersion,
    });
    if (fallbackRes.ok && propagateOt && expectedOtDirtyVersion !== undefined && expectedOtDirtyVersion !== null) {
      await pushAdminTableViaAppsScript({
        gasUrl,
        adminPin,
        table: 'ot',
        db,
        expectedDirtyVersion: expectedOtDirtyVersion,
      });
    }
    return fallbackRes;
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'Network error') };
  }
};

/**
 * Targeted Settings key-only update via Apps Script Web App URL.
 * Updates ONLY the changed Settings key rows without rewriting unrelated keys or headers.
 */
export const pushTargetedSettingsKeysViaAppsScript = async (params: {
  gasUrl: string;
  adminPin: string;
  changedEntries: Array<[string, string]>;
  db: AppDatabase;
  auditEntry?: AuditLogEntry;
  expectedDirtyVersion: number;
}): Promise<{
  ok: boolean;
  error?: string;
  syncedDb?: AppDatabase;
}> => {
  const { gasUrl, adminPin, changedEntries, db, auditEntry, expectedDirtyVersion } = params;
  if (changedEntries.length === 0) {
    clearSettingsDirty(expectedDirtyVersion);
    return { ok: true };
  }
  if (!gasUrl || !adminPin) {
    return { ok: false, error: 'ไม่มี Web App URL หรือรหัส Admin PIN' };
  }

  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateSettingsKeys',
        adminPin,
        payload: {
          entries: changedEntries,
          ...(auditEntry ? { auditEntry } : {}),
        },
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();

    if (data && data.targeted === true) {
      if (data.success === false) {
        return { ok: false, error: String(data.error || 'Apps Script ปฏิเสธการบันทึก') };
      }
      clearSettingsDirty(expectedDirtyVersion);
      if (auditEntry) markAuditOutboxSynced([auditEntry]);
      const merged = mergeRemoteDataRows(
        {
          staffRows: Array.isArray(data.staffRows) ? data.staffRows : [],
          workloadRows: Array.isArray(data.workloadRows) ? data.workloadRows : [],
          leaveRows: Array.isArray(data.leaveRows) ? data.leaveRows : [],
          otRows: Array.isArray(data.otRows) ? data.otRows : [],
          settingsRows: Array.isArray(data.settingsRows) ? data.settingsRows : [],
          auditRows: Array.isArray(data.auditRows) ? data.auditRows : [],
        },
        db,
        auditEntry ? { justPushedAudits: [auditEntry] } : undefined
      );
      const resolvedSheetId =
        merged.settings.spreadsheetId || String(data.spreadsheetId || '').trim();
      return {
        ok: true,
        syncedDb: {
          ...merged,
          settings: {
            ...merged.settings,
            spreadsheetId: resolvedSheetId || undefined,
            spreadsheetUrl:
              merged.settings.spreadsheetUrl ||
              (resolvedSheetId ? `https://docs.google.com/spreadsheets/d/${resolvedSheetId}/edit` : undefined),
            gasUrl: merged.settings.gasUrl || String(data.gasUrl || gasUrl).trim(),
          },
        },
      };
    }

    const errText = String(data?.error || '');
    const isUnsupportedActionFallback =
      data && data.success === false && errText.includes('สงวนสิทธิ์');
    if (data && data.success === false && !isUnsupportedActionFallback) {
      return { ok: false, error: errText || 'Apps Script ปฏิเสธการบันทึก' };
    }

    return await pushAdminTableViaAppsScript({
      gasUrl,
      adminPin,
      table: 'settings',
      db,
      auditEntry,
      expectedDirtyVersion,
    });
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'Network error') };
  }
};

async function getOAuthSheetNumericId(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string
): Promise<number | null> {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!metaRes.ok) return null;
  const meta = await metaRes.json();
  const matched = (meta.sheets || []).find(
    (s: any) => s?.properties?.title === sheetTitle
  );
  return typeof matched?.properties?.sheetId === 'number' ? matched.properties.sheetId : null;
}

async function deleteOAuthSheetRowAt(
  accessToken: string,
  spreadsheetId: string,
  sheetTitle: string,
  rowNumber1Based: number
): Promise<void> {
  if (rowNumber1Based < 2) return;
  const numericSheetId = await getOAuthSheetNumericId(accessToken, spreadsheetId, sheetTitle);
  if (numericSheetId === null) {
    throw new Error(`ไม่พบแท็บ ${sheetTitle} ใน Google Sheets`);
  }
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: numericSheetId,
                dimension: 'ROWS',
                startIndex: rowNumber1Based - 1,
                endIndex: rowNumber1Based,
              },
            },
          },
        ],
      }),
    }
  );
  if (!res.ok) {
    throw parseSheetsApiError(await res.text(), `ลบแถวใน ${sheetTitle} ไม่สำเร็จ`);
  }
}

/**
 * Targeted single-row Admin Edit/Delete for Daily_Workload / Leave_Records / OT_Attendance via OAuth.
 */
export const pushTargetedAdminRowViaOAuth = async (params: {
  accessToken: string;
  spreadsheetId: string;
  action: 'updateWorkload' | 'deleteWorkload' | 'updateLeave' | 'deleteLeave' | 'updateOT' | 'deleteOT';
  table: 'workloads' | 'leaves' | 'ot';
  target: DailyWorkload | LeaveRecord | OTAttendance;
  updated?: DailyWorkload | LeaveRecord | OTAttendance;
  insertIfMissing?: boolean;
  auditEntry?: AuditLogEntry;
  expectedDirtyVersion: number;
}): Promise<{ ok: boolean; error?: string }> => {
  const {
    accessToken,
    spreadsheetId,
    action,
    table,
    target,
    updated,
    insertIfMissing,
    auditEntry,
    expectedDirtyVersion,
  } = params;
  try {
    await ensureSpreadsheetTabs(accessToken, spreadsheetId);
    const sheetTitle =
      table === 'workloads'
        ? 'Daily_Workload'
        : table === 'leaves'
        ? 'Leave_Records'
        : 'OT_Attendance';
    const maxColLetter = table === 'workloads' ? 'S' : 'I';

    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${sheetTitle}!A1:${maxColLetter}`)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!readRes.ok) {
      throw parseSheetsApiError(await readRes.text(), `อ่านข้อมูลจาก ${sheetTitle} ไม่สำเร็จ`);
    }
    const readJson = await readRes.json();
    const values: any[][] = Array.isArray(readJson.values) ? readJson.values : [];
    const header0 = String(values[0]?.[0] || '').trim();

    let matchRowNum = -1;
    let hasId = false;

    if (table === 'workloads') {
      hasId = header0 === 'Record_ID';
      const wTarget = target as DailyWorkload;
      const targetFullKey = workloadKey(wTarget);
      if (hasId && wTarget.id) {
        const idx = values.findIndex((r, i) => i > 0 && String(r[0] || '').trim() === wTarget.id);
        if (idx > 0) matchRowNum = idx + 1;
      }
      if (matchRowNum === -1) {
        const idx = values.findIndex((r, i) => {
          if (i === 0) return false;
          const sliced = hasId ? r.slice(1, 19) : r.slice(0, 18);
          const parsed = parseRemoteWorkloadsOnly([sliced])[0];
          return parsed ? workloadKey(parsed) === targetFullKey : false;
        });
        if (idx > 0) matchRowNum = idx + 1;
      }
    } else if (table === 'leaves') {
      hasId = header0 === 'Leave_ID';
      const lTarget = target as LeaveRecord;
      const targetFullKey = leaveKey(lTarget);
      if (hasId && lTarget.id) {
        const idx = values.findIndex((r, i) => i > 0 && String(r[0] || '').trim() === lTarget.id);
        if (idx > 0) matchRowNum = idx + 1;
      }
      if (matchRowNum === -1) {
        const idx = values.findIndex((r, i) => {
          if (i === 0) return false;
          const sliced = hasId ? r.slice(1, 9) : r.slice(0, 8);
          const parsed = parseRemoteLeavesOnly([sliced])[0];
          return parsed ? leaveKey(parsed) === targetFullKey : false;
        });
        if (idx > 0) matchRowNum = idx + 1;
      }
    } else {
      hasId = header0 === 'OT_ID';
      const oTarget = target as OTAttendance;
      const targetFullKey = otKey(oTarget);
      if (hasId && oTarget.id) {
        const idx = values.findIndex((r, i) => i > 0 && String(r[0] || '').trim() === oTarget.id);
        if (idx > 0) matchRowNum = idx + 1;
      }
      if (matchRowNum === -1) {
        const idx = values.findIndex((r, i) => {
          if (i === 0) return false;
          const sliced = hasId ? r.slice(1, 9) : r.slice(0, 8);
          if (!(String(sliced[0] || '').trim() && String(sliced[2] || '').trim())) return false;
          return otKey(parseSheetOtRecord(sliced, `O-${i}`)) === targetFullKey;
        });
        if (idx > 0) matchRowNum = idx + 1;
      }
    }

    const isDelete = action.startsWith('delete');
    if (isDelete) {
      if (matchRowNum !== -1) {
        await deleteOAuthSheetRowAt(accessToken, spreadsheetId, sheetTitle, matchRowNum);
      }
    } else if (updated) {
      let baseRow: (string | number)[] = [];
      let fallbackId = '';
      if (table === 'workloads') {
        const u = updated as DailyWorkload;
        fallbackId = u.id;
        baseRow = [
          u.date,
          u.shift,
          u.clinic,
          getEffectiveTotalPt(u),
          u.adultPt,
          u.childPt,
          u.admit,
          u.hn,
          u.rn,
          u.pn,
          u.na ?? u.pca ?? 0,
          u.clerk,
          u.serviceWorker,
          encodeWorkloadNoteForSheet(u),
          u.reporter,
          u.clinicGroup || '',
          u.poolId || '',
          u.recordType || 'STANDARD',
        ];
      } else if (table === 'leaves') {
        const u = updated as LeaveRecord;
        fallbackId = u.id;
        baseRow = [
          u.startDate,
          u.endDate,
          u.staffName,
          u.position,
          u.clinic,
          u.leaveType,
          u.days,
          u.note || '',
        ];
      } else {
        const u = updated as OTAttendance;
        fallbackId = u.id;
        baseRow = [
          u.date,
          u.shift,
          u.staffName,
          u.position,
          u.homeClinic,
          formatOtWorkClinicForSheet(u.workClinic, u.hours, u.shift),
          getEffectiveOtHours(u),
          u.employeeCode || '',
        ];
      }

      if (matchRowNum !== -1) {
        const existingId = hasId ? String(values[matchRowNum - 1]?.[0] || '').trim() : '';
        const rowValues = hasId ? [existingId || fallbackId, ...baseRow] : baseRow;
        const endCol = table === 'workloads' ? (hasId ? 'S' : 'R') : (hasId ? 'I' : 'H');
        const putRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${sheetTitle}!A${matchRowNum}:${endCol}${matchRowNum}`)}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [rowValues] }),
          }
        );
        if (!putRes.ok) {
          throw parseSheetsApiError(await putRes.text(), `อัปเดตแถวใน ${sheetTitle} ไม่สำเร็จ`);
        }
      } else if (insertIfMissing) {
        const rowValues = hasId ? [fallbackId, ...baseRow] : baseRow;
        const endCol = table === 'workloads' ? (hasId ? 'S' : 'R') : (hasId ? 'I' : 'H');
        const appRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${sheetTitle}!A:${endCol}`)}:append?valueInputOption=USER_ENTERED`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [rowValues] }),
          }
        );
        if (!appRes.ok) {
          throw parseSheetsApiError(await appRes.text(), `เพิ่มแถวใหม่ใน ${sheetTitle} ไม่สำเร็จ`);
        }
      }
    }

    if (table === 'workloads') {
      clearWorkloadsDirty(expectedDirtyVersion);
      if (isDelete) clearWorkloadTombstone(target as DailyWorkload);
      if (getWorkloadsDirtyVersion() === 0) clearAllWorkloadTombstones();
    } else if (table === 'leaves') {
      clearLeavesDirty(expectedDirtyVersion);
      if (isDelete) clearLeaveTombstone(target as LeaveRecord);
      if (getLeavesDirtyVersion() === 0) clearAllLeaveTombstones();
    } else {
      clearOtDirty(expectedDirtyVersion);
      if (isDelete) clearOtTombstone(target as OTAttendance);
      if (getOtDirtyVersion() === 0) clearAllOtTombstones();
    }
    if (auditEntry) {
      await appendAuditLogToSheet(accessToken, spreadsheetId, auditEntry);
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'OAuth row error') };
  }
};

/**
 * Targeted single-row Admin Staff mutation via OAuth.
 */
export const pushTargetedStaffViaOAuth = async (params: {
  accessToken: string;
  spreadsheetId: string;
  action: 'addStaff' | 'updateStaff' | 'deleteStaff';
  target?: StaffMember;
  updated?: StaffMember;
  previousStaffId?: string;
  propagateOt?: boolean;
  insertIfMissing?: boolean;
  auditEntry?: AuditLogEntry;
  expectedDirtyVersion: number;
  expectedOtDirtyVersion?: number | null;
}): Promise<{ ok: boolean; error?: string }> => {
  const {
    accessToken,
    spreadsheetId,
    action,
    target,
    updated,
    previousStaffId,
    propagateOt,
    insertIfMissing,
    auditEntry,
    expectedDirtyVersion,
    expectedOtDirtyVersion,
  } = params;
  try {
    await ensureSpreadsheetTabs(accessToken, spreadsheetId);
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('Staff_Master!A1:H')}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!readRes.ok) {
      throw parseSheetsApiError(await readRes.text(), 'อ่านข้อมูล Staff_Master ไม่สำเร็จ');
    }
    const readJson = await readRes.json();
    const values: any[][] = Array.isArray(readJson.values) ? readJson.values : [];

    const lookupTarget = target || updated;
    const candidates = [
      previousStaffId,
      lookupTarget?.staffId,
      lookupTarget?.employeeCode && isValidEmployeeCodeValue(lookupTarget.employeeCode)
        ? lookupTarget.employeeCode
        : undefined,
    ]
      .map((c) => String(c || '').trim())
      .filter(Boolean);

    let matchRowNum = -1;
    for (const needle of candidates) {
      const idx = values.findIndex((r, i) => {
        if (i === 0) return false;
        const cId = String(r[0] || '').trim();
        const cCode = String(r[7] || '').trim();
        return cId === needle || (isValidEmployeeCodeValue(needle) && cCode === needle);
      });
      if (idx > 0) {
        matchRowNum = idx + 1;
        break;
      }
    }
    if (matchRowNum === -1 && lookupTarget?.name) {
      const needleName = lookupTarget.name.trim();
      const idx = values.findIndex(
        (r, i) => i > 0 && String(r[1] || '').trim() === needleName
      );
      if (idx > 0) matchRowNum = idx + 1;
    }

    if (action === 'deleteStaff') {
      if (matchRowNum !== -1) {
        await deleteOAuthSheetRowAt(accessToken, spreadsheetId, 'Staff_Master', matchRowNum);
      }
    } else if (updated) {
      const rowValues = prepareStaffRowForSheet(updated);
      if (matchRowNum !== -1) {
        const putRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`Staff_Master!A${matchRowNum}:H${matchRowNum}`)}?valueInputOption=USER_ENTERED`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [rowValues] }),
          }
        );
        if (!putRes.ok) {
          throw parseSheetsApiError(await putRes.text(), 'อัปเดตข้อมูลบุคลากรไม่สำเร็จ');
        }
      } else if (action === 'addStaff' || insertIfMissing) {
        const appRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('Staff_Master!A:H')}:append?valueInputOption=USER_ENTERED`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: [rowValues] }),
          }
        );
        if (!appRes.ok) {
          throw parseSheetsApiError(await appRes.text(), 'เพิ่มรายชื่อบุคลากรไม่สำเร็จ');
        }
      }

      if (propagateOt) {
        const newCode = getStaffEmployeeCode(updated);
        const oldName = (target?.name || updated.name).trim();
        const newName = updated.name.trim();
        const otReadRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('OT_Attendance!A1:I')}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (otReadRes.ok) {
          const otJson = await otReadRes.json();
          const otValues: any[][] = Array.isArray(otJson.values) ? otJson.values : [];
          const hasId = String(otValues[0]?.[0] || '').trim() === 'OT_ID';
          const offset = hasId ? 1 : 0;
          const updates: Array<{ range: string; values: string[][] }> = [];
          const nameCol = String.fromCharCode(65 + offset + 2);
          const codeCol = String.fromCharCode(65 + offset + 7);
          otValues.forEach((r, idx) => {
            if (idx === 0) return;
            const rName = String(r[offset + 2] || '').trim();
            const rCode = String(r[offset + 7] || '').trim();
            const matched =
              (newCode && rCode === newCode) ||
              (previousStaffId && isValidEmployeeCodeValue(previousStaffId) && rCode === previousStaffId) ||
              rName === oldName ||
              rName === newName;
            if (!matched) return;
            const rowNum = idx + 1;
            if (newName && rName !== newName) {
              updates.push({ range: `OT_Attendance!${nameCol}${rowNum}`, values: [[newName]] });
            }
            if (newCode && rCode !== newCode) {
              updates.push({ range: `OT_Attendance!${codeCol}${rowNum}`, values: [[newCode]] });
            }
          });
          if (updates.length > 0) {
            await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  valueInputOption: 'USER_ENTERED',
                  data: updates,
                }),
              }
            );
          }
        }
      }
    }

    clearStaffMasterDirty(expectedDirtyVersion);
    if (propagateOt && expectedOtDirtyVersion !== undefined && expectedOtDirtyVersion !== null) {
      clearOtDirty(expectedOtDirtyVersion);
    }
    if (auditEntry) {
      await appendAuditLogToSheet(accessToken, spreadsheetId, auditEntry);
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'OAuth staff error') };
  }
};

/**
 * Targeted Settings key-only update via OAuth (modifies ONLY changed key rows in Settings sheet).
 */
export const pushTargetedSettingsKeysViaOAuth = async (params: {
  accessToken: string;
  spreadsheetId: string;
  changedEntries: Array<[string, string]>;
  auditEntry?: AuditLogEntry;
  expectedDirtyVersion: number;
}): Promise<{ ok: boolean; error?: string }> => {
  const { accessToken, spreadsheetId, changedEntries, auditEntry, expectedDirtyVersion } = params;
  if (changedEntries.length === 0) {
    clearSettingsDirty(expectedDirtyVersion);
    return { ok: true };
  }
  try {
    await ensureSpreadsheetTabs(accessToken, spreadsheetId);
    const readRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('Settings!A1:B')}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!readRes.ok) {
      throw parseSheetsApiError(await readRes.text(), 'อ่านข้อมูล Settings ไม่สำเร็จ');
    }
    const readJson = await readRes.json();
    const values: any[][] = Array.isArray(readJson.values) ? readJson.values : [];
    const keyToRowNum = new Map<string, number>();
    values.forEach((r, i) => {
      if (i === 0) return;
      const k = String(r[0] || '').trim();
      if (k && !keyToRowNum.has(k)) {
        keyToRowNum.set(k, i + 1);
      }
    });

    const batchUpdates: Array<{ range: string; values: string[][] }> = [];
    const toAppend: string[][] = [];
    changedEntries.forEach(([k, v]) => {
      const existingRow = keyToRowNum.get(k);
      if (existingRow) {
        batchUpdates.push({ range: `Settings!B${existingRow}`, values: [[v]] });
      } else {
        toAppend.push([k, v]);
      }
    });

    if (batchUpdates.length > 0) {
      const batchRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            valueInputOption: 'USER_ENTERED',
            data: batchUpdates,
          }),
        }
      );
      if (!batchRes.ok) {
        throw parseSheetsApiError(await batchRes.text(), 'อัปเดตคีย์ Settings ไม่สำเร็จ');
      }
    }

    if (toAppend.length > 0) {
      const appRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent('Settings!A:B')}:append?valueInputOption=USER_ENTERED`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: toAppend }),
        }
      );
      if (!appRes.ok) {
        throw parseSheetsApiError(await appRes.text(), 'เพิ่มคีย์ Settings ใหม่ไม่สำเร็จ');
      }
    }

    clearSettingsDirty(expectedDirtyVersion);
    if (auditEntry) {
      await appendAuditLogToSheet(accessToken, spreadsheetId, auditEntry);
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'OAuth settings error') };
  }
};

/**
 * Full 2-Way Apps Script sync for Admin PIN-unlocked session (zero Google Sign-In).
 */
export const syncAdminViaAppsScript = async (
  gasUrl: string,
  adminPin: string,
  db: AppDatabase
): Promise<{
  accessible: boolean;
  adminSynced: boolean;
  mergedDb: AppDatabase;
  pushedCount: number;
  error?: string;
}> => {
  const pubRes = await syncPublicViaAppsScript(gasUrl, db);
  if (!pubRes.accessible) {
    return { accessible: false, adminSynced: false, mergedDb: db, pushedCount: 0 };
  }

  const workingDb = pubRes.mergedDb;
  const dirtyVersions = {
    staff: getStaffMasterDirtyVersion(),
    settings: getSettingsDirtyVersion(),
    workloads: getWorkloadsDirtyVersion(),
    leaves: getLeavesDirtyVersion(),
    ot: getOtDirtyVersion(),
  };
  const dirty = {
    staff: dirtyVersions.staff > 0 || Boolean(pubRes.needsStaffIdUpgrade),
    settings: dirtyVersions.settings > 0,
    workloads: dirtyVersions.workloads > 0,
    leaves: dirtyVersions.leaves > 0,
    ot: dirtyVersions.ot > 0,
  };
  const pendingAudits = getPendingOutboxAuditLogs();
  const anyDirty =
    dirty.staff ||
    dirty.settings ||
    dirty.workloads ||
    dirty.leaves ||
    dirty.ot ||
    pendingAudits.length > 0;

  if (!adminPin || !anyDirty) {
    return {
      accessible: true,
      adminSynced: true,
      mergedDb: workingDb,
      pushedCount: pubRes.pushedCount,
    };
  }

  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'syncAdminAll',
        adminPin,
        payload: {
          dirty: {
            ...dirty,
            settings: dirty.settings || dirty.staff,
          },
          staff: workingDb.staff.map(prepareStaffForRemote),
          workloads: workingDb.workloads.map(prepareWorkloadForRemote),
          leaves: workingDb.leaves,
          ot: workingDb.ot.map(prepareOtForRemote),
          auditLogs: pendingAudits,
          settings: {
            ...workingDb.settings,
            staffEmployeeCodes: buildStaffEmployeeCodesMap(workingDb.staff),
          },
        },
      }),
    });

    if (!res.ok) {
      return {
        accessible: true,
        adminSynced: false,
        mergedDb: workingDb,
        pushedCount: pubRes.pushedCount,
        error: `HTTP ${res.status}`,
      };
    }

    const data = await res.json();
    if (!data || data.success === false) {
      return {
        accessible: true,
        adminSynced: false,
        mergedDb: workingDb,
        pushedCount: pubRes.pushedCount,
        error: String(data?.error || 'Apps Script syncAdminAll failed'),
      };
    }

    // Verify dirty tables actually cleared deleted items before clearing dirty versions
    if (dirty.workloads && Array.isArray(data.workloadRows)) {
      const remoteParsed = parseRemoteWorkloadsOnly(
        data.workloadRows,
        workingDb.settings.premiumSubClinics
      );
      const deletedSet = getDeletedWorkloadKeySet();
      if (remoteParsed.some((r) => deletedSet.has(workloadKey(r)))) {
        return {
          accessible: true,
          adminSynced: false,
          mergedDb: workingDb,
          pushedCount: pubRes.pushedCount,
          error: 'Google Sheet ยังแสดงรายการที่ลบไปแล้ว (กรุณาตรวจสอบการ Deploy Code.gs)',
        };
      }
    }

    if (dirty.staff) clearStaffMasterDirty(dirtyVersions.staff);
    if (dirty.settings) clearSettingsDirty(dirtyVersions.settings);
    if (dirty.workloads) {
      clearWorkloadsDirty(dirtyVersions.workloads);
      if (getWorkloadsDirtyVersion() === 0) clearAllWorkloadTombstones();
    }
    if (dirty.leaves) {
      clearLeavesDirty(dirtyVersions.leaves);
      if (getLeavesDirtyVersion() === 0) clearAllLeaveTombstones();
    }
    if (dirty.ot) {
      clearOtDirty(dirtyVersions.ot);
      if (getOtDirtyVersion() === 0) clearAllOtTombstones();
    }
    if (pendingAudits.length > 0) {
      markAuditOutboxSynced(pendingAudits);
    }

    const refreshed = mergeRemoteDataRows(
      {
        staffRows: Array.isArray(data.staffRows) ? data.staffRows : [],
        workloadRows: Array.isArray(data.workloadRows) ? data.workloadRows : [],
        leaveRows: Array.isArray(data.leaveRows) ? data.leaveRows : [],
        otRows: Array.isArray(data.otRows) ? data.otRows : [],
        settingsRows: Array.isArray(data.settingsRows) ? data.settingsRows : [],
        auditRows: Array.isArray(data.auditRows) ? data.auditRows : [],
      },
      workingDb,
      { justPushedAudits: pendingAudits }
    );

    const authoritativeDb: AppDatabase = {
      ...refreshed,
      staff: dirty.staff ? workingDb.staff : refreshed.staff,
      workloads: dirty.workloads ? workingDb.workloads : refreshed.workloads,
      leaves: dirty.leaves ? workingDb.leaves : refreshed.leaves,
      ot: dirty.ot ? workingDb.ot : refreshed.ot,
      settings: dirty.settings ? workingDb.settings : refreshed.settings,
    };

    const resolvedSheetId =
      authoritativeDb.settings.spreadsheetId || String(data.spreadsheetId || '').trim();

    return {
      accessible: true,
      adminSynced: true,
      pushedCount: pubRes.pushedCount,
      mergedDb: {
        ...authoritativeDb,
        settings: {
          ...authoritativeDb.settings,
          spreadsheetId: resolvedSheetId || undefined,
          spreadsheetUrl:
            authoritativeDb.settings.spreadsheetUrl ||
            (resolvedSheetId
              ? `https://docs.google.com/spreadsheets/d/${resolvedSheetId}/edit`
              : undefined),
          gasUrl: authoritativeDb.settings.gasUrl || String(data.gasUrl || gasUrl).trim(),
        },
      },
    };
  } catch (err: any) {
    return {
      accessible: true,
      adminSynced: false,
      mergedDb: workingDb,
      pushedCount: pubRes.pushedCount,
      error: String(err?.message || err || 'Network error'),
    };
  }
};

export const appendAuditViaAppsScript = async (
  gasUrl: string,
  adminPin: string,
  entry: AuditLogEntry
): Promise<boolean> => {
  if (!gasUrl || !adminPin) return false;
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'appendAudit',
        adminPin,
        payload: entry,
      }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.success);
  } catch {
    return false;
  }
};

export interface LineAutomationStatusInfo {
  enabled: boolean;
  time: string;
  triggerInstalled: boolean;
  triggerCount: number;
  nextRunAt: string;
  hasToken: boolean;
  tokenVerified?: boolean;
  tokenError?: string;
  botName?: string;
  groupVerified?: boolean;
  groupName?: string;
  targetId?: string;
  detectedGroupId?: string;
  detectedGroupName?: string;
  lastSentAt?: string;
  lastSentReportDate?: string;
  lastStatus?: string;
}

export interface LineServerStatusInfo {
  ok: boolean;
  hasServerToken: boolean;
  tokenVerified?: boolean;
  tokenError?: string;
  defaultGroupId: string;
  targetId: string;
  botName: string;
  groupName: string;
  groupVerified: boolean;
  groupError: string;
  serverAutoEnabled: boolean;
  serverAutoTime: string;
  serverNextRunAt: string;
  lastSentAt: string;
  lastStatus: string;
  detectedGroupId?: string;
  detectedGroupName?: string;
}

export const fetchServerLineStatus = async (
  targetId?: string,
  refresh = false
): Promise<LineServerStatusInfo | null> => {
  try {
    const qs = new URLSearchParams();
    if (targetId && targetId.trim()) qs.set('targetId', targetId.trim());
    if (refresh) qs.set('refresh', '1');
    const url = `/api/line/status${qs.toString() ? `?${qs.toString()}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    const data = await res.json();
    if (!data || data.ok === false) return null;
    return data as LineServerStatusInfo;
  } catch {
    return null;
  }
};

export const sendLineMessageViaServerProxy = async (params: {
  targetId?: string;
  targetIds?: string[];
  message: string;
  imageUrl?: string;
  previewImageUrl?: string;
  sendFormat?: LineSendFormat;
}): Promise<{
  available: boolean;
  ok: boolean;
  statusText?: string;
  sentAt?: string;
  groupName?: string;
  sentCount?: number;
  error?: string;
}> => {
  try {
    const res = await fetch('/api/line/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetId: (params.targetId || DEFAULT_LINE_GROUP_ID).trim(),
        ...(params.targetIds && params.targetIds.length > 0 ? { targetIds: params.targetIds } : {}),
        message: params.message,
        ...(params.imageUrl ? { imageUrl: params.imageUrl } : {}),
        ...(params.previewImageUrl ? { previewImageUrl: params.previewImageUrl } : {}),
        ...(params.sendFormat ? { sendFormat: params.sendFormat } : {}),
      }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { available: false, ok: false };
    }
    const data = await res.json();
    return {
      available: true,
      ok: Boolean(res.ok && data?.ok),
      statusText: data?.statusText,
      sentAt: data?.sentAt,
      groupName: data?.groupName,
      sentCount: data?.sentCount,
      error: data?.error,
    };
  } catch {
    return { available: false, ok: false };
  }
};

export const configureLineViaServerProxy = async (params: {
  enabled: boolean;
  time: string;
  reportDayMode: LineAutoReportDayMode;
  shift: 'ALL' | WorkShift;
  targetId: string;
  targetGroups?: LineTargetGroup[];
  schedules?: LineReportSchedule[];
  sendAsImage?: boolean;
  sendFormat?: LineSendFormat;
  boobyOwnerName?: string;
  boobyOwnerUserId?: string;
  boobyGroupMentionOnly?: boolean;
  gasUrl?: string;
  adminPin?: string;
}): Promise<{
  available: boolean;
  ok: boolean;
  hasServerToken?: boolean;
  botName?: string;
  groupName?: string;
  groupVerified?: boolean;
  groupError?: string;
  serverNextRunAt?: string;
  gasSynced?: boolean;
  gasError?: string;
  gasData?: Record<string, unknown> | null;
}> => {
  try {
    const res = await fetch('/api/line/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { available: false, ok: false };
    }
    const data = await res.json();
    return {
      available: true,
      ok: Boolean(res.ok && data?.ok),
      hasServerToken: Boolean(data?.hasServerToken),
      botName: data?.botName,
      groupName: data?.groupName,
      groupVerified: data?.groupVerified,
      groupError: data?.groupError,
      serverNextRunAt: data?.serverNextRunAt,
      gasSynced: Boolean(data?.gasSynced),
      gasError: data?.gasError,
      gasData: data?.gasData || null,
    };
  } catch {
    return { available: false, ok: false };
  }
};

export const configureLineAutomationViaAppsScript = async (params: {
  gasUrl: string;
  adminPin: string;
  config: {
    enabled: boolean;
    time: string;
    reportDayMode: LineAutoReportDayMode;
    shift: 'ALL' | WorkShift;
    targetId: string;
    targetGroups?: LineTargetGroup[];
    schedules?: LineReportSchedule[];
    sendAsImage?: boolean;
    sendFormat?: LineSendFormat;
    boobyOwnerName?: string;
    boobyOwnerUserId?: string;
    boobyGroupMentionOnly?: boolean;
  };
  db: AppDatabase;
  expectedDirtyVersion?: number;
}): Promise<{
  ok: boolean;
  error?: string;
  syncedDb?: AppDatabase;
  lineAutomation?: LineAutomationStatusInfo;
}> => {
  const { gasUrl, adminPin, config, db, expectedDirtyVersion } = params;
  if (!gasUrl || !adminPin) {
    return { ok: false, error: 'ไม่มี Web App URL หรือรหัส Admin PIN' };
  }
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'configureLineAutomation',
        adminPin,
        payload: config,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (!data || data.success === false) {
      return {
        ok: false,
        error: String(data?.error || 'Google Apps Script ปฏิเสธการตั้งค่า LINE อัตโนมัติ (กรุณาตรวจสอบการ Deploy Code.gs)'),
      };
    }
    clearSettingsDirty(expectedDirtyVersion);
    const merged = mergeRemoteDataRows(
      {
        staffRows: Array.isArray(data.staffRows) ? data.staffRows : [],
        workloadRows: Array.isArray(data.workloadRows) ? data.workloadRows : [],
        leaveRows: Array.isArray(data.leaveRows) ? data.leaveRows : [],
        otRows: Array.isArray(data.otRows) ? data.otRows : [],
        settingsRows: Array.isArray(data.settingsRows) ? data.settingsRows : [],
        auditRows: Array.isArray(data.auditRows) ? data.auditRows : [],
      },
      db
    );
    const resolvedSheetId =
      merged.settings.spreadsheetId || String(data.spreadsheetId || '').trim();
    return {
      ok: true,
      syncedDb: {
        ...merged,
        settings: {
          ...merged.settings,
          spreadsheetId: resolvedSheetId || undefined,
          spreadsheetUrl:
            merged.settings.spreadsheetUrl ||
            (resolvedSheetId
              ? `https://docs.google.com/spreadsheets/d/${resolvedSheetId}/edit`
              : undefined),
          gasUrl: merged.settings.gasUrl || String(data.gasUrl || gasUrl).trim(),
        },
      },
      lineAutomation: data.lineAutomation,
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'Network error') };
  }
};

export const uploadLineReportJpegViaAppsScript = async (params: {
  gasUrl: string;
  base64Jpeg: string;
  filename?: string;
}): Promise<{ ok: boolean; imageUrl?: string; previewImageUrl?: string; error?: string }> => {
  const { gasUrl, base64Jpeg, filename } = params;
  if (!gasUrl) {
    return { ok: false, error: 'ยังไม่ได้เชื่อมต่อ Google Apps Script Web App URL' };
  }
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'uploadLineReportJpeg',
        payload: {
          base64Jpeg: base64Jpeg.replace(/^data:image\/\w+;base64,/, ''),
          filename: filename || `OPD_Census_${Date.now()}.jpeg`,
        },
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!data || data.success === false || !data.imageUrl) {
      return { ok: false, error: String(data?.error || 'อัปโหลดภาพ .jpeg ไปยัง Google Drive ไม่สำเร็จ') };
    }
    return {
      ok: true,
      imageUrl: String(data.imageUrl),
      previewImageUrl: String(data.previewImageUrl || data.imageUrl),
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'Network error') };
  }
};

export const saveUnitCostCenterViaAppsScript = async (params: {
  gasUrl: string;
  clinic: string;
  costCenter: string;
}): Promise<{ ok: boolean; error?: string }> => {
  const { gasUrl, clinic, costCenter } = params;
  if (!gasUrl) return { ok: false, error: 'ไม่มี Web App URL' };
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'saveUnitCostCenter',
        payload: { clinic, costCenter },
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    if (!data || data.success === false) {
      return { ok: false, error: String(data?.error || 'บันทึก Cost Center ไม่สำเร็จ') };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'Network error') };
  }
};

export const sendLineDailyCensusNowViaAppsScript = async (params: {
  gasUrl: string;
  adminPin?: string;
  targetId?: string;
  targetIds?: string[];
  date?: string;
  shift?: string;
  reportDayMode?: LineAutoReportDayMode;
  message?: string;
  imageUrl?: string;
  previewImageUrl?: string;
  imageBase64?: string;
  sendFormat?: LineSendFormat;
  scheduleId?: string;
  db: AppDatabase;
}): Promise<{
  ok: boolean;
  error?: string;
  statusText?: string;
  sentAt?: string;
  targetDate?: string;
  syncedDb?: AppDatabase;
}> => {
  const {
    gasUrl,
    adminPin,
    targetId,
    targetIds,
    date,
    shift,
    reportDayMode,
    message,
    imageUrl,
    previewImageUrl,
    imageBase64,
    sendFormat,
    scheduleId,
    db,
  } = params;
  if (!gasUrl || !adminPin) {
    return { ok: false, error: 'ไม่มี Web App URL หรือรหัส Admin PIN' };
  }
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'sendLineReportNow',
        adminPin,
        payload: {
          targetId: (targetId || DEFAULT_LINE_GROUP_ID).trim(),
          ...(targetIds && targetIds.length > 0 ? { targetIds } : {}),
          ...(date ? { date } : {}),
          ...(shift ? { shift } : {}),
          ...(reportDayMode ? { reportDayMode } : {}),
          ...(message ? { message } : {}),
          ...(imageUrl ? { imageUrl } : {}),
          ...(previewImageUrl ? { previewImageUrl } : {}),
          ...(imageBase64 ? { imageBase64 } : {}),
          ...(sendFormat ? { sendFormat } : {}),
          ...(scheduleId ? { scheduleId } : {}),
        },
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const merged = Array.isArray(data?.settingsRows)
      ? mergeRemoteDataRows(
          {
            staffRows: Array.isArray(data.staffRows) ? data.staffRows : [],
            workloadRows: Array.isArray(data.workloadRows) ? data.workloadRows : [],
            leaveRows: Array.isArray(data.leaveRows) ? data.leaveRows : [],
            otRows: Array.isArray(data.otRows) ? data.otRows : [],
            settingsRows: data.settingsRows,
            auditRows: Array.isArray(data.auditRows) ? data.auditRows : [],
          },
          db
        )
      : undefined;

    if (!data || data.success === false) {
      return {
        ok: false,
        error: String(data?.error || 'ส่งรายงานเข้า LINE ไม่สำเร็จ'),
        statusText: data?.statusText,
        syncedDb: merged,
      };
    }

    return {
      ok: true,
      statusText: data.statusText,
      sentAt: data.sentAt,
      targetDate: data.targetDate,
      syncedDb: merged,
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'Network error') };
  }
};

export const fetchLineAutomationStatusViaAppsScript = async (params: {
  gasUrl: string;
  adminPin: string;
}): Promise<{
  ok: boolean;
  error?: string;
  status?: LineAutomationStatusInfo;
}> => {
  const { gasUrl, adminPin } = params;
  if (!gasUrl || !adminPin) {
    return { ok: false, error: 'ไม่มี Web App URL หรือรหัส Admin PIN' };
  }
  try {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'getLineAutomationStatus',
        adminPin,
        payload: {},
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    if (!data || data.success === false) {
      return {
        ok: false,
        error: String(data?.error || 'ไม่สามารถอ่านสถานะ LINE อัตโนมัติได้'),
      };
    }
    return {
      ok: true,
      status: {
        enabled: Boolean(data.enabled),
        time: String(data.time || DEFAULT_LINE_AUTO_TIME),
        triggerInstalled: Boolean(data.triggerInstalled),
        triggerCount: Number(data.triggerCount) || 0,
        nextRunAt: String(data.nextRunAt || ''),
        hasToken: Boolean(data.hasToken),
        tokenVerified: typeof data.tokenVerified === 'boolean' ? data.tokenVerified : undefined,
        tokenError: String(data.tokenError || ''),
        botName: String(data.botName || ''),
        groupVerified: typeof data.groupVerified === 'boolean' ? data.groupVerified : undefined,
        groupName: String(data.groupName || ''),
        targetId: String(data.targetId || DEFAULT_LINE_GROUP_ID),
        detectedGroupId: String(data.detectedGroupId || ''),
        detectedGroupName: String(data.detectedGroupName || ''),
        lastSentAt: String(data.lastSentAt || ''),
        lastSentReportDate: String(data.lastSentReportDate || ''),
        lastStatus: String(data.lastStatus || ''),
      },
    };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err || 'Network error') };
  }
};


