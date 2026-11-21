import {
  DailyWorkload,
  WorkShift,
  PREMIUM_CLINIC_GROUP,
  DEFAULT_PREMIUM_SUB_CLINICS,
  isPremiumWorkloadRecord,
  normalizeWorkloadRecord,
  getEffectiveTotalPt,
  isReferralWorkload,
  normalizeReferralData,
  REFERRAL_ITEM_DEFINITIONS,
  getReferralTotalCount,
  getReferralAdmitCount,
  isOffDutyWorkload,
  getWorkloadOffDutyReason,
  getWorkloadOffDutyStaff,
  formatOffDutyStaffSummaryText,
} from '../types';
import { formatThaiFullDate, formatThaiDateTime } from './thaiDate';

export interface RenderCensusJpegOptions {
  workloads: DailyWorkload[];
  date: string;
  shiftFilter?: 'ALL' | WorkShift | string;
  premiumSubClinics?: string[];
}

interface TableRowVisual {
  noText: string;
  clinicText: string;
  badgeText?: string;
  shiftText: string;
  totalPt: string;
  adultPt: string;
  childPt: string;
  admit: string;
  hn: string;
  rn: string;
  pn: string;
  na: string;
  clerk: string;
  sw: string;
  reporter: string;
  note: string;
  kind: 'normal' | 'referralHeader' | 'referralSub' | 'premiumHeader' | 'premiumSub' | 'offDuty';
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const s = (text || '').trim();
  if (!s) return '';
  if (ctx.measureText(s).width <= maxWidth) return s;
  let cut = s;
  while (cut.length > 1 && ctx.measureText(`${cut}...`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}...`;
}

function buildVisualRows(options: RenderCensusJpegOptions): {
  rows: TableRowVisual[];
  totals: {
    clinicCount: number;
    totalPt: number;
    adultPt: number;
    childPt: number;
    admit: number;
    hn: number;
    rn: number;
    pn: number;
    na: number;
    clerk: number;
    sw: number;
  };
} {
  const shiftFilter = options.shiftFilter || 'ในเวลา 08:00-16:00';
  const premiumSubClinics = options.premiumSubClinics || [...DEFAULT_PREMIUM_SUB_CLINICS];
  const filtered = options.workloads.filter((w) => {
    const matchDate = (w.date || '').trim() === (options.date || '').trim();
    const matchShift = shiftFilter === 'ALL' || w.shift === shiftFilter;
    return matchDate && matchShift;
  });

  const regularWorkloads: DailyWorkload[] = [];
  const groupMap = new Map<
    string,
    { date: string; shift: WorkShift; poolRows: DailyWorkload[]; subRows: DailyWorkload[] }
  >();

  filtered.forEach((raw) => {
    if (!isPremiumWorkloadRecord(raw, premiumSubClinics)) {
      regularWorkloads.push(raw);
      return;
    }
    const w = normalizeWorkloadRecord(raw, premiumSubClinics);
    const key = `${w.date}|${w.shift}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, { date: w.date, shift: w.shift, poolRows: [], subRows: [] });
    }
    const grp = groupMap.get(key)!;
    if (w.recordType === 'PREMIUM_POOL') grp.poolRows.push(w);
    else grp.subRows.push(w);
  });

  const rows: TableRowVisual[] = [];
  let idxCounter = 0;

  let totPt = 0;
  let totAdult = 0;
  let totChild = 0;
  let totAdmit = 0;
  let totHn = 0;
  let totRn = 0;
  let totPn = 0;
  let totNa = 0;
  let totClerk = 0;
  let totSw = 0;

  regularWorkloads.forEach((w) => {
    idxCounter += 1;
    const isRef = isReferralWorkload(w);
    const refData = isRef ? normalizeReferralData(w.referralData) : null;
    const effTotal = isRef && refData ? getReferralTotalCount(refData) : getEffectiveTotalPt(w);
    const effAdmit = isRef && refData ? getReferralAdmitCount(refData) : w.admit || 0;
    const naVal = w.na !== undefined ? w.na : w.pca || 0;
    const offDuty = isOffDutyWorkload(w);
    const offStaff = getWorkloadOffDutyStaff(w);
    const offNote = offDuty
      ? `Off เวร${getWorkloadOffDutyReason(w) ? `: ${getWorkloadOffDutyReason(w)}` : ''}`
      : offStaff.length > 0
      ? `Off รายวัน: ${formatOffDutyStaffSummaryText(offStaff)}${w.note ? ` | ${w.note}` : ''}`
      : w.note || '-';

    totPt += effTotal;
    totAdult += w.adultPt || 0;
    totChild += w.childPt || 0;
    totAdmit += effAdmit;
    totHn += w.hn || 0;
    totRn += w.rn || 0;
    totPn += w.pn || 0;
    totNa += naVal;
    totClerk += w.clerk || 0;
    totSw += w.serviceWorker || 0;

    rows.push({
      noText: String(idxCounter),
      clinicText: w.clinic,
      badgeText: isRef ? `รวม ${effTotal} รายการ` : offDuty ? 'Off เวร' : undefined,
      shiftText: w.shift,
      totalPt: effTotal.toLocaleString(),
      adultPt: (w.adultPt || 0).toLocaleString(),
      childPt: (w.childPt || 0).toLocaleString(),
      admit: effAdmit.toLocaleString(),
      hn: String(w.hn || 0),
      rn: String(w.rn || 0),
      pn: String(w.pn || 0),
      na: String(naVal),
      clerk: String(w.clerk || 0),
      sw: String(w.serviceWorker || 0),
      reporter: w.reporter || '-',
      note: isRef ? 'รายละเอียดตามรายการย่อย' : offNote,
      kind: isRef ? 'referralHeader' : offDuty ? 'offDuty' : 'normal',
    });

    if (isRef && refData) {
      REFERRAL_ITEM_DEFINITIONS.forEach((def) => {
        const item = refData[def.key];
        const isAdmitSub = def.key === 'admitPrivate' || def.key === 'admitGeneral';
        rows.push({
          noText: '•',
          clinicText: `↳ ${def.label}`,
          shiftText: w.shift,
          totalPt: String(item.count || 0),
          adultPt: '-',
          childPt: '-',
          admit: isAdmitSub ? String(item.count || 0) : '-',
          hn: '',
          rn: '',
          pn: 'ใช้กำลังคนร่วม (Pooled Staffing)',
          na: '',
          clerk: '',
          sw: '',
          reporter: w.reporter || '-',
          note: item.reason || '-',
          kind: 'referralSub',
        });
      });
    }
  });

  const subOrder = new Map<string, number>();
  premiumSubClinics.forEach((n, i) => subOrder.set(n, i));

  Array.from(groupMap.values()).forEach((grp) => {
    idxCounter += 1;
    const staffSrc = grp.poolRows.length > 0 ? grp.poolRows : grp.subRows;
    const sortedSubs = [...grp.subRows].sort((a, b) => {
      const ra = subOrder.has(a.clinic) ? subOrder.get(a.clinic)! : 999;
      const rb = subOrder.has(b.clinic) ? subOrder.get(b.clinic)! : 999;
      if (ra !== rb) return ra - rb;
      return a.clinic.localeCompare(b.clinic, 'th');
    });
    const adultPt = grp.subRows.reduce((s, r) => s + (r.adultPt || 0), 0);
    const childPt = grp.subRows.reduce((s, r) => s + (r.childPt || 0), 0);
    const totalPt = Math.max(
      grp.subRows.reduce((s, r) => s + getEffectiveTotalPt(r), 0),
      adultPt + childPt
    );
    const admit = grp.subRows.reduce((s, r) => s + (r.admit || 0), 0);
    const hn = staffSrc.reduce((s, r) => s + (r.hn || 0), 0);
    const rn = staffSrc.reduce((s, r) => s + (r.rn || 0), 0);
    const pn = staffSrc.reduce((s, r) => s + (r.pn || 0), 0);
    const na = staffSrc.reduce((s, r) => s + (r.na !== undefined ? r.na : r.pca || 0), 0);
    const clerk = staffSrc.reduce((s, r) => s + (r.clerk || 0), 0);
    const sw = staffSrc.reduce((s, r) => s + (r.serviceWorker || 0), 0);
    const reporters = Array.from(new Set([...grp.poolRows, ...grp.subRows].map((r) => r.reporter).filter(Boolean)));
    const notes = Array.from(new Set(grp.poolRows.map((r) => r.note).filter(Boolean)));

    totPt += totalPt;
    totAdult += adultPt;
    totChild += childPt;
    totAdmit += admit;
    totHn += hn;
    totRn += rn;
    totPn += pn;
    totNa += na;
    totClerk += clerk;
    totSw += sw;

    rows.push({
      noText: String(idxCounter),
      clinicText: PREMIUM_CLINIC_GROUP,
      badgeText: `รวม ${sortedSubs.length} แผนก`,
      shiftText: grp.shift,
      totalPt: totalPt.toLocaleString(),
      adultPt: adultPt.toLocaleString(),
      childPt: childPt.toLocaleString(),
      admit: admit.toLocaleString(),
      hn: String(hn),
      rn: String(rn),
      pn: String(pn),
      na: String(na),
      clerk: String(clerk),
      sw: String(sw),
      reporter: reporters.join(', ') || '-',
      note: notes.join(' | ') || '-',
      kind: 'premiumHeader',
    });

    sortedSubs.forEach((sub) => {
      rows.push({
        noText: '•',
        clinicText: `↳ ${sub.clinic}`,
        shiftText: sub.shift,
        totalPt: getEffectiveTotalPt(sub).toLocaleString(),
        adultPt: (sub.adultPt || 0).toLocaleString(),
        childPt: (sub.childPt || 0).toLocaleString(),
        admit: (sub.admit || 0).toLocaleString(),
        hn: '',
        rn: '',
        pn: 'ใช้กำลังคนร่วม (Pooled Staffing)',
        na: '',
        clerk: '',
        sw: '',
        reporter: sub.reporter || '-',
        note: sub.note || '-',
        kind: 'premiumSub',
      });
    });
  });

  return {
    rows,
    totals: {
      clinicCount: idxCounter,
      totalPt: totPt,
      adultPt: totAdult,
      childPt: totChild,
      admit: totAdmit,
      hn: totHn,
      rn: totRn,
      pn: totPn,
      na: totNa,
      clerk: totClerk,
      sw: totSw,
    },
  };
}

