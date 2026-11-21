import dotenv from 'dotenv';
import fs from 'fs';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

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

interface LineServerAutomationState {
  enabled: boolean;
  time: string;
  reportDayMode: 'YESTERDAY' | 'TODAY' | 'LATEST_WITH_DATA';
  shift: string;
  targetId: string;
  targetGroups: ServerLineTargetGroup[];
  schedules: ServerLineSchedule[];
  sendAsImage: boolean;
  gasUrl: string;
  gasAdminPin: string;
  lastSentAt: string;
  lastStatus: string;
  lastTriggeredBangkokKeys: Record<string, boolean>;
  detectedGroupId: string;
  detectedGroupName: string;
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
  gasUrl: '',
  gasAdminPin: (process.env.ADMIN_PIN || '').trim(),
  lastSentAt: '',
  lastStatus: '',
  lastTriggeredBangkokKeys: {},
  detectedGroupId: '',
  detectedGroupName: '',
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

  if (result.tokenVerified && resolvedTarget && resolvedTarget.startsWith('C')) {
    try {
      const grpRes = await fetch(
        `https://api.line.me/v2/bot/group/${encodeURIComponent(resolvedTarget)}/summary`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
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

async function pushLineMessages(params: {
  targetIds: string[];
  text?: string;
  imageUrl?: string;
  previewImageUrl?: string;
}): Promise<{ ok: boolean; statusText: string; sentAt: string; sentCount: number; error?: string }> {
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

  const messages: Array<Record<string, unknown>> = [];
  if (params.imageUrl && /^https:\/\//i.test(params.imageUrl.trim())) {
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
  if (cleanText) {
    const finalMessage =
      cleanText.length > 4950
        ? `${cleanText.slice(0, 4900)}\n...(ข้อความถูกย่อตามขีดจำกัด LINE)`
        : cleanText;
    messages.push({ type: 'text', text: finalMessage });
  }
  if (messages.length === 0) {
    return { ok: false, statusText: 'ไม่มีข้อความหรือรูปภาพสำหรับส่ง', sentAt, sentCount: 0, error: 'ไม่มีข้อมูลส่ง' };
  }

  let successCount = 0;
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

  serverLineState.lastSentAt = sentAt;
  if (successCount > 0 && errors.length === 0) {
    const okStatus = `ส่งรายงานเข้า ${successCount} กลุ่ม LINE ผ่าน Server Proxy สำเร็จ`;
    serverLineState.lastStatus = okStatus;
    return { ok: true, statusText: okStatus, sentAt, sentCount: successCount };
  }
  if (successCount > 0) {
    const partial = `ส่งสำเร็จ ${successCount}/${targets.length} กลุ่ม (${errors[0]})`;
    serverLineState.lastStatus = partial;
    return { ok: true, statusText: partial, sentAt, sentCount: successCount, error: errors.join('; ') };
  }
  const errMsg = errors[0] || 'ส่งเข้า LINE ไม่สำเร็จ';
  serverLineState.lastStatus = `ส่งไม่สำเร็จ: ${errMsg}`;
  return { ok: false, statusText: serverLineState.lastStatus, sentAt, sentCount: 0, error: errMsg };
}

async function createAppServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '8mb' }));

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

  app.post('/api/line/webhook', (req: Request, res: Response) => {
    // Always return HTTP 200 OK immediately with zero 302 redirects for LINE Platform verification
    res.status(200).json({ status: 'ok' });

    const body = (req.body || {}) as {
      events?: Array<{
        type?: string;
        replyToken?: string;
        source?: { groupId?: string; roomId?: string; userId?: string };
        message?: { type?: string; text?: string };
      }>;
    };
    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length === 0) return;

    void (async () => {
      const token = getLineAccessToken();
      for (const ev of events) {
        const src = ev?.source;
        if (!src) continue;
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

        serverLineState.detectedGroupId = detectedId;
        if (groupName) {
          serverLineState.detectedGroupName = groupName;
        }

        const txt =
          ev.type === 'message' && ev.message?.type === 'text'
            ? String(ev.message.text || '').trim().toLowerCase()
            : '';

        if (
          token &&
          ev.replyToken &&
          (txt === '/id' || txt === '/groupid' || txt === 'ขอรหัสกลุ่ม' || txt === 'id')
        ) {
          try {
            await fetch('https://api.line.me/v2/bot/message/reply', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                replyToken: ev.replyToken,
                messages: [
                  {
                    type: 'text',
                    text:
                      `รหัสกลุ่ม LINE (Group ID) สำหรับตั้งค่าออโตเมชั่น OPD:\n${detectedId}` +
                      (groupName ? `\nกลุ่ม: ${groupName}` : ''),
                  },
                ],
              }),
            });
          } catch {
            // ignore reply failures (e.g. dummy reply tokens)
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

  app.post('/api/line/send', async (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      targetId?: string;
      targetIds?: string[];
      message?: string;
      imageUrl?: string;
      previewImageUrl?: string;
    };
    const primaryTarget = String(body.targetId || serverLineState.targetId || getDefaultGroupId()).trim();
    const targetList =
      Array.isArray(body.targetIds) && body.targetIds.length > 0
        ? body.targetIds.map((t) => String(t || '').trim()).filter(Boolean)
        : [primaryTarget];
    const result = await pushLineMessages({
      targetIds: targetList,
      text: String(body.message || ''),
      imageUrl: body.imageUrl,
      previewImageUrl: body.previewImageUrl,
    });
    const meta = await fetchLineMetadata(targetList[0] || primaryTarget, false);

    res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      targetId: targetList[0] || primaryTarget,
      groupName: meta.groupName,
      sentCount: result.sentCount,
      statusText: result.statusText,
      sentAt: result.sentAt,
      error: result.error,
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
      gasUrl?: string;
      adminPin?: string;
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
    if (typeof body.sendAsImage === 'boolean') {
      serverLineState.sendAsImage = body.sendAsImage;
    }
    if (gasUrl) serverLineState.gasUrl = gasUrl;
    if (adminPin) serverLineState.gasAdminPin = adminPin;

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

    for (const sch of activeSchedules) {
      if (bkk.hm !== sch.time) continue;
      if (!matchesDayRuleServer(bkk.ymd, sch.dayRule || 'ALL_DAYS')) continue;
      const key = `${sch.id}|${bkk.ymd}`;
      if (serverLineState.lastTriggeredBangkokKeys[key]) continue;
      serverLineState.lastTriggeredBangkokKeys[key] = true;

      try {
        await fetch(serverLineState.gasUrl, {
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
              channelAccessToken: token,
            },
          }),
        });
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
  app.listen(port, '0.0.0.0', () => {
    console.log(`PCMC OPD server listening on http://0.0.0.0:${port}`);
  });
}

createAppServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
