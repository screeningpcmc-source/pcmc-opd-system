import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  DailyWorkload,
  StaffMember,
  WorkShift,
  SHIFTS,
  getEffectiveTotalPt,
  PREMIUM_CLINIC_GROUP,
  DEFAULT_PREMIUM_SUB_CLINICS,
  isPremiumWorkloadRecord,
  normalizeWorkloadRecord,
  REFERRAL_ITEM_DEFINITIONS,
  ReferralCenterData,
  formatReferralSummaryText,
  getReferralAdmitCount,
  getReferralTotalCount,
  isReferralWorkload,
  normalizeReferralData,
  SystemSettings,
  CustomHoliday,
  LineSendFormat,
  resolveLineSendFormat,
  isDailyWagePosition,
  formatPositionLabel,
  isOffDutyWorkload,
  getWorkloadOffDutyReason,
  getWorkloadOffDutyStaff,
  formatOffDutyStaffSummaryText,
  OFF_DUTY_STAFF_REASON_PRESETS,
  normalizeWorkloadDateStr,
  normalizeWorkloadShiftStr,
} from '../types';
import { formatThaiFullDate, formatThaiShortDate, formatThaiDateTime, THAI_SHORT_MONTHS, getLocalTodayIso } from '../utils/thaiDate';
import { isWeekendOrThaiHoliday } from '../utils/thaiHolidays';
import { buildDailyCensusLineMessage } from '../utils/lineReport';
import { exportElementAsJpeg, captureElementAsJpegDataUrl } from '../utils/exportImage';
import { ThaiDateInput } from './ThaiDateInput';
import { 
  FileText, 
  Printer, 
  Download, 
  Calendar, 
  Clock, 
  Users, 
  Bed, 
  Activity, 
  Copy, 
  Check, 
  TrendingUp,
  Pencil,
  Trash2,
  X,
  Save,
  ImageDown,
  AlertCircle,
  Star,
  Send,
  Loader2,
  Plus,
  PauseCircle
} from 'lucide-react';

interface DailyCensusTabProps {
  workloads: DailyWorkload[];
  staffList?: StaffMember[];
  isAdmin?: boolean;
  premiumSubClinics?: string[];
  settings?: SystemSettings;
  onUpdateWorkload?: (updated: DailyWorkload, reason: string) => void;
  onDeleteWorkload?: (id: string, reason: string) => void;
  onSendLineReportNow?: (params: {
    date: string;
    shift: string;
    message: string;
    imageDataUrl?: string;
    sendAsImage?: boolean;
    sendFormat?: LineSendFormat;
  }) => Promise<{ ok: boolean; error?: string }>;
}

const getDefaultShiftForCensusDate = (
  isoDate: string,
  customHolidays: CustomHoliday[] = []
): WorkShift =>
  isWeekendOrThaiHoliday(isoDate, customHolidays)
    ? 'นอกเวลาวันหยุด 08:00-12:00'
    : 'ในเวลา 08:00-16:00';

interface PremiumCensusGroup {
  key: string;
  date: string;
  shift: WorkShift;
  poolRows: DailyWorkload[];
  subRows: DailyWorkload[];
  primaryPoolRecord: DailyWorkload | null;
  totalPt: number;
  adultPt: number;
  childPt: number;
  admit: number;
  hn: number;
  rn: number;
  pn: number;
  na: number;
  clerk: number;
  serviceWorker: number;
  reporter: string;
  note: string;
}

