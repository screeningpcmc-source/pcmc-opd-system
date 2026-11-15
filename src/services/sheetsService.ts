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
  getEffectiveTotalPt,
  normalizeWorkloadRecord
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
const DEMO_PURGED_KEY = 'pcmc_demo_data_purged_v1';

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
        position: (s.position === 'PCA' ? 'NA' : s.position) as StaffPosition,
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
        position: (l.position === 'PCA' ? 'NA' : l.position) as StaffPosition,
      }));

      const rawOt: any[] = parsed.ot || INITIAL_OT;
      const migratedOt = (needsDemoPurge
        ? rawOt.filter((o) => !isDemoOtId(o.id))
        : rawOt
      ).map((o: any) => ({
        ...o,
        position: (o.position === 'PCA' ? 'NA' : o.position) as StaffPosition,
      }));

      const mergedSettings: SystemSettings = {
        ...INITIAL_SETTINGS,
        ...(parsed.settings || {}),
        screeningNhppd:
          Number(parsed.settings?.screeningNhppd) > 0
            ? Number(parsed.settings.screeningNhppd)
            : 0.1,
        inTimeClinics:
          Array.isArray(parsed.settings?.inTimeClinics) && parsed.settings.inTimeClinics.length > 0
            ? parsed.settings.inTimeClinics
            : INITIAL_SETTINGS.inTimeClinics,
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
        gasUrl: typeof parsed.settings?.gasUrl === 'string' ? parsed.settings.gasUrl.trim() : '',
        autoSync: parsed.settings?.autoSync !== undefined ? Boolean(parsed.settings.autoSync) : true,
      };

      const cleanDb: AppDatabase = {
        staff: migratedStaff,
        workloads: migratedWorkloads,
        leaves: migratedLeaves,
        ot: migratedOt,
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

export const saveLocalDatabase = (db: AppDatabase): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (err) {
    console.error('Error saving local DB:', err);
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

  const staffRows = staffList.map((s) => [
    s.staffId,
    s.name,
    s.position,
    s.homeClinic,
    s.status,
    s.startDate || '',
    s.endDate || '',
  ]);
  const settingsRows = [
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
  ];

  const batchUpdateValues = {
    valueInputOption: 'USER_ENTERED',
    data: [
      {
        range: 'Staff_Master!A1:G',
        values: [
          ['Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status', 'Start_Date', 'End_Date'],
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
        range: 'OT_Attendance!A1:F1',
        values: [['Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic']],
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

    const clearRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Staff_Master!A:G:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!clearRes.ok) {
      const errText = await clearRes.text();
      throw parseSheetsApiError(errText, 'ล้างข้อมูลชีท Staff_Master ไม่สำเร็จ');
    }

    const rows = [
      ['Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status', 'Start_Date', 'End_Date'],
      ...staffList.map((s) => [
        s.staffId,
        s.name,
        s.position,
        s.homeClinic,
        s.status,
        s.startDate || '',
        s.endDate || '',
      ]),
    ];

    const putRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Staff_Master!A1:G${rows.length}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: rows }),
      }
    );
    if (!putRes.ok) {
      const errText = await putRes.text();
      throw parseSheetsApiError(errText, 'บันทึกชีท Staff_Master ไม่สำเร็จ');
    }

    clearStaffMasterDirty();
    return true;
  } catch (err) {
    console.error('Failed to sync Staff_Master:', err);
    return false;
  }
};

