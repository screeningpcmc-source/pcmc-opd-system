import { 
  StaffMember, 
  StaffPosition,
  DailyWorkload, 
  LeaveRecord, 
  OTAttendance, 
  SystemSettings 
} from '../types';
import { 
  INITIAL_STAFF_LIST, 
  INITIAL_WORKLOADS, 
  INITIAL_LEAVES, 
  INITIAL_OT, 
  INITIAL_SETTINGS 
} from '../data/mockStaff';

export interface AppDatabase {
  staff: StaffMember[];
  workloads: DailyWorkload[];
  leaves: LeaveRecord[];
  ot: OTAttendance[];
  settings: SystemSettings;
}

const STORAGE_KEY = 'pcmc_opd_system_db_v1';

export const loadLocalDatabase = (): AppDatabase => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Migrate legacy PCA to NA
      const migratedStaff = (parsed.staff || INITIAL_STAFF_LIST).map((s: StaffMember) => ({
        ...s,
        position: (s.position === 'PCA' ? 'NA' : s.position) as StaffPosition,
      }));

      const migratedWorkloads = (parsed.workloads || INITIAL_WORKLOADS).map((w: any) => {
        const adult = Number(w.adultPt) || 0;
        const child = Number(w.childPt) || 0;
        const total = Math.max(Number(w.totalPt) || 0, adult + child);
        return {
          ...w,
          totalPt: total,
          na: w.na !== undefined ? Number(w.na) : Number(w.pca || 0),
        };
      });

      const migratedLeaves = (parsed.leaves || INITIAL_LEAVES).map((l: any) => ({
        ...l,
        position: (l.position === 'PCA' ? 'NA' : l.position) as StaffPosition,
      }));

      const migratedOt = (parsed.ot || INITIAL_OT).map((o: any) => ({
        ...o,
        position: (o.position === 'PCA' ? 'NA' : o.position) as StaffPosition,
      }));

      const mergedSettings: SystemSettings = {
        ...INITIAL_SETTINGS,
        ...(parsed.settings || {}),
        inTimeClinics: Array.isArray(parsed.settings?.inTimeClinics) && parsed.settings.inTimeClinics.length > 0
          ? parsed.settings.inTimeClinics
          : INITIAL_SETTINGS.inTimeClinics,
        outTimeClinics: Array.isArray(parsed.settings?.outTimeClinics) && parsed.settings.outTimeClinics.length > 0
          ? parsed.settings.outTimeClinics
          : INITIAL_SETTINGS.outTimeClinics,
      };

      return {
        staff: migratedStaff,
        workloads: migratedWorkloads,
        leaves: migratedLeaves,
        ot: migratedOt,
        settings: mergedSettings,
      };
    }
  } catch (err) {
    console.error('Error loading local DB:', err);
  }

  return {
    staff: INITIAL_STAFF_LIST,
    workloads: INITIAL_WORKLOADS,
    leaves: INITIAL_LEAVES,
    ot: INITIAL_OT,
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

/**
 * Creates Google Spreadsheet with the exact 5 sheets requested:
 * 1. Staff_Master
 * 2. Daily_Workload
 * 3. Leave_Records
 * 4. OT_Attendance
 * 5. Settings
 */
export const createGoogleSpreadsheet = async (
  accessToken: string,
  staffList: StaffMember[],
  settings: SystemSettings
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> => {
  // Step 1: Create spreadsheet with sheets
  const requestBody = {
    properties: {
      title: 'PCMC_OPD_Database_โรงพยาบาลชลประทาน',
      timeZone: 'Asia/Bangkok',
    },
    sheets: [
      { properties: { title: 'Staff_Master', gridProperties: { frozenRowCount: 1 } } },
      { properties: { title: 'Daily_Workload', gridProperties: { frozenRowCount: 1 } } },
      { properties: { title: 'Leave_Records', gridProperties: { frozenRowCount: 1 } } },
      { properties: { title: 'OT_Attendance', gridProperties: { frozenRowCount: 1 } } },
      { properties: { title: 'Settings', gridProperties: { frozenRowCount: 1 } } },
    ],
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
    throw new Error(`สร้าง Google Sheets ไม่สำเร็จ: ${errorText}`);
  }

  const createdData = await createRes.json();
  const spreadsheetId = createdData.spreadsheetId;
  const spreadsheetUrl = createdData.spreadsheetUrl;

  // Step 2: Initialize headers and seed data
  const staffRows = staffList.map(s => [s.staffId, s.name, s.position, s.homeClinic, s.status]);
  const settingsRows = [
    ['Key', 'Value'],
    ['NHPPD', settings.nhppd.toString()],
    ['Std_Hr', settings.stdHr.toString()],
    ['Annual_Hr', settings.annualHr.toString()],
    ['Work_Days', settings.workDays.toString()],
    ['Admin_Emails', settings.adminEmails.join(', ')],
    ['Admin_Pin', settings.adminPin || '4217'],
    ['In_Time_Clinics', (settings.inTimeClinics || []).join(', ')],
    ['Out_Time_Clinics', (settings.outTimeClinics || []).join(', ')],
  ];

  const batchUpdateValues = {
    valueInputOption: 'USER_ENTERED',
    data: [
      {
        range: 'Staff_Master!A1:E',
        values: [
          ['Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status'],
          ...staffRows
        ],
      },
      {
        range: 'Daily_Workload!A1:O1',
        values: [
          [
            'Date', 'Shift', 'Clinic', 'Total_Pt', 'Adult_Pt', 'Child_Pt', 
            'Admit', 'HN', 'RN', 'PN', 'NA', 'Clerk', 'Service_Worker', 'Note', 'Reporter'
          ]
        ],
      },
      {
        range: 'Leave_Records!A1:H1',
        values: [
          ['Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note']
        ],
      },
      {
        range: 'OT_Attendance!A1:F1',
        values: [
          ['Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic']
        ],
      },
      {
        range: 'Settings!A1:B9',
        values: settingsRows,
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

  return { spreadsheetId, spreadsheetUrl };
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
      entry.totalPt,
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
    const row = [
      ot.date,
      ot.shift,
      ot.staffName,
      ot.position,
      ot.homeClinic,
      ot.workClinic,
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
