import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  DailyWorkload, 
  StaffMember,
  LeaveRecord,
  OTAttendance,
  SystemSettings, 
  IN_TIME_CLINICS, 
  OUT_TIME_CLINICS, 
  SHIFTS, 
  getEffectiveTotalPt,
  getClinicNhppd,
  SCREENING_CLINIC_NAME,
  PREMIUM_CLINIC_GROUP,
  LEGACY_PREMIUM_CLINIC_GROUP,
  DEFAULT_PREMIUM_SUB_CLINICS,
  isPremiumGroupName,
  isPremiumPoolClinicName,
  isPremiumWorkloadRecord,
  normalizeWorkloadRecord,
  normalizeWorkloadDateStr,
  normalizeWorkloadShiftStr,
  isTrainingLeaveType,
  parseLeavePeriodFromNote,
  stripLeavePeriodFromNote,
  parseOtWorkClinic,
  REFERRAL_CLINIC_NAME,
  REFERRAL_ITEM_DEFINITIONS,
  isReferralClinicName,
  isReferralWorkload,
  formatReferralSummaryText,
  normalizeReferralData,
  getWorkloadRolePosition,
  OffDutyStaffEntry,
  isOffDutyWorkload,
  getWorkloadOffDutyReason,
  getWorkloadOffDutyStaff,
  formatOffDutyStaffSummaryText,
} from '../types';
import { ThaiMonthInput } from './ThaiDateInput';
import { THAI_MONTHS, formatThaiShortDate, getLocalCurrentMonthIso } from '../utils/thaiDate';
import { getHolidaysForYear } from '../utils/thaiHolidays';
import { exportElementAsJpeg } from '../utils/exportImage';
import {
  OPHTHALMOLOGY_CLINIC_NAME,
  EyeNaMappingMode,
  isOphthalmologyOutTimeRecord,
  computeEyeOutTimeRow,
  summarizeEyeOutTimeRows,
} from '../utils/ophthalmologyOutTime';
import { 
  BarChart3, 
  PieChart, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  Flame, 
  Calculator, 
  Layers, 
  Info, 
  Sliders, 
  Sparkles,
  ArrowRight,
  Star,
  Printer,
  ImageDown,
  FileSpreadsheet,
  ShieldCheck,
  ShieldAlert,
  CalendarOff,
  GraduationCap,
  ArrowRightLeft,
  Users,
  PauseCircle,
  Eye,
  Download
} from 'lucide-react';

interface ProductivityTabProps {
  workloads: DailyWorkload[];
  staffList?: StaffMember[];
  leaves?: LeaveRecord[];
  otRecords?: OTAttendance[];
  settings: SystemSettings;
  inTimeClinics?: string[];
  outTimeClinics?: string[];
  premiumSubClinics?: string[];
}

