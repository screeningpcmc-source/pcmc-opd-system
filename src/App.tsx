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
  AuditLogEntry,
  SystemSettings, 
  StaffStatus,
  LeaveType,
  LEAVE_TYPES,
  IN_TIME_CLINICS,
  OUT_TIME_CLINICS,
  getEffectiveTotalPt
} from './types';
import { 
  loadLocalDatabase, 
  saveLocalDatabase, 
  createGoogleSpreadsheet,
  syncAllWithGoogleSheet,
  syncStaffMasterToSheet,
  markStaffMasterDirty,
  markSettingsDirty,
  markWorkloadsDirty,
  markLeavesDirty,
  markOtDirty,
  appendDailyWorkloadToSheet,
  appendLeaveToSheet,
  appendOTToSheet,
  appendAuditLogToSheet,
  ensureSheetAnyoneReaderPermission,
  readPublicGoogleSheet,
  readViaAppsScript,
  appendViaAppsScript
} from './services/sheetsService';
import { formatThaiLeaveRange, formatThaiShortDate } from './utils/thaiDate';
import { 
  initAuth, 
  googleSignIn, 
  logout, 
  getAccessToken 
} from './services/firebaseAuth';
import { verifyAdminPinWithOwner } from './services/adminSecurity';
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
  RefreshCw,
  LogOut,
  Lock,
  X
} from 'lucide-react';

