import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_LINE_GROUP_ID = 'C21630721218bccf814848fcf793e1746';
const DEFAULT_LINE_AUTO_TIME = '03:59';

interface LineServerAutomationState {
  enabled: boolean;
  time: string;
  reportDayMode: 'YESTERDAY' | 'TODAY' | 'LATEST_WITH_DATA';
  shift: string;
  targetId: string;
  gasUrl: string;
  lastSentAt: string;
  lastStatus: string;
  lastTriggeredBangkokDay: string;
  detectedGroupId: string;
  detectedGroupName: string;
}

interface LineMetadataCache {
  fetchedAt: number;
  targetId: string;
  botName: string;
  groupName: string;
  groupVerified: boolean;
  groupError: string;
}

const serverLineState: LineServerAutomationState = {
  enabled: false,
  time: DEFAULT_LINE_AUTO_TIME,
  reportDayMode: 'YESTERDAY',
  shift: 'ALL',
  targetId: (process.env.LINE_GROUP_ID || DEFAULT_LINE_GROUP_ID).trim(),
  gasUrl: '',
  lastSentAt: '',
  lastStatus: '',
  lastTriggeredBangkokDay: '',
  detectedGroupId: '',
  detectedGroupName: '',
};

let lineMetaCache: LineMetadataCache | null = null;

function getLineAccessToken(): string {
  return (process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
}

function getDefaultGroupId(): string {
  return (process.env.LINE_GROUP_ID || DEFAULT_LINE_GROUP_ID).trim();
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
  const hh = m ? Math.min(23, Math.max(0, Number(m[1]))) : 3;
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
    lineMetaCache.targetId === resolvedTarget &&
    Date.now() - lineMetaCache.fetchedAt < 60_000
  ) {
    return lineMetaCache;
  }

  const result: LineMetadataCache = {
    fetchedAt: Date.now(),
    targetId: resolvedTarget,
    botName: '',
    groupName: '',
    groupVerified: false,
    groupError: '',
  };

  if (!token) {
    result.groupError = 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN บนเซิร์ฟเวอร์';
    lineMetaCache = result;
    return result;
  }

  try {
    const botRes = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (botRes.ok) {
      const botData = (await botRes.json()) as { displayName?: string };
      result.botName = String(botData.displayName || '').trim();
    } else {
      const errTxt = await botRes.text();
      result.groupError = `Bot Token ตรวจสอบไม่ผ่าน (HTTP ${botRes.status}): ${errTxt}`;
    }
  } catch (err) {
    result.groupError = String(err instanceof Error ? err.message : err);
  }

  if (resolvedTarget && resolvedTarget.startsWith('C')) {
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

async function pushLineTextMessage(
  targetId: string,
  text: string
): Promise<{ ok: boolean; statusText: string; sentAt: string; error?: string }> {
  const token = getLineAccessToken();
  const to = (targetId || getDefaultGroupId()).trim();
  const sentAt = getBangkokDateParts().timestamp;

  if (!token) {
    const err = 'เซิร์ฟเวอร์ยังไม่มี LINE_CHANNEL_ACCESS_TOKEN';
    serverLineState.lastSentAt = sentAt;
    serverLineState.lastStatus = `ส่งไม่สำเร็จ: ${err}`;
    return { ok: false, statusText: serverLineState.lastStatus, sentAt, error: err };
  }
  if (!to) {
    const err = 'ยังไม่ได้ระบุ LINE Group ID';
    serverLineState.lastSentAt = sentAt;
    serverLineState.lastStatus = `ส่งไม่สำเร็จ: ${err}`;
    return { ok: false, statusText: serverLineState.lastStatus, sentAt, error: err };
  }
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    return { ok: false, statusText: 'ไม่มีข้อความสำหรับส่ง', sentAt, error: 'ข้อความว่างเปล่า' };
  }

  const finalMessage =
    cleanText.length > 4950 ? `${cleanText.slice(0, 4900)}\n...(ข้อความถูกย่อตามขีดจำกัด LINE)` : cleanText;

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to,
        messages: [{ type: 'text', text: finalMessage }],
      }),
    });

    if (res.ok) {
      const okStatus = 'ส่งรายงานเข้ากลุ่ม LINE ผ่าน Server Proxy สำเร็จ';
      serverLineState.lastSentAt = sentAt;
      serverLineState.lastStatus = okStatus;
      return { ok: true, statusText: okStatus, sentAt };
    }

    const errText = await res.text();
    const errMsg = `LINE API HTTP ${res.status}: ${errText}`;
    serverLineState.lastSentAt = sentAt;
    serverLineState.lastStatus = `ส่งไม่สำเร็จ: ${errMsg}`;
    return { ok: false, statusText: serverLineState.lastStatus, sentAt, error: errMsg };
  } catch (err) {
    const errMsg = String(err instanceof Error ? err.message : err);
    serverLineState.lastSentAt = sentAt;
    serverLineState.lastStatus = `ส่งไม่สำเร็จ: ${errMsg}`;
    return { ok: false, statusText: serverLineState.lastStatus, sentAt, error: errMsg };
  }
}

async function createAppServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

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
    const body = (req.body || {}) as { targetId?: string; message?: string };
    const targetId = String(body.targetId || serverLineState.targetId || getDefaultGroupId()).trim();
    const result = await pushLineTextMessage(targetId, String(body.message || ''));
    const meta = await fetchLineMetadata(targetId, false);

    res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      targetId,
      groupName: meta.groupName,
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
      gasUrl?: string;
      adminPin?: string;
    };

    const enabled = Boolean(body.enabled);
    const timeMatch = String(body.time || DEFAULT_LINE_AUTO_TIME)
      .trim()
      .match(/^(\d{2}):(\d{2})$/);
    const cleanTime = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : DEFAULT_LINE_AUTO_TIME;
    const reportDayMode =
      body.reportDayMode === 'TODAY' || body.reportDayMode === 'LATEST_WITH_DATA'
        ? body.reportDayMode
        : 'YESTERDAY';
    const shift = String(body.shift || 'ALL').trim() || 'ALL';
    const targetId = String(body.targetId || getDefaultGroupId()).trim();
    const gasUrl = String(body.gasUrl || '').trim();
    const adminPin = String(body.adminPin || '').trim();

    serverLineState.enabled = enabled;
    serverLineState.time = cleanTime;
    serverLineState.reportDayMode = reportDayMode;
    serverLineState.shift = shift;
    serverLineState.targetId = targetId;
    if (gasUrl) serverLineState.gasUrl = gasUrl;

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

  // In-process Bangkok time scheduler backup (runs when Node server is active)
  setInterval(async () => {
    if (!serverLineState.enabled || !serverLineState.gasUrl) return;
    const token = getLineAccessToken();
    if (!token) return;
    const bkk = getBangkokDateParts();
    if (bkk.hm !== serverLineState.time) return;
    if (serverLineState.lastTriggeredBangkokDay === bkk.ymd) return;
    serverLineState.lastTriggeredBangkokDay = bkk.ymd;

    const pin = (process.env.ADMIN_PIN || '').trim();
    if (!pin) return;
    try {
      await fetch(serverLineState.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'sendLineReportNow',
          adminPin: pin,
          payload: {
            targetId: serverLineState.targetId || getDefaultGroupId(),
            reportDayMode: serverLineState.reportDayMode,
            shift: serverLineState.shift,
            channelAccessToken: token,
          },
        }),
      });
    } catch {
      // Best-effort backup trigger; primary 24/7 cron runs inside Google Apps Script
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
