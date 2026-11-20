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
  LineAutoReportDayMode,
  isOffDutyWorkload,
  getWorkloadOffDutyReason,
  getWorkloadOffDutyStaff,
  formatOffDutyStaffSummaryText,
} from '../types';
import { formatThaiFullDate, getLocalTodayIso } from './thaiDate';

export interface BuildDailyCensusLineOptions {
  workloads: DailyWorkload[];
  date: string;
  shiftFilter?: 'ALL' | WorkShift | string;
  premiumSubClinics?: string[];
  includeClinicBreakdown?: boolean;
}

export function addDaysToIsoDate(isoDate: string, deltaDays: number): string {
  const m = (isoDate || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return getLocalTodayIso();
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + deltaDays));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}

export function resolveLineAutoReportDate(
  workloads: DailyWorkload[],
  mode: LineAutoReportDayMode = 'YESTERDAY',
  referenceTodayIso: string = getLocalTodayIso()
): string {
  if (mode === 'TODAY') return referenceTodayIso;
  if (mode === 'LATEST_WITH_DATA') {
    const dates = Array.from(
      new Set(
        workloads
          .map((w) => (w.date || '').trim())
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      )
    ).sort();
    return dates.length > 0 ? dates[dates.length - 1] : addDaysToIsoDate(referenceTodayIso, -1);
  }
  return addDaysToIsoDate(referenceTodayIso, -1);
}

