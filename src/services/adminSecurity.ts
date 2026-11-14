import { AdminPinEntry, SystemSettings } from '../types';

/**
 * Admin PIN Verification Utility
 * ตรวจสอบรหัสผ่านผู้ดูแลระบบโดยไม่ฝังรหัสผ่านจริงไว้ในซอร์สโค้ด
 * ลำดับการตรวจสอบ:
 * 1. รหัสหลัก (ค่าเริ่มต้น 4217 = หัวหน้าพยาบาล หรือรหัสที่ตั้งเองในตั้งค่า / VITE_ADMIN_PIN)
 * 2. รหัสแอดมินเพิ่มเติม 3 รหัส พร้อมระบุชื่อเจ้าของรหัส
 */

export const DEFAULT_PRIMARY_ADMIN_OWNER = 'หัวหน้าพยาบาล';

const DEFAULT_PIN_SHA256 = '7ec7bbd3677bee60f1e0c58b2967299b9985afad73acfde38966d76f30cc4f88';

export const DEFAULT_ADDITIONAL_ADMIN_SLOTS: {
  id: string;
  defaultOwnerName: string;
  defaultSha256: string;
}[] = [
  {
    id: 'admin-2',
    defaultOwnerName: 'รองหัวหน้าหน่วย OPD (แอดมิน 2)',
    defaultSha256: '89c1baf80810ed35b8cc4ab4bb30da6136d5ad7d4c0442988ed519e0dd68fc5e',
  },
  {
    id: 'admin-3',
    defaultOwnerName: 'พยาบาลผู้ดูแลระบบข้อมูล OPD (แอดมิน 3)',
    defaultSha256: '6a0a323dee59cd417b5071ea2a375702d16a9c40afe1f72ac8bf5d605b7c2c9d',
  },
  {
    id: 'admin-4',
    defaultOwnerName: 'พยาบาลผู้ดูแลระบบข้อมูล OPD (แอดมิน 4)',
    defaultSha256: 'd81c15506dffe8152eec8216c52eb7b524fa7dc78010196d3e71c489f75001d',
  },
];

export function buildDefaultAdditionalAdminPins(): AdminPinEntry[] {
  return DEFAULT_ADDITIONAL_ADMIN_SLOTS.map((s) => ({
    id: s.id,
    ownerName: s.defaultOwnerName,
    pin: '',
  }));
}

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

export interface AdminVerifyResult {
  valid: boolean;
  ownerName: string;
  isPrimary: boolean;
}

export function verifyAdminPinWithOwner(
  enteredPin: string,
  settings?: Pick<SystemSettings, 'adminPin' | 'primaryAdminOwner' | 'additionalAdminPins'>
): AdminVerifyResult {
  const normalized = enteredPin.trim();
  if (!normalized) {
    return { valid: false, ownerName: '', isPrimary: false };
  }

  const primaryOwner = (settings?.primaryAdminOwner || '').trim() || DEFAULT_PRIMARY_ADMIN_OWNER;
  const customPin = (settings?.adminPin || '').trim();
  const envPin = String(import.meta.env.VITE_ADMIN_PIN || '').trim();
  const enteredDigest = sha256Hex(normalized);

  // 1. Check Primary Admin PIN
  if (customPin) {
    if (normalized === customPin) {
      return { valid: true, ownerName: primaryOwner, isPrimary: true };
    }
  } else if (envPin) {
    if (normalized === envPin) {
      return { valid: true, ownerName: primaryOwner, isPrimary: true };
    }
  } else if (enteredDigest === DEFAULT_PIN_SHA256) {
    return { valid: true, ownerName: primaryOwner, isPrimary: true };
  }

  // 2. Check 3 Additional Admin PIN slots (custom configured or default slot digest)
  const configuredSlots = settings?.additionalAdminPins || [];
  for (let i = 0; i < DEFAULT_ADDITIONAL_ADMIN_SLOTS.length; i++) {
    const defSlot = DEFAULT_ADDITIONAL_ADMIN_SLOTS[i];
    const userSlot = configuredSlots.find((s) => s.id === defSlot.id) || configuredSlots[i];
    const ownerName = (userSlot?.ownerName || '').trim() || defSlot.defaultOwnerName;
    const customSlotPin = (userSlot?.pin || '').trim();

    if (customSlotPin) {
      if (normalized === customSlotPin) {
        return { valid: true, ownerName, isPrimary: false };
      }
    } else if (enteredDigest === defSlot.defaultSha256) {
      return { valid: true, ownerName, isPrimary: false };
    }
  }

  return { valid: false, ownerName: '', isPrimary: false };
}

export function verifyAdminPin(
  enteredPin: string,
  customStoredPin?: string,
  settings?: Pick<SystemSettings, 'adminPin' | 'primaryAdminOwner' | 'additionalAdminPins'>
): boolean {
  return verifyAdminPinWithOwner(enteredPin, settings ?? { adminPin: customStoredPin }).valid;
}
