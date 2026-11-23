import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  StaffMember,
  StaffPosition,
  LeaveRecord,
  OTAttendance,
  DailyWorkload,
  LeaveType,
  LEAVE_TYPES,
  WorkShift,
  OT_SHIFTS,
  OUT_TIME_CLINICS,
  IN_TIME_CLINICS,
  ALL_POSITIONS,
  POSITION_LABELS,
  formatPositionLabel,
  CustomHoliday,
  AuditLogEntry,
  PREMIUM_CLINIC_GROUP,
  LEGACY_PREMIUM_CLINIC_GROUP,
  compareStaffByPositionAndStartDate,
  isTrainingLeaveType,
  isDailyWagePosition,
  parseLeavePeriodFromNote,
  stripLeavePeriodFromNote,
  formatLeaveNoteWithPeriod,
  parseOtWorkClinic,
  formatOtWorkClinicValue,
  HalfDayPeriod,
  SystemSettings,
  DEFAULT_OT_COST_CENTER,
  DEFAULT_OT_CONTROLLER_NAME,
  getOtHourlyRate,
  getDefaultOtHoursForShift,
  formatOtPaySheetPositionLabel,
  getEffectiveOtHours,
  normalizeStaffPosition,
  compareStaffByPositionAndStartDate as _compareRoster,
  getStaffEmployeeCode,
  isOtDuplicateConflict,
} from '../types';
import {
  CalendarClock,
  CalendarDays,
  UserPlus,
  Users,
  CheckSquare,
  Square,
  Search,
  Download,
  FileCheck2,
  Trash2,
  Award,
  Filter,
  Clock,
  Building,
  User,
  Calendar,
  Pencil,
  Save,
  X,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  BadgePlus,
  ImageDown,
  Printer,
  History,
  List,
  ReceiptText,
} from 'lucide-react';
import {
  formatThaiLeaveRange,
  formatThaiShortDate,
  formatThaiDateTime,
  splitThaiName,
  THAI_MONTHS,
  THAI_SHORT_MONTHS,
  getLocalTodayIso,
} from '../utils/thaiDate';
import {
  calculateGovernmentLeaveStats,
  countGovernmentWorkdaysInRange,
  getHolidaysForYear,
} from '../utils/thaiHolidays';
import { numberToThaiBahtText } from '../utils/thaiBahtText';
import { exportElementAsJpeg } from '../utils/exportImage';
import { ThaiDateInput } from './ThaiDateInput';

const THAI_CALENDAR_WEEKDAYS = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