export default function App() {
  // App Database State (pre-loaded from local storage or hospital defaults)
  const [db, setDb] = useState(() => loadLocalDatabase());
  const [activeTab, setActiveTab] = useState<'workload' | 'leave_ot' | 'census' | 'productivity' | 'admin'>('workload');

  // Auth & Sync state
  const [user, setUser] = useState<User | null>(null);
  const [hasActiveToken, setHasActiveToken] = useState<boolean>(false);
  const [sheetSyncStatus, setSheetSyncStatus] = useState<
    'idle' | 'connected_write' | 'connected_gas' | 'public_readonly' | 'needs_auth'
  >('idle');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [isSettingUpSheet, setIsSettingUpSheet] = useState<boolean>(false);
  const [isSyncingSheet, setIsSyncingSheet] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [localRevision, setLocalRevision] = useState<number>(0);

  const dbRef = useRef(db);
  dbRef.current = db;
  const isSyncInFlightRef = useRef<boolean>(false);
  const lastSyncEpochRef = useRef<number>(0);
  const lastSyncedKeyRef = useRef<string>('');

  // Toast State
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Auto-save local database whenever db changes
  useEffect(() => {
    saveLocalDatabase(db);
  }, [db]);

  // Clear any legacy admin unlock state on load and handle ?sheetId= / ?gasUrl= from shared URL
  useEffect(() => {
    try {
      sessionStorage.removeItem('pcmc_admin_pin_unlocked');
      localStorage.removeItem('pcmc_admin_pin_unlocked');
      const params = new URLSearchParams(window.location.search);
      const sharedSheetParam = params.get('sheetId')?.trim();
      const sharedGasParam = params.get('gasUrl')?.trim();
      if (sharedSheetParam || sharedGasParam) {
        setIsAdminUnlocked(false);
        setAdminOwnerName('');
        const idMatch = sharedSheetParam?.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        const extractedId = sharedSheetParam ? (idMatch ? idMatch[1] : sharedSheetParam) : '';
        const shouldUpdateSheet = Boolean(extractedId && extractedId !== db.settings.spreadsheetId);
        const shouldUpdateGas = Boolean(sharedGasParam && sharedGasParam !== (db.settings.gasUrl || ''));
        if (shouldUpdateSheet || shouldUpdateGas) {
          setDb(prev => ({
            ...prev,
            settings: {
              ...prev.settings,
              spreadsheetId: extractedId || prev.settings.spreadsheetId,
              spreadsheetUrl: extractedId
                ? `https://docs.google.com/spreadsheets/d/${extractedId}/edit`
                : prev.settings.spreadsheetUrl,
              gasUrl: sharedGasParam || prev.settings.gasUrl,
            },
          }));
          setToastMessage({
            text: `เชื่อมโยงฐานข้อมูล OPD อัตโนมัติเรียบร้อยแล้ว${extractedId ? ` (${extractedId.slice(0, 12)}...)` : ''}`,
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
      (currentUser, token) => {
        setUser(currentUser);
        setHasActiveToken(Boolean(token));
      },
      () => {
        setUser(null);
        setHasActiveToken(false);
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
        setHasActiveToken(true);
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
      setHasActiveToken(false);
      setIsAdminUnlocked(false);
      setAdminOwnerName('');
      sessionStorage.removeItem('pcmc_admin_pin_unlocked');
      showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Admin PIN Unlock State (NEVER persisted across page reloads or shared links)
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(false);
  const [adminOwnerName, setAdminOwnerName] = useState<string>('');

  const handleUnlockAdmin = (pin: string) => {
    const match = verifyAdminPinWithOwner(pin, db.settings);
    if (match.valid) {
      setIsAdminUnlocked(true);
      setAdminOwnerName(match.ownerName);
      showToast(`ปลดล็อกสิทธิ์ผู้ดูแลระบบ (${match.ownerName}) สำเร็จ!`, 'success');
      return true;
    }
    return false;
  };

  const handleLockAdmin = () => {
    setIsAdminUnlocked(false);
    setAdminOwnerName('');
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
  const ensureGoogleToken = async (loginHint?: string): Promise<string | null> => {
    let token = await getAccessToken();
    if (!token) {
      try {
        const loginRes = await googleSignIn(loginHint || user?.email || undefined);
        if (!loginRes) return null;
        token = loginRes.accessToken;
        setUser(loginRes.user);
        setHasActiveToken(true);
      } catch (err: any) {
        showToast(`เชื่อมต่อ Google ไม่สำเร็จ: ${err?.message || err}`, 'error');
        return null;
      }
    } else {
      setHasActiveToken(true);
    }
    return token;
  };

  const formatSyncTime = () =>
    new Date().toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  // Silent background Auto-Sync:
  // 1) Full 2-way OAuth sync if Google token is active
  // 2) Apps Script Web App auto-read if gasUrl is configured (0 login)
  // 3) Public GViz read-only sync when ?sheetId= is shared as Anyone with link can view (0 login)
  const performBackgroundSync = useCallback(async (_reason: 'initial' | 'interval' | 'focus' | 'edit') => {
    if (isSyncInFlightRef.current) return;
    const currentDb = dbRef.current;
    const targetSheetId = (currentDb.settings.spreadsheetId || '').trim();
    const targetGasUrl = (currentDb.settings.gasUrl || '').trim();
    if ((!targetSheetId && !targetGasUrl) || currentDb.settings.autoSync === false) return;

    const syncKey = `${targetSheetId}|${targetGasUrl}`;
    const token = await getAccessToken();
    setHasActiveToken(Boolean(token));

    isSyncInFlightRef.current = true;
    setIsSyncingSheet(true);
    try {
      if (token && targetSheetId) {
        const result = await syncAllWithGoogleSheet(token, targetSheetId, currentDb);
        setDb({
          ...result.mergedDb,
          settings: {
            ...result.mergedDb.settings,
            spreadsheetId: targetSheetId,
            spreadsheetUrl:
              result.mergedDb.settings.spreadsheetUrl ||
              `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
            gasUrl: result.mergedDb.settings.gasUrl || targetGasUrl || undefined,
          },
        });
        lastSyncEpochRef.current = Date.now();
        lastSyncedKeyRef.current = syncKey;
        setLastSyncedAt(formatSyncTime());
        setSheetSyncStatus('connected_write');
        return;
      }

      if (targetGasUrl) {
        const gasRes = await readViaAppsScript(targetGasUrl, currentDb);
        if (gasRes.accessible) {
          setDb({
            ...gasRes.mergedDb,
            settings: {
              ...gasRes.mergedDb.settings,
              spreadsheetId: targetSheetId || gasRes.mergedDb.settings.spreadsheetId,
              spreadsheetUrl:
                targetSheetId
                  ? `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`
                  : gasRes.mergedDb.settings.spreadsheetUrl,
              gasUrl: targetGasUrl,
            },
          });
          lastSyncEpochRef.current = Date.now();
          lastSyncedKeyRef.current = syncKey;
          setLastSyncedAt(formatSyncTime());
          setSheetSyncStatus('connected_gas');
          return;
        }
      }

      if (targetSheetId) {
        const pubRes = await readPublicGoogleSheet(targetSheetId, currentDb);
        if (pubRes.accessible) {
          setDb({
            ...pubRes.mergedDb,
            settings: {
              ...pubRes.mergedDb.settings,
              spreadsheetId: targetSheetId,
              spreadsheetUrl:
                pubRes.mergedDb.settings.spreadsheetUrl ||
                `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
              gasUrl: pubRes.mergedDb.settings.gasUrl || targetGasUrl || undefined,
            },
          });
          lastSyncEpochRef.current = Date.now();
          lastSyncedKeyRef.current = syncKey;
          setLastSyncedAt(formatSyncTime());
          setSheetSyncStatus('public_readonly');
        } else {
          lastSyncedKeyRef.current = syncKey;
          setSheetSyncStatus('needs_auth');
        }
      }
    } catch (err) {
      console.warn('Auto-sync skipped:', err);
      if (targetSheetId && !token) {
        setSheetSyncStatus('needs_auth');
      }
    } finally {
      isSyncInFlightRef.current = false;
      setIsSyncingSheet(false);
    }
  }, []);

  // Auto-Sync: initial load / when user or spreadsheetId/gasUrl changes
  useEffect(() => {
    const sheetId = (db.settings.spreadsheetId || '').trim();
    const gasUrl = (db.settings.gasUrl || '').trim();
    const syncKey = `${sheetId}|${gasUrl}`;
    if ((!sheetId && !gasUrl) || db.settings.autoSync === false) return;
    if (lastSyncedKeyRef.current !== syncKey || user) {
      const timer = setTimeout(() => {
        performBackgroundSync('initial');
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [user, db.settings.spreadsheetId, db.settings.gasUrl, db.settings.autoSync, performBackgroundSync]);

  // Auto-Sync: periodic every 3 minutes + on window focus/visibility
  useEffect(() => {
    const sheetId = (db.settings.spreadsheetId || '').trim();
    const gasUrl = (db.settings.gasUrl || '').trim();
    if ((!sheetId && !gasUrl) || db.settings.autoSync === false) return;

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
  }, [db.settings.spreadsheetId, db.settings.gasUrl, db.settings.autoSync, performBackgroundSync]);

  // Auto-Sync: debounced sync after local edits (workloads, leaves, OT, staff, settings)
  useEffect(() => {
    if (localRevision === 0) return;
    const sheetId = (dbRef.current.settings.spreadsheetId || '').trim();
    const gasUrl = (dbRef.current.settings.gasUrl || '').trim();
    if ((!sheetId && !gasUrl) || dbRef.current.settings.autoSync === false) return;

    const timer = window.setTimeout(() => {
      performBackgroundSync('edit');
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [localRevision, performBackgroundSync]);

  // Connect Google specifically for shared OPD staff (Data Entry ONLY; never grants Admin)
  const handleConnectGoogleForStaff = async () => {
    setIsLoggingIn(true);
    try {
      const token = await ensureGoogleToken(user?.email || undefined);
      if (token) {
        lastSyncedKeyRef.current = '';
        await performBackgroundSync('initial');
        showToast('เชื่อมต่อ Google Sheets สำหรับนำข้อมูลเข้าเรียบร้อยแล้ว!', 'success');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

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
      lastSyncedKeyRef.current = `${targetSheetId}|${result.mergedDb.settings.gasUrl || ''}`;
      setLastSyncedAt(formatSyncTime());
      setSheetSyncStatus('connected_write');
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

  // Copy shareable OPD link (auto-grants read access if signed in + includes ?sheetId= / ?gasUrl=)
  const handleCopyShareLink = async () => {
    const targetSheetId = (db.settings.spreadsheetId || '').trim();
    const targetGasUrl = (db.settings.gasUrl || '').trim();

    if (targetSheetId) {
      const token = await getAccessToken();
      if (token) {
        await ensureSheetAnyoneReaderPermission(token, targetSheetId);
      }
    }

    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const qp = new URLSearchParams();
    if (targetSheetId) qp.set('sheetId', targetSheetId);
    if (targetGasUrl) qp.set('gasUrl', targetGasUrl);
    const qs = qp.toString();
    const shareUrl = qs ? `${baseUrl}?${qs}` : baseUrl;

    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast(
        targetSheetId
          ? 'คัดลอกลิงก์พร้อมเชื่อม Google Sheet สำหรับส่งให้บุคลากร OPD แล้ว!'
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

    // Sync Data Entry (append-only) to Google Sheets via GAS Web App or OAuth token
    const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
    const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

    if (targetGasUrl) {
      let allOk = await appendViaAppsScript(targetGasUrl, 'appendWorkload', entry);
      for (const l of newLeaveEntries) {
        const ok = await appendViaAppsScript(targetGasUrl, 'appendLeave', l);
        if (!ok) allOk = false;
      }
      for (const o of newOtEntries) {
        const ok = await appendViaAppsScript(targetGasUrl, 'appendOT', o);
        if (!ok) allOk = false;
      }
      if (allOk) {
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        setSheetSyncStatus('connected_gas');
      } else {
        showToast('บันทึกในเครื่องแล้ว แต่ส่งเข้า Google Sheet ผ่าน Web App ไม่ครบถ้วน', 'error');
      }
    } else if (targetSheetId) {
      const token = await ensureGoogleToken(user?.email || undefined);
      if (!token) {
        showToast('บันทึกในเครื่องแล้ว (กรุณากดเชื่อมต่อ Google ด้านบนเพื่อส่งข้อมูลเข้าชีท)', 'error');
        return;
      }
      let allOk = await appendDailyWorkloadToSheet(token, targetSheetId, entry);
      for (const l of newLeaveEntries) {
        const ok = await appendLeaveToSheet(token, targetSheetId, l);
        if (!ok) allOk = false;
      }
      for (const o of newOtEntries) {
        const ok = await appendOTToSheet(token, targetSheetId, o);
        if (!ok) allOk = false;
      }
      if (allOk) {
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        setSheetSyncStatus('connected_write');
      } else {
        showToast(
          'บันทึกในเครื่องแล้ว แต่ส่งขึ้น Google Sheet ไม่สำเร็จ (บัญชี Google ที่ใช้ต้องมีสิทธิ์ Editor ในชีทนี้)',
          'error'
        );
      }
    }
  };

  const recordAuditToSheet = async (auditEntry: AuditLogEntry) => {
    const token = await getAccessToken();
    if (token && dbRef.current.settings.spreadsheetId) {
      await appendAuditLogToSheet(token, dbRef.current.settings.spreadsheetId, auditEntry);
    }
  };

  // Handler: Update Daily Workload (Admin, mandatory reason + timestamp)
  const handleUpdateWorkload = (updated: DailyWorkload, reason: string) => {
    if (!isAdmin) {
      showToast('การแก้ไขข้อมูลสงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason) return;
    const nowIso = new Date().toISOString();
    const editedBy = adminOwnerName || 'ผู้ดูแลระบบ';
    const prevItem = db.workloads.find(w => w.id === updated.id);

    const stamped: DailyWorkload = {
      ...updated,
      lastEditedAt: nowIso,
      lastEditReason: cleanReason,
      lastEditedBy: editedBy,
    };

    const summary = prevItem
      ? `${prevItem.clinic} (${formatThaiShortDate(prevItem.date)} • ${prevItem.shift}) ผู้ป่วย ${getEffectiveTotalPt(prevItem)} → ${getEffectiveTotalPt(stamped)} คน`
      : `${stamped.clinic} (${formatThaiShortDate(stamped.date)})`;

    const auditEntry: AuditLogEntry = {
      id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowIso,
      action: 'แก้ไขภาระงาน',
      targetName: stamped.clinic,
      summary,
      reason: cleanReason,
      editedBy,
    };

    markWorkloadsDirty();
    setDb(prev => ({
      ...prev,
      workloads: prev.workloads.map(w => w.id === stamped.id ? stamped : w),
      auditLogs: [auditEntry, ...(prev.auditLogs || [])],
    }));
    setLocalRevision(r => r + 1);
    void recordAuditToSheet(auditEntry);
    showToast(`อัปเดตข้อมูลภาระงานห้องตรวจ ${updated.clinic} พร้อมบันทึกเหตุผลแล้ว`, 'success');
  };

  // Handler: Delete Daily Workload (Admin, mandatory reason + timestamp)
  const handleDeleteWorkload = (id: string, reason: string) => {
    if (!isAdmin) {
      showToast('การลบข้อมูลสงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason) return;
    const target = db.workloads.find(w => w.id === id);
    const nowIso = new Date().toISOString();
    const editedBy = adminOwnerName || 'ผู้ดูแลระบบ';

    const auditEntry: AuditLogEntry = {
      id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowIso,
      action: 'ลบภาระงาน',
      targetName: target?.clinic || 'ไม่ระบุห้องตรวจ',
      summary: target
        ? `${target.clinic} (${formatThaiShortDate(target.date)} • ${target.shift}) ผู้ป่วย ${getEffectiveTotalPt(target)} คน`
        : `รหัสรายการ ${id}`,
      reason: cleanReason,
      editedBy,
    };

    markWorkloadsDirty();
    setDb(prev => ({
      ...prev,
      workloads: prev.workloads.filter(w => w.id !== id),
      auditLogs: [auditEntry, ...(prev.auditLogs || [])],
    }));
    setLocalRevision(r => r + 1);
    void recordAuditToSheet(auditEntry);
    showToast('ลบรายการภาระงานพร้อมบันทึกเหตุผลเรียบร้อยแล้ว', 'info');
  };

  // Handler: Save Leave (Data Entry: allowed via GAS or OAuth)
  const handleSaveLeave = async (leave: LeaveRecord) => {
    setDb(prev => ({
      ...prev,
      leaves: [leave, ...prev.leaves],
    }));
    showToast(`บันทึกวันลา ${leave.staffName} สำเร็จ!`, 'success');

    const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
    const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

    if (targetGasUrl) {
      const ok = await appendViaAppsScript(targetGasUrl, 'appendLeave', leave);
      if (ok) {
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        setSheetSyncStatus('connected_gas');
      } else {
        showToast('บันทึกวันลาในเครื่องแล้ว แต่ส่งเข้า Google Sheet ผ่าน Web App ไม่สำเร็จ', 'error');
      }
    } else if (targetSheetId) {
      const token = await ensureGoogleToken(user?.email || undefined);
      if (!token) {
        showToast('บันทึกวันลาในเครื่องแล้ว (กรุณากดเชื่อมต่อ Google ด้านบนเพื่อส่งข้อมูลเข้าชีท)', 'error');
        return;
      }
      const ok = await appendLeaveToSheet(token, targetSheetId, leave);
      if (ok) {
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        setSheetSyncStatus('connected_write');
      } else {
        showToast(
          'บันทึกวันลาในเครื่องแล้ว แต่ส่งขึ้น Google Sheet ไม่สำเร็จ (บัญชี Google ที่ใช้ต้องมีสิทธิ์ Editor ในชีทนี้)',
          'error'
        );
      }
    }
  };

  // Handler: Update Leave (Admin, mandatory reason + timestamp)
  const handleUpdateLeave = (updated: LeaveRecord, reason: string) => {
    if (!isAdmin) {
      showToast('การแก้ไขวันลาสงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason) return;
    const nowIso = new Date().toISOString();
    const editedBy = adminOwnerName || 'ผู้ดูแลระบบ';
    const prevItem = db.leaves.find(l => l.id === updated.id);

    const stamped: LeaveRecord = {
      ...updated,
      lastEditedAt: nowIso,
      lastEditReason: cleanReason,
      lastEditedBy: editedBy,
    };

    const prevDesc = prevItem
      ? `${prevItem.leaveType} ${prevItem.days} วัน (${formatThaiLeaveRange(prevItem.startDate, prevItem.endDate)})`
      : '';
    const nextDesc = `${stamped.leaveType} ${stamped.days} วัน (${formatThaiLeaveRange(stamped.startDate, stamped.endDate)})`;

    const auditEntry: AuditLogEntry = {
      id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowIso,
      action: 'แก้ไขวันลา',
      targetName: stamped.staffName,
      summary: prevDesc ? `${prevDesc} → ${nextDesc}` : nextDesc,
      reason: cleanReason,
      editedBy,
    };

    markLeavesDirty();
    setDb(prev => ({
      ...prev,
      leaves: prev.leaves.map(l => l.id === stamped.id ? stamped : l),
      auditLogs: [auditEntry, ...(prev.auditLogs || [])],
    }));
    setLocalRevision(r => r + 1);
    void recordAuditToSheet(auditEntry);
    showToast(`อัปเดตประวัติการลา ${stamped.staffName} พร้อมบันทึกเหตุผลแล้ว`, 'success');
  };

  // Handler: Delete Leave (Admin, mandatory reason + timestamp)
  const handleDeleteLeave = (id: string, reason: string) => {
    if (!isAdmin) {
      showToast('การลบวันลาสงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason) return;
    const target = db.leaves.find(l => l.id === id);
    const nowIso = new Date().toISOString();
    const editedBy = adminOwnerName || 'ผู้ดูแลระบบ';

    const auditEntry: AuditLogEntry = {
      id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowIso,
      action: 'ลบวันลา',
      targetName: target?.staffName || 'ไม่ระบุชื่อ',
      summary: target
        ? `${target.leaveType} ${target.days} วัน (${formatThaiLeaveRange(target.startDate, target.endDate)})`
        : `รหัสรายการ ${id}`,
      reason: cleanReason,
      editedBy,
    };

    markLeavesDirty();
    setDb(prev => ({
      ...prev,
      leaves: prev.leaves.filter(l => l.id !== id),
      auditLogs: [auditEntry, ...(prev.auditLogs || [])],
    }));
    setLocalRevision(r => r + 1);
    void recordAuditToSheet(auditEntry);
    showToast('ลบประวัติการลาพร้อมบันทึกเหตุผลเรียบร้อยแล้ว', 'info');
  };

  // Handler: Save Batch OT (Data Entry: allowed via GAS or OAuth)
  const handleSaveBatchOT = async (records: OTAttendance[]) => {
    setDb(prev => ({
      ...prev,
      ot: [...records, ...prev.ot],
    }));
    showToast(`บันทึกเวรนอกเวลาจำนวน ${records.length} คน เรียบร้อยแล้ว!`, 'success');

    const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
    const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

    if (targetGasUrl) {
      let allOk = true;
      for (const r of records) {
        const ok = await appendViaAppsScript(targetGasUrl, 'appendOT', r);
        if (!ok) allOk = false;
      }
      if (allOk) {
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        setSheetSyncStatus('connected_gas');
      } else {
        showToast('บันทึกเวร OT ในเครื่องแล้ว แต่ส่งเข้า Google Sheet ผ่าน Web App ไม่ครบถ้วน', 'error');
      }
    } else if (targetSheetId) {
      const token = await ensureGoogleToken(user?.email || undefined);
      if (!token) {
        showToast('บันทึกเวร OT ในเครื่องแล้ว (กรุณากดเชื่อมต่อ Google ด้านบนเพื่อส่งข้อมูลเข้าชีท)', 'error');
        return;
      }
      let allOk = true;
      for (const r of records) {
        const ok = await appendOTToSheet(token, targetSheetId, r);
        if (!ok) allOk = false;
      }
      if (allOk) {
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        setSheetSyncStatus('connected_write');
      } else {
        showToast(
          'บันทึกเวร OT ในเครื่องแล้ว แต่ส่งขึ้น Google Sheet ไม่สำเร็จ (บัญชี Google ที่ใช้ต้องมีสิทธิ์ Editor ในชีทนี้)',
          'error'
        );
      }
    }
  };

  // Handler: Update OT (Admin, mandatory reason + timestamp)
  const handleUpdateOT = (updated: OTAttendance, reason: string) => {
    if (!isAdmin) {
      showToast('การแก้ไขเวร OT สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason) return;
    const nowIso = new Date().toISOString();
    const editedBy = adminOwnerName || 'ผู้ดูแลระบบ';
    const prevItem = db.ot.find(o => o.id === updated.id);

    const stamped: OTAttendance = {
      ...updated,
      lastEditedAt: nowIso,
      lastEditReason: cleanReason,
      lastEditedBy: editedBy,
    };

    const summary = prevItem
      ? `${prevItem.workClinic} (${formatThaiShortDate(prevItem.date)}) → ${stamped.workClinic} (${formatThaiShortDate(stamped.date)} • ${stamped.shift})`
      : `${stamped.workClinic} (${formatThaiShortDate(stamped.date)} • ${stamped.shift})`;

    const auditEntry: AuditLogEntry = {
      id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowIso,
      action: 'แก้ไขเวร OT',
      targetName: stamped.staffName,
      summary,
      reason: cleanReason,
      editedBy,
    };

    markOtDirty();
    setDb(prev => ({
      ...prev,
      ot: prev.ot.map(o => o.id === stamped.id ? stamped : o),
      auditLogs: [auditEntry, ...(prev.auditLogs || [])],
    }));
    setLocalRevision(r => r + 1);
    void recordAuditToSheet(auditEntry);
    showToast(`อัปเดตเวรนอกเวลา ${stamped.staffName} พร้อมบันทึกเหตุผลแล้ว`, 'success');
  };

  // Handler: Delete OT (Admin, mandatory reason + timestamp)
  const handleDeleteOT = (id: string, reason: string) => {
    if (!isAdmin) {
      showToast('การลบเวร OT สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason) return;
    const target = db.ot.find(o => o.id === id);
    const nowIso = new Date().toISOString();
    const editedBy = adminOwnerName || 'ผู้ดูแลระบบ';

    const auditEntry: AuditLogEntry = {
      id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      timestamp: nowIso,
      action: 'ลบเวร OT',
      targetName: target?.staffName || 'ไม่ระบุชื่อ',
      summary: target
        ? `${target.workClinic} (${formatThaiShortDate(target.date)} • ${target.shift})`
        : `รหัสรายการ ${id}`,
      reason: cleanReason,
      editedBy,
    };

    markOtDirty();
    setDb(prev => ({
      ...prev,
      ot: prev.ot.filter(o => o.id !== id),
      auditLogs: [auditEntry, ...(prev.auditLogs || [])],
    }));
    setLocalRevision(r => r + 1);
    void recordAuditToSheet(auditEntry);
    showToast('ลบรายการเวรนอกเวลาพร้อมบันทึกเหตุผลแล้ว', 'info');
  };

  // Handler: Add Staff Member
  const handleAddStaff = async (staff: StaffMember) => {
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
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
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
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
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
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
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
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
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
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
    if (!isAdmin) return;
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
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    localStorage.removeItem('pcmc_opd_system_db_v1');
    markStaffMasterDirty();
    setDb(loadLocalDatabase());
    showToast('ล้างข้อมูลทั้งหมดเรียบร้อยแล้ว พร้อมเริ่มต้นใช้งานจริง', 'info');
  };

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-800 flex flex-col font-sans">
      {/* Top Navbar (Clean without Auto Sync & Sync Sheet buttons per Image 1; Auto Sync still runs silently) */}
      <Navbar
        isAdmin={isAdmin}
        adminOwnerName={adminOwnerName}
        onLockAdmin={handleLockAdmin}
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

        {/* Shared Google Sheet Data-Entry Connection Bar (For OPD Staff — Data Entry ONLY; Edit/Delete requires Admin PIN) */}
        {!isAdmin && (db.settings.spreadsheetId || db.settings.gasUrl) && activeTab !== 'admin' && (
          <div
            className={`no-print rounded-2xl px-4 py-2.5 border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs shadow-2xs ${
              db.settings.gasUrl || hasActiveToken
                ? 'bg-emerald-50/90 border-emerald-200 text-emerald-900'
                : 'bg-amber-50/90 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-center gap-2.5 flex-wrap">
              <span
                className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                  isSyncingSheet
                    ? 'bg-amber-500 animate-ping'
                    : db.settings.gasUrl || hasActiveToken
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'
                }`}
              />
              <div className="font-semibold">
                {db.settings.gasUrl ? (
                  <span>เชื่อมต่อ Google Sheets อัตโนมัติพร้อมนำข้อมูลเข้าแล้ว</span>
                ) : hasActiveToken ? (
                  <span>
                    เชื่อมต่อบัญชี Google ({user?.email || 'พร้อมส่งข้อมูลเข้าชีท'}) เรียบร้อยแล้ว
                  </span>
                ) : sheetSyncStatus === 'public_readonly' ? (
                  <span>
                    โหลดรายชื่อบุคลากรและข้อมูลจาก Google Sheets แล้ว — เชื่อมต่อบัญชี Google เพื่อบันทึกข้อมูลใหม่เข้าชีท
                  </span>
                ) : (
                  <span>
                    พบลิงก์ Google Sheets ของหน่วยงาน — กดเชื่อมต่อเพื่อดึงข้อมูลและนำข้อมูลเข้าชีทอัตโนมัติ
                  </span>
                )}
                {lastSyncedAt && (
                  <span className="ml-2 text-[11px] font-normal opacity-75">
                    (อัปเดตล่าสุด {lastSyncedAt})
                  </span>
                )}
              </div>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/80 border border-black/10 text-[11px] font-medium text-slate-700">
                <Lock className="w-3 h-3 text-red-600" />
                <span>สิทธิ์: นำข้อมูลเข้าเท่านั้น (แก้ไข/ลบใช้รหัส Admin)</span>
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!db.settings.gasUrl && !hasActiveToken && (
                <button
                  type="button"
                  onClick={handleConnectGoogleForStaff}
                  disabled={isLoggingIn}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-gray-50 text-gray-800 border border-gray-300 font-bold text-xs shadow-2xs transition-colors cursor-pointer disabled:opacity-60"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                    />
                  </svg>
                  <span>{isLoggingIn ? 'กำลังเชื่อมต่อ...' : 'เชื่อมต่อ Google (นำข้อมูลเข้า)'}</span>
                </button>
              )}
              {(db.settings.gasUrl || hasActiveToken || sheetSyncStatus === 'public_readonly') && (
                <button
                  type="button"
                  onClick={() => performBackgroundSync('initial')}
                  disabled={isSyncingSheet}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/90 hover:bg-white text-emerald-800 border border-emerald-300 font-semibold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                  title="ดึงข้อมูลล่าสุดจาก Google Sheets"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
                  <span>รีเฟรชข้อมูล</span>
                </button>
              )}
              {hasActiveToken && (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/90 hover:bg-red-50 text-red-700 border border-red-200 font-semibold text-[11px] transition-colors cursor-pointer"
                  title="ออกจากบัญชี Google"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>ออกจาก Google</span>
                </button>
              )}
            </div>
          </div>
        )}

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
            auditLogs={db.auditLogs || []}
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
            adminOwnerName={adminOwnerName}
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
