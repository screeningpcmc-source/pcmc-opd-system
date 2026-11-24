import {
  DailyWorkload,
  formatOffDutyStaffSummaryText,
  getEffectiveTotalPt,
  getWorkloadOffDutyReason,
  getWorkloadOffDutyStaff,
  isOffDutyWorkload,
  normalizeWorkloadDateStr,
  normalizeWorkloadShiftStr,
} from '../types';
import { THAI_SHORT_MONTHS } from './thaiDate';

export const OPHTHALMOLOGY_CLINIC_NAME = 'จักษุวิทยา';

export const EYE_OUTTIME_RATES = {
  nurse: 600,
  pn: 380,
  technician: 300,
  serviceWorker: 300,
  na: 380,
  targetDivisor: 150,
} as const;

const THAI_DAY_ABBREVS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;

export type EyeNaMappingMode = 'auto' | 'technician' | 'na380';

export const isOutTimeShift = (shift?: string): boolean => {
  const norm = normalizeWorkloadShiftStr(shift);
  return Boolean(norm) && norm !== 'ALL' && norm !== 'ในเวลา 08:00-16:00';
};

export const isOphthalmologyOutTimeRecord = (w: DailyWorkload): boolean => {
  const normDate = normalizeWorkloadDateStr(w.date);
  if (!normDate) return false;
  if ((w.clinic || '').trim() !== OPHTHALMOLOGY_CLINIC_NAME) return false;
  return isOutTimeShift(w.shift);
};

export const parseShiftInOutTimes = (shift?: string): { timeIn: string; timeOut: string } => {
  const norm = normalizeWorkloadShiftStr(shift);
  if (norm === 'นอกเวลาเย็น 16:00-20:00') return { timeIn: '16:00', timeOut: '20:00' };
  if (norm === 'นอกเวลาวันหยุด 08:00-12:00') return { timeIn: '08:00', timeOut: '12:00' };
  const m = (shift || '').match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (m) return { timeIn: m[1].padStart(5, '0'), timeOut: m[2].padStart(5, '0') };
  return { timeIn: '-', timeOut: '-' };
};