function parseIsoParts(iso: string): { y: number; m: number; d: number } {
  const match = (iso || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  }
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function toIsoDate(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

function addDaysToIso(iso: string, delta: number): string {
  const { y, m, d } = parseIsoParts(iso);
  return toIsoDate(y, m, d + delta);
}

function addMonthsToIso(iso: string, deltaMonths: number): string {
  const { y, m, d } = parseIsoParts(iso);
  const targetFirst = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  const ty = targetFirst.getUTCFullYear();
  const tm = targetFirst.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return toIsoDate(ty, tm, Math.min(d, lastDay));
}

function getWeekIsoDates(anchorIso: string): string[] {
  const { y, m, d } = parseIsoParts(anchorIso);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const sunday = addDaysToIso(anchorIso, -dow);
  return Array.from({ length: 7 }, (_, i) => addDaysToIso(sunday, i));
}

function getMonthGridCells(anchorIso: string): { date: string; inMonth: boolean; dayNum: number }[] {
  const { y, m } = parseIsoParts(anchorIso);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const totalCells = firstDow + daysInMonth > 35 ? 42 : 35;
  const startIso = toIsoDate(y, m, 1 - firstDow);
  return Array.from({ length: totalCells }, (_, idx) => {
    const cellIso = addDaysToIso(startIso, idx);
    const parts = parseIsoParts(cellIso);
    return {
      date: cellIso,
      inMonth: parts.y === y && parts.m === m,
      dayNum: parts.d,
    };
  });
}

function formatThaiMonthHeader(anchorIso: string): string {
  const { y, m } = parseIsoParts(anchorIso);
  return `${THAI_MONTHS[Math.max(0, Math.min(11, m - 1))]} ${y + 543}`;
}

function formatThaiWeekRangeHeader(weekDates: string[]): string {
  if (weekDates.length === 0) return '';
  const first = parseIsoParts(weekDates[0]);
  const last = parseIsoParts(weekDates[weekDates.length - 1]);
  const m1 = THAI_SHORT_MONTHS[first.m - 1] || '';
  const m2 = THAI_SHORT_MONTHS[last.m - 1] || '';
  return `${first.d} ${m1} ${first.y + 543} – ${last.d} ${m2} ${last.y + 543}`;
}

interface LeaveAndOTTabProps {
  staffList: StaffMember[];
  leaves: LeaveRecord[];
  otRecords: OTAttendance[];
  auditLogs?: AuditLogEntry[];
  workloads?: DailyWorkload[];
  inTimeClinics?: string[];
  outTimeClinics?: string[];
  leaveTypes?: string[];
  customHolidays?: CustomHoliday[];
  settings?: SystemSettings;
  isAdmin?: boolean;
  onSaveLeave: (leave: LeaveRecord) => void;
  onSaveBatchOT: (records: OTAttendance[]) => void;
  onUpdateLeave?: (updated: LeaveRecord, reason: string) => void;
  onDeleteLeave: (id: string, reason: string) => void;
  onUpdateOT?: (updated: OTAttendance, reason: string) => void;
  onDeleteOT: (id: string, reason: string) => void;
  onSaveUnitCostCenter?: (
    clinic: string,
    costCenter: string
  ) => Promise<{ ok: boolean; error?: string }>;
}

interface ExternalOtDraft {
  tempId: string;
  employeeCode?: string;
  name: string;
  position: StaffPosition;
  affiliation: string;
  hours: number;
}

const formatOtHourNum = (h: number): string => {
  const rounded = Math.round(h * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
};

const formatOtMoney = (amt: number): string => {
  return (Math.round(amt * 100) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatOtOfficialClinicName = (clinic: string): string => {
  const c = (clinic || '').trim();
  if (!c || c === 'ALL') return 'ทุกห้องตรวจ';
  if (c.startsWith('ตรวจ')) return `ห้อง${c}`;
  if (/^(ห้อง|หน่วย|ศูนย์|คลินิก)/.test(c)) return c;
  return `ห้องตรวจ${c}`;
};

const getOtPayGroupRank = (pos: StaffPosition | string): number => {
  const norm = normalizeStaffPosition(pos);
  if (norm === 'HN' || norm === 'RN' || norm === 'RN (Daily Wage)') return 1;
  if (norm === 'PN' || norm === 'PN (Daily Wage)') return 2;
  if (norm === 'NA' || norm === 'PCA' || norm === 'NA (Daily Wage)') return 3;
  if (norm === 'Clerk' || norm === 'Clerk (Referral)' || norm === 'Clerk (Daily Wage)') return 4;
  if (norm === 'Service Worker' || norm === 'Service Worker (Daily Wage)') return 5;
  return 9;
};

export const LeaveAndOTTab: React.FC<LeaveAndOTTabProps> = ({
  staffList,
  leaves,
  otRecords,
  auditLogs = [],
  workloads: _workloads = [],
  inTimeClinics = [...IN_TIME_CLINICS],
  outTimeClinics = [...OUT_TIME_CLINICS],
  leaveTypes = [...LEAVE_TYPES],
  customHolidays = [],
  settings,
  isAdmin = false,
  onSaveLeave,
  onSaveBatchOT,
  onUpdateLeave,
  onDeleteLeave,
  onUpdateOT,
  onDeleteOT,
  onSaveUnitCostCenter,
}) => {
  const todayStr = getLocalTodayIso();

  const [activeSubTab, setActiveSubTab] = useState<'leave' | 'ot' | 'fiscalSummary' | 'otPayReport'>('leave');
  const [summaryReportMode, setSummaryReportMode] = useState<'ALL' | 'WORK_OT' | 'LEAVE_REPORT'>('ALL');
  const [onlyStaffWithLeaves, setOnlyStaffWithLeaves] = useState<boolean>(false);
  const [isExportingLeaveJpeg, setIsExportingLeaveJpeg] = useState<boolean>(false);
  const [isExportingOtPayJpeg, setIsExportingOtPayJpeg] = useState<boolean>(false);
  const [printTarget, setPrintTarget] = useState<'NONE' | 'LEAVE_REPORT' | 'OT_PAY_REPORT'>('NONE');
  const leaveReportRef = useRef<HTMLDivElement | null>(null);
  const otPaymentReportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleAfterPrint = () => setPrintTarget('NONE');
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const activeStaff = useMemo(() => {
    return staffList
      .filter((s) => s.status === 'Active')
      .sort(compareStaffByPositionAndStartDate);
  }, [staffList]);

  const allClinics = useMemo(() => {
    return Array.from(
      new Set([
        ...inTimeClinics,
        ...outTimeClinics,
        PREMIUM_CLINIC_GROUP,
        ...staffList.map((s) => (s.homeClinic || '').trim()).filter(Boolean),
      ])
    ).filter((c) => c && c !== LEGACY_PREMIUM_CLINIC_GROUP);
  }, [inTimeClinics, outTimeClinics, staffList]);

  // --- Sub-Tab 1: Leave Entry State ---
  const [leaveStartDate, setLeaveStartDate] = useState<string>(todayStr);
  const [leaveEndDate, setLeaveEndDate] = useState<string>(todayStr);
  const [leaveStaffId, setLeaveStaffId] = useState<string>('');
  const [leaveStaffQuery, setLeaveStaffQuery] = useState<string>('');
  const [isLeaveDropdownOpen, setIsLeaveDropdownOpen] = useState<boolean>(false);
  const [leaveFormError, setLeaveFormError] = useState<string>('');
  const leaveDropdownRef = useRef<HTMLDivElement | null>(null);

  const [leaveType, setLeaveType] = useState<LeaveType>(leaveTypes[0] || 'ลาพักผ่อน');
  const [leaveDays, setLeaveDays] = useState<number>(1);
  const [leaveHalfPeriod, setLeaveHalfPeriod] = useState<HalfDayPeriod>('');
  const [leaveNote, setLeaveNote] = useState<string>('');

  useEffect(() => {
    if (leaveTypes.length > 0 && !leaveTypes.includes(leaveType)) {
      setLeaveType(leaveTypes[0]);
    }
  }, [leaveTypes, leaveType]);

  // Dual Filter for Leave History + Upcoming 5-7 toggle + Leave Calendar State
  const [leaveSearchStaff, setLeaveSearchStaff] = useState<string>('');
  const [leaveFilterType, setLeaveFilterType] = useState<string>('ALL');
  const [showAllLeaveHistory, setShowAllLeaveHistory] = useState<boolean>(false);
  const [recentSavedLeaveIds, setRecentSavedLeaveIds] = useState<string[]>([]);
  const [leaveCalView, setLeaveCalView] = useState<'month' | 'week' | 'day'>('month');
  const [leaveCalAnchor, setLeaveCalAnchor] = useState<string>(todayStr);
  const [leaveCalStaff, setLeaveCalStaff] = useState<string>('ALL');
  const [leaveCalType, setLeaveCalType] = useState<string>('ALL');

  const [editingLeave, setEditingLeave] = useState<LeaveRecord | null>(null);
  const [editLeaveReason, setEditLeaveReason] = useState<string>('');
  const [editLeaveReasonError, setEditLeaveReasonError] = useState<string>('');
  const [editLeaveDuplicateError, setEditLeaveDuplicateError] = useState<string>('');
  const [deletingLeave, setDeletingLeave] = useState<LeaveRecord | null>(null);
  const [deleteLeaveReason, setDeleteLeaveReason] = useState<string>('');
  const [deleteLeaveReasonError, setDeleteLeaveReasonError] = useState<string>('');
  const [showLeaveAuditLog, setShowLeaveAuditLog] = useState<boolean>(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (leaveDropdownRef.current && !leaveDropdownRef.current.contains(event.target as Node)) {
        setIsLeaveDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLeaveStaff = useMemo(() => {
    return activeStaff.find((s) => s.staffId === leaveStaffId) || null;
  }, [activeStaff, leaveStaffId]);

  const findOverlappingLeaveConflict = (
    targetStaffName: string,
    targetLeaveType: string,
    startIso: string,
    endIso: string,
    excludeId?: string,
    targetDays?: number,
    targetPeriod?: HalfDayPeriod
  ): LeaveRecord | null => {
    const cleanName = (targetStaffName || '').trim().replace(/\s+/g, ' ');
    if (!cleanName || !startIso) return null;
    const rangeEnd = (endIso || startIso).trim();
    const targetIsTraining = isTrainingLeaveType(targetLeaveType);
    const effTargetDays = targetDays ?? (startIso === rangeEnd ? Number(leaveDays) || 1 : 1);
    const effTargetPeriod = targetPeriod ?? (effTargetDays === 0.5 ? leaveHalfPeriod : '');
    return (
      leaves.find((lv) => {
        if (excludeId && lv.id === excludeId) return false;
        if ((lv.staffName || '').trim().replace(/\s+/g, ' ') !== cleanName) return false;
        const lvStart = (lv.startDate || '').trim();
        const lvEnd = (lv.endDate || lvStart).trim();
        if (!lvStart) return false;
        if (!(startIso <= lvEnd && rangeEnd >= lvStart)) return false;

        const lvIsTraining = isTrainingLeaveType(lv.leaveType);
        if (lvIsTraining === targetIsTraining) return true;

        // Leave vs Training on overlapping date: only allow if BOTH are 0.5 single-day with distinct periods
        const lvDays = Number(lv.days) || 1;
        const lvPeriod = parseLeavePeriodFromNote(lv.note);
        if (
          lvStart === lvEnd &&
          startIso === rangeEnd &&
          lvDays === 0.5 &&
          effTargetDays === 0.5 &&
          lvPeriod &&
          effTargetPeriod &&
          lvPeriod !== effTargetPeriod
        ) {
          return false;
        }
        return true;
      }) || null
    );
  };

  const overlappingLeaveInDb = useMemo(() => {
    if (!selectedLeaveStaff) return null;
    return findOverlappingLeaveConflict(
      selectedLeaveStaff.name,
      leaveType,
      leaveStartDate,
      leaveEndDate,
      undefined,
      Number(leaveDays) || 1,
      leaveHalfPeriod
    );
  }, [selectedLeaveStaff, leaveType, leaveStartDate, leaveEndDate, leaveDays, leaveHalfPeriod, leaves]);

  const filteredLeaveDropdownStaff = useMemo(() => {
    const q = leaveStaffQuery.toLowerCase().trim();
    if (!q) return activeStaff;
    return activeStaff.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        formatPositionLabel(s.position).toLowerCase().includes(q) ||
        s.homeClinic.toLowerCase().includes(q)
    );
  }, [activeStaff, leaveStaffQuery]);

  const filteredLeaves = useMemo(() => {
    return leaves.filter((lv) => {
      const matchStaff =
        !leaveSearchStaff.trim() ||
        lv.staffName.toLowerCase().includes(leaveSearchStaff.toLowerCase().trim());
      const matchType = leaveFilterType === 'ALL' || lv.leaveType === leaveFilterType;
      return matchStaff && matchType;
    });
  }, [leaves, leaveSearchStaff, leaveFilterType]);

  // Prioritize upcoming 5-7 nearest leaves by default; always keep newly saved records immediately visible
  const leaveHistoryDisplay = useMemo(() => {
    const upcoming = filteredLeaves
      .filter((lv) => (lv.endDate || lv.startDate || '') >= todayStr)
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    const past = filteredLeaves
      .filter((lv) => (lv.endDate || lv.startDate || '') < todayStr)
      .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

    const hasUpcoming = upcoming.length > 0;
    const defaultSlice = hasUpcoming ? upcoming.slice(0, 7) : past.slice(0, 7);
    const pinnedRecent = recentSavedLeaveIds
      .map((id) => filteredLeaves.find((lv) => lv.id === id))
      .filter((lv): lv is LeaveRecord => Boolean(lv));
    const pinnedIds = new Set(pinnedRecent.map((lv) => lv.id));
    const compactRows =
      pinnedRecent.length > 0
        ? [...pinnedRecent, ...defaultSlice.filter((lv) => !pinnedIds.has(lv.id))]
        : defaultSlice;
    const rows = showAllLeaveHistory ? filteredLeaves : compactRows;
    return {
      rows,
      upcomingCount: upcoming.length,
      showingUpcomingOnly: !showAllLeaveHistory && hasUpcoming,
      isTruncated: !showAllLeaveHistory && filteredLeaves.length > compactRows.length,
    };
  }, [filteredLeaves, todayStr, showAllLeaveHistory, recentSavedLeaveIds]);

  // Business rule: "การไปอบรม/ประชุมไม่นับเป็นวันลา ให้ถือเป็นวันทำงานตามปกติ"
  const totalFilteredLeaveDays = useMemo(() => {
    return filteredLeaves
      .filter((l) => !isTrainingLeaveType(l.leaveType))
      .reduce((sum, l) => sum + (Number(l.days) || 0), 0);
  }, [filteredLeaves]);

  const totalFilteredTrainingDays = useMemo(() => {
    return filteredLeaves
      .filter((l) => isTrainingLeaveType(l.leaveType))
      .reduce((sum, l) => sum + (Number(l.days) || 0), 0);
  }, [filteredLeaves]);

  const leaveDayStats = useMemo(() => {
    return calculateGovernmentLeaveStats(leaveStartDate, leaveEndDate, customHolidays);
  }, [leaveStartDate, leaveEndDate, customHolidays]);

  useEffect(() => {
    setLeaveDays(leaveDayStats.workDays);
    if (leaveStartDate !== leaveEndDate) {
      setLeaveHalfPeriod('');
    }
  }, [leaveDayStats.workDays, leaveStartDate, leaveEndDate]);

  const handleStartDateChange = (d: string) => {
    setLeaveStartDate(d);
    if (d > leaveEndDate) setLeaveEndDate(d);
    setLeaveFormError('');
  };

  const handleEndDateChange = (d: string) => {
    if (d < leaveStartDate) {
      setLeaveEndDate(leaveStartDate);
    } else {
      setLeaveEndDate(d);
    }
    setLeaveFormError('');
  };

  // --- Sub-Tab 2: OT Entry State (Multi-Select + Exact Hours + External Substitute) ---
  const [otDate, setOtDate] = useState<string>(todayStr);
  const [otShift, setOtShift] = useState<WorkShift>('นอกเวลาเย็น 16:00-20:00');
  const [otHours, setOtHours] = useState<number>(() =>
    getDefaultOtHoursForShift('นอกเวลาเย็น 16:00-20:00', settings?.stdHr)
  );
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [selectedOtHoursByStaffId, setSelectedOtHoursByStaffId] = useState<Record<string, number>>({});
  const [workClinic, setWorkClinic] = useState<string>(outTimeClinics[0] || OUT_TIME_CLINICS[0]);
  const [otSearch, setOtSearch] = useState<string>('');
  const [otFormError, setOtFormError] = useState<string>('');

  // External substitute staff state
  const [extEmployeeCode, setExtEmployeeCode] = useState<string>('');
  const [extName, setExtName] = useState<string>('');
  const [extPosition, setExtPosition] = useState<StaffPosition>('RN');
  const [extAffiliation, setExtAffiliation] = useState<string>('');
  const [extOtHours, setExtOtHours] = useState<number>(() =>
    getDefaultOtHoursForShift('นอกเวลาเย็น 16:00-20:00', settings?.stdHr)
  );
  const [extError, setExtError] = useState<string>('');
  const [externalOtStaff, setExternalOtStaff] = useState<ExternalOtDraft[]>([]);

  // OT Calendar & History search + edit/delete modal with mandatory reason
  const [otCalView, setOtCalView] = useState<'month' | 'week' | 'day' | 'list'>('month');
  const [otCalAnchor, setOtCalAnchor] = useState<string>(todayStr);
  const [otCalStaff, setOtCalStaff] = useState<string>('ALL');
  const [otCalClinic, setOtCalClinic] = useState<string>('ALL');
  const [otHistorySearch, setOtHistorySearch] = useState<string>('');
  const [editingOT, setEditingOT] = useState<OTAttendance | null>(null);
  const [editOtReason, setEditOtReason] = useState<string>('');
  const [editOtReasonError, setEditOtReasonError] = useState<string>('');
  const [editOtDuplicateError, setEditOtDuplicateError] = useState<string>('');
  const [deletingOT, setDeletingOT] = useState<OTAttendance | null>(null);
  const [deleteOtReason, setDeleteOtReason] = useState<string>('');
  const [deleteOtReasonError, setDeleteOtReasonError] = useState<string>('');
  const [showOtAuditLog, setShowOtAuditLog] = useState<boolean>(false);

  // --- Sub-Tab 4: OT Payment Sheet (Image 4 Form) State ---
  const todayParts = parseIsoParts(todayStr);
  const [otPayMonth, setOtPayMonth] = useState<number>(todayParts.m);
  const [otPayYearBE, setOtPayYearBE] = useState<number>(todayParts.y + 543);
  const [otPayClinic, setOtPayClinic] = useState<string>(
    outTimeClinics[0] || OUT_TIME_CLINICS[0] || 'ตรวจโรคทั่วไป'
  );
  const [otPayShiftScope, setOtPayShiftScope] = useState<
    'OUT_TIME' | 'ALL_OT' | WorkShift
  >('OUT_TIME');
  const [otPaySearch, setOtPaySearch] = useState<string>('');
  const [localUnitCostCenters, setLocalUnitCostCenters] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('pcmc_unit_cost_centers');
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const [otPayCostCenterOverride, setOtPayCostCenterOverride] = useState<string>('');
  const [isSavingUnitCostCenter, setIsSavingUnitCostCenter] = useState<boolean>(false);
  const [unitCostCenterSavedBadge, setUnitCostCenterSavedBadge] = useState<string>('');
  const [otPayControllerOverride, setOtPayControllerOverride] = useState<string>('');

  const otWorkClinicOptions = useMemo(() => {
    return allClinics;
  }, [allClinics]);

  useEffect(() => {
    if (otWorkClinicOptions.length > 0 && !otWorkClinicOptions.includes(workClinic)) {
      setWorkClinic(otWorkClinicOptions[0]);
    }
  }, [otWorkClinicOptions, workClinic]);

  const hasFilledExternalDraft = Boolean(extName.trim() || extAffiliation.trim());
  const readyExtDraft = Boolean(extName.trim() && extAffiliation.trim());
  const totalOtSelectedCount = selectedStaffIds.length + externalOtStaff.length + (readyExtDraft ? 1 : 0);
  const leaveFormErrorRef = useRef<HTMLDivElement | null>(null);
  const otFormErrorRef = useRef<HTMLDivElement | null>(null);

  const findOtConflictForName = (name: string, dateIso: string, shiftVal: WorkShift, targetClinic: string, excludeId?: string) => {
    return otRecords.find((o) =>
      isOtDuplicateConflict(o, { date: dateIso, shift: shiftVal, staffName: name, workClinic: targetClinic }, excludeId)
    ) || null;
  };

  const conflictingSelectedOtList = useMemo(() => {
    const conflicts: { name: string; existingClinic: string }[] = [];
    const seenNames = new Set<string>();
    selectedStaffIds.forEach((id) => {
      const staff = staffList.find((s) => s.staffId === id);
      const name = (staff ? staff.name : id).trim();
      const dup = findOtConflictForName(name, otDate, otShift, workClinic);
      if (dup) {
        conflicts.push({ name, existingClinic: parseOtWorkClinic(dup.workClinic).clinic || dup.workClinic });
      }
      seenNames.add(name.replace(/\s+/g, ' '));
    });
    externalOtStaff.forEach((ext) => {
      const name = ext.name.trim();
      const norm = name.replace(/\s+/g, ' ');
      const dup = findOtConflictForName(name, otDate, otShift, workClinic);
      if (dup) {
        conflicts.push({ name, existingClinic: parseOtWorkClinic(dup.workClinic).clinic || dup.workClinic });
      } else if (seenNames.has(norm)) {
        conflicts.push({ name, existingClinic: 'ซ้ำในชุดที่กำลังบันทึก' });
      }
      seenNames.add(norm);
    });
    return conflicts;
  }, [selectedStaffIds, externalOtStaff, staffList, otRecords, otDate, otShift, workClinic]);

  const leaveCalendarStaffOptions = useMemo(() => {
    const set = new Set<string>();
    activeStaff.forEach((s) => set.add(s.name));
    leaves.forEach((l) => {
      if (l.staffName) set.add(l.staffName);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
  }, [activeStaff, leaves]);

  const otCalendarStaffOptions = useMemo(() => {
    const set = new Set<string>();
    activeStaff.forEach((s) => set.add(s.name));
    otRecords.forEach((o) => {
      if (o.staffName) set.add(o.staffName);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'th'));
  }, [activeStaff, otRecords]);

  const filteredOtRecords = useMemo(() => {
    const q = otHistorySearch.toLowerCase().trim();
    return otRecords.filter((o) => {
      if (otCalStaff !== 'ALL' && o.staffName !== otCalStaff) return false;
      const parsedWork = parseOtWorkClinic(o.workClinic);
      if (otCalClinic !== 'ALL' && parsedWork.clinic !== otCalClinic) return false;
      if (!q) return true;
      return (
        o.staffName.toLowerCase().includes(q) ||
        o.workClinic.toLowerCase().includes(q) ||
        (o.affiliation || o.homeClinic).toLowerCase().includes(q) ||
        o.shift.toLowerCase().includes(q) ||
        o.date.includes(q)
      );
    });
  }, [otRecords, otCalStaff, otCalClinic, otHistorySearch]);

  const calendarHolidayMap = useMemo(() => {
    const lYear = parseIsoParts(leaveCalAnchor).y;
    const map = new Map(getHolidaysForYear(lYear, customHolidays));
    if (lYear - 1 >= 2020) {
      getHolidaysForYear(lYear - 1, customHolidays).forEach((v, k) => map.set(k, v));
    }
    getHolidaysForYear(lYear + 1, customHolidays).forEach((v, k) => map.set(k, v));
    return map;
  }, [leaveCalAnchor, customHolidays]);

  const filteredLeaveCalendarRecords = useMemo(() => {
    return leaves.filter((lv) => {
      if (leaveCalStaff !== 'ALL' && lv.staffName !== leaveCalStaff) return false;
      if (leaveCalType !== 'ALL' && lv.leaveType !== leaveCalType) return false;
      return true;
    });
  }, [leaves, leaveCalStaff, leaveCalType]);

  const getLeavesOnCalendarDate = (dateIso: string): LeaveRecord[] => {
    const { y, m, d } = parseIsoParts(dateIso);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const isNonWorkday = dow === 0 || dow === 6 || calendarHolidayMap.has(dateIso);
    return filteredLeaveCalendarRecords.filter((lv) => {
      const s = (lv.startDate || '').trim();
      const e = (lv.endDate || s).trim();
      if (!s || dateIso < s || dateIso > e) return false;
      if (s !== e && isNonWorkday) return false;
      return true;
    });
  };

  // --- Sub-Tab 3: Fiscal Summary Filter States ---
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number>(2570);
  const [shiftFilter, setShiftFilter] = useState<'ALL' | 'IN_TIME' | 'OT'>('ALL');
  const [clinicFilter, setClinicFilter] = useState<string>('ALL');
  const [fiscalPositionFilter, setFiscalPositionFilter] = useState<string>('ALL');
  const [staffFilter, setStaffFilter] = useState<string>('ALL');
  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [summarySearchQuery, setSummarySearchQuery] = useState<string>('');

  // Handle Save Leave
  const handleSaveLeaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const scrollLeaveErr = () => {
      setTimeout(() => leaveFormErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
    };
    const staff = staffList.find((s) => s.staffId === leaveStaffId);
    if (!staff) {
      setLeaveFormError('กรุณาพิมพ์ค้นหาและเลือกเจ้าหน้าที่จากรายการ');
      scrollLeaveErr();
      return;
    }
    const conflict = findOverlappingLeaveConflict(
      staff.name,
      leaveType,
      leaveStartDate,
      leaveEndDate,
      undefined,
      Number(leaveDays) || 1,
      leaveHalfPeriod
    );
    if (conflict) {
      setLeaveFormError(
        `ไม่สามารถบันทึกซ้ำได้: ${staff.name} มีประวัติ "${conflict.leaveType}" วันที่ ${formatThaiLeaveRange(conflict.startDate, conflict.endDate)} (${conflict.days} วัน) อยู่ในฐานข้อมูลแล้ว`
      );
      scrollLeaveErr();
      return;
    }
    const numericDays = Number(leaveDays) || 0;
    if (numericDays <= 0) {
      setLeaveFormError('ช่วงวันที่เลือกตรงกับวันหยุดราชการทั้งหมด (0 วัน) กรุณาเลือกวันทำการ หรือระบุจำนวนวันลาด้วยตนเอง');
      scrollLeaveErr();
      return;
    }
    setLeaveFormError('');

    const formattedNote = formatLeaveNoteWithPeriod(leaveNote, numericDays, leaveHalfPeriod);

    const newLeave: LeaveRecord = {
      id: `LV-${Date.now()}`,
      startDate: leaveStartDate,
      endDate: leaveEndDate,
      staffName: staff.name,
      position: staff.position,
      clinic: staff.homeClinic,
      leaveType,
      days: numericDays,
      note: formattedNote,
    };

    onSaveLeave(newLeave);
    setRecentSavedLeaveIds((prev) => [newLeave.id, ...prev.filter((id) => id !== newLeave.id)]);
    setLeaveCalAnchor(leaveStartDate);
    setLeaveNote('');
    setLeaveHalfPeriod('');
    setLeaveStaffId('');
    setLeaveStaffQuery('');
  };

  const handleOtShiftChange = (nextShift: WorkShift) => {
    setOtShift(nextShift);
    const nextDefault = getDefaultOtHoursForShift(nextShift, settings?.stdHr);
    setOtHours((prevBatch) => {
      setSelectedOtHoursByStaffId((prevMap) => {
        const nextMap = { ...prevMap };
        selectedStaffIds.forEach((id) => {
          if (nextMap[id] === undefined || Math.abs(nextMap[id] - prevBatch) < 0.001) {
            nextMap[id] = nextDefault;
          }
        });
        return nextMap;
      });
      return nextDefault;
    });
    setExtOtHours(nextDefault);
  };

  const handleBatchOtHoursChange = (rawVal: number) => {
    const safeVal =
      Number.isFinite(rawVal) && rawVal > 0 ? Math.min(24, Math.max(0.5, rawVal)) : 4;
    setOtHours((prevBatch) => {
      setSelectedOtHoursByStaffId((prevMap) => {
        const nextMap = { ...prevMap };
        selectedStaffIds.forEach((id) => {
          if (nextMap[id] === undefined || Math.abs(nextMap[id] - prevBatch) < 0.001) {
            nextMap[id] = safeVal;
          }
        });
        return nextMap;
      });
      return safeVal;
    });
    setExtOtHours((prevExt) => (Math.abs(prevExt - otHours) < 0.001 ? safeVal : prevExt));
  };

  // Handle Add External Staff to Batch OT
  const handleAddExternalStaff = () => {
    const trimmedName = extName.trim();
    const trimmedAff = extAffiliation.trim();
    const trimmedCode = extEmployeeCode.trim();
    const numericHours =
      Number.isFinite(extOtHours) && extOtHours > 0 ? Math.min(24, extOtHours) : otHours;
    if (!trimmedName || !trimmedAff) {
      setExtError('กรุณากรอกทั้ง ชื่อ-สกุล และ สังกัด / หน่วยงานต้นสังกัด');
      return;
    }
    const normExtName = trimmedName.replace(/\s+/g, ' ');
    const dupInBatch =
      externalOtStaff.some((x) => x.name.trim().replace(/\s+/g, ' ') === normExtName) ||
      selectedStaffIds.some((id) => {
        const st = staffList.find((s) => s.staffId === id);
        return (st?.name || '').trim().replace(/\s+/g, ' ') === normExtName;
      });
    if (dupInBatch) {
      setExtError(`ไม่สามารถเพิ่มซ้ำได้: ${trimmedName} ถูกเลือกอยู่ในรายการบันทึกชุดนี้แล้ว`);
      return;
    }
    const dupInDb = findOtConflictForName(trimmedName, otDate, otShift, workClinic);
    if (dupInDb) {
      const exClinic = parseOtWorkClinic(dupInDb.workClinic).clinic || dupInDb.workClinic;
      setExtError(
        `ไม่สามารถเพิ่มซ้ำได้: ${trimmedName} มีประวัติขึ้นเวร (${exClinic}) วันที่ ${formatThaiShortDate(otDate)} กะ "${otShift}" อยู่ในฐานข้อมูลแล้ว`
      );
      return;
    }
    setExtError('');
    setOtFormError('');
    setExternalOtStaff((prev) => [
      ...prev,
      {
        tempId: `EXT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        ...(trimmedCode ? { employeeCode: trimmedCode } : {}),
        name: trimmedName,
        position: extPosition,
        affiliation: trimmedAff,
        hours: numericHours,
      },
    ]);
    setExtEmployeeCode('');
    setExtName('');
    setExtAffiliation('');
    setExtOtHours(otHours);
  };

  // Handle Save Batch OT
  const handleSaveBatchOTSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const scrollOtErr = () => {
      setTimeout(() => otFormErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 30);
    };

    const trimmedDraftName = extName.trim();
    const trimmedDraftAff = extAffiliation.trim();
    const trimmedDraftCode = extEmployeeCode.trim();
    const draftHours = Number.isFinite(extOtHours) && extOtHours > 0 ? Math.min(24, extOtHours) : otHours;

    if ((trimmedDraftName && !trimmedDraftAff) || (!trimmedDraftName && trimmedDraftAff)) {
      const msg = 'กรุณากรอกทั้ง ชื่อ-สกุล และ สังกัด ของเจ้าหน้าที่เฉพาะกิจให้ครบก่อนบันทึก';
      setExtError(msg);
      setOtFormError(msg);
      scrollOtErr();
      return;
    }

    let draftExternalItem: {
      tempId: string;
      employeeCode?: string;
      name: string;
      position: StaffPosition;
      affiliation: string;
      hours: number;
    } | null = null;

    if (trimmedDraftName && trimmedDraftAff) {
      const normExtName = trimmedDraftName.replace(/\s+/g, ' ');
      const dupInBatch =
        externalOtStaff.some((x) => x.name.trim().replace(/\s+/g, ' ') === normExtName) ||
        selectedStaffIds.some((id) => {
          const st = staffList.find((s) => s.staffId === id);
          return (st?.name || '').trim().replace(/\s+/g, ' ') === normExtName;
        });
      if (dupInBatch) {
        const msg = `ไม่สามารถเพิ่มซ้ำได้: ${trimmedDraftName} ถูกเลือกอยู่ในรายการบันทึกชุดนี้แล้ว`;
        setExtError(msg);
        setOtFormError(msg);
        scrollOtErr();
        return;
      }
      const dupInDb = findOtConflictForName(trimmedDraftName, otDate, otShift, workClinic);
      if (dupInDb) {
        const exClinic = parseOtWorkClinic(dupInDb.workClinic).clinic || dupInDb.workClinic;
        const msg = `ไม่สามารถบันทึกซ้ำได้: ${trimmedDraftName} มีประวัติขึ้นเวร (${exClinic}) วันที่ ${formatThaiShortDate(otDate)} กะ "${otShift}" อยู่ในฐานข้อมูลแล้ว`;
        setExtError(msg);
        setOtFormError(msg);
        scrollOtErr();
        return;
      }
      draftExternalItem = {
        tempId: `EXT-${Date.now()}-DRAFT`,
        ...(trimmedDraftCode ? { employeeCode: trimmedDraftCode } : {}),
        name: trimmedDraftName,
        position: extPosition,
        affiliation: trimmedDraftAff,
        hours: draftHours,
      };
    }

    const effectiveExtList = draftExternalItem ? [...externalOtStaff, draftExternalItem] : externalOtStaff;
    if (selectedStaffIds.length + effectiveExtList.length === 0) {
      setOtFormError('กรุณาเลือกเจ้าหน้าที่ OPD หรือเพิ่มเจ้าหน้าที่เฉพาะกิจอย่างน้อย 1 คน');
      scrollOtErr();
      return;
    }
    if (conflictingSelectedOtList.length > 0) {
      const summary = conflictingSelectedOtList
        .map((c) => `${c.name} (${c.existingClinic})`)
        .join(', ');
      setOtFormError(
        `ไม่สามารถบันทึกซ้ำได้: พบรายชื่อที่มีบันทึกเวรในวันที่ ${formatThaiShortDate(otDate)} กะ "${otShift}" แล้ว ได้แก่ ${summary}`
      );
      scrollOtErr();
      return;
    }
    setExtError('');
    setOtFormError('');

    const opdRecords: OTAttendance[] = selectedStaffIds.map((id) => {
      const staff = staffList.find((s) => s.staffId === id);
      const pickedHrs = Number(selectedOtHoursByStaffId[id] ?? otHours);
      const effectiveHrs =
        Number.isFinite(pickedHrs) && pickedHrs > 0
          ? pickedHrs
          : getDefaultOtHoursForShift(otShift, settings?.stdHr);
      const empCode = getStaffEmployeeCode(staff);
      return {
        id: `OT-${Date.now()}-${id}`,
        date: otDate,
        shift: otShift,
        staffName: staff ? staff.name : id,
        ...(empCode ? { employeeCode: empCode } : {}),
        position: staff ? staff.position : 'RN',
        homeClinic: staff ? staff.homeClinic : 'OPD',
        workClinic,
        hours: effectiveHrs,
        isExternal: false,
      };
    });

    const extRecords: OTAttendance[] = effectiveExtList.map((ext, idx) => ({
      id: `OT-EXT-${Date.now()}-${idx}`,
      date: otDate,
      shift: otShift,
      staffName: ext.name,
      ...(ext.employeeCode ? { employeeCode: ext.employeeCode } : {}),
      position: ext.position,
      homeClinic: ext.affiliation,
      workClinic,
      hours: Number.isFinite(ext.hours) && ext.hours > 0 ? ext.hours : otHours,
      isExternal: true,
      affiliation: ext.affiliation,
    }));

    onSaveBatchOT([...opdRecords, ...extRecords]);
    setOtCalAnchor(otDate);
    setSelectedStaffIds([]);
    setSelectedOtHoursByStaffId({});
    setExternalOtStaff([]);
    if (draftExternalItem) {
      setExtEmployeeCode('');
      setExtName('');
      setExtAffiliation('');
      setExtOtHours(otHours);
    }
  };

  const toggleSelectStaff = (id: string) => {
    setOtFormError('');
    setSelectedStaffIds((prev) => {
      const exists = prev.includes(id);
      if (exists) {
        return prev.filter((x) => x !== id);
      }
      setSelectedOtHoursByStaffId((prevMap) => ({
        ...prevMap,
        [id]: prevMap[id] ?? otHours,
      }));
      return [...prev, id];
    });
  };

  const clearSelectedStaff = () => {
    setSelectedStaffIds([]);
    setSelectedOtHoursByStaffId({});
    setExternalOtStaff([]);
  };

  // --- Fiscal Year Calculation (12 Months: Oct - Sep) ---
  const fiscalMonths = useMemo(
    () => [
      { name: 'ต.ค.', fullName: 'ตุลาคม', key: '10', yearOffset: -1 },
      { name: 'พ.ย.', fullName: 'พฤศจิกายน', key: '11', yearOffset: -1 },
      { name: 'ธ.ค.', fullName: 'ธันวาคม', key: '12', yearOffset: -1 },
      { name: 'ม.ค.', fullName: 'มกราคม', key: '01', yearOffset: 0 },
      { name: 'ก.พ.', fullName: 'กุมภาพันธ์', key: '02', yearOffset: 0 },
      { name: 'มี.ค.', fullName: 'มีนาคม', key: '03', yearOffset: 0 },
      { name: 'เม.ย.', fullName: 'เมษายน', key: '04', yearOffset: 0 },
      { name: 'พ.ค.', fullName: 'พฤษภาคม', key: '05', yearOffset: 0 },
      { name: 'มิ.ย.', fullName: 'มิถุนายน', key: '06', yearOffset: 0 },
      { name: 'ก.ค.', fullName: 'กรกฎาคม', key: '07', yearOffset: 0 },
      { name: 'ส.ค.', fullName: 'สิงหาคม', key: '08', yearOffset: 0 },
      { name: 'ก.ย.', fullName: 'กันยายน', key: '09', yearOffset: 0 },
    ],
    []
  );

  const summaryEligibleStaff = useMemo(() => {
    const targetCeEndYear = selectedFiscalYear - 543;
    const targetCeStartYear = targetCeEndYear - 1;
    const fyStart = `${targetCeStartYear}-10-01`;
    const fyEnd = `${targetCeEndYear}-09-30`;

    return staffList
      .filter((s) => {
        if (s.status === 'Active') {
          if (s.startDate && s.startDate > fyEnd) return false;
          return true;
        }
        if (s.startDate || s.endDate) {
          const effStart = s.startDate || '0000-01-01';
          const effEnd = s.endDate || '9999-12-31';
          if (effStart <= fyEnd && effEnd >= fyStart) return true;
        }
        const hasOtInFy = otRecords.some(
          (o) => o.staffName === s.name && o.date >= fyStart && o.date <= fyEnd
        );
        const hasLeaveInFy = leaves.some(
          (l) => l.staffName === s.name && l.endDate >= fyStart && l.startDate <= fyEnd
        );
        return hasOtInFy || hasLeaveInFy;
      })
      .sort(compareStaffByPositionAndStartDate);
  }, [staffList, otRecords, leaves, selectedFiscalYear]);

  const fiscalSummaryData = useMemo(() => {
    const targetCeEndYear = selectedFiscalYear - 543;
    const targetCeStartYear = targetCeEndYear - 1;
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return summaryEligibleStaff.map((staff) => {
      const monthDetails: Record<
        string,
        {
          inTime: number;
          ot: number;
          leaves: number;
          total: number;
          otClinics: string[];
          leaveTypes: string[];
        }
      > = {};

      let totalInTime = 0;
      let totalOT = 0;
      let totalLeaves = 0;

      fiscalMonths.forEach((m) => {
        const year = m.yearOffset === -1 ? targetCeStartYear : targetCeEndYear;
        const ymPrefix = `${year}-${m.key}`;
        const lastDay = new Date(year, Number(m.key), 0).getDate();
        const monthStart = `${ymPrefix}-01`;
        const monthEnd = `${ymPrefix}-${String(lastDay).padStart(2, '0')}`;

        const staffOts = otRecords.filter(
          (o) => o.staffName === staff.name && o.date.startsWith(ymPrefix)
        );
        const otCount = staffOts.length;
        const otClinics = Array.from(new Set(staffOts.map((o) => o.workClinic)));

        const staffLeavesAll = leaves.filter((l) => {
          const lStart = l.startDate || '';
          const lEnd = l.endDate || lStart;
          return l.staffName === staff.name && lStart <= monthEnd && lEnd >= monthStart;
        });
        // Business rule: "ไปอบรม/ประชุม" counts as normal workday, NOT leave
        const actualLeaves = staffLeavesAll.filter((l) => !isTrainingLeaveType(l.leaveType));
        const leaveDays = actualLeaves.reduce((sum, l) => {
          const lStart = l.startDate || '';
          const lEnd = l.endDate || lStart;
          if (lStart >= monthStart && lEnd <= monthEnd) {
            return sum + (Number(l.days) || 1);
          }
          const overlapStart = lStart > monthStart ? lStart : monthStart;
          const overlapEnd = lEnd < monthEnd ? lEnd : monthEnd;
          if (overlapStart > overlapEnd) return sum;
          return sum + countGovernmentWorkdaysInRange(overlapStart, overlapEnd, customHolidays);
        }, 0);
        const leaveTypes = Array.from(
          new Set(
            staffLeavesAll.map((l) =>
              isTrainingLeaveType(l.leaveType)
                ? `ไปอบรม/ประชุม (${l.days} วัน - นับมาปฏิบัติงาน)`
                : `${l.leaveType} (${l.days} วัน)`
            )
          )
        );

        let inTimeDays = 0;
        const isNotYetStarted = Boolean(staff.startDate && staff.startDate > monthEnd);
        const isAlreadyEnded = Boolean(staff.endDate && staff.endDate < monthStart);
        const isInactiveWithoutEndDate = staff.status !== 'Active' && !staff.endDate;

        if (!isNotYetStarted && !isAlreadyEnded && !isInactiveWithoutEndDate) {
          const effectiveStart =
            staff.startDate && staff.startDate > monthStart ? staff.startDate : monthStart;
          const effectiveEnd =
            staff.endDate && staff.endDate < monthEnd ? staff.endDate : monthEnd;

          if (ymPrefix <= currentYm && effectiveStart <= effectiveEnd) {
            const baseWorkDays = countGovernmentWorkdaysInRange(
              effectiveStart,
              effectiveEnd,
              customHolidays
            );
            inTimeDays = Math.max(0, baseWorkDays - leaveDays);
          }
        }

        const totalMonthDays = inTimeDays + otCount;

        monthDetails[m.key] = {
          inTime: inTimeDays,
          ot: otCount,
          leaves: leaveDays,
          total: totalMonthDays,
          otClinics,
          leaveTypes,
        };

        totalInTime += inTimeDays;
        totalOT += otCount;
        totalLeaves += leaveDays;
      });

      const grandTotal = totalInTime + totalOT;

      return {
        staff,
        monthDetails,
        totalInTime,
        totalOT,
        totalLeaves,
        grandTotal,
      };
    });
  }, [summaryEligibleStaff, otRecords, leaves, selectedFiscalYear, fiscalMonths, customHolidays]);

  const filteredSummaryData = useMemo(() => {
    return fiscalSummaryData
      .filter((item) => {
        if (clinicFilter !== 'ALL' && item.staff.homeClinic !== clinicFilter) {
          return false;
        }
        if (fiscalPositionFilter === 'DAILY_WAGE_ALL') {
          if (!isDailyWagePosition(item.staff.position)) return false;
        } else if (fiscalPositionFilter !== 'ALL' && item.staff.position !== fiscalPositionFilter) {
          return false;
        }
        if (staffFilter !== 'ALL' && item.staff.staffId !== staffFilter) {
          return false;
        }
        if (summarySearchQuery.trim()) {
          const q = summarySearchQuery.toLowerCase().trim();
          const match =
            item.staff.name.toLowerCase().includes(q) ||
            item.staff.homeClinic.toLowerCase().includes(q) ||
            item.staff.position.toLowerCase().includes(q) ||
            formatPositionLabel(item.staff.position).toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .sort((a, b) => compareStaffByPositionAndStartDate(a.staff, b.staff));
  }, [fiscalSummaryData, clinicFilter, fiscalPositionFilter, staffFilter, summarySearchQuery]);

  const summaryKpis = useMemo(() => {
    if (monthFilter === 'ALL') {
      const totalInTime = filteredSummaryData.reduce((acc, d) => acc + d.totalInTime, 0);
      const totalOT = filteredSummaryData.reduce((acc, d) => acc + d.totalOT, 0);
      const totalLeaves = filteredSummaryData.reduce((acc, d) => acc + d.totalLeaves, 0);
      const totalWork = totalInTime + totalOT;
      return { totalInTime, totalOT, totalLeaves, totalWork, staffCount: filteredSummaryData.length };
    } else {
      const totalInTime = filteredSummaryData.reduce(
        (acc, d) => acc + (d.monthDetails[monthFilter]?.inTime || 0),
        0
      );
      const totalOT = filteredSummaryData.reduce(
        (acc, d) => acc + (d.monthDetails[monthFilter]?.ot || 0),
        0
      );
      const totalLeaves = filteredSummaryData.reduce(
        (acc, d) => acc + (d.monthDetails[monthFilter]?.leaves || 0),
        0
      );
      const totalWork = totalInTime + totalOT;
      return { totalInTime, totalOT, totalLeaves, totalWork, staffCount: filteredSummaryData.length };
    }
  }, [filteredSummaryData, monthFilter]);

  // Dynamic Export to CSV based on active filters (No Staff_ID column)
  const exportFiscalSummaryCsv = () => {
    const shiftLabel =
      shiftFilter === 'IN_TIME'
        ? 'เฉพาะในเวลา'
        : shiftFilter === 'OT'
          ? 'เฉพาะนอกเวลา_OT'
          : 'ในเวลาและนอกเวลา';

    if (monthFilter === 'ALL') {
      const headers = [
        'ชื่อ-สกุล',
        'ตำแหน่ง',
        'หน่วยงานสังกัด',
        ...fiscalMonths.map((m) => m.name),
        'รวมในเวลา (วัน)',
        'รวมเวรนอกเวลา (เวร)',
        'รวมวันลา (วัน)',
        'รวมทั้งสิ้น (วัน)',
      ];

      const rows = filteredSummaryData.map((item) => [
        `"${item.staff.name}"`,
        `"${formatPositionLabel(item.staff.position)}"`,
        `"${item.staff.homeClinic}"`,
        ...fiscalMonths.map((m) => {
          const d = item.monthDetails[m.key];
          if (shiftFilter === 'IN_TIME') return d?.inTime || 0;
          if (shiftFilter === 'OT') return d?.ot || 0;
          return `${d?.inTime || 0}/${d?.ot || 0}`;
        }),
        item.totalInTime,
        item.totalOT,
        item.totalLeaves,
        item.grandTotal,
      ]);

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `สรุปวันทำงาน_12เดือน_${shiftLabel}_ปีงบ_${selectedFiscalYear}_PCMC.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const selectedMObj = fiscalMonths.find((m) => m.key === monthFilter);
      const monthName = selectedMObj ? selectedMObj.fullName : monthFilter;

      const headers = [
        'ชื่อ-สกุล',
        'ตำแหน่ง',
        'หน่วยงานสังกัด',
        'วันทำงานในเวลา (วัน)',
        'เวรนอกเวลา OT (เวร)',
        'วันลา (วัน)',
        'รวมวันทำงานสุทธิ (วัน)',
        'คลินิกที่ขึ้นเวรนอกเวลา',
        'ประวัติการลา',
      ];

      const rows = filteredSummaryData.map((item) => {
        const d = item.monthDetails[monthFilter] || {
          inTime: 0,
          ot: 0,
          leaves: 0,
          total: 0,
          otClinics: [],
          leaveTypes: [],
        };
        return [
          `"${item.staff.name}"`,
          `"${formatPositionLabel(item.staff.position)}"`,
          `"${item.staff.homeClinic}"`,
          d.inTime,
          d.ot,
          d.leaves,
          d.total,
          `"${d.otClinics.join(', ') || '-'}"`,
          `"${d.leaveTypes.join(', ') || '-'}"`,
        ];
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `สรุปวันทำงาน_รายเดือน_${monthName}_ปีงบ_${selectedFiscalYear}_PCMC.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  // --- Image 4 Official Leave Report Data & Columns ---
  const leaveReportColumns = useMemo(() => {
    const coreCols: { type: string; shortLabel: string }[] = [
      { type: 'ลาพักผ่อน', shortLabel: 'พักผ่อน' },
      { type: 'ลาป่วย', shortLabel: 'ป่วย' },
      { type: 'ลากิจ', shortLabel: 'กิจ' },
      { type: 'ลาคลอด', shortLabel: 'คลอด' },
    ];
    const coreTypesSet = new Set(coreCols.map((c) => c.type));
    const extraTypes = new Set<string>();
    leaveTypes.forEach((lt) => {
      if (!coreTypesSet.has(lt) && !isTrainingLeaveType(lt)) extraTypes.add(lt);
    });
    leaves.forEach((lv) => {
      if (lv.leaveType && !coreTypesSet.has(lv.leaveType) && !isTrainingLeaveType(lv.leaveType)) {
        extraTypes.add(lv.leaveType);
      }
    });

    const formatShortCol = (t: string) => {
      if (t === 'ลาบวช') return 'บวช';
      if (t === 'ลาศึกษาต่อ') return 'ศึกษาต่อ';
      return t;
    };

    const extraCols = Array.from(extraTypes).map((t) => ({
      type: t,
      shortLabel: formatShortCol(t),
    }));

    return { coreCols, extraCols, allCols: [...coreCols, ...extraCols] };
  }, [leaveTypes, leaves]);

  const leaveReportData = useMemo(() => {
    const targetCeEndYear = selectedFiscalYear - 543;
    const targetCeStartYear = targetCeEndYear - 1;

    const allowedYearMonths = new Set<string>();
    fiscalMonths.forEach((m) => {
      if (monthFilter === 'ALL' || m.key === monthFilter) {
        const y = m.yearOffset === -1 ? targetCeStartYear : targetCeEndYear;
        allowedYearMonths.add(`${y}-${m.key}`);
      }
    });

    // Exclude "ไปอบรม/ประชุม" from leave report (training counts as normal workday, NOT leave)
    const periodLeaves = leaves.filter((lv) => {
      if (isTrainingLeaveType(lv.leaveType)) return false;
      const startYm = (lv.startDate || '').slice(0, 7);
      const endYm = (lv.endDate || lv.startDate || '').slice(0, 7);
      if (allowedYearMonths.has(startYm) || allowedYearMonths.has(endYm)) return true;
      for (const ym of allowedYearMonths) {
        if (startYm && endYm && startYm <= ym && endYm >= ym) return true;
      }
      return false;
    });

    // Build roster combining activeStaff + any unlinked leave staff in the period
    const rosterMap = new Map<
      string,
      { id: string; name: string; position: StaffPosition; clinic: string; startDate?: string }
    >();
    activeStaff.forEach((s) => {
      rosterMap.set(s.name, {
        id: s.staffId,
        name: s.name,
        position: s.position,
        clinic: s.homeClinic,
        startDate: s.startDate,
      });
    });
    periodLeaves.forEach((lv) => {
      if (!rosterMap.has(lv.staffName)) {
        const matchedStaff = staffList.find((s) => s.name === lv.staffName);
        rosterMap.set(lv.staffName, {
          id: matchedStaff?.staffId || `UNLINKED-${lv.staffName}`,
          name: lv.staffName,
          position: lv.position,
          clinic: lv.clinic || '-',
          startDate: matchedStaff?.startDate,
        });
      }
    });

    const q = summarySearchQuery.toLowerCase().trim();
    const filteredRoster = Array.from(rosterMap.values())
      .filter((person) => {
        if (clinicFilter !== 'ALL' && person.clinic !== clinicFilter) return false;
        if (fiscalPositionFilter === 'DAILY_WAGE_ALL') {
          if (!isDailyWagePosition(person.position)) return false;
        } else if (fiscalPositionFilter !== 'ALL' && person.position !== fiscalPositionFilter) {
          return false;
        }
        if (staffFilter !== 'ALL' && person.id !== staffFilter) return false;
        if (q) {
          const match =
            person.name.toLowerCase().includes(q) ||
            person.clinic.toLowerCase().includes(q) ||
            person.position.toLowerCase().includes(q) ||
            formatPositionLabel(person.position).toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .sort(compareStaffByPositionAndStartDate);

    const rows = filteredRoster
      .map((person) => {
        const personLeaves = periodLeaves
          .filter((lv) => lv.staffName === person.name)
          .sort((a, b) => a.startDate.localeCompare(b.startDate));

        const daysByType: Record<string, number> = {};
        let totalLeaveDays = 0;

        personLeaves.forEach((lv) => {
          const d = Number(lv.days) || 1;
          daysByType[lv.leaveType] = (daysByType[lv.leaveType] || 0) + d;
          totalLeaveDays += d;
        });

        const details = personLeaves.map((lv) => {
          const rangeText = formatThaiLeaveRange(lv.startDate, lv.endDate);
          const reasonSuffix = lv.note && lv.note.trim() ? ` (เหตุผล: ${lv.note.trim()})` : '';
          return `${lv.leaveType} ${lv.days} วัน ${rangeText}${reasonSuffix}`;
        });

        const { firstName, lastName } = splitThaiName(person.name);

        return {
          id: person.id,
          fullName: person.name,
          firstName,
          lastName,
          position: person.position,
          clinic: person.clinic,
          daysByType,
          totalLeaveDays,
          details,
        };
      })
      .filter((row) => !onlyStaffWithLeaves || row.totalLeaveDays > 0);

    const totalsByType: Record<string, number> = {};
    leaveReportColumns.allCols.forEach((c) => {
      totalsByType[c.type] = rows.reduce((sum, r) => sum + (r.daysByType[c.type] || 0), 0);
    });
    const grandTotalDays = rows.reduce((sum, r) => sum + r.totalLeaveDays, 0);

    return { rows, totalsByType, grandTotalDays };
  }, [
    selectedFiscalYear,
    fiscalMonths,
    monthFilter,
    leaves,
    activeStaff,
    staffList,
    clinicFilter,
    fiscalPositionFilter,
    staffFilter,
    summarySearchQuery,
    onlyStaffWithLeaves,
    leaveReportColumns,
  ]);

  const leaveReportPeriodLabel = useMemo(() => {
    if (monthFilter === 'ALL') {
      return `ปีงบประมาณ ${selectedFiscalYear} (ต.ค. ${String(selectedFiscalYear - 1).slice(-2)} - ก.ย. ${String(selectedFiscalYear).slice(-2)})`;
    }
    const m = fiscalMonths.find((fm) => fm.key === monthFilter);
    const beYear = m?.yearOffset === -1 ? selectedFiscalYear - 1 : selectedFiscalYear;
    return `เดือน ${m?.fullName || monthFilter} พ.ศ. ${beYear}`;
  }, [monthFilter, selectedFiscalYear, fiscalMonths]);

  const exportLeaveReportCsv = () => {
    const headers = [
      'ลำดับ',
      'ชื่อ',
      'สกุล',
      'ตำแหน่ง',
      'คลินิกสังกัด',
      ...leaveReportColumns.allCols.map((c) => c.shortLabel),
      'รวมวันลา (วัน)',
      'เหตุผลการลาและวันที่ลา',
    ];
    const rows = leaveReportData.rows.map((r, i) => [
      i + 1,
      `"${r.firstName}"`,
      `"${r.lastName}"`,
      `"${formatPositionLabel(r.position)}"`,
      `"${r.clinic}"`,
      ...leaveReportColumns.allCols.map((c) => r.daysByType[c.type] || 0),
      r.totalLeaveDays,
      `"${r.details.join(' | ') || '-'}"`,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `รายงานการลา_หน่วยการพยาบาลผู้ป่วยนอก_ปีงบ_${selectedFiscalYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportLeaveJpeg = async () => {
    if (!leaveReportRef.current || isExportingLeaveJpeg) return;
    setIsExportingLeaveJpeg(true);
    try {
      await exportElementAsJpeg(
        leaveReportRef.current,
        `รายงานสรุปวันลา_หน่วยการพยาบาลผู้ป่วยนอก_ปีงบ_${selectedFiscalYear}.jpeg`
      );
    } finally {
      setIsExportingLeaveJpeg(false);
    }
  };

  const handlePrintLeaveReport = () => {
    setPrintTarget('LEAVE_REPORT');
    setTimeout(() => {
      window.print();
    }, 60);
  };

  // --- Sub-Tab 4: OT Payment Report Calculation (Image 4 Official Form) ---
  const otPayYearBEOptions = useMemo(() => {
    const years = new Set<number>([2568, 2569, 2570, 2571, 2572, todayParts.y + 543]);
    otRecords.forEach((o) => {
      const y = Number((o.date || '').slice(0, 4));
      if (Number.isFinite(y) && y > 2000) years.add(y + 543);
    });
    return Array.from(years).sort((a, b) => a - b);
  }, [otRecords, todayParts.y]);

  const otPayClinicOptions = useMemo(() => {
    const fromRecords = otRecords
      .map((o) => parseOtWorkClinic(o.workClinic).clinic)
      .filter(Boolean);
    return Array.from(new Set([...outTimeClinics, ...allClinics, ...fromRecords]));
  }, [otRecords, outTimeClinics, allClinics]);

  const savedCostCenterForSelectedUnit = useMemo(() => {
    if (otPayClinic !== 'ALL') {
      const fromSettings = (settings?.clinicCostCenters?.[otPayClinic] || '').trim();
      if (fromSettings) return fromSettings;
      const fromLocal = (localUnitCostCenters[otPayClinic] || '').trim();
      if (fromLocal) return fromLocal;
    } else {
      const fromLocalAll = (localUnitCostCenters['ALL'] || '').trim();
      if (fromLocalAll) return fromLocalAll;
    }
    return (settings?.defaultCostCenter || '').trim() || DEFAULT_OT_COST_CENTER;
  }, [otPayClinic, settings, localUnitCostCenters]);

  useEffect(() => {
    // Load remembered Cost Center whenever unit selection or persisted settings change
    if (otPayClinic === 'ALL') {
      const remembered = (localUnitCostCenters['ALL'] || settings?.defaultCostCenter || '').trim();
      setOtPayCostCenterOverride(remembered && remembered !== DEFAULT_OT_COST_CENTER ? remembered : '');
    } else {
      const remembered = (
        settings?.clinicCostCenters?.[otPayClinic] ||
        localUnitCostCenters[otPayClinic] ||
        ''
      ).trim();
      setOtPayCostCenterOverride(remembered);
    }
    setUnitCostCenterSavedBadge('');
  }, [otPayClinic, settings?.clinicCostCenters, settings?.defaultCostCenter, localUnitCostCenters]);

  const resolvedOtPayCostCenter = useMemo(() => {
    if (otPayCostCenterOverride.trim()) return otPayCostCenterOverride.trim();
    return savedCostCenterForSelectedUnit;
  }, [otPayCostCenterOverride, savedCostCenterForSelectedUnit]);

  const handleSaveCurrentUnitCostCenter = async () => {
    const cleanClinic = (otPayClinic || '').trim();
    const cleanVal = otPayCostCenterOverride.trim();
    if (!cleanClinic) return;
    setIsSavingUnitCostCenter(true);
    try {
      setLocalUnitCostCenters((prev) => {
        const next = { ...prev };
        if (cleanVal) next[cleanClinic] = cleanVal;
        else delete next[cleanClinic];
        try {
          localStorage.setItem('pcmc_unit_cost_centers', JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
      if (onSaveUnitCostCenter) {
        await onSaveUnitCostCenter(cleanClinic, cleanVal);
      }
      setUnitCostCenterSavedBadge(
        cleanVal ? `จำค่า "${cleanVal}" แล้ว ✓` : 'ล้างค่าเฉพาะหน่วยนี้แล้ว ✓'
      );
      setTimeout(() => setUnitCostCenterSavedBadge(''), 3000);
    } finally {
      setIsSavingUnitCostCenter(false);
    }
  };

  const resolvedOtPayControllerName = useMemo(() => {
    if (otPayControllerOverride.trim()) return otPayControllerOverride.trim();
    return (settings?.otControllerName || '').trim() || DEFAULT_OT_CONTROLLER_NAME;
  }, [otPayControllerOverride, settings]);

  const otPaymentReportData = useMemo(() => {
    const yearAD = otPayYearBE - 543;
    const monthStr = String(otPayMonth).padStart(2, '0');
    const monthPrefix = `${yearAD}-${monthStr}-`;
    const daysInMonth = new Date(yearAD, otPayMonth, 0).getDate();
    const holidayMap = getHolidaysForYear(yearAD, customHolidays);

    const dayColumns = Array.from({ length: daysInMonth }, (_, i) => {
      const dayNum = i + 1;
      const iso = `${yearAD}-${monthStr}-${String(dayNum).padStart(2, '0')}`;
      const dow = new Date(Date.UTC(yearAD, otPayMonth - 1, dayNum)).getUTCDay();
      const holiday = holidayMap.get(iso);
      const isShaded = dow === 0 || dow === 6 || Boolean(holiday);
      return {
        dayNum,
        iso,
        dow,
        isShaded,
        holidayName: holiday?.name || '',
      };
    });

    const staffByName = new Map<string, StaffMember>();
    const rosterRankMap = new Map<string, number>();
    [...staffList].sort(_compareRoster).forEach((s, idx) => {
      const key = (s.name || '').trim();
      if (key) {
        if (!staffByName.has(key)) staffByName.set(key, s);
        if (!rosterRankMap.has(key)) rosterRankMap.set(key, idx);
      }
    });

    const grouped = new Map<
      string,
      {
        staffName: string;
        employeeCode: string;
        position: StaffPosition;
        positionLabel: string;
        dayHours: Record<number, number>;
      }
    >();

    otRecords.forEach((o) => {
      if (!(o.date || '').startsWith(monthPrefix)) return;
      if (otPayShiftScope === 'OUT_TIME') {
        if (
          o.shift !== 'นอกเวลาเย็น 16:00-20:00' &&
          o.shift !== 'นอกเวลาวันหยุด 08:00-12:00'
        ) {
          return;
        }
      } else if (otPayShiftScope !== 'ALL_OT' && o.shift !== otPayShiftScope) {
        return;
      }

      const parsedWork = parseOtWorkClinic(o.workClinic);
      if (otPayClinic !== 'ALL' && parsedWork.clinic !== otPayClinic) return;

      const dayNum = Number((o.date || '').slice(8, 10));
      if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > daysInMonth) return;

      const cleanName = (o.staffName || '').trim();
      const normPos = normalizeStaffPosition(o.position);
      const posLabel = formatOtPaySheetPositionLabel(normPos);
      const groupKey = `${cleanName}::${posLabel}`;
      const hrs = getEffectiveOtHours(o, settings?.stdHr);
      const matchedStaff = staffByName.get(cleanName);
      const staffCode = o.isExternal ? '' : getStaffEmployeeCode(matchedStaff);
      const empCode = staffCode || (o.employeeCode || '').trim();

      let entry = grouped.get(groupKey);
      if (!entry) {
        entry = {
          staffName: cleanName,
          employeeCode: empCode,
          position: normPos,
          positionLabel: posLabel,
          dayHours: {},
        };
        grouped.set(groupKey, entry);
      } else if (staffCode && entry.employeeCode !== staffCode) {
        entry.employeeCode = staffCode;
      } else if (!entry.employeeCode && empCode) {
        entry.employeeCode = empCode;
      }
      entry.dayHours[dayNum] = Math.round(((entry.dayHours[dayNum] || 0) + hrs) * 100) / 100;
    });

    const q = otPaySearch.trim().toLowerCase();
    const rows = Array.from(grouped.values())
      .filter((r) => {
        if (!q) return true;
        return (
          r.staffName.toLowerCase().includes(q) ||
          r.employeeCode.toLowerCase().includes(q) ||
          r.positionLabel.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const rankDiff = getOtPayGroupRank(a.position) - getOtPayGroupRank(b.position);
        if (rankDiff !== 0) return rankDiff;
        const idxA = rosterRankMap.get(a.staffName) ?? 99999;
        const idxB = rosterRankMap.get(b.staffName) ?? 99999;
        if (idxA !== idxB) return idxA - idxB;
        return a.staffName.localeCompare(b.staffName, 'th');
      })
      .map((r) => {
        const totalHours =
          Math.round(
            Object.values(r.dayHours).reduce((sum, h) => sum + (Number(h) || 0), 0) * 100
          ) / 100;
        const hourlyRate = getOtHourlyRate(r.position, settings?.otHourlyRates);
        const grossAmount = Math.round(totalHours * hourlyRate * 100) / 100;
        const taxAmount = Math.round(grossAmount * 0.05 * 100) / 100;
        const netAmount = Math.round((grossAmount - taxAmount) * 100) / 100;
        return {
          ...r,
          totalHours,
          hourlyRate,
          grossAmount,
          taxAmount,
          netAmount,
        };
      });

    const grandTotalHours =
      Math.round(rows.reduce((s, r) => s + r.totalHours, 0) * 100) / 100;
    const grandTotalGross =
      Math.round(rows.reduce((s, r) => s + r.grossAmount, 0) * 100) / 100;
    const grandTotalTax =
      Math.round(rows.reduce((s, r) => s + r.taxAmount, 0) * 100) / 100;
    const grandTotalNet =
      Math.round(rows.reduce((s, r) => s + r.netAmount, 0) * 100) / 100;
    const missingCodeCount = rows.filter((r) => !r.employeeCode).length;

    return {
      yearAD,
      daysInMonth,
      dayColumns,
      rows,
      grandTotalHours,
      grandTotalGross,
      grandTotalTax,
      grandTotalNet,
      bahtText: numberToThaiBahtText(grandTotalGross),
      missingCodeCount,
    };
  }, [
    otPayYearBE,
    otPayMonth,
    otPayClinic,
    otPayShiftScope,
    otPaySearch,
    otRecords,
    staffList,
    customHolidays,
    settings?.stdHr,
    settings?.otHourlyRates,
  ]);

  const exportOtPayReportCsv = () => {
    const monthName = THAI_MONTHS[otPayMonth - 1] || String(otPayMonth);
    const headers = [
      'ลำดับที่',
      'รหัสบุคลากร',
      'ชื่อ สกุล',
      'ตำแหน่ง',
      ...otPaymentReportData.dayColumns.map((d) => String(d.dayNum)),
      'อัตรา/ชั่วโมง',
      'จำนวนชั่วโมง',
      'จำนวนเงินที่เบิก',
      'หักภาษี 5%',
      'จำนวนเงินคงเหลือ',
    ];
    const rows = otPaymentReportData.rows.map((r, i) => [
      i + 1,
      `"${r.employeeCode}"`,
      `"${r.staffName}"`,
      `"${r.positionLabel}"`,
      ...otPaymentReportData.dayColumns.map((d) =>
        r.dayHours[d.dayNum] ? formatOtHourNum(r.dayHours[d.dayNum]) : ''
      ),
      r.hourlyRate,
      formatOtHourNum(r.totalHours),
      r.grossAmount.toFixed(2),
      r.taxAmount.toFixed(2),
      r.netAmount.toFixed(2),
    ]);
    const totalRow = [
      `"รวม (${otPaymentReportData.bahtText})"`,
      '""',
      '""',
      '""',
      ...otPaymentReportData.dayColumns.map(() => ''),
      '"รวม"',
      formatOtHourNum(otPaymentReportData.grandTotalHours),
      otPaymentReportData.grandTotalGross.toFixed(2),
      otPaymentReportData.grandTotalTax.toFixed(2),
      otPaymentReportData.grandTotalNet.toFixed(2),
    ];
    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(',')), totalRow.join(',')].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `หลักฐานจ่ายค่าตอบแทนOT_${otPayClinic === 'ALL' ? 'ทุกห้องตรวจ' : otPayClinic}_${monthName}_${otPayYearBE}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportOtPayJpeg = async () => {
    if (!otPaymentReportRef.current || isExportingOtPayJpeg) return;
    setIsExportingOtPayJpeg(true);
    try {
      const monthName = THAI_MONTHS[otPayMonth - 1] || String(otPayMonth);
      await exportElementAsJpeg(
        otPaymentReportRef.current,
        `หลักฐานจ่ายค่าตอบแทนOT_${otPayClinic === 'ALL' ? 'ทุกห้องตรวจ' : otPayClinic}_${monthName}_${otPayYearBE}.jpeg`
      );
    } finally {
      setIsExportingOtPayJpeg(false);
    }
  };

  const handlePrintOtPayReport = () => {
    setPrintTarget('OT_PAY_REPORT');
    setTimeout(() => {
      window.print();
    }, 60);
  };

  return (
    <div className="space-y-6">
      {/* Tab Header Banner (Hidden on Print) */}
      <div className="no-print bg-gradient-to-r from-teal-50 via-cyan-50 to-emerald-50 border border-teal-200/80 rounded-xl p-4 flex flex-col xl:flex-row xl:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <CalendarClock className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-teal-950">
              เมนูที่ 2: บันทึกเวรนอกเวลา & วันลา (Leave & OT Tracker)
            </h2>
            <p className="text-xs text-teal-800">
              บันทึกวันลา/ไปอบรม, บันทึกเวรนอกเวลา & OT ในเวลาราชการ (รวมเจ้าหน้าที่เฉพาะกิจ), และสรุปปีงบประมาณ
            </p>
          </div>
        </div>

        {/* Sub Navigation Buttons */}
        <div className="flex flex-nowrap items-center gap-1 bg-white/90 p-1 rounded-xl border border-teal-200 overflow-x-auto max-w-full shrink-0 self-start xl:self-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('leave')}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'leave'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-teal-800'
            }`}
          >
            1) บันทึกวันลา
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('ot')}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'ot'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-teal-800'
            }`}
          >
            2) บันทึกเวร OT / ปฏิบัติแทน
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('fiscalSummary')}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              activeSubTab === 'fiscalSummary'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-teal-800'
            }`}
          >
            3) สรุป 12 เดือนปีงบประมาณ
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('otPayReport')}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer inline-flex items-center gap-1 whitespace-nowrap shrink-0 ${
              activeSubTab === 'otPayReport'
                ? 'bg-indigo-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-indigo-800'
            }`}
          >
            <ReceiptText className="w-3.5 h-3.5 shrink-0" />
            <span>4) หลักฐานจ่ายค่าตอบแทน OT</span>
          </button>
        </div>
      </div>

      {/* --- SUB-TAB 1: LEAVE ENTRY --- */}
      {activeSubTab === 'leave' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 lg:items-stretch">
          <div className="lg:col-span-3 flex flex-col min-w-0">
            <form
              onSubmit={handleSaveLeaveSubmit}
              noValidate
              className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-4 sm:p-5 space-y-4 flex-1 flex flex-col justify-between"
            >
              <div className="space-y-4">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 border-b pb-2">
                <CalendarDays className="w-4 h-4 text-amber-600" />
                แบบฟอร์มบันทึกวันลาของบุคลากร
              </h3>

              {/* Searchable Staff Combobox */}
              <div ref={leaveDropdownRef} className="relative">
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  เลือกเจ้าหน้าที่ (พิมพ์ค้นหาด้วยชื่อ) <span className="text-red-500">*</span>
                </label>
                {selectedLeaveStaff ? (
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-amber-300 bg-amber-50/70">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-gray-900 truncate">
                        {selectedLeaveStaff.name}
                      </div>
                      <div className="text-[11px] text-amber-800">
                        {formatPositionLabel(selectedLeaveStaff.position)} •{' '}
                        {selectedLeaveStaff.homeClinic}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLeaveStaffId('');
                        setLeaveStaffQuery('');
                        setIsLeaveDropdownOpen(true);
                      }}
                      className="text-gray-500 hover:text-red-600 p-1 rounded-md hover:bg-white cursor-pointer shrink-0"
                      title="เปลี่ยนเจ้าหน้าที่"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={leaveStaffQuery}
                      onFocus={() => setIsLeaveDropdownOpen(true)}
                      onChange={(e) => {
                        setLeaveStaffQuery(e.target.value);
                        setIsLeaveDropdownOpen(true);
                        setLeaveFormError('');
                      }}
                      placeholder="พิมพ์ชื่อเจ้าหน้าที่, ตำแหน่ง หรือคลินิกเพื่อค้นหา..."
                      className="w-full text-xs rounded-lg border-gray-300 py-2 pl-8 pr-8 border bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setIsLeaveDropdownOpen((prev) => !prev)}
                      className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 cursor-pointer"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>

                    {isLeaveDropdownOpen && (
                      <div className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto bg-white rounded-xl border border-gray-200 shadow-lg divide-y divide-gray-100">
                        {filteredLeaveDropdownStaff.length === 0 ? (
                          <div className="p-3 text-center text-xs text-gray-400">
                            ไม่พบรายชื่อเจ้าหน้าที่ที่ตรงกับคำค้นหา
                          </div>
                        ) : (
                          filteredLeaveDropdownStaff.map((s) => {
                            const conflictItem = findOverlappingLeaveConflict(
                              s.name,
                              leaveType,
                              leaveStartDate,
                              leaveEndDate
                            );
                            return (
                              <button
                                key={s.staffId}
                                type="button"
                                onClick={() => {
                                  setLeaveStaffId(s.staffId);
                                  setLeaveStaffQuery(s.name);
                                  setIsLeaveDropdownOpen(false);
                                  setLeaveFormError('');
                                }}
                                className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                                  conflictItem ? 'bg-red-50/70 hover:bg-red-100/70' : 'hover:bg-amber-50'
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-semibold text-gray-900 truncate">
                                      {s.name}
                                    </span>
                                    {conflictItem && (
                                      <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-800 border border-red-200 shrink-0">
                                        {conflictItem.leaveType}แล้วในวันที่เลือก
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-gray-500">{s.homeClinic}</span>
                                </div>
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 shrink-0">
                                  {formatPositionLabel(s.position)}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                )}
                {leaveFormError && (
                  <p className="mt-1 text-[11px] text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{leaveFormError}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  ประเภทการลา / ปฏิบัติราชการ <span className="text-red-500">*</span>
                </label>
                <select
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                  required
                  className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border bg-white font-medium text-amber-900"
                >
                  {leaveTypes.map((lt) => (
                    <option key={lt} value={lt}>
                      {isTrainingLeaveType(lt) ? `${lt} (นับมาปฏิบัติงาน ไม่นับวันลา/ไม่นับภาระงานหน่วย)` : lt}
                    </option>
                  ))}
                </select>
                {isTrainingLeaveType(leaveType) && (
                  <p className="mt-1.5 text-[11px] text-cyan-800 bg-cyan-50 border border-cyan-200 rounded-lg px-2.5 py-1.5">
                    การไปอบรม/ประชุม <strong>นับว่ามาปฏิบัติงาน (ไม่นับเป็นวันลา)</strong> ในรายงานวันลาและ Unit Cost แต่<strong>จะไม่นับเป็นภาระงานในหน่วยงาน</strong> (หักออกจากกำลังคนปฏิบัติงานประจำวันของหน่วยงานในเมนู 1 และ 4)
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    วันที่เริ่มต้น (พ.ศ.) <span className="text-red-500">*</span>
                  </label>
                  <ThaiDateInput
                    value={leaveStartDate}
                    onChange={handleStartDateChange}
                    selectClassName="w-full text-xs rounded-lg border border-gray-300 py-2 pl-2.5 pr-8 bg-white font-medium text-gray-900 outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    วันที่สิ้นสุด (พ.ศ.) <span className="text-red-500">*</span>
                  </label>
                  <ThaiDateInput
                    value={leaveEndDate}
                    onChange={handleEndDateChange}
                    selectClassName="w-full text-xs rounded-lg border border-gray-300 py-2 pl-2.5 pr-8 bg-white font-medium text-gray-900 outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  จำนวนวัน (นับเฉพาะวันราชการ - คำนวณอัตโนมัติ)
                </label>

                {leaveStartDate === leaveEndDate && (
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    <button
                      type="button"
                      onClick={() => {
                        setLeaveDays(1);
                        setLeaveHalfPeriod('');
                      }}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        leaveDays === 1 && !leaveHalfPeriod
                          ? 'bg-amber-600 text-white border-amber-700 shadow-2xs'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-amber-50'
                      }`}
                    >
                      เต็มวัน (1.0)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLeaveDays(0.5);
                        setLeaveHalfPeriod('ครึ่งวันเช้า');
                      }}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        leaveDays === 0.5 && leaveHalfPeriod === 'ครึ่งวันเช้า'
                          ? 'bg-indigo-600 text-white border-indigo-700 shadow-2xs'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-indigo-50'
                      }`}
                    >
                      ครึ่งวันเช้า (0.5)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLeaveDays(0.5);
                        setLeaveHalfPeriod('ครึ่งวันบ่าย');
                      }}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        leaveDays === 0.5 && leaveHalfPeriod === 'ครึ่งวันบ่าย'
                          ? 'bg-indigo-600 text-white border-indigo-700 shadow-2xs'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-indigo-50'
                      }`}
                    >
                      ครึ่งวันบ่าย (0.5)
                    </button>
                  </div>
                )}

                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={leaveDays}
                  onChange={(e) => {
                    const nextVal = Math.max(0, Number(e.target.value) || 0);
                    setLeaveDays(nextVal);
                    if (nextVal === 0.5 && leaveStartDate === leaveEndDate) {
                      if (!leaveHalfPeriod) setLeaveHalfPeriod('ครึ่งวันเช้า');
                    } else {
                      setLeaveHalfPeriod('');
                    }
                  }}
                  className="w-full text-sm font-bold text-center rounded-lg border-gray-300 bg-amber-50/50 py-1.5 px-3 border text-amber-900"
                />
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2.5 text-[11px] space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-1 text-slate-700">
                    <span>
                      รวมปฏิทิน <strong>{leaveDayStats.totalCalendarDays}</strong> วัน →{' '}
                      <strong className="text-emerald-800">
                        วันราชการ {leaveDayStats.workDays} วัน
                      </strong>
                    </span>
                    {leaveDayStats.weekendCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700 font-medium">
                        ตัดเสาร์-อาทิตย์ {leaveDayStats.weekendCount} วัน
                      </span>
                    )}
                  </div>
                  {leaveDayStats.holidaysInRange.length > 0 && (
                    <div className="text-rose-800 space-y-0.5 pt-1 border-t border-slate-200/80">
                      <div className="font-semibold">
                        ตัดวันหยุดนักขัตฤกษ์ / วันหยุด รพ. ({leaveDayStats.holidaysInRange.length} วัน):
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                        {leaveDayStats.holidaysInRange.map((h) => (
                          <li key={h.date}>
                            {formatThaiShortDate(h.date)} — {h.name}
                            {h.isCustom ? ' (วันหยุดพิเศษ รพ.)' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {leaveDayStats.workDays === 0 && (
                    <div className="text-amber-800 font-medium pt-0.5">
                      * ช่วงวันที่เลือกตรงกับวันหยุดทั้งหมด (สามารถแก้ไขเป็น 0.5 หรือระบุจำนวนวันเองได้)
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  หมายเหตุ / เหตุผลการลา / หัวข้ออบรม
                </label>
                <input
                  type="text"
                  value={leaveNote}
                  onChange={(e) => setLeaveNote(e.target.value)}
                  placeholder="เช่น ใบรับรองแพทย์, ลาพักผ่อนประจำปี, ประชุมวิชาการ"
                  className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border"
                />
              </div>

              {overlappingLeaveInDb && (
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-300 text-[11px] text-red-900 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold text-red-800">ตรวจพบรายการซ้ำในวันเดียวกัน</div>
                    <div>
                      <strong>{selectedLeaveStaff?.name}</strong> มีประวัติ <strong>{overlappingLeaveInDb.leaveType}</strong> วันที่{' '}
                      {formatThaiLeaveRange(overlappingLeaveInDb.startDate, overlappingLeaveInDb.endDate)} ({overlappingLeaveInDb.days} วัน) ในฐานข้อมูลแล้ว จึงไม่สามารถบันทึกซ้ำได้
                    </div>
                  </div>
                </div>
              )}
              {leaveFormError && (
                <div
                  ref={leaveFormErrorRef}
                  className="p-2.5 rounded-xl bg-red-50 border border-red-300 text-xs text-red-700 font-medium flex items-center gap-1.5"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{leaveFormError}</span>
                </div>
              )}
              </div>

              <button
                type="submit"
                disabled={Boolean(overlappingLeaveInDb)}
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <FileCheck2 className="w-4 h-4" />
                <span>{overlappingLeaveInDb ? 'มีประวัติในวันเดียวกันแล้ว (บันทึกซ้ำไม่ได้)' : 'บันทึกประวัติการลา'}</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-7 lg:relative min-w-0">
            <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 flex flex-col gap-3 lg:absolute lg:inset-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 shrink-0">
                <h3 className="text-xs font-bold text-gray-900 flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-amber-600" />
                  <span>ประวัติการลาและไปอบรม/ประชุม ({leaves.length} รายการทั้งหมด)</span>
                </h3>
                <span className="text-[11px] font-normal text-gray-500">บันทึกลง Leave_Records</span>
              </div>

              {/* Dual Filter: Staff Search + Leave Type Filter */}
              <div className="bg-slate-50 p-3 rounded-xl border border-gray-200/80 space-y-2.5 shrink-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
                    <input
                      type="text"
                      value={leaveSearchStaff}
                      onChange={(e) => setLeaveSearchStaff(e.target.value)}
                      placeholder="พิมพ์ค้นหาชื่อเจ้าหน้าที่..."
                      className="w-full pl-8 pr-7 py-1.5 bg-white border border-gray-300 rounded-lg text-xs"
                    />
                    {leaveSearchStaff && (
                      <button
                        type="button"
                        onClick={() => setLeaveSearchStaff('')}
                        className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div>
                    <select
                      value={leaveFilterType}
                      onChange={(e) => setLeaveFilterType(e.target.value)}
                      className="w-full py-1.5 px-2.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700"
                    >
                      <option value="ALL">-- ทุกประเภทการลา / อบรม --</option>
                      {leaveTypes.map((lt) => (
                        <option key={lt} value={lt}>
                          {lt}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Filter Summary Badge + Upcoming 5-7 Toggle */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-gray-200/60 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-gray-600 font-medium">ผลการกรอง:</span>
                    <span className="bg-amber-100 text-amber-900 font-extrabold px-2.5 py-0.5 rounded-lg border border-amber-300 text-xs">
                      รวมวันลาที่เลือก: {totalFilteredLeaveDays} วัน
                    </span>
                    {totalFilteredTrainingDays > 0 && (
                      <span className="bg-cyan-50 text-cyan-800 font-bold px-2.5 py-0.5 rounded-lg border border-cyan-200 text-xs">
                        ไปอบรม/ประชุม: {totalFilteredTrainingDays} วัน (นับมาปฏิบัติงาน ไม่นับวันลา)
                      </span>
                    )}
                    <span className="text-gray-500 text-[11px]">
                      (แสดง {leaveHistoryDisplay.rows.length} จาก {filteredLeaves.length} รายการ)
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    {(leaveHistoryDisplay.isTruncated || showAllLeaveHistory) && (
                      <button
                        type="button"
                        onClick={() => setShowAllLeaveHistory((prev) => !prev)}
                        className="px-2.5 py-1 rounded-lg bg-white border border-amber-300 text-amber-900 hover:bg-amber-50 font-bold text-[11px] cursor-pointer"
                      >
                        {showAllLeaveHistory
                          ? 'แสดงเฉพาะ 7 รายการที่ใกล้ถึง'
                          : `ดูทั้งหมด (${filteredLeaves.length} รายการ)`}
                      </button>
                    )}
                    {(leaveSearchStaff || leaveFilterType !== 'ALL') && (
                      <button
                        type="button"
                        onClick={() => {
                          setLeaveSearchStaff('');
                          setLeaveFilterType('ALL');
                        }}
                        className="text-amber-800 hover:underline font-semibold text-[11px] cursor-pointer"
                      >
                        ล้างตัวกรองทั้งหมด
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {filteredLeaves.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-10 text-center text-gray-400 text-xs">
                  {leaves.length === 0
                    ? 'ยังไม่มีประวัติการลา'
                    : 'ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา'}
                </div>
              ) : (
                <div className="flex-1 min-h-0 flex flex-col gap-2">
                  {!showAllLeaveHistory && leaveHistoryDisplay.showingUpcomingOnly && (
                    <div className="text-[11px] text-amber-900 bg-amber-50/70 border border-amber-200/80 rounded-lg px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
                      <span>
                        กำลังแสดง <strong>{leaveHistoryDisplay.rows.length} รายการที่กำลังจะถึงใกล้ที่สุด</strong> (จากวันลาล่วงหน้าทั้งหมด {leaveHistoryDisplay.upcomingCount} รายการ)
                      </span>
                      <span className="text-[10px] text-amber-700">สามารถดูรายการทั้งหมดในปฏิทินด้านล่างหรือกด &ldquo;ดูทั้งหมด&rdquo;</span>
                    </div>
                  )}
                  <div className="flex-1 min-h-0 overflow-auto border border-gray-100 rounded-xl">
                    <table className="w-full text-left text-[11.5px]">
                      <thead className="bg-slate-50 text-slate-700 font-semibold border-b sticky top-0 z-10">
                        <tr>
                          <th className="py-2 px-2.5 whitespace-nowrap">ชื่อ-สกุล</th>
                          <th className="py-2 px-2 whitespace-nowrap">ตำแหน่ง</th>
                          <th className="py-2 px-2 whitespace-nowrap">คลินิก</th>
                          <th className="py-2 px-2 whitespace-nowrap">ประเภท</th>
                          <th className="py-2 px-2 text-center whitespace-nowrap">ระยะเวลา</th>
                          <th className="py-2 px-1.5 text-center whitespace-nowrap">วัน</th>
                          <th className="py-2 px-1.5 text-center whitespace-nowrap">จัดการ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {leaveHistoryDisplay.rows.map((lv) => {
                          const isTraining = isTrainingLeaveType(lv.leaveType);
                          const halfPeriod = parseLeavePeriodFromNote(lv.note);
                          const cleanNote = stripLeavePeriodFromNote(lv.note);
                          return (
                            <tr key={lv.id} className="hover:bg-slate-50/80">
                              <td className="py-2 px-3 whitespace-nowrap">
                                <div className="font-semibold text-gray-900 whitespace-nowrap">{lv.staffName}</div>
                                {cleanNote && (
                                  <div className="text-[10px] text-gray-500 truncate max-w-[200px]" title={cleanNote}>
                                    {cleanNote}
                                  </div>
                                )}
                                {lv.lastEditReason && (
                                  <div
                                    className="text-[10px] text-blue-700 bg-blue-50/80 border border-blue-100 rounded px-1.5 py-0.5 mt-1 inline-block"
                                    title={`แก้ไขโดย ${lv.lastEditedBy || 'Admin'} เมื่อ ${lv.lastEditedAt ? formatThaiDateTime(lv.lastEditedAt) : '-'}`}
                                  >
                                    แก้ไข: {lv.lastEditReason}
                                    {lv.lastEditedAt ? ` • ${formatThaiDateTime(lv.lastEditedAt)}` : ''}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-2 text-gray-600 whitespace-nowrap">
                                {formatPositionLabel(lv.position)}
                              </td>
                              <td className="py-2 px-2 text-gray-600 whitespace-nowrap">{lv.clinic}</td>
                              <td className="py-2 px-2 whitespace-nowrap">
                                <div className="flex flex-col items-start gap-0.5">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${
                                      isTraining
                                        ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                                        : 'bg-amber-50 text-amber-800 border-amber-200'
                                    }`}
                                  >
                                    {lv.leaveType}
                                  </span>
                                  {isTraining && (
                                    <span className="text-[9px] text-cyan-700 font-medium">นับมาปฏิบัติงาน</span>
                                  )}
                                  {lv.days === 0.5 && halfPeriod && (
                                    <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                      {halfPeriod}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-2 text-center text-[11px] text-gray-600 whitespace-nowrap">
                                {lv.startDate === lv.endDate
                                  ? formatThaiShortDate(lv.startDate)
                                  : `${formatThaiShortDate(lv.startDate)} ถึง ${formatThaiShortDate(lv.endDate)}`}
                              </td>
                              <td className="py-2 px-2 text-center font-bold text-gray-800">
                                {lv.days}
                              </td>
                              <td className="py-2 px-2 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {isAdmin && onUpdateLeave && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingLeave({ ...lv });
                                        setEditLeaveReason('');
                                        setEditLeaveReasonError('');
                                        setEditLeaveDuplicateError('');
                                      }}
                                      className="text-gray-400 hover:text-blue-600 p-1 cursor-pointer"
                                      title="แก้ไขรายการและระบุเหตุผล (Admin)"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  {isAdmin ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDeletingLeave(lv);
                                        setDeleteLeaveReason('');
                                        setDeleteLeaveReasonError('');
                                      }}
                                      className="text-gray-400 hover:text-red-500 p-1 cursor-pointer"
                                      title="ลบรายการและบันทึกเหตุผล (Admin)"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  ) : (
                                    <span className="text-gray-300 text-[10px]">-</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Leave Audit Log Section */}
              {auditLogs.filter((a) => a.action === 'แก้ไขวันลา' || a.action === 'ลบวันลา').length > 0 && (
                <div className="pt-2 border-t border-gray-200 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowLeaveAuditLog((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-amber-700 cursor-pointer"
                  >
                    <History className="w-3.5 h-3.5 text-amber-600" />
                    <span>
                      ประวัติการแก้ไข / ลบวันลา (
                      {auditLogs.filter((a) => a.action === 'แก้ไขวันลา' || a.action === 'ลบวันลา').length}{' '}
                      รายการ)
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${showLeaveAuditLog ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {showLeaveAuditLog && (
                    <div className="mt-2.5 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {auditLogs
                        .filter((a) => a.action === 'แก้ไขวันลา' || a.action === 'ลบวันลา')
                        .map((log) => (
                          <div
                            key={log.id}
                            className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] flex flex-col gap-1"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                                    log.action === 'ลบวันลา'
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-blue-100 text-blue-800'
                                  }`}
                                >
                                  {log.action}
                                </span>
                                <span className="font-bold text-gray-900">{log.targetName}</span>
                              </div>
                              <span className="text-[10px] text-gray-500">
                                {formatThaiDateTime(log.timestamp)}
                                {log.editedBy ? ` • โดย ${log.editedBy}` : ''}
                              </span>
                            </div>
                            <div className="text-gray-600">{log.summary}</div>
                            <div className="text-amber-900 font-semibold">
                              เหตุผล: {log.reason}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          </div>

          {/* Interactive Leave Calendar Section (Bottom of Sub-Tab 1) */}
          {(() => {
            const leaveWeekDates = getWeekIsoDates(leaveCalAnchor);
            const leaveMonthCells = getMonthGridCells(leaveCalAnchor);
            const selectedDayLeaves = getLeavesOnCalendarDate(leaveCalAnchor);
            const periodLabel =
              leaveCalView === 'month'
                ? formatThaiMonthHeader(leaveCalAnchor)
                : leaveCalView === 'week'
                  ? formatThaiWeekRangeHeader(leaveWeekDates)
                  : formatThaiShortDate(leaveCalAnchor);

            return (
              <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-amber-600" />
                      <span>ปฏิทินวันลาและไปอบรม/ประชุมของบุคลากร</span>
                    </h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      คลิกเลือกดูแบบรายเดือน รายสัปดาห์ หรือรายวัน พร้อมตัวกรองรายบุคคลและประเภทการลา
                    </p>
                  </div>

                  {/* View Mode Switcher */}
                  <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 self-start">
                    {(
                      [
                        { id: 'month', label: 'รายเดือน' },
                        { id: 'week', label: 'รายสัปดาห์' },
                        { id: 'day', label: 'รายวัน' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setLeaveCalView(tab.id)}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                          leaveCalView === tab.id
                            ? 'bg-amber-600 text-white shadow-2xs'
                            : 'text-gray-600 hover:text-amber-800'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Controls: Date Nav + Staff Filter + Leave Type Filter */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-slate-50/90 border border-slate-200/80 rounded-xl p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (leaveCalView === 'month') setLeaveCalAnchor((p) => addMonthsToIso(p, -1));
                        else if (leaveCalView === 'week') setLeaveCalAnchor((p) => addDaysToIso(p, -7));
                        else setLeaveCalAnchor((p) => addDaysToIso(p, -1));
                      }}
                      className="p-1.5 rounded-lg border border-gray-300 bg-white hover:bg-amber-50 text-gray-700 cursor-pointer"
                      title="ก่อนหน้า"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setLeaveCalAnchor(todayStr)}
                      className="px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-amber-50 text-xs font-bold text-gray-800 cursor-pointer"
                    >
                      วันนี้
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (leaveCalView === 'month') setLeaveCalAnchor((p) => addMonthsToIso(p, 1));
                        else if (leaveCalView === 'week') setLeaveCalAnchor((p) => addDaysToIso(p, 7));
                        else setLeaveCalAnchor((p) => addDaysToIso(p, 1));
                      }}
                      className="p-1.5 rounded-lg border border-gray-300 bg-white hover:bg-amber-50 text-gray-700 cursor-pointer"
                      title="ถัดไป"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <span className="text-xs sm:text-sm font-extrabold text-gray-900 px-2">
                      {periodLabel}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={leaveCalStaff}
                      onChange={(e) => setLeaveCalStaff(e.target.value)}
                      className="text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 bg-white font-medium text-gray-800 max-w-[220px]"
                    >
                      <option value="ALL">-- ดูเจ้าหน้าที่ทุกคน ({leaveCalendarStaffOptions.length}) --</option>
                      {leaveCalendarStaffOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={leaveCalType}
                      onChange={(e) => setLeaveCalType(e.target.value)}
                      className="text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 bg-white font-medium text-gray-800"
                    >
                      <option value="ALL">-- ทุกประเภทการลา / อบรม --</option>
                      {leaveTypes.map((lt) => (
                        <option key={lt} value={lt}>
                          {lt}
                        </option>
                      ))}
                    </select>

                    {(leaveCalStaff !== 'ALL' || leaveCalType !== 'ALL') && (
                      <button
                        type="button"
                        onClick={() => {
                          setLeaveCalStaff('ALL');
                          setLeaveCalType('ALL');
                        }}
                        className="text-xs font-bold text-amber-800 hover:underline px-1 cursor-pointer"
                      >
                        ล้างตัวกรอง
                      </button>
                    )}
                  </div>
                </div>

                {/* Calendar Views */}
                {leaveCalView === 'month' && (
                  <div className="space-y-4">
                    <div className="overflow-x-auto">
                      <div className="min-w-[700px] border border-gray-200 rounded-xl overflow-hidden">
                        <div className="grid grid-cols-7 bg-slate-100 border-b border-gray-200 text-center text-[11px] font-bold text-slate-700">
                          {THAI_CALENDAR_WEEKDAYS.map((wd, idx) => (
                            <div
                              key={wd}
                              className={`py-2 ${idx === 0 || idx === 6 ? 'text-rose-700 bg-rose-50/40' : ''}`}
                            >
                              {wd}
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 divide-x divide-y divide-gray-200 bg-white">
                          {leaveMonthCells.map((cell) => {
                            const dayItems = getLeavesOnCalendarDate(cell.date);
                            const holidayName = calendarHolidayMap.get(cell.date)?.name;
                            const isSelected = cell.date === leaveCalAnchor;
                            const isToday = cell.date === todayStr;
                            return (
                              <div
                                key={cell.date}
                                onClick={() => setLeaveCalAnchor(cell.date)}
                                className={`min-h-[92px] p-1.5 cursor-pointer transition-colors flex flex-col gap-1 ${
                                  !cell.inMonth
                                    ? 'bg-slate-50/70 text-gray-400'
                                    : isSelected
                                      ? 'bg-amber-50/80 ring-2 ring-inset ring-amber-500'
                                      : holidayName
                                        ? 'bg-rose-50/30 hover:bg-rose-50/50'
                                        : 'hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span
                                    className={`text-[11px] font-bold w-6 h-6 inline-flex items-center justify-center rounded-full ${
                                      isToday
                                        ? 'bg-amber-600 text-white'
                                        : isSelected
                                          ? 'bg-amber-200 text-amber-950'
                                          : 'text-gray-700'
                                    }`}
                                  >
                                    {cell.dayNum}
                                  </span>
                                  {dayItems.length > 0 && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                                      {dayItems.length}
                                    </span>
                                  )}
                                </div>
                                {holidayName && (
                                  <div className="text-[9px] font-semibold text-rose-700 truncate" title={holidayName}>
                                    {holidayName}
                                  </div>
                                )}
                                <div className="space-y-0.5">
                                  {dayItems.slice(0, 3).map((lv) => {
                                    const isTrain = isTrainingLeaveType(lv.leaveType);
                                    const p = parseLeavePeriodFromNote(lv.note);
                                    return (
                                      <div
                                        key={`${cell.date}-${lv.id}`}
                                        className={`text-[10px] px-1.5 py-0.5 rounded border truncate font-medium ${
                                          isTrain
                                            ? 'bg-cyan-50 text-cyan-900 border-cyan-200'
                                            : 'bg-amber-50 text-amber-900 border-amber-200'
                                        }`}
                                        title={`${lv.staffName} • ${lv.leaveType}${lv.days === 0.5 && p ? ` (${p})` : ''}`}
                                      >
                                        {lv.staffName.split(' ')[0]} • {lv.leaveType}
                                        {lv.days === 0.5 ? ` (${p === 'ครึ่งวันบ่าย' ? 'บ่าย' : 'เช้า'})` : ''}
                                      </div>
                                    );
                                  })}
                                  {dayItems.length > 3 && (
                                    <div className="text-[10px] font-bold text-amber-800 pl-1">
                                      +{dayItems.length - 3} รายการ
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Selected Day Quick Detail Strip */}
                    <div className="p-3.5 rounded-xl bg-amber-50/50 border border-amber-200/80 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-bold text-amber-950">
                          รายละเอียดวันที่ {formatThaiShortDate(leaveCalAnchor)}
                          {calendarHolidayMap.has(leaveCalAnchor) && (
                            <span className="ml-2 text-[11px] text-rose-700 font-semibold">
                              ({calendarHolidayMap.get(leaveCalAnchor)?.name})
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setLeaveCalView('day')}
                          className="text-[11px] font-bold text-amber-800 hover:underline cursor-pointer"
                        >
                          เปิดดูแบบรายวัน →
                        </button>
                      </div>
                      {selectedDayLeaves.length === 0 ? (
                        <div className="text-xs text-gray-500">ไม่มีรายการลาหรือไปอบรมในวันที่เลือก</div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {selectedDayLeaves.map((lv) => {
                            const isTrain = isTrainingLeaveType(lv.leaveType);
                            const period = parseLeavePeriodFromNote(lv.note);
                            const cleanNote = stripLeavePeriodFromNote(lv.note);
                            return (
                              <div
                                key={lv.id}
                                className="flex items-start justify-between gap-2 bg-white p-2.5 rounded-lg border border-gray-200 text-xs"
                              >
                                <div className="min-w-0 space-y-0.5">
                                  <div className="font-bold text-gray-900 truncate">{lv.staffName}</div>
                                  <div className="text-[11px] text-gray-600">
                                    {formatPositionLabel(lv.position)} • {lv.clinic}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                        isTrain
                                          ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                                          : 'bg-amber-50 text-amber-800 border-amber-200'
                                      }`}
                                    >
                                      {lv.leaveType} {lv.days} วัน
                                    </span>
                                    {lv.days === 0.5 && period && (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-800 border border-indigo-200">
                                        {period}
                                      </span>
                                    )}
                                    {cleanNote && (
                                      <span className="text-[10px] text-gray-500 truncate max-w-[200px]">
                                        ({cleanNote})
                                      </span>
                                    )}
                                  </div>
                                </div>
                                {isAdmin && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    {onUpdateLeave && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingLeave({ ...lv });
                                          setEditLeaveReason('');
                                          setEditLeaveReasonError('');
                                        }}
                                        className="p-1 text-gray-400 hover:text-blue-600 cursor-pointer"
                                        title="แก้ไข"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDeletingLeave(lv);
                                        setDeleteLeaveReason('');
                                        setDeleteLeaveReasonError('');
                                      }}
                                      className="p-1 text-gray-400 hover:text-red-500 cursor-pointer"
                                      title="ลบ"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {leaveCalView === 'week' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5">
                    {leaveWeekDates.map((dIso, idx) => {
                      const dayItems = getLeavesOnCalendarDate(dIso);
                      const holidayName = calendarHolidayMap.get(dIso)?.name;
                      const isToday = dIso === todayStr;
                      const isSelected = dIso === leaveCalAnchor;
                      return (
                        <div
                          key={dIso}
                          onClick={() => setLeaveCalAnchor(dIso)}
                          className={`rounded-xl border p-2.5 min-h-[180px] flex flex-col gap-2 cursor-pointer transition-all ${
                            isSelected
                              ? 'border-amber-500 bg-amber-50/40 ring-1 ring-amber-400'
                              : 'border-gray-200 bg-white hover:border-amber-300'
                          }`}
                        >
                          <div className="flex items-center justify-between border-b pb-1.5">
                            <span className="text-[11px] font-bold text-gray-700">
                              {THAI_CALENDAR_WEEKDAYS[idx]} {parseIsoParts(dIso).d}
                            </span>
                            {isToday && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-600 text-white">
                                วันนี้
                              </span>
                            )}
                          </div>
                          {holidayName && (
                            <div className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">
                              {holidayName}
                            </div>
                          )}
                          <div className="space-y-1.5 flex-1">
                            {dayItems.length === 0 ? (
                              <div className="text-[10px] text-gray-400 italic py-2">ไม่มีรายการ</div>
                            ) : (
                              dayItems.map((lv) => {
                                const isTrain = isTrainingLeaveType(lv.leaveType);
                                const period = parseLeavePeriodFromNote(lv.note);
                                return (
                                  <div
                                    key={`${dIso}-${lv.id}`}
                                    className={`p-1.5 rounded-lg border text-[10px] space-y-0.5 ${
                                      isTrain
                                        ? 'bg-cyan-50/90 border-cyan-200 text-cyan-950'
                                        : 'bg-amber-50/90 border-amber-200 text-amber-950'
                                    }`}
                                  >
                                    <div className="font-bold truncate">{lv.staffName}</div>
                                    <div className="text-[9px] opacity-80 truncate">{lv.clinic}</div>
                                    <div className="font-semibold">
                                      {lv.leaveType}
                                      {lv.days === 0.5 && period ? ` (${period})` : ''}
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {leaveCalView === 'day' && (
                  <div className="space-y-2.5">
                    {calendarHolidayMap.has(leaveCalAnchor) && (
                      <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800">
                        วันหยุดราชการ/นักขัตฤกษ์: {calendarHolidayMap.get(leaveCalAnchor)?.name}
                      </div>
                    )}
                    {selectedDayLeaves.length === 0 ? (
                      <div className="py-10 text-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl">
                        ไม่มีข้อมูลการลาหรือไปอบรมในวันที่ {formatThaiShortDate(leaveCalAnchor)}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {selectedDayLeaves.map((lv) => {
                          const isTrain = isTrainingLeaveType(lv.leaveType);
                          const period = parseLeavePeriodFromNote(lv.note);
                          const cleanNote = stripLeavePeriodFromNote(lv.note);
                          return (
                            <div
                              key={lv.id}
                              className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
                                isTrain ? 'bg-cyan-50/40 border-cyan-200' : 'bg-amber-50/40 border-amber-200'
                              }`}
                            >
                              <div className="space-y-1 min-w-0">
                                <div className="text-xs font-bold text-gray-900">{lv.staffName}</div>
                                <div className="text-[11px] text-gray-600">
                                  {formatPositionLabel(lv.position)} • คลินิก: {lv.clinic}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                      isTrain
                                        ? 'bg-cyan-100 text-cyan-900 border-cyan-300'
                                        : 'bg-amber-100 text-amber-900 border-amber-300'
                                    }`}
                                  >
                                    {lv.leaveType} ({lv.days} วัน)
                                  </span>
                                  {lv.days === 0.5 && period && (
                                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                                      {period}
                                    </span>
                                  )}
                                  {isTrain && (
                                    <span className="text-[10px] font-semibold text-cyan-800">
                                      ทำงานปกติ (ไม่นับวันลา)
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-gray-600">
                                  ช่วงวันที่: {formatThaiLeaveRange(lv.startDate, lv.endDate)}
                                  {cleanNote ? ` • หมายเหตุ: ${cleanNote}` : ''}
                                </div>
                              </div>
                              {isAdmin && (
                                <div className="flex items-center gap-1 shrink-0">
                                  {onUpdateLeave && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingLeave({ ...lv });
                                        setEditLeaveReason('');
                                        setEditLeaveReasonError('');
                                        setEditLeaveDuplicateError('');
                                      }}
                                      className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-blue-600 cursor-pointer"
                                      title="แก้ไข"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeletingLeave(lv);
                                      setDeleteLeaveReason('');
                                      setDeleteLeaveReasonError('');
                                    }}
                                    className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-red-500 cursor-pointer"
                                    title="ลบ"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* --- SUB-TAB 2: OT MULTI-SELECT + IN-TIME OT + EXTERNAL SUBSTITUTE ENTRY --- */}
      {activeSubTab === 'ot' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:items-stretch">
            {/* Controls: 50% width */}
            <div className="flex flex-col min-w-0">
              <form
                onSubmit={handleSaveBatchOTSubmit}
                noValidate
                className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4 flex-1 flex flex-col justify-between"
              >
                <div className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 border-b pb-2">
                  <Users className="w-4 h-4 text-teal-600 shrink-0" />
                  <span>บันทึกเวรนอกเวลา &amp; ปฏิบัติหน้าที่แทน</span>
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      วันที่ปฏิบัติงานเวร (พ.ศ.) <span className="text-red-500">*</span>
                    </label>
                    <ThaiDateInput
                      value={otDate}
                      onChange={setOtDate}
                      selectClassName="w-full text-xs rounded-lg border border-gray-300 py-2 pl-2.5 pr-8 bg-white font-medium text-gray-900 outline-none focus:border-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      กะเวลาเวร / OT <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={otShift}
                      onChange={(e) => handleOtShiftChange(e.target.value as WorkShift)}
                      required
                      className="w-full text-xs rounded-lg border-gray-300 py-2 px-2.5 border bg-white font-medium"
                    >
                      {OT_SHIFTS.map((sh) => (
                        <option key={sh.value} value={sh.value}>
                          {sh.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {otShift === 'OT ในเวลาราชการ 08:00-16:00' && (
                  <div className="p-2.5 rounded-xl bg-cyan-50 border border-cyan-200 text-[11px] text-cyan-900">
                    สำหรับบันทึกเจ้าหน้าที่จากหน่วยงานอื่น (นอก OPD) ที่มาขึ้น OT ปฏิบัติหน้าที่แทนในเวลาราชการ
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      ห้องตรวจที่ไปปฏิบัติงานจริง (Work Clinic) <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={workClinic}
                      onChange={(e) => setWorkClinic(e.target.value)}
                      required
                      className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border bg-white font-medium text-teal-900"
                    >
                      {otWorkClinicOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-teal-700" />
                      <span>จำนวนชั่วโมงปฏิบัติงานจริง (ชม./คน) *</span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        max="24"
                        value={otHours}
                        onChange={(e) => handleBatchOtHoursChange(Number(e.target.value))}
                        className="w-20 text-xs font-extrabold text-center rounded-lg border border-teal-300 bg-teal-50/40 py-2 px-2 text-teal-950 focus:ring-2 focus:ring-teal-500 outline-none"
                      />
                      <div className="flex flex-wrap gap-1">
                        {[4, 4.5, 5, 6, 7, 8].map((hPreset) => (
                          <button
                            key={hPreset}
                            type="button"
                            onClick={() => handleBatchOtHoursChange(hPreset)}
                            className={`px-2 py-1 text-[11px] font-bold rounded-md border transition-colors cursor-pointer ${
                              Math.abs(otHours - hPreset) < 0.001
                                ? 'bg-teal-700 text-white border-teal-700'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-teal-50'
                            }`}
                          >
                            {hPreset}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-[10.5px] text-teal-800/90 -mt-2">
                  กรณีปฏิบัติงานเกินเวลา (เช่น 4.5, 5 หรือ 6 ชม.) สามารถตั้งค่าหลักด้านบน หรือปรับชั่วโมงรายคนในรายการฝั่งขวาได้
                </p>

                {/* Ad-hoc External Substitute Staff Box */}
                <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200/90 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                    <UserPlus className="w-4 h-4 text-indigo-600" />
                    <span>เจ้าหน้าที่เฉพาะกิจ (กรณีที่ไม่ใช่คนของ OPD)</span>
                  </div>
                  <p className="text-[11px] text-indigo-800/90">
                    ระบุชื่อ-สกุล, รหัสบุคลากร (ถ้ามี), จำนวนชั่วโมง และหน่วยงานต้นสังกัดของเจ้าหน้าที่ภายนอก
                  </p>

                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={extName}
                        onChange={(e) => {
                          setExtName(e.target.value);
                          setExtError('');
                        }}
                        placeholder="ชื่อ-สกุล * (เช่น พว.สุภาภรณ์ ดีมาก)"
                        className="sm:col-span-2 w-full text-xs rounded-lg border-indigo-200 py-1.5 px-2.5 border bg-white"
                      />
                      <input
                        type="text"
                        value={extEmployeeCode}
                        onChange={(e) => setExtEmployeeCode(e.target.value)}
                        placeholder="รหัสบุคลากร (ถ้ามี)"
                        className="w-full text-xs rounded-lg border-indigo-200 py-1.5 px-2.5 border bg-white font-mono"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <select
                        value={extPosition}
                        onChange={(e) => setExtPosition(e.target.value as StaffPosition)}
                        className="w-full text-xs rounded-lg border-indigo-200 py-1.5 px-2 border bg-white"
                      >
                        {ALL_POSITIONS.map((p) => (
                          <option key={p} value={p}>
                            {POSITION_LABELS[p]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={extAffiliation}
                        onChange={(e) => {
                          setExtAffiliation(e.target.value);
                          setExtError('');
                        }}
                        placeholder="สังกัด * (เช่น ER, ICU)"
                        className="w-full text-xs rounded-lg border-indigo-200 py-1.5 px-2.5 border bg-white"
                      />
                      <div className="flex items-center gap-1 bg-white border border-indigo-200 rounded-lg px-2 py-1">
                        <span className="text-[10px] font-bold text-indigo-800 shrink-0">ชม.:</span>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          max="24"
                          value={extOtHours}
                          onChange={(e) => setExtOtHours(Number(e.target.value) || 4)}
                          className="w-full text-xs font-bold text-center outline-none"
                        />
                      </div>
                    </div>
                    {extError && (
                      <p className="text-[11px] text-red-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{extError}</span>
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleAddExternalStaff}
                      className="w-full py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <BadgePlus className="w-3.5 h-3.5" />
                      <span>เพิ่มชื่อเจ้าหน้าที่เฉพาะกิจเข้าชุดบันทึก</span>
                    </button>
                  </div>

                  {externalOtStaff.length > 0 && (
                    <div className="pt-2 border-t border-indigo-200/70 space-y-1.5">
                      <div className="text-[11px] font-bold text-indigo-900">
                        รายชื่อเฉพาะกิจที่เพิ่มไว้ ({externalOtStaff.length} คน):
                      </div>
                      {externalOtStaff.map((ext) => (
                        <div
                          key={ext.tempId}
                          className="flex items-center justify-between gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-indigo-200 text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-bold text-gray-900 block truncate">
                              {ext.name}
                              {ext.employeeCode ? (
                                <span className="ml-1.5 text-[10px] font-mono text-indigo-700">
                                  ({ext.employeeCode})
                                </span>
                              ) : null}
                            </span>
                            <span className="text-[10px] text-indigo-700">
                              {formatPositionLabel(ext.position)} • สังกัด: {ext.affiliation} •{' '}
                              <strong>{formatOtHourNum(ext.hours)} ชม.</strong>
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setExternalOtStaff((prev) =>
                                prev.filter((item) => item.tempId !== ext.tempId)
                              )
                            }
                            className="text-gray-400 hover:text-red-600 p-0.5 cursor-pointer shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected Staff Counter */}
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-teal-950 block">เลือกแล้วทั้งหมด:</span>
                    <span className="text-sm font-bold text-teal-700">
                      {totalOtSelectedCount} คน{' '}
                      <span className="text-[11px] font-normal text-teal-600">
                        (OPD {selectedStaffIds.length} + เฉพาะกิจ {externalOtStaff.length + (readyExtDraft ? 1 : 0)})
                      </span>
                    </span>
                  </div>
                  {totalOtSelectedCount > 0 && (
                    <button
                      type="button"
                      onClick={clearSelectedStaff}
                      className="text-xs text-red-600 hover:underline cursor-pointer"
                    >
                      ล้างที่เลือกทั้งหมด
                    </button>
                  )}
                </div>

                {conflictingSelectedOtList.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-red-50 border border-red-300 text-[11px] text-red-900 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-red-800">ตรวจพบบันทึกเวรซ้ำในวันและกะเวลาเดียวกัน</div>
                      <div>
                        รายชื่อต่อไปนี้มีข้อมูลเวรวันที่ {formatThaiShortDate(otDate)} กะ <strong>{otShift}</strong> อยู่ในระบบแล้ว:{' '}
                        <strong>{conflictingSelectedOtList.map((c) => `${c.name} (${c.existingClinic})`).join(', ')}</strong>
                      </div>
                    </div>
                  </div>
                )}

                {otFormError && (
                  <p ref={otFormErrorRef} className="text-[11px] text-red-600 font-medium bg-red-50 border border-red-200 rounded-lg px-2.5 py-2 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{otFormError}</span>
                  </p>
                )}

                </div>
                <button
                  type="submit"
                  disabled={(totalOtSelectedCount === 0 && !hasFilledExternalDraft) || conflictingSelectedOtList.length > 0}
                  className="w-full py-2.5 bg-teal-700 hover:bg-teal-600 active:bg-teal-800 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>
                    {conflictingSelectedOtList.length > 0
                      ? 'พบรายชื่อเวรซ้ำในกะนี้ (บันทึกซ้ำไม่ได้)'
                      : `บันทึกเวรปฏิบัติงาน (${totalOtSelectedCount} คน)`}
                  </span>
                </button>
              </form>
            </div>

            {/* Staff Multi-Select Grid: 50% width, equal height to left form */}
            <div className="lg:relative min-w-0">
              <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 flex flex-col gap-3 lg:absolute lg:inset-0">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3 shrink-0">
                  <h3 className="text-xs font-bold text-gray-900">
                    คลิกเลือกเจ้าหน้าที่ OPD ที่จะขึ้นเวร ({activeStaff.length} คน)
                  </h3>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      placeholder="ค้นหาชื่อ, รหัส, ตำแหน่ง, คลินิก..."
                      value={otSearch}
                      onChange={(e) => setOtSearch(e.target.value)}
                      className="text-xs rounded-lg border-gray-200 pl-8 pr-3 py-1.5 border w-56"
                    />
                  </div>
                </div>

                {/* Staff Items List */}
                <div className="flex-1 min-h-0 max-h-[540px] lg:max-h-none overflow-y-auto space-y-1.5 pr-1">
                  {activeStaff
                    .filter((s) => {
                      const q = otSearch.toLowerCase().trim();
                      if (!q) return true;
                      const staffCode = getStaffEmployeeCode(s).toLowerCase();
                      return (
                        s.name.toLowerCase().includes(q) ||
                        staffCode.includes(q) ||
                        s.position.toLowerCase().includes(q) ||
                        formatPositionLabel(s.position).toLowerCase().includes(q) ||
                        s.homeClinic.toLowerCase().includes(q)
                      );
                    })
                    .map((s) => {
                      const isSelected = selectedStaffIds.includes(s.staffId);
                      const existingOt = findOtConflictForName(s.name, otDate, otShift, workClinic);
                      const isBlockedDuplicate = Boolean(existingOt) && !isSelected;
                      const existingOtClinic = existingOt
                        ? parseOtWorkClinic(existingOt.workClinic).clinic || existingOt.workClinic
                        : '';
                      const personHours = selectedOtHoursByStaffId[s.staffId] ?? otHours;
                      const staffCode = getStaffEmployeeCode(s);
                      return (
                        <div
                          key={s.staffId}
                          onClick={() => {
                            if (isBlockedDuplicate) {
                              setOtFormError(
                                `ไม่สามารถเลือก ${s.name} ซ้ำได้ เนื่องจากมีบันทึกเวรที่ ${existingOtClinic} วันที่ ${formatThaiShortDate(otDate)} กะ "${otShift}" แล้ว`
                              );
                              return;
                            }
                            toggleSelectStaff(s.staffId);
                          }}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 transition-all ${
                            isBlockedDuplicate
                              ? 'bg-red-50/50 border-red-200 text-gray-400 cursor-not-allowed'
                              : isSelected && existingOt
                                ? 'bg-red-50 border-red-300 text-red-900 font-medium cursor-pointer'
                                : isSelected
                                  ? 'bg-teal-50 border-teal-300 text-teal-950 font-medium cursor-pointer'
                                  : 'bg-slate-50/50 border-gray-100 hover:border-teal-200 text-gray-700 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-teal-600 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-300 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-xs font-bold block truncate">{s.name}</span>
                                {existingOt && (
                                  <span className="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-800 border border-red-200 shrink-0">
                                    บันทึกเวรแล้ว ({existingOtClinic})
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-gray-500 block truncate">
                                {staffCode ? `รหัส: ${staffCode} • ` : ''}
                                สังกัด: {s.homeClinic}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isSelected && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex items-center gap-1 bg-white border border-teal-300 rounded-lg px-1.5 py-0.5 shadow-2xs"
                                title="ปรับจำนวนชั่วโมงปฏิบัติงานเฉพาะรายบุคคล"
                              >
                                <input
                                  type="number"
                                  step="0.5"
                                  min="0.5"
                                  max="24"
                                  value={personHours}
                                  onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setSelectedOtHoursByStaffId((prev) => ({
                                      ...prev,
                                      [s.staffId]:
                                        Number.isFinite(val) && val > 0 ? Math.min(24, val) : 0.5,
                                    }));
                                  }}
                                  className="w-11 text-[11px] font-extrabold text-center text-teal-900 outline-none"
                                />
                                <span className="text-[10px] font-semibold text-teal-700">ชม.</span>
                              </div>
                            )}
                            <span
                              className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                                s.position === 'RN'
                                  ? 'bg-blue-100 text-blue-800'
                                  : s.position === 'PN'
                                    ? 'bg-teal-100 text-teal-800'
                                    : s.position === 'NA' || s.position === 'PCA'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : s.position === 'Clerk (Referral)'
                                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                        : isDailyWagePosition(s.position)
                                          ? 'bg-sky-100 text-sky-800'
                                          : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {formatPositionLabel(s.position)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>

          {/* OT & Substitute Attendance Calendar + List Section */}
          {(() => {
            const otWeekDates = getWeekIsoDates(otCalAnchor);
            const otMonthCells = getMonthGridCells(otCalAnchor);
            const otDayItems = filteredOtRecords.filter((o) => o.date === otCalAnchor);
            const otPeriodLabel =
              otCalView === 'month'
                ? formatThaiMonthHeader(otCalAnchor)
                : otCalView === 'week'
                  ? formatThaiWeekRangeHeader(otWeekDates)
                  : formatThaiShortDate(otCalAnchor);

            return (
              <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b pb-3">
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-gray-900 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-teal-700" />
                      <span>
                        ปฏิทินและรายการบันทึกเวรนอกเวลา &amp; ปฏิบัติหน้าที่แทน ({filteredOtRecords.length} / {otRecords.length} รายการ)
                      </span>
                    </h3>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      สลับดูแบบปฏิทินรายเดือน รายสัปดาห์ รายวัน หรือตารางรายการ พร้อมกรองรายบุคคลและคลินิก
                    </p>
                  </div>

                  <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 self-start">
                    {(
                      [
                        { id: 'month', label: 'รายเดือน' },
                        { id: 'week', label: 'รายสัปดาห์' },
                        { id: 'day', label: 'รายวัน' },
                        { id: 'list', label: 'รายการตาราง' },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setOtCalView(tab.id)}
                        className={`px-2.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer inline-flex items-center gap-1 ${
                          otCalView === tab.id
                            ? 'bg-teal-700 text-white shadow-2xs'
                            : 'text-gray-600 hover:text-teal-800'
                        }`}
                      >
                        {tab.id === 'list' && <List className="w-3.5 h-3.5" />}
                        <span>{tab.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Controls: Date Navigation (in Calendar views) + Individual Staff + Clinic + Search */}
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 bg-slate-50/90 border border-slate-200/80 rounded-xl p-3">
                  {otCalView !== 'list' ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (otCalView === 'month') setOtCalAnchor((p) => addMonthsToIso(p, -1));
                          else if (otCalView === 'week') setOtCalAnchor((p) => addDaysToIso(p, -7));
                          else setOtCalAnchor((p) => addDaysToIso(p, -1));
                        }}
                        className="p-1.5 rounded-lg border border-gray-300 bg-white hover:bg-teal-50 text-gray-700 cursor-pointer"
                        title="ก่อนหน้า"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setOtCalAnchor(todayStr)}
                        className="px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-teal-50 text-xs font-bold text-gray-800 cursor-pointer"
                      >
                        วันนี้
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (otCalView === 'month') setOtCalAnchor((p) => addMonthsToIso(p, 1));
                          else if (otCalView === 'week') setOtCalAnchor((p) => addDaysToIso(p, 7));
                          else setOtCalAnchor((p) => addDaysToIso(p, 1));
                        }}
                        className="p-1.5 rounded-lg border border-gray-300 bg-white hover:bg-teal-50 text-gray-700 cursor-pointer"
                        title="ถัดไป"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <span className="text-xs sm:text-sm font-extrabold text-teal-950 px-2">
                        {otPeriodLabel}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs font-bold text-teal-900">
                      มุมมองตารางรายการทั้งหมด ({filteredOtRecords.length} รายการ)
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={otCalStaff}
                      onChange={(e) => setOtCalStaff(e.target.value)}
                      className="text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 bg-white font-medium text-gray-800 max-w-[200px]"
                    >
                      <option value="ALL">-- ดูเจ้าหน้าที่ทุกคน ({otCalendarStaffOptions.length}) --</option>
                      {otCalendarStaffOptions.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={otCalClinic}
                      onChange={(e) => setOtCalClinic(e.target.value)}
                      className="text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 bg-white font-medium text-gray-800"
                    >
                      <option value="ALL">-- ทุกคลินิกที่ปฏิบัติงาน --</option>
                      {allClinics.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>

                    <div className="relative w-full sm:w-52">
                      <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2" />
                      <input
                        type="text"
                        value={otHistorySearch}
                        onChange={(e) => setOtHistorySearch(e.target.value)}
                        placeholder="ค้นหาชื่อ, สังกัด, กะ..."
                        className="w-full text-xs rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 bg-white"
                      />
                    </div>

                    {(otCalStaff !== 'ALL' || otCalClinic !== 'ALL' || otHistorySearch) && (
                      <button
                        type="button"
                        onClick={() => {
                          setOtCalStaff('ALL');
                          setOtCalClinic('ALL');
                          setOtHistorySearch('');
                        }}
                        className="text-xs font-bold text-teal-800 hover:underline px-1 cursor-pointer"
                      >
                        ล้างตัวกรอง
                      </button>
                    )}
                  </div>
                </div>

                {/* VIEW 1: MONTH CALENDAR */}
                {otCalView === 'month' && (
                  <div className="space-y-4">
                    <div className="overflow-x-auto">
                      <div className="min-w-[700px] border border-gray-200 rounded-xl overflow-hidden">
                        <div className="grid grid-cols-7 bg-slate-100 border-b border-gray-200 text-center text-[11px] font-bold text-slate-700">
                          {THAI_CALENDAR_WEEKDAYS.map((wd, idx) => (
                            <div
                              key={wd}
                              className={`py-2 ${idx === 0 || idx === 6 ? 'text-purple-800 bg-purple-50/40' : ''}`}
                            >
                              {wd}
                            </div>
                          ))}
                        </div>
                        <div className="grid grid-cols-7 divide-x divide-y divide-gray-200 bg-white">
                          {otMonthCells.map((cell) => {
                            const dayOts = filteredOtRecords.filter((o) => o.date === cell.date);
                            const isSelected = cell.date === otCalAnchor;
                            const isToday = cell.date === todayStr;
                            return (
                              <div
                                key={cell.date}
                                onClick={() => setOtCalAnchor(cell.date)}
                                className={`min-h-[92px] p-1.5 cursor-pointer transition-colors flex flex-col gap-1 ${
                                  !cell.inMonth
                                    ? 'bg-slate-50/70 text-gray-400'
                                    : isSelected
                                      ? 'bg-teal-50/80 ring-2 ring-inset ring-teal-600'
                                      : 'hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span
                                    className={`text-[11px] font-bold w-6 h-6 inline-flex items-center justify-center rounded-full ${
                                      isToday
                                        ? 'bg-teal-700 text-white'
                                        : isSelected
                                          ? 'bg-teal-200 text-teal-950'
                                          : 'text-gray-700'
                                    }`}
                                  >
                                    {cell.dayNum}
                                  </span>
                                  {dayOts.length > 0 && (
                                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-100 text-teal-900">
                                      {dayOts.length} เวร
                                    </span>
                                  )}
                                </div>
                                <div className="space-y-0.5">
                                  {dayOts.slice(0, 3).map((o) => {
                                    const isInTimeOT = o.shift === 'OT ในเวลาราชการ 08:00-16:00';
                                    const parsedWork = parseOtWorkClinic(o.workClinic);
                                    const effHrs = getEffectiveOtHours(o, settings?.stdHr);
                                    return (
                                      <div
                                        key={o.id}
                                        className={`text-[10px] px-1.5 py-0.5 rounded border truncate font-medium ${
                                          isInTimeOT
                                            ? 'bg-cyan-50 text-cyan-900 border-cyan-200'
                                            : 'bg-purple-50 text-purple-900 border-purple-200'
                                        }`}
                                        title={`${o.staffName} • ${o.shift} • ${parsedWork.clinic} (${formatOtHourNum(effHrs)} ชม.)`}
                                      >
                                        {o.staffName.split(' ')[0]} → {parsedWork.clinic}
                                        {parsedWork.amount === 0.5 ? ' (0.5)' : ''}
                                        {` • ${formatOtHourNum(effHrs)}ชม.`}
                                      </div>
                                    );
                                  })}
                                  {dayOts.length > 3 && (
                                    <div className="text-[10px] font-bold text-teal-800 pl-1">
                                      +{dayOts.length - 3} รายการ
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Selected Day Quick Detail Strip */}
                    <div className="p-3.5 rounded-xl bg-teal-50/50 border border-teal-200/80 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-bold text-teal-950">
                          รายการเวรนอกเวลา/ช่วยงาน วันที่ {formatThaiShortDate(otCalAnchor)} ({otDayItems.length} รายการ)
                        </div>
                        <button
                          type="button"
                          onClick={() => setOtCalView('day')}
                          className="text-[11px] font-bold text-teal-800 hover:underline cursor-pointer"
                        >
                          เปิดดูแบบรายวัน →
                        </button>
                      </div>
                      {otDayItems.length === 0 ? (
                        <div className="text-xs text-gray-500">ไม่มีรายการเวรในวันที่เลือก</div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {otDayItems.map((o) => {
                            const isInTimeOT = o.shift === 'OT ในเวลาราชการ 08:00-16:00';
                            const origin = o.affiliation || o.homeClinic;
                            const parsedWork = parseOtWorkClinic(o.workClinic);
                            const effHrs = getEffectiveOtHours(o, settings?.stdHr);
                            const matchedStaff = !o.isExternal
                              ? staffList.find((s) => s.name.trim() === (o.staffName || '').trim())
                              : undefined;
                            const displayEmpCode =
                              getStaffEmployeeCode(matchedStaff) || (o.employeeCode || '').trim();
                            return (
                              <div
                                key={o.id}
                                className="flex items-start justify-between gap-2 bg-white p-2.5 rounded-lg border border-gray-200 text-xs"
                              >
                                <div className="min-w-0 space-y-0.5">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-bold text-gray-900">{o.staffName}</span>
                                    {displayEmpCode && (
                                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
                                        {displayEmpCode}
                                      </span>
                                    )}
                                    {o.isExternal && (
                                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 text-indigo-800">
                                        เฉพาะกิจ
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-gray-600">
                                    {formatPositionLabel(o.position)} • ต้นสังกัด: {origin}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                        isInTimeOT
                                          ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                                          : 'bg-purple-50 text-purple-800 border-purple-200'
                                      }`}
                                    >
                                      {o.shift}
                                    </span>
                                    <span className="font-bold text-teal-800 text-[11px]">
                                      → {parsedWork.clinic}
                                      {parsedWork.amount === 0.5 && parsedWork.periodLabel
                                        ? ` (0.5 ${parsedWork.periodLabel})`
                                        : ''}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                      {formatOtHourNum(effHrs)} ชม.
                                    </span>
                                  </div>
                                </div>
                                {isAdmin && (
                                  <div className="flex items-center gap-1 shrink-0">
                                    {onUpdateOT && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingOT({
                                            ...o,
                                            employeeCode: displayEmpCode || undefined,
                                          });
                                          setEditOtReason('');
                                          setEditOtReasonError('');
                                        }}
                                        className="p-1 text-gray-400 hover:text-blue-600 cursor-pointer"
                                        title="แก้ไข"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDeletingOT(o);
                                        setDeleteOtReason('');
                                        setDeleteOtReasonError('');
                                      }}
                                      className="p-1 text-gray-400 hover:text-red-500 cursor-pointer"
                                      title="ลบ"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* VIEW 2: WEEK BOARD */}
                {otCalView === 'week' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2.5">
                    {otWeekDates.map((dIso, idx) => {
                      const dayOts = filteredOtRecords.filter((o) => o.date === dIso);
                      const isToday = dIso === todayStr;
                      const isSelected = dIso === otCalAnchor;
                      return (
                        <div
                          key={dIso}
                          onClick={() => setOtCalAnchor(dIso)}
                          className={`rounded-xl border p-2.5 min-h-[190px] flex flex-col gap-2 cursor-pointer transition-all ${
                            isSelected
                              ? 'border-teal-600 bg-teal-50/40 ring-1 ring-teal-500'
                              : 'border-gray-200 bg-white hover:border-teal-300'
                          }`}
                        >
                          <div className="flex items-center justify-between border-b pb-1.5">
                            <span className="text-[11px] font-bold text-gray-700">
                              {THAI_CALENDAR_WEEKDAYS[idx]} {parseIsoParts(dIso).d}
                            </span>
                            {isToday && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-teal-700 text-white">
                                วันนี้
                              </span>
                            )}
                          </div>
                          <div className="space-y-1.5 flex-1">
                            {dayOts.length === 0 ? (
                              <div className="text-[10px] text-gray-400 italic py-2">ไม่มีเวร</div>
                            ) : (
                              dayOts.map((o) => {
                                const isInTimeOT = o.shift === 'OT ในเวลาราชการ 08:00-16:00';
                                const parsedWork = parseOtWorkClinic(o.workClinic);
                                const effHrs = getEffectiveOtHours(o, settings?.stdHr);
                                return (
                                  <div
                                    key={o.id}
                                    className={`p-1.5 rounded-lg border text-[10px] space-y-0.5 ${
                                      isInTimeOT
                                        ? 'bg-cyan-50/90 border-cyan-200 text-cyan-950'
                                        : 'bg-purple-50/90 border-purple-200 text-purple-950'
                                    }`}
                                  >
                                    <div className="font-bold truncate">{o.staffName}</div>
                                    <div className="text-[9px] opacity-80 truncate">{o.shift}</div>
                                    <div className="font-bold text-teal-900 truncate">
                                      → {parsedWork.clinic}
                                      {parsedWork.amount === 0.5 ? ` (0.5)` : ''} • {formatOtHourNum(effHrs)} ชม.
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* VIEW 3: DAY ROSTER */}
                {otCalView === 'day' && (
                  <div>
                    {otDayItems.length === 0 ? (
                      <div className="py-10 text-center text-xs text-gray-400 border border-dashed border-gray-200 rounded-xl">
                        ไม่มีข้อมูลเวรนอกเวลาหรือปฏิบัติหน้าที่แทนในวันที่ {formatThaiShortDate(otCalAnchor)}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {otDayItems.map((o) => {
                          const isInTimeOT = o.shift === 'OT ในเวลาราชการ 08:00-16:00';
                          const origin = o.affiliation || o.homeClinic;
                          const parsedWork = parseOtWorkClinic(o.workClinic);
                          const effHrs = getEffectiveOtHours(o, settings?.stdHr);
                          const matchedStaff = !o.isExternal
                            ? staffList.find((s) => s.name.trim() === (o.staffName || '').trim())
                            : undefined;
                          const displayEmpCode =
                            getStaffEmployeeCode(matchedStaff) || (o.employeeCode || '').trim();
                          return (
                            <div
                              key={o.id}
                              className={`p-3.5 rounded-xl border flex items-start justify-between gap-3 ${
                                isInTimeOT ? 'bg-cyan-50/30 border-cyan-200' : 'bg-purple-50/30 border-purple-200'
                              }`}
                            >
                              <div className="space-y-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs font-bold text-gray-900">{o.staffName}</span>
                                  {displayEmpCode && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
                                      รหัส: {displayEmpCode}
                                    </span>
                                  )}
                                  {o.isExternal && (
                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                                      เฉพาะกิจนอก OPD
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-gray-600">
                                  {formatPositionLabel(o.position)} • สังกัด: {origin}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                      isInTimeOT
                                        ? 'bg-cyan-100 text-cyan-900 border-cyan-300'
                                        : 'bg-purple-100 text-purple-900 border-purple-300'
                                    }`}
                                  >
                                    {o.shift}
                                  </span>
                                  <span className="text-xs font-extrabold text-teal-800">
                                    ปฏิบัติงาน: {parsedWork.clinic}
                                    {parsedWork.amount === 0.5 && parsedWork.periodLabel
                                      ? ` (0.5 ${parsedWork.periodLabel})`
                                      : ''}
                                  </span>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                    {formatOtHourNum(effHrs)} ชม.
                                  </span>
                                </div>
                              </div>
                              {isAdmin && (
                                <div className="flex items-center gap-1 shrink-0">
                                  {onUpdateOT && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingOT({
                                          ...o,
                                          employeeCode: displayEmpCode || undefined,
                                        });
                                        setEditOtReason('');
                                        setEditOtReasonError('');
                                      }}
                                      className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-blue-600 cursor-pointer"
                                      title="แก้ไข"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeletingOT(o);
                                      setDeleteOtReason('');
                                      setDeleteOtReasonError('');
                                    }}
                                    className="p-1.5 rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-red-500 cursor-pointer"
                                    title="ลบ"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* VIEW 4: FULL TABLE LIST */}
                {otCalView === 'list' && (
                  filteredOtRecords.length === 0 ? (
                    <div className="py-8 text-center text-xs text-gray-400">
                      ยังไม่มีประวัติการบันทึกเวรนอกเวลาหรือปฏิบัติหน้าที่แทน
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 text-slate-700 font-semibold border-b">
                          <tr>
                            <th className="py-2.5 px-3">วันที่</th>
                            <th className="py-2.5 px-2">กะเวลา / ประเภท OT</th>
                            <th className="py-2.5 px-3">ชื่อ-สกุล</th>
                            <th className="py-2.5 px-2">ตำแหน่ง</th>
                            <th className="py-2.5 px-2">สังกัด / หน่วยงานต้นทาง</th>
                            <th className="py-2.5 px-2">ห้องตรวจที่ปฏิบัติงาน</th>
                            <th className="py-2.5 px-2 text-center">ชั่วโมง</th>
                            <th className="py-2.5 px-2 text-center">จัดการ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {filteredOtRecords.map((o) => {
                            const isInTimeOT = o.shift === 'OT ในเวลาราชการ 08:00-16:00';
                            const origin = o.affiliation || o.homeClinic;
                            const parsedWork = parseOtWorkClinic(o.workClinic);
                            const effHrs = getEffectiveOtHours(o, settings?.stdHr);
                            const matchedStaff = !o.isExternal
                              ? staffList.find((s) => s.name.trim() === (o.staffName || '').trim())
                              : undefined;
                            const displayEmpCode =
                              getStaffEmployeeCode(matchedStaff) || (o.employeeCode || '').trim();
                            return (
                              <tr key={o.id} className="hover:bg-slate-50/80">
                                <td className="py-2 px-3 text-gray-700 font-medium whitespace-nowrap">
                                  {formatThaiShortDate(o.date)}
                                </td>
                                <td className="py-2 px-2">
                                  <span
                                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                      isInTimeOT
                                        ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                                        : 'bg-purple-50 text-purple-800 border-purple-200'
                                    }`}
                                  >
                                    {o.shift}
                                  </span>
                                </td>
                                <td className="py-2 px-3">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-semibold text-gray-900">{o.staffName}</span>
                                    {displayEmpCode && (
                                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
                                        {displayEmpCode}
                                      </span>
                                    )}
                                    {o.isExternal && (
                                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                                        เฉพาะกิจนอก OPD
                                      </span>
                                    )}
                                  </div>
                                  {o.lastEditReason && (
                                    <div
                                      className="text-[10px] text-blue-700 bg-blue-50/80 border border-blue-100 rounded px-1.5 py-0.5 mt-1 inline-block"
                                      title={`แก้ไขโดย ${o.lastEditedBy || 'Admin'} เมื่อ ${o.lastEditedAt ? formatThaiDateTime(o.lastEditedAt) : '-'}`}
                                    >
                                      แก้ไข: {o.lastEditReason}
                                      {o.lastEditedAt ? ` • ${formatThaiDateTime(o.lastEditedAt)}` : ''}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2 px-2 text-gray-600">
                                  {formatPositionLabel(o.position)}
                                </td>
                                <td className="py-2 px-2 text-gray-600">{origin}</td>
                                <td className="py-2 px-2 font-semibold text-teal-800">
                                  {parsedWork.clinic}
                                  {parsedWork.amount === 0.5 && parsedWork.periodLabel && (
                                    <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                                      0.5 {parsedWork.periodLabel}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-2 text-center whitespace-nowrap">
                                  <span className="inline-block px-2 py-0.5 rounded text-[11px] font-extrabold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                    {formatOtHourNum(effHrs)} ชม.
                                  </span>
                                </td>
                                <td className="py-2 px-2 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    {isAdmin && onUpdateOT && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingOT({
                                            ...o,
                                            employeeCode: displayEmpCode || undefined,
                                          });
                                          setEditOtReason('');
                                          setEditOtReasonError('');
                                        }}
                                        className="text-gray-400 hover:text-blue-600 p-1 cursor-pointer"
                                        title="แก้ไขรายการและระบุเหตุผล (Admin)"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    {isAdmin ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setDeletingOT(o);
                                          setDeleteOtReason('');
                                          setDeleteOtReasonError('');
                                        }}
                                        className="text-gray-400 hover:text-red-500 p-1 cursor-pointer"
                                        title="ลบรายการและบันทึกเหตุผล (Admin)"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <span className="text-gray-300 text-[10px]">-</span>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

            {/* OT Audit Log Section */}
            {auditLogs.filter((a) => a.action === 'แก้ไขเวร OT' || a.action === 'ลบเวร OT').length > 0 && (
              <div className="pt-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowOtAuditLog((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-teal-700 cursor-pointer"
                >
                  <History className="w-3.5 h-3.5 text-teal-600" />
                  <span>
                    ประวัติการแก้ไข / ลบเวร OT (
                    {auditLogs.filter((a) => a.action === 'แก้ไขเวร OT' || a.action === 'ลบเวร OT').length}{' '}
                    รายการ)
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${showOtAuditLog ? 'rotate-180' : ''}`}
                  />
                </button>

                {showOtAuditLog && (
                  <div className="mt-2.5 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {auditLogs
                      .filter((a) => a.action === 'แก้ไขเวร OT' || a.action === 'ลบเวร OT')
                      .map((log) => (
                        <div
                          key={log.id}
                          className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] flex flex-col gap-1"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                                  log.action === 'ลบเวร OT'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-blue-100 text-blue-800'
                                }`}
                              >
                                {log.action}
                              </span>
                              <span className="font-bold text-gray-900">{log.targetName}</span>
                            </div>
                            <span className="text-[10px] text-gray-500">
                              {formatThaiDateTime(log.timestamp)}
                              {log.editedBy ? ` • โดย ${log.editedBy}` : ''}
                            </span>
                          </div>
                          <div className="text-gray-600">{log.summary}</div>
                          <div className="text-teal-900 font-semibold">
                            เหตุผล: {log.reason}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
              </div>
            );
          })()}
        </div>
      )}

      {/* --- SUB-TAB 3: FISCAL YEAR SUMMARY (12 MONTHS / MONTHLY / CLINIC / INDIVIDUAL) --- */}
      {activeSubTab === 'fiscalSummary' && (
        <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4 print:border-none print:shadow-none print:p-0">
          {/* Header Title & Actions (Hidden on Print) */}
          <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b pb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Award className="w-5 h-5 text-teal-700" />
                <span>3. สรุปวันทำงานและเวรนอกเวลา (In-Time & OT Analytics)</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                เลือกดูข้อมูลจำนวนวันทำงานทั้งในเวลาและนอกเวลา (เวร OT) แยกรายบุคคล หน่วยงาน และรายเดือน
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                <Calendar className="w-3.5 h-3.5 text-teal-700" />
                <span>ปีงบประมาณ:</span>
                <select
                  value={selectedFiscalYear}
                  onChange={(e) => setSelectedFiscalYear(Number(e.target.value))}
                  className="bg-transparent font-bold text-teal-900 outline-none cursor-pointer"
                >
                  <option value={2569}>2569 (ต.ค. 68 - ก.ย. 69)</option>
                  <option value={2570}>2570 (ต.ค. 69 - ก.ย. 70)</option>
                  <option value={2571}>2571 (ต.ค. 70 - ก.ย. 71)</option>
                </select>
              </div>

              <button
                type="button"
                onClick={exportFiscalSummaryCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>ส่งออก CSV ตามตัวกรอง</span>
              </button>
            </div>
          </div>

          {/* Sub-view Switcher inside Summary */}
          <div className="no-print flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200/80 rounded-xl p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSummaryReportMode('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  summaryReportMode === 'ALL'
                    ? 'bg-teal-700 text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:text-teal-800 border border-gray-200'
                }`}
              >
                แสดงทั้งหมด (วันทำงาน + รายงานการลา)
              </button>
              <button
                type="button"
                onClick={() => setSummaryReportMode('LEAVE_REPORT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  summaryReportMode === 'LEAVE_REPORT'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:text-amber-800 border border-gray-200'
                }`}
              >
                รายงานสรุปวันลารายบุคคล (แบบฟอร์ม)
              </button>
              <button
                type="button"
                onClick={() => setSummaryReportMode('WORK_OT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  summaryReportMode === 'WORK_OT'
                    ? 'bg-blue-700 text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:text-blue-800 border border-gray-200'
                }`}
              >
                ตารางวันทำงานในเวลา &amp; เวร OT
              </button>
            </div>
          </div>

          {/* Interactive Filters Grid (Hidden on Print) */}
          <div className="no-print bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <Filter className="w-4 h-4 text-teal-700" />
              <span>ตัวกรองการแสดงผล (Filters)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {/* 1. Shift Filter */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-teal-700" />
                  <span>ประเภทเวลาปฏิบัติงาน:</span>
                </label>
                <select
                  value={shiftFilter}
                  onChange={(e) => setShiftFilter(e.target.value as 'ALL' | 'IN_TIME' | 'OT')}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-medium text-gray-900 focus:ring-1 focus:ring-teal-500"
                >
                  <option value="ALL">ทั้งหมด (ในเวลา + นอกเวลา)</option>
                  <option value="IN_TIME">เฉพาะในเวลา (08:00 - 16:00)</option>
                  <option value="OT">เฉพาะนอกเวลา (เวร OT)</option>
                </select>
              </div>

              {/* 2. Clinic Filter */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <Building className="w-3 h-3 text-teal-700" />
                  <span>หน่วยงาน / คลินิกสังกัด:</span>
                </label>
                <select
                  value={clinicFilter}
                  onChange={(e) => setClinicFilter(e.target.value)}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-medium text-gray-900 focus:ring-1 focus:ring-teal-500"
                >
                  <option value="ALL">-- ทุกหน่วยงาน (ทุกคลินิก OPD) --</option>
                  {allClinics.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Position Filter (for Unit Cost breakdown) */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <Users className="w-3 h-3 text-teal-700" />
                  <span>ตำแหน่ง (สำหรับ Unit Cost):</span>
                </label>
                <select
                  value={fiscalPositionFilter}
                  onChange={(e) => setFiscalPositionFilter(e.target.value)}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-medium text-gray-900 focus:ring-1 focus:ring-teal-500"
                >
                  <option value="ALL">-- ทุกตำแหน่งวิชาชีพ --</option>
                  <option value="DAILY_WAGE_ALL">รวมทุกตำแหน่ง (จ้างรายวัน ทั้งหมด)</option>
                  {ALL_POSITIONS.map((p) => (
                    <option key={p} value={p}>
                      {POSITION_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. Month Filter */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-teal-700" />
                  <span>ช่วงเวลา / รายเดือน:</span>
                </label>
                <select
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-medium text-gray-900 focus:ring-1 focus:ring-teal-500"
                >
                  <option value="ALL">สรุปทั้งปีงบประมาณ (12 เดือน ต.ค. - ก.ย.)</option>
                  {fiscalMonths.map((m) => (
                    <option key={m.key} value={m.key}>
                      รายเดือน: {m.fullName} ({m.name})
                    </option>
                  ))}
                </select>
              </div>

              {/* 5. Individual Staff Filter */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <User className="w-3 h-3 text-teal-700" />
                  <span>เลือกดูเฉพาะรายบุคคล:</span>
                </label>
                <select
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-medium text-gray-900 focus:ring-1 focus:ring-teal-500"
                >
                  <option value="ALL">-- บุคลากรทุกคน ({summaryEligibleStaff.length} คน) --</option>
                  {summaryEligibleStaff.map((s) => (
                    <option key={s.staffId} value={s.staffId}>
                      {s.name} ({formatPositionLabel(s.position)} - {s.homeClinic})
                      {s.status !== 'Active' ? ` [${s.status}]` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quick Search Box & Reset Filter Button */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-slate-200/60">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="พิมพ์ค้นหาชื่อเจ้าหน้าที่, ตำแหน่ง, คลินิก..."
                  value={summarySearchQuery}
                  onChange={(e) => setSummarySearchQuery(e.target.value)}
                  className="w-full text-xs rounded-lg border-gray-200 pl-8 pr-3 py-1.5 border bg-white"
                />
              </div>

              <div className="flex items-center gap-2">
                {(shiftFilter !== 'ALL' ||
                  clinicFilter !== 'ALL' ||
                  fiscalPositionFilter !== 'ALL' ||
                  staffFilter !== 'ALL' ||
                  monthFilter !== 'ALL' ||
                  summarySearchQuery) && (
                  <button
                    type="button"
                    onClick={() => {
                      setShiftFilter('ALL');
                      setClinicFilter('ALL');
                      setFiscalPositionFilter('ALL');
                      setStaffFilter('ALL');
                      setMonthFilter('ALL');
                      setSummarySearchQuery('');
                    }}
                    className="text-xs text-red-600 hover:text-red-700 font-semibold cursor-pointer"
                  >
                    ล้างตัวกรองทั้งหมด
                  </button>
                )}
                <span className="text-xs text-gray-500">
                  พบข้อมูล: <strong>{filteredSummaryData.length}</strong> คน
                </span>
              </div>
            </div>
          </div>

          {/* KPI Metrics Cards (Hidden on Print) */}
          <div className="no-print grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-2xl p-3.5 border border-teal-200/70 shadow-2xs">
              <span className="text-[11px] font-bold text-teal-800 block">
                {monthFilter === 'ALL' ? 'รวมวันทำงานทั้งสิ้น (ปีงบ)' : 'รวมวันทำงานในเดือนนี้'}
              </span>
              <div className="text-2xl font-black text-teal-950 mt-1">
                {summaryKpis.totalWork} <span className="text-xs font-normal text-teal-700">วัน</span>
              </div>
              <span className="text-[10px] text-teal-600">ในเวลา + นอกเวลา</span>
            </div>

            <div className="bg-white rounded-2xl p-3.5 border border-blue-200 shadow-2xs">
              <span className="text-[11px] font-bold text-blue-800 block">
                วันทำงานในเวลา (08:00-16:00)
              </span>
              <div className="text-2xl font-black text-blue-900 mt-1">
                {summaryKpis.totalInTime}{' '}
                <span className="text-xs font-normal text-blue-600">วัน</span>
              </div>
              <span className="text-[10px] text-blue-500">วันราชการ (จ.-ศ. หักวันหยุด) - วันลา</span>
            </div>

            <div className="bg-white rounded-2xl p-3.5 border border-purple-200 shadow-2xs">
              <span className="text-[11px] font-bold text-purple-800 block">เวรนอกเวลา (OT)</span>
              <div className="text-2xl font-black text-purple-900 mt-1">
                {summaryKpis.totalOT}{' '}
                <span className="text-xs font-normal text-purple-600">เวร</span>
              </div>
              <span className="text-[10px] text-purple-500">เวรเย็น, วันหยุด & OT ในเวลา</span>
            </div>

            <div className="bg-white rounded-2xl p-3.5 border border-amber-200 shadow-2xs">
              <span className="text-[11px] font-bold text-amber-800 block">วันลาสะสม</span>
              <div className="text-2xl font-black text-amber-900 mt-1">
                {summaryKpis.totalLeaves}{' '}
                <span className="text-xs font-normal text-amber-600">วัน</span>
              </div>
              <span className="text-[10px] text-amber-500">ลาป่วย/ลากิจ/ลาพักผ่อน (ไม่รวมอบรม)</span>
            </div>
          </div>

          {/* VIEW A & B: Work & OT Summary Grid */}
          {summaryReportMode !== 'LEAVE_REPORT' && (
            <div className={printTarget === 'LEAVE_REPORT' ? 'no-print' : ''}>
              {monthFilter === 'ALL' ? (
            <div className="space-y-1.5">
              {shiftFilter === 'ALL' && (
                <div className="no-print text-[11px] text-teal-800 bg-teal-50/70 border border-teal-200/70 rounded-lg px-3 py-1.5 flex items-center justify-between">
                  <span>
                    รูปแบบตัวเลขในตาราง 12 เดือน: <strong>วันทำงานในเวลา / เวรนอกเวลา (OT)</strong> (เช่น 18.5/0 หมายถึง ในเวลา 18.5 วัน / OT 0 เวร)
                  </span>
                </div>
              )}
              <div className="overflow-x-auto border border-gray-200 rounded-xl print:border-none print:overflow-visible">
                <div className="print-landscape-sheet w-[1050px] max-w-full print:w-full mx-auto bg-white">
                  <table className="w-full table-fixed text-left text-[11px] print:text-[8px] print-fit-table">
                    <colgroup>
                      <col className="w-[116px]" />
                      <col className="w-[78px]" />
                      <col className="w-[74px]" />
                      {fiscalMonths.map((m) => (
                        <col key={m.key} />
                      ))}
                      <col className="w-[42px]" />
                      <col className="w-[42px]" />
                      <col className="w-[38px]" />
                      <col className="w-[48px]" />
                    </colgroup>
                    <thead className="bg-slate-100 text-slate-800 font-bold border-b text-[10.5px] print:text-[7.5px]">
                      <tr>
                        <th className="py-2 px-1.5 print:px-1 print:py-1">ชื่อ - นามสกุล</th>
                        <th className="py-2 px-1 text-center print:px-0.5 print:py-1">ตำแหน่ง</th>
                        <th className="py-2 px-1 print:px-0.5 print:py-1">หน่วยงานสังกัด</th>
                        {fiscalMonths.map((m) => {
                          const ceEnd = selectedFiscalYear - 543;
                          const mYear = m.yearOffset === -1 ? ceEnd - 1 : ceEnd;
                          const mLast = new Date(mYear, Number(m.key), 0).getDate();
                          const mGovDays = countGovernmentWorkdaysInRange(
                            `${mYear}-${m.key}-01`,
                            `${mYear}-${m.key}-${String(mLast).padStart(2, '0')}`,
                            customHolidays
                          );
                          return (
                            <th
                              key={m.key}
                              className="py-2 px-0.5 text-center bg-slate-200/50 print:px-0.5 print:py-1"
                              title={`${m.fullName} ${mYear + 543}: วันราชการ ${mGovDays} วัน (จ.-ศ. หักวันหยุด)`}
                            >
                              <div>{m.name}</div>
                              <div className="text-[8.5px] font-medium text-slate-500 print:text-[6.5px]">
                                ({mGovDays}ว)
                              </div>
                            </th>
                          );
                        })}
                        <th className="py-2 px-1 text-center bg-blue-50 text-blue-900 leading-tight print:px-0.5 print:py-1">
                          ในเวลา
                        </th>
                        <th className="py-2 px-1 text-center bg-purple-50 text-purple-900 leading-tight print:px-0.5 print:py-1">
                          เวร OT
                        </th>
                        <th className="py-2 px-1 text-center bg-amber-50 text-amber-900 leading-tight print:px-0.5 print:py-1">
                          วันลา
                        </th>
                        <th className="py-2 px-1 text-center bg-teal-700 text-white font-extrabold leading-tight print:px-0.5 print:py-1">
                          รวมทั้งสิ้น
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredSummaryData.length === 0 ? (
                        <tr>
                          <td colSpan={19} className="py-8 text-center text-gray-400">
                            ไม่พบข้อมูลตามตัวกรองที่เลือก
                          </td>
                        </tr>
                      ) : (
                        filteredSummaryData.map((item, idx) => {
                          const { staff, monthDetails, totalInTime, totalOT, totalLeaves, grandTotal } =
                            item;
                          return (
                            <tr
                              key={staff.staffId}
                              className={
                                idx % 2 === 0
                                  ? 'bg-white hover:bg-slate-50'
                                  : 'bg-slate-50/50 hover:bg-slate-100/60'
                              }
                            >
                              <td className="py-1.5 px-1.5 font-semibold text-gray-900 whitespace-normal break-words leading-tight print:px-1 print:py-1">
                                {staff.name}
                              </td>
                              <td className="py-1.5 px-1 text-center print:px-0.5 print:py-1">
                                <span
                                  className={`inline-block px-1 py-0.5 rounded text-[9.5px] font-bold whitespace-normal break-words leading-tight print:px-0.5 print:text-[7px] ${
                                    staff.position === 'HN'
                                      ? 'bg-purple-100 text-purple-800'
                                      : staff.position === 'RN'
                                        ? 'bg-blue-100 text-blue-800'
                                        : staff.position === 'PN'
                                          ? 'bg-teal-100 text-teal-800'
                                          : staff.position === 'NA' || staff.position === 'PCA'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : staff.position === 'Clerk (Referral)'
                                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                              : isDailyWagePosition(staff.position)
                                                ? 'bg-sky-100 text-sky-800'
                                                : 'bg-gray-100 text-gray-800'
                                  }`}
                                >
                                  {formatPositionLabel(staff.position)}
                                </span>
                              </td>
                              <td className="py-1.5 px-1 text-gray-600 whitespace-normal break-words leading-tight print:px-0.5 print:py-1">
                                {staff.homeClinic}
                              </td>

                              {/* 12 Month columns */}
                              {fiscalMonths.map((m) => {
                                const detail = monthDetails[m.key];
                                const inTime = detail?.inTime || 0;
                                const ot = detail?.ot || 0;
                                const val =
                                  shiftFilter === 'IN_TIME'
                                    ? inTime
                                    : shiftFilter === 'OT'
                                      ? ot
                                      : inTime + ot;
                                const hasAnyWork = shiftFilter === 'ALL' ? inTime > 0 || ot > 0 : val > 0;

                                return (
                                  <td
                                    key={m.key}
                                    className={`py-1.5 px-0.5 text-center text-[10px] print:text-[7.5px] print:px-0.5 print:py-1 ${
                                      hasAnyWork ? 'font-bold text-teal-950' : 'text-gray-300'
                                    }`}
                                    title={`ในเวลา: ${inTime} วัน, OT: ${ot} เวร, ลา: ${detail?.leaves || 0} วัน`}
                                  >
                                    {hasAnyWork ? (
                                      shiftFilter === 'ALL' ? (
                                        <span className="font-bold text-teal-950 whitespace-nowrap">
                                          {inTime}/{ot}
                                        </span>
                                      ) : (
                                        val
                                      )
                                    ) : (
                                      '-'
                                    )}
                                  </td>
                                );
                              })}

                              <td className="py-1.5 px-1 text-center font-bold text-blue-900 bg-blue-50/50 print:px-0.5 print:py-1">
                                {totalInTime}
                              </td>
                              <td className="py-1.5 px-1 text-center font-bold text-purple-900 bg-purple-50/50 print:px-0.5 print:py-1">
                                {totalOT}
                              </td>
                              <td className="py-1.5 px-1 text-center text-amber-800 bg-amber-50/50 print:px-0.5 print:py-1">
                                {totalLeaves > 0 ? totalLeaves : '-'}
                              </td>
                              <td className="py-1.5 px-1 text-center font-black text-xs print:text-[8.5px] text-teal-950 bg-teal-50 print:px-0.5 print:py-1">
                                {shiftFilter === 'IN_TIME'
                                  ? totalInTime
                                  : shiftFilter === 'OT'
                                    ? totalOT
                                    : grandTotal}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* VIEW B: Monthly Detailed Table */
            <div className="overflow-x-auto border border-gray-200 rounded-xl print:border-none print:overflow-visible">
              <div className="print-landscape-sheet w-full max-w-[1050px] print:max-w-full mx-auto bg-white">
                <table className="w-full table-fixed text-left text-xs print:text-[8.5px] print-fit-table">
                  <colgroup>
                    <col className="w-[16%]" />
                    <col className="w-[12%]" />
                    <col className="w-[13%]" />
                    <col className="w-[9%]" />
                    <col className="w-[9%]" />
                    <col className="w-[8%]" />
                    <col className="w-[9%]" />
                    <col className="w-[24%]" />
                  </colgroup>
                  <thead className="bg-slate-100 text-slate-800 font-bold border-b text-[11px] print:text-[8px]">
                  <tr>
                    <th className="py-2.5 px-3 whitespace-nowrap">ชื่อ - นามสกุล</th>
                    <th className="py-2.5 px-2 text-center whitespace-nowrap">ตำแหน่ง</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">หน่วยงานสังกัด</th>
                    <th className="py-2.5 px-3 text-center bg-blue-50 text-blue-950 whitespace-nowrap font-bold">
                      วันทำงานในเวลา
                    </th>
                    <th className="py-2.5 px-3 text-center bg-purple-50 text-purple-950 whitespace-nowrap font-bold">
                      เวรนอกเวลา (OT)
                    </th>
                    <th className="py-2.5 px-3 text-center bg-amber-50 text-amber-950 whitespace-nowrap font-bold">
                      วันลา (วัน)
                    </th>
                    <th className="py-2.5 px-3 text-center bg-teal-100 text-teal-950 whitespace-nowrap font-extrabold">
                      รวมวันทำงานสุทธิ
                    </th>
                    <th className="py-2.5 px-3 whitespace-nowrap">
                      คลินิกที่ขึ้นเวรนอกเวลา & ประวัติวันลา
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSummaryData.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-400">
                        ไม่พบข้อมูลตามตัวกรองที่เลือกในเดือนนี้
                      </td>
                    </tr>
                  ) : (
                    filteredSummaryData.map((item, idx) => {
                      const { staff, monthDetails } = item;
                      const d = monthDetails[monthFilter] || {
                        inTime: 0,
                        ot: 0,
                        leaves: 0,
                        total: 0,
                        otClinics: [],
                        leaveTypes: [],
                      };
                      return (
                        <tr
                          key={staff.staffId}
                          className={
                            idx % 2 === 0
                              ? 'bg-white hover:bg-slate-50'
                              : 'bg-slate-50/50 hover:bg-slate-100/60'
                          }
                        >
                          <td className="py-2 px-2 font-semibold text-gray-900 whitespace-normal break-words leading-tight">
                            {staff.name}
                          </td>
                          <td className="py-2 px-1.5 text-center">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-normal break-words leading-tight ${
                                staff.position === 'HN'
                                  ? 'bg-purple-100 text-purple-800'
                                  : staff.position === 'RN'
                                    ? 'bg-blue-100 text-blue-800'
                                    : staff.position === 'PN'
                                      ? 'bg-teal-100 text-teal-800'
                                      : staff.position === 'NA' || staff.position === 'PCA'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : staff.position === 'Clerk (Referral)'
                                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                          : isDailyWagePosition(staff.position)
                                            ? 'bg-sky-100 text-sky-800'
                                            : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {formatPositionLabel(staff.position)}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-gray-600 whitespace-normal break-words leading-tight">
                            {staff.homeClinic}
                          </td>
                          <td className="py-2 px-2 text-center font-bold text-blue-900 bg-blue-50/30">
                            {d.inTime > 0 ? `${d.inTime} วัน` : '-'}
                          </td>
                          <td className="py-2 px-2 text-center font-bold text-purple-900 bg-purple-50/30">
                            {d.ot > 0 ? `${d.ot} เวร` : '-'}
                          </td>
                          <td className="py-2 px-2 text-center font-semibold text-amber-800 bg-amber-50/30">
                            {d.leaves > 0 ? `${d.leaves} วัน` : '-'}
                          </td>
                          <td className="py-2 px-2 text-center font-black text-sm text-teal-950 bg-teal-50">
                            {shiftFilter === 'IN_TIME'
                              ? d.inTime
                              : shiftFilter === 'OT'
                                ? d.ot
                                : d.total}{' '}
                            วัน
                          </td>
                          <td className="py-2 px-2 text-[11px] text-gray-600 break-words">
                            <div className="space-y-0.5">
                              {d.otClinics.length > 0 && (
                                <div className="text-purple-800 font-medium">
                                  ขึ้นเวร: {d.otClinics.join(', ')}
                                </div>
                              )}
                              {d.leaveTypes.length > 0 && (
                                <div className="text-amber-800">
                                  การลา: {d.leaveTypes.join(', ')}
                                </div>
                              )}
                              {d.otClinics.length === 0 && d.leaveTypes.length === 0 && (
                                <span className="text-gray-400">ปฏิบัติงานปกติประจำหน่วยงาน</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>
            </div>
              )}
            </div>
          )}

          {/* OFFICIAL LEAVE SUMMARY REPORT (Image 4 Form + Leave Reason & Thai Date Range) */}
          {summaryReportMode !== 'WORK_OT' && (
            <div className="space-y-3 pt-4 border-t border-gray-200 print:border-none print:pt-0">
              <div className="no-print flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-amber-600" />
                    <span>รายงานสรุปวันลาประจำหน่วยงาน (แยกประเภทการลา พร้อมเหตุผลและวันที่ลา)</span>
                  </h4>
                  <p className="text-[11px] text-gray-500">
                    อ้างอิงตามช่วงเวลาและตัวกรองด้านบน • ช่วงข้อมูล: {leaveReportPeriodLabel}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 bg-slate-100 hover:bg-slate-200/70 px-2.5 py-1.5 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyStaffWithLeaves}
                      onChange={(e) => setOnlyStaffWithLeaves(e.target.checked)}
                      className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>แสดงเฉพาะผู้ที่มีประวัติลา</span>
                  </label>

                  <button
                    type="button"
                    onClick={exportLeaveReportCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-2xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>ส่งออก CSV รายงานการลา</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportLeaveJpeg}
                    disabled={isExportingLeaveJpeg}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white rounded-lg shadow-2xs cursor-pointer"
                  >
                    <ImageDown className="w-3.5 h-3.5" />
                    <span>{isExportingLeaveJpeg ? 'กำลังสร้างรูป...' : 'บันทึกเป็น .JPEG'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePrintLeaveReport}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg shadow-2xs cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>พิมพ์รายงาน / PDF</span>
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto border border-gray-300 rounded-xl print:border-none print:overflow-visible">
                <div
                  ref={leaveReportRef}
                  className="print-landscape-sheet w-[1030px] max-w-full print:w-full mx-auto bg-white p-4 sm:p-5 space-y-3 print:p-0 print:space-y-2"
                >
                  <div className="text-center space-y-1 border-b border-gray-300 pb-2.5 print:pb-2">
                    <div className="text-sm sm:text-base font-extrabold text-gray-900 print:text-sm">
                      ชื่อหน่วยงาน : หน่วยการพยาบาลผู้ป่วยนอก
                    </div>
                    <div className="text-xs text-gray-600 font-medium print:text-[10px]">
                      รายงานสรุปวันลาบุคลากร • {leaveReportPeriodLabel}
                      {clinicFilter !== 'ALL' ? ` • คลินิก: ${clinicFilter}` : ''}
                    </div>
                  </div>

                  <div className="w-full">
                    <table className="w-full table-fixed text-[11px] border-collapse border border-gray-400 print:text-[8px] print-fit-table">
                      <colgroup>
                        <col className="w-[32px]" />
                        <col className="w-[86px]" />
                        <col className="w-[92px]" />
                        <col className="w-[88px]" />
                        {leaveReportColumns.allCols.map((col) => (
                          <col key={col.type} className="w-[46px]" />
                        ))}
                        <col className="w-[46px]" />
                        <col />
                      </colgroup>
                      <thead className="bg-slate-100 text-gray-900 font-bold">
                        <tr>
                          <th className="border border-gray-400 py-1.5 px-1 text-center print:px-0.5 print:py-1">
                            ลำดับ
                          </th>
                          <th className="border border-gray-400 py-1.5 px-1.5 text-left print:px-1 print:py-1">
                            ชื่อ
                          </th>
                          <th className="border border-gray-400 py-1.5 px-1.5 text-left print:px-1 print:py-1">
                            สกุล
                          </th>
                          <th className="border border-gray-400 py-1.5 px-1.5 text-center print:px-1 print:py-1">
                            ตำแหน่ง
                          </th>
                          {leaveReportColumns.allCols.map((col) => (
                            <th
                              key={col.type}
                              className="border border-gray-400 py-1.5 px-0.5 text-center leading-tight break-words print:px-0.5 print:py-1"
                              title={col.type}
                            >
                              {col.shortLabel}
                            </th>
                          ))}
                          <th className="border border-gray-400 py-1.5 px-0.5 text-center bg-amber-50 leading-tight print:px-0.5 print:py-1">
                            รวมวันลา
                          </th>
                          <th className="border border-gray-400 py-1.5 px-2 text-left leading-tight print:px-1 print:py-1">
                            เหตุผลการลาและวันที่ลา
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaveReportData.rows.length === 0 ? (
                          <tr>
                            <td
                              colSpan={6 + leaveReportColumns.allCols.length}
                              className="border border-gray-400 py-8 text-center text-gray-400"
                            >
                              ไม่พบข้อมูลการลาในตัวกรองที่เลือก
                            </td>
                          </tr>
                        ) : (
                          leaveReportData.rows.map((row, idx) => (
                            <tr
                              key={row.id}
                              className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}
                            >
                              <td className="border border-gray-400 py-1.5 px-1 text-center text-gray-700 font-medium print:px-0.5 print:py-1">
                                {idx + 1}
                              </td>
                              <td className="border border-gray-400 py-1.5 px-1.5 text-gray-900 font-semibold whitespace-normal break-words leading-tight print:px-1 print:py-1">
                                {row.firstName}
                              </td>
                              <td className="border border-gray-400 py-1.5 px-1.5 text-gray-900 whitespace-normal break-words leading-tight print:px-1 print:py-1">
                                {row.lastName}
                              </td>
                              <td className="border border-gray-400 py-1.5 px-1 text-center font-semibold text-gray-800 whitespace-normal break-words leading-tight print:px-1 print:py-1">
                                {formatPositionLabel(row.position)}
                              </td>
                              {leaveReportColumns.allCols.map((col) => {
                                const val = row.daysByType[col.type] || 0;
                                return (
                                  <td
                                    key={col.type}
                                    className={`border border-gray-400 py-1.5 px-0.5 text-center print:px-0.5 print:py-1 ${
                                      val > 0 ? 'font-bold text-amber-900 bg-amber-50/40' : 'text-gray-400'
                                    }`}
                                  >
                                    {val > 0 ? val : ''}
                                  </td>
                                );
                              })}
                              <td className="border border-gray-400 py-1.5 px-0.5 text-center font-extrabold text-amber-950 bg-amber-50/60 print:px-0.5 print:py-1">
                                {row.totalLeaveDays > 0 ? row.totalLeaveDays : ''}
                              </td>
                              <td className="border border-gray-400 py-1.5 px-2 text-[10.5px] text-gray-800 break-words leading-tight print:px-1 print:py-1 print:text-[8px]">
                                {row.details.length > 0 ? (
                                  <ul className="space-y-0.5 list-disc list-outside pl-3">
                                    {row.details.map((d, dIdx) => (
                                      <li key={dIdx}>{d}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="text-gray-300">-</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      {leaveReportData.rows.length > 0 && (
                        <tfoot className="bg-slate-100 font-bold text-gray-900">
                          <tr>
                            <td colSpan={4} className="border border-gray-400 py-1.5 px-2 text-right print:px-1 print:py-1">
                              รวมทั้งหมด ({leaveReportData.rows.length} คน)
                            </td>
                            {leaveReportColumns.allCols.map((col) => (
                              <td key={col.type} className="border border-gray-400 py-1.5 px-0.5 text-center print:px-0.5 print:py-1">
                                {leaveReportData.totalsByType[col.type] > 0
                                  ? leaveReportData.totalsByType[col.type]
                                  : '-'}
                              </td>
                            ))}
                            <td className="border border-gray-400 py-1.5 px-0.5 text-center bg-amber-100 text-amber-950 font-extrabold print:px-0.5 print:py-1">
                              {leaveReportData.grandTotalDays}
                            </td>
                            <td className="border border-gray-400 py-1.5 px-2 text-[10.5px] text-gray-600 font-normal print:px-1 print:py-1 print:text-[8px]">
                              หน่วยนับ: วันทำการ/วันลา
                            </td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>

                  <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-6 text-center text-xs print:text-[10px] text-gray-700 print:break-inside-avoid">
                    <div>
                      <p className="mb-8">ผู้จัดทำรายงาน</p>
                      <p>ลงชื่อ......................................................</p>
                      <p className="mt-1">(......................................................)</p>
                    </div>
                    <div>
                      <p className="mb-8">ผู้ตรวจทาน / รับรองข้อมูล</p>
                      <p>ลงชื่อ......................................................</p>
                      <p className="mt-1">(หัวหน้าหน่วยการพยาบาลผู้ป่วยนอก)</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- SUB-TAB 4: OT PAYMENT EVIDENCE REPORT (IMAGE 4 OFFICIAL FORM) --- */}
      {activeSubTab === 'otPayReport' && (
        <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4 print:border-none print:shadow-none print:p-0">
          {/* Header & Export Controls (Hidden on Print) */}
          <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b pb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <ReceiptText className="w-5 h-5 text-indigo-700" />
                <span>4. หลักฐานการจ่ายเงินค่าตอบแทนการปฏิบัติงานคลินิกนอกเวลาราชการ</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                สรุปชั่วโมงปฏิบัติงาน OT รายวัน คำนวณค่าตอบแทน หักภาษี 5% และคงเหลือ พร้อมคำอ่านจำนวนเงินภาษาไทย
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={exportOtPayReportCsv}
                disabled={otPaymentReportData.rows.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg shadow-2xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>ส่งออก CSV</span>
              </button>

              <button
                type="button"
                onClick={handleExportOtPayJpeg}
                disabled={isExportingOtPayJpeg}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white rounded-lg shadow-2xs cursor-pointer"
              >
                <ImageDown className="w-3.5 h-3.5" />
                <span>{isExportingOtPayJpeg ? 'กำลังสร้างรูป...' : 'บันทึกเป็น .JPEG'}</span>
              </button>

              <button
                type="button"
                onClick={handlePrintOtPayReport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg shadow-2xs cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>พิมพ์ / PDF (A4 แนวนอน)</span>
              </button>
            </div>
          </div>

          {/* Filter & Form Overrides Bar (Hidden on Print) */}
          <div className="no-print bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">ประจำเดือน:</label>
                <select
                  value={otPayMonth}
                  onChange={(e) => setOtPayMonth(Number(e.target.value))}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-semibold text-gray-900"
                >
                  {THAI_MONTHS.map((mName, idx) => (
                    <option key={mName} value={idx + 1}>
                      {mName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">ปี พ.ศ.:</label>
                <select
                  value={otPayYearBE}
                  onChange={(e) => setOtPayYearBE(Number(e.target.value))}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-semibold text-gray-900"
                >
                  {otPayYearBEOptions.map((yBE) => (
                    <option key={yBE} value={yBE}>
                      พ.ศ. {yBE}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">ห้องตรวจที่ปฏิบัติงาน:</label>
                <select
                  value={otPayClinic}
                  onChange={(e) => setOtPayClinic(e.target.value)}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-semibold text-teal-950"
                >
                  <option value="ALL">-- ทุกห้องตรวจ OPD --</option>
                  {otPayClinicOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">ประเภทเวร OT:</label>
                <select
                  value={otPayShiftScope}
                  onChange={(e) =>
                    setOtPayShiftScope(e.target.value as 'OUT_TIME' | 'ALL_OT' | WorkShift)
                  }
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-semibold text-gray-900"
                >
                  <option value="OUT_TIME">คลินิกนอกเวลาราชการ (เย็น + วันหยุด)</option>
                  <option value="ALL_OT">ทุกประเภท OT (รวมปฏิบัติแทนในเวลา)</option>
                  {OT_SHIFTS.map((sh) => (
                    <option key={sh.value} value={sh.value}>
                      เฉพาะ: {sh.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200/70">
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                  ค้นหาชื่อ / รหัสบุคลากร:
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2" />
                  <input
                    type="text"
                    value={otPaySearch}
                    onChange={(e) => setOtPaySearch(e.target.value)}
                    placeholder="พิมพ์ชื่อ หรือ รหัส..."
                    className="w-full text-xs rounded-lg border border-gray-300 pl-8 pr-2.5 py-1.5 bg-white"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block text-[11px] font-bold text-gray-700">
                    Cost Center ({otPayClinic === 'ALL' ? 'ค่าตั้งต้นทุกหน่วย' : `ประจำ${otPayClinic}`}):
                  </label>
                  {unitCostCenterSavedBadge && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                      {unitCostCenterSavedBadge}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={otPayCostCenterOverride}
                    onChange={(e) => setOtPayCostCenterOverride(e.target.value)}
                    placeholder={`ค่าตั้งต้น: ${savedCostCenterForSelectedUnit}`}
                    className="flex-1 min-w-0 text-xs rounded-lg border border-gray-300 px-2.5 py-1.5 bg-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleSaveCurrentUnitCostCenter}
                    disabled={isSavingUnitCostCenter}
                    title="บันทึก Cost Center ของหน่วยนี้ไว้ใช้งานครั้งถัดไป (ไม่ต้องใช้ Admin PIN)"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-[11px] font-bold shrink-0 cursor-pointer shadow-2xs"
                  >
                    <Save className="w-3 h-3" />
                    <span>{isSavingUnitCostCenter ? 'กำลังจำ...' : 'จำค่าของหน่วย'}</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1">
                  ชื่อผู้ควบคุม (หัวหน้าหน่วยฯ):
                </label>
                <input
                  type="text"
                  value={otPayControllerOverride}
                  onChange={(e) => setOtPayControllerOverride(e.target.value)}
                  placeholder={`ค่าตั้งต้น: ${resolvedOtPayControllerName}`}
                  className="w-full text-xs rounded-lg border border-gray-300 px-2.5 py-1.5 bg-white"
                />
              </div>
            </div>

            {otPaymentReportData.missingCodeCount > 0 && (
              <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                หมายเหตุ: พบรายชื่อที่ยังไม่มีรหัสบุคลากร {otPaymentReportData.missingCodeCount} ราย — สามารถเพิ่มรหัสบุคลากรและปรับอัตราค่าตอบแทน OT ได้ที่{' '}
                <strong>เมนู 5: จัดการบุคลากร &amp; ตั้งค่า</strong>
              </div>
            )}
          </div>

          {/* Official Printable / JPEG OT Payment Evidence Form (Fits A4 Landscape Without Clipping) */}
          <div className="overflow-x-auto border border-gray-200 rounded-xl print:border-none print:overflow-visible">
            <div
              ref={otPaymentReportRef}
              className="print-landscape-sheet w-[1040px] max-w-full print:w-full mx-auto bg-white p-3.5 sm:p-4 text-black font-sarabun print:p-0"
            >
              {/* Top Right Cost Center */}
              <div className="text-right text-[11.5px] font-bold leading-tight mb-0.5 print:text-[10px]">
                Cost Center {resolvedOtPayCostCenter}
              </div>

              {/* Centered Header Titles */}
              <div className="text-center space-y-0.5 mb-2">
                <div className="text-[14px] font-bold leading-snug print:text-[12px]">
                  หลักฐานการจ่ายเงินค่าตอบแทนการปฏิบัติงานคลินิกนอกเวลาราชการ
                </div>
                <div className="text-[13px] font-bold leading-snug print:text-[11px]">
                  <span>หน่วยงาน การพยาบาลผู้ป่วยนอก {formatOtOfficialClinicName(otPayClinic)}</span>
                  <span className="inline-block w-8" />
                  <span>ประจำเดือน</span>
                  <span className="inline-block w-4" />
                  <span className="underline decoration-dotted underline-offset-4">
                    {THAI_MONTHS[otPayMonth - 1]}
                  </span>
                  <span className="inline-block w-4" />
                  <span>{otPayYearBE}</span>
                </div>
              </div>

              {/* Official 2-Row Header Monthly OT Grid Table (Fixed columns sized to fit A4 Landscape completely) */}
              <table className="w-full table-fixed border-collapse border border-black text-[9.5px] leading-tight print:text-[8px] print-fit-table">
                <colgroup>
                  <col className="w-[26px]" />
                  <col className="w-[52px]" />
                  <col className="w-[110px]" />
                  <col className="w-[66px]" />
                  {otPaymentReportData.dayColumns.map((d) => (
                    <col key={d.dayNum} />
                  ))}
                  <col className="w-[34px]" />
                  <col className="w-[34px]" />
                  <col className="w-[54px]" />
                  <col className="w-[44px]" />
                  <col className="w-[54px]" />
                  <col className="w-[48px]" />
                </colgroup>
                <thead>
                  <tr className="bg-white font-bold text-center">
                    <th rowSpan={2} className="border border-black px-0.5 py-1 leading-tight">
                      ลำดับ
                      <br />
                      ที่
                    </th>
                    <th rowSpan={2} className="border border-black px-0.5 py-1 leading-tight">
                      รหัสบุคลากร
                    </th>
                    <th rowSpan={2} className="border border-black px-1 py-1">
                      ชื่อ สกุล
                    </th>
                    <th rowSpan={2} className="border border-black px-1 py-1">
                      ตำแหน่ง
                    </th>
                    <th
                      colSpan={otPaymentReportData.daysInMonth}
                      className="border border-black px-0.5 py-0.5 text-center font-bold"
                    >
                      วันที่ปฏิบัติงาน
                    </th>
                    <th rowSpan={2} className="border border-black px-0.5 py-1 leading-tight">
                      อัตรา/
                      <br />
                      ชั่วโมง
                    </th>
                    <th rowSpan={2} className="border border-black px-0.5 py-1 leading-tight">
                      จำนวน
                      <br />
                      ชั่วโมง
                    </th>
                    <th rowSpan={2} className="border border-black px-0.5 py-1 leading-tight">
                      จำนวนเงิน
                      <br />
                      ที่เบิก
                    </th>
                    <th rowSpan={2} className="border border-black px-0.5 py-1 leading-tight">
                      หักภาษี
                      <br />
                      5%
                    </th>
                    <th rowSpan={2} className="border border-black px-0.5 py-1 leading-tight">
                      จำนวนเงิน
                      <br />
                      คงเหลือ
                    </th>
                    <th rowSpan={2} className="border border-black px-0.5 py-1 leading-tight">
                      ลายมือชื่อ
                      <br />
                      ผู้รับเงิน
                    </th>
                  </tr>
                  <tr className="bg-white text-center font-semibold">
                    {otPaymentReportData.dayColumns.map((d) => (
                      <th
                        key={d.dayNum}
                        className="border border-black py-0.5 px-0 text-center text-[8.5px] print:text-[7.5px]"
                        title={d.holidayName || d.iso}
                      >
                        {d.dayNum}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {otPaymentReportData.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={10 + otPaymentReportData.daysInMonth}
                        className="border border-black py-8 text-center text-gray-500 text-xs"
                      >
                        ไม่พบข้อมูลการปฏิบัติงานนอกเวลา (OT) ในเดือน {THAI_MONTHS[otPayMonth - 1]} พ.ศ. {otPayYearBE}
                        {otPayClinic !== 'ALL' ? ` สำหรับ ${otPayClinic}` : ''}
                      </td>
                    </tr>
                  ) : (
                    otPaymentReportData.rows.map((row, idx) => (
                      <tr key={`${row.staffName}-${row.positionLabel}-${idx}`}>
                        <td className="border border-black py-1 px-0.5 text-center">{idx + 1}</td>
                        <td className="border border-black py-1 px-0.5 text-center font-mono text-[8.5px] print:text-[7.5px] break-all">
                          {row.employeeCode || ''}
                        </td>
                        <td className="border border-black py-1 px-1 text-left whitespace-normal break-words leading-tight">
                          {row.staffName}
                        </td>
                        <td className="border border-black py-1 px-0.5 text-center whitespace-normal break-words leading-tight">
                          {row.positionLabel}
                        </td>
                        {otPaymentReportData.dayColumns.map((d) => {
                          const hrs = row.dayHours[d.dayNum] || 0;
                          return (
                            <td
                              key={d.dayNum}
                              className={`border border-black py-1 px-0 text-center text-[8.5px] print:text-[7.5px] ${
                                d.isShaded ? 'bg-[#d1d5db]' : 'bg-white'
                              }`}
                              title={d.holidayName || d.iso}
                            >
                              {hrs > 0 ? formatOtHourNum(hrs) : ''}
                            </td>
                          );
                        })}
                        <td className="border border-black py-1 px-0.5 text-center tabular-nums">
                          {row.hourlyRate}
                        </td>
                        <td className="border border-black py-1 px-0.5 text-center tabular-nums">
                          {formatOtHourNum(row.totalHours)}
                        </td>
                        <td className="border border-black py-1 px-1 text-right tabular-nums whitespace-nowrap">
                          {formatOtMoney(row.grossAmount)}
                        </td>
                        <td className="border border-black py-1 px-1 text-right tabular-nums whitespace-nowrap">
                          {formatOtMoney(row.taxAmount)}
                        </td>
                        <td className="border border-black py-1 px-1 text-right tabular-nums whitespace-nowrap">
                          {formatOtMoney(row.netAmount)}
                        </td>
                        <td className="border border-black py-1 px-0.5" />
                      </tr>
                    ))
                  )}
                </tbody>
                {(() => {
                  const leftPart = Math.min(9, Math.floor(otPaymentReportData.daysInMonth / 3));
                  const rightPart = otPaymentReportData.daysInMonth - leftPart;
                  return (
                    <tfoot>
                      <tr className="font-bold">
                        <td
                          colSpan={4 + leftPart}
                          className="border border-black py-1.5 px-1.5 text-right"
                        >
                          (ตัวอักษร)
                        </td>
                        <td
                          colSpan={rightPart}
                          className="border border-black py-1.5 px-1.5 text-center break-words"
                        >
                          {otPaymentReportData.bahtText}
                        </td>
                        <td className="border border-black py-1.5 px-0.5 text-center bg-white">
                          รวม
                        </td>
                        <td className="border border-black py-1.5 px-0.5 text-center bg-[#fef08a] tabular-nums">
                          {formatOtHourNum(otPaymentReportData.grandTotalHours)}
                        </td>
                        <td className="border border-black py-1.5 px-1 text-right bg-[#fef08a] tabular-nums whitespace-nowrap">
                          {formatOtMoney(otPaymentReportData.grandTotalGross)}
                        </td>
                        <td className="border border-black py-1.5 px-1 text-right bg-[#fef08a] tabular-nums whitespace-nowrap">
                          {formatOtMoney(otPaymentReportData.grandTotalTax)}
                        </td>
                        <td className="border border-black py-1.5 px-1 text-right bg-[#fef08a] tabular-nums whitespace-nowrap">
                          {formatOtMoney(otPaymentReportData.grandTotalNet)}
                        </td>
                        <td className="border border-black py-1.5 px-0.5 bg-white" />
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>

              {/* Two Bordered Signature Boxes at Bottom (Image 4 Exact Style) */}
              <div className="grid grid-cols-2 border border-black mt-3 text-[11px] print:text-[9.5px] print:break-inside-avoid">
                <div className="border-r border-black p-3.5 flex flex-col items-center justify-center text-center space-y-2 print:p-2.5 print:space-y-1.5">
                  <div>ได้ตรวจสอบจำนวนเงินถูกต้องแล้ว</div>
                  <div>ลงชื่อ....................................................ผู้ตรวจ</div>
                </div>
                <div className="p-3 flex flex-col items-center justify-center text-center space-y-1 print:p-2">
                  <div>ขอรับรองว่าผู้มีรายชื่อข้างต้นได้ปฏิบัติงานนอกเวลาจริง</div>
                  <div>ลงชื่อ....................................................ผู้ควบคุม</div>
                  <div>({resolvedOtPayControllerName})</div>
                  <div>หัวหน้าหน่วยการพยาบาลผู้ป่วยนอก</div>
                  <div>วันที่............................................................</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Edit Leave Modal (Mandatory Reason + Timestamp) */}
      {editingLeave && onUpdateLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-bold text-gray-900">
                  แก้ไขข้อมูลประวัติการลา (เฉพาะ Admin)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingLeave(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">ชื่อเจ้าหน้าที่</label>
                <input
                  type="text"
                  value={editingLeave.staffName}
                  disabled
                  className="w-full px-2.5 py-1.5 bg-gray-100 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ตำแหน่ง</label>
                  <input
                    type="text"
                    value={formatPositionLabel(editingLeave.position)}
                    disabled
                    className="w-full px-2.5 py-1.5 bg-gray-100 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">คลินิกสังกัด</label>
                  <input
                    type="text"
                    value={editingLeave.clinic}
                    disabled
                    className="w-full px-2.5 py-1.5 bg-gray-100 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ตั้งแต่วันที่ (พ.ศ.)</label>
                  <ThaiDateInput
                    value={editingLeave.startDate}
                    onChange={(nextStart) => {
                      const nextEnd = editingLeave.endDate >= nextStart ? editingLeave.endDate : nextStart;
                      const autoWorkDays = countGovernmentWorkdaysInRange(nextStart, nextEnd, customHolidays);
                      setEditingLeave({
                        ...editingLeave,
                        startDate: nextStart,
                        endDate: nextEnd,
                        days: autoWorkDays,
                      });
                    }}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ถึงวันที่ (พ.ศ.)</label>
                  <ThaiDateInput
                    value={editingLeave.endDate}
                    onChange={(nextDate) => {
                      const nextEnd = nextDate >= editingLeave.startDate ? nextDate : editingLeave.startDate;
                      const autoWorkDays = countGovernmentWorkdaysInRange(editingLeave.startDate, nextEnd, customHolidays);
                      setEditingLeave({
                        ...editingLeave,
                        endDate: nextEnd,
                        days: autoWorkDays,
                      });
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ประเภทการลา</label>
                  <select
                    value={editingLeave.leaveType}
                    onChange={(e) =>
                      setEditingLeave({ ...editingLeave, leaveType: e.target.value as LeaveType })
                    }
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-medium"
                  >
                    {leaveTypes.map((lt) => (
                      <option key={lt} value={lt}>
                        {lt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">จำนวนวันลา (วัน)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={editingLeave.days}
                    onChange={(e) => {
                      const nextDays = Number(e.target.value) || 1;
                      const currentPeriod = parseLeavePeriodFromNote(editingLeave.note);
                      setEditingLeave({
                        ...editingLeave,
                        days: nextDays,
                        note:
                          nextDays === 0.5 && editingLeave.startDate === editingLeave.endDate
                            ? formatLeaveNoteWithPeriod(
                                editingLeave.note || '',
                                0.5,
                                currentPeriod || 'ครึ่งวันเช้า'
                              )
                            : stripLeavePeriodFromNote(editingLeave.note),
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-bold"
                  />
                </div>
              </div>

              {editingLeave.startDate === editingLeave.endDate && (
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    ช่วงเวลาการลา (สำหรับลาวันเดียว)
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { label: 'เต็มวัน (1.0)', days: 1, period: '' as HalfDayPeriod },
                        { label: 'ครึ่งวันเช้า (0.5)', days: 0.5, period: 'ครึ่งวันเช้า' as HalfDayPeriod },
                        { label: 'ครึ่งวันบ่าย (0.5)', days: 0.5, period: 'ครึ่งวันบ่าย' as HalfDayPeriod },
                      ] as const
                    ).map((opt) => {
                      const currentPeriod = parseLeavePeriodFromNote(editingLeave.note);
                      const isActive =
                        editingLeave.days === opt.days &&
                        (opt.days === 1 ? !currentPeriod : currentPeriod === opt.period);
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() =>
                            setEditingLeave({
                              ...editingLeave,
                              days: opt.days,
                              note: formatLeaveNoteWithPeriod(
                                editingLeave.note || '',
                                opt.days,
                                opt.period
                              ),
                            })
                          }
                          className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border cursor-pointer ${
                            isActive
                              ? 'bg-amber-600 text-white border-amber-700'
                              : 'bg-white text-gray-700 border-gray-300 hover:bg-amber-50'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-gray-700 mb-1">หมายเหตุการลา</label>
                <input
                  type="text"
                  value={editingLeave.note || ''}
                  onChange={(e) => setEditingLeave({ ...editingLeave, note: e.target.value })}
                  placeholder="เช่น ใบรับรองแพทย์, ลาพักผ่อนประจำปี"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                />
              </div>

              {/* Mandatory Edit Reason */}
              <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
                <label className="block font-bold text-amber-950">
                  เหตุผลการแก้ไขรายการ (บังคับระบุ) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editLeaveReason}
                  onChange={(e) => {
                    setEditLeaveReason(e.target.value);
                    setEditLeaveReasonError('');
                  }}
                  placeholder="เช่น เปลี่ยนจากลาพักผ่อนเป็นลาป่วย, แก้ไขช่วงวันที่ลา"
                  className="w-full px-2.5 py-2 border border-amber-300 rounded-lg text-xs bg-white font-medium"
                />
                <div className="flex flex-wrap gap-1">
                  {[
                    'เปลี่ยนจากลาพักผ่อนเป็นลาป่วย',
                    'เปลี่ยนประเภทการลา',
                    'แก้ไขช่วงวันที่ลา',
                    'ปรับแก้จำนวนวันลา',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setEditLeaveReason(preset);
                        setEditLeaveReasonError('');
                      }}
                      className="px-2 py-0.5 text-[10px] rounded-md bg-white border border-amber-200 text-amber-900 hover:bg-amber-100 cursor-pointer"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
                {editLeaveReasonError && (
                  <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{editLeaveReasonError}</span>
                  </p>
                )}
                <p className="text-[10px] text-amber-800">
                  ระบบจะบันทึกเวลาที่แก้ไขอัตโนมัติ: {formatThaiDateTime(new Date().toISOString())}
                </p>
              </div>
            </div>

            {editLeaveDuplicateError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-300 text-xs text-red-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{editLeaveDuplicateError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setEditingLeave(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editLeaveReason.trim()) {
                    setEditLeaveReasonError('กรุณาระบุเหตุผลการแก้ไขรายการก่อนบันทึก');
                    return;
                  }
                  const conflict = findOverlappingLeaveConflict(
                    editingLeave.staffName,
                    editingLeave.leaveType,
                    editingLeave.startDate,
                    editingLeave.endDate,
                    editingLeave.id,
                    Number(editingLeave.days) || 1,
                    parseLeavePeriodFromNote(editingLeave.note)
                  );
                  if (conflict) {
                    setEditLeaveDuplicateError(
                      `ไม่สามารถบันทึกได้: ${editingLeave.staffName} มีประวัติ "${conflict.leaveType}" วันที่ ${formatThaiLeaveRange(conflict.startDate, conflict.endDate)} (${conflict.days} วัน) อยู่ในฐานข้อมูลแล้ว`
                    );
                    return;
                  }
                  setEditLeaveDuplicateError('');
                  onUpdateLeave(editingLeave, editLeaveReason.trim());
                  setEditingLeave(null);
                  setEditLeaveReason('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>บันทึกการแก้ไข</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Delete Leave Confirmation Modal (Mandatory Reason + Timestamp) */}
      {deletingLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-red-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                <h3 className="text-base font-bold text-red-950">
                  ยืนยันลบประวัติการลา (ระบุเหตุผล)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingLeave(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-bold text-gray-900">{deletingLeave.staffName}</div>
                <div className="text-gray-600">
                  {deletingLeave.leaveType} • {deletingLeave.days} วัน (
                  {formatThaiLeaveRange(deletingLeave.startDate, deletingLeave.endDate)})
                </div>
              </div>

              <div className="space-y-2">
                <label className="block font-bold text-red-950">
                  เหตุผลการลบรายการ (บังคับระบุ) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={deleteLeaveReason}
                  onChange={(e) => {
                    setDeleteLeaveReason(e.target.value);
                    setDeleteLeaveReasonError('');
                  }}
                  placeholder="เช่น ยกเลิกวันลา, บันทึกซ้ำซ้อน, บันทึกข้อมูลผิดคน"
                  autoFocus
                  className="w-full px-2.5 py-2 border border-red-300 rounded-lg text-xs font-medium"
                />
                <div className="flex flex-wrap gap-1">
                  {['ยกเลิกวันลา', 'เปลี่ยนแผนไม่ลาแล้ว', 'บันทึกข้อมูลซ้ำซ้อน', 'บันทึกผิดคน/ผิดวัน'].map(
                    (preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setDeleteLeaveReason(preset);
                          setDeleteLeaveReasonError('');
                        }}
                        className="px-2 py-0.5 text-[10px] rounded-md bg-red-50 border border-red-200 text-red-900 hover:bg-red-100 cursor-pointer"
                      >
                        + {preset}
                      </button>
                    )
                  )}
                </div>
                {deleteLeaveReasonError && (
                  <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{deleteLeaveReasonError}</span>
                  </p>
                )}
                <p className="text-[10px] text-gray-500">
                  บันทึกเวลาที่ลบอัตโนมัติ: {formatThaiDateTime(new Date().toISOString())}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setDeletingLeave(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!deleteLeaveReason.trim()) {
                    setDeleteLeaveReasonError('กรุณาระบุเหตุผลการลบรายการก่อนยืนยัน');
                    return;
                  }
                  onDeleteLeave(deletingLeave.id, deleteLeaveReason.trim());
                  setDeletingLeave(null);
                  setDeleteLeaveReason('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>ยืนยันลบและบันทึกเหตุผล</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Edit OT Modal (Mandatory Reason + Timestamp) */}
      {editingOT && onUpdateOT && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-bold text-gray-900">
                  แก้ไขข้อมูลเวรนอกเวลา & ปฏิบัติแทน (เฉพาะ Admin)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingOT(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-gray-700 mb-1">ชื่อ-สกุล</label>
                  <input
                    type="text"
                    value={editingOT.staffName}
                    onChange={(e) => setEditingOT({ ...editingOT, staffName: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">รหัสบุคลากร</label>
                  <input
                    type="text"
                    value={editingOT.employeeCode || ''}
                    onChange={(e) =>
                      setEditingOT({ ...editingOT, employeeCode: e.target.value })
                    }
                    placeholder="เช่น 20708302"
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ตำแหน่ง</label>
                  <select
                    value={editingOT.position}
                    onChange={(e) =>
                      setEditingOT({ ...editingOT, position: e.target.value as StaffPosition })
                    }
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    {ALL_POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {POSITION_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    สังกัด / หน่วยงานต้นทาง
                  </label>
                  <input
                    type="text"
                    value={editingOT.affiliation || editingOT.homeClinic}
                    onChange={(e) =>
                      setEditingOT({
                        ...editingOT,
                        homeClinic: e.target.value,
                        affiliation: editingOT.isExternal ? e.target.value : editingOT.affiliation,
                      })
                    }
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    จำนวนชั่วโมงปฏิบัติงานจริง (ชม.)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="24"
                    value={getEffectiveOtHours(editingOT, settings?.stdHr)}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setEditingOT({
                        ...editingOT,
                        hours:
                          Number.isFinite(val) && val > 0 ? Math.min(24, val) : 0.5,
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-teal-300 bg-teal-50/40 rounded-lg text-xs font-extrabold text-teal-950"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">วันที่ (พ.ศ.)</label>
                  <ThaiDateInput
                    value={editingOT.date}
                    onChange={(nextDate) => setEditingOT({ ...editingOT, date: nextDate })}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">กะเวลา</label>
                  <select
                    value={editingOT.shift}
                    onChange={(e) =>
                      setEditingOT({ ...editingOT, shift: e.target.value as WorkShift })
                    }
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    {OT_SHIFTS.map((sh) => (
                      <option key={sh.value} value={sh.value}>
                        {sh.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {(() => {
                const parsedWork = parseOtWorkClinic(editingOT.workClinic);
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">
                        ห้องตรวจที่ปฏิบัติงาน
                      </label>
                      <select
                        value={parsedWork.clinic}
                        onChange={(e) =>
                          setEditingOT({
                            ...editingOT,
                            workClinic: formatOtWorkClinicValue(
                              e.target.value,
                              parsedWork.amount,
                              parsedWork.periodLabel
                            ),
                          })
                        }
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                      >
                        {allClinics.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">
                        สัดส่วนแรง / ช่วงเวลา
                      </label>
                      <select
                        value={
                          parsedWork.amount === 0.5
                            ? parsedWork.periodLabel === 'ครึ่งวันบ่าย'
                              ? '0.5-PM'
                              : '0.5-AM'
                            : '1'
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          const nextAmt = v === '1' ? 1 : 0.5;
                          const nextPeriod: HalfDayPeriod =
                            v === '0.5-AM' ? 'ครึ่งวันเช้า' : v === '0.5-PM' ? 'ครึ่งวันบ่าย' : '';
                          setEditingOT({
                            ...editingOT,
                            workClinic: formatOtWorkClinicValue(
                              parsedWork.clinic,
                              nextAmt,
                              nextPeriod
                            ),
                          });
                        }}
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                      >
                        <option value="1">เต็มเวร / เต็มวัน (1.0)</option>
                        <option value="0.5-AM">0.5 แรง — ครึ่งวันเช้า</option>
                        <option value="0.5-PM">0.5 แรง — ครึ่งวันบ่าย</option>
                      </select>
                    </div>
                  </div>
                );
              })()}

              {/* Mandatory Edit Reason */}
              <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200 space-y-2">
                <label className="block font-bold text-teal-950">
                  เหตุผลการแก้ไขรายการ (บังคับระบุ) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editOtReason}
                  onChange={(e) => {
                    setEditOtReason(e.target.value);
                    setEditOtReasonError('');
                  }}
                  placeholder="เช่น เปลี่ยนห้องตรวจที่ขึ้นเวร, แก้ไขวันที่/กะเวลาเวร"
                  className="w-full px-2.5 py-2 border border-teal-300 rounded-lg text-xs bg-white font-medium"
                />
                <div className="flex flex-wrap gap-1">
                  {[
                    'เปลี่ยนคลินิกที่ปฏิบัติงาน',
                    'เปลี่ยนวันที่ขึ้นเวร',
                    'แก้ไขกะเวลาเวร',
                    'เปลี่ยนชื่อผู้ปฏิบัติแทน',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setEditOtReason(preset);
                        setEditOtReasonError('');
                      }}
                      className="px-2 py-0.5 text-[10px] rounded-md bg-white border border-teal-200 text-teal-900 hover:bg-teal-100 cursor-pointer"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
                {editOtReasonError && (
                  <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{editOtReasonError}</span>
                  </p>
                )}
                <p className="text-[10px] text-teal-800">
                  ระบบจะบันทึกเวลาที่แก้ไขอัตโนมัติ: {formatThaiDateTime(new Date().toISOString())}
                </p>
              </div>
            </div>

            {editOtDuplicateError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-300 text-xs text-red-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{editOtDuplicateError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => {
                  setEditingOT(null);
                  setEditOtDuplicateError('');
                }}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editOtReason.trim()) {
                    setEditOtReasonError('กรุณาระบุเหตุผลการแก้ไขรายการก่อนบันทึก');
                    return;
                  }
                  const dupOt = findOtConflictForName(
                    editingOT.staffName,
                    editingOT.date,
                    editingOT.shift,
                    editingOT.workClinic,
                    editingOT.id
                  );
                  if (dupOt) {
                    const dupClinic = parseOtWorkClinic(dupOt.workClinic).clinic || dupOt.workClinic;
                    setEditOtDuplicateError(
                      `ไม่สามารถบันทึกซ้ำได้: ${editingOT.staffName} มีประวัติขึ้นเวร (${dupClinic}) วันที่ ${formatThaiShortDate(editingOT.date)} กะ "${editingOT.shift}" อยู่ในระบบแล้ว`
                    );
                    return;
                  }
                  setEditOtDuplicateError('');
                  onUpdateOT(editingOT, editOtReason.trim());
                  setEditingOT(null);
                  setEditOtReason('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>บันทึกการแก้ไข</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Delete OT Confirmation Modal (Mandatory Reason + Timestamp) */}
      {deletingOT && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-red-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                <h3 className="text-base font-bold text-red-950">
                  ยืนยันลบรายการเวร OT (ระบุเหตุผล)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingOT(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-bold text-gray-900">{deletingOT.staffName}</div>
                <div className="text-gray-600">
                  {formatThaiShortDate(deletingOT.date)} • {deletingOT.shift} •{' '}
                  {deletingOT.workClinic}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block font-bold text-red-950">
                  เหตุผลการลบรายการ (บังคับระบุ) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={deleteOtReason}
                  onChange={(e) => {
                    setDeleteOtReason(e.target.value);
                    setDeleteOtReasonError('');
                  }}
                  placeholder="เช่น ยกเลิกเวร OT, แลกเวรเปลี่ยนคน, บันทึกซ้ำซ้อน"
                  autoFocus
                  className="w-full px-2.5 py-2 border border-red-300 rounded-lg text-xs font-medium"
                />
                <div className="flex flex-wrap gap-1">
                  {['ยกเลิกเวร OT', 'แลกเวรเปลี่ยนผู้ปฏิบัติงาน', 'บันทึกข้อมูลซ้ำซ้อน', 'บันทึกผิดวัน'].map(
                    (preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setDeleteOtReason(preset);
                          setDeleteOtReasonError('');
                        }}
                        className="px-2 py-0.5 text-[10px] rounded-md bg-red-50 border border-red-200 text-red-900 hover:bg-red-100 cursor-pointer"
                      >
                        + {preset}
                      </button>
                    )
                  )}
                </div>
                {deleteOtReasonError && (
                  <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{deleteOtReasonError}</span>
                  </p>
                )}
                <p className="text-[10px] text-gray-500">
                  บันทึกเวลาที่ลบอัตโนมัติ: {formatThaiDateTime(new Date().toISOString())}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setDeletingOT(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!deleteOtReason.trim()) {
                    setDeleteOtReasonError('กรุณาระบุเหตุผลการลบรายการก่อนยืนยัน');
                    return;
                  }
                  onDeleteOT(deletingOT.id, deleteOtReason.trim());
                  setDeletingOT(null);
                  setDeleteOtReason('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>ยืนยันลบและบันทึกเหตุผล</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
