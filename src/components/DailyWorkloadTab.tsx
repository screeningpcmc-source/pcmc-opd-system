import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  DailyWorkload, 
  StaffMember, 
  StaffPosition,
  ALL_POSITIONS,
  LeaveRecord,
  OTAttendance,
  WorkShift, 
  IN_TIME_CLINICS, 
  OUT_TIME_CLINICS, 
  DEFAULT_PREMIUM_SUB_CLINICS,
  PREMIUM_CLINIC_GROUP,
  LEGACY_PREMIUM_CLINIC_GROUP,
  PREMIUM_POOL_CLINIC_NAME,
  isPremiumGroupName,
  isPremiumPoolClinicName,
  LeaveType,
  LEAVE_TYPES,
  formatPositionLabel,
  getEffectiveTotalPt,
  compareStaffByPositionAndStartDate,
  HalfDayPeriod,
  isTrainingLeaveType,
  parseLeavePeriodFromNote,
  parseOtWorkClinic,
  WorkloadLeavePayload,
  WorkloadCrossCoveragePayload,
  WorkloadTrainingPayload,
  REFERRAL_CLINIC_NAME,
  REFERRAL_ITEM_DEFINITIONS,
  ReferralCenterData,
  ReferralItemKey,
  createEmptyReferralData,
  getReferralAdmitCount,
  getReferralTotalCount,
  isReferralClinicName,
  isReferralWorkload,
  normalizeReferralData,
  isDailyWagePosition,
  getWorkloadRolePosition,
  normalizeStaffPosition,
  OffDutyPeriodLabel,
  OffDutyStaffEntry,
  OFF_DUTY_STAFF_REASON_PRESETS,
  isOffDutyWorkload,
  getWorkloadOffDutyReason,
  getWorkloadOffDutyStaff,
  formatOffDutyStaffSummaryText,
  normalizeWorkloadDateStr,
  normalizeWorkloadShiftStr,
  deduplicateLeaves,
  isLeaveDuplicateConflict,
  normalizeLeaveDateStr,
  normalizeStaffNameKey,
  isLeaveReasonRequired,
  hasValidLeaveReason,
} from '../types';
import {
  formatThaiShortDate,
  formatThaiDateTime,
  THAI_SHORT_MONTHS,
  getLocalTodayIso,
} from '../utils/thaiDate';
import { ThaiDateInput } from './ThaiDateInput';
import { 
  ClipboardPen, 
  Users, 
  Plus, 
  Minus, 
  Sparkles, 
  Calendar, 
  Clock, 
  Building, 
  Bed, 
  Activity, 
  Trash2, 
  FileCheck2,
  CheckCircle2,
  HelpCircle,
  ArrowRightLeft,
  Lock,
  ShieldCheck,
  ShieldAlert,
  Pencil,
  X,
  Save,
  Search,
  CheckSquare,
  Square,
  GraduationCap,
  CalendarOff,
  AlertCircle,
  UserPlus,
  PauseCircle,
  SlidersHorizontal
} from 'lucide-react';
import { AdjustPatientModal, AdjustPatientPatch } from './AdjustPatientModal';

interface LeaveSelectionDraft {
  staffId: string;
  leaveType: LeaveType;
  days: 1 | 0.5;
  periodLabel: HalfDayPeriod;
  note: string;
}

interface TrainingSelectionDraft {
  staffId: string;
  days: 1 | 0.5;
  periodLabel: HalfDayPeriod;
}

interface OffDutyStaffDraft {
  staffId: string;
  amount: 1 | 0.5;
  periodLabel: OffDutyPeriodLabel;
  reason: string;
}

interface CrossCoverageDraft {
  tempId: string;
  direction: 'outgoing' | 'incoming';
  staffName: string;
  position: StaffPosition;
  otherClinic: string;
  amount: 1 | 0.5;
  periodLabel: HalfDayPeriod;
  isExternal: boolean;
}

interface DailyWorkloadTabProps {
  workloads: DailyWorkload[];
  staffList: StaffMember[];
  leaves?: LeaveRecord[];
  otRecords?: OTAttendance[];
  inTimeClinics?: string[];
  outTimeClinics?: string[];
  premiumSubClinics?: string[];
  leaveTypes?: string[];
  onSaveWorkload: (
    entry: DailyWorkload, 
    leaveData?: WorkloadLeavePayload[] | null,
    crossCoverageData?: WorkloadCrossCoveragePayload | WorkloadCrossCoveragePayload[] | null,
    trainingData?: WorkloadTrainingPayload[] | null
  ) => void;
  onSaveBatchWorkloads?: (
    entries: DailyWorkload[],
    leaveData?: WorkloadLeavePayload[] | null,
    crossCoverageData?: WorkloadCrossCoveragePayload | WorkloadCrossCoveragePayload[] | null,
    trainingData?: WorkloadTrainingPayload[] | null
  ) => void;
  onUpdateWorkload?: (updated: DailyWorkload, reason: string) => void;
  onAdjustWorkloadPatients?: (
    target: DailyWorkload,
    patch: AdjustPatientPatch,
    adjusterName: string,
    reason: string
  ) => void;
  onDeleteWorkload: (id: string, reason: string) => void;
  defaultReporter?: string;
  isAdmin?: boolean;
  onPromptAdminUnlock?: () => void;
}

