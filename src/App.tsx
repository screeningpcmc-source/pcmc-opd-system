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
  isValidEmployeeCodeValue,
  isOtDuplicateConflict,
  parseLeavePeriodFromNote,
  WorkShift,
  DEFAULT_LINE_AUTO_TIME,
  DEFAULT_LINE_GROUP_ID,
  DEFAULT_LINE_TARGET_GROUPS,
  DEFAULT_LINE_SCHEDULES,
  LineAutoReportDayMode,
  LineTargetGroup,
  LineReportSchedule,
  LineSendFormat,
  resolveLineSendFormat,
  normalizeLineTimeString,
  isOffDutyWorkload,
  getWorkloadOffDutyReason,
  getWorkloadOffDutyStaff,
  normalizeWorkloadDateStr,
  normalizeWorkloadShiftStr,
  DEFAULT_BOOBY_OWNER_NAME
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
  computeChangedSettingsEntries,
  pushAdminTableViaAppsScript,
  pushTargetedAdminRowMutationViaAppsScript,
  pushTargetedAdminStaffMutationViaAppsScript,
  pushTargetedSettingsKeysViaAppsScript,
  pushAdminTableViaOAuth,
  pushTargetedAdminRowViaOAuth,
  pushTargetedStaffViaOAuth,
  pushTargetedSettingsKeysViaOAuth,
  appendDailyWorkloadToSheet,
  appendLeaveToSheet,
  appendOTToSheet,
  appendAuditLogToSheet,
  ensureSheetAnyoneReaderPermission,
  readPublicGoogleSheet,
  appendViaAppsScript,
  syncPublicViaAppsScript,
  syncAdminViaAppsScript,
  appendAuditViaAppsScript,
  markWorkloadsRecentlySaved,
  removeWorkloadRecentlySaved,
  markLeavesRecentlySaved,
  removeLeaveRecentlySaved,
  markOtRecentlySaved,
  removeOtRecentlySaved,
  clearAllRecentlySaved,
  configureLineAutomationViaAppsScript,
  sendLineDailyCensusNowViaAppsScript,
  fetchLineAutomationStatusViaAppsScript,
  configureLineViaServerProxy,
  sendLineMessageViaServerProxy,
  uploadLineReportJpegViaAppsScript,
  saveUnitCostCenterViaAppsScript,
  fetchServerDatabaseSnapshot,
  pushServerMutation,
  pushServerSync,
  applyServerTombstonesLocally,
  normalizeIncomingServerDb,
  ServerSnapshotResponse,
  LineAutomationStatusInfo,
  AppDatabase
} from './services/sheetsService';
import { buildDailyCensusLineMessage, resolveLineAutoReportDate } from './utils/lineReport';
import { renderDailyCensusReportJpegDataUrl } from './utils/censusJpegGenerator';
import { doesDateMatchLineDayRule } from './utils/thaiHolidays';
import { formatThaiLeaveRange, formatThaiShortDate, getLocalTodayIso } from './utils/thaiDate';
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
import { CqiReportModal } from './components/CqiReportModal';
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
  const [showCqiModal, setShowCqiModal] = useState<boolean>(false);

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
  const serverVersionRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  // Toast State
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

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

  const applyAuthoritativeServerSnapshot = useCallback(
    (
      snapshot: ServerSnapshotResponse | null | undefined,
      source: 'init' | 'ws' | 'self_ws' | 'sync' | 'mutate'
    ): boolean => {
      if (!snapshot || !snapshot.ok) return false;
      applyServerTombstonesLocally(snapshot.tombstones);

      const incomingVer = Number(snapshot.version) || 0;
      if (source === 'self_ws') {
        if (incomingVer > serverVersionRef.current) {
          serverVersionRef.current = incomingVer;
        }
        return true;
      }

      if (source === 'mutate') {
        const prevVer = serverVersionRef.current;
        if (incomingVer > prevVer) {
          serverVersionRef.current = incomingVer;
        }
        // Only hydrate if server skipped ahead due to concurrent edits from other machines
        if (!(prevVer > 0 && incomingVer > prevVer + 1)) {
          return true;
        }
      } else {
        if (incomingVer <= 0) return false;
        if (source !== 'init' && incomingVer <= serverVersionRef.current) {
          return false;
        }
        if (source === 'init' && incomingVer < serverVersionRef.current) {
          return false;
        }
        serverVersionRef.current = incomingVer;
      }

      const hydrated = normalizeIncomingServerDb(snapshot.db, dbRef.current);

      const boxW = getPendingOutboxWorkloads();
      const wIds = new Set(hydrated.workloads.map((w) => w.id));
      const wKeys = new Set(hydrated.workloads.map(getWorkloadKey));
      const syncedW = boxW.filter((w) => wIds.has(w.id) || wKeys.has(getWorkloadKey(w)));
      if (syncedW.length > 0) markWorkloadOutboxSynced(syncedW);
      const pendingW = boxW.filter((w) => !wIds.has(w.id) && !wKeys.has(getWorkloadKey(w)));

      const boxL = getPendingOutboxLeaves();
      const lIds = new Set(hydrated.leaves.map((l) => l.id));
      const lKeys = new Set(hydrated.leaves.map(getLeaveKey));
      const syncedL = boxL.filter((l) => lIds.has(l.id) || lKeys.has(getLeaveKey(l)));
      if (syncedL.length > 0) markLeaveOutboxSynced(syncedL);
      const pendingL = boxL.filter((l) => !lIds.has(l.id) && !lKeys.has(getLeaveKey(l)));

      const boxO = getPendingOutboxOt();
      const oIds = new Set(hydrated.ot.map((o) => o.id));
      const oKeys = new Set(hydrated.ot.map(getOtKey));
      const syncedO = boxO.filter((o) => oIds.has(o.id) || oKeys.has(getOtKey(o)));
      if (syncedO.length > 0) markOtOutboxSynced(syncedO);
      const pendingO = boxO.filter((o) => !oIds.has(o.id) && !oKeys.has(getOtKey(o)));

      const mergedDb: AppDatabase = {
        ...hydrated,
        workloads: pendingW.length > 0 ? [...pendingW, ...hydrated.workloads] : hydrated.workloads,
        leaves: pendingL.length > 0 ? [...pendingL, ...hydrated.leaves] : hydrated.leaves,
        ot: pendingO.length > 0 ? [...pendingO, ...hydrated.ot] : hydrated.ot,
      };

      suppressNextBroadcastRef.current = true;
      dbRef.current = mergedDb;
      setDb(mergedDb);
      lastSyncEpochRef.current = Date.now();
      setLastSyncedAt(
        new Date().toLocaleTimeString('th-TH', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
      return true;
    },
    []
  );

  const propagateServerMutation = useCallback(
    async (action: string, payload: any) => {
      const res = await pushServerMutation({
        clientId: tabInstanceIdRef.current,
        action,
        payload,
      });
      if (res && res.ok) {
        applyAuthoritativeServerSnapshot(res, 'mutate');
      }
    },
    [applyAuthoritativeServerSnapshot]
  );

  // Real-time multi-machine WebSocket (/ws) + authoritative /api/db hydration + same-browser cross-tab sync
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let reconnectAttempt = 0;
    let hasConnectedOnce = false;

    const replayOfflineOutbox = async (currentDb: AppDatabase) => {
      const wIds = new Set(currentDb.workloads.map((w) => w.id));
      const wKeys = new Set(currentDb.workloads.map(getWorkloadKey));
      const pendingW = getPendingOutboxWorkloads().filter(
        (w) => !wIds.has(w.id) && !wKeys.has(getWorkloadKey(w))
      );

      const lIds = new Set(currentDb.leaves.map((l) => l.id));
      const lKeys = new Set(currentDb.leaves.map(getLeaveKey));
      const pendingL = getPendingOutboxLeaves().filter(
        (l) => !lIds.has(l.id) && !lKeys.has(getLeaveKey(l))
      );

      const oIds = new Set(currentDb.ot.map((o) => o.id));
      const oKeys = new Set(currentDb.ot.map(getOtKey));
      const pendingO = getPendingOutboxOt().filter(
        (o) => !oIds.has(o.id) && !oKeys.has(getOtKey(o))
      );

      if (pendingW.length > 0 || pendingL.length > 0 || pendingO.length > 0) {
        const res = await pushServerMutation({
          clientId: tabInstanceIdRef.current,
          action: 'addWorkloads',
          payload: { workloads: pendingW, leaves: pendingL, ot: pendingO },
        });
        if (res && res.ok && !disposed) {
          if (pendingW.length > 0) markWorkloadOutboxSynced(pendingW);
          if (pendingL.length > 0) markLeaveOutboxSynced(pendingL);
          if (pendingO.length > 0) markOtOutboxSynced(pendingO);
          applyAuthoritativeServerSnapshot(res, 'mutate');
        }
      }
    };

    const hydrateFromServer = async () => {
      const snap = await fetchServerDatabaseSnapshot();
      if (disposed || !snap || !snap.ok) return;
      if (snap.version > 0) {
        applyAuthoritativeServerSnapshot(snap, 'init');
        await replayOfflineOutbox(dbRef.current);
      } else {
        const seedRes = await pushServerSync({
          clientId: tabInstanceIdRef.current,
          baseVersion: 0,
          forceOverwrite: true,
          db: dbRef.current,
        });
        if (!disposed && seedRes && seedRes.ok) {
          serverVersionRef.current = Math.max(serverVersionRef.current, Number(seedRes.version) || 1);
        }
      }
    };

    void hydrateFromServer();

    const connectWebSocket = () => {
      if (disposed || typeof window === 'undefined' || typeof WebSocket === 'undefined') return;
      try {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
        wsRef.current = ws;

        ws.onopen = () => {
          if (disposed) {
            ws.close();
            return;
          }
          reconnectAttempt = 0;
          if (pingTimer !== null) window.clearInterval(pingTimer);
          pingTimer = window.setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ type: 'ping' }));
              } catch {
                // ignore
              }
            }
          }, 20_000);

          if (hasConnectedOnce) {
            void fetchServerDatabaseSnapshot().then(async (snap) => {
              if (!disposed && snap && snap.ok && snap.version > 0) {
                applyAuthoritativeServerSnapshot(snap, 'ws');
                await replayOfflineOutbox(dbRef.current);
              }
            });
          } else {
            hasConnectedOnce = true;
            if (serverVersionRef.current === 0) {
              try {
                ws.send(JSON.stringify({ type: 'sync:request' }));
              } catch {
                // ignore
              }
            }
          }
        };

        ws.onmessage = (event) => {
          if (disposed) return;
          try {
            const msg = JSON.parse(String(event.data || ''));
            if (msg?.type === 'db:state') {
              const isSelf = Boolean(msg.senderClientId && msg.senderClientId === tabInstanceIdRef.current);
              applyAuthoritativeServerSnapshot(
                {
                  ok: true,
                  version: Number(msg.version) || 0,
                  updatedAt: msg.updatedAt,
                  db: msg.db,
                  tombstones: msg.tombstones,
                },
                isSelf ? 'self_ws' : 'ws'
              );
            }
          } catch {
            // ignore non-JSON messages
          }
        };

        ws.onclose = () => {
          if (pingTimer !== null) {
            window.clearInterval(pingTimer);
            pingTimer = null;
          }
          if (wsRef.current === ws) wsRef.current = null;
          if (!disposed) {
            const delay = Math.min(10_000, 1000 * Math.pow(2, reconnectAttempt));
            reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
            reconnectTimer = window.setTimeout(connectWebSocket, delay);
          }
        };

        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            // ignore
          }
        };
      } catch {
        if (!disposed) {
          const delay = Math.min(10_000, 1000 * Math.pow(2, reconnectAttempt));
          reconnectAttempt = Math.min(reconnectAttempt + 1, 5);
          reconnectTimer = window.setTimeout(connectWebSocket, delay);
        }
      }
    };

    connectWebSocket();

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
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (pingTimer !== null) window.clearInterval(pingTimer);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }
      window.removeEventListener('storage', handleStorage);
      try {
        syncChannelRef.current?.close();
      } catch {
        // ignore
      }
      syncChannelRef.current = null;
    };
  }, [applyAuthoritativeServerSnapshot]);

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
          const updatedSettings: SystemSettings = {
            ...dbRef.current.settings,
            spreadsheetId: extractedId || dbRef.current.settings.spreadsheetId,
            spreadsheetUrl: extractedId
              ? `https://docs.google.com/spreadsheets/d/${extractedId}/edit`
              : dbRef.current.settings.spreadsheetUrl,
            gasUrl: sharedGasParam || dbRef.current.settings.gasUrl,
            isUnlinked: false,
          };
          const nextLinkedDb: AppDatabase = { ...dbRef.current, settings: updatedSettings };
          dbRef.current = nextLinkedDb;
          setDb(nextLinkedDb);
          void propagateServerMutation('saveSettings', { settings: updatedSettings });
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
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
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
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
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
        void pushServerSync({
          clientId: tabInstanceIdRef.current,
          baseVersion: serverVersionRef.current,
          mergeFromRemote: true,
          db: nextDb,
        }).then((srvRes) => {
          if (!srvRes || !srvRes.ok) return;
          if (srvRes.staleRejected) {
            applyAuthoritativeServerSnapshot(srvRes, 'sync');
          } else if (!srvRes.unchanged && srvRes.version > serverVersionRef.current) {
            serverVersionRef.current = srvRes.version;
          }
        });
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

      if (targetSheetId) {
        const token = await getPassiveGoogleToken();
        if (mutationSeqRef.current !== startSeq) {
          pendingSyncAfterFlightRef.current = true;
          return;
        }
        if (token) {
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

  // Background periodic polling (every 20s when tab visible) & focus/WS catch-up so open tabs stay aligned
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void performBackgroundSync('interval');
    }, 20_000);

    const handleWakeSync = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchServerDatabaseSnapshot().then((snap) => {
        if (snap && snap.ok && snap.version > serverVersionRef.current) {
          applyAuthoritativeServerSnapshot(snap, 'ws');
        }
      });
      if (Date.now() - lastSyncEpochRef.current > 5_000) {
        void performBackgroundSync('focus');
      }
    };
    window.addEventListener('focus', handleWakeSync);
    document.addEventListener('visibilitychange', handleWakeSync);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleWakeSync);
      document.removeEventListener('visibilitychange', handleWakeSync);
    };
  }, [performBackgroundSync, applyAuthoritativeServerSnapshot]);

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
        void pushServerSync({
          clientId: tabInstanceIdRef.current,
          baseVersion: serverVersionRef.current,
          mergeFromRemote: true,
          db: nextDb,
        }).then((srvRes) => {
          if (!srvRes || !srvRes.ok) return;
          if (srvRes.staleRejected) {
            applyAuthoritativeServerSnapshot(srvRes, 'sync');
          } else if (!srvRes.unchanged && srvRes.version > serverVersionRef.current) {
            serverVersionRef.current = srvRes.version;
          }
        });
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

      const updatedSettings: SystemSettings = {
        ...dbRef.current.settings,
        spreadsheetId,
        spreadsheetUrl,
      };
      const nextLinkedDb = { ...dbRef.current, settings: updatedSettings };
      dbRef.current = nextLinkedDb;
      setDb(nextLinkedDb);
      void propagateServerMutation('saveSettings', { settings: updatedSettings });

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
    const isDuplicateStandardWorkload =
      entry.recordType !== 'PREMIUM_SUB' &&
      entry.recordType !== 'PREMIUM_POOL' &&
      dbRef.current.workloads.some(
        w =>
          w.date === entry.date &&
          w.shift === entry.shift &&
          (w.clinic || '').trim() === (entry.clinic || '').trim() &&
          w.recordType !== 'PREMIUM_SUB' &&
          w.recordType !== 'PREMIUM_POOL'
      );
    if (isDuplicateStandardWorkload) {
      showToast(
        `ไม่สามารถบันทึกซ้ำได้: แผนก ${entry.clinic} วันที่ ${formatThaiShortDate(entry.date)} กะเวลา "${entry.shift}" มีข้อมูลในระบบแล้ว`,
        'error'
      );
      return;
    }

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
      const existingLeaves = dbRef.current.leaves;
      trainingData.forEach((td, idx) => {
        const cleanName = (td.staffName || '').trim();
        const isDuplicateInDb = existingLeaves.some(l => {
          if (!isTrainingLeaveType(l.leaveType)) return false;
          const sDate = (l.startDate || '').trim();
          const eDate = (l.endDate || l.startDate || '').trim();
          return (l.staffName || '').trim() === cleanName && Boolean(sDate) && entry.date >= sDate && entry.date <= eDate;
        });
        if (isDuplicateInDb) return;
        const staff = db.staff.find(s => s.name === td.staffName);
        const numericDays = Number(td.days) === 0.5 ? 0.5 : 1;
        const rawNote =
          [td.topic, td.note].filter(Boolean).join(' — ') ||
          `ไปอบรม/ประชุม (บันทึกจาก ${entry.clinic})`;
        newLeaveEntries.push({
          id: `TRN-AUTO-${Date.now()}-${idx}-${td.staffName}`,
          startDate: entry.date,
          endDate: entry.date,
          staffName: td.staffName,
          position: staff ? staff.position : 'RN',
          clinic: staff ? staff.homeClinic : entry.clinic,
          leaveType: 'ไปอบรม/ประชุม',
          days: numericDays,
          note: formatLeaveNoteWithPeriod(rawNote, numericDays, td.periodLabel),
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
      const candidateOt: OTAttendance = {
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
      };
      const dupInDbOrBatch =
        dbRef.current.ot.some(o => isOtDuplicateConflict(o, candidateOt)) ||
        newOtEntries.some(o => isOtDuplicateConflict(o, candidateOt));
      if (!dupInDbOrBatch) {
        newOtEntries.push(candidateOt);
      }
    });

    clearWorkloadTombstone(entry);
    markWorkloadsRecentlySaved([entry]);
    enqueuePendingOutboxWorkloads([entry]);
    if (newLeaveEntries.length > 0) {
      markLeavesRecentlySaved(newLeaveEntries);
      enqueuePendingOutboxLeaves(newLeaveEntries);
    }
    if (newOtEntries.length > 0) {
      markOtRecentlySaved(newOtEntries);
      enqueuePendingOutboxOt(newOtEntries);
    }

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
    void propagateServerMutation('addWorkloads', {
      workloads: [entry],
      leaves: newLeaveEntries,
      ot: newOtEntries,
    });

    const offStaffSavedCount = getWorkloadOffDutyStaff(entry).length;
    showToast(
      isOffDutyWorkload(entry)
        ? `บันทึกสถานะ Off เวรห้องตรวจ ${entry.clinic} สำเร็จ!`
        : offStaffSavedCount > 0
        ? `บันทึกภาระงานห้องตรวจ ${entry.clinic} (Off เวรรายวัน ${offStaffSavedCount} คน) สำเร็จ!`
        : `บันทึกภาระงานห้องตรวจ ${entry.clinic} สำเร็จ!`,
      'success'
    );

    // Auto-Sync on Save (append-only, batched & parallelized) to Google Sheets when Auto-Sync is enabled
    if (dbRef.current.settings.autoSync === false) return;
    const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
    const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

    if (targetGasUrl) {
      const [wOk, lOk, oOk] = await Promise.all([
        appendViaAppsScript(targetGasUrl, 'appendWorkload', entry).then((ok) => {
          if (ok) markWorkloadOutboxSynced([entry]);
          return ok;
        }),
        newLeaveEntries.length > 0
          ? appendViaAppsScript(targetGasUrl, 'appendLeave', newLeaveEntries).then((ok) => {
              if (ok) markLeaveOutboxSynced(newLeaveEntries);
              return ok;
            })
          : Promise.resolve(true),
        newOtEntries.length > 0
          ? appendViaAppsScript(targetGasUrl, 'appendOT', newOtEntries).then((ok) => {
              if (ok) markOtOutboxSynced(newOtEntries);
              return ok;
            })
          : Promise.resolve(true),
      ]);
      if (wOk && lOk && oOk) {
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        void performBackgroundSync('edit');
      } else {
        showToast('บันทึกในเครื่องแล้ว (รอซิงค์เข้า Google Sheet รอบถัดไปอัตโนมัติ)', 'info');
      }
    } else if (targetSheetId) {
      const token = await getAccessToken();
      if (token) {
        await Promise.all([
          appendDailyWorkloadToSheet(token, targetSheetId, entry).then((ok) => {
            if (ok) markWorkloadOutboxSynced([entry]);
          }),
          ...newLeaveEntries.map((l) =>
            appendLeaveToSheet(token, targetSheetId, l).then((ok) => {
              if (ok) markLeaveOutboxSynced([l]);
            })
          ),
          ...newOtEntries.map((o) =>
            appendOTToSheet(token, targetSheetId, o).then((ok) => {
              if (ok) markOtOutboxSynced([o]);
            })
          ),
        ]);
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        void performBackgroundSync('edit');
      } else {
        showToast('บันทึกข้อมูลไว้ในเครื่องนี้แล้ว (ยังไม่ได้เชื่อม Web App URL /exec หรือ Sign in Google จึงยังไม่ขึ้น Google Sheet)', 'info');
      }
    } else {
      showToast('บันทึกข้อมูลไว้ในเครื่องนี้แล้ว (ยังไม่ได้เชื่อมต่อ Google Sheets ในหน้า Admin)', 'info');
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
    const dupBatchEntry = entries.find(incoming =>
      dbRef.current.workloads.some(
        existing =>
          existing.date === incoming.date &&
          existing.shift === incoming.shift &&
          (existing.clinic || '').trim() === (incoming.clinic || '').trim() &&
          (existing.recordType || 'STANDARD') === (incoming.recordType || 'STANDARD')
      )
    );
    if (dupBatchEntry) {
      showToast(
        `ไม่สามารถบันทึกซ้ำได้: แผนก ${dupBatchEntry.clinic} วันที่ ${formatThaiShortDate(dupBatchEntry.date)} กะเวลา "${dupBatchEntry.shift}" มีข้อมูลในระบบแล้ว`,
        'error'
      );
      return;
    }
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
      const existingLeaves = dbRef.current.leaves;
      trainingData.forEach((td, idx) => {
        const cleanName = (td.staffName || '').trim();
        const isDuplicateInDb = existingLeaves.some(l => {
          if (!isTrainingLeaveType(l.leaveType)) return false;
          const sDate = (l.startDate || '').trim();
          const eDate = (l.endDate || l.startDate || '').trim();
          return (l.staffName || '').trim() === cleanName && Boolean(sDate) && primaryEntry.date >= sDate && primaryEntry.date <= eDate;
        });
        if (isDuplicateInDb) return;
        const staff = db.staff.find(s => s.name === td.staffName);
        const numericDays = Number(td.days) === 0.5 ? 0.5 : 1;
        const rawNote =
          [td.topic, td.note].filter(Boolean).join(' — ') ||
          `ไปอบรม/ประชุม (บันทึกจาก ${PREMIUM_CLINIC_GROUP})`;
        newLeaveEntries.push({
          id: `TRN-AUTO-${Date.now()}-${idx}-${td.staffName}`,
          startDate: primaryEntry.date,
          endDate: primaryEntry.date,
          staffName: td.staffName,
          position: staff ? staff.position : 'RN',
          clinic: staff ? staff.homeClinic : PREMIUM_CLINIC_GROUP,
          leaveType: 'ไปอบรม/ประชุม',
          days: numericDays,
          note: formatLeaveNoteWithPeriod(rawNote, numericDays, td.periodLabel),
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
      const candidateOt: OTAttendance = {
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
      };
      const dupInDbOrBatch =
        dbRef.current.ot.some(o => isOtDuplicateConflict(o, candidateOt)) ||
        newOtEntries.some(o => isOtDuplicateConflict(o, candidateOt));
      if (!dupInDbOrBatch) {
        newOtEntries.push(candidateOt);
      }
    });

    entries.forEach(clearWorkloadTombstone);
    markWorkloadsRecentlySaved(entries);
    enqueuePendingOutboxWorkloads(entries);
    if (newLeaveEntries.length > 0) {
      markLeavesRecentlySaved(newLeaveEntries);
      enqueuePendingOutboxLeaves(newLeaveEntries);
    }
    if (newOtEntries.length > 0) {
      markOtRecentlySaved(newOtEntries);
      enqueuePendingOutboxOt(newOtEntries);
    }

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
    void propagateServerMutation('addWorkloads', {
      workloads: entries,
      leaves: newLeaveEntries,
      ot: newOtEntries,
    });

    const subCount = entries.filter(e => e.recordType === 'PREMIUM_SUB').length;
    const batchOffStaffCount = entries.reduce((sum, e) => sum + getWorkloadOffDutyStaff(e).length, 0);
    const offSuffix = batchOffStaffCount > 0 ? ` (Off เวรรายวัน ${batchOffStaffCount} คน)` : '';
    showToast(
      isOffDutyWorkload(primaryEntry)
        ? `บันทึกสถานะ Off เวร ${PREMIUM_CLINIC_GROUP} สำเร็จ!`
        : subCount > 0
        ? `บันทึกข้อมูล ${PREMIUM_CLINIC_GROUP} (${subCount} แผนกย่อย)${offSuffix} สำเร็จ!`
        : `บันทึกข้อมูล ${PREMIUM_CLINIC_GROUP}${offSuffix} สำเร็จ!`,
      'success'
    );

    if (dbRef.current.settings.autoSync === false) return;
    const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
    const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

    if (targetGasUrl) {
      const [wOk, lOk, oOk] = await Promise.all([
        appendViaAppsScript(targetGasUrl, 'appendWorkload', entries).then((ok) => {
          if (ok) markWorkloadOutboxSynced(entries);
          return ok;
        }),
        newLeaveEntries.length > 0
          ? appendViaAppsScript(targetGasUrl, 'appendLeave', newLeaveEntries).then((ok) => {
              if (ok) markLeaveOutboxSynced(newLeaveEntries);
              return ok;
            })
          : Promise.resolve(true),
        newOtEntries.length > 0
          ? appendViaAppsScript(targetGasUrl, 'appendOT', newOtEntries).then((ok) => {
              if (ok) markOtOutboxSynced(newOtEntries);
              return ok;
            })
          : Promise.resolve(true),
      ]);
      if (wOk && lOk && oOk) {
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        void performBackgroundSync('edit');
      } else {
        showToast('บันทึกในเครื่องแล้ว (รอซิงค์เข้า Google Sheet รอบถัดไปอัตโนมัติ)', 'info');
      }
    } else if (targetSheetId) {
      const token = await getAccessToken();
      if (token) {
        await Promise.all([
          appendDailyWorkloadToSheet(token, targetSheetId, entries).then((ok) => {
            if (ok) markWorkloadOutboxSynced(entries);
          }),
          ...newLeaveEntries.map((l) =>
            appendLeaveToSheet(token, targetSheetId, l).then((ok) => {
              if (ok) markLeaveOutboxSynced([l]);
            })
          ),
          ...newOtEntries.map((o) =>
            appendOTToSheet(token, targetSheetId, o).then((ok) => {
              if (ok) markOtOutboxSynced([o]);
            })
          ),
        ]);
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        void performBackgroundSync('edit');
      } else {
        showToast('บันทึกข้อมูลไว้ในเครื่องนี้แล้ว (ยังไม่ได้เชื่อม Web App URL /exec หรือ Sign in Google จึงยังไม่ขึ้น Google Sheet)', 'info');
      }
    } else {
      showToast('บันทึกข้อมูลไว้ในเครื่องนี้แล้ว (ยังไม่ได้เชื่อมต่อ Google Sheets ในหน้า Admin)', 'info');
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
    insertIfMissing?: boolean;
    opSeq: number;
  };

  type TargetedAdminStaffSpec = {
    action: 'addStaff' | 'updateStaff' | 'deleteStaff';
    target?: StaffMember;
    updated?: StaffMember;
    previousStaffId?: string;
    propagateOt?: boolean;
    insertIfMissing?: boolean;
    otDirtyVer?: number | null;
    opSeq: number;
  };

  type TargetedAdminSettingsSpec = {
    changedEntries: Array<[string, string]>;
    opSeq: number;
  };

  type TargetedAdminMutationPayload =
    | TargetedAdminRowSpec
    | { staff: TargetedAdminStaffSpec }
    | { settings: TargetedAdminSettingsSpec };

  // Sequential direct Admin sync queue (always executes regardless of autoSync setting)
  const enqueueAdminSync = (
    table: 'workloads' | 'leaves' | 'ot' | 'staff' | 'settings',
    expectedDirtyVersion: number,
    auditEntry?: AuditLogEntry,
    targeted?: TargetedAdminMutationPayload
  ) => {
    const targetedRow =
      targeted && 'action' in targeted && 'target' in targeted && !('staff' in targeted)
        ? (targeted as TargetedAdminRowSpec)
        : undefined;
    const targetedStaff =
      targeted && 'staff' in targeted ? targeted.staff : undefined;
    const targetedSettings =
      targeted && 'settings' in targeted ? targeted.settings : undefined;

    adminWriteQueueRef.current = adminWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        adminWriteInFlightRef.current = true;
        try {
          const latestDb = dbRef.current;
          const targetGasUrl = (latestDb.settings.gasUrl || '').trim();
          const targetSheetId = (latestDb.settings.spreadsheetId || '').trim();
          const pin = unlockedAdminPinRef.current;

          if (targetedSettings && targetedSettings.changedEntries.length === 0) {
            clearSettingsDirty(expectedDirtyVersion);
            return;
          }

          if (targetGasUrl && pin) {
            // 1. Targeted single-row Workload / Leave / OT
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
                insertIfMissing: targetedRow.insertIfMissing,
                db: latestDb,
                auditEntry,
                expectedDirtyVersion,
              });

              const isDeleteAction = targetedRow.action.startsWith('delete');
              if (
                targetRes.syncedDb &&
                mutationSeqRef.current === targetedRow.opSeq &&
                (targetRes.ok || isDeleteAction)
              ) {
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

              if (targetRes.notFound && isDeleteAction) {
                showToast(
                  targetRes.error ||
                    'รายการนี้ถูกแก้ไขหรือลบจากเครื่องอื่นไปแล้ว ระบบซิงค์ข้อมูลล่าสุดให้แล้ว',
                  'info'
                );
                return;
              }

              const token = await getAccessToken();
              if (token && targetSheetId) {
                const oauthRes = await pushTargetedAdminRowViaOAuth({
                  accessToken: token,
                  spreadsheetId: targetSheetId,
                  action: targetedRow.action,
                  table,
                  target: targetedRow.target,
                  updated: targetedRow.updated,
                  insertIfMissing: targetedRow.insertIfMissing,
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

            // 2. Targeted single-row Staff_Master
            if (table === 'staff' && targetedStaff) {
              const staffRes = await pushTargetedAdminStaffMutationViaAppsScript({
                gasUrl: targetGasUrl,
                adminPin: pin,
                action: targetedStaff.action,
                target: targetedStaff.target,
                updated: targetedStaff.updated,
                previousStaffId: targetedStaff.previousStaffId,
                propagateOt: targetedStaff.propagateOt,
                insertIfMissing: targetedStaff.insertIfMissing,
                db: latestDb,
                auditEntry,
                expectedDirtyVersion,
                expectedOtDirtyVersion: targetedStaff.otDirtyVer,
              });

              if (staffRes.syncedDb && mutationSeqRef.current === targetedStaff.opSeq) {
                dbRef.current = staffRes.syncedDb;
                setDb(staffRes.syncedDb);
                lastSyncEpochRef.current = Date.now();
                setLastSyncedAt(formatSyncTime());
              }

              if (staffRes.ok) {
                lastSyncEpochRef.current = Date.now();
                setLastSyncedAt(formatSyncTime());
                return;
              }

              if (staffRes.notFound) {
                showToast(
                  staffRes.error || 'ไม่พบรายชื่อบุคลากรเดิมใน Google Sheets ระบบซิงค์ข้อมูลล่าสุดให้แล้ว',
                  'info'
                );
                return;
              }

              const token = await getAccessToken();
              if (token && targetSheetId) {
                const oauthRes = await pushTargetedStaffViaOAuth({
                  accessToken: token,
                  spreadsheetId: targetSheetId,
                  action: targetedStaff.action,
                  target: targetedStaff.target,
                  updated: targetedStaff.updated,
                  previousStaffId: targetedStaff.previousStaffId,
                  propagateOt: targetedStaff.propagateOt,
                  insertIfMissing: targetedStaff.insertIfMissing,
                  auditEntry,
                  expectedDirtyVersion,
                  expectedOtDirtyVersion: targetedStaff.otDirtyVer,
                });
                if (oauthRes.ok) {
                  lastSyncEpochRef.current = Date.now();
                  setLastSyncedAt(formatSyncTime());
                  return;
                }
              }

              showToast(
                `บันทึกในหน้าเว็บแล้ว แต่เขียนทับ Google Sheet ไม่สำเร็จ: ${staffRes.error || 'กรุณาตรวจสอบ Web App URL / Code.gs'}`,
                'error'
              );
              return;
            }

            // 3. Targeted Settings key-only updates
            if (table === 'settings' && targetedSettings) {
              const settingsRes = await pushTargetedSettingsKeysViaAppsScript({
                gasUrl: targetGasUrl,
                adminPin: pin,
                changedEntries: targetedSettings.changedEntries,
                db: latestDb,
                auditEntry,
                expectedDirtyVersion,
              });

              if (settingsRes.syncedDb && mutationSeqRef.current === targetedSettings.opSeq) {
                dbRef.current = settingsRes.syncedDb;
                setDb(settingsRes.syncedDb);
                lastSyncEpochRef.current = Date.now();
                setLastSyncedAt(formatSyncTime());
              }

              if (settingsRes.ok) {
                lastSyncEpochRef.current = Date.now();
                setLastSyncedAt(formatSyncTime());
                return;
              }

              const token = await getAccessToken();
              if (token && targetSheetId) {
                const oauthRes = await pushTargetedSettingsKeysViaOAuth({
                  accessToken: token,
                  spreadsheetId: targetSheetId,
                  changedEntries: targetedSettings.changedEntries,
                  auditEntry,
                  expectedDirtyVersion,
                });
                if (oauthRes.ok) {
                  lastSyncEpochRef.current = Date.now();
                  setLastSyncedAt(formatSyncTime());
                  return;
                }
              }

              showToast(
                `บันทึกการตั้งค่าแล้ว แต่เขียนทับ Google Sheet ไม่สำเร็จ: ${settingsRes.error || 'กรุณาตรวจสอบ Web App URL / Code.gs'}`,
                'error'
              );
              return;
            }

            // Fallback generic table push if called without targeted descriptor
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
              let oauthRes: { ok: boolean; error?: string };
              if (targetedRow && (table === 'workloads' || table === 'leaves' || table === 'ot')) {
                oauthRes = await pushTargetedAdminRowViaOAuth({
                  accessToken: token,
                  spreadsheetId: targetSheetId,
                  action: targetedRow.action,
                  table,
                  target: targetedRow.target,
                  updated: targetedRow.updated,
                  insertIfMissing: targetedRow.insertIfMissing,
                  auditEntry,
                  expectedDirtyVersion,
                });
              } else if (table === 'staff' && targetedStaff) {
                oauthRes = await pushTargetedStaffViaOAuth({
                  accessToken: token,
                  spreadsheetId: targetSheetId,
                  action: targetedStaff.action,
                  target: targetedStaff.target,
                  updated: targetedStaff.updated,
                  previousStaffId: targetedStaff.previousStaffId,
                  propagateOt: targetedStaff.propagateOt,
                  insertIfMissing: targetedStaff.insertIfMissing,
                  auditEntry,
                  expectedDirtyVersion,
                  expectedOtDirtyVersion: targetedStaff.otDirtyVer,
                });
              } else if (table === 'settings' && targetedSettings) {
                oauthRes = await pushTargetedSettingsKeysViaOAuth({
                  accessToken: token,
                  spreadsheetId: targetSheetId,
                  changedEntries: targetedSettings.changedEntries,
                  auditEntry,
                  expectedDirtyVersion,
                });
              } else {
                oauthRes = await pushAdminTableViaOAuth({
                  accessToken: token,
                  spreadsheetId: targetSheetId,
                  table,
                  db: latestDb,
                  auditEntry,
                  expectedDirtyVersion,
                });
              }
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

    const stampedOffCount = getWorkloadOffDutyStaff(stamped).length;
    const stampedLabel = isOffDutyWorkload(stamped)
      ? `Off เวร (${getWorkloadOffDutyReason(stamped) || 'งดออกตรวจ'})`
      : `ผู้ป่วย ${getEffectiveTotalPt(stamped)} คน${
          stampedOffCount > 0 ? ` • Off เวรรายวัน ${stampedOffCount} คน` : ''
        }`;
    const summary = prevItem
      ? `${prevItem.clinic} (${formatThaiShortDate(prevItem.date)} • ${prevItem.shift}) ${
          isOffDutyWorkload(prevItem) ? 'Off เวร' : `ผู้ป่วย ${getEffectiveTotalPt(prevItem)}`
        } → ${stampedLabel}`
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
      removeWorkloadRecentlySaved(prevItem);
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
    markWorkloadsRecentlySaved([stamped]);

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
    void propagateServerMutation('updateWorkload', {
      target: prevItem,
      updated: stamped,
      auditEntry,
    });
    showToast(`อัปเดตข้อมูลภาระงานห้องตรวจ ${updated.clinic} พร้อมบันทึกเหตุผลแล้ว`, 'success');
    enqueueAdminSync(
      'workloads',
      dirtyVer,
      auditEntry,
      prevItem
        ? {
            action: 'updateWorkload',
            target: prevItem,
            updated: stamped,
            insertIfMissing: true,
            opSeq,
          }
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
      removeWorkloadRecentlySaved(target);
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
    void propagateServerMutation('deleteWorkload', {
      id,
      target,
      auditEntry,
    });
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
    const cleanName = (leave.staffName || '').trim().replace(/\s+/g, ' ');
    const lStart = (leave.startDate || '').trim();
    const lEnd = (leave.endDate || lStart).trim();
    const isTrain = isTrainingLeaveType(leave.leaveType);
    const lDays = Number(leave.days) || 1;
    const lPeriod = parseLeavePeriodFromNote(leave.note);
    const conflict = dbRef.current.leaves.find(existing => {
      if ((existing.staffName || '').trim().replace(/\s+/g, ' ') !== cleanName) return false;
      const exStart = (existing.startDate || '').trim();
      const exEnd = (existing.endDate || exStart).trim();
      if (!(Boolean(exStart) && exStart <= lEnd && exEnd >= lStart)) return false;
      if (isTrain === isTrainingLeaveType(existing.leaveType)) return true;
      const exDays = Number(existing.days) || 1;
      const exPeriod = parseLeavePeriodFromNote(existing.note);
      if (
        exStart === exEnd &&
        lStart === lEnd &&
        exDays === 0.5 &&
        lDays === 0.5 &&
        exPeriod &&
        lPeriod &&
        exPeriod !== lPeriod
      ) {
        return false;
      }
      return true;
    });
    if (conflict) {
      showToast(
        `ไม่สามารถบันทึกซ้ำได้: ${cleanName} มีรายการ "${conflict.leaveType}" ในวันที่ซ้ำซ้อน (${conflict.startDate}) อยู่ในฐานข้อมูลแล้ว`,
        'error'
      );
      return;
    }

    clearLeaveTombstone(leave);
    markLeavesRecentlySaved([leave]);
    enqueuePendingOutboxLeaves([leave]);
    mutationSeqRef.current += 1;
    const baseDb = dbRef.current;
    const nextDb = {
      ...baseDb,
      leaves: [leave, ...baseDb.leaves],
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    void propagateServerMutation('addLeave', { leave });
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
        void performBackgroundSync('edit');
      } else {
        showToast('บันทึกวันลาในเครื่องแล้ว (รอซิงค์เข้า Google Sheet รอบถัดไปอัตโนมัติ)', 'info');
      }
    } else if (targetSheetId) {
      const token = await getAccessToken();
      if (token) {
        const ok = await appendLeaveToSheet(token, targetSheetId, leave);
        if (ok) markLeaveOutboxSynced([leave]);
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        void performBackgroundSync('edit');
      } else {
        showToast('บันทึกวันลาไว้ในเครื่องนี้แล้ว (ยังไม่ได้เชื่อม Web App URL /exec หรือ Sign in Google จึงยังไม่ขึ้น Google Sheet)', 'info');
      }
    } else {
      showToast('บันทึกวันลาไว้ในเครื่องนี้แล้ว (ยังไม่ได้เชื่อมต่อ Google Sheets ในหน้า Admin)', 'info');
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
      removeLeaveRecentlySaved(prevItem);
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
    markLeavesRecentlySaved([stamped]);

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
    void propagateServerMutation('updateLeave', {
      target: prevItem,
      updated: stamped,
      auditEntry,
    });
    showToast(`อัปเดตประวัติการลา ${stamped.staffName} พร้อมบันทึกเหตุผลแล้ว`, 'success');
    enqueueAdminSync(
      'leaves',
      dirtyVer,
      auditEntry,
      prevItem
        ? {
            action: 'updateLeave',
            target: prevItem,
            updated: stamped,
            insertIfMissing: true,
            opSeq,
          }
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
      removeLeaveRecentlySaved(target);
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
    void propagateServerMutation('deleteLeave', {
      id,
      target,
      auditEntry,
    });
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
    const validRecords: OTAttendance[] = [];
    const duplicateNames: string[] = [];
    records.forEach(rec => {
      const dup =
        dbRef.current.ot.some(existing => isOtDuplicateConflict(existing, rec)) ||
        validRecords.some(existing => isOtDuplicateConflict(existing, rec));
      if (dup) {
        duplicateNames.push(rec.staffName);
      } else {
        validRecords.push(rec);
      }
    });
    if (duplicateNames.length > 0) {
      showToast(
        `ไม่สามารถบันทึก OT ซ้ำในวันและกะเวลาเดียวกันได้ (${duplicateNames.join(', ')})`,
        'error'
      );
    }
    if (validRecords.length === 0) return;

    validRecords.forEach(clearOtTombstone);
    markOtRecentlySaved(validRecords);
    enqueuePendingOutboxOt(validRecords);
    mutationSeqRef.current += 1;
    const baseDb = dbRef.current;
    const nextDb = {
      ...baseDb,
      ot: [...validRecords, ...baseDb.ot],
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    void propagateServerMutation('addOt', { records: validRecords });
    showToast(`บันทึกเวรนอกเวลาจำนวน ${validRecords.length} คน เรียบร้อยแล้ว!`, 'success');

    if (dbRef.current.settings.autoSync === false) return;
    const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
    const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

    if (targetGasUrl) {
      const ok = await appendViaAppsScript(targetGasUrl, 'appendOT', validRecords);
      if (ok) {
        markOtOutboxSynced(validRecords);
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        void performBackgroundSync('edit');
      } else {
        showToast('บันทึกเวร OT ในเครื่องแล้ว (รอซิงค์เข้า Google Sheet รอบถัดไปอัตโนมัติ)', 'info');
      }
    } else if (targetSheetId) {
      const token = await getAccessToken();
      if (token) {
        await Promise.all(
          validRecords.map((r) =>
            appendOTToSheet(token, targetSheetId, r).then((ok) => {
              if (ok) markOtOutboxSynced([r]);
            })
          )
        );
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        void performBackgroundSync('edit');
      } else {
        showToast('บันทึกเวร OT ไว้ในเครื่องนี้แล้ว (ยังไม่ได้เชื่อม Web App URL /exec หรือ Sign in Google จึงยังไม่ขึ้น Google Sheet)', 'info');
      }
    } else {
      showToast('บันทึกเวร OT ไว้ในเครื่องนี้แล้ว (ยังไม่ได้เชื่อมต่อ Google Sheets ในหน้า Admin)', 'info');
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
      removeOtRecentlySaved(prevItem);
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
    markOtRecentlySaved([stamped]);

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
    void propagateServerMutation('updateOt', {
      target: prevItem,
      updated: stamped,
      ...(promotedStaffDirtyVer !== null ? { staffList: nextStaffList } : {}),
      auditEntry,
    });
    showToast(`อัปเดตเวรนอกเวลา ${stamped.staffName} พร้อมบันทึกเหตุผลแล้ว`, 'success');
    const promotedTarget =
      promotedStaffDirtyVer !== null
        ? baseDb.staff.find((s) => s.name.trim() === stamped.staffName.trim())
        : undefined;
    const promotedUpdated =
      promotedStaffDirtyVer !== null && promotedTarget
        ? { ...promotedTarget, staffId: stampedEmpCode, employeeCode: stampedEmpCode }
        : undefined;

    enqueueAdminSync(
      'ot',
      dirtyVer,
      auditEntry,
      prevItem
        ? {
            action: 'updateOT',
            target: prevItem,
            updated: stamped,
            insertIfMissing: true,
            opSeq,
          }
        : undefined
    );
    if (promotedStaffDirtyVer !== null && promotedTarget && promotedUpdated) {
      enqueueAdminSync('staff', promotedStaffDirtyVer, undefined, {
        staff: {
          action: 'updateStaff',
          target: promotedTarget,
          updated: promotedUpdated,
          previousStaffId: promotedTarget.staffId,
          insertIfMissing: true,
          opSeq,
        },
      });
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
      removeOtRecentlySaved(target);
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
    void propagateServerMutation('deleteOt', {
      id,
      target,
      auditEntry,
    });
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
    const opSeq = mutationSeqRef.current;
    const dirtyVer = markStaffMasterDirty();
    const otDirtyVer = otChanged ? markOtDirty() : null;
    const nextDb = {
      ...baseDb,
      staff: nextStaff,
      ot: nextOt,
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    void propagateServerMutation('syncStaff', {
      staff: nextStaff,
      ...(otChanged ? { ot: nextOt } : {}),
    });
    showToast(`เพิ่มเจ้าหน้าที่ ${normalizedStaff.name} เข้าสู่ระบบแล้ว`, 'success');
    enqueueAdminSync('staff', dirtyVer, undefined, {
      staff: {
        action: 'addStaff',
        updated: normalizedStaff,
        propagateOt: otDirtyVer !== null,
        otDirtyVer,
        opSeq,
      },
    });
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
    const opSeq = mutationSeqRef.current;
    const dirtyVer = markStaffMasterDirty();
    const nextDb = {
      ...baseDb,
      staff: nextStaff,
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    void propagateServerMutation('syncStaff', { staff: nextStaff });
    showToast(`ลบบุคลากร ${target?.name || ''} ออกจากระบบแล้ว`, 'info');
    enqueueAdminSync(
      'staff',
      dirtyVer,
      undefined,
      target
        ? {
            staff: {
              action: 'deleteStaff',
              target,
              previousStaffId: staffId,
              opSeq,
            },
          }
        : undefined
    );
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
    const opSeq = mutationSeqRef.current;
    const dirtyVer = markStaffMasterDirty();
    const otDirtyVer = otChanged ? markOtDirty() : null;
    const nextDb = {
      ...baseDb,
      staff: nextStaff,
      ot: nextOt,
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    void propagateServerMutation('syncStaff', {
      staff: nextStaff,
      ...(otChanged ? { ot: nextOt } : {}),
    });
    showToast(`อัปเดตข้อมูลบุคลากร ${normalizedStaff.name} เรียบร้อยแล้ว`, 'success');
    enqueueAdminSync('staff', dirtyVer, undefined, {
      staff: {
        action: 'updateStaff',
        target: prevStaff,
        updated: normalizedStaff,
        previousStaffId: prevStaff.staffId,
        propagateOt: otDirtyVer !== null,
        otDirtyVer,
        insertIfMissing: true,
        opSeq,
      },
    });
  };

  // Handler: Update Staff Status (Active / Resigned / Retired)
  const handleUpdateStaffStatus = async (staffId: string, status: StaffStatus) => {
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const baseDb = dbRef.current;
    const todayStr = getLocalTodayIso();
    const prevTarget = baseDb.staff.find(s => s.staffId === staffId);
    let updatedTarget: StaffMember | undefined;
    const nextStaff = baseDb.staff.map(s => {
      if (s.staffId !== staffId) return s;
      const next =
        status === 'Resigned' || status === 'Retired'
          ? { ...s, status, endDate: s.endDate || todayStr }
          : { ...s, status, endDate: undefined };
      updatedTarget = next;
      return next;
    });
    mutationSeqRef.current += 1;
    const opSeq = mutationSeqRef.current;
    const dirtyVer = markStaffMasterDirty();
    const nextDb = {
      ...baseDb,
      staff: nextStaff,
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    void propagateServerMutation('syncStaff', { staff: nextStaff });
    showToast(`อัปเดตสถานะเป็น ${status} สำเร็จ`, 'info');
    enqueueAdminSync(
      'staff',
      dirtyVer,
      undefined,
      prevTarget && updatedTarget
        ? {
            staff: {
              action: 'updateStaff',
              target: prevTarget,
              updated: updatedTarget,
              previousStaffId: staffId,
              insertIfMissing: true,
              opSeq,
            },
          }
        : undefined
    );
  };

  // Handler: Save Settings
  const handleSaveSettings = (settings: SystemSettings) => {
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const baseDb = dbRef.current;
    const changedEntries = computeChangedSettingsEntries(baseDb.settings, settings);
    mutationSeqRef.current += 1;
    const opSeq = mutationSeqRef.current;
    const dirtyVer = markSettingsDirty();
    const nextDb = {
      ...baseDb,
      settings,
    };
    dbRef.current = nextDb;
    setDb(nextDb);
    void propagateServerMutation('saveSettings', { settings });
    showToast('บันทึกการตั้งค่าเรียบร้อยแล้ว', 'success');
    enqueueAdminSync('settings', dirtyVer, undefined, {
      settings: { changedEntries, opSeq },
    });
  };

  // Handler: Toggle Auto Sync
  const handleToggleAutoSync = (enabled: boolean) => {
    if (!isAdmin) return;
    const baseDb = dbRef.current;
    mutationSeqRef.current += 1;
    const opSeq = mutationSeqRef.current;
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
    void propagateServerMutation('saveSettings', { settings: nextDb.settings });
    enqueueAdminSync('settings', dirtyVer, undefined, {
      settings: { changedEntries: [], opSeq },
    });
    showToast(
      enabled
        ? 'เปิดใช้งาน Auto ซิงค์ทุกครั้งที่กดบันทึกแล้ว'
        : 'ปิดโหมด Auto ซิงค์ชั่วคราว (สามารถกดปุ่มซิงค์เองได้)',
      'info'
    );
  };

  // Handler: Save Unit Cost Center (allowed for general OPD staff from Menu 2 & persists locally + GAS)
  const handleSaveUnitCostCenter = async (
    clinic: string,
    costCenter: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const cleanClinic = (clinic || '').trim();
    const cleanCostCenter = (costCenter || '').trim();
    if (!cleanClinic) {
      return { ok: false, error: 'กรุณาเลือกหน่วยงานหรือห้องตรวจ' };
    }

    const baseDb = dbRef.current;
    const prevSettings = baseDb.settings;
    let nextSettings: SystemSettings;

    if (cleanClinic === 'ALL') {
      const resolvedDefault = cleanCostCenter || prevSettings.defaultCostCenter || '2012000000';
      nextSettings = {
        ...prevSettings,
        defaultCostCenter: resolvedDefault,
      };
    } else {
      const nextMap = { ...(prevSettings.clinicCostCenters || {}) };
      if (cleanCostCenter) {
        nextMap[cleanClinic] = cleanCostCenter;
      } else {
        delete nextMap[cleanClinic];
      }
      nextSettings = {
        ...prevSettings,
        clinicCostCenters: nextMap,
      };
    }

    try {
      const rawLocal = localStorage.getItem('pcmc_unit_cost_centers');
      const localMap: Record<string, string> = rawLocal ? JSON.parse(rawLocal) : {};
      if (cleanCostCenter) localMap[cleanClinic] = cleanCostCenter;
      else delete localMap[cleanClinic];
      localStorage.setItem('pcmc_unit_cost_centers', JSON.stringify(localMap));
    } catch {
      // ignore localStorage failure
    }

    mutationSeqRef.current += 1;
    const nextDb: AppDatabase = { ...baseDb, settings: nextSettings };
    dbRef.current = nextDb;
    setDb(nextDb);
    void propagateServerMutation('saveUnitCostCenter', {
      clinic: cleanClinic,
      costCenter: cleanCostCenter,
    });

    const gasUrl = (baseDb.settings.gasUrl || '').trim();
    if (gasUrl) {
      const res = await saveUnitCostCenterViaAppsScript({
        gasUrl,
        clinic: cleanClinic,
        costCenter: cleanCostCenter,
      });
      if (res.ok) {
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
        showToast(
          cleanCostCenter
            ? `บันทึก Cost Center "${cleanCostCenter}" สำหรับ ${cleanClinic === 'ALL' ? 'ทุกห้องตรวจ OPD' : cleanClinic} แล้ว`
            : `ล้างค่า Cost Center เฉพาะของ ${cleanClinic} แล้ว`,
          'success'
        );
        return { ok: true };
      }
      showToast(
        `จำค่า Cost Center บนเครื่องแล้ว แต่ซิงค์ไปยัง Google Sheets ไม่สำเร็จ (${res.error || 'ตรวจสอบ Code.gs ล่าสุด'})`,
        'info'
      );
      return { ok: true };
    }

    showToast(
      cleanCostCenter
        ? `จำค่า Cost Center "${cleanCostCenter}" สำหรับ ${cleanClinic === 'ALL' ? 'ทุกห้องตรวจ OPD' : cleanClinic} เรียบร้อยแล้ว`
        : `ล้างค่า Cost Center เฉพาะของ ${cleanClinic} แล้ว`,
      'success'
    );
    return { ok: true };
  };

  // Handler: Configure LINE Group Daily Report Automation (Multi-Group + Multi-Schedule + .JPEG)
  const handleConfigureLineAutomation = async (config: {
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
  }): Promise<{
    ok: boolean;
    error?: string;
    lineAutomation?: LineAutomationStatusInfo;
    gasSynced?: boolean;
    gasError?: string;
  }> => {
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return { ok: false, error: 'สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น' };
    }
    const baseDb = dbRef.current;
    const gasUrl = (baseDb.settings.gasUrl || '').trim();
    const adminPin = unlockedAdminPinRef.current;

    const cleanTargetGroups: LineTargetGroup[] =
      Array.isArray(config.targetGroups) && config.targetGroups.length > 0
        ? config.targetGroups
        : baseDb.settings.lineTargetGroups && baseDb.settings.lineTargetGroups.length > 0
        ? baseDb.settings.lineTargetGroups
        : DEFAULT_LINE_TARGET_GROUPS.map((g) => ({ ...g }));

    const resolvedTargetId = (
      config.targetId ||
      cleanTargetGroups.find((g) => g.enabled)?.id ||
      baseDb.settings.lineTargetId ||
      DEFAULT_LINE_GROUP_ID
    ).trim();

    const cleanSchedules: LineReportSchedule[] =
      Array.isArray(config.schedules) && config.schedules.length > 0
        ? config.schedules.map((s) => ({
            ...s,
            time: normalizeLineTimeString(s.time, DEFAULT_LINE_AUTO_TIME),
          }))
        : baseDb.settings.lineSchedules && baseDb.settings.lineSchedules.length > 0
        ? baseDb.settings.lineSchedules
        : DEFAULT_LINE_SCHEDULES.map((s) => ({ ...s }));

    const resolvedPrimaryTime = normalizeLineTimeString(
      config.time || cleanSchedules[0]?.time || DEFAULT_LINE_AUTO_TIME,
      DEFAULT_LINE_AUTO_TIME
    );
    const resolvedSendFormat: LineSendFormat = config.sendFormat
      ? resolveLineSendFormat(config.sendFormat, config.sendAsImage)
      : typeof config.sendAsImage === 'boolean'
      ? resolveLineSendFormat(undefined, config.sendAsImage)
      : resolveLineSendFormat(baseDb.settings.lineSendFormat, baseDb.settings.lineSendAsImage);
    const resolvedSendAsImage = resolvedSendFormat !== 'TEXT_ONLY';

    const resolvedBoobyOwnerName =
      (config.boobyOwnerName !== undefined
        ? config.boobyOwnerName
        : baseDb.settings.boobyOwnerName || DEFAULT_BOOBY_OWNER_NAME
      ).trim() || DEFAULT_BOOBY_OWNER_NAME;
    const resolvedBoobyOwnerUserId = (
      config.boobyOwnerUserId !== undefined
        ? config.boobyOwnerUserId
        : baseDb.settings.boobyOwnerUserId || ''
    ).trim();
    const resolvedBoobyGroupMentionOnly =
      typeof config.boobyGroupMentionOnly === 'boolean'
        ? config.boobyGroupMentionOnly
        : baseDb.settings.boobyGroupMentionOnly !== false;

    const dirtyVer = markSettingsDirty();
    const optimisticSettings: SystemSettings = {
      ...baseDb.settings,
      lineAutoEnabled: config.enabled,
      lineAutoTime: resolvedPrimaryTime,
      lineAutoReportDayMode: config.reportDayMode,
      lineAutoShift: config.shift,
      lineTargetId: resolvedTargetId,
      lineTargetGroups: cleanTargetGroups,
      lineSchedules: cleanSchedules,
      lineSendAsImage: resolvedSendAsImage,
      lineSendFormat: resolvedSendFormat,
      boobyOwnerName: resolvedBoobyOwnerName,
      boobyOwnerUserId: resolvedBoobyOwnerUserId,
      boobyGroupMentionOnly: resolvedBoobyGroupMentionOnly,
    };
    const optimisticDb: AppDatabase = { ...baseDb, settings: optimisticSettings };
    dbRef.current = optimisticDb;
    setDb(optimisticDb);

    // 1. Prefer server-side proxy (/api/line/configure), which securely passes .env token to GAS server-to-server
    const proxyRes = await configureLineViaServerProxy({
      enabled: config.enabled,
      time: resolvedPrimaryTime,
      reportDayMode: config.reportDayMode,
      shift: config.shift,
      targetId: resolvedTargetId,
      targetGroups: cleanTargetGroups,
      schedules: cleanSchedules,
      sendAsImage: resolvedSendAsImage,
      sendFormat: resolvedSendFormat,
      boobyOwnerName: resolvedBoobyOwnerName,
      boobyOwnerUserId: resolvedBoobyOwnerUserId,
      boobyGroupMentionOnly: resolvedBoobyGroupMentionOnly,
      ...(gasUrl ? { gasUrl } : {}),
      ...(adminPin ? { adminPin } : {}),
    });

    if (proxyRes.available && proxyRes.ok) {
      let lineAutomation: LineAutomationStatusInfo | undefined;
      if (proxyRes.gasSynced && proxyRes.gasData) {
        clearSettingsDirty(dirtyVer);
        const gasRawAuto = proxyRes.gasData.lineAutomation as Partial<LineAutomationStatusInfo> | undefined;
        lineAutomation = {
          enabled: config.enabled,
          time: normalizeLineTimeString(gasRawAuto?.time || resolvedPrimaryTime, resolvedPrimaryTime),
          triggerInstalled: Boolean(gasRawAuto?.triggerInstalled),
          triggerCount: Number(gasRawAuto?.triggerCount) || 0,
          nextRunAt: String(gasRawAuto?.nextRunAt || proxyRes.serverNextRunAt || ''),
          hasToken: Boolean(gasRawAuto?.hasToken ?? proxyRes.hasServerToken),
          targetId: resolvedTargetId,
          detectedGroupName: proxyRes.groupName || undefined,
        };
      } else {
        lineAutomation = {
          enabled: config.enabled,
          time: resolvedPrimaryTime,
          triggerInstalled: false,
          triggerCount: 0,
          nextRunAt: String(proxyRes.serverNextRunAt || ''),
          hasToken: Boolean(proxyRes.hasServerToken),
          targetId: resolvedTargetId,
          detectedGroupName: proxyRes.groupName || undefined,
        };
      }

      const finalSettings: SystemSettings = {
        ...dbRef.current.settings,
        lineAutoEnabled: config.enabled,
        lineAutoTime: resolvedPrimaryTime,
        lineAutoReportDayMode: config.reportDayMode,
        lineAutoShift: config.shift,
        lineTargetId: resolvedTargetId,
        lineTargetGroups: cleanTargetGroups,
        lineSchedules: cleanSchedules,
        lineSendAsImage: resolvedSendAsImage,
        lineSendFormat: resolvedSendFormat,
        boobyOwnerName: resolvedBoobyOwnerName,
        boobyOwnerUserId: resolvedBoobyOwnerUserId,
        boobyGroupMentionOnly: resolvedBoobyGroupMentionOnly,
        lineChannelTokenSet: Boolean(lineAutomation.hasToken || proxyRes.hasServerToken),
        ...(proxyRes.groupName ? { lineDetectedGroupName: proxyRes.groupName } : {}),
      };
      const nextDb: AppDatabase = { ...dbRef.current, settings: finalSettings };
      dbRef.current = nextDb;
      setDb(nextDb);
      void propagateServerMutation('saveSettings', { settings: finalSettings });

      showToast(
        config.enabled
          ? proxyRes.gasSynced
            ? `บันทึกและตั้งเวลาส่งรายงานเข้า LINE (${cleanSchedules.filter((s) => s.enabled).length} รอบ) สำเร็จ`
            : `บันทึกบนเซิร์ฟเวอร์แล้ว แต่ซิงค์ไปยัง Google Apps Script ไม่สำเร็จ${
                proxyRes.gasError ? ` (${proxyRes.gasError})` : ''
              }`
          : 'บันทึกการปิดส่งรายงาน LINE อัตโนมัติแล้ว',
        config.enabled && gasUrl && !proxyRes.gasSynced ? 'info' : 'success'
      );
      return {
        ok: true,
        lineAutomation,
        gasSynced: Boolean(proxyRes.gasSynced),
        gasError: proxyRes.gasError,
      };
    }

    // 2. Static build fallback (direct GAS without Node backend)
    if (!gasUrl || !adminPin) {
      showToast('กรุณาเชื่อมต่อ Google Apps Script Web App URL และปลดล็อก Admin PIN ก่อน', 'error');
      return { ok: false, error: 'ไม่มี Web App URL หรือรหัส Admin PIN' };
    }

    const res = await configureLineAutomationViaAppsScript({
      gasUrl,
      adminPin,
      config: {
        ...config,
        time: resolvedPrimaryTime,
        targetId: resolvedTargetId,
        targetGroups: cleanTargetGroups,
        schedules: cleanSchedules,
        sendAsImage: resolvedSendAsImage,
        sendFormat: resolvedSendFormat,
        boobyOwnerName: resolvedBoobyOwnerName,
        boobyOwnerUserId: resolvedBoobyOwnerUserId,
        boobyGroupMentionOnly: resolvedBoobyGroupMentionOnly,
      },
      db: optimisticDb,
      expectedDirtyVersion: dirtyVer,
    });

    if (!res.ok) {
      showToast(res.error || 'ตั้งค่า LINE อัตโนมัติบน Apps Script ไม่สำเร็จ', 'error');
      return { ok: false, error: res.error };
    }

    if (res.syncedDb) {
      const mergedSettings: SystemSettings = {
        ...res.syncedDb.settings,
        lineAutoEnabled: config.enabled,
        lineAutoTime: resolvedPrimaryTime,
        lineAutoReportDayMode: config.reportDayMode,
        lineAutoShift: config.shift,
        lineTargetId: resolvedTargetId,
        lineTargetGroups: cleanTargetGroups,
        lineSchedules: cleanSchedules,
        lineSendAsImage: resolvedSendAsImage,
        lineSendFormat: resolvedSendFormat,
        boobyOwnerName: resolvedBoobyOwnerName,
        boobyOwnerUserId: resolvedBoobyOwnerUserId,
        boobyGroupMentionOnly: resolvedBoobyGroupMentionOnly,
        lineChannelTokenSet:
          res.lineAutomation?.hasToken ?? Boolean(res.syncedDb.settings.lineChannelTokenSet),
      };
      const syncedFinal: AppDatabase = { ...res.syncedDb, settings: mergedSettings };
      dbRef.current = syncedFinal;
      setDb(syncedFinal);
      void propagateServerMutation('saveSettings', { settings: mergedSettings });
    }

    showToast(
      config.enabled
        ? `ตั้งเวลาส่งรายงานเข้า LINE (${cleanSchedules.filter((s) => s.enabled).length} รอบ) สำเร็จ`
        : 'บันทึกการปิดส่งรายงาน LINE อัตโนมัติแล้ว',
      'success'
    );
    return { ok: true, lineAutomation: res.lineAutomation };
  };

  // Helper: Always fetch latest Google Sheets state before automated/manual LINE push so .jpeg matches Web App 100%
  const fetchLatestDbForLineSend = useCallback(async (seedDb: AppDatabase): Promise<AppDatabase> => {
    const gasUrl = (seedDb.settings.gasUrl || '').trim();
    const sheetId = (seedDb.settings.spreadsheetId || '').trim();
    const startSeq = mutationSeqRef.current;
    let latestDb = seedDb;
    try {
      if (gasUrl) {
        const useAdmin = isAdminUnlockedRef.current && Boolean(unlockedAdminPinRef.current);
        const gasRes = useAdmin
          ? await syncAdminViaAppsScript(gasUrl, unlockedAdminPinRef.current, seedDb)
          : await syncPublicViaAppsScript(gasUrl, seedDb);
        if (gasRes.accessible && gasRes.mergedDb) {
          latestDb = {
            ...gasRes.mergedDb,
            settings: {
              ...gasRes.mergedDb.settings,
              gasUrl,
              spreadsheetId: sheetId || gasRes.mergedDb.settings.spreadsheetId,
            },
          };
        }
      } else if (sheetId) {
        const pubRes = await readPublicGoogleSheet(sheetId, seedDb);
        if (pubRes.accessible && pubRes.mergedDb) {
          latestDb = pubRes.mergedDb;
        }
      }
      if (latestDb !== seedDb && mutationSeqRef.current === startSeq) {
        dbRef.current = latestDb;
        setDb(latestDb);
        lastSyncEpochRef.current = Date.now();
        setLastSyncedAt(formatSyncTime());
      }
    } catch {
      // Fallback safely to current in-memory DB if network temporarily fails
    }
    return latestDb;
  }, []);

  // Handler: Immediate push to LINE Group(s) with optional .JPEG table snapshot
  const handleSendLineReportNow = async (params: {
    targetId?: string;
    targetIds?: string[];
    date?: string;
    shift?: string;
    reportDayMode?: LineAutoReportDayMode;
    message?: string;
    imageDataUrl?: string;
    sendAsImage?: boolean;
    sendFormat?: LineSendFormat;
  }): Promise<{ ok: boolean; error?: string }> => {
    if (!isAdmin) {
      const err = 'สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น';
      showToast(err, 'error');
      return { ok: false, error: err };
    }
    const baseDb = !params.imageDataUrl
      ? await fetchLatestDbForLineSend(dbRef.current)
      : dbRef.current;
    const configuredGroups = (baseDb.settings.lineTargetGroups || []).filter(
      (g) => g.enabled && (g.id || '').trim()
    );
    const resolvedTargetIds = Array.from(
      new Set(
        (params.targetIds && params.targetIds.length > 0
          ? params.targetIds
          : configuredGroups.length > 0
          ? configuredGroups.map((g) => g.id)
          : [params.targetId || baseDb.settings.lineTargetId || DEFAULT_LINE_GROUP_ID]
        )
          .map((id) => (id || '').trim())
          .filter(Boolean)
      )
    );
    const resolvedTargetId = resolvedTargetIds[0] || DEFAULT_LINE_GROUP_ID;

    const resolvedDate =
      params.date ||
      resolveLineAutoReportDate(
        baseDb.workloads,
        params.reportDayMode || baseDb.settings.lineAutoReportDayMode || 'TODAY'
      );
    const resolvedShift = params.shift || baseDb.settings.lineAutoShift || 'ในเวลา 08:00-16:00';
    const premSubs = baseDb.settings.premiumSubClinics || [...DEFAULT_PREMIUM_SUB_CLINICS];
    const messageToSend =
      (params.imageDataUrl && (params.message || '').trim()) ||
      buildDailyCensusLineMessage({
        workloads: baseDb.workloads,
        date: resolvedDate,
        shiftFilter: resolvedShift,
        premiumSubClinics: premSubs,
        includeClinicBreakdown: true,
      });

    const resolvedSendFormat: LineSendFormat = params.sendFormat
      ? resolveLineSendFormat(params.sendFormat, params.sendAsImage)
      : typeof params.sendAsImage === 'boolean'
      ? resolveLineSendFormat(undefined, params.sendAsImage)
      : resolveLineSendFormat(baseDb.settings.lineSendFormat, baseDb.settings.lineSendAsImage);
    const wantImage = resolvedSendFormat !== 'TEXT_ONLY';
    const gasUrl = (baseDb.settings.gasUrl || '').trim();
    let uploadedImageUrl = '';
    let uploadedPreviewUrl = '';
    let imageUploadNote = '';

    if (wantImage) {
      try {
        let base64Jpeg = '';
        if (params.imageDataUrl) {
          base64Jpeg = params.imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
        } else {
          const generated = renderDailyCensusReportJpegDataUrl({
            workloads: baseDb.workloads,
            date: resolvedDate,
            shiftFilter: resolvedShift,
            premiumSubClinics: premSubs,
          });
          base64Jpeg = generated.base64;
        }
        if (base64Jpeg && gasUrl) {
          const upRes = await uploadLineReportJpegViaAppsScript({
            gasUrl,
            base64Jpeg,
            filename: `OPD_Census_${resolvedDate}.jpeg`,
          });
          if (upRes.ok && upRes.imageUrl) {
            uploadedImageUrl = upRes.imageUrl;
            uploadedPreviewUrl = upRes.previewImageUrl || upRes.imageUrl;
          } else {
            imageUploadNote = upRes.error || 'ยังไม่อัปเดต Code.gs สำหรับฝากไฟล์ภาพ .jpeg บน Google Drive';
          }
        } else if (!gasUrl) {
          imageUploadNote = 'ยังไม่ได้เชื่อม Google Apps Script URL จึงไม่สามารถฝากไฟล์ภาพ .jpeg บน Google Drive ได้';
        }
      } catch (imgErr) {
        imageUploadNote = String(imgErr instanceof Error ? imgErr.message : imgErr);
      }
    }

    if (resolvedSendFormat === 'IMAGE_ONLY' && !uploadedImageUrl) {
      const err =
        imageUploadNote ||
        'เลือกส่งเฉพาะรูปภาพ (.jpeg) แต่ไม่สามารถสร้าง/อัปโหลดภาพขึ้น Google Drive ได้ กรุณาเชื่อมต่อ Google Apps Script ล่าสุด';
      showToast(err, 'error');
      return { ok: false, error: err };
    }

    // 1. Try server-side LINE Messaging API proxy first (uses .env token securely)
    const proxyRes = await sendLineMessageViaServerProxy({
      targetId: resolvedTargetId,
      targetIds: resolvedTargetIds,
      message: messageToSend,
      sendFormat: resolvedSendFormat,
      ...(uploadedImageUrl ? { imageUrl: uploadedImageUrl, previewImageUrl: uploadedPreviewUrl } : {}),
    });

    if (proxyRes.available) {
      const latestDb = dbRef.current;
      const updatedDb: AppDatabase = {
        ...latestDb,
        settings: {
          ...latestDb.settings,
          lineTargetId: resolvedTargetId,
          lineChannelTokenSet: proxyRes.ok || latestDb.settings.lineChannelTokenSet,
          lineLastSentAt: proxyRes.sentAt || latestDb.settings.lineLastSentAt,
          lineLastSentReportDate: resolvedDate,
          lineLastStatus: proxyRes.statusText || latestDb.settings.lineLastStatus,
          ...(proxyRes.groupName ? { lineDetectedGroupName: proxyRes.groupName } : {}),
        },
      };
      dbRef.current = updatedDb;
      setDb(updatedDb);
      void propagateServerMutation('saveSettings', { settings: updatedDb.settings });

      if (proxyRes.ok) {
        const formatSuffix =
          resolvedSendFormat === 'IMAGE_ONLY'
            ? ' (เฉพาะภาพตาราง .JPEG)'
            : resolvedSendFormat === 'TEXT_ONLY'
            ? ' (เฉพาะข้อความ)'
            : uploadedImageUrl
            ? ' (ภาพตาราง .JPEG + ข้อความ)'
            : imageUploadNote
            ? ` (ส่งข้อความสำเร็จ — หมายเหตุรูปภาพ: ${imageUploadNote})`
            : '';
        showToast(
          `ส่งรายงานเข้ากลุ่ม LINE ${resolvedTargetIds.length} กลุ่ม${formatSuffix} เรียบร้อยแล้ว!`,
          'success'
        );
        return { ok: true };
      }
      const errMsg = proxyRes.error || 'ส่งรายงานเข้า LINE ไม่สำเร็จ';
      showToast(errMsg, 'error');
      return { ok: false, error: errMsg };
    }

    // 2. Fallback to Apps Script if running in static build mode without Node backend
    const adminPin = unlockedAdminPinRef.current;
    if (!gasUrl || !adminPin) {
      const err = 'กรุณาเชื่อมต่อ Google Apps Script Web App URL และปลดล็อก Admin PIN ก่อน';
      showToast(err, 'error');
      return { ok: false, error: err };
    }

    const res = await sendLineDailyCensusNowViaAppsScript({
      gasUrl,
      adminPin,
      targetId: resolvedTargetId,
      targetIds: resolvedTargetIds,
      date: resolvedDate,
      shift: resolvedShift,
      reportDayMode: params.reportDayMode,
      message: messageToSend,
      sendFormat: resolvedSendFormat,
      ...(uploadedImageUrl ? { imageUrl: uploadedImageUrl, previewImageUrl: uploadedPreviewUrl } : {}),
      db: baseDb,
    });

    if (res.syncedDb) {
      dbRef.current = res.syncedDb;
      setDb(res.syncedDb);
    }

    if (res.ok) {
      const gasSuffix =
        resolvedSendFormat === 'IMAGE_ONLY'
          ? ' (เฉพาะภาพตาราง .JPEG)'
          : resolvedSendFormat === 'TEXT_ONLY'
          ? ' (เฉพาะข้อความ)'
          : uploadedImageUrl
          ? ' (ภาพ .JPEG + ข้อความ)'
          : '';
      showToast(
        res.statusText ||
          `ส่งรายงานเข้ากลุ่ม LINE ${resolvedTargetIds.length} กลุ่ม${gasSuffix} เรียบร้อยแล้ว!`,
        'success'
      );
      return { ok: true };
    }
    const gasErr = res.error || 'ส่งรายงานเข้า LINE ไม่สำเร็จ';
    showToast(gasErr, 'error');
    return { ok: false, error: gasErr };
  };

  // Client-side multi-schedule Bangkok-time auto-scheduler (always syncs live Sheets data first + 15-min grace for late saves)
  useEffect(() => {
    const checkSchedules = async () => {
      const curDb = dbRef.current;
      const st = curDb.settings;
      if (!st.lineAutoEnabled) return;

      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
      const bkkHour = parts.hour === '24' ? '00' : parts.hour;
      const bkkYmd = `${parts.year}-${parts.month}-${parts.day}`;
      const nowMins = Number(bkkHour) * 60 + Number(parts.minute);

      const schedules =
        st.lineSchedules && st.lineSchedules.length > 0
          ? st.lineSchedules
          : DEFAULT_LINE_SCHEDULES;
      const customHolidays = st.customHolidays || [];

      let dedupeMap: Record<string, string> = {};
      try {
        dedupeMap = JSON.parse(localStorage.getItem('pcmc_line_client_auto_dedupe_v1') || '{}');
      } catch {
        dedupeMap = {};
      }

      const toMins = (hmStr: string) => {
        const [h, m] = hmStr.split(':').map(Number);
        return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
      };

      const dueSchedules = schedules.filter((sch) => {
        if (!sch.enabled) return false;
        const schTime = normalizeLineTimeString(sch.time, DEFAULT_LINE_AUTO_TIME);
        const diff = nowMins - toMins(schTime);
        if (diff < 0 || diff > 15) return false;
        if (!doesDateMatchLineDayRule(bkkYmd, sch.dayRule, customHolidays)) return false;
        return !dedupeMap[`${sch.id}|${bkkYmd}`];
      });
      if (dueSchedules.length === 0) return;

      // Always fetch fresh workloads from Google Sheets BEFORE rendering .jpeg & counting rows!
      const freshDb = await fetchLatestDbForLineSend(curDb);
      const freshSt = freshDb.settings;
      const premSubs = freshSt.premiumSubClinics || [...DEFAULT_PREMIUM_SUB_CLINICS];

      for (const sch of dueSchedules) {
        const dedupeKey = `${sch.id}|${bkkYmd}`;
        if (dedupeMap[dedupeKey]) continue;

        const schTime = normalizeLineTimeString(sch.time, DEFAULT_LINE_AUTO_TIME);
        const diff = nowMins - toMins(schTime);

        const targetDate = resolveLineAutoReportDate(
          freshDb.workloads,
          sch.reportDayMode || 'TODAY',
          bkkYmd
        );
        const targetDateNorm = normalizeWorkloadDateStr(targetDate);
        const schShiftNorm = normalizeWorkloadShiftStr(sch.shift);
        const matchingRows = freshDb.workloads.filter((w) => {
          const matchDate = normalizeWorkloadDateStr(w.date) === targetDateNorm;
          const matchShift =
            schShiftNorm === 'ALL' || normalizeWorkloadShiftStr(w.shift) === schShiftNorm;
          return matchDate && matchShift;
        });

        // Grace window: during first 14 minutes after schTime, hold sending if 0 clinics so late-entered rows aren't skipped!
        if (matchingRows.length === 0 && diff < 15) {
          continue;
        }

        dedupeMap[dedupeKey] = new Date().toISOString();
        try {
          localStorage.setItem('pcmc_line_client_auto_dedupe_v1', JSON.stringify(dedupeMap));
        } catch {
          // ignore
        }

        const msg = buildDailyCensusLineMessage({
          workloads: freshDb.workloads,
          date: targetDate,
          shiftFilter: sch.shift,
          premiumSubClinics: premSubs,
          includeClinicBreakdown: true,
        });

        const groups = (freshSt.lineTargetGroups || []).filter((g) => g.enabled && (g.id || '').trim());
        const targetIds = Array.from(
          new Set(
            (groups.length > 0 ? groups.map((g) => g.id) : [freshSt.lineTargetId || DEFAULT_LINE_GROUP_ID])
              .map((id) => (id || '').trim())
              .filter(Boolean)
          )
        );
        const gasUrl = (freshSt.gasUrl || '').trim();
        const schedSendFormat = resolveLineSendFormat(freshSt.lineSendFormat, freshSt.lineSendAsImage);
        let imageUrl = '';
        let previewImageUrl = '';

        if (schedSendFormat !== 'TEXT_ONLY' && gasUrl) {
          try {
            const rendered = renderDailyCensusReportJpegDataUrl({
              workloads: freshDb.workloads,
              date: targetDate,
              shiftFilter: sch.shift,
              premiumSubClinics: premSubs,
            });
            const up = await uploadLineReportJpegViaAppsScript({
              gasUrl,
              base64Jpeg: rendered.base64,
              filename: `OPD_Census_${targetDate}_${sch.id}.jpeg`,
            });
            if (up.ok && up.imageUrl) {
              imageUrl = up.imageUrl;
              previewImageUrl = up.previewImageUrl || up.imageUrl;
            }
          } catch {
            // proceed with text fallback if image render/upload fails
          }
        }

        let sentViaGas = false;
        if (gasUrl) {
          try {
            const gasRes = await fetch(gasUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify({
                action: 'sendAutoScheduledLineReport',
                payload: {
                  scheduleId: sch.id,
                  scheduleLabel: sch.label,
                  targetIds,
                  targetId: targetIds[0] || DEFAULT_LINE_GROUP_ID,
                  date: targetDate,
                  shift: sch.shift,
                  reportDayMode: sch.reportDayMode,
                  message: msg,
                  clientClinicCount: matchingRows.length,
                  sendFormat: schedSendFormat,
                  ...(imageUrl ? { imageUrl, previewImageUrl } : {}),
                },
              }),
            });
            if (gasRes.ok) {
              const gasJson = await gasRes.json();
              if (gasJson?.success) sentViaGas = true;
            }
          } catch {
            // fallback to server proxy below
          }
        }

        if (!sentViaGas) {
          await sendLineMessageViaServerProxy({
            targetId: targetIds[0] || DEFAULT_LINE_GROUP_ID,
            targetIds,
            message: msg,
            sendFormat: schedSendFormat,
            ...(imageUrl ? { imageUrl, previewImageUrl } : {}),
          });
        }
      }
    };

    const timerId = window.setInterval(() => {
      void checkSchedules();
    }, 30_000);
    return () => window.clearInterval(timerId);
  }, [fetchLatestDbForLineSend]);

  const handleFetchLineStatus = useCallback(async (): Promise<LineAutomationStatusInfo | null> => {
    const baseDb = dbRef.current;
    const gasUrl = (baseDb.settings.gasUrl || '').trim();
    const adminPin = unlockedAdminPinRef.current;
    if (!gasUrl || !adminPin) return null;
    const res = await fetchLineAutomationStatusViaAppsScript({ gasUrl, adminPin });
    if (!res.ok || !res.status) return null;
    const latest = dbRef.current;
    const updatedSettings: SystemSettings = {
      ...latest.settings,
      lineAutoEnabled: res.status.enabled,
      lineAutoTime: normalizeLineTimeString(
        res.status.time || latest.settings.lineAutoTime,
        DEFAULT_LINE_AUTO_TIME
      ),
      lineChannelTokenSet: res.status.hasToken,
      lineTargetId: res.status.targetId || latest.settings.lineTargetId,
      lineDetectedGroupId: res.status.detectedGroupId || latest.settings.lineDetectedGroupId,
      lineDetectedGroupName: res.status.detectedGroupName || latest.settings.lineDetectedGroupName,
      lineLastSentAt: res.status.lastSentAt || latest.settings.lineLastSentAt,
      lineLastSentReportDate:
        res.status.lastSentReportDate || latest.settings.lineLastSentReportDate,
      lineLastStatus: res.status.lastStatus || latest.settings.lineLastStatus,
    };
    const nextDb = { ...latest, settings: updatedSettings };
    dbRef.current = nextDb;
    setDb(nextDb);
    void propagateServerMutation('saveSettings', { settings: updatedSettings });
    return res.status;
  }, [propagateServerMutation]);

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
    clearAllRecentlySaved();
    clearWorkloadsDirty();
    clearLeavesDirty();
    clearOtDirty();
    clearSettingsDirty();
    clearStaffMasterDirty();
    markStaffMasterDirty();
    const clean = loadLocalDatabase();
    dbRef.current = clean;
    setDb(clean);
    void propagateServerMutation('resetAll', { db: clean });
    showToast('ล้างข้อมูลทั้งหมดเรียบร้อยแล้ว พร้อมเริ่มต้นใช้งานจริง', 'info');
  };

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-800 flex flex-col font-sans">
      {/* Top Navbar (Clean without Auto Sync & Sync Sheet buttons per Image 1; Auto Sync still runs silently) */}
      <Navbar
        isAdmin={isAdmin}
        adminOwnerName={adminOwnerName}
        onLockAdmin={handleLockAdmin}
        onOpenCqi={() => setShowCqiModal(true)}
      />

      <CqiReportModal
        isOpen={showCqiModal}
        onClose={() => setShowCqiModal(false)}
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
            onSaveUnitCostCenter={handleSaveUnitCostCenter}
          />
        )}

        {/* Tab 3: Daily OPD Census Report */}
        {activeTab === 'census' && (
          <DailyCensusTab
            workloads={db.workloads}
            staffList={db.staff}
            premiumSubClinics={premiumSubClinics}
            settings={db.settings}
            isAdmin={isAdmin}
            onUpdateWorkload={handleUpdateWorkload}
            onDeleteWorkload={handleDeleteWorkload}
            onSendLineReportNow={handleSendLineReportNow}
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
            workloads={db.workloads}
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
            onConfigureLineAutomation={handleConfigureLineAutomation}
            onSendLineReportNow={handleSendLineReportNow}
            onFetchLineStatus={handleFetchLineStatus}
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
