/**
 * PCMC OPD Workload & Productivity Management System
 * โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (PCMC)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { User } from 'firebase/auth';
import confetti from 'canvas-confetti';
import { 
  StaffMember, 
  DailyWorkload, 
  LeaveRecord, 
  OTAttendance, 
  SystemSettings, 
  StaffStatus,
  LeaveType,
  LEAVE_TYPES,
  IN_TIME_CLINICS,
  OUT_TIME_CLINICS
} from './types';
import { 
  loadLocalDatabase, 
  saveLocalDatabase, 
  createGoogleSpreadsheet,
  syncAllWithGoogleSheet,
  syncStaffMasterToSheet,
  markStaffMasterDirty,
  markSettingsDirty,
  appendDailyWorkloadToSheet,
  appendLeaveToSheet,
  appendOTToSheet
} from './services/sheetsService';
import { 
  initAuth, 
  googleSignIn, 
  logout, 
  getAccessToken 
} from './services/firebaseAuth';
import { verifyAdminPin } from './services/adminSecurity';
import { Navbar } from './components/Navbar';
import { DailyWorkloadTab } from './components/DailyWorkloadTab';
import { LeaveAndOTTab } from './components/LeaveAndOTTab';
import { DailyCensusTab } from './components/DailyCensusTab';
import { ProductivityTab } from './components/ProductivityTab';
import { AdminPanelTab } from './components/AdminPanelTab';
import { 
  ClipboardPen, 
  CalendarClock, 
  FileText, 
  Calculator, 
  UsersRound, 
  CheckCircle2, 
  AlertCircle,
  X
} from 'lucide-react';

export default function App() {
  // App Database State (pre-loaded from local storage or hospital defaults)
  const [db, setDb] = useState(() => loadLocalDatabase());
  const [activeTab, setActiveTab] = useState<'workload' | 'leave_ot' | 'census' | 'productivity' | 'admin'>('workload');

  // Auth & Sync state
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [isSettingUpSheet, setIsSettingUpSheet] = useState<boolean>(false);
  const [isSyncingSheet, setIsSyncingSheet] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [localRevision, setLocalRevision] = useState<number>(0);

  const dbRef = useRef(db);
  dbRef.current = db;
  const isSyncInFlightRef = useRef<boolean>(false);
  const lastSyncEpochRef = useRef<number>(0);
  const lastSyncedSheetIdRef = useRef<string>('');

  // Toast State
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Auto-save local database whenever db changes
  useEffect(() => {
    saveLocalDatabase(db);
  }, [db]);

  // Clear any legacy admin unlock state on load and handle ?sheetId= from shared URL
  useEffect(() => {
    try {
      sessionStorage.removeItem('pcmc_admin_pin_unlocked');
      localStorage.removeItem('pcmc_admin_pin_unlocked');
      const params = new URLSearchParams(window.location.search);
      const sharedSheetParam = params.get('sheetId')?.trim();
      if (sharedSheetParam) {
        setIsAdminUnlocked(false);
        const idMatch = sharedSheetParam.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        const extractedId = idMatch ? idMatch[1] : sharedSheetParam;
        if (extractedId && extractedId !== db.settings.spreadsheetId) {
          setDb(prev => ({
            ...prev,
            settings: {
              ...prev.settings,
              spreadsheetId: extractedId,
              spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${extractedId}/edit`,
            },
          }));
          setToastMessage({
            text: `เชื่อมโยงลิงก์ Google Sheets จากทีม OPD เรียบร้อยแล้ว (${extractedId.slice(0, 12)}...)`,
            type: 'info',
          });
        }
      }
    } catch {
      // Safe fallback
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize Firebase Auth listener (persists user across reloads)
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser) => {
        setUser(currentUser);
      },
      () => {
        setUser(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Show toast notification
  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    if (type === 'success') {
      try {
        confetti({
          particleCount: 40,
          spread: 60,
          origin: { y: 0.85 },
          colors: ['#059669', '#0d9488', '#0891b2', '#3b82f6']
        });
      } catch {
        // Safe fallback
      }
    }
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Google Sign-In Handler
  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        showToast(`ยินดีต้อนรับ ${res.user.displayName || res.user.email}!`, 'success');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      showToast(`เข้าสู่ระบบไม่สำเร็จ: ${err.message || err}`, 'error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Logout Handler (Google Sign-Out also locks Admin mode)
  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      setIsAdminUnlocked(false);
      sessionStorage.removeItem('pcmc_admin_pin_unlocked');
      showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Admin PIN Unlock State (NEVER persisted across page reloads or shared links)
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(false);

  const handleUnlockAdmin = (pin: string) => {
    if (verifyAdminPin(pin, db.settings.adminPin)) {
      setIsAdminUnlocked(true);
      showToast('ปลดล็อกสิทธิ์ผู้ดูแลระบบ (Admin) สำเร็จ!', 'success');
      return true;
    }
    return false;
  };

  const handleLockAdmin = () => {
    setIsAdminUnlocked(false);
    sessionStorage.removeItem('pcmc_admin_pin_unlocked');
    showToast('ออกจากระบบ Admin (ล็อกสิทธิ์) เรียบร้อยแล้ว', 'info');
  };

  // Admin access strictly requires entering the Admin PIN in the current session (never bypassed by Google Sign-In)
  const isAdmin = isAdminUnlocked;

  // Dynamic clinic lists managed by Admin (with fallback defaults)
  const inTimeClinics = db.settings.inTimeClinics && db.settings.inTimeClinics.length > 0
    ? db.settings.inTimeClinics
    : [...IN_TIME_CLINICS];
  const outTimeClinics = db.settings.outTimeClinics && db.settings.outTimeClinics.length > 0
    ? db.settings.outTimeClinics
    : [...OUT_TIME_CLINICS];
  const leaveTypes = db.settings.leaveTypes && db.settings.leaveTypes.length > 0
    ? db.settings.leaveTypes
    : [...LEAVE_TYPES];

  // Ensure we have a valid Google OAuth token (triggers Google Sign-In cleanly if missing/expired)
  const ensureGoogleToken = async (): Promise<string | null> => {
    let token = await getAccessToken();
    if (!token) {
      try {
        const loginRes = await googleSignIn();
        if (!loginRes) return null;
        token = loginRes.accessToken;
        setUser(loginRes.user);
      } catch (err: any) {
        showToast(`เข้าสู่ระบบไม่สำเร็จ: ${err?.message || err}`, 'error');
        return null;
      }
    }
    return token;
  };

  const formatSyncTime = () =>
    new Date().toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  // Silent background 2-way Auto-Sync (never forces login popup)
  const performBackgroundSync = useCallback(async (_reason: 'initial' | 'interval' | 'focus' | 'edit') => {
    if (isSyncInFlightRef.current) return;
    const currentDb = dbRef.current;
    const targetSheetId = (currentDb.settings.spreadsheetId || '').trim();
    if (!targetSheetId || currentDb.settings.autoSync === false) return;

    const token = await getAccessToken();
    if (!token) return;

    isSyncInFlightRef.current = true;
    setIsSyncingSheet(true);
    try {
      const result = await syncAllWithGoogleSheet(token, targetSheetId, currentDb);
      setDb({
        ...result.mergedDb,
        settings: {
          ...result.mergedDb.settings,
          spreadsheetId: targetSheetId,
          spreadsheetUrl:
            result.mergedDb.settings.spreadsheetUrl ||
            `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
        },
      });
      lastSyncEpochRef.current = Date.now();
      lastSyncedSheetIdRef.current = targetSheetId;
      setLastSyncedAt(formatSyncTime());
    } catch (err) {
      console.warn('Auto-sync skipped:', err);
    } finally {
      isSyncInFlightRef.current = false;
      setIsSyncingSheet(false);
    }
  }, []);

  // Auto-Sync: initial load / when user or spreadsheetId changes
  useEffect(() => {
    const sheetId = (db.settings.spreadsheetId || '').trim();
    if (!sheetId || db.settings.autoSync === false) return;
    if (lastSyncedSheetIdRef.current !== sheetId || user) {
      const timer = setTimeout(() => {
        performBackgroundSync('initial');
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [user, db.settings.spreadsheetId, db.settings.autoSync, performBackgroundSync]);

  // Auto-Sync: periodic every 3 minutes + on window focus/visibility
  useEffect(() => {
    const sheetId = (db.settings.spreadsheetId || '').trim();
    if (!sheetId || db.settings.autoSync === false) return;

    const intervalId = window.setInterval(() => {
      performBackgroundSync('interval');
    }, 3 * 60 * 1000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSyncEpochRef.current > 60 * 1000) {
        performBackgroundSync('focus');
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [db.settings.spreadsheetId, db.settings.autoSync, performBackgroundSync]);

  // Auto-Sync: debounced sync after local edits (workloads, leaves, OT, staff, settings)
  useEffect(() => {
    if (localRevision === 0) return;
    const sheetId = (dbRef.current.settings.spreadsheetId || '').trim();
    if (!sheetId || dbRef.current.settings.autoSync === false) return;

    const timer = window.setTimeout(() => {
      performBackgroundSync('edit');
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [localRevision, performBackgroundSync]);

  // Manual Sync 2-way with an existing linked Google Spreadsheet (never creates duplicates)
  const handleSyncSpreadsheet = async (overrideSheetId?: string) => {
    const currentDb = dbRef.current;
    const targetSheetId = (overrideSheetId || currentDb.settings.spreadsheetId || '').trim();
    if (!targetSheetId) {
      showToast('ยังไม่มีลิงก์/ID Google Sheets กรุณาวางลิงก์ชีทหรือกดสร้าง 5 ชีทใหม่ก่อน', 'error');
      return;
    }

    if (isSyncInFlightRef.current) return;

    const token = await ensureGoogleToken();
    if (!token) return;

    isSyncInFlightRef.current = true;
    setIsSyncingSheet(true);
    try {
      const result = await syncAllWithGoogleSheet(token, targetSheetId, dbRef.current);
      setDb({
        ...result.mergedDb,
        settings: {
          ...result.mergedDb.settings,
          spreadsheetId: targetSheetId,
          spreadsheetUrl:
            result.mergedDb.settings.spreadsheetUrl ||
            `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
        },
      });
      lastSyncEpochRef.current = Date.now();
      lastSyncedSheetIdRef.current = targetSheetId;
      setLastSyncedAt(formatSyncTime());
      showToast(
        `ซิงค์ Google Sheet สำเร็จ! (บุคลากร ${result.staffCount} คน, ส่งขึ้น ${result.pushedWorkloads} / ดึงเข้า ${result.pulledWorkloads} รายการ)`,
        'success'
      );
    } catch (err: any) {
      console.error('Sync spreadsheet error:', err);
      showToast(`ซิงค์ข้อมูลไม่สำเร็จ: ${err?.message || err}`, 'error');
    } finally {
      isSyncInFlightRef.current = false;
      setIsSyncingSheet(false);
    }
  };

  // Setup Google Spreadsheet (Creates 5 sheets ONLY when no Sheet link/ID is configured yet)
  const handleSetupSpreadsheet = async () => {
    if (db.settings.spreadsheetId) {
      await handleSyncSpreadsheet(db.settings.spreadsheetId);
      return;
    }

    const token = await ensureGoogleToken();
    if (!token) return;

    setIsSettingUpSheet(true);
    try {
      const { spreadsheetId, spreadsheetUrl } = await createGoogleSpreadsheet(
        token,
        db.staff,
        db.settings
      );

      setDb(prev => ({
        ...prev,
        settings: {
          ...prev.settings,
          spreadsheetId,
          spreadsheetUrl,
        }
      }));

      showToast('สร้างฐานข้อมูล Google Sheets 5 ชีทเรียบร้อยแล้ว!', 'success');
    } catch (err: any) {
      console.error('Setup spreadsheet error:', err);
      showToast(`เกิดข้อผิดพลาดในการสร้างชีท: ${err.message || err}`, 'error');
    } finally {
      setIsSettingUpSheet(false);
    }
  };

  // Copy shareable OPD link (includes ?sheetId=... if linked)
  const handleCopyShareLink = async () => {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const shareUrl = db.settings.spreadsheetId
      ? `${baseUrl}?sheetId=${encodeURIComponent(db.settings.spreadsheetId)}`
      : baseUrl;

    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast(
        db.settings.spreadsheetId
          ? 'คัดลอกลิงก์พร้อมรหัส Google Sheet สำหรับส่งให้บุคลากร OPD แล้ว!'
          : 'คัดลอกลิงก์หน้าเว็บสำหรับแชร์ให้บุคลากร OPD แล้ว!',
        'success'
      );
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = shareUrl;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('คัดลอกลิงก์สำหรับแชร์ให้บุคลากร OPD เรียบร้อยแล้ว!', 'success');
    }
  };

  // Handler: Save Daily Workload
  const handleSaveWorkload = async (
    entry: DailyWorkload,
    leaveData?: { staffName: string; leaveType: LeaveType; note: string }[] | null,
    crossCoverageData?: { staffName: string; targetClinic: string } | null,
    trainingData?: { staffName: string; topic: string; note: string }[] | null
  ) => {
    const newLeaveEntries: LeaveRecord[] = [];
    const newOtEntries: OTAttendance[] = [];

    if (leaveData) {
      leaveData.forEach((ld, idx) => {
        const staff = db.staff.find(s => s.name === ld.staffName);
        newLeaveEntries.push({
          id: `LV-AUTO-${Date.now()}-${idx}-${ld.staffName}`,
          startDate: entry.date,
          endDate: entry.date,
          staffName: ld.staffName,
          position: staff ? staff.position : 'RN',
          clinic: staff ? staff.homeClinic : entry.clinic,
          leaveType: ld.leaveType,
          days: 1,
          note: ld.note,
        });
      });
    }

    if (trainingData) {
      trainingData.forEach((td, idx) => {
        const staff = db.staff.find(s => s.name === td.staffName);
        newLeaveEntries.push({
          id: `TRN-AUTO-${Date.now()}-${idx}-${td.staffName}`,
          startDate: entry.date,
          endDate: entry.date,
          staffName: td.staffName,
          position: staff ? staff.position : 'RN',
          clinic: staff ? staff.homeClinic : entry.clinic,
          leaveType: 'ไปอบรม/ประชุม',
          days: 1,
          note: [td.topic, td.note].filter(Boolean).join(' — ') || `ไปอบรม/ประชุม (บันทึกจาก ${entry.clinic})`,
        });
      });
    }

    if (crossCoverageData) {
      const staff = db.staff.find(s => s.name === crossCoverageData.staffName);
      newOtEntries.push({
        id: `OT-CROSS-${Date.now()}`,
        date: entry.date,
        shift: entry.shift,
        staffName: crossCoverageData.staffName,
        position: staff ? staff.position : 'RN',
        homeClinic: staff ? staff.homeClinic : entry.clinic,
        workClinic: crossCoverageData.targetClinic,
      });
    }

    setDb(prev => ({
      ...prev,
      workloads: [entry, ...prev.workloads],
      leaves: [...newLeaveEntries, ...prev.leaves],
      ot: [...newOtEntries, ...prev.ot],
    }));

    showToast(`บันทึกภาระงานห้องตรวจ ${entry.clinic} สำเร็จ!`, 'success');

    // Async sync to Google Sheets if connected
    const token = await getAccessToken();
    if (token && db.settings.spreadsheetId) {
      await appendDailyWorkloadToSheet(token, db.settings.spreadsheetId, entry);
      for (const l of newLeaveEntries) {
        await appendLeaveToSheet(token, db.settings.spreadsheetId, l);
      }
      for (const o of newOtEntries) {
        await appendOTToSheet(token, db.settings.spreadsheetId, o);
      }
      lastSyncEpochRef.current = Date.now();
      setLastSyncedAt(formatSyncTime());
    }
  };

  // Handler: Update Daily Workload (Admin)
  const handleUpdateWorkload = (updated: DailyWorkload) => {
    setDb(prev => ({
      ...prev,
      workloads: prev.workloads.map(w => w.id === updated.id ? updated : w),
    }));
    setLocalRevision(r => r + 1);
    showToast(`อัปเดตข้อมูลภาระงานห้องตรวจ ${updated.clinic} สำเร็จ!`, 'success');
  };

  // Handler: Delete Daily Workload
  const handleDeleteWorkload = (id: string) => {
    if (window.confirm('ยืนยันที่จะลบรายการบันทึกภาระงานนี้หรือไม่?')) {
      setDb(prev => ({
        ...prev,
        workloads: prev.workloads.filter(w => w.id !== id),
      }));
      setLocalRevision(r => r + 1);
      showToast('ลบรายการเรียบร้อยแล้ว', 'info');
    }
  };

  // Handler: Save Leave
  const handleSaveLeave = async (leave: LeaveRecord) => {
    setDb(prev => ({
      ...prev,
      leaves: [leave, ...prev.leaves],
    }));
    showToast(`บันทึกวันลา ${leave.staffName} สำเร็จ!`, 'success');

    const token = await getAccessToken();
    if (token && db.settings.spreadsheetId) {
      await appendLeaveToSheet(token, db.settings.spreadsheetId, leave);
      lastSyncEpochRef.current = Date.now();
      setLastSyncedAt(formatSyncTime());
    }
  };

  // Handler: Update Leave (Admin)
  const handleUpdateLeave = (updated: LeaveRecord) => {
    setDb(prev => ({
      ...prev,
      leaves: prev.leaves.map(l => l.id === updated.id ? updated : l),
    }));
    setLocalRevision(r => r + 1);
    showToast(`อัปเดตประวัติการลา ${updated.staffName} เรียบร้อยแล้ว`, 'success');
  };

  // Handler: Delete Leave
  const handleDeleteLeave = (id: string) => {
    if (window.confirm('ยืนยันที่จะลบประวัติการลานี้หรือไม่?')) {
      setDb(prev => ({
        ...prev,
        leaves: prev.leaves.filter(l => l.id !== id),
      }));
      setLocalRevision(r => r + 1);
      showToast('ลบประวัติการลาเรียบร้อยแล้ว', 'info');
    }
  };

  // Handler: Save Batch OT
  const handleSaveBatchOT = async (records: OTAttendance[]) => {
    setDb(prev => ({
      ...prev,
      ot: [...records, ...prev.ot],
    }));
    showToast(`บันทึกเวรนอกเวลาจำนวน ${records.length} คน เรียบร้อยแล้ว!`, 'success');

    const token = await getAccessToken();
    if (token && db.settings.spreadsheetId) {
      for (const r of records) {
        await appendOTToSheet(token, db.settings.spreadsheetId, r);
      }
      lastSyncEpochRef.current = Date.now();
      setLastSyncedAt(formatSyncTime());
    }
  };

  // Handler: Update OT (Admin)
  const handleUpdateOT = (updated: OTAttendance) => {
    setDb(prev => ({
      ...prev,
      ot: prev.ot.map(o => o.id === updated.id ? updated : o),
    }));
    setLocalRevision(r => r + 1);
    showToast(`อัปเดตเวรนอกเวลา ${updated.staffName} เรียบร้อยแล้ว`, 'success');
  };

  // Handler: Delete OT
  const handleDeleteOT = (id: string) => {
    setDb(prev => ({
      ...prev,
      ot: prev.ot.filter(o => o.id !== id),
    }));
    setLocalRevision(r => r + 1);
    showToast('ลบรายการเวรนอกเวลาแล้ว', 'info');
  };

  // Handler: Add Staff Member
  const handleAddStaff = async (staff: StaffMember) => {
    const nextStaff = [...db.staff, staff];
    markStaffMasterDirty();
    setDb(prev => ({
      ...prev,
      staff: nextStaff,
    }));
    showToast(`เพิ่มเจ้าหน้าที่ ${staff.name} เข้าสู่ระบบแล้ว`, 'success');

    const token = await getAccessToken();
    if (token && db.settings.spreadsheetId) {
      await syncStaffMasterToSheet(token, db.settings.spreadsheetId, nextStaff);
      lastSyncEpochRef.current = Date.now();
      setLastSyncedAt(formatSyncTime());
    }
  };

  // Handler: Delete Staff Member
  const handleDeleteStaff = async (staffId: string) => {
    const target = db.staff.find(s => s.staffId === staffId);
    const nextStaff = db.staff.filter(s => s.staffId !== staffId);
    markStaffMasterDirty();
    setDb(prev => ({
      ...prev,
      staff: nextStaff,
    }));
    showToast(`ลบบุคลากร ${target?.name || ''} ออกจากระบบแล้ว`, 'info');

    const token = await getAccessToken();
    if (token && db.settings.spreadsheetId) {
      await syncStaffMasterToSheet(token, db.settings.spreadsheetId, nextStaff);
      lastSyncEpochRef.current = Date.now();
      setLastSyncedAt(formatSyncTime());
    }
  };

  // Handler: Update Staff Member (Admin)
  const handleUpdateStaff = async (updatedStaff: StaffMember) => {
    const nextStaff = db.staff.map(s => s.staffId === updatedStaff.staffId ? updatedStaff : s);
    markStaffMasterDirty();
    setDb(prev => ({
      ...prev,
      staff: nextStaff,
    }));
    showToast(`อัปเดตข้อมูลบุคลากร ${updatedStaff.name} เรียบร้อยแล้ว`, 'success');

    const token = await getAccessToken();
    if (token && db.settings.spreadsheetId) {
      await syncStaffMasterToSheet(token, db.settings.spreadsheetId, nextStaff);
      lastSyncEpochRef.current = Date.now();
      setLastSyncedAt(formatSyncTime());
    }
  };

  // Handler: Update Staff Status (Active / Resigned / Retired)
  const handleUpdateStaffStatus = async (staffId: string, status: StaffStatus) => {
    const todayStr = new Date().toISOString().split('T')[0];
    const nextStaff = db.staff.map(s => {
      if (s.staffId !== staffId) return s;
      if (status === 'Resigned' || status === 'Retired') {
        return { ...s, status, endDate: s.endDate || todayStr };
      }
      return { ...s, status, endDate: undefined };
    });
    markStaffMasterDirty();
    setDb(prev => ({
      ...prev,
      staff: nextStaff,
    }));
    showToast(`อัปเดตสถานะเป็น ${status} สำเร็จ`, 'info');

    const token = await getAccessToken();
    if (token && db.settings.spreadsheetId) {
      await syncStaffMasterToSheet(token, db.settings.spreadsheetId, nextStaff);
      lastSyncEpochRef.current = Date.now();
      setLastSyncedAt(formatSyncTime());
    }
  };

  // Handler: Save Settings
  const handleSaveSettings = (settings: SystemSettings) => {
    markSettingsDirty();
    setDb(prev => ({
      ...prev,
      settings,
    }));
    setLocalRevision(r => r + 1);
    showToast('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
  };

  // Handler: Toggle Auto Sync
  const handleToggleAutoSync = (enabled: boolean) => {
    markSettingsDirty();
    setDb(prev => ({
      ...prev,
      settings: {
        ...prev.settings,
        autoSync: enabled,
      },
    }));
    showToast(enabled ? 'เปิดใช้งาน Auto ซิงค์อัตโนมัติแล้ว' : 'ปิดโหมด Auto ซิงค์ชั่วคราว (สามารถกดปุ่มซิงค์เองได้)', 'info');
  };

  // Handler: Reset to clean empty production data
  const handleResetData = () => {
    localStorage.removeItem('pcmc_opd_system_db_v1');
    markStaffMasterDirty();
    setDb(loadLocalDatabase());
    showToast('ล้างข้อมูลทั้งหมดเรียบร้อยแล้ว พร้อมเริ่มต้นใช้งานจริง', 'info');
  };

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-800 flex flex-col font-sans">
      {/* Top Navbar */}
      <Navbar
        isAdmin={isAdmin}
        onLockAdmin={handleLockAdmin}
        hasSpreadsheet={Boolean(db.settings.spreadsheetId)}
        isSyncingSheet={isSyncingSheet}
        autoSyncEnabled={db.settings.autoSync !== false}
        lastSyncedAt={lastSyncedAt}
        onManualSync={() => handleSyncSpreadsheet()}
      />

      {/* Floating Toast Message */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce">
          <div className={`px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-2.5 text-xs font-semibold ${
            toastMessage.type === 'success' 
              ? 'bg-emerald-900 text-white border-emerald-700' 
              : toastMessage.type === 'error'
              ? 'bg-red-900 text-white border-red-700'
              : 'bg-slate-900 text-white border-slate-700'
          }`}>
            {toastMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            )}
            <span>{toastMessage.text}</span>
            <button 
              onClick={() => setToastMessage(null)}
              className="ml-2 hover:opacity-75 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex-1 w-full space-y-5">
        {/* 5 Main Tabs Navigation Bar */}
        <div className="no-print bg-white p-1.5 rounded-2xl shadow-xs border border-gray-200/90 flex flex-wrap gap-1">
          <button
            onClick={() => setActiveTab('workload')}
            className={`flex-1 min-w-[170px] py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'workload'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-emerald-800 hover:bg-emerald-50/50'
            }`}
          >
            <ClipboardPen className="w-4 h-4" />
            <span>1. บันทึกภาระงานประจำวัน</span>
          </button>

          <button
            onClick={() => setActiveTab('leave_ot')}
            className={`flex-1 min-w-[170px] py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'leave_ot'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-teal-800 hover:bg-teal-50/50'
            }`}
          >
            <CalendarClock className="w-4 h-4" />
            <span>2. บันทึกเวรนอกเวลา & วันลา</span>
          </button>

          <button
            onClick={() => setActiveTab('census')}
            className={`flex-1 min-w-[170px] py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'census'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-blue-800 hover:bg-blue-50/50'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>3. รายงานผู้ป่วยประจำวัน</span>
          </button>

          <button
            onClick={() => setActiveTab('productivity')}
            className={`flex-1 min-w-[170px] py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'productivity'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-amber-800 hover:bg-amber-50/50'
            }`}
          >
            <Calculator className="w-4 h-4" />
            <span>4. สรุป Productivity & FTC</span>
          </button>

          <button
            onClick={() => setActiveTab('admin')}
            className={`flex-1 min-w-[170px] py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'admin'
                ? 'bg-red-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-red-800 hover:bg-red-50/50'
            }`}
          >
            <UsersRound className="w-4 h-4" />
            <span>5. จัดการบุคลากร & ตั้งค่า</span>
          </button>
        </div>

        {/* Tab 1: Daily Workload Entry */}
        {activeTab === 'workload' && (
          <DailyWorkloadTab
            workloads={db.workloads}
            staffList={db.staff}
            inTimeClinics={inTimeClinics}
            outTimeClinics={outTimeClinics}
            leaveTypes={leaveTypes}
            onSaveWorkload={handleSaveWorkload}
            onUpdateWorkload={handleUpdateWorkload}
            onDeleteWorkload={handleDeleteWorkload}
            defaultReporter=""
            isAdmin={isAdmin}
            onPromptAdminUnlock={() => setActiveTab('admin')}
          />
        )}

        {/* Tab 2: Leave & OT Tracker */}
        {activeTab === 'leave_ot' && (
          <LeaveAndOTTab
            staffList={db.staff}
            leaves={db.leaves}
            otRecords={db.ot}
            workloads={db.workloads}
            inTimeClinics={inTimeClinics}
            outTimeClinics={outTimeClinics}
            leaveTypes={leaveTypes}
            customHolidays={db.settings.customHolidays || []}
            isAdmin={isAdmin}
            onSaveLeave={handleSaveLeave}
            onSaveBatchOT={handleSaveBatchOT}
            onUpdateLeave={handleUpdateLeave}
            onDeleteLeave={handleDeleteLeave}
            onUpdateOT={handleUpdateOT}
            onDeleteOT={handleDeleteOT}
          />
        )}

        {/* Tab 3: Daily OPD Census Report */}
        {activeTab === 'census' && (
          <DailyCensusTab
            workloads={db.workloads}
            isAdmin={isAdmin}
            onUpdateWorkload={handleUpdateWorkload}
            onDeleteWorkload={handleDeleteWorkload}
          />
        )}

        {/* Tab 4: Monthly Productivity & Skill Mix */}
        {activeTab === 'productivity' && (
          <ProductivityTab
            workloads={db.workloads}
            settings={db.settings}
            inTimeClinics={inTimeClinics}
            outTimeClinics={outTimeClinics}
          />
        )}

        {/* Tab 5: Admin Panel & Staff Master */}
        {activeTab === 'admin' && (
          <AdminPanelTab
            staffList={db.staff}
            settings={db.settings}
            inTimeClinics={inTimeClinics}
            outTimeClinics={outTimeClinics}
            leaveTypes={leaveTypes}
            isAdmin={isAdmin}
            isAdminUnlocked={isAdminUnlocked}
            user={user}
            onLogin={handleLogin}
            onLogout={handleLogout}
            isLoggingIn={isLoggingIn}
            onAddStaff={handleAddStaff}
            onUpdateStaff={handleUpdateStaff}
            onDeleteStaff={handleDeleteStaff}
            onUpdateStaffStatus={handleUpdateStaffStatus}
            onSaveSettings={handleSaveSettings}
            onResetData={handleResetData}
            onSetupSpreadsheet={handleSetupSpreadsheet}
            onSyncSpreadsheet={() => handleSyncSpreadsheet()}
            isSettingUpSheet={isSettingUpSheet}
            isSyncingSheet={isSyncingSheet}
            onCopyShareLink={handleCopyShareLink}
            onUnlockAdmin={handleUnlockAdmin}
            onLockAdmin={handleLockAdmin}
            lastSyncedAt={lastSyncedAt}
            onToggleAutoSync={handleToggleAutoSync}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="no-print bg-white border-t border-gray-200 mt-12 py-5 text-center text-xs text-gray-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            © 2026 โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (PCMC) • กลุ่มงานการพยาบาลผู้ป่วยนอก
          </div>
          <div className="text-[11px] text-gray-400">
            ระบบบริหารจัดการภาระงานและ Productivity OPD • เชื่อมต่อ Google Sheets
          </div>
        </div>
      </footer>
    </div>
  );
}