export function buildDailyCensusLineMessage({
  workloads,
  date,
  shiftFilter = 'ALL',
  premiumSubClinics = [...DEFAULT_PREMIUM_SUB_CLINICS],
  includeClinicBreakdown = true,
}: BuildDailyCensusLineOptions): string {
  const filtered = workloads.filter((w) => {
    const matchDate = (w.date || '').trim() === (date || '').trim();
    const matchShift = shiftFilter === 'ALL' || w.shift === shiftFilter;
    return matchDate && matchShift;
  });

  const formattedThaiDate = formatThaiFullDate(date);
  const shiftLabel = shiftFilter === 'ALL' ? 'สรุปภาพรวมทุกกะ' : shiftFilter;

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
      groupMap.set(key, {
        date: w.date,
        shift: w.shift,
        poolRows: [],
        subRows: [],
      });
    }
    const grp = groupMap.get(key)!;
    if (w.recordType === 'PREMIUM_POOL') grp.poolRows.push(w);
    else grp.subRows.push(w);
  });

  const premiumGroups = Array.from(groupMap.values()).map((grp) => {
    const staffSource = grp.poolRows.length > 0 ? grp.poolRows : grp.subRows;
    const subOrder = new Map<string, number>();
    premiumSubClinics.forEach((name, idx) => subOrder.set(name, idx));
    const sortedSubs = [...grp.subRows].sort((a, b) => {
      const ra = subOrder.has(a.clinic) ? subOrder.get(a.clinic)! : 999;
      const rb = subOrder.has(b.clinic) ? subOrder.get(b.clinic)! : 999;
      if (ra !== rb) return ra - rb;
      return a.clinic.localeCompare(b.clinic, 'th');
    });
    const adultPt = grp.subRows.reduce((s, r) => s + (r.adultPt || 0), 0);
    const childPt = grp.subRows.reduce((s, r) => s + (r.childPt || 0), 0);
    const totalPt = grp.subRows.reduce((s, r) => s + getEffectiveTotalPt(r), 0);
    const admit = grp.subRows.reduce((s, r) => s + (r.admit || 0), 0);
    const rn = staffSource.reduce((s, r) => s + (r.rn || 0), 0);
    const pn = staffSource.reduce((s, r) => s + (r.pn || 0), 0);
    const na = staffSource.reduce((s, r) => s + (r.na !== undefined ? r.na : r.pca || 0), 0);
    const isGroupOffDuty =
      grp.subRows.length === 0 &&
      grp.poolRows.length > 0 &&
      grp.poolRows.every((r) => isOffDutyWorkload(r));
    const groupOffDutyReason = grp.poolRows.map((r) => getWorkloadOffDutyReason(r)).find(Boolean) || '';
    const groupOffDutyStaff = grp.poolRows.flatMap((r) => getWorkloadOffDutyStaff(r));
    return {
      shift: grp.shift,
      subRows: sortedSubs,
      totalPt: Math.max(totalPt, adultPt + childPt),
      adultPt,
      childPt,
      admit,
      rn,
      pn,
      na,
      isGroupOffDuty,
      groupOffDutyReason,
      groupOffDutyStaff,
    };
  });

  const regularStats = regularWorkloads.reduce(
    (acc, w) => {
      const refTot =
        isReferralWorkload(w) && w.referralData
          ? getReferralTotalCount(normalizeReferralData(w.referralData))
          : 0;
      const effPt = isReferralWorkload(w) && w.referralData ? refTot : getEffectiveTotalPt(w);
      acc.totalPt += effPt;
      acc.adultPt += w.adultPt || 0;
      acc.childPt += w.childPt || 0;
      acc.admit += w.admit || 0;
      acc.rn += w.rn || 0;
      acc.pn += w.pn || 0;
      acc.na += w.na !== undefined ? w.na : w.pca || 0;
      return acc;
    },
    { totalPt: 0, adultPt: 0, childPt: 0, admit: 0, rn: 0, pn: 0, na: 0 }
  );

  const premiumStats = premiumGroups.reduce(
    (acc, g) => {
      acc.totalPt += g.totalPt;
      acc.adultPt += g.adultPt;
      acc.childPt += g.childPt;
      acc.admit += g.admit;
      acc.rn += g.rn;
      acc.pn += g.pn;
      acc.na += g.na;
      return acc;
    },
    { totalPt: 0, adultPt: 0, childPt: 0, admit: 0, rn: 0, pn: 0, na: 0 }
  );

  const totals = {
    totalPt: regularStats.totalPt + premiumStats.totalPt,
    adultPt: regularStats.adultPt + premiumStats.adultPt,
    childPt: regularStats.childPt + premiumStats.childPt,
    admit: regularStats.admit + premiumStats.admit,
    rn: regularStats.rn + premiumStats.rn,
    pn: regularStats.pn + premiumStats.pn,
    na: regularStats.na + premiumStats.na,
  };
  const totalNursing = totals.rn + totals.pn + totals.na;
  const clinicCount = regularWorkloads.length + premiumGroups.length;
  const offDutyCount =
    regularWorkloads.filter((w) => isOffDutyWorkload(w)).length +
    premiumGroups.filter((g) => g.isGroupOffDuty).length;

  let premiumSection = '';
  if (premiumGroups.length > 0) {
    const premiumLines = premiumGroups.map((grp) => {
      if (grp.isGroupOffDuty) {
        return `🌟 ${PREMIUM_CLINIC_GROUP} (${grp.shift}): ⏸️ Off เวร${
          grp.groupOffDutyReason ? ` (${grp.groupOffDutyReason})` : ''
        }`;
      }
      const nursing = grp.rn + grp.pn + grp.na;
      const groupOffText =
        grp.groupOffDutyStaff.length > 0
          ? ` | Off เวรรายวัน: ${formatOffDutyStaffSummaryText(grp.groupOffDutyStaff)}`
          : '';
      const headerLine = `🌟 ${PREMIUM_CLINIC_GROUP} (${grp.shift}): ${grp.totalPt.toLocaleString()} ราย (Admit ${grp.admit}) | พยาบาล ${nursing.toFixed(1)} แรง${groupOffText}`;
      const subLines = grp.subRows.map(
        (sub) =>
          `  ↳ ${sub.clinic}: ${getEffectiveTotalPt(sub).toLocaleString()} ราย${
            sub.admit > 0 ? ` (Admit ${sub.admit})` : ''
          }`
      );
      return [headerLine, ...subLines].join('\n');
    });
    premiumSection = `\n──────────────────\n${premiumLines.join('\n')}`;
  }

  const referralRows = regularWorkloads.filter((w) => isReferralWorkload(w) && w.referralData);
  let referralSection = '';
  if (referralRows.length > 0) {
    const mergedCounts = REFERRAL_ITEM_DEFINITIONS.map(({ key, label }) => {
      let count = 0;
      const reasons: string[] = [];
      referralRows.forEach((w) => {
        const norm = normalizeReferralData(w.referralData);
        count += Number(norm[key]?.count) || 0;
        if (norm[key]?.reason) reasons.push(norm[key].reason);
      });
      return `  • ${label}: ${count > 0 ? count : '-'}${
        reasons.length > 0 ? ` (${Array.from(new Set(reasons)).join(', ')})` : ''
      }`;
    });
    const refTotal = referralRows.reduce(
      (s, w) => s + getReferralTotalCount(normalizeReferralData(w.referralData)),
      0
    );
    const reporters = Array.from(
      new Set(referralRows.map((w) => (w.reporter || '').trim()).filter(Boolean))
    );
    referralSection = `\n──────────────────\n🚑 ห้องรับ - ส่งต่อผู้ป่วย (รวม ${refTotal} รายการ)\n${mergedCounts.join(
      '\n'
    )}${reporters.length > 0 ? `\nผู้รายงาน: ${reporters.join(', ')}` : ''}`;
  }

  let regularBreakdown = '';
  if (includeClinicBreakdown && regularWorkloads.length > 0) {
    const lines = regularWorkloads.map((w) => {
      if (isOffDutyWorkload(w)) {
        const offReason = getWorkloadOffDutyReason(w);
        return `• ${w.clinic} (${w.shift}): ⏸️ Off เวร${offReason ? ` (${offReason})` : ''}`;
      }
      const pt =
        isReferralWorkload(w) && w.referralData
          ? getReferralTotalCount(normalizeReferralData(w.referralData))
          : getEffectiveTotalPt(w);
      const nursing = (w.rn || 0) + (w.pn || 0) + (w.na !== undefined ? w.na : w.pca || 0);
      const offStaff = getWorkloadOffDutyStaff(w);
      const offStaffText =
        offStaff.length > 0 ? ` | Off เวรรายวัน: ${formatOffDutyStaffSummaryText(offStaff)}` : '';
      return `• ${w.clinic} (${w.shift}): ${pt.toLocaleString()} ราย${
        w.admit > 0 ? ` | Admit ${w.admit}` : ''
      } | พยาบาล ${nursing.toFixed(1)}${offStaffText}`;
    });
    regularBreakdown = `\n──────────────────\n📋 รายละเอียดแยกห้องตรวจ:\n${lines.join('\n')}`;
  }

  if (filtered.length === 0) {
    return `📊 รายงานสถิติผู้ป่วยนอก OPD PCMC
🏥 รพ.ศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน
📅 ประจำวันที่: ${formattedThaiDate} (${shiftLabel})
──────────────────
⚠️ ยังไม่พบข้อมูลบันทึกภาระงานในวันที่และกะเวลาที่กำหนด`;
  }

  const message = `📊 รายงานภาระงานผู้ป่วยนอก OPD PCMC
🏥 รพ.ศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน
📅 ประจำวันที่: ${formattedThaiDate} (${shiftLabel})
──────────────────
👥 ผู้ป่วยนอกรวม: ${totals.totalPt.toLocaleString()} ราย (ผู้ใหญ่ ${totals.adultPt.toLocaleString()} | เด็ก ${totals.childPt.toLocaleString()})
🛌 รับไว้รักษา (Admit): ${totals.admit.toLocaleString()} ราย
👩‍⚕️ กำลังคนพยาบาลปฏิบัติงาน (RN+PN+NA): ${totalNursing.toFixed(1)} แรง
(RN: ${totals.rn.toFixed(1)} | PN: ${totals.pn.toFixed(1)} | NA: ${totals.na.toFixed(1)})${regularBreakdown}${premiumSection}${referralSection}
──────────────────
บันทึกทั้งหมด ${clinicCount} คลินิกหลัก${
    offDutyCount > 0 ? ` (เปิดบริการ ${clinicCount - offDutyCount} | Off เวร ${offDutyCount})` : ''
  }`;

  // LINE Messaging API single text message limit is 5000 chars
  return message.length > 4950 ? `${message.slice(0, 4900)}\n...(ข้อความถูกย่อตามขีดจำกัด LINE)` : message;
}
