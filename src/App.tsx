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
  deduplicateLeaves,
  isLeaveDuplicateConflict,
  normalizeLeaveDateStr,
  normalizeStaffNameKey,
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
  appendViaAppsScriptDetailed,
  syncPublicViaAppsScript,
  syncAdminViaAppsScript,
  appendAuditViaAppsScript,
  testGoogleSheetConnection,
  exportAllToGoogleSheetViaAppsScript,
  SheetConnectionStatus,
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
  getWorkloadSlotKey,
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
  Info,
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
  const [isExportingToSheet, setIsExportingToSheet] = useState<boolean>(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [sheetConnectionStatus, setSheetConnectionStatus] = useState<SheetConnectionStatus>({
    checked: false,
    ok: false,
  });

  const dbRef = useRef(db);
  dbRef.current = db;
  const isSyncInFlightRef = useRef<boolean>(false);
  const adminWriteInFlightRef = useRef<boolean>(false);
  const sheetOpQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSyncEpochRef = useRef<number>(0);
  const lastSyncedKeyRef = useRef<string>('');
  const pendingUrlLinkNoticeRef = useRef<{ sheetId: string; gasUrl: string } | null>(null);
  const mutationSeqRef = useRef<number>(0);
  const tabInstanceIdRef = useRef<string>(`tab-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const syncChannelRef = useRef<BroadcastChannel | null>(null);
  const suppressNextBroadcastRef = useRef<boolean>(false);
  const serverVersionRef = useRef<number>(0);
  const wsRef = useRef<WebSocket | null>(null);
  const savingWorkloadSlotsRef = useRef<Set<string>>(new Set());
  const savingLeaveSlotsRef = useRef<Set<string>>(new Set());
  const lineAutoCheckInFlightRef = useRef<boolean>(false);
  const hasMountedTabRef = useRef<boolean>(false);

  const enqueueSheetOperation = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = sheetOpQueueRef.current.catch(() => undefined).then(task);
    sheetOpQueueRef.current = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }, []);

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
      const wSlots = new Set(hydrated.workloads.map(getWorkloadSlotKey));
      const syncedW = boxW.filter(
        (w) => wIds.has(w.id) || wKeys.has(getWorkloadKey(w)) || wSlots.has(getWorkloadSlotKey(w))
      );
      if (syncedW.length > 0) markWorkloadOutboxSynced(syncedW);
      const pendingW = boxW.filter(
        (w) => !wIds.has(w.id) && !wKeys.has(getWorkloadKey(w)) && !wSlots.has(getWorkloadSlotKey(w))
      );

      const boxL = getPendingOutboxLeaves();
      const lIds = new Set(hydrated.leaves.map((l) => l.id));
      const lKeys = new Set(hydrated.leaves.map(getLeaveKey));
      const syncedL = boxL.filter(
        (l) =>
          lIds.has(l.id) ||
          lKeys.has(getLeaveKey(l)) ||
          hydrated.leaves.some((hl) => isLeaveDuplicateConflict(hl, l))
      );
      if (syncedL.length > 0) markLeaveOutboxSynced(syncedL);
      const pendingL = boxL.filter(
        (l) =>
          !lIds.has(l.id) &&
          !lKeys.has(getLeaveKey(l)) &&
          !hydrated.leaves.some((hl) => isLeaveDuplicateConflict(hl, l))
      );

      const boxO = getPendingOutboxOt();
      const oIds = new Set(hydrated.ot.map((o) => o.id));
      const oKeys = new Set(hydrated.ot.map(getOtKey));
      const syncedO = boxO.filter((o) => oIds.has(o.id) || oKeys.has(getOtKey(o)));
      if (syncedO.length > 0) markOtOutboxSynced(syncedO);
      const pendingO = boxO.filter((o) => !oIds.has(o.id) && !oKeys.has(getOtKey(o)));

      const mergedDb: AppDatabase = {
        ...hydrated,
        workloads: pendingW.length > 0 ? [...pendingW, ...hydrated.workloads] : hydrated.workloads,
        leaves: deduplicateLeaves(
          pendingL.length > 0 ? [...pendingL, ...hydrated.leaves] : hydrated.leaves
        ),
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
      return res;
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
        (l) =>
          !lIds.has(l.id) &&
          !lKeys.has(getLeaveKey(l)) &&
          !currentDb.leaves.some((cl) => isLeaveDuplicateConflict(cl, l))
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
          const nextGasUrl = shouldUpdateGas
            ? sharedGasParam || ''
            : shouldUpdateSheet
            ? ''
            : dbRef.current.settings.gasUrl || '';
          const updatedSettings: SystemSettings = {
            ...dbRef.current.settings,
            spreadsheetId: extractedId || dbRef.current.settings.spreadsheetId,
            spreadsheetUrl: extractedId
              ? `https://docs.google.com/spreadsheets/d/${extractedId}/edit`
              : dbRef.current.settings.spreadsheetUrl,
            gasUrl: nextGasUrl,
            isUnlinked: false,
          };
          const nextLinkedDb: AppDatabase = { ...dbRef.current, settings: updatedSettings };
          dbRef.current = nextLinkedDb;
          setDb(nextLinkedDb);
          void propagateServerMutation('saveSettings', { settings: updatedSettings });
          pendingUrlLinkNoticeRef.current = {
            sheetId: updatedSettings.spreadsheetId || '',
            gasUrl: updatedSettings.gasUrl || '',
          };
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
        void enqueueSheetOperation(async () => {
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
                const srvRes = await pushServerSync({
                  clientId: tabInstanceIdRef.current,
                  baseVersion: serverVersionRef.current,
                  mergeFromRemote: true,
                  db: res.mergedDb,
                });
                if (srvRes && srvRes.ok && !srvRes.staleRejected && srvRes.version > serverVersionRef.current) {
                  serverVersionRef.current = srvRes.version;
                }
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

  // Broadcast authoritative Sheet-synced snapshot to Node server (/ws) so all users see latest data immediately
  const broadcastSyncedSnapshot = useCallback(
    async (nextDb: AppDatabase) => {
      try {
        const srvRes = await pushServerSync({
          clientId: tabInstanceIdRef.current,
          baseVersion: serverVersionRef.current,
          mergeFromRemote: true,
          db: nextDb,
        });
        if (!srvRes || !srvRes.ok) return;
        if (srvRes.staleRejected) {
          applyAuthoritativeServerSnapshot(srvRes, 'sync');
        } else if (!srvRes.unchanged && srvRes.version > serverVersionRef.current) {
          serverVersionRef.current = srvRes.version;
        }
      } catch {
        // ignore in offline/static mode
      }
    },
    [applyAuthoritativeServerSnapshot]
  );

  // Core serialized Google Sheets 2-way sync (safe to call inside an existing sheetOpQueue task or directly)
  const executeSheetSyncNow = useCallback(
    async (options?: {
      reason?: 'initial' | 'focus' | 'tab' | 'save' | 'manual';
      overrideSheetId?: string;
      ignoreSeqGuard?: boolean;
    }): Promise<{
      accessible: boolean;
      via?: 'gas' | 'oauth' | 'public';
      pushedCount?: number;
      staffCount?: number;
      pulledWorkloads?: number;
      adminSynced?: boolean;
      error?: string;
    }> => {
      const currentDb = dbRef.current;
      const targetSheetId = (options?.overrideSheetId || currentDb.settings.spreadsheetId || '').trim();
      let targetGasUrl = (currentDb.settings.gasUrl || '').trim();

      if (!targetSheetId && !targetGasUrl) {
        return { accessible: false };
      }

      const syncKey = `${targetSheetId}|${targetGasUrl}`;
      const startSeq = mutationSeqRef.current;

      isSyncInFlightRef.current = true;
      setIsSyncingSheet(true);
      try {
        const applySyncedDb = async (nextDb: AppDatabase, resolvedKey?: string) => {
          if (!options?.ignoreSeqGuard && mutationSeqRef.current !== startSeq) {
            return false;
          }
          dbRef.current = nextDb;
          setDb(nextDb);
          lastSyncEpochRef.current = Date.now();
          lastSyncedKeyRef.current = resolvedKey || syncKey;
          setLastSyncedAt(formatSyncTime());
          await broadcastSyncedSnapshot(nextDb);
          return true;
        };

        let publicFallbackRes: { accessible: boolean; mergedDb: AppDatabase; httpStatus?: number; error?: string } | null = null;
        let lastGasError = '';
        let lastGasStatus: number | undefined;

        const notifyPendingUrlLinkIfNeeded = (ok: boolean, detailErr?: string) => {
          const pending = pendingUrlLinkNoticeRef.current;
          if (!pending) return;
          pendingUrlLinkNoticeRef.current = null;
          const shortId = pending.sheetId ? ` (${pending.sheetId.slice(0, 12)}...)` : '';
          if (ok) {
            showToast(`เชื่อมโยงฐานข้อมูล OPD อัตโนมัติเรียบร้อยแล้ว${shortId}`, 'success');
          } else {
            showToast(
              `ไม่สามารถเชื่อมต่อ Google Sheet จากลิงก์ได้${shortId}: ${detailErr || 'ไม่พบชีท (HTTP 404) หรือยังไม่เปิดสิทธิ์'}`,
              'error'
            );
          }
        };

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
            await applySyncedDb(
              {
                ...gasRes.mergedDb,
                settings: {
                  ...gasRes.mergedDb.settings,
                  spreadsheetId: finalSheetId || undefined,
                  spreadsheetUrl:
                    gasRes.mergedDb.settings.spreadsheetUrl ||
                    (finalSheetId ? `https://docs.google.com/spreadsheets/d/${finalSheetId}/edit` : undefined),
                  gasUrl: targetGasUrl,
                },
              },
              `${finalSheetId}|${targetGasUrl}`
            );
            setSheetConnectionStatus({
              checked: true,
              ok: true,
              via: 'gas',
              sheetOk: true,
              gasOk: true,
              gasStatus: gasRes.httpStatus || 200,
              discoveredGasUrl: targetGasUrl,
              rowCounts: {
                staff: gasRes.mergedDb.staff.length,
                workloads: gasRes.mergedDb.workloads.length,
                leaves: gasRes.mergedDb.leaves.length,
                ot: gasRes.mergedDb.ot.length,
              },
            });
            notifyPendingUrlLinkIfNeeded(true);
            return {
              accessible: true,
              via: 'gas',
              pushedCount: gasRes.pushedCount,
              staffCount: gasRes.mergedDb.staff.length,
              adminSynced: 'adminSynced' in gasRes ? Boolean(gasRes.adminSynced) : true,
              error: 'error' in gasRes ? String(gasRes.error || '') : undefined,
            };
          } else {
            lastGasError = gasRes.error || 'เชื่อมต่อ Web App URL ไม่สำเร็จ';
            lastGasStatus = gasRes.httpStatus;
          }
        }

        if (targetSheetId) {
          const token = await getPassiveGoogleToken();
          if (!options?.ignoreSeqGuard && mutationSeqRef.current !== startSeq) {
            return { accessible: false };
          }
          if (token) {
            const result = await syncAllWithGoogleSheet(token, targetSheetId, currentDb);
            await applySyncedDb(
              {
                ...result.mergedDb,
                settings: {
                  ...result.mergedDb.settings,
                  spreadsheetId: targetSheetId,
                  spreadsheetUrl:
                    result.mergedDb.settings.spreadsheetUrl ||
                    `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
                  gasUrl: result.mergedDb.settings.gasUrl || targetGasUrl || undefined,
                },
              },
              `${targetSheetId}|${result.mergedDb.settings.gasUrl || targetGasUrl || ''}`
            );
            setSheetConnectionStatus({
              checked: true,
              ok: true,
              via: 'oauth',
              sheetOk: true,
              gasOk: Boolean(result.mergedDb.settings.gasUrl || targetGasUrl) && !lastGasError,
              gasError: lastGasError || undefined,
            });
            notifyPendingUrlLinkIfNeeded(true);
            return {
              accessible: true,
              via: 'oauth',
              pushedCount: result.pushedWorkloads,
              staffCount: result.staffCount,
              pulledWorkloads: result.pulledWorkloads,
            };
          }

          const pubRes = publicFallbackRes || (await readPublicGoogleSheet(targetSheetId, currentDb));
          if (pubRes.accessible) {
            const discoveredGas = (pubRes.mergedDb.settings.gasUrl || '').trim();
            if (discoveredGas && discoveredGas !== targetGasUrl) {
              const gasRes =
                isAdminUnlockedRef.current && unlockedAdminPinRef.current
                  ? await syncAdminViaAppsScript(discoveredGas, unlockedAdminPinRef.current, pubRes.mergedDb)
                  : await syncPublicViaAppsScript(discoveredGas, pubRes.mergedDb);
              const finalDb = gasRes.accessible ? gasRes.mergedDb : pubRes.mergedDb;
              await applySyncedDb(
                {
                  ...finalDb,
                  settings: {
                    ...finalDb.settings,
                    spreadsheetId: targetSheetId,
                    spreadsheetUrl:
                      finalDb.settings.spreadsheetUrl ||
                      `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
                    gasUrl: gasRes.accessible ? discoveredGas : targetGasUrl || discoveredGas,
                  },
                },
                `${targetSheetId}|${gasRes.accessible ? discoveredGas : targetGasUrl}`
              );
              setSheetConnectionStatus({
                checked: true,
                ok: true,
                via: gasRes.accessible ? 'gas' : 'public',
                sheetOk: true,
                gasOk: gasRes.accessible,
                gasStatus: gasRes.httpStatus,
                gasError: gasRes.accessible ? undefined : gasRes.error || lastGasError || undefined,
                discoveredGasUrl: discoveredGas,
                error: gasRes.accessible ? undefined : gasRes.error || lastGasError || undefined,
                rowCounts: {
                  staff: finalDb.staff.length,
                  workloads: finalDb.workloads.length,
                  leaves: finalDb.leaves.length,
                  ot: finalDb.ot.length,
                },
              });
              notifyPendingUrlLinkIfNeeded(true);
              return {
                accessible: true,
                via: gasRes.accessible ? 'gas' : 'public',
                pushedCount: gasRes.accessible ? gasRes.pushedCount : 0,
                staffCount: finalDb.staff.length,
              };
            }
            await applySyncedDb(
              {
                ...pubRes.mergedDb,
                settings: {
                  ...pubRes.mergedDb.settings,
                  spreadsheetId: targetSheetId,
                  spreadsheetUrl:
                    pubRes.mergedDb.settings.spreadsheetUrl ||
                    `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`,
                },
              },
              `${targetSheetId}|${targetGasUrl}`
            );
            setSheetConnectionStatus({
              checked: true,
              ok: true,
              via: 'public',
              sheetOk: true,
              gasOk: false,
              gasStatus: lastGasStatus,
              gasError: lastGasError || 'ยังไม่ได้เชื่อม Apps Script Web App URL (/exec)',
              error: lastGasError ? `อ่านชีทได้ แต่ส่งออก via Web App ไม่สำเร็จ: ${lastGasError}` : undefined,
              rowCounts: {
                staff: pubRes.mergedDb.staff.length,
                workloads: pubRes.mergedDb.workloads.length,
                leaves: pubRes.mergedDb.leaves.length,
                ot: pubRes.mergedDb.ot.length,
              },
            });
            notifyPendingUrlLinkIfNeeded(true);
            return {
              accessible: true,
              via: 'public',
              staffCount: pubRes.mergedDb.staff.length,
              error: lastGasError || undefined,
            };
          } else {
            lastSyncedKeyRef.current = syncKey;
            const combinedError = [lastGasError, pubRes.error].filter(Boolean).join(' • ') || 'ไม่สามารถเชื่อมต่อ Google Sheets ได้';
            setSheetConnectionStatus({
              checked: true,
              ok: false,
              sheetOk: false,
              sheetStatus: pubRes.httpStatus,
              sheetError: pubRes.error,
              gasOk: false,
              gasStatus: lastGasStatus,
              gasError: lastGasError || undefined,
              error: combinedError,
            });
            notifyPendingUrlLinkIfNeeded(false, combinedError);
            return { accessible: false, error: combinedError };
          }
        }

        lastSyncedKeyRef.current = syncKey;
        const gasOnlyErr = lastGasError || 'ไม่สามารถเชื่อมต่อ Google Apps Script Web App ได้';
        setSheetConnectionStatus({
          checked: true,
          ok: false,
          gasOk: false,
          gasStatus: lastGasStatus,
          gasError: gasOnlyErr,
          error: gasOnlyErr,
        });
        notifyPendingUrlLinkIfNeeded(false, gasOnlyErr);
        return { accessible: false, error: gasOnlyErr };
      } finally {
        isSyncInFlightRef.current = false;
        setIsSyncingSheet(false);
      }
    },
    [broadcastSyncedSnapshot]
  );

  // Serialized background sync (never races with active saves or admin edits)
  const performBackgroundSync = useCallback(
    async (reason: 'initial' | 'focus' | 'tab' | 'edit') => {
      const currentDb = dbRef.current;
      const targetSheetId = (currentDb.settings.spreadsheetId || '').trim();
      const targetGasUrl = (currentDb.settings.gasUrl || '').trim();
      if (!targetSheetId && !targetGasUrl) return;
      if (reason !== 'edit' && currentDb.settings.autoSync === false) return;

      await enqueueSheetOperation(async () => {
        const latestDb = dbRef.current;
        if (reason !== 'edit' && latestDb.settings.autoSync === false) return;
        await executeSheetSyncNow({
          reason: reason === 'edit' ? 'save' : reason,
          ignoreSeqGuard: reason === 'edit',
        });
      });
    },
    [enqueueSheetOperation, executeSheetSyncNow]
  );

  // Auto-Sync: initial load / when user or spreadsheetId/gasUrl changes
  useEffect(() => {
    const sheetId = (db.settings.spreadsheetId || '').trim();
    const gasUrl = (db.settings.gasUrl || '').trim();
    const syncKey = `${sheetId}|${gasUrl}`;
    if ((!sheetId && !gasUrl) || db.settings.autoSync === false) return;
    if (lastSyncedKeyRef.current !== syncKey || user) {
      const timer = setTimeout(() => {
        void performBackgroundSync('initial');
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [user, db.settings.spreadsheetId, db.settings.gasUrl, db.settings.autoSync, performBackgroundSync]);

  // Event-driven focus/visibility catch-up + WebSocket real-time push (no 20s polling race with saves!)
  useEffect(() => {
    const handleWakeSync = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchServerDatabaseSnapshot().then((snap) => {
        if (snap && snap.ok && snap.version > serverVersionRef.current) {
          applyAuthoritativeServerSnapshot(snap, 'ws');
        }
      });
      if (Date.now() - lastSyncEpochRef.current > 10_000) {
        void performBackgroundSync('focus');
      }
    };
    window.addEventListener('focus', handleWakeSync);
    document.addEventListener('visibilitychange', handleWakeSync);

    return () => {
      window.removeEventListener('focus', handleWakeSync);
      document.removeEventListener('visibilitychange', handleWakeSync);
    };
  }, [performBackgroundSync, applyAuthoritativeServerSnapshot]);

  // Refresh latest data cleanly when general users switch tabs (serialized, 10s cooldown)
  useEffect(() => {
    if (!hasMountedTabRef.current) {
      hasMountedTabRef.current = true;
      return;
    }
    if (Date.now() - lastSyncEpochRef.current > 10_000) {
      void performBackgroundSync('tab');
    }
  }, [activeTab, performBackgroundSync]);

  // Manual Sync with linked Google Spreadsheet — serialized through sheetOpQueue
  const handleSyncSpreadsheet = async (overrideSheetId?: string) => {
    const currentDb = dbRef.current;
    const targetSheetId = (overrideSheetId || currentDb.settings.spreadsheetId || '').trim();
    const targetGasUrl = (currentDb.settings.gasUrl || '').trim();

    if (!targetSheetId && !targetGasUrl) {
      showToast('ยังไม่มีลิงก์ Google Sheets หรือ Web App URL กรุณากด "ตั้งค่าลิงก์ชีท" ก่อน', 'info');
      return;
    }

    try {
      const res = await enqueueSheetOperation(() =>
        executeSheetSyncNow({ reason: 'manual', overrideSheetId })
      );
      if (!res.accessible) {
        showToast(
          res.error
            ? `เชื่อมต่อ Google Sheets ไม่สำเร็จ: ${res.error}`
            : 'ไม่สามารถซิงค์แบบไม่ต้อง Sign in ได้ กรุณาวาง Web App URL (/exec) จาก Code.gs ใน "ตั้งค่าลิงก์ชีท" หรือเปิดสิทธิ์ชีทเป็น "ทุกคนที่มีลิงก์อ่านได้"',
          'error'
        );
        return;
      }
      if (res.via === 'gas') {
        if (res.adminSynced === false) {
          showToast(
            `ดึงข้อมูลสำเร็จ แต่เขียนทับ Google Sheet ในสิทธิ์ Admin ไม่สำเร็จ: ${res.error || 'กรุณาตรวจสอบ Code.gs'}`,
            'error'
          );
          return;
        }
        const syncDetail =
          (res.pushedCount || 0) > 0
            ? ` (บุคลากร ${res.staffCount || 0} คน, ส่งขึ้น ${res.pushedCount} รายการ)`
            : ` (บุคลากร ${res.staffCount || 0} คน)`;
        showToast(`ซิงค์ข้อมูลกับ Google Sheet สำเร็จ!${syncDetail}`, 'success');
      } else if (res.via === 'oauth') {
        showToast(
          `ซิงค์ Google Sheet สำเร็จ! (บุคลากร ${res.staffCount || 0} คน, ส่งขึ้น ${res.pushedCount || 0} / ดึงเข้า ${res.pulledWorkloads || 0} รายการ)`,
          'success'
        );
      } else {
        showToast(
          res.error
            ? `ดึงข้อมูลจากชีทได้แล้ว (${res.staffCount || 0} คน) แต่ส่งออกข้อมูลยังไม่ได้: ${res.error}`
            : `ดึงข้อมูลล่าสุดจาก Google Sheet สำเร็จ! (${res.staffCount || 0} คน — หากต้องการส่งข้อมูลกลับอัตโนมัติให้วาง Web App URL ใน "ตั้งค่าลิงก์ชีท")`,
          res.error ? 'info' : 'success'
        );
      }
    } catch (err: any) {
      console.error('Sync spreadsheet error:', err);
      showToast(`ซิงค์ข้อมูลไม่สำเร็จ: ${err?.message || err}`, 'error');
    }
  };

  // Test live Google Sheet & Apps Script Web App reachability
  const handleTestSheetConnection = async (overrideSheetUrlOrId?: string, overrideGasUrl?: string): Promise<SheetConnectionStatus> => {
    const rawSheet = (overrideSheetUrlOrId !== undefined ? overrideSheetUrlOrId : dbRef.current.settings.spreadsheetId || '').trim();
    const idMatch = rawSheet.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const spreadsheetId = idMatch ? idMatch[1] : rawSheet;
    const gasUrl = (overrideGasUrl !== undefined ? overrideGasUrl : dbRef.current.settings.gasUrl || '').trim();

    const status = await enqueueSheetOperation(() => testGoogleSheetConnection({ spreadsheetId, gasUrl }));
    setSheetConnectionStatus(status);

    if (status.discoveredGasUrl && status.discoveredGasUrl !== (dbRef.current.settings.gasUrl || '').trim() && status.gasOk) {
      const nextSettings: SystemSettings = {
        ...dbRef.current.settings,
        spreadsheetId: spreadsheetId || dbRef.current.settings.spreadsheetId,
        gasUrl: status.discoveredGasUrl,
        isUnlinked: false,
      };
      const nextDb = { ...dbRef.current, settings: nextSettings };
      dbRef.current = nextDb;
      setDb(nextDb);
      void propagateServerMutation('saveSettings', { settings: nextSettings });
    }

    if (status.ok && status.gasOk) {
      showToast(
        `เชื่อมต่อ Google Sheet & Web App สำเร็จ! (ชีทมีบุคลากร ${status.rowCounts?.staff ?? 0} คน, ภาระงาน ${status.rowCounts?.workloads ?? 0} แถว)`,
        'success'
      );
    } else if (status.ok) {
      showToast(
        status.gasError
          ? `อ่านชีทได้ แต่ Web App URL (/exec) ยังเขียนข้อมูลไม่ได้: ${status.gasError}`
          : 'อ่านข้อมูลจาก Google Sheet ได้แล้ว (กรุณาวาง Web App URL /exec เพื่อส่งออกข้อมูล)',
        'info'
      );
    } else {
      showToast(`เชื่อมต่อ Google Sheet ไม่สำเร็จ: ${status.error || 'กรุณาตรวจสอบลิงก์ชีทและ Web App URL'}`, 'error');
    }
    return status;
  };

  // Full export of ALL local records (workloads, leaves, OT, staff, settings) to Google Sheet
  const handleExportAllToGoogleSheet = async (overrideGasUrl?: string, overrideSheetId?: string) => {
    const currentDb = dbRef.current;
    const targetSheetId = (overrideSheetId || currentDb.settings.spreadsheetId || '').trim();
    let targetGasUrl = (overrideGasUrl !== undefined ? overrideGasUrl : currentDb.settings.gasUrl || '').trim();

    setIsExportingToSheet(true);
    try {
      await enqueueSheetOperation(async () => {
        // Discover Web App URL from linked Google Sheet Settings if needed
        if (!targetGasUrl && targetSheetId) {
          const probe = await testGoogleSheetConnection({ spreadsheetId: targetSheetId, gasUrl: '' });
          if (probe.discoveredGasUrl) {
            targetGasUrl = probe.discoveredGasUrl;
          }
        }

        if (targetGasUrl) {
          const res = await exportAllToGoogleSheetViaAppsScript({
            gasUrl: targetGasUrl,
            adminPin: isAdminUnlockedRef.current ? unlockedAdminPinRef.current : undefined,
            db: dbRef.current,
          });
          if (res.ok) {
            dbRef.current = res.mergedDb;
            setDb(res.mergedDb);
            lastSyncEpochRef.current = Date.now();
            lastSyncedKeyRef.current = `${res.mergedDb.settings.spreadsheetId || targetSheetId}|${targetGasUrl}`;
            setLastSyncedAt(formatSyncTime());
            setSheetConnectionStatus({
              checked: true,
              ok: true,
              via: 'gas',
              sheetOk: true,
              gasOk: true,
              gasStatus: 200,
              discoveredGasUrl: targetGasUrl,
              rowCounts: {
                staff: res.mergedDb.staff.length,
                workloads: res.mergedDb.workloads.length,
                leaves: res.mergedDb.leaves.length,
                ot: res.mergedDb.ot.length,
              },
            });
            await broadcastSyncedSnapshot(res.mergedDb);
            const exportedTotal = res.exportedWorkloads + res.exportedLeaves + res.exportedOt;
            showToast(
              exportedTotal > 0
                ? `ส่งออกข้อมูลขึ้น Google Sheet สำเร็จ! (ภาระงาน +${res.exportedWorkloads}, วันลา +${res.exportedLeaves}, OT +${res.exportedOt}, บุคลากร ${res.staffCount} คน)`
                : `ซิงค์และส่งออกข้อมูลทั้งหมดไปยัง Google Sheet เรียบร้อยแล้ว! (บุคลากร ${res.staffCount} คน)`,
              'success'
            );
            return;
          }

          // Fallback to OAuth if logged in
          const token = await getPassiveGoogleToken();
          if (token && targetSheetId) {
            const oauthRes = await syncAllWithGoogleSheet(token, targetSheetId, dbRef.current);
            dbRef.current = oauthRes.mergedDb;
            setDb(oauthRes.mergedDb);
            lastSyncEpochRef.current = Date.now();
            setLastSyncedAt(formatSyncTime());
            await broadcastSyncedSnapshot(oauthRes.mergedDb);
            setSheetConnectionStatus({
              checked: true,
              ok: true,
              via: 'oauth',
              sheetOk: true,
              gasOk: false,
              gasError: res.error,
            });
            showToast(
              `ส่งออกข้อมูลขึ้น Google Sheet ผ่านบัญชี Google สำเร็จ! (ส่งขึ้น ${oauthRes.pushedWorkloads} รายการ)`,
              'success'
            );
            return;
          }

          setSheetConnectionStatus({
            checked: true,
            ok: false,
            gasOk: false,
            gasStatus: res.httpStatus,
            gasError: res.error,
            error: res.error,
          });
          showToast(`ส่งออกข้อมูลไปยัง Google Sheet ไม่สำเร็จ: ${res.error || 'กรุณาตรวจสอบ Web App URL (/exec)'}`, 'error');
          return;
        }

        if (targetSheetId) {
          const token = await getPassiveGoogleToken();
          if (token) {
            const oauthRes = await syncAllWithGoogleSheet(token, targetSheetId, dbRef.current);
            dbRef.current = oauthRes.mergedDb;
            setDb(oauthRes.mergedDb);
            lastSyncEpochRef.current = Date.now();
            setLastSyncedAt(formatSyncTime());
            await broadcastSyncedSnapshot(oauthRes.mergedDb);
            setSheetConnectionStatus({ checked: true, ok: true, via: 'oauth', sheetOk: true });
            showToast(
              `ส่งออกข้อมูลขึ้น Google Sheet สำเร็จ! (ส่งขึ้น ${oauthRes.pushedWorkloads} รายการ)`,
              'success'
            );
            return;
          }
          const pubProbe = await testGoogleSheetConnection({ spreadsheetId: targetSheetId, gasUrl: '' });
          setSheetConnectionStatus(pubProbe);
          showToast(
            pubProbe.ok
              ? 'ยังไม่ได้วาง Apps Script Web App URL (/exec) จึงอ่านได้เฉพาะข้อมูล — กรุณาคัดลอก Code.gs ไป Deploy เป็น Web App แล้วนำลิงก์ /exec มาวางเพื่อส่งออกข้อมูล'
              : `ไม่พบ Google Sheet หรือยังไม่ได้เปิดสิทธิ์: ${pubProbe.error || ''}`,
            'error'
          );
          return;
        }

        showToast('กรุณาวางลิงก์ Google Sheets และ Apps Script Web App URL (/exec) ก่อนส่งออกข้อมูล', 'error');
      });
    } finally {
      setIsExportingToSheet(false);
    }
  };

  // Save Sheet URL/ID + GAS Web App URL and immediately verify & export/sync
  const handleSaveSheetLinkConfig = async (rawSheetInput: string, rawGasInput: string) => {
    if (!isAdmin) {
      showToast('สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น', 'error');
      return;
    }
    const raw = rawSheetInput.trim();
    const trimmedGas = rawGasInput.trim();
    const baseDb = dbRef.current;

    if (!raw && !trimmedGas) {
      const unlinkedSettings: SystemSettings = {
        ...baseDb.settings,
        spreadsheetId: undefined,
        spreadsheetUrl: undefined,
        gasUrl: undefined,
        isUnlinked: true,
      };
      const dirtyVer = markSettingsDirty();
      mutationSeqRef.current += 1;
      const nextDb = { ...baseDb, settings: unlinkedSettings };
      dbRef.current = nextDb;
      setDb(nextDb);
      setSheetConnectionStatus({ checked: false, ok: false });
      void propagateServerMutation('saveSettings', { settings: unlinkedSettings });
      clearSettingsDirty(dirtyVer);
      showToast('ยกเลิกการเชื่อมโยง Google Sheet แล้ว', 'info');
      return;
    }

    const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const extractedId = raw ? (idMatch ? idMatch[1] : raw) : undefined;
    const normalizedUrl = raw
      ? raw.startsWith('http')
        ? raw
        : `https://docs.google.com/spreadsheets/d/${extractedId}/edit`
      : undefined;

    const updatedSettings: SystemSettings = {
      ...baseDb.settings,
      spreadsheetId: extractedId,
      spreadsheetUrl: normalizedUrl,
      gasUrl: trimmedGas || '',
      isUnlinked: false,
    };

    const dirtyVer = markSettingsDirty();
    mutationSeqRef.current += 1;
    const nextDb = { ...baseDb, settings: updatedSettings };
    dbRef.current = nextDb;
    setDb(nextDb);
    void propagateServerMutation('saveSettings', { settings: updatedSettings });

    if (trimmedGas) {
      await handleExportAllToGoogleSheet(trimmedGas, extractedId);
      clearSettingsDirty(dirtyVer);
    } else if (extractedId) {
      const status = await handleTestSheetConnection(extractedId, '');
      if (status.ok) {
        await handleSyncSpreadsheet(extractedId);
      }
      clearSettingsDirty(dirtyVer);
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
    const entrySlotKey = getWorkloadSlotKey(entry);
    const isDuplicateWorkloadSlot =
      savingWorkloadSlotsRef.current.has(entrySlotKey) ||
      dbRef.current.workloads.some((w) => getWorkloadSlotKey(w) === entrySlotKey);
    if (isDuplicateWorkloadSlot) {
      showToast(
        `ไม่สามารถบันทึกซ้ำได้: แผนก ${entry.clinic} วันที่ ${formatThaiShortDate(entry.date)} กะเวลา "${entry.shift}" มีข้อมูลในระบบแล้ว`,
        'error'
      );
      return;
    }

    savingWorkloadSlotsRef.current.add(entrySlotKey);
    try {
      const newLeaveEntries: LeaveRecord[] = [];
      const newOtEntries: OTAttendance[] = [];

      if (leaveData) {
        const existingLeaves = dbRef.current.leaves;
        const skippedNames: string[] = [];
        const entryDateNorm = normalizeLeaveDateStr(entry.date) || entry.date;
        leaveData.forEach((ld, idx) => {
          const cleanName = normalizeStaffNameKey(ld.staffName);
          if (!cleanName) return;
          const staff = db.staff.find(s => normalizeStaffNameKey(s.name) === cleanName);
          const numericDays = Number(ld.days) === 0.5 ? 0.5 : 1;
          const formattedNote = formatLeaveNoteWithPeriod(ld.note || '', numericDays, ld.periodLabel);
          const candidate: LeaveRecord = {
            id: `LV-AUTO-${Date.now()}-${idx}-${cleanName}`,
            startDate: entryDateNorm,
            endDate: entryDateNorm,
            staffName: cleanName,
            position: staff ? staff.position : 'RN',
            clinic: staff ? staff.homeClinic : entry.clinic,
            leaveType: ld.leaveType,
            days: numericDays,
            note: formattedNote,
          };
          const isDuplicateInDb =
            existingLeaves.some(l => isLeaveDuplicateConflict(l, candidate)) ||
            newLeaveEntries.some(l => isLeaveDuplicateConflict(l, candidate));
          if (isDuplicateInDb) {
            skippedNames.push(cleanName);
            return;
          }
          newLeaveEntries.push(candidate);
        });
        if (skippedNames.length > 0) {
          showToast(`ข้ามรายการลาซ้ำในวันเดียวกัน (${skippedNames.join(', ')}) เนื่องจากมีอยู่ในฐานข้อมูลแล้ว`, 'error');
        }
      }

      if (trainingData) {
        const existingLeaves = dbRef.current.leaves;
        const entryDateNorm = normalizeLeaveDateStr(entry.date) || entry.date;
        trainingData.forEach((td, idx) => {
          const cleanName = normalizeStaffNameKey(td.staffName);
          if (!cleanName) return;
          const staff = db.staff.find(s => normalizeStaffNameKey(s.name) === cleanName);
          const numericDays = Number(td.days) === 0.5 ? 0.5 : 1;
          const rawNote =
            [td.topic, td.note].filter(Boolean).join(' — ') ||
            `ไปอบรม/ประชุม (บันทึกจาก ${entry.clinic})`;
          const candidate: LeaveRecord = {
            id: `TRN-AUTO-${Date.now()}-${idx}-${cleanName}`,
            startDate: entryDateNorm,
            endDate: entryDateNorm,
            staffName: cleanName,
            position: staff ? staff.position : 'RN',
            clinic: staff ? staff.homeClinic : entry.clinic,
            leaveType: 'ไปอบรม/ประชุม',
            days: numericDays,
            note: formatLeaveNoteWithPeriod(rawNote, numericDays, td.periodLabel),
          };
          const isDuplicateInDb =
            existingLeaves.some(l => isLeaveDuplicateConflict(l, candidate)) ||
            newLeaveEntries.some(l => isLeaveDuplicateConflict(l, candidate));
          if (isDuplicateInDb) return;
          newLeaveEntries.push(candidate);
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
        leaves: deduplicateLeaves([...newLeaveEntries, ...baseDb.leaves]),
        ot: [...newOtEntries, ...baseDb.ot],
      };
      dbRef.current = nextDb;
      setDb(nextDb);

      const offStaffSavedCount = getWorkloadOffDutyStaff(entry).length;
      showToast(
        isOffDutyWorkload(entry)
          ? `บันทึกสถานะ Off เวรห้องตรวจ ${entry.clinic} สำเร็จ!`
          : offStaffSavedCount > 0
          ? `บันทึกภาระงานห้องตรวจ ${entry.clinic} (Off เวรรายวัน ${offStaffSavedCount} คน) สำเร็จ!`
          : `บันทึกภาระงานห้องตรวจ ${entry.clinic} สำเร็จ!`,
        'success'
      );

      // Every save runs sequentially through sheetOpQueue: push to Sheet -> sync & refresh Web App + broadcast via WebSocket
      await enqueueSheetOperation(async () => {
        await propagateServerMutation('addWorkloads', {
          workloads: [entry],
          leaves: newLeaveEntries,
          ot: newOtEntries,
        });

        const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
        const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

        if (targetGasUrl) {
          const [wRes, lRes, oRes] = await Promise.all([
            appendViaAppsScriptDetailed(targetGasUrl, 'appendWorkload', entry).then((r) => {
              if (r.ok) markWorkloadOutboxSynced([entry]);
              return r;
            }),
            newLeaveEntries.length > 0
              ? appendViaAppsScriptDetailed(targetGasUrl, 'appendLeave', newLeaveEntries).then((r) => {
                  if (r.ok) markLeaveOutboxSynced(newLeaveEntries);
                  return r;
                })
              : Promise.resolve({ ok: true } as { ok: boolean; httpStatus?: number; error?: string }),
            newOtEntries.length > 0
              ? appendViaAppsScriptDetailed(targetGasUrl, 'appendOT', newOtEntries).then((r) => {
                  if (r.ok) markOtOutboxSynced(newOtEntries);
                  return r;
                })
              : Promise.resolve({ ok: true } as { ok: boolean; httpStatus?: number; error?: string }),
          ]);
          const syncRes = await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
          const failedAppend = [wRes, lRes, oRes].find((r) => !r.ok);
          if (failedAppend && !syncRes.accessible) {
            const errDetail = failedAppend.error || syncRes.error || 'ตรวจสอบการเชื่อมต่อ Google Sheets';
            showToast(`บันทึกในระบบแล้ว แต่ส่งขึ้น Google Sheet ไม่สำเร็จ: ${errDetail}`, 'error');
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
            await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
          } else {
            await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
            showToast('บันทึกข้อมูลไว้ในระบบแล้ว (กรุณาวาง Web App URL /exec ใน "ตั้งค่าลิงก์ชีท" เพื่อให้ส่งขึ้น Google Sheet อัตโนมัติ)', 'info');
          }
        }
      });
    } finally {
      savingWorkloadSlotsRef.current.delete(entrySlotKey);
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
    const existingSlots = new Set(dbRef.current.workloads.map(getWorkloadSlotKey));
    const dupBatchEntry = entries.find((incoming) => {
      const slot = getWorkloadSlotKey(incoming);
      return savingWorkloadSlotsRef.current.has(slot) || existingSlots.has(slot);
    });
    if (dupBatchEntry) {
      showToast(
        `ไม่สามารถบันทึกซ้ำได้: แผนก ${dupBatchEntry.clinic} วันที่ ${formatThaiShortDate(dupBatchEntry.date)} กะเวลา "${dupBatchEntry.shift}" มีข้อมูลในระบบแล้ว`,
        'error'
      );
      return;
    }

    const batchSlots = entries.map(getWorkloadSlotKey);
    batchSlots.forEach((s) => savingWorkloadSlotsRef.current.add(s));
    try {
      const primaryEntry = entries[0];
      const newLeaveEntries: LeaveRecord[] = [];
      const newOtEntries: OTAttendance[] = [];

      if (leaveData) {
        const existingLeaves = dbRef.current.leaves;
        const skippedNames: string[] = [];
        const primaryDateNorm = normalizeLeaveDateStr(primaryEntry.date) || primaryEntry.date;
        leaveData.forEach((ld, idx) => {
          const cleanName = normalizeStaffNameKey(ld.staffName);
          if (!cleanName) return;
          const staff = db.staff.find(s => normalizeStaffNameKey(s.name) === cleanName);
          const numericDays = Number(ld.days) === 0.5 ? 0.5 : 1;
          const formattedNote = formatLeaveNoteWithPeriod(ld.note || '', numericDays, ld.periodLabel);
          const candidate: LeaveRecord = {
            id: `LV-AUTO-${Date.now()}-${idx}-${cleanName}`,
            startDate: primaryDateNorm,
            endDate: primaryDateNorm,
            staffName: cleanName,
            position: staff ? staff.position : 'RN',
            clinic: staff ? staff.homeClinic : PREMIUM_CLINIC_GROUP,
            leaveType: ld.leaveType,
            days: numericDays,
            note: formattedNote,
          };
          const isDuplicateInDb =
            existingLeaves.some(l => isLeaveDuplicateConflict(l, candidate)) ||
            newLeaveEntries.some(l => isLeaveDuplicateConflict(l, candidate));
          if (isDuplicateInDb) {
            skippedNames.push(cleanName);
            return;
          }
          newLeaveEntries.push(candidate);
        });
        if (skippedNames.length > 0) {
          showToast(`ข้ามรายการลาซ้ำในวันเดียวกัน (${skippedNames.join(', ')}) เนื่องจากมีอยู่ในฐานข้อมูลแล้ว`, 'error');
        }
      }

      if (trainingData) {
        const existingLeaves = dbRef.current.leaves;
        const primaryDateNorm = normalizeLeaveDateStr(primaryEntry.date) || primaryEntry.date;
        trainingData.forEach((td, idx) => {
          const cleanName = normalizeStaffNameKey(td.staffName);
          if (!cleanName) return;
          const staff = db.staff.find(s => normalizeStaffNameKey(s.name) === cleanName);
          const numericDays = Number(td.days) === 0.5 ? 0.5 : 1;
          const rawNote =
            [td.topic, td.note].filter(Boolean).join(' — ') ||
            `ไปอบรม/ประชุม (บันทึกจาก ${PREMIUM_CLINIC_GROUP})`;
          const candidate: LeaveRecord = {
            id: `TRN-AUTO-${Date.now()}-${idx}-${cleanName}`,
            startDate: primaryDateNorm,
            endDate: primaryDateNorm,
            staffName: cleanName,
            position: staff ? staff.position : 'RN',
            clinic: staff ? staff.homeClinic : PREMIUM_CLINIC_GROUP,
            leaveType: 'ไปอบรม/ประชุม',
            days: numericDays,
            note: formatLeaveNoteWithPeriod(rawNote, numericDays, td.periodLabel),
          };
          const isDuplicateInDb =
            existingLeaves.some(l => isLeaveDuplicateConflict(l, candidate)) ||
            newLeaveEntries.some(l => isLeaveDuplicateConflict(l, candidate));
          if (isDuplicateInDb) return;
          newLeaveEntries.push(candidate);
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
        leaves: deduplicateLeaves([...newLeaveEntries, ...baseDb.leaves]),
        ot: [...newOtEntries, ...baseDb.ot],
      };
      dbRef.current = nextDb;
      setDb(nextDb);

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

      await enqueueSheetOperation(async () => {
        await propagateServerMutation('addWorkloads', {
          workloads: entries,
          leaves: newLeaveEntries,
          ot: newOtEntries,
        });

        const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
        const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

        if (targetGasUrl) {
          const [wRes, lRes, oRes] = await Promise.all([
            appendViaAppsScriptDetailed(targetGasUrl, 'appendWorkload', entries).then((r) => {
              if (r.ok) markWorkloadOutboxSynced(entries);
              return r;
            }),
            newLeaveEntries.length > 0
              ? appendViaAppsScriptDetailed(targetGasUrl, 'appendLeave', newLeaveEntries).then((r) => {
                  if (r.ok) markLeaveOutboxSynced(newLeaveEntries);
                  return r;
                })
              : Promise.resolve({ ok: true } as { ok: boolean; httpStatus?: number; error?: string }),
            newOtEntries.length > 0
              ? appendViaAppsScriptDetailed(targetGasUrl, 'appendOT', newOtEntries).then((r) => {
                  if (r.ok) markOtOutboxSynced(newOtEntries);
                  return r;
                })
              : Promise.resolve({ ok: true } as { ok: boolean; httpStatus?: number; error?: string }),
          ]);
          const syncRes = await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
          const failedAppend = [wRes, lRes, oRes].find((r) => !r.ok);
          if (failedAppend && !syncRes.accessible) {
            const errDetail = failedAppend.error || syncRes.error || 'ตรวจสอบการเชื่อมต่อ Google Sheets';
            showToast(`บันทึกในระบบแล้ว แต่ส่งขึ้น Google Sheet ไม่สำเร็จ: ${errDetail}`, 'error');
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
            await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
          } else {
            await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
            showToast('บันทึกข้อมูลไว้ในระบบแล้ว (กรุณาวาง Web App URL /exec ใน "ตั้งค่าลิงก์ชีท" เพื่อให้ส่งขึ้น Google Sheet อัตโนมัติ)', 'info');
          }
        }
      });
    } finally {
      batchSlots.forEach((s) => savingWorkloadSlotsRef.current.delete(s));
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

  // Sequential direct Admin sync queue inside unified sheetOpQueue (writes to Sheet -> refreshes Web App & WebSocket viewers)
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

    void enqueueSheetOperation(async () => {
      adminWriteInFlightRef.current = true;
      try {
        const latestDb = dbRef.current;
        const targetGasUrl = (latestDb.settings.gasUrl || '').trim();
        const targetSheetId = (latestDb.settings.spreadsheetId || '').trim();
        const pin = unlockedAdminPinRef.current;

        if (targetedSettings && targetedSettings.changedEntries.length === 0) {
          clearSettingsDirty(expectedDirtyVersion);
          await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
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
              await broadcastSyncedSnapshot(targetRes.syncedDb);
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
                await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
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
              await broadcastSyncedSnapshot(staffRes.syncedDb);
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
                await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
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
              await broadcastSyncedSnapshot(settingsRes.syncedDb);
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
                await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
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
            await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
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
              await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
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
              await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
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
    const cleanName = normalizeStaffNameKey(leave.staffName);
    const lStart = normalizeLeaveDateStr(leave.startDate);
    const lEnd = normalizeLeaveDateStr(leave.endDate || leave.startDate) || lStart;
    const normalizedLeave: LeaveRecord = {
      ...leave,
      staffName: cleanName,
      startDate: lStart <= lEnd ? lStart : lEnd,
      endDate: lStart <= lEnd ? lEnd : lStart,
    };
    const slotKey = getLeaveKey(normalizedLeave);

    if (savingLeaveSlotsRef.current.has(slotKey)) {
      showToast(`กำลังบันทึกข้อมูลวันลาของ ${cleanName} อยู่ กรุณารอสักครู่ (ป้องกันการบันทึกซ้ำ)`, 'info');
      return;
    }

    const conflict = dbRef.current.leaves.find(existing =>
      isLeaveDuplicateConflict(existing, normalizedLeave)
    );
    if (conflict) {
      showToast(
        `ไม่สามารถบันทึกซ้ำได้: ${cleanName} มีรายการ "${conflict.leaveType}" ในวันที่ซ้ำซ้อน (${formatThaiLeaveRange(conflict.startDate, conflict.endDate)}) อยู่ในฐานข้อมูลแล้ว`,
        'error'
      );
      return;
    }

    savingLeaveSlotsRef.current.add(slotKey);
    try {
      clearLeaveTombstone(normalizedLeave);
      markLeavesRecentlySaved([normalizedLeave]);
      enqueuePendingOutboxLeaves([normalizedLeave]);
      mutationSeqRef.current += 1;
      const baseDb = dbRef.current;
      const nextDb = {
        ...baseDb,
        leaves: deduplicateLeaves([normalizedLeave, ...baseDb.leaves]),
      };
      dbRef.current = nextDb;
      setDb(nextDb);
      showToast(`บันทึกวันลา ${normalizedLeave.staffName} สำเร็จ!`, 'success');

      await enqueueSheetOperation(async () => {
        const srvRes = await propagateServerMutation('addLeave', { leave: normalizedLeave });
        if (srvRes && (srvRes as any).duplicateRejected) {
          markLeaveOutboxSynced([normalizedLeave]);
          removeLeaveRecentlySaved(normalizedLeave);
          const cleanServerDb = normalizeIncomingServerDb(srvRes.db, dbRef.current);
          dbRef.current = cleanServerDb;
          setDb(cleanServerDb);
          showToast(
            `ไม่สามารถบันทึกซ้ำได้: ${cleanName} มีประวัติการลาในวันที่ซ้ำซ้อนอยู่แล้ว (ซิงค์ข้อมูลล่าสุดให้ตรงกันแล้ว)`,
            'error'
          );
          return;
        }

        const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
        const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

        if (targetGasUrl) {
          const appendRes = await appendViaAppsScriptDetailed(targetGasUrl, 'appendLeave', normalizedLeave);
          if (appendRes.ok) markLeaveOutboxSynced([normalizedLeave]);
          const syncRes = await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
          if (!appendRes.ok && !syncRes.accessible) {
            showToast(
              `บันทึกวันลาในระบบแล้ว แต่ส่งขึ้น Google Sheet ไม่สำเร็จ: ${appendRes.error || syncRes.error || 'ตรวจสอบการเชื่อมต่อ Google Sheets'}`,
              'error'
            );
          }
        } else if (targetSheetId) {
          const token = await getAccessToken();
          if (token) {
            const ok = await appendLeaveToSheet(token, targetSheetId, normalizedLeave);
            if (ok) markLeaveOutboxSynced([normalizedLeave]);
            await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
          } else {
            await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
            showToast('บันทึกวันลาไว้ในระบบแล้ว (กรุณาวาง Web App URL /exec ใน "ตั้งค่าลิงก์ชีท" เพื่อให้ส่งขึ้น Google Sheet อัตโนมัติ)', 'info');
          }
        }
      });
    } finally {
      savingLeaveSlotsRef.current.delete(slotKey);
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

    const normStart = normalizeLeaveDateStr(updated.startDate);
    const normEnd = normalizeLeaveDateStr(updated.endDate || updated.startDate) || normStart;
    const stamped: LeaveRecord = {
      ...updated,
      staffName: normalizeStaffNameKey(updated.staffName),
      startDate: normStart <= normEnd ? normStart : normEnd,
      endDate: normStart <= normEnd ? normEnd : normStart,
      lastEditedAt: nowIso,
      lastEditReason: cleanReason,
      lastEditedBy: editedBy,
    };

    const updateConflict = baseDb.leaves.find((l) =>
      isLeaveDuplicateConflict(l, stamped, stamped.id)
    );
    if (updateConflict) {
      showToast(
        `ไม่สามารถบันทึกแก้ไขได้: ${stamped.staffName} มีประวัติ "${updateConflict.leaveType}" ในวันที่ซ้ำซ้อน (${formatThaiLeaveRange(updateConflict.startDate, updateConflict.endDate)}) อยู่ในระบบแล้ว`,
        'error'
      );
      return;
    }

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
      leaves: deduplicateLeaves(nextLeaves),
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
    showToast(`บันทึกเวรนอกเวลาจำนวน ${validRecords.length} คน เรียบร้อยแล้ว!`, 'success');

    await enqueueSheetOperation(async () => {
      await propagateServerMutation('addOt', { records: validRecords });

      const targetGasUrl = (dbRef.current.settings.gasUrl || '').trim();
      const targetSheetId = (dbRef.current.settings.spreadsheetId || '').trim();

      if (targetGasUrl) {
        const appendRes = await appendViaAppsScriptDetailed(targetGasUrl, 'appendOT', validRecords);
        if (appendRes.ok) markOtOutboxSynced(validRecords);
        const syncRes = await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
        if (!appendRes.ok && !syncRes.accessible) {
          showToast(
            `บันทึกเวร OT ในระบบแล้ว แต่ส่งขึ้น Google Sheet ไม่สำเร็จ: ${appendRes.error || syncRes.error || 'ตรวจสอบการเชื่อมต่อ Google Sheets'}`,
            'error'
          );
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
          await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
        } else {
          await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
          showToast('บันทึกเวร OT ไว้ในระบบแล้ว (กรุณาวาง Web App URL /exec ใน "ตั้งค่าลิงก์ชีท" เพื่อให้ส่งขึ้น Google Sheet อัตโนมัติ)', 'info');
        }
      }
    });
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
        ? 'เปิดซิงค์อัตโนมัติเมื่อเปิดหน้าต่าง/สลับเมนูแล้ว (ทุกการกดบันทึกจะซิงค์ทันทีเสมอ)'
        : 'ปิดการซิงค์อัตโนมัติเมื่อสลับหน้าต่างแล้ว (ทุกการกดบันทึกยังซิงค์ขึ้นชีททันที)',
      'info'
    );
  };

  // Handler: Save Unit Cost Center (allowed for general OPD staff from Menu 2 & persists locally + GAS + refreshes latest Sheet state)
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

    return enqueueSheetOperation(async () => {
      await propagateServerMutation('saveUnitCostCenter', {
        clinic: cleanClinic,
        costCenter: cleanCostCenter,
      });

      const gasUrl = (dbRef.current.settings.gasUrl || '').trim();
      if (gasUrl) {
        const res = await saveUnitCostCenterViaAppsScript({
          gasUrl,
          clinic: cleanClinic,
          costCenter: cleanCostCenter,
        });
        if (res.ok) {
          await executeSheetSyncNow({ reason: 'save', ignoreSeqGuard: true });
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
    });
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

    const LINE_QUOTA_PAUSED_MONTH_KEY = 'pcmc_line_quota_paused_month_v1';
    const bkkNowMonth = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
    })
      .format(new Date())
      .slice(0, 7);

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
        try {
          localStorage.removeItem(LINE_QUOTA_PAUSED_MONTH_KEY);
        } catch {
          // ignore
        }
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
      if (proxyRes.quotaExceeded) {
        try {
          localStorage.setItem(LINE_QUOTA_PAUSED_MONTH_KEY, bkkNowMonth);
        } catch {
          // ignore
        }
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
      try {
        localStorage.removeItem(LINE_QUOTA_PAUSED_MONTH_KEY);
      } catch {
        // ignore
      }
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
    if (res.quotaExceeded) {
      try {
        localStorage.setItem(LINE_QUOTA_PAUSED_MONTH_KEY, bkkNowMonth);
      } catch {
        // ignore
      }
    }
    const gasErr = res.error || 'ส่งรายงานเข้า LINE ไม่สำเร็จ';
    showToast(gasErr, 'error');
    return { ok: false, error: gasErr };
  };

  // Client-side multi-schedule Bangkok-time auto-scheduler (always syncs live Sheets data first + coordinated .jpeg upload & delivery)
  const checkLineSchedules = useCallback(async () => {
    if (lineAutoCheckInFlightRef.current) return;
    const curDb = dbRef.current;
    const st = curDb.settings;
    if (!st.lineAutoEnabled) return;

    lineAutoCheckInFlightRef.current = true;
    try {
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
      const bkkMonth = `${parts.year}-${parts.month}`;
      const nowMins = Number(bkkHour) * 60 + Number(parts.minute);

      const LINE_QUOTA_PAUSED_MONTH_KEY = 'pcmc_line_quota_paused_month_v1';
      try {
        if (localStorage.getItem(LINE_QUOTA_PAUSED_MONTH_KEY) === bkkMonth) {
          return;
        }
      } catch {
        // ignore
      }

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
        // Full 75-minute catch-up window (matching Code.gs & surviving 15-min grace wait!)
        if (diff < 0 || diff > 75) return false;
        if (!doesDateMatchLineDayRule(bkkYmd, sch.dayRule, customHolidays)) return false;
        return !dedupeMap[`${sch.id}|${bkkYmd}`];
      });
      if (dueSchedules.length === 0) return;

      // Always fetch fresh workloads from Google Sheets BEFORE rendering .jpeg & counting rows!
      const freshDb = await fetchLatestDbForLineSend(curDb);
      const freshSt = freshDb.settings;
      if (!freshSt.lineAutoEnabled) return;
      const premSubs = freshSt.premiumSubClinics || [...DEFAULT_PREMIUM_SUB_CLINICS];
      const globalSendFormat = resolveLineSendFormat(freshSt.lineSendFormat, freshSt.lineSendAsImage);

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

        const schedSendFormat: LineSendFormat =
          sch.sendAsImage === false ? 'TEXT_ONLY' : globalSendFormat;
        const wantImage = schedSendFormat !== 'TEXT_ONLY';

        // Coordinate across open tabs/machines via server claim lock so multiple browsers never double-send
        let claimToken = '';
        let serverClaimAvailable = false;
        try {
          const claimRes = await fetch('/api/line/auto-claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientId: tabInstanceIdRef.current,
              scheduleId: sch.id,
              time: schTime,
              shift: sch.shift,
              ymd: bkkYmd,
              wantImage,
            }),
          });
          if (claimRes.ok) {
            serverClaimAvailable = true;
            const claimJson = await claimRes.json();
            if (!claimJson?.claimed) {
              if (claimJson?.quotaPaused) {
                try {
                  localStorage.setItem(LINE_QUOTA_PAUSED_MONTH_KEY, bkkMonth);
                } catch {
                  // ignore
                }
                break;
              }
              if (claimJson?.alreadyCompleted) {
                dedupeMap[dedupeKey] = new Date().toISOString();
                try {
                  localStorage.setItem('pcmc_line_client_auto_dedupe_v1', JSON.stringify(dedupeMap));
                } catch {
                  // ignore
                }
              }
              continue;
            }
            claimToken = String(claimJson.claimToken || '');
          }
        } catch {
          // Proceed standalone if backend unavailable
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
        let imageUrl = '';
        let previewImageUrl = '';
        let renderedBase64 = '';

        if (wantImage) {
          try {
            const rendered = renderDailyCensusReportJpegDataUrl({
              workloads: freshDb.workloads,
              date: targetDate,
              shiftFilter: sch.shift,
              premiumSubClinics: premSubs,
            });
            renderedBase64 = rendered.base64;
            if (gasUrl) {
              const up = await uploadLineReportJpegViaAppsScript({
                gasUrl,
                base64Jpeg: rendered.base64,
                filename: `OPD_Census_${targetDate}_${sch.id}.jpeg`,
              });
              if (up.ok && up.imageUrl) {
                imageUrl = up.imageUrl;
                previewImageUrl = up.previewImageUrl || up.imageUrl;
              }
            }
          } catch {
            // proceed with fallback below
          }
        }

        let sentViaGas = false;
        let alreadySentWithImageOnGas = false;
        let sentOk = false;
        let quotaExceeded = false;

        if (gasUrl) {
          try {
            const gasRes = await fetch(gasUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              body: JSON.stringify({
                action: 'sendAutoScheduledLineReport',
                payload: {
                  scheduleId: sch.id,
                  scheduleTime: schTime,
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
                  ...(!imageUrl && renderedBase64 ? { imageBase64: renderedBase64 } : {}),
                },
              }),
            });
            if (gasRes.ok) {
              const gasJson = await gasRes.json();
              const gasErr = String(gasJson?.error || '');
              if (gasJson?.quotaExceeded || /429|monthly limit|โควต้าส่งข้อความ Push รายเดือน/i.test(gasErr)) {
                quotaExceeded = true;
              } else if (gasJson?.alreadySentWithImage) {
                alreadySentWithImageOnGas = true;
              } else if (gasJson?.success && !gasJson?.skipped) {
                sentViaGas = true;
                sentOk = true;
                if (gasJson?.imageUrl) {
                  imageUrl = String(gasJson.imageUrl);
                }
              }
            }
          } catch {
            // fallback to server proxy below
          }
        }

        if (!sentViaGas && !alreadySentWithImageOnGas && !quotaExceeded) {
          const proxyRes = await sendLineMessageViaServerProxy({
            targetId: targetIds[0] || DEFAULT_LINE_GROUP_ID,
            targetIds,
            message: msg,
            sendFormat: schedSendFormat,
            ...(imageUrl ? { imageUrl, previewImageUrl } : {}),
          });
          if (proxyRes.ok) {
            sentOk = true;
          } else if (proxyRes.quotaExceeded) {
            quotaExceeded = true;
          }
        }

        if (quotaExceeded) {
          try {
            localStorage.setItem(LINE_QUOTA_PAUSED_MONTH_KEY, bkkMonth);
          } catch {
            // ignore
          }
        }

        if (serverClaimAvailable) {
          try {
            await fetch('/api/line/auto-complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                scheduleId: sch.id,
                time: schTime,
                shift: sch.shift,
                ymd: bkkYmd,
                claimToken,
                ok: sentOk || alreadySentWithImageOnGas,
                quotaExceeded,
                sentWithImage: Boolean((sentOk && (imageUrl || renderedBase64)) || alreadySentWithImageOnGas),
                statusText: sentOk
                  ? `ส่งรายงานอัตโนมัติ (${sch.label || schTime}) สำเร็จ`
                  : quotaExceeded
                  ? 'โควต้าส่งข้อความ Push รายเดือน LINE OA เต็มแล้ว (HTTP 429) — พักการส่งอัตโนมัติในเดือนนี้'
                  : undefined,
              }),
            });
          } catch {
            // ignore
          }
        }

        // Lock local dedupe key after confirmed delivery OR monthly quota pause so it never loops every 30s
        if (sentOk || alreadySentWithImageOnGas || quotaExceeded) {
          dedupeMap[dedupeKey] = new Date().toISOString();
          try {
            localStorage.setItem('pcmc_line_client_auto_dedupe_v1', JSON.stringify(dedupeMap));
          } catch {
            // ignore
          }
        }
        if (quotaExceeded) break;
      }
    } finally {
      lineAutoCheckInFlightRef.current = false;
    }
  }, [fetchLatestDbForLineSend]);

  useEffect(() => {
    void checkLineSchedules();
    const timerId = window.setInterval(() => {
      void checkLineSchedules();
    }, 30_000);
    return () => window.clearInterval(timerId);
  }, [
    checkLineSchedules,
    db.settings.lineAutoEnabled,
    db.settings.lineSchedules,
    db.settings.lineSendFormat,
    db.settings.lineSendAsImage,
    db.workloads.length,
  ]);

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
        <div className="fixed bottom-6 right-6 z-50 max-w-md animate-bounce">
          <div className={`px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-2.5 text-xs font-semibold ${
            toastMessage.type === 'success' 
              ? 'bg-emerald-900 text-white border-emerald-700' 
              : toastMessage.type === 'error'
              ? 'bg-red-900 text-white border-red-700'
              : 'bg-slate-900 text-white border-cyan-700/70'
          }`}>
            {toastMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : toastMessage.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-cyan-400 shrink-0" />
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
            onExportAllToGoogleSheet={() => handleExportAllToGoogleSheet()}
            onTestSheetConnection={handleTestSheetConnection}
            onSaveSheetLinkConfig={handleSaveSheetLinkConfig}
            sheetConnectionStatus={sheetConnectionStatus}
            isExportingToSheet={isExportingToSheet}
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