export function getWorkloadKey(w: DailyWorkload): string {
  return [
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
    (w.note || '').trim(),
    (w.reporter || '').trim(),
    (w.clinicGroup || '').trim(),
    (w.recordType || 'STANDARD').trim(),
  ].join('|');
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
  return [
    (o.date || '').trim(),
    (o.shift || '').trim(),
    (o.staffName || '').trim(),
    (o.homeClinic || '').trim(),
    (o.workClinic || '').trim(),
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
      'Staff_Master!A:G'
    )}&ranges=${encodeURIComponent('Daily_Workload!A:R')}&ranges=${encodeURIComponent(
      'Leave_Records!A:H'
    )}&ranges=${encodeURIComponent('OT_Attendance!A:F')}&ranges=${encodeURIComponent(
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

  // 1. Parse Staff_Master from sheet
  const sheetStaffRows = staffRawRows
    .slice(1)
    .filter((r) => (r[1] || '').trim().length > 0)
    .map((r, idx): StaffMember => {
      const rawPos = (r[2] || 'RN').trim();
      const pos = (rawPos === 'PCA' ? 'NA' : rawPos) as StaffPosition;
      const rawStatus = (r[4] || 'Active').trim();
      const status: StaffStatus =
        rawStatus === 'Resigned' || rawStatus === 'Retired' ? rawStatus : 'Active';
      return {
        staffId: (r[0] || `STF-GS-${idx + 1}`).trim(),
        name: (r[1] || '').trim(),
        position: pos,
        homeClinic: (r[3] || '').trim(),
        status,
        startDate: (r[5] || '').trim() || undefined,
        endDate: (r[6] || '').trim() || undefined,
      };
    });

  const shouldPushStaff = Boolean(options?.pushLocalStaff || isStaffMasterDirty() || sheetStaffRows.length === 0);
  const finalStaff = shouldPushStaff ? db.staff : sheetStaffRows;

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
  const localWKeys = new Set(db.workloads.map(workloadKey));

  const workloadsToPush = shouldOverwriteWorkloads
    ? []
    : db.workloads.filter((w) => !sheetWKeys.has(workloadKey(w)));
  const workloadsPulled = shouldOverwriteWorkloads
    ? []
    : sheetWorkloads.filter((w) => !localWKeys.has(workloadKey(w)));

  const mergedWorkloadsMap = new Map<string, DailyWorkload>();
  (shouldOverwriteWorkloads ? db.workloads : [...db.workloads, ...sheetWorkloads]).forEach((w) => {
    const k = workloadKey(w);
    if (!mergedWorkloadsMap.has(k)) {
      mergedWorkloadsMap.set(
        k,
        normalizeWorkloadRecord({ ...w, totalPt: getEffectiveTotalPt(w) }, db.settings.premiumSubClinics)
      );
    }
  });
  const mergedWorkloads = Array.from(mergedWorkloadsMap.values()).sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  // 3. Parse Leave_Records from sheet & merge with local
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
        position: (rawPos === 'PCA' ? 'NA' : rawPos) as StaffPosition,
        clinic: String(r[4] || '').trim(),
        leaveType: (String(r[5] || 'ลาป่วย').trim()) as LeaveType,
        days: Number(r[6] || 1),
        note: String(r[7] || '').trim(),
      };
    });

  const shouldOverwriteLeaves = isLeavesDirty();
  const sheetLKeys = new Set(sheetLeaves.map(leaveKey));
  const leavesToPush = shouldOverwriteLeaves
    ? []
    : db.leaves.filter((l) => !sheetLKeys.has(leaveKey(l)));
  const mergedLeavesMap = new Map<string, LeaveRecord>();
  (shouldOverwriteLeaves ? db.leaves : [...db.leaves, ...sheetLeaves]).forEach((l) => {
    const k = leaveKey(l);
    if (!mergedLeavesMap.has(k)) mergedLeavesMap.set(k, l);
  });
  const mergedLeaves = Array.from(mergedLeavesMap.values()).sort((a, b) =>
    b.startDate.localeCompare(a.startDate)
  );

  // 4. Parse OT_Attendance from sheet & merge with local
  const sheetOt: OTAttendance[] = otRawRows
    .slice(1)
    .filter((r) => (r[0] || '').trim() && (r[2] || '').trim())
    .map((r, idx) => {
      const rawPos = (r[3] || 'RN').trim();
      return {
        id: `OT-GS-${Date.now()}-${idx}`,
        date: String(r[0] || '').trim(),
        shift: String(r[1] || 'นอกเวลาเย็น 16:00-20:00').trim() as WorkShift,
        staffName: String(r[2] || '').trim(),
        position: (rawPos === 'PCA' ? 'NA' : rawPos) as StaffPosition,
        homeClinic: String(r[4] || '').trim(),
        workClinic: String(r[5] || '').trim(),
      };
    });

  const shouldOverwriteOt = isOtDirty();
  const sheetOKeys = new Set(sheetOt.map(otKey));
  const otToPush = shouldOverwriteOt
    ? []
    : db.ot.filter((o) => !sheetOKeys.has(otKey(o)));
  const mergedOtMap = new Map<string, OTAttendance>();
  (shouldOverwriteOt ? db.ot : [...db.ot, ...sheetOt]).forEach((o) => {
    const k = otKey(o);
    if (!mergedOtMap.has(k)) mergedOtMap.set(k, o);
  });
  const mergedOt = Array.from(mergedOtMap.values()).sort((a, b) => b.date.localeCompare(a.date));

  // 4.5 Parse Audit_Logs from sheet & merge with local
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
  const auditLogsToPush = (db.auditLogs || []).filter((a) => !sheetAuditKeys.has(auditLogKey(a)));
  const mergedAuditMap = new Map<string, AuditLogEntry>();
  [...(db.auditLogs || []), ...sheetAuditLogs].forEach((a) => {
    const k = auditLogKey(a);
    if (!mergedAuditMap.has(k)) mergedAuditMap.set(k, a);
  });
  const mergedAuditLogs = Array.from(mergedAuditMap.values()).sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  );

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
    inTimeClinics:
      db.settings.inTimeClinics && db.settings.inTimeClinics.length > 0
        ? db.settings.inTimeClinics
        : settingsMap['In_Time_Clinics']
        ? settingsMap['In_Time_Clinics'].split(',').map((s) => s.trim()).filter(Boolean)
        : [...IN_TIME_CLINICS],
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
  };

  // 6. Push headers + updated tabs back to Google Sheets cleanly
  const writeData: { range: string; values: (string | number)[][] }[] = [];

  if (shouldPushStaff) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Staff_Master!A:G:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    writeData.push({
      range: 'Staff_Master!A1:G',
      values: [
        ['Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status', 'Start_Date', 'End_Date'],
        ...finalStaff.map((s) => [
          s.staffId,
          s.name,
          s.position,
          s.homeClinic,
          s.status,
          s.startDate || '',
          s.endDate || '',
        ]),
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
          w.note,
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
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/OT_Attendance!A:F:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    writeData.push({
      range: 'OT_Attendance!A1:F',
      values: [
        ['Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic'],
        ...mergedOt.map((o) => [
          o.date,
          o.shift,
          o.staffName,
          o.position,
          o.homeClinic,
          o.workClinic,
        ]),
      ],
    });
  } else if (otRawRows.length === 0) {
    writeData.push({
      range: 'OT_Attendance!A1:F1',
      values: [['Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic']],
    });
  }

  if (auditRawRows.length === 0) {
    writeData.push({
      range: 'Audit_Logs!A1:F1',
      values: [['Timestamp', 'Action', 'Target_Name', 'Summary', 'Reason', 'Edited_By']],
    });
  }

  writeData.push({
    range: 'Settings!A1:B15',
    values: [
      ['Key', 'Value'],
      ['NHPPD', finalSettings.nhppd.toString()],
      ['Screening_NHPPD', (finalSettings.screeningNhppd ?? 0.1).toString()],
      ['Std_Hr', finalSettings.stdHr.toString()],
      ['Annual_Hr', finalSettings.annualHr.toString()],
      ['Work_Days', finalSettings.workDays.toString()],
      ['Admin_Emails', finalSettings.adminEmails.join(', ')],
      ['In_Time_Clinics', (finalSettings.inTimeClinics || []).join(', ')],
      ['Out_Time_Clinics', (finalSettings.outTimeClinics || []).join(', ')],
      ['Premium_Sub_Clinics', (finalSettings.premiumSubClinics || [...DEFAULT_PREMIUM_SUB_CLINICS]).join(', ')],
      ['Leave_Types', (finalSettings.leaveTypes || [...LEAVE_TYPES]).join(', ')],
      ['Custom_Holidays', JSON.stringify(finalSettings.customHolidays || [])],
      ['Primary_Admin_Owner', finalSettings.primaryAdminOwner || DEFAULT_PRIMARY_ADMIN_OWNER],
      ['Additional_Admin_Pins', JSON.stringify(finalSettings.additionalAdminPins || buildDefaultAdditionalAdminPins())],
      ['Gas_Web_App_URL', finalSettings.gasUrl || ''],
    ],
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
            w.note,
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
            o.workClinic,
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
      entry.note,
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
    const row = [ot.date, ot.shift, ot.staffName, ot.position, ot.homeClinic, ot.workClinic];

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
    )}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheetName)}`;
    const res = await fetch(url, { method: 'GET' });
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

function mergeRemoteDataRows(
  params: {
    staffRows: string[][];
    workloadRows: string[][];
    leaveRows: string[][];
    otRows: string[][];
    settingsRows: string[][];
    auditRows: string[][];
  },
  db: AppDatabase
): AppDatabase {
  const sheetStaff: StaffMember[] = params.staffRows
    .filter((r) => (r[1] || '').trim().length > 0)
    .map((r, idx) => {
      const rawPos = (r[2] || 'RN').trim();
      const pos = (rawPos === 'PCA' ? 'NA' : rawPos) as StaffPosition;
      const rawStatus = (r[4] || 'Active').trim();
      const status: StaffStatus =
        rawStatus === 'Resigned' || rawStatus === 'Retired' ? rawStatus : 'Active';
      return {
        staffId: (r[0] || `STF-GS-${idx + 1}`).trim(),
        name: (r[1] || '').trim(),
        position: pos,
        homeClinic: (r[3] || '').trim(),
        status,
        startDate: (r[5] || '').trim() || undefined,
        endDate: (r[6] || '').trim() || undefined,
      };
    });

  const finalStaff = isStaffMasterDirty() ? db.staff : sheetStaff.length > 0 ? sheetStaff : db.staff;

  const deletedWKeys = getDeletedWorkloadKeySet();
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
    })
    .filter((w) => !deletedWKeys.has(workloadKey(w)));

  const shouldOverwriteWorkloads = isWorkloadsDirty();
  const mergedWorkloadsMap = new Map<string, DailyWorkload>();
  (shouldOverwriteWorkloads ? db.workloads : [...db.workloads, ...sheetWorkloads]).forEach((w) => {
    const k = workloadKey(w);
    if (!mergedWorkloadsMap.has(k)) {
      mergedWorkloadsMap.set(
        k,
        normalizeWorkloadRecord({ ...w, totalPt: getEffectiveTotalPt(w) }, db.settings.premiumSubClinics)
      );
    }
  });
  const mergedWorkloads = Array.from(mergedWorkloadsMap.values()).sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  const deletedLKeys = getDeletedLeaveKeySet();
  const sheetLeaves: LeaveRecord[] = params.leaveRows
    .filter((r) => (r[0] || '').trim() && (r[2] || '').trim())
    .map((r, idx) => {
      const rawPos = (r[3] || 'RN').trim();
      return {
        id: `LV-GS-${Date.now()}-${idx}`,
        startDate: String(r[0] || '').trim(),
        endDate: String(r[1] || r[0] || '').trim(),
        staffName: String(r[2] || '').trim(),
        position: (rawPos === 'PCA' ? 'NA' : rawPos) as StaffPosition,
        clinic: String(r[4] || '').trim(),
        leaveType: String(r[5] || 'ลาป่วย').trim() as LeaveType,
        days: Number(r[6] || 1),
        note: String(r[7] || '').trim(),
      };
    })
    .filter((l) => !deletedLKeys.has(leaveKey(l)));

  const shouldOverwriteLeaves = isLeavesDirty();
  const mergedLeavesMap = new Map<string, LeaveRecord>();
  (shouldOverwriteLeaves ? db.leaves : [...db.leaves, ...sheetLeaves]).forEach((l) => {
    const k = leaveKey(l);
    if (!mergedLeavesMap.has(k)) mergedLeavesMap.set(k, l);
  });
  const mergedLeaves = Array.from(mergedLeavesMap.values()).sort((a, b) =>
    b.startDate.localeCompare(a.startDate)
  );

  const deletedOKeys = getDeletedOtKeySet();
  const sheetOt: OTAttendance[] = params.otRows
    .filter((r) => (r[0] || '').trim() && (r[2] || '').trim())
    .map((r, idx) => {
      const rawPos = (r[3] || 'RN').trim();
      return {
        id: `OT-GS-${Date.now()}-${idx}`,
        date: String(r[0] || '').trim(),
        shift: String(r[1] || 'นอกเวลาเย็น 16:00-20:00').trim() as WorkShift,
        staffName: String(r[2] || '').trim(),
        position: (rawPos === 'PCA' ? 'NA' : rawPos) as StaffPosition,
        homeClinic: String(r[4] || '').trim(),
        workClinic: String(r[5] || '').trim(),
      };
    })
    .filter((o) => !deletedOKeys.has(otKey(o)));

  const shouldOverwriteOt = isOtDirty();
  const mergedOtMap = new Map<string, OTAttendance>();
  (shouldOverwriteOt ? db.ot : [...db.ot, ...sheetOt]).forEach((o) => {
    const k = otKey(o);
    if (!mergedOtMap.has(k)) mergedOtMap.set(k, o);
  });
  const mergedOt = Array.from(mergedOtMap.values()).sort((a, b) => b.date.localeCompare(a.date));

  const sheetAuditLogs: AuditLogEntry[] = params.auditRows
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

  const mergedAuditMap = new Map<string, AuditLogEntry>();
  [...(db.auditLogs || []), ...sheetAuditLogs].forEach((a) => {
    const k = auditLogKey(a);
    if (!mergedAuditMap.has(k)) mergedAuditMap.set(k, a);
  });
  const mergedAuditLogs = Array.from(mergedAuditMap.values()).sort((a, b) =>
    b.timestamp.localeCompare(a.timestamp)
  );

  const settingsMap: Record<string, string> = {};
  params.settingsRows.forEach((r) => {
    if (r[0]) settingsMap[String(r[0]).trim()] = String(r[1] || '').trim();
  });

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
    inTimeClinics: settingsDirty
      ? db.settings.inTimeClinics
      : settingsMap['In_Time_Clinics']
      ? settingsMap['In_Time_Clinics'].split(',').map((s) => s.trim()).filter(Boolean)
      : db.settings.inTimeClinics,
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
    gasUrl: settingsDirty
      ? db.settings.gasUrl || ''
      : db.settings.gasUrl || settingsMap['Gas_Web_App_URL'] || '',
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
      staffRows: staffRows || [],
      workloadRows: workloadRows || [],
      leaveRows: leaveRows || [],
      otRows: otRows || [],
      settingsRows: settingsRows || [],
      auditRows: auditRows || [],
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
  try {
    const bodyObj =
      action === 'appendWorkload'
        ? {
            action,
            payload,
            records: Array.isArray(payload) ? payload : [payload],
          }
        : { action, payload };
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(bodyObj),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.success);
  } catch (err) {
    console.error(`Failed to ${action} via Apps Script:`, err);
    return false;
  }
};

export const hasPendingAdminDirtyFlags = (): boolean =>
  isStaffMasterDirty() ||
  isSettingsDirty() ||
  isWorkloadsDirty() ||
  isLeavesDirty() ||
  isOtDirty();

/**
 * 2-Way Apps Script sync for general OPD staff (zero Google Sign-In, zero Admin PIN):
 * - Reads all remote tabs
 * - Pushes any local Workload/Leave/OT records not yet present in the remote sheet
 */
export const syncPublicViaAppsScript = async (
  gasUrl: string,
  db: AppDatabase
): Promise<{ accessible: boolean; mergedDb: AppDatabase; pushedCount: number }> => {
  try {
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

    const remoteWorkloads: DailyWorkload[] = Array.isArray(data.workloadRows)
      ? data.workloadRows
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
                id: `REC-GS-${idx}`,
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
              db.settings.premiumSubClinics
            );
          })
          .filter((w: DailyWorkload) => !deletedWKeys.has(workloadKey(w)))
      : [];

    const remoteLeaves: LeaveRecord[] = Array.isArray(data.leaveRows)
      ? data.leaveRows
          .filter((r: string[]) => (r[0] || '').trim() && (r[2] || '').trim())
          .map((r: string[], idx: number) => ({
            id: `LV-GS-${idx}`,
            startDate: String(r[0] || '').trim(),
            endDate: String(r[1] || r[0] || '').trim(),
            staffName: String(r[2] || '').trim(),
            position: ((r[3] || 'RN').trim() === 'PCA' ? 'NA' : (r[3] || 'RN').trim()) as StaffPosition,
            clinic: String(r[4] || '').trim(),
            leaveType: String(r[5] || 'ลาป่วย').trim() as LeaveType,
            days: Number(r[6] || 1),
            note: String(r[7] || '').trim(),
          }))
          .filter((l: LeaveRecord) => !deletedLKeys.has(leaveKey(l)))
      : [];

    const remoteOt: OTAttendance[] = Array.isArray(data.otRows)
      ? data.otRows
          .filter((r: string[]) => (r[0] || '').trim() && (r[2] || '').trim())
          .map((r: string[], idx: number) => ({
            id: `OT-GS-${idx}`,
            date: String(r[0] || '').trim(),
            shift: String(r[1] || 'นอกเวลาเย็น 16:00-20:00').trim() as WorkShift,
            staffName: String(r[2] || '').trim(),
            position: ((r[3] || 'RN').trim() === 'PCA' ? 'NA' : (r[3] || 'RN').trim()) as StaffPosition,
            homeClinic: String(r[4] || '').trim(),
            workClinic: String(r[5] || '').trim(),
          }))
          .filter((o: OTAttendance) => !deletedOKeys.has(otKey(o)))
      : [];

    const remoteWKeys = new Set(remoteWorkloads.map(workloadKey));
    const remoteLKeys = new Set(remoteLeaves.map(leaveKey));
    const remoteOKeys = new Set(remoteOt.map(otKey));

    const workloadsToPush = !isWorkloadsDirty()
      ? db.workloads.filter((w) => !remoteWKeys.has(workloadKey(w)))
      : [];
    const leavesToPush = !isLeavesDirty()
      ? db.leaves.filter((l) => !remoteLKeys.has(leaveKey(l)))
      : [];
    const otToPush = !isOtDirty() ? db.ot.filter((o) => !remoteOKeys.has(otKey(o))) : [];

    let pushedCount = 0;
    if (workloadsToPush.length > 0) {
      if (await appendViaAppsScript(gasUrl, 'appendWorkload', workloadsToPush)) {
        pushedCount += workloadsToPush.length;
      }
    }
    if (leavesToPush.length > 0) {
      if (await appendViaAppsScript(gasUrl, 'appendLeave', leavesToPush)) {
        pushedCount += leavesToPush.length;
      }
    }
    if (otToPush.length > 0) {
      if (await appendViaAppsScript(gasUrl, 'appendOT', otToPush)) {
        pushedCount += otToPush.length;
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
      db
    );
    const resolvedSheetId =
      mergedDb.settings.spreadsheetId || String(data.spreadsheetId || '').trim();

    return {
      accessible: true,
      pushedCount,
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
        position: (rawPos === 'PCA' ? 'NA' : rawPos) as StaffPosition,
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
    .map((r: string[], idx: number) => {
      const rawPos = (r[3] || 'RN').trim();
      return {
        id: `OT-CHK-${idx}`,
        date: String(r[0] || '').trim(),
        shift: String(r[1] || 'นอกเวลาเย็น 16:00-20:00').trim() as WorkShift,
        staffName: String(r[2] || '').trim(),
        position: (rawPos === 'PCA' ? 'NA' : rawPos) as StaffPosition,
        homeClinic: String(r[4] || '').trim(),
        workClinic: String(r[5] || '').trim(),
      };
    });
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
    if (table === 'staff') payload.staff = db.staff;
    if (table === 'workloads') payload.workloads = db.workloads;
    if (table === 'leaves') payload.leaves = db.leaves;
    if (table === 'ot') payload.ot = db.ot;
    if (table === 'settings') payload.settings = db.settings;
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
      const rows = [
        [
          'Date', 'Shift', 'Clinic', 'Total_Pt', 'Adult_Pt', 'Child_Pt',
          'Admit', 'HN', 'RN', 'PN', 'NA', 'Clerk', 'Service_Worker',
          'Note', 'Reporter', 'Clinic_Group', 'Pool_ID', 'Record_Type',
        ],
        ...db.workloads.map((w) => [
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
          w.note,
          w.reporter,
          w.clinicGroup || '',
          w.poolId || '',
          w.recordType || 'STANDARD',
        ]),
      ];
      await clearAndPut('Daily_Workload!A:R', `Daily_Workload!A1:R${rows.length}`, rows);
      clearWorkloadsDirty(expectedDirtyVersion);
      if (getWorkloadsDirtyVersion() === 0) clearAllWorkloadTombstones();
    } else if (table === 'leaves') {
      const rows = [
        ['Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note'],
        ...db.leaves.map((l) => [
          l.startDate,
          l.endDate,
          l.staffName,
          l.position,
          l.clinic,
          l.leaveType,
          l.days,
          l.note || '',
        ]),
      ];
      await clearAndPut('Leave_Records!A:H', `Leave_Records!A1:H${rows.length}`, rows);
      clearLeavesDirty(expectedDirtyVersion);
      if (getLeavesDirtyVersion() === 0) clearAllLeaveTombstones();
    } else if (table === 'ot') {
      const rows = [
        ['Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic'],
        ...db.ot.map((o) => [
          o.date,
          o.shift,
          o.staffName,
          o.position,
          o.homeClinic,
          o.workClinic,
        ]),
      ];
      await clearAndPut('OT_Attendance!A:F', `OT_Attendance!A1:F${rows.length}`, rows);
      clearOtDirty(expectedDirtyVersion);
      if (getOtDirtyVersion() === 0) clearAllOtTombstones();
    } else if (table === 'staff') {
      const ok = await syncStaffMasterToSheet(accessToken, spreadsheetId, db.staff);
      if (!ok) return { ok: false, error: 'อัปเดต Staff_Master ไม่สำเร็จ' };
      clearStaffMasterDirty(expectedDirtyVersion);
    } else if (table === 'settings') {
      const s = db.settings;
      const rows = [
        ['Key', 'Value'],
        ['NHPPD', s.nhppd.toString()],
        ['Screening_NHPPD', (s.screeningNhppd ?? 0.1).toString()],
        ['Std_Hr', s.stdHr.toString()],
        ['Annual_Hr', s.annualHr.toString()],
        ['Work_Days', s.workDays.toString()],
        ['Admin_Emails', s.adminEmails.join(', ')],
        ['In_Time_Clinics', (s.inTimeClinics || []).join(', ')],
        ['Out_Time_Clinics', (s.outTimeClinics || []).join(', ')],
        ['Premium_Sub_Clinics', (s.premiumSubClinics || [...DEFAULT_PREMIUM_SUB_CLINICS]).join(', ')],
        ['Leave_Types', (s.leaveTypes || [...LEAVE_TYPES]).join(', ')],
        ['Custom_Holidays', JSON.stringify(s.customHolidays || [])],
        ['Primary_Admin_Owner', s.primaryAdminOwner || DEFAULT_PRIMARY_ADMIN_OWNER],
        ['Additional_Admin_Pins', JSON.stringify(s.additionalAdminPins || buildDefaultAdditionalAdminPins())],
        ['Gas_Web_App_URL', s.gasUrl || ''],
      ];
      await clearAndPut('Settings!A:B', `Settings!A1:B${rows.length}`, rows);
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
    staff: dirtyVersions.staff > 0,
    settings: dirtyVersions.settings > 0,
    workloads: dirtyVersions.workloads > 0,
    leaves: dirtyVersions.leaves > 0,
    ot: dirtyVersions.ot > 0,
  };
  const anyDirty =
    dirty.staff ||
    dirty.settings ||
    dirty.workloads ||
    dirty.leaves ||
    dirty.ot ||
    (workingDb.auditLogs && workingDb.auditLogs.length > 0);

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
          dirty,
          staff: workingDb.staff,
          workloads: workingDb.workloads,
          leaves: workingDb.leaves,
          ot: workingDb.ot,
          auditLogs: workingDb.auditLogs || [],
          settings: workingDb.settings,
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

    const refreshed = mergeRemoteDataRows(
      {
        staffRows: Array.isArray(data.staffRows) ? data.staffRows : [],
        workloadRows: Array.isArray(data.workloadRows) ? data.workloadRows : [],
        leaveRows: Array.isArray(data.leaveRows) ? data.leaveRows : [],
        otRows: Array.isArray(data.otRows) ? data.otRows : [],
        settingsRows: Array.isArray(data.settingsRows) ? data.settingsRows : [],
        auditRows: Array.isArray(data.auditRows) ? data.auditRows : [],
      },
      workingDb
    );

    // Preserve authoritative local arrays for tables that were just overwritten by Admin
    // so local metadata (IDs, edit reasons/timestamps) stays exact and remote echoes cannot duplicate
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
