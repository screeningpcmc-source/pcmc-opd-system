import React, { useState, useMemo, useRef } from 'react';
import { DailyWorkload, WorkShift, SHIFTS, getEffectiveTotalPt } from '../types';
import { formatThaiFullDate } from '../utils/thaiDate';
import { exportElementAsJpeg } from '../utils/exportImage';
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
  ImageDown
} from 'lucide-react';

interface DailyCensusTabProps {
  workloads: DailyWorkload[];
  isAdmin?: boolean;
  onUpdateWorkload?: (updated: DailyWorkload) => void;
  onDeleteWorkload?: (id: string) => void;
}

export const DailyCensusTab: React.FC<DailyCensusTabProps> = ({ 
  workloads,
  isAdmin = false,
  onUpdateWorkload,
  onDeleteWorkload
}) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const [date, setDate] = useState<string>(todayStr);
  const [shiftFilter, setShiftFilter] = useState<string>('ALL');
  const [copied, setCopied] = useState<boolean>(false);
  const [isExportingJpeg, setIsExportingJpeg] = useState<boolean>(false);
  const [editingWorkload, setEditingWorkload] = useState<DailyWorkload | null>(null);
  const reportSheetRef = useRef<HTMLDivElement | null>(null);
  const formattedThaiDate = useMemo(() => formatThaiFullDate(date), [date]);

  // Filter workloads for this date and shift
  const filteredWorkloads = useMemo(() => {
    return workloads.filter(w => {
      const matchDate = w.date === date;
      const matchShift = shiftFilter === 'ALL' || w.shift === shiftFilter;
      return matchDate && matchShift;
    });
  }, [workloads, date, shiftFilter]);

  // Aggregate Totals
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

    const rows = filteredWorkloads.map((w, i) => [
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
      `"${w.note || ''}"`
    ]);

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

  // Copy Summary text for LINE message
  const handleCopySummary = () => {
    const shiftLabel = shiftFilter === 'ALL' ? 'สรุปภาพรวมทุกกะ' : shiftFilter;
    const text = `📊 รายงานภาระงานผู้ป่วยนอก OPD PCMC
🏥 รพ.ศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน
📅 ประจำวันที่: ${formattedThaiDate} (${shiftLabel})
──────────────────
👥 ผู้ป่วยนอกรวม: ${totals.totalPt.toLocaleString()} ราย
🛌 รับไว้รักษา (Admit): ${totals.admit.toLocaleString()} ราย
👩‍⚕️ กำลังคนพยาบาลปฏิบัติงาน (RN+PN+NA): ${totalNursingOnDuty.toFixed(1)} แรง
(RN: ${totals.rn.toFixed(1)} | PN: ${totals.pn.toFixed(1)} | NA: ${totals.na.toFixed(1)})
──────────────────
บันทึกทั้งหมด ${filteredWorkloads.length} คลินิก/แผนก`;

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
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
            <Calendar className="w-4 h-4 text-gray-500" />
            <label className="text-xs font-bold text-gray-700">วันที่:</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border"
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
          แสดงข้อมูล <span className="font-bold text-blue-900">{filteredWorkloads.length}</span> ห้องตรวจที่บันทึกแล้ว
        </div>
      </div>

      {/* Summary KPI Cards (Visible on screen and print) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
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

      {/* Main Census Report Sheet (Print & JPEG Optimized) */}
      <div
        ref={reportSheetRef}
        className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-6 space-y-4 print:p-0 print:border-none print:shadow-none"
      >
        {/* Printable Hospital Header */}
        <div className="border-b border-gray-300 pb-3 text-center">
          <h3 className="text-base sm:text-lg font-bold text-gray-950">
            โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน มหาวิทยาลัยศรีนครินทรวิโรฒ
          </h3>
          <p className="text-xs font-semibold text-gray-700 mt-0.5">
            รายงานสถิติผู้ป่วยนอกและอัตรากำลังประจำวัน (Daily OPD Census Report)
          </p>
          <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-1 text-xs text-gray-600 mt-1">
            <span><strong>วันที่:</strong> {formattedThaiDate}</span>
            <span>•</span>
            <span><strong>กะเวลา:</strong> {shiftFilter === 'ALL' ? 'ทุกกะเวลา' : shiftFilter}</span>
            <span>•</span>
            <span><strong>พิมพ์เมื่อ:</strong> {new Date().toLocaleString('th-TH')}</span>
          </div>
        </div>

        {/* Detailed Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border border-gray-300 print:text-[10px]">
            <thead className="bg-slate-100 text-slate-800 font-bold border-b border-gray-300">
              <tr>
                <th className="py-2.5 px-2 text-center w-8">ที่</th>
                <th className="py-2.5 px-3">ห้องตรวจ / แผนก</th>
                <th className="py-2.5 px-2">กะเวลา</th>
                <th className="py-2.5 px-2 text-right bg-blue-50 text-blue-950">ผู้ป่วยรวม</th>
                <th className="py-2.5 px-2 text-right">ผู้ใหญ่</th>
                <th className="py-2.5 px-2 text-right">เด็ก</th>
                <th className="py-2.5 px-2 text-right bg-red-50 text-red-950">Admit</th>
                <th className="py-2.5 px-1.5 text-center">HN</th>
                <th className="py-2.5 px-1.5 text-center bg-blue-50/70 font-bold text-blue-900">RN</th>
                <th className="py-2.5 px-1.5 text-center bg-teal-50/70 text-teal-900">PN</th>
                <th className="py-2.5 px-1.5 text-center bg-emerald-50/70 text-emerald-900">NA</th>
                <th className="py-2.5 px-1.5 text-center">ผู้ปฏิบัติงานทั่วไป</th>
                <th className="py-2.5 px-1.5 text-center">พนักงานบริการ</th>
                <th className="py-2.5 px-3">ผู้บันทึกรายงาน</th>
                <th className="py-2.5 px-3">หมายเหตุ</th>
                {isAdmin && <th className="py-2.5 px-2 text-center no-print bg-slate-100">จัดการ</th>}
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
                filteredWorkloads.map((w, index) => (
                  <tr key={w.id} className="hover:bg-slate-50/80">
                    <td className="py-2 px-2 text-center text-gray-500">{index + 1}</td>
                    <td className="py-2 px-3 font-bold text-gray-900 whitespace-nowrap">{w.clinic}</td>
                    <td className="py-2 px-2 text-gray-600 whitespace-nowrap text-[11px]">{w.shift}</td>
                    <td className="py-2 px-2 text-right font-bold text-blue-900 bg-blue-50/30">{getEffectiveTotalPt(w)}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{w.adultPt}</td>
                    <td className="py-2 px-2 text-right text-gray-600">{w.childPt}</td>
                    <td className="py-2 px-2 text-right font-bold text-red-600 bg-red-50/30">{w.admit}</td>
                    <td className="py-2 px-1.5 text-center text-gray-700">{w.hn}</td>
                    <td className="py-2 px-1.5 text-center font-bold text-blue-800 bg-blue-50/40">{w.rn}</td>
                    <td className="py-2 px-1.5 text-center text-teal-800 bg-teal-50/40">{w.pn}</td>
                    <td className="py-2 px-1.5 text-center text-emerald-800 bg-emerald-50/40">{w.na !== undefined ? w.na : (w.pca || 0)}</td>
                    <td className="py-2 px-1.5 text-center text-gray-600">{w.clerk}</td>
                    <td className="py-2 px-1.5 text-center text-gray-600">{w.serviceWorker}</td>
                    <td className="py-2 px-3 text-gray-800 whitespace-nowrap text-[11px]">{w.reporter}</td>
                    <td className="py-2 px-3 text-gray-500 text-[11px] truncate max-w-[150px]" title={w.note}>
                      {w.note || '-'}
                    </td>
                    {isAdmin && (
                      <td className="py-2 px-2 text-center whitespace-nowrap no-print">
                        <div className="flex items-center justify-center gap-1">
                          {onUpdateWorkload && (
                            <button
                              type="button"
                              onClick={() => setEditingWorkload({ ...w, totalPt: getEffectiveTotalPt(w) })}
                              className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 cursor-pointer"
                              title="แก้ไขข้อมูลภาระงาน"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {onDeleteWorkload && (
                            <button
                              type="button"
                              onClick={() => onDeleteWorkload(w.id)}
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
                ))
              )}
            </tbody>
            {/* Total Row */}
            <tfoot className="bg-slate-200 text-slate-900 font-extrabold border-t-2 border-gray-400">
              <tr>
                <td colSpan={3} className="py-2.5 px-3 text-center">
                  ยอดรวมทั้งสิ้น ({filteredWorkloads.length} แผนก)
                </td>
                <td className="py-2.5 px-2 text-right text-blue-950 font-black text-sm bg-blue-100">
                  {totals.totalPt.toLocaleString()}
                </td>
                <td className="py-2.5 px-2 text-right">{totals.adultPt.toLocaleString()}</td>
                <td className="py-2.5 px-2 text-right">{totals.childPt.toLocaleString()}</td>
                <td className="py-2.5 px-2 text-right text-red-950 font-black text-sm bg-red-100">
                  {totals.admit.toLocaleString()}
                </td>
                <td className="py-2.5 px-1.5 text-center">{totals.hn.toFixed(1)}</td>
                <td className="py-2.5 px-1.5 text-center text-blue-950 bg-blue-100 font-black">
                  {totals.rn.toFixed(1)}
                </td>
                <td className="py-2.5 px-1.5 text-center text-teal-950 bg-teal-100">
                  {totals.pn.toFixed(1)}
                </td>
                <td className="py-2.5 px-1.5 text-center text-emerald-950 bg-emerald-100">
                  {totals.na.toFixed(1)}
                </td>
                <td className="py-2.5 px-1.5 text-center">{totals.clerk.toFixed(1)}</td>
                <td className="py-2.5 px-1.5 text-center">{totals.serviceWorker.toFixed(1)}</td>
                <td colSpan={2} className="py-2.5 px-3 text-right text-xs">
                  กำลังคนพยาบาลรวม: <span className="text-emerald-900 font-black">{totalNursingOnDuty.toFixed(1)}</span> แรง
                </td>
                {isAdmin && <td className="no-print"></td>}
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Printable Official Signatures */}
        <div className="pt-8 pb-4 print:pt-12 grid grid-cols-2 gap-8 text-center text-xs text-gray-700">
          <div>
            <div className="h-12 border-b border-gray-400 w-48 mx-auto"></div>
            <div className="mt-2 font-semibold">ลงชื่อ .....................................................</div>
            <div className="text-[11px] text-gray-500 mt-0.5">(ผู้รวบรวมรายงาน / พยาบาลเวรตรวจการ)</div>
          </div>
          <div>
            <div className="h-12 border-b border-gray-400 w-48 mx-auto"></div>
            <div className="mt-2 font-semibold">ลงชื่อ .....................................................</div>
            <div className="text-[11px] text-gray-500 mt-0.5">(หัวหน้าหน่วยการพยาบาลผู้ป่วยนอก)</div>
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">วันที่</label>
                  <input
                    type="date"
                    value={editingWorkload.date}
                    onChange={(e) => setEditingWorkload({ ...editingWorkload, date: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
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
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                  >
                    <option value="ในเวลา 08:00-16:00">ในเวลา 08:00-16:00</option>
                    <option value="นอกเวลาเย็น 16:00-20:00">นอกเวลาเย็น 16:00-20:00</option>
                    <option value="นอกเวลาวันหยุด 08:00-12:00">นอกเวลาวันหยุด 08:00-12:00</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-slate-50 rounded-xl border border-gray-200">
                <div>
                  <label className="block font-semibold text-blue-900 mb-1">ผู้ป่วยทั้งหมด</label>
                  <input
                    type="number"
                    min="0"
                    value={editingWorkload.totalPt}
                    onChange={(e) => {
                      const nextTotal = Math.max(0, Number(e.target.value) || 0);
                      setEditingWorkload({
                        ...editingWorkload,
                        totalPt: nextTotal,
                        adultPt: Math.max(0, nextTotal - (editingWorkload.childPt || 0)),
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-blue-300 rounded-lg text-xs font-bold text-blue-900"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ผู้ใหญ่</label>
                  <input
                    type="number"
                    min="0"
                    value={editingWorkload.adultPt}
                    onChange={(e) => {
                      const nextAdult = Math.max(0, Number(e.target.value) || 0);
                      setEditingWorkload({
                        ...editingWorkload,
                        adultPt: nextAdult,
                        totalPt: nextAdult + (editingWorkload.childPt || 0),
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">เด็ก</label>
                  <input
                    type="number"
                    min="0"
                    value={editingWorkload.childPt}
                    onChange={(e) => {
                      const nextChild = Math.max(0, Number(e.target.value) || 0);
                      setEditingWorkload({
                        ...editingWorkload,
                        childPt: nextChild,
                        totalPt: (editingWorkload.adultPt || 0) + nextChild,
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-red-600 mb-1">Admit (คน)</label>
                  <input
                    type="number"
                    min="0"
                    value={editingWorkload.admit}
                    onChange={(e) => setEditingWorkload({ ...editingWorkload, admit: Number(e.target.value) || 0 })}
                    className="w-full px-2.5 py-1.5 border border-red-300 rounded-lg text-xs font-bold text-red-600"
                  />
                </div>
              </div>

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
                      value={editingWorkload.hn}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, hn: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-blue-800 mb-1">RN *</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={editingWorkload.rn}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, rn: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-blue-300 rounded text-center text-xs font-bold text-blue-900"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-teal-800 mb-1">PN *</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={editingWorkload.pn}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, pn: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-teal-300 rounded text-center text-xs font-bold text-teal-900"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] font-bold text-emerald-800 mb-1">NA *</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={editingWorkload.na ?? editingWorkload.pca ?? 0}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, na: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-emerald-300 rounded text-center text-xs font-bold text-emerald-900"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] text-gray-500 mb-1">ผู้ปฏิบัติงานทั่วไป</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={editingWorkload.clerk}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, clerk: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
                    />
                  </div>
                  <div>
                    <span className="block text-[11px] text-gray-500 mb-1">พนักงานบริการ</span>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={editingWorkload.serviceWorker}
                      onChange={(e) => setEditingWorkload({ ...editingWorkload, serviceWorker: Number(e.target.value) || 0 })}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-center text-xs"
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
                    onChange={(e) => setEditingWorkload({ ...editingWorkload, reporter: e.target.value })}
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
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setEditingWorkload(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!editingWorkload.reporter.trim()) {
                    alert('กรุณาระบุชื่อผู้บันทึกรายงาน');
                    return;
                  }
                  onUpdateWorkload(editingWorkload);
                  setEditingWorkload(null);
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
    </div>
  );
};
