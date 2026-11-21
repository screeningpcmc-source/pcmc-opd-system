import { CustomHoliday } from '../types';

interface FixedHolidayDef {
  monthDay: string; // MM-DD
  name: string;
}

const THAI_FIXED_GOVERNMENT_HOLIDAYS: FixedHolidayDef[] = [
  { monthDay: '01-01', name: 'วันขึ้นปีใหม่' },
  { monthDay: '04-06', name: 'วันพระบาทสมเด็จพระพุทธยอดฟ้าจุฬาโลกมหาราช และวันที่ระลึกมหาจักรีบรมราชวงศ์' },
  { monthDay: '04-13', name: 'วันสงกรานต์' },
  { monthDay: '04-14', name: 'วันสงกรานต์' },
  { monthDay: '04-15', name: 'วันสงกรานต์' },
  { monthDay: '05-04', name: 'วันฉัตรมงคล' },
  { monthDay: '06-03', name: 'วันเฉลิมพระชนมพรรษา สมเด็จพระนางเจ้าฯ พระบรมราชินี' },
  { monthDay: '07-28', name: 'วันเฉลิมพระชนมพรรษา พระบาทสมเด็จพระเจ้าอยู่หัว' },
  { monthDay: '08-12', name: 'วันเฉลิมพระชนมพรรษา สมเด็จพระบรมราชชนนีพันปีหลวง และวันแม่แห่งชาติ' },
  { monthDay: '10-13', name: 'วันนวมินทรมหาราช' },
  { monthDay: '10-23', name: 'วันปิยมหาราช' },
  { monthDay: '12-05', name: 'วันคล้ายวันพระบรมราชสมภพ ร.9 / วันชาติ / วันพ่อแห่งชาติ' },
  { monthDay: '12-10', name: 'วันรัฐธรรมนูญ' },
  { monthDay: '12-31', name: 'วันสิ้นปี' },
];