/**
 * Renders the Daily OPD Census Report (matching Image 4 layout) onto an offscreen Canvas
 * and returns both dataUrl (data:image/jpeg;base64,...) and raw base64 payload.
 */
export function renderDailyCensusReportJpegDataUrl(options: RenderCensusJpegOptions): {
  dataUrl: string;
  base64: string;
} {
  const { rows, totals } = buildVisualRows(options);
  const shiftLabel = !options.shiftFilter || options.shiftFilter === 'ALL' ? 'ทุกกะเวลา' : options.shiftFilter;
  const thaiDate = formatThaiFullDate(options.date);
  const printedAt = formatThaiDateTime(new Date().toISOString());

  const width = 1600;
  const padX = 28;
  const tableWidth = width - padX * 2; // 1544
  const headerH = 112;
  const colHeaderH = 44;
  const rowH = 34;
  const totalH = 40;
  const footerH = 100;
  const bodyRowsCount = Math.max(1, rows.length);
  const height = headerH + colHeaderH + bodyRowsCount * rowH + totalH + footerH + 24;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const fontRegular = '14px "Sarabun", "Noto Sans Thai", "Tahoma", sans-serif';
  const fontBold = 'bold 14px "Sarabun", "Noto Sans Thai", "Tahoma", sans-serif';
  const fontSmall = '12px "Sarabun", "Noto Sans Thai", "Tahoma", sans-serif';
  const fontSmallItalic = 'italic 12px "Sarabun", "Noto Sans Thai", "Tahoma", sans-serif';

  // Hospital Title Header
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 23px "Sarabun", "Noto Sans Thai", "Tahoma", sans-serif';
  ctx.fillText(
    'โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน มหาวิทยาลัยศรีนครินทรวิโรฒ',
    width / 2,
    40
  );
  ctx.font = 'bold 17px "Sarabun", "Noto Sans Thai", "Tahoma", sans-serif';
  ctx.fillStyle = '#1e293b';
  ctx.fillText('รายงานสถิติผู้ป่วยนอกและอัตรากำลังประจำวัน (Daily OPD Census Report)', width / 2, 68);
  ctx.font = '14px "Sarabun", "Noto Sans Thai", "Tahoma", sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText(
    `วันที่: ${thaiDate}   •   กะเวลา: ${shiftLabel}   •   ส่งรายงานเมื่อ: ${printedAt}`,
    width / 2,
    94
  );

  // Header divider
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(padX, headerH - 6);
  ctx.lineTo(width - padX, headerH - 6);
  ctx.stroke();

  // Column widths (sum = 1544)
  const cols = [
    { label: 'ที่', w: 42, align: 'center' as const },
    { label: 'ห้องตรวจ / แผนก', w: 268, align: 'left' as const },
    { label: 'กะเวลา', w: 160, align: 'left' as const },
    { label: 'ผู้ป่วยรวม', w: 72, align: 'right' as const },
    { label: 'ผู้ใหญ่', w: 62, align: 'right' as const },
    { label: 'เด็ก', w: 56, align: 'right' as const },
    { label: 'Admit', w: 58, align: 'right' as const },
    { label: 'HN', w: 48, align: 'right' as const },
    { label: 'RN', w: 52, align: 'right' as const },
    { label: 'PN', w: 52, align: 'right' as const },
    { label: 'NA', w: 52, align: 'right' as const },
    { label: 'ผู้ปฏิบัติงานทั่วไป', w: 108, align: 'right' as const },
    { label: 'พนักงานบริการ', w: 94, align: 'right' as const },
    { label: 'ผู้บันทึกรายงาน', w: 170, align: 'left' as const },
    { label: 'หมายเหตุ', w: 250, align: 'left' as const },
  ];

  // Table header row
  let curY = headerH + 2;
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(padX, curY, tableWidth, colHeaderH);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  ctx.strokeRect(padX, curY, tableWidth, colHeaderH);

  let curX = padX;
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 13px "Sarabun", "Noto Sans Thai", "Tahoma", sans-serif';
  cols.forEach((col, i) => {
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(curX, curY);
      ctx.lineTo(curX, curY + colHeaderH);
      ctx.stroke();
    }
    ctx.textBaseline = 'middle';
    if (col.align === 'center') {
      ctx.textAlign = 'center';
      ctx.fillText(col.label, curX + col.w / 2, curY + colHeaderH / 2);
    } else if (col.align === 'right') {
      ctx.textAlign = 'right';
      ctx.fillText(col.label, curX + col.w - 8, curY + colHeaderH / 2);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(col.label, curX + 8, curY + colHeaderH / 2);
    }
    curX += col.w;
  });

  curY += colHeaderH;

  if (rows.length === 0) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(padX, curY, tableWidth, rowH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.strokeRect(padX, curY, tableWidth, rowH);
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.font = fontRegular;
    ctx.fillText('ยังไม่มีข้อมูลบันทึกภาระงานในวันที่และกะเวลาที่เลือก', width / 2, curY + rowH / 2);
    curY += rowH;
  } else {
    rows.forEach((row, rIdx) => {
      const bg =
        row.kind === 'referralHeader'
          ? '#eff6ff'
          : row.kind === 'referralSub'
          ? '#f8fafc'
          : row.kind === 'premiumHeader'
          ? '#fffbeb'
          : row.kind === 'premiumSub'
          ? '#fffdf5'
          : row.kind === 'offDuty'
          ? '#fefce8'
          : rIdx % 2 === 1
          ? '#f8fafc'
          : '#ffffff';

      ctx.fillStyle = bg;
      ctx.fillRect(padX, curY, tableWidth, rowH);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(padX, curY, tableWidth, rowH);

      const isGroupHeader = row.kind === 'referralHeader' || row.kind === 'premiumHeader';
      const isSub = row.kind === 'referralSub' || row.kind === 'premiumSub';

      const values = [
        row.noText,
        row.badgeText ? `${row.clinicText} [${row.badgeText}]` : row.clinicText,
        row.shiftText,
        row.totalPt,
        row.adultPt,
        row.childPt,
        row.admit,
        row.hn,
        row.rn,
        row.pn,
        row.na,
        row.clerk,
        row.sw,
        row.reporter,
        row.note,
      ];

      let cx = padX;
      cols.forEach((col, cIdx) => {
        if (cIdx > 0 && !(isSub && cIdx >= 8 && cIdx <= 12)) {
          ctx.strokeStyle = '#e2e8f0';
          ctx.beginPath();
          ctx.moveTo(cx, curY);
          ctx.lineTo(cx, curY + rowH);
          ctx.stroke();
        }

        // Merged pooled staffing text for sub rows across HN..SW columns (indices 7..12)
        if (isSub && cIdx === 7) {
          const spanW = cols.slice(7, 13).reduce((s, c) => s + c.w, 0);
          ctx.fillStyle = '#ea580c';
          ctx.font = fontSmallItalic;
          ctx.textAlign = 'center';
          ctx.fillText('ใช้กำลังคนร่วม (Pooled Staffing)', cx + spanW / 2, curY + rowH / 2);
          cx += col.w;
          return;
        }
        if (isSub && cIdx > 7 && cIdx <= 12) {
          cx += col.w;
          return;
        }

        const rawVal = values[cIdx] || '';
        ctx.font =
          isGroupHeader || cIdx === 3
            ? fontBold
            : isSub && cIdx >= 13
            ? fontSmall
            : fontRegular;

        if (cIdx === 3) {
          ctx.fillStyle = '#1e3a8a';
        } else if (cIdx === 6 && Number(rawVal.replace(/,/g, '')) > 0) {
          ctx.fillStyle = '#dc2626';
          ctx.font = fontBold;
        } else if (cIdx === 8) {
          ctx.fillStyle = '#1d4ed8';
          ctx.font = fontBold;
        } else if (row.kind === 'offDuty' && cIdx === 1) {
          ctx.fillStyle = '#92400e';
          ctx.font = fontBold;
        } else if (isGroupHeader && cIdx === 1) {
          ctx.fillStyle = row.kind === 'referralHeader' ? '#1e3a8a' : '#78350f';
          ctx.font = fontBold;
        } else {
          ctx.fillStyle = '#1e293b';
        }

        const clipped = truncateText(ctx, rawVal, col.w - 14);
        if (col.align === 'center') {
          ctx.textAlign = 'center';
          ctx.fillText(clipped, cx + col.w / 2, curY + rowH / 2);
        } else if (col.align === 'right') {
          ctx.textAlign = 'right';
          ctx.fillText(clipped, cx + col.w - 8, curY + rowH / 2);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(clipped, cx + 8, curY + rowH / 2);
        }
        cx += col.w;
      });

      curY += rowH;
    });
  }

  // Totals Footer Row
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(padX, curY, tableWidth, totalH);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(padX, curY, tableWidth, totalH);

  // Colored highlights matching Image 4 totals row
  const colStartX = (idx: number) => padX + cols.slice(0, idx).reduce((s, c) => s + c.w, 0);
  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(colStartX(3), curY + 1, cols[3].w, totalH - 2);
  ctx.fillStyle = '#fee2e2';
  ctx.fillRect(colStartX(6), curY + 1, cols[6].w, totalH - 2);
  ctx.fillStyle = '#e0f2fe';
  ctx.fillRect(colStartX(8), curY + 1, cols[8].w, totalH - 2);
  ctx.fillStyle = '#dcfce7';
  ctx.fillRect(colStartX(9), curY + 1, cols[9].w + cols[10].w, totalH - 2);

  const nursingSum = totals.rn + totals.pn + totals.na;
  const totalValues = [
    '',
    `ยอดรวมทั้งสิ้น (${totals.clinicCount} คลินิก)`,
    '',
    totals.totalPt.toLocaleString(),
    totals.adultPt.toLocaleString(),
    totals.childPt.toLocaleString(),
    totals.admit.toLocaleString(),
    totals.hn.toFixed(1),
    totals.rn.toFixed(1),
    totals.pn.toFixed(1),
    totals.na.toFixed(1),
    totals.clerk.toFixed(1),
    totals.sw.toFixed(1),
    '',
    `กำลังคนพยาบาลรวม: ${nursingSum.toFixed(1)} แรง`,
  ];

  let tx = padX;
  cols.forEach((col, i) => {
    if (i === 1) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0f172a';
      ctx.font = fontBold;
      ctx.fillText(totalValues[1], tx + (col.w + cols[2].w) / 2, curY + totalH / 2);
    } else if (i === 2 || i === 13) {
      // merged
    } else if (i === 14) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0f172a';
      ctx.font = fontBold;
      ctx.fillText(totalValues[14], tx - cols[13].w / 2 + (cols[13].w + col.w) / 2, curY + totalH / 2);
    } else if (i >= 3) {
      ctx.font = fontBold;
      ctx.fillStyle = i === 6 ? '#991b1b' : i === 3 ? '#1e3a8a' : '#0f172a';
      ctx.textAlign = 'right';
      ctx.fillText(totalValues[i], tx + col.w - 8, curY + totalH / 2);
    }
    tx += col.w;
  });

  // Signature lines matching Image 4
  const sigY = curY + totalH + 54;
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.font = fontRegular;
  ctx.fillStyle = '#334155';
  ctx.textAlign = 'center';
  ctx.fillText('ลงชื่อ ............................................................................', width * 0.28, sigY);
  ctx.fillText('ลงชื่อ ............................................................................', width * 0.72, sigY);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
  const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
  return { dataUrl, base64 };
}
