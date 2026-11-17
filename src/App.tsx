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
  DEFAULT_PREMIUM_SUB_CLINICS,
  PREMIUM_CLINIC_GROUP,
  getEffectiveTotalPt,
  WorkloadLeavePayload,
  WorkloadCrossCoveragePayload,
  WorkloadTrainingPayload,
  formatLeaveNoteWithPeriod,
  formatOtWorkClinicValue,
  isTrainingLeaveType,
  getStaffEmployeeCode,
  isLegacyGeneratedStaffId,
  isValidEmployeeCodeValue
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
  hasPendingAdminDirtyFlags,
  getWorkloadKey,
  getLeaveKey,
  getOtKey,
  recordDeletedWorkloadTombstone,
  clearWorkloadTombstone,
  recordDeletedLeaveTombstone,
  clearLeaveTombstone,
  recordDeletedOtTombstone,
  clearOtTombstone,
  clearAllTombstones,
  clearStaffMasterDirty,
  clearSettingsDirty,
  clearWorkloadsDirty,
  clearLeavesDirty,
  clearOtDirty,
  enqueuePendingOutboxWorkloads,
  markWorkloadOutboxSynced,
  getPendingOutboxWorkloads,
  enqueuePendingOutboxLeaves,
  markLeaveOutboxSynced,
  getPendingOutboxLeaves,
  enqueuePendingOutboxOt,
  markOtOutboxSynced,
  getPendingOutboxOt,
  enqueuePendingOutboxAuditLogs,
  clearAllPendingOutbox,
  pushAdminTableViaAppsScript,
  pushTargetedAdminRowMutationViaAppsScript,
  pushAdminTableViaOAuth,
  appendDailyWorkloadToSheet,
  appendLeaveToSheet,
  appendOTToSheet,
  appendAuditLogToSheet,
  ensureSheetAnyoneReaderPermission,
  readPublicGoogleSheet,
  appendViaAppsScript,
  syncPublicViaAppsScript,
  syncAdminViaAppsScript,
  appendAuditViaAppsScript
} from './services/sheetsService';
import { formatThaiLeaveRange, formatThaiShortDate } from './utils/thaiDate';
import { 
  initAuth, 
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

  const dbRef = useRef(db);
  dbRef.current = db;
  const isSyncInFlightRef = useRef<boolean>(false);
  const adminWriteInFlightRef = useRef<boolean>(false);
  const adminWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSyncEpochRef = useRef<number>(0);
  const lastSyncedKeyRef = useRef<string>('');
  const mutationSeqRef = useRef<number>(0);
  const pendingSyncAfterFlightRef = useRef<boolean>(false);
  const tabInstanceIdRef = useRef<string>(`tab-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const suppressNextBroadcastRef = useRef<boolean>(false);

  // Toast State
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Auto-save local database whenever db changes & notify other open tabs in same browser
  useEffect(() => {
    saveLocalDatabase(db);
    if (suppressNextBroadcastRef.current) {
      suppressNextBroadcastRef.current = false;
      return;
    }
    try {
      syncChannelRef.current?.postMessage({
        type: 'DB_UPDATED',
        senderId: tabInstanceIdRef.current,
        ts: Date.now(),
      });
    } catch {
      // ignore BroadcastChannel errors on unsupported browsers
    }
  }, [db]);

  // Same-browser cross-tab real-time sync (BroadcastChannel + storage fallback)
  useEffect(() => {
    const syncFromSiblingTab = () => {
      if (isSyncInFlightRef.current || adminWriteInFlightRef.current) return;
      const freshLocal = loadLocalDatabase();
      suppressNextBroadcastRef.current = true;
      dbRef.current = freshLocal;
      setDb(freshLocal);
    };

    try {
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel('pcmc_opd_sync_v1');
        syncChannelRef.current = channel;
        channel.onmessage = (event) => {
          const msg = event?.data;
          if (msg?.type === 'DB_UPDATED' && msg.senderId !== tabInstanceIdRef.current) {
            syncFromSiblingTab();
          }
        };
      }
    } catch {
      // ignore if BroadcastChannel unavailable
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'pcmc_opd_system_db_v1' && e.newValue) {
        syncFromSiblingTab();
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('storage', handleStorage);
      try {
        syncChannelRef.current?.close();
      } catch {
        // ignore
      }
      syncChannelRef.current = null;
    };
  }, []);

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
              isUnlinked: false,
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

  // Google Sign-In Handler (disabled: Google Sheets sync operates without Google Sign-In)
  const handleLogin = async () => {
    setIsLoggingIn(false);
    showToast('ระบบเชื่อมต่อและซิงค์ Google Sheets ทำงานได้ทันทีโดยไม่ต้อง Sign in Google', 'info');
  };

  // Logout Handler (Google Sign-Out also locks Admin mode)
  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
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
  const unlockedAdminPinRef = useRef<string>('');
  const isAdminUnlockedRef = useRef<boolean>(false);

  const handleUnlockAdmin = (pin: string) => {
    const match = verifyAdminPinWithOwner(pin, db.settings);
    if (match.valid) {
      unlockedAdminPinRef.current = pin.trim();
      isAdminUnlockedRef.current = true;
      setIsAdminUnlocked(true);
      setAdminOwnerName(match.ownerName);
      showToast(`ปลดล็อกสิทธิ์ผู้ดูแลระบบ (${match.ownerName}) สำเร็จ!`, 'success');
      if (hasPendingAdminDirtyFlags()) {
        adminWriteQueueRef.current = adminWriteQueueRef.current
          .catch(() => undefined)
          .then(async () => {
            const latestDb = dbRef.current;
            const targetGasUrl = (latestDb.settings.gasUrl || '').trim();
            if (targetGasUrl && unlockedAdminPinRef.current) {
              adminWriteInFlightRef.current = true;
              try {
                const res = await syncAdminViaAppsScript(
                  targetGasUrl,
                  unlockedAdminPinRef.current,
                  latestDb
                );
                if (res.accessible && res.adminSynced) {
                  dbRef.current = res.mergedDb;
                  setDb(res.mergedDb);
                  lastSyncEpochRef.current = Date.now();
                  setLastSyncedAt(formatSyncTime());
                }
              } finally {
                adminWriteInFlightRef.current = false;
              }
            }
          });
      }
      return true;
    }
    return false;
  };

  const handleLockAdmin = () => {
    unlockedAdminPinRef.current = '';
    isAdminUnlockedRef.current = false;
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
  const premiumSubClinics = db.settings.premiumSubClinics && db.settings.premiumSubClinics.length > 0
    ? db.settings.premiumSubClinics
    : [...DEFAULT_PREMIUM_SUB_CLINICS];
  const leaveTypes = db.settings.leaveTypes && db.settings.leaveTypes.length > 0
    ? db.settings.leaveTypes
    : [...LEAVE_TYPES];

  // Passive OAuth token check only (never triggers forced Sign-In popup during sync)
  const getPassiveGoogleToken = async (): Promise<string | null> => {
    return await getAccessToken();
  };

  const formatSyncTime = () =>
    new Date().toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  // Silent background Auto-Sync (100% works without Google Sign-In):
  // 1) Apps Script Web App 2-way sync if gasUrl is configured (or discovered from Settings tab)
  // 2) Public GViz read-only sync when ?sheetId= is shared as Anyone with link can view
  // 3) Optional passive OAuth 2-way sync only if user happened to already hold a valid token
  const performBackgroundSync = useCallback(async (_reason: 'initial' | 'interval' | 'focus' | 'edit') => {
    if (isSyncInFlightRef.current || adminWriteInFlightRef.current) {
      if (_reason === 'edit') {
        pendingSyncAfterFlightRef.current = true;
      }
      return;
    }
    const currentDb = dbRef.current;
    const targetSheetId = (currentDb.settings.spreadsheetId || '').trim();
    const targetGasUrl = (currentDb.settings.gasUrl || '').trim();
    if ((!targetSheetId && !targetGasUrl) || currentDb.settings.autoSync === false) return;

    const syncKey = `${targetSheetId}|${targetGasUrl}`;
    const startSeq = mutationSeqRef.current;

    isSyncInFlightRef.current = true;
    setIsSyncingSheet(true);
    try {
      const token = await getPassiveGoogleToken();
      if (mutationSeqRef.current !== startSeq) {
        pendingSyncAfterFlightRef.current = true;
        return;
      }

      const applySyncedDb = (nextDb: typeof currentDb) => {
        if (mutationSeqRef.current !== startSeq) {
          pendingSyncAfterFlightRef.current = true;
          return false;
        }
        dbRef.current = nextDb;
        setDb(nextDb);
        lastSyncEpochRef.current = Date.now();
        lastSyncedKeyRef.current = syncKey;
        setLastSyncedAt(formatSyncTime());
        return true;
      };

      if (targetGasUrl) {
        const useAdmin = isAdminUnlockedRef.current && Boolean(unlockedAdminPinRef.current);
        const gasRes = useAdmin
          ? await syncAdminViaAppsScript(targetGasUrl, unlockedAdminPinRef.current, currentDb)
          : await syncPublicViaAppsScript(targetGasUrl, currentDb);
        if (gasRes.accessible) {
          if (useAdmin && 'adminSynced' in gasRes && !gasRes.adminSynced) {
            console.warn('Admin sync warning:', 'error' in gasRes ? gasRes.error : '');
          }
          applySyncedDb({
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
          return;
        }
      }

      if (token && targetSheetId) {
        const result = await syncAllWithGoogleSheet(token, targetSheetId, currentDb);
        applySyncedDb({
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
        return;
      }

      if (targetSheetId) {
        const pubRes = await readPublicGoogleSheet(targetSheetId, currentDb);
        if (pubRes.accessible) {
          const discoveredGas = (pubRes.mergedDb.settings.gasUrl || '').trim();
          if (discoveredGas) {
            const gasRes =
              isAdminUnlockedRef.current && unlockedAdminPinRef.current
                ? await syncAdminViaAppsScript(discoveredGas, unlockedAdminPinRef.current, pubRes.mergedDb)
                : await syncPublicViaAppsScript(discoveredGas, pubRes.mergedDb);
            const finalDb = gasRes.accessible ? gasRes.mergedDb : pubRes.mergedDb;
            applySyncedDb({
              ...finalDb,
              settings: {
                ...finalDb.settings,
                spreadsheetId: targetSheetId,
                spreadsheetUrl:
                  finalDb.settings.spreadsheetUrl ||
                  `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
                gasUrl: discoveredGas,
              },
            });
          } else {
            applySyncedDb({
              ...pubRes.mergedDb,
              settings: {
                ...pubRes.mergedDb.settings,
                spreadsheetId: targetSheetId,
                spreadsheetUrl:
                  pubRes.mergedDb.settings.spreadsheetUrl ||
                  `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
              },
            });
          }
        } else {
          lastSyncedKeyRef.current = syncKey;
        }
      }
    } catch (err) {
      console.warn('Auto-sync skipped:', err);
    } finally {
      isSyncInFlightRef.current = false;
      setIsSyncingSheet(false);
      if (pendingSyncAfterFlightRef.current) {
        pendingSyncAfterFlightRef.current = false;
        window.setTimeout(() => {
          performBackgroundSync('edit');
        }, 100);
      }
    }
  }, []);

  // Auto-Sync: initial load / when user or spreadsheetId/gasUrl changes (no background interval polling)
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

  // Manual Sync with linked Google Spreadsheet — works completely WITHOUT Google Sign-In
  const handleSyncSpreadsheet = async (overrideSheetId?: string) => {
    const currentDb = dbRef.current;
    const targetSheetId = (overrideSheetId || currentDb.settings.spreadsheetId || '').trim();
    let targetGasUrl = (currentDb.settings.gasUrl || '').trim();

    if (!targetSheetId && !targetGasUrl) {
      showToast('ยังไม่มีลิงก์ Google Sheets หรือ Web App URL กรุณากด "ตั้งค่าลิงก์ชีท" ก่อน', 'info');
      return;
    }

    if (isSyncInFlightRef.current) return;

    const startSeq = mutationSeqRef.current;
    isSyncInFlightRef.current = true;
    setIsSyncingSheet(true);
    try {
      const applyManualDb = (nextDb: typeof currentDb) => {
        if (mutationSeqRef.current !== startSeq) {
          pendingSyncAfterFlightRef.current = true;
          return false;
        }
        dbRef.current = nextDb;
        setDb(nextDb);
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        return true;
      };

      let publicFallbackRes: { accessible: boolean; mergedDb: typeof currentDb } | null = null;

      // If gasUrl isn't saved yet but spreadsheetId exists, check public sheet first to read & auto-discover Gas_Web_App_URL
      if (!targetGasUrl && targetSheetId) {
        publicFallbackRes = await readPublicGoogleSheet(targetSheetId, currentDb);
        if (publicFallbackRes.accessible && publicFallbackRes.mergedDb.settings.gasUrl) {
          targetGasUrl = publicFallbackRes.mergedDb.settings.gasUrl.trim();
        }
      }

      if (targetGasUrl) {
        const workingDb = publicFallbackRes?.accessible ? publicFallbackRes.mergedDb : currentDb;
        const useAdminSync = isAdminUnlockedRef.current && Boolean(unlockedAdminPinRef.current);
        const gasRes = useAdminSync
          ? await syncAdminViaAppsScript(targetGasUrl, unlockedAdminPinRef.current, workingDb)
          : await syncPublicViaAppsScript(targetGasUrl, workingDb);

        if (gasRes.accessible) {
          const finalSheetId = targetSheetId || gasRes.mergedDb.settings.spreadsheetId || '';
          const applied = applyManualDb({
            ...gasRes.mergedDb,
            settings: {
              ...gasRes.mergedDb.settings,
              spreadsheetId: finalSheetId || undefined,
              spreadsheetUrl:
                gasRes.mergedDb.settings.spreadsheetUrl ||
                (finalSheetId ? `https://docs.google.com/spreadsheets/d/${finalSheetId}/edit` : undefined),
              gasUrl: targetGasUrl,
            },
          });
          if (applied) {
            lastSyncedKeyRef.current = `${finalSheetId}|${targetGasUrl}`;
          }

          if (useAdminSync && 'adminSynced' in gasRes && !gasRes.adminSynced) {
            const errMsg = 'error' in gasRes ? gasRes.error : undefined;
            showToast(
              `ดึงข้อมูลสำเร็จ แต่เขียนทับ Google Sheet ในสิทธิ์ Admin ไม่สำเร็จ: ${errMsg || 'กรุณาตรวจสอบ Code.gs'}`,
              'error'
            );
            return;
          }

          const syncDetail =
            gasRes.pushedCount > 0
              ? ` (บุคลากร ${gasRes.mergedDb.staff.length} คน, ส่งขึ้น ${gasRes.pushedCount} รายการ)`
              : ` (บุคลากร ${gasRes.mergedDb.staff.length} คน)`;
          showToast(`ซิงค์ข้อมูลกับ Google Sheet สำเร็จ!${syncDetail}`, 'success');
          return;
        }
      }

      // 2) Passive OAuth fallback ONLY if a valid token already exists (never opens Sign-In popup)
      const token = await getPassiveGoogleToken();
      if (token && targetSheetId) {
        const result = await syncAllWithGoogleSheet(token, targetSheetId, currentDb);
        const applied = applyManualDb({
          ...result.mergedDb,
          settings: {
            ...result.mergedDb.settings,
            spreadsheetId: targetSheetId,
            spreadsheetUrl:
              result.mergedDb.settings.spreadsheetUrl ||
              `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
          },
        });
        if (applied) {
          lastSyncedKeyRef.current = `${targetSheetId}|${result.mergedDb.settings.gasUrl || ''}`;
        }
        showToast(
          `ซิงค์ Google Sheet สำเร็จ! (บุคลากร ${result.staffCount} คน, ส่งขึ้น ${result.pushedWorkloads} / ดึงเข้า ${result.pulledWorkloads} รายการ)`,
          'success'
        );
        return;
      }

      // 3) Public GViz read-only sync fallback (ZERO Google Sign-In)
      if (targetSheetId) {
        const pubRes = publicFallbackRes || (await readPublicGoogleSheet(targetSheetId, currentDb));
        if (pubRes.accessible) {
          const applied = applyManualDb({
            ...pubRes.mergedDb,
            settings: {
              ...pubRes.mergedDb.settings,
              spreadsheetId: targetSheetId,
              spreadsheetUrl:
                pubRes.mergedDb.settings.spreadsheetUrl ||
                `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
            },
          });
          if (applied) {
            lastSyncedKeyRef.current = `${targetSheetId}|${pubRes.mergedDb.settings.gasUrl || ''}`;
          }
          showToast(
            `ดึงข้อมูลล่าสุดจาก Google Sheet สำเร็จ! (${pubRes.mergedDb.staff.length} คน — หากต้องการส่งข้อมูลกลับอัตโนมัติให้วาง Web App URL ใน "ตั้งค่าลิงก์ชีท")`,
            'success'
          );
          return;
        }
      }

      showToast(
        'ไม่สามารถซิงค์แบบไม่ต้อง Sign in ได้ กรุณาวาง Web App URL (/exec) จาก Code.gs ใน "ตั้งค่าลิงก์ชีท" หรือเปิดสิทธิ์ชีทเป็น "ทุกคนที่มีลิงก์อ่านได้"',
        'info'
      );
    } catch (err: any) {
      console.error('Sync spreadsheet error:', err);
      showToast(`ซิงค์ข้อมูลไม่สำเร็จ: ${err?.message || err}`, 'error');
    } finally {
      isSyncInFlightRef.current = false;
      setIsSyncingSheet(false);
      if (pendingSyncAfterFlightRef.current) {
        pendingSyncAfterFlightRef.current = false;
        window.setTimeout(() => {
          performBackgroundSync('edit');
        }, 100);
      }
    }
  };

  // Setup Google Spreadsheet (never forces Google Sign-In popup)
  const handleSetupSpreadsheet = async () => {
    if (db.settings.spreadsheetId || db.settings.gasUrl) {
      await handleSyncSpreadsheet(db.settings.spreadsheetId);
      return;
    }

    const token = await getPassiveGoogleToken();
    if (!token) {
      showToast('กรุณากด "ตั้งค่าลิงก์ชีท" เพื่อวางลิงก์ Google Sheets และ Web App URL (/exec) จาก Code.gs (ไม่ต้อง Sign in Google)', 'info');
      return;
    }

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

      showToast('สร้างฐานข้อมูล Google Sheets เรียบร้อยแล้ว!', 'success');
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
    leaveData?: WorkloadLeavePayload[] | null,
    crossCoverageData?: WorkloadCrossCoveragePayload | WorkloadCrossCoveragePayload[] | null,
    trainingData?: WorkloadTrainingPayload[] | null
  ) => {
    const newLeaveEntries: LeaveRecord[] = [];
    const newOtEntries: OTAttendance[] = [];

    if (leaveData) {
      const existingLeaves = dbRef.current.leaves;
      const skippedNames: string[] = [];
      leaveData.forEach((ld, idx) => {
        const cleanName = (ld.staffName || '').trim();
        const isDuplicateInDb = existingLeaves.some(l => {
          if (isTrainingLeaveType(l.leaveType) !== isTrainingLeaveType(ld.leaveType)) return false;
          const sDate = (l.startDate || '').trim();
          const eDate = (l.endDate || l.startDate || '').trim();
          return (l.staffName || '').trim() === cleanName && Boolean(sDate) && entry.date >= sDate && entry.date <= eDate;
        });
        if (isDuplicateInDb) {
          skippedNames.push(cleanName);
          return;
        }
        const staff = db.staff.find(s => s.name === ld.staffName);
        const numericDays = Number(ld.days) === 0.5 ? 0.5 : 1;
        const formattedNote = formatLeaveNoteWithPeriod(ld.note || '', numericDays, ld.periodLabel);
        newLeaveEntries.push({
          id: `LV-AUTO-${Date.now()}-${idx}-${ld.staffName}`,
          startDate: entry.date,
          endDate: entry.date,
          staffName: ld.staffName,
          position: staff ? staff.position : 'RN',
          clinic: staff ? staff.homeClinic : entry.clinic,
          leaveType: ld.leaveType,
          days: numericDays,
          note: formattedNote,
        });
      });
      if (skippedNames.length > 0) {
        showToast(`ข้ามรายการลาซ้ำในวันเดียวกัน (${skippedNames.join(', ')}) เนื่องจากมีอยู่ในฐานข้อมูลแล้ว`, 'error');
      }
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

    const crossList: WorkloadCrossCoveragePayload[] = Array.isArray(crossCoverageData)
      ? crossCoverageData
      : crossCoverageData
        ? [crossCoverageData]
        : [];

    crossList.forEach((cc, idx) => {
      if (!cc.staffName || !cc.targetClinic) return;
      const staff = db.staff.find(s => s.name === cc.staffName);
      const amount = cc.amount === 0.5 ? 0.5 : 1;
      const workClinicVal = formatOtWorkClinicValue(cc.targetClinic, amount, cc.periodLabel);
      const resolvedHome =
        cc.homeClinic ||
        (cc.isExternal ? (cc.affiliation || 'ภายนอก OPD') : (staff ? staff.homeClinic : entry.clinic));
      const resolvedShift =
        cc.shift || (cc.isExternal ? 'OT ในเวลาราชการ 08:00-16:00' : entry.shift);
      newOtEntries.push({
        id: `OT-CROSS-${Date.now()}-${idx}`,
        date: entry.date,
        shift: resolvedShift,
        staffName: cc.staffName,
        position: cc.position || (staff ? staff.position : 'RN'),
        homeClinic: resolvedHome,
        workClinic: workClinicVal,
        ...(cc.isExternal
          ? { isExternal: true, affiliation: cc.affiliation || resolvedHome }
          : {}),
      });
    });

    clearWorkloadTombstone(entry);
    enqueuePendingOutboxWorkloads([entry]);
    if (newLeaveEntries.length > 0) enqueuePendingOutboxLeaves(newLeaveEntries);
    if (newOtEntries.length > 0) enqueuePendingOutboxOt(newOtEntries);

    mutationSeqRef.current += 1;
    const baseDb = dbRef.current;
    const nextDb = {
      ...baseDb,
      workloads: [entry, ...baseDb.workloads],
      leaves: [...newLeaveEntries, ...baseDb.leaves],
      ot: [...newOtEntries, ...baseDb.ot],
    };
    dbRef.current = nextDb;
    setDb(nextDb);

    showToast(`บันทึกภาระงานห้องตรวจ ${entry.clinic} สำเร็จ!`, 'success');

    // Auto-Sync on Save (append-only) to Google Sheets when Auto-Sync is enabled
    if (dbRef.current.settings.autoSync === false) return;
    const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
    const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

    if (targetGasUrl) {
      let allOk = await appendViaAppsScript(targetGasUrl, 'appendWorkload', entry);
      if (allOk) markWorkloadOutboxSynced([entry]);
      for (const l of newLeaveEntries) {
        const ok = await appendViaAppsScript(targetGasUrl, 'appendLeave', l);
        if (ok) markLeaveOutboxSynced([l]);
        else allOk = false;
      }
      for (const o of newOtEntries) {
        const ok = await appendViaAppsScript(targetGasUrl, 'appendOT', o);
        if (ok) markOtOutboxSynced([o]);
        else allOk = false;
      }
      if (allOk) {
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
      } else {
        showToast('บันทึกในเครื่องแล้ว (กำลังรอซิงค์เข้า Google Sheet อัตโนมัติ)', 'error');
      }
      void performBackgroundSync('edit');
    } else if (targetSheetId) {
      const token = await getAccessToken();
      if (token) {
        const wOk = await appendDailyWorkloadToSheet(token, targetSheetId, entry);
        if (wOk) markWorkloadOutboxSynced([entry]);
        for (const l of newLeaveEntries) {
          if (await appendLeaveToSheet(token, targetSheetId, l)) {
            markLeaveOutboxSynced([l]);
          }
        }
        for (const o of newOtEntries) {
          if (await appendOTToSheet(token, targetSheetId, o)) {
            markOtOutboxSynced([o]);
          }
        }
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        void performBackgroundSync('edit');
      }
    }
  };

  // Handler: Save Batch Daily Workloads (used by คลินิกพิเศษ PREMIUM Pooled Staffing Model)
  const handleSaveBatchWorkloads = async (
    entries: DailyWorkload[],
    leaveData?: WorkloadLeavePayload[] | null,
    crossCoverageData?: WorkloadCrossCoveragePayload | WorkloadCrossCoveragePayload[] | null,
    trainingData?: WorkloadTrainingPayload[] | null
  ) => {
    if (!entries || entries.length === 0) return;
    const primaryEntry = entries[0];
    const newLeaveEntries: LeaveRecord[] = [];
    const newOtEntries: OTAttendance[] = [];

    if (leaveData) {
      const existingLeaves = dbRef.current.leaves;
      const skippedNames: string[] = [];
      leaveData.forEach((ld, idx) => {
        const cleanName = (ld.staffName || '').trim();
        const isDuplicateInDb = existingLeaves.some(l => {
          if (isTrainingLeaveType(l.leaveType) !== isTrainingLeaveType(ld.leaveType)) return false;
          const sDate = (l.startDate || '').trim();
          const eDate = (l.endDate || l.startDate || '').trim();
          return (l.staffName || '').trim() === cleanName && Boolean(sDate) && primaryEntry.date >= sDate && primaryEntry.date <= eDate;
        });
        if (isDuplicateInDb) {
          skippedNames.push(cleanName);
          return;
        }
        const staff = db.staff.find(s => s.name === ld.staffName);
        const numericDays = Number(ld.days) === 0.5 ? 0.5 : 1;
        const formattedNote = formatLeaveNoteWithPeriod(ld.note || '', numericDays, ld.periodLabel);
        newLeaveEntries.push({
          id: `LV-AUTO-${Date.now()}-${idx}-${ld.staffName}`,
          startDate: primaryEntry.date,
          endDate: primaryEntry.date,
          staffName: ld.staffName,
          position: staff ? staff.position : 'RN',
          clinic: staff ? staff.homeClinic : PREMIUM_CLINIC_GROUP,
          leaveType: ld.leaveType,
          days: numericDays,
          note: formattedNote,
        });
      });
      if (skippedNames.length > 0) {
        showToast(`ข้ามรายการลาซ้ำในวันเดียวกัน (${skippedNames.join(', ')}) เนื่องจากมีอยู่ในฐานข้อมูลแล้ว`, 'error');
      }
    }

    if (trainingData) {
      trainingData.forEach((td, idx) => {
        const staff = db.staff.find(s => s.name === td.staffName);
        newLeaveEntries.push({
          id: `TRN-AUTO-${Date.now()}-${idx}-${td.staffName}`,
          startDate: primaryEntry.date,
          endDate: primaryEntry.date,
          staffName: td.staffName,
          position: staff ? staff.position : 'RN',
          clinic: staff ? staff.homeClinic : PREMIUM_CLINIC_GROUP,
          leaveType: 'ไปอบรม/ประชุม',
          days: 1,
          note: [td.topic, td.note].filter(Boolean).join(' — ') || `ไปอบรม/ประชุม (บันทึกจาก ${PREMIUM_CLINIC_GROUP})`,
        });
      });
    }

    const crossList: WorkloadCrossCoveragePayload[] = Array.isArray(crossCoverageData)
      ? crossCoverageData
      : crossCoverageData
        ? [crossCoverageData]
        : [];

    crossList.forEach((cc, idx) => {
      if (!cc.staffName || !cc.targetClinic) return;
      const staff = db.staff.find(s => s.name === cc.staffName);
      const amount = cc.amount === 0.5 ? 0.5 : 1;
      const workClinicVal = formatOtWorkClinicValue(cc.targetClinic, amount, cc.periodLabel);
      const resolvedHome =
        cc.homeClinic ||
        (cc.isExternal ? (cc.affiliation || 'ภายนอก OPD') : (staff ? staff.homeClinic : PREMIUM_CLINIC_GROUP));
      const resolvedShift =
        cc.shift || (cc.isExternal ? 'OT ในเวลาราชการ 08:00-16:00' : primaryEntry.shift);
      newOtEntries.push({
        id: `OT-CROSS-${Date.now()}-${idx}`,
        date: primaryEntry.date,
        shift: resolvedShift,
        staffName: cc.staffName,
        position: cc.position || (staff ? staff.position : 'RN'),
        homeClinic: resolvedHome,
        workClinic: workClinicVal,
        ...(cc.isExternal
          ? { isExternal: true, affiliation: cc.affiliation || resolvedHome }
          : {}),
      });
    });

    entries.forEach(clearWorkloadTombstone);
    enqueuePendingOutboxWorkloads(entries);
    if (newLeaveEntries.length > 0) enqueuePendingOutboxLeaves(newLeaveEntries);
    if (newOtEntries.length > 0) enqueuePendingOutboxOt(newOtEntries);

    mutationSeqRef.current += 1;
    const baseDb = dbRef.current;
    const nextDb = {
      ...baseDb,
      workloads: [...entries, ...baseDb.workloads],
      leaves: [...newLeaveEntries, ...baseDb.leaves],
      ot: [...newOtEntries, ...baseDb.ot],
    };
    dbRef.current = nextDb;
    setDb(nextDb);

    const subCount = entries.filter(e => e.recordType === 'PREMIUM_SUB').length;
    showToast(
      subCount > 0
        ? `บันทึกข้อมูล ${PREMIUM_CLINIC_GROUP} (${subCount} แผนกย่อย) สำเร็จ!`
        : `บันทึกข้อมูล ${PREMIUM_CLINIC_GROUP} สำเร็จ!`,
      'success'
    );

    if (dbRef.current.settings.autoSync === false) return;
    const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
    const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

    if (targetGasUrl) {
      let allOk = await appendViaAppsScript(targetGasUrl, 'appendWorkload', entries);
      if (allOk) markWorkloadOutboxSynced(entries);
      for (const l of newLeaveEntries) {
        const ok = await appendViaAppsScript(targetGasUrl, 'appendLeave', l);
        if (ok) markLeaveOutboxSynced([l]);
        else allOk = false;
      }
      for (const o of newOtEntries) {
        const ok = await appendViaAppsScript(targetGasUrl, 'appendOT', o);
        if (ok) markOtOutboxSynced([o]);
        else allOk = false;
      }
      if (allOk) {
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
      } else {
        showToast('บันทึกในเครื่องแล้ว (กำลังรอซิงค์เข้า Google Sheet อัตโนมัติ)', 'error');
      }
      void performBackgroundSync('edit');
    } else if (targetSheetId) {
      const token = await getAccessToken();
      if (token) {
        const wOk = await appendDailyWorkloadToSheet(token, targetSheetId, entries);
        if (wOk) markWorkloadOutboxSynced(entries);
        for (const l of newLeaveEntries) {
          if (await appendLeaveToSheet(token, targetSheetId, l)) {
            markLeaveOutboxSynced([l]);
          }
        }
        for (const o of newOtEntries) {
          if (await appendOTToSheet(token, targetSheetId, o)) {
            markOtOutboxSynced([o]);
          }
        }
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        void performBackgroundSync('edit');
      }
    }
  };

  const recordAuditToSheet = async (auditEntry: AuditLogEntry) => {
    const gasUrl = (dbRef.current.settings.gasUrl || '').trim();
    if (gasUrl && unlockedAdminPinRef.current) {
      const ok = await appendAuditViaAppsScript(gasUrl, unlockedAdminPinRef.current, auditEntry);
      if (ok) return;
    }
    const token = await getAccessToken();
    if (token && dbRef.current.settings.spreadsheetId) {
      await appendAuditLogToSheet(token, dbRef.current.settings.spreadsheetId, auditEntry);
    }
  };

  type TargetedAdminRowSpec = {
    action: 'updateWorkload' | 'deleteWorkload' | 'updateLeave' | 'deleteLeave' | 'updateOT' | 'deleteOT';
    target: DailyWorkload | LeaveRecord | OTAttendance;
    updated?: DailyWorkload | LeaveRecord | OTAttendance;
    opSeq: number;
  };

  // Sequential direct Admin sync queue (always executes regardless of autoSync setting)
  const enqueueAdminSync = (
    table: 'workloads' | 'leaves' | 'ot' | 'staff' | 'settings',
    expectedDirtyVersion: number,
    auditEntry?: AuditLogEntry,
    targetedRow?: TargetedAdminRowSpec
  ) => {
    adminWriteQueueRef.current = adminWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        adminWriteInFlightRef.current = true;
        try {
          const latestDb = dbRef.current;
          const targetGasUrl = (latestDb.settings.gasUrl || '').trim();
          const targetSheetId = (latestDb.settings.spreadsheetId || '').trim();
          const pin = unlockedAdminPinRef.current;

          if (targetGasUrl && pin) {
            if (
              targetedRow &&
              auditEntry &&
              (table === 'workloads' || table === 'leaves' || table === 'ot')
            ) {
              const targetRes = await pushTargetedAdminRowMutationViaAppsScript({
                gasUrl: targetGasUrl,
                adminPin: pin,
                action: targetedRow.action,
                table,
                target: targetedRow.target,
                updated: targetedRow.updated,
                db: latestDb,
                auditEntry,
                expectedDirtyVersion,
              });

              if (targetRes.syncedDb && mutationSeqRef.current === targetedRow.opSeq) {
                dbRef.current = targetRes.syncedDb;
                setDb(targetRes.syncedDb);
                lastSyncEpochRef.current = Date.now();
                setLastSyncedAt(formatSyncTime());
              }

              if (targetRes.ok) {
                lastSyncEpochRef.current = Date.now();
                setLastSyncedAt(formatSyncTime());
                return;
              }

              if (targetRes.notFound) {
                showToast(
                  targetRes.error ||
                    'รายการนี้ถูกแก้ไขหรือลบจากเครื่องอื่นไปแล้ว ระบบซิงค์ข้อมูลล่าสุดให้แล้ว',
                  'info'
                );
                return;
              }

              const token = await getAccessToken();
              if (token && targetSheetId) {
                const oauthRes = await pushAdminTableViaOAuth({
                  accessToken: token,
                  spreadsheetId: targetSheetId,
                  table,
                  db: latestDb,
                  auditEntry,
                  expectedDirtyVersion,
                });
                if (oauthRes.ok) {
                  lastSyncEpochRef.current = Date.now();
                  setLastSyncedAt(formatSyncTime());
                  return;
                }
              }

              if (auditEntry) {
                await recordAuditToSheet(auditEntry);
              }
              showToast(
                `บันทึกในหน้าเว็บแล้ว แต่เขียนทับ Google Sheet ไม่สำเร็จ: ${targetRes.error || 'กรุณาตรวจสอบ Web App URL / Code.gs'}`,
                'error'
              );
              return;
            }

            const gasRes = await pushAdminTableViaAppsScript({
              gasUrl: targetGasUrl,
              adminPin: pin,
              table,
              db: latestDb,
              auditEntry,
              expectedDirtyVersion,
            });
            if (gasRes.ok) {
              lastSyncEpochRef.current = Date.now();
              setLastSyncedAt(formatSyncTime());
              if (dbRef.current.settings.autoSync !== false) {
                window.setTimeout(() => {
                  void performBackgroundSync('edit');
                }, 0);
              }
              return;
            }

            const token = await getAccessToken();
            if (token && targetSheetId) {
              const oauthRes = await pushAdminTableViaOAuth({
                accessToken: token,
                spreadsheetId: targetSheetId,
                table,
                db: latestDb,
                auditEntry,
                expectedDirtyVersion,
              });
              if (oauthRes.ok) {
                lastSyncEpochRef.current = Date.now();
                setLastSyncedAt(formatSyncTime());
                return;
              }
            }

            if (auditEntry) {
              await recordAuditToSheet(auditEntry);
            }
            showToast(
              `บันทึกในหน้าเว็บแล้ว แต่เขียนทับ Google Sheet ไม่สำเร็จ: ${gasRes.error || 'กรุณาตรวจสอบ Web App URL / Code.gs'}`,
              'error'
            );
            return;
          }

          if (targetSheetId) {
            const token = await getAccessToken();
            if (token) {
              const oauthRes = await pushAdminTableViaOAuth({
                accessToken: token,
                spreadsheetId: targetSheetId,
                table,
                db: latestDb,
                auditEntry,
                expectedDirtyVersion,
              });
              if (oauthRes.ok) {
                lastSyncEpochRef.current = Date.now();
                setLastSyncedAt(formatSyncTime());
                return;
              }
              showToast(`บันทึกทับ Google Sheet ไม่สำเร็จ: ${oauthRes.error || 'OAuth error'}`, 'error');
              return;
            }
          }

          if (auditEntry) {
            await recordAuditToSheet(auditEntry);
          }
        } finally {
          adminWriteInFlightRef.current = false;
        }
      });
  };

  // Handler: Update Daily Workload (Admin, mandatory reason + timestamp)
  const handleUpdateWorkload = (updated: DailyWorkload, reason: string) => {
    if (!isAdmin) {
      showToast('การแก้ไขข้อมูลสงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason) return;
    const baseDb = dbRef.current;
    const nowIso = new Date().toISOString();
    const editedBy = adminOwnerName || 'ผู้ดูแลระบบ';
    const prevItem = baseDb.workloads.find(w => w.id === updated.id);

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
    enqueuePendingOutboxAuditLogs([auditEntry]);

    const nextWorkloads = baseDb.workloads.map(w => w.id === stamped.id ? stamped : w);
    const prevWasInOutbox = prevItem
      ? getPendingOutboxWorkloads().some(
          (w) => w.id === prevItem.id || getWorkloadKey(w) === getWorkloadKey(prevItem)
        )
      : false;
    if (prevItem) {
      if (prevWasInOutbox) {
        markWorkloadOutboxSynced([prevItem]);
      }
      const oldKey = getWorkloadKey(prevItem);
      const newKey = getWorkloadKey(stamped);
      if (oldKey !== newKey && !nextWorkloads.some(w => getWorkloadKey(w) === oldKey)) {
        recordDeletedWorkloadTombstone(prevItem);
      }
    }
    clearWorkloadTombstone(stamped);

    mutationSeqRef.current += 1;
    const opSeq = mutationSeqRef.current;
    const dirtyVer = markWorkloadsDirty();
    const nextDb = {
      ...baseDb,
      workloads: nextWorkloads,
      auditLogs: [auditEntry, ...(baseDb.auditLogs || [])],
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast(`อัปเดตข้อมูลภาระงานห้องตรวจ ${updated.clinic} พร้อมบันทึกเหตุผลแล้ว`, 'success');
    enqueueAdminSync(
      'workloads',
      dirtyVer,
      auditEntry,
      prevItem && !prevWasInOutbox
        ? { action: 'updateWorkload', target: prevItem, updated: stamped, opSeq }
        : undefined
    );
  };

  // Handler: Delete Daily Workload (Admin, mandatory reason + timestamp)
  const handleDeleteWorkload = (id: string, reason: string) => {
    if (!isAdmin) {
      showToast('การลบข้อมูลสงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason) return;
    const baseDb = dbRef.current;
    const target = baseDb.workloads.find(w => w.id === id);
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
    enqueuePendingOutboxAuditLogs([auditEntry]);

    const nextWorkloads = baseDb.workloads.filter(w => w.id !== id);
    if (target) {
      markWorkloadOutboxSynced([target]);
      const targetKey = getWorkloadKey(target);
      if (!nextWorkloads.some(w => getWorkloadKey(w) === targetKey)) {
        recordDeletedWorkloadTombstone(target);
      }
    }

    mutationSeqRef.current += 1;
    const opSeq = mutationSeqRef.current;
    const dirtyVer = markWorkloadsDirty();
    const nextDb = {
      ...baseDb,
      workloads: nextWorkloads,
      auditLogs: [auditEntry, ...(baseDb.auditLogs || [])],
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast('ลบรายการภาระงานพร้อมบันทึกเหตุผลเรียบร้อยแล้ว', 'info');
    enqueueAdminSync(
      'workloads',
      dirtyVer,
      auditEntry,
      target ? { action: 'deleteWorkload', target, opSeq } : undefined
    );
  };

  // Handler: Save Leave (Data Entry: allowed via GAS or OAuth)
  const handleSaveLeave = async (leave: LeaveRecord) => {
    const cleanName = (leave.staffName || '').trim();
    const lStart = (leave.startDate || '').trim();
    const lEnd = (leave.endDate || lStart).trim();
    const isTrain = isTrainingLeaveType(leave.leaveType);
    const conflict = dbRef.current.leaves.find(existing => {
      if ((existing.staffName || '').trim() !== cleanName) return false;
      if (isTrain !== isTrainingLeaveType(existing.leaveType)) return false;
      const exStart = (existing.startDate || '').trim();
      const exEnd = (existing.endDate || exStart).trim();
      return Boolean(exStart) && exStart <= lEnd && exEnd >= lStart;
    });
    if (conflict) {
      showToast(
        `ไม่สามารถบันทึกได้: ${cleanName} มีรายการ "${conflict.leaveType}" ในวันที่ซ้ำซ้อน (${conflict.startDate}) อยู่ในฐานข้อมูลแล้ว`,
        'error'
      );
      return;
    }

    clearLeaveTombstone(leave);
    enqueuePendingOutboxLeaves([leave]);
    mutationSeqRef.current += 1;
    const baseDb = dbRef.current;
    const nextDb = {
      ...baseDb,
      leaves: [leave, ...baseDb.leaves],
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast(`บันทึกวันลา ${leave.staffName} สำเร็จ!`, 'success');

    if (dbRef.current.settings.autoSync === false) return;
    const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
    const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

    if (targetGasUrl) {
      const ok = await appendViaAppsScript(targetGasUrl, 'appendLeave', leave);
      if (ok) {
        markLeaveOutboxSynced([leave]);
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
      } else {
        showToast('บันทึกวันลาในเครื่องแล้ว (กำลังรอซิงค์เข้า Google Sheet อัตโนมัติ)', 'error');
      }
      void performBackgroundSync('edit');
    } else if (targetSheetId) {
      const token = await getAccessToken();
      if (token) {
        const ok = await appendLeaveToSheet(token, targetSheetId, leave);
        if (ok) markLeaveOutboxSynced([leave]);
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        void performBackgroundSync('edit');
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
    const baseDb = dbRef.current;
    const nowIso = new Date().toISOString();
    const editedBy = adminOwnerName || 'ผู้ดูแลระบบ';
    const prevItem = baseDb.leaves.find(l => l.id === updated.id);

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

    enqueuePendingOutboxAuditLogs([auditEntry]);

    const nextLeaves = baseDb.leaves.map(l => l.id === stamped.id ? stamped : l);
    const prevWasInOutbox = prevItem
      ? getPendingOutboxLeaves().some(
          (l) => l.id === prevItem.id || getLeaveKey(l) === getLeaveKey(prevItem)
        )
      : false;
    if (prevItem) {
      if (prevWasInOutbox) {
        markLeaveOutboxSynced([prevItem]);
      }
      const oldKey = getLeaveKey(prevItem);
      const newKey = getLeaveKey(stamped);
      if (oldKey !== newKey && !nextLeaves.some(l => getLeaveKey(l) === oldKey)) {
        recordDeletedLeaveTombstone(prevItem);
      }
    }
    clearLeaveTombstone(stamped);

    mutationSeqRef.current += 1;
    const opSeq = mutationSeqRef.current;
    const dirtyVer = markLeavesDirty();
    const nextDb = {
      ...baseDb,
      leaves: nextLeaves,
      auditLogs: [auditEntry, ...(baseDb.auditLogs || [])],
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast(`อัปเดตประวัติการลา ${stamped.staffName} พร้อมบันทึกเหตุผลแล้ว`, 'success');
    enqueueAdminSync(
      'leaves',
      dirtyVer,
      auditEntry,
      prevItem && !prevWasInOutbox
        ? { action: 'updateLeave', target: prevItem, updated: stamped, opSeq }
        : undefined
    );
  };

  // Handler: Delete Leave (Admin, mandatory reason + timestamp)
  const handleDeleteLeave = (id: string, reason: string) => {
    if (!isAdmin) {
      showToast('การลบวันลาสงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason) return;
    const baseDb = dbRef.current;
    const target = baseDb.leaves.find(l => l.id === id);
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
    enqueuePendingOutboxAuditLogs([auditEntry]);

    const nextLeaves = baseDb.leaves.filter(l => l.id !== id);
    if (target) {
      markLeaveOutboxSynced([target]);
      const targetKey = getLeaveKey(target);
      if (!nextLeaves.some(l => getLeaveKey(l) === targetKey)) {
        recordDeletedLeaveTombstone(target);
      }
    }

    mutationSeqRef.current += 1;
    const opSeq = mutationSeqRef.current;
    const dirtyVer = markLeavesDirty();
    const nextDb = {
      ...baseDb,
      leaves: nextLeaves,
      auditLogs: [auditEntry, ...(baseDb.auditLogs || [])],
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast('ลบประวัติการลาพร้อมบันทึกเหตุผลเรียบร้อยแล้ว', 'info');
    enqueueAdminSync(
      'leaves',
      dirtyVer,
      auditEntry,
      target ? { action: 'deleteLeave', target, opSeq } : undefined
    );
  };

  // Handler: Save Batch OT (Data Entry: allowed via GAS or OAuth)
  const handleSaveBatchOT = async (records: OTAttendance[]) => {
    if (!records || records.length === 0) return;
    records.forEach(clearOtTombstone);
    enqueuePendingOutboxOt(records);
    mutationSeqRef.current += 1;
    const baseDb = dbRef.current;
    const nextDb = {
      ...baseDb,
      ot: [...records, ...baseDb.ot],
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast(`บันทึกเวรนอกเวลาจำนวน ${records.length} คน เรียบร้อยแล้ว!`, 'success');

    if (dbRef.current.settings.autoSync === false) return;
    const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
    const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

    if (targetGasUrl) {
      const ok = await appendViaAppsScript(targetGasUrl, 'appendOT', records);
      if (ok) {
        markOtOutboxSynced(records);
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
      } else {
        showToast('บันทึกเวร OT ในเครื่องแล้ว (กำลังรอซิงค์เข้า Google Sheet อัตโนมัติ)', 'error');
      }
      void performBackgroundSync('edit');
    } else if (targetSheetId) {
      const token = await getAccessToken();
      if (token) {
        for (const r of records) {
          if (await appendOTToSheet(token, targetSheetId, r)) {
            markOtOutboxSynced([r]);
          }
        }
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        void performBackgroundSync('edit');
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
    const baseDb = dbRef.current;
    const nowIso = new Date().toISOString();
    const editedBy = adminOwnerName || 'ผู้ดูแลระบบ';
    const prevItem = baseDb.ot.find(o => o.id === updated.id);

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
    enqueuePendingOutboxAuditLogs([auditEntry]);

    const nextOt = baseDb.ot.map(o => o.id === stamped.id ? stamped : o);
    const prevWasInOutbox = prevItem
      ? getPendingOutboxOt().some(
          (o) => o.id === prevItem.id || getOtKey(o) === getOtKey(prevItem)
        )
      : false;
    if (prevItem) {
      if (prevWasInOutbox) {
        markOtOutboxSynced([prevItem]);
      }
      const oldKey = getOtKey(prevItem);
      const newKey = getOtKey(stamped);
      if (oldKey !== newKey && !nextOt.some(o => getOtKey(o) === oldKey)) {
        recordDeletedOtTombstone(prevItem);
      }
    }
    clearOtTombstone(stamped);

    mutationSeqRef.current += 1;
    const opSeq = mutationSeqRef.current;
    const dirtyVer = markOtDirty();
    const stampedEmpCode = (stamped.employeeCode || '').trim();
    let nextStaffList = baseDb.staff;
    let promotedStaffDirtyVer: number | null = null;
    if (!stamped.isExternal && isValidEmployeeCodeValue(stampedEmpCode)) {
      const targetName = stamped.staffName.trim();
      const matchedIdx = baseDb.staff.findIndex((s) => s.name.trim() === targetName);
      if (matchedIdx >= 0) {
        const matched = baseDb.staff[matchedIdx];
        const existingCode = getStaffEmployeeCode(matched);
        const codeTakenByOther = baseDb.staff.some(
          (s, i) =>
            i !== matchedIdx &&
            (s.staffId === stampedEmpCode || getStaffEmployeeCode(s) === stampedEmpCode)
        );
        if (!existingCode && isLegacyGeneratedStaffId(matched.staffId) && !codeTakenByOther) {
          promotedStaffDirtyVer = markStaffMasterDirty();
          nextStaffList = baseDb.staff.map((s, i) =>
            i === matchedIdx
              ? { ...s, staffId: stampedEmpCode, employeeCode: stampedEmpCode }
              : s
          );
        }
      }
    }

    const nextDb = {
      ...baseDb,
      staff: nextStaffList,
      ot: nextOt,
      auditLogs: [auditEntry, ...(baseDb.auditLogs || [])],
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast(`อัปเดตเวรนอกเวลา ${stamped.staffName} พร้อมบันทึกเหตุผลแล้ว`, 'success');
    enqueueAdminSync(
      'ot',
      dirtyVer,
      auditEntry,
      prevItem && !prevWasInOutbox
        ? { action: 'updateOT', target: prevItem, updated: stamped, opSeq }
        : undefined
    );
    if (promotedStaffDirtyVer !== null) {
      enqueueAdminSync('staff', promotedStaffDirtyVer);
    }
  };

  // Handler: Delete OT (Admin, mandatory reason + timestamp)
  const handleDeleteOT = (id: string, reason: string) => {
    if (!isAdmin) {
      showToast('การลบเวร OT สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const cleanReason = reason.trim();
    if (!cleanReason) return;
    const baseDb = dbRef.current;
    const target = baseDb.ot.find(o => o.id === id);
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
    enqueuePendingOutboxAuditLogs([auditEntry]);

    const nextOt = baseDb.ot.filter(o => o.id !== id);
    if (target) {
      markOtOutboxSynced([target]);
      const targetKey = getOtKey(target);
      if (!nextOt.some(o => getOtKey(o) === targetKey)) {
        recordDeletedOtTombstone(target);
      }
    }

    mutationSeqRef.current += 1;
    const opSeq = mutationSeqRef.current;
    const dirtyVer = markOtDirty();
    const nextDb = {
      ...baseDb,
      ot: nextOt,
      auditLogs: [auditEntry, ...(baseDb.auditLogs || [])],
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast('ลบรายการเวรนอกเวลาพร้อมบันทึกเหตุผลแล้ว', 'info');
    enqueueAdminSync(
      'ot',
      dirtyVer,
      auditEntry,
      target ? { action: 'deleteOT', target, opSeq } : undefined
    );
  };

  // Handler: Add Staff Member
  const handleAddStaff = async (staff: StaffMember) => {
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const baseDb = dbRef.current;
    const resolvedCode = getStaffEmployeeCode(staff);
    const normalizedStaff: StaffMember = {
      ...staff,
      staffId: resolvedCode || staff.staffId,
      employeeCode: resolvedCode || undefined,
    };
    const nextStaff = [...baseDb.staff, normalizedStaff];
    let otChanged = false;
    const nextOt = resolvedCode
      ? baseDb.ot.map((o) => {
          if (
            !o.isExternal &&
            o.staffName.trim() === normalizedStaff.name.trim() &&
            (o.employeeCode || '').trim() !== resolvedCode
          ) {
            otChanged = true;
            return { ...o, employeeCode: resolvedCode };
          }
          return o;
        })
      : baseDb.ot;

    mutationSeqRef.current += 1;
    const dirtyVer = markStaffMasterDirty();
    const otDirtyVer = otChanged ? markOtDirty() : null;
    const nextDb = {
      ...baseDb,
      staff: nextStaff,
      ot: nextOt,
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast(`เพิ่มเจ้าหน้าที่ ${normalizedStaff.name} เข้าสู่ระบบแล้ว`, 'success');
    enqueueAdminSync('staff', dirtyVer);
    if (otDirtyVer !== null) {
      enqueueAdminSync('ot', otDirtyVer);
    }
  };

  // Handler: Delete Staff Member
  const handleDeleteStaff = async (staffId: string) => {
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const baseDb = dbRef.current;
    const target = baseDb.staff.find(s => s.staffId === staffId);
    const nextStaff = baseDb.staff.filter(s => s.staffId !== staffId);
    mutationSeqRef.current += 1;
    const dirtyVer = markStaffMasterDirty();
    const nextDb = {
      ...baseDb,
      staff: nextStaff,
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast(`ลบบุคลากร ${target?.name || ''} ออกจากระบบแล้ว`, 'info');
    enqueueAdminSync('staff', dirtyVer);
  };

  // Handler: Update Staff Member (Admin)
  const handleUpdateStaff = async (updatedStaff: StaffMember, previousStaffId?: string) => {
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const baseDb = dbRef.current;
    const matchId = previousStaffId || updatedStaff.staffId;
    const targetIdx = baseDb.staff.findIndex(
      (s) => s.staffId === matchId || s.staffId === updatedStaff.staffId
    );
    if (targetIdx < 0) return;

    const prevStaff = baseDb.staff[targetIdx];
    const resolvedCode = getStaffEmployeeCode(updatedStaff);
    const normalizedStaff: StaffMember = {
      ...updatedStaff,
      staffId: resolvedCode || prevStaff.staffId,
      employeeCode: resolvedCode || undefined,
    };
    const nextStaff = baseDb.staff.map((s, idx) =>
      idx === targetIdx ? normalizedStaff : s
    );

    const prevNameTrimmed = prevStaff.name.trim();
    const nextNameTrimmed = normalizedStaff.name.trim();
    let otChanged = false;
    const nextOt = resolvedCode
      ? baseDb.ot.map((o) => {
          if (o.isExternal) return o;
          const oName = o.staffName.trim();
          if (oName !== prevNameTrimmed && oName !== nextNameTrimmed) return o;
          if ((o.employeeCode || '').trim() === resolvedCode && oName === nextNameTrimmed) {
            return o;
          }
          otChanged = true;
          return {
            ...o,
            staffName: nextNameTrimmed,
            employeeCode: resolvedCode,
          };
        })
      : baseDb.ot;

    mutationSeqRef.current += 1;
    const dirtyVer = markStaffMasterDirty();
    const otDirtyVer = otChanged ? markOtDirty() : null;
    const nextDb = {
      ...baseDb,
      staff: nextStaff,
      ot: nextOt,
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast(`อัปเดตข้อมูลบุคลากร ${normalizedStaff.name} เรียบร้อยแล้ว`, 'success');
    enqueueAdminSync('staff', dirtyVer);
    if (otDirtyVer !== null) {
      enqueueAdminSync('ot', otDirtyVer);
    }
  };

  // Handler: Update Staff Status (Active / Resigned / Retired)
  const handleUpdateStaffStatus = async (staffId: string, status: StaffStatus) => {
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const baseDb = dbRef.current;
    const todayStr = new Date().toISOString().split('T')[0];
    const nextStaff = baseDb.staff.map(s => {
      if (s.staffId !== staffId) return s;
      if (status === 'Resigned' || status === 'Retired') {
        return { ...s, status, endDate: s.endDate || todayStr };
      }
      return { ...s, status, endDate: undefined };
    });
    mutationSeqRef.current += 1;
    const dirtyVer = markStaffMasterDirty();
    const nextDb = {
      ...baseDb,
      staff: nextStaff,
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast(`อัปเดตสถานะเป็น ${status} สำเร็จ`, 'info');
    enqueueAdminSync('staff', dirtyVer);
  };

  // Handler: Save Settings
  const handleSaveSettings = (settings: SystemSettings) => {
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const baseDb = dbRef.current;
    mutationSeqRef.current += 1;
    const dirtyVer = markSettingsDirty();
    const nextDb = {
      ...baseDb,
      settings,
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    showToast('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
    enqueueAdminSync('settings', dirtyVer);
  };

  // Handler: Toggle Auto Sync
  const handleToggleAutoSync = (enabled: boolean) => {
    if (!isAdmin) return;
    const baseDb = dbRef.current;
    mutationSeqRef.current += 1;
    const dirtyVer = markSettingsDirty();
    const nextDb = {
      ...baseDb,
      settings: {
        ...baseDb.settings,
        autoSync: enabled,
      },
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    enqueueAdminSync('settings', dirtyVer);
    showToast(
      enabled
        ? 'เปิดใช้งาน Auto ซิงค์ทุกครั้งที่กดบันทึกแล้ว'
        : 'ปิดโหมด Auto ซิงค์ชั่วคราว (สามารถกดปุ่มซิงค์เองได้)',
      'info'
    );
  };

  // Handler: Reset to clean empty production data
  const handleResetData = () => {
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    mutationSeqRef.current += 1;
    localStorage.removeItem('pcmc_opd_system_db_v1');
    clearAllTombstones();
    clearAllPendingOutbox();
    clearWorkloadsDirty();
    clearLeavesDirty();
    clearOtDirty();
    clearSettingsDirty();
    clearStaffMasterDirty();
    markStaffMasterDirty();
    const clean = loadLocalDatabase();
    dbRef.current = clean;
    setDb(clean);
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex-1 w-full space-y-5 print:max-w-none print:px-0 print:py-0">
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
            leaves={db.leaves}
            otRecords={db.ot}
            inTimeClinics={inTimeClinics}
            outTimeClinics={outTimeClinics}
            premiumSubClinics={premiumSubClinics}
            leaveTypes={leaveTypes}
            onSaveWorkload={handleSaveWorkload}
            onSaveBatchWorkloads={handleSaveBatchWorkloads}
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
            settings={db.settings}
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
            premiumSubClinics={premiumSubClinics}
            isAdmin={isAdmin}
            onUpdateWorkload={handleUpdateWorkload}
            onDeleteWorkload={handleDeleteWorkload}
          />
        )}

        {/* Tab 4: Monthly Productivity & Skill Mix */}
        {activeTab === 'productivity' && (
          <ProductivityTab
            workloads={db.workloads}
            staffList={db.staff}
            leaves={db.leaves}
            otRecords={db.ot}
            settings={db.settings}
            inTimeClinics={inTimeClinics}
            outTimeClinics={outTimeClinics}
            premiumSubClinics={premiumSubClinics}
          />
        )}

        {/* Tab 5: Admin Panel & Staff Master */}
        {activeTab === 'admin' && (
          <AdminPanelTab
            staffList={db.staff}
            settings={db.settings}
            inTimeClinics={inTimeClinics}
            outTimeClinics={outTimeClinics}
            premiumSubClinics={premiumSubClinics}
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