// Official Thai lunar government holidays & Royal Ploughing Ceremony dates (CE year -> list)
const THAI_LUNAR_HOLIDAYS_BY_YEAR: Record<number, { date: string; name: string; noSubstitute?: boolean }[]> = {
  2024: [
    { date: '2024-02-24', name: 'วันมาฆบูชา' },
    { date: '2024-05-10', name: 'วันพืชมงคล', noSubstitute: true },
    { date: '2024-05-22', name: 'วันวิสาขบูชา' },
    { date: '2024-07-20', name: 'วันอาสาฬหบูชา' },
    { date: '2024-07-21', name: 'วันเข้าพรรษา' },
  ],
  2025: [
    { date: '2025-02-12', name: 'วันมาฆบูชา' },
    { date: '2025-05-09', name: 'วันพืชมงคล', noSubstitute: true },
    { date: '2025-05-11', name: 'วันวิสาขบูชา' },
    { date: '2025-07-10', name: 'วันอาสาฬหบูชา' },
    { date: '2025-07-11', name: 'วันเข้าพรรษา' },
  ],
  2026: [
    { date: '2026-03-03', name: 'วันมาฆบูชา' },
    { date: '2026-05-13', name: 'วันพืชมงคล', noSubstitute: true },
    { date: '2026-05-31', name: 'วันวิสาขบูชา' },
    { date: '2026-07-29', name: 'วันอาสาฬหบูชา' },
    { date: '2026-07-30', name: 'วันเข้าพรรษา' },
  ],
  2027: [
    { date: '2027-02-21', name: 'วันมาฆบูชา' },
    { date: '2027-05-20', name: 'วันวิสาขบูชา' },
    { date: '2027-07-18', name: 'วันอาสาฬหบูชา' },
    { date: '2027-07-19', name: 'วันเข้าพรรษา' },
  ],
  2028: [
    { date: '2028-02-10', name: 'วันมาฆบูชา' },
    { date: '2028-05-08', name: 'วันวิสาขบูชา' },
    { date: '2028-07-06', name: 'วันอาสาฬหบูชา' },
    { date: '2028-07-07', name: 'วันเข้าพรรษา' },
  ],
};

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoLocal(iso: string): Date | null {
  const match = (iso || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return new Date(y, m - 1, d);
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  return next;
}

/**
 * Returns a map of YYYY-MM-DD -> { name, isCustom } for all Thai public holidays
 * (including weekend substitution days) plus hospital-configured custom holidays in a given CE year.
 */
export function getHolidaysForYear(
  year: number,
  customHolidays: CustomHoliday[] = []
): Map<string, { name: string; isCustom: boolean }> {
  const map = new Map<string, { name: string; isCustom: boolean }>();
  const pendingSubstitutes: { baseDate: Date; name: string }[] = [];

  // 1. Register fixed annual holidays
  for (const item of THAI_FIXED_GOVERNMENT_HOLIDAYS) {
    const iso = `${year}-${item.monthDay}`;
    const d = parseIsoLocal(iso);
    if (!d) continue;
    map.set(iso, { name: item.name, isCustom: false });
    const dow = d.getDay();
    if (dow === 0 || dow === 6) {
      pendingSubstitutes.push({ baseDate: d, name: `วันหยุดชดเชย${item.name}` });
    }
  }

  // Check if previous year's Dec 31 fell on Sat/Sun and its substitute spills into January of this year
  const prevDec31 = new Date(year - 1, 11, 31);
  if (prevDec31.getDay() === 0 || prevDec31.getDay() === 6) {
    pendingSubstitutes.push({ baseDate: prevDec31, name: 'วันหยุดชดเชยวันสิ้นปี' });
  }

  // 2. Register lunar holidays for the year
  const lunarList = THAI_LUNAR_HOLIDAYS_BY_YEAR[year] || [];
  for (const item of lunarList) {
    const d = parseIsoLocal(item.date);
    if (!d) continue;
    map.set(item.date, { name: item.name, isCustom: false });
    const dow = d.getDay();
    if (!item.noSubstitute && (dow === 0 || dow === 6)) {
      pendingSubstitutes.push({ baseDate: d, name: `วันหยุดชดเชย${item.name}` });
    }
  }

  // 3. Apply Thai substitution rule: shift to next available Mon-Fri not already a holiday
  for (const sub of pendingSubstitutes) {
    let candidate = addDays(sub.baseDate, 1);
    let guard = 0;
    while (guard < 14) {
      const dow = candidate.getDay();
      const iso = toIsoDate(candidate);
      if (dow !== 0 && dow !== 6 && !map.has(iso)) {
        if (candidate.getFullYear() === year) {
          map.set(iso, { name: sub.name, isCustom: false });
        }
        break;
      }
      candidate = addDays(candidate, 1);
      guard++;
    }
  }

  // 4. Overlay custom hospital holidays
  for (const ch of customHolidays) {
    if (!ch.date) continue;
    const d = parseIsoLocal(ch.date);
    if (!d || d.getFullYear() !== year) continue;
    const iso = toIsoDate(d);
    map.set(iso, { name: ch.name || 'วันหยุดพิเศษที่โรงพยาบาลกำหนด', isCustom: true });
  }

  return map;
}

export interface GovernmentLeaveStats {
  workDays: number;
  totalCalendarDays: number;
  weekendCount: number;
  holidaysInRange: { date: string; name: string; isCustom: boolean }[];
}

/**
 * Calculates official government working days between startIso and endIso (inclusive),
 * excluding Saturdays, Sundays, Thai public holidays (+ substitutes), and custom hospital holidays.
 */
export function calculateGovernmentLeaveStats(
  startIso: string,
  endIso: string,
  customHolidays: CustomHoliday[] = []
): GovernmentLeaveStats {
  const start = parseIsoLocal(startIso);
  const end = parseIsoLocal(endIso || startIso);
  if (!start || !end) {
    return { workDays: 1, totalCalendarDays: 1, weekendCount: 0, holidaysInRange: [] };
  }

  const from = start <= end ? start : end;
  const to = start <= end ? end : start;

  // Preload holiday maps for spanned years
  const yearMaps = new Map<number, Map<string, { name: string; isCustom: boolean }>>();
  for (let y = from.getFullYear(); y <= to.getFullYear(); y++) {
    yearMaps.set(y, getHolidaysForYear(y, customHolidays));
  }

  let workDays = 0;
  let totalCalendarDays = 0;
  let weekendCount = 0;
  const holidaysInRange: { date: string; name: string; isCustom: boolean }[] = [];

  let cursor = from;
  let safety = 0;
  while (cursor <= to && safety < 1500) {
    totalCalendarDays++;
    const dow = cursor.getDay();
    const iso = toIsoDate(cursor);
    const holidayInfo = yearMaps.get(cursor.getFullYear())?.get(iso);

    if (dow === 0 || dow === 6) {
      weekendCount++;
    } else if (holidayInfo) {
      holidaysInRange.push({
        date: iso,
        name: holidayInfo.name,
        isCustom: holidayInfo.isCustom,
      });
    } else {
      workDays++;
    }

    cursor = addDays(cursor, 1);
    safety++;
  }

  return { workDays, totalCalendarDays, weekendCount, holidaysInRange };
}

export function countGovernmentWorkdaysInRange(
  startIso: string,
  endIso: string,
  customHolidays: CustomHoliday[] = []
): number {
  return calculateGovernmentLeaveStats(startIso, endIso, customHolidays).workDays;
}

export function isWeekendOrThaiHoliday(
  isoDate: string,
  customHolidays: CustomHoliday[] = []
): boolean {
  const d = parseIsoLocal(isoDate);
  if (!d) return false;
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return true;
  const holidayMap = getHolidaysForYear(d.getFullYear(), customHolidays);
  return holidayMap.has(toIsoDate(d));
}

export function doesDateMatchLineDayRule(
  isoDate: string,
  dayRule: 'ALL_DAYS' | 'WORKDAYS_MON_FRI' | 'WEEKENDS_AND_HOLIDAYS' = 'ALL_DAYS',
  customHolidays: CustomHoliday[] = []
): boolean {
  if (dayRule === 'ALL_DAYS') return true;
  const isHol = isWeekendOrThaiHoliday(isoDate, customHolidays);
  return dayRule === 'WEEKENDS_AND_HOLIDAYS' ? isHol : !isHol;
}
