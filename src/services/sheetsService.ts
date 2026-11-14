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
  LEAVE_TYPES,
  getEffectiveTotalPt
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
const DEMO_PURGED_KEY = 'pcmc_demo_data_purged_v1';

const isDemoStaffId = (id?: string) => /^STF-\d{3}$/.test((id || '').trim());
const isDemoWorkloadId = (id?: string) => /^WL-\d{3}$/.test((id || '').trim());
const isDemoLeaveId = (id?: string) => /^LV-\d{3}$/.test((id || '').trim());
const isDemoOtId = (id?: string) => /^OT-\d{3}$/.test((id || '').trim());

export const markStaffMasterDirty = (): void => {
  try {
    localStorage.setItem(STAFF_DIRTY_KEY, 'true');
  } catch {
    // ignore
  }
};

export const clearStaffMasterDirty = (): void => {
  try {
    localStorage.removeItem(STAFF_DIRTY_KEY);
  } catch {
    // ignore
  }
};

export const isStaffMasterDirty = (): boolean => {
  try {
    return localStorage.getItem(STAFF_DIRTY_KEY) === 'true';
  } catch {
    return false;
  }
};

export const markSettingsDirty = (): void => {
  try {
    localStorage.setItem(SETTINGS_DIRTY_KEY, 'true');
  } catch {
    // ignore
  }
};

export const clearSettingsDirty = (): void => {
  try {
    localStorage.removeItem(SETTINGS_DIRTY_KEY);
  } catch {
    // ignore
  }
};

export const isSettingsDirty = (): boolean => {
  try {
    return localStorage.getItem(SETTINGS_DIRTY_KEY) === 'true';
  } catch {
    return false;
  }
};

export const markWorkloadsDirty = (): void => {
  try {
    localStorage.setItem(WORKLOADS_DIRTY_KEY, 'true');
  } catch {
    // ignore
  }
};

export const clearWorkloadsDirty = (): void => {
  try {
    localStorage.removeItem(WORKLOADS_DIRTY_KEY);
  } catch {
    // ignore
  }
};

export const isWorkloadsDirty = (): boolean => {
  try {
    return localStorage.getItem(WORKLOADS_DIRTY_KEY) === 'true';
  } catch {
    return false;
  }
};

export const markLeavesDirty = (): void => {
  try {
    localStorage.setItem(LEAVES_DIRTY_KEY, 'true');
  } catch {
    // ignore
  }
};

export const clearLeavesDirty = (): void => {
  try {
    localStorage.removeItem(LEAVES_DIRTY_KEY);
  } catch {
    // ignore
  }
};

export const isLeavesDirty = (): boolean => {
  try {
    return localStorage.getItem(LEAVES_DIRTY_KEY) === 'true';
  } catch {
    return false;
  }
};

export const markOtDirty = (): void => {
  try {
    localStorage.setItem(OT_DIRTY_KEY, 'true');
  } catch {
    // ignore
  }
};

export const clearOtDirty = (): void => {
  try {
    localStorage.removeItem(OT_DIRTY_KEY);
  } catch {
    // ignore
  }
};

