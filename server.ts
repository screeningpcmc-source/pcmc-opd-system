import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_LINE_GROUP_ID = 'C21630721218bccf814848fcf793e1746';
const DEFAULT_LINE_AUTO_TIME = '15:55';
const DEFAULT_LINE_AUTO_SHIFT = 'ในเวลา 08:00-16:00';

interface ServerLineSchedule {
  id: string;
  label?: string;
  enabled: boolean;
  time: string;
  dayRule: 'ALL_DAYS' | 'WORKDAYS_MON_FRI' | 'WEEKENDS_AND_HOLIDAYS';
  reportDayMode: 'YESTERDAY' | 'TODAY' | 'LATEST_WITH_DATA';
  shift: string;
  sendAsImage?: boolean;
}

interface ServerLineTargetGroup {
  id: string;
  name?: string;
  enabled: boolean;
}

type ServerLineSendFormat = 'BOTH' | 'IMAGE_ONLY' | 'TEXT_ONLY';

interface LineServerAutomationState {
  enabled: boolean;
  time: string;
  reportDayMode: 'YESTERDAY' | 'TODAY' | 'LATEST_WITH_DATA';
  shift: string;
  targetId: string;
  targetGroups: ServerLineTargetGroup[];
  schedules: ServerLineSchedule[];
  sendAsImage: boolean;
  sendFormat: ServerLineSendFormat;
  gasUrl: string;
  gasAdminPin: string;
  lastSentAt: string;
  lastStatus: string;
  lastTriggeredBangkokKeys: Record<string, boolean>;
  detectedGroupId: string;
  detectedGroupName: string;
  boobyOwnerName: string;
  boobyOwnerUserId: string;
  boobyGroupMentionOnly: boolean;
}

interface LineMetadataCache {
  fetchedAt: number;
  targetId: string;
  tokenVerified: boolean;
  tokenError: string;
  botName: string;
  groupName: string;
  groupVerified: boolean;
  groupError: string;
  quotaType?: string;
  quotaLimit?: number;
  quotaUsed?: number;
  quotaRemaining?: number;
}

const serverLineState: LineServerAutomationState = {
  enabled: false,
  time: DEFAULT_LINE_AUTO_TIME,
  reportDayMode: 'TODAY',
  shift: DEFAULT_LINE_AUTO_SHIFT,
  targetId: (process.env.LINE_GROUP_ID || DEFAULT_LINE_GROUP_ID).trim(),
  targetGroups: [
    {
      id: (process.env.LINE_GROUP_ID || DEFAULT_LINE_GROUP_ID).trim(),
      name: 'หัวหน้าห้องตรวจ OPD',
      enabled: true,
    },
  ],
  schedules: [
    {
      id: 'sch-regular',
      label: 'ในเวลาราชการ (จันทร์–ศุกร์)',
      enabled: true,
      time: '15:55',
      dayRule: 'WORKDAYS_MON_FRI',
      reportDayMode: 'TODAY',
      shift: 'ในเวลา 08:00-16:00',
      sendAsImage: true,
    },
    {
      id: 'sch-ot-weekday',
      label: 'นอกเวลา (จันทร์–ศุกร์)',
      enabled: true,
      time: '20:00',
      dayRule: 'WORKDAYS_MON_FRI',
      reportDayMode: 'TODAY',
      shift: 'นอกเวลาเย็น 16:00-20:00',
      sendAsImage: true,
    },
    {
      id: 'sch-ot-holiday',
      label: 'นอกเวลา (เสาร์–อาทิตย์ / นักขัตฤกษ์)',
      enabled: true,
      time: '12:30',
      dayRule: 'WEEKENDS_AND_HOLIDAYS',
      reportDayMode: 'TODAY',
      shift: 'นอกเวลาวันหยุด 08:00-12:00',
      sendAsImage: true,
    },
  ],
  sendAsImage: true,
  sendFormat: 'BOTH',
  gasUrl: '',
  gasAdminPin: (process.env.ADMIN_PIN || '').trim(),
  lastSentAt: '',
  lastStatus: '',
  lastTriggeredBangkokKeys: {},
  detectedGroupId: '',
  detectedGroupName: '',
  boobyOwnerName: 'คุณทรงยศ',
  boobyOwnerUserId: '',
  boobyGroupMentionOnly: true,
};

let lineMetaCache: LineMetadataCache | null = null;

function readEnvOverride(key: string): string {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
      if (parsed[key] && parsed[key].trim()) {
        return parsed[key].trim();
      }
    }
  } catch {
    // Fallback to process.env below
  }
  return (process.env[key] || '').trim();
}

function getLineAccessToken(): string {
  return readEnvOverride('LINE_CHANNEL_ACCESS_TOKEN');
}

function getDefaultGroupId(): string {
  return readEnvOverride('LINE_GROUP_ID') || DEFAULT_LINE_GROUP_ID;
}

function getGeminiAiClient(): GoogleGenAI | null {
  const apiKey = readEnvOverride('GEMINI_API_KEY');
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

async function generateBoobyAiText(systemInstruction: string, prompt: string): Promise<string> {
  const ai = getGeminiAiClient();
  if (!ai) return '';
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });
    return String(response.text || '').trim();
  } catch {
    return '';
  }
}

function getBangkokDateParts(date = new Date()): {
  ymd: string;
  hm: string;
  timestamp: string;
} {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const hm = `${hour}:${parts.minute}`;
  return {
    ymd,
    hm,
    timestamp: `${ymd} ${hm}:${parts.second}`,
  };
}

function computeNextRunAtLabel(timeStr: string): string {
  const m = (timeStr || DEFAULT_LINE_AUTO_TIME).trim().match(/^(\d{1,2}):(\d{1,2})$/);
  const hh = m ? Math.min(23, Math.max(0, Number(m[1]))) : 15;
  const mm = m ? Math.min(59, Math.max(0, Number(m[2]))) : 59;
  const formatted = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const bkk = getBangkokDateParts();
  if (bkk.hm < formatted) {
    return `${bkk.ymd} ${formatted}:00`;
  }
  const [y, mo, d] = bkk.ymd.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, mo - 1, d + 1));
  const ty = tomorrow.getUTCFullYear();
  const tm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
  const td = String(tomorrow.getUTCDate()).padStart(2, '0');
  return `${ty}-${tm}-${td} ${formatted}:00`;
}

