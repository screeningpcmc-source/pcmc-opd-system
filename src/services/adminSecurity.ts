/**
 * Admin PIN Verification Utility
 * ตรวจสอบรหัสผ่านผู้ดูแลระบบโดยไม่ฝังรหัสผ่านจริงไว้ในซอร์สโค้ด
 * ลำดับการตรวจสอบ:
 * 1. รหัสที่ผู้ดูแลระบบตั้งค่าเองในเครื่อง (localStorage settings.adminPin)
 * 2. ค่าจาก Environment Variable (VITE_ADMIN_PIN ใน .env.local หรือ GitHub Secrets)
 * 3. ค่า Digest SHA-256 มาตรฐานของระบบ
 */

const DEFAULT_PIN_SHA256 = '7ec7bbd3677bee60f1e0c58b2967299b9985afad73acfde38966d76f30cc4f88';

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function sha256Hex(ascii: string): string {
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';

  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;

  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: Record<number, boolean> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while ((ascii.length % 64) - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);

    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];

      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);

      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));

      hash.unshift((temp1 + temp2) | 0);
      hash[4] = (hash[4] + temp1) | 0;
      hash.pop();
    }

    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

export function verifyAdminPin(enteredPin: string, customStoredPin?: string): boolean {
  const normalized = enteredPin.trim();
  if (!normalized) return false;

  const customPin = (customStoredPin || '').trim();
  if (customPin) {
    return normalized === customPin;
  }

  const envPin = String(import.meta.env.VITE_ADMIN_PIN || '').trim();
  if (envPin) {
    return normalized === envPin;
  }

  return sha256Hex(normalized) === DEFAULT_PIN_SHA256;
}