export const isOtDirty = (): boolean => {
  try {
    return localStorage.getItem(OT_DIRTY_KEY) === 'true';
  } catch {
    return false;
  }
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

      const rawWorkloads: any[] = parsed.workloads || INITIAL_WORKLOADS;
      const migratedWorkloads = (needsDemoPurge
        ? rawWorkloads.filter((w) => !isDemoWorkloadId(w.id))
        : rawWorkloads
      ).map((w: any) => {
        const adult = Number(w.adultPt) || 0;
        const child = Number(w.childPt) || 0;
        const total = Math.max(Number(w.totalPt) || 0, adult + child);
        return {
          ...w,
          totalPt: total,
          na: w.na !== undefined ? Number(w.na) : Number(w.pca || 0),
        };
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
            ? Number(parsed.settings?.screeningNhppd)
            : 0.1,
        inTimeClinics:
          Array.isArray(parsed.settings?.inTimeClinics) && parsed.settings.inTimeClinics.length > 0
            ? parsed.settings.inTimeClinics
            : INITIAL_SETTINGS.inTimeClinics,
        outTimeClinics:
          Array.isArray(parsed.settings?.outTimeClinics) && parsed.settings.outTimeClinics.length > 0
            ? parsed.settings.outTimeClinics
            : INITIAL_SETTINGS.outTimeClinics,
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
      friendlyMsg = 'สิทธิ์การเชื่อมต่อ Google หมดอายุ กรุณากด Sign in with Google ใหม่อีกครั้ง';
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
        range: 'Daily_Workload!A1:O1',
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
        range: 'Settings!A1:B12',
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

function workloadKey(w: DailyWorkload): string {
  return [
    (w.date || '').trim(),
    (w.shift || '').trim(),
    (w.clinic || '').trim(),
    getEffectiveTotalPt(w),
    (w.reporter || '').trim(),
  ].join('|');
}

function leaveKey(l: LeaveRecord): string {
  return [
    (l.startDate || '').trim(),
    (l.endDate || '').trim(),
    (l.staffName || '').trim(),
    (l.leaveType || '').trim(),
  ].join('|');
}

function otKey(o: OTAttendance): string {
  return [
    (o.date || '').trim(),
    (o.shift || '').trim(),
    (o.staffName || '').trim(),
    (o.workClinic || '').trim(),
  ].join('|');
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
    )}&ranges=${encodeURIComponent('Daily_Workload!A:O')}&ranges=${encodeURIComponent(
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
      return {
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
      };
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
      mergedWorkloadsMap.set(k, { ...w, totalPt: getEffectiveTotalPt(w) });
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
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Daily_Workload!A:O:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    writeData.push({
      range: 'Daily_Workload!A1:O',
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
        ]),
      ],
    });
  } else if (workloadRawRows.length === 0) {
    writeData.push({
      range: 'Daily_Workload!A1:O1',
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
    range: 'Settings!A1:B14',
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
  entry: DailyWorkload
): Promise<boolean> => {
  try {
    const row = [
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
    ];

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Daily_Workload!A1:append?valueInputOption=USER_ENTERED`,
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

  const sheetWorkloads: DailyWorkload[] = params.workloadRows
    .filter((r) => (r[0] || '').trim() && (r[2] || '').trim())
    .map((r, idx) => {
      const adultPt = Number(r[4] || 0);
      const childPt = Number(r[5] || 0);
      const totalPt = Math.max(Number(r[3] || 0), adultPt + childPt);
      return {
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
      };
    });

  const mergedWorkloadsMap = new Map<string, DailyWorkload>();
  [...db.workloads, ...sheetWorkloads].forEach((w) => {
    const k = workloadKey(w);
    if (!mergedWorkloadsMap.has(k)) {
      mergedWorkloadsMap.set(k, { ...w, totalPt: getEffectiveTotalPt(w) });
    }
  });
  const mergedWorkloads = Array.from(mergedWorkloadsMap.values()).sort((a, b) =>
    b.date.localeCompare(a.date)
  );

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
    });

  const mergedLeavesMap = new Map<string, LeaveRecord>();
  [...db.leaves, ...sheetLeaves].forEach((l) => {
    const k = leaveKey(l);
    if (!mergedLeavesMap.has(k)) mergedLeavesMap.set(k, l);
  });
  const mergedLeaves = Array.from(mergedLeavesMap.values()).sort((a, b) =>
    b.startDate.localeCompare(a.startDate)
  );

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
    });

  const mergedOtMap = new Map<string, OTAttendance>();
  [...db.ot, ...sheetOt].forEach((o) => {
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
    nhppd: Number(settingsMap['NHPPD']) || db.settings.nhppd || 0.4,
    screeningNhppd: Number(settingsMap['Screening_NHPPD']) || db.settings.screeningNhppd || 0.1,
    stdHr: Number(settingsMap['Std_Hr']) || db.settings.stdHr || 7,
    annualHr: Number(settingsMap['Annual_Hr']) || db.settings.annualHr || 2080,
    workDays: Number(settingsMap['Work_Days']) || db.settings.workDays || 245,
    inTimeClinics: settingsMap['In_Time_Clinics']
      ? settingsMap['In_Time_Clinics'].split(',').map((s) => s.trim()).filter(Boolean)
      : db.settings.inTimeClinics,
    outTimeClinics: settingsMap['Out_Time_Clinics']
      ? settingsMap['Out_Time_Clinics'].split(',').map((s) => s.trim()).filter(Boolean)
      : db.settings.outTimeClinics,
    leaveTypes: settingsMap['Leave_Types']
      ? settingsMap['Leave_Types'].split(',').map((s) => s.trim()).filter(Boolean)
      : db.settings.leaveTypes,
    customHolidays: parsedHolidays || db.settings.customHolidays || [],
    primaryAdminOwner:
      settingsMap['Primary_Admin_Owner'] ||
      db.settings.primaryAdminOwner ||
      DEFAULT_PRIMARY_ADMIN_OWNER,
    additionalAdminPins: parsedPins || normalizeAdditionalAdminPins(db.settings.additionalAdminPins),
    gasUrl: db.settings.gasUrl || settingsMap['Gas_Web_App_URL'] || '',
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
    const res = await fetch(`${gasUrl}${sep}action=readAll`, { method: 'GET' });
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
    return { accessible: true, mergedDb };
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
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data?.success);
  } catch (err) {
    console.error(`Failed to ${action} via Apps Script:`, err);
    return false;
  }
};