export const DailyWorkloadTab: React.FC<DailyWorkloadTabProps> = ({
  workloads,
  staffList,
  leaves = [],
  otRecords = [],
  inTimeClinics = [...IN_TIME_CLINICS],
  outTimeClinics = [...OUT_TIME_CLINICS],
  premiumSubClinics = [...DEFAULT_PREMIUM_SUB_CLINICS],
  leaveTypes = [...LEAVE_TYPES],
  onSaveWorkload,
  onSaveBatchWorkloads,
  onUpdateWorkload,
  onAdjustWorkloadPatients,
  onDeleteWorkload,
  defaultReporter = '',
  isAdmin = false,
  onPromptAdminUnlock,
}) => {
  const todayStr = getLocalTodayIso();

  const [date, setDate] = useState<string>(todayStr);
  const [shift, setShift] = useState<WorkShift>('ในเวลา 08:00-16:00');
  const [clinic, setClinic] = useState<string>(inTimeClinics[0] || IN_TIME_CLINICS[0]);

  // Admin Editing / Deleting Modal, General Patient Adjust Modal & Form Error State
  const [formError, setFormError] = useState<string>('');
  const [adjustingPatientWorkload, setAdjustingPatientWorkload] = useState<DailyWorkload | null>(null);
  const [editingWorkload, setEditingWorkload] = useState<DailyWorkload | null>(null);
  const [editWorkloadReason, setEditWorkloadReason] = useState<string>('');
  const [editWorkloadReasonError, setEditWorkloadReasonError] = useState<string>('');
  const [editModalError, setEditModalError] = useState<string>('');
  const [deletingWorkload, setDeletingWorkload] = useState<DailyWorkload | null>(null);
  const [deleteWorkloadReason, setDeleteWorkloadReason] = useState<string>('');
  const [deleteWorkloadReasonError, setDeleteWorkloadReasonError] = useState<string>('');
  
  // Patients & Admit
  const [totalPt, setTotalPt] = useState<number>(0);
  const [adultPt, setAdultPt] = useState<number>(0);
  const [childPt, setChildPt] = useState<number>(0);
  const [admit, setAdmit] = useState<number>(0);

  // Staff on duty (supports 0.5 steps; automatically defaulted from active clinic roster)
  const [hn, setHn] = useState<number>(0);
  const [rn, setRn] = useState<number>(0);
  const [pn, setPn] = useState<number>(0);
  const [na, setNa] = useState<number>(0);
  const [clerk, setClerk] = useState<number>(0);
  const [serviceWorker, setServiceWorker] = useState<number>(0);

  // Notes & Reporter (empty by default & required)
  const [note, setNote] = useState<string>('');
  const [reporter, setReporter] = useState<string>(defaultReporter);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const submittingRef = useRef<boolean>(false);

  // Off เวรเจ้าหน้าที่ตำแหน่งรายวัน (กรณียอดผู้ป่วยน้อยลง — รองรับทั้งในเวลาและนอกเวลาราชการ)
  const [hasStaffOffDuty, setHasStaffOffDuty] = useState<boolean>(false);
  const [selectedOffDutyStaffItems, setSelectedOffDutyStaffItems] = useState<OffDutyStaffDraft[]>([]);
  const [offDutyStaffSearch, setOffDutyStaffSearch] = useState<string>('');
  const [showAllOpdDailyWageInTime, setShowAllOpdDailyWageInTime] = useState<boolean>(false);
  const [adminAddOffDutyStaffId, setAdminAddOffDutyStaffId] = useState<string>('');

  // Section 4: Leave / Training-Meeting / Cross-Coverage
  const [hasStaffLeave, setHasStaffLeave] = useState<boolean>(false);
  const [selectedLeaveItems, setSelectedLeaveItems] = useState<LeaveSelectionDraft[]>([]);
  const [leaveSearch, setLeaveSearch] = useState<string>('');

  const [hasTraining, setHasTraining] = useState<boolean>(false);
  const [selectedTrainingItems, setSelectedTrainingItems] = useState<TrainingSelectionDraft[]>([]);
  const [trainingSearch, setTrainingSearch] = useState<string>('');
  const [trainingTopic, setTrainingTopic] = useState<string>('');
  const [trainingNote, setTrainingNote] = useState<string>('');

  const [hasCrossCover, setHasCrossCover] = useState<boolean>(false);
  const [crossDirection, setCrossDirection] = useState<'outgoing' | 'incoming'>('outgoing');
  const [crossIncomingSource, setCrossIncomingSource] = useState<'opd' | 'external'>('opd');
  const [crossStaffSearch, setCrossStaffSearch] = useState<string>('');
  const [crossStaffName, setCrossStaffName] = useState<string>('');
  const [crossExtPosition, setCrossExtPosition] = useState<StaffPosition>('RN');
  const [crossOtherClinic, setCrossOtherClinic] = useState<string>('');
  const [crossAmount, setCrossAmount] = useState<1 | 0.5>(1);
  const [crossPeriod, setCrossPeriod] = useState<HalfDayPeriod>('');
  const [crossItems, setCrossItems] = useState<CrossCoverageDraft[]>([]);

  // ศูนย์ปัญญาภิรมย์ sub-department inputs
  const [premiumInputs, setPremiumInputs] = useState<
    Record<string, { adultPt: number; childPt: number; admit: number }>
  >({});

  // ศูนย์รับ - ส่งต่อผู้ป่วย 6-item inputs
  const [referralInputs, setReferralInputs] = useState<ReferralCenterData>(() =>
    createEmptyReferralData()
  );

  const uniqueLeaves = useMemo(() => deduplicateLeaves(leaves), [leaves]);

  const regularLeaveOptions = useMemo(() => {
    const filtered = leaveTypes.filter(lt => !isTrainingLeaveType(lt));
    return filtered.length > 0 ? filtered : ['ลาป่วย', 'ลากิจ', 'ลาพักผ่อน'];
  }, [leaveTypes]);

  const effectiveCrossItems = useMemo(() => {
    if (!hasCrossCover) return [];
    const list = [...crossItems];
    const draftName = crossStaffName.trim();
    const draftClinic = crossOtherClinic.trim();
    if (draftName && draftClinic) {
      const alreadyAdded = list.some(
        x =>
          x.direction === crossDirection &&
          x.staffName === draftName &&
          x.otherClinic === draftClinic &&
          x.periodLabel === crossPeriod
      );
      if (!alreadyAdded) {
        const st = staffList.find(s => s.name === draftName);
        list.push({
          tempId: 'DRAFT-ACTIVE',
          direction: crossDirection,
          staffName: draftName,
          position:
            crossDirection === 'incoming' && crossIncomingSource === 'external'
              ? crossExtPosition
              : st?.position || 'RN',
          otherClinic: draftClinic,
          amount: crossAmount,
          periodLabel: crossAmount === 0.5 ? (crossPeriod || 'ครึ่งวันเช้า') : '',
          isExternal: crossDirection === 'incoming' && crossIncomingSource === 'external',
        });
      }
    }
    return list;
  }, [
    hasCrossCover,
    crossItems,
    crossDirection,
    crossIncomingSource,
    crossStaffName,
    crossExtPosition,
    crossOtherClinic,
    crossAmount,
    crossPeriod,
    staffList,
  ]);

  // Shift & Clinics logic (exclude group names so "★ ศูนย์ปัญญาภิรมย์" renders once at bottom)
  const isOutTime = shift !== 'ในเวลา 08:00-16:00';
  const availableClinics = useMemo(
    () =>
      (isOutTime ? outTimeClinics : inTimeClinics).filter(
        c => c !== PREMIUM_CLINIC_GROUP && c !== LEGACY_PREMIUM_CLINIC_GROUP
      ),
    [isOutTime, outTimeClinics, inTimeClinics]
  );
  const allOpdClinics = useMemo(
    () =>
      Array.from(
        new Set([...inTimeClinics, ...outTimeClinics, PREMIUM_CLINIC_GROUP])
      ).filter(c => c && c !== LEGACY_PREMIUM_CLINIC_GROUP),
    [inTimeClinics, outTimeClinics]
  );
  const isEchoClinic = clinic === 'Echo';
  const isPremiumClinic = clinic === PREMIUM_CLINIC_GROUP;
  const isReferralClinic = isReferralClinicName(clinic);

  const referralTotal = useMemo(() => getReferralTotalCount(referralInputs), [referralInputs]);
  const referralAdmit = useMemo(() => getReferralAdmitCount(referralInputs), [referralInputs]);

  const referralThaiDateParts = useMemo(() => {
    const m = (date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return { day: '-', month: '-', beYear: '-' };
    const yr = Number(m[1]);
    const mo = Number(m[2]);
    const dy = Number(m[3]);
    return {
      day: String(dy),
      month: THAI_SHORT_MONTHS[mo - 1] || '-',
      beYear: String(yr + 543),
    };
  }, [date]);

  const updateReferralInput = (
    key: ReferralItemKey,
    field: 'count' | 'reason',
    value: number | string
  ) => {
    setReferralInputs(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]:
          field === 'count'
            ? Math.max(0, Number(value) || 0)
            : String(value),
      },
    }));
  };

  const existingPremiumPool = useMemo(() => {
    return (
      workloads.find(
        w =>
          w.date === date &&
          w.shift === shift &&
          (w.recordType === 'PREMIUM_POOL' || isPremiumPoolClinicName(w.clinic))
      ) || null
    );
  }, [workloads, date, shift]);

  const existingPremiumSubMap = useMemo(() => {
    const normDate = normalizeWorkloadDateStr(date);
    const normShift = normalizeWorkloadShiftStr(shift);
    const map = new Map<string, DailyWorkload>();
    workloads
      .filter(
        w =>
          normalizeWorkloadDateStr(w.date) === normDate &&
          normalizeWorkloadShiftStr(w.shift) === normShift &&
          (w.recordType === 'PREMIUM_SUB' ||
            ((isPremiumGroupName(w.clinicGroup) || /-Premium$/i.test(w.clinic)) &&
              !isPremiumPoolClinicName(w.clinic)))
      )
      .forEach(w => {
        if (!map.has(w.clinic)) map.set(w.clinic, w);
      });
    return map;
  }, [workloads, date, shift]);

  const existingPremiumSubClinics = useMemo(
    () => new Set(existingPremiumSubMap.keys()),
    [existingPremiumSubMap]
  );

  const existingDuplicateWorkload = useMemo(() => {
    if (isPremiumClinic) return null;
    const targetClinic = (clinic || '').trim();
    const normDate = normalizeWorkloadDateStr(date);
    const normShift = normalizeWorkloadShiftStr(shift);
    if (!targetClinic || !normDate || !normShift) return null;
    return (
      workloads.find(
        w =>
          normalizeWorkloadDateStr(w.date) === normDate &&
          normalizeWorkloadShiftStr(w.shift) === normShift &&
          (w.clinic || '').trim() === targetClinic &&
          w.recordType !== 'PREMIUM_SUB' &&
          w.recordType !== 'PREMIUM_POOL'
      ) || null
    );
  }, [workloads, date, shift, clinic, isPremiumClinic]);

  const premiumSummary = useMemo(() => {
    let activeCount = 0;
    let adultSum = 0;
    let childSum = 0;
    let admitSum = 0;
    premiumSubClinics.forEach(sub => {
      const item = premiumInputs[sub];
      if (!item) return;
      const a = Number(item.adultPt) || 0;
      const c = Number(item.childPt) || 0;
      const adm = Number(item.admit) || 0;
      if (a + c > 0 || adm > 0) {
        activeCount += 1;
        adultSum += a;
        childSum += c;
        admitSum += adm;
      }
    });
    return {
      activeCount,
      adultSum,
      childSum,
      totalSum: adultSum + childSum,
      admitSum,
    };
  }, [premiumSubClinics, premiumInputs]);

  const updatePremiumSubInput = (
    subClinic: string,
    field: 'adultPt' | 'childPt' | 'admit',
    value: number
  ) => {
    const cleanVal = Math.max(0, Number(value) || 0);
    setPremiumInputs(prev => ({
      ...prev,
      [subClinic]: {
        adultPt: prev[subClinic]?.adultPt || 0,
        childPt: prev[subClinic]?.childPt || 0,
        admit: prev[subClinic]?.admit || 0,
        [field]: cleanVal,
      },
    }));
  };

  const baselinePositionCounts = useMemo(() => {
    const normalizeUnit = (c?: string) => {
      const trimmed = (c || '').trim();
      if (!trimmed) return '';
      if (
        isPremiumGroupName(trimmed) ||
        isPremiumPoolClinicName(trimmed) ||
        /-Premium$/i.test(trimmed) ||
        premiumSubClinics.includes(trimmed)
      ) {
        return PREMIUM_CLINIC_GROUP;
      }
      return trimmed;
    };
    const targetUnit = normalizeUnit(clinic);
    const counts = { hn: 0, rn: 0, pn: 0, na: 0, clerk: 0, serviceWorker: 0 };
    staffList.forEach(s => {
      if (s.status !== 'Active') return;
      if (s.startDate && s.startDate > date) return;
      if (s.endDate && s.endDate < date) return;
      if (normalizeUnit(s.homeClinic) !== targetUnit) return;
      const pos = getWorkloadRolePosition(s.position);
      if (pos === 'RN') counts.rn += 1;
      else if (pos === 'PN') counts.pn += 1;
      else if (pos === 'NA') counts.na += 1;
      else if (pos === 'Clerk') counts.clerk += 1;
      else if (pos === 'Service Worker') counts.serviceWorker += 1;
    });
    return counts;
  }, [staffList, clinic, date, premiumSubClinics]);

  useEffect(() => {
    if (isOutTime) {
      setHn(0);
      setRn(0);
      setPn(0);
      setNa(0);
      setClerk(0);
      setServiceWorker(0);
      return;
    }
    if (isPremiumClinic && existingPremiumPool) {
      setHn(0);
      setRn(existingPremiumPool.rn || 0);
      setPn(existingPremiumPool.pn || 0);
      setNa(existingPremiumPool.na ?? existingPremiumPool.pca ?? 0);
      setClerk(existingPremiumPool.clerk || 0);
      setServiceWorker(existingPremiumPool.serviceWorker || 0);
      return;
    }
    setHn(0);
    setRn(baselinePositionCounts.rn);
    setPn(baselinePositionCounts.pn);
    setNa(baselinePositionCounts.na);
    setClerk(baselinePositionCounts.clerk);
    setServiceWorker(baselinePositionCounts.serviceWorker);
  }, [isOutTime, isPremiumClinic, existingPremiumPool, baselinePositionCounts]);

  useEffect(() => {
    if (
      clinic !== PREMIUM_CLINIC_GROUP &&
      availableClinics.length > 0 &&
      !availableClinics.includes(clinic)
    ) {
      setClinic(availableClinics[0]);
    }
  }, [availableClinics, clinic]);

  // Handle shift change
  const handleShiftChange = (newShift: WorkShift) => {
    setShift(newShift);
    setHasStaffOffDuty(false);
    setSelectedOffDutyStaffItems([]);
    setOffDutyStaffSearch('');
    setShowAllOpdDailyWageInTime(false);
    if (newShift !== 'ในเวลา 08:00-16:00') {
      setHasStaffLeave(false);
      setSelectedLeaveItems([]);
      setHasTraining(false);
      setSelectedTrainingItems([]);
    }
    setFormError('');
    const newClinics = (newShift !== 'ในเวลา 08:00-16:00' ? outTimeClinics : inTimeClinics).filter(
      c => c !== PREMIUM_CLINIC_GROUP && c !== LEGACY_PREMIUM_CLINIC_GROUP
    );
    if (clinic !== PREMIUM_CLINIC_GROUP && newClinics.length > 0 && !newClinics.includes(clinic)) {
      setClinic(newClinics[0]);
    }
  };

  // Adjust patient counts so adult + child always sum into totalPt
  const handleTotalPtChange = (val: number) => {
    const v = Math.max(0, val);
    setTotalPt(v);
    if (!isEchoClinic) {
      setAdultPt(Math.max(0, v - childPt));
    }
  };

  const handleAdultPtChange = (val: number) => {
    const v = Math.max(0, val);
    setAdultPt(v);
    setTotalPt(v + childPt);
  };

  const handleChildPtChange = (val: number) => {
    const v = Math.max(0, val);
    setChildPt(v);
    setTotalPt(adultPt + v);
  };

  // Filter & sort staff by position rank (1→12) and startDate (includes Daily Wage staff counted in workload)
  const clinicStaff = useMemo(
    () =>
      staffList
        .filter(
          s =>
            s.status === 'Active' &&
            (isPremiumClinic
              ? s.homeClinic === PREMIUM_CLINIC_GROUP || s.homeClinic === LEGACY_PREMIUM_CLINIC_GROUP
              : s.homeClinic === clinic)
        )
        .sort(compareStaffByPositionAndStartDate),
    [staffList, clinic, isPremiumClinic]
  );
  const dailyWageClinicStaffCount = useMemo(
    () =>
      staffList.filter(
        s =>
          s.status === 'Active' &&
          isDailyWagePosition(s.position) &&
          (isPremiumClinic
            ? s.homeClinic === PREMIUM_CLINIC_GROUP || s.homeClinic === LEGACY_PREMIUM_CLINIC_GROUP
            : s.homeClinic === clinic)
      ).length,
    [staffList, clinic, isPremiumClinic]
  );
  const activeStaffAll = useMemo(
    () =>
      staffList
        .filter(s => s.status === 'Active')
        .sort(compareStaffByPositionAndStartDate),
    [staffList]
  );

  // เจ้าหน้าที่ตำแหน่งงาน "รายวัน" ทั้งหมดใน OPD และเฉพาะสังกัดแผนกที่เลือก
  const allDailyWageStaff = useMemo(
    () => activeStaffAll.filter(s => isDailyWagePosition(s.position)),
    [activeStaffAll]
  );

  const clinicDailyWageStaff = useMemo(
    () =>
      allDailyWageStaff.filter(s =>
        isPremiumClinic
          ? s.homeClinic === PREMIUM_CLINIC_GROUP || s.homeClinic === LEGACY_PREMIUM_CLINIC_GROUP
          : s.homeClinic === clinic
      ),
    [allDailyWageStaff, clinic, isPremiumClinic]
  );

  // รายชื่อผู้มีเวร OT ในวัน/กะ/ห้องตรวจนี้ (ใช้ช่วยเรียงและแสดงป้ายกำกับในโหมด Off เวรนอกเวลา)
  const otScheduledStaffNamesForShift = useMemo(() => {
    const names = new Set<string>();
    const normalizeU = (c?: string) => {
      const t = (c || '').trim();
      if (!t) return '';
      if (isPremiumGroupName(t) || isPremiumPoolClinicName(t) || /-Premium$/i.test(t) || premiumSubClinics.includes(t)) {
        return PREMIUM_CLINIC_GROUP;
      }
      return t;
    };
    const targetU = normalizeU(clinic);
    otRecords.forEach(o => {
      if ((o.date || '').trim() !== date) return;
      if ((o.shift || '').trim() !== shift) return;
      const wUnit = normalizeU(parseOtWorkClinic(o.workClinic).clinic);
      if (wUnit === targetU && o.staffName) {
        names.add(o.staffName.trim());
      }
    });
    return names;
  }, [otRecords, date, shift, clinic, premiumSubClinics]);

  const sortedOutTimeDailyWageStaff = useMemo(() => {
    return [...allDailyWageStaff].sort((a, b) => {
      const aOt = otScheduledStaffNamesForShift.has((a.name || '').trim()) ? 0 : 1;
      const bOt = otScheduledStaffNamesForShift.has((b.name || '').trim()) ? 0 : 1;
      if (aOt !== bOt) return aOt - bOt;
      const aHome = (
        isPremiumClinic
          ? a.homeClinic === PREMIUM_CLINIC_GROUP || a.homeClinic === LEGACY_PREMIUM_CLINIC_GROUP
          : a.homeClinic === clinic
      )
        ? 0
        : 1;
      const bHome = (
        isPremiumClinic
          ? b.homeClinic === PREMIUM_CLINIC_GROUP || b.homeClinic === LEGACY_PREMIUM_CLINIC_GROUP
          : b.homeClinic === clinic
      )
        ? 0
        : 1;
      if (aHome !== bHome) return aHome - bHome;
      return compareStaffByPositionAndStartDate(a, b);
    });
  }, [allDailyWageStaff, otScheduledStaffNamesForShift, clinic, isPremiumClinic]);

  // Live 3-Point Verification across ALL 5 core workload buckets:
  // (1) Working staff entered == (3) Full department roster - (2) Leaves, Training & Outgoing Cross-Cover (0.5 / 1.0) + Incoming Cross-Cover/Substitute
  // IMPORTANT BUSINESS RULE: "ไปอบรม/ประชุม" counts as attendance in Menu 2 (NOT leave),
  // but does NOT count toward the unit's daily workload (deducted from expected unit working headcount).
  const dayStaffingCheck = useMemo(() => {
    const normalizeUnit = (c?: string) => {
      const trimmed = (c || '').trim();
      if (!trimmed) return '';
      if (
        isPremiumGroupName(trimmed) ||
        isPremiumPoolClinicName(trimmed) ||
        /-Premium$/i.test(trimmed) ||
        premiumSubClinics.includes(trimmed)
      ) {
        return PREMIUM_CLINIC_GROUP;
      }
      return trimmed;
    };
    const normalizePos = (pos?: string): StaffPosition => getWorkloadRolePosition(pos);
    const isActiveOnDate = (s: StaffMember) => {
      if (s.status !== 'Active') return false;
      if (s.startDate && s.startDate > date) return false;
      if (s.endDate && s.endDate < date) return false;
      return true;
    };

    const targetUnit = normalizeUnit(clinic);
    const staffUnitMap = new Map<string, string>();
    const staffPosMap = new Map<string, StaffPosition>();
    staffList.forEach(s => {
      if (s.name) {
        const cleanName = s.name.trim();
        staffUnitMap.set(cleanName, normalizeUnit(s.homeClinic));
        staffPosMap.set(cleanName, normalizePos(s.position));
      }
    });

    const baselineStaff = staffList.filter(
      s =>
        isActiveOnDate(s) &&
        normalizeUnit(s.homeClinic) === targetUnit &&
        normalizePos(s.position) !== 'HN'
    );
    const baseTotalAll = baselineStaff.length;
    const nursingPositions: StaffPosition[] = ['RN', 'PN', 'NA'];
    const baseTotalNursing = baselineStaff.filter(s =>
      nursingPositions.includes(normalizePos(s.position))
    ).length;

    const absents: { name: string; pos: StaffPosition; amount: number; kind: 'leave' | 'training' | 'outgoing' | 'off_duty'; detail: string }[] = [];
    const incomings: { name: string; pos: StaffPosition; amount: number; detail: string }[] = [];
    const trainings: { name: string; pos: StaffPosition; amount: number; detail: string }[] = [];
    const nonDeptSelections: string[] = [];
    const conflictErrors: string[] = [];

    const savedLeaveAmtByName = new Map<string, number>();
    const savedLeaveDetailsByName = new Map<string, string[]>();
    const savedTrainingAmtByName = new Map<string, number>();
    const savedTrainingDetailsByName = new Map<string, string[]>();
    const absentTrackKeys = new Set<string>();
    const incomingTrackKeys = new Set<string>();

    const needsStrictValidation = !isOutTime && !(isPremiumClinic && existingPremiumPool);

    const normWorkloadDate = normalizeLeaveDateStr(date) || date;

    if (needsStrictValidation) {
      // Saved leaves & training overlapping date for this department (deduplicated)
      uniqueLeaves.forEach(l => {
        const name = normalizeStaffNameKey(l.staffName);
        if (!name) return;
        const resolvedPos = staffPosMap.get(name) || normalizePos(l.position);
        const sDate = normalizeLeaveDateStr(l.startDate);
        const eDate = normalizeLeaveDateStr(l.endDate || l.startDate) || sDate;
        if (!sDate || normWorkloadDate < sDate || normWorkloadDate > eDate) return;
        const unit = normalizeUnit(l.clinic || staffUnitMap.get(name) || '');
        if (unit !== targetUnit) return;

        const isSingleDayHalf = sDate === eDate && Number(l.days) === 0.5;
        const amt = isSingleDayHalf ? 0.5 : 1;
        const pLabel = isSingleDayHalf ? parseLeavePeriodFromNote(l.note) : '';

        if (isTrainingLeaveType(l.leaveType)) {
          const tKey = `TRN|${name}|${pLabel || 'FULL'}`;
          if (absentTrackKeys.has(tKey)) return;
          absentTrackKeys.add(tKey);

          savedTrainingAmtByName.set(name, Math.min(1, (savedTrainingAmtByName.get(name) || 0) + amt));
          const trDesc = `ไปอบรม/ประชุม${isSingleDayHalf ? ` 0.5 ${pLabel || 'ครึ่งวัน'}` : ''}`;
          const prevTr = savedTrainingDetailsByName.get(name) || [];
          savedTrainingDetailsByName.set(name, [...prevTr, trDesc]);

          const detailText = `${name} (${trDesc} - ไม่นับภาระงานหน่วย)`;
          trainings.push({
            name,
            pos: resolvedPos,
            amount: amt,
            detail: detailText,
          });
          absents.push({
            name,
            pos: resolvedPos,
            amount: amt,
            kind: 'training',
            detail: detailText,
          });
          return;
        }

        const tKey = `LV|${name}|${pLabel || 'FULL'}`;
        if (absentTrackKeys.has(tKey)) return;
        absentTrackKeys.add(tKey);

        savedLeaveAmtByName.set(name, Math.min(1, (savedLeaveAmtByName.get(name) || 0) + amt));
        const desc = `${l.leaveType}${isSingleDayHalf ? ` 0.5 ${pLabel || 'ครึ่งวัน'}` : ''}`;
        const prevDescs = savedLeaveDetailsByName.get(name) || [];
        savedLeaveDetailsByName.set(name, [...prevDescs, desc]);

        absents.push({
          name,
          pos: resolvedPos,
          amount: amt,
          kind: 'leave',
          detail: `${name} (${desc})`,
        });
      });

      // Selected in Section 4 Block 1: Per-person Leave (disallow duplicate same-day leave if already in DB)
      if (hasStaffLeave) {
        selectedLeaveItems.forEach(item => {
          const st = staffList.find(s => s.staffId === item.staffId);
          if (!st) return;
          if (normalizeUnit(st.homeClinic) !== targetUnit) {
            nonDeptSelections.push(`${st.name} (สังกัด ${st.homeClinic} ไม่ใช่แผนก ${clinic})`);
            return;
          }
          const cleanStName = normalizeStaffNameKey(st.name);
          const itemPeriod: HalfDayPeriod =
            item.days === 0.5 ? (item.periodLabel || 'ครึ่งวันเช้า') : '';
          const globalConflict = uniqueLeaves.find(l =>
            isLeaveDuplicateConflict(l, {
              staffName: cleanStName,
              leaveType: item.leaveType,
              startDate: normWorkloadDate,
              endDate: normWorkloadDate,
              days: item.days,
              note: item.days === 0.5 ? itemPeriod : '',
            })
          );
          const existingSavedAmt = savedLeaveAmtByName.get(cleanStName) || 0;
          const existingDescs = savedLeaveDetailsByName.get(cleanStName) || [];

          if (globalConflict || existingSavedAmt > 0 || existingDescs.length > 0) {
            const conflictDesc =
              existingDescs.length > 0
                ? existingDescs.join(', ')
                : `${globalConflict?.leaveType || 'การลา'} (${globalConflict?.days || 1} วัน)`;
            conflictErrors.push(
              `${st.name} มีประวัติการลา (${conflictDesc}) ในวันที่ ${formatThaiShortDate(date)} อยู่ในฐานข้อมูลแล้ว ไม่สามารถบันทึกวันลาซ้ำในวันเดียวกันได้`
            );
            return;
          }

          const tKey = `LV|${st.name}|${itemPeriod || 'FULL'}`;
          if (!absentTrackKeys.has(tKey)) {
            absentTrackKeys.add(tKey);
            absents.push({
              name: st.name,
              pos: normalizePos(st.position),
              amount: item.days,
              kind: 'leave',
              detail: `${st.name} (${item.leaveType}${item.days === 0.5 ? ` 0.5 ${itemPeriod}` : ''})`,
            });
          }
        });
      }

      // Selected in Section 4 Block 2: Training / Meeting (Counts as attendance in Menu 2, deducted from unit daily workload)
      if (hasTraining) {
        selectedTrainingItems.forEach(item => {
          const st = staffList.find(s => s.staffId === item.staffId);
          if (!st) return;
          if (normalizeUnit(st.homeClinic) !== targetUnit) {
            nonDeptSelections.push(`${st.name} ไปอบรม/ประชุม (สังกัด ${st.homeClinic} ไม่ใช่แผนก ${clinic})`);
            return;
          }
          const cleanTrName = normalizeStaffNameKey(st.name);
          const itemPeriodTr: HalfDayPeriod =
            item.days === 0.5 ? (item.periodLabel || 'ครึ่งวันเช้า') : '';
          const globalTrConflict = uniqueLeaves.find(l =>
            isTrainingLeaveType(l.leaveType) &&
            isLeaveDuplicateConflict(l, {
              staffName: cleanTrName,
              leaveType: 'ไปอบรม/ประชุม',
              startDate: normWorkloadDate,
              endDate: normWorkloadDate,
              days: item.days,
              note: item.days === 0.5 ? itemPeriodTr : '',
            })
          );
          const existingSavedTrAmt = savedTrainingAmtByName.get(cleanTrName) || 0;
          const existingTrDescs = savedTrainingDetailsByName.get(cleanTrName) || [];
          if (globalTrConflict || existingSavedTrAmt > 0 || existingTrDescs.length > 0) {
            const trDesc = existingTrDescs.length > 0 ? existingTrDescs.join(', ') : 'ไปอบรม/ประชุม';
            conflictErrors.push(
              `${st.name} มีประวัติ (${trDesc}) ในวันที่ ${formatThaiShortDate(date)} อยู่ในฐานข้อมูลแล้ว ไม่สามารถบันทึกซ้ำในวันเดียวกันได้`
            );
            return;
          }
          const leaveSum = absents
            .filter(a => normalizeStaffNameKey(a.name) === cleanTrName && a.kind === 'leave')
            .reduce((s, a) => s + a.amount, 0);
          if (leaveSum + item.days > 1.001) {
            conflictErrors.push(
              `${st.name} มียอดวันลา (${leaveSum}) และไปอบรม/ประชุม (${item.days}) รวมกันเกิน 1 วันในวันเดียวกัน`
            );
            return;
          }
          const itemPeriod: HalfDayPeriod =
            item.days === 0.5 ? (item.periodLabel || 'ครึ่งวันเช้า') : '';
          const tKey = `TRN|${st.name}|${itemPeriod || 'FULL'}`;
          if (!absentTrackKeys.has(tKey)) {
            absentTrackKeys.add(tKey);
            const detailText = `${st.name} (ไปอบรม/ประชุม${item.days === 0.5 ? ` 0.5 ${itemPeriod}` : ''} - ไม่นับภาระงานหน่วย)`;
            trainings.push({
              name: st.name,
              pos: normalizePos(st.position),
              amount: item.days,
              detail: detailText,
            });
            absents.push({
              name: st.name,
              pos: normalizePos(st.position),
              amount: item.days,
              kind: 'training',
              detail: detailText,
            });
          }
        });
      }

      // Selected in Section 4 Block 4: Daily Wage Staff Off เวร (ยอดผู้ป่วยน้อยลง — ไม่นับเป็นวันลา แต่หักจากยอดปฏิบัติงานในหน่วย)
      if (hasStaffOffDuty) {
        selectedOffDutyStaffItems.forEach(item => {
          const st = staffList.find(s => s.staffId === item.staffId);
          if (!st) return;
          if (!isDailyWagePosition(st.position)) {
            conflictErrors.push(
              `${st.name} ไม่ใช่เจ้าหน้าที่ตำแหน่งงาน "รายวัน" (Off เวรใช้สำหรับเจ้าหน้าที่รายวันกรณียอดผู้ป่วยน้อยลงเท่านั้น)`
            );
            return;
          }
          if (normalizeUnit(st.homeClinic) !== targetUnit) {
            nonDeptSelections.push(`${st.name} (Off เวรรายวัน - สังกัด ${st.homeClinic} ไม่ใช่แผนก ${clinic})`);
            return;
          }
          const existingCombined = absents
            .filter(a => a.name === st.name && (a.kind === 'leave' || a.kind === 'training'))
            .reduce((s, a) => s + a.amount, 0);
          if (existingCombined + item.amount > 1.001) {
            conflictErrors.push(
              `${st.name} มียอดวันลา/อบรม (${existingCombined}) และ Off เวร (${item.amount}) รวมกันเกิน 1 วันในวันเดียวกัน`
            );
            return;
          }
          const itemPeriod: OffDutyPeriodLabel =
            item.amount === 0.5 ? (item.periodLabel || 'ครึ่งวันเช้า') : '';
          const tKey = `OFFS|${st.name}|${itemPeriod || 'FULL'}`;
          if (!absentTrackKeys.has(tKey)) {
            absentTrackKeys.add(tKey);
            const reasonSuffix = item.reason.trim() ? ` - ${item.reason.trim()}` : '';
            absents.push({
              name: st.name,
              pos: normalizePos(st.position),
              amount: item.amount,
              kind: 'off_duty',
              detail: `${st.name} [รายวัน] (Off เวร${item.amount === 0.5 ? ` 0.5 ${itemPeriod}` : ''}${reasonSuffix})`,
            });
          }
        });
      }

      // Saved OT / Cross-Cover on this date (daytime shifts)
      otRecords.forEach(o => {
        if (o.date !== date) return;
        if (o.shift !== 'ในเวลา 08:00-16:00' && o.shift !== 'OT ในเวลาราชการ 08:00-16:00') return;
        const cleanOtName = (o.staffName || '').trim();
        const pos = (cleanOtName && staffPosMap.get(cleanOtName)) || normalizePos(o.position);
        const parsedWork = parseOtWorkClinic(o.workClinic);
        const hUnit = normalizeUnit(o.homeClinic || staffUnitMap.get(cleanOtName) || '');
        const wUnit = normalizeUnit(parsedWork.clinic);
        const amt = parsedWork.amount;
        const pSuffix = amt === 0.5 && parsedWork.periodLabel ? ` 0.5 ${parsedWork.periodLabel}` : '';

        if (hUnit === targetUnit && wUnit !== targetUnit && wUnit) {
          const tKey = `OUT|${o.staffName}|${wUnit}|${parsedWork.periodLabel || 'FULL'}`;
          if (!absentTrackKeys.has(tKey)) {
            absentTrackKeys.add(tKey);
            absents.push({
              name: o.staffName,
              pos,
              amount: amt,
              kind: 'outgoing',
              detail: `${o.staffName} (ไปช่วย ${parsedWork.clinic}${pSuffix})`,
            });
          }
        }
        if (
          wUnit === targetUnit &&
          (hUnit !== targetUnit || Boolean(o.isExternal) || o.shift === 'OT ในเวลาราชการ 08:00-16:00')
        ) {
          const tKey = `IN|${o.staffName}|${parsedWork.periodLabel || 'FULL'}`;
          if (!incomingTrackKeys.has(tKey)) {
            incomingTrackKeys.add(tKey);
            const src = o.affiliation || (hUnit !== targetUnit ? o.homeClinic : '');
            incomings.push({
              name: o.staffName,
              pos,
              amount: amt,
              detail: `${o.staffName} (${
                o.shift === 'OT ในเวลาราชการ 08:00-16:00' || o.isExternal ? 'ขึ้นแทน' : 'มาช่วย'
              }${src ? ` จาก ${src}` : ''}${pSuffix})`,
            });
          }
        }
      });

      // Selected in Section 4 Block 3: Outgoing & Incoming Cross-Cover (0.5 or 1.0)
      effectiveCrossItems.forEach(item => {
        const amt = item.amount === 0.5 ? 0.5 : 1;
        const pSuffix = amt === 0.5 && item.periodLabel ? ` 0.5 ${item.periodLabel}` : '';
        if (item.direction === 'outgoing') {
          const st = staffList.find(s => s.name === item.staffName);
          if (!st) return;
          if (normalizeUnit(st.homeClinic) !== targetUnit) {
            nonDeptSelections.push(`${st.name} ไปช่วยห้องอื่น (สังกัด ${st.homeClinic} ไม่ใช่แผนก ${clinic})`);
            return;
          }
          const destUnit = normalizeUnit(item.otherClinic);
          if (destUnit && destUnit !== targetUnit) {
            const tKey = `OUT|${st.name}|${destUnit}|${item.periodLabel || 'FULL'}`;
            if (!absentTrackKeys.has(tKey)) {
              absentTrackKeys.add(tKey);
              absents.push({
                name: st.name,
                pos: normalizePos(st.position),
                amount: amt,
                kind: 'outgoing',
                detail: `${st.name} (ไปช่วย ${item.otherClinic}${pSuffix})`,
              });
            }
          }
        } else {
          // Incoming helper to current unit
          const srcUnit = normalizeUnit(item.otherClinic);
          if (!item.isExternal && srcUnit === targetUnit) {
            conflictErrors.push(`${item.staffName} เป็นสมาชิกแผนก ${clinic} อยู่แล้ว กรุณาเลือกผู้มาช่วยจากแผนกอื่น`);
            return;
          }
          const tKey = `IN|${item.staffName}|${item.periodLabel || 'FULL'}`;
          if (!incomingTrackKeys.has(tKey)) {
            incomingTrackKeys.add(tKey);
            incomings.push({
              name: item.staffName,
              pos: normalizePos(item.position),
              amount: amt,
              detail: `${item.staffName} (${item.isExternal ? 'ขึ้นแทน' : 'มาช่วย'} จาก ${item.otherClinic}${pSuffix})`,
            });
          }
        }
      });
    }

    const enteredByPos: Record<StaffPosition, number> = {
      HN: 0,
      RN: Number(rn) || 0,
      PN: Number(pn) || 0,
      NA: Number(na) || 0,
      PCA: 0,
      Clerk: Number(clerk) || 0,
      'Clerk (Referral)': 0,
      'Service Worker': Number(serviceWorker) || 0,
      'RN (Daily Wage)': 0,
      'PN (Daily Wage)': 0,
      'NA (Daily Wage)': 0,
      'Clerk (Daily Wage)': 0,
      'Service Worker (Daily Wage)': 0,
    };

    const positionShortLabels: Record<StaffPosition, string> = {
      HN: 'HN (หัวหน้าเวร)',
      RN: 'RN (พยาบาลวิชาชีพ)',
      PN: 'PN (ผู้ช่วยพยาบาล)',
      NA: 'NA (ผู้ช่วยคนไข้)',
      PCA: 'NA',
      Clerk: 'ผู้ปฏิบัติงานทั่วไป',
      'Clerk (Referral)': 'ผู้ปฏิบัติงานทั่วไป (ศูนย์รับ-ส่งต่อ • เทียบเท่า NA)',
      'Service Worker': 'พนักงานบริการ',
      'RN (Daily Wage)': 'พยาบาล(จ้างรายวัน)',
      'PN (Daily Wage)': 'ผู้ช่วยพยาบาล(จ้างรายวัน)',
      'NA (Daily Wage)': 'ผู้ช่วยคนไข้(จ้างรายวัน)',
      'Clerk (Daily Wage)': 'ผู้ปฏิบัติงานทั่วไป(จ้างรายวัน)',
      'Service Worker (Daily Wage)': 'พนักงานบริการ(จ้างรายวัน)',
    };

    const trackedPositions = ALL_POSITIONS.filter(
      pos => pos !== 'HN' && pos !== 'Clerk (Referral)' && !isDailyWagePosition(pos)
    );

    const positionRows = trackedPositions.map(pos => {
      const full = baselineStaff.filter(s => normalizePos(s.position) === pos).length;
      const working = enteredByPos[pos] || 0;
      const absent = Number(
        absents
          .filter(a => a.pos === pos)
          .reduce((s, a) => s + a.amount, 0)
          .toFixed(1)
      );
      const incoming = Number(
        incomings
          .filter(i => i.pos === pos)
          .reduce((s, i) => s + i.amount, 0)
          .toFixed(1)
      );
      const expectedWorking = Math.max(0, Number((full - absent + incoming).toFixed(1)));
      const accounted = Number((working + absent - incoming).toFixed(1));
      const diff = Number((accounted - full).toFixed(1));
      const isBalanced = Math.abs(diff) < 0.001;

      let issueText = '';
      if (!isBalanced) {
        if (diff < 0) {
          const lack = Math.abs(diff);
          issueText = `${positionShortLabels[pos]}: ประจำ ${full} คน แต่ปฏิบัติงาน (${working}) + ลา/อบรม/ไปช่วย (${absent})${
            incoming > 0 ? ` − มาช่วย (${incoming})` : ''
          } = ${accounted} คน (ต้องระบุผู้ลา/อบรม หรือไปช่วยห้องอื่นเพิ่ม ${lack} แรง หรือปรับยอดปฏิบัติงานเป็น ${expectedWorking})`;
        } else {
          issueText = `${positionShortLabels[pos]}: ประจำ ${full} คน แต่ปฏิบัติงาน (${working}) + ลา/อบรม/ไปช่วย (${absent})${
            incoming > 0 ? ` − มาช่วย (${incoming})` : ''
          } = ${accounted} คน (เกินจำนวนเต็ม +${diff} แรง — หากมีคนจากห้องอื่น/ภายนอกมาช่วย ${diff} แรง ให้เพิ่มในหัวข้อ 'ไปช่วย/รับคนมาช่วย' หรือลดยอดลา/อบรม/ปรับปฏิบัติงานเป็น ${expectedWorking})`;
        }
      }

      return {
        pos,
        label: positionShortLabels[pos],
        full,
        working,
        absent,
        incoming,
        expectedWorking,
        accounted,
        diff,
        isBalanced,
        issueText,
      };
    });

    const totalAbsentAll = Number(positionRows.reduce((s, r) => s + r.absent, 0).toFixed(1));
    const totalIncomingAll = Number(positionRows.reduce((s, r) => s + r.incoming, 0).toFixed(1));

    const activePositionRows = positionRows.filter(
      r => r.full > 0 || r.working > 0 || r.absent > 0 || r.incoming > 0
    );

    const getExpected = (p: StaffPosition) =>
      positionRows.find(r => r.pos === p)?.expectedWorking ?? 0;

    const expectedHN = 0;
    const expectedRN = getExpected('RN');
    const expectedPN = getExpected('PN');
    const expectedNA = getExpected('NA');
    const expectedClerk = getExpected('Clerk');
    const expectedServiceWorker = getExpected('Service Worker');

    const expectedTotalNursing = Number((expectedRN + expectedPN + expectedNA).toFixed(1));
    const enteredTotalNursing = Number((rn + pn + na).toFixed(1));
    const expectedTotalAll = Math.max(
      0,
      Number((baseTotalAll - totalAbsentAll + totalIncomingAll).toFixed(1))
    );
    const enteredTotalAll = Number((rn + pn + na + clerk + serviceWorker).toFixed(1));

    const isStrictActive = needsStrictValidation && baseTotalAll > 0;
    const allPositionsBalanced = positionRows.every(r => r.isBalanced);
    const hasNonDeptIssue = needsStrictValidation && nonDeptSelections.length > 0;
    const hasConflictIssue = needsStrictValidation && conflictErrors.length > 0;

    const validationErrors: string[] = [];
    if (hasNonDeptIssue) {
      validationErrors.push(`พบรายชื่อที่เลือกไม่ได้สังกัดแผนก ${clinic}: ${nonDeptSelections.join(', ')}`);
    }
    if (hasConflictIssue) {
      validationErrors.push(...conflictErrors);
    }
    if (isStrictActive) {
      positionRows.forEach(r => {
        if (!r.isBalanced && r.issueText) {
          validationErrors.push(r.issueText);
        }
      });
    }

    const canSave3Points =
      !hasNonDeptIssue && !hasConflictIssue && (!isStrictActive || allPositionsBalanced);

    return {
      isOutTime,
      needsStrictValidation,
      isStrictActive,
      baseTotal: baseTotalNursing,
      baseTotalAll,
      absents,
      incomings,
      trainings,
      totalAbsentAll,
      totalIncomingAll,
      nonDeptSelections,
      positionRows,
      activePositionRows,
      expectedHN,
      expectedRN,
      expectedPN,
      expectedNA,
      expectedClerk,
      expectedServiceWorker,
      expectedTotal: expectedTotalNursing,
      enteredTotal: enteredTotalNursing,
      expectedTotalAll,
      enteredTotalAll,
      diff: Number((enteredTotalAll - expectedTotalAll).toFixed(1)),
      canSave3Points,
      validationErrors,
      isMatch: baseTotalAll > 0 && allPositionsBalanced && !hasNonDeptIssue && !hasConflictIssue,
    };
  }, [
    date,
    clinic,
    isOutTime,
    isPremiumClinic,
    existingPremiumPool,
    staffList,
    uniqueLeaves,
    otRecords,
    hn,
    rn,
    pn,
    na,
    clerk,
    serviceWorker,
    hasStaffLeave,
    selectedLeaveItems,
    hasTraining,
    selectedTrainingItems,
    hasStaffOffDuty,
    selectedOffDutyStaffItems,
    effectiveCrossItems,
    premiumSubClinics,
  ]);

  const applyExpectedAllPositions = () => {
    setHn(0);
    setRn(dayStaffingCheck.expectedRN);
    setPn(dayStaffingCheck.expectedPN);
    setNa(dayStaffingCheck.expectedNA);
    setClerk(dayStaffingCheck.expectedClerk);
    setServiceWorker(dayStaffingCheck.expectedServiceWorker);
    setFormError('');
  };

  const adjustStaff = (setter: React.Dispatch<React.SetStateAction<number>>, delta: number) => {
    setter(prev => Math.max(0, Math.round((prev + delta) * 10) / 10));
  };

  const formErrorRef = useRef<HTMLDivElement | null>(null);
  const reporterInputRef = useRef<HTMLInputElement | null>(null);

  const scrollToFormError = (focusReporter = false) => {
    setTimeout(() => {
      if (focusReporter) {
        reporterInputRef.current?.focus();
        reporterInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        formErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 30);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setFormError('');

    if (existingDuplicateWorkload) {
      setFormError(
        `ไม่สามารถบันทึกซ้ำได้: แผนก ${clinic} วันที่ ${formatThaiShortDate(date)} กะเวลา "${shift}" มีข้อมูลอยู่ในระบบแล้ว (รายงานโดย ${existingDuplicateWorkload.reporter || '-'})`
      );
      scrollToFormError();
      return;
    }

    if (!reporter.trim()) {
      setFormError('กรุณาระบุชื่อผู้รายงานก่อนบันทึก');
      scrollToFormError(true);
      return;
    }

    if (hasStaffOffDuty && selectedOffDutyStaffItems.length === 0) {
      setFormError(
        'กรุณาเลือกเจ้าหน้าที่ตำแหน่งงาน "รายวัน" อย่างน้อย 1 คนสำหรับ Off เวร (หรือปิดหัวข้อ Off เวร)'
      );
      scrollToFormError();
      return;
    }

    if (!dayStaffingCheck.canSave3Points) {
      setFormError(
        `ไม่สามารถบันทึกภาระงานได้ — ข้อมูล 3 จุด (ปฏิบัติงานจริง + วันลา/อบรม/Off เวรรายวัน/ช่วยงานในแผนก + จำนวนเต็มประจำแผนก) ไม่ตรงกัน: ${dayStaffingCheck.validationErrors.join(' | ')}`
      );
      scrollToFormError();
      return;
    }

    if (!isOutTime && hasStaffLeave && selectedLeaveItems.length > 0) {
      const missingReasonItems = selectedLeaveItems.filter(
        item => !hasValidLeaveReason(item.leaveType, item.note)
      );
      if (missingReasonItems.length > 0) {
        const missingDetails = missingReasonItems.map(item => {
          const staff = staffList.find(s => s.staffId === item.staffId);
          return `${staff?.name || item.staffId} (${item.leaveType})`;
        });
        setFormError(
          `กรุณาระบุเหตุผลการลาให้ครบก่อนบันทึก (บังคับใส่เหตุผลทุกครั้งสำหรับ ลากิจ/ลาป่วย ยกเว้นลาพักผ่อน): ${missingDetails.join(', ')}`
        );
        scrollToFormError();
        return;
      }
    }

    let leaveData: WorkloadLeavePayload[] | null = null;
    if (!isOutTime && hasStaffLeave && selectedLeaveItems.length > 0) {
      leaveData = selectedLeaveItems.map(item => {
        const staff = staffList.find(s => s.staffId === item.staffId);
        return {
          staffName: staff?.name || item.staffId,
          leaveType: item.leaveType,
          days: item.days,
          periodLabel: item.days === 0.5 ? (item.periodLabel || 'ครึ่งวันเช้า') : '',
          note:
            item.note.trim() ||
            (isLeaveReasonRequired(item.leaveType) ? '' : `บันทึกอัตโนมัติจากห้องตรวจ ${clinic}`),
        };
      });
    }

    let trainingData: WorkloadTrainingPayload[] | null = null;
    if (!isOutTime && hasTraining && selectedTrainingItems.length > 0) {
      trainingData = selectedTrainingItems.map(item => {
        const staff = staffList.find(s => s.staffId === item.staffId);
        return {
          staffName: staff?.name || item.staffId,
          days: item.days,
          periodLabel: item.days === 0.5 ? (item.periodLabel || 'ครึ่งวันเช้า') : '',
          topic: trainingTopic.trim() || 'ไปอบรม/ประชุม',
          note: trainingNote.trim(),
        };
      });
    }

    let crossCoverageData: WorkloadCrossCoveragePayload[] | null = null;
    if (hasCrossCover && effectiveCrossItems.length > 0) {
      crossCoverageData = effectiveCrossItems.map(item => {
        if (item.direction === 'outgoing') {
          const st = staffList.find(s => s.name === item.staffName);
          return {
            direction: 'outgoing',
            staffName: item.staffName,
            position: st?.position || item.position,
            homeClinic: st?.homeClinic || clinic,
            targetClinic: item.otherClinic,
            amount: item.amount,
            periodLabel: item.amount === 0.5 ? (item.periodLabel || 'ครึ่งวันเช้า') : '',
            isExternal: false,
            shift,
          };
        }
        const st = staffList.find(s => s.name === item.staffName);
        return {
          direction: 'incoming',
          staffName: item.staffName,
          position: item.isExternal ? item.position : st?.position || item.position,
          homeClinic: item.otherClinic,
          targetClinic: clinic,
          amount: item.amount,
          periodLabel: item.amount === 0.5 ? (item.periodLabel || 'ครึ่งวันเช้า') : '',
          isExternal: item.isExternal,
          affiliation: item.isExternal ? item.otherClinic : undefined,
          shift: item.isExternal ? 'OT ในเวลาราชการ 08:00-16:00' : shift,
        };
      });
    }

    const resolvedOffDutyStaff: OffDutyStaffEntry[] =
      hasStaffOffDuty && selectedOffDutyStaffItems.length > 0
        ? selectedOffDutyStaffItems
            .map((item) => {
              const st = staffList.find((s) => s.staffId === item.staffId);
              if (!st || !isDailyWagePosition(st.position)) return null;
              return {
                staffName: st.name,
                position: st.position,
                amount: item.amount,
                ...(item.amount === 0.5
                  ? { periodLabel: item.periodLabel || (isOutTime ? 'ครึ่งเวร' : 'ครึ่งวันเช้า') }
                  : {}),
                ...(item.reason.trim() ? { reason: item.reason.trim() } : {}),
              } as OffDutyStaffEntry;
            })
            .filter((x): x is OffDutyStaffEntry => Boolean(x))
        : [];

    if (isPremiumClinic) {
      const activeSubs = premiumSubClinics
        .map(sub => {
          const item = premiumInputs[sub];
          const adult = Number(item?.adultPt || 0);
          const child = Number(item?.childPt || 0);
          const adm = Number(item?.admit || 0);
          return { sub, adult, child, total: adult + child, admit: adm };
        })
        .filter(item => item.total > 0 || item.admit > 0);

      if (activeSubs.length === 0) {
        setFormError(
          existingPremiumPool
            ? 'พบกำลังคนรวมในกะนี้แล้ว กรุณากรอกยอดผู้ป่วยหรือ Admit อย่างน้อย 1 แผนกย่อยที่ยังไม่เคยบันทึกในกะนี้'
            : 'กรุณากรอกยอดผู้ป่วยหรือ Admit อย่างน้อย 1 แผนกย่อยในตารางศูนย์ปัญญาภิรมย์'
        );
        return;
      }

      const duplicateSubs = activeSubs.filter(item => existingPremiumSubClinics.has(item.sub));
      if (duplicateSubs.length > 0) {
        setFormError(
          `ไม่สามารถบันทึกซ้ำได้: แผนกย่อย (${duplicateSubs.map(d => d.sub).join(', ')}) ในวันที่ ${formatThaiShortDate(date)} กะเวลา "${shift}" มีการบันทึกไว้แล้ว`
        );
        return;
      }

      const nowMs = Date.now();
      const nowIso = new Date().toISOString();
      const poolId = existingPremiumPool?.poolId || `POOL-${date}-${nowMs}`;
      const recordsToSave: DailyWorkload[] = [];

      if (!existingPremiumPool) {
        recordsToSave.push({
          id: `WL-POOL-${nowMs}`,
          date,
          shift,
          clinic: PREMIUM_POOL_CLINIC_NAME,
          totalPt: 0,
          adultPt: 0,
          childPt: 0,
          admit: 0,
          hn: Number(hn) || 0,
          rn: Number(rn) || 0,
          pn: Number(pn) || 0,
          na: Number(na) || 0,
          pca: Number(na) || 0,
          clerk: Number(clerk) || 0,
          serviceWorker: Number(serviceWorker) || 0,
          note: note.trim(),
          reporter: reporter.trim(),
          clinicGroup: PREMIUM_CLINIC_GROUP,
          poolId,
          recordType: 'PREMIUM_POOL',
          ...(resolvedOffDutyStaff.length > 0 ? { offDutyStaff: resolvedOffDutyStaff } : {}),
          timestamp: nowIso,
        });
      }

      activeSubs.forEach((subItem, idx) => {
        recordsToSave.push({
          id: `WL-SUB-${nowMs}-${idx}`,
          date,
          shift,
          clinic: subItem.sub,
          totalPt: subItem.total,
          adultPt: subItem.adult,
          childPt: subItem.child,
          admit: subItem.admit,
          hn: 0,
          rn: 0,
          pn: 0,
          na: 0,
          pca: 0,
          clerk: 0,
          serviceWorker: 0,
          note: note.trim(),
          reporter: reporter.trim(),
          clinicGroup: PREMIUM_CLINIC_GROUP,
          poolId,
          recordType: 'PREMIUM_SUB',
          timestamp: nowIso,
        });
      });

      submittingRef.current = true;
      setIsSubmitting(true);
      try {
        if (onSaveBatchWorkloads) {
          await Promise.resolve(
            onSaveBatchWorkloads(recordsToSave, leaveData, crossCoverageData, trainingData)
          );
        } else {
          for (let idx = 0; idx < recordsToSave.length; idx++) {
            await Promise.resolve(
              onSaveWorkload(
                recordsToSave[idx],
                idx === 0 ? leaveData : null,
                idx === 0 ? crossCoverageData : null,
                idx === 0 ? trainingData : null
              )
            );
          }
        }
      } finally {
        submittingRef.current = false;
        setIsSubmitting(false);
      }

      setPremiumInputs({});
      setNote('');
      setHasStaffOffDuty(false);
      setSelectedOffDutyStaffItems([]);
      setOffDutyStaffSearch('');
      setShowAllOpdDailyWageInTime(false);
      setHasStaffLeave(false);
      setSelectedLeaveItems([]);
      setLeaveSearch('');
      setHasTraining(false);
      setSelectedTrainingItems([]);
      setTrainingSearch('');
      setTrainingTopic('');
      setTrainingNote('');
      setHasCrossCover(false);
      setCrossStaffSearch('');
      setCrossStaffName('');
      setCrossOtherClinic('');
      setCrossAmount(1);
      setCrossPeriod('');
      setCrossItems([]);
      return;
    }

    const normalizedReferral = isReferralClinic
      ? normalizeReferralData(referralInputs)
      : undefined;
    const finalTotal = isReferralClinic
      ? getReferralTotalCount(normalizedReferral)
      : Math.max(Number(totalPt) || 0, (Number(adultPt) || 0) + (Number(childPt) || 0));
    const calculatedChild = isReferralClinic ? 0 : Number(childPt) || 0;
    const calculatedAdult = isReferralClinic
      ? 0
      : isEchoClinic
        ? Number(adultPt) || 0
        : Math.max(0, finalTotal - calculatedChild);
    const finalAdmit = isReferralClinic
      ? getReferralAdmitCount(normalizedReferral)
      : Number(admit) || 0;

    const newEntry: DailyWorkload = {
      id: `WL-${Date.now()}`,
      date,
      shift,
      clinic,
      totalPt: finalTotal,
      adultPt: calculatedAdult,
      childPt: calculatedChild,
      admit: finalAdmit,
      hn: Number(hn) || 0,
      rn: Number(rn) || 0,
      pn: Number(pn) || 0,
      na: Number(na) || 0,
      pca: Number(na) || 0,
      clerk: Number(clerk) || 0,
      serviceWorker: Number(serviceWorker) || 0,
      note: note.trim(),
      reporter: reporter.trim(),
      clinicGroup: '',
      poolId: '',
      recordType: 'STANDARD',
      ...(normalizedReferral ? { referralData: normalizedReferral } : {}),
      ...(resolvedOffDutyStaff.length > 0 ? { offDutyStaff: resolvedOffDutyStaff } : {}),
      timestamp: new Date().toISOString(),
    };

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await Promise.resolve(onSaveWorkload(newEntry, leaveData, crossCoverageData, trainingData));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }

    // Reset sensitive fields & restore active clinic roster defaults
    setHasStaffOffDuty(false);
    setSelectedOffDutyStaffItems([]);
    setOffDutyStaffSearch('');
    setShowAllOpdDailyWageInTime(false);
    setTotalPt(0);
    setAdultPt(0);
    setChildPt(0);
    setAdmit(0);
    setHn(0);
    setRn(isOutTime ? 0 : baselinePositionCounts.rn);
    setPn(isOutTime ? 0 : baselinePositionCounts.pn);
    setNa(isOutTime ? 0 : baselinePositionCounts.na);
    setClerk(isOutTime ? 0 : baselinePositionCounts.clerk);
    setServiceWorker(isOutTime ? 0 : baselinePositionCounts.serviceWorker);
    setReferralInputs(createEmptyReferralData());
    setNote('');
    setHasStaffLeave(false);
    setSelectedLeaveItems([]);
    setLeaveSearch('');
    setHasTraining(false);
    setSelectedTrainingItems([]);
    setTrainingSearch('');
    setTrainingTopic('');
    setTrainingNote('');
    setHasCrossCover(false);
    setCrossStaffSearch('');
    setCrossStaffName('');
    setCrossOtherClinic('');
    setCrossAmount(1);
    setCrossPeriod('');
    setCrossItems([]);
  };

  // Filter workloads for selected date
  const todayWorkloads = workloads.filter(w => w.date === date);

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 border border-emerald-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <ClipboardPen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-emerald-950">
              เมนูที่ 1: บันทึกภาระงานประจำวัน (Daily Clinic Workload Entry)
            </h2>
            <p className="text-xs text-emerald-800">
              บันทึกสถิติผู้ป่วย, Admit, และกำลังคนปฏิบัติงานจริง (รองรับ 0.5 แรง) พร้อมซิงค์ชีทอัตโนมัติ
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 bg-white/80 px-3 py-1.5 rounded-lg border border-emerald-200">
          <Calendar className="w-4 h-4 text-emerald-600" />
          <span>วันที่เลือก: {formatThaiShortDate(date)}</span>
          <span className="text-emerald-400">|</span>
          <span className="text-emerald-700 font-bold">{todayWorkloads.length} รายการ</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:items-stretch">
        {/* Left Form: 7 cols */}
        <div className="lg:col-span-7 flex flex-col min-w-0">
          <form onSubmit={handleSubmit} noValidate className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 sm:p-6 space-y-5 flex-1 flex flex-col">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                ข้อมูลห้องตรวจและกะเวลา
              </h3>
              <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                {isOutTime ? `กะนอกเวลา (${availableClinics.length} ห้อง)` : `กะในเวลา (${availableClinics.length} ห้อง)`}
              </span>
            </div>

            {/* Row 1: Date (พ.ศ.), Shift, Clinic */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  วันที่ปฏิบัติงาน <span className="text-red-500">*</span>
                </label>
                <ThaiDateInput
                  value={date}
                  onChange={setDate}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  กะเวลา <span className="text-red-500">*</span>
                </label>
                <select
                  value={shift}
                  onChange={(e) => handleShiftChange(e.target.value as WorkShift)}
                  required
                  className="w-full text-sm rounded-lg border-gray-300 shadow-2xs focus:border-emerald-500 focus:ring-emerald-500 py-2 px-3 border bg-white"
                >
                  <option value="ในเวลา 08:00-16:00">ในเวลา 08:00-16:00</option>
                  <option value="นอกเวลาเย็น 16:00-20:00">นอกเวลาเย็น 16:00-20:00</option>
                  <option value="นอกเวลาวันหยุด 08:00-12:00">นอกเวลาวันหยุด 08:00-12:00</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                  <Building className="w-3.5 h-3.5 text-gray-400" />
                  ห้องตรวจ / แผนก <span className="text-red-500">*</span>
                </label>
                <select
                  value={clinic}
                  onChange={(e) => {
                    setClinic(e.target.value);
                    setHasStaffOffDuty(false);
                    setSelectedOffDutyStaffItems([]);
                    setOffDutyStaffSearch('');
                    setShowAllOpdDailyWageInTime(false);
                    setFormError('');
                  }}
                  required
                  className={`w-full text-sm rounded-lg shadow-2xs py-2 px-3 border bg-white font-medium ${
                    isPremiumClinic
                      ? 'border-orange-400 text-orange-950 focus:border-orange-500 focus:ring-orange-500'
                      : 'border-gray-300 text-emerald-950 focus:border-emerald-500 focus:ring-emerald-500'
                  }`}
                >
                  {availableClinics.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={PREMIUM_CLINIC_GROUP}>
                    ★ {PREMIUM_CLINIC_GROUP} (กำลังคนรวมหลายแผนก)
                  </option>
                </select>
              </div>
            </div>

            {existingDuplicateWorkload && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-300 text-xs text-red-950 flex items-start gap-2.5 shadow-2xs">
                <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="font-bold text-red-800">
                    ตรวจพบข้อมูลภาระงานซ้ำในวันและกะเวลาเดียวกัน (ห้ามบันทึกซ้ำ)
                  </div>
                  <div>
                    แผนก <strong>{clinic}</strong> วันที่ <strong>{formatThaiShortDate(date)}</strong> กะเวลา{' '}
                    <strong>{shift}</strong> มีข้อมูลบันทึกไว้ในระบบแล้ว (ผู้ป่วย{' '}
                    <strong>{getEffectiveTotalPt(existingDuplicateWorkload)}</strong> ราย • รายงานโดย{' '}
                    <strong>{existingDuplicateWorkload.reporter || '-'}</strong>)
                  </div>
                  <div className="text-[11px] text-red-800">
                    {isOffDutyWorkload(existingDuplicateWorkload)
                      ? 'รายการนี้บันทึกเป็น Off เวรไว้แล้ว หากต้องการแก้ไขหรือลบรายการ กรุณาให้ผู้ดูแลระบบ (Admin) ดำเนินการในตารางด้านขวา'
                      : 'หากมีผู้ป่วยเพิ่มจากการส่งตรวจ/Consult หรือต้องการลดยอดผู้ป่วย สามารถกดปุ่ม "ปรับเพิ่ม / ลดยอดผู้ป่วยรายการนี้" ได้ทันที (ไม่ต้องใช้สิทธิ์ Admin)'}
                  </div>
                  {onAdjustWorkloadPatients && !isOffDutyWorkload(existingDuplicateWorkload) && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => setAdjustingPatientWorkload(existingDuplicateWorkload)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold shadow-xs transition-colors cursor-pointer"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        <span>ปรับเพิ่ม / ลดยอดผู้ป่วยรายการนี้</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {isPremiumClinic ? (
              <div className="space-y-4">
                {/* Premium Header Banner */}
                <div className="bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50 border border-orange-300/80 rounded-xl p-3.5 flex items-start gap-2.5">
                  <Sparkles className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-orange-950 space-y-0.5">
                    <div className="font-bold">
                      โหมดศูนย์ปัญญาภิรมย์ (Pooled Staffing Model — 1 ชุดกำลังคนรวมหลายแผนก)
                    </div>
                    <p className="text-[11px] text-orange-900/85">
                      บันทึกกำลังคนปฏิบัติงานรวม 1 ชุดต่อกะ และกรอกยอดผู้ป่วยแยกเฉพาะแผนกที่มีแพทย์ออกตรวจจริง เพื่อไม่ให้นับจำนวนเจ้าหน้าที่ซ้ำซ้อน
                    </p>
                  </div>
                </div>

                {/* Part 1: Pooled Staffing */}
                <div className={`border rounded-xl p-4 space-y-3 ${
                  existingPremiumPool
                    ? 'border-amber-300 bg-amber-50/40'
                    : 'border-orange-200 bg-orange-50/40'
                }`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-orange-950 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-orange-600" />
                      <span>ส่วนที่ 1: กำลังคนรวมทั้งศูนย์ปัญญาภิรมย์ (1 ชุดต่อกะ)</span>
                    </h4>
                    <span className="text-[11px] font-semibold text-orange-900 bg-white px-2.5 py-0.5 rounded-full border border-orange-200">
                      กำลังคนพยาบาล (RN+PN+NA):{' '}
                      {(existingPremiumPool
                        ? (existingPremiumPool.rn || 0) +
                          (existingPremiumPool.pn || 0) +
                          (existingPremiumPool.na ?? existingPremiumPool.pca ?? 0)
                        : rn + pn + na
                      ).toFixed(1)}{' '}
                      แรง
                    </span>
                  </div>

                  {existingPremiumPool && (
                    <div className="bg-amber-100/80 border border-amber-300 rounded-lg p-2.5 flex items-start gap-2 text-xs text-amber-950">
                      <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">พบการบันทึกกำลังคนรวมในวันที่และกะเวลานี้แล้ว:</span>{' '}
                        ระบบล็อกช่องกรอกกำลังคนเพื่อป้องกันการคูณซ้ำ (รายงานโดย {existingPremiumPool.reporter}) คุณสามารถกรอกเพิ่มเฉพาะยอดผู้ป่วยแผนกย่อยในส่วนที่ 2 ได้เลย
                      </div>
                    </div>
                  )}

                  {(() => {
                    const dispRn = existingPremiumPool ? existingPremiumPool.rn : rn;
                    const dispPn = existingPremiumPool ? existingPremiumPool.pn : pn;
                    const dispNa = existingPremiumPool
                      ? (existingPremiumPool.na ?? existingPremiumPool.pca ?? 0)
                      : na;
                    const dispClerk = existingPremiumPool ? existingPremiumPool.clerk : clerk;
                    const dispSw = existingPremiumPool ? existingPremiumPool.serviceWorker : serviceWorker;
                    const isLocked = Boolean(existingPremiumPool);

                    const cards = [
                      { label: 'RN (พยาบาลวิชาชีพ)', val: dispRn, setter: setRn, border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-50 text-blue-800' },
                      { label: 'PN (ผู้ช่วยพยาบาล)', val: dispPn, setter: setPn, border: 'border-teal-200', text: 'text-teal-700', badge: 'bg-teal-50 text-teal-800' },
                      { label: 'NA (ผู้ช่วยคนไข้)', val: dispNa, setter: setNa, border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-50 text-emerald-800' },
                      { label: 'ผู้ปฏิบัติงานทั่วไป', val: dispClerk, setter: setClerk, border: 'border-gray-200', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-900' },
                      { label: 'พนักงานบริการ', val: dispSw, setter: setServiceWorker, border: 'border-gray-200', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-900' },
                    ];

                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {cards.map((c) => (
                          <div
                            key={c.label}
                            className={`p-2.5 rounded-lg border shadow-2xs ${
                              isLocked ? 'bg-gray-100/80 border-gray-200 opacity-80' : `bg-white ${c.border}`
                            }`}
                          >
                            <div className="flex justify-between items-center mb-1">
                              <span className={`text-xs font-bold ${c.text}`}>{c.label}</span>
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${c.badge}`}>
                                {Number(c.val || 0).toFixed(1)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={() => adjustStaff(c.setter, -0.5)}
                                className="p-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 cursor-pointer"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                disabled={isLocked}
                                value={c.val}
                                onChange={(e) => c.setter(Math.max(0, Number(e.target.value) || 0))}
                                className="w-full text-center text-xs font-bold py-1 border rounded border-gray-200 disabled:bg-gray-100"
                              />
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={() => adjustStaff(c.setter, 0.5)}
                                className="p-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Part 2: Sub-Department Patient Counts Table */}
                <div className="bg-white border border-orange-200/90 rounded-xl p-4 space-y-3 shadow-2xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-orange-100 pb-2.5">
                    <div>
                      <h4 className="text-xs font-bold text-orange-950 flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-orange-600" />
                        <span>ส่วนที่ 2: ตารางกรอกยอดผู้ป่วยแยกตามแผนกแพทย์ ({premiumSubClinics.length} แผนก)</span>
                      </h4>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        กรอกเฉพาะแผนกที่มีแพทย์ออกตรวจจริงในกะนี้ (ระบบจะบันทึกเฉพาะแผนกที่มียอดผู้ป่วย &gt; 0 หรือ Admit &gt; 0)
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-900 font-bold border border-orange-200">
                        เปิดตรวจ: {premiumSummary.activeCount} แผนก
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-900 font-bold border border-blue-200">
                        รวม: {premiumSummary.totalSum} ราย
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-bold border border-red-200">
                        Admit: {premiumSummary.admitSum}
                      </span>
                      {premiumSummary.activeCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setPremiumInputs({})}
                          className="px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold cursor-pointer"
                        >
                          ล้างค่า
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-orange-100 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-orange-50/90 text-orange-950 font-bold border-b border-orange-200">
                        <tr>
                          <th className="py-2 px-2.5 text-center w-10">ที่</th>
                          <th className="py-2 px-3">แผนกย่อย (ศูนย์ปัญญาภิรมย์)</th>
                          <th className="py-2 px-2 text-center w-24">ผู้ใหญ่</th>
                          <th className="py-2 px-2 text-center w-24">เด็ก</th>
                          <th className="py-2 px-2 text-center w-24 text-red-700">Admit</th>
                          <th className="py-2 px-2.5 text-right w-20 bg-orange-100/60">รวม</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-orange-100/80">
                        {premiumSubClinics.map((sub, idx) => {
                          const rowVal = premiumInputs[sub] || { adultPt: 0, childPt: 0, admit: 0 };
                          const rowTotal = rowVal.adultPt + rowVal.childPt;
                          const isRowActive = rowTotal > 0 || rowVal.admit > 0;
                          const alreadySaved = existingPremiumSubClinics.has(sub);
                          const savedSubRecord = alreadySaved ? existingPremiumSubMap.get(sub) : undefined;
                          return (
                            <tr
                              key={sub}
                              className={isRowActive ? 'bg-orange-50/70' : 'hover:bg-slate-50/70'}
                            >
                              <td className="py-1.5 px-2.5 text-center text-gray-500 font-medium">
                                {idx + 1}
                              </td>
                              <td className="py-1.5 px-3">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`font-semibold ${alreadySaved ? 'text-gray-500' : isRowActive ? 'text-orange-950' : 'text-gray-800'}`}>
                                    {sub}
                                  </span>
                                  {alreadySaved && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-red-50 text-red-700 border border-red-200 font-semibold">
                                      บันทึกแล้วในกะนี้ (ห้ามบันทึกซ้ำ)
                                    </span>
                                  )}
                                  {alreadySaved &&
                                    savedSubRecord &&
                                    onAdjustWorkloadPatients &&
                                    !isOffDutyWorkload(savedSubRecord) && (
                                      <button
                                        type="button"
                                        onClick={() => setAdjustingPatientWorkload(savedSubRecord)}
                                        className="text-[10px] px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1 shadow-2xs cursor-pointer"
                                      >
                                        <SlidersHorizontal className="w-2.5 h-2.5" />
                                        <span>ปรับยอด ({getEffectiveTotalPt(savedSubRecord)})</span>
                                      </button>
                                    )}
                                </div>
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  disabled={alreadySaved}
                                  value={alreadySaved ? '' : rowVal.adultPt || ''}
                                  onChange={(e) =>
                                    updatePremiumSubInput(sub, 'adultPt', Number(e.target.value) || 0)
                                  }
                                  className="w-full text-center text-xs font-semibold rounded-lg border border-gray-300 focus:border-orange-500 focus:ring-orange-500 py-1 px-1.5 bg-white disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  disabled={alreadySaved}
                                  value={alreadySaved ? '' : rowVal.childPt || ''}
                                  onChange={(e) =>
                                    updatePremiumSubInput(sub, 'childPt', Number(e.target.value) || 0)
                                  }
                                  className="w-full text-center text-xs font-semibold rounded-lg border border-gray-300 focus:border-orange-500 focus:ring-orange-500 py-1 px-1.5 bg-white disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  disabled={alreadySaved}
                                  value={alreadySaved ? '' : rowVal.admit || ''}
                                  onChange={(e) =>
                                    updatePremiumSubInput(sub, 'admit', Number(e.target.value) || 0)
                                  }
                                  className="w-full text-center text-xs font-bold rounded-lg border border-red-200 bg-red-50/30 text-red-700 focus:border-red-400 py-1 px-1.5 disabled:bg-gray-100 disabled:border-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
                                />
                              </td>
                              <td className="py-1.5 px-2.5 text-right font-extrabold text-orange-950 bg-orange-50/40">
                                {rowTotal}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-orange-100/70 text-orange-950 font-extrabold border-t border-orange-200">
                        <tr>
                          <td colSpan={2} className="py-2 px-3">
                            สรุปรวมศูนย์ปัญญาภิรมย์ ({premiumSummary.activeCount} แผนกที่เปิดตรวจ)
                          </td>
                          <td className="py-2 px-2 text-center">{premiumSummary.adultSum.toLocaleString()}</td>
                          <td className="py-2 px-2 text-center">{premiumSummary.childSum.toLocaleString()}</td>
                          <td className="py-2 px-2 text-center text-red-700">{premiumSummary.admitSum.toLocaleString()}</td>
                          <td className="py-2 px-2.5 text-right text-sm">{premiumSummary.totalSum.toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <>
            {isReferralClinic ? (
              <div className="bg-indigo-50/50 border border-indigo-200 rounded-xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-200/80 pb-2.5">
                  <div>
                    <h4 className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                      <ClipboardPen className="w-4 h-4 text-indigo-600" />
                      <span>ตารางเก็บข้อมูล ห้องรับ - ส่งต่อผู้ป่วย</span>
                    </h4>
                    <p className="text-[11px] text-indigo-800/80 mt-0.5">
                      วันที่ {referralThaiDateParts.day} เดือน {referralThaiDateParts.month} พ.ศ. {referralThaiDateParts.beYear}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-900 font-bold border border-indigo-200">
                      Admit รวม: {referralAdmit} ราย
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-bold border border-emerald-200">
                      รวมทั้งหมด: {referralTotal} รายการ
                    </span>
                    {referralTotal > 0 && (
                      <button
                        type="button"
                        onClick={() => setReferralInputs(createEmptyReferralData())}
                        className="px-2 py-0.5 rounded-full bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 font-semibold cursor-pointer"
                      >
                        ล้างค่า
                      </button>
                    )}
                  </div>
                </div>

                <div className="overflow-x-auto bg-white border border-indigo-200 rounded-xl">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-indigo-100/70 text-indigo-950 font-bold border-b border-indigo-200">
                        <th className="py-2 px-3 text-left w-44 border-r border-indigo-200/70">รายการ</th>
                        <th className="py-2 px-2.5 text-center w-28 border-r border-indigo-200/70">จำนวน</th>
                        <th className="py-2 px-3 text-left">เหตุผล</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-indigo-100">
                      {REFERRAL_ITEM_DEFINITIONS.map(({ key, label }) => {
                        const row = referralInputs[key];
                        return (
                          <tr key={key} className="hover:bg-indigo-50/30">
                            <td className="py-1.5 px-3 font-semibold text-gray-900 border-r border-indigo-100">
                              {label}
                            </td>
                            <td className="py-1.5 px-2 border-r border-indigo-100">
                              <input
                                type="number"
                                min="0"
                                placeholder="-"
                                value={row.count || ''}
                                onChange={(e) => updateReferralInput(key, 'count', Number(e.target.value) || 0)}
                                className="w-full text-center text-sm font-bold rounded-lg border border-indigo-200 bg-white text-indigo-950 py-1 px-2 focus:border-indigo-500 focus:ring-indigo-500"
                              />
                            </td>
                            <td className="py-1.5 px-2.5">
                              <input
                                type="text"
                                placeholder="ระบุเหตุผล (ถ้ามี)..."
                                value={row.reason}
                                onChange={(e) => updateReferralInput(key, 'reason', e.target.value)}
                                className="w-full text-xs rounded-lg border border-gray-200 bg-white text-gray-800 py-1.5 px-2.5 focus:border-indigo-400"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-indigo-100/60 font-extrabold text-indigo-950 border-t-2 border-indigo-200">
                        <td className="py-2 px-3 text-center border-r border-indigo-200/70">รวม</td>
                        <td className="py-2 px-2 text-center text-base border-r border-indigo-200/70">
                          {referralTotal}
                        </td>
                        <td className="py-2 px-3 text-[11px] font-medium text-indigo-900">
                          Admit พิเศษ+สามัญ = {referralAdmit} ราย | Refer in {referralInputs.referIn.count} / Refer out {referralInputs.referOut.count}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            ) : (
              <>
            {/* Echo Notice */}
            {isEchoClinic && (
              <div className="bg-amber-50 border border-amber-200/90 rounded-xl p-3 flex items-start gap-2.5">
                <Sparkles className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900">
                  <span className="font-bold">ระบบตรวจพบคลินิก Echo:</span> เปิดช่องแยกกรอกจำนวนผู้ใหญ่และเด็กพิเศษอัตโนมัติ โดยยอดรวมผู้ป่วยจะคำนวณจาก (ผู้ใหญ่ + เด็ก)
                </div>
              </div>
            )}

            {/* Row 2: Patient Counts & Admit */}
            <div className="p-4 rounded-xl border bg-slate-50/80 border-slate-200/80 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-600" />
                  ภาระงานผู้ป่วย (Patients & Admissions)
                </h4>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    จำนวนผู้ป่วยทั้งหมด (คน) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={totalPt || ''}
                    onChange={(e) => handleTotalPtChange(Number(e.target.value) || 0)}
                    disabled={isEchoClinic}
                    placeholder="0"
                    className={`w-full text-base font-bold rounded-lg border py-2 px-3 shadow-2xs ${
                      isEchoClinic
                        ? 'bg-amber-100/50 border-amber-300 text-amber-950'
                        : 'border-slate-300 bg-white text-emerald-900 focus:border-emerald-500 focus:ring-emerald-500'
                    }`}
                  />
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    = ผู้ใหญ่ ({adultPt}) + เด็ก ({childPt})
                  </span>
                </div>

                <div>
                  <label className={`block text-xs font-semibold mb-1 ${isEchoClinic ? 'text-amber-800' : 'text-slate-700'}`}>
                    ผู้ป่วยผู้ใหญ่ (คน)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={adultPt || ''}
                    onChange={(e) => handleAdultPtChange(Number(e.target.value) || 0)}
                    placeholder="0"
                    className={`w-full text-sm font-semibold rounded-lg border py-2 px-3 shadow-2xs ${
                      isEchoClinic
                        ? 'border-amber-300 bg-white text-amber-900 focus:border-amber-500 focus:ring-amber-500'
                        : 'border-slate-300 bg-white text-slate-800'
                    }`}
                  />
                </div>

                <div>
                  <label className={`block text-xs font-semibold mb-1 ${isEchoClinic ? 'text-amber-800' : 'text-slate-700'}`}>
                    ผู้ป่วยเด็ก
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={childPt || ''}
                    onChange={(e) => handleChildPtChange(Number(e.target.value) || 0)}
                    placeholder="0"
                    className={`w-full text-sm font-semibold rounded-lg border py-2 px-3 shadow-2xs ${
                      isEchoClinic
                        ? 'border-amber-300 bg-white text-amber-900 focus:border-amber-500 focus:ring-amber-500'
                        : 'border-slate-300 bg-white text-slate-800'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-red-700 mb-1 flex items-center gap-1">
                    <Bed className="w-3.5 h-3.5 text-red-500" />
                    ยอดรับไว้รักษา (Admit)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={admit || ''}
                    onChange={(e) => setAdmit(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                    className="w-full text-base font-bold rounded-lg border border-red-200 bg-red-50/40 text-red-900 py-2 px-3 shadow-2xs focus:border-red-400 focus:ring-red-400"
                  />
                </div>
              </div>
            </div>
              </>
            )}

            {/* Row 3: Staff Counts with 0.5 Support */}
            <div className="border border-emerald-100 bg-emerald-50/30 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-emerald-600" />
                  จำนวนบุคลากรปฏิบัติงานจริง (รองรับ 0.5 แรง ช่วยข้ามห้องตรวจ)
                </h4>
                <span className="text-[11px] font-semibold text-emerald-800">
                  กำลังคนการพยาบาล (RN+PN+NA): {(rn + pn + na).toFixed(1)} แรง
                </span>
              </div>

              {dailyWageClinicStaffCount > 0 && (
                <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-1.5 text-[11px] text-sky-900 font-medium">
                  หมายเหตุ: แผนกนี้มีเจ้าหน้าที่ตำแหน่ง <strong>"จ้างรายวัน"</strong> {dailyWageClinicStaffCount} คน (นับรวมกำลังคนในภาระงานประจำวันตามกลุ่มตำแหน่งหลักแล้ว โดยยังคงตำแหน่งจ้างรายวันไว้สำหรับทะเบียน วันลา OT/Unit Cost และสามารถระบุ <strong>Off เวรรายวัน</strong> ได้ในหัวข้อที่ 4 กรณียอดผู้ป่วยน้อยลง)
                </div>
              )}

              {/* Live 3-Point Headcount Verification across ALL positions */}
              {dayStaffingCheck.needsStrictValidation && dayStaffingCheck.baseTotalAll > 0 && (
                <div
                  className={`rounded-xl border p-3 text-[11px] space-y-2.5 ${
                    dayStaffingCheck.canSave3Points
                      ? 'bg-emerald-50/90 border-emerald-200 text-emerald-950'
                      : 'bg-red-50/90 border-red-300 text-red-950'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-start gap-2">
                      {dayStaffingCheck.canSave3Points ? (
                        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      )}
                      <div>
                        <div className="font-bold">
                          ตรวจเช็กความสัมพันธ์ 3 จุด แผนก {clinic}: ประจำทั้งหมด {dayStaffingCheck.baseTotalAll} คน
                          {dayStaffingCheck.totalAbsentAll > 0 && ` − ลา/อบรม/Off เวร/ไปช่วย ${dayStaffingCheck.totalAbsentAll} แรง`}
                          {dayStaffingCheck.totalIncomingAll > 0 && ` + มาช่วย/ขึ้นแทน ${dayStaffingCheck.totalIncomingAll} แรง`}
                          {` = คาดการณ์ปฏิบัติงาน ${dayStaffingCheck.expectedTotalAll} แรง`}
                          <span className={`ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            dayStaffingCheck.canSave3Points ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {dayStaffingCheck.canSave3Points ? 'ตรงกันครบทุกตำแหน่ง (บันทึกได้)' : 'ไม่ตรงจำนวนเต็ม (ยังบันทึกไม่ได้)'}
                          </span>
                        </div>
                        {(dayStaffingCheck.absents.length > 0 || dayStaffingCheck.incomings.length > 0) && (
                          <div className="text-[10.5px] opacity-90 flex flex-wrap gap-1.5 pt-1">
                            {dayStaffingCheck.absents.map((a, idx) => (
                              <span
                                key={`ab-${idx}`}
                                className={`px-1.5 py-0.5 rounded bg-white font-medium border ${
                                  a.kind === 'training'
                                    ? 'border-cyan-200 text-cyan-900'
                                    : a.kind === 'off_duty'
                                    ? 'border-violet-200 text-violet-900'
                                    : a.kind === 'outgoing'
                                    ? 'border-purple-200 text-purple-900'
                                    : 'border-amber-200 text-amber-950'
                                }`}
                              >
                                {a.detail}
                              </span>
                            ))}
                            {dayStaffingCheck.incomings.map((inc, idx) => (
                              <span key={`inc-${idx}`} className="px-1.5 py-0.5 rounded bg-white border border-emerald-200 text-emerald-900 font-medium">
                                {inc.detail}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {!dayStaffingCheck.canSave3Points && (
                      <button
                        type="button"
                        onClick={applyExpectedAllPositions}
                        className="shrink-0 px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-[10.5px] shadow-2xs transition-colors cursor-pointer"
                      >
                        ตั้งยอดปฏิบัติงานตามจำนวนเต็ม − ลา/อบรม/Off เวร
                      </button>
                    )}
                  </div>

                  {/* Per-Position Breakdown Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {dayStaffingCheck.activePositionRows.map(r => (
                      <div
                        key={r.pos}
                        className={`px-2 py-1.5 rounded-lg border text-[10.5px] ${
                          r.isBalanced
                            ? 'bg-white/90 border-emerald-200 text-emerald-950'
                            : 'bg-white border-red-300 text-red-900 font-semibold'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-bold truncate">{r.label}</span>
                          <span className={`px-1 rounded text-[9.5px] font-bold ${
                            r.isBalanced ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {r.isBalanced ? 'ตรง' : r.diff < 0 ? `ขาด ${Math.abs(r.diff)}` : `เกิน ${r.diff}`}
                          </span>
                        </div>
                        <div className="text-[10px] text-gray-600 mt-0.5">
                          เต็ม <strong>{r.full}</strong> | ทำจริง <strong>{r.working}</strong> | ลา/อบรม/Off/ช่วย <strong>{r.absent}</strong>
                          {r.incoming > 0 ? ` | แทน +${r.incoming}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* RN */}
                <div className="bg-white p-2.5 rounded-lg border border-blue-200 shadow-2xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-blue-700">RN (พยาบาลวิชาชีพ)</span>
                    <span className="text-xs font-bold text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded">
                      {rn.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustStaff(setRn, -0.5)}
                      className="p-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={rn}
                      onChange={(e) => setRn(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-center text-xs font-bold py-1 border rounded border-blue-200 text-blue-900"
                    />
                    <button
                      type="button"
                      onClick={() => adjustStaff(setRn, 0.5)}
                      className="p-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* PN */}
                <div className="bg-white p-2.5 rounded-lg border border-teal-200 shadow-2xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-teal-700">PN (ผู้ช่วยพยาบาล)</span>
                    <span className="text-xs font-bold text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded">
                      {pn.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustStaff(setPn, -0.5)}
                      className="p-1 rounded bg-teal-50 hover:bg-teal-100 text-teal-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={pn}
                      onChange={(e) => setPn(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-center text-xs font-bold py-1 border rounded border-teal-200 text-teal-900"
                    />
                    <button
                      type="button"
                      onClick={() => adjustStaff(setPn, 0.5)}
                      className="p-1 rounded bg-teal-50 hover:bg-teal-100 text-teal-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* NA */}
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200 shadow-2xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-emerald-700">NA (ผู้ช่วยคนไข้)</span>
                    <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded">
                      {na.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustStaff(setNa, -0.5)}
                      className="p-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={na}
                      onChange={(e) => setNa(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-center text-xs font-bold py-1 border rounded border-emerald-200 text-emerald-900"
                    />
                    <button
                      type="button"
                      onClick={() => adjustStaff(setNa, 0.5)}
                      className="p-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Clerk -> ผู้ปฏิบัติงานทั่วไป */}
                <div className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-2xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-gray-700">ผู้ปฏิบัติงานทั่วไป</span>
                    <span className="text-xs font-bold text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">
                      {clerk.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustStaff(setClerk, -0.5)}
                      className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={clerk}
                      onChange={(e) => setClerk(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-center text-xs font-bold py-1 border rounded border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => adjustStaff(setClerk, 0.5)}
                      className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Service Worker -> พนักงานบริการ */}
                <div className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-2xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-gray-700">พนักงานบริการ</span>
                    <span className="text-xs font-bold text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">
                      {serviceWorker.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustStaff(setServiceWorker, -0.5)}
                      className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={serviceWorker}
                      onChange={(e) => setServiceWorker(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-center text-xs font-bold py-1 border rounded border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => adjustStaff(setServiceWorker, 0.5)}
                      className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
              </>
            )}

            {/* Row 4: Redesigned Cohesive Section — Staff Leave, Training/Meeting, Cross-Coverage */}
            <div className="rounded-2xl border border-teal-200/80 bg-gradient-to-br from-emerald-50/50 via-teal-50/40 to-cyan-50/30 p-4 space-y-3.5 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-teal-950 block">
                      การเชื่อมโยงวันลา, ไปอบรม/ประชุม หรือช่วยงานห้องอื่นในวันนี้
                    </span>
                    <span className="text-[11px] text-teal-700/80">
                      เลือกได้มากกว่า 1 หัวข้อและระบุรายชื่อได้หลายคนพร้อมกัน
                    </span>
                  </div>
                </div>

                {/* Toggle Pill Buttons */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {!isOutTime && (
                    <>
                      <button
                        type="button"
                        onClick={() => setHasStaffLeave(!hasStaffLeave)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                          hasStaffLeave
                            ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-amber-300 hover:bg-amber-50/50'
                        }`}
                      >
                        <CalendarOff className="w-3.5 h-3.5" />
                        <span>มีเจ้าหน้าที่ลา</span>
                        {selectedLeaveItems.length > 0 && (
                          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${hasStaffLeave ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-800'}`}>
                            {selectedLeaveItems.length}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setHasTraining(!hasTraining)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                          hasTraining
                            ? 'bg-cyan-700 text-white border-cyan-700 shadow-xs'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-cyan-300 hover:bg-cyan-50/50'
                        }`}
                      >
                        <GraduationCap className="w-3.5 h-3.5" />
                        <span>ไปอบรม/ประชุม (ไม่นับภาระงานหน่วย)</span>
                        {selectedTrainingItems.length > 0 && (
                          <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${hasTraining ? 'bg-white/25 text-white' : 'bg-cyan-100 text-cyan-800'}`}>
                            {selectedTrainingItems.length}
                          </span>
                        )}
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => setHasCrossCover(!hasCrossCover)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      hasCrossCover
                        ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/50'
                    }`}
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    <span>ไปช่วย/รับคนมาช่วย (0.5/1 แรง)</span>
                    {effectiveCrossItems.length > 0 && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${hasCrossCover ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
                        {effectiveCrossItems.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setHasStaffOffDuty(!hasStaffOffDuty)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      hasStaffOffDuty
                        ? 'bg-violet-700 text-white border-violet-700 shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-violet-300 hover:bg-violet-50/50'
                    }`}
                  >
                    <PauseCircle className="w-3.5 h-3.5" />
                    <span>มีเจ้าหน้าที่รายวัน Off เวร (ยอดผู้ป่วยน้อยลง)</span>
                    {selectedOffDutyStaffItems.length > 0 && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${hasStaffOffDuty ? 'bg-white/25 text-white' : 'bg-violet-100 text-violet-800'}`}>
                        {selectedOffDutyStaffItems.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Block 1: Staff Leave (Per-person Leave Type + Full/Half Morning/Afternoon) */}
              {hasStaffLeave && (
                <div className="bg-white rounded-xl border border-amber-200/90 p-3.5 space-y-3 shadow-2xs text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 pb-2">
                    <div>
                      <span className="font-bold text-amber-950 flex items-center gap-1.5">
                        <CalendarOff className="w-4 h-4 text-amber-600" />
                        1. รายชื่อเจ้าหน้าที่ที่ลาวันนี้ (สมาชิกแผนก {clinic})
                      </span>
                      <span className="text-[10.5px] text-amber-700">
                        เจ้าหน้าที่ 1 คนเลือกการลาได้ 1 ประเภท พร้อมระบุเต็มวัน หรือ ครึ่งวันเช้า/บ่าย (0.5 แรง) แยกรายบุคคล
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-amber-700">
                      เลือกแล้ว {selectedLeaveItems.length} คน
                    </span>
                  </div>

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder={`พิมพ์ค้นหาชื่อหรือตำแหน่งในแผนก ${clinic}...`}
                      value={leaveSearch}
                      onChange={(e) => setLeaveSearch(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-slate-50/60 focus:bg-white pl-8 pr-8 py-1.5 text-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                    />
                    {leaveSearch && (
                      <button
                        type="button"
                        onClick={() => setLeaveSearch('')}
                        className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Searchable Staff Picker (1 person max 1 leave entry) */}
                  <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                    {(clinicStaff.length > 0 ? clinicStaff : activeStaffAll)
                      .filter(s => {
                        const q = leaveSearch.toLowerCase().trim();
                        if (!q) return true;
                        return (
                          s.name.toLowerCase().includes(q) ||
                          s.position.toLowerCase().includes(q) ||
                          formatPositionLabel(s.position).toLowerCase().includes(q) ||
                          s.homeClinic.toLowerCase().includes(q)
                        );
                      })
                      .map(s => {
                        const checked = selectedLeaveItems.some(it => it.staffId === s.staffId);
                        const normPickerDate = normalizeLeaveDateStr(date) || date;
                        const normStaffName = normalizeStaffNameKey(s.name);
                        const existingSavedLeaves = uniqueLeaves.filter(l => {
                          if (isTrainingLeaveType(l.leaveType)) return false;
                          const sDate = normalizeLeaveDateStr(l.startDate);
                          const eDate = normalizeLeaveDateStr(l.endDate || l.startDate) || sDate;
                          return normalizeStaffNameKey(l.staffName) === normStaffName && Boolean(sDate) && normPickerDate >= sDate && normPickerDate <= eDate;
                        });
                        const isBlockedAlready = existingSavedLeaves.length > 0;
                        const existingTypeLabel = existingSavedLeaves[0]?.leaveType || '';

                        return (
                          <div
                            key={s.staffId}
                            onClick={() => {
                              if (isBlockedAlready && !checked) return;
                              setSelectedLeaveItems(prev => {
                                if (checked) {
                                  return prev.filter(it => it.staffId !== s.staffId);
                                }
                                return [
                                  ...prev,
                                  {
                                    staffId: s.staffId,
                                    leaveType: regularLeaveOptions[0] || 'ลาป่วย',
                                    days: 1,
                                    periodLabel: '',
                                    note: '',
                                  },
                                ];
                              });
                            }}
                            className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border transition-all ${
                              isBlockedAlready && !checked
                                ? 'bg-red-50/50 border-red-200 text-gray-400 cursor-not-allowed'
                                : checked
                                  ? 'bg-amber-50/90 border-amber-300 text-amber-950 font-semibold cursor-pointer'
                                  : 'bg-white border-gray-100 hover:bg-slate-50 text-gray-700 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {checked ? (
                                <CheckSquare className="w-4 h-4 text-amber-600 shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-300 shrink-0" />
                              )}
                              <span className="truncate">{s.name}</span>
                              {isBlockedAlready && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200 font-semibold shrink-0">
                                  มีประวัติ{existingTypeLabel ? `${existingTypeLabel}` : 'ลา'}ในฐานข้อมูลแล้ว
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold shrink-0">
                              {formatPositionLabel(s.position)}
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  {/* Per-Person Leave Configuration Cards */}
                  {selectedLeaveItems.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <div className="text-[11px] font-bold text-amber-900">
                        กำหนดประเภทการลาและช่วงเวลารายบุคคล ({selectedLeaveItems.length} คน):
                      </div>
                      {selectedLeaveItems.map(item => {
                        const s = staffList.find(st => st.staffId === item.staffId);
                        if (!s) return null;
                        const periodSelectValue =
                          item.days === 1
                            ? 'FULL'
                            : item.periodLabel === 'ครึ่งวันบ่าย'
                              ? 'HALF_PM'
                              : 'HALF_AM';
                        return (
                          <div
                            key={item.staffId}
                            className="p-2.5 rounded-xl bg-amber-50/60 border border-amber-200 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-bold text-amber-950 truncate">{s.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-amber-200 text-amber-800 font-semibold shrink-0">
                                  {formatPositionLabel(s.position)}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedLeaveItems(prev =>
                                    prev.filter(x => x.staffId !== item.staffId)
                                  )
                                }
                                className="text-amber-600 hover:text-red-600 p-0.5 cursor-pointer"
                                title="นำรายชื่อออก"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                              <div>
                                <label className="block text-[10.5px] font-semibold text-gray-700 mb-0.5">
                                  ประเภทการลา
                                </label>
                                <select
                                  value={item.leaveType}
                                  onChange={(e) =>
                                    setSelectedLeaveItems(prev =>
                                      prev.map(x =>
                                        x.staffId === item.staffId
                                          ? { ...x, leaveType: e.target.value as LeaveType }
                                          : x
                                      )
                                    )
                                  }
                                  className="w-full rounded-lg border border-amber-200 py-1 px-2 text-xs bg-white font-medium"
                                >
                                  {regularLeaveOptions.map(lt => (
                                    <option key={lt} value={lt}>{lt}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[10.5px] font-semibold text-gray-700 mb-0.5">
                                  ช่วงเวลา / จำนวนแรง
                                </label>
                                <select
                                  value={periodSelectValue}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setSelectedLeaveItems(prev =>
                                      prev.map(x => {
                                        if (x.staffId !== item.staffId) return x;
                                        if (v === 'HALF_AM') {
                                          return { ...x, days: 0.5, periodLabel: 'ครึ่งวันเช้า' };
                                        }
                                        if (v === 'HALF_PM') {
                                          return { ...x, days: 0.5, periodLabel: 'ครึ่งวันบ่าย' };
                                        }
                                        return { ...x, days: 1, periodLabel: '' };
                                      })
                                    );
                                  }}
                                  className="w-full rounded-lg border border-amber-200 py-1 px-2 text-xs bg-white font-medium"
                                >
                                  <option value="FULL">เต็มวัน (1.0 วัน)</option>
                                  <option value="HALF_AM">ครึ่งวันเช้า (0.5 วัน)</option>
                                  <option value="HALF_PM">ครึ่งวันบ่าย (0.5 วัน)</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-[10.5px] font-semibold text-gray-700 mb-0.5">
                                  {isLeaveReasonRequired(item.leaveType) ? (
                                    <>
                                      เหตุผลการลา <span className="text-red-500">*</span>{' '}
                                      <span className="text-rose-700 font-medium">(บังคับระบุ)</span>
                                    </>
                                  ) : (
                                    <>
                                      หมายเหตุเฉพาะบุคคล{' '}
                                      <span className="text-gray-400 font-normal">(ไม่บังคับ)</span>
                                    </>
                                  )}
                                </label>
                                <input
                                  type="text"
                                  value={item.note}
                                  required={isLeaveReasonRequired(item.leaveType)}
                                  onChange={(e) => {
                                    setSelectedLeaveItems(prev =>
                                      prev.map(x =>
                                        x.staffId === item.staffId
                                          ? { ...x, note: e.target.value }
                                          : x
                                      )
                                    );
                                    if (formError) setFormError('');
                                  }}
                                  placeholder={
                                    isLeaveReasonRequired(item.leaveType)
                                      ? item.leaveType.includes('ป่วย')
                                        ? 'ระบุเหตุผล (บังคับ) เช่น เวียนศีรษะ, ท้องเสีย'
                                        : 'ระบุเหตุผล (บังคับ) เช่น ไปทำใบขับขี่, ทำธุระ'
                                      : 'เช่น ลาพักผ่อนประจำปี (ไม่บังคับ)'
                                  }
                                  className={`w-full rounded-lg border py-1 px-2 text-xs bg-white ${
                                    isLeaveReasonRequired(item.leaveType) &&
                                    !hasValidLeaveReason(item.leaveType, item.note)
                                      ? 'border-rose-400 ring-1 ring-rose-300/70'
                                      : 'border-amber-200'
                                  }`}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Block 2: Training / Meeting (Counts as attendance in Menu 2, deducted from unit daily workload) */}
              {hasTraining && (
                <div className="bg-white rounded-xl border border-cyan-200/90 p-3.5 space-y-3 shadow-2xs text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-100 pb-2">
                    <div>
                      <span className="font-bold text-cyan-950 flex items-center gap-1.5">
                        <GraduationCap className="w-4 h-4 text-cyan-600" />
                        2. รายชื่อเจ้าหน้าที่ไปอบรม / ประชุม (สมาชิกแผนก {clinic})
                      </span>
                      <span className="text-[10.5px] text-cyan-700 font-medium">
                        การไปอบรม/ประชุม นับว่ามาปฏิบัติงาน (ไม่นับเป็นวันลา) แต่ไม่นับเป็นภาระงานในหน่วยงาน (หักออกจากกำลังคนปฏิบัติงานประจำวันของหน่วยงาน)
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-cyan-700">
                      เลือกแล้ว {selectedTrainingItems.length} คน
                    </span>
                  </div>

                  {/* Selected Chips with 1.0 / 0.5 Day Period Selector */}
                  {selectedTrainingItems.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTrainingItems.map(item => {
                        const s = staffList.find(st => st.staffId === item.staffId);
                        if (!s) return null;
                        const periodSelectValue =
                          item.days === 1
                            ? 'FULL'
                            : item.periodLabel === 'ครึ่งวันบ่าย'
                              ? 'HALF_PM'
                              : 'HALF_AM';
                        return (
                          <div
                            key={item.staffId}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-900 font-semibold text-[11px]"
                          >
                            <span>{s.name} ({formatPositionLabel(s.position)})</span>
                            <select
                              value={periodSelectValue}
                              onChange={e => {
                                const v = e.target.value;
                                setSelectedTrainingItems(prev =>
                                  prev.map(x =>
                                    x.staffId === item.staffId
                                      ? {
                                          ...x,
                                          days: v === 'FULL' ? 1 : 0.5,
                                          periodLabel:
                                            v === 'HALF_AM'
                                              ? 'ครึ่งวันเช้า'
                                              : v === 'HALF_PM'
                                                ? 'ครึ่งวันบ่าย'
                                                : '',
                                        }
                                      : x
                                  )
                                );
                              }}
                              className="rounded border border-cyan-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-cyan-900 outline-none"
                            >
                              <option value="FULL">เต็มวัน (1.0)</option>
                              <option value="HALF_AM">ครึ่งวันเช้า (0.5)</option>
                              <option value="HALF_PM">ครึ่งวันบ่าย (0.5)</option>
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedTrainingItems(prev => prev.filter(x => x.staffId !== item.staffId))
                              }
                              className="text-cyan-600 hover:text-red-600 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder={`พิมพ์ค้นหาชื่อหรือตำแหน่งในแผนก ${clinic}...`}
                      value={trainingSearch}
                      onChange={(e) => setTrainingSearch(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-slate-50/60 focus:bg-white pl-8 pr-8 py-1.5 text-xs outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                    />
                    {trainingSearch && (
                      <button
                        type="button"
                        onClick={() => setTrainingSearch('')}
                        className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Clean Scrollable Picker (scoped to current clinic staff when available) */}
                  <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                    {(clinicStaff.length > 0 ? clinicStaff : activeStaffAll)
                      .filter(s => {
                        const q = trainingSearch.toLowerCase().trim();
                        if (!q) return true;
                        return (
                          s.name.toLowerCase().includes(q) ||
                          s.position.toLowerCase().includes(q) ||
                          formatPositionLabel(s.position).toLowerCase().includes(q) ||
                          s.homeClinic.toLowerCase().includes(q)
                        );
                      })
                      .map(s => {
                        const checked = selectedTrainingItems.some(it => it.staffId === s.staffId);
                        const normPickerDate = normalizeLeaveDateStr(date) || date;
                        const normStaffName = normalizeStaffNameKey(s.name);
                        const existingSavedTrainings = uniqueLeaves.filter(l => {
                          if (!isTrainingLeaveType(l.leaveType)) return false;
                          const sDate = normalizeLeaveDateStr(l.startDate);
                          const eDate = normalizeLeaveDateStr(l.endDate || l.startDate) || sDate;
                          return normalizeStaffNameKey(l.staffName) === normStaffName && Boolean(sDate) && normPickerDate >= sDate && normPickerDate <= eDate;
                        });
                        const isBlockedAlready = existingSavedTrainings.length > 0;
                        return (
                          <div
                            key={s.staffId}
                            onClick={() => {
                              if (isBlockedAlready && !checked) return;
                              setSelectedTrainingItems(prev =>
                                checked
                                  ? prev.filter(it => it.staffId !== s.staffId)
                                  : [...prev, { staffId: s.staffId, days: 1, periodLabel: '' }]
                              );
                            }}
                            className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border transition-all ${
                              isBlockedAlready && !checked
                                ? 'bg-red-50/50 border-red-200 text-gray-400 cursor-not-allowed'
                                : checked
                                  ? 'bg-cyan-50/90 border-cyan-300 text-cyan-950 font-semibold cursor-pointer'
                                  : 'bg-white border-gray-100 hover:bg-slate-50 text-gray-700 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {checked ? (
                                <CheckSquare className="w-4 h-4 text-cyan-600 shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-300 shrink-0" />
                              )}
                              <span className="truncate">{s.name}</span>
                              <span className="text-[10px] text-gray-400 shrink-0">({s.homeClinic})</span>
                              {isBlockedAlready && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-800 border border-cyan-200 font-semibold shrink-0">
                                  มีบันทึกอบรมในฐานข้อมูลแล้ว
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold shrink-0">
                              {formatPositionLabel(s.position)}
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">หัวข้อการอบรม / ประชุม</label>
                      <input
                        type="text"
                        value={trainingTopic}
                        onChange={(e) => setTrainingTopic(e.target.value)}
                        placeholder="เช่น ประชุม HA, อบรม CPR ประจำปี"
                        className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">สถานที่ / หมายเหตุ</label>
                      <input
                        type="text"
                        value={trainingNote}
                        onChange={(e) => setTrainingNote(e.target.value)}
                        placeholder="เช่น ห้องประชุมชั้น 4, เต็มวัน"
                        className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Block 3: Outgoing & Incoming Cross-Coverage (Supports 0.5 Morning/Afternoon & 1.0 Full Day) */}
              {hasCrossCover && (
                <div className="bg-white rounded-xl border border-emerald-200/90 p-3.5 space-y-3 shadow-2xs text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 pb-2">
                    <div className="font-bold text-emerald-950 flex items-center gap-1.5">
                      <ArrowRightLeft className="w-4 h-4 text-emerald-600" />
                      <span>3. การช่วยงานข้ามห้องตรวจ (รองรับ 0.5 ครึ่งวันเช้า/บ่าย และ 1.0 เต็มวัน)</span>
                    </div>
                    <div className="inline-flex rounded-lg border border-emerald-200 bg-emerald-50/50 p-0.5 text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => {
                          setCrossDirection('outgoing');
                          setCrossStaffName('');
                          setCrossOtherClinic('');
                          setCrossStaffSearch('');
                        }}
                        className={`px-2.5 py-1 rounded-md cursor-pointer transition-all ${
                          crossDirection === 'outgoing'
                            ? 'bg-emerald-700 text-white shadow-2xs'
                            : 'text-emerald-900 hover:bg-white'
                        }`}
                      >
                        ส่งคนไปช่วยห้องอื่น (−แรง)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCrossDirection('incoming');
                          setCrossStaffName('');
                          setCrossOtherClinic('');
                          setCrossStaffSearch('');
                        }}
                        className={`px-2.5 py-1 rounded-md cursor-pointer transition-all ${
                          crossDirection === 'incoming'
                            ? 'bg-indigo-700 text-white shadow-2xs'
                            : 'text-indigo-900 hover:bg-white'
                        }`}
                      >
                        มีคนจากหน่วยอื่นมาช่วย (+แรง)
                      </button>
                    </div>
                  </div>

                  {crossDirection === 'incoming' && (
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-semibold text-gray-700">แหล่งที่มาของผู้มาช่วยงาน:</span>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          checked={crossIncomingSource === 'opd'}
                          onChange={() => {
                            setCrossIncomingSource('opd');
                            setCrossStaffName('');
                            setCrossOtherClinic('');
                          }}
                        />
                        <span>บุคลากร OPD จากแผนกอื่น</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="radio"
                          checked={crossIncomingSource === 'external'}
                          onChange={() => {
                            setCrossIncomingSource('external');
                            setCrossStaffName('');
                            setCrossOtherClinic('');
                          }}
                        />
                        <span>เจ้าหน้าที่เฉพาะกิจจากนอก OPD (เช่น ER/Ward/Float)</span>
                      </label>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {crossDirection === 'incoming' && crossIncomingSource === 'external' ? (
                      <>
                        <div>
                          <label className="block font-semibold text-gray-700 mb-1">ชื่อ-สกุล ผู้มาช่วย</label>
                          <input
                            type="text"
                            value={crossStaffName}
                            onChange={(e) => setCrossStaffName(e.target.value)}
                            placeholder="ระบุชื่อ-สกุล"
                            className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs bg-white"
                          />
                        </div>
                        <div>
                          <label className="block font-semibold text-gray-700 mb-1">ตำแหน่ง</label>
                          <select
                            value={crossExtPosition}
                            onChange={(e) => setCrossExtPosition(e.target.value as StaffPosition)}
                            className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs bg-white"
                          >
                            {ALL_POSITIONS.filter(p => !isDailyWagePosition(p)).map(p => (
                              <option key={p} value={p}>{formatPositionLabel(p)}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block font-semibold text-gray-700 mb-1">หน่วยงานต้นทาง</label>
                          <input
                            type="text"
                            value={crossOtherClinic}
                            onChange={(e) => setCrossOtherClinic(e.target.value)}
                            placeholder="เช่น ER, ICU, Ward 5"
                            className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs bg-white"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="space-y-1">
                          <label className="block font-semibold text-gray-700">
                            {crossDirection === 'outgoing' ? 'เจ้าหน้าที่ไปช่วยงาน' : 'เจ้าหน้าที่จากห้องอื่นที่มาช่วย'}
                          </label>
                          <div className="relative">
                            <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-2" />
                            <input
                              type="text"
                              value={crossStaffSearch}
                              onChange={(e) => setCrossStaffSearch(e.target.value)}
                              placeholder="พิมพ์กรองชื่อ..."
                              className="w-full rounded-lg border border-gray-200 bg-slate-50/70 pl-7 pr-2 py-1 text-[11px]"
                            />
                          </div>
                          <select
                            value={crossStaffName}
                            onChange={(e) => {
                              const nextName = e.target.value;
                              setCrossStaffName(nextName);
                              if (crossDirection === 'incoming') {
                                const st = staffList.find(s => s.name === nextName);
                                if (st) setCrossOtherClinic(st.homeClinic);
                              }
                            }}
                            className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs bg-white"
                          >
                            <option value="">-- เลือกเจ้าหน้าที่ --</option>
                            {(crossDirection === 'outgoing'
                              ? clinicStaff.length > 0
                                ? clinicStaff
                                : activeStaffAll
                              : activeStaffAll.filter(s => s.homeClinic !== clinic)
                            )
                              .filter(s => {
                                const q = crossStaffSearch.toLowerCase().trim();
                                return !q || s.name.toLowerCase().includes(q) || s.homeClinic.toLowerCase().includes(q);
                              })
                              .map(s => (
                                <option key={s.staffId} value={s.name}>
                                  {s.name} ({formatPositionLabel(s.position)} - {s.homeClinic})
                                </option>
                              ))}
                          </select>
                        </div>

                        <div>
                          <label className="block font-semibold text-gray-700 mb-1">
                            {crossDirection === 'outgoing' ? 'ห้องตรวจเป้าหมายที่ไปช่วย' : 'แผนกต้นทางของผู้มาช่วย'}
                          </label>
                          <select
                            value={crossOtherClinic}
                            onChange={(e) => setCrossOtherClinic(e.target.value)}
                            className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs bg-white mt-7"
                          >
                            <option value="">-- เลือกห้องตรวจ --</option>
                            {allOpdClinics.filter(c => c !== clinic).map(c => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block font-semibold text-gray-700 mb-1">
                            จำนวนแรง & ช่วงเวลา
                          </label>
                          <select
                            value={
                              crossAmount === 1
                                ? 'FULL'
                                : crossPeriod === 'ครึ่งวันบ่าย'
                                  ? 'HALF_PM'
                                  : 'HALF_AM'
                            }
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === 'HALF_AM') {
                                setCrossAmount(0.5);
                                setCrossPeriod('ครึ่งวันเช้า');
                              } else if (v === 'HALF_PM') {
                                setCrossAmount(0.5);
                                setCrossPeriod('ครึ่งวันบ่าย');
                              } else {
                                setCrossAmount(1);
                                setCrossPeriod('');
                              }
                            }}
                            className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs bg-white mt-7 font-medium"
                          >
                            <option value="FULL">เต็มวัน (1.0 แรง)</option>
                            <option value="HALF_AM">ครึ่งวันเช้า (0.5 แรง)</option>
                            <option value="HALF_PM">ครึ่งวันบ่าย (0.5 แรง)</option>
                          </select>
                        </div>
                      </>
                    )}
                  </div>

                  {crossDirection === 'incoming' && crossIncomingSource === 'external' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="block font-semibold text-gray-700 mb-1">
                          จำนวนแรง & ช่วงเวลาที่มาช่วย
                        </label>
                        <select
                          value={
                            crossAmount === 1
                              ? 'FULL'
                              : crossPeriod === 'ครึ่งวันบ่าย'
                                ? 'HALF_PM'
                                : 'HALF_AM'
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === 'HALF_AM') {
                              setCrossAmount(0.5);
                              setCrossPeriod('ครึ่งวันเช้า');
                            } else if (v === 'HALF_PM') {
                              setCrossAmount(0.5);
                              setCrossPeriod('ครึ่งวันบ่าย');
                            } else {
                              setCrossAmount(1);
                              setCrossPeriod('');
                            }
                          }}
                          className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs bg-white font-medium"
                        >
                          <option value="FULL">เต็มวัน (1.0 แรง)</option>
                          <option value="HALF_AM">ครึ่งวันเช้า (0.5 แรง)</option>
                          <option value="HALF_PM">ครึ่งวันบ่าย (0.5 แรง)</option>
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-[10.5px] text-gray-500">
                      สามารถเพิ่มได้หลายคน (เช่น ส่งไปช่วย 0.5 แรง หรือรับคนมาช่วย 0.5 แรง)
                    </span>
                    <button
                      type="button"
                      disabled={!crossStaffName.trim() || !crossOtherClinic.trim()}
                      onClick={() => {
                        const cleanName = crossStaffName.trim();
                        const cleanClinic = crossOtherClinic.trim();
                        if (!cleanName || !cleanClinic) return;
                        const st = staffList.find(s => s.name === cleanName);
                        const resolvedPos: StaffPosition =
                          crossDirection === 'incoming' && crossIncomingSource === 'external'
                            ? crossExtPosition
                            : st?.position || 'RN';
                        const resolvedPeriod: HalfDayPeriod =
                          crossAmount === 0.5 ? (crossPeriod || 'ครึ่งวันเช้า') : '';
                        setCrossItems(prev => [
                          ...prev,
                          {
                            tempId: `CC-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                            direction: crossDirection,
                            staffName: cleanName,
                            position: resolvedPos,
                            otherClinic: cleanClinic,
                            amount: crossAmount,
                            periodLabel: resolvedPeriod,
                            isExternal: crossDirection === 'incoming' && crossIncomingSource === 'external',
                          },
                        ]);
                        setCrossStaffName('');
                        setCrossOtherClinic('');
                        setCrossStaffSearch('');
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-[11px] font-bold cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>เพิ่มรายการช่วยงานเข้าชุดนี้</span>
                    </button>
                  </div>

                  {effectiveCrossItems.length > 0 && (
                    <div className="pt-2 border-t border-emerald-100 space-y-1.5">
                      <div className="text-[11px] font-bold text-emerald-950">
                        รายการช่วยงานที่ระบุไว้ ({effectiveCrossItems.length} รายการ):
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {effectiveCrossItems.map(item => (
                          <span
                            key={item.tempId}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${
                              item.direction === 'outgoing'
                                ? 'bg-amber-50 border-amber-200 text-amber-950'
                                : 'bg-indigo-50 border-indigo-200 text-indigo-950'
                            }`}
                          >
                            <span>
                              {item.direction === 'outgoing'
                                ? `${item.staffName} → ไปช่วย ${item.otherClinic} (−${item.amount}${
                                    item.amount === 0.5 && item.periodLabel ? ` ${item.periodLabel}` : ''
                                  })`
                                : `${item.staffName} ← มาช่วยจาก ${item.otherClinic} (+${item.amount}${
                                    item.amount === 0.5 && item.periodLabel ? ` ${item.periodLabel}` : ''
                                  })`}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (item.tempId === 'DRAFT-ACTIVE') {
                                  setCrossStaffName('');
                                  setCrossOtherClinic('');
                                } else {
                                  setCrossItems(prev => prev.filter(x => x.tempId !== item.tempId));
                                }
                              }}
                              className="text-gray-500 hover:text-red-600 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Block 4: Daily Wage Staff Off เวร (ยอดผู้ป่วยน้อยลง — รองรับทั้งในเวลาและนอกเวลาราชการ) */}
              {hasStaffOffDuty && (() => {
                const candidatePool = isOutTime
                  ? sortedOutTimeDailyWageStaff
                  : showAllOpdDailyWageInTime || clinicDailyWageStaff.length === 0
                    ? sortedOutTimeDailyWageStaff
                    : clinicDailyWageStaff;
                const filteredCandidates = candidatePool.filter((s) => {
                  const q = offDutyStaffSearch.toLowerCase().trim();
                  if (!q) return true;
                  return (
                    s.name.toLowerCase().includes(q) ||
                    s.position.toLowerCase().includes(q) ||
                    formatPositionLabel(s.position).toLowerCase().includes(q) ||
                    s.homeClinic.toLowerCase().includes(q)
                  );
                });

                return (
                <div className="bg-white rounded-xl border border-violet-200/90 p-3.5 space-y-3 shadow-2xs text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-violet-100 pb-2">
                    <div>
                      <span className="font-bold text-violet-950 flex items-center gap-1.5 flex-wrap">
                        <PauseCircle className="w-4 h-4 text-violet-700" />
                        <span>4. รายชื่อเจ้าหน้าที่ตำแหน่ง &quot;รายวัน&quot; ที่ Off เวร (กรณียอดผู้ป่วยน้อยลง)</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 font-semibold border border-violet-200">
                          ใช้ได้ทั้งในและนอกเวลาราชการ
                        </span>
                      </span>
                      <span className="text-[10.5px] text-violet-700 block mt-0.5">
                        {isOutTime
                          ? 'เลือกเจ้าหน้าที่รายวันที่มีเวร OT ในกะนอกเวลานี้แล้วต้อง Off เวรเนื่องจากผู้ป่วยน้อยลง (รองรับเต็มเวร 1.0 / ครึ่งเวร 0.5)'
                          : 'เลือกเจ้าหน้าที่ตำแหน่งรายวันของแผนกที่ Off เวรเนื่องจากผู้ป่วยน้อยลง (ไม่นับเป็นวันลาในเมนู 2 แต่หักออกจากกำลังคนปฏิบัติงานประจำวันของหน่วย)'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {!isOutTime && clinicDailyWageStaff.length > 0 && allDailyWageStaff.length > clinicDailyWageStaff.length && (
                        <button
                          type="button"
                          onClick={() => setShowAllOpdDailyWageInTime(!showAllOpdDailyWageInTime)}
                          className="text-[10.5px] px-2 py-0.5 rounded-lg border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-800 font-semibold cursor-pointer"
                        >
                          {showAllOpdDailyWageInTime
                            ? `แสดงเฉพาะสังกัด ${clinic} (${clinicDailyWageStaff.length})`
                            : `แสดงรายวันทั้ง OPD (${allDailyWageStaff.length})`}
                        </button>
                      )}
                      <span className="text-[11px] font-semibold text-violet-700">
                        เลือกแล้ว {selectedOffDutyStaffItems.length} คน
                      </span>
                    </div>
                  </div>

                  {!isOutTime && clinicDailyWageStaff.length === 0 && (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-[11px] text-amber-900">
                      แผนก <strong>{clinic}</strong> ยังไม่มีบุคลากรตำแหน่ง &quot;รายวัน&quot; ประจำหน่วยในเมนู 5 (กำลังแสดงรายชื่อบุคลากรรายวันทั้ง OPD — หมายเหตุ: ระบบตรวจ 3 จุดจะคำนวณหักเฉพาะสมาชิกที่สังกัดแผนกนี้)
                    </div>
                  )}

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="พิมพ์ค้นหาชื่อ, ตำแหน่งรายวัน หรือสังกัด..."
                      value={offDutyStaffSearch}
                      onChange={(e) => setOffDutyStaffSearch(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-slate-50/60 focus:bg-white pl-8 pr-8 py-1.5 text-xs outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                    />
                    {offDutyStaffSearch && (
                      <button
                        type="button"
                        onClick={() => setOffDutyStaffSearch('')}
                        className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {allDailyWageStaff.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-gray-500 text-xs">
                      ยังไม่มีบุคลากรตำแหน่งงาน &quot;รายวัน&quot; (จ้างรายวัน) ในทะเบียนบุคลากรเมนู 5
                    </div>
                  ) : filteredCandidates.length === 0 ? (
                    <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-center text-gray-500 text-xs">
                      ไม่พบรายชื่อเจ้าหน้าที่รายวันที่ตรงกับคำค้นหา
                    </div>
                  ) : (
                    <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                      {filteredCandidates.map((s) => {
                        const checked = selectedOffDutyStaffItems.some((it) => it.staffId === s.staffId);
                        const hasOtThisShift = isOutTime && otScheduledStaffNamesForShift.has((s.name || '').trim());
                        return (
                          <div
                            key={s.staffId}
                            onClick={() => {
                              setSelectedOffDutyStaffItems((prev) =>
                                checked
                                  ? prev.filter((it) => it.staffId !== s.staffId)
                                  : [
                                      ...prev,
                                      {
                                        staffId: s.staffId,
                                        amount: 1,
                                        periodLabel: '',
                                        reason: OFF_DUTY_STAFF_REASON_PRESETS[0],
                                      },
                                    ]
                              );
                            }}
                            className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                              checked
                                ? 'bg-violet-50/90 border-violet-300 text-violet-950 font-semibold'
                                : 'bg-white border-gray-100 hover:bg-slate-50 text-gray-700'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {checked ? (
                                <CheckSquare className="w-4 h-4 text-violet-700 shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-300 shrink-0" />
                              )}
                              <span className="truncate">{s.name}</span>
                              {hasOtThisShift && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 font-bold shrink-0">
                                  มีเวร OT กะนี้
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-800 border border-violet-200 font-semibold">
                                [รายวัน] {formatPositionLabel(s.position)}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                {s.homeClinic}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {selectedOffDutyStaffItems.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <div className="text-[11px] font-bold text-violet-900">
                        กำหนดช่วงเวลาและเหตุผล Off เวรรายวัน ({selectedOffDutyStaffItems.length} คน):
                      </div>
                      {selectedOffDutyStaffItems.map((item) => {
                        const s = staffList.find((st) => st.staffId === item.staffId);
                        if (!s) return null;
                        const periodSelectValue =
                          item.amount === 1
                            ? 'FULL'
                            : isOutTime
                              ? 'HALF_SHIFT'
                              : item.periodLabel === 'ครึ่งวันบ่าย'
                                ? 'HALF_PM'
                                : 'HALF_AM';
                        return (
                          <div
                            key={item.staffId}
                            className="p-2.5 rounded-xl bg-violet-50/60 border border-violet-200 space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                                <span className="font-bold text-violet-950 truncate">{s.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-violet-200 text-violet-800 font-semibold shrink-0">
                                  [รายวัน] {formatPositionLabel(s.position)}
                                </span>
                                <span className="text-[10px] text-gray-500">({s.homeClinic})</span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedOffDutyStaffItems((prev) =>
                                    prev.filter((x) => x.staffId !== item.staffId)
                                  )
                                }
                                className="text-violet-600 hover:text-red-600 p-0.5 cursor-pointer"
                                title="นำรายชื่อออก"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10.5px] font-semibold text-gray-700 mb-0.5">
                                  ช่วงเวลา / จำนวนแรง Off เวร
                                </label>
                                <select
                                  value={periodSelectValue}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setSelectedOffDutyStaffItems((prev) =>
                                      prev.map((x) => {
                                        if (x.staffId !== item.staffId) return x;
                                        if (v === 'HALF_SHIFT') {
                                          return {
                                            ...x,
                                            amount: 0.5,
                                            periodLabel: 'ครึ่งเวร',
                                            reason:
                                              x.reason === OFF_DUTY_STAFF_REASON_PRESETS[0]
                                                ? OFF_DUTY_STAFF_REASON_PRESETS[1]
                                                : x.reason,
                                          };
                                        }
                                        if (v === 'HALF_AM') {
                                          return {
                                            ...x,
                                            amount: 0.5,
                                            periodLabel: 'ครึ่งวันเช้า',
                                            reason:
                                              x.reason === OFF_DUTY_STAFF_REASON_PRESETS[0]
                                                ? OFF_DUTY_STAFF_REASON_PRESETS[1]
                                                : x.reason,
                                          };
                                        }
                                        if (v === 'HALF_PM') {
                                          return {
                                            ...x,
                                            amount: 0.5,
                                            periodLabel: 'ครึ่งวันบ่าย',
                                            reason:
                                              x.reason === OFF_DUTY_STAFF_REASON_PRESETS[0]
                                                ? OFF_DUTY_STAFF_REASON_PRESETS[1]
                                                : x.reason,
                                          };
                                        }
                                        return { ...x, amount: 1, periodLabel: '' };
                                      })
                                    );
                                  }}
                                  className="w-full rounded-lg border border-violet-200 py-1 px-2 text-xs bg-white font-medium"
                                >
                                  {isOutTime ? (
                                    <>
                                      <option value="FULL">เต็มเวรนอกเวลา (1.0 แรง)</option>
                                      <option value="HALF_SHIFT">ครึ่งเวร (0.5 แรง)</option>
                                    </>
                                  ) : (
                                    <>
                                      <option value="FULL">เต็มวัน (1.0 แรง)</option>
                                      <option value="HALF_AM">ครึ่งวันเช้า (0.5 แรง)</option>
                                      <option value="HALF_PM">ครึ่งวันบ่าย (0.5 แรง)</option>
                                    </>
                                  )}
                                </select>
                              </div>
                              <div>
                                <label className="block text-[10.5px] font-semibold text-gray-700 mb-0.5">
                                  เหตุผล (เลือกด่วนหรือพิมพ์เพิ่ม)
                                </label>
                                <input
                                  type="text"
                                  value={item.reason}
                                  onChange={(e) =>
                                    setSelectedOffDutyStaffItems((prev) =>
                                      prev.map((x) =>
                                        x.staffId === item.staffId ? { ...x, reason: e.target.value } : x
                                      )
                                    )
                                  }
                                  placeholder="เช่น ยอดผู้ป่วยน้อยลง (Off เวรรายวัน)"
                                  className="w-full rounded-lg border border-violet-200 py-1 px-2 text-xs bg-white"
                                />
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {OFF_DUTY_STAFF_REASON_PRESETS.map((preset) => (
                                <button
                                  key={preset}
                                  type="button"
                                  onClick={() =>
                                    setSelectedOffDutyStaffItems((prev) =>
                                      prev.map((x) =>
                                        x.staffId === item.staffId ? { ...x, reason: preset } : x
                                      )
                                    )
                                  }
                                  className={`text-[10px] px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${
                                    item.reason === preset
                                      ? 'bg-violet-700 text-white border-violet-700 font-semibold'
                                      : 'bg-white text-violet-900 border-violet-200 hover:bg-violet-100'
                                  }`}
                                >
                                  {preset}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                );
              })()}

              {/* 3-Point Integrity Alert inside Section 4 */}
              {dayStaffingCheck.needsStrictValidation && dayStaffingCheck.baseTotalAll > 0 && !dayStaffingCheck.canSave3Points && (
                <div className="rounded-xl bg-red-50 border border-red-300 p-3 text-xs text-red-900 space-y-1.5">
                  <div className="font-bold flex items-center gap-1.5 text-red-800">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>แจ้งเตือน: ข้อมูล 3 จุดของแผนก {clinic} ยังไม่สอดคล้องกัน (ยังบันทึกภาระงานไม่ได้)</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-[11px]">
                    {dayStaffingCheck.validationErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Row 5: Notes & Reporter */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  หมายเหตุ / กิจกรรมพิเศษ
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="เช่น ทำหัตถการพิเศษ, ผู้ป่วยส่งต่อฉุกเฉิน"
                  className="w-full text-xs rounded-lg border-gray-300 shadow-2xs py-2 px-3 border"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  ผู้บันทึกรายงาน <span className="text-red-500">*</span>
                </label>
                <input
                  ref={reporterInputRef}
                  type="text"
                  value={reporter}
                  onChange={(e) => {
                    setReporter(e.target.value);
                    if (formError) setFormError('');
                  }}
                  placeholder="ระบุชื่อ-สกุล และตำแหน่ง"
                  required
                  className={`w-full text-xs rounded-lg shadow-2xs py-2 px-3 border font-medium ${
                    formError && !reporter.trim() ? 'border-red-400 ring-1 ring-red-400 bg-red-50/30' : 'border-gray-300'
                  }`}
                />
              </div>
            </div>

            {formError && (
              <div
                ref={formErrorRef}
                className="flex flex-wrap items-center justify-between gap-2 text-xs text-red-700 bg-red-50 border border-red-300 rounded-lg px-3 py-2.5 font-medium"
              >
                <div className="flex items-start gap-1.5 min-w-0 flex-1">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
                {!dayStaffingCheck.canSave3Points && (
                  <button
                    type="button"
                    onClick={applyExpectedAllPositions}
                    className="px-2.5 py-1 rounded-md bg-red-700 hover:bg-red-800 text-white text-[11px] font-bold shrink-0 cursor-pointer transition-colors"
                  >
                    ปรับกำลังคนให้ตรงอัตโนมัติ
                  </button>
                )}
              </div>
            )}

            {/* Submit Button */}
            <div className="mt-auto pt-2 flex justify-end">
              <button
                type="submit"
                disabled={Boolean(existingDuplicateWorkload) || isSubmitting}
                className={`inline-flex items-center gap-2 px-6 py-2.5 text-white font-semibold text-sm rounded-xl shadow-md transition-all cursor-pointer hover:shadow-lg disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed disabled:shadow-none ${
                  isPremiumClinic
                    ? 'bg-orange-600 hover:bg-orange-500 active:bg-orange-700'
                    : isReferralClinic
                    ? 'bg-indigo-700 hover:bg-indigo-600 active:bg-indigo-800'
                    : 'bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800'
                }`}
              >
                <FileCheck2 className="w-4 h-4" />
                <span>
                  {isSubmitting
                    ? 'กำลังบันทึกข้อมูล...'
                    : existingDuplicateWorkload
                    ? 'มีข้อมูลภาระงานกะนี้แล้ว (บันทึกซ้ำไม่ได้)'
                    : isPremiumClinic
                    ? 'บันทึกข้อมูลศูนย์ปัญญาภิรมย์ (กำลังคน + ยอดผู้ป่วย)'
                    : isReferralClinic
                    ? 'บันทึกข้อมูลห้องรับ - ส่งต่อผู้ป่วย'
                    : 'บันทึกภาระงานห้องตรวจนี้'}
                </span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Info & Today's Records: 5 cols (equal height to Left Form) */}
        <div className="lg:col-span-5 lg:relative min-w-0">
          <div className="lg:absolute lg:inset-0 flex flex-col gap-4">
          {/* Quick Summary Card */}
          <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-4 flex flex-col flex-1 min-h-0">
            <h3 className="text-xs font-bold text-gray-800 mb-3 flex items-center justify-between shrink-0">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                รายการที่บันทึกแล้วในวันที่ {formatThaiShortDate(date)}
              </span>
              <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded text-[11px]">
                {todayWorkloads.length} รายการ
              </span>
            </h3>

            {todayWorkloads.length === 0 ? (
              <div className="flex-1 flex items-center justify-center py-8 text-center text-gray-400 text-xs">
                ยังไม่มีข้อมูลการบันทึกภาระงานในวันที่เลือก
              </div>
            ) : (
              <div className="space-y-2 flex-1 min-h-0 max-h-[460px] lg:max-h-none overflow-y-auto pr-1">
                {todayWorkloads.map((item) => {
                  const isPoolRow =
                    item.recordType === 'PREMIUM_POOL' || isPremiumPoolClinicName(item.clinic);
                  const isSubRow =
                    item.recordType === 'PREMIUM_SUB' ||
                    (!isPoolRow && isPremiumGroupName(item.clinicGroup));
                  const isReferralRow = isReferralWorkload(item);
                  const itemIsOffDuty = isOffDutyWorkload(item);
                  const itemOffReason = getWorkloadOffDutyReason(item);
                  const itemOffStaff = getWorkloadOffDutyStaff(item);
                  return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-xl border transition-all text-xs ${
                      itemIsOffDuty
                        ? 'border-violet-200 bg-violet-50/55'
                        : isPoolRow
                        ? 'border-orange-300 bg-orange-50/70'
                        : isSubRow
                        ? 'border-orange-200/80 bg-orange-50/30'
                        : isReferralRow
                        ? 'border-indigo-200 bg-indigo-50/35'
                        : 'border-gray-100 hover:border-emerald-200 bg-slate-50/70 hover:bg-emerald-50/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-gray-900 text-sm">
                            {isPoolRow ? PREMIUM_POOL_CLINIC_NAME : item.clinic}
                          </span>
                          {itemIsOffDuty && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-violet-700 text-white font-bold">
                              Off เวร
                            </span>
                          )}
                          {!itemIsOffDuty && itemOffStaff.length > 0 && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-violet-100 text-violet-900 border border-violet-300 font-bold">
                              Off เวรรายวัน {itemOffStaff.length} คน
                            </span>
                          )}
                          {isPoolRow && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-orange-600 text-white font-bold">
                              กำลังคนรวม
                            </span>
                          )}
                          {isSubRow && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-orange-100 text-orange-800 border border-orange-200 font-semibold">
                              ศูนย์ปัญญาภิรมย์
                            </span>
                          )}
                          {isReferralRow && !itemIsOffDuty && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 border border-indigo-200 font-semibold">
                              รับ-ส่งต่อผู้ป่วย
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500">{item.shift}</div>
                      </div>
                      <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
                        {onAdjustWorkloadPatients && !isPoolRow && !itemIsOffDuty && (
                          <button
                            type="button"
                            onClick={() => setAdjustingPatientWorkload(item)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10.5px] font-bold transition-colors cursor-pointer"
                            title="ปรับเพิ่ม/ลดจำนวนผู้ป่วย (ไม่ต้องใช้รหัส Admin)"
                          >
                            <SlidersHorizontal className="w-3 h-3" />
                            <span>ปรับยอดผู้ป่วย</span>
                          </button>
                        )}
                        {isAdmin && (
                          <>
                            {onUpdateWorkload && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingWorkload({
                                    ...item,
                                    totalPt: getEffectiveTotalPt(item),
                                    ...(itemIsOffDuty
                                      ? { isOffDuty: true, offDutyReason: itemOffReason }
                                      : {}),
                                    ...(itemOffStaff.length > 0 ? { offDutyStaff: itemOffStaff } : {}),
                                    ...(isReferralWorkload(item) && !itemIsOffDuty
                                      ? { referralData: normalizeReferralData(item.referralData) }
                                      : {}),
                                  });
                                  setAdminAddOffDutyStaffId('');
                                  setEditWorkloadReason('');
                                  setEditWorkloadReasonError('');
                                  setEditModalError('');
                                }}
                                className="text-gray-400 hover:text-blue-600 p-1 rounded transition-colors cursor-pointer"
                                title="แก้ไขรายการนี้ (ผู้ดูแลระบบ Admin)"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setDeletingWorkload(item);
                                setDeleteWorkloadReason('');
                                setDeleteWorkloadReasonError('');
                              }}
                              className="text-gray-400 hover:text-red-500 p-1 rounded transition-colors cursor-pointer"
                              title="ลบรายการนี้ (เฉพาะผู้ดูแลระบบ Admin)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {itemIsOffDuty ? (
                      <div className="bg-white/90 border border-violet-200 rounded-lg px-2.5 py-2 my-2 text-[11px] text-violet-950 font-medium flex items-center gap-2">
                        <PauseCircle className="w-4 h-4 text-violet-700 shrink-0" />
                        <span>
                          <strong>Off เวร / ปิดบริการกะนี้</strong>
                          {itemOffReason ? ` — เหตุผล: ${itemOffReason}` : ''}
                        </span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-1.5 text-center my-2">
                        <div className="bg-white p-1.5 rounded border border-gray-200">
                          <span className="block text-[10px] text-gray-500">
                            {isReferralRow ? 'รวมรายการ' : 'ผู้ป่วย'}
                          </span>
                          <span className="font-bold text-emerald-800 text-sm">
                            {isPoolRow ? '-' : getEffectiveTotalPt(item)}
                          </span>
                        </div>
                        <div className="bg-white p-1.5 rounded border border-gray-200">
                          <span className="block text-[10px] text-gray-500">Admit</span>
                          <span className="font-bold text-red-600 text-sm">
                            {isPoolRow ? '-' : item.admit}
                          </span>
                        </div>
                        <div className="bg-white p-1.5 rounded border border-gray-200">
                          <span className="block text-[10px] text-gray-500">RN+PN+NA</span>
                          <span className="font-bold text-blue-800 text-sm">
                            {isSubRow
                              ? 'ร่วม'
                              : (item.rn + item.pn + (item.na ?? item.pca ?? 0)).toFixed(1)}
                          </span>
                        </div>
                      </div>
                    )}

                    {!itemIsOffDuty && itemOffStaff.length > 0 && (
                      <div className="mb-1.5 px-2 py-1 rounded-md bg-violet-50 border border-violet-200 text-[10.5px] text-violet-900">
                        <strong>Off เวรรายวัน:</strong> {formatOffDutyStaffSummaryText(itemOffStaff)}
                      </div>
                    )}

                    {!itemIsOffDuty && isReferralRow && item.referralData && (
                      <div className="bg-white/90 border border-indigo-100 rounded-lg p-2 mb-2 grid grid-cols-2 gap-1 text-[10.5px]">
                        {REFERRAL_ITEM_DEFINITIONS.map(({ key, label }) => {
                          const entry = item.referralData?.[key];
                          const cnt = Number(entry?.count) || 0;
                          const reason = (entry?.reason || '').trim();
                          return (
                            <div key={key} className="flex items-center justify-between gap-1 px-1.5 py-0.5 rounded bg-indigo-50/40">
                              <span className="text-gray-700 truncate">{label}:</span>
                              <span className="font-bold text-indigo-950 shrink-0">
                                {cnt > 0 ? cnt : '-'}
                                {reason ? ` (${reason})` : ''}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[10px] text-gray-500 border-t border-gray-200/60 pt-1.5">
                      <span>ผู้รายงาน: {item.reporter}</span>
                      {item.note && <span className="text-gray-600 truncate max-w-[120px]" title={item.note}>{item.note}</span>}
                    </div>
                    {(item.lastEditReason || item.lastEditedAt) && (
                      <div className="mt-1.5 text-[10px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-md px-2 py-1">
                        <span className="font-semibold">แก้ไขล่าสุด:</span> {item.lastEditReason || '-'}
                        {item.lastEditedAt && (
                          <span className="text-amber-700 ml-1">• {formatThaiDateTime(item.lastEditedAt)}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
                })}
              </div>
            )}

            {todayWorkloads.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-gray-100 shrink-0">
                {isAdmin ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg py-1 px-2 text-center flex items-center justify-center gap-1.5 text-[11px] text-emerald-800 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>โหมด Admin: แสดงปุ่มถังขยะสำหรับลบรายการบันทึกแล้ว</span>
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 text-center flex items-center justify-between text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Lock className="w-3 h-3 text-slate-400" />
                      รูปถังขยะอนุญาตให้เห็นเฉพาะ Admin
                    </span>
                    {onPromptAdminUnlock && (
                      <button
                        type="button"
                        onClick={onPromptAdminUnlock}
                        className="text-emerald-700 font-bold hover:underline cursor-pointer"
                      >
                        ปลดล็อกด้วยรหัสผ่าน
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Clinical Informatics Reference Card */}
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-2xl p-4 shadow-sm text-xs space-y-2.5 shrink-0">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <HelpCircle className="w-4 h-4" />
              <span>หลักการคำนวณกำลังคนทางการพยาบาล OPD</span>
            </div>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              • <strong>อัตรากำลังปฏิบัติงาน (Input):</strong> นับรวมเฉพาะผู้ปฏิบัติงานทางการพยาบาล ได้แก่ <strong>RN + PN + NA</strong> โดยไม่รวม HN ตามเกณฑ์จำแนกภาระงาน
            </p>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              • <strong>การเกลี่ยอัตรากำลัง 0.5:</strong> สำหรับเจ้าหน้าที่ที่หมุนเวียนปฏิบัติงานครึ่งวัน หรือช่วยงานข้ามแผนกในชั่วโมงเร่งด่วน
            </p>
          </div>
          </div>
        </div>
      </div>

      {/* Admin Edit Workload Modal */}
      {editingWorkload && onUpdateWorkload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-gray-900">
                  แก้ไขข้อมูลภาระงานห้องตรวจ (เฉพาะ Admin)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingWorkload(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Row 1: Date (พ.ศ.), Clinic, Shift */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">วันที่ (พ.ศ.)</label>
                  <ThaiDateInput
                    value={editingWorkload.date}
                    onChange={(iso) => setEditingWorkload({ ...editingWorkload, date: iso })}
                    selectClassName="w-full px-2.5 py-1.5 pr-9 border border-gray-300 rounded-lg text-xs bg-white font-medium text-gray-900 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ห้องตรวจ / แผนก</label>
                  <input
                    type="text"
                    value={editingWorkload.clinic}
                    onChange={(e) => setEditingWorkload({ ...editingWorkload, clinic: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">กะเวลา</label>
                  <select
                    value={editingWorkload.shift}
                    onChange={(e) => setEditingWorkload({ ...editingWorkload, shift: e.target.value as WorkShift })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    <option value="ในเวลา 08:00-16:00">ในเวลา 08:00-16:00</option>
                    <option value="นอกเวลาเย็น 16:00-20:00">นอกเวลาเย็น 16:00-20:00</option>
                    <option value="นอกเวลาวันหยุด 08:00-12:00">นอกเวลาวันหยุด 08:00-12:00</option>
                  </select>
                </div>
              </div>

              {/* Admin Edit Modal: Daily Wage Off เวร Editor (+ legacy Off-Duty clear if present) */}
              {editingWorkload.isOffDuty && (
                <div className="rounded-xl border border-violet-300 bg-violet-50 p-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-violet-950">
                    <strong>พบสถานะปิดบริการเดิม (Off เวรทั้งกะ):</strong>{' '}
                    {editingWorkload.offDutyReason || 'งดออกตรวจ'}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingWorkload({
                        ...editingWorkload,
                        isOffDuty: false,
                        offDutyReason: '',
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-white border border-violet-300 text-violet-900 hover:bg-violet-100 font-semibold text-[11px] cursor-pointer"
                  >
                    ล้างสถานะปิดบริการเดิม
                  </button>
                </div>
              )}

              {editingWorkload.recordType !== 'PREMIUM_SUB' && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-violet-950 flex items-center gap-1.5">
                      <PauseCircle className="w-4 h-4 text-violet-700" />
                      <span>เจ้าหน้าที่ตำแหน่ง &quot;รายวัน&quot; ที่ Off เวร (ยอดผู้ป่วยน้อยลง)</span>
                    </div>
                    <span className="text-[11px] font-semibold text-violet-800">
                      {(editingWorkload.offDutyStaff || []).length} คน
                    </span>
                  </div>

                  {(editingWorkload.offDutyStaff || []).length > 0 && (
                    <div className="space-y-1.5">
                      {(editingWorkload.offDutyStaff || []).map((entry, idx) => {
                        const isOut = editingWorkload.shift !== 'ในเวลา 08:00-16:00';
                        const pVal =
                          entry.amount === 1
                            ? 'FULL'
                            : isOut
                              ? 'HALF_SHIFT'
                              : entry.periodLabel === 'ครึ่งวันบ่าย'
                                ? 'HALF_PM'
                                : 'HALF_AM';
                        return (
                          <div
                            key={`${entry.staffName}-${idx}`}
                            className="bg-white border border-violet-200 rounded-lg p-2 space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-violet-950">
                                {entry.staffName}{' '}
                                <span className="text-[10px] font-semibold text-violet-700">
                                  ([รายวัน] {formatPositionLabel(entry.position)})
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingWorkload({
                                    ...editingWorkload,
                                    offDutyStaff: (editingWorkload.offDutyStaff || []).filter(
                                      (_, i) => i !== idx
                                    ),
                                  })
                                }
                                className="text-gray-400 hover:text-red-600 p-0.5 cursor-pointer"
                                title="นำออก"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <select
                                value={pVal}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const nextList = (editingWorkload.offDutyStaff || []).map((it, i) => {
                                    if (i !== idx) return it;
                                    if (v === 'HALF_SHIFT')
                                      return { ...it, amount: 0.5 as const, periodLabel: 'ครึ่งเวร' as const };
                                    if (v === 'HALF_AM')
                                      return { ...it, amount: 0.5 as const, periodLabel: 'ครึ่งวันเช้า' as const };
                                    if (v === 'HALF_PM')
                                      return { ...it, amount: 0.5 as const, periodLabel: 'ครึ่งวันบ่าย' as const };
                                    const copy = { ...it, amount: 1 as const };
                                    delete copy.periodLabel;
                                    return copy;
                                  });
                                  setEditingWorkload({ ...editingWorkload, offDutyStaff: nextList });
                                }}
                                className="px-2 py-1 border border-violet-200 rounded-lg text-xs bg-white"
                              >
                                {isOut ? (
                                  <>
                                    <option value="FULL">เต็มเวรนอกเวลา (1.0)</option>
                                    <option value="HALF_SHIFT">ครึ่งเวร (0.5)</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="FULL">เต็มวัน (1.0)</option>
                                    <option value="HALF_AM">ครึ่งวันเช้า (0.5)</option>
                                    <option value="HALF_PM">ครึ่งวันบ่าย (0.5)</option>
                                  </>
                                )}
                              </select>
                              <input
                                type="text"
                                value={entry.reason || ''}
                                onChange={(e) => {
                                  const nextList = (editingWorkload.offDutyStaff || []).map((it, i) =>
                                    i === idx ? { ...it, reason: e.target.value } : it
                                  );
                                  setEditingWorkload({ ...editingWorkload, offDutyStaff: nextList });
                                }}
                                placeholder="เหตุผล Off เวร..."
                                className="px-2 py-1 border border-violet-200 rounded-lg text-xs bg-white"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {allDailyWageStaff.length > 0 ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select
                        value={adminAddOffDutyStaffId}
                        onChange={(e) => setAdminAddOffDutyStaffId(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 border border-violet-200 rounded-lg text-xs bg-white"
                      >
                        <option value="">-- เลือกเจ้าหน้าที่ตำแหน่งรายวันเพื่อเพิ่ม Off เวร --</option>
                        {allDailyWageStaff.map((s) => (
                          <option key={s.staffId} value={s.staffId}>
                            {s.name} ([รายวัน] {formatPositionLabel(s.position)} • {s.homeClinic})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!adminAddOffDutyStaffId}
                        onClick={() => {
                          const st = allDailyWageStaff.find((s) => s.staffId === adminAddOffDutyStaffId);
                          if (!st) return;
                          const curr = editingWorkload.offDutyStaff || [];
                          if (curr.some((x) => x.staffName === st.name && x.amount === 1)) return;
                          setEditingWorkload({
                            ...editingWorkload,
                            offDutyStaff: [
                              ...curr,
                              {
                                staffName: st.name,
                                position: st.position,
                                amount: 1,
                                reason: OFF_DUTY_STAFF_REASON_PRESETS[0],
                              },
                            ],
                          });
                          setAdminAddOffDutyStaffId('');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:bg-gray-300 text-white font-semibold text-xs flex items-center justify-center gap-1 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>เพิ่ม Off เวรรายวัน</span>
                      </button>
                    </div>
                  ) : (
                    <div className="text-[11px] text-gray-500">
                      ยังไม่มีบุคลากรตำแหน่ง &quot;รายวัน&quot; ในทะเบียนบุคลากรเมนู 5
                    </div>
                  )}
                </div>
              )}

              {/* Row 2: Patient counts & Admit (or Referral Center 6-item Table) */}
              {isReferralWorkload(editingWorkload) ? (
                <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-950">
                      ข้อมูลห้องรับ - ส่งต่อผู้ป่วย (คำนวณยอดรวมและ Admit อัตโนมัติ)
                    </span>
                    <span className="text-[11px] font-bold text-indigo-800">
                      รวม {getReferralTotalCount(normalizeReferralData(editingWorkload.referralData))} | Admit{' '}
                      {getReferralAdmitCount(normalizeReferralData(editingWorkload.referralData))}
                    </span>
                  </div>
                  <div className="bg-white border border-indigo-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-indigo-100/70 text-indigo-950 font-bold border-b border-indigo-200">
                        <tr>
                          <th className="py-1.5 px-2.5 text-left w-36">รายการ</th>
                          <th className="py-1.5 px-2 text-center w-24">จำนวน</th>
                          <th className="py-1.5 px-2.5 text-left">เหตุผล</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-indigo-100">
                        {REFERRAL_ITEM_DEFINITIONS.map(({ key, label }) => {
                          const currentRef = normalizeReferralData(editingWorkload.referralData);
                          const entry = currentRef[key];
                          return (
                            <tr key={key}>
                              <td className="py-1 px-2.5 font-semibold text-gray-800">{label}</td>
                              <td className="py-1 px-2">
                                <input
                                  type="number"
                                  min="0"
                                  disabled={Boolean(editingWorkload.isOffDuty)}
                                  value={entry.count || ''}
                                  onChange={(e) => {
                                    const nextRef: ReferralCenterData = {
                                      ...currentRef,
                                      [key]: {
                                        ...entry,
                                        count: Math.max(0, Number(e.target.value) || 0),
                                      },
                                    };
                                    setEditingWorkload({
                                      ...editingWorkload,
                                      referralData: nextRef,
                                      totalPt: getReferralTotalCount(nextRef),
                                      adultPt: 0,
                                      childPt: 0,
                                      admit: getReferralAdmitCount(nextRef),
                                    });
                                  }}
                                  className="w-full text-center font-bold border border-indigo-200 rounded py-1 px-1.5 text-xs disabled:bg-gray-100 disabled:text-gray-400"
                                />
                              </td>
                              <td className="py-1 px-2">
                                <input
                                  type="text"
                                  disabled={Boolean(editingWorkload.isOffDuty)}
                                  value={entry.reason}
                                  onChange={(e) => {
                                    const nextRef: ReferralCenterData = {
                                      ...currentRef,
                                      [key]: {
                                        ...entry,
                                        reason: e.target.value,
                                      },
                                    };
                                    setEditingWorkload({
                                      ...editingWorkload,
                                      referralData: nextRef,
                                    });
                                  }}
                                  placeholder="ระบุเหตุผล..."
                                  className="w-full border border-gray-200 rounded py-1 px-2 text-xs disabled:bg-gray-100 disabled:text-gray-400"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-xl border border-gray-200">
                <div>
                  <label className="block font-semibold text-blue-900 mb-1">ผู้ป่วยทั้งหมด</label>
                  <input
                    type="number"
                    min="0"
                    disabled={Boolean(editingWorkload.isOffDuty)}
                    value={editingWorkload.totalPt}
                    onChange={(e) => {
                      const nextTotal = Math.max(0, Number(e.target.value) || 0);
                      setEditingWorkload({
                        ...editingWorkload,
                        totalPt: nextTotal,
                        adultPt: Math.max(0, nextTotal - (editingWorkload.childPt || 0)),
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg text-xs font-bold text-blue-900 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ผู้ใหญ่</label>
                  <input
                    type="number"
                    min="0"
                    disabled={Boolean(editingWorkload.isOffDuty)}
                    value={editingWorkload.adultPt}
                    onChange={(e) => {
                      const nextAdult = Math.max(0, Number(e.target.value) || 0);
                      setEditingWorkload({
                        ...editingWorkload,
                        adultPt: nextAdult,
                        totalPt: nextAdult + (editingWorkload.childPt || 0),
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">เด็ก</label>
                  <input
                    type="number"
                    min="0"
                    disabled={Boolean(editingWorkload.isOffDuty)}
                    value={editingWorkload.childPt}
                    onChange={(e) => {
                      const nextChild = Math.max(0, Number(e.target.value) || 0);
                      setEditingWorkload({
                        ...editingWorkload,
                        childPt: nextChild,
                        totalPt: (editingWorkload.adultPt || 0) + nextChild,
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-red-600 mb-1">Admit (คน)</label>
                  <input
                    type="number"
                    min="0"
                    disabled={Boolean(editingWorkload.isOffDuty)}
                    value={editingWorkload.admit}
                    onChange={(e) => setEditingWorkload({ ...editingWorkload, admit: Number(e.target.value) || 0 })}
                    className="w-full px-2.5 py-1.5 border border-red-300 rounded-lg text-xs font-bold text-red-600 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
              </div>
              )}

              {/* Row 3: Staffing (RN, PN, NA, Clerk, Service Worker) */}
              <div>
                <label className="block font-semibold text-gray-800 mb-1.5">
                  กำลังคนปฏิบัติงาน (รองรับ 0.5 แรง)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <div>
                    <span className="block text-[11px] font-bold text-blue-800 mb-1">RN *</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={Boolean(editingWorkload.isOffDuty)}
                      value={editingWorkload.rn}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, rn: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-blue-300 rounded text-center text-xs font-bold text-blue-900 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-teal-800 mb-1">PN *</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={Boolean(editingWorkload.isOffDuty)}
                      value={editingWorkload.pn}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, pn: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-teal-300 rounded text-center text-xs font-bold text-teal-900 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-emerald-800 mb-1">NA *</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={Boolean(editingWorkload.isOffDuty)}
                      value={editingWorkload.na ?? editingWorkload.pca ?? 0}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, na: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-emerald-300 rounded text-center text-xs font-bold text-emerald-900 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] text-gray-500 mb-1">ผู้ปฏิบัติงานทั่วไป</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={Boolean(editingWorkload.isOffDuty)}
                      value={editingWorkload.clerk}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, clerk: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] text-gray-500 mb-1">พนักงานบริการ</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={Boolean(editingWorkload.isOffDuty)}
                      value={editingWorkload.serviceWorker}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, serviceWorker: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                </div>
              </div>

              {/* Row 4: Reporter & Note */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    ผู้บันทึกรายงาน <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editingWorkload.reporter}
                    onChange={(e) => {
                      setEditingWorkload({ ...editingWorkload, reporter: e.target.value });
                      if (editModalError) setEditModalError('');
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                    placeholder="เช่น พว.สุดารัตน์ ศิริพรหม"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">หมายเหตุ</label>
                  <input
                    type="text"
                    value={editingWorkload.note || ''}
                    onChange={(e) => setEditingWorkload({ ...editingWorkload, note: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                    placeholder="หมายเหตุเพิ่มเติม"
                  />
                </div>
              </div>

              {editModalError && (
                <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editModalError}</span>
                </div>
              )}

              {/* Mandatory Edit Reason + Timestamp Preview */}
              <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="block font-bold text-amber-900">
                    เหตุผลการแก้ไขรายการ <span className="text-red-600">*</span>
                  </label>
                  <span className="text-[11px] text-amber-700 font-medium">
                    เวลาที่บันทึก: {formatThaiDateTime(new Date().toISOString())}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['แก้ไขจำนวนผู้ป่วย', 'แก้ไขจำนวนเจ้าหน้าที่ขึ้นเวร', 'แก้ไขห้องตรวจ/กะเวลา', 'แก้ไขชื่อผู้รายงาน'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setEditWorkloadReason(preset);
                        setEditWorkloadReasonError('');
                      }}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                        editWorkloadReason === preset
                          ? 'bg-amber-600 text-white border-amber-600 font-semibold'
                          : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={editWorkloadReason}
                  onChange={(e) => {
                    setEditWorkloadReason(e.target.value);
                    if (editWorkloadReasonError) setEditWorkloadReasonError('');
                  }}
                  placeholder="ระบุเหตุผลการแก้ไข เช่น แก้ไขยอดผู้ป่วยนอกช่วงบ่าย..."
                  className={`w-full px-3 py-1.5 border rounded-lg text-xs bg-white ${
                    editWorkloadReasonError ? 'border-red-400 focus:ring-red-400' : 'border-amber-300'
                  }`}
                />
                {editWorkloadReasonError && (
                  <p className="text-[11px] text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{editWorkloadReasonError}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setEditingWorkload(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (editingWorkload.isOffDuty && !(editingWorkload.offDutyReason || '').trim()) {
                    setEditModalError('กรุณาระบุเหตุผลการ Off เวร');
                    return;
                  }
                  if (!editingWorkload.reporter.trim()) {
                    setEditModalError('กรุณาระบุชื่อผู้บันทึกรายงาน');
                    return;
                  }
                  const dupWorkload = workloads.find(
                    w =>
                      w.id !== editingWorkload.id &&
                      w.date === editingWorkload.date &&
                      w.shift === editingWorkload.shift &&
                      (w.clinic || '').trim() === (editingWorkload.clinic || '').trim() &&
                      (w.recordType || 'STANDARD') === (editingWorkload.recordType || 'STANDARD')
                  );
                  if (dupWorkload) {
                    setEditModalError(
                      `ไม่สามารถบันทึกซ้ำได้: แผนก ${editingWorkload.clinic} วันที่ ${formatThaiShortDate(editingWorkload.date)} กะเวลา "${editingWorkload.shift}" มีรายการอื่นบันทึกไว้แล้ว`
                    );
                    return;
                  }
                  if (!editWorkloadReason.trim()) {
                    setEditWorkloadReasonError('กรุณาระบุเหตุผลการแก้ไขรายการก่อนบันทึก');
                    return;
                  }
                  setEditModalError('');
                  onUpdateWorkload(editingWorkload, editWorkloadReason.trim());
                  setEditingWorkload(null);
                  setEditWorkloadReason('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>บันทึกการแก้ไข</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Delete Workload Confirmation Modal (Mandatory Reason) */}
      {deletingWorkload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-red-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-red-100 pb-3">
              <div className="flex items-center gap-2 text-red-700">
                <Trash2 className="w-5 h-5" />
                <h3 className="text-base font-bold">ยืนยันการลบรายการภาระงาน</h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingWorkload(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1 text-gray-700">
              <div className="font-bold text-gray-900">{deletingWorkload.clinic} ({deletingWorkload.shift})</div>
              <div>วันที่: <span className="font-semibold">{formatThaiShortDate(deletingWorkload.date)}</span></div>
              <div>ผู้ป่วยทั้งหมด: <span className="font-semibold">{getEffectiveTotalPt(deletingWorkload)} คน</span> • ผู้รายงาน: {deletingWorkload.reporter}</div>
            </div>

            <div className="bg-red-50/70 border border-red-200 rounded-xl p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="font-bold text-red-900">
                  เหตุผลการลบรายการ <span className="text-red-600">*</span>
                </label>
                <span className="text-[11px] text-red-700 font-medium">
                  เวลาที่ลบ: {formatThaiDateTime(new Date().toISOString())}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['บันทึกซ้ำซ้อน', 'บันทึกผิดห้องตรวจ/ผิดวัน', 'ยกเลิกรายการ'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setDeleteWorkloadReason(preset);
                      setDeleteWorkloadReasonError('');
                    }}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                      deleteWorkloadReason === preset
                        ? 'bg-red-600 text-white border-red-600 font-semibold'
                        : 'bg-white text-red-800 border-red-300 hover:bg-red-100'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={deleteWorkloadReason}
                onChange={(e) => {
                  setDeleteWorkloadReason(e.target.value);
                  if (deleteWorkloadReasonError) setDeleteWorkloadReasonError('');
                }}
                placeholder="ระบุเหตุผลการลบ เช่น บันทึกข้อมูลซ้ำซ้อน..."
                className={`w-full px-3 py-1.5 border rounded-lg text-xs bg-white ${
                  deleteWorkloadReasonError ? 'border-red-500' : 'border-red-300'
                }`}
              />
              {deleteWorkloadReasonError && (
                <p className="text-[11px] text-red-700 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{deleteWorkloadReasonError}</span>
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setDeletingWorkload(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!deleteWorkloadReason.trim()) {
                    setDeleteWorkloadReasonError('กรุณาระบุเหตุผลการลบรายการก่อนยืนยัน');
                    return;
                  }
                  onDeleteWorkload(deletingWorkload.id, deleteWorkloadReason.trim());
                  setDeletingWorkload(null);
                  setDeleteWorkloadReason('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>ยืนยันการลบ</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* General User / Staff Patient Count Adjustment Modal */}
      <AdjustPatientModal
        workload={adjustingPatientWorkload}
        defaultAdjusterName={reporter}
        onClose={() => setAdjustingPatientWorkload(null)}
        onConfirm={(target, patch, adjusterName, reason) => {
          onAdjustWorkloadPatients?.(target, patch, adjusterName, reason);
        }}
      />
    </div>
  );
};
