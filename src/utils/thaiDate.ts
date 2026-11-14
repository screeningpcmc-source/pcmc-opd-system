export const THAI_WEEKDAYS = [
  'อาทิตย์',
  'จันทร์',
  'อังคาร',
  'พุธ',
  'พฤหัสบดี',
  'ศุกร์',
  'เสาร์',
] as const;

export const THAI_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

function parseIsoDateParts(isoDate: string): { year: number; month: number; day: number } | null {
  const match = (isoDate || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/**
 * Formats YYYY-MM-DD as: วันเสาร์ที่ 14 พฤศจิกายน พ.ศ. 2569
 */
export function formatThaiFullDate(isoDate: string): string {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) return isoDate;
  const d = new Date(parts.year, parts.month - 1, parts.day);
  const weekday = THAI_WEEKDAYS[d.getDay()];
  const monthName = THAI_MONTHS[parts.month - 1];
  const beYear = parts.year + 543;
  return `วัน${weekday}ที่ ${parts.day} ${monthName} พ.ศ. ${beYear}`;
}

/**
 * Formats YYYY-MM-DD as: 1 ธันวาคม 2569
 */
export function formatThaiShortDate(isoDate: string): string {
  const parts = parseIsoDateParts(isoDate);
  if (!parts) return isoDate;
  const monthName = THAI_MONTHS[parts.month - 1];
  const beYear = parts.year + 543;
  return `${parts.day} ${monthName} ${beYear}`;
}

/**
 * Formats leave date range as:
 * - Single day: วันที่ 1 ธันวาคม 2569
 * - Same year range: ตั้งแต่วันที่ 1 ธันวาคม ถึง 5 ธันวาคม 2569
 * - Cross year range: ตั้งแต่วันที่ 30 ธันวาคม 2569 ถึง 2 มกราคม 2570
 */
export function formatThaiLeaveRange(startIso: string, endIso: string): string {
  const s = parseIsoDateParts(startIso);
  const e = parseIsoDateParts(endIso || startIso);
  if (!s) return startIso;
  if (!e || startIso === endIso) {
    return `วันที่ ${s.day} ${THAI_MONTHS[s.month - 1]} ${s.year + 543}`;
  }
  const sMonth = THAI_MONTHS[s.month - 1];
  const eMonth = THAI_MONTHS[e.month - 1];
  const sBe = s.year + 543;
  const eBe = e.year + 543;
  if (sBe === eBe) {
    return `ตั้งแต่วันที่ ${s.day} ${sMonth} ถึง ${e.day} ${eMonth} ${eBe}`;
  }
  return `ตั้งแต่วันที่ ${s.day} ${sMonth} ${sBe} ถึง ${e.day} ${eMonth} ${eBe}`;
}

/**
 * Splits full Thai name (e.g. "น.ส.ประภัสสร พันธุ์วา") into { firstName, lastName }
 */
export function splitThaiName(fullName: string): { firstName: string; lastName: string } {
  const tokens = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { firstName: '-', lastName: '-' };
  if (tokens.length === 1) return { firstName: tokens[0], lastName: '-' };
  return {
    firstName: tokens.slice(0, -1).join(' '),
    lastName: tokens[tokens.length - 1],
  };
}

export const THAI_SHORT_MONTHS = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

/**
 * Formats ISO timestamp as: 14 พ.ย. 2569 เวลา 15:42 น.
 */
export function formatThaiDateTime(isoTimestamp: string): string {
  if (!isoTimestamp) return '-';
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return isoTimestamp;
  const day = d.getDate();
  const month = THAI_SHORT_MONTHS[d.getMonth()];
  const beYear = d.getFullYear() + 543;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${beYear} เวลา ${hh}:${mm} น.`;
}