export const ProductivityTab: React.FC<ProductivityTabProps> = ({
  workloads,
  staffList = [],
  leaves = [],
  otRecords = [],
  settings,
  inTimeClinics = [...IN_TIME_CLINICS],
  outTimeClinics = [...OUT_TIME_CLINICS],
  premiumSubClinics = [...DEFAULT_PREMIUM_SUB_CLINICS],
}) => {
  // Current month string YYYY-MM
  const currentMonthStr = getLocalCurrentMonthIso();

  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [selectedShift, setSelectedShift] = useState<string>('ในเวลา 08:00-16:00');
  const [selectedClinic, setSelectedClinic] = useState<string>('ALL');
  const [excludeLasik, setExcludeLasik] = useState<boolean>(true); // Default exclude LASIK as per standard OPD nursing formula
  const [excludeReferral, setExcludeReferral] = useState<boolean>(false);
  const [showAllVerificationDays, setShowAllVerificationDays] = useState<boolean>(false);
  const [isExportingJpeg, setIsExportingJpeg] = useState<boolean>(false);
  const [eyeNaMappingMode, setEyeNaMappingMode] = useState<EyeNaMappingMode>('auto');
  const [includeEyeInPrint, setIncludeEyeInPrint] = useState<boolean>(true);
  const [isExportingEyeJpeg, setIsExportingEyeJpeg] = useState<boolean>(false);
  const reportSheetRef = useRef<HTMLDivElement | null>(null);
  const eyeReportSheetRef = useRef<HTMLDivElement | null>(null);

  // Combine unique clinics list (exclude group names so "★ ศูนย์ปัญญาภิรมย์" renders once at top)
  const allClinicsList = useMemo(() => {
    return Array.from(new Set([...inTimeClinics, ...outTimeClinics])).filter(
      c => c !== PREMIUM_CLINIC_GROUP && c !== LEGACY_PREMIUM_CLINIC_GROUP
    );
  }, [inTimeClinics, outTimeClinics]);

  useEffect(() => {
    if (
      selectedClinic !== 'ALL' &&
      selectedClinic !== PREMIUM_CLINIC_GROUP &&
      allClinicsList.length > 0 &&
      !allClinicsList.includes(selectedClinic)
    ) {
      setSelectedClinic('ALL');
    }
  }, [allClinicsList, selectedClinic]);

  // Filter workloads matching month, shift, clinic, and LASIK rule
  const filteredWorkloads = useMemo(() => {
    return workloads.filter(w => {
      const matchMonth = w.date.startsWith(selectedMonth);
      const matchShift = selectedShift === 'ALL' || w.shift === selectedShift;
      const clinicTrim = (w.clinic || '').trim();
      const matchClinic =
        selectedClinic === 'ALL' ||
        (selectedClinic === PREMIUM_CLINIC_GROUP
          ? isPremiumWorkloadRecord(w, premiumSubClinics) ||
            clinicTrim === PREMIUM_CLINIC_GROUP ||
            clinicTrim === LEGACY_PREMIUM_CLINIC_GROUP
          : w.clinic === selectedClinic);
      const matchLasik = !(excludeLasik && selectedClinic === 'ALL' && w.clinic === 'ศูนย์เลสิก');
      const matchReferral = !(excludeReferral && selectedClinic === 'ALL' && isReferralWorkload(w));

      return matchMonth && matchShift && matchClinic && matchLasik && matchReferral;
    });
  }, [workloads, selectedMonth, selectedShift, selectedClinic, excludeLasik, excludeReferral, premiumSubClinics]);

  // Working days count: unique active dates (exclude pure Off เวร dates when open dates exist)
  const workingDays = useMemo(() => {
    const activeDates = new Set(filteredWorkloads.filter(w => !isOffDutyWorkload(w)).map(w => w.date));
    if (activeDates.size > 0) return activeDates.size;
    const allDates = new Set(filteredWorkloads.map(w => w.date));
    return allDates.size > 0 ? allDates.size : 1;
  }, [filteredWorkloads]);

  // Totals calculation (uses 0.1 NHPPD for หน่วยคัดกรอง and 0.4 for all other clinics)
  const stats = useMemo(() => {
    const totalPt = filteredWorkloads.reduce((sum, w) => sum + getEffectiveTotalPt(w), 0);
    const totalAdmit = filteredWorkloads.reduce((sum, w) => sum + (w.admit || 0), 0);
    const sumRN = filteredWorkloads.reduce((sum, w) => sum + (w.rn || 0), 0);
    const sumPN = filteredWorkloads.reduce((sum, w) => sum + (w.pn || 0), 0);
    const sumNA = filteredWorkloads.reduce((sum, w) => sum + (w.na !== undefined ? w.na : (w.pca || 0)), 0);
    const sumHN = filteredWorkloads.reduce((sum, w) => sum + (w.hn || 0), 0);
    const totalNursingStaff = sumRN + sumPN + sumNA; // Exclude HN

    const generalNhppd = Number(settings.nhppd) > 0 ? Number(settings.nhppd) : 0.4;
    const screeningNhppd = Number(settings.screeningNhppd) > 0 ? Number(settings.screeningNhppd) : 0.1;
    const hasScreeningRecords = filteredWorkloads.some(w => w.clinic === SCREENING_CLINIC_NAME);
    const isScreeningOnly =
      selectedClinic === SCREENING_CLINIC_NAME ||
      (filteredWorkloads.length > 0 && filteredWorkloads.every(w => w.clinic === SCREENING_CLINIC_NAME));

    // 1) ผู้ป่วยเฉลี่ย/วัน = Total_Pt / จำนวนวันทำการ
    const avgPtPerDay = totalPt / workingDays;

    // 2) อัตรากำลังที่ต้องการ (FTC) = ผลรวม (ผู้ป่วยแต่ละหน่วย * NHPPD ของหน่วยนั้น) / (วันทำการ * Std_Hr)
    const totalRequiredHours = filteredWorkloads.reduce(
      (sum, w) => sum + getEffectiveTotalPt(w) * getClinicNhppd(w.clinic, settings),
      0
    );
    const stdHr = Number(settings.stdHr) || 7;
    const ftc = (totalRequiredHours / workingDays) / stdHr;
    const effectiveNhppd = totalPt > 0
      ? totalRequiredHours / totalPt
      : isScreeningOnly
      ? screeningNhppd
      : generalNhppd;

    // 3) Output (อัตรากำลังที่ต้องการ/วัน) = (ข้อ 2 * Annual_Hr) / (Work_Days * 8)
    const annualHr = Number(settings.annualHr) || 2080;
    const workDays = Number(settings.workDays) || 245;
    const output = (ftc * annualHr) / (workDays * 8);

    // 4) Input (อัตรากำลังจัดเฉลี่ย/วัน) = (ผลรวม RN + PN + NA) / จำนวนวันทำการ (ไม่รวม HN)
    const input = totalNursingStaff / workingDays;

    // 5) Productivity (%) = (Output / Input) * 100
    const productivity = input > 0 ? (output / input) * 100 : 0;

    // 6) Skill Mix (%) = RN / (RN + PN + NA) * 100
    const skillMix = totalNursingStaff > 0 ? (sumRN / totalNursingStaff) * 100 : 0;

    return {
      totalPt,
      totalAdmit,
      sumRN,
      sumPN,
      sumNA,
      sumHN,
      totalNursingStaff,
      avgPtPerDay,
      ftc,
      output,
      input,
      productivity,
      skillMix,
      generalNhppd,
      screeningNhppd,
      effectiveNhppd,
      hasScreeningRecords,
      isScreeningOnly,
    };
  }, [filteredWorkloads, workingDays, settings, selectedClinic]);

  // Productivity Status
  const getProductivityStatus = (prod: number) => {
    if (prod === 0) return { label: 'ยังไม่มีข้อมูล', color: 'text-gray-500 bg-gray-100 border-gray-300', level: 'empty' };
    if (prod < 85) {
      return { 
        label: 'ต่ำกว่าเกณฑ์ (< 85%) - กำลังคนสูงกว่าภาระงาน', 
        color: 'text-amber-800 bg-amber-50 border-amber-300', 
        level: 'low',
        badge: 'Under-utilized',
        icon: AlertTriangle,
        advice: 'พิจารณาเกลี่ยอัตรากำลังพยาบาลไปยังห้องตรวจที่มีภาระงานสูง หรือปรับลดเวรเสริม'
      };
    }
    if (prod <= 115) {
      return { 
        label: 'เหมาะสมตามเกณฑ์มาตรฐาน (85% - 115%)', 
        color: 'text-emerald-800 bg-emerald-50 border-emerald-300', 
        level: 'optimal',
        badge: 'Optimal Ratio',
        icon: CheckCircle2,
        advice: 'การจัดอัตรากำลังสมดุลกับภาระงานผู้ป่วย คุณภาพการพยาบาลและความปลอดภัยอยู่ในเกณฑ์ดีเยี่ยม'
      };
    }
    return { 
      label: 'สูงเกินเกณฑ์ (> 115%) - ภาระงานหนักเกินมาตรฐาน', 
      color: 'text-red-800 bg-red-50 border-red-300', 
      level: 'high',
      badge: 'Overloaded',
      icon: Flame,
      advice: 'พิจารณาเสริมอัตรากำลัง RN/PN ในช่วงเวลาพีค หรือเปิดรับเวรนอกเวลาเสริมเพื่อป้องกันภาวะหมดไฟและความเสี่ยงทางคลินิก'
    };
  };

  const status = getProductivityStatus(stats.productivity);
  const StatusIcon = status.icon || Info;

  // Breakdown by Clinic (Collapses all PREMIUM_POOL & PREMIUM_SUB rows into 1 grouped Pooled Staffing clinic row)
  const clinicBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        totalPt: number;
        rn: number;
        pn: number;
        na: number;
        days: Set<string>;
        activeDays: Set<string>;
        isPremiumGroup: boolean;
        subClinicTotals: Record<string, number>;
      }
    >();

    filteredWorkloads.forEach(raw => {
      const clinicTrim = (raw.clinic || '').trim();
      const isPremium =
        isPremiumWorkloadRecord(raw, premiumSubClinics) ||
        clinicTrim === PREMIUM_CLINIC_GROUP ||
        clinicTrim === LEGACY_PREMIUM_CLINIC_GROUP;
      const w = isPremium ? normalizeWorkloadRecord(raw, premiumSubClinics) : raw;
      const c = isPremium ? PREMIUM_CLINIC_GROUP : w.clinic;

      if (!map.has(c)) {
        map.set(c, {
          totalPt: 0,
          rn: 0,
          pn: 0,
          na: 0,
          days: new Set(),
          activeDays: new Set(),
          isPremiumGroup: isPremium,
          subClinicTotals: {},
        });
      }
      const item = map.get(c)!;
      const pt = getEffectiveTotalPt(w);
      item.totalPt += pt;
      item.rn += w.rn || 0;
      item.pn += w.pn || 0;
      item.na += (w.na !== undefined ? w.na : (w.pca || 0));
      item.days.add(w.date);
      if (!isOffDutyWorkload(w)) {
        item.activeDays.add(w.date);
      }

      if (isPremium && w.recordType === 'PREMIUM_SUB' && pt > 0) {
        item.subClinicTotals[w.clinic] = (item.subClinicTotals[w.clinic] || 0) + pt;
      }
    });

    const list = Array.from(map.entries()).map(([clinicName, val]) => {
      const d = (val.activeDays.size || val.days.size || 1);
      const avgPt = val.totalPt / d;
      const clinicNhppd = getClinicNhppd(clinicName, settings);
      const ftc = (avgPt * clinicNhppd) / settings.stdHr;
      const out = (ftc * settings.annualHr) / (settings.workDays * 8);
      const nursing = (val.rn + val.pn + val.na) / d;
      const prod = nursing > 0 ? (out / nursing) * 100 : 0;
      const skillMix = (val.rn + val.pn + val.na) > 0 ? (val.rn / (val.rn + val.pn + val.na)) * 100 : 0;

      const subClinicEntries = Object.entries(val.subClinicTotals).sort((a, b) => b[1] - a[1]);

      return {
        clinicName,
        clinicNhppd,
        totalPt: val.totalPt,
        avgPt: Number(avgPt.toFixed(1)),
        nursingStaffPerDay: Number(nursing.toFixed(1)),
        productivity: Number(prod.toFixed(1)),
        skillMix: Number(skillMix.toFixed(1)),
        isPremiumGroup: val.isPremiumGroup,
        subClinicEntries,
      };
    });

    return list.sort((a, b) => b.totalPt - a.totalPt);
  }, [filteredWorkloads, settings, premiumSubClinics]);

  const normalizeClinicUnit = (clinicName?: string): string => {
    const c = (clinicName || '').trim();
    if (!c) return '';
    if (
      isPremiumGroupName(c) ||
      isPremiumPoolClinicName(c) ||
      /-Premium$/i.test(c) ||
      premiumSubClinics.includes(c)
    ) {
      return PREMIUM_CLINIC_GROUP;
    }
    return c;
  };

  const isNursingRole = (pos?: string): boolean => {
    const norm = getWorkloadRolePosition(pos);
    return norm === 'RN' || norm === 'PN' || norm === 'NA';
  };

  const isStaffActiveOnDate = (s: StaffMember, dateStr: string): boolean => {
    // นับเฉพาะเจ้าหน้าที่ที่มีสถานะ Active เท่านั้น (ไม่นับผู้ที่ลาออก/เกษียณ)
    if (s.status !== 'Active') return false;
    if (s.startDate && s.startDate > dateStr) return false;
    if (s.endDate && s.endDate < dateStr) return false;
    return true;
  };

  const staffClinicByName = useMemo(() => {
    const map = new Map<string, string>();
    staffList.forEach((s) => {
      const n = (s.name || '').trim();
      if (n) map.set(n, (s.homeClinic || '').trim());
    });
    return map;
  }, [staffList]);

  const staffPositionByName = useMemo(() => {
    const map = new Map<string, string>();
    staffList.forEach((s) => {
      const n = (s.name || '').trim();
      if (n) map.set(n, (s.position || '').trim());
    });
    return map;
  }, [staffList]);

  const monthHolidayMap = useMemo(() => {
    const yr = Number(selectedMonth.split('-')[0]) || new Date().getFullYear();
    return getHolidaysForYear(yr, settings.customHolidays || []);
  }, [selectedMonth, settings.customHolidays]);

  const isWeekendOrHolidayDate = (dateStr: string): boolean => {
    const m = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return false;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return true;
    return monthHolidayMap.has(dateStr);
  };

  const cleanAutoLeaveNote = (raw?: string): string => {
    const txt = (raw || '').trim();
    if (!txt) return '';
    if (/^บันทึกอัตโนมัติจากห้องตรวจ/.test(txt)) return '';
    if (/^ไปอบรม\/ประชุม\s*\(บันทึกจาก/.test(txt)) return '';
    return txt;
  };

  // Daily grouped rows for the official PDF-style monthly report (connected with Leaves, Training, and Cross-Coverage/OT)
  const dailyReportRows = useMemo(() => {
    const byDate = new Map<
      string,
      {
        date: string;
        day: number;
        hn: number;
        rn: number;
        pn: number;
        na: number;
        pt: number;
        notes: string[];
        hasInTimeShift: boolean;
        hasActiveService: boolean;
      }
    >();

    filteredWorkloads.forEach((w) => {
      const dateStr = (w.date || '').trim();
      if (!dateStr) return;
      const dayNum = Number(dateStr.split('-')[2]) || 0;
      if (!byDate.has(dateStr)) {
        byDate.set(dateStr, {
          date: dateStr,
          day: dayNum,
          hn: 0,
          rn: 0,
          pn: 0,
          na: 0,
          pt: 0,
          notes: [],
          hasInTimeShift: false,
          hasActiveService: false,
        });
      }
      const row = byDate.get(dateStr)!;
      const itemIsOffDuty = isOffDutyWorkload(w);
      row.hn += w.hn || 0;
      row.rn += w.rn || 0;
      row.pn += w.pn || 0;
      row.na += w.na !== undefined ? w.na : (w.pca || 0);
      row.pt += getEffectiveTotalPt(w);
      if (w.shift === 'ในเวลา 08:00-16:00') {
        row.hasInTimeShift = true;
      }
      if (!itemIsOffDuty) {
        row.hasActiveService = true;
      }

      if (itemIsOffDuty) {
        const offReason = getWorkloadOffDutyReason(w);
        const prefix = selectedClinic === 'ALL' ? `[${w.clinic}] ` : '';
        const offText = `${prefix}Off เวร${offReason ? ` (${offReason})` : ''}`;
        if (!row.notes.includes(offText)) {
          row.notes.push(offText);
        }
      } else {
        if (isReferralWorkload(w) && w.referralData) {
          const refSummary = formatReferralSummaryText(normalizeReferralData(w.referralData));
          if (refSummary) {
            const taggedSummary =
              selectedClinic === 'ALL' ? `[${REFERRAL_CLINIC_NAME}] ${refSummary}` : refSummary;
            if (!row.notes.includes(taggedSummary)) {
              row.notes.push(taggedSummary);
            }
          }
        }
        const offStaff = getWorkloadOffDutyStaff(w);
        if (offStaff.length > 0) {
          const prefix = selectedClinic === 'ALL' ? `[${w.clinic}] ` : '';
          const offStaffText = `${prefix}Off เวรรายวัน: ${formatOffDutyStaffSummaryText(offStaff)}`;
          if (!row.notes.includes(offStaffText)) {
            row.notes.push(offStaffText);
          }
        }
      }
      const cleanNote = (w.note || '').trim();
      if (cleanNote && !row.notes.includes(cleanNote)) {
        row.notes.push(cleanNote);
      }
    });

    const includesInTime =
      selectedShift === 'ALL' || selectedShift === 'ในเวลา 08:00-16:00';

    const pushUniqueNote = (notes: string[], candidate: string, staffName?: string, keyword?: string) => {
      const trimmed = candidate.trim();
      if (!trimmed) return;
      if (notes.includes(trimmed)) return;
      if (
        staffName &&
        keyword &&
        notes.some((existing) => existing.includes(staffName) && existing.includes(keyword))
      ) {
        return;
      }
      notes.push(trimmed);
    };

    // Enrich each working day row with Leaves, Training/Meeting, and Cross-Unit Coverage/Substitute OT
    byDate.forEach((row, dateStr) => {
      // 1. Leaves & Training/Meetings
      if (includesInTime) {
        const seenLeaveKeys = new Set<string>();
        leaves.forEach((l) => {
          const start = (l.startDate || '').trim();
          const end = (l.endDate || l.startDate || '').trim();
          if (!start || dateStr < start || dateStr > end) return;
          // If multi-day leave range spans across a weekend/holiday, only show on days with in-time work or non-holidays
          if (start !== end && !row.hasInTimeShift && isWeekendOrHolidayDate(dateStr)) {
            return;
          }

          const rawUnit = (l.clinic || staffClinicByName.get((l.staffName || '').trim()) || '').trim();
          const unit = normalizeClinicUnit(rawUnit);

          if (selectedClinic === 'ALL') {
            if (excludeLasik && unit === 'ศูนย์เลสิก') return;
            if (excludeReferral && isReferralClinicName(unit)) return;
          } else if (unit !== selectedClinic) {
            return;
          }

          const dedupKey = `${l.staffName}|${l.leaveType}|${unit}|${l.days}`;
          if (seenLeaveKeys.has(dedupKey)) return;
          seenLeaveKeys.add(dedupKey);

          const isHalfDay = start === end && Number(l.days) === 0.5;
          const periodLabel = isHalfDay ? parseLeavePeriodFromNote(l.note) : '';
          const extra = cleanAutoLeaveNote(stripLeavePeriodFromNote(l.note));
          const prefix = selectedClinic === 'ALL' && unit ? `[${unit}] ` : '';
          const isTraining = isTrainingLeaveType(l.leaveType);
          const halfSuffix = isHalfDay ? ` (${periodLabel || 'ครึ่งวัน'} 0.5 วัน)` : '';
          const text = isTraining
            ? `${prefix}${l.staffName} ไปอบรม/ประชุม${halfSuffix}${extra ? ` (${extra})` : ''}`
            : `${prefix}${l.staffName} ${l.leaveType}${halfSuffix}${extra ? ` (${extra})` : ''}`;

          pushUniqueNote(row.notes, text, l.staffName, l.leaveType);
        });
      }

      // 2. Cross-Unit Coverage & Substitute OT
      const seenOtKeys = new Set<string>();
      otRecords.forEach((o) => {
        if ((o.date || '').trim() !== dateStr) return;

        // Match shift
        if (selectedShift !== 'ALL') {
          if (selectedShift === 'ในเวลา 08:00-16:00') {
            if (o.shift !== 'ในเวลา 08:00-16:00' && o.shift !== 'OT ในเวลาราชการ 08:00-16:00') {
              return;
            }
          } else if (o.shift !== selectedShift) {
            return;
          }
        }

        const parsedWork = parseOtWorkClinic(o.workClinic);
        const homeUnit = normalizeClinicUnit(o.homeClinic || staffClinicByName.get((o.staffName || '').trim()) || '');
        const workUnit = normalizeClinicUnit(parsedWork.clinic);
        const fracTag =
          parsedWork.amount === 0.5
            ? ` (0.5 ${parsedWork.periodLabel || 'ครึ่งวัน'})`
            : '';

        if (selectedClinic === 'ALL') {
          if (excludeLasik && homeUnit === 'ศูนย์เลสิก' && workUnit === 'ศูนย์เลสิก') return;
          if (excludeReferral && isReferralClinicName(homeUnit) && isReferralClinicName(workUnit)) return;
          if (homeUnit && workUnit && homeUnit !== workUnit) {
            const k = `MOVE|${o.staffName}|${homeUnit}|${workUnit}|${parsedWork.periodLabel}`;
            if (seenOtKeys.has(k)) return;
            seenOtKeys.add(k);
            const tag = o.shift === 'OT ในเวลาราชการ 08:00-16:00' ? ' ขึ้นแทน' : ' ไปช่วย';
            pushUniqueNote(
              row.notes,
              `${o.staffName}${tag} (${homeUnit} → ${parsedWork.clinic}${fracTag ? ` ${fracTag}` : ''})`,
              o.staffName,
              parsedWork.clinic
            );
          } else if (o.isExternal || o.shift === 'OT ในเวลาราชการ 08:00-16:00') {
            const k = `SUB|${o.staffName}|${workUnit}|${parsedWork.periodLabel}`;
            if (seenOtKeys.has(k)) return;
            seenOtKeys.add(k);
            const src = o.affiliation || (homeUnit && homeUnit !== workUnit ? o.homeClinic : '');
            pushUniqueNote(
              row.notes,
              `[${workUnit}] ${o.staffName} ขึ้นแทน${src ? ` (${src})` : ''}${fracTag}`,
              o.staffName,
              'ขึ้นแทน'
            );
          }
          return;
        }

        const isOutgoing = homeUnit === selectedClinic && workUnit !== selectedClinic && Boolean(parsedWork.clinic);
        const isIncoming =
          workUnit === selectedClinic &&
          (homeUnit !== selectedClinic || Boolean(o.isExternal) || o.shift === 'OT ในเวลาราชการ 08:00-16:00');

        if (isOutgoing) {
          const k = `OUT|${o.staffName}|${parsedWork.clinic}|${parsedWork.periodLabel}`;
          if (seenOtKeys.has(k)) return;
          seenOtKeys.add(k);
          pushUniqueNote(row.notes, `${o.staffName} ไปช่วย ${parsedWork.clinic}${fracTag}`, o.staffName, 'ไปช่วย');
        }

        if (isIncoming) {
          const k = `IN|${o.staffName}|${o.homeClinic || o.affiliation || ''}|${parsedWork.periodLabel}`;
          if (seenOtKeys.has(k)) return;
          seenOtKeys.add(k);
          const isSubstitute = o.shift === 'OT ในเวลาราชการ 08:00-16:00' || Boolean(o.isExternal);
          const srcLabel = o.affiliation || (homeUnit && homeUnit !== selectedClinic ? o.homeClinic : '');
          const verb = isSubstitute ? 'ขึ้นแทน' : 'มาช่วย';
          pushUniqueNote(
            row.notes,
            `${o.staffName} ${verb}${srcLabel ? ` (จาก ${srcLabel})` : ''}${fracTag}`,
            o.staffName,
            verb
          );
        }
      });
    });

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [
    filteredWorkloads,
    leaves,
    otRecords,
    selectedShift,
    selectedClinic,
    excludeLasik,
    excludeReferral,
    staffClinicByName,
    staffPositionByName,
    monthHolidayMap,
    premiumSubClinics,
  ]);

  // Daily Staffing Headcount Verification (Master Staff - Leaves/Training/Outgoing + Incoming vs Recorded RN+PN+NA)
  // NOTE: "ไปอบรม/ประชุม" counts as attendance (NOT leave), but does NOT count toward the unit's daily workload (deducted from unit headcount)
  const staffingVerification = useMemo(() => {
    const isOutTimeOnlyFilter =
      selectedShift === 'นอกเวลาเย็น 16:00-20:00' || selectedShift === 'นอกเวลาวันหยุด 08:00-12:00';

    interface VerificationItem {
      key: string;
      date: string;
      day: number;
      unit: string;
      mode: 'IN_TIME' | 'OUT_TIME';
      baselineCount: number;
      baselineSummary: string;
      absentList: { name: string; label: string; kind: 'leave' | 'training' | 'outgoing' | 'off_duty'; amount: number }[];
      incomingList: { name: string; label: string; amount: number }[];
      expectedCount: number;
      recordedNursing: number;
      recordedRN: number;
      recordedPN: number;
      recordedNA: number;
      diff: number;
      status: 'match' | 'mismatch_over' | 'mismatch_under' | 'no_baseline';
      message: string;
    }

    const items: VerificationItem[] = [];

    if (isOutTimeOnlyFilter) {
      // Group filteredWorkloads by date + unit and compare against OTAttendance for that shift
      const groupMap = new Map<
        string,
        {
          date: string;
          unit: string;
          rn: number;
          pn: number;
          na: number;
          hasActive: boolean;
          hasOffDuty: boolean;
          offReasons: string[];
          offDutyStaffList: OffDutyStaffEntry[];
        }
      >();
      filteredWorkloads.forEach((w) => {
        const unit = normalizeClinicUnit(w.clinic);
        const key = `${w.date}||${unit}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            date: w.date,
            unit,
            rn: 0,
            pn: 0,
            na: 0,
            hasActive: false,
            hasOffDuty: false,
            offReasons: [],
            offDutyStaffList: [],
          });
        }
        const g = groupMap.get(key)!;
        g.rn += w.rn || 0;
        g.pn += w.pn || 0;
        g.na += w.na !== undefined ? w.na : (w.pca || 0);
        if (isOffDutyWorkload(w)) {
          g.hasOffDuty = true;
          const r = getWorkloadOffDutyReason(w);
          if (r && !g.offReasons.includes(r)) g.offReasons.push(r);
        } else {
          g.hasActive = true;
          const staffOff = getWorkloadOffDutyStaff(w);
          if (staffOff.length > 0) {
            staffOff.forEach((it) => {
              if (
                !g.offDutyStaffList.some(
                  (x) => x.staffName === it.staffName && (x.periodLabel || '') === (it.periodLabel || '')
                )
              ) {
                g.offDutyStaffList.push(it);
              }
            });
          }
        }
      });

      groupMap.forEach((g, key) => {
        const recorded = Number((g.rn + g.pn + g.na).toFixed(1));
        const otMatched = otRecords.filter(
          (o) => {
            const effPos = staffPositionByName.get((o.staffName || '').trim()) || o.position;
            return (
              o.date === g.date &&
              o.shift === selectedShift &&
              normalizeClinicUnit(parseOtWorkClinic(o.workClinic).clinic) === g.unit &&
              isNursingRole(effPos)
            );
          }
        );
        const incomingList = Array.from(
          new Map(
            otMatched.map((o) => {
              const parsedWork = parseOtWorkClinic(o.workClinic);
              const amt = parsedWork.amount;
              return [
                o.staffName,
                {
                  name: o.staffName,
                  label: `${o.staffName} (${o.position === 'PCA' ? 'NA' : o.position}${
                    amt === 0.5 ? ` 0.5 ${parsedWork.periodLabel || 'ครึ่งวัน'}` : ''
                  })`,
                  amount: amt,
                },
              ];
            })
          ).values()
        );
        const incomingExpected = Number(incomingList.reduce((s, x) => s + x.amount, 0).toFixed(1));
        const incomingByName = new Map<string, number>();
        incomingList.forEach((inc) => {
          const clean = (inc.name || '').trim();
          incomingByName.set(clean, Number(((incomingByName.get(clean) || 0) + inc.amount).toFixed(1)));
        });

        const outAbsentList: VerificationItem['absentList'] = [];
        let matchedOtDeduct = 0;
        g.offDutyStaffList.forEach((offItem) => {
          const name = (offItem.staffName || '').trim();
          if (!name) return;
          const staff = staffList.find((s) => (s.name || '').trim() === name);
          const effPos = offItem.position || staff?.position || staffPositionByName.get(name) || '';
          if (effPos && !isNursingRole(effPos)) return;
          const amt = offItem.amount === 0.5 ? 0.5 : 1;
          const pLabel = amt === 0.5 ? (offItem.periodLabel || 'ครึ่งเวร') : '';
          outAbsentList.push({
            name,
            label: `${name} [รายวัน] (Off เวร${amt === 0.5 ? ` 0.5 ${pLabel}` : ''}${
              offItem.reason ? `: ${offItem.reason}` : ''
            })`,
            kind: 'off_duty',
            amount: amt,
          });
          const otAvail = incomingByName.get(name) || 0;
          if (otAvail > 0) {
            const deduct = Math.min(otAvail, amt);
            matchedOtDeduct = Number((matchedOtDeduct + deduct).toFixed(1));
            incomingByName.set(name, Number((otAvail - deduct).toFixed(1)));
          }
        });

        const expected = Math.max(0, Number((incomingExpected - matchedOtDeduct).toFixed(1)));
        const isPureOffDuty = !g.hasActive && g.hasOffDuty;
        const diff = Number((recorded - expected).toFixed(1));
        let status: VerificationItem['status'];
        let message: string;
        if (isPureOffDuty) {
          if (expected === 0 && recorded === 0) {
            status = 'match';
            message = `Off เวร / ปิดบริการกะนี้ (${g.offReasons.join(', ') || 'งดออกตรวจ'})`;
          } else {
            status = expected > recorded ? 'mismatch_under' : 'mismatch_over';
            message = `แจ้ง Off เวร แต่พบรายชื่อขึ้นเวร OT ${expected} แรงในเมนู 2`;
          }
        } else {
          status =
            incomingExpected === 0 && recorded > 0
              ? 'no_baseline'
              : Math.abs(diff) < 0.01
              ? 'match'
              : diff > 0
              ? 'mismatch_over'
              : 'mismatch_under';

          message =
            status === 'match'
              ? outAbsentList.length > 0
                ? matchedOtDeduct > 0
                  ? `ตรงกันกับรายชื่อเวร OT (หัก Off เวรรายวัน ${matchedOtDeduct} แรงแล้ว)`
                  : `ตรงกันกับรายชื่อเวร OT (มี Off เวรรายวัน ${outAbsentList.length} คน)`
                : 'ตรงกันกับรายชื่อเวร OT ที่บันทึกในเมนู 2'
              : status === 'no_baseline'
              ? `บันทึก ${recorded} แรง (ยังไม่มีรายชื่อลงเวร OT กะนี้ในเมนู 2)`
              : diff > 0
              ? `บันทึกมากกว่ายอดรายชื่อ OT +${diff} แรง`
              : `บันทึกน้อยกว่ายอดรายชื่อ OT ${diff} แรง`;
        }

        items.push({
          key,
          date: g.date,
          day: Number(g.date.split('-')[2]) || 0,
          unit: g.unit,
          mode: 'OUT_TIME',
          baselineCount: 0,
          baselineSummary: isPureOffDuty ? 'Off เวร (ปิดบริการกะนี้)' : 'เวรนอกเวลา (เทียบจากรายชื่อ OT)',
          absentList: outAbsentList,
          incomingList,
          expectedCount: expected,
          recordedNursing: recorded,
          recordedRN: g.rn,
          recordedPN: g.pn,
          recordedNA: g.na,
          diff,
          status,
          message,
        });
      });

      return items.sort((a, b) => a.date.localeCompare(b.date) || a.unit.localeCompare(b.unit, 'th'));
    }

    // In-time verification: evaluate every (date, unit) pair that has In-Time workload
    const inTimeWorkloads = filteredWorkloads.filter((w) => w.shift === 'ในเวลา 08:00-16:00');
    const inTimeMap = new Map<
      string,
      {
        date: string;
        unit: string;
        rn: number;
        pn: number;
        na: number;
        hasActive: boolean;
        hasOffDuty: boolean;
        offReasons: string[];
        offDutyStaffList: OffDutyStaffEntry[];
      }
    >();

    inTimeWorkloads.forEach((w) => {
      const unit = normalizeClinicUnit(w.clinic);
      const key = `${w.date}||${unit}`;
      if (!inTimeMap.has(key)) {
        inTimeMap.set(key, {
          date: w.date,
          unit,
          rn: 0,
          pn: 0,
          na: 0,
          hasActive: false,
          hasOffDuty: false,
          offReasons: [],
          offDutyStaffList: [],
        });
      }
      const g = inTimeMap.get(key)!;
      g.rn += w.rn || 0;
      g.pn += w.pn || 0;
      g.na += w.na !== undefined ? w.na : (w.pca || 0);
      if (isOffDutyWorkload(w)) {
        g.hasOffDuty = true;
        const r = getWorkloadOffDutyReason(w);
        if (r && !g.offReasons.includes(r)) g.offReasons.push(r);
      } else {
        g.hasActive = true;
        const staffOff = getWorkloadOffDutyStaff(w);
        if (staffOff.length > 0) {
          staffOff.forEach((it) => {
            if (
              !g.offDutyStaffList.some(
                (x) => x.staffName === it.staffName && (x.periodLabel || '') === (it.periodLabel || '')
              )
            ) {
              g.offDutyStaffList.push(it);
            }
          });
        }
      }
    });

    inTimeMap.forEach((g, key) => {
      const recorded = Number((g.rn + g.pn + g.na).toFixed(1));
      const baseStaff = staffList.filter(
        (s) =>
          isNursingRole(s.position) &&
          isStaffActiveOnDate(s, g.date) &&
          normalizeClinicUnit(s.homeClinic) === g.unit
      );
      const baseRN = baseStaff.filter((s) => getWorkloadRolePosition(s.position) === 'RN').length;
      const basePN = baseStaff.filter((s) => getWorkloadRolePosition(s.position) === 'PN').length;
      const baseNA = baseStaff.filter((s) => getWorkloadRolePosition(s.position) === 'NA').length;
      const baselineCount = baseStaff.length;
      const baselineParts: string[] = [];
      if (baseRN > 0) baselineParts.push(`RN ${baseRN}`);
      if (basePN > 0) baselineParts.push(`PN ${basePN}`);
      if (baseNA > 0) baselineParts.push(`NA ${baseNA}`);
      const baselineSummary = baselineParts.length > 0 ? baselineParts.join(', ') : 'ไม่มีรายชื่อในเมนู 5';

      const isPureOffDuty = !g.hasActive && g.hasOffDuty;
      if (isPureOffDuty) {
        const expectedCount = 0;
        const diff = Number((recorded - expectedCount).toFixed(1));
        items.push({
          key,
          date: g.date,
          day: Number(g.date.split('-')[2]) || 0,
          unit: g.unit,
          mode: 'IN_TIME',
          baselineCount,
          baselineSummary,
          absentList: [
            {
              name: g.unit,
              label: `Off เวรทั้งกะ (${g.offReasons.join(', ') || 'งดออกตรวจ'})`,
              kind: 'off_duty',
              amount: baselineCount,
            },
          ],
          incomingList: [],
          expectedCount,
          recordedNursing: recorded,
          recordedRN: g.rn,
          recordedPN: g.pn,
          recordedNA: g.na,
          diff,
          status: Math.abs(diff) < 0.01 ? 'match' : 'mismatch_over',
          message:
            Math.abs(diff) < 0.01
              ? `Off เวร / ปิดบริการกะนี้ (${g.offReasons.join(', ') || 'งดออกตรวจ'})`
              : `แจ้ง Off เวรทั้งกะ แต่มีการบันทึกกำลังคน ${recorded} แรง`,
        });
        return;
      }

      // Absent from unit on date: Leaves + Training + Staff Off เวร + Outgoing Cross-Cover
      const absentMap = new Map<
        string,
        { name: string; label: string; kind: 'leave' | 'training' | 'outgoing' | 'off_duty'; amount: number }
      >();

      leaves.forEach((l) => {
        const effPos = staffPositionByName.get((l.staffName || '').trim()) || l.position;
        const start = (l.startDate || '').trim();
        const end = (l.endDate || l.startDate || '').trim();
        if (!start || g.date < start || g.date > end) return;
        const unit = normalizeClinicUnit(l.clinic || staffClinicByName.get((l.staffName || '').trim()) || '');
        if (unit !== g.unit) return;
        if (!isNursingRole(effPos)) return;
        const name = (l.staffName || '').trim();
        if (!name) return;
        const isTraining = isTrainingLeaveType(l.leaveType);
        const isHalf = start === end && Number(l.days) === 0.5;
        const pLabel = isHalf ? parseLeavePeriodFromNote(l.note) : '';
        const amt = isHalf ? 0.5 : 1;
        const extra = cleanAutoLeaveNote(stripLeavePeriodFromNote(l.note));
        const keyId = `${isTraining ? 'TRN' : 'LV'}|${name}|${pLabel || 'FULL'}`;
        if (absentMap.has(keyId)) return;
        absentMap.set(keyId, {
          name,
          label: isTraining
            ? `${name} (ไปอบรม/ประชุม${isHalf ? ` 0.5 ${pLabel || 'ครึ่งวัน'}` : ''} - ไม่นับภาระงานหน่วย${extra ? `: ${extra}` : ''})`
            : `${name} (${l.leaveType}${isHalf ? ` 0.5 ${pLabel || 'ครึ่งวัน'}` : ''}${extra ? `: ${extra}` : ''})`,
          kind: isTraining ? 'training' : 'leave',
          amount: amt,
        });
      });

      g.offDutyStaffList.forEach((offItem) => {
        const name = (offItem.staffName || '').trim();
        if (!name) return;
        const staff = staffList.find((s) => (s.name || '').trim() === name);
        const effPos = offItem.position || staff?.position || staffPositionByName.get(name) || '';
        if (effPos && !isNursingRole(effPos)) return;
        const amt = offItem.amount === 0.5 ? 0.5 : 1;
        const pLabel = amt === 0.5 ? (offItem.periodLabel || 'ครึ่งวัน') : '';
        const keyId = `OFF|${name}|${pLabel || 'FULL'}`;
        if (absentMap.has(keyId)) return;
        absentMap.set(keyId, {
          name,
          label: `${name} [รายวัน] (Off เวร${amt === 0.5 ? ` 0.5 ${pLabel}` : ''}${offItem.reason ? `: ${offItem.reason}` : ''})`,
          kind: 'off_duty',
          amount: amt,
        });
      });

      otRecords.forEach((o) => {
        const effPos = staffPositionByName.get((o.staffName || '').trim()) || o.position;
        if ((o.date || '').trim() !== g.date) return;
        if (o.shift !== 'ในเวลา 08:00-16:00' && o.shift !== 'OT ในเวลาราชการ 08:00-16:00') return;
        if (!isNursingRole(effPos)) return;
        const parsedWork = parseOtWorkClinic(o.workClinic);
        const homeUnit = normalizeClinicUnit(o.homeClinic || staffClinicByName.get((o.staffName || '').trim()) || '');
        const workUnit = normalizeClinicUnit(parsedWork.clinic);
        if (homeUnit === g.unit && workUnit !== g.unit && workUnit) {
          const name = (o.staffName || '').trim();
          const keyId = `OUT|${name}|${workUnit}|${parsedWork.periodLabel || 'FULL'}`;
          if (name && !absentMap.has(keyId)) {
            const pSuffix =
              parsedWork.amount === 0.5 && parsedWork.periodLabel ? ` 0.5 ${parsedWork.periodLabel}` : '';
            absentMap.set(keyId, {
              name,
              label: `${name} (ไปช่วย ${parsedWork.clinic}${pSuffix})`,
              kind: 'outgoing',
              amount: parsedWork.amount,
            });
          }
        }
      });

      // Incoming substitutes / cross-cover
      const incomingMap = new Map<string, { name: string; label: string; amount: number }>();
      otRecords.forEach((o) => {
        const effPos = staffPositionByName.get((o.staffName || '').trim()) || o.position;
        if ((o.date || '').trim() !== g.date) return;
        if (o.shift !== 'ในเวลา 08:00-16:00' && o.shift !== 'OT ในเวลาราชการ 08:00-16:00') return;
        if (!isNursingRole(effPos)) return;
        const parsedWork = parseOtWorkClinic(o.workClinic);
        const homeUnit = normalizeClinicUnit(o.homeClinic || staffClinicByName.get((o.staffName || '').trim()) || '');
        const workUnit = normalizeClinicUnit(parsedWork.clinic);
        const isIncoming =
          workUnit === g.unit &&
          (homeUnit !== g.unit || Boolean(o.isExternal) || o.shift === 'OT ในเวลาราชการ 08:00-16:00');
        if (!isIncoming) return;
        const name = (o.staffName || '').trim();
        const keyId = `IN|${name}|${parsedWork.periodLabel || 'FULL'}`;
        if (!name || incomingMap.has(keyId)) return;
        const src = o.affiliation || (homeUnit && homeUnit !== g.unit ? o.homeClinic : '');
        const isSub = o.shift === 'OT ในเวลาราชการ 08:00-16:00' || Boolean(o.isExternal);
        const pSuffix =
          parsedWork.amount === 0.5 && parsedWork.periodLabel ? ` 0.5 ${parsedWork.periodLabel}` : '';
        incomingMap.set(keyId, {
          name,
          label: `${name} (${isSub ? 'ขึ้นแทน' : 'มาช่วย'}${src ? ` จาก ${src}` : ''}${pSuffix})`,
          amount: parsedWork.amount,
        });
      });

      const absentList = Array.from(absentMap.values());
      const incomingList = Array.from(incomingMap.values());
      const absentAmount = Number(absentList.reduce((s, a) => s + a.amount, 0).toFixed(1));
      const incomingAmount = Number(incomingList.reduce((s, i) => s + i.amount, 0).toFixed(1));
      const expectedCount = Math.max(0, Number((baselineCount - absentAmount + incomingAmount).toFixed(1)));
      const diff = Number((recorded - expectedCount).toFixed(1));

      let status: VerificationItem['status'];
      let message: string;
      if (baselineCount === 0) {
        status = 'no_baseline';
        message =
          absentAmount > 0 || incomingAmount > 0
            ? 'ยังไม่มีรายชื่อบุคลากรประจำหน่วยงานในเมนู 5 (พบข้อมูลลา/Off เวร/ช่วยงานตามรายการ)'
            : 'ยังไม่มีรายชื่อบุคลากรประจำหน่วยงานในเมนู 5';
      } else if (Math.abs(diff) < 0.01) {
        status = 'match';
        message =
          absentAmount > 0 || incomingAmount > 0
            ? 'ตรงกัน (หักยอดลา/Off เวร/ช่วยงานแล้วสอดคล้องกับยอดปฏิบัติงาน)'
            : 'ตรงกันตามอัตรากำลังประจำ';
      } else if (diff > 0) {
        status = 'mismatch_over';
        if (absentAmount > 0 && Math.abs(diff - 0.5) < 0.01) {
          message =
            'ต่าง +0.5 แรง (คาดว่ามีผู้มาขึ้นแทน/ช่วยครึ่งวัน 0.5 แรง — สามารถบันทึกในเมนู 1 หรือ 2)';
        } else if (absentAmount > 0) {
          message = `บันทึกสูงกว่าคาดการณ์ +${diff} แรง (หักลา/Off เวร/ไปช่วย ${absentAmount} แรง กรุณาตรวจสอบยอดคนหรือผู้มาช่วย)`;
        } else {
          message = `บันทึกสูงกว่ากำลังคนประจำ +${diff} แรง (ตรวจสอบว่ามีผู้มาช่วยงาน 0.5/1 แรงหรือไม่)`;
        }
      } else {
        status = 'mismatch_under';
        message =
          absentAmount === 0
            ? `บันทึกต่ำกว่ากำลังคนประจำ ${diff} แรง (ยังไม่มีรายชื่อลา / Off เวร / ไปช่วยห้องอื่นในวันนี้)`
            : `บันทึกต่ำกว่าคาดการณ์ ${diff} แรง (กรุณาตรวจสอบรายชื่อลา/Off เวร/ช่วยงานซ้ำ)`;
      }

      items.push({
        key,
        date: g.date,
        day: Number(g.date.split('-')[2]) || 0,
        unit: g.unit,
        mode: 'IN_TIME',
        baselineCount,
        baselineSummary,
        absentList,
        incomingList,
        expectedCount,
        recordedNursing: recorded,
        recordedRN: g.rn,
        recordedPN: g.pn,
        recordedNA: g.na,
        diff,
        status,
        message,
      });
    });

    return items.sort((a, b) => a.date.localeCompare(b.date) || a.unit.localeCompare(b.unit, 'th'));
  }, [
    filteredWorkloads,
    selectedShift,
    staffList,
    leaves,
    otRecords,
    staffClinicByName,
    staffPositionByName,
    premiumSubClinics,
  ]);

  const verificationStats = useMemo(() => {
    const matched = staffingVerification.filter((v) => v.status === 'match').length;
    const mismatch = staffingVerification.filter(
      (v) => v.status === 'mismatch_over' || v.status === 'mismatch_under'
    ).length;
    const withEvents = staffingVerification.filter(
      (v) => v.absentList.length > 0 || v.incomingList.length > 0
    ).length;
    const visibleItems = showAllVerificationDays
      ? staffingVerification
      : staffingVerification.filter(
          (v) =>
            v.absentList.length > 0 ||
            v.incomingList.length > 0 ||
            v.status === 'mismatch_over' ||
            v.status === 'mismatch_under'
        );
    return {
      total: staffingVerification.length,
      matched,
      mismatch,
      withEvents,
      visibleItems,
    };
  }, [staffingVerification, showAllVerificationDays]);

  const actualWorkingDays = useMemo(() => {
    const activeCount = dailyReportRows.filter((r) => r.hasActiveService).length;
    return activeCount > 0 ? activeCount : dailyReportRows.length;
  }, [dailyReportRows]);

  const officialReportMeta = useMemo(() => {
    const [yrStr, moStr] = selectedMonth.split('-');
    const yr = Number(yrStr) || new Date().getFullYear();
    const mo = Number(moStr) || new Date().getMonth() + 1;
    const monthLabel = `${THAI_MONTHS[Math.max(0, Math.min(11, mo - 1))]} ${yr + 543}`;
    const clinicLabel =
      selectedClinic === 'ALL'
        ? 'ภาพรวมทั้ง OPD'
        : selectedClinic.replace(/\s*\([^)]*\)/g, '').trim();
    const shiftSuffix =
      selectedShift !== 'ALL'
        ? ` ${selectedShift.replace(/\s*\([^)]*\)/g, '').trim()}`
        : '';
    const title = `แบบรวบรวมภาระงานผู้ป่วยนอก ห้องตรวจ ${clinicLabel}${shiftSuffix} ${monthLabel}`
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const rnHours = stats.sumRN * 8;
    const auxHours = (stats.sumPN + stats.sumNA) * 8;
    const totalHours = stats.totalNursingStaff * 8;
    const rnPct = stats.totalNursingStaff > 0 ? (stats.sumRN / stats.totalNursingStaff) * 100 : 0;
    const auxPct = stats.totalNursingStaff > 0 ? ((stats.sumPN + stats.sumNA) / stats.totalNursingStaff) * 100 : 0;

    const nhppdFormulaVal = stats.isScreeningOnly
      ? stats.screeningNhppd
      : stats.hasScreeningRecords && selectedClinic === 'ALL'
      ? Number(stats.effectiveNhppd.toFixed(2))
      : stats.generalNhppd;

    const fmtStaff = (n: number) =>
      n === 0 ? '' : Number.isInteger(n) ? String(n) : Number(n.toFixed(1)).toString();
    const fmtSum = (n: number) =>
      Number.isInteger(n) ? String(n) : Number(n.toFixed(1)).toString();
    const fmtPct = (n: number) =>
      Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1);

    const minTableRows = dailyReportRows.length > 0 ? Math.max(dailyReportRows.length + 2, 16) : 14;
    const blankRowCount = Math.max(0, minTableRows - dailyReportRows.length);

    return {
      monthLabel,
      clinicLabel,
      title,
      rnHours,
      auxHours,
      totalHours,
      rnPct,
      auxPct,
      nhppdFormulaVal,
      fmtStaff,
      fmtSum,
      fmtPct,
      blankRowCount,
    };
  }, [selectedMonth, selectedClinic, selectedShift, excludeLasik, excludeReferral, stats, dailyReportRows.length]);

  // Monthly aggregation for Referral Center (ศูนย์รับ - ส่งต่อผู้ป่วย)
  const referralMonthlySummary = useMemo(() => {
    const records = filteredWorkloads
      .filter((w) => isReferralWorkload(w) && !isOffDutyWorkload(w))
      .sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift, 'th'));

    if (records.length === 0) return null;

    const totals: Record<string, number> = {
      admitPrivate: 0,
      admitGeneral: 0,
      referIn: 0,
      referOut: 0,
      reservePrivateRoom: 0,
      cancelPrivateRoom: 0,
    };

    const dailyRows = records.map((w) => {
      const ref = normalizeReferralData(w.referralData);
      REFERRAL_ITEM_DEFINITIONS.forEach(({ key }) => {
        totals[key] += Number(ref[key]?.count) || 0;
      });
      const rowTotal = REFERRAL_ITEM_DEFINITIONS.reduce(
        (sum, { key }) => sum + (Number(ref[key]?.count) || 0),
        0
      );
      const reasons = REFERRAL_ITEM_DEFINITIONS.map(({ key, label }) => {
        const r = (ref[key]?.reason || '').trim();
        return r ? `${label}: ${r}` : '';
      }).filter(Boolean);
      const extraNote = (w.note || '').trim();
      if (extraNote) reasons.push(extraNote);

      return {
        id: w.id,
        date: w.date,
        day: Number(w.date.split('-')[2]) || 0,
        shift: w.shift,
        ref,
        rowTotal,
        reasonText: reasons.join(' | '),
        reporter: w.reporter || '',
      };
    });

    const grandTotal = REFERRAL_ITEM_DEFINITIONS.reduce((s, { key }) => s + totals[key], 0);
    const totalAdmit = totals.admitPrivate + totals.admitGeneral;

    return {
      recordCount: records.length,
      totals,
      grandTotal,
      totalAdmit,
      dailyRows,
    };
  }, [filteredWorkloads]);

  const handlePrintOfficialReport = () => {
    window.print();
  };

  const handleExportOfficialJpeg = async () => {
    if (!reportSheetRef.current) return;
    setIsExportingJpeg(true);
    try {
      const clinicSlug =
        selectedClinic === 'ALL'
          ? 'OPD_ALL'
          : selectedClinic.replace(/[^\wก-ฮะ-์]+/g, '_');
      await exportElementAsJpeg(
        reportSheetRef.current,
        `OPD_Productivity_${selectedMonth}_${clinicSlug}.jpeg`
      );
    } catch (err) {
      console.error('Export Productivity JPEG error:', err);
    } finally {
      setIsExportingJpeg(false);
    }
  };

  // Ophthalmology Out-of-Hours Productivity (STRICTLY for จักษุวิทยา + นอกเวลาราชการ, cost ÷ 150)
  const ophthalmologyOutTimeData = useMemo(() => {
    const shiftNorm = normalizeWorkloadShiftStr(selectedShift);
    const isInTimeOnly = shiftNorm === 'ในเวลา 08:00-16:00';
    const isEyeClinicScope = selectedClinic === OPHTHALMOLOGY_CLINIC_NAME || selectedClinic === 'ALL';

    const rows =
      isInTimeOnly || !isEyeClinicScope
        ? []
        : workloads
            .filter((w) => {
              if (!isOphthalmologyOutTimeRecord(w)) return false;
              const isoDate = normalizeWorkloadDateStr(w.date);
              if (!isoDate.startsWith(selectedMonth)) return false;
              if (shiftNorm !== 'ALL') {
                return normalizeWorkloadShiftStr(w.shift) === shiftNorm;
              }
              return true;
            })
            .sort((a, b) => {
              const da = normalizeWorkloadDateStr(a.date);
              const db = normalizeWorkloadDateStr(b.date);
              if (da !== db) return da.localeCompare(db);
              return a.shift.localeCompare(b.shift, 'th');
            })
            .map((w) => computeEyeOutTimeRow(w, eyeNaMappingMode));

    const summary = summarizeEyeOutTimeRows(rows);
    const showPanel =
      !isInTimeOnly &&
      isEyeClinicScope &&
      (selectedClinic === OPHTHALMOLOGY_CLINIC_NAME || rows.length > 0);

    const hasAnyNa = rows.some((r) => r.rawNa > 0);
    const showExtraNaColumn = rows.some((r) => r.extraNaCount > 0);
    const [yrStr, moStr] = selectedMonth.split('-');
    const yr = Number(yrStr) || new Date().getFullYear();
    const mo = Number(moStr) || new Date().getMonth() + 1;
    const thaiMonthTitle = `${THAI_MONTHS[Math.max(0, Math.min(11, mo - 1))] || ''} พ.ศ. ${yr + 543}`;

    return {
      showPanel,
      isInTimeOnly,
      thaiMonthTitle,
      rows,
      summary,
      hasAnyNa,
      showExtraNaColumn,
    };
  }, [workloads, selectedMonth, selectedShift, selectedClinic, eyeNaMappingMode]);

  const handleExportEyeCsv = () => {
    const headers = [
      'วัน',
      'วันที่',
      'กะเวลา',
      'เวลาเข้า',
      'เวลาออก',
      'ผู้รับบริการ (คน)',
      'พยาบาล (600)',
      'PN (380)',
      'Technician (300)',
      ...(ophthalmologyOutTimeData.showExtraNaColumn ? ['NA (380)'] : []),
      'พนง.บริการ (300)',
      'รายจ่ายรวม (บาท)',
      'ควรรับขั้นต่ำ (รายจ่าย÷150)',
      'เทียบเกณฑ์ (คน)',
      'Productivity (%)',
      'ต้นทุนต่อราย (บาท)',
      'หมายเหตุ',
    ];
    const bodyRows = ophthalmologyOutTimeData.rows.map((r) => [
      r.dayAbbrev,
      r.shortDate,
      r.record.shift,
      r.timeIn,
      r.timeOut,
      r.actualPatients,
      r.nurseCount,
      r.pnCount,
      r.techCount,
      ...(ophthalmologyOutTimeData.showExtraNaColumn ? [r.extraNaCount] : []),
      r.swCount,
      r.totalExpense,
      r.targetPatients.toFixed(2),
      r.diffPatients.toFixed(2),
      r.productivityPct.toFixed(1),
      r.costPerPatient.toFixed(1),
      r.noteText || '-',
    ]);
    const s = ophthalmologyOutTimeData.summary;
    const footerRow = [
      'รวม',
      `${ophthalmologyOutTimeData.rows.length} เวร`,
      '',
      '',
      '',
      s.actualPatients,
      s.nurseCount,
      s.pnCount,
      s.techCount,
      ...(ophthalmologyOutTimeData.showExtraNaColumn ? [s.extraNaCount] : []),
      s.swCount,
      s.totalExpense,
      s.targetPatients.toFixed(2),
      s.diffPatients.toFixed(2),
      s.productivityPct.toFixed(1),
      s.costPerPatient.toFixed(1),
      'สูตร: Productivity = (ผู้รับบริการจริง ÷ (รายจ่าย ÷ 150)) × 100',
    ];

    const csv = [headers, ...bodyRows, footerRow]
      .map((cols) => cols.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `OPD_Eye_OutTime_Productivity_${selectedMonth}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportEyeJpeg = async () => {
    if (!eyeReportSheetRef.current) return;
    setIsExportingEyeJpeg(true);
    try {
      await exportElementAsJpeg(
        eyeReportSheetRef.current,
        `OPD_Eye_OutTime_Productivity_${selectedMonth}.jpeg`
      );
    } catch (err) {
      console.error('Export Eye Productivity JPEG error:', err);
    } finally {
      setIsExportingEyeJpeg(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <div className="no-print bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 border border-amber-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-amber-950">
              เมนูที่ 4: สรุป Productivity, Skill Mix และ FTC ประจำเดือน
            </h2>
            <p className="text-xs text-amber-800">
              คำนวณอัตโนมัติตามมาตรฐานภาระงานการพยาบาล สป.สธ. (NHPPD {stats.generalNhppd} / หน่วยคัดกรอง {stats.screeningNhppd} / Std {settings.stdHr} ชม. / {settings.annualHr} ชม.ต่อปี)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold px-3 py-1.5 bg-white text-amber-900 border border-amber-300 rounded-lg shadow-2xs">
            วันทำการที่บันทึก: {workingDays} วัน
          </span>
          <button
            type="button"
            onClick={handleExportOfficialJpeg}
            disabled={isExportingJpeg}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <ImageDown className="w-3.5 h-3.5" />
            <span>{isExportingJpeg ? 'กำลังสร้างรูป...' : 'บันทึกเป็น .JPEG'}</span>
          </button>
          <button
            type="button"
            onClick={handlePrintOfficialReport}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-blue-700 hover:bg-blue-600 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>พิมพ์รายงาน / PDF</span>
          </button>
        </div>
      </div>

      {/* Filter Bar with LASIK Exclusion Toggle */}
      <div className="no-print bg-white rounded-2xl shadow-xs border border-gray-200/90 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              เลือกเดือน (พ.ศ.):
            </label>
            <ThaiMonthInput
              value={selectedMonth}
              onChange={setSelectedMonth}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              กะเวลา:
            </label>
            <select
              value={selectedShift}
              onChange={(e) => setSelectedShift(e.target.value)}
              className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border bg-white"
            >
              <option value="ALL">-- ทุกกะเวลา --</option>
              {SHIFTS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              ห้องตรวจ:
            </label>
            <select
              value={selectedClinic}
              onChange={(e) => setSelectedClinic(e.target.value)}
              className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border bg-white font-medium text-emerald-950"
            >
              <option value="ALL">ภาพรวมทั้ง OPD (ทุกคลินิก)</option>
              <option value={PREMIUM_CLINIC_GROUP}>★ ศูนย์ปัญญาภิรมย์ (ภาพรวม)</option>
              {allClinicsList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* LASIK & Referral Center exclusion toggles */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-gray-100 text-xs">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2 cursor-pointer text-gray-700 font-medium">
              <input
                type="checkbox"
                checked={excludeLasik}
                onChange={(e) => setExcludeLasik(e.target.checked)}
                className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4"
              />
              <span>
                ไม่รวม <strong>"ศูนย์เลสิก"</strong> ในภาพรวม OPD
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-gray-700 font-medium">
              <input
                type="checkbox"
                checked={excludeReferral}
                onChange={(e) => setExcludeReferral(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
              />
              <span>
                ไม่รวม <strong>"{REFERRAL_CLINIC_NAME}"</strong> ในภาพรวม OPD
              </span>
            </label>
          </div>
          <span className="text-gray-400 text-[11px]">
            {excludeLasik ? 'คัดศูนย์เลสิกออก' : 'รวมศูนย์เลสิก'} • {excludeReferral ? 'คัดศูนย์รับ-ส่งต่อออก' : 'รวมศูนย์รับ-ส่งต่อ'}
          </span>
        </div>

        {selectedClinic === OPHTHALMOLOGY_CLINIC_NAME && ophthalmologyOutTimeData.isInTimeOnly && (
          <div className="bg-cyan-50 border border-cyan-200 rounded-xl px-3 py-2 text-xs text-cyan-950 flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>หมายเหตุ OPD จักษุวิทยา:</strong> สูตรคำนวณอัตรากำลังต่อจำนวนผู้ป่วย (รายจ่าย ÷ 150 บาท/คน) ใช้เฉพาะ{' '}
              <strong>กะนอกเวลาราชการ</strong> เท่านั้น
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedShift('นอกเวลาเย็น 16:00-20:00')}
                className="px-2.5 py-1 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-white text-[11px] font-bold cursor-pointer"
              >
                ดูนอกเวลาเย็น 16:00-20:00
              </button>
              <button
                type="button"
                onClick={() => setSelectedShift('ALL')}
                className="px-2.5 py-1 rounded-lg bg-white hover:bg-cyan-100 text-cyan-900 border border-cyan-300 text-[11px] font-bold cursor-pointer"
              >
                ดูรวมทุกกะ (แสดงจักษุฯ นอกเวลา)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main 6 Steps Formulas Cards */}
      <div className="no-print grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Step 1: Avg Patients / Day */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-gray-500 text-xs">
            <span className="font-semibold">ข้อ 1) ผู้ป่วยเฉลี่ย/วัน</span>
            <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-mono">Total / Days</span>
          </div>
          <div className="text-2xl font-extrabold text-blue-900">
            {stats.avgPtPerDay.toFixed(1)}{' '}
            <span className="text-xs font-normal text-gray-500">คน/วัน</span>
          </div>
          <div className="text-[11px] text-gray-500">
            ผู้ป่วยสะสม: {stats.totalPt.toLocaleString()} คน / {workingDays} วันทำการ
          </div>
        </div>

        {/* Step 2: FTC Required */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-gray-500 text-xs">
            <span className="font-semibold">ข้อ 2) อัตรากำลังที่ต้องการ (FTC)</span>
            <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-mono">
              {stats.isScreeningOnly
                ? `(Pt * ${stats.screeningNhppd}) / ${settings.stdHr}`
                : stats.hasScreeningRecords && selectedClinic === 'ALL'
                ? `(Pt * ${stats.generalNhppd} / คัดกรอง ${stats.screeningNhppd}) / ${settings.stdHr}`
                : `(Pt * ${stats.generalNhppd}) / ${settings.stdHr}`}
            </span>
          </div>
          <div className="text-2xl font-extrabold text-indigo-900">
            {stats.ftc.toFixed(2)}{' '}
            <span className="text-xs font-normal text-gray-500">FTC</span>
          </div>
          <div className="text-[11px] text-gray-500">
            {stats.isScreeningOnly ? (
              <>NHPPD หน่วยคัดกรอง: <strong className="text-cyan-800">{stats.screeningNhppd}</strong> ชม. | ชม.มาตรฐาน: {settings.stdHr} ชม.</>
            ) : stats.hasScreeningRecords && selectedClinic === 'ALL' ? (
              <>NHPPD: ทั่วไป {stats.generalNhppd} / คัดกรอง <strong className="text-cyan-800">{stats.screeningNhppd}</strong> ชม. | มาตรฐาน: {settings.stdHr} ชม.</>
            ) : (
              <>NHPPD: {stats.generalNhppd} ชม. (หน่วยคัดกรอง {stats.screeningNhppd}) | ชม.มาตรฐาน: {settings.stdHr} ชม.</>
            )}
          </div>
        </div>

        {/* Step 3: Output Required / Day */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-gray-500 text-xs">
            <span className="font-semibold">ข้อ 3) Output (ต้องการ/วัน)</span>
            <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-mono">FTC*2080 / (245*8)</span>
          </div>
          <div className="text-2xl font-extrabold text-emerald-900">
            {stats.output.toFixed(2)}{' '}
            <span className="text-xs font-normal text-gray-500">แรง/วัน</span>
          </div>
          <div className="text-[11px] text-gray-500">
            อัตรากำลังที่ต้องการคำนวณจากภาระงานจริง
          </div>
        </div>

        {/* Step 4: Input Scheduled / Day */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-gray-500 text-xs">
            <span className="font-semibold">ข้อ 4) Input (จัดเฉลี่ย/วัน)</span>
            <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-mono">(RN+PN+NA) / Days</span>
          </div>
          <div className="text-2xl font-extrabold text-cyan-900">
            {stats.input.toFixed(2)}{' '}
            <span className="text-xs font-normal text-gray-500">แรง/วัน</span>
          </div>
          <div className="text-[11px] text-gray-500">
            กำลังคนการพยาบาลจัดจริง (ไม่รวม HN)
          </div>
        </div>

        {/* Step 5: Productivity % */}
        <div className={`rounded-2xl p-4 border-2 shadow-sm space-y-1.5 ${
          stats.productivity > 115 ? 'bg-red-50/50 border-red-300' :
          stats.productivity >= 85 ? 'bg-emerald-50/50 border-emerald-300' :
          'bg-amber-50/50 border-amber-300'
        }`}>
          <div className="flex items-center justify-between text-gray-600 text-xs">
            <span className="font-bold">ข้อ 5) Productivity (%)</span>
            <span className="text-[10px] bg-white px-2 py-0.5 rounded-full font-mono font-bold">
              (Output / Input) * 100
            </span>
          </div>
          <div className={`text-3xl font-black ${
            stats.productivity > 115 ? 'text-red-900' :
            stats.productivity >= 85 ? 'text-emerald-900' :
            'text-amber-900'
          }`}>
            {stats.productivity.toFixed(1)}%
          </div>
          <div className="text-[11px] font-semibold text-gray-700">
            เกณฑ์มาตรฐาน: 85.0% - 115.0%
          </div>
        </div>

        {/* Step 6: Skill Mix % */}
        <div className="bg-white rounded-2xl p-4 border border-purple-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-gray-500 text-xs">
            <span className="font-bold text-purple-900">ข้อ 6) Skill Mix (%)</span>
            <span className="text-[10px] bg-purple-50 px-2 py-0.5 rounded-full text-purple-800 font-mono">
              RN / (RN+PN+NA)
            </span>
          </div>
          <div className="text-3xl font-extrabold text-purple-900">
            {stats.skillMix.toFixed(1)}%
          </div>
          <div className="text-[11px] text-gray-500">
            สัดส่วนพยาบาลวิชาชีพ RN ต่อบุคลากรการพยาบาลทั้งหมด
          </div>
        </div>
      </div>

      {/* Productivity Status Banner & Recommendations */}
      <div className={`no-print rounded-2xl p-5 border ${status.color} shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4`}>
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-white shadow-xs shrink-0">
            <StatusIcon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-base leading-tight">
                สถานะ Productivity: {stats.productivity.toFixed(1)}%
              </h4>
              {status.badge && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white shadow-2xs">
                  {status.badge}
                </span>
              )}
            </div>
            <p className="text-xs font-medium mt-1">
              {status.label}
            </p>
            {status.advice && (
              <p className="text-xs mt-1.5 opacity-90 flex items-center gap-1.5 font-normal">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span><strong>ข้อเสนอแนะทาง Informatics:</strong> {status.advice}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Specialized Ophthalmology Out-of-Hours Productivity Summary (Strictly for จักษุวิทยา + นอกเวลาราชการ) */}
      {ophthalmologyOutTimeData.showPanel && (
        <div
          className={
            includeEyeInPrint
              ? 'print:break-before-page bg-white rounded-2xl shadow-xs border-2 border-cyan-300/90 p-5 space-y-4 print:p-0 print:border-none print:shadow-none'
              : 'no-print bg-white rounded-2xl shadow-xs border-2 border-cyan-300/90 p-5 space-y-4'
          }
        >
          <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-cyan-100 pb-3.5">
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-700 text-white flex items-center justify-center shrink-0 shadow-xs">
                <Eye className="w-5 h-5" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-cyan-950">
                    สรุป Productivity เฉพาะ OPD จักษุวิทยา (นอกเวลาราชการ)
                  </h3>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-cyan-100 text-cyan-900 border border-cyan-200">
                    สูตรคำนวณ: รายจ่าย จนท. ÷ 150
                  </span>
                </div>
                <p className="text-xs text-cyan-800/90 mt-0.5">
                  คำนวณ Productivity เฉพาะแผนก <strong>จักษุวิทยา</strong> กะนอกเวลาราชการ จากอัตราส่วนจำนวนผู้ป่วยนอกเวลาจริงเทียบเป้าหมายคุ้มทุน 150 บ./ราย
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {ophthalmologyOutTimeData.hasAnyNa && (
                <select
                  value={eyeNaMappingMode}
                  onChange={(e) => setEyeNaMappingMode(e.target.value as EyeNaMappingMode)}
                  title="กำหนดการนับตำแหน่ง NA ในสูตร OPD จักษุ"
                  aria-label="การนับตำแหน่ง NA"
                  className="text-[11px] font-semibold text-cyan-950 bg-white border border-cyan-300 rounded-lg px-2 py-1.5 outline-none cursor-pointer"
                >
                  <option value="auto">NA → Tech (300) เมื่อไม่มีผู้ปฏิบัติงานทั่วไป</option>
                  <option value="technician">นับ NA รวมใน Technician (300) เสมอ</option>
                  <option value="na380">แยกคอลัมน์ NA (380)</option>
                </select>
              )}

              <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeEyeInPrint}
                  onChange={(e) => setIncludeEyeInPrint(e.target.checked)}
                  className="rounded border-gray-300 text-cyan-700 focus:ring-cyan-600"
                />
                <span>พิมพ์แนบรายงาน</span>
              </label>

              <button
                type="button"
                onClick={handleExportEyeCsv}
                disabled={ophthalmologyOutTimeData.rows.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-white text-emerald-800 border border-emerald-300 rounded-lg hover:bg-emerald-50 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV จักษุฯ</span>
              </button>

              <button
                type="button"
                onClick={handleExportEyeJpeg}
                disabled={isExportingEyeJpeg || ophthalmologyOutTimeData.rows.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                <ImageDown className="w-3.5 h-3.5" />
                <span>{isExportingEyeJpeg ? 'กำลังสร้างรูป...' : 'บันทึกภาพ .JPEG'}</span>
              </button>
            </div>
          </div>

          {/* 5 KPI Summary Cards for Ophthalmology Out-of-Hours Productivity */}
          <div className="no-print grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3.5">
              <div className="text-[11px] font-bold text-blue-800">ผู้รับบริการนอกเวลาจริง</div>
              <div className="text-2xl font-extrabold text-blue-950 mt-0.5">
                {ophthalmologyOutTimeData.summary.actualPatients.toLocaleString()}{' '}
                <span className="text-xs font-normal text-gray-600">คน</span>
              </div>
              <div className="text-[11px] text-blue-900/80 mt-1">
                เปิดตรวจ {ophthalmologyOutTimeData.summary.activeDays} เวร ({ophthalmologyOutTimeData.rows.length} รายการ)
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
              <div className="text-[11px] font-bold text-amber-900">รายจ่ายค่าตอบแทน จนท.รวม</div>
              <div className="text-2xl font-extrabold text-amber-950 mt-0.5">
                {ophthalmologyOutTimeData.summary.totalExpense.toLocaleString()}{' '}
                <span className="text-xs font-normal text-gray-600">บาท</span>
              </div>
              <div className="text-[11px] text-amber-900/85 mt-1 leading-snug">
                พยาบาล {ophthalmologyOutTimeData.summary.nurseCount}×600 • PN {ophthalmologyOutTimeData.summary.pnCount}×380 • Tech {ophthalmologyOutTimeData.summary.techCount}×300 • บริการ {ophthalmologyOutTimeData.summary.swCount}×300
                {ophthalmologyOutTimeData.summary.extraNaCount > 0
                  ? ` • NA ${ophthalmologyOutTimeData.summary.extraNaCount}×380`
                  : ''}
              </div>
            </div>

            <div className="rounded-xl border border-cyan-200 bg-cyan-50/40 p-3.5">
              <div className="text-[11px] font-bold text-cyan-900">คนไข้ที่ควรรับ (รายจ่าย ÷ 150)</div>
              <div className="text-2xl font-extrabold text-cyan-950 mt-0.5">
                {ophthalmologyOutTimeData.summary.targetPatients.toFixed(2)}{' '}
                <span className="text-xs font-normal text-gray-600">คน</span>
              </div>
              <div className="text-[11px] text-cyan-900/80 mt-1">
                ปัดเต็มขั้นต่ำ {Math.ceil(ophthalmologyOutTimeData.summary.targetPatients)} คน เพื่อคุ้มทุน
              </div>
            </div>

            <div
              className={`rounded-xl border-2 p-3.5 ${
                ophthalmologyOutTimeData.summary.totalExpense === 0
                  ? 'border-gray-200 bg-gray-50/60'
                  : ophthalmologyOutTimeData.summary.productivityPct >= 100
                  ? 'border-emerald-300 bg-emerald-50/60'
                  : 'border-rose-300 bg-rose-50/60'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={`text-[11px] font-bold ${
                    ophthalmologyOutTimeData.summary.totalExpense === 0
                      ? 'text-gray-700'
                      : ophthalmologyOutTimeData.summary.productivityPct >= 100
                      ? 'text-emerald-900'
                      : 'text-rose-900'
                  }`}
                >
                  Productivity จักษุฯ นอกเวลา
                </span>
                <span className="text-[9px] font-mono bg-white px-1.5 py-0.5 rounded border border-gray-200 text-gray-600">
                  จริง ÷ ควรรับ × 100
                </span>
              </div>
              <div
                className={`text-2xl font-black mt-0.5 ${
                  ophthalmologyOutTimeData.summary.totalExpense === 0
                    ? 'text-gray-700'
                    : ophthalmologyOutTimeData.summary.productivityPct >= 100
                    ? 'text-emerald-950'
                    : 'text-rose-950'
                }`}
              >
                {ophthalmologyOutTimeData.summary.productivityPct.toFixed(1)}%
              </div>
              <div
                className={`text-[11px] font-semibold mt-1 ${
                  ophthalmologyOutTimeData.summary.totalExpense === 0
                    ? 'text-gray-500'
                    : ophthalmologyOutTimeData.summary.productivityPct >= 100
                    ? 'text-emerald-800'
                    : 'text-rose-800'
                }`}
              >
                {ophthalmologyOutTimeData.summary.totalExpense === 0
                  ? 'ยังไม่มีข้อมูล'
                  : ophthalmologyOutTimeData.summary.productivityPct >= 100
                  ? 'ผ่านเกณฑ์คุ้มทุน (≥ 100%)'
                  : 'ต่ำกว่าเกณฑ์คุ้มทุน (< 100%)'}
              </div>
            </div>

            <div
              className={`rounded-xl border p-3.5 ${
                ophthalmologyOutTimeData.summary.diffPatients >= 0
                  ? 'border-emerald-200 bg-emerald-50/40'
                  : 'border-rose-200 bg-rose-50/40'
              }`}
            >
              <div
                className={`text-[11px] font-bold ${
                  ophthalmologyOutTimeData.summary.diffPatients >= 0
                    ? 'text-emerald-900'
                    : 'text-rose-900'
                }`}
              >
                ส่วนต่าง &amp; ต้นทุนต่อราย
              </div>
              <div
                className={`text-2xl font-extrabold mt-0.5 ${
                  ophthalmologyOutTimeData.summary.diffPatients >= 0
                    ? 'text-emerald-950'
                    : 'text-rose-950'
                }`}
              >
                {ophthalmologyOutTimeData.summary.diffPatients >= 0 ? '+' : ''}
                {ophthalmologyOutTimeData.summary.diffPatients.toFixed(2)}{' '}
                <span className="text-xs font-normal text-gray-600">คน</span>
              </div>
              <div className="text-[11px] text-gray-700 mt-1">
                {ophthalmologyOutTimeData.summary.actualPatients > 0
                  ? `ต้นทุนจริง ${ophthalmologyOutTimeData.summary.costPerPatient.toFixed(1)} บ./ราย (เกณฑ์ 150)`
                  : 'ผู้ป่วย 0 ราย'}
              </div>
            </div>
          </div>

          {/* Detailed Printable / JPEG-Exportable Daily Breakdown Table */}
          <div className="overflow-x-auto print:overflow-visible">
            <div
              ref={eyeReportSheetRef}
              className="w-[1030px] max-w-full print:w-full mx-auto bg-white p-2 sm:p-3 space-y-2.5"
            >
              <div className="text-center border-b border-gray-300 pb-2">
                <h4 className="text-sm sm:text-base font-extrabold text-gray-950">
                  สรุป Productivity และจุดคุ้มทุนอัตรากำลังนอกเวลา OPD จักษุวิทยา
                </h4>
                <p className="text-xs font-semibold text-gray-700 mt-0.5">
                  ประจำเดือน {ophthalmologyOutTimeData.thaiMonthTitle} •{' '}
                  {selectedShift === 'ALL'
                    ? 'รวมทุกกะนอกเวลาราชการ (16:00-20:00 และวันหยุด 08:00-12:00)'
                    : selectedShift}
                </p>
              </div>

              <table className="w-full text-[11px] border border-gray-400 border-collapse print:text-[9px]">
                <thead className="bg-slate-100 text-slate-900 font-bold">
                  <tr>
                    <th rowSpan={2} className="border border-gray-400 py-1.5 px-1 text-center w-12">
                      วัน
                    </th>
                    <th rowSpan={2} className="border border-gray-400 py-1.5 px-1.5 text-center w-24">
                      วันที่
                    </th>
                    <th rowSpan={2} className="border border-gray-400 py-1.5 px-1 text-center w-12">
                      เข้า
                    </th>
                    <th rowSpan={2} className="border border-gray-400 py-1.5 px-1 text-center w-12">
                      ออก
                    </th>
                    <th rowSpan={2} className="border border-gray-400 py-1.5 px-1.5 text-center w-20 leading-tight bg-blue-50/70">
                      ผู้รับบริการ (คน)
                    </th>
                    <th
                      colSpan={ophthalmologyOutTimeData.showExtraNaColumn ? 5 : 4}
                      className="border border-gray-400 py-1 px-2 text-center bg-amber-50/60"
                    >
                      จำนวนจนท.ปฏิบัติงาน
                    </th>
                    <th rowSpan={2} className="border border-gray-400 py-1.5 px-1.5 text-center w-20 leading-tight bg-amber-50/80">
                      รายจ่าย (บาท)
                    </th>
                    <th rowSpan={2} className="border border-gray-400 py-1.5 px-1.5 text-center w-20 leading-tight bg-cyan-50/80">
                      ควรรับ (÷150)
                    </th>
                    <th rowSpan={2} className="border border-gray-400 py-1.5 px-1.5 text-center w-20 leading-tight">
                      เทียบเกณฑ์ (คน)
                    </th>
                    <th rowSpan={2} className="border border-gray-400 py-1.5 px-1.5 text-center w-20 leading-tight bg-emerald-50/80">
                      Productivity (%)
                    </th>
                    <th rowSpan={2} className="border border-gray-400 py-1.5 px-2 text-left">
                      หมายเหตุ
                    </th>
                  </tr>
                  <tr>
                    <th className="border border-gray-400 py-1 px-1 text-center w-14 leading-tight bg-white">
                      พยาบาล (600)
                    </th>
                    <th className="border border-gray-400 py-1 px-1 text-center w-14 leading-tight bg-white">
                      PN (380)
                    </th>
                    <th className="border border-gray-400 py-1 px-1 text-center w-16 leading-tight bg-white">
                      Tech (300)
                    </th>
                    {ophthalmologyOutTimeData.showExtraNaColumn && (
                      <th className="border border-gray-400 py-1 px-1 text-center w-14 leading-tight bg-white">
                        NA (380)
                      </th>
                    )}
                    <th className="border border-gray-400 py-1 px-1 text-center w-16 leading-tight bg-white">
                      บริการ (300)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ophthalmologyOutTimeData.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={ophthalmologyOutTimeData.showExtraNaColumn ? 15 : 14}
                        className="border border-gray-300 py-6 text-center text-gray-400"
                      >
                        ยังไม่มีข้อมูลนอกเวลาราชการของแผนกจักษุวิทยาในเดือนที่เลือก
                      </td>
                    </tr>
                  ) : (
                    ophthalmologyOutTimeData.rows.map((row) => (
                      <tr
                        key={row.record.id}
                        className={row.isOffDuty ? 'bg-violet-50/70 text-violet-950' : 'hover:bg-slate-50/80'}
                      >
                        <td className="border border-gray-300 py-1.5 px-1 text-center font-semibold">
                          {row.dayAbbrev}
                        </td>
                        <td className="border border-gray-300 py-1.5 px-1.5 text-center whitespace-nowrap">
                          {row.shortDate}
                        </td>
                        <td className="border border-gray-300 py-1.5 px-1 text-center">{row.timeIn}</td>
                        <td className="border border-gray-300 py-1.5 px-1 text-center">{row.timeOut}</td>
                        <td className="border border-gray-300 py-1.5 px-1.5 text-right font-bold text-blue-950 bg-blue-50/30">
                          {row.actualPatients.toLocaleString()}
                        </td>
                        <td className="border border-gray-300 py-1.5 px-1 text-center">{row.nurseCount}</td>
                        <td className="border border-gray-300 py-1.5 px-1 text-center">{row.pnCount}</td>
                        <td
                          className="border border-gray-300 py-1.5 px-1 text-center"
                          title={
                            row.naCountedAsTech > 0
                              ? `รวม NA ${row.naCountedAsTech} คนเป็น Technician (300)`
                              : undefined
                          }
                        >
                          {row.techCount}
                          {row.naCountedAsTech > 0 && <span className="text-[9px] text-cyan-700 ml-0.5">*</span>}
                        </td>
                        {ophthalmologyOutTimeData.showExtraNaColumn && (
                          <td className="border border-gray-300 py-1.5 px-1 text-center">{row.extraNaCount}</td>
                        )}
                        <td className="border border-gray-300 py-1.5 px-1 text-center">{row.swCount}</td>
                        <td className="border border-gray-300 py-1.5 px-1.5 text-right font-semibold text-amber-950 bg-amber-50/25">
                          {row.totalExpense.toLocaleString()}
                        </td>
                        <td className="border border-gray-300 py-1.5 px-1.5 text-right font-bold text-cyan-950 bg-cyan-50/30">
                          {row.targetPatients.toFixed(2)}
                        </td>
                        <td
                          className={`border border-gray-300 py-1.5 px-1.5 text-right font-bold ${
                            row.isOffDuty
                              ? 'text-violet-800'
                              : row.diffPatients >= 0
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {row.isOffDuty
                            ? 'Off เวร'
                            : `${row.diffPatients >= 0 ? '+' : ''}${row.diffPatients.toFixed(2)}`}
                        </td>
                        <td
                          className={`border border-gray-300 py-1.5 px-1.5 text-right font-extrabold ${
                            row.isOffDuty
                              ? 'text-violet-800'
                              : row.productivityPct >= 100
                              ? 'text-emerald-700 bg-emerald-50/40'
                              : 'text-rose-700 bg-rose-50/40'
                          }`}
                        >
                          {row.isOffDuty ? '-' : `${row.productivityPct.toFixed(1)}%`}
                        </td>
                        <td className="border border-gray-300 py-1.5 px-2 text-left text-[10px] text-gray-600 break-words">
                          {row.noteText || '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {ophthalmologyOutTimeData.rows.length > 0 && (
                  <tfoot className="bg-slate-200/80 font-extrabold text-gray-950">
                    <tr>
                      <td colSpan={4} className="border border-gray-400 py-1.5 px-2 text-center">
                        รวมทั้งเดือน ({ophthalmologyOutTimeData.rows.length} เวร)
                      </td>
                      <td className="border border-gray-400 py-1.5 px-1.5 text-right text-blue-950 bg-blue-100/70">
                        {ophthalmologyOutTimeData.summary.actualPatients.toLocaleString()}
                      </td>
                      <td className="border border-gray-400 py-1.5 px-1 text-center">
                        {ophthalmologyOutTimeData.summary.nurseCount}
                      </td>
                      <td className="border border-gray-400 py-1.5 px-1 text-center">
                        {ophthalmologyOutTimeData.summary.pnCount}
                      </td>
                      <td className="border border-gray-400 py-1.5 px-1 text-center">
                        {ophthalmologyOutTimeData.summary.techCount}
                      </td>
                      {ophthalmologyOutTimeData.showExtraNaColumn && (
                        <td className="border border-gray-400 py-1.5 px-1 text-center">
                          {ophthalmologyOutTimeData.summary.extraNaCount}
                        </td>
                      )}
                      <td className="border border-gray-400 py-1.5 px-1 text-center">
                        {ophthalmologyOutTimeData.summary.swCount}
                      </td>
                      <td className="border border-gray-400 py-1.5 px-1.5 text-right text-amber-950 bg-amber-100/70">
                        {ophthalmologyOutTimeData.summary.totalExpense.toLocaleString()}
                      </td>
                      <td className="border border-gray-400 py-1.5 px-1.5 text-right text-cyan-950 bg-cyan-100/70">
                        {ophthalmologyOutTimeData.summary.targetPatients.toFixed(2)}
                      </td>
                      <td
                        className={`border border-gray-400 py-1.5 px-1.5 text-right ${
                          ophthalmologyOutTimeData.summary.diffPatients >= 0
                            ? 'text-emerald-800 bg-emerald-100/60'
                            : 'text-rose-800 bg-rose-100/60'
                        }`}
                      >
                        {ophthalmologyOutTimeData.summary.diffPatients >= 0 ? '+' : ''}
                        {ophthalmologyOutTimeData.summary.diffPatients.toFixed(2)}
                      </td>
                      <td
                        className={`border border-gray-400 py-1.5 px-1.5 text-right font-black ${
                          ophthalmologyOutTimeData.summary.productivityPct >= 100
                            ? 'text-emerald-900 bg-emerald-100/80'
                            : 'text-rose-900 bg-rose-100/80'
                        }`}
                      >
                        {ophthalmologyOutTimeData.summary.productivityPct.toFixed(1)}%
                      </td>
                      <td className="border border-gray-400 py-1.5 px-2 text-right text-[10px] font-semibold text-gray-800">
                        {ophthalmologyOutTimeData.summary.actualPatients > 0
                          ? `เฉลี่ย ${ophthalmologyOutTimeData.summary.costPerPatient.toFixed(1)} บ./ราย`
                          : '-'}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>

              <div className="pt-1 text-[11px] text-gray-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong className="text-gray-950">สูตร Productivity จักษุฯ นอกเวลา:</strong>{' '}
                  คนไข้ที่ควรรับ = รายจ่าย จนท.รวม ÷ 150 •{' '}
                  <strong>Productivity (%) = (ผู้รับบริการจริง ÷ คนไข้ที่ควรรับ) × 100</strong> (คุ้มทุน ≥ 100%)
                </div>
                <div className="text-[10px] text-gray-500">
                  อัตราต่อเวร: พยาบาล 600 • PN 380 • Technician 300 • พนง.บริการ 300 บาท
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Skill Mix Breakdown Visual Bar */}
      <div className="no-print bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-3">
        <h3 className="text-xs font-bold text-gray-900 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-purple-600" />
            สัดส่วนองค์ประกอบบุคลากรการพยาบาล (Nursing Staff Mix)
          </span>
          <span className="text-gray-500 font-normal">
            รวม: {stats.totalNursingStaff.toFixed(1)} แรง-เวร
          </span>
        </h3>

        {/* Proportion Bar */}
        {stats.totalNursingStaff > 0 ? (
          <div className="space-y-2">
            <div className="h-6 w-full rounded-xl overflow-hidden flex bg-gray-100 shadow-inner">
              <div
                style={{ width: `${(stats.sumRN / stats.totalNursingStaff) * 100}%` }}
                className="bg-blue-600 h-full text-white text-[10px] font-bold flex items-center justify-center transition-all"
                title={`RN: ${stats.sumRN} (${((stats.sumRN / stats.totalNursingStaff) * 100).toFixed(1)}%)`}
              >
                {((stats.sumRN / stats.totalNursingStaff) * 100) > 10 && `RN ${((stats.sumRN / stats.totalNursingStaff) * 100).toFixed(0)}%`}
              </div>
              <div
                style={{ width: `${(stats.sumPN / stats.totalNursingStaff) * 100}%` }}
                className="bg-teal-500 h-full text-white text-[10px] font-bold flex items-center justify-center transition-all"
                title={`PN: ${stats.sumPN} (${((stats.sumPN / stats.totalNursingStaff) * 100).toFixed(1)}%)`}
              >
                {((stats.sumPN / stats.totalNursingStaff) * 100) > 10 && `PN ${((stats.sumPN / stats.totalNursingStaff) * 100).toFixed(0)}%`}
              </div>
              <div
                style={{ width: `${(stats.sumNA / stats.totalNursingStaff) * 100}%` }}
                className="bg-emerald-500 h-full text-white text-[10px] font-bold flex items-center justify-center transition-all"
                title={`NA: ${stats.sumNA} (${((stats.sumNA / stats.totalNursingStaff) * 100).toFixed(1)}%)`}
              >
                {((stats.sumNA / stats.totalNursingStaff) * 100) > 10 && `NA ${((stats.sumNA / stats.totalNursingStaff) * 100).toFixed(0)}%`}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
              <div className="bg-blue-50 text-blue-900 p-2 rounded-lg border border-blue-200">
                <div className="font-bold">RN (พยาบาลวิชาชีพ)</div>
                <div className="text-sm font-extrabold">{stats.sumRN.toFixed(1)} แรง</div>
                <div className="text-[10px] text-blue-700">{stats.skillMix.toFixed(1)}% ของทั้งหมด</div>
              </div>
              <div className="bg-teal-50 text-teal-900 p-2 rounded-lg border border-teal-200">
                <div className="font-bold">PN (ผู้ช่วยพยาบาล)</div>
                <div className="text-sm font-extrabold">{stats.sumPN.toFixed(1)} แรง</div>
                <div className="text-[10px] text-teal-700">
                  {((stats.sumPN / stats.totalNursingStaff) * 100).toFixed(1)}% ของทั้งหมด
                </div>
              </div>
              <div className="bg-emerald-50 text-emerald-900 p-2 rounded-lg border border-emerald-200">
                <div className="font-bold">NA (ผู้ช่วยคนไข้)</div>
                <div className="text-sm font-extrabold">{stats.sumNA.toFixed(1)} แรง</div>
                <div className="text-[10px] text-emerald-700">
                  {((stats.sumNA / stats.totalNursingStaff) * 100).toFixed(1)}% ของทั้งหมด
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูลบุคลากรในเดือนนี้</div>
        )}
      </div>

      {/* Comparison Table by Clinic */}
      <div className="no-print bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4">
        <h3 className="text-xs font-bold text-gray-900 flex items-center justify-between border-b pb-2">
          <span>เปรียบเทียบภาระงานและ Productivity แยกรายห้องตรวจ ({clinicBreakdown.length} คลินิก)</span>
          <span className="text-[11px] font-normal text-gray-500">จัดเรียงตามจำนวนผู้ป่วย</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b">
              <tr>
                <th className="py-2.5 px-3">ห้องตรวจ</th>
                <th className="py-2.5 px-2 text-center">NHPPD</th>
                <th className="py-2.5 px-2 text-right">ผู้ป่วยรวม (คน)</th>
                <th className="py-2.5 px-2 text-right">เฉลี่ย/วัน (คน)</th>
                <th className="py-2.5 px-2 text-right">กำลังคนพยาบาล/วัน (แรง)</th>
                <th className="py-2.5 px-2 text-right">Skill Mix (% RN)</th>
                <th className="py-2.5 px-3 text-center">Productivity (%)</th>
                <th className="py-2.5 px-2 text-center">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {clinicBreakdown.map((item) => {
                const itemStatus = getProductivityStatus(item.productivity);
                const isScreening = item.clinicName === SCREENING_CLINIC_NAME;
                return (
                  <tr
                    key={item.clinicName}
                    className={item.isPremiumGroup ? 'bg-orange-50/40 hover:bg-orange-50/70' : 'hover:bg-slate-50/80'}
                  >
                    <td className="py-2 px-3 font-bold text-gray-900">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {item.isPremiumGroup && <Star className="w-3.5 h-3.5 text-orange-600 shrink-0" />}
                        <span className={item.isPremiumGroup ? 'text-orange-950' : ''}>{item.clinicName}</span>
                        {item.isPremiumGroup && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 border border-orange-300">
                            Pooled Staffing
                          </span>
                        )}
                      </div>
                      {item.isPremiumGroup && item.subClinicEntries.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {item.subClinicEntries.map(([subName, subPt]) => (
                            <span
                              key={subName}
                              className="inline-flex items-center px-1.5 py-0.5 rounded bg-white border border-orange-200 text-[10px] font-medium text-orange-900"
                            >
                              {subName.replace(/-Premium$/i, '')}: <strong className="ml-0.5">{subPt.toLocaleString()}</strong>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isScreening
                          ? 'bg-cyan-100 text-cyan-800 border border-cyan-300'
                          : item.isPremiumGroup
                          ? 'bg-orange-100 text-orange-900 border border-orange-300'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {item.clinicNhppd}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right text-gray-700 font-semibold">{item.totalPt.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right font-medium text-blue-900">{item.avgPt}</td>
                    <td className="py-2 px-2 text-right text-gray-800">{item.nursingStaffPerDay}</td>
                    <td className="py-2 px-2 text-right font-medium text-purple-900">{item.skillMix}%</td>
                    <td className="py-2 px-3 text-center font-extrabold text-sm">
                      <span className={
                        item.productivity > 115 ? 'text-red-700' :
                        item.productivity >= 85 ? 'text-emerald-700' :
                        'text-amber-700'
                      }>
                        {item.productivity}%
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.productivity > 115 ? 'bg-red-100 text-red-800' :
                        item.productivity >= 85 ? 'bg-emerald-100 text-emerald-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {itemStatus.badge || 'N/A'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Referral Center Monthly Summary Card (shown whenever Referral Center records exist) */}
      {referralMonthlySummary && (
        <div className="no-print bg-white rounded-2xl shadow-xs border border-indigo-200/90 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-indigo-100 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <ArrowRightLeft className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-indigo-950">
                  สรุปภาระงาน {REFERRAL_CLINIC_NAME} ประจำเดือน {officialReportMeta.monthLabel}
                </h3>
                <p className="text-[11px] text-indigo-700">
                  บันทึกทั้งหมด {referralMonthlySummary.recordCount} เวร • รวม 6 รายการ {referralMonthlySummary.grandTotal.toLocaleString()} รายการ (Admit รวม {referralMonthlySummary.totalAdmit.toLocaleString()} ราย)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-900 border border-indigo-200 font-bold">
                Admit รวม: {referralMonthlySummary.totalAdmit.toLocaleString()}
              </span>
              <span className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold">
                รวมทั้งเดือน: {referralMonthlySummary.grandTotal.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {REFERRAL_ITEM_DEFINITIONS.map(({ key, label }) => (
              <div
                key={key}
                className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-2.5 text-center"
              >
                <div className="text-[11px] font-semibold text-indigo-800">{label}</div>
                <div className="text-xl font-black text-indigo-950 mt-0.5">
                  {referralMonthlySummary.totals[key].toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border border-indigo-100 rounded-xl overflow-hidden">
              <thead className="bg-indigo-50 text-indigo-950 font-semibold border-b border-indigo-200">
                <tr>
                  <th className="py-2 px-2.5 whitespace-nowrap">วันที่</th>
                  <th className="py-2 px-2 whitespace-nowrap">กะเวลา</th>
                  {REFERRAL_ITEM_DEFINITIONS.map(({ key, label }) => (
                    <th key={key} className="py-2 px-2 text-center whitespace-nowrap">
                      {label}
                    </th>
                  ))}
                  <th className="py-2 px-2 text-center bg-indigo-100/70">รวม</th>
                  <th className="py-2 px-2.5">เหตุผล / หมายเหตุ</th>
                  <th className="py-2 px-2.5 whitespace-nowrap">ผู้รายงาน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-indigo-100/70">
                {referralMonthlySummary.dailyRows.map((d) => (
                  <tr key={d.id} className="hover:bg-indigo-50/30">
                    <td className="py-1.5 px-2.5 font-semibold text-gray-900 whitespace-nowrap">
                      {formatThaiShortDate(d.date)}
                    </td>
                    <td className="py-1.5 px-2 text-[11px] text-gray-600 whitespace-nowrap">
                      {d.shift.replace(/\s*\([^)]*\)/g, '')}
                    </td>
                    {REFERRAL_ITEM_DEFINITIONS.map(({ key }) => {
                      const val = Number(d.ref[key]?.count) || 0;
                      return (
                        <td key={key} className="py-1.5 px-2 text-center font-medium text-gray-800">
                          {val > 0 ? val : '-'}
                        </td>
                      );
                    })}
                    <td className="py-1.5 px-2 text-center font-extrabold text-indigo-900 bg-indigo-50/50">
                      {d.rowTotal}
                    </td>
                    <td className="py-1.5 px-2.5 text-[11px] text-gray-600 max-w-[260px]">
                      {d.reasonText || '-'}
                    </td>
                    <td className="py-1.5 px-2.5 text-[11px] text-gray-700 whitespace-nowrap">
                      {d.reporter || '-'}
                    </td>
                  </tr>
                ))}
                <tr className="bg-indigo-100/60 font-bold text-indigo-950 border-t border-indigo-200">
                  <td colSpan={2} className="py-2 px-2.5 text-center">
                    รวมประจำเดือน
                  </td>
                  {REFERRAL_ITEM_DEFINITIONS.map(({ key }) => (
                    <td key={key} className="py-2 px-2 text-center">
                      {referralMonthlySummary.totals[key]}
                    </td>
                  ))}
                  <td className="py-2 px-2 text-center font-black">
                    {referralMonthlySummary.grandTotal}
                  </td>
                  <td colSpan={2} className="py-2 px-2.5 text-[11px] font-medium">
                    Admit รวม {referralMonthlySummary.totalAdmit} ราย
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Staffing Headcount vs Leave / Training / Cross-Coverage Verification Panel */}
      <div className="no-print bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
          <div className="flex items-start gap-2.5">
            <div className={`p-2 rounded-xl shrink-0 ${
              verificationStats.mismatch > 0
                ? 'bg-amber-100 text-amber-800'
                : 'bg-emerald-100 text-emerald-800'
            }`}>
              {verificationStats.mismatch > 0 ? (
                <ShieldAlert className="w-5 h-5" />
              ) : (
                <ShieldCheck className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="text-xs font-bold text-gray-900">
                ตรวจสอบความสอดคล้องจำนวนบุคลากร vs รายชื่อลา / ไปอบรม / ไปช่วยงานอื่น
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                เทียบกำลังคนประจำในเมนู 5 หักผู้ลา/อบรม/ไปช่วยห้องอื่น บวกผู้มาขึ้นแทน เทียบกับยอดกำลังคน (RN+PN+NA) ที่บันทึกจริง
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold">
              ตรงกัน: {verificationStats.matched} รายการ
            </span>
            {verificationStats.mismatch > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-900 border border-amber-300 font-bold">
                ควรตรวจสอบ: {verificationStats.mismatch} รายการ
              </span>
            )}
            <span className="px-2.5 py-1 rounded-lg bg-slate-50 text-slate-700 border border-slate-200 font-medium">
              วันที่มีลา/อบรม/ช่วยงาน: {verificationStats.withEvents} รายการ
            </span>
            {staffingVerification.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAllVerificationDays((v) => !v)}
                className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-gray-300 font-semibold cursor-pointer transition-colors"
              >
                {showAllVerificationDays
                  ? 'แสดงเฉพาะวันที่มีลา/อบรม/ไม่ตรงกัน'
                  : `แสดงทุกวันทำการ (${staffingVerification.length})`}
              </button>
            )}
          </div>
        </div>

        {staffingVerification.length === 0 ? (
          <div className="py-5 text-center text-xs text-gray-400">
            ยังไม่มีข้อมูลภาระงานสำหรับตรวจสอบในเดือน/กะเวลาที่เลือก
          </div>
        ) : verificationStats.visibleItems.length === 0 ? (
          <div className="py-4 px-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              กำลังคนพยาบาลทุกวันทำการ ({verificationStats.matched} รายการ) สอดคล้องตรงตามอัตรากำลังประจำและไม่พบความคลาดเคลื่อน
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b">
                <tr>
                  <th className="py-2 px-2.5 whitespace-nowrap">วันที่</th>
                  {selectedClinic === 'ALL' && <th className="py-2 px-2.5">หน่วยงาน</th>}
                  <th className="py-2 px-2.5 text-center whitespace-nowrap">ประจำ (เมนู 5)</th>
                  <th className="py-2 px-2.5">รายชื่อลา / อบรม / ไปช่วย (-)</th>
                  <th className="py-2 px-2.5">มาช่วย / ขึ้นแทน (+)</th>
                  <th className="py-2 px-2 text-center whitespace-nowrap">คาดการณ์</th>
                  <th className="py-2 px-2 text-center whitespace-nowrap">บันทึกจริง</th>
                  <th className="py-2 px-2.5">ผลการตรวจสอบ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {verificationStats.visibleItems.map((v) => {
                  const rowBg =
                    v.status === 'mismatch_over' || v.status === 'mismatch_under'
                      ? 'bg-amber-50/60'
                      : v.status === 'match'
                      ? 'bg-emerald-50/30'
                      : 'bg-white';
                  return (
                    <tr key={v.key} className={`${rowBg} align-top`}>
                      <td className="py-2 px-2.5 font-semibold text-gray-900 whitespace-nowrap">
                        {formatThaiShortDate(v.date)}
                      </td>
                      {selectedClinic === 'ALL' && (
                        <td className="py-2 px-2.5 font-semibold text-gray-800 whitespace-nowrap">
                          {v.unit}
                        </td>
                      )}
                      <td className="py-2 px-2.5 text-center whitespace-nowrap">
                        {v.mode === 'IN_TIME' ? (
                          <div>
                            <div className="font-bold text-gray-900">{v.baselineCount} คน</div>
                            <div className="text-[10px] text-gray-500">{v.baselineSummary}</div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-gray-500">{v.baselineSummary}</span>
                        )}
                      </td>
                      <td className="py-2 px-2.5">
                        {v.absentList.length === 0 ? (
                          <span className="text-gray-300">-</span>
                        ) : (
                          <div className="space-y-1">
                            {v.absentList.map((ab, idx) => (
                              <div
                                key={idx}
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium mr-1 ${
                                  ab.kind === 'training'
                                    ? 'bg-cyan-50 text-cyan-900 border border-cyan-200'
                                    : ab.kind === 'outgoing'
                                    ? 'bg-purple-50 text-purple-900 border border-purple-200'
                                    : ab.kind === 'off_duty'
                                    ? 'bg-violet-100/90 text-violet-950 border border-violet-300'
                                    : 'bg-amber-100/80 text-amber-950 border border-amber-200'
                                }`}
                              >
                                {ab.kind === 'training' ? (
                                  <GraduationCap className="w-3 h-3 shrink-0" />
                                ) : ab.kind === 'outgoing' ? (
                                  <ArrowRightLeft className="w-3 h-3 shrink-0" />
                                ) : ab.kind === 'off_duty' ? (
                                  <PauseCircle className="w-3 h-3 shrink-0" />
                                ) : (
                                  <CalendarOff className="w-3 h-3 shrink-0" />
                                )}
                                <span>{ab.label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2.5">
                        {v.incomingList.length === 0 ? (
                          <span className="text-gray-300">-</span>
                        ) : (
                          <div className="space-y-1">
                            {v.incomingList.map((inc, idx) => (
                              <div
                                key={idx}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-900 border border-emerald-200 mr-1"
                              >
                                <Users className="w-3 h-3 shrink-0" />
                                <span>{inc.label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-2 text-center font-bold text-slate-800 whitespace-nowrap">
                        {v.baselineCount > 0 || v.mode === 'OUT_TIME' ? `${v.expectedCount} แรง` : '-'}
                      </td>
                      <td className="py-2 px-2 text-center whitespace-nowrap">
                        <div className="font-extrabold text-blue-900">{v.recordedNursing} แรง</div>
                        <div className="text-[10px] text-gray-500">
                          RN {v.recordedRN}
                          {v.recordedPN > 0 ? ` / PN ${v.recordedPN}` : ''}
                          {v.recordedNA > 0 ? ` / NA ${v.recordedNA}` : ''}
                        </div>
                      </td>
                      <td className="py-2 px-2.5">
                        <div className="flex items-start gap-1.5">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                              v.status === 'match'
                                ? 'bg-emerald-100 text-emerald-800'
                                : v.status === 'no_baseline'
                                ? 'bg-gray-100 text-gray-700'
                                : 'bg-amber-200 text-amber-950'
                            }`}
                          >
                            {v.status === 'match'
                              ? 'ตรงกัน'
                              : v.status === 'no_baseline'
                              ? 'ไม่มีฐานเมนู 5'
                              : v.diff > 0
                              ? `เกิน ${v.diff}`
                              : `ขาด ${Math.abs(v.diff)}`}
                          </span>
                          <span className="text-[11px] text-gray-700 leading-snug">{v.message}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Official PDF / JPEG Printable Productivity Form */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-4 sm:p-6 space-y-4 print:p-0 print:border-0 print:shadow-none print:rounded-none">
        <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-amber-600 shrink-0" />
            <div>
              <h3 className="text-xs font-bold text-gray-900">
                แบบรวบรวมภาระงานผู้ป่วยนอก (แบบฟอร์มมาตรฐาน A4 สำหรับบันทึกเป็น PDF / .JPEG)
              </h3>
              <p className="text-[11px] text-gray-500">
                แสดงข้อมูลตรงตามตัวกรองเดือน กะเวลา และห้องตรวจที่เลือกไว้ด้านบน
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportOfficialJpeg}
              disabled={isExportingJpeg}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <ImageDown className="w-3.5 h-3.5" />
              <span>{isExportingJpeg ? 'กำลังสร้างรูป...' : 'บันทึกเป็น .JPEG'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrintOfficialReport}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-blue-700 hover:bg-blue-600 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>พิมพ์รายงาน / PDF</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto print:overflow-visible">
          <div
            ref={reportSheetRef}
            className="print-portrait-sheet font-sarabun bg-white text-black mx-auto w-full max-w-[730px] min-w-0 print:max-w-full p-3 sm:p-5 print:p-0"
          >
            {/* Main Form Grid matching the official PDF layout */}
            <table className="w-full table-fixed border-collapse border border-black text-[11.5px] print:text-[10px] leading-tight print-fit-table">
              <colgroup>
                <col className="w-[9%]" />
                <col className="w-[35%]" />
                <col className="w-[7.5%]" />
                <col className="w-[7.5%]" />
                <col className="w-[7.5%]" />
                <col className="w-[7.5%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
              </colgroup>
              <tbody>
                {/* Title Header */}
                <tr>
                  <td
                    colSpan={8}
                    className="border border-black py-1.5 px-2 text-center font-bold text-[15px] print:text-[13px] bg-white"
                  >
                    {officialReportMeta.title}
                  </td>
                </tr>

                {/* Summary Header Row */}
                <tr className="text-center font-bold bg-white">
                  <td className="border border-black py-1 px-1">วันรวม</td>
                  <td className="border border-black py-1 px-2">Staff</td>
                  <td className="border border-black py-1 px-1">HN</td>
                  <td className="border border-black py-1 px-1">RN</td>
                  <td className="border border-black py-1 px-1">PN</td>
                  <td className="border border-black py-1 px-1">NA</td>
                  <td className="border border-black py-1 px-1">รวม ชม.</td>
                  <td className="border border-black py-1 px-1 text-[10.5px] print:text-[9.5px]">
                    รวม staff /วัน (A)
                  </td>
                </tr>

                {/* Summary Row 1: Headcount */}
                <tr className="text-center bg-white">
                  <td rowSpan={2} className="border border-black py-1 px-1 font-bold text-[13px] align-middle">
                    {actualWorkingDays}
                  </td>
                  <td className="border border-black py-1 px-2 font-bold">รวมคน</td>
                  <td className="border border-black py-1 px-1 font-semibold">
                    {officialReportMeta.fmtSum(stats.sumHN)}
                  </td>
                  <td className="border border-black py-1 px-1 font-semibold">
                    {officialReportMeta.fmtSum(stats.sumRN)}
                  </td>
                  <td className="border border-black py-1 px-1 font-semibold">
                    {officialReportMeta.fmtSum(stats.sumPN)}
                  </td>
                  <td className="border border-black py-1 px-1 font-semibold">
                    {officialReportMeta.fmtSum(stats.sumNA)}
                  </td>
                  <td className="border border-black py-1 px-1 font-bold">
                    {officialReportMeta.fmtSum(stats.totalNursingStaff)}
                  </td>
                  <td rowSpan={2} className="border border-black py-1 px-1 font-bold align-middle">
                    {stats.totalNursingStaff > 0 ? stats.input.toFixed(2) : ''}
                  </td>
                </tr>

                {/* Summary Row 2: Total Hours (x8) */}
                <tr className="text-center bg-[#fef9c3]">
                  <td className="border border-black py-1 px-2 font-bold bg-white">
                    รวม ชม. การทำงาน (คนx8ชม.)
                  </td>
                  <td className="border border-black py-1 px-1 font-semibold">
                    {officialReportMeta.fmtSum(stats.sumHN * 8)}
                  </td>
                  <td className="border border-black py-1 px-1 font-semibold">
                    {officialReportMeta.fmtSum(stats.sumRN * 8)}
                  </td>
                  <td className="border border-black py-1 px-1 font-semibold">
                    {officialReportMeta.fmtSum(stats.sumPN * 8)}
                  </td>
                  <td className="border border-black py-1 px-1 font-semibold">
                    {officialReportMeta.fmtSum(stats.sumNA * 8)}
                  </td>
                  <td className="border border-black py-1 px-1 font-bold">
                    {officialReportMeta.fmtSum(officialReportMeta.totalHours)}
                  </td>
                </tr>

                {/* Subheader Row */}
                <tr className="bg-white">
                  <td colSpan={8} className="border border-black py-1 px-3 font-bold text-left">
                    อัตราส่วน RN Hr/Auxiliaries
                  </td>
                </tr>

                {/* Daily Table Column Headers */}
                <tr className="text-center font-bold bg-white">
                  <td className="border border-black py-1 px-1">วันที่</td>
                  <td className="border border-black py-1 px-2"></td>
                  <td className="border border-black py-1 px-1">HN</td>
                  <td className="border border-black py-1 px-1">RN</td>
                  <td className="border border-black py-1 px-1">PN</td>
                  <td className="border border-black py-1 px-1">NA</td>
                  <td className="border border-black py-1 px-1 text-[11px] print:text-[9.5px]">รวม staff/เวร</td>
                  <td className="border border-black py-1 px-1 text-[11px] print:text-[9.5px]">รวม Pt/วัน</td>
                </tr>

                {/* Daily Rows */}
                {dailyReportRows.map((row) => {
                  const rowNursing = row.rn + row.pn + row.na;
                  const isPureOffRow = !row.hasActiveService;
                  return (
                    <tr
                      key={row.date}
                      className={`text-center min-h-[22px] print:min-h-[18px] ${
                        isPureOffRow ? 'bg-violet-50/40 print:bg-white' : ''
                      }`}
                    >
                      <td className="border border-black py-0.5 px-1 align-middle">{row.day}</td>
                      <td className="border border-black py-0.5 px-1.5 text-left text-[10.5px] print:text-[9px] leading-snug whitespace-normal break-words align-middle">
                        {row.notes.join(', ')}
                      </td>
                      <td className="border border-black py-0.5 px-1">
                        {officialReportMeta.fmtStaff(row.hn)}
                      </td>
                      <td className="border border-black py-0.5 px-1 bg-[#ccfbf1]">
                        {officialReportMeta.fmtStaff(row.rn)}
                      </td>
                      <td className="border border-black py-0.5 px-1">
                        {officialReportMeta.fmtStaff(row.pn)}
                      </td>
                      <td className="border border-black py-0.5 px-1">
                        {officialReportMeta.fmtStaff(row.na)}
                      </td>
                      <td className="border border-black py-0.5 px-1">
                        {officialReportMeta.fmtStaff(rowNursing)}
                      </td>
                      <td className="border border-black py-0.5 px-1 bg-[#ccfbf1]">
                        {isPureOffRow ? 'Off' : row.pt}
                      </td>
                    </tr>
                  );
                })}

                {/* Blank Padding Rows for clean official sheet layout */}
                {Array.from({ length: officialReportMeta.blankRowCount }).map((_, idx) => (
                  <tr key={`blank-${idx}`} className="text-center h-[22px] print:h-[18px]">
                    <td className="border border-black py-0.5 px-1">&nbsp;</td>
                    <td className="border border-black py-0.5 px-2"></td>
                    <td className="border border-black py-0.5 px-1"></td>
                    <td className="border border-black py-0.5 px-1 bg-[#ccfbf1]"></td>
                    <td className="border border-black py-0.5 px-1"></td>
                    <td className="border border-black py-0.5 px-1"></td>
                    <td className="border border-black py-0.5 px-1"></td>
                    <td className="border border-black py-0.5 px-1 bg-[#ccfbf1]"></td>
                  </tr>
                ))}

                {/* Bottom Total Row */}
                <tr className="text-center font-bold bg-[#d9f99d]">
                  <td className="border border-black py-1 px-1">รวม</td>
                  <td className="border border-black py-1 px-2"></td>
                  <td className="border border-black py-1 px-1">
                    {officialReportMeta.fmtSum(stats.sumHN)}
                  </td>
                  <td className="border border-black py-1 px-1">
                    {officialReportMeta.fmtSum(stats.sumRN)}
                  </td>
                  <td className="border border-black py-1 px-1">
                    {officialReportMeta.fmtSum(stats.sumPN)}
                  </td>
                  <td className="border border-black py-1 px-1">
                    {officialReportMeta.fmtSum(stats.sumNA)}
                  </td>
                  <td className="border border-black py-1 px-1">
                    {officialReportMeta.fmtSum(stats.totalNursingStaff)}
                  </td>
                  <td className="border border-black py-1 px-1">{stats.totalPt}</td>
                </tr>
              </tbody>
            </table>

            {/* Bottom Calculation Formulas (Steps 1–5 + Skill Mix Ratio) */}
            <div className="mt-3 print:mt-2 space-y-1.5 print:space-y-1 text-[12.5px] print:text-[10.5px] text-black px-1">
              {/* Step 1 */}
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-5 font-medium">1. จำนวนผู้ป่วยเฉลี่ย/วัน</div>
                <div className="col-span-1 text-center">=</div>
                <div className="col-span-3 text-center">PT/Day (B)</div>
                <div className="col-span-1 text-center">=</div>
                <div className="col-span-1 text-right font-bold">{stats.avgPtPerDay.toFixed(2)}</div>
                <div className="col-span-1 text-left pl-1">คน/วัน</div>
              </div>

              {/* Step 2 */}
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-5 font-medium">2. อัตรากำลังทั้งหมดที่ต้องการ</div>
                <div className="col-span-1 text-center">=</div>
                <div className="col-span-3 flex flex-col items-center leading-tight">
                  <span className="border-b border-black px-3 pb-0.5">
                    (1) x {officialReportMeta.nhppdFormulaVal}
                  </span>
                  <span className="pt-0.5">{settings.stdHr}</span>
                </div>
                <div className="col-span-1 text-center">=</div>
                <div className="col-span-1 text-right font-bold">{stats.ftc.toFixed(2)}</div>
                <div className="col-span-1"></div>
              </div>

              {/* Step 3 */}
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-5 font-medium">3. อัตรากำลังที่ต้องการต่อวัน(Outputs)</div>
                <div className="col-span-1 text-center">=</div>
                <div className="col-span-3 flex flex-col items-center leading-tight">
                  <span className="border-b border-black px-2 pb-0.5">
                    (2.) x {settings.annualHr.toLocaleString()} ชม./ปี
                  </span>
                  <span className="pt-0.5">{settings.workDays}วัน x 8 ชม.</span>
                </div>
                <div className="col-span-1 text-center">=</div>
                <div className="col-span-1 text-right font-bold">{stats.output.toFixed(2)}</div>
                <div className="col-span-1 text-left pl-1">คน/วัน</div>
              </div>

              {/* Step 4 */}
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-5 font-medium">4. อัตรากำลังที่จัดเฉลี่ยต่อวัน(Inputs)</div>
                <div className="col-span-1 text-center">=</div>
                <div className="col-span-3 flex flex-col items-center leading-tight">
                  <span className="border-b border-black px-3 pb-0.5">RN+PN+NA</span>
                  <span className="pt-0.5">วันรวม</span>
                </div>
                <div className="col-span-1 text-center">=</div>
                <div className="col-span-1 text-right font-bold">{stats.input.toFixed(2)}</div>
                <div className="col-span-1 text-left pl-1">คน/วัน</div>
              </div>

              {/* Step 5 */}
              <div className="grid grid-cols-12 items-center gap-1">
                <div className="col-span-5 font-medium">5. Productivity</div>
                <div className="col-span-1 text-center">=</div>
                <div className="col-span-3 flex flex-col items-center leading-tight">
                  <span className="border-b border-black px-2 pb-0.5">Outputs(3.) x 100</span>
                  <span className="pt-0.5">Inputs(4.)</span>
                </div>
                <div className="col-span-1 text-center">=</div>
                <div className="col-span-1 text-right font-bold">{stats.productivity.toFixed(2)}</div>
                <div className="col-span-1 text-left pl-1">%</div>
              </div>

              {/* Skill Mix Section */}
              <div className="pt-2 print:pt-1.5 space-y-1.5 print:space-y-1">
                <div className="font-semibold">
                  สัดส่วนการผสมผสานอัตรากำลัง พยาบาล (RN+TN) : NA (PN+NA)
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-3">
                  <span className="w-20">พยาบาล</span>
                  <span>=</span>
                  <div className="inline-flex flex-col items-center leading-tight">
                    <span className="border-b border-black px-2 pb-0.5">
                      รวมชั่วโมงการทำงานของ RN+TN
                    </span>
                    <span className="pt-0.5">รวมชั่วโมงทั้งหมด</span>
                  </div>
                  <span>x 100</span>
                  <span>=</span>
                  <div className="inline-flex flex-col items-center leading-tight min-w-[70px]">
                    <span className="border-b border-black px-2 pb-0.5">
                      {officialReportMeta.fmtSum(officialReportMeta.rnHours)} x 100
                    </span>
                    <span className="pt-0.5">
                      {officialReportMeta.fmtSum(officialReportMeta.totalHours)}
                    </span>
                  </div>
                  <span>=</span>
                  <span className="font-bold min-w-[36px] text-right">
                    {officialReportMeta.fmtPct(officialReportMeta.rnPct)}
                  </span>
                  <span>%</span>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-3">
                  <span className="w-20">Nurse Aid</span>
                  <span>=</span>
                  <div className="inline-flex flex-col items-center leading-tight">
                    <span className="border-b border-black px-2 pb-0.5">
                      รวมชั่วโมงการทำงานของ PN+NA
                    </span>
                    <span className="pt-0.5">รวมชั่วโมงทั้งหมด</span>
                  </div>
                  <span>x 100</span>
                  <span>=</span>
                  <div className="inline-flex flex-col items-center leading-tight min-w-[70px]">
                    <span className="border-b border-black px-2 pb-0.5">
                      {officialReportMeta.fmtSum(officialReportMeta.auxHours)} x 100
                    </span>
                    <span className="pt-0.5">
                      {officialReportMeta.fmtSum(officialReportMeta.totalHours)}
                    </span>
                  </div>
                  <span>=</span>
                  <span className="font-bold min-w-[36px] text-right">
                    {officialReportMeta.fmtPct(officialReportMeta.auxPct)}
                  </span>
                  <span>%</span>
                </div>

                <div className="flex items-center justify-center gap-8 pt-1 font-bold text-[13px] print:text-[11px]">
                  <span>พยาบาล : Nurse Aid =</span>
                  <span>
                    {officialReportMeta.fmtPct(officialReportMeta.rnPct)} &nbsp;&nbsp;:&nbsp;&nbsp;{' '}
                    {officialReportMeta.fmtPct(officialReportMeta.auxPct)}
                  </span>
                </div>
              </div>
            </div>

            {/* Official Formal Monthly Referral Table inside PDF / JPEG sheet */}
            {referralMonthlySummary && (
              <div className="mt-4 print:mt-3 pt-2">
                <table className="w-full table-fixed border-collapse border border-black text-[10.5px] print:text-[9px] leading-tight print-fit-table">
                  <colgroup>
                    <col className="w-[6%]" />
                    <col className="w-[8.5%]" />
                    <col className="w-[8.5%]" />
                    <col className="w-[8.5%]" />
                    <col className="w-[8.5%]" />
                    <col className="w-[8.5%]" />
                    <col className="w-[8.5%]" />
                    <col className="w-[8%]" />
                    <col className="w-[35%]" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th
                        colSpan={9}
                        className="border border-black py-1 px-2 text-center font-bold bg-[#eef2ff]"
                      >
                        ตารางเก็บข้อมูล ห้องรับ - ส่งต่อผู้ป่วย ประจำเดือน {officialReportMeta.monthLabel}
                      </th>
                    </tr>
                    <tr className="text-center font-bold bg-slate-50">
                      <th className="border border-black py-1 px-0.5">วันที่</th>
                      {REFERRAL_ITEM_DEFINITIONS.map(({ key, label }) => (
                        <th key={key} className="border border-black py-1 px-0.5 whitespace-normal break-words">
                          {label}
                        </th>
                      ))}
                      <th className="border border-black py-1 px-0.5 bg-[#fef9c3]">รวม</th>
                      <th className="border border-black py-1 px-1">เหตุผล / ผู้รายงาน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referralMonthlySummary.dailyRows.map((d) => (
                      <tr key={d.id} className="text-center">
                        <td className="border border-black py-0.5 px-1 font-semibold">{d.day}</td>
                        {REFERRAL_ITEM_DEFINITIONS.map(({ key }) => {
                          const cnt = Number(d.ref[key]?.count) || 0;
                          return (
                            <td key={key} className="border border-black py-0.5 px-1">
                              {cnt > 0 ? cnt : '-'}
                            </td>
                          );
                        })}
                        <td className="border border-black py-0.5 px-1 font-bold bg-[#fef9c3]">
                          {d.rowTotal}
                        </td>
                        <td className="border border-black py-0.5 px-1.5 text-left text-[10px] print:text-[8.5px] break-words">
                          {d.reasonText ? `${d.reasonText}${d.reporter ? ` (${d.reporter})` : ''}` : d.reporter || '-'}
                        </td>
                      </tr>
                    ))}
                    <tr className="text-center font-bold bg-[#d9f99d]">
                      <td className="border border-black py-1 px-1">รวม</td>
                      {REFERRAL_ITEM_DEFINITIONS.map(({ key }) => (
                        <td key={key} className="border border-black py-1 px-1">
                          {referralMonthlySummary.totals[key]}
                        </td>
                      ))}
                      <td className="border border-black py-1 px-1">
                        {referralMonthlySummary.grandTotal}
                      </td>
                      <td className="border border-black py-1 px-1.5 text-left text-[10px]">
                        Admit รวม {referralMonthlySummary.totalAdmit} ราย ({referralMonthlySummary.recordCount} เวร)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