export const getThaiDayAbbrev = (isoDate: string): string => {
  const m = normalizeWorkloadDateStr(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '-';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return THAI_DAY_ABBREVS[d.getDay()] || '-';
};

export const formatEyeShortDate = (isoDate: string): string => {
  const m = normalizeWorkloadDateStr(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const beShort = String((Number(m[1]) + 543) % 100).padStart(2, '0');
  const monthShort = THAI_SHORT_MONTHS[Number(m[2]) - 1] || '-';
  return `${Number(m[3])} ${monthShort} ${beShort}`;
};

export interface EyeOutTimeComputedRow {
  record: DailyWorkload;
  isoDate: string;
  dayAbbrev: string;
  shortDate: string;
  timeIn: string;
  timeOut: string;
  actualPatients: number;
  nurseCount: number;
  pnCount: number;
  rawClerk: number;
  rawNa: number;
  techCount: number;
  extraNaCount: number;
  naCountedAsTech: number;
  swCount: number;
  nurseCost: number;
  pnCost: number;
  techCost: number;
  extraNaCost: number;
  swCost: number;
  totalExpense: number;
  targetPatients: number;
  diffPatients: number;
  productivityPct: number;
  costPerPatient: number;
  isOffDuty: boolean;
  noteText: string;
}

export interface EyeOutTimeSummary {
  actualPatients: number;
  nurseCount: number;
  pnCount: number;
  techCount: number;
  extraNaCount: number;
  swCount: number;
  nurseCost: number;
  pnCost: number;
  techCost: number;
  extraNaCost: number;
  swCost: number;
  totalExpense: number;
  targetPatients: number;
  activeDays: number;
  diffPatients: number;
  productivityPct: number;
  costPerPatient: number;
}

export const computeEyeOutTimeRow = (
  w: DailyWorkload,
  naMode: EyeNaMappingMode
): EyeOutTimeComputedRow => {
  const isoDate = normalizeWorkloadDateStr(w.date);
  const { timeIn, timeOut } = parseShiftInOutTimes(w.shift);
  const offDuty = isOffDutyWorkload(w);
  const offReason = getWorkloadOffDutyReason(w);
  const offStaff = getWorkloadOffDutyStaff(w);

  const nurseCount = offDuty ? 0 : (Number(w.hn) || 0) + (Number(w.rn) || 0);
  const pnCount = offDuty ? 0 : Number(w.pn) || 0;
  const rawClerk = offDuty ? 0 : Number(w.clerk) || 0;
  const rawNa = offDuty ? 0 : Number(w.na !== undefined ? w.na : w.pca) || 0;
  const swCount = offDuty ? 0 : Number(w.serviceWorker) || 0;

  const mapNaToTech = naMode === 'technician' || (naMode === 'auto' && rawClerk === 0 && rawNa > 0);
  const techCount = mapNaToTech ? rawClerk + rawNa : rawClerk;
  const extraNaCount = mapNaToTech ? 0 : rawNa;
  const naCountedAsTech = mapNaToTech ? rawNa : 0;

  const nurseCost = nurseCount * EYE_OUTTIME_RATES.nurse;
  const pnCost = pnCount * EYE_OUTTIME_RATES.pn;
  const techCost = techCount * EYE_OUTTIME_RATES.technician;
  const extraNaCost = extraNaCount * EYE_OUTTIME_RATES.na;
  const swCost = swCount * EYE_OUTTIME_RATES.serviceWorker;
  const totalExpense = nurseCost + pnCost + techCost + extraNaCost + swCost;
  const targetPatients = totalExpense / EYE_OUTTIME_RATES.targetDivisor;
  const actualPatients = offDuty ? 0 : getEffectiveTotalPt(w);
  const diffPatients = actualPatients - targetPatients;
  const productivityPct = targetPatients > 0 ? (actualPatients / targetPatients) * 100 : 0;
  const costPerPatient = actualPatients > 0 ? totalExpense / actualPatients : 0;

  const noteParts: string[] = [];
  if (offDuty) {
    noteParts.push(`Off เวร${offReason ? `: ${offReason}` : ''}`);
  } else if (offStaff.length > 0) {
    noteParts.push(`Off เวรรายวัน: ${formatOffDutyStaffSummaryText(offStaff)}`);
  }
  if ((w.note || '').trim()) {
    noteParts.push(w.note.trim());
  }

  return {
    record: w,
    isoDate,
    dayAbbrev: getThaiDayAbbrev(isoDate),
    shortDate: formatEyeShortDate(isoDate),
    timeIn,
    timeOut,
    actualPatients,
    nurseCount,
    pnCount,
    rawClerk,
    rawNa,
    techCount,
    extraNaCount,
    naCountedAsTech,
    swCount,
    nurseCost,
    pnCost,
    techCost,
    extraNaCost,
    swCost,
    totalExpense,
    targetPatients,
    diffPatients,
    productivityPct,
    costPerPatient,
    isOffDuty: offDuty,
    noteText: noteParts.join(' • '),
  };
};

export const summarizeEyeOutTimeRows = (rows: EyeOutTimeComputedRow[]): EyeOutTimeSummary => {
  const agg = rows.reduce(
    (acc, r) => ({
      actualPatients: acc.actualPatients + r.actualPatients,
      nurseCount: acc.nurseCount + r.nurseCount,
      pnCount: acc.pnCount + r.pnCount,
      techCount: acc.techCount + r.techCount,
      extraNaCount: acc.extraNaCount + r.extraNaCount,
      swCount: acc.swCount + r.swCount,
      nurseCost: acc.nurseCost + r.nurseCost,
      pnCost: acc.pnCost + r.pnCost,
      techCost: acc.techCost + r.techCost,
      extraNaCost: acc.extraNaCost + r.extraNaCost,
      swCost: acc.swCost + r.swCost,
      totalExpense: acc.totalExpense + r.totalExpense,
      targetPatients: acc.targetPatients + r.targetPatients,
      activeDays: acc.activeDays + (r.isOffDuty ? 0 : 1),
    }),
    {
      actualPatients: 0,
      nurseCount: 0,
      pnCount: 0,
      techCount: 0,
      extraNaCount: 0,
      swCount: 0,
      nurseCost: 0,
      pnCost: 0,
      techCost: 0,
      extraNaCost: 0,
      swCost: 0,
      totalExpense: 0,
      targetPatients: 0,
      activeDays: 0,
    }
  );

  return {
    ...agg,
    diffPatients: agg.actualPatients - agg.targetPatients,
    productivityPct: agg.targetPatients > 0 ? (agg.actualPatients / agg.targetPatients) * 100 : 0,
    costPerPatient: agg.actualPatients > 0 ? agg.totalExpense / agg.actualPatients : 0,
  };
};