export const DailyCensusTab: React.FC<DailyCensusTabProps> = ({ 
  workloads,
  staffList = [],
  isAdmin = false,
  premiumSubClinics = [...DEFAULT_PREMIUM_SUB_CLINICS],
  settings,
  onUpdateWorkload,
  onDeleteWorkload,
  onSendLineReportNow,
}) => {
  const todayStr = getLocalTodayIso();

  const [date, setDate] = useState<string>(todayStr);
  const [shiftFilter, setShiftFilter] = useState<string>(() =>
    getDefaultShiftForCensusDate(todayStr, settings?.customHolidays || [])
  );
  const [lineSendFormat, setLineSendFormat] = useState<LineSendFormat>(() =>
    resolveLineSendFormat(settings?.lineSendFormat, settings?.lineSendAsImage)
  );
  const [copied, setCopied] = useState<boolean>(false);
  const [isSendingLine, setIsSendingLine] = useState<boolean>(false);
  const [isExportingJpeg, setIsExportingJpeg] = useState<boolean>(false);

  useEffect(() => {
    setLineSendFormat(resolveLineSendFormat(settings?.lineSendFormat, settings?.lineSendAsImage));
  }, [settings?.lineSendFormat, settings?.lineSendAsImage]);
  const [editingWorkload, setEditingWorkload] = useState<DailyWorkload | null>(null);
  const [adminAddOffDutyStaffId, setAdminAddOffDutyStaffId] = useState<string>('');
  const [editWorkloadReason, setEditWorkloadReason] = useState<string>('');
  const [editWorkloadReasonError, setEditWorkloadReasonError] = useState<string>('');
  const [editModalError, setEditModalError] = useState<string>('');
  const [deletingWorkload, setDeletingWorkload] = useState<DailyWorkload | null>(null);
  const [deleteWorkloadReason, setDeleteWorkloadReason] = useState<string>('');
  const [deleteWorkloadReasonError, setDeleteWorkloadReasonError] = useState<string>('');
  const reportSheetRef = useRef<HTMLDivElement | null>(null);
  const formattedThaiDate = useMemo(() => formatThaiFullDate(date), [date]);
  const allDailyWageStaff = useMemo(
    () => staffList.filter((s) => s.status === 'Active' && isDailyWagePosition(s.position)),
    [staffList]
  );

  // Filter workloads for this date and shift
  const filteredWorkloads = useMemo(() => {
    const targetDateNorm = normalizeWorkloadDateStr(date);
    const shiftNorm = normalizeWorkloadShiftStr(shiftFilter);
    return workloads.filter(w => {
      const matchDate = normalizeWorkloadDateStr(w.date) === targetDateNorm;
      const matchShift = shiftNorm === 'ALL' || normalizeWorkloadShiftStr(w.shift) === shiftNorm;
      return matchDate && matchShift;
    });
  }, [workloads, date, shiftFilter]);

  // Separate standard clinics vs Pooled Staffing Premium groups (Master-Detail)
  const { regularWorkloads, premiumGroups } = useMemo(() => {
    const regular: DailyWorkload[] = [];
    const groupMap = new Map<string, { date: string; shift: WorkShift; poolRows: DailyWorkload[]; subRows: DailyWorkload[] }>();

    filteredWorkloads.forEach((raw) => {
      if (!isPremiumWorkloadRecord(raw, premiumSubClinics)) {
        regular.push(raw);
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
      if (w.recordType === 'PREMIUM_POOL') {
        grp.poolRows.push(w);
      } else {
        grp.subRows.push(w);
      }
    });

    const groups: PremiumCensusGroup[] = Array.from(groupMap.entries()).map(([key, grp]) => {
      const allRows = [...grp.poolRows, ...grp.subRows];
      const staffSource = grp.poolRows.length > 0 ? grp.poolRows : grp.subRows;
      const subOrder = new Map<string, number>();
      premiumSubClinics.forEach((name, idx) => subOrder.set(name, idx));
      const sortedSubs = [...grp.subRows].sort((a, b) => {
        const ra = subOrder.has(a.clinic) ? subOrder.get(a.clinic)! : 999;
        const rb = subOrder.has(b.clinic) ? subOrder.get(b.clinic)! : 999;
        if (ra !== rb) return ra - rb;
        return a.clinic.localeCompare(b.clinic, 'th');
      });

      const reporters = Array.from(new Set(allRows.map((r) => (r.reporter || '').trim()).filter(Boolean)));
      const notes = Array.from(new Set(grp.poolRows.map((r) => (r.note || '').trim()).filter(Boolean)));

      return {
        key,
        date: grp.date,
        shift: grp.shift,
        poolRows: grp.poolRows,
        subRows: sortedSubs,
        primaryPoolRecord: grp.poolRows[0] || null,
        totalPt: allRows.reduce((s, r) => s + getEffectiveTotalPt(r), 0),
        adultPt: allRows.reduce((s, r) => s + (r.adultPt || 0), 0),
        childPt: allRows.reduce((s, r) => s + (r.childPt || 0), 0),
        admit: allRows.reduce((s, r) => s + (r.admit || 0), 0),
        hn: staffSource.reduce((s, r) => s + (r.hn || 0), 0),
        rn: staffSource.reduce((s, r) => s + (r.rn || 0), 0),
        pn: staffSource.reduce((s, r) => s + (r.pn || 0), 0),
        na: staffSource.reduce((s, r) => s + (r.na !== undefined ? r.na : (r.pca || 0)), 0),
        clerk: staffSource.reduce((s, r) => s + (r.clerk || 0), 0),
        serviceWorker: staffSource.reduce((s, r) => s + (r.serviceWorker || 0), 0),
        reporter: reporters[0] || '-',
        note: notes.join(' / '),
      };
    });

    return { regularWorkloads: regular, premiumGroups: groups };
  }, [filteredWorkloads, premiumSubClinics]);

  const clinicCount = regularWorkloads.length + premiumGroups.length;
  const offDutyCount =
    regularWorkloads.filter(isOffDutyWorkload).length +
    premiumGroups.filter(
      (grp) => grp.subRows.length === 0 && grp.poolRows.length > 0 && grp.poolRows.every(isOffDutyWorkload)
    ).length;
  const activeClinicCount = Math.max(0, clinicCount - offDutyCount);
  const offDutyStaffCount =
    regularWorkloads.reduce((s, w) => s + getWorkloadOffDutyStaff(w).length, 0) +
    premiumGroups.reduce(
      (s, grp) => s + grp.poolRows.reduce((ps, r) => ps + getWorkloadOffDutyStaff(r).length, 0),
      0
    );

  // Aggregate Totals (PREMIUM_POOL has 0 patients, PREMIUM_SUB has 0 staffing -> zero double-counting)
  const totals = useMemo(() => {
    return filteredWorkloads.reduce(
      (acc, curr) => ({
        totalPt: acc.totalPt + getEffectiveTotalPt(curr),
        adultPt: acc.adultPt + (curr.adultPt || 0),
        childPt: acc.childPt + (curr.childPt || 0),
        admit: acc.admit + (curr.admit || 0),
        hn: acc.hn + (curr.hn || 0),
        rn: acc.rn + (curr.rn || 0),
        pn: acc.pn + (curr.pn || 0),
        na: acc.na + (curr.na !== undefined ? curr.na : (curr.pca || 0)),
        clerk: acc.clerk + (curr.clerk || 0),
        serviceWorker: acc.serviceWorker + (curr.serviceWorker || 0),
      }),
      { totalPt: 0, adultPt: 0, childPt: 0, admit: 0, hn: 0, rn: 0, pn: 0, na: 0, clerk: 0, serviceWorker: 0 }
    );
  }, [filteredWorkloads]);

  const totalNursingOnDuty = totals.rn + totals.pn + totals.na;

  const referralRecords = useMemo(
    () => filteredWorkloads.filter((w) => isReferralWorkload(w) && !isOffDutyWorkload(w)),
    [filteredWorkloads]
  );

  const referralSummarySheet = useMemo(() => {
    if (referralRecords.length === 0) return null;
    const aggregated = REFERRAL_ITEM_DEFINITIONS.map(({ key, label }) => {
      let count = 0;
      const reasons: string[] = [];
      referralRecords.forEach((rec) => {
        const ref = rec.referralData;
        if (!ref) return;
        count += Number(ref[key]?.count) || 0;
        const r = (ref[key]?.reason || '').trim();
        if (r && !reasons.includes(r)) reasons.push(r);
      });
      return { key, label, count, reason: reasons.join('; ') };
    });
    const totalCount = aggregated.reduce((sum, item) => sum + item.count, 0);
    const reporters = Array.from(
      new Set(referralRecords.map((r) => (r.reporter || '').trim()).filter(Boolean))
    );
    const m = (date || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    const day = m ? String(Number(m[3])) : '-';
    const month = m ? THAI_SHORT_MONTHS[Number(m[2]) - 1] || '-' : '-';
    const beYear = m ? String(Number(m[1]) + 543) : '-';
    return {
      rows: aggregated,
      totalCount,
      reporterText: reporters.join(', ') || '-',
      day,
      month,
      beYear,
    };
  }, [referralRecords, date]);

  // Print function
  const handlePrint = () => {
    window.print();
  };

  // Export Report as .JPEG image
  const handleExportJpeg = async () => {
    if (!reportSheetRef.current) return;
    setIsExportingJpeg(true);
    try {
      const shiftSlug = shiftFilter === 'ALL' ? 'ทุกกะ' : shiftFilter.replace(/[^\wก-ฮะ-์]+/g, '_');
      await exportElementAsJpeg(reportSheetRef.current, `OPD_Census_${date}_${shiftSlug}.jpeg`);
    } catch (err) {
      console.error('Export JPEG error:', err);
    } finally {
      setIsExportingJpeg(false);
    }
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      'ลำดับ', 'ห้องตรวจ', 'กะเวลา', 'ผู้ป่วยทั้งหมด', 'ผู้ใหญ่', 'เด็ก', 
      'Admit', 'HN', 'RN', 'PN', 'NA', 'ผู้ปฏิบัติงานทั่วไป', 'พนักงานบริการ', 'ผู้รายงาน', 'หมายเหตุ'
    ];

    const rows: (string | number)[][] = regularWorkloads.map((w, i) => {
      const itemIsOffDuty = isOffDutyWorkload(w);
      const itemOffReason = getWorkloadOffDutyReason(w);
      const itemOffStaff = getWorkloadOffDutyStaff(w);
      const noteParts: string[] = [];
      if (itemIsOffDuty) {
        noteParts.push(`Off เวร: ${itemOffReason || 'งดออกตรวจ'}`);
      } else if (isReferralWorkload(w) && w.referralData) {
        const refText = formatReferralSummaryText(w.referralData);
        if (refText) noteParts.push(refText);
      }
      if (!itemIsOffDuty && itemOffStaff.length > 0) {
        noteParts.push(`Off เวรรายวัน: ${formatOffDutyStaffSummaryText(itemOffStaff)}`);
      }
      if (w.note) noteParts.push(w.note);
      const noteWithReferral = noteParts.join(' | ');
      return [
        i + 1,
        `"${w.clinic}"`,
        `"${w.shift}"`,
        getEffectiveTotalPt(w),
        w.adultPt,
        w.childPt,
        w.admit,
        w.hn,
        w.rn,
        w.pn,
        w.na !== undefined ? w.na : (w.pca || 0),
        w.clerk,
        w.serviceWorker,
        `"${w.reporter}"`,
        `"${noteWithReferral.replace(/"/g, '""')}"`
      ];
    });

    premiumGroups.forEach((grp, idx) => {
      const isGroupOffDuty =
        grp.subRows.length === 0 && grp.poolRows.length > 0 && grp.poolRows.every(isOffDutyWorkload);
      const groupOffReason = grp.poolRows.map(getWorkloadOffDutyReason).filter(Boolean).join(', ');
      const groupOffStaff = grp.poolRows.flatMap(getWorkloadOffDutyStaff);
      const groupNoteParts: string[] = [];
      if (isGroupOffDuty) {
        groupNoteParts.push(`Off เวร: ${groupOffReason || 'งดออกตรวจ'}`);
      } else if (groupOffStaff.length > 0) {
        groupNoteParts.push(`Off เวรรายวัน: ${formatOffDutyStaffSummaryText(groupOffStaff)}`);
      }
      if (grp.note) groupNoteParts.push(grp.note);
      const groupLabel = isGroupOffDuty
        ? `${PREMIUM_CLINIC_GROUP} (Off เวร)`
        : `${PREMIUM_CLINIC_GROUP} (รวม ${grp.subRows.length} แผนก - กำลังคนรวม)`;

      rows.push([
        regularWorkloads.length + idx + 1,
        `"${groupLabel}"`,
        `"${grp.shift}"`,
        grp.totalPt,
        grp.adultPt,
        grp.childPt,
        grp.admit,
        grp.hn,
        grp.rn,
        grp.pn,
        grp.na,
        grp.clerk,
        grp.serviceWorker,
        `"${grp.reporter}"`,
        `"${(groupNoteParts.join(' | ') || 'Pooled Staffing').replace(/"/g, '""')}"`
      ]);
      grp.subRows.forEach((sub) => {
        rows.push([
          '-',
          `"  ↳ ${sub.clinic}"`,
          `"${sub.shift}"`,
          getEffectiveTotalPt(sub),
          sub.adultPt,
          sub.childPt,
          sub.admit,
          0,
          0,
          0,
          0,
          0,
          0,
          `"${sub.reporter}"`,
          `"${(sub.note || 'ใช้กำลังคนร่วม').replace(/"/g, '""')}"`
        ]);
      });
    });

    // Total row
    rows.push([
      'รวมทั้งสิ้น',
      '-',
      '-',
      totals.totalPt,
      totals.adultPt,
      totals.childPt,
      totals.admit,
      totals.hn,
      totals.rn,
      totals.pn,
      totals.na,
      totals.clerk,
      totals.serviceWorker,
      '-',
      '-'
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `OPD_Census_${date}_${shiftFilter === 'ALL' ? 'ทุกกะ' : shiftFilter}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const currentLineMessage = useMemo(
    () =>
      buildDailyCensusLineMessage({
        workloads,
        date,
        shiftFilter,
        premiumSubClinics,
        includeClinicBreakdown: true,
      }),
    [workloads, date, shiftFilter, premiumSubClinics]
  );

  // Copy Summary text for LINE message
  const handleCopySummary = () => {
    navigator.clipboard.writeText(currentLineMessage).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleSendLineNowClick = async () => {
    if (!onSendLineReportNow || isSendingLine) return;
    setIsSendingLine(true);
    try {
      const wantImage = lineSendFormat !== 'TEXT_ONLY';
      let imageDataUrl: string | undefined;
      if (wantImage && reportSheetRef.current) {
        try {
          imageDataUrl = await captureElementAsJpegDataUrl(reportSheetRef.current);
        } catch {
          imageDataUrl = undefined;
        }
      }
      await onSendLineReportNow({
        date,
        shift: shiftFilter,
        message: currentLineMessage,
        imageDataUrl,
        sendAsImage: wantImage,
        sendFormat: lineSendFormat,
      });
    } finally {
      setIsSendingLine(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Notice (Hidden on Print) */}
      <div className="no-print bg-gradient-to-r from-blue-50 via-indigo-50 to-cyan-50 border border-blue-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-blue-950">
              เมนูที่ 3: รายงานผู้ป่วยประจำวัน (Daily OPD Census Report)
            </h2>
            <p className="text-xs text-blue-800">
              สรุปยอดผู้ป่วยรายห้องตรวจ, ยอด Admit, กำลังคนแต่ละวิชาชีพ, พร้อมพิมพ์ใบรายงานทางการ
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopySummary}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white text-blue-800 border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'คัดลอกข้อความแล้ว!' : 'คัดลอกสรุปส่ง LINE'}</span>
          </button>
          {isAdmin && onSendLineReportNow && (
            <div className="inline-flex items-center rounded-lg border border-emerald-600 bg-white overflow-hidden shadow-xs">
              <select
                value={lineSendFormat}
                onChange={(e) => setLineSendFormat(e.target.value as LineSendFormat)}
                disabled={isSendingLine}
                title="เลือกรูปแบบรายงานที่ส่งเข้ากลุ่ม LINE"
                aria-label="รูปแบบส่ง LINE"
                className="text-[11px] font-semibold text-emerald-900 bg-emerald-50 border-r border-emerald-200 py-1.5 pl-2 pr-1.5 outline-none cursor-pointer disabled:opacity-60"
              >
                <option value="BOTH">ภาพ + ข้อความ</option>
                <option value="IMAGE_ONLY">เฉพาะภาพ .JPEG</option>
                <option value="TEXT_ONLY">เฉพาะข้อความ</option>
              </select>
              <button
                type="button"
                onClick={handleSendLineNowClick}
                disabled={isSendingLine}
                title={`ส่งรายงานวันที่ ${formatThaiShortDate(date)} เข้ากลุ่ม LINE (${
                  (settings?.lineTargetGroups || []).filter((g) => g.enabled).length > 1
                    ? `${(settings?.lineTargetGroups || []).filter((g) => g.enabled).length} กลุ่ม`
                    : settings?.lineTargetId || 'กลุ่มหลัก OPD'
                }) ทันที`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white transition-colors cursor-pointer"
              >
                {isSendingLine ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>
                  {isSendingLine
                    ? lineSendFormat === 'TEXT_ONLY'
                      ? 'กำลังส่งข้อความ...'
                      : 'กำลังสร้างภาพและส่ง...'
                    : lineSendFormat === 'IMAGE_ONLY'
                    ? 'ส่ง LINE (เฉพาะภาพ .JPEG)'
                    : lineSendFormat === 'TEXT_ONLY'
                    ? 'ส่ง LINE (เฉพาะข้อความ)'
                    : 'ส่ง LINE (ภาพ + ข้อความ)'}
                </span>
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white text-emerald-800 border border-emerald-300 rounded-lg hover:bg-emerald-50 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>ส่งออก CSV</span>
          </button>
          <button
            type="button"
            onClick={handleExportJpeg}
            disabled={isExportingJpeg}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 disabled:opacity-60 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <ImageDown className="w-3.5 h-3.5" />
            <span>{isExportingJpeg ? 'กำลังสร้างรูป...' : 'บันทึกเป็น .JPEG'}</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-blue-700 hover:bg-blue-600 text-white rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>พิมพ์รายงาน / PDF</span>
          </button>
        </div>
      </div>

      {/* Filter Toolbar (Hidden on Print) */}
      <div className="no-print bg-white rounded-2xl shadow-xs border border-gray-200/90 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500 shrink-0" />
            <label className="text-xs font-bold text-gray-700 whitespace-nowrap">วันที่ (พ.ศ.):</label>
            <ThaiDateInput
              value={date}
              onChange={(newDate) => {
                setDate(newDate);
                setShiftFilter(getDefaultShiftForCensusDate(newDate, settings?.customHolidays || []));
              }}
              className="w-40"
              selectClassName="w-full text-xs rounded-lg border border-gray-300 py-1.5 pl-2.5 pr-8 bg-white font-medium text-gray-900 outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-500" />
            <label className="text-xs font-bold text-gray-700">กะเวลา:</label>
            <select
              value={shiftFilter}
              onChange={(e) => setShiftFilter(e.target.value)}
              className="text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white"
            >
              <option value="ALL">-- ทุกกะเวลา (รวมทั้งวัน) --</option>
              {SHIFTS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs text-gray-500">
          แสดงข้อมูล <span className="font-bold text-blue-900">{clinicCount}</span> คลินิก
          {offDutyCount > 0 && (
            <span className="text-violet-800 font-semibold ml-1">
              (เปิดบริการ {activeClinicCount} | Off เวร {offDutyCount})
            </span>
          )}
          {offDutyStaffCount > 0 && (
            <span className="text-violet-800 font-semibold ml-1">
              (Off เวรรายวัน {offDutyStaffCount} คน)
            </span>
          )}
          {premiumGroups.length > 0 && (
            <span className="text-orange-700 font-semibold ml-1">
              (รวม {PREMIUM_CLINIC_GROUP} {premiumGroups.reduce((s, g) => s + g.subRows.length, 0)} แผนกย่อย)
            </span>
          )}
        </div>
      </div>

      {/* Summary KPI Cards (Hidden on Print) */}
      <div className="no-print grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 border border-blue-200 shadow-2xs">
          <div className="flex items-center justify-between text-blue-600 mb-1">
            <span className="text-xs font-bold">ผู้ป่วยนอกรวม</span>
            <Activity className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-blue-950">
            {totals.totalPt.toLocaleString()} <span className="text-xs font-normal text-gray-500">คน</span>
          </div>
          <div className="text-[11px] text-gray-500 mt-1">
            ผู้ใหญ่: {totals.adultPt} | เด็ก: {totals.childPt}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-red-200 shadow-2xs">
          <div className="flex items-center justify-between text-red-600 mb-1">
            <span className="text-xs font-bold">ยอดรับไว้รักษา (Admit)</span>
            <Bed className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-red-950">
            {totals.admit.toLocaleString()} <span className="text-xs font-normal text-gray-500">เตียง</span>
          </div>
          <div className="text-[11px] text-red-600 mt-1 font-semibold">
            Admit Rate: {totals.totalPt > 0 ? ((totals.admit / totals.totalPt) * 100).toFixed(2) : 0}%
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-emerald-200 shadow-2xs">
          <div className="flex items-center justify-between text-emerald-600 mb-1">
            <span className="text-xs font-bold">กำลังคนพยาบาล</span>
            <Users className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-emerald-950">
            {totalNursingOnDuty.toFixed(1)} <span className="text-xs font-normal text-gray-500">แรง</span>
          </div>
          <div className="text-[11px] text-gray-500 mt-1">
            RN: {totals.rn.toFixed(1)} | PN: {totals.pn.toFixed(1)} | NA: {totals.na.toFixed(1)}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-purple-200 shadow-2xs">
          <div className="flex items-center justify-between text-purple-600 mb-1">
            <span className="text-xs font-bold">อัตราส่วนผู้ป่วยต่อพยาบาล</span>
            <TrendingUp className="w-4 h-4" />
          </div>
          <div className="text-2xl font-extrabold text-purple-950">
            {totalNursingOnDuty > 0 ? (totals.totalPt / totalNursingOnDuty).toFixed(1) : 0}{' '}
            <span className="text-xs font-normal text-gray-500">คน/แรง</span>
          </div>
          <div className="text-[11px] text-gray-500 mt-1">
            ผู้ปฏิบัติงานทั่วไป: {totals.clerk.toFixed(1)} | พนักงานบริการ: {totals.serviceWorker.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Main Census Report Sheet (Print A4 Landscape & JPEG Optimized) */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-4 sm:p-5 overflow-x-auto print:overflow-visible print:p-0 print:border-none print:shadow-none">
        <div
          ref={reportSheetRef}
          className="print-landscape-sheet w-[1030px] max-w-full print:w-full mx-auto bg-white space-y-3.5 print:space-y-2"
        >
          {/* Printable Hospital Header */}
          <div className="border-b border-gray-300 pb-2.5 text-center">
            <h3 className="text-base sm:text-lg font-bold text-gray-950 print:text-sm">
              โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน มหาวิทยาลัยศรีนครินทรวิโรฒ
            </h3>
            <p className="text-xs font-semibold text-gray-700 mt-0.5 print:text-[10.5px]">
              รายงานสถิติผู้ป่วยนอกและอัตรากำลังประจำวัน (Daily OPD Census Report)
            </p>
            <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1 text-xs text-gray-600 mt-1 print:text-[9.5px]">
              <span><strong>วันที่:</strong> {formattedThaiDate}</span>
              <span>•</span>
              <span><strong>กะเวลา:</strong> {shiftFilter === 'ALL' ? 'ทุกกะเวลา' : shiftFilter}</span>
              <span>•</span>
              <span><strong>พิมพ์เมื่อ:</strong> {new Date().toLocaleString('th-TH')}</span>
            </div>
          </div>

          {/* Detailed Table (A4 Landscape Fit - Zero Overflow) */}
          <div className="print-fit-container">
            <table className="w-full table-fixed text-left text-[11px] border border-gray-300 border-collapse print:text-[8.5px] print-fit-table">
              <colgroup>
                <col className="w-[26px]" />
                <col className="w-[162px]" />
                <col className="w-[92px]" />
                <col className="w-[44px]" />
                <col className="w-[40px]" />
                <col className="w-[34px]" />
                <col className="w-[40px]" />
                <col className="w-[26px]" />
                <col className="w-[30px]" />
                <col className="w-[30px]" />
                <col className="w-[30px]" />
                <col className="w-[50px]" />
                <col className="w-[46px]" />
                <col className="w-[116px]" />
                <col />
                {isAdmin && <col className="no-print w-[46px]" />}
              </colgroup>
              <thead className="bg-slate-100 text-slate-800 font-bold border-b border-gray-300">
                <tr>
                  <th className="py-2 px-1 text-center print:px-0.5 print:py-1">ที่</th>
                  <th className="py-2 px-2 print:px-1 print:py-1">ห้องตรวจ / แผนก</th>
                  <th className="py-2 px-1.5 print:px-1 print:py-1">กะเวลา</th>
                  <th className="py-2 px-1 text-right bg-blue-50 text-blue-950 leading-tight print:px-0.5 print:py-1">ผู้ป่วยรวม</th>
                  <th className="py-2 px-1 text-right print:px-0.5 print:py-1">ผู้ใหญ่</th>
                  <th className="py-2 px-1 text-right print:px-0.5 print:py-1">เด็ก</th>
                  <th className="py-2 px-1 text-right bg-red-50 text-red-950 print:px-0.5 print:py-1">Admit</th>
                  <th className="py-2 px-0.5 text-center print:py-1">HN</th>
                  <th className="py-2 px-0.5 text-center bg-blue-50/70 font-bold text-blue-900 print:py-1">RN</th>
                  <th className="py-2 px-0.5 text-center bg-teal-50/70 text-teal-900 print:py-1">PN</th>
                  <th className="py-2 px-0.5 text-center bg-emerald-50/70 text-emerald-900 print:py-1">NA</th>
                  <th className="py-2 px-1 text-center leading-tight print:px-0.5 print:py-1">ผู้ปฏิบัติงานทั่วไป</th>
                  <th className="py-2 px-1 text-center leading-tight print:px-0.5 print:py-1">พนักงานบริการ</th>
                  <th className="py-2 px-1.5 print:px-1 print:py-1">ผู้บันทึกรายงาน</th>
                  <th className="py-2 px-2 print:px-1 print:py-1">หมายเหตุ</th>
                  {isAdmin && <th className="py-2 px-1 text-center no-print bg-slate-100">จัดการ</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredWorkloads.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 16 : 15} className="py-8 text-center text-gray-400">
                      ไม่มีรายการบันทึกภาระงานในวันที่และกะที่เลือก
                    </td>
                  </tr>
                ) : (
                  <>
                    {regularWorkloads.map((w, index) => {
                      const itemIsOffDuty = isOffDutyWorkload(w);
                      const itemOffReason = getWorkloadOffDutyReason(w);
                      const itemOffStaff = getWorkloadOffDutyStaff(w);
                      const hasRefDetails = !itemIsOffDuty && isReferralWorkload(w) && Boolean(w.referralData);
                      const refData = hasRefDetails ? normalizeReferralData(w.referralData) : null;
                      const refTotal = refData ? getReferralTotalCount(refData) : 0;

                      return (
                        <React.Fragment key={w.id}>
                          <tr
                            className={
                              itemIsOffDuty
                                ? 'bg-violet-50/75 hover:bg-violet-100/50 border-t border-violet-200'
                                : refData
                                ? 'bg-indigo-50/75 hover:bg-indigo-100/60 border-t-2 border-indigo-200'
                                : 'hover:bg-slate-50/80'
                            }
                          >
                            <td
                              className={`py-2 px-1 text-center print:px-0.5 print:py-1 ${
                                itemIsOffDuty
                                  ? 'font-bold text-violet-900'
                                  : refData
                                  ? 'font-bold text-indigo-900'
                                  : 'text-gray-500'
                              }`}
                            >
                              {index + 1}
                            </td>
                            <td
                              className={`py-2 px-2 break-words print:px-1 print:py-1 ${
                                itemIsOffDuty
                                  ? 'font-extrabold text-violet-950'
                                  : refData
                                  ? 'font-extrabold text-indigo-950'
                                  : 'font-bold text-gray-900'
                              }`}
                            >
                              {itemIsOffDuty ? (
                                <div className="inline-flex items-center gap-1 flex-wrap">
                                  <span>{w.clinic}</span>
                                  <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-violet-200/85 text-violet-950 print:text-[7.5px] print:px-1">
                                    Off เวร
                                  </span>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1 flex-wrap">
                                  <span>{w.clinic}</span>
                                  {refData && (
                                    <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded bg-indigo-200/80 text-indigo-900 print:text-[7.5px] print:px-1">
                                      รวม {REFERRAL_ITEM_DEFINITIONS.length} รายการ
                                    </span>
                                  )}
                                  {itemOffStaff.length > 0 && (
                                    <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 border border-violet-300 print:text-[7.5px] print:px-1">
                                      Off เวรรายวัน {itemOffStaff.length} คน
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                            <td
                              className={`py-2 px-1.5 text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-1 ${
                                itemIsOffDuty
                                  ? 'text-violet-900 font-semibold'
                                  : refData
                                  ? 'text-indigo-900 font-semibold'
                                  : 'text-gray-600'
                              }`}
                            >
                              {w.shift}
                            </td>
                            <td className="py-2 px-1 text-right font-bold text-blue-900 bg-blue-50/30 print:px-0.5 print:py-1">
                              {refData ? refTotal : getEffectiveTotalPt(w)}
                            </td>
                            <td className="py-2 px-1 text-right text-gray-600 print:px-0.5 print:py-1">{w.adultPt}</td>
                            <td className="py-2 px-1 text-right text-gray-600 print:px-0.5 print:py-1">{w.childPt}</td>
                            <td className="py-2 px-1 text-right font-bold text-red-600 bg-red-50/30 print:px-0.5 print:py-1">{w.admit}</td>
                            <td className="py-2 px-0.5 text-center text-gray-700 print:py-1">{w.hn}</td>
                            <td className="py-2 px-0.5 text-center font-bold text-blue-800 bg-blue-50/40 print:py-1">{w.rn}</td>
                            <td className="py-2 px-0.5 text-center text-teal-800 bg-teal-50/40 print:py-1">{w.pn}</td>
                            <td className="py-2 px-0.5 text-center text-emerald-800 bg-emerald-50/40 print:py-1">{w.na !== undefined ? w.na : (w.pca || 0)}</td>
                            <td className="py-2 px-1 text-center text-gray-600 print:px-0.5 print:py-1">{w.clerk}</td>
                            <td className="py-2 px-1 text-center text-gray-600 print:px-0.5 print:py-1">{w.serviceWorker}</td>
                            <td className="py-2 px-1.5 text-gray-800 text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-1">{w.reporter}</td>
                            <td
                              className={`py-2 px-2 text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-1 ${
                                itemIsOffDuty
                                  ? 'text-violet-900 font-medium'
                                  : refData
                                  ? 'text-indigo-800 font-medium'
                                  : 'text-gray-500'
                              }`}
                              title={w.note}
                            >
                              {itemIsOffDuty ? (
                                <div className="whitespace-normal break-words">
                                  <span className="font-bold">Off เวร{itemOffReason ? `: ${itemOffReason}` : ''}</span>
                                  {w.note ? ` • ${w.note}` : ''}
                                </div>
                              ) : (
                                <div className="whitespace-normal break-words">
                                  {refData ? (w.note || 'รายละเอียดตามรายการย่อย') : (w.note || '-')}
                                </div>
                              )}
                              {!itemIsOffDuty && itemOffStaff.length > 0 && (
                                <div className="mt-0.5 text-[9.5px] text-violet-800 font-medium break-words">
                                  Off เวรรายวัน: {formatOffDutyStaffSummaryText(itemOffStaff)}
                                </div>
                              )}
                              {(w.lastEditReason || w.lastEditedAt) && (
                                <div className="no-print mt-0.5 text-[9.5px] text-amber-700 break-words" title={`${w.lastEditReason || ''} (${w.lastEditedAt ? formatThaiDateTime(w.lastEditedAt) : ''})`}>
                                  แก้ไข: {w.lastEditReason || '-'}
                                </div>
                              )}
                            </td>
                            {isAdmin && (
                              <td className="py-2 px-1 text-center no-print">
                                <div className="flex items-center justify-center gap-0.5">
                                  {onUpdateWorkload && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingWorkload({
                                          ...w,
                                          totalPt: getEffectiveTotalPt(w),
                                          ...(itemIsOffDuty
                                            ? { isOffDuty: true, offDutyReason: itemOffReason }
                                            : {}),
                                          ...(itemOffStaff.length > 0 ? { offDutyStaff: itemOffStaff } : {}),
                                          ...(isReferralWorkload(w) && !itemIsOffDuty
                                            ? { referralData: normalizeReferralData(w.referralData) }
                                            : {}),
                                        });
                                        setAdminAddOffDutyStaffId('');
                                        setEditWorkloadReason('');
                                        setEditWorkloadReasonError('');
                                        setEditModalError('');
                                      }}
                                      className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 cursor-pointer"
                                      title="แก้ไขข้อมูลภาระงาน"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  {onDeleteWorkload && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDeletingWorkload(w);
                                        setDeleteWorkloadReason('');
                                        setDeleteWorkloadReasonError('');
                                      }}
                                      className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 cursor-pointer"
                                      title="ลบรายการ"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                          {refData &&
                            REFERRAL_ITEM_DEFINITIONS.map((def) => {
                              const item = refData[def.key];
                              const countVal = Number(item?.count) || 0;
                              const isAdmitCategory =
                                def.key === 'admitPrivate' || def.key === 'admitGeneral';
                              return (
                                <tr
                                  key={`${w.id}-${def.key}`}
                                  className="bg-indigo-50/20 hover:bg-indigo-50/50 text-gray-700"
                                >
                                  <td className="py-1.5 px-1 text-center text-indigo-400 print:px-0.5 print:py-0.5">•</td>
                                  <td className="py-1.5 px-2 pl-4 font-semibold text-gray-800 break-words print:pl-2.5 print:px-1 print:py-0.5">
                                    <span className="text-indigo-500 mr-1">↳</span>
                                    {def.label}
                                  </td>
                                  <td className="py-1.5 px-1.5 text-gray-500 text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-0.5">
                                    {w.shift}
                                  </td>
                                  <td className="py-1.5 px-1 text-right font-bold text-blue-900 bg-blue-50/20 print:px-0.5 print:py-0.5">
                                    {countVal > 0 ? countVal.toLocaleString() : 0}
                                  </td>
                                  <td className="py-1.5 px-1 text-right text-gray-400 print:px-0.5 print:py-0.5">-</td>
                                  <td className="py-1.5 px-1 text-right text-gray-400 print:px-0.5 print:py-0.5">-</td>
                                  <td
                                    className={`py-1.5 px-1 text-right bg-red-50/20 print:px-0.5 print:py-0.5 ${
                                      isAdmitCategory
                                        ? 'font-bold text-red-600'
                                        : 'text-gray-400 font-normal'
                                    }`}
                                  >
                                    {isAdmitCategory ? (countVal > 0 ? countVal.toLocaleString() : 0) : '-'}
                                  </td>
                                  <td
                                    colSpan={6}
                                    className="py-1.5 px-1 text-center text-[10px] italic text-indigo-700/80 bg-indigo-50/30 print:text-[7.5px] print:px-0.5 print:py-0.5"
                                  >
                                    ใช้กำลังคนร่วม (Pooled Staffing)
                                  </td>
                                  <td className="py-1.5 px-1.5 text-gray-600 text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-0.5">
                                    {w.reporter}
                                  </td>
                                  <td className="py-1.5 px-2 text-gray-600 text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-0.5">
                                    {item?.reason || '-'}
                                  </td>
                                  {isAdmin && (
                                    <td className="py-1.5 px-1 text-center text-gray-300 text-[10px] no-print">
                                      -
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      );
                    })}

                    {premiumGroups.map((grp, grpIdx) => {
                      const poolRec = grp.primaryPoolRecord;
                      const isGroupOffDuty =
                        grp.subRows.length === 0 &&
                        grp.poolRows.length > 0 &&
                        grp.poolRows.every(isOffDutyWorkload);
                      const groupOffReason = grp.poolRows
                        .map(getWorkloadOffDutyReason)
                        .filter(Boolean)
                        .join(', ');
                      const groupOffStaff = grp.poolRows.flatMap(getWorkloadOffDutyStaff);
                      return (
                        <React.Fragment key={grp.key}>
                          {/* Master Row: ศูนย์ปัญญาภิรมย์ */}
                          <tr
                            className={
                              isGroupOffDuty
                                ? 'bg-violet-50/75 hover:bg-violet-100/50 border-t-2 border-violet-200'
                                : 'bg-orange-50/80 hover:bg-orange-100/70 border-t-2 border-orange-200'
                            }
                          >
                            <td
                              className={`py-2 px-1 text-center font-bold print:px-0.5 print:py-1 ${
                                isGroupOffDuty ? 'text-violet-900' : 'text-orange-900'
                              }`}
                            >
                              {regularWorkloads.length + grpIdx + 1}
                            </td>
                            <td
                              className={`py-2 px-2 font-extrabold break-words print:px-1 print:py-1 ${
                                isGroupOffDuty ? 'text-violet-950' : 'text-orange-950'
                              }`}
                            >
                              <div className="inline-flex items-center gap-1 flex-wrap">
                                <Star className={`w-3.5 h-3.5 shrink-0 no-print ${isGroupOffDuty ? 'text-violet-600' : 'text-orange-600'}`} />
                                <span>{PREMIUM_CLINIC_GROUP}</span>
                                {isGroupOffDuty ? (
                                  <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-violet-200/85 text-violet-950 print:text-[7.5px] print:px-1">
                                    Off เวร
                                  </span>
                                ) : (
                                  <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded bg-orange-200/80 text-orange-900 print:text-[7.5px] print:px-1">
                                    รวม {grp.subRows.length} แผนก
                                  </span>
                                )}
                                {!isGroupOffDuty && groupOffStaff.length > 0 && (
                                  <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 border border-violet-300 print:text-[7.5px] print:px-1">
                                    Off เวรรายวัน {groupOffStaff.length} คน
                                  </span>
                                )}
                              </div>
                            </td>
                            <td
                              className={`py-2 px-1.5 font-semibold text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-1 ${
                                isGroupOffDuty ? 'text-violet-900' : 'text-orange-900'
                              }`}
                            >
                              {grp.shift}
                            </td>
                            <td className="py-2 px-1 text-right font-extrabold text-blue-950 bg-blue-50/50 print:px-0.5 print:py-1">
                              {grp.totalPt}
                            </td>
                            <td className="py-2 px-1 text-right font-semibold text-gray-800 print:px-0.5 print:py-1">
                              {grp.adultPt}
                            </td>
                            <td className="py-2 px-1 text-right font-semibold text-gray-800 print:px-0.5 print:py-1">
                              {grp.childPt}
                            </td>
                            <td className="py-2 px-1 text-right font-extrabold text-red-700 bg-red-50/50 print:px-0.5 print:py-1">
                              {grp.admit}
                            </td>
                            <td className="py-2 px-0.5 text-center font-bold text-orange-950 print:py-1">
                              {grp.hn}
                            </td>
                            <td className="py-2 px-0.5 text-center font-extrabold text-blue-900 bg-blue-50/50 print:py-1">
                              {grp.rn}
                            </td>
                            <td className="py-2 px-0.5 text-center font-bold text-teal-900 bg-teal-50/50 print:py-1">
                              {grp.pn}
                            </td>
                            <td className="py-2 px-0.5 text-center font-bold text-emerald-900 bg-emerald-50/50 print:py-1">
                              {grp.na}
                            </td>
                            <td className="py-2 px-1 text-center font-semibold text-gray-700 print:px-0.5 print:py-1">
                              {grp.clerk}
                            </td>
                            <td className="py-2 px-1 text-center font-semibold text-gray-700 print:px-0.5 print:py-1">
                              {grp.serviceWorker}
                            </td>
                            <td className="py-2 px-1.5 text-gray-900 font-medium text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-1">
                              {grp.reporter}
                            </td>
                            <td
                              className={`py-2 px-2 text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-1 ${
                                isGroupOffDuty ? 'text-violet-900 font-medium' : 'text-orange-800'
                              }`}
                              title={grp.note}
                            >
                              {isGroupOffDuty ? (
                                <div className="whitespace-normal break-words">
                                  <span className="font-bold">Off เวร{groupOffReason ? `: ${groupOffReason}` : ''}</span>
                                  {grp.note ? ` • ${grp.note}` : ''}
                                </div>
                              ) : (
                                <div className="whitespace-normal break-words">
                                  {grp.note || (poolRec ? 'กำลังคนรวมทั้งคลินิก' : '-')}
                                </div>
                              )}
                              {!isGroupOffDuty && groupOffStaff.length > 0 && (
                                <div className="mt-0.5 text-[9.5px] text-violet-800 font-medium break-words">
                                  Off เวรรายวัน: {formatOffDutyStaffSummaryText(groupOffStaff)}
                                </div>
                              )}
                              {poolRec && (poolRec.lastEditReason || poolRec.lastEditedAt) && (
                                <div className="no-print mt-0.5 text-[9.5px] text-amber-700 break-words">
                                  แก้ไขกำลังคน: {poolRec.lastEditReason || '-'}
                                </div>
                              )}
                            </td>
                            {isAdmin && (
                              <td className="py-2 px-1 text-center no-print">
                                {poolRec ? (
                                  <div className="flex items-center justify-center gap-0.5">
                                    {onUpdateWorkload && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const poolOff = isOffDutyWorkload(poolRec);
                                          const poolOffReason = getWorkloadOffDutyReason(poolRec);
                                          const poolOffStaff = getWorkloadOffDutyStaff(poolRec);
                                          setEditingWorkload({
                                            ...poolRec,
                                            totalPt: getEffectiveTotalPt(poolRec),
                                            ...(poolOff ? { isOffDuty: true, offDutyReason: poolOffReason } : {}),
                                            ...(poolOffStaff.length > 0 ? { offDutyStaff: poolOffStaff } : {}),
                                          });
                                          setAdminAddOffDutyStaffId('');
                                          setEditWorkloadReason('');
                                          setEditWorkloadReasonError('');
                                          setEditModalError('');
                                        }}
                                        className="text-orange-700 hover:text-orange-900 p-1 rounded hover:bg-orange-200/70 cursor-pointer"
                                        title="แก้ไขกำลังคนรวมศูนย์ปัญญาภิรมย์"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    {onDeleteWorkload && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setDeletingWorkload(poolRec);
                                          setDeleteWorkloadReason('');
                                          setDeleteWorkloadReasonError('');
                                        }}
                                        className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 cursor-pointer"
                                        title="ลบแถวกำลังคนรวม"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-gray-400">-</span>
                                )}
                              </td>
                            )}
                          </tr>

                          {/* Detail Rows: แผนกย่อยของศูนย์ปัญญาภิรมย์ */}
                          {grp.subRows.map((sub) => (
                            <tr key={sub.id} className="bg-orange-50/20 hover:bg-orange-50/60 text-gray-700">
                              <td className="py-1.5 px-1 text-center text-orange-400 print:px-0.5 print:py-0.5">•</td>
                              <td className="py-1.5 px-2 pl-4 font-semibold text-gray-800 break-words print:pl-2.5 print:px-1 print:py-0.5">
                                <span className="text-orange-500 mr-1">↳</span>
                                {sub.clinic}
                              </td>
                              <td className="py-1.5 px-1.5 text-gray-500 text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-0.5">
                                {sub.shift}
                              </td>
                              <td className="py-1.5 px-1 text-right font-bold text-blue-900 bg-blue-50/20 print:px-0.5 print:py-0.5">
                                {getEffectiveTotalPt(sub)}
                              </td>
                              <td className="py-1.5 px-1 text-right text-gray-600 print:px-0.5 print:py-0.5">
                                {sub.adultPt}
                              </td>
                              <td className="py-1.5 px-1 text-right text-gray-600 print:px-0.5 print:py-0.5">
                                {sub.childPt}
                              </td>
                              <td className="py-1.5 px-1 text-right font-bold text-red-600 bg-red-50/20 print:px-0.5 print:py-0.5">
                                {sub.admit}
                              </td>
                              <td
                                colSpan={6}
                                className="py-1.5 px-1 text-center text-[10px] italic text-orange-700/80 bg-orange-50/30 print:text-[7.5px] print:px-0.5 print:py-0.5"
                              >
                                ใช้กำลังคนร่วม (Pooled Staffing)
                              </td>
                              <td className="py-1.5 px-1.5 text-gray-600 text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-0.5">
                                {sub.reporter}
                              </td>
                              <td className="py-1.5 px-2 text-gray-500 text-[10px] leading-tight break-words print:text-[8px] print:px-1 print:py-0.5" title={sub.note}>
                                <div className="whitespace-normal break-words">{sub.note || '-'}</div>
                                {(sub.lastEditReason || sub.lastEditedAt) && (
                                  <div className="no-print mt-0.5 text-[9.5px] text-amber-700 break-words">
                                    แก้ไข: {sub.lastEditReason || '-'}
                                  </div>
                                )}
                              </td>
                              {isAdmin && (
                                <td className="py-1.5 px-1 text-center no-print">
                                  <div className="flex items-center justify-center gap-0.5">
                                    {onUpdateWorkload && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingWorkload({ ...sub, totalPt: getEffectiveTotalPt(sub) });
                                          setEditWorkloadReason('');
                                          setEditWorkloadReasonError('');
                                          setEditModalError('');
                                        }}
                                        className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 cursor-pointer"
                                        title="แก้ไขข้อมูลผู้ป่วยแผนกย่อย"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    {onDeleteWorkload && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setDeletingWorkload(sub);
                                          setDeleteWorkloadReason('');
                                          setDeleteWorkloadReasonError('');
                                        }}
                                        className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 cursor-pointer"
                                        title="ลบรายการแผนกย่อย"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </>
                )}
              </tbody>
              {/* Total Row */}
              <tfoot className="bg-slate-200 text-slate-900 font-extrabold border-t-2 border-gray-400">
                <tr>
                  <td colSpan={3} className="py-2 px-2 text-center print:px-1">
                    ยอดรวมทั้งสิ้น ({clinicCount} คลินิก)
                  </td>
                  <td className="py-2 px-1 text-right text-blue-950 font-black text-xs bg-blue-100 print:text-[9px] print:px-0.5">
                    {totals.totalPt.toLocaleString()}
                  </td>
                  <td className="py-2 px-1 text-right print:px-0.5">{totals.adultPt.toLocaleString()}</td>
                  <td className="py-2 px-1 text-right print:px-0.5">{totals.childPt.toLocaleString()}</td>
                  <td className="py-2 px-1 text-right text-red-950 font-black text-xs bg-red-100 print:text-[9px] print:px-0.5">
                    {totals.admit.toLocaleString()}
                  </td>
                  <td className="py-2 px-0.5 text-center">{totals.hn.toFixed(1)}</td>
                  <td className="py-2 px-0.5 text-center text-blue-950 bg-blue-100 font-black">
                    {totals.rn.toFixed(1)}
                  </td>
                  <td className="py-2 px-0.5 text-center text-teal-950 bg-teal-100">
                    {totals.pn.toFixed(1)}
                  </td>
                  <td className="py-2 px-0.5 text-center text-emerald-950 bg-emerald-100">
                    {totals.na.toFixed(1)}
                  </td>
                  <td className="py-2 px-0.5 text-center">{totals.clerk.toFixed(1)}</td>
                  <td className="py-2 px-0.5 text-center">{totals.serviceWorker.toFixed(1)}</td>
                  <td colSpan={2} className="py-2 px-2 text-right text-[11px] print:text-[8.5px] print:px-1 whitespace-normal">
                    กำลังคนพยาบาลรวม: <span className="text-emerald-900 font-black">{totalNursingOnDuty.toFixed(1)}</span> แรง
                  </td>
                  {isAdmin && <td className="no-print"></td>}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Printable Official Signatures */}
          <div className="pt-6 pb-3 print:pt-10 grid grid-cols-2 gap-8 text-center text-xs text-gray-700">
            <div>
              <div className="h-10 border-b border-gray-400 w-48 mx-auto"></div>
              <div className="mt-2 font-semibold">ลงชื่อ .....................................................</div>
              <div className="text-[11px] text-gray-500 mt-0.5">(ผู้รวบรวมรายงาน / พยาบาลเวรตรวจการ)</div>
            </div>
            <div>
              <div className="h-10 border-b border-gray-400 w-48 mx-auto"></div>
              <div className="mt-2 font-semibold">ลงชื่อ .....................................................</div>
              <div className="text-[11px] text-gray-500 mt-0.5">(หัวหน้าหน่วยการพยาบาลผู้ป่วยนอก)</div>
            </div>
          </div>
        </div>
      </div>

      {/* Admin Edit Workload Modal in Daily Census */}
      {editingWorkload && onUpdateWorkload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs no-print">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-gray-900">
                  แก้ไขข้อมูลภาระงานห้องตรวจ {editingWorkload.clinic} (Admin)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingWorkload(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {editingWorkload.recordType === 'PREMIUM_POOL' && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 text-[11px] text-orange-900">
                  <strong>แถวกำลังคนรวม (PREMIUM_POOL):</strong> ใช้สำหรับเก็บกำลังคนปฏิบัติงานรวมทั้งศูนย์ปัญญาภิรมย์ในกะนี้ (ยอดผู้ป่วยควรเป็น 0 เพื่อไม่ให้นับซ้ำกับแผนกย่อย)
                </div>
              )}
              {editingWorkload.recordType === 'PREMIUM_SUB' && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 text-[11px] text-orange-900">
                  <strong>แถวแผนกย่อย (PREMIUM_SUB):</strong> ใช้สำหรับเก็บยอดผู้ป่วยรายแผนกของศูนย์ปัญญาภิรมย์ (กำลังคนควรเป็น 0 เพราะใช้กำลังคนร่วมจากแถวหลัก)
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">วันที่ (พ.ศ.)</label>
                  <ThaiDateInput
                    value={editingWorkload.date}
                    onChange={(iso) => setEditingWorkload({ ...editingWorkload, date: iso })}
                    selectClassName="w-full px-2.5 py-1.5 pr-9 border border-gray-300 rounded-lg text-xs bg-white font-medium text-gray-900 outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ห้องตรวจ / แผนก</label>
                  <input
                    type="text"
                    value={editingWorkload.clinic}
                    onChange={(e) => setEditingWorkload({ ...editingWorkload, clinic: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-semibold bg-gray-50"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">กะเวลา</label>
                  <select
                    value={editingWorkload.shift}
                    onChange={(e) => setEditingWorkload({ ...editingWorkload, shift: e.target.value as WorkShift })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    <option value="ในเวลา 08:00-16:00">ในเวลา 08:00-16:00</option>
                    <option value="นอกเวลาเย็น 16:00-20:00">นอกเวลาเย็น 16:00-20:00</option>
                    <option value="นอกเวลาวันหยุด 08:00-12:00">นอกเวลาวันหยุด 08:00-12:00</option>
                  </select>
                </div>
              </div>

              {/* Admin Edit Modal: Daily Wage Off เวร Editor (+ legacy Off-Duty clear if present) */}
              {editingWorkload.isOffDuty && (
                <div className="rounded-xl border border-violet-300 bg-violet-50 p-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-violet-950">
                    <strong>พบสถานะปิดบริการเดิม (Off เวรทั้งกะ):</strong>{' '}
                    {editingWorkload.offDutyReason || 'งดออกตรวจ'}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingWorkload({
                        ...editingWorkload,
                        isOffDuty: false,
                        offDutyReason: '',
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-white border border-violet-300 text-violet-900 hover:bg-violet-100 font-semibold text-[11px] cursor-pointer"
                  >
                    ล้างสถานะปิดบริการเดิม
                  </button>
                </div>
              )}

              {editingWorkload.recordType !== 'PREMIUM_SUB' && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-bold text-violet-950 flex items-center gap-1.5">
                      <PauseCircle className="w-4 h-4 text-violet-700" />
                      <span>เจ้าหน้าที่ตำแหน่ง &quot;รายวัน&quot; ที่ Off เวร (ยอดผู้ป่วยน้อยลง)</span>
                    </div>
                    <span className="text-[11px] font-semibold text-violet-800">
                      {(editingWorkload.offDutyStaff || []).length} คน
                    </span>
                  </div>

                  {(editingWorkload.offDutyStaff || []).length > 0 && (
                    <div className="space-y-1.5">
                      {(editingWorkload.offDutyStaff || []).map((entry, idx) => {
                        const isOut = editingWorkload.shift !== 'ในเวลา 08:00-16:00';
                        const pVal =
                          entry.amount === 1
                            ? 'FULL'
                            : isOut
                              ? 'HALF_SHIFT'
                              : entry.periodLabel === 'ครึ่งวันบ่าย'
                                ? 'HALF_PM'
                                : 'HALF_AM';
                        return (
                          <div
                            key={`${entry.staffName}-${idx}`}
                            className="bg-white border border-violet-200 rounded-lg p-2 space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-bold text-violet-950">
                                {entry.staffName}{' '}
                                <span className="text-[10px] font-semibold text-violet-700">
                                  ([รายวัน] {formatPositionLabel(entry.position)})
                                </span>
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingWorkload({
                                    ...editingWorkload,
                                    offDutyStaff: (editingWorkload.offDutyStaff || []).filter(
                                      (_, i) => i !== idx
                                    ),
                                  })
                                }
                                className="text-gray-400 hover:text-red-600 p-0.5 cursor-pointer"
                                title="นำออก"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <select
                                value={pVal}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const nextList = (editingWorkload.offDutyStaff || []).map((it, i) => {
                                    if (i !== idx) return it;
                                    if (v === 'HALF_SHIFT')
                                      return { ...it, amount: 0.5 as const, periodLabel: 'ครึ่งเวร' as const };
                                    if (v === 'HALF_AM')
                                      return { ...it, amount: 0.5 as const, periodLabel: 'ครึ่งวันเช้า' as const };
                                    if (v === 'HALF_PM')
                                      return { ...it, amount: 0.5 as const, periodLabel: 'ครึ่งวันบ่าย' as const };
                                    const copy = { ...it, amount: 1 as const };
                                    delete copy.periodLabel;
                                    return copy;
                                  });
                                  setEditingWorkload({ ...editingWorkload, offDutyStaff: nextList });
                                }}
                                className="px-2 py-1 border border-violet-200 rounded-lg text-xs bg-white"
                              >
                                {isOut ? (
                                  <>
                                    <option value="FULL">เต็มเวรนอกเวลา (1.0)</option>
                                    <option value="HALF_SHIFT">ครึ่งเวร (0.5)</option>
                                  </>
                                ) : (
                                  <>
                                    <option value="FULL">เต็มวัน (1.0)</option>
                                    <option value="HALF_AM">ครึ่งวันเช้า (0.5)</option>
                                    <option value="HALF_PM">ครึ่งวันบ่าย (0.5)</option>
                                  </>
                                )}
                              </select>
                              <input
                                type="text"
                                value={entry.reason || ''}
                                onChange={(e) => {
                                  const nextList = (editingWorkload.offDutyStaff || []).map((it, i) =>
                                    i === idx ? { ...it, reason: e.target.value } : it
                                  );
                                  setEditingWorkload({ ...editingWorkload, offDutyStaff: nextList });
                                }}
                                placeholder="เหตุผล Off เวร..."
                                className="px-2 py-1 border border-violet-200 rounded-lg text-xs bg-white"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {allDailyWageStaff.length > 0 ? (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select
                        value={adminAddOffDutyStaffId}
                        onChange={(e) => setAdminAddOffDutyStaffId(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 border border-violet-200 rounded-lg text-xs bg-white"
                      >
                        <option value="">-- เลือกเจ้าหน้าที่ตำแหน่งรายวันเพื่อเพิ่ม Off เวร --</option>
                        {allDailyWageStaff.map((s) => (
                          <option key={s.staffId} value={s.staffId}>
                            {s.name} ([รายวัน] {formatPositionLabel(s.position)} • {s.homeClinic})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!adminAddOffDutyStaffId}
                        onClick={() => {
                          const st = allDailyWageStaff.find((s) => s.staffId === adminAddOffDutyStaffId);
                          if (!st) return;
                          const curr = editingWorkload.offDutyStaff || [];
                          if (curr.some((x) => x.staffName === st.name && x.amount === 1)) return;
                          setEditingWorkload({
                            ...editingWorkload,
                            offDutyStaff: [
                              ...curr,
                              {
                                staffName: st.name,
                                position: st.position,
                                amount: 1,
                                reason: OFF_DUTY_STAFF_REASON_PRESETS[0],
                              },
                            ],
                          });
                          setAdminAddOffDutyStaffId('');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:bg-gray-300 text-white font-semibold text-xs flex items-center justify-center gap-1 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>เพิ่ม Off เวรรายวัน</span>
                      </button>
                    </div>
                  ) : (
                    <div className="text-[11px] text-gray-500">
                      ยังไม่มีบุคลากรตำแหน่ง &quot;รายวัน&quot; ในทะเบียนบุคลากรเมนู 5
                    </div>
                  )}
                </div>
              )}

              {isReferralWorkload(editingWorkload) ? (
                <div className="bg-indigo-50/60 border border-indigo-200 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-indigo-950">
                      ข้อมูลห้องรับ - ส่งต่อผู้ป่วย (คำนวณยอดรวมและ Admit อัตโนมัติ)
                    </span>
                    <span className="text-[11px] font-bold text-indigo-800">
                      รวม {getReferralTotalCount(normalizeReferralData(editingWorkload.referralData))} | Admit{' '}
                      {getReferralAdmitCount(normalizeReferralData(editingWorkload.referralData))}
                    </span>
                  </div>
                  <div className="bg-white border border-indigo-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-indigo-100/70 text-indigo-950 font-bold border-b border-indigo-200">
                        <tr>
                          <th className="py-1.5 px-2.5 text-left w-36">รายการ</th>
                          <th className="py-1.5 px-2 text-center w-24">จำนวน</th>
                          <th className="py-1.5 px-2.5 text-left">เหตุผล</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-indigo-100">
                        {REFERRAL_ITEM_DEFINITIONS.map(({ key, label }) => {
                          const currentRef = normalizeReferralData(editingWorkload.referralData);
                          const entry = currentRef[key];
                          return (
                            <tr key={key}>
                              <td className="py-1 px-2.5 font-semibold text-gray-800">{label}</td>
                              <td className="py-1 px-2">
                                <input
                                  type="number"
                                  min="0"
                                  disabled={Boolean(editingWorkload.isOffDuty)}
                                  value={entry.count || ''}
                                  onChange={(e) => {
                                    const nextRef: ReferralCenterData = {
                                      ...currentRef,
                                      [key]: {
                                        ...entry,
                                        count: Math.max(0, Number(e.target.value) || 0),
                                      },
                                    };
                                    setEditingWorkload({
                                      ...editingWorkload,
                                      referralData: nextRef,
                                      totalPt: getReferralTotalCount(nextRef),
                                      adultPt: 0,
                                      childPt: 0,
                                      admit: getReferralAdmitCount(nextRef),
                                    });
                                  }}
                                  className="w-full text-center font-bold border border-indigo-200 rounded py-1 px-1.5 text-xs disabled:bg-gray-100 disabled:text-gray-400"
                                />
                              </td>
                              <td className="py-1 px-2">
                                <input
                                  type="text"
                                  disabled={Boolean(editingWorkload.isOffDuty)}
                                  value={entry.reason}
                                  onChange={(e) => {
                                    const nextRef: ReferralCenterData = {
                                      ...currentRef,
                                      [key]: {
                                        ...entry,
                                        reason: e.target.value,
                                      },
                                    };
                                    setEditingWorkload({
                                      ...editingWorkload,
                                      referralData: nextRef,
                                    });
                                  }}
                                  placeholder="ระบุเหตุผล..."
                                  className="w-full border border-gray-200 rounded py-1 px-2 text-xs disabled:bg-gray-100 disabled:text-gray-400"
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-xl border border-gray-200">
                <div>
                  <label className="block font-semibold text-blue-900 mb-1">ผู้ป่วยทั้งหมด</label>
                  <input
                    type="number"
                    min="0"
                    disabled={Boolean(editingWorkload.isOffDuty)}
                    value={editingWorkload.totalPt}
                    onChange={(e) => {
                      const nextTotal = Math.max(0, Number(e.target.value) || 0);
                      setEditingWorkload({
                        ...editingWorkload,
                        totalPt: nextTotal,
                        adultPt: Math.max(0, nextTotal - (editingWorkload.childPt || 0)),
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg text-xs font-bold text-blue-900 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ผู้ใหญ่</label>
                  <input
                    type="number"
                    min="0"
                    disabled={Boolean(editingWorkload.isOffDuty)}
                    value={editingWorkload.adultPt}
                    onChange={(e) => {
                      const nextAdult = Math.max(0, Number(e.target.value) || 0);
                      setEditingWorkload({
                        ...editingWorkload,
                        adultPt: nextAdult,
                        totalPt: nextAdult + (editingWorkload.childPt || 0),
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">เด็ก</label>
                  <input
                    type="number"
                    min="0"
                    disabled={Boolean(editingWorkload.isOffDuty)}
                    value={editingWorkload.childPt}
                    onChange={(e) => {
                      const nextChild = Math.max(0, Number(e.target.value) || 0);
                      setEditingWorkload({
                        ...editingWorkload,
                        childPt: nextChild,
                        totalPt: (editingWorkload.adultPt || 0) + nextChild,
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-red-600 mb-1">Admit (คน)</label>
                  <input
                    type="number"
                    min="0"
                    disabled={Boolean(editingWorkload.isOffDuty)}
                    value={editingWorkload.admit}
                    onChange={(e) => setEditingWorkload({ ...editingWorkload, admit: Number(e.target.value) || 0 })}
                    className="w-full px-2.5 py-1.5 border border-red-300 rounded-lg text-xs font-bold text-red-600 disabled:bg-gray-100 disabled:text-gray-400"
                  />
                </div>
              </div>
              )}

              <div>
                <label className="block font-semibold text-gray-800 mb-1.5">
                  กำลังคนปฏิบัติงาน (รองรับ 0.5 แรง)
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  <div>
                    <span className="block text-[11px] text-gray-500 mb-1">HN</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={Boolean(editingWorkload.isOffDuty)}
                      value={editingWorkload.hn}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, hn: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-blue-800 mb-1">RN *</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={Boolean(editingWorkload.isOffDuty)}
                      value={editingWorkload.rn}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, rn: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-blue-300 rounded text-center text-xs font-bold text-blue-900 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-teal-800 mb-1">PN *</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={Boolean(editingWorkload.isOffDuty)}
                      value={editingWorkload.pn}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, pn: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-teal-300 rounded text-center text-xs font-bold text-teal-900 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-emerald-800 mb-1">NA *</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={Boolean(editingWorkload.isOffDuty)}
                      value={editingWorkload.na ?? editingWorkload.pca ?? 0}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, na: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-emerald-300 rounded text-center text-xs font-bold text-emerald-900 disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] text-gray-500 mb-1">ผู้ปฏิบัติงานทั่วไป</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={Boolean(editingWorkload.isOffDuty)}
                      value={editingWorkload.clerk}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, clerk: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] text-gray-500 mb-1">พนักงานบริการ</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      disabled={Boolean(editingWorkload.isOffDuty)}
                      value={editingWorkload.serviceWorker}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, serviceWorker: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs disabled:bg-gray-100 disabled:text-gray-400"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    ผู้บันทึกรายงาน <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editingWorkload.reporter}
                    onChange={(e) => {
                      setEditingWorkload({ ...editingWorkload, reporter: e.target.value });
                      if (editModalError) setEditModalError('');
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                    placeholder="เช่น พว.สุดารัตน์ ศิริพรหม"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">หมายเหตุ</label>
                  <input
                    type="text"
                    value={editingWorkload.note || ''}
                    onChange={(e) => setEditingWorkload({ ...editingWorkload, note: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                    placeholder="หมายเหตุเพิ่มเติม"
                  />
                </div>
              </div>

              {editModalError && (
                <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{editModalError}</span>
                </div>
              )}

              {/* Mandatory Edit Reason + Timestamp Preview */}
              <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="block font-bold text-amber-900">
                    เหตุผลการแก้ไขรายการ <span className="text-red-600">*</span>
                  </label>
                  <span className="text-[11px] text-amber-700 font-medium">
                    เวลาที่บันทึก: {formatThaiDateTime(new Date().toISOString())}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {['แก้ไขจำนวนผู้ป่วย', 'แก้ไขจำนวนเจ้าหน้าที่ขึ้นเวร', 'แก้ไขห้องตรวจ/กะเวลา', 'แก้ไขชื่อผู้รายงาน'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setEditWorkloadReason(preset);
                        setEditWorkloadReasonError('');
                      }}
                      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                        editWorkloadReason === preset
                          ? 'bg-amber-600 text-white border-amber-600 font-semibold'
                          : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-100'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={editWorkloadReason}
                  onChange={(e) => {
                    setEditWorkloadReason(e.target.value);
                    if (editWorkloadReasonError) setEditWorkloadReasonError('');
                  }}
                  placeholder="ระบุเหตุผลการแก้ไข เช่น แก้ไขยอดผู้ป่วยนอกช่วงบ่าย..."
                  className={`w-full px-3 py-1.5 border rounded-lg text-xs bg-white ${
                    editWorkloadReasonError ? 'border-red-400' : 'border-amber-300'
                  }`}
                />
                {editWorkloadReasonError && (
                  <p className="text-[11px] text-red-600 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{editWorkloadReasonError}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setEditingWorkload(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (editingWorkload.isOffDuty && !(editingWorkload.offDutyReason || '').trim()) {
                    setEditModalError('กรุณาระบุเหตุผลการ Off เวร');
                    return;
                  }
                  if (!editingWorkload.reporter.trim()) {
                    setEditModalError('กรุณาระบุชื่อผู้บันทึกรายงาน');
                    return;
                  }
                  const dupWorkload = workloads.find(
                    (w) =>
                      w.id !== editingWorkload.id &&
                      w.date === editingWorkload.date &&
                      w.shift === editingWorkload.shift &&
                      (w.clinic || '').trim() === (editingWorkload.clinic || '').trim() &&
                      (w.recordType || 'STANDARD') === (editingWorkload.recordType || 'STANDARD')
                  );
                  if (dupWorkload) {
                    setEditModalError(
                      `ไม่สามารถบันทึกซ้ำได้: แผนก ${editingWorkload.clinic} วันที่ ${formatThaiShortDate(editingWorkload.date)} กะเวลา "${editingWorkload.shift}" มีรายการอื่นบันทึกไว้แล้ว`
                    );
                    return;
                  }
                  if (!editWorkloadReason.trim()) {
                    setEditWorkloadReasonError('กรุณาระบุเหตุผลการแก้ไขรายการก่อนบันทึก');
                    return;
                  }
                  setEditModalError('');
                  onUpdateWorkload(editingWorkload, editWorkloadReason.trim());
                  setEditingWorkload(null);
                  setEditWorkloadReason('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>บันทึกการแก้ไข</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Delete Workload Confirmation Modal (Mandatory Reason) */}
      {deletingWorkload && onDeleteWorkload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs no-print">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-red-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-red-100 pb-3">
              <div className="flex items-center gap-2 text-red-700">
                <Trash2 className="w-5 h-5" />
                <h3 className="text-base font-bold">ยืนยันการลบรายการภาระงาน</h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingWorkload(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1 text-gray-700">
              <div className="font-bold text-gray-900">{deletingWorkload.clinic} ({deletingWorkload.shift})</div>
              <div>วันที่: <span className="font-semibold">{formatThaiShortDate(deletingWorkload.date)}</span></div>
              <div>ผู้ป่วยทั้งหมด: <span className="font-semibold">{getEffectiveTotalPt(deletingWorkload)} คน</span> • ผู้รายงาน: {deletingWorkload.reporter}</div>
            </div>

            <div className="bg-red-50/70 border border-red-200 rounded-xl p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="font-bold text-red-900">
                  เหตุผลการลบรายการ <span className="text-red-600">*</span>
                </label>
                <span className="text-[11px] text-red-700 font-medium">
                  เวลาที่ลบ: {formatThaiDateTime(new Date().toISOString())}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['บันทึกซ้ำซ้อน', 'บันทึกผิดห้องตรวจ/ผิดวัน', 'ยกเลิกรายการ'].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setDeleteWorkloadReason(preset);
                      setDeleteWorkloadReasonError('');
                    }}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors cursor-pointer ${
                      deleteWorkloadReason === preset
                        ? 'bg-red-600 text-white border-red-600 font-semibold'
                        : 'bg-white text-red-800 border-red-300 hover:bg-red-100'
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={deleteWorkloadReason}
                onChange={(e) => {
                  setDeleteWorkloadReason(e.target.value);
                  if (deleteWorkloadReasonError) setDeleteWorkloadReasonError('');
                }}
                placeholder="ระบุเหตุผลการลบ เช่น บันทึกข้อมูลซ้ำซ้อน..."
                className={`w-full px-3 py-1.5 border rounded-lg text-xs bg-white ${
                  deleteWorkloadReasonError ? 'border-red-500' : 'border-red-300'
                }`}
              />
              {deleteWorkloadReasonError && (
                <p className="text-[11px] text-red-700 font-medium flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{deleteWorkloadReasonError}</span>
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setDeletingWorkload(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!deleteWorkloadReason.trim()) {
                    setDeleteWorkloadReasonError('กรุณาระบุเหตุผลการลบรายการก่อนยืนยัน');
                    return;
                  }
                  onDeleteWorkload(deletingWorkload.id, deleteWorkloadReason.trim());
                  setDeletingWorkload(null);
                  setDeleteWorkloadReason('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>ยืนยันการลบ</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