async function fetchLineMetadata(targetId: string, forceRefresh = false): Promise<LineMetadataCache> {
  const token = getLineAccessToken();
  const resolvedTarget = (targetId || getDefaultGroupId()).trim();

  if (
    !forceRefresh &&
    lineMetaCache &&
    lineMetaCache.tokenVerified &&
    lineMetaCache.targetId === resolvedTarget &&
    Date.now() - lineMetaCache.fetchedAt < 60_000
  ) {
    return lineMetaCache;
  }

  const result: LineMetadataCache = {
    fetchedAt: Date.now(),
    targetId: resolvedTarget,
    tokenVerified: false,
    tokenError: '',
    botName: '',
    groupName: '',
    groupVerified: false,
    groupError: '',
  };

  if (!token) {
    result.tokenError = 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN บนเซิร์ฟเวอร์ (.env)';
    result.groupError = result.tokenError;
    lineMetaCache = result;
    return result;
  }

  try {
    const botRes = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (botRes.ok) {
      const botData = (await botRes.json()) as { displayName?: string };
      result.tokenVerified = true;
      result.botName = String(botData.displayName || '').trim();
    } else {
      const errTxt = await botRes.text();
      result.tokenVerified = false;
      result.tokenError =
        botRes.status === 401
          ? 'LINE Channel Access Token ไม่ถูกต้อง หมดอายุ หรือถูกกด Reissue ใหม่ใน LINE Developers Console (HTTP 401)'
          : `Bot Token ตรวจสอบไม่ผ่าน (HTTP ${botRes.status}): ${errTxt}`;
      result.groupError = result.tokenError;
    }
  } catch (err) {
    result.tokenError = String(err instanceof Error ? err.message : err);
    result.groupError = result.tokenError;
  }

  if (result.tokenVerified) {
    try {
      const [grpRes, quotaRes, consRes] = await Promise.all([
        resolvedTarget && resolvedTarget.startsWith('C')
          ? fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(resolvedTarget)}/summary`, {
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => null)
          : Promise.resolve(null),
        fetch('https://api.line.me/v2/bot/message/quota', {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null),
        fetch('https://api.line.me/v2/bot/message/quota/consumption', {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null),
      ]);

      if (grpRes) {
        if (grpRes.ok) {
          const grpData = (await grpRes.json()) as { groupName?: string };
          result.groupName = String(grpData.groupName || '').trim();
          result.groupVerified = true;
        } else {
          const errBody = await grpRes.text();
          result.groupVerified = false;
          result.groupError =
            grpRes.status === 404
              ? 'ไม่พบกลุ่มหรือบอทยังไม่ได้เข้ากลุ่ม LINE นี้'
              : `LINE Group API HTTP ${grpRes.status}: ${errBody}`;
        }
      }

      if (quotaRes && quotaRes.ok) {
        const qData = (await quotaRes.json()) as { type?: string; value?: number };
        result.quotaType = String(qData.type || '');
        if (typeof qData.value === 'number' && Number.isFinite(qData.value)) {
          result.quotaLimit = qData.value;
        }
      }
      if (consRes && consRes.ok) {
        const cData = (await consRes.json()) as { totalUsage?: number };
        if (typeof cData.totalUsage === 'number' && Number.isFinite(cData.totalUsage)) {
          result.quotaUsed = cData.totalUsage;
        }
      }
      if (typeof result.quotaLimit === 'number' && typeof result.quotaUsed === 'number') {
        result.quotaRemaining = Math.max(0, result.quotaLimit - result.quotaUsed);
      }
    } catch (err) {
      result.groupVerified = false;
      result.groupError = String(err instanceof Error ? err.message : err);
    }
  }

  lineMetaCache = result;
  return result;
}

function normalizeTimeServer(raw?: string, fallback = DEFAULT_LINE_AUTO_TIME): string {
  const s = String(raw || '').trim().replace(/^'+/, '');
  if (!s) return fallback;
  const m = s.match(/^(\d{1,2}):(\d{1,2})(?::\d{1,2})?$/);
  if (m) {
    const hh = Math.min(23, Math.max(0, Number(m[1])));
    const mm = Math.min(59, Math.max(0, Number(m[2])));
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return fallback;
}

function normalizeDateYmdServer(raw: unknown): string {
  const s = String(raw || '').trim();
  if (!s) return '';
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    let y = Number(iso[1]);
    if (y >= 2400) y -= 543;
    return `${y}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`;
  }
  const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (slash) {
    const d = Number(slash[1]);
    const m = Number(slash[2]);
    let yr = Number(slash[3]);
    if (yr < 100) yr += yr >= 55 ? 2500 - 543 : 2000;
    else if (yr >= 2400) yr -= 543;
    return `${yr}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return s;
}

function normalizeShiftStrServer(raw: unknown): string {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

function canonicalLineScheduleKeyServer(scheduleId?: string, time?: string, shift?: string): string {
  const idClean = String(scheduleId || '').trim().toLowerCase();
  if (idClean === 'sch-regular' || idClean === 'workday_reg') return 'WORKDAY_REG';
  if (idClean === 'sch-ot-weekday' || idClean === 'workday_evening') return 'WORKDAY_EVENING';
  if (idClean === 'sch-ot-holiday' || idClean === 'holiday_morning') return 'HOLIDAY_MORNING';
  const normTime = time ? normalizeTimeServer(time, '') : '';
  const normShift = normalizeShiftStrServer(shift);
  if (normTime && normShift) return `${normTime}|${normShift}`;
  if (idClean) return idClean.toUpperCase();
  return 'DEFAULT';
}

const THAI_FIXED_HOLIDAYS_MD = new Set([
  '01-01', '04-06', '04-13', '04-14', '04-15', '05-04', '06-03',
  '07-28', '08-12', '10-13', '10-23', '12-05', '12-10', '12-31',
]);
const THAI_LUNAR_HOLIDAYS_YMD = new Set([
  '2025-02-12', '2025-05-09', '2025-05-11', '2025-07-10', '2025-07-11',
  '2026-03-03', '2026-05-13', '2026-05-31', '2026-07-29', '2026-07-30',
  '2027-02-21', '2027-05-20', '2027-07-18', '2027-07-19',
  '2028-02-10', '2028-05-08', '2028-07-06', '2028-07-07',
]);

function matchesDayRuleServer(
  ymd: string,
  dayRule: 'ALL_DAYS' | 'WORKDAYS_MON_FRI' | 'WEEKENDS_AND_HOLIDAYS'
): boolean {
  if (dayRule === 'ALL_DAYS') return true;
  const parts = ymd.split('-').map(Number);
  if (parts.length !== 3) return true;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const dow = dt.getUTCDay();
  const md = `${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
  const isWeekendOrHol =
    dow === 0 || dow === 6 || THAI_FIXED_HOLIDAYS_MD.has(md) || THAI_LUNAR_HOLIDAYS_YMD.has(ymd);
  return dayRule === 'WEEKENDS_AND_HOLIDAYS' ? isWeekendOrHol : !isWeekendOrHol;
}

function normalizeSendFormatServer(raw?: string, legacySendAsImage?: boolean): ServerLineSendFormat {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'IMAGE_ONLY' || s === 'IMAGE') return 'IMAGE_ONLY';
  if (s === 'TEXT_ONLY' || s === 'TEXT') return 'TEXT_ONLY';
  if (s === 'BOTH') return 'BOTH';
  if (legacySendAsImage === false) return 'TEXT_ONLY';
  return 'BOTH';
}

async function pushLineMessages(params: {
  targetIds: string[];
  text?: string;
  imageUrl?: string;
  previewImageUrl?: string;
  sendFormat?: ServerLineSendFormat;
}): Promise<{ ok: boolean; statusText: string; sentAt: string; sentCount: number; error?: string; quotaExceeded?: boolean }> {
  const token = getLineAccessToken();
  const sentAt = getBangkokDateParts().timestamp;
  const targets = Array.from(
    new Set(params.targetIds.map((id) => String(id || '').trim()).filter(Boolean))
  );
  if (targets.length === 0) targets.push(getDefaultGroupId());

  if (!token) {
    const err = 'เซิร์ฟเวอร์ยังไม่มี LINE_CHANNEL_ACCESS_TOKEN';
    serverLineState.lastSentAt = sentAt;
    serverLineState.lastStatus = `ส่งไม่สำเร็จ: ${err}`;
    return { ok: false, statusText: serverLineState.lastStatus, sentAt, sentCount: 0, error: err };
  }

  const fmt = normalizeSendFormatServer(params.sendFormat, true);
  const messages: Array<Record<string, unknown>> = [];
  if (fmt !== 'TEXT_ONLY' && params.imageUrl && /^https:\/\//i.test(params.imageUrl.trim())) {
    const cleanImg = params.imageUrl.trim();
    const cleanPrev =
      params.previewImageUrl && /^https:\/\//i.test(params.previewImageUrl.trim())
        ? params.previewImageUrl.trim()
        : cleanImg;
    messages.push({
      type: 'image',
      originalContentUrl: cleanImg,
      previewImageUrl: cleanPrev,
    });
  }
  const cleanText = String(params.text || '').trim();
  if (fmt !== 'IMAGE_ONLY' && cleanText) {
    const finalMessage =
      cleanText.length > 4950
        ? `${cleanText.slice(0, 4900)}\n...(ข้อความถูกย่อตามขีดจำกัด LINE)`
        : cleanText;
    messages.push({ type: 'text', text: finalMessage });
  }
  if (fmt === 'IMAGE_ONLY' && messages.length === 0) {
    return {
      ok: false,
      statusText: 'ไม่สามารถอัปโหลดรูปภาพ .jpeg ได้',
      sentAt,
      sentCount: 0,
      error: 'เลือกส่งเฉพาะรูปภาพ (.jpeg) แต่ไม่สามารถสร้าง/อัปโหลดภาพขึ้น Google Drive ได้ กรุณาตรวจสอบการเชื่อมต่อและ Deploy Code.gs ล่าสุด',
    };
  }
  if (messages.length === 0) {
    return { ok: false, statusText: 'ไม่มีข้อความหรือรูปภาพสำหรับส่ง', sentAt, sentCount: 0, error: 'ไม่มีข้อมูลส่ง' };
  }

  let successCount = 0;
  let quotaExceeded = false;
  const errors: string[] = [];

  for (const to of targets) {
    try {
      const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to, messages }),
      });
      if (res.ok) {
        successCount += 1;
      } else {
        const errText = await res.text();
        if (res.status === 429 || /monthly limit/i.test(errText)) {
          quotaExceeded = true;
          errors.push(
            'โควต้าส่งข้อความ Push รายเดือนของ LINE OA เต็มแล้ว (HTTP 429 — แพ็กเกจฟรีจำกัด 200 ข้อความ/เดือน) รอรีเซ็ตต้นเดือนถัดไป หรืออัปเกรดแพ็กเกจใน LINE Official Account Manager (ส่วนแชตถาม "บูบี้" ในกลุ่มยังตอบกลับได้ฟรีไม่จำกัด)'
          );
          break;
        }
        const errMsg =
          res.status === 401
            ? 'LINE API HTTP 401: Channel Access Token หมดอายุหรือถูกกด Reissue ใหม่ใน LINE Developers Console กรุณาอัปเดต Token ล่าสุดในเซิร์ฟเวอร์ (.env) และ Apps Script'
            : `LINE API HTTP ${res.status} (${to}): ${errText}`;
        errors.push(errMsg);
      }
    } catch (err) {
      errors.push(`${to}: ${String(err instanceof Error ? err.message : err)}`);
    }
  }

  lineMetaCache = null; // Invalidate cached quota consumption after a push attempt
  serverLineState.lastSentAt = sentAt;
  if (successCount > 0 && errors.length === 0) {
    const okStatus = `ส่งรายงานเข้า ${successCount} กลุ่ม LINE ผ่าน Server Proxy สำเร็จ`;
    serverLineState.lastStatus = okStatus;
    return { ok: true, statusText: okStatus, sentAt, sentCount: successCount };
  }
  if (successCount > 0) {
    const partial = `ส่งสำเร็จ ${successCount}/${targets.length} กลุ่ม (${errors[0]})`;
    serverLineState.lastStatus = partial;
    return { ok: true, statusText: partial, sentAt, sentCount: successCount, error: errors.join('; '), quotaExceeded };
  }
  const errMsg = errors[0] || 'ส่งเข้า LINE ไม่สำเร็จ';
  serverLineState.lastStatus = `ส่งไม่สำเร็จ: ${errMsg}`;
  return { ok: false, statusText: serverLineState.lastStatus, sentAt, sentCount: 0, error: errMsg, quotaExceeded };
}

async function createAppServer(): Promise<void> {
  const app = express();
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/line/status', async (req: Request, res: Response) => {
    const requestedTargetId =
      typeof req.query.targetId === 'string' && req.query.targetId.trim()
        ? req.query.targetId.trim()
        : serverLineState.targetId || getDefaultGroupId();
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const meta = await fetchLineMetadata(requestedTargetId, refresh);

    res.json({
      ok: true,
      hasServerToken: Boolean(getLineAccessToken()),
      tokenVerified: meta.tokenVerified,
      tokenError: meta.tokenError,
      defaultGroupId: getDefaultGroupId(),
      targetId: requestedTargetId,
      botName: meta.botName,
      groupName: meta.groupName,
      groupVerified: meta.groupVerified,
      groupError: meta.groupError,
      quotaType: meta.quotaType,
      quotaLimit: meta.quotaLimit,
      quotaUsed: meta.quotaUsed,
      quotaRemaining: meta.quotaRemaining,
      serverAutoEnabled: serverLineState.enabled,
      serverAutoTime: serverLineState.time,
      serverNextRunAt: serverLineState.enabled ? computeNextRunAtLabel(serverLineState.time) : '',
      lastSentAt: serverLineState.lastSentAt,
      lastStatus: serverLineState.lastStatus,
      detectedGroupId: serverLineState.detectedGroupId,
      detectedGroupName: serverLineState.detectedGroupName,
    });
  });

  app.get('/api/line/webhook', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', message: 'LINE Messaging API webhook endpoint ready' });
  });

  const SERVER_DB_PATH = path.join(process.cwd(), 'server-db.json');
  const LINE_AUTO_STATE_PATH = path.join(process.cwd(), 'line-auto-state.json');
  const SERVER_TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const LINE_CLAIM_TTL_MS = 90_000;

  interface LineAutoDailyState {
    completedKeys: Record<string, { at: string; withImage: boolean; statusText?: string }>;
    completedImageKeys: Record<string, string>;
    quotaPausedMonth?: string;
  }

  const lineInFlightClaims = new Map<
    string,
    { claimToken: string; clientId: string; wantImage: boolean; expiresAt: number }
  >();

  function loadLineAutoState(): LineAutoDailyState {
    try {
      if (fs.existsSync(LINE_AUTO_STATE_PATH)) {
        const raw = JSON.parse(fs.readFileSync(LINE_AUTO_STATE_PATH, 'utf8'));
        return {
          completedKeys: raw?.completedKeys && typeof raw.completedKeys === 'object' ? raw.completedKeys : {},
          completedImageKeys:
            raw?.completedImageKeys && typeof raw.completedImageKeys === 'object' ? raw.completedImageKeys : {},
          quotaPausedMonth: typeof raw?.quotaPausedMonth === 'string' ? raw.quotaPausedMonth : undefined,
        };
      }
    } catch {
      // ignore corrupted state file
    }
    return { completedKeys: {}, completedImageKeys: {} };
  }

  function saveLineAutoState(state: LineAutoDailyState): void {
    try {
      const cutoffDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const cutoffYmd = getBangkokDateParts(cutoffDate).ymd;
      const keepRecent = <T>(obj: Record<string, T>): Record<string, T> => {
        const out: Record<string, T> = {};
        for (const [k, v] of Object.entries(obj || {})) {
          const ymdPart = k.split('|').pop() || '';
          if (!/^\d{4}-\d{2}-\d{2}$/.test(ymdPart) || ymdPart >= cutoffYmd) {
            out[k] = v;
          }
        }
        return out;
      };
      const cleaned: LineAutoDailyState = {
        completedKeys: keepRecent(state.completedKeys),
        completedImageKeys: keepRecent(state.completedImageKeys),
        ...(state.quotaPausedMonth && state.quotaPausedMonth >= getBangkokDateParts().ymd.slice(0, 7)
          ? { quotaPausedMonth: state.quotaPausedMonth }
          : {}),
      };
      fs.writeFileSync(LINE_AUTO_STATE_PATH, JSON.stringify(cleaned, null, 2), 'utf8');
    } catch {
      // ignore write failures
    }
  }

  interface ServerGroupNote {
    id: string;
    timestamp: string;
    category: string;
    content: string;
    savedBy: string;
    groupId: string;
    keywords: string;
    status: 'ACTIVE' | 'ARCHIVED';
  }

  interface ServerTombstones {
    workloads: Record<string, number>;
    leaves: Record<string, number>;
    ot: Record<string, number>;
  }

  interface AuthoritativeServerDb {
    version: number;
    updatedAt: string;
    staff: any[];
    workloads: any[];
    leaves: any[];
    ot: any[];
    auditLogs: any[];
    settings: Record<string, any>;
    groupNotes: ServerGroupNote[];
    tombstones: ServerTombstones;
  }

  function pruneServerTombstones(raw: any): ServerTombstones {
    const cutoff = Date.now() - SERVER_TOMBSTONE_TTL_MS;
    const cleanBucket = (bucket: any): Record<string, number> => {
      if (!bucket || typeof bucket !== 'object') return {};
      const out: Record<string, number> = {};
      Object.entries(bucket).forEach(([k, v]) => {
        const ts = Number(v);
        if (k && Number.isFinite(ts) && ts >= cutoff) out[k] = ts;
      });
      return out;
    };
    return {
      workloads: cleanBucket(raw?.workloads),
      leaves: cleanBucket(raw?.leaves),
      ot: cleanBucket(raw?.ot),
    };
  }

  function mergeServerTombstones(a: ServerTombstones, b: any): ServerTombstones {
    const cleanB = pruneServerTombstones(b);
    const mergeBucket = (b1: Record<string, number>, b2: Record<string, number>) => {
      const out = { ...b1 };
      Object.entries(b2).forEach(([k, v]) => {
        if (!out[k] || v > out[k]) out[k] = v;
      });
      return out;
    };
    return {
      workloads: mergeBucket(a.workloads, cleanB.workloads),
      leaves: mergeBucket(a.leaves, cleanB.leaves),
      ot: mergeBucket(a.ot, cleanB.ot),
    };
  }

  function serverWorkloadSlotKey(w: any): string {
    const normDate = normalizeDateYmdServer(w?.date);
    const normShift = normalizeShiftStrServer(w?.shift);
    const normClinic = String(w?.clinic || '').trim();
    const rawType = String(w?.recordType || 'STANDARD').trim().toUpperCase();
    const typeGroup =
      rawType === 'PREMIUM_SUB'
        ? 'PREMIUM_SUB'
        : rawType === 'PREMIUM_POOL'
        ? 'PREMIUM_POOL'
        : 'STANDARD';
    return `${normDate}|${normShift}|${normClinic}|${typeGroup}`;
  }

  function deduplicateServerWorkloads(items: any[]): any[] {
    if (!Array.isArray(items)) return [];
    const seenIds = new Set<string>();
    const bySlot = new Map<string, number>();
    const result: any[] = [];
    const score = (w: any): number => {
      const pt = Math.max(Number(w?.totalPt || 0), Number(w?.adultPt || 0) + Number(w?.childPt || 0));
      const staff =
        Number(w?.hn || 0) +
        Number(w?.rn || 0) +
        Number(w?.pn || 0) +
        Number(w?.na !== undefined ? w.na : w?.pca || 0);
      return (
        (w?.id ? 10 : 0) +
        (pt > 0 ? 5 : 0) +
        (staff > 0 ? 5 : 0) +
        (String(w?.reporter || '').trim() ? 2 : 0) +
        (String(w?.note || '').trim() ? 1 : 0)
      );
    };
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const cleanId = String(item.id || '').trim();
      if (cleanId && seenIds.has(cleanId)) continue;
      const slot = serverWorkloadSlotKey(item);
      if (bySlot.has(slot)) {
        const idx = bySlot.get(slot)!;
        const existingEdited = String(result[idx]?.lastEditedAt || '').trim();
        const itemEdited = String(item.lastEditedAt || '').trim();
        const itemIsNewerEdit =
          (Boolean(itemEdited) && !existingEdited) ||
          (Boolean(itemEdited) && Boolean(existingEdited) && itemEdited > existingEdited);
        const existingIsNewerEdit =
          (Boolean(existingEdited) && !itemEdited) ||
          (Boolean(itemEdited) && Boolean(existingEdited) && existingEdited > itemEdited);
        if (itemIsNewerEdit || (!existingIsNewerEdit && score(item) > score(result[idx]))) {
          result[idx] = item;
        }
        if (cleanId) seenIds.add(cleanId);
        continue;
      }
      if (cleanId) seenIds.add(cleanId);
      bySlot.set(slot, result.length);
      result.push(item);
    }
    return result;
  }

  function serverWorkloadKey(w: any): string {
    const total = Math.max(Number(w?.totalPt || 0), Number(w?.adultPt || 0) + Number(w?.childPt || 0));
    const na = w?.na !== undefined ? Number(w.na || 0) : Number(w?.pca || 0);
    return [
      normalizeDateYmdServer(w?.date),
      normalizeShiftStrServer(w?.shift),
      String(w?.clinic || '').trim(),
      total,
      Number(w?.adultPt || 0),
      Number(w?.childPt || 0),
      Number(w?.admit || 0),
      Number(w?.hn || 0),
      Number(w?.rn || 0),
      Number(w?.pn || 0),
      na,
      Number(w?.clerk || 0),
      Number(w?.serviceWorker || 0),
      String(w?.reporter || '').trim(),
      String(w?.recordType || 'STANDARD').trim(),
    ].join('|');
  }

  function normalizeStaffNameServer(name: any): string {
    return String(name || '').replace(/\s+/g, ' ').trim();
  }

  function isTrainingLeaveServer(leaveType: any): boolean {
    const lt = String(leaveType || '').trim();
    return lt.includes('อบรม') || lt.includes('ประชุม');
  }

  function parseLeavePeriodServer(note: any): string {
    const text = String(note || '');
    if (text.includes('ครึ่งวันเช้า')) return 'ครึ่งวันเช้า';
    if (text.includes('ครึ่งวันบ่าย')) return 'ครึ่งวันบ่าย';
    return '';
  }

  function isLeaveReasonRequiredServer(leaveType: any): boolean {
    const lt = String(leaveType || '').trim();
    if (!lt || lt === 'ลาพักผ่อน') return false;
    return lt.includes('ลากิจ') || lt.includes('ลาป่วย');
  }

  function hasValidLeaveReasonServer(leaveType: any, note: any): boolean {
    if (!isLeaveReasonRequiredServer(leaveType)) return true;
    const clean = String(note || '')
      .replace(/\[(ครึ่งวันเช้า|ครึ่งวันบ่าย)\]\s*/g, '')
      .replace(/\((ครึ่งวันเช้า|ครึ่งวันบ่าย)\)\s*/g, '')
      .trim();
    if (!clean) return false;
    if (/^บันทึกอัตโนมัติจากห้องตรวจ/.test(clean)) return false;
    return true;
  }

  function normalizeLeaveRangeServer(startRaw: any, endRaw: any): { start: string; end: string } {
    const s = normalizeDateYmdServer(startRaw);
    const e = normalizeDateYmdServer(endRaw || startRaw) || s;
    if (!s) return { start: '', end: '' };
    return s <= e ? { start: s, end: e } : { start: e, end: s };
  }

  function isServerLeaveConflict(existing: any, candidate: any, excludeId?: string): boolean {
    if (!existing || !candidate) return false;
    if (excludeId && String(existing.id || '').trim() === excludeId) return false;
    const exName = normalizeStaffNameServer(existing.staffName);
    const caName = normalizeStaffNameServer(candidate.staffName);
    if (!exName || !caName || exName !== caName) return false;

    const exRange = normalizeLeaveRangeServer(existing.startDate, existing.endDate);
    const caRange = normalizeLeaveRangeServer(candidate.startDate, candidate.endDate);
    if (!exRange.start || !caRange.start) return false;
    if (!(exRange.start <= caRange.end && exRange.end >= caRange.start)) return false;

    const exIsTrain = isTrainingLeaveServer(existing.leaveType);
    const caIsTrain = isTrainingLeaveServer(candidate.leaveType);
    if (exIsTrain === caIsTrain) return true;

    const exDays = Number(existing.days) || 1;
    const caDays = Number(candidate.days) || 1;
    const exPeriod = parseLeavePeriodServer(existing.note);
    const caPeriod = parseLeavePeriodServer(candidate.note);
    if (
      exRange.start === exRange.end &&
      caRange.start === caRange.end &&
      exDays === 0.5 &&
      caDays === 0.5 &&
      exPeriod &&
      caPeriod &&
      exPeriod !== caPeriod
    ) {
      return false;
    }
    return true;
  }

  function scoreServerLeaveQuality(l: any): number {
    let score = 0;
    if (l?.lastEditedAt) score += 2000;
    if (l?.lastEditReason) score += 200;
    const cleanNote = String(l?.note || '')
      .replace(/^\s*\[(?:ครึ่งวันเช้า|ครึ่งวันบ่าย)\]\s*/, '')
      .replace(/\s*\((?:ครึ่งวันเช้า|ครึ่งวันบ่าย)\)\s*$/, '')
      .trim();
    if (cleanNote) {
      const isAutoNote =
        /^บันทึกอัตโนมัติจากห้องตรวจ/.test(cleanNote) ||
        /^ไปอบรม\/ประชุม\s*\(บันทึกจาก/.test(cleanNote);
      score += isAutoNote ? 10 : 300;
    }
    const id = String(l?.id || '').trim();
    if (id && !/^(LV-AUTO-|TRN-AUTO-|LV-GS-|LV-CHK-)/.test(id)) {
      score += 50;
    } else if (/^(LV-AUTO-|TRN-AUTO-)/.test(id)) {
      score += 20;
    }
    score += Math.min(30, Number(l?.days || 0));
    if (String(l?.clinic || '').trim()) score += 5;
    return score;
  }

  function deduplicateServerLeaves(items: any[]): any[] {
    if (!Array.isArray(items) || items.length === 0) return [];
    const seenIds = new Set<string>();
    const keptByStaff = new Map<string, number[]>();
    const result: any[] = [];

    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const staffName = normalizeStaffNameServer(rawItem.staffName);
      const range = normalizeLeaveRangeServer(rawItem.startDate, rawItem.endDate);
      if (!staffName || !range.start) continue;

      const item = {
        ...rawItem,
        staffName,
        startDate: range.start,
        endDate: range.end,
        clinic: String(rawItem.clinic || '').trim(),
        leaveType: String(rawItem.leaveType || 'ลาป่วย').trim(),
        days: Number(rawItem.days) > 0 ? Number(rawItem.days) : 1,
        note: String(rawItem.note || '').trim(),
      };

      const cleanId = String(item.id || '').trim();
      if (cleanId && seenIds.has(cleanId)) continue;

      const indices = keptByStaff.get(staffName) || [];
      const conflictIdx = indices.find((idx) => isServerLeaveConflict(result[idx], item));

      if (conflictIdx !== undefined) {
        const existing = result[conflictIdx];
        const itemScore = scoreServerLeaveQuality(item);
        const exScore = scoreServerLeaveQuality(existing);
        const itemEdited = String(item.lastEditedAt || '');
        const exEdited = String(existing.lastEditedAt || '');
        if (itemScore > exScore || (itemScore === exScore && itemEdited > exEdited)) {
          result[conflictIdx] = item;
        }
        if (cleanId) seenIds.add(cleanId);
        continue;
      }

      if (cleanId) seenIds.add(cleanId);
      const newIdx = result.length;
      result.push(item);
      indices.push(newIdx);
      keptByStaff.set(staffName, indices);
    }

    return result;
  }

  function serverLeaveKey(l: any): string {
    const range = normalizeLeaveRangeServer(l?.startDate, l?.endDate);
    const isTrain = isTrainingLeaveServer(l?.leaveType);
    const daysNum = Number(l?.days || 1);
    const period = daysNum === 0.5 ? parseLeavePeriodServer(l?.note) : '';
    return [
      range.start,
      range.end,
      normalizeStaffNameServer(l?.staffName),
      isTrain ? 'TRAIN' : 'LEAVE',
      ...(period ? [period] : []),
    ].join('|');
  }

  function serverOtKey(o: any): string {
    return [
      normalizeDateYmdServer(o?.date),
      normalizeShiftStrServer(o?.shift),
      String(o?.staffName || '').trim(),
      String(o?.homeClinic || '').trim(),
      String(o?.workClinic || '').trim(),
    ].join('|');
  }

  function syncServerLineStateFromSettings(settings: any): void {
    if (!settings || typeof settings !== 'object') return;
    if (settings.lineAutoEnabled !== undefined) {
      serverLineState.enabled = Boolean(settings.lineAutoEnabled);
    }
    if (settings.lineAutoTime) {
      serverLineState.time = normalizeTimeServer(String(settings.lineAutoTime), DEFAULT_LINE_AUTO_TIME);
    }
    if (
      settings.lineAutoReportDayMode === 'TODAY' ||
      settings.lineAutoReportDayMode === 'YESTERDAY' ||
      settings.lineAutoReportDayMode === 'LATEST_WITH_DATA'
    ) {
      serverLineState.reportDayMode = settings.lineAutoReportDayMode;
    }
    if (settings.lineAutoShift) {
      serverLineState.shift = String(settings.lineAutoShift).trim() || DEFAULT_LINE_AUTO_SHIFT;
    }
    if (settings.lineTargetId) {
      serverLineState.targetId = String(settings.lineTargetId).trim();
    }
    if (Array.isArray(settings.lineTargetGroups) && settings.lineTargetGroups.length > 0) {
      serverLineState.targetGroups = settings.lineTargetGroups;
    }
    if (Array.isArray(settings.lineSchedules) && settings.lineSchedules.length > 0) {
      serverLineState.schedules = settings.lineSchedules.map((s: any) => ({
        ...s,
        time: normalizeTimeServer(s?.time, DEFAULT_LINE_AUTO_TIME),
      }));
    }
    if (settings.lineSendFormat !== undefined || settings.lineSendAsImage !== undefined) {
      const resolvedFmt = normalizeSendFormatServer(
        settings.lineSendFormat,
        settings.lineSendAsImage !== undefined ? Boolean(settings.lineSendAsImage) : undefined
      );
      serverLineState.sendFormat = resolvedFmt;
      serverLineState.sendAsImage = resolvedFmt !== 'TEXT_ONLY';
    }
    if (settings.boobyOwnerName) {
      serverLineState.boobyOwnerName = String(settings.boobyOwnerName).trim() || 'คุณทรงยศ';
    }
    if (settings.boobyOwnerUserId !== undefined) {
      serverLineState.boobyOwnerUserId = String(settings.boobyOwnerUserId || '').trim();
    }
    if (settings.boobyGroupMentionOnly !== undefined) {
      serverLineState.boobyGroupMentionOnly = Boolean(settings.boobyGroupMentionOnly);
    }
    if (settings.gasUrl) {
      serverLineState.gasUrl = String(settings.gasUrl).trim();
    }
  }

  function normalizeAuthoritativeDb(raw: any): AuthoritativeServerDb {
    const rawVer = Number(raw?.version);
    const rawWorkloads = Array.isArray(raw?.workloads) ? raw.workloads : [];
    const dedupedWorkloads = deduplicateServerWorkloads(rawWorkloads);
    const dedupedLeaves = deduplicateServerLeaves(Array.isArray(raw?.leaves) ? raw.leaves : []);
    const hasSeedData =
      dedupedWorkloads.length > 0 ||
      dedupedLeaves.length > 0 ||
      (Array.isArray(raw?.ot) && raw.ot.length > 0) ||
      (Array.isArray(raw?.staff) && raw.staff.length > 0);
    return {
      version: Number.isFinite(rawVer) && rawVer > 0 ? Math.floor(rawVer) : hasSeedData ? 1 : 0,
      updatedAt: typeof raw?.updatedAt === 'string' && raw.updatedAt ? raw.updatedAt : new Date().toISOString(),
      staff: Array.isArray(raw?.staff) ? raw.staff : [],
      workloads: dedupedWorkloads,
      leaves: dedupedLeaves,
      ot: Array.isArray(raw?.ot) ? raw.ot : [],
      auditLogs: Array.isArray(raw?.auditLogs) ? raw.auditLogs.slice(0, 500) : [],
      settings: raw?.settings && typeof raw.settings === 'object' ? raw.settings : {},
      groupNotes: Array.isArray(raw?.groupNotes) ? raw.groupNotes : [],
      tombstones: pruneServerTombstones(raw?.tombstones),
    };
  }

  function loadServerDb(): any {
    try {
      if (fs.existsSync(SERVER_DB_PATH)) {
        return JSON.parse(fs.readFileSync(SERVER_DB_PATH, 'utf8'));
      }
    } catch {
      // ignore
    }
    return null;
  }

  function getAuthoritativeServerDb(): AuthoritativeServerDb {
    return normalizeAuthoritativeDb(loadServerDb() || {});
  }

  function writeServerDb(data: any): void {
    const normalized = normalizeAuthoritativeDb(data);
    fs.writeFileSync(SERVER_DB_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  }

  // Hydrate LINE state from persisted server-db.json & line-auto-state.json on startup
  try {
    const bootDb = loadServerDb();
    if (bootDb?.settings) syncServerLineStateFromSettings(bootDb.settings);
    const bootLineState = loadLineAutoState();
    for (const k of Object.keys(bootLineState.completedKeys)) {
      serverLineState.lastTriggeredBangkokKeys[k] = true;
    }
  } catch {
    // ignore startup hydration failures
  }

  function buildPublicDbResponse(authDb: AuthoritativeServerDb) {
    return {
      version: authDb.version,
      updatedAt: authDb.updatedAt,
      db: {
        staff: authDb.staff,
        workloads: authDb.workloads,
        leaves: authDb.leaves,
        ot: authDb.ot,
        auditLogs: authDb.auditLogs,
        settings: authDb.settings,
      },
      tombstones: authDb.tombstones,
    };
  }

  function broadcastServerDbState(
    authDb: AuthoritativeServerDb,
    senderClientId = '',
    reason = 'mutation'
  ): void {
    const message = JSON.stringify({
      type: 'db:state',
      reason,
      senderClientId,
      ...buildPublicDbResponse(authDb),
    });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch {
          // ignore individual socket write failure
        }
      }
    });
  }

  // Real-Time WebSocket Server on /ws (same port 3000 as HTTP)
  const wsAliveMap = new WeakMap<WebSocket, boolean>();
  wss.on('connection', (ws) => {
    wsAliveMap.set(ws, true);
    ws.on('pong', () => wsAliveMap.set(ws, true));
    ws.on('message', (rawMsg) => {
      try {
        const parsed = JSON.parse(String(rawMsg || ''));
        if (parsed?.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        } else if (parsed?.type === 'sync:request') {
          const cur = getAuthoritativeServerDb();
          ws.send(
            JSON.stringify({
              type: 'db:state',
              reason: 'sync_request',
              senderClientId: '',
              ...buildPublicDbResponse(cur),
            })
          );
        }
      } catch {
        // ignore malformed client socket message
      }
    });

    // Immediately send current authoritative state on connection
    try {
      const current = getAuthoritativeServerDb();
      if (current.version > 0) {
        ws.send(
          JSON.stringify({
            type: 'db:state',
            reason: 'init',
            senderClientId: '',
            ...buildPublicDbResponse(current),
          })
        );
      }
    } catch {
      // ignore send failure
    }
  });

  const wsHeartbeatTimer = setInterval(() => {
    wss.clients.forEach((client) => {
      if (wsAliveMap.get(client) === false) {
        try {
          client.terminate();
        } catch {
          // ignore
        }
        return;
      }
      wsAliveMap.set(client, false);
      try {
        client.ping();
      } catch {
        // ignore
      }
    });
  }, 25_000);
  wss.on('close', () => clearInterval(wsHeartbeatTimer));

  // GET authoritative DB snapshot (used on initial mount & WebSocket reconnect catch-up)
  app.get('/api/db', (_req: Request, res: Response) => {
    try {
      const current = getAuthoritativeServerDb();
      res.json({ ok: true, ...buildPublicDbResponse(current) });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
    }
  });

  // POST idempotent atomic domain mutation -> increments version, persists server-db.json, broadcasts immediately to all WebSocket clients
  app.post('/api/db/mutate', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        clientId?: string;
        action?: string;
        payload?: any;
      };
      const clientId = String(body.clientId || '').trim();
      const action = String(body.action || '').trim();
      const payload = body.payload || {};
      if (!action) {
        res.status(400).json({ ok: false, error: 'Missing mutation action' });
        return;
      }

      const cur = getAuthoritativeServerDb();
      const next: AuthoritativeServerDb = {
        ...cur,
        staff: [...cur.staff],
        workloads: [...cur.workloads],
        leaves: [...cur.leaves],
        ot: [...cur.ot],
        auditLogs: [...cur.auditLogs],
        settings: { ...cur.settings },
        tombstones: {
          workloads: { ...cur.tombstones.workloads },
          leaves: { ...cur.tombstones.leaves },
          ot: { ...cur.tombstones.ot },
        },
      };

      const appendAuditIfNew = (auditEntry: any) => {
        if (!auditEntry || !auditEntry.id) return;
        if (!next.auditLogs.some((a) => a?.id === auditEntry.id)) {
          next.auditLogs = [auditEntry, ...next.auditLogs].slice(0, 500);
        }
      };

      const addUniqueWorkloads = (items: any[]) => {
        const added: any[] = [];
        const existingSlots = new Set(next.workloads.map((ex) => serverWorkloadSlotKey(ex)));
        const existingIds = new Set(next.workloads.map((ex) => String(ex?.id || '').trim()).filter(Boolean));
        for (const item of items) {
          if (!item || !item.date || !item.clinic) continue;
          const cleanId = String(item.id || '').trim();
          const slot = serverWorkloadSlotKey(item);
          if ((cleanId && existingIds.has(cleanId)) || existingSlots.has(slot)) {
            continue;
          }
          added.push(item);
          if (cleanId) existingIds.add(cleanId);
          existingSlots.add(slot);
          delete next.tombstones.workloads[serverWorkloadKey(item)];
          if (cleanId) delete next.tombstones.workloads[`id:${cleanId}`];
        }
        if (added.length > 0) {
          next.workloads = [...added, ...next.workloads];
        }
      };

      const addUniqueLeaves = (items: any[]): { added: any[]; conflicts: any[] } => {
        const added: any[] = [];
        const conflicts: any[] = [];
        for (const rawItem of items) {
          if (!rawItem || !rawItem.staffName || !rawItem.startDate) continue;
          const range = normalizeLeaveRangeServer(rawItem.startDate, rawItem.endDate);
          if (!range.start) continue;
          const item = {
            ...rawItem,
            staffName: normalizeStaffNameServer(rawItem.staffName),
            startDate: range.start,
            endDate: range.end,
            clinic: String(rawItem.clinic || '').trim(),
            leaveType: String(rawItem.leaveType || 'ลาป่วย').trim(),
            days: Number(rawItem.days) > 0 ? Number(rawItem.days) : 1,
            note: String(rawItem.note || '').trim(),
          };
          const lKey = serverLeaveKey(item);
          const cleanId = String(item.id || '').trim();
          const conflictItem =
            next.leaves.find(
              (ex) =>
                (cleanId && ex.id && String(ex.id).trim() === cleanId) ||
                serverLeaveKey(ex) === lKey ||
                isServerLeaveConflict(ex, item)
            ) ||
            added.find(
              (ex) =>
                (cleanId && ex.id && String(ex.id).trim() === cleanId) ||
                serverLeaveKey(ex) === lKey ||
                isServerLeaveConflict(ex, item)
            );
          if (!conflictItem) {
            added.push(item);
            delete next.tombstones.leaves[lKey];
            if (cleanId) delete next.tombstones.leaves[`id:${cleanId}`];
          } else {
            conflicts.push(conflictItem);
          }
        }
        if (added.length > 0) {
          next.leaves = deduplicateServerLeaves([...added, ...next.leaves]);
        }
        return { added, conflicts };
      };

      const addUniqueOt = (items: any[]) => {
        const added: any[] = [];
        for (const item of items) {
          if (!item || !item.staffName || !item.date) continue;
          const oKey = serverOtKey(item);
          const dup = next.ot.some(
            (ex) =>
              (ex.id && item.id && ex.id === item.id) ||
              serverOtKey(ex) === oKey ||
              (String(ex.date || '').trim() === String(item.date || '').trim() &&
                String(ex.shift || '').trim() === String(item.shift || '').trim() &&
                String(ex.staffName || '').trim().replace(/\s+/g, ' ') ===
                  String(item.staffName || '').trim().replace(/\s+/g, ' '))
          );
          if (!dup) {
            added.push(item);
            delete next.tombstones.ot[oKey];
            if (item.id) delete next.tombstones.ot[`id:${item.id}`];
          }
        }
        if (added.length > 0) {
          next.ot = [...added, ...next.ot];
        }
      };

      switch (action) {
        case 'addWorkloads': {
          if (Array.isArray(payload.workloads)) addUniqueWorkloads(payload.workloads);
          if (Array.isArray(payload.leaves)) addUniqueLeaves(payload.leaves);
          if (Array.isArray(payload.ot)) addUniqueOt(payload.ot);
          break;
        }
        case 'updateWorkload': {
          const updated = payload.updated;
          const target = payload.target;
          if (updated) {
            const targetSlot = serverWorkloadSlotKey(target || updated);
            const idx = next.workloads.findIndex(
              (w) =>
                (updated.id && w.id === updated.id) ||
                (target && serverWorkloadKey(w) === serverWorkloadKey(target)) ||
                serverWorkloadSlotKey(w) === targetSlot
            );
            if (idx >= 0) next.workloads[idx] = updated;
            else next.workloads.unshift(updated);
            if (target) {
              const oldKey = serverWorkloadKey(target);
              if (oldKey !== serverWorkloadKey(updated)) {
                next.tombstones.workloads[oldKey] = Date.now();
              }
            }
            delete next.tombstones.workloads[serverWorkloadKey(updated)];
            if (updated.id) delete next.tombstones.workloads[`id:${updated.id}`];
          }
          appendAuditIfNew(payload.auditEntry);
          break;
        }
        case 'adjustWorkloadPatients': {
          const updated = payload.updated;
          const target = payload.target;
          if (updated) {
            const targetSlot = serverWorkloadSlotKey(target || updated);
            const idx = next.workloads.findIndex(
              (w) =>
                (target?.id && w.id === target.id) ||
                (updated.id && w.id === updated.id) ||
                (target && serverWorkloadKey(w) === serverWorkloadKey(target)) ||
                serverWorkloadSlotKey(w) === targetSlot
            );
            const existing = idx >= 0 ? next.workloads[idx] : null;
            const refObj = existing || target || updated;
            const isPool =
              String(refObj?.recordType || '').toUpperCase() === 'PREMIUM_POOL' ||
              String(refObj?.clinic || '').includes('รวมทั้งศูนย์');
            const isOffDuty =
              Boolean(refObj?.isOffDuty) || String(refObj?.note || '').includes('[[OFF_DUTY_JSON:');
            if (!isPool && !isOffDuty) {
              const nextAdult = Math.max(0, Number(updated.adultPt || 0));
              const nextChild = Math.max(0, Number(updated.childPt || 0));
              const nextTotal = Math.max(Number(updated.totalPt || 0), nextAdult + nextChild);
              const nextAdmit = Math.max(0, Number(updated.admit || 0));
              const nextEditedAt = String(updated.lastEditedAt || new Date().toISOString());
              const nextEditReason = String(
                updated.lastEditReason || payload.auditEntry?.reason || ''
              ).trim();
              const nextEditedBy = String(
                updated.lastEditedBy || payload.auditEntry?.editedBy || ''
              ).trim();

              if (existing) {
                const isReferralExisting =
                  String(existing.clinic || '').trim() === 'ศูนย์รับ - ส่งต่อผู้ป่วย' ||
                  Boolean(existing.referralData) ||
                  String(existing.note || '').includes('[[REFERRAL_JSON:');
                let nextNote = existing.note || '';
                if (isReferralExisting && typeof updated.note === 'string') {
                  const refMatch = updated.note.match(/\[\[REFERRAL_JSON:[\s\S]*?\]\]/);
                  if (refMatch) {
                    if (/\[\[REFERRAL_JSON:[\s\S]*?\]\]/.test(nextNote)) {
                      nextNote = nextNote.replace(/\[\[REFERRAL_JSON:[\s\S]*?\]\]/, refMatch[0]).trim();
                    } else {
                      nextNote = [nextNote.trim(), refMatch[0]].filter(Boolean).join(' ');
                    }
                  }
                }
                const patched = {
                  ...existing,
                  adultPt: nextAdult,
                  childPt: nextChild,
                  totalPt: nextTotal,
                  admit: nextAdmit,
                  ...(isReferralExisting && updated.referralData
                    ? { referralData: updated.referralData, note: nextNote }
                    : {}),
                  lastEditedAt: nextEditedAt,
                  lastEditReason: nextEditReason,
                  lastEditedBy: nextEditedBy,
                };
                next.workloads[idx] = patched;
                const oldKey = serverWorkloadKey(existing);
                const newKey = serverWorkloadKey(patched);
                if (oldKey !== newKey) {
                  next.tombstones.workloads[oldKey] = Date.now();
                }
                delete next.tombstones.workloads[newKey];
                if (patched.id) delete next.tombstones.workloads[`id:${patched.id}`];
              } else {
                const inserted = {
                  ...updated,
                  adultPt: nextAdult,
                  childPt: nextChild,
                  totalPt: nextTotal,
                  admit: nextAdmit,
                  lastEditedAt: nextEditedAt,
                  lastEditReason: nextEditReason,
                  lastEditedBy: nextEditedBy,
                };
                next.workloads.unshift(inserted);
                if (target) {
                  const oldKey = serverWorkloadKey(target);
                  if (oldKey !== serverWorkloadKey(inserted)) {
                    next.tombstones.workloads[oldKey] = Date.now();
                  }
                }
                delete next.tombstones.workloads[serverWorkloadKey(inserted)];
                if (inserted.id) delete next.tombstones.workloads[`id:${inserted.id}`];
              }
            }
          }
          appendAuditIfNew(payload.auditEntry);
          break;
        }
        case 'deleteWorkload': {
          const delId = String(payload.id || payload.target?.id || '').trim();
          const target = payload.target || next.workloads.find((w) => w.id === delId);
          next.workloads = next.workloads.filter(
            (w) => !(delId && w.id === delId) && !(target && serverWorkloadKey(w) === serverWorkloadKey(target))
          );
          if (target) {
            next.tombstones.workloads[serverWorkloadKey(target)] = Date.now();
          }
          if (delId) {
            next.tombstones.workloads[`id:${delId}`] = Date.now();
          }
          appendAuditIfNew(payload.auditEntry);
          break;
        }
        case 'addLeave': {
          if (payload.leave) {
            if (!hasValidLeaveReasonServer(payload.leave.leaveType, payload.leave.note)) {
              res.json({
                ok: true,
                missingReasonRejected: true,
                ...buildPublicDbResponse(cur),
              });
              return;
            }
            const { added, conflicts } = addUniqueLeaves([payload.leave]);
            if (added.length === 0 && conflicts.length > 0) {
              res.json({
                ok: true,
                duplicateRejected: true,
                conflict: conflicts[0],
                ...buildPublicDbResponse(cur),
              });
              return;
            }
          }
          break;
        }
        case 'updateLeave': {
          const updatedRaw = payload.updated;
          const target = payload.target;
          if (updatedRaw) {
            if (!hasValidLeaveReasonServer(updatedRaw.leaveType, updatedRaw.note)) {
              res.json({
                ok: true,
                missingReasonRejected: true,
                ...buildPublicDbResponse(cur),
              });
              return;
            }
            const range = normalizeLeaveRangeServer(updatedRaw.startDate, updatedRaw.endDate);
            const updated = {
              ...updatedRaw,
              staffName: normalizeStaffNameServer(updatedRaw.staffName),
              startDate: range.start || updatedRaw.startDate,
              endDate: range.end || updatedRaw.endDate || updatedRaw.startDate,
            };
            const idx = next.leaves.findIndex(
              (l) => (updated.id && l.id === updated.id) || (target && serverLeaveKey(l) === serverLeaveKey(target))
            );
            const otherConflict = next.leaves.find(
              (l, i) => i !== idx && isServerLeaveConflict(l, updated, updated.id ? String(updated.id) : undefined)
            );
            if (otherConflict) {
              res.json({
                ok: true,
                duplicateRejected: true,
                conflict: otherConflict,
                ...buildPublicDbResponse(cur),
              });
              return;
            }
            if (idx >= 0) next.leaves[idx] = updated;
            else next.leaves.unshift(updated);
            next.leaves = deduplicateServerLeaves(next.leaves);
            if (target) {
              const oldKey = serverLeaveKey(target);
              if (oldKey !== serverLeaveKey(updated)) {
                next.tombstones.leaves[oldKey] = Date.now();
              }
            }
            delete next.tombstones.leaves[serverLeaveKey(updated)];
            if (updated.id) delete next.tombstones.leaves[`id:${updated.id}`];
          }
          appendAuditIfNew(payload.auditEntry);
          break;
        }
        case 'deleteLeave': {
          const delId = String(payload.id || payload.target?.id || '').trim();
          const target = payload.target || next.leaves.find((l) => l.id === delId);
          next.leaves = next.leaves.filter(
            (l) => !(delId && l.id === delId) && !(target && serverLeaveKey(l) === serverLeaveKey(target))
          );
          if (target) {
            next.tombstones.leaves[serverLeaveKey(target)] = Date.now();
          }
          if (delId) {
            next.tombstones.leaves[`id:${delId}`] = Date.now();
          }
          appendAuditIfNew(payload.auditEntry);
          break;
        }
        case 'addOt': {
          if (Array.isArray(payload.records)) addUniqueOt(payload.records);
          break;
        }
        case 'updateOt': {
          const updated = payload.updated;
          const target = payload.target;
          if (updated) {
            const idx = next.ot.findIndex(
              (o) => (updated.id && o.id === updated.id) || (target && serverOtKey(o) === serverOtKey(target))
            );
            if (idx >= 0) next.ot[idx] = updated;
            else next.ot.unshift(updated);
            if (target) {
              const oldKey = serverOtKey(target);
              if (oldKey !== serverOtKey(updated)) {
                next.tombstones.ot[oldKey] = Date.now();
              }
            }
            delete next.tombstones.ot[serverOtKey(updated)];
            if (updated.id) delete next.tombstones.ot[`id:${updated.id}`];
          }
          if (Array.isArray(payload.staffList)) {
            next.staff = payload.staffList;
          }
          appendAuditIfNew(payload.auditEntry);
          break;
        }
        case 'deleteOt': {
          const delId = String(payload.id || payload.target?.id || '').trim();
          const target = payload.target || next.ot.find((o) => o.id === delId);
          next.ot = next.ot.filter(
            (o) => !(delId && o.id === delId) && !(target && serverOtKey(o) === serverOtKey(target))
          );
          if (target) {
            next.tombstones.ot[serverOtKey(target)] = Date.now();
          }
          if (delId) {
            next.tombstones.ot[`id:${delId}`] = Date.now();
          }
          appendAuditIfNew(payload.auditEntry);
          break;
        }
        case 'syncStaff': {
          if (Array.isArray(payload.staff)) next.staff = payload.staff;
          if (Array.isArray(payload.ot)) next.ot = payload.ot;
          appendAuditIfNew(payload.auditEntry);
          break;
        }
        case 'saveSettings': {
          if (payload.settings && typeof payload.settings === 'object') {
            next.settings = { ...next.settings, ...payload.settings };
            syncServerLineStateFromSettings(next.settings);
          }
          appendAuditIfNew(payload.auditEntry);
          break;
        }
        case 'saveUnitCostCenter': {
          const cleanClinic = String(payload.clinic || '').trim();
          const cleanCode = String(payload.costCenter || '').trim();
          if (cleanClinic === 'ALL') {
            next.settings = {
              ...next.settings,
              defaultCostCenter: cleanCode || next.settings.defaultCostCenter || '2012000000',
            };
          } else if (cleanClinic) {
            const nextMap = { ...(next.settings.clinicCostCenters || {}) };
            if (cleanCode) nextMap[cleanClinic] = cleanCode;
            else delete nextMap[cleanClinic];
            next.settings = { ...next.settings, clinicCostCenters: nextMap };
          }
          break;
        }
        case 'resetAll': {
          const cleanDb = payload.db || {};
          next.staff = Array.isArray(cleanDb.staff) ? cleanDb.staff : [];
          next.workloads = Array.isArray(cleanDb.workloads) ? cleanDb.workloads : [];
          next.leaves = Array.isArray(cleanDb.leaves) ? cleanDb.leaves : [];
          next.ot = Array.isArray(cleanDb.ot) ? cleanDb.ot : [];
          next.auditLogs = Array.isArray(cleanDb.auditLogs) ? cleanDb.auditLogs : [];
          next.settings = cleanDb.settings && typeof cleanDb.settings === 'object' ? cleanDb.settings : next.settings;
          next.tombstones = { workloads: {}, leaves: {}, ot: {} };
          syncServerLineStateFromSettings(next.settings);
          break;
        }
        default: {
          res.status(400).json({ ok: false, error: `Unknown mutation action: ${action}` });
          return;
        }
      }

      next.version = cur.version + 1;
      next.updatedAt = new Date().toISOString();
      next.tombstones = pruneServerTombstones(next.tombstones);
      writeServerDb(next);
      broadcastServerDbState(next, clientId, action);
      res.json({ ok: true, ...buildPublicDbResponse(next) });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
    }
  });

  // Protected sync endpoint: prevents stale clients from blindly overwriting newer server state
  app.post('/api/db/sync', (req: Request, res: Response) => {
    try {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        res.status(400).json({ ok: false, error: 'Invalid database payload' });
        return;
      }

      const isWrapped = 'db' in body && body.db && typeof body.db === 'object';
      const incomingDb = isWrapped ? body.db : body;
      const clientId = isWrapped ? String(body.clientId || '') : '';
      const baseVersion = isWrapped && body.baseVersion !== undefined ? Number(body.baseVersion) : undefined;
      const forceOverwrite = isWrapped ? Boolean(body.forceOverwrite) : false;
      const mergeFromRemote = isWrapped ? Boolean(body.mergeFromRemote) : false;
      const incomingTombstones = isWrapped ? body.tombstones : undefined;

      const cur = getAuthoritativeServerDb();
      const mergedTombstones = mergeServerTombstones(cur.tombstones, incomingTombstones);

      // Guard: if server already has newer state (version > 0) and client has stale/missing baseVersion without forceOverwrite,
      // reject blind overwrite and return authoritative server snapshot instead!
      if (
        cur.version > 0 &&
        !forceOverwrite &&
        (baseVersion === undefined || !Number.isFinite(baseVersion) || baseVersion < cur.version)
      ) {
        res.json({
          ok: true,
          staleRejected: true,
          ...buildPublicDbResponse(cur),
        });
        return;
      }

      const incomingStaff = Array.isArray(incomingDb.staff) ? incomingDb.staff : cur.staff;
      const incomingWorkloads = deduplicateServerWorkloads(
        (Array.isArray(incomingDb.workloads) ? incomingDb.workloads : cur.workloads).filter(
          (w: any) => !mergedTombstones.workloads[serverWorkloadKey(w)] && !(w?.id && mergedTombstones.workloads[`id:${w.id}`])
        )
      );
      const incomingLeaves = deduplicateServerLeaves(
        (Array.isArray(incomingDb.leaves) ? incomingDb.leaves : cur.leaves).filter(
          (l: any) => !mergedTombstones.leaves[serverLeaveKey(l)] && !(l?.id && mergedTombstones.leaves[`id:${l.id}`])
        )
      );
      const incomingOt = (Array.isArray(incomingDb.ot) ? incomingDb.ot : cur.ot).filter(
        (o: any) => !mergedTombstones.ot[serverOtKey(o)] && !(o?.id && mergedTombstones.ot[`id:${o.id}`])
      );
      const incomingAuditLogs = Array.isArray(incomingDb.auditLogs)
        ? incomingDb.auditLogs.slice(0, 500)
        : cur.auditLogs;
      const incomingSettings =
        incomingDb.settings && typeof incomingDb.settings === 'object' ? incomingDb.settings : cur.settings;

      // Avoid empty bump when mergeFromRemote didn't change anything
      if (mergeFromRemote && cur.version > 0) {
        const same =
          JSON.stringify(cur.staff) === JSON.stringify(incomingStaff) &&
          JSON.stringify(cur.workloads) === JSON.stringify(incomingWorkloads) &&
          JSON.stringify(cur.leaves) === JSON.stringify(incomingLeaves) &&
          JSON.stringify(cur.ot) === JSON.stringify(incomingOt) &&
          JSON.stringify(cur.settings) === JSON.stringify(incomingSettings) &&
          JSON.stringify(cur.auditLogs) === JSON.stringify(incomingAuditLogs);
        if (same) {
          res.json({ ok: true, unchanged: true, ...buildPublicDbResponse(cur) });
          return;
        }
      }

      const next: AuthoritativeServerDb = {
        version: cur.version + 1,
        updatedAt: new Date().toISOString(),
        staff: incomingStaff,
        workloads: incomingWorkloads,
        leaves: incomingLeaves,
        ot: incomingOt,
        auditLogs: incomingAuditLogs,
        settings: incomingSettings,
        groupNotes: Array.isArray(incomingDb.groupNotes) ? incomingDb.groupNotes : cur.groupNotes,
        tombstones: mergedTombstones,
      };

      syncServerLineStateFromSettings(next.settings);
      writeServerDb(next);
      broadcastServerDbState(next, clientId, mergeFromRemote ? 'sheets_sync' : 'seed_sync');
      res.json({ ok: true, ...buildPublicDbResponse(next) });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
    }
  });

  const validateAllowedGasUrlServer = (
    rawUrl: string
  ): { ok: true; url: URL } | { ok: false; errorCode: string; error: string } => {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) {
      return { ok: false, errorCode: 'MISSING_URL', error: 'กรุณาระบุ Apps Script Web App URL' };
    }
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return { ok: false, errorCode: 'INVALID_URL', error: 'รูปแบบ Web App URL ไม่ถูกต้อง' };
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, errorCode: 'INVALID_PROTOCOL', error: 'Web App URL ต้องขึ้นต้นด้วย https:// เท่านั้น' };
    }
    const host = parsed.hostname.toLowerCase();
    if (host !== 'script.google.com' && host !== 'script.googleusercontent.com') {
      return {
        ok: false,
        errorCode: 'DISALLOWED_HOST',
        error: 'อนุญาตเฉพาะโดเมน script.google.com หรือ script.googleusercontent.com เท่านั้น',
      };
    }
    if (host === 'script.google.com' && !parsed.pathname.startsWith('/macros/')) {
      return {
        ok: false,
        errorCode: 'INVALID_PATH',
        error: 'Web App URL ต้องเป็นลิงก์ /macros/s/.../exec จาก Google Apps Script',
      };
    }
    if (/\/dev\/?$/i.test(parsed.pathname)) {
      return {
        ok: false,
        errorCode: 'DEV_URL',
        error: 'URL ลงท้ายด้วย /dev ไม่สามารถใช้งานภายนอกได้ กรุณา Deploy เป็น Web App แล้วคัดลอกลิงก์ที่ลงท้ายด้วย /exec',
      };
    }
    return { ok: true, url: parsed };
  };

  const formatGvizCellServer = (cell: any): string => {
    if (!cell || cell.v === null || cell.v === undefined) return '';
    if (typeof cell.v === 'string') {
      const dateMatch = cell.v.match(/^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)/);
      if (dateMatch) {
        const y = Number(dateMatch[1]);
        const m = Number(dateMatch[2]) + 1;
        const d = Number(dateMatch[3]);
        if (dateMatch[4] !== undefined && y < 1900) {
          return String(cell.f || cell.v);
        }
        return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
      return cell.v;
    }
    if (typeof cell.f === 'string' && /^\d{4}-\d{2}-\d{2}/.test(cell.f.trim())) {
      return cell.f.trim();
    }
    return String(cell.v);
  };

  app.post('/api/sheets/gas-proxy', async (req: Request, res: Response) => {
    try {
      const bodyObj = (req.body || {}) as {
        gasUrl?: string;
        method?: 'GET' | 'POST';
        action?: string;
        body?: unknown;
      };
      const check = validateAllowedGasUrlServer(String(bodyObj.gasUrl || ''));
      if (!check.ok) {
        res.status(400).json({ ok: false, httpStatus: 400, errorCode: check.errorCode, error: check.error });
        return;
      }

      const method = bodyObj.method === 'GET' ? 'GET' : 'POST';
      const targetUrl = new URL(check.url.toString());
      if (method === 'GET') {
        targetUrl.searchParams.set('action', String(bodyObj.action || 'readAll'));
        targetUrl.searchParams.set('_ts', String(Date.now()));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25_000);
      let upstream: globalThis.Response;
      try {
        upstream = await fetch(targetUrl.toString(), {
          method,
          redirect: 'follow',
          signal: controller.signal,
          ...(method === 'POST'
            ? {
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body:
                  typeof bodyObj.body === 'string'
                    ? bodyObj.body
                    : JSON.stringify(bodyObj.body ?? {}),
              }
            : {}),
        });
      } finally {
        clearTimeout(timer);
      }

      const finalUrl = String(upstream.url || '');
      const rawText = await upstream.text();

      if (
        finalUrl.includes('accounts.google.com') ||
        /ServiceLogin|accounts\.google\.com/i.test(rawText.slice(0, 1200))
      ) {
        res.json({
          ok: false,
          httpStatus: upstream.status || 401,
          errorCode: 'AUTH_REQUIRED',
          error:
            'Apps Script Web App ยังไม่ได้เปิดสิทธิ์เป็น "Who has access: Anyone" (ทุกคน) กรุณา Deploy ใหม่และเลือก Who has access: Anyone',
        });
        return;
      }

      if (upstream.status === 404) {
        res.json({
          ok: false,
          httpStatus: 404,
          errorCode: 'NOT_FOUND',
          error:
            'ไม่พบ Apps Script Web App URL นี้ (HTTP 404) — ลิงก์ /exec อาจถูกลบหรือยังไม่ได้ Deploy Code.gs ใหม่',
        });
        return;
      }

      if (upstream.status === 401 || upstream.status === 403) {
        res.json({
          ok: false,
          httpStatus: upstream.status,
          errorCode: 'FORBIDDEN',
          error: `ไม่มีสิทธิ์เข้าถึง Apps Script Web App (HTTP ${upstream.status}) — กรุณาตั้ง Execute as: Me และ Who has access: Anyone`,
        });
        return;
      }

      if (!upstream.ok) {
        res.json({
          ok: false,
          httpStatus: upstream.status,
          errorCode: 'HTTP_ERROR',
          error: `Apps Script ตอบกลับ HTTP ${upstream.status}`,
        });
        return;
      }

      try {
        const parsed = JSON.parse(rawText);
        if (parsed && parsed.success === false) {
          res.json({
            ok: false,
            httpStatus: upstream.status,
            data: parsed,
            errorCode: 'SCRIPT_REJECTED',
            error: String(parsed.error || 'Apps Script ปฏิเสธคำสั่ง'),
          });
          return;
        }
        res.json({ ok: true, httpStatus: upstream.status, data: parsed });
      } catch {
        const htmlHint = /Script function not found/i.test(rawText)
          ? 'ไม่พบฟังก์ชันใน Apps Script (กรุณาคัดลอกโค้ด Code.gs ล่าสุดไปวางและ Deploy ใหม่)'
          : 'Apps Script ส่งค่ากลับมาไม่ใช่ JSON (กรุณาตรวจสอบสิทธิ์ Who has access: Anyone และลิงก์ลงท้าย /exec)';
        res.json({
          ok: false,
          httpStatus: upstream.status,
          errorCode: 'NON_JSON',
          error: htmlHint,
        });
      }
    } catch (err: any) {
      const msg =
        err?.name === 'AbortError'
          ? 'หมดเวลาการเชื่อมต่อ Apps Script (Timeout 25 วินาที)'
          : String(err?.message || err || 'เชื่อมต่อ Apps Script ไม่สำเร็จ');
      res.json({ ok: false, httpStatus: 502, errorCode: 'NETWORK_ERROR', error: msg });
    }
  });

  app.get('/api/sheets/gviz-proxy', async (req: Request, res: Response) => {
    try {
      const spreadsheetId = String(req.query.spreadsheetId || '').trim();
      const sheetName = String(req.query.sheet || '').trim().slice(0, 80);
      if (!/^[a-zA-Z0-9-_]{10,128}$/.test(spreadsheetId)) {
        res.status(400).json({ ok: false, httpStatus: 400, errorCode: 'INVALID_ID', error: 'Spreadsheet ID ไม่ถูกต้อง' });
        return;
      }
      if (!sheetName) {
        res.status(400).json({ ok: false, httpStatus: 400, errorCode: 'MISSING_SHEET', error: 'ไม่ได้ระบุชื่อแท็บชีท' });
        return;
      }

      const targetUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
        spreadsheetId
      )}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheetName)}&_ts=${Date.now()}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      let upstream: globalThis.Response;
      try {
        upstream = await fetch(targetUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const finalUrl = String(upstream.url || '');
      const text = await upstream.text();

      if (finalUrl.includes('accounts.google.com') || text.trim().startsWith('<')) {
        if (upstream.status === 404) {
          res.json({
            ok: false,
            httpStatus: 404,
            errorCode: 'NOT_FOUND',
            error: `ไม่พบ Google Sheet (${spreadsheetId.slice(0, 12)}...) — HTTP 404 ชีทอาจถูกลบหรือยังไม่ได้สร้าง`,
          });
          return;
        }
        res.json({
          ok: false,
          httpStatus: upstream.status || 401,
          errorCode: 'PRIVATE_SHEET',
          error: 'Google Sheet ยังไม่ได้เปิดสิทธิ์แชร์แบบ "ทุกคนที่มีลิงก์อ่านได้ (Viewer)"',
        });
        return;
      }

      if (upstream.status === 404) {
        res.json({
          ok: false,
          httpStatus: 404,
          errorCode: 'NOT_FOUND',
          error: `ไม่พบ Google Sheet (${spreadsheetId.slice(0, 12)}...) — HTTP 404`,
        });
        return;
      }

      if (!upstream.ok || !text.includes('setResponse(')) {
        res.json({
          ok: false,
          httpStatus: upstream.status,
          errorCode: 'GVIZ_ERROR',
          error: `ไม่สามารถอ่านข้อมูล Google Sheet ได้ (HTTP ${upstream.status})`,
        });
        return;
      }

      const startIdx = text.indexOf('{');
      const endIdx = text.lastIndexOf('}');
      if (startIdx < 0 || endIdx <= startIdx) {
        res.json({ ok: false, httpStatus: upstream.status, errorCode: 'PARSE_ERROR', error: 'ข้อมูลชีทไม่สมบูรณ์' });
        return;
      }
      const parsed = JSON.parse(text.slice(startIdx, endIdx + 1));
      if (parsed.status === 'error' || !parsed.table) {
        const msg = parsed?.errors?.[0]?.detailed_message || parsed?.errors?.[0]?.message || 'ไม่พบแท็บชีทใน Google Sheets';
        res.json({ ok: false, httpStatus: 200, errorCode: 'SHEET_TAB_ERROR', error: String(msg) });
        return;
      }
      const rawRows: any[] = Array.isArray(parsed.table.rows) ? parsed.table.rows : [];
      const rows = rawRows.map((row) =>
        (Array.isArray(row.c) ? row.c : []).map((cell: any) => formatGvizCellServer(cell))
      );
      res.json({ ok: true, httpStatus: 200, rows });
    } catch (err: any) {
      res.json({
        ok: false,
        httpStatus: 502,
        errorCode: 'NETWORK_ERROR',
        error: String(err?.message || err || 'เชื่อมต่อ Google Sheets ไม่สำเร็จ'),
      });
    }
  });

  app.get('/api/sheets/code-gs', (_req: Request, res: Response) => {
    try {
      const baseDir = path.resolve(__dirname);
      const codeGsPath = path.resolve(baseDir, 'Code.gs');
      if (!codeGsPath.startsWith(baseDir + path.sep) || !fs.existsSync(codeGsPath)) {
        res.status(404).type('text/plain; charset=utf-8').send('// Code.gs not found');
        return;
      }
      const content = fs.readFileSync(codeGsPath, 'utf8');
      res.status(200).type('text/plain; charset=utf-8').send(content);
    } catch (err: any) {
      res.status(500).type('text/plain; charset=utf-8').send(`// Error reading Code.gs: ${String(err?.message || err)}`);
    }
  });

  app.post('/api/line/webhook', (req: Request, res: Response) => {
    // Always return HTTP 200 OK immediately with zero 302 redirects for LINE Platform verification
    res.status(200).json({ status: 'ok' });

    const body = (req.body || {}) as {
      events?: Array<{
        type?: string;
        replyToken?: string;
        source?: { type?: string; groupId?: string; roomId?: string; userId?: string };
        message?: { type?: string; text?: string; quotedMessageId?: string };
      }>;
    };
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length === 0) return;

    void (async () => {
      const token = getLineAccessToken();
      const bkk = getBangkokDateParts();
      const todayYmd = bkk.ymd;
      const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
      const thaiShortMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      const formatThaiShortServer = (ymd: string): string => {
        const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return ymd;
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
        return `วัน${thaiDays[dow]}ที่ ${d} ${thaiShortMonths[mo - 1] || m[2]} ${y + 543}`;
      };
      const formatCompactThaiServer = (ymd: string): string => {
        const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return ymd;
        return `${Number(m[3])} ${thaiShortMonths[Number(m[2]) - 1] || m[2]} ${Number(m[1]) + 543}`;
      };
      const addDaysBangkokYmd = (ymd: string, delta: number): string => {
        const p = ymd.split('-').map(Number);
        if (p.length !== 3) return ymd;
        const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + delta));
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
      };
      const normalizeDbDateServer = (raw: unknown): string => {
        const s = String(raw || '').trim();
        if (!s) return '';
        const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (iso) {
          let y = Number(iso[1]);
          if (y >= 2400) y -= 543;
          return `${y}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`;
        }
        const slash = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
        if (slash) {
          const d = Number(slash[1]);
          const m = Number(slash[2]);
          let yr = Number(slash[3]);
          if (yr < 100) yr += yr >= 55 ? 2500 - 543 : 2000;
          else if (yr >= 2400) yr -= 543;
          return `${yr}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
        return s;
      };
      const parseThaiQueryDateServer = (
        rawText: string
      ): { ymd: string; endYmd: string; isRange: boolean; relLabel: string; hasExplicitDate: boolean } => {
        const thaiDigits = '๐๑๒๓๔๕๖๗๘๙';
        const q = String(rawText || '')
          .trim()
          .toLowerCase()
          .replace(/[๐-๙]/g, (ch) => {
            const idx = thaiDigits.indexOf(ch);
            return idx !== -1 ? String(idx) : ch;
          })
          .replace(/\s+/g, ' ');

        const p = todayYmd.split('-').map(Number);
        const baseYear = p.length === 3 ? p[0] : new Date().getFullYear();
        const baseMonth = p.length === 3 ? p[1] : new Date().getMonth() + 1;
        const baseDay = p.length === 3 ? p[2] : new Date().getDate();
        const curDow = p.length === 3 ? new Date(Date.UTC(baseYear, baseMonth - 1, baseDay)).getUTCDay() : new Date().getDay();

        const makeYmd = (y: number, m: number, d: number): string => {
          const dt = new Date(Date.UTC(y, m - 1, d));
          if (isNaN(dt.getTime())) return todayYmd;
          return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
        };
        const lastDayOfMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
        const normalizeYear = (rawY: unknown, fallbackYear: number): number => {
          if (rawY === undefined || rawY === null || rawY === '') return fallbackYear;
          const n = Number(rawY);
          if (!Number.isFinite(n) || n <= 0) return fallbackYear;
          if (n < 100) {
            if (n >= 55) return 2500 + n - 543;
            if (n >= 20 && n <= 45) return 2000 + n;
            return fallbackYear;
          }
          if (n >= 2400) return n - 543;
          if (n >= 1900 && n <= 2150) return n;
          return fallbackYear;
        };
        const singleResult = (ymd: string, relLabel = '', isFallback = false) => ({
          ymd,
          endYmd: ymd,
          isRange: false,
          relLabel,
          hasExplicitDate: !isFallback,
        });
        const rangeResult = (startYmd: string, endYmd: string, relLabel = '') => {
          let s = startYmd;
          let e = endYmd;
          if (s > e) [s, e] = [e, s];
          return { ymd: s, endYmd: e, isRange: s !== e, relLabel, hasExplicitDate: true };
        };

        const thaiMonthMap: Record<string, number> = {
          'มกราคม': 1, 'มกรา': 1, 'มค': 1,
          'กุมภาพันธ์': 2, 'กุมภา': 2, 'กพ': 2,
          'มีนาคม': 3, 'มีนา': 3, 'มีค': 3,
          'เมษายน': 4, 'เมษา': 4, 'เมย': 4,
          'พฤษภาคม': 5, 'พฤษภา': 5, 'พค': 5,
          'มิถุนายน': 6, 'มิถุนา': 6, 'มิย': 6,
          'กรกฎาคม': 7, 'กรกฎา': 7, 'กค': 7,
          'สิงหาคม': 8, 'สิงหา': 8, 'สค': 8,
          'กันยายน': 9, 'กันยา': 9, 'กย': 9,
          'ตุลาคม': 10, 'ตุลา': 10, 'ตค': 10,
          'พฤศจิกายน': 11, 'พฤศจิกา': 11, 'พย': 11,
          'ธันวาคม': 12, 'ธันวา': 12, 'ธค': 12,
        };
        const monthPattern =
          '(มกราคม|มกรา|ม\\.?\\s*ค\\.?|กุมภาพันธ์|กุมภา|ก\\.?\\s*พ\\.?|มีนาคม|มีนา|มี\\.?\\s*ค\\.?|เมษายน|เมษา|เม\\.?\\s*ย\\.?|พฤษภาคม|พฤษภา|พ\\.?\\s*ค\\.?|มิถุนายน|มิถุนา|มิ\\.?\\s*ย\\.?|กรกฎาคม|กรกฎา|ก\\.?\\s*ค\\.?|สิงหาคม|สิงหา|ส\\.?\\s*ค\\.?|กันยายน|กันยา|ก\\.?\\s*ย\\.?|ตุลาคม|ตุลา|ต\\.?\\s*ค\\.?|พฤศจิกายน|พฤศจิกา|พ\\.?\\s*ย\\.?|ธันวาคม|ธันวา|ธ\\.?\\s*ค\\.?)';
        const resolveMonth = (rawM: string): number =>
          thaiMonthMap[String(rawM || '').replace(/[\s.]/g, '')] || 0;

        // 1. Explicit ISO range / single
        const isoRM = q.match(/(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:-|–|—|ถึง)\s*(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (isoRM) {
          return rangeResult(
            makeYmd(normalizeYear(isoRM[1], baseYear), Number(isoRM[2]), Number(isoRM[3])),
            makeYmd(normalizeYear(isoRM[4], baseYear), Number(isoRM[5]), Number(isoRM[6]))
          );
        }
        const isoM = q.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (isoM) {
          return singleResult(makeYmd(normalizeYear(isoM[1], baseYear), Number(isoM[2]), Number(isoM[3])));
        }

        // 2. Explicit Thai month date ranges
        const tmCrossRe = new RegExp(
          `(?:ที่\\s*)?(\\d{1,2})\\s*${monthPattern}(?:\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{2,4})(?!\\s*[:.]\\d|\\s*น\\.))?\\s*(?:-|–|—|ถึง)\\s*(?:ที่\\s*)?(\\d{1,2})\\s*${monthPattern}(?:\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{2,4})(?!\\s*[:.]\\d|\\s*น\\.))?`
        );
        const tmCross = q.match(tmCrossRe);
        if (tmCross) {
          const cd1 = Number(tmCross[1]);
          const cm1 = resolveMonth(tmCross[2]);
          const cy1 = normalizeYear(tmCross[3], baseYear);
          const cd2 = Number(tmCross[4]);
          const cm2 = resolveMonth(tmCross[5]);
          const cy2 = normalizeYear(tmCross[6], cy1);
          if (cm1 && cm2 && cd1 >= 1 && cd1 <= 31 && cd2 >= 1 && cd2 <= 31) {
            return rangeResult(makeYmd(cy1, cm1, cd1), makeYmd(cy2, cm2, cd2));
          }
        }
        const tmSameRe = new RegExp(
          `(?:ที่\\s*)?(\\d{1,2})\\s*(?:-|–|—|ถึง)\\s*(\\d{1,2})\\s*${monthPattern}(?:\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{2,4})(?!\\s*[:.]\\d|\\s*น\\.))?`
        );
        const tmSame = q.match(tmSameRe);
        if (tmSame) {
          const sd1 = Number(tmSame[1]);
          const sd2 = Number(tmSame[2]);
          const smm = resolveMonth(tmSame[3]);
          const syy = normalizeYear(tmSame[4], baseYear);
          if (smm && sd1 >= 1 && sd1 <= 31 && sd2 >= 1 && sd2 <= 31) {
            return rangeResult(makeYmd(syy, smm, sd1), makeYmd(syy, smm, sd2));
          }
        }

        // 3. Explicit Single Thai month date
        const tmSingleRe = new RegExp(
          `(?:ที่\\s*)?(\\d{1,2})\\s*${monthPattern}(?:\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{2,4})(?!\\s*[:.]\\d|\\s*น\\.))?`
        );
        const tmMatch = q.match(tmSingleRe);
        if (tmMatch) {
          const td = Number(tmMatch[1]);
          const tm = resolveMonth(tmMatch[2]);
          if (tm && td >= 1 && td <= 31) {
            const ty = normalizeYear(tmMatch[3], baseYear);
            return singleResult(makeYmd(ty, tm, td));
          }
        }

        // 4. Numeric DD/MM(/YYYY) range & single, plus DD.MM.YYYY
        const slashRangeM = q.match(
          /(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s*(?:-|–|—|ถึง)\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/
        );
        if (slashRangeM) {
          const rsd1 = Number(slashRangeM[1]);
          const rsm1 = Number(slashRangeM[2]);
          const rsy1 = normalizeYear(slashRangeM[3], baseYear);
          const rsd2 = Number(slashRangeM[4]);
          const rsm2 = Number(slashRangeM[5]);
          const rsy2 = normalizeYear(slashRangeM[6], rsy1);
          if (rsd1 >= 1 && rsd1 <= 31 && rsm1 >= 1 && rsm1 <= 12 && rsd2 >= 1 && rsd2 <= 31 && rsm2 >= 1 && rsm2 <= 12) {
            return rangeResult(makeYmd(rsy1, rsm1, rsd1), makeYmd(rsy2, rsm2, rsd2));
          }
        }
        const slashM = q.match(/(?:ที่\s*)?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
        if (slashM) {
          const sd = Number(slashM[1]);
          const sm = Number(slashM[2]);
          if (sd >= 1 && sd <= 31 && sm >= 1 && sm <= 12) {
            return singleResult(makeYmd(normalizeYear(slashM[3], baseYear), sm, sd));
          }
        }
        const dotM = q.match(/(?:ที่\s*)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
        if (dotM) {
          const dd1 = Number(dotM[1]);
          const dm1 = Number(dotM[2]);
          if (dd1 >= 1 && dd1 <= 31 && dm1 >= 1 && dm1 <= 12) {
            return singleResult(makeYmd(normalizeYear(dotM[3], baseYear), dm1, dd1));
          }
        }

        // 5. Relative days & offsets
        if (q.includes('เมื่อวานซืน') || q.includes('วานซืน')) return singleResult(addDaysBangkokYmd(todayYmd, -2), 'เมื่อวานซืน');
        if (q.includes('เมื่อวาน') || q.includes('วานนี้')) return singleResult(addDaysBangkokYmd(todayYmd, -1), 'เมื่อวาน');
        if (q.includes('มะเรื่อง')) return singleResult(addDaysBangkokYmd(todayYmd, 3), 'มะเรื่อง');
        if (q.includes('มะรืน')) return singleResult(addDaysBangkokYmd(todayYmd, 2), 'มะรืนนี้');
        if (q.includes('พรุ่งนี้') || q.includes('พรุ้งนี้')) return singleResult(addDaysBangkokYmd(todayYmd, 1), 'พรุ่งนี้');
        if (q.includes('วันนี้')) return singleResult(todayYmd, 'วันนี้');

        const thaiNumWords: Record<string, number> = {
          'หนึ่ง': 1, 'สอง': 2, 'สาม': 3, 'สี่': 4, 'ห้า': 5,
          'หก': 6, 'เจ็ด': 7, 'แปด': 8, 'เก้า': 9, 'สิบ': 10,
        };
        const parseCountWord = (w?: string) => (!w ? 0 : /^\d+$/.test(w) ? Number(w) : thaiNumWords[w] || 0);
        const pastDaysM = q.match(/(\d+|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*(?:วันก่อน|วันที่แล้ว)/);
        if (pastDaysM) {
          const pn = parseCountWord(pastDaysM[1]);
          if (pn > 0 && pn <= 90) return singleResult(addDaysBangkokYmd(todayYmd, -pn), `${pn} วันที่แล้ว`);
        }
        const fwdDaysM = q.match(
          /(?:อีก\s*(\d+|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*วัน|(\d+|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*วันข้างหน้า)/
        );
        if (fwdDaysM) {
          const fn = parseCountWord(fwdDaysM[1] || fwdDaysM[2]);
          if (fn > 0 && fn <= 90) return singleResult(addDaysBangkokYmd(todayYmd, fn), `อีก ${fn} วัน`);
        }

        // Normalize "วันอาทิตย์" before week-modifier checks
        const qMarked = q.replace(/วัน\s*อาทิตย์/g, 'วัน__sun__');
        const hasLastWeekMod = /(?:สัปดาห์ที่แล้ว|สัปดาห์ที่ผ่านมา|สัปดาห์ก่อน|อาทิตย์ที่แล้ว|อาทิตย์ที่ผ่านมา|อาทิตย์ก่อน|วีคที่แล้ว|วีคก่อน)/.test(
          qMarked
        );
        const hasNextWeekMod = /(?:สัปดาห์หน้า|สัปดาห์ถัดไป|อาทิตย์หน้า|อาทิตย์ถัดไป|วีคหน้า)/.test(qMarked);
        const hasThisWeekMod = /(?:สัปดาห์นี้|อาทิตย์นี้|วีคนี้)/.test(qMarked);
        const hasPastMod = /(?:ที่ผ่านมา|ที่แล้ว|ก่อนหน้า|ก่อนนี้|เมื่อวัน|ล่าสุด)/.test(q) || /(?:^|\s)เมื่อ/.test(q);
        const hasFutureMod = /(?:หน้า|ถัดไป|ที่จะถึง|ข้างหน้า)/.test(q);

        // 6. Thai weekdays (past / future / week modifiers)
        const weekdayRules = [
          { kw: 'วัน__sun__', dow: 0 },
          { kw: 'จันทร์', dow: 1 },
          { kw: 'อังคาร', dow: 2 },
          { kw: 'พุธ', dow: 3 },
          { kw: 'พฤหัส', dow: 4 },
          { kw: 'ศุกร์', dow: 5 },
          { kw: 'เสาร์', dow: 6 },
        ];
        for (const rule of weekdayRules) {
          if (qMarked.includes(rule.kw)) {
            if (hasLastWeekMod) {
              const monBack = (curDow === 0 ? -6 : 1 - curDow) - 7;
              const offset = rule.dow === 0 ? 6 : rule.dow - 1;
              return singleResult(addDaysBangkokYmd(todayYmd, monBack + offset));
            }
            if (hasNextWeekMod) {
              const monFwd = (curDow === 0 ? -6 : 1 - curDow) + 7;
              const offset = rule.dow === 0 ? 6 : rule.dow - 1;
              return singleResult(addDaysBangkokYmd(todayYmd, monFwd + offset));
            }
            if (hasPastMod) {
              let back = (curDow - rule.dow + 7) % 7;
              if (back === 0) back = 7;
              return singleResult(addDaysBangkokYmd(todayYmd, -back));
            }
            if (hasFutureMod) {
              let fwd = (rule.dow - curDow + 7) % 7;
              if (fwd === 0) fwd = 7;
              return singleResult(addDaysBangkokYmd(todayYmd, fwd));
            }
            const diff = (rule.dow - curDow + 7) % 7;
            return singleResult(addDaysBangkokYmd(todayYmd, diff));
          }
        }

        // Relative month shifts
        let targetMonthOffset = 0;
        if (/เดือนที่แล้ว|เดือนที่ผ่านมา|เดือนก่อน/.test(q)) targetMonthOffset = -1;
        else if (/เดือนหน้า|เดือนถัดไป/.test(q)) targetMonthOffset = 1;
        const shiftedDt = new Date(Date.UTC(baseYear, baseMonth - 1 + targetMonthOffset, 1));
        const effYear = shiftedDt.getUTCFullYear();
        const effMonth = shiftedDt.getUTCMonth() + 1;

        // 7. Day-of-month range or single day number
        const dayRangeM = q.match(/(?:วันที่|ที่)\s*(\d{1,2})\s*(?:-|–|—|ถึง)\s*(\d{1,2})(?!\d)/);
        if (dayRangeM) {
          const dr1 = Number(dayRangeM[1]);
          const dr2 = Number(dayRangeM[2]);
          if (dr1 >= 1 && dr1 <= 31 && dr2 >= 1 && dr2 <= 31) {
            return rangeResult(makeYmd(effYear, effMonth, dr1), makeYmd(effYear, effMonth, dr2));
          }
        }
        const dayOnlyM = q.match(/(?:วันที่|ที่)\s*(\d{1,2})(?!\d)/);
        if (dayOnlyM) {
          const dd = Number(dayOnlyM[1]);
          if (dd >= 1 && dd <= 31) return singleResult(makeYmd(effYear, effMonth, dd));
        }

        // 8. Whole Week queries
        if (hasLastWeekMod) {
          const lwMon = addDaysBangkokYmd(todayYmd, (curDow === 0 ? -6 : 1 - curDow) - 7);
          return rangeResult(lwMon, addDaysBangkokYmd(lwMon, 6), 'สัปดาห์ที่ผ่านมา');
        }
        if (hasNextWeekMod) {
          const nwMon = addDaysBangkokYmd(todayYmd, (curDow === 0 ? -6 : 1 - curDow) + 7);
          return rangeResult(nwMon, addDaysBangkokYmd(nwMon, 6), 'สัปดาห์หน้า');
        }
        if (hasThisWeekMod) {
          const twMon = addDaysBangkokYmd(todayYmd, curDow === 0 ? -6 : 1 - curDow);
          return rangeResult(twMon, addDaysBangkokYmd(twMon, 6), 'สัปดาห์นี้');
        }

        // 9. Whole Month queries
        const explicitMonthRe = new RegExp(`(?:เดือน\\s*)${monthPattern}(?:\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{2,4}))?`);
        const expMM = q.match(explicitMonthRe);
        if (expMM) {
          const em = resolveMonth(expMM[1]);
          if (em) {
            const ey = normalizeYear(expMM[2], baseYear);
            return rangeResult(makeYmd(ey, em, 1), makeYmd(ey, em, lastDayOfMonth(ey, em)));
          }
        }
        if (/เดือนนี้|เดือนที่แล้ว|เดือนที่ผ่านมา|เดือนก่อน|เดือนหน้า|เดือนถัดไป/.test(q)) {
          const mLabel = targetMonthOffset < 0 ? 'เดือนที่ผ่านมา' : targetMonthOffset > 0 ? 'เดือนหน้า' : 'เดือนนี้';
          return rangeResult(makeYmd(effYear, effMonth, 1), makeYmd(effYear, effMonth, lastDayOfMonth(effYear, effMonth)), mLabel);
        }

        return singleResult(todayYmd, 'วันนี้', true);
      };

      const fetchLineSenderNameServer = async (
        evSource: { groupId?: string; roomId?: string; userId?: string }
      ): Promise<string> => {
        if (!token || !evSource?.userId) return 'สมาชิกกลุ่ม';
        try {
          const uid = String(evSource.userId).trim();
          const gid = String(evSource.groupId || '').trim();
          const url = gid
            ? `https://api.line.me/v2/bot/group/${encodeURIComponent(gid)}/member/${encodeURIComponent(uid)}`
            : `https://api.line.me/v2/bot/profile/${encodeURIComponent(uid)}`;
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (res.ok) {
            const data = (await res.json()) as { displayName?: string };
            if (data?.displayName) return String(data.displayName).trim();
          }
        } catch {
          // ignore
        }
        return 'สมาชิกกลุ่ม';
      };

      const detectGroupNoteCategoryServer = (content: string): string => {
        const c = String(content || '').toLowerCase();
        if (/ลงนัด|นัดหมาย|ตารางนัด|มีนัด|นัดประชุม|เตือนความจำ|เตือนให้|reminder/.test(c)) return 'นัดหมาย/เตือนความจำ';
        if (/สั่งงาน|งานค้าง|มอบหมาย|action item|to-do|todo/.test(c)) return 'งานที่ต้องทำ/To-Do';
        if (/สลับเวร|อยู่เวร|ตารางเวร|นอกเวลา|\bot\b|โอที/.test(c)) return 'ตารางเวร/สลับเวร';
        if (/ข้อตกลง|มติ|กติกา|เงื่อนไข|ตกลงตาม/.test(c)) return 'ข้อตกลง/มติ';
        if (/ประกาศ|แจ้งเวียน|ประชุม|ปิดบริการ|งดตรวจ|วันหยุด/.test(c)) return 'ประกาศ/แจ้งเวียน';
        return 'บันทึกช่วยจำ';
      };

      const isPrivateNoteRecordServer = (n?: ServerGroupNote): boolean =>
        Boolean(n && (String(n.groupId || '').startsWith('PRIVATE:') || String(n.category || '').includes('[ส่วนตัว]')));

      const readVisibleNotesServer = (list: ServerGroupNote[], isGroupChat: boolean, userId?: string): ServerGroupNote[] => {
        const uid = String(userId || '').trim();
        return list.filter((n) => {
          if (!n.content || n.status === 'ARCHIVED') return false;
          const priv = isPrivateNoteRecordServer(n);
          if (isGroupChat) return !priv;
          if (!priv) return true;
          const gid = String(n.groupId || '').trim();
          if (gid === 'PRIVATE:' || gid === 'PRIVATE') return true;
          return uid ? gid === `PRIVATE:${uid}` : false;
        });
      };

      const formatBoobyPersonaReplyServer = (rawText: string, speakerCall: string, addClosingWit = false): string => {
        const txt = String(rawText || '').trim();
        if (!txt) return '';
        const lines = txt.split('\n');
        const outLines: string[] = [];
        for (const line of lines) {
          if (/^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(line)) continue;
          if (/^\s*\|.*\|\s*$/.test(line)) {
            const cells = line
              .replace(/^\s*\|/, '')
              .replace(/\|\s*$/, '')
              .split('|')
              .map((c) => c.trim())
              .filter(Boolean);
            if (cells.length > 0) outLines.push(`• ${cells.join(' — ')}`);
            continue;
          }
          outLines.push(line);
        }
        let cleaned = outLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
        if (addClosingWit && cleaned.length > 60 && !cleaned.includes('☕') && !cleaned.includes('✨ หาก')) {
          const closingOffers = [
            '\n\n☕ หากต้องการให้บูบี้ช่วยจัดทำรายงาน หรือดำเนินการเพิ่มเติมในจุดใด แจ้งได้เลยนะครับ',
            '\n\n✨ หากมีข้อมูลส่วนใดให้บูบี้ช่วยกลั่นกรองเพิ่มเติม บอกได้ทุกเมื่อเลยครับ',
            '\n\n🎩 หากต้องการให้สรุปส่งเข้าที่ประชุมหรือปรับแก้จุดใด แจ้งบูบี้ได้ทันทีครับ',
          ];
          const pickIdx = (cleaned.length + (speakerCall ? speakerCall.length : 0)) % closingOffers.length;
          cleaned += closingOffers[pickIdx];
        }
        return cleaned;
      };

      const stripThaiHonorificsServer = (name: string): string =>
        String(name || '')
          .trim()
          .toLowerCase()
          .replace(/^(?:นางสาว|นาง|นาย|น\.ส\.|ดร\.|ผศ\.|รศ\.|ศ\.|พว\.|นพ\.|พญ\.|ทพ\.|ภก\.|คุณ|พี่|น้อง|หัวหน้า)\s*/g, '')
          .replace(/\s+/g, ' ')
          .trim();

      const extractCandidatePersonServer = (rawText: string): string => {
        const cleaned = String(rawText || '')
          .trim()
          .replace(/^@?บูบี้\s*/i, '')
          .replace(/^(?:ช่วยเช็ค|ช่วยดู|เช็ค|สอบถาม|ถามหน่อย|อยากรู้ว่า|ดูให้หน่อยว่า)\s*/i, '')
          .replace(/^(?:นาย|นางสาว|นาง|น\.ส\.|พว\.|นพ\.|พญ\.|คุณ|พี่|น้อง)\s*/i, '')
          .trim();
        const m = cleaned.match(
          /^([\u0E00-\u0E7Fa-zA-Z.]{2,30}(?:\s+[\u0E00-\u0E7Fa-zA-Z.]{2,30})?)\s+(?:ลา|อยู่\s*ot|ขึ้นเวร|อยู่เวร|อยู่คลินิก|ตำแหน่ง|รหัส|เบิก|มี\s*ot)/i
        );
        if (!m) return '';
        const cand = String(m[1] || '').trim();
        if (/^(?:ใคร|วัน|พรุ่งนี้|วันนี้|เมื่อวาน|มะรืน|สัปดาห์|อาทิตย์|เดือน|คลินิก|ห้อง|ทั้งหมด|สรุป|ยอด|ช่วย|ที่|มี|ทำไม|หรือ)$/i.test(cand)) {
          return '';
        }
        return cand;
      };

      const DEFAULT_IN_CLINICS_SERVER = [
        'กุมารเวชกรรม', 'สูติ-นรีเวชกรรม', 'ศัลยกรรมกระดูก', 'เวชศาสตร์ฟื้นฟู', 'ศัลยกรรม',
        'จักษุวิทยา', 'ศูนย์เลสิก', 'โสต ศอ นาสิก', 'อายุรกรรม', 'ตรวจโรคทั่วไป',
        'Echo', 'AAIRC', 'ODS', 'ประกันสังคม', 'หน่วยคัดกรอง', 'ศูนย์รับ - ส่งต่อผู้ป่วย',
      ];
      const DEFAULT_OUT_CLINICS_SERVER = [
        'ตรวจโรคทั่วไป', 'กุมารเวชกรรม', 'สูติ-นรีเวชกรรม', 'ศัลยกรรมกระดูก', 'ศัลยกรรม',
        'จักษุวิทยา', 'โสต ศอ นาสิก', 'อายุรกรรม', 'คลินิกหัวใจ', 'หน่วยคัดกรอง',
      ];

      const getHolidaysMapServer = (
        ceYear: number,
        customHolidays: Array<{ date?: string; name?: string }> = []
      ): Map<string, { name: string; isCustom: boolean }> => {
        const fixed: Array<[string, string]> = [
          ['01-01', 'วันขึ้นปีใหม่'],
          ['04-06', 'วันจักรี'],
          ['04-13', 'วันสงกรานต์'],
          ['04-14', 'วันสงกรานต์'],
          ['04-15', 'วันสงกรานต์'],
          ['05-04', 'วันฉัตรมงคล'],
          ['06-03', 'วันเฉลิมพระชนมพรรษา พระบรมราชินี'],
          ['07-28', 'วันเฉลิมพระชนมพรรษา ในหลวง ร.10'],
          ['08-12', 'วันแม่แห่งชาติ'],
          ['10-13', 'วันนวมินทรมหาราช'],
          ['10-23', 'วันปิยมหาราช'],
          ['12-05', 'วันพ่อแห่งชาติ / วันชาติ'],
          ['12-10', 'วันรัฐธรรมนูญ'],
          ['12-31', 'วันสิ้นปี'],
        ];
        const lunarByYear: Record<number, Array<{ date: string; name: string; noSub?: boolean }>> = {
          2024: [
            { date: '2024-02-24', name: 'วันมาฆบูชา' },
            { date: '2024-05-10', name: 'วันพืชมงคล', noSub: true },
            { date: '2024-05-22', name: 'วันวิสาขบูชา' },
            { date: '2024-07-20', name: 'วันอาสาฬหบูชา' },
            { date: '2024-07-21', name: 'วันเข้าพรรษา' },
          ],
          2025: [
            { date: '2025-02-12', name: 'วันมาฆบูชา' },
            { date: '2025-05-09', name: 'วันพืชมงคล', noSub: true },
            { date: '2025-05-11', name: 'วันวิสาขบูชา' },
            { date: '2025-07-10', name: 'วันอาสาฬหบูชา' },
            { date: '2025-07-11', name: 'วันเข้าพรรษา' },
          ],
          2026: [
            { date: '2026-03-03', name: 'วันมาฆบูชา' },
            { date: '2026-05-13', name: 'วันพืชมงคล', noSub: true },
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
        const map = new Map<string, { name: string; isCustom: boolean }>();
        const pendingSubs: Array<{ iso: string; name: string }> = [];
        for (const [md, name] of fixed) {
          const iso = `${ceYear}-${md}`;
          const p = iso.split('-').map(Number);
          const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
          map.set(iso, { name, isCustom: false });
          if (dow === 0 || dow === 6) pendingSubs.push({ iso, name: `วันหยุดชดเชย${name}` });
        }
        const prevDecDow = new Date(Date.UTC(ceYear - 1, 11, 31)).getUTCDay();
        if (prevDecDow === 0 || prevDecDow === 6) {
          pendingSubs.push({ iso: `${ceYear - 1}-12-31`, name: 'วันหยุดชดเชยวันสิ้นปี' });
        }
        for (const item of lunarByYear[ceYear] || []) {
          const p = item.date.split('-').map(Number);
          const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
          map.set(item.date, { name: item.name, isCustom: false });
          if (!item.noSub && (dow === 0 || dow === 6)) {
            pendingSubs.push({ iso: item.date, name: `วันหยุดชดเชย${item.name}` });
          }
        }
        for (const sub of pendingSubs) {
          let cursor = addDaysBangkokYmd(sub.iso, 1);
          for (let g = 0; g < 14; g++) {
            const p = cursor.split('-').map(Number);
            const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
            if (dow !== 0 && dow !== 6 && !map.has(cursor)) {
              if (p[0] === ceYear) map.set(cursor, { name: sub.name, isCustom: false });
              break;
            }
            cursor = addDaysBangkokYmd(cursor, 1);
          }
        }
        for (const ch of customHolidays || []) {
          const dNorm = normalizeDbDateServer(ch?.date);
          if (dNorm && dNorm.startsWith(`${ceYear}-`)) {
            map.set(dNorm, { name: String(ch?.name || 'วันหยุดพิเศษ รพ.').trim(), isCustom: true });
          }
        }
        return map;
      };

      const isWeekendOrHolidayServer = (
        ymd: string,
        customHolidays: Array<{ date?: string; name?: string }> = []
      ): boolean => {
        const p = ymd.split('-').map(Number);
        if (p.length !== 3) return false;
        const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
        if (dow === 0 || dow === 6) return true;
        return getHolidaysMapServer(p[0], customHolidays).has(ymd);
      };

      const parseWorkloadMetaServer = (w: any) => {
        const rawNote = String(w?.note || '').trim();
        let referralData = w?.referralData && typeof w.referralData === 'object' ? w.referralData : null;
        if (!referralData) {
          const refM = rawNote.match(/\[\[REFERRAL_JSON:([\s\S]*?)\]\]/);
          if (refM) {
            try {
              referralData = JSON.parse(refM[1]);
            } catch {
              referralData = null;
            }
          }
        }
        let isOffDuty = Boolean(w?.isOffDuty);
        let offDutyReason = String(w?.offDutyReason || '').trim();
        const offM = rawNote.match(/\[\[OFF_DUTY_JSON:([\s\S]*?)\]\]/);
        if (offM) {
          isOffDuty = true;
          try {
            const po = JSON.parse(offM[1]);
            if (!offDutyReason && (po?.r || po?.reason)) offDutyReason = String(po.r || po.reason).trim();
          } catch {
            // keep isOffDuty
          }
        }
        let offDutyStaff: Array<{ staffName: string; position: string; amount: number; periodLabel?: string; reason?: string }> =
          Array.isArray(w?.offDutyStaff) ? w.offDutyStaff : [];
        if (offDutyStaff.length === 0) {
          const osM = rawNote.match(/\[\[OFF_STAFF_JSON:([\s\S]*?)\]\]/);
          if (osM) {
            try {
              const arr = JSON.parse(osM[1]);
              if (Array.isArray(arr)) {
                offDutyStaff = arr
                  .filter((it: any) => it && (it.staffName || it.n))
                  .map((it: any) => ({
                    staffName: String(it.staffName || it.n || '').trim(),
                    position: String(it.position || it.p || 'RN').trim(),
                    amount: Number(it.amount ?? it.a) === 0.5 ? 0.5 : 1,
                    periodLabel: String(it.periodLabel || it.l || '').trim(),
                    reason: String(it.reason || it.r || '').trim(),
                  }));
              }
            } catch {
              // ignore
            }
          }
        }
        const cleanNote = rawNote
          .replace(/\[\[REFERRAL_JSON:[\s\S]*?\]\]/g, '')
          .replace(/\[\[OFF_DUTY_JSON:[\s\S]*?\]\]/g, '')
          .replace(/\[\[OFF_STAFF_JSON:[\s\S]*?\]\]/g, '')
          .trim();
        return { referralData, isOffDuty, offDutyReason, offDutyStaff, cleanNote };
      };

      const extractClinicMatchServer = (q: string, settingsObj: any): string => {
        const aliases: Array<{ kw: string; target: string }> = [
          { kw: 'ศูนย์ปัญญาภิรมย์', target: 'ศูนย์ปัญญาภิรมย์' },
          { kw: 'ปัญญาภิรมย์', target: 'ศูนย์ปัญญาภิรมย์' },
          { kw: 'พรีเมียม', target: 'ศูนย์ปัญญาภิรมย์' },
          { kw: 'premium', target: 'ศูนย์ปัญญาภิรมย์' },
          { kw: 'ศูนย์รับ - ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
          { kw: 'ศูนย์รับ-ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
          { kw: 'ห้องรับ-ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
          { kw: 'รับ - ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
          { kw: 'รับ-ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
          { kw: 'ศูนย์รับส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
          { kw: 'ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
          { kw: 'refer', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
          { kw: 'ศัลยกรรมกระดูก', target: 'ศัลยกรรมกระดูก' },
          { kw: 'ออร์โธ', target: 'ศัลยกรรมกระดูก' },
          { kw: 'ortho', target: 'ศัลยกรรมกระดูก' },
          { kw: 'กระดูก', target: 'ศัลยกรรมกระดูก' },
          { kw: 'เวชศาสตร์ฟื้นฟู', target: 'เวชศาสตร์ฟื้นฟู' },
          { kw: 'ฟื้นฟู', target: 'เวชศาสตร์ฟื้นฟู' },
          { kw: 'กายภาพ', target: 'เวชศาสตร์ฟื้นฟู' },
          { kw: 'สูติ-นรีเวชกรรม', target: 'สูติ-นรีเวชกรรม' },
          { kw: 'สูติ', target: 'สูติ-นรีเวชกรรม' },
          { kw: 'นรีเวช', target: 'สูติ-นรีเวชกรรม' },
          { kw: 'กุมารเวชกรรม', target: 'กุมารเวชกรรม' },
          { kw: 'กุมาร', target: 'กุมารเวชกรรม' },
          { kw: 'คลินิกเด็ก', target: 'กุมารเวชกรรม' },
          { kw: 'ตรวจโรคทั่วไป', target: 'ตรวจโรคทั่วไป' },
          { kw: 'ตรวจโรค', target: 'ตรวจโรคทั่วไป' },
          { kw: 'gp', target: 'ตรวจโรคทั่วไป' },
          { kw: 'โสต ศอ นาสิก', target: 'โสต ศอ นาสิก' },
          { kw: 'หูคอจมูก', target: 'โสต ศอ นาสิก' },
          { kw: 'หู คอ จมูก', target: 'โสต ศอ นาสิก' },
          { kw: 'โสต', target: 'โสต ศอ นาสิก' },
          { kw: 'ent', target: 'โสต ศอ นาสิก' },
          { kw: 'ศูนย์เลสิก', target: 'ศูนย์เลสิก' },
          { kw: 'เลสิก', target: 'ศูนย์เลสิก' },
          { kw: 'จักษุวิทยา', target: 'จักษุวิทยา' },
          { kw: 'จักษุ', target: 'จักษุวิทยา' },
          { kw: 'คลินิกตา', target: 'จักษุวิทยา' },
          { kw: 'อายุรกรรม', target: 'อายุรกรรม' },
          { kw: 'อายุร', target: 'อายุรกรรม' },
          { kw: 'ศัลยกรรม', target: 'ศัลยกรรม' },
          { kw: 'ศัลย์', target: 'ศัลยกรรม' },
          { kw: 'หน่วยคัดกรอง', target: 'หน่วยคัดกรอง' },
          { kw: 'คัดกรอง', target: 'หน่วยคัดกรอง' },
          { kw: 'ประกันสังคม', target: 'ประกันสังคม' },
          { kw: 'คลินิกหัวใจ', target: 'คลินิกหัวใจ' },
          { kw: 'หัวใจ', target: 'คลินิกหัวใจ' },
          { kw: 'echo', target: 'Echo' },
          { kw: 'aairc', target: 'AAIRC' },
          { kw: 'ods', target: 'ODS' },
        ];
        const extraClinics: string[] = [
          ...(Array.isArray(settingsObj?.inTimeClinics) ? settingsObj.inTimeClinics : []),
          ...(Array.isArray(settingsObj?.outTimeClinics) ? settingsObj.outTimeClinics : []),
          ...(Array.isArray(settingsObj?.premiumSubClinics) ? settingsObj.premiumSubClinics : []),
        ].map((c: unknown) => String(c || '').trim());
        const containsClinicKw = (keyword: string): boolean => {
          const k = String(keyword || '').toLowerCase();
          if (!k) return false;
          if (/^[a-z0-9\s-]+$/.test(k)) {
            const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`(?:^|[^a-z0-9])${esc}(?:[^a-z0-9]|$)`).test(q);
          }
          return q.includes(k);
        };
        for (const cName of extraClinics) {
          if (cName && containsClinicKw(cName)) return cName;
        }
        for (const a of aliases) {
          if (containsClinicKw(a.kw)) return a.target;
        }
        return '';
      };

      const getOtHourlyRateServer = (pos: string, customRates?: Record<string, number>): number => {
        if (customRates && Number.isFinite(Number(customRates[pos])) && Number(customRates[pos]) > 0) {
          return Number(customRates[pos]);
        }
        const p = String(pos || '').trim().toUpperCase();
        if (p.includes('HN') || p.includes('RN') || p.includes('พยาบาลวิชาชีพ') || p === 'พยาบาล') return 150;
        if (p.includes('CLERK') || p.includes('SERVICE') || p.includes('พนักงาน') || p.includes('ธุรการ')) return 75;
        return 95;
      };

      for (const ev of events) {
        const src = ev?.source;
        if (!src) continue;
        const isGroupChat = Boolean(src.groupId || src.roomId);
        const detectedId = String(src.groupId || src.roomId || src.userId || '').trim();
        if (!detectedId) continue;

        let groupName = '';
        if (src.groupId && token) {
          try {
            const grpRes = await fetch(
              `https://api.line.me/v2/bot/group/${encodeURIComponent(detectedId)}/summary`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (grpRes.ok) {
              const grpData = (await grpRes.json()) as { groupName?: string };
              groupName = String(grpData.groupName || '').trim();
            }
          } catch {
            // ignore group summary lookup errors during webhook event handling
          }
        }

        if (isGroupChat) {
          serverLineState.detectedGroupId = detectedId;
          if (groupName) {
            serverLineState.detectedGroupName = groupName;
          }
        }

        const rawText =
          ev.type === 'message' && ev.message?.type === 'text'
            ? String(ev.message.text || '').trim()
            : '';
        const txt = rawText.toLowerCase();

        if (token && ev.replyToken && txt) {
          let replyText = '';
          let addClosingWit = false;
          const sdb = loadServerDb() || {};
          const settingsObj = sdb?.settings || {};
          const ownerCallName =
            String(settingsObj.boobyOwnerName || serverLineState.boobyOwnerName || 'คุณทรงยศ').trim() || 'คุณทรงยศ';
          const ownerUserId = String(settingsObj.boobyOwnerUserId || serverLineState.boobyOwnerUserId || '').trim();
          const groupMentionOnly =
            settingsObj.boobyGroupMentionOnly !== undefined
              ? Boolean(settingsObj.boobyGroupMentionOnly)
              : serverLineState.boobyGroupMentionOnly !== false;

          const isIdCmd = txt === '/id' || txt === '/groupid' || txt === 'ขอรหัสกลุ่ม' || txt === 'id' || txt === 'whoami';
          const isMentioned = /บูบี้|booby/i.test(rawText);
          const isReplyToQuote = Boolean(ev.message?.quotedMessageId);

          if (isGroupChat && groupMentionOnly && !isIdCmd && !isMentioned && !isReplyToQuote) {
            continue;
          }

          const senderName = await fetchLineSenderNameServer(src);
          const ownerStripped = stripThaiHonorificsServer(ownerCallName);
          const senderStripped = stripThaiHonorificsServer(senderName);
          const isOwner = Boolean(
            (ownerUserId && src.userId === ownerUserId) ||
              !isGroupChat ||
              (ownerStripped && senderStripped && (senderStripped.includes(ownerStripped) || ownerStripped.includes(senderStripped)))
          );
          const speakerCall = isOwner
            ? ownerCallName
            : senderName && senderName !== 'สมาชิกกลุ่ม'
            ? `คุณ${senderName.replace(/^คุณ\s*/, '')}`
            : 'ทุกท่าน';

          const groupNotesList: ServerGroupNote[] = Array.isArray(sdb.groupNotes) ? sdb.groupNotes : [];
          const visibleNotes = readVisibleNotesServer(groupNotesList, isGroupChat, src.userId);
          const cmdText = rawText.replace(/@?บูบี้/gi, '').replace(/\bbooby\b/gi, '').trim();
          const cmdLower = cmdText.toLowerCase();
          const wantsPrivateScope = !isGroupChat || /ส่วนตัว|เฉพาะผม|เฉพาะฉัน|ความลับ/.test(cmdLower);
          const noteGroupScopeId = wantsPrivateScope ? `PRIVATE:${String(src.userId || detectedId)}` : detectedId;

          const persistNewNote = (content: string, explicitCat = '', isPriv = wantsPrivateScope): ServerGroupNote => {
            const nowBkk = getBangkokDateParts();
            const compactTs = nowBkk.ymd.replace(/-/g, '').slice(2) + '-' + nowBkk.hm.replace(':', '');
            const idTag = `N-${compactTs}-${Math.floor(10 + Math.random() * 89)}`;
            const baseCat = explicitCat || detectGroupNoteCategoryServer(content);
            const category = isPriv && !baseCat.includes('[ส่วนตัว]') ? `[ส่วนตัว] ${baseCat}` : baseCat;
            const newNote: ServerGroupNote = {
              id: idTag,
              timestamp: nowBkk.timestamp,
              category,
              content: content.trim(),
              savedBy: speakerCall,
              groupId: isPriv ? `PRIVATE:${String(src.userId || detectedId)}` : detectedId,
              keywords: content
                .toLowerCase()
                .replace(/[^\u0E00-\u0E7Fa-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter((t: string) => t.length >= 2)
                .slice(0, 15)
                .join(', '),
              status: 'ACTIVE',
            };
            const latestDb = loadServerDb() || {};
            const latestList: ServerGroupNote[] = Array.isArray(latestDb.groupNotes) ? latestDb.groupNotes : [];
            writeServerDb({ ...latestDb, groupNotes: [...latestList, newNote] });
            return newNote;
          };

          if (isIdCmd) {
            replyText = isGroupChat
              ? `🎩 ${speakerCall} ครับ รหัสกลุ่ม LINE (Group ID) สำหรับตั้งค่าออโตเมชั่น OPD:\n${detectedId}${groupName ? `\nกลุ่ม: ${groupName}` : ''}`
              : `🎩 สวัสดีครับ ${speakerCall} รหัส LINE User ID ของท่านคือ:\n${String(src.userId || detectedId)}\n\n💡 นำรหัส U... นี้ไปใส่ในหน้า Admin เพื่อยืนยันสิทธิ์เลขาส่วนตัว 1-on-1 ได้เลยครับ`;
          } else {
            const apptCancelMatch = cmdText.match(/^(?:ยกเลิกนัด|ลบนัด|เลื่อนนัด(?:ออก)?)\s*(.*)/i);
            const isApptRecall = /(?:ดูนัด|เช็คนัด|เช็กนัด|ตารางนัด|มีนัดอะไร|นัดหมายอะไร|นัดอะไรบ้าง|เตือนความจำอะไร|มีนัดไหม|มีนัดมั้ย)/.test(cmdLower);
            const isApptCreate = /^(?:ลงนัด|เพิ่มนัด|นัดหมาย|ตั้งเตือน|เตือนความจำ|เตือนให้|บันทึกนัด|ช่วยจำนัด|มีนัด(?:เรื่อง|กับ|ที่))/.test(cmdLower);
            const todoDoneMatch = cmdText.match(/^(?:ปิดงาน|ทำเสร็จแล้ว|เสร็จแล้ว|เคลียร์งาน)\s*(.*)/i);
            const isTodoRecall =
              /(?:งานค้าง|ดูงาน|รายการงาน|เช็คงาน|เช็กงาน|มีงานอะไรบ้าง|to-do|todo)/.test(cmdLower) &&
              !/^(?:สั่งงาน|มอบหมาย|เพิ่มงาน|แยกงาน)/.test(cmdLower);
            const isChatSummaryCmd = /^(?:สรุปแชต|สรุปข้อความ|สรุปบทสนทนา|สรุปประชุม|แยกงาน)/.test(cmdLower);
            const isTodoAddCmd = cmdText.match(/^(?:สั่งงาน|มอบหมายงาน|มอบหมาย|เพิ่มงาน|to-do|todo)\s*[:\-]?\s*(.+)/i);
            const isDraftCmd = /^(?:ร่างข้อความ|ร่างประกาศ|เขียนประกาศ|ร่างไลน์|ขอข้อความแจ้ง|ช่วยพิมพ์แจ้ง|ช่วยเขียนแจ้ง|ร่างคำชี้แจง)/.test(cmdLower);

            if (apptCancelMatch) {
              const delQ = String(apptCancelMatch[1] || '').trim().toLowerCase();
              const apptPool = visibleNotes.filter((n) => n.category.includes('นัดหมาย'));
              const targetIds = new Set<string>();
              if (!delQ || delQ === 'ล่าสุด') {
                if (apptPool.length > 0) targetIds.add(apptPool[apptPool.length - 1].id);
              } else {
                const cleanQ = delQ.replace(/^#/, '');
                apptPool.forEach((n) => {
                  if (n.id.toLowerCase() === cleanQ || n.content.toLowerCase().includes(cleanQ)) targetIds.add(n.id);
                });
              }
              const archivedAppts: ServerGroupNote[] = [];
              if (targetIds.size > 0) {
                const updated = groupNotesList.map((n) => {
                  if (targetIds.has(n.id)) {
                    archivedAppts.push(n);
                    return { ...n, status: 'ARCHIVED' as const };
                  }
                  return n;
                });
                writeServerDb({ ...sdb, groupNotes: updated });
              }
              replyText =
                archivedAppts.length > 0
                  ? `🗑️ เรียบร้อยครับ ${speakerCall} บูบี้ยกเลิกนัดหมายออกจากตารางแล้ว (${archivedAppts.length} รายการ):\n` +
                    archivedAppts.map((n) => `• #${n.id}: ${n.content.split('\n')[0]}`).join('\n')
                  : `🔍 ยังไม่พบนัดหมายที่ตรงกับ "${delQ || 'ล่าสุด'}" ครับ ${speakerCall}`;
            } else if (isApptRecall && !isApptCreate) {
              const appts = visibleNotes.filter((n) => n.category.includes('นัดหมาย'));
              const apptDateFilter = parseThaiQueryDateServer(cmdLower);
              const filtered = apptDateFilter.hasExplicitDate
                ? appts.filter((n) => n.content.includes(apptDateFilter.ymd) || n.content.includes(formatCompactThaiServer(apptDateFilter.ymd)))
                : appts;
              if (filtered.length === 0) {
                replyText = `📅 ${speakerCall} ครับ ${
                  apptDateFilter.hasExplicitDate ? `ประจำ${formatThaiShortServer(apptDateFilter.ymd)} ` : 'ขณะนี้'
                }ยังไม่มีกำหนดการนัดหมายที่บันทึกไว้ในระบบครับ\n💡 พิมพ์ "ลงนัด <วันที่> เวลา <เวลา> เรื่อง <หัวข้อ>" เพื่อให้บูบี้ลงตารางให้ได้เลยครับ`;
              } else {
                const aLines = filtered.slice(-10).map((n, idx) => {
                  const scopeTag = isPrivateNoteRecordServer(n) ? '🔒 ส่วนตัว' : '👥 ทีม/กลุ่ม';
                  return `${idx + 1}. [#${n.id} • ${scopeTag}]\n${n.content}`;
                });
                replyText = `📅 ตารางนัดหมายและการแจ้งเตือนของ ${speakerCall} (${filtered.length} รายการ):\n\n${aLines.join('\n\n')}`;
                addClosingWit = true;
              }
            } else if (isApptCreate) {
              if (isGroupChat && /ส่วนตัว|ลับ/.test(cmdLower)) {
                replyText = `🔒 ${speakerCall} ครับ เพื่อรักษาความลับ บูบี้ขอแนะนำให้ส่งนัดหมายส่วนตัวมาที่แชตส่วนตัว 1-on-1 ของบูบี้นะครับ`;
              } else {
                const apptDateInfo = parseThaiQueryDateServer(cmdLower);
                const apptTimeMatch = cmdText.match(
                  /(\d{1,2}[:.]\d{2}\s*(?:น\.?)?|\d{1,2}\s*โมง(?:\s*(?:เช้า|เย็น|ค่ำ|ครึ่ง))?|เที่ยง(?:ตรง|วัน)?|บ่าย\s*\d{1,2}\s*โมง)/i
                );
                if (!apptDateInfo.hasExplicitDate || !apptTimeMatch) {
                  const missingParts: string[] = [];
                  if (!apptDateInfo.hasExplicitDate) missingParts.push('วันที่ (เช่น พรุ่งนี้, วันศุกร์, 25 พ.ย.)');
                  if (!apptTimeMatch) missingParts.push('เวลา (เช่น 09:00 น., 13:30 น.)');
                  replyText =
                    `🎩 ${speakerCall} ครับ เพื่อไม่ให้ลงตารางคลาดเคลื่อน บูบี้ขอทราบรายละเอียดเพิ่มเติมเล็กน้อยครับ:\n• ระบุ ${missingParts.join(' และ ')} ได้เลยครับ เดี๋ยวบูบี้จัดระเบียบลงตารางให้ทันทีครับ`;
                } else {
                  let timeClean = String(apptTimeMatch[1]).replace(/\s+/g, ' ').trim();
                  if (!timeClean.includes('น.') && /\d/.test(timeClean)) timeClean += ' น.';
                  const prepMatch = cmdText.match(/(?:เตรียม|สิ่งที่ต้องเตรียม|นำ)\s*[:\-]?\s*(.+)$/i);
                  const prepText = prepMatch ? String(prepMatch[1] || '').trim() : 'เตรียมประเด็น/เอกสารที่เกี่ยวข้อง';
                  const topicText = cmdText
                    .replace(/^(?:ลงนัด|เพิ่มนัด|นัดหมาย|ตั้งเตือน|เตือนความจำ|เตือนให้|บันทึกนัด|ช่วยจำนัด)\s*[:\-]?\s*/i, '')
                    .replace(apptTimeMatch[0], ' ')
                    .replace(/(?:เตรียม|สิ่งที่ต้องเตรียม)\s*[:\-]?\s*.+$/i, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                  const formattedAppt = `📌 ${formatThaiShortServer(apptDateInfo.ymd)} เวลา ${timeClean}\n📍 ${topicText || 'นัดหมายสำคัญ'}\n🎒 เตรียม: ${prepText}`;
                  const savedAppt = persistNewNote(formattedAppt, 'นัดหมาย/เตือนความจำ', wantsPrivateScope);
                  replyText = `📅 บันทึกนัดหมายเรียบร้อยครับ ${speakerCall} (#${savedAppt.id} • ${
                    wantsPrivateScope ? '🔒 ส่วนตัว' : '👥 กลุ่ม'
                  })\n\n${formattedAppt}`;
                  addClosingWit = true;
                }
              }
            } else if (todoDoneMatch) {
              const delQ = String(todoDoneMatch[1] || '').trim().toLowerCase();
              const todoPool = visibleNotes.filter((n) => n.category.includes('To-Do') || n.category.includes('งานที่ต้องทำ'));
              const targetIds = new Set<string>();
              if (!delQ || delQ === 'ล่าสุด') {
                if (todoPool.length > 0) targetIds.add(todoPool[todoPool.length - 1].id);
              } else if (/^#?\d{1,3}$/.test(delQ)) {
                const idx = Number(delQ.replace('#', '')) - 1;
                if (idx >= 0 && idx < todoPool.length) targetIds.add(todoPool[idx].id);
              } else {
                const cleanQ = delQ.replace(/^#/, '');
                todoPool.forEach((n) => {
                  if (n.id.toLowerCase() === cleanQ || n.content.toLowerCase().includes(cleanQ)) targetIds.add(n.id);
                });
              }
              const doneList: ServerGroupNote[] = [];
              if (targetIds.size > 0) {
                const updated = groupNotesList.map((n) => {
                  if (targetIds.has(n.id)) {
                    doneList.push(n);
                    return { ...n, status: 'ARCHIVED' as const };
                  }
                  return n;
                });
                writeServerDb({ ...sdb, groupNotes: updated });
              }
              replyText =
                doneList.length > 0
                  ? `🎉 ยอดเยี่ยมครับ ${speakerCall} บูบี้ปิดงานเรียบร้อยแล้ว (${doneList.length} รายการ):\n` +
                    doneList.map((n) => `✅ #${n.id}: ${n.content}`).join('\n')
                  : `🔍 ไม่พบรายการงานค้างที่ตรงกับ "${delQ || 'ล่าสุด'}" ครับ (พิมพ์ "งานค้าง" เพื่อดูเลข #ID ได้ครับ)`;
            } else if (isTodoRecall) {
              const todos = visibleNotes.filter((n) => n.category.includes('To-Do') || n.category.includes('งานที่ต้องทำ'));
              if (todos.length === 0) {
                replyText = `✅ ${speakerCall} ครับ ขณะนี้ไม่มีงานค้าง (To-Do) ในรายการครับ ทุกอย่างเรียบร้อยดีครับ`;
              } else {
                const tLines = todos.slice(-15).map((n, idx) => `${idx + 1}. [#${n.id}] ${n.content}`);
                replyText = `📝 รายการงานค้าง (Action Items) จำนวน ${todos.length} รายการ:\n\n${tLines.join('\n\n')}\n\n💡 พิมพ์ "ปิดงาน #<เลขID>" เมื่อดำเนินการเสร็จสิ้นครับ`;
                addClosingWit = true;
              }
            } else if (isChatSummaryCmd) {
              const bodyToSummarize = cmdText.replace(/^(?:สรุปแชต|สรุปข้อความ|สรุปบทสนทนา|สรุปประชุม|แยกงาน)\s*[:\-]?\s*/i, '').trim();
              const rawLines = bodyToSummarize
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l.length >= 3);
              if (rawLines.length === 0) {
                replyText = `📝 ${speakerCall} ครับ กรุณาวางข้อความแชตกลุ่มหรือบันทึกการประชุมต่อท้ายคำสั่ง "สรุปแชต:" ได้เลยครับ เดี๋ยวบูบี้สกัดประเด็นสำคัญและแยก Action Items ให้ทันทีครับ`;
              } else {
                const aiSummary = await generateBoobyAiText(
                  `คุณคือ "บูบี้" เลขานุการส่วนตัวและผู้ช่วย AI (สุภาพ สุขุม แฝงอารมณ์ขันแบบผู้ดีอังกฤษเล็กน้อย ลงท้ายด้วย "ครับ") ของ ${ownerCallName}\n` +
                    `จงสรุปบทสนทนาที่ได้รับเป็นภาษาไทยที่กระชับ ชัดเจน เหมาะอ่านบนมือถือ LINE ห้ามใช้ตาราง Markdown (|---|) เด็ดขาด\n` +
                    `แบ่งเป็น 2 ส่วน:\n1) 📌 สรุปประเด็นสำคัญ (3-5 ข้อ)\n2) ✅ Action Items (รูปแบบ: • [ชื่องาน] — ผู้รับผิดชอบ: [ชื่อ] — กำหนดส่ง: [วัน/เวลา])`,
                  `ผู้สั่งงาน: ${speakerCall}\nข้อความแชต:\n${bodyToSummarize}`
                );
                const actionLines: string[] = [];
                for (const ln of rawLines) {
                  if (/คุณ|ส่ง|ทำ|เตรียม|แจ้ง|แก้|ประสาน|ตรวจ|กำหนด|ก่อน|ภายใน|พว\.|หัวหน้า/.test(ln)) {
                    const whoM = ln.match(/(?:คุณ|พว\.|พี่|น้อง)\s*([^\s:,-]+)/);
                    const dlInfo = parseThaiQueryDateServer(ln.toLowerCase());
                    const whoStr = whoM ? whoM[0] : 'ทีมผู้เกี่ยวข้อง';
                    const dlStr = dlInfo.hasExplicitDate ? formatCompactThaiServer(dlInfo.ymd) : 'แจ้งกำหนดเพิ่มเติม';
                    const itemStr = `${ln} — ผู้รับผิดชอบ: ${whoStr} — กำหนดส่ง: ${dlStr}`;
                    actionLines.push(`• ${itemStr}`);
                    persistNewNote(itemStr, 'งานที่ต้องทำ/To-Do', wantsPrivateScope);
                  }
                }
                if (aiSummary) {
                  replyText = aiSummary + (actionLines.length > 0 ? `\n\n💾 บันทึกลง To-Do อัตโนมัติแล้ว ${actionLines.length} รายการครับ` : '');
                } else {
                  const bulletSummary = rawLines.slice(0, 5).map((l) => `📌 ${l.length > 140 ? `${l.slice(0, 137)}...` : l}`);
                  replyText =
                    `📝 สรุปสาระสำคัญจากบทสนทนาครับ ${speakerCall}:\n\n${bulletSummary.join('\n')}` +
                    (actionLines.length > 0
                      ? `\n\n✅ Action Items ที่แยกและบันทึกลง To-Do แล้ว (${actionLines.length} งาน):\n${actionLines.slice(0, 8).join('\n')}`
                      : '\n\n💡 หากต้องการมอบหมายงานชิ้นใด พิมพ์ "สั่งงาน: <ชื่องาน> ให้คุณ<ชื่อ> ภายใน <วัน>" ได้เลยครับ');
                }
                addClosingWit = true;
              }
            } else if (isTodoAddCmd && isTodoAddCmd[1]) {
              const taskRaw = String(isTodoAddCmd[1]).trim();
              const assigneeM = taskRaw.match(/(?:ให้|ผู้รับผิดชอบ\s*[:\-]?)\s*((?:คุณ|พว\.|พี่|น้อง)?\s*[\u0E00-\u0E7Fa-zA-Z]+)/);
              const taskDateInfo = parseThaiQueryDateServer(taskRaw.toLowerCase());
              const assigneeStr = assigneeM ? String(assigneeM[1]).trim() : 'ยังไม่ระบุ';
              const deadlineStr = taskDateInfo.hasExplicitDate ? formatThaiShortServer(taskDateInfo.ymd) : 'ไม่ระบุกำหนดส่ง';
              const formattedTask = `${taskRaw} — ผู้รับผิดชอบ: ${assigneeStr} — กำหนดส่ง: ${deadlineStr}`;
              const savedTask = persistNewNote(formattedTask, 'งานที่ต้องทำ/To-Do', wantsPrivateScope);
              replyText = `📝 บูบี้บันทึกงานเข้ากระดาน To-Do เรียบร้อยครับ ${speakerCall} (#${savedTask.id})\n\n• งาน: ${taskRaw}\n• ผู้รับผิดชอบ: ${assigneeStr}\n• กำหนดส่ง: ${deadlineStr}`;
              addClosingWit = true;
            } else if (isDraftCmd) {
              const draftTopic = cmdText
                .replace(/^(?:ร่างข้อความ|ร่างประกาศ|เขียนประกาศ|ร่างไลน์|ขอข้อความแจ้ง|ช่วยพิมพ์แจ้ง|ช่วยเขียนแจ้ง|ร่างคำชี้แจง)\s*(?:เรื่อง|เกี่ยวกับ)?\s*[:\-]?\s*/i, '')
                .trim();
              if (!draftTopic || draftTopic.length < 3) {
                replyText = `✍️ ${speakerCall} ครับ ต้องการให้บูบี้ร่างข้อความหรือประกาศเรื่องอะไร และส่งถึงกลุ่มใดครับ แจ้งสั้นๆ ได้เลยครับ เดี๋ยวจัดให้ครบทั้งแบบทางการและแบบเป็นกันเองครับ`;
              } else {
                const aiDraft = await generateBoobyAiText(
                  `คุณคือ "บูบี้" เลขานุการส่วนตัวและผู้เชี่ยวชาญการสื่อสารในโรงพยาบาล (รพ.ชลประทาน OPD) ของ ${ownerCallName}\n` +
                    `จงร่างข้อความสื่อสารภาษาไทย 2 รูปแบบจากหัวข้อที่กำหนด ห้ามใช้ตาราง Markdown (|---|) เด็ดขาด ลงท้ายบทสนทนาด้วยคำว่า "ครับ"\n` +
                    `1️⃣ แบบทางการสุภาพ (สำหรับผู้บริหาร / หัวหน้าหน่วยงาน / หนังสือเวียน)\n` +
                    `2️⃣ แบบกระชับเป็นกันเอง (สำหรับกลุ่ม LINE ทีมงาน OPD อ่านง่ายใน 10 วินาที)`,
                  `ผู้สั่ง: ${speakerCall}\nหัวข้อ/ใจความสำคัญ: ${draftTopic}`
                );
                replyText =
                  aiDraft ||
                  `✍️ บูบี้ร่างข้อความให้เลือก 2 รูปแบบตามระดับผู้รับสารครับ ${speakerCall}:\n\n` +
                    `1️⃣ แบบทางการสุภาพ (สำหรับผู้บริหาร / หัวหน้าหน่วยงาน / หนังสือเวียน)\n` +
                    `เรียน ทุกท่านที่เกี่ยวข้อง\nขออนุญาตแจ้งประชาสัมพันธ์เรื่อง "${draftTopic}" เพื่อให้การปฏิบัติงานและประสานงานของกลุ่มงานการพยาบาลผู้ป่วยนอก (OPD) เป็นไปด้วยความเรียบร้อย จึงเรียนมาเพื่อโปรดทราบและถือปฏิบัติโดยพร้อมเพรียงกัน\nขอแสดงความนับถือ\n\n` +
                    `2️⃣ แบบกระชับเป็นกันเอง (สำหรับกลุ่ม LINE ทีมงาน OPD)\n` +
                    `📢 แจ้งทีม OPD ทราบครับทุกคน\n📌 เรื่อง: ${draftTopic}\nรบกวนทุกท่านรับทราบและช่วยกันดำเนินการตามนี้นะครับ หากมีข้อสงสัยแจ้งในกลุ่มนี้ได้เลย ขอบคุณทุกท่านมากครับ 🙏`;
                addClosingWit = true;
              }
            } else {
              // Group Memory Write
              const saveNoteMatch = cmdText.match(
                /^(?:จำไว้ว่า|จำไว้หน่อยว่า|จำไว้หน่อย|จำไว้|ฝากจำว่า|ฝากจำ|จดไว้ว่า|จดไว้|จดบันทึก|บันทึกข้อตกลงใหม่|บันทึกข้อตกลง|ข้อตกลงใหม่|ข้อตกลงกลุ่ม|ข้อตกลง|มติที่ประชุม|มติกลุ่ม|มติ|ตกลงตามนี้|ประกาศใหม่|แจ้งเวียน|โน้ตไว้|เพิ่มบันทึก|บันทึกช่วยจำ|เงื่อนไขใหม่)[:\s-]*(.+)/i
              );
              const passiveSaveMatch =
                !saveNoteMatch && cmdText.match(/^(?:.*?(?:จำไว้ว่า|จดไว้ว่า|บันทึกไว้ว่า))\s*[:\-]?\s*(.+)/i);
              const noteContentToSave = saveNoteMatch
                ? String(saveNoteMatch[1] || '').trim()
                : passiveSaveMatch
                ? String(passiveSaveMatch[1] || '').trim()
                : '';

              const delNoteMatch = cmdText.match(/^(?:ลบข้อตกลง|ลบบันทึก|ลืมเรื่อง|ลืมข้อตกลง|ยกเลิกข้อตกลง|ลบโน้ต)\s*(.*)/i);

              const looksLikeRecallNoteQuestion =
                !noteContentToSave ||
                /^(?:อะไรบ้าง|มีอะไร|กี่|ทั้งหมด|เรื่อง|ที่จำ|ไหม|มั้ย|มั๊ย|ได้ไหม|ได้มั้ย|\?)/.test(noteContentToSave) ||
                /(?:อะไรบ้าง|มีอะไรบ้าง|กี่ข้อ|กี่เรื่อง|ไหม|มั้ย|มั๊ย|\?)\s*$/.test(noteContentToSave);

              if (noteContentToSave && !looksLikeRecallNoteQuestion) {
                const newNote = persistNewNote(noteContentToSave, '', wantsPrivateScope);
                replyText =
                  `📝 บูบี้จดจำ${wantsPrivateScope ? 'บันทึกส่วนตัว' : 'ข้อตกลงกลุ่ม'}เรียบร้อยแล้วครับ ${speakerCall} (#${newNote.id})\n\n` +
                  `📂 หมวดหมู่: ${newNote.category}\n` +
                  `📌 "${newNote.content}"\n` +
                  `👤 โดย: ${newNote.savedBy} (${newNote.timestamp.slice(11, 16)} น.)\n` +
                  `💡 พิมพ์ "สรุปข้อตกลง" เพื่อเรียกดูได้ตลอดครับ`;
                addClosingWit = true;
              } else if (delNoteMatch) {
                const delQ = String(delNoteMatch[1] || '').trim().toLowerCase();
                const archived: ServerGroupNote[] = [];
                if (visibleNotes.length > 0) {
                  const targetIds = new Set<string>();
                  if (!delQ || delQ === 'ล่าสุด' || delQ === 'ข้อล่าสุด') {
                    targetIds.add(visibleNotes[visibleNotes.length - 1].id);
                  } else if (/^#?\d{1,3}$/.test(delQ)) {
                    const idx = Number(delQ.replace('#', '')) - 1;
                    if (idx >= 0 && idx < visibleNotes.length) targetIds.add(visibleNotes[idx].id);
                  } else {
                    const cleanDelQ = delQ.replace(/^#/, '');
                    visibleNotes.forEach((n: ServerGroupNote) => {
                      if (n.id.toLowerCase() === cleanDelQ || n.content.toLowerCase().includes(cleanDelQ)) {
                        targetIds.add(n.id);
                      }
                    });
                  }
                  const updatedNotes = groupNotesList.map((n: ServerGroupNote) => {
                    if (targetIds.has(n.id)) {
                      archived.push(n);
                      return { ...n, status: 'ARCHIVED' as const };
                    }
                    return n;
                  });
                  if (archived.length > 0) {
                    writeServerDb({ ...sdb, groupNotes: updatedNotes });
                  }
                }
                replyText =
                  archived.length > 0
                    ? `🗑️ จัดเก็บบันทึกเรียบร้อยครับ ${speakerCall} (${archived.length} รายการ):\n` +
                      archived.map((n: ServerGroupNote) => `• #${n.id}: "${n.content}"`).join('\n')
                    : `🔍 ไม่พบบันทึกข้อตกลงที่ตรงกับเงื่อนไขลบครับ ${speakerCall} (ลองพิมพ์ "สรุปข้อตกลง" เพื่อดูเลข #ID ก่อนได้ครับ)`;
              } else {
                const staffArr: any[] = Array.isArray(sdb?.staff) ? sdb.staff : [];
                const leavesArr: any[] = Array.isArray(sdb?.leaves) ? sdb.leaves : [];
                const otArr: any[] = Array.isArray(sdb?.ot) ? sdb.ot : [];
                const workloadsArr: any[] = Array.isArray(sdb?.workloads) ? sdb.workloads : [];

                const parsedTarget = parseThaiQueryDateServer(txt);
                const startYmd = parsedTarget.ymd;
                const endYmd = parsedTarget.endYmd || startYmd;
                const hasExplicitDate = Boolean(parsedTarget.hasExplicitDate);
                const isRange = Boolean(parsedTarget.isRange && startYmd !== endYmd);
                const dateHeader = isRange
                  ? (parsedTarget.relLabel ? `${parsedTarget.relLabel} (` : '') +
                    `${formatCompactThaiServer(startYmd)} - ${formatCompactThaiServer(endYmd)}` +
                    (parsedTarget.relLabel ? ')' : '')
                  : parsedTarget.relLabel
                  ? `${parsedTarget.relLabel} (${formatThaiShortServer(startYmd)})`
                  : formatThaiShortServer(startYmd);

                const isExecutiveBriefing = /(?:สรุปผู้บริหาร|executive|briefing|ภาพรวมวันนี้|สรุปภาพรวมทั้งหมด|ต้องตัดสินใจอะไรบ้าง|สถานการณ์วันนี้|สรุปสำหรับหัวหน้า)/.test(
                  cmdLower
                );
                if (isExecutiveBriefing) {
                  const briefDate = hasExplicitDate ? startYmd : todayYmd;
                  const briefWl = workloadsArr.filter((w: any) => normalizeDbDateServer(w.date) === briefDate);
                  const briefPt = briefWl.reduce(
                    (acc: number, w: any) => acc + Math.max(Number(w.totalPt || 0), Number(w.adultPt || 0) + Number(w.childPt || 0)),
                    0
                  );
                  const briefLeaves = leavesArr.filter((l: any) => {
                    const ls = normalizeDbDateServer(l.startDate);
                    const le = normalizeDbDateServer(l.endDate) || ls;
                    return ls && ls <= briefDate && le >= briefDate;
                  });
                  const briefOt = otArr.filter((o: any) => normalizeDbDateServer(o.date) === briefDate);
                  const bAppts = visibleNotes.filter((n) => n.category.includes('นัดหมาย'));
                  const bTodos = visibleNotes.filter((n) => n.category.includes('To-Do') || n.category.includes('งานที่ต้องทำ'));

                  let execAdvice = 'สถานการณ์อยู่ในเกณฑ์ปกติ สามารถบริหารอัตรากำลังตามแผนได้ครับ';
                  if (briefWl.length === 0 && briefLeaves.length > 0) {
                    execAdvice = `วันนี้มีผู้ลา ${briefLeaves.length} ท่าน แนะนำตรวจการจัดคนทดแทนและติดตามการบันทึกยอด Census ช่วงปิดเวรครับ`;
                  } else if (briefLeaves.length >= 3) {
                    execAdvice = `วันนี้มีผู้ลา ${briefLeaves.length} ท่าน (ค่อนข้างหนาแน่น) แนะนำพิจารณาเกลี่ยอัตรากำลังคลินิกรองหรือจัดเวร OT เสริมครับ`;
                  } else if (bTodos.length > 0) {
                    execAdvice = `ภาระงานโดยรวมคุมได้ แนะนำติดตามงานค้าง (To-Do) ${bTodos.length} รายการ และตรวจสอบความครบถ้วนก่อนปิดเวรครับ`;
                  }

                  replyText =
                    `🗂️ Executive Briefing — ${formatThaiShortServer(briefDate)}\n` +
                    `💡 ข้อเสนอแนะเชิงบริหาร: ${execAdvice}\n\n` +
                    `📊 ภาระงานผู้ป่วยนอก: ${
                      briefWl.length > 0 ? `${briefWl.length} รายการคลินิก • ${briefPt.toLocaleString()} ราย` : 'ยังไม่มีบันทึกยอดประจำวัน'
                    }\n` +
                    `🏥 ผู้ลาวันนี้: ${briefLeaves.length} รายการ${
                      briefLeaves.length > 0
                        ? ` (${briefLeaves
                            .slice(0, 4)
                            .map((l: any) => String(l.staffName || '').trim())
                            .join(', ')}${briefLeaves.length > 4 ? '...' : ''})`
                        : ''
                    }\n` +
                    `⏰ เวร OT นอกเวลา: ${briefOt.length} รายการ\n` +
                    `📅 นัดหมายที่บันทึกไว้: ${bAppts.length} รายการ\n` +
                    `📝 งานค้าง (To-Do): ${bTodos.length} รายการ`;
                  addClosingWit = true;
                } else {
                  // Directory & Staff entity resolution
                  interface PersonDirEntry {
                    name: string;
                    pos: string;
                    clinic: string;
                    status: string;
                    empCode: string;
                  }
                  const dirMap = new Map<string, PersonDirEntry>();
                  const addDir = (name: unknown, pos: unknown, clinic: unknown, status: unknown, empCode: unknown) => {
                    const clean = String(name || '').trim();
                    if (!clean) return;
                    const existing = dirMap.get(clean);
                    if (!existing) {
                      dirMap.set(clean, {
                        name: clean,
                        pos: String(pos || '').trim(),
                        clinic: String(clinic || '').trim(),
                        status: String(status || 'Active').trim(),
                        empCode: String(empCode || '').trim(),
                      });
                    } else {
                      if (!existing.pos && pos) existing.pos = String(pos).trim();
                      if (!existing.clinic && clinic) existing.clinic = String(clinic).trim();
                      if (!existing.empCode && empCode) existing.empCode = String(empCode).trim();
                    }
                  };
                  staffArr.forEach((st: any) => addDir(st.name, st.position, st.homeClinic, st.status, st.employeeCode || st.staffId));
                  leavesArr.forEach((l: any) => addDir(l.staffName, l.position, l.clinic, 'Active', ''));
                  otArr.forEach((o: any) => addDir(o.staffName, o.position, o.workClinic || o.homeClinic, 'Active', o.employeeCode));

                  const stopTokens = new Set([
                    'ลา', 'วัน', 'คน', 'งาน', 'เวร', 'คลินิก', 'ห้อง', 'ตรวจ', 'วันนี้', 'พรุ่งนี้', 'เมื่อวาน',
                    'เดือน', 'สัปดาห์', 'อาทิตย์', 'ใคร', 'บ้าง', 'ไหน', 'เท่าไหร่', 'กี่คน', 'อายุรกรรม',
                    'ศัลยกรรม', 'กุมารเวชกรรม', 'จักษุวิทยา', 'ทั่วไป', 'คัดกรอง', 'พยาบาล', 'ผู้ช่วย',
                  ]);
                  const scoredMatches: Array<{ staff: PersonDirEntry; score: number }> = [];
                  for (const entry of dirMap.values()) {
                    const stripped = stripThaiHonorificsServer(entry.name);
                    if (stripped.length >= 2 && txt.includes(stripped)) {
                      scoredMatches.push({ staff: entry, score: stripped.length + 100 });
                      continue;
                    }
                    const parts = stripped.split(/\s+/).filter((tk: string) => tk.length >= 2 && !stopTokens.has(tk));
                    if (parts.some((tk: string) => txt.includes(tk))) {
                      scoredMatches.push({ staff: entry, score: Math.max(...parts.map((tk: string) => tk.length)) });
                    }
                  }
                  scoredMatches.sort((a: { staff: PersonDirEntry; score: number }, b: { staff: PersonDirEntry; score: number }) => b.score - a.score);
                  const matchedStaff = scoredMatches.map((m: { staff: PersonDirEntry; score: number }) => m.staff);
                  const candidateName = matchedStaff.length > 0 ? matchedStaff[0].name : extractCandidatePersonServer(rawText);
                  const isPersonQuery = matchedStaff.length > 0 || Boolean(candidateName);
                  const asksOpenWhen = /(?:วันไหน|เมื่อไหร่|ช่วงไหน|วันที่เท่าไหร่|วันอะไร|บ่อยแค่ไหน|กี่ครั้ง|กี่วัน|ทั้งหมด|ล่าสุด|เคยลา|เคยขึ้น)/.test(
                    txt
                  );

                  const matchedClinic = extractClinicMatchServer(txt, settingsObj);
                  let shiftFilter = '';
                  if (txt.includes('นอกเวลาวันหยุด') || (txt.includes('นอกเวลา') && (txt.includes('วันหยุด') || txt.includes('12:00')))) {
                    shiftFilter = 'นอกเวลาวันหยุด 08:00-12:00';
                  } else if (
                    txt.includes('นอกเวลาเย็น') ||
                    (txt.includes('นอกเวลา') && (txt.includes('เย็น') || txt.includes('16:00') || txt.includes('20:00')))
                  ) {
                    shiftFilter = 'นอกเวลาเย็น 16:00-20:00';
                  } else if (txt.includes('ในเวลา') && !txt.includes('นอกเวลา')) {
                    shiftFilter = 'ในเวลา 08:00-16:00';
                  } else if (txt.includes('นอกเวลา')) {
                    shiftFilter = 'OUT_TIME_ALL';
                  }

                  const asksRecallNotes = /(?:สรุปข้อตกลง|ข้อตกลง|บันทึกที่จำ|ความจำ|จำอะไรไว้|จำเรื่อง|โน้ตที่|มติที่ประชุม|มติกลุ่ม|ประกาศที่บันทึก|บันทึกใหม่)/.test(
                    txt
                  );

                  const txtNoTimeWord = txt.replace(/นอกเวลา|ในเวลา|เวลา/g, '');
                  const asksLeave =
                    txtNoTimeWord.includes('ใครลา') ||
                    txtNoTimeWord.includes('ลาวันนี้') ||
                    txtNoTimeWord.includes('ลาบ้าง') ||
                    txtNoTimeWord.includes('ลาวันไหน') ||
                    txtNoTimeWord.includes('คนลา') ||
                    txtNoTimeWord.includes('ผู้ลา') ||
                    txtNoTimeWord.includes('ลาป่วย') ||
                    txtNoTimeWord.includes('ลากิจ') ||
                    txtNoTimeWord.includes('ลาพัก') ||
                    txtNoTimeWord.includes('ลางาน') ||
                    txtNoTimeWord.includes('ยอดลา') ||
                    txtNoTimeWord.includes('ไปอบรม') ||
                    /(?:ใคร|คน|ผู้|ยื่น|ขอ|หยุด|แจ้ง|มี|กี่คน|วันไหน|เมื่อไหร่|เคย).*ลา|ลา.*(?:ใคร|บ้าง|กี่คน|กี่วัน|วันไหน|เมื่อไหร่|ไหม|มั้ย|วัน|สัปดาห์|อาทิตย์|เดือน|พรุ่งนี้|มะรืน|เมื่อวาน|\d)/.test(
                      txtNoTimeWord
                    );

                  const asksOtPayment = /(?:เบิก\s*ot|เบิกค่า|หลักฐานจ่าย|หักภาษี|ภาษี\s*5%|เรท\s*ot|อัตราค่าตอบแทน|ค่าตอบแทนรายชั่วโมง|เงินสุทธิ|ยอดเบิก|สรุปเงิน\s*ot|ยอดค่าตอบแทน|ค่าเวรรวม)/.test(
                    txt
                  );
                  const asksFiscalSummary = /(?:ปีงบ|ปีงบประมาณ|12\s*เดือน|สรุปทั้งปี|สรุปรายปี)/.test(txt);
                  const asksOt =
                    !asksOtPayment &&
                    !asksFiscalSummary &&
                    (txt.includes('ot') ||
                      txt.includes('โอที') ||
                      txt.includes('นอกเวลา') ||
                      txt.includes('อยู่เวร') ||
                      txt.includes('ขึ้นเวร') ||
                      txt.includes('ค่าตอบแทน') ||
                      txt.includes('ค่าเวร') ||
                      txt.includes('เวร')) &&
                    !/(?:off\s*เวร|ออฟเวร)/.test(txt);

                  const asksUnreportedClinics = /(?:ยังไม่ได้รายงาน|ยังไม่รายงาน|ไม่ได้รายงาน|ยังไม่ส่ง|ไม่ได้ส่ง|ขาดรายงาน|ขาดส่ง|รายงานครบ|ส่งครบ|เหลือคลินิก|เหลือหน่วย|คลินิกไหนยัง|หน่วยงานไหนยัง|แผนกไหนยัง)/.test(
                    txt
                  );
                  const asksReferral = /(?:ส่งต่อ|refer|รับย้าย|ห้องพิเศษ|จองห้อง|ยกเลิกห้อง|ศูนย์รับ)/.test(txt) && !asksUnreportedClinics;
                  const asksOffDuty = /(?:off\s*เวร|ออฟเวร|ปิดคลินิก|ไม่ได้เปิดตรวจ|หยุดบริการ|งดตรวจ|รายวัน\s*off)/.test(txt);
                  const asksCensusMeta = /(?:admit\s*rate|อัตรา\s*admit|สัดส่วนผู้ป่วยต่อพยาบาล|pt\/nurse|ส่งไลน์ล่าสุด|ส่งรายงานล่าสุด)/.test(txt);
                  const asksProductivity = /(?:productivity|โปรดัก|ประสิทธิผล|nhppd|\bftc\b|skill\s*mix|สกิลมิกซ์|\boutput\b|\binput\b|กำลังคน|อัตรากำลัง|ขาดคน|เกินเกณฑ์|ภาระงานหนัก|โหลดสุด)/.test(
                    txt
                  );
                  const asksWorkload =
                    !asksUnreportedClinics &&
                    !asksFiscalSummary &&
                    (/(?:ภาระงาน|ยอดภาระงาน|จำนวนผู้ป่วย|ยอดบริการ|เปิดตรวจ|ปิดตรวจ|ศูนย์ปัญญาภิรมย์|อัตราส่วน|ยอดผู้ป่วย|ผู้ป่วย|คนไข้|ยอดคนไข้|ยอดตรวจ|ยอดรวม|สรุปยอด|census|admit|แอดมิท|รับไว้|กี่ราย|เยอะสุด|มากสุด)/.test(
                      txt
                    ) ||
                      asksCensusMeta);
                  const asksCostCenter = /(?:cost\s*center|คอสเซ็นเตอร์|คอลเซ็นเตอร์|รหัสศูนย์ต้นทุน)/.test(txt);
                  const asksScheduleInfo = /(?:ตั้งเวลา|ตารางส่ง|รอบส่งรายงาน|ส่งรายงานกี่โมง|ออโต้ส่งกี่โมง|ส่งไลน์ล่าสุด|ส่งรายงานล่าสุด)/.test(txt);
                  const asksHolidays = /(?:วันหยุด|นักขัตฤกษ์|วันหยุดพิเศษ|วันหยุดราชการ)/.test(txt) && !/นอกเวลาวันหยุด/.test(txt);
                  const asksAuditLogs = /(?:ประวัติแก้ไข|ประวัติลบ|audit|แก้ไขล่าสุด|ลบล่าสุด|ใครแก้|ใครลบ)/.test(txt);
                  const asksStaffInfo =
                    /(?:อยู่คลินิกไหน|อยู่หน่วยไหน|ตำแหน่งอะไร|รหัสพนักงาน|รหัสประจำตัว|กี่คนในหน่วย|มีพยาบาลกี่คน|มีบุคลากรกี่คน|รายชื่อเจ้าหน้าที่|รายชื่อบุคลากร|staff|อัตรากำลังประจำ|ลาออก|เกษียณ|รายวัน)/.test(
                      txt
                    ) ||
                    (isPersonQuery &&
                      !asksLeave &&
                      !asksOt &&
                      !asksOtPayment &&
                      !asksFiscalSummary &&
                      !asksWorkload &&
                      !asksProductivity &&
                      !asksRecallNotes);

                  const sections: string[] = [];

                  if (asksRecallNotes) {
                    if (visibleNotes.length === 0) {
                      sections.push(
                        `📒 ${speakerCall} ครับ ยังไม่มีข้อตกลงหรือบันทึกที่จดจำไว้ในขอบเขตห้องแชตนี้ครับ\n💡 พิมพ์ขึ้นต้นว่า "จำไว้ว่า ..." หรือ "บันทึกข้อตกลง: ..." เพื่อให้บูบี้จำให้ได้เลยครับ`
                      );
                    } else {
                      const noteTopic = rawText
                        .replace(
                          /(?:@?บูบี้|สรุปข้อตกลงทั้งหมด|สรุปข้อตกลง|ข้อตกลงทั้งหมด|ข้อตกลงกลุ่ม|มีข้อตกลง|ข้อตกลง|มติที่ประชุม|มติกลุ่ม|มติ|บันทึกที่จำ|บันทึกทั้งหมด|ความจำ|จำอะไรไว้บ้าง|จำอะไรไว้|ที่จำไว้|เรื่อง|เกี่ยวกับ|มีอะไรบ้าง|อะไรบ้าง|ทั้งหมด|โน้ตที่|มี|ไหม|มั้ย|มั๊ย|บ้าง|\?)/gi,
                          ' '
                        )
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();
                      const filteredNotes =
                        noteTopic.length >= 2
                          ? visibleNotes.filter(
                              (n: ServerGroupNote) =>
                                n.content.toLowerCase().includes(noteTopic) || n.category.toLowerCase().includes(noteTopic)
                            )
                          : visibleNotes;
                      if (filteredNotes.length > 0) {
                        const noteLines = filteredNotes
                          .slice(-15)
                          .reverse()
                          .map(
                            (n: ServerGroupNote, idx: number) =>
                              `${idx + 1}. [#${n.id} • ${n.category}] ${n.content} (โดย ${n.savedBy} • ${n.timestamp.slice(0, 10)})`
                          );
                        sections.push(
                          `📒 ข้อตกลง/บันทึกที่บูบี้จำไว้${noteTopic.length >= 2 ? ` (ค้นหา: "${noteTopic}")` : ''}:\nรวม ${filteredNotes.length} รายการ\n${noteLines.join('\n')}`
                        );
                      } else {
                        sections.push(
                          `🔍 ไม่พบข้อตกลงเกี่ยวกับ "${noteTopic}" ครับ ${speakerCall} (ปัจจุบันมีบันทึกทั้งหมด ${visibleNotes.length} รายการ — พิมพ์ "สรุปข้อตกลง" เพื่อดูทั้งหมด)`
                        );
                      }
                    }
                  }

              if (asksCostCenter) {
                const defaultCC = String(settingsObj?.defaultCostCenter || '2012000000').trim();
                const clinicCCMap: Record<string, string> = settingsObj?.clinicCostCenters || {};
                if (matchedClinic) {
                  const foundCC = clinicCCMap[matchedClinic] || defaultCC;
                  sections.push(
                    `🏷️ Cost Center ของ "${matchedClinic}":\n${foundCC}${clinicCCMap[matchedClinic] ? ' (กำหนดเฉพาะหน่วย)' : ' (ใช้ค่าหลัก OPD)'}`
                  );
                } else {
                  const ccLines = Object.keys(clinicCCMap)
                    .filter((k: string) => Boolean(clinicCCMap[k]))
                    .map((k: string) => `• ${k}: ${clinicCCMap[k]}`);
                  sections.push(
                    `🏷️ ข้อมูล Cost Center OPD:\n• ค่าหลักหน่วยงาน: ${defaultCC}\n${ccLines.length > 0 ? ccLines.join('\n') : '(ทุกห้องตรวจใช้ค่าหลักนี้)'}`
                  );
                }
              }

              if (asksScheduleInfo) {
                const scheds = serverLineState.schedules || [];
                const schedLines = scheds.map(
                  (s: ServerLineSchedule, idx: number) =>
                    `${idx + 1}. ${s.enabled === false ? '⏸️ ' : '✅ '}${s.label || s.shift} — เวลา ${s.time} น. [${s.shift}]`
                );
                const lastPushInfo =
                  settingsObj?.lineLastSentAt || serverLineState.lastSentAt
                    ? `\n📤 ส่งไลน์ล่าสุด: ${settingsObj?.lineLastSentAt || serverLineState.lastSentAt} (${settingsObj?.lineLastStatus || serverLineState.lastStatus || 'สำเร็จ'})`
                    : '';
                sections.push(
                  `⏰ ตารางส่งรายงานอัตโนมัติเข้า LINE: ${serverLineState.enabled ? 'เปิดใช้งานอยู่' : 'ปิดอยู่'}\n${schedLines.join('\n')}${lastPushInfo}`
                );
              }

              if (asksHolidays) {
                const customHols: Array<{ date?: string; name?: string }> = Array.isArray(settingsObj?.customHolidays)
                  ? settingsObj.customHolidays
                  : [];
                const targetYr = Number(startYmd.slice(0, 4)) || Number(todayYmd.slice(0, 4));
                const hMap = getHolidaysMapServer(targetYr, customHols);
                const filterMonth = hasExplicitDate && isRange && startYmd.slice(0, 7) === endYmd.slice(0, 7) ? startYmd.slice(0, 7) : '';
                const holEntries = Array.from(hMap.entries())
                  .filter(([d]) => (filterMonth ? d.startsWith(filterMonth) : d >= todayYmd))
                  .sort((a, b) => a[0].localeCompare(b[0]));
                const allYearEntries = Array.from(hMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
                const showList = holEntries.length > 0 ? holEntries : allYearEntries;
                if (showList.length > 0) {
                  const hLines = showList
                    .slice(0, 15)
                    .map(([d, info], idx) => `${idx + 1}. ${formatThaiShortServer(d)} — ${info.name}${info.isCustom ? ' (วันหยุดพิเศษ รพ.)' : ''}`);
                  sections.push(
                    `📅 วันหยุดราชการและวันหยุดพิเศษ รพ.${filterMonth ? ` เดือน ${thaiShortMonths[Number(filterMonth.slice(5, 7)) - 1]} ${targetYr + 543}` : ` ปี พ.ศ. ${targetYr + 543}`} (${showList.length} วัน):\n${hLines.join('\n')}`
                  );
                } else {
                  sections.push(`📅 ไม่พบวันหยุดในช่วงที่สอบถามของปี พ.ศ. ${targetYr + 543} ครับ`);
                }
              }

              if (asksAuditLogs) {
                const audits: any[] = Array.isArray(sdb?.auditLogs) ? sdb.auditLogs : [];
                if (audits.length === 0) {
                  sections.push(`🛡️ ยังไม่พบประวัติการแก้ไขหรือลบข้อมูล (Audit_Logs) ในระบบครับ`);
                } else {
                  const aLines = audits.slice(0, 10).map((a: any, idx: number) => {
                    const ts = String(a.timestamp || '').replace('T', ' ').slice(0, 16);
                    return `${idx + 1}. [${ts}] ${a.action || 'แก้ไข'} — ${a.targetName || '-'} (${a.summary || ''}) | เหตุผล: ${a.reason || '-'} • โดย ${a.editedBy || 'Admin'}`;
                  });
                  sections.push(`🛡️ ประวัติการแก้ไข/ลบข้อมูลล่าสุด (Audit Logs ${audits.length} รายการ):\n${aLines.join('\n')}`);
                }
              }

              if (asksUnreportedClinics) {
                const targetCheckDate = hasExplicitDate ? startYmd : todayYmd;
                const customHols: Array<{ date?: string; name?: string }> = Array.isArray(settingsObj?.customHolidays)
                  ? settingsObj.customHolidays
                  : [];
                const isHolDay = isWeekendOrHolidayServer(targetCheckDate, customHols);
                let effShift = shiftFilter && shiftFilter !== 'OUT_TIME_ALL' ? shiftFilter : '';
                if (!effShift) {
                  if (shiftFilter === 'OUT_TIME_ALL') {
                    effShift = isHolDay ? 'นอกเวลาวันหยุด 08:00-12:00' : 'นอกเวลาเย็น 16:00-20:00';
                  } else if (isHolDay) {
                    effShift = 'นอกเวลาวันหยุด 08:00-12:00';
                  } else {
                    const bkkHr = Number(bkk.hm.slice(0, 2)) || 12;
                    effShift = targetCheckDate === todayYmd && bkkHr >= 16 ? 'นอกเวลาเย็น 16:00-20:00' : 'ในเวลา 08:00-16:00';
                  }
                }
                const inClinicsCfg: string[] = Array.isArray(settingsObj?.inTimeClinics) && settingsObj.inTimeClinics.length > 0
                  ? [...settingsObj.inTimeClinics]
                  : [...DEFAULT_IN_CLINICS_SERVER];
                if (!inClinicsCfg.includes('ศูนย์ปัญญาภิรมย์')) inClinicsCfg.push('ศูนย์ปัญญาภิรมย์');
                if (!inClinicsCfg.includes('ศูนย์รับ - ส่งต่อผู้ป่วย')) inClinicsCfg.push('ศูนย์รับ - ส่งต่อผู้ป่วย');
                const outClinicsCfg: string[] = Array.isArray(settingsObj?.outTimeClinics) && settingsObj.outTimeClinics.length > 0
                  ? [...settingsObj.outTimeClinics]
                  : [...DEFAULT_OUT_CLINICS_SERVER];
                const expectedClinics = effShift === 'ในเวลา 08:00-16:00' ? inClinicsCfg : outClinicsCfg;

                const dayShiftRows = workloadsArr.filter((w: any) => {
                  const wd = normalizeDbDateServer(w.date);
                  const wSh = String(w.shift || '').replace(/\s+/g, ' ').trim();
                  return wd === targetCheckDate && wSh === effShift;
                });
                const reportedActiveSet = new Set<string>();
                const reportedOffDutySet = new Set<string>();
                dayShiftRows.forEach((w: any) => {
                  const wc = String(w.clinic || '').trim();
                  const rt = String(w.recordType || '').toUpperCase();
                  const isPrem = wc.includes('ปัญญาภิรมย์') || /-Premium$/i.test(wc) || rt === 'PREMIUM_SUB' || rt === 'PREMIUM_POOL';
                  const mapped = isPrem ? 'ศูนย์ปัญญาภิรมย์' : wc;
                  const meta = parseWorkloadMetaServer(w);
                  if (meta.isOffDuty) reportedOffDutySet.add(mapped);
                  else reportedActiveSet.add(mapped);
                });
                const missingClinics = expectedClinics.filter((c) => !reportedActiveSet.has(c) && !reportedOffDutySet.has(c));
                const reportedTotal = expectedClinics.length - missingClinics.length;
                const missingLines = missingClinics.map((c, idx) => `${idx + 1}. ${c}`);
                const offDutyList = Array.from(reportedOffDutySet);
                sections.push(
                  `📋 ตรวจสอบความครบถ้วนการรายงานภาระงาน ประจำ${formatThaiShortServer(targetCheckDate)} (${effShift}):\n` +
                    `• รายงานแล้ว: ${reportedTotal}/${expectedClinics.length} หน่วยงาน` +
                    (reportedActiveSet.size > 0 ? ` (เปิดตรวจ ${reportedActiveSet.size}` : '') +
                    (offDutyList.length > 0 ? `${reportedActiveSet.size > 0 ? ', ' : ' ('}Off เวร ${offDutyList.length}` : '') +
                    (reportedActiveSet.size > 0 || offDutyList.length > 0 ? ')' : '') +
                    `\n` +
                    (missingClinics.length === 0
                      ? `✅ ส่งข้อมูลครบทุกหน่วยงานแล้วครับ!`
                      : `⏳ ยังไม่ได้รายงาน (${missingClinics.length} หน่วยงาน):\n${missingLines.join('\n')}`) +
                    (offDutyList.length > 0 ? `\n🏖️ แจ้ง Off เวร/ปิดคลินิก: ${offDutyList.join(', ')}` : '')
                );
              }

              if (asksReferral) {
                const refRows = workloadsArr
                  .map((w: any) => ({ w, wd: normalizeDbDateServer(w.date), meta: parseWorkloadMetaServer(w) }))
                  .filter(({ w, wd, meta }) => {
                    if (!wd || wd < startYmd || wd > endYmd) return false;
                    const wc = String(w.clinic || '').trim();
                    return wc.includes('ส่งต่อ') || Boolean(meta.referralData);
                  });
                if (refRows.length === 0) {
                  sections.push(`🚑 ไม่พบข้อมูลบันทึกของ "ศูนย์รับ - ส่งต่อผู้ป่วย" ประจำ${dateHeader} ครับ`);
                } else {
                  const refTotals = {
                    admitPrivate: 0,
                    admitGeneral: 0,
                    referIn: 0,
                    referOut: 0,
                    reservePrivateRoom: 0,
                    cancelPrivateRoom: 0,
                  };
                  const refReasons: string[] = [];
                  refRows.forEach(({ meta }) => {
                    const rd = meta.referralData || {};
                    (Object.keys(refTotals) as Array<keyof typeof refTotals>).forEach((k) => {
                      const c = Number(rd[k]?.count || 0) || 0;
                      refTotals[k] += c;
                      if (rd[k]?.reason) refReasons.push(`• ${k}: ${rd[k].reason}`);
                    });
                  });
                  const grandRef =
                    refTotals.admitPrivate +
                    refTotals.admitGeneral +
                    refTotals.referIn +
                    refTotals.referOut +
                    refTotals.reservePrivateRoom +
                    refTotals.cancelPrivateRoom;
                  sections.push(
                    `🚑 สรุปข้อมูลศูนย์รับ - ส่งต่อผู้ป่วย ประจำ${dateHeader} (รวม ${grandRef} รายการ จาก ${refRows.length} บันทึก):\n` +
                      `• Admit พิเศษ: ${refTotals.admitPrivate} ราย\n` +
                      `• Admit สามัญ: ${refTotals.admitGeneral} ราย\n` +
                      `• Refer in (รับเข้า): ${refTotals.referIn} ราย\n` +
                      `• Refer out (ส่งต่อ): ${refTotals.referOut} ราย\n` +
                      `• จองห้องพิเศษ: ${refTotals.reservePrivateRoom} ราย\n` +
                      `• ยกเลิกห้องพิเศษ: ${refTotals.cancelPrivateRoom} ราย` +
                      (refReasons.length > 0 ? `\n📝 เหตุผล/หมายเหตุ:\n${refReasons.slice(0, 6).join('\n')}` : '')
                  );
                }
              }

              if (asksOffDuty) {
                const offClinics: string[] = [];
                const offStaffList: string[] = [];
                workloadsArr.forEach((w: any) => {
                  const wd = normalizeDbDateServer(w.date);
                  if (!wd || wd < startYmd || wd > endYmd) return;
                  const meta = parseWorkloadMetaServer(w);
                  const dTag = isRange ? `[${formatCompactThaiServer(wd)}] ` : '';
                  if (meta.isOffDuty) {
                    offClinics.push(`• ${dTag}${w.clinic} (${w.shift})${meta.offDutyReason ? ` — ${meta.offDutyReason}` : ''}`);
                  }
                  if (meta.offDutyStaff.length > 0) {
                    meta.offDutyStaff.forEach((os) => {
                      offStaffList.push(
                        `• ${dTag}${os.staffName} (${os.position} • ${w.clinic}) — ${os.amount === 0.5 ? `0.5 แรง [${os.periodLabel || 'ครึ่งเวร'}]` : '1 แรง'}${os.reason ? ` (${os.reason})` : ''}`
                      );
                    });
                  }
                });
                if (offClinics.length === 0 && offStaffList.length === 0) {
                  sections.push(`✅ ไม่พบรายการ Off เวรห้องตรวจหรือ Off เวรพนักงานรายวัน ประจำ${dateHeader} ครับ`);
                } else {
                  sections.push(
                    `🏖️ รายการ Off เวร ประจำ${dateHeader}:\n` +
                      (offClinics.length > 0 ? `🏥 ปิดคลินิก/Off เวร (${offClinics.length}):\n${offClinics.slice(0, 15).join('\n')}\n` : '') +
                      (offStaffList.length > 0 ? `👤 พนักงานรายวัน Off เวร (${offStaffList.length} คน):\n${offStaffList.slice(0, 15).join('\n')}` : '')
                  );
                }
              }

              if (asksStaffInfo) {
                if (matchedStaff.length > 0) {
                  const pLines = matchedStaff.slice(0, 5).map(
                    (st: PersonDirEntry) =>
                      `👤 ${st.name}` +
                      (st.pos ? `\n• ตำแหน่ง: ${st.pos}` : '') +
                      (st.clinic ? `\n• หน่วยหลัก: ${st.clinic}` : '') +
                      (st.empCode ? `\n• รหัสบุคลากร: ${st.empCode}` : '') +
                      (st.status ? `\n• สถานะ: ${st.status}` : '')
                  );
                  sections.push(pLines.join('\n\n'));
                } else if (txt.includes('ลาออก') || txt.includes('เกษียณ')) {
                  const wantStatus = txt.includes('เกษียณ') ? 'Retired' : 'Resigned';
                  const stMatched = staffArr.filter((s: any) => String(s.status || '') === wantStatus);
                  const stLabel = wantStatus === 'Retired' ? 'เกษียณอายุ (Retired)' : 'ลาออก/ย้าย (Resigned)';
                  if (stMatched.length > 0) {
                    sections.push(
                      `📋 รายชื่อบุคลากรสถานะ ${stLabel} (${stMatched.length} คน):\n` +
                        stMatched.slice(0, 25).map((s: any, idx: number) => `${idx + 1}. ${s.name} (${s.position} • ${s.homeClinic})`).join('\n')
                    );
                  } else {
                    sections.push(`✅ ไม่มีบุคลากรสถานะ ${stLabel} ใน Staff_Master ครับ`);
                  }
                } else if (txt.includes('รายวัน')) {
                  const dwStaff = staffArr.filter((s: any) => String(s.status || 'Active') === 'Active' && String(s.position || '').includes('รายวัน'));
                  if (dwStaff.length > 0) {
                    sections.push(
                      `👥 บุคลากรตำแหน่งจ้างรายวัน (Active ${dwStaff.length} คน):\n` +
                        dwStaff.slice(0, 30).map((s: any, idx: number) => `${idx + 1}. ${s.name} (${s.position} • ${s.homeClinic})`).join('\n')
                    );
                  } else {
                    sections.push(`✅ ไม่พบรายชื่อตำแหน่งจ้างรายวันใน Staff_Master ครับ`);
                  }
                } else if (matchedClinic) {
                  const cStaff = Array.from(dirMap.values()).filter(
                    (st: PersonDirEntry) =>
                      st.status !== 'Inactive' &&
                      st.status !== 'Resigned' &&
                      st.status !== 'Retired' &&
                      st.clinic &&
                      st.clinic.toLowerCase().includes(matchedClinic.toLowerCase())
                  );
                  if (cStaff.length > 0) {
                    const csLines = cStaff
                      .slice(0, 30)
                      .map((st: PersonDirEntry, idx: number) => `${idx + 1}. ${st.name}${st.pos ? ` (${st.pos})` : ''}`);
                    sections.push(`👩‍⚕️ บุคลากรประจำ "${matchedClinic}" (${cStaff.length} คน):\n${csLines.join('\n')}`);
                  } else {
                    sections.push(`🔍 ไม่พบรายชื่อบุคลากรประจำ "${matchedClinic}" ใน Staff_Master ครับ`);
                  }
                } else {
                  const activeStaff = staffArr.filter((st: any) => String(st.status || 'Active') === 'Active');
                  const resignedCnt = staffArr.filter((st: any) => st.status === 'Resigned').length;
                  const retiredCnt = staffArr.filter((st: any) => st.status === 'Retired').length;
                  const posCounts: Record<string, number> = {};
                  activeStaff.forEach((st: any) => {
                    const pKey = String(st.position || 'ไม่ระบุ');
                    posCounts[pKey] = (posCounts[pKey] || 0) + 1;
                  });
                  const posSummary = Object.keys(posCounts).map((k: string) => `• ${k}: ${posCounts[k]} คน`);
                  sections.push(
                    `👩‍⚕️ สรุปบุคลากร OPD (Staff_Master ทั้งหมด ${staffArr.length} คน):\n` +
                      `• ปฏิบัติงาน (Active): ${activeStaff.length} คน | ลาออก/ย้าย: ${resignedCnt} | เกษียณ: ${retiredCnt}\n` +
                      posSummary.join('\n')
                  );
                }
              }

              if (asksFiscalSummary) {
                const fyYearMatch = txt.match(/(?:ปีงบ(?:ประมาณ)?\s*)(25\d{2}|20\d{2})/);
                const curCeY = Number(todayYmd.slice(0, 4));
                const curCeM = Number(todayYmd.slice(5, 7));
                const defaultBeFy = curCeM >= 10 ? curCeY + 544 : curCeY + 543;
                let fyBe = defaultBeFy;
                if (fyYearMatch) {
                  const rawFy = Number(fyYearMatch[1]);
                  fyBe = rawFy >= 2400 ? rawFy : rawFy + 543;
                }
                const fyStartCe = fyBe - 543 - 1;
                const fyStartYmd = `${fyStartCe}-10-01`;
                const fyEndYmd = `${fyStartCe + 1}-09-30`;
                const personToksFy = matchedStaff.length > 0 ? matchedStaff.map((s) => stripThaiHonorificsServer(s.name)) : [];

                const fyLeaves = leavesArr.filter((l: any) => {
                  const ls = normalizeDbDateServer(l.startDate);
                  if (!ls || ls < fyStartYmd || ls > fyEndYmd) return false;
                  if (matchedClinic && !String(l.clinic || '').toLowerCase().includes(matchedClinic.toLowerCase())) return false;
                  if (personToksFy.length > 0) {
                    const nm = stripThaiHonorificsServer(l.staffName);
                    return personToksFy.some((pt) => pt && (nm.includes(pt) || pt.includes(nm)));
                  }
                  return true;
                });
                let fyLeaveDays = 0;
                let fyTrainingCount = 0;
                let fyTrainingDays = 0;
                fyLeaves.forEach((l: any) => {
                  const dVal = Number(l.days || 1) || 1;
                  if (String(l.leaveType || '').includes('อบรม') || String(l.leaveType || '').includes('ประชุม')) {
                    fyTrainingCount += 1;
                    fyTrainingDays += dVal;
                  } else {
                    fyLeaveDays += dVal;
                  }
                });
                const fyOt = otArr.filter((o: any) => {
                  const od = normalizeDbDateServer(o.date);
                  if (!od || od < fyStartYmd || od > fyEndYmd) return false;
                  if (matchedClinic && !String(o.workClinic || '').toLowerCase().includes(matchedClinic.toLowerCase())) return false;
                  if (personToksFy.length > 0) {
                    const nm = stripThaiHonorificsServer(o.staffName);
                    return personToksFy.some((pt) => pt && (nm.includes(pt) || pt.includes(nm)));
                  }
                  return true;
                });
                const fyOtHrs = fyOt.reduce((s: number, o: any) => s + (Number(o.hours) > 0 ? Number(o.hours) : 4), 0);
                const fyOtPeople = new Set(fyOt.map((o: any) => String(o.staffName || '').trim())).size;
                sections.push(
                  `📊 สรุปวันลา/อบรม & OT ปีงบประมาณ ${fyBe} (ต.ค. ${fyBe - 1 - 2500} – ก.ย. ${fyBe - 2500})` +
                    `${matchedStaff.length > 0 ? ` — ${matchedStaff[0].name}` : matchedClinic ? ` — ${matchedClinic}` : ''}:\n` +
                    `• วันลาจริง (ไม่รวมอบรม): ${fyLeaveDays} วันทำการ (${fyLeaves.length - fyTrainingCount} รายการ)\n` +
                    `• ไปอบรม/ประชุม: ${fyTrainingCount} ครั้ง (${fyTrainingDays} วัน)\n` +
                    `• เวรนอกเวลา (OT): ${fyOt.length} เวร (${fyOtPeople} คน) • รวม ${fyOtHrs} ชม.`
                );
              }

              if (asksOtPayment) {
                let payStart = startYmd;
                let payEnd = endYmd;
                let payHeader = dateHeader;
                if (!hasExplicitDate) {
                  const bp = todayYmd.split('-').map(Number);
                  const mLast = new Date(Date.UTC(bp[0], bp[1], 0)).getUTCDate();
                  payStart = `${bp[0]}-${String(bp[1]).padStart(2, '0')}-01`;
                  payEnd = `${bp[0]}-${String(bp[1]).padStart(2, '0')}-${String(mLast).padStart(2, '0')}`;
                  payHeader = `เดือนนี้ (${thaiShortMonths[bp[1] - 1]} ${bp[0] + 543})`;
                }
                const otRatesMap: Record<string, number> = settingsObj?.otHourlyRates || {};
                const matchedPayOt = otArr.filter((o: any) => {
                  const od = normalizeDbDateServer(o.date);
                  if (!od || od < payStart || od > payEnd) return false;
                  if (matchedClinic && !String(o.workClinic || '').toLowerCase().includes(matchedClinic.toLowerCase())) return false;
                  if (shiftFilter === 'OUT_TIME_ALL' && String(o.shift || '').startsWith('ในเวลา 08:00')) return false;
                  if (shiftFilter && shiftFilter !== 'OUT_TIME_ALL' && o.shift !== shiftFilter) return false;
                  return true;
                });
                if (matchedPayOt.length === 0) {
                  sections.push(`💰 ไม่พบข้อมูลเวร OT สำหรับคำนวณหลักฐานจ่ายประจำ${payHeader} ครับ`);
                } else {
                  let totalHrs = 0;
                  let totalGross = 0;
                  let opdCount = 0;
                  let extCount = 0;
                  const peopleSet = new Set<string>();
                  const posHrs: Record<string, { hrs: number; gross: number }> = {};
                  matchedPayOt.forEach((o: any) => {
                    const sh = String(o.shift || '');
                    const hrs = Number(o.hours) > 0 ? Number(o.hours) : sh.includes('ในเวลาราชการ') ? 7 : 4;
                    const pos = String(o.position || 'RN').trim();
                    const rate = getOtHourlyRateServer(pos, otRatesMap);
                    const gross = hrs * rate;
                    totalHrs += hrs;
                    totalGross += gross;
                    peopleSet.add(String(o.staffName || '').trim());
                    if (o.isExternal) extCount += 1;
                    else opdCount += 1;
                    if (!posHrs[pos]) posHrs[pos] = { hrs: 0, gross: 0 };
                    posHrs[pos].hrs += hrs;
                    posHrs[pos].gross += gross;
                  });
                  const tax5 = Math.round(totalGross * 0.05 * 100) / 100;
                  const netPay = totalGross - tax5;
                  const posLines = Object.keys(posHrs).map(
                    (p) => `• ${p} (${getOtHourlyRateServer(p, otRatesMap)} บ./ชม.): ${posHrs[p].hrs} ชม. = ${posHrs[p].gross.toLocaleString()} บ.`
                  );
                  sections.push(
                    `💰 สรุปหลักฐานจ่ายค่าตอบแทน OT${matchedClinic ? ` (${matchedClinic})` : ''} ประจำ${payHeader}:\n` +
                      `• จำนวน ${peopleSet.size} คน (${matchedPayOt.length} เวร: OPD ${opdCount} / เฉพาะกิจ ${extCount}) • ${totalHrs} ชม.\n` +
                      `• ยอดเบิกก่อนหักภาษี: ${totalGross.toLocaleString()} บาท\n` +
                      `• หักภาษี ณ ที่จ่าย 5%: ${tax5.toLocaleString()} บาท\n` +
                      `• รับสุทธิทั้งหมด: ${netPay.toLocaleString()} บาท\n` +
                      posLines.slice(0, 6).join('\n')
                  );
                }
              }

              if (asksLeave) {
                let leaveTypeFilter = '';
                if (txtNoTimeWord.includes('ลาป่วย')) leaveTypeFilter = 'ลาป่วย';
                else if (txtNoTimeWord.includes('ลากิจ')) leaveTypeFilter = 'ลากิจ';
                else if (txtNoTimeWord.includes('ลาพัก')) leaveTypeFilter = 'ลาพัก';
                else if (txtNoTimeWord.includes('อบรม') || txtNoTimeWord.includes('ประชุม')) leaveTypeFilter = 'อบรม';

                const searchAllDatesForPerson = isPersonQuery && (!hasExplicitDate || asksOpenWhen);
                const personTokens =
                  matchedStaff.length > 0
                    ? matchedStaff.map((st: PersonDirEntry) => stripThaiHonorificsServer(st.name))
                    : candidateName
                    ? [stripThaiHonorificsServer(candidateName)]
                    : [];

                const matchedLeaves = leavesArr
                  .map((l: any) => {
                    const s = normalizeDbDateServer(l.startDate);
                    const e = normalizeDbDateServer(l.endDate) || s;
                    return { l, s, e };
                  })
                  .filter(({ l, s, e }: { l: any; s: string; e: string }) => {
                    if (!s) return false;
                    const lsName = String(l.staffName || l.staffId || '').trim();
                    const lClinic = String(l.clinic || '').trim();
                    const lType = String(l.leaveType || '').trim();
                    if (isPersonQuery) {
                      const normLs = stripThaiHonorificsServer(lsName);
                      const matchedName = personTokens.some((pt: string) => pt && (normLs.includes(pt) || pt.includes(normLs)));
                      if (!matchedName) return false;
                      if (hasExplicitDate && (s > endYmd || e < startYmd)) return false;
                    } else {
                      if (s > endYmd || e < startYmd) return false;
                      if (matchedClinic && !lClinic.toLowerCase().includes(matchedClinic.toLowerCase())) return false;
                    }
                    if (leaveTypeFilter && !lType.includes(leaveTypeFilter)) return false;
                    return true;
                  });

                const targetPersonLabel = matchedStaff.length > 0 ? matchedStaff[0].name : candidateName;
                if (isPersonQuery) {
                  if (matchedLeaves.length > 0) {
                    matchedLeaves.sort((a: { l: any; s: string; e: string }, b: { l: any; s: string; e: string }) => {
                      const aUp = a.e >= todayYmd ? 0 : 1;
                      const bUp = b.e >= todayYmd ? 0 : 1;
                      if (aUp !== bUp) return aUp - bUp;
                      return aUp === 0 ? (a.s < b.s ? -1 : 1) : (a.s > b.s ? -1 : 1);
                    });
                    let totalDays = 0;
                    const pLeaveLines = matchedLeaves.slice(0, 20).map(({ l, s, e }: { l: any; s: string; e: string }, idx: number) => {
                      const daysNum = Number(l.days || 1);
                      totalDays += Number.isFinite(daysNum) && daysNum > 0 ? daysNum : 1;
                      const tag = e >= todayYmd ? '🔜 ' : '📌 ';
                      const dStr = `${formatThaiShortServer(s)}${e !== s ? ` ถึง ${formatThaiShortServer(e)}` : ''}`;
                      const noteTxt = String(l.note || '').trim();
                      const periodMatch = noteTxt.match(/\[(ครึ่งวันเช้า|ครึ่งวันบ่าย)\]/);
                      const periodLabel = String(l.period || (periodMatch ? periodMatch[1] : '')).trim();
                      const lType = String(l.leaveType || 'ลากิจ/ลาป่วย').trim();
                      return `${idx + 1}. ${tag}${dStr} — ${lType}${periodLabel ? ` [${periodLabel}]` : ''}${daysNum ? ` (${daysNum} วัน)` : ''}`;
                    });
                    sections.push(
                      `🗓️ ประวัติวันลาของ "${targetPersonLabel}"${hasExplicitDate ? ` ประจำ${dateHeader}` : ' (ทั้งหมดในระบบ)'}:\n` +
                        `รวม ${matchedLeaves.length} รายการ (${totalDays} วันทำการ)\n${pLeaveLines.join('\n')}`
                    );
                  } else {
                    sections.push(
                      `✅ ไม่พบข้อมูลวันลาของ "${targetPersonLabel}"${hasExplicitDate ? ` ประจำ${dateHeader}` : ' ในระบบครับ'}`
                    );
                  }
                } else if (matchedLeaves.length > 0) {
                  const lines = matchedLeaves.slice(0, 35).map(({ l, s, e }: { l: any; s: string; e: string }, idx: number) => {
                    const name = String(l.staffName || l.staffId || '').trim();
                    const pos = String(l.position || '').trim();
                    const clinic = String(l.clinic || '').trim();
                    const lType = String(l.leaveType || 'ลากิจ/ลาป่วย').trim();
                    const noteTxt = String(l.note || '').trim();
                    const periodMatch = noteTxt.match(/\[(ครึ่งวันเช้า|ครึ่งวันบ่าย)\]/);
                    const periodLabel = String(l.period || (periodMatch ? periodMatch[1] : '')).trim();
                    const dateSpan = isRange
                      ? ` [${formatCompactThaiServer(s)}${e !== s ? ` - ${formatCompactThaiServer(e)}` : ''}]`
                      : '';
                    const clinicPos = [pos, clinic].filter(Boolean).join(' • ');
                    return `${idx + 1}. ${name}${clinicPos ? ` (${clinicPos})` : ''} — ${lType}${periodLabel ? ` [${periodLabel}]` : ''}${dateSpan}`;
                  });
                  sections.push(
                    `🏥 รายชื่อผู้ลา${matchedClinic ? ` (${matchedClinic})` : ''} ประจำ${dateHeader}:\nรวม ${matchedLeaves.length} รายการ\n${lines.join('\n')}`
                  );
                } else {
                  sections.push(`✅ ไม่พบรายชื่อผู้ลา${matchedClinic ? ` (${matchedClinic})` : ''} ประจำ${dateHeader} ครับ`);
                }
              }

              if (asksOt) {
                const otRatesMap: Record<string, number> = settingsObj?.otHourlyRates || {};
                const personTokensOt =
                  matchedStaff.length > 0
                    ? matchedStaff.map((st: PersonDirEntry) => stripThaiHonorificsServer(st.name))
                    : candidateName
                    ? [stripThaiHonorificsServer(candidateName)]
                    : [];

                let totalOtHrs = 0;
                let totalOtPay = 0;
                const matchedOt = otArr
                  .map((o: any) => ({ o, d: normalizeDbDateServer(o.date) }))
                  .filter(({ o, d }: { o: any; d: string }) => {
                    if (!d) return false;
                    const oName = String(o.staffName || '').trim();
                    const oShift = String(o.shift || '').trim();
                    const oWorkClinic = String(o.workClinic || '').trim();
                    if (isPersonQuery) {
                      const normOn = stripThaiHonorificsServer(oName);
                      const okName = personTokensOt.some((pt: string) => pt && (normOn.includes(pt) || pt.includes(normOn)));
                      if (!okName) return false;
                      if (hasExplicitDate && (d < startYmd || d > endYmd)) return false;
                    } else {
                      if (d < startYmd || d > endYmd) return false;
                      if (matchedClinic && !oWorkClinic.toLowerCase().includes(matchedClinic.toLowerCase())) return false;
                    }
                    if (shiftFilter === 'OUT_TIME_ALL' && oShift.startsWith('ในเวลา 08:00')) return false;
                    else if (shiftFilter && shiftFilter !== 'OUT_TIME_ALL' && oShift !== shiftFilter) return false;
                    return true;
                  })
                  .map(({ o, d }: { o: any; d: string }) => {
                    const shift = String(o.shift || '').trim();
                    const rawHrs = Number(o.hours);
                    const hrs = Number.isFinite(rawHrs) && rawHrs > 0 ? rawHrs : shift.includes('ในเวลาราชการ') ? 7 : 4;
                    const pos = String(o.position || '').trim();
                    const pay = hrs * getOtHourlyRateServer(pos, otRatesMap);
                    totalOtHrs += hrs;
                    totalOtPay += pay;
                    return { o, d, hrs, pay };
                  });

                const otTargetPerson = matchedStaff.length > 0 ? matchedStaff[0].name : candidateName;
                if (isPersonQuery) {
                  if (matchedOt.length > 0) {
                    matchedOt.sort((a: { d: string }, b: { d: string }) => (a.d > b.d ? -1 : a.d < b.d ? 1 : 0));
                    const pOtLines = matchedOt
                      .slice(0, 25)
                      .map(
                        (item: { o: any; d: string; hrs: number; pay: number }, idx: number) =>
                          `${idx + 1}. ${formatThaiShortServer(item.d)} • ${item.o.workClinic || 'นอกเวลา'} (${item.hrs} ชม. ≈ ${item.pay.toLocaleString()} บ.)`
                      );
                    sections.push(
                      `⏰ ประวัติขึ้นเวร OT ของ "${otTargetPerson}"${hasExplicitDate ? ` ประจำ${dateHeader}` : ' (ทั้งหมดในระบบ)'}:\n` +
                        `รวม ${matchedOt.length} เวร • ${totalOtHrs} ชม. (ประมาณ ${totalOtPay.toLocaleString()} บาท)\n${pOtLines.join('\n')}`
                    );
                  } else {
                    sections.push(
                      `✅ ไม่พบข้อมูลขึ้นเวร OT ของ "${otTargetPerson}"${hasExplicitDate ? ` ประจำ${dateHeader}` : ' ในระบบครับ'}`
                    );
                  }
                } else if (matchedOt.length > 0) {
                  matchedOt.sort((a: { d: string }, b: { d: string }) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
                  const uniqueNames = new Set(matchedOt.map(({ o }: { o: any }) => String(o.staffName || '').trim()).filter(Boolean));
                  const lines = matchedOt.slice(0, 40).map(({ o, d, hrs }: { o: any; d: string; hrs: number }, idx: number) => {
                    const name = String(o.staffName || '').trim();
                    const pos = String(o.position || '').trim();
                    const clinic = String(o.workClinic || '').trim();
                    const shift = String(o.shift || '').trim();
                    const dTag = isRange ? `[${formatCompactThaiServer(d)}] ` : '';
                    return `${idx + 1}. ${dTag}${name}${pos ? ` (${pos})` : ''} • ${clinic || 'นอกเวลา'}${shift ? ` [${shift}]` : ''} (${hrs} ชม.)`;
                  });
                  const extraNote = matchedOt.length > 40 ? `\n...และอีก ${matchedOt.length - 40} รายการ` : '';
                  const uniqueCount = uniqueNames.size || matchedOt.length;
                  const countSummary =
                    uniqueCount === matchedOt.length
                      ? `รวม ${uniqueCount} คน • ${totalOtHrs} ชม. (ประมาณ ${totalOtPay.toLocaleString()} บ.)`
                      : `รวม ${uniqueCount} คน (${matchedOt.length} รายการ) • ${totalOtHrs} ชม. (ประมาณ ${totalOtPay.toLocaleString()} บ.)`;
                  sections.push(
                    `⏰ รายชื่อผู้ปฏิบัติงาน OT / นอกเวลา${matchedClinic ? ` (${matchedClinic})` : ''} ประจำ${dateHeader}:\n${countSummary}\n${lines.join('\n')}${extraNote}`
                  );
                } else {
                  sections.push(`✅ ไม่พบข้อมูลเวร OT${matchedClinic ? ` (${matchedClinic})` : ''} ประจำ${dateHeader} ในระบบครับ`);
                }
              }

              if (asksWorkload || asksProductivity) {
                let wlStart = startYmd;
                let wlEnd = endYmd;
                let wlHeader = dateHeader;
                if (asksProductivity && !hasExplicitDate) {
                  const bp = todayYmd.split('-').map(Number);
                  const mLast = new Date(Date.UTC(bp[0], bp[1], 0)).getUTCDate();
                  wlStart = `${bp[0]}-${String(bp[1]).padStart(2, '0')}-01`;
                  wlEnd = `${bp[0]}-${String(bp[1]).padStart(2, '0')}-${String(mLast).padStart(2, '0')}`;
                  wlHeader = `เดือนนี้ (${thaiShortMonths[bp[1] - 1]} ${bp[0] + 543})`;
                }

                const excludeLasik = /(?:ไม่รวมเลสิก|คัดเลสิก|ไม่นับเลสิก|ยกเว้นเลสิก)/.test(txt);
                const excludeReferral = /(?:ไม่รวมศูนย์รับ|คัดศูนย์รับ|ไม่นับศูนย์รับ)/.test(txt);
                const asksLowest = /(?:ต่ำสุด|น้อยสุด)/.test(txt);

                const generalNhppd = Number(settingsObj?.nhppd) > 0 ? Number(settingsObj.nhppd) : 0.4;
                const screeningNhppd = Number(settingsObj?.screeningNhppd) > 0 ? Number(settingsObj.screeningNhppd) : 0.1;
                const stdHr = Number(settingsObj?.stdHr) > 0 ? Number(settingsObj.stdHr) : 7;
                const annualHr = Number(settingsObj?.annualHr) > 0 ? Number(settingsObj.annualHr) : 2080;
                const workDays = Number(settingsObj?.workDays) > 0 ? Number(settingsObj.workDays) : 245;

                const allWlDates = new Set<string>();
                const matchedWl = workloadsArr
                  .map((w: any) => {
                    const wd = normalizeDbDateServer(w.date);
                    const wClinic = String(w.clinic || '').trim();
                    const wShift = String(w.shift || '').trim();
                    if (wd) allWlDates.add(wd);
                    const recType = String(w.recordType || '').toUpperCase();
                    const isPrem =
                      wClinic.includes('ปัญญาภิรมย์') ||
                      /-Premium$/i.test(wClinic) ||
                      recType === 'PREMIUM_SUB' ||
                      recType === 'PREMIUM_POOL';
                    const groupClinic = isPrem ? 'ศูนย์ปัญญาภิรมย์' : wClinic;
                    const pt = Math.max(Number(w.totalPt || 0), Number(w.adultPt || 0) + Number(w.childPt || 0));
                    return { w, wd, wClinic, wShift, groupClinic, pt };
                  })
                  .filter((r: { wd: string; wShift: string; wClinic: string; groupClinic: string }) => {
                    if (!r.wd || !r.wClinic) return false;
                    if (r.wd < wlStart || r.wd > wlEnd) return false;
                    if (shiftFilter === 'OUT_TIME_ALL' && r.wShift === 'ในเวลา 08:00-16:00') return false;
                    else if (shiftFilter && shiftFilter !== 'OUT_TIME_ALL' && r.wShift !== shiftFilter) return false;
                    if (excludeLasik && r.groupClinic.includes('เลสิก')) return false;
                    if (excludeReferral && r.groupClinic.includes('ส่งต่อ')) return false;
                    if (
                      matchedClinic &&
                      !r.groupClinic.toLowerCase().includes(matchedClinic.toLowerCase()) &&
                      !r.wClinic.toLowerCase().includes(matchedClinic.toLowerCase())
                    ) {
                      return false;
                    }
                    return true;
                  });

                if (matchedWl.length === 0) {
                  const latestSorted = Array.from(allWlDates).sort();
                  const latestHint =
                    latestSorted.length > 0 ? `\n💡 ล่าสุดที่มีข้อมูลในระบบคือ ${formatThaiShortServer(latestSorted[latestSorted.length - 1])}` : '';
                  sections.push(`✅ ไม่พบข้อมูลภาระงานผู้ป่วย${matchedClinic ? ` (${matchedClinic})` : ''}${shiftFilter && shiftFilter !== 'OUT_TIME_ALL' ? ` [${shiftFilter}]` : ''} ประจำ${wlHeader} ครับ${latestHint}`);
                } else {
                  let sumPt = 0,
                    sumAdult = 0,
                    sumChild = 0,
                    sumAdmit = 0,
                    sumHN = 0,
                    sumRN = 0,
                    sumPN = 0,
                    sumNA = 0,
                    sumClerk = 0,
                    sumSW = 0;
                  const activeDaysSet = new Set<string>();
                  const byClinicMap = new Map<
                    string,
                    { name: string; pt: number; admit: number; rn: number; pn: number; na: number; days: Set<string> }
                  >();
                  matchedWl.forEach((r: { w: any; wd: string; groupClinic: string; pt: number }) => {
                    const adult = Number(r.w.adultPt || 0);
                    const child = Number(r.w.childPt || 0);
                    const admit = Number(r.w.admit || 0);
                    const hn = Number(r.w.hn || 0);
                    const rn = Number(r.w.rn || 0);
                    const pn = Number(r.w.pn || 0);
                    const na = Number(r.w.na || 0);
                    const clk = Number(r.w.clerk || 0);
                    const sw = Number(r.w.serviceWorker || 0);
                    sumPt += r.pt;
                    sumAdult += adult;
                    sumChild += child;
                    sumAdmit += admit;
                    sumHN += hn;
                    sumRN += rn;
                    sumPN += pn;
                    sumNA += na;
                    sumClerk += clk;
                    sumSW += sw;
                    if (r.pt > 0 || rn + pn + na > 0) activeDaysSet.add(r.wd);
                    let bc = byClinicMap.get(r.groupClinic);
                    if (!bc) {
                      bc = { name: r.groupClinic, pt: 0, admit: 0, rn: 0, pn: 0, na: 0, days: new Set<string>() };
                      byClinicMap.set(r.groupClinic, bc);
                    }
                    bc.pt += r.pt;
                    bc.admit += admit;
                    bc.rn += rn;
                    bc.pn += pn;
                    bc.na += na;
                    bc.days.add(r.wd);
                  });

                  const wDaysCount = activeDaysSet.size || 1;
                  const totalNursing = sumRN + sumPN + sumNA;
                  const avgPtPerDay = sumPt / wDaysCount;
                  const admitRatePct = sumPt > 0 ? (sumAdmit / sumPt) * 100 : 0;
                  const ptPerNurse = totalNursing > 0 ? sumPt / totalNursing : 0;
                  const clinicArr = Array.from(byClinicMap.values()).map((c) => {
                    const cd = c.days.size || 1;
                    const cNhppd = c.name === 'หน่วยคัดกรอง' ? screeningNhppd : generalNhppd;
                    const cFtc = ((c.pt / cd) * cNhppd) / stdHr;
                    const cOut = (cFtc * annualHr) / (workDays * 8);
                    const cInput = (c.rn + c.pn + c.na) / cd;
                    const cProd = cInput > 0 ? (cOut / cInput) * 100 : 0;
                    return { name: c.name, pt: c.pt, admit: c.admit, nursing: c.rn + c.pn + c.na, prod: cProd, nhppd: cNhppd };
                  });
                  const ftcSum = clinicArr.reduce((acc: number, c) => acc + ((c.pt / wDaysCount) * c.nhppd) / stdHr, 0);
                  const outputVal = (ftcSum * annualHr) / (workDays * 8);
                  const inputVal = totalNursing / wDaysCount;
                  const prodPct = inputVal > 0 ? (outputVal / inputVal) * 100 : 0;
                  const skillMixPct = totalNursing > 0 ? (sumRN / totalNursing) * 100 : 0;
                  const prodStatusTxt =
                    prodPct === 0
                      ? 'ไม่มีกำลังคน'
                      : prodPct > 115
                      ? '🔴 สูงเกินเกณฑ์ (>115% ภาระงานหนัก)'
                      : prodPct >= 85
                      ? '🟢 เหมาะสมตามเกณฑ์ (85-115%)'
                      : '🟡 ต่ำกว่าเกณฑ์ (<85%)';

                  if (asksWorkload) {
                    const topClinics = [...clinicArr]
                      .sort((a, b) => (asksLowest ? a.pt - b.pt : b.pt - a.pt))
                      .slice(0, 6)
                      .map((c, idx: number) => `${idx + 1}. ${c.name}: ${c.pt.toLocaleString()} ราย${c.admit > 0 ? ` (Admit ${c.admit})` : ''}`);
                    const shiftTag = shiftFilter && shiftFilter !== 'OUT_TIME_ALL' ? ` [${shiftFilter}]` : shiftFilter === 'OUT_TIME_ALL' ? ' [นอกเวลา]' : '';
                    sections.push(
                      `📊 สรุปภาระงานผู้ป่วยนอก${matchedClinic ? ` (${matchedClinic})` : ''}${shiftTag} ประจำ${wlHeader} (${clinicArr.length} หน่วย):\n` +
                        `👥 ผู้ป่วยรวม: ${sumPt.toLocaleString()} ราย (ผู้ใหญ่ ${sumAdult.toLocaleString()} • เด็ก ${sumChild.toLocaleString()})\n` +
                        `🛌 Admit: ${sumAdmit.toLocaleString()} ราย (Admit Rate ${admitRatePct.toFixed(2)}%) | สัดส่วน Pt/Nurse: ${ptPerNurse.toFixed(1)} คน/แรง\n` +
                        `👩‍⚕️ กำลังคนพยาบาล: ${totalNursing.toFixed(1)} แรง (RN ${sumRN.toFixed(1)} / PN ${sumPN.toFixed(1)} / NA ${sumNA.toFixed(1)})${sumHN + sumClerk + sumSW > 0 ? ` • HN ${sumHN.toFixed(1)} / ทั่วไป ${sumClerk.toFixed(1)} / บริการ ${sumSW.toFixed(1)}` : ''}` +
                        (wDaysCount > 1 ? `\n📆 เฉลี่ย ${avgPtPerDay.toFixed(1)} ราย/วัน (${wDaysCount} วัน)` : '') +
                        (!matchedClinic && topClinics.length > 0 ? `\n🏆 ${asksLowest ? 'อันดับคลินิกยอดน้อยสุด' : 'อันดับคลินิกยอดสูงสุด'}:\n${topClinics.join('\n')}` : '')
                    );
                  }

                  if (asksProductivity) {
                    const sortedLoad = clinicArr.filter((c) => c.prod > 0).sort((a, b) => (asksLowest ? a.prod - b.prod : b.prod - a.prod));
                    const loadLines = sortedLoad.slice(0, 4).map((c) => `• ${c.name}: ${c.prod.toFixed(1)}% (${c.pt.toLocaleString()} ราย)`);
                    sections.push(
                      `📈 วิเคราะห์ Productivity & กำลังคน${matchedClinic ? ` (${matchedClinic})` : ''}${excludeLasik ? ' [ไม่รวมเลสิก]' : ''} ประจำ${wlHeader}:\n` +
                        `• Productivity: ${prodPct.toFixed(1)}% — ${prodStatusTxt}\n` +
                        `• Skill Mix (สัดส่วน RN): ${skillMixPct.toFixed(1)}%\n` +
                        `• Output ต้องการ: ${outputVal.toFixed(2)} แรง/วัน | Input จัดจริง: ${inputVal.toFixed(2)} แรง/วัน (FTC ${ftcSum.toFixed(2)})\n` +
                        `• เกณฑ์ NHPPD: ทั่วไป ${generalNhppd} / คัดกรอง ${screeningNhppd} (Std ${stdHr} ชม.)` +
                        (!matchedClinic && loadLines.length > 0 ? `\n${asksLowest ? '📉 คลินิกภาระงานต่ำสุด' : '🔥 คลินิกภาระงานสูงสุด'}:\n${loadLines.join('\n')}` : '')
                    );

                    const eyeOutRows = matchedWl.filter(
                      (r: { w: any; wClinic: string; wShift: string }) =>
                        r.wClinic === 'จักษุวิทยา' && r.wShift !== 'ในเวลา 08:00-16:00'
                    );
                    if (
                      eyeOutRows.length > 0 &&
                      (matchedClinic === 'จักษุวิทยา' ||
                        shiftFilter === 'OUT_TIME_ALL' ||
                        (shiftFilter && shiftFilter !== 'ในเวลา 08:00-16:00'))
                    ) {
                      let eyeActualPt = 0;
                      let eyeExpense = 0;
                      let eyeActiveShifts = 0;
                      eyeOutRows.forEach((r: { w: any; pt: number }) => {
                        const noteTxt = String(r.w?.note || '');
                        const offDuty = Boolean(r.w?.isOffDuty) || /\[OFF_DUTY(?::|])/.test(noteTxt);
                        if (offDuty) return;
                        eyeActiveShifts += 1;
                        eyeActualPt += r.pt;
                        const nurses = (Number(r.w?.hn) || 0) + (Number(r.w?.rn) || 0);
                        const pn = Number(r.w?.pn) || 0;
                        const clk = Number(r.w?.clerk) || 0;
                        const na = Number(r.w?.na !== undefined ? r.w?.na : r.w?.pca) || 0;
                        const sw = Number(r.w?.serviceWorker) || 0;
                        const tech = clk === 0 && na > 0 ? clk + na : clk;
                        eyeExpense += nurses * 600 + pn * 380 + tech * 300 + sw * 300;
                      });
                      const eyeTargetPt = eyeExpense / 150;
                      const eyeProdPct = eyeTargetPt > 0 ? (eyeActualPt / eyeTargetPt) * 100 : 0;
                      const eyeDiff = eyeActualPt - eyeTargetPt;
                      const eyeCostPerPt = eyeActualPt > 0 ? eyeExpense / eyeActualPt : 0;
                      const eyeStatus =
                        eyeExpense === 0
                          ? 'ไม่มีค่าตอบแทน'
                          : eyeProdPct >= 100
                          ? '🟢 ผ่านเกณฑ์คุ้มทุน (≥100%)'
                          : '🔴 ต่ำกว่าเกณฑ์คุ้มทุน (<100%)';
                      sections.push(
                        `👁️ Productivity เฉพาะ OPD จักษุวิทยา (นอกเวลาราชการ) ประจำ${wlHeader}:\n` +
                          `• Productivity จักษุฯ นอกเวลา: ${eyeProdPct.toFixed(1)}% — ${eyeStatus}\n` +
                          `• ผู้รับบริการจริง: ${eyeActualPt.toLocaleString()} ราย (${eyeActiveShifts} เวร) | ควรรับขั้นต่ำ (÷150): ${eyeTargetPt.toFixed(2)} คน\n` +
                          `• รายจ่ายค่าตอบแทนรวม: ${eyeExpense.toLocaleString()} บาท | ส่วนต่าง: ${eyeDiff >= 0 ? '+' : ''}${eyeDiff.toFixed(2)} คน` +
                          (eyeActualPt > 0 ? `\n• ต้นทุนจริง: ${eyeCostPerPt.toFixed(1)} บ./ราย (เกณฑ์ 150 บ./ราย)` : '')
                      );
                    }
                  }
                }
              }

                  const isPureHelpOrGreeting =
                    cmdLower === '' ||
                    /(?:วิธีใช้|คู่มือ|คำสั่ง|เมนู|ทำอะไรได้|ความสามารถ|แนะนำตัว|\bbot\b|\bhelp\b)/.test(cmdLower) ||
                    (cmdLower.length <= 22 && /^(?:สวัสดี|หวัดดี|ดีครับ|ฮัลโหล|hello|hi|hey)/.test(cmdLower));

                  if (sections.length > 0) {
                    replyText = sections.join('\n\n');
                    addClosingWit = sections.length >= 2;
                  } else if (isPureHelpOrGreeting) {
                    replyText =
                      `🎩 สวัสดีครับ ${speakerCall} ผม "บูบี้" (Booby) เลขานุการส่วนตัวและผู้ช่วย AI ระบบ OPD รพ.ชลประทาน พร้อมดูแลครบทั้ง 5 เมนูบนเว็บแอปครับ:\n\n` +
                      `1️⃣ ภาระงาน & ส่งต่อ/Off เวร: "ยอดภาระงานในเวลาวันนี้", "หน่วยงานไหนยังไม่ได้รายงานบ้าง", "ยอดศูนย์รับ-ส่งต่อ", "ใคร Off เวร"\n` +
                      `2️⃣ วันลา อบรม OT & เบิกเงิน: "วันนี้ใครลาบ้าง", "วันศุกร์มี OT กี่คน", "สรุปเงิน OT เดือนนี้", "สรุปปีงบประมาณ"\n` +
                      `3️⃣ Productivity & กำลังคน: "Productivity เดือนนี้", "คลินิกไหนโหลดสุด", "Admit Rate วันนี้"\n` +
                      `4️⃣ ทะเบียนบุคลากร วันหยุด Cost Center & Audit: "วันหยุดเดือนนี้", "ประวัติแก้ไขล่าสุด", "รายชื่อบุคลากรรายวัน", "Cost Center"\n` +
                      `5️⃣ เลขาส่วนตัว & ความจำกลุ่ม: "สรุปผู้บริหาร", "ลงนัด ...", "สั่งงาน: ...", "สรุปแชต: ...", "ร่างประกาศ: ...", "จำไว้ว่า ..."\n` +
                      `• "/id" (ดูรหัสห้อง/User ID)`;
                    addClosingWit = true;
                  } else {
                    if (visibleNotes.length > 0 && /[?？]|ไหม|มั้ย|อะไร|ยังไง|ข้อตกลง|เรื่อง/.test(txt)) {
                      const qTokens = txt
                        .replace(/[^\u0E00-\u0E7Fa-z0-9\s]/g, ' ')
                        .split(/\s+/)
                        .filter((tk: string) => tk.length >= 2 && !/^(?:อะไร|ไหม|มั้ย|เรื่อง|บูบี้|ช่วย|หน่อย|ข้อตกลง|ถาม)$/.test(tk));
                      const memMatched = visibleNotes.filter((n: ServerGroupNote) =>
                        qTokens.some((tk: string) => n.content.toLowerCase().includes(tk))
                      );
                      if (memMatched.length > 0) {
                        const mLines = memMatched
                          .slice(-5)
                          .map((n: ServerGroupNote, idx: number) => `${idx + 1}. [#${n.id}] ${n.content} (โดย ${n.savedBy})`);
                        replyText = `📒 ${speakerCall} ครับ พบข้อตกลง/บันทึกที่เกี่ยวข้องในความจำ:\n${mLines.join('\n')}`;
                      }
                    }

                    if (!replyText && (!isGroupChat || isMentioned || isReplyToQuote)) {
                      const todayWlRows = workloadsArr.filter((w: any) => normalizeDbDateServer(w.date) === todayYmd);
                      const todayPtSum = todayWlRows.reduce(
                        (s: number, w: any) => s + Math.max(Number(w.totalPt || 0), Number(w.adultPt || 0) + Number(w.childPt || 0)),
                        0
                      );
                      const todayAdmitSum = todayWlRows.reduce((s: number, w: any) => s + Number(w.admit || 0), 0);
                      const inClinicsSnap: string[] = Array.isArray(settingsObj?.inTimeClinics) && settingsObj.inTimeClinics.length > 0
                        ? settingsObj.inTimeClinics
                        : DEFAULT_IN_CLINICS_SERVER;
                      const reportedInSet = new Set(
                        todayWlRows
                          .filter((w: any) => String(w.shift || '').trim() === 'ในเวลา 08:00-16:00')
                          .map((w: any) => (String(w.clinic || '').includes('ปัญญาภิรมย์') ? 'ศูนย์ปัญญาภิรมย์' : String(w.clinic || '').trim()))
                      );
                      const missingTodayIn = inClinicsSnap.filter((c: string) => !reportedInSet.has(c));
                      const todayLeaves = leavesArr.filter((l: any) => {
                        const ls = normalizeDbDateServer(l.startDate);
                        const le = normalizeDbDateServer(l.endDate) || ls;
                        return ls && ls <= todayYmd && le >= todayYmd;
                      });
                      const todayOt = otArr.filter((o: any) => normalizeDbDateServer(o.date) === todayYmd);
                      const curMonthYm = todayYmd.slice(0, 7);
                      const monthOtRows = otArr.filter((o: any) => normalizeDbDateServer(o.date).startsWith(curMonthYm));
                      const monthOtHrs = monthOtRows.reduce((s: number, o: any) => s + (Number(o.hours) > 0 ? Number(o.hours) : 4), 0);
                      const auditsSnap: any[] = Array.isArray(sdb?.auditLogs) ? sdb.auditLogs : [];

                      const snapshotSummary =
                        `สรุปข้อมูลสดจากทั้ง 5 เมนูในระบบ ณ ${formatThaiShortServer(todayYmd)}:\n` +
                        `[เมนู 1&3 ภาระงาน/Census วันนี้] บันทึก ${todayWlRows.length} รายการ • ผู้ป่วยรวม ${todayPtSum} ราย • Admit ${todayAdmitSum} • คลินิกในเวลาที่ยังไม่ได้ส่งรายงาน (${missingTodayIn.length}): ${missingTodayIn.slice(0, 10).join(', ') || 'ครบแล้ว'}\n` +
                        `[เมนู 2 ลา/อบรม/OT] วันนี้ลา ${todayLeaves.length} คน (${todayLeaves.slice(0, 5).map((l: any) => l.staffName).join(', ')}) • วันนี้มี OT ${todayOt.length} คน • เดือนนี้มี OT ${monthOtRows.length} เวร (${monthOtHrs} ชม.)\n` +
                        `[เมนู 4&5 บุคลากร/ระบบ] Staff_Master ${staffArr.length} คน (Active ${staffArr.filter((s: any) => String(s.status || 'Active') === 'Active').length}) • Audit Logs ${auditsSnap.length} รายการ • บันทึกกลุ่มที่มองเห็น ${visibleNotes.length} รายการ`;

                      const aiGeneral = await generateBoobyAiText(
                        `คุณคือ "บูบี้" (Booby) เลขานุการส่วนตัวและผู้ช่วย AI ระบบ OPD รพ.ชลประทาน\n` +
                          `บุคลิก: สุภาพ สุขุม ฉลาด แฝงอารมณ์ขันแบบผู้ดีอังกฤษเล็กน้อย ลงท้ายด้วย "ครับ" เสมอ\n` +
                          `เรียกเจ้าของระบบว่า "${ownerCallName}" และผู้พูดปัจจุบันว่า "${speakerCall}"\n` +
                          `กฎเหล็ก: ห้ามใช้ตาราง Markdown (|---|) ใช้ย่อหน้าสั้น 3-4 บรรทัด อ่านง่ายบนมือถือ LINE ตอบตรงประเด็นโดยอ้างอิงเฉพาะข้อมูลจริงด้านล่าง (ห้ามแต่งตัวเลขเอง)\n` +
                          snapshotSummary,
                        `${speakerCall} ถาม/สั่งงานว่า: ${cmdText || rawText}`
                      );
                      replyText =
                        aiGeneral ||
                        `🎩 ${speakerCall} ครับ บูบี้พร้อมช่วยจัดระเบียบงานครับ ลองระบุคำสั่งสั้นๆ เช่น "ยอดภาระงานในเวลาวันนี้", "หน่วยงานไหนยังไม่ได้รายงานบ้าง", "ใครลาวันนี้", หรือพิมพ์ "เมนู" เพื่อดูความสามารถทั้งหมดได้เลยครับ`;
                    }
                  }
                }
              }
            }
          }

          if (replyText) {
            replyText = formatBoobyPersonaReplyServer(replyText, speakerCall, addClosingWit);
            if (replyText.length > 4950) {
              replyText = `${replyText.slice(0, 4900)}\n...(ข้อความถูกย่อตามขีดจำกัด LINE)`;
            }
            try {
              await fetch('https://api.line.me/v2/bot/message/reply', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  replyToken: ev.replyToken,
                  messages: [{ type: 'text', text: replyText }],
                }),
              });
            } catch {
              // ignore reply failures
            }
          }
        }
      }

      if (serverLineState.gasUrl) {
        try {
          await fetch(serverLineState.gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(body),
          });
        } catch {
          // best-effort forward to Apps Script Settings
        }
      }
    })();
  });

  app.post('/api/line/auto-claim', (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      clientId?: string;
      scheduleId?: string;
      time?: string;
      shift?: string;
      ymd?: string;
      wantImage?: boolean;
    };
    const bkk = getBangkokDateParts();
    const cleanYmd = /^\d{4}-\d{2}-\d{2}$/.test(String(body.ymd || '').trim())
      ? String(body.ymd).trim()
      : bkk.ymd;
    const cleanClientId = String(body.clientId || '').trim().slice(0, 120) || 'browser';
    const wantImage = Boolean(body.wantImage);
    const canonKey = canonicalLineScheduleKeyServer(body.scheduleId, body.time, body.shift);
    const dayKey = `${canonKey}|${cleanYmd}`;

    const autoState = loadLineAutoState();
    const currentMonth = cleanYmd.slice(0, 7);
    if (autoState.quotaPausedMonth && autoState.quotaPausedMonth === currentMonth) {
      res.json({ ok: true, claimed: false, alreadyCompleted: true, quotaExceeded: true });
      return;
    }
    const alreadyDone = wantImage
      ? Boolean(autoState.completedImageKeys[dayKey])
      : Boolean(autoState.completedKeys[dayKey]);
    if (alreadyDone) {
      res.json({ ok: true, claimed: false, alreadyCompleted: true });
      return;
    }

    const nowMs = Date.now();
    const existingClaim = lineInFlightClaims.get(dayKey);
    if (existingClaim && existingClaim.expiresAt > nowMs && existingClaim.clientId !== cleanClientId) {
      res.json({ ok: true, claimed: false, alreadyCompleted: false });
      return;
    }

    const claimToken = `${nowMs}-${Math.random().toString(36).slice(2, 10)}`;
    lineInFlightClaims.set(dayKey, {
      claimToken,
      clientId: cleanClientId,
      wantImage,
      expiresAt: nowMs + LINE_CLAIM_TTL_MS,
    });
    res.json({ ok: true, claimed: true, claimToken });
  });

  app.post('/api/line/auto-complete', (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      scheduleId?: string;
      time?: string;
      shift?: string;
      ymd?: string;
      claimToken?: string;
      ok?: boolean;
      sentWithImage?: boolean;
      quotaExceeded?: boolean;
      statusText?: string;
    };
    const bkk = getBangkokDateParts();
    const cleanYmd = /^\d{4}-\d{2}-\d{2}$/.test(String(body.ymd || '').trim())
      ? String(body.ymd).trim()
      : bkk.ymd;
    const canonKey = canonicalLineScheduleKeyServer(body.scheduleId, body.time, body.shift);
    const dayKey = `${canonKey}|${cleanYmd}`;
    const existingClaim = lineInFlightClaims.get(dayKey);
    if (!existingClaim || existingClaim.claimToken === String(body.claimToken || '').trim() || existingClaim.expiresAt <= Date.now()) {
      lineInFlightClaims.delete(dayKey);
    }

    if (Boolean(body.quotaExceeded)) {
      const autoState = loadLineAutoState();
      autoState.quotaPausedMonth = cleanYmd.slice(0, 7);
      saveLineAutoState(autoState);
      serverLineState.lastSentAt = bkk.timestamp;
      serverLineState.lastStatus = 'ส่งไม่สำเร็จ: โควต้าส่งข้อความ Push รายเดือน LINE เต็มแล้ว (HTTP 429)';
    } else if (Boolean(body.ok)) {
      const autoState = loadLineAutoState();
      autoState.quotaPausedMonth = undefined;
      const sentAt = bkk.timestamp;
      const sentWithImage = Boolean(body.sentWithImage);
      const statusText = String(body.statusText || '').trim().slice(0, 300);
      autoState.completedKeys[dayKey] = {
        at: sentAt,
        withImage: sentWithImage,
        ...(statusText ? { statusText } : {}),
      };
      if (sentWithImage) {
        autoState.completedImageKeys[dayKey] = sentAt;
      }
      saveLineAutoState(autoState);
      serverLineState.lastTriggeredBangkokKeys[dayKey] = true;
      if (body.scheduleId) {
        serverLineState.lastTriggeredBangkokKeys[`${String(body.scheduleId).trim()}|${cleanYmd}`] = true;
      }
      serverLineState.lastSentAt = sentAt;
      if (statusText) {
        serverLineState.lastStatus = statusText;
      }
    }

    res.json({ ok: true });
  });

  app.post('/api/line/send', async (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      targetId?: string;
      targetIds?: string[];
      message?: string;
      imageUrl?: string;
      previewImageUrl?: string;
      sendFormat?: string;
    };
    const primaryTarget = String(body.targetId || serverLineState.targetId || getDefaultGroupId()).trim();
    const targetList =
      Array.isArray(body.targetIds) && body.targetIds.length > 0
        ? body.targetIds.map((t) => String(t || '').trim()).filter(Boolean)
        : [primaryTarget];
    const resolvedFmt = normalizeSendFormatServer(body.sendFormat, body.imageUrl ? true : undefined);
    const result = await pushLineMessages({
      targetIds: targetList,
      text: String(body.message || ''),
      imageUrl: body.imageUrl,
      previewImageUrl: body.previewImageUrl,
      sendFormat: resolvedFmt,
    });
    if (result.ok) {
      const autoState = loadLineAutoState();
      if (autoState.quotaPausedMonth) {
        autoState.quotaPausedMonth = undefined;
        saveLineAutoState(autoState);
      }
    } else if (result.quotaExceeded) {
      const autoState = loadLineAutoState();
      autoState.quotaPausedMonth = getBangkokDateParts().ymd.slice(0, 7);
      saveLineAutoState(autoState);
    }
    const meta = await fetchLineMetadata(targetList[0] || primaryTarget, false);

    res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      targetId: targetList[0] || primaryTarget,
      groupName: meta.groupName,
      sentCount: result.sentCount,
      statusText: result.statusText,
      sentAt: result.sentAt,
      error: result.error,
      quotaExceeded: result.quotaExceeded,
    });
  });

  app.post('/api/line/configure', async (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      enabled?: boolean;
      time?: string;
      reportDayMode?: 'YESTERDAY' | 'TODAY' | 'LATEST_WITH_DATA';
      shift?: string;
      targetId?: string;
      targetGroups?: ServerLineTargetGroup[];
      schedules?: ServerLineSchedule[];
      sendAsImage?: boolean;
      sendFormat?: string;
      gasUrl?: string;
      adminPin?: string;
      boobyOwnerName?: string;
      boobyOwnerUserId?: string;
      boobyGroupMentionOnly?: boolean;
    };

    const enabled = Boolean(body.enabled);
    const cleanTime = normalizeTimeServer(body.time, DEFAULT_LINE_AUTO_TIME);
    const reportDayMode =
      body.reportDayMode === 'YESTERDAY' || body.reportDayMode === 'LATEST_WITH_DATA'
        ? body.reportDayMode
        : 'TODAY';
    const shift = String(body.shift || DEFAULT_LINE_AUTO_SHIFT).trim() || DEFAULT_LINE_AUTO_SHIFT;
    const targetId = String(body.targetId || getDefaultGroupId()).trim();
    const gasUrl = String(body.gasUrl || '').trim();
    const adminPin = String(body.adminPin || '').trim();

    serverLineState.enabled = enabled;
    serverLineState.time = cleanTime;
    serverLineState.reportDayMode = reportDayMode;
    serverLineState.shift = shift;
    serverLineState.targetId = targetId;
    if (Array.isArray(body.targetGroups) && body.targetGroups.length > 0) {
      serverLineState.targetGroups = body.targetGroups;
    }
    if (Array.isArray(body.schedules) && body.schedules.length > 0) {
      serverLineState.schedules = body.schedules.map((s) => ({
        ...s,
        time: normalizeTimeServer(s.time, DEFAULT_LINE_AUTO_TIME),
      }));
    }
    const resolvedSendFormat = normalizeSendFormatServer(body.sendFormat, body.sendAsImage);
    serverLineState.sendFormat = resolvedSendFormat;
    serverLineState.sendAsImage = resolvedSendFormat !== 'TEXT_ONLY';
    if (gasUrl) serverLineState.gasUrl = gasUrl;
    if (adminPin) serverLineState.gasAdminPin = adminPin;
    if (body.boobyOwnerName) {
      serverLineState.boobyOwnerName = String(body.boobyOwnerName).trim() || 'คุณทรงยศ';
    }
    if (body.boobyOwnerUserId !== undefined) {
      serverLineState.boobyOwnerUserId = String(body.boobyOwnerUserId || '').trim();
    }
    if (body.boobyGroupMentionOnly !== undefined) {
      serverLineState.boobyGroupMentionOnly = Boolean(body.boobyGroupMentionOnly);
    }

    // Persist LINE configuration inside server-db.json settings if database exists so restarts retain settings
    try {
      const existingDb = loadServerDb();
      if (existingDb && typeof existingDb === 'object') {
        const mergedSettings = {
          ...(existingDb.settings || {}),
          lineAutoEnabled: serverLineState.enabled,
          lineAutoTime: serverLineState.time,
          lineAutoReportDayMode: serverLineState.reportDayMode,
          lineAutoShift: serverLineState.shift,
          lineTargetId: serverLineState.targetId,
          lineTargetGroups: serverLineState.targetGroups,
          lineSchedules: serverLineState.schedules,
          lineSendAsImage: serverLineState.sendAsImage,
          lineSendFormat: serverLineState.sendFormat,
          ...(serverLineState.gasUrl ? { gasUrl: serverLineState.gasUrl } : {}),
          boobyOwnerName: serverLineState.boobyOwnerName,
          boobyOwnerUserId: serverLineState.boobyOwnerUserId,
          boobyGroupMentionOnly: serverLineState.boobyGroupMentionOnly,
        };
        writeServerDb({ ...existingDb, settings: mergedSettings });
      }
    } catch {
      // ignore persistence failure
    }

    const token = getLineAccessToken();
    const meta = await fetchLineMetadata(targetId, true);

    let gasSynced = false;
    let gasError = '';
    let gasData: Record<string, unknown> | null = null;

    if (gasUrl && adminPin) {
      try {
        const gasRes = await fetch(gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'configureLineAutomation',
            adminPin,
            payload: {
              enabled,
              time: cleanTime,
              reportDayMode,
              shift,
              targetId,
              targetGroups: serverLineState.targetGroups,
              schedules: serverLineState.schedules,
              sendAsImage: serverLineState.sendAsImage,
              sendFormat: serverLineState.sendFormat,
              boobyOwnerName: serverLineState.boobyOwnerName,
              boobyOwnerUserId: serverLineState.boobyOwnerUserId,
              boobyGroupMentionOnly: serverLineState.boobyGroupMentionOnly,
              ...(token ? { channelAccessToken: token } : {}),
            },
          }),
        });
        if (!gasRes.ok) {
          gasError = `Apps Script HTTP ${gasRes.status}`;
        } else {
          const parsed = (await gasRes.json()) as Record<string, unknown>;
          if (parsed && parsed.success !== false) {
            gasSynced = true;
            gasData = parsed;
          } else {
            gasError = String(parsed?.error || 'Apps Script ปฏิเสธการตั้งค่า LINE อัตโนมัติ');
          }
        }
      } catch (err) {
        gasError = String(err instanceof Error ? err.message : err);
      }
    }

    res.json({
      ok: true,
      hasServerToken: Boolean(token),
      tokenVerified: meta.tokenVerified,
      tokenError: meta.tokenError,
      targetId,
      botName: meta.botName,
      groupName: meta.groupName,
      groupVerified: meta.groupVerified,
      groupError: meta.groupError,
      serverAutoEnabled: enabled,
      serverAutoTime: cleanTime,
      serverNextRunAt: enabled ? computeNextRunAtLabel(cleanTime) : '',
      gasSynced,
      gasError,
      gasData,
    });
  });

  // In-process Bangkok time multi-schedule backup (runs when Node server is active)
  setInterval(async () => {
    if (!serverLineState.enabled || !serverLineState.gasUrl) return;
    const token = getLineAccessToken();
    if (!token) return;
    const bkk = getBangkokDateParts();
    const pin = (serverLineState.gasAdminPin || process.env.ADMIN_PIN || '').trim();
    if (!pin) return;

    const activeSchedules =
      serverLineState.schedules && serverLineState.schedules.length > 0
        ? serverLineState.schedules.filter((s) => s.enabled)
        : [
            {
              id: 'default',
              enabled: true,
              time: serverLineState.time,
              dayRule: 'ALL_DAYS' as const,
              reportDayMode: serverLineState.reportDayMode,
              shift: serverLineState.shift,
              sendAsImage: serverLineState.sendAsImage,
            },
          ];

    const targetIds = Array.from(
      new Set(
        [
          ...serverLineState.targetGroups.filter((g) => g.enabled).map((g) => g.id),
          serverLineState.targetId || getDefaultGroupId(),
        ]
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );

    const toMins = (hm: string): number => {
      const [h, m] = hm.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };
    const nowMins = toMins(bkk.hm);
    const autoState = loadLineAutoState();
    if (autoState.quotaPausedMonth && autoState.quotaPausedMonth === bkk.ymd.slice(0, 7)) {
      return;
    }

    for (const sch of activeSchedules) {
      if (!matchesDayRuleServer(bkk.ymd, sch.dayRule || 'ALL_DAYS')) continue;
      const schTime = normalizeTimeServer(sch.time, DEFAULT_LINE_AUTO_TIME);
      const diff = nowMins - toMins(schTime);
      // Full catch-up window aligned with client/GAS
      if (diff < 1 || diff > 75) continue;

      const canonKey = canonicalLineScheduleKeyServer(sch.id, schTime, sch.shift);
      const dayKey = `${canonKey}|${bkk.ymd}`;
      const rawKey = `${sch.id}|${bkk.ymd}`;
      if (
        autoState.completedKeys[dayKey] ||
        serverLineState.lastTriggeredBangkokKeys[dayKey] ||
        serverLineState.lastTriggeredBangkokKeys[rawKey]
      ) {
        continue;
      }

      // Skip if a browser client currently holds an active claim for rendering/uploading .jpeg
      const activeClaim = lineInFlightClaims.get(dayKey);
      if (activeClaim && activeClaim.expiresAt > Date.now()) continue;

      const schedSendFormat: ServerLineSendFormat =
        sch.sendAsImage === false ? 'TEXT_ONLY' : serverLineState.sendFormat;
      // Respect IMAGE_ONLY: server has no headless Chromium, so never send a plain-text fallback
      if (schedSendFormat === 'IMAGE_ONLY') continue;

      // Give open browser clients a 10-minute priority window to render & upload .jpeg before server fallback sends text
      if (schedSendFormat === 'BOTH' && diff < 10) continue;

      if (diff < 15) {
        const sdb = loadServerDb();
        const wRows: any[] = Array.isArray(sdb?.workloads) ? sdb.workloads : [];
        const schShiftNorm = normalizeShiftStrServer(sch.shift);
        const hasTodayShiftData = wRows.some(
          (w: any) =>
            normalizeDateYmdServer(w?.date) === bkk.ymd &&
            (schShiftNorm === 'ALL' || normalizeShiftStrServer(w?.shift) === schShiftNorm)
        );
        if (!hasTodayShiftData) continue; // Let GAS/browser finish grace window rather than pushing premature 0-clinic report
      }
      serverLineState.lastTriggeredBangkokKeys[dayKey] = true;
      serverLineState.lastTriggeredBangkokKeys[rawKey] = true;

      try {
        const gasRes = await fetch(serverLineState.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'sendLineReportNow',
            adminPin: pin,
            payload: {
              targetId: targetIds[0] || getDefaultGroupId(),
              targetIds,
              reportDayMode: sch.reportDayMode,
              shift: sch.shift,
              scheduleId: sch.id,
              scheduleTime: schTime,
              sendFormat: schedSendFormat,
              channelAccessToken: token,
            },
          }),
        });
        if (gasRes.ok) {
          const parsed = (await gasRes.json()) as {
            success?: boolean;
            statusText?: string;
            quotaExceeded?: boolean;
            error?: string;
          };
          if (parsed?.quotaExceeded || /429|monthly limit/i.test(String(parsed?.error || ''))) {
            autoState.quotaPausedMonth = bkk.ymd.slice(0, 7);
            saveLineAutoState(autoState);
            break;
          }
          if (parsed && parsed.success !== false) {
            autoState.completedKeys[dayKey] = {
              at: bkk.timestamp,
              withImage: false,
              statusText: String(parsed.statusText || 'ส่งรายงานสำรองอัตโนมัติ (Server/GAS)').slice(0, 300),
            };
            saveLineAutoState(autoState);
          }
        }
      } catch {
        // Best-effort backup trigger; primary 24/7 cron runs inside Google Apps Script
      }
    }
  }, 30_000);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`PCMC OPD server (HTTP + WebSocket) listening on http://0.0.0.0:${port}`);
  });
}

createAppServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
