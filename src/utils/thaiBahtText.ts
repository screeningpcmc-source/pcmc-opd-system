/**
 * แปลงจำนวนเงินตัวเลขเป็นคำอ่านภาษาไทยมาตรฐานทางราชการ (BAHTTEXT)
 * เช่น 42042.50 -> "สี่หมื่นสองพันสี่สิบสองบาทห้าสิบสตางค์"
 */
const THAI_NUMBERS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

function readThaiIntegerUnderMillion(intStr: string): string {
  const clean = intStr.replace(/^0+/, '') || '0';
  if (clean === '0') return '';
  let out = '';
  const len = clean.length;
  for (let i = 0; i < len; i++) {
    const digit = Number(clean[i]);
    const pos = len - i - 1;
    if (digit === 0) continue;
    if (pos === 0 && digit === 1 && len > 1) {
      out += 'เอ็ด';
    } else if (pos === 1 && digit === 2) {
      out += 'ยี่สิบ';
    } else if (pos === 1 && digit === 1) {
      out += 'สิบ';
    } else {
      out += THAI_NUMBERS[digit] + THAI_POSITIONS[pos];
    }
  }
  return out;
}

function readThaiInteger(intStr: string): string {
  const clean = intStr.replace(/^0+/, '') || '0';
  if (clean === '0') return 'ศูนย์';
  if (clean.length <= 6) {
    return readThaiIntegerUnderMillion(clean);
  }
  const head = clean.slice(0, clean.length - 6);
  const tail = clean.slice(clean.length - 6);
  const headText = readThaiInteger(head);
  const tailText = readThaiIntegerUnderMillion(tail);
  return `${headText}ล้าน${tailText}`;
}

export function numberToThaiBahtText(amount: number): string {
  if (!Number.isFinite(amount)) return 'ศูนย์บาทถ้วน';
  const isNegative = amount < 0;
  const rounded = Math.round(Math.abs(amount) * 100);
  const intPart = Math.floor(rounded / 100);
  const satangPart = rounded % 100;

  if (intPart === 0 && satangPart === 0) {
    return 'ศูนย์บาทถ้วน';
  }

  let result = isNegative ? 'ลบ' : '';
  if (intPart > 0) {
    result += `${readThaiInteger(String(intPart))}บาท`;
  }
  if (satangPart === 0) {
    result += 'ถ้วน';
  } else {
    result += `${readThaiIntegerUnderMillion(String(satangPart))}สตางค์`;
  }
  return result;
}
