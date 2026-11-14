import React, { useState, useMemo } from 'react';
import { 
  DailyWorkload, 
  SystemSettings, 
  IN_TIME_CLINICS, 
  OUT_TIME_CLINICS, 
  SHIFTS, 
  WorkShift,
  getEffectiveTotalPt,
  getClinicNhppd,
  SCREENING_CLINIC_NAME
} from '../types';
import { ThaiMonthInput } from './ThaiDateInput';
import { 
  BarChart3, 
  PieChart, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  Flame, 
  Calculator, 
  Layers, 
  Info, 
  Sliders, 
  Sparkles,
  ArrowRight
} from 'lucide-react';

interface ProductivityTabProps {
  workloads: DailyWorkload[];
  settings: SystemSettings;
  inTimeClinics?: string[];
  outTimeClinics?: string[];
}

export const ProductivityTab: React.FC<ProductivityTabProps> = ({
  workloads,
  settings,
  inTimeClinics = [...IN_TIME_CLINICS],
  outTimeClinics = [...OUT_TIME_CLINICS],
}) => {
  // Current month string YYYY-MM
  const currentMonthStr = new Date().toISOString().slice(0, 7);

  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);
  const [selectedShift, setSelectedShift] = useState<string>('ALL');
  const [selectedClinic, setSelectedClinic] = useState<string>('ALL');
  const [excludeLasik, setExcludeLasik] = useState<boolean>(true); // Default exclude LASIK as per standard OPD nursing formula

  // Combine unique clinics list
  const allClinicsList = useMemo(() => {
    return Array.from(new Set([...inTimeClinics, ...outTimeClinics]));
  }, [inTimeClinics, outTimeClinics]);

  // Filter workloads matching month, shift, clinic, and LASIK rule
  const filteredWorkloads = useMemo(() => {
    return workloads.filter(w => {
      const matchMonth = w.date.startsWith(selectedMonth);
      const matchShift = selectedShift === 'ALL' || w.shift === selectedShift;
      const matchClinic = selectedClinic === 'ALL' || w.clinic === selectedClinic;
      const matchLasik = !(excludeLasik && selectedClinic === 'ALL' && w.clinic === 'ศูนย์เลสิก');

      return matchMonth && matchShift && matchClinic && matchLasik;
    });
  }, [workloads, selectedMonth, selectedShift, selectedClinic, excludeLasik]);

  // Working days count: unique dates in the filtered records
  const workingDays = useMemo(() => {
    const dates = new Set(filteredWorkloads.map(w => w.date));
    return dates.size > 0 ? dates.size : 1;
  }, [filteredWorkloads]);

  // Totals calculation (uses 0.1 NHPPD for หน่วยคัดกรอง and 0.4 for all other clinics)
  const stats = useMemo(() => {
    const totalPt = filteredWorkloads.reduce((sum, w) => sum + getEffectiveTotalPt(w), 0);
    const totalAdmit = filteredWorkloads.reduce((sum, w) => sum + (w.admit || 0), 0);
    const sumRN = filteredWorkloads.reduce((sum, w) => sum + (w.rn || 0), 0);
    const sumPN = filteredWorkloads.reduce((sum, w) => sum + (w.pn || 0), 0);
    const sumNA = filteredWorkloads.reduce((sum, w) => sum + (w.na !== undefined ? w.na : (w.pca || 0)), 0);
    const sumHN = filteredWorkloads.reduce((sum, w) => sum + (w.hn || 0), 0);
    const totalNursingStaff = sumRN + sumPN + sumNA; // Exclude HN

    const generalNhppd = Number(settings.nhppd) > 0 ? Number(settings.nhppd) : 0.4;
    const screeningNhppd = Number(settings.screeningNhppd) > 0 ? Number(settings.screeningNhppd) : 0.1;
    const hasScreeningRecords = filteredWorkloads.some(w => w.clinic === SCREENING_CLINIC_NAME);
    const isScreeningOnly =
      selectedClinic === SCREENING_CLINIC_NAME ||
      (filteredWorkloads.length > 0 && filteredWorkloads.every(w => w.clinic === SCREENING_CLINIC_NAME));

    // 1) ผู้ป่วยเฉลี่ย/วัน = Total_Pt / จำนวนวันทำการ
    const avgPtPerDay = totalPt / workingDays;

    // 2) อัตรากำลังที่ต้องการ (FTC) = ผลรวม (ผู้ป่วยแต่ละหน่วย * NHPPD ของหน่วยนั้น) / (วันทำการ * Std_Hr)
    const totalRequiredHours = filteredWorkloads.reduce(
      (sum, w) => sum + getEffectiveTotalPt(w) * getClinicNhppd(w.clinic, settings),
      0
    );
    const stdHr = Number(settings.stdHr) || 7;
    const ftc = (totalRequiredHours / workingDays) / stdHr;
    const effectiveNhppd = totalPt > 0
      ? totalRequiredHours / totalPt
      : isScreeningOnly
      ? screeningNhppd
      : generalNhppd;

    // 3) Output (อัตรากำลังที่ต้องการ/วัน) = (ข้อ 2 * Annual_Hr) / (Work_Days * 8)
    const annualHr = Number(settings.annualHr) || 2080;
    const workDays = Number(settings.workDays) || 245;
    const output = (ftc * annualHr) / (workDays * 8);

    // 4) Input (อัตรากำลังจัดเฉลี่ย/วัน) = (ผลรวม RN + PN + NA) / จำนวนวันทำการ (ไม่รวม HN)
    const input = totalNursingStaff / workingDays;

    // 5) Productivity (%) = (Output / Input) * 100
    const productivity = input > 0 ? (output / input) * 100 : 0;

    // 6) Skill Mix (%) = RN / (RN + PN + NA) * 100
    const skillMix = totalNursingStaff > 0 ? (sumRN / totalNursingStaff) * 100 : 0;

    return {
      totalPt,
      totalAdmit,
      sumRN,
      sumPN,
      sumNA,
      sumHN,
      totalNursingStaff,
      avgPtPerDay,
      ftc,
      output,
      input,
      productivity,
      skillMix,
      generalNhppd,
      screeningNhppd,
      effectiveNhppd,
      hasScreeningRecords,
      isScreeningOnly,
    };
  }, [filteredWorkloads, workingDays, settings, selectedClinic]);

  // Productivity Status
  const getProductivityStatus = (prod: number) => {
    if (prod === 0) return { label: 'ยังไม่มีข้อมูล', color: 'text-gray-500 bg-gray-100 border-gray-300', level: 'empty' };
    if (prod < 85) {
      return { 
        label: 'ต่ำกว่าเกณฑ์ (< 85%) - กำลังคนสูงกว่าภาระงาน', 
        color: 'text-amber-800 bg-amber-50 border-amber-300', 
        level: 'low',
        badge: 'Under-utilized',
        icon: AlertTriangle,
        advice: 'พิจารณาเกลี่ยอัตรากำลังพยาบาลไปยังห้องตรวจที่มีภาระงานสูง หรือปรับลดเวรเสริม'
      };
    }
    if (prod <= 115) {
      return { 
        label: 'เหมาะสมตามเกณฑ์มาตรฐาน (85% - 115%)', 
        color: 'text-emerald-800 bg-emerald-50 border-emerald-300', 
        level: 'optimal',
        badge: 'Optimal Ratio',
        icon: CheckCircle2,
        advice: 'การจัดอัตรากำลังสมดุลกับภาระงานผู้ป่วย คุณภาพการพยาบาลและความปลอดภัยอยู่ในเกณฑ์ดีเยี่ยม'
      };
    }
    return { 
      label: 'สูงเกินเกณฑ์ (> 115%) - ภาระงานหนักเกินมาตรฐาน', 
      color: 'text-red-800 bg-red-50 border-red-300', 
      level: 'high',
      badge: 'Overloaded',
      icon: Flame,
      advice: 'พิจารณาเสริมอัตรากำลัง RN/PN ในช่วงเวลาพีค หรือเปิดรับเวรนอกเวลาเสริมเพื่อป้องกันภาวะหมดไฟและความเสี่ยงทางคลินิก'
    };
  };

  const status = getProductivityStatus(stats.productivity);
  const StatusIcon = status.icon || Info;

  // Breakdown by Clinic
  const clinicBreakdown = useMemo(() => {
    const map = new Map<string, { totalPt: number; rn: number; pn: number; na: number; days: Set<string> }>();

    filteredWorkloads.forEach(w => {
      const c = w.clinic;
      if (!map.has(c)) {
        map.set(c, { totalPt: 0, rn: 0, pn: 0, na: 0, days: new Set() });
      }
      const item = map.get(c)!;
      item.totalPt += getEffectiveTotalPt(w);
      item.rn += w.rn || 0;
      item.pn += w.pn || 0;
      item.na += (w.na !== undefined ? w.na : (w.pca || 0));
      item.days.add(w.date);
    });

    const list = Array.from(map.entries()).map(([clinicName, val]) => {
      const d = val.days.size || 1;
      const avgPt = val.totalPt / d;
      const clinicNhppd = getClinicNhppd(clinicName, settings);
      const ftc = (avgPt * clinicNhppd) / settings.stdHr;
      const out = (ftc * settings.annualHr) / (settings.workDays * 8);
      const nursing = (val.rn + val.pn + val.na) / d;
      const prod = nursing > 0 ? (out / nursing) * 100 : 0;
      const skillMix = (val.rn + val.pn + val.na) > 0 ? (val.rn / (val.rn + val.pn + val.na)) * 100 : 0;

      return {
        clinicName,
        clinicNhppd,
        totalPt: val.totalPt,
        avgPt: Number(avgPt.toFixed(1)),
        nursingStaffPerDay: Number(nursing.toFixed(1)),
        productivity: Number(prod.toFixed(1)),
        skillMix: Number(skillMix.toFixed(1)),
      };
    });

    return list.sort((a, b) => b.totalPt - a.totalPt);
  }, [filteredWorkloads, settings]);

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <div className="bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 border border-amber-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <Calculator className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-amber-950">
              เมนูที่ 4: สรุป Productivity, Skill Mix และ FTC ประจำเดือน
            </h2>
            <p className="text-xs text-amber-800">
              คำนวณอัตโนมัติตามมาตรฐานภาระงานการพยาบาล สป.สธ. (NHPPD {stats.generalNhppd} / หน่วยคัดกรอง {stats.screeningNhppd} / Std {settings.stdHr} ชม. / {settings.annualHr} ชม.ต่อปี)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-3 py-1.5 bg-white text-amber-900 border border-amber-300 rounded-lg shadow-2xs">
            วันทำการที่บันทึก: {workingDays} วัน
          </span>
        </div>
      </div>

      {/* Filter Bar with LASIK Exclusion Toggle */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              เลือกเดือน (พ.ศ.):
            </label>
            <ThaiMonthInput
              value={selectedMonth}
              onChange={setSelectedMonth}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              กะเวลา:
            </label>
            <select
              value={selectedShift}
              onChange={(e) => setSelectedShift(e.target.value)}
              className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border bg-white"
            >
              <option value="ALL">-- ทุกกะเวลา --</option>
              {SHIFTS.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">
              ห้องตรวจ:
            </label>
            <select
              value={selectedClinic}
              onChange={(e) => setSelectedClinic(e.target.value)}
              className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border bg-white font-medium text-emerald-950"
            >
              <option value="ALL">ภาพรวมทั้ง OPD (ทุกคลินิก)</option>
              {allClinicsList.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* LASIK exclusion checkbox */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs">
          <label className="flex items-center gap-2 cursor-pointer text-gray-700 font-medium">
            <input
              type="checkbox"
              checked={excludeLasik}
              onChange={(e) => setExcludeLasik(e.target.checked)}
              className="rounded text-amber-600 focus:ring-amber-500 w-4 h-4"
            />
            <span>
              ไม่รวม <strong>"ศูนย์เลสิก"</strong> ในการคำนวณภาพรวม OPD (แยกหน่วยบริการพิเศษ)
            </span>
          </label>
          <span className="text-gray-400 text-[11px]">
            {excludeLasik ? '(คัดศูนย์เลสิกออกแล้ว)' : '(รวมศูนย์เลสิกด้วย)'}
          </span>
        </div>
      </div>

      {/* Main 6 Steps Formulas Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Step 1: Avg Patients / Day */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-gray-500 text-xs">
            <span className="font-semibold">ข้อ 1) ผู้ป่วยเฉลี่ย/วัน</span>
            <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-mono">Total / Days</span>
          </div>
          <div className="text-2xl font-extrabold text-blue-900">
            {stats.avgPtPerDay.toFixed(1)}{' '}
            <span className="text-xs font-normal text-gray-500">คน/วัน</span>
          </div>
          <div className="text-[11px] text-gray-500">
            ผู้ป่วยสะสม: {stats.totalPt.toLocaleString()} คน / {workingDays} วันทำการ
          </div>
        </div>

        {/* Step 2: FTC Required */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-gray-500 text-xs">
            <span className="font-semibold">ข้อ 2) อัตรากำลังที่ต้องการ (FTC)</span>
            <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-mono">
              {stats.isScreeningOnly
                ? `(Pt * ${stats.screeningNhppd}) / ${settings.stdHr}`
                : stats.hasScreeningRecords && selectedClinic === 'ALL'
                ? `(Pt * ${stats.generalNhppd} / คัดกรอง ${stats.screeningNhppd}) / ${settings.stdHr}`
                : `(Pt * ${stats.generalNhppd}) / ${settings.stdHr}`}
            </span>
          </div>
          <div className="text-2xl font-extrabold text-indigo-900">
            {stats.ftc.toFixed(2)}{' '}
            <span className="text-xs font-normal text-gray-500">FTC</span>
          </div>
          <div className="text-[11px] text-gray-500">
            {stats.isScreeningOnly ? (
              <>NHPPD หน่วยคัดกรอง: <strong className="text-cyan-800">{stats.screeningNhppd}</strong> ชม. | ชม.มาตรฐาน: {settings.stdHr} ชม.</>
            ) : stats.hasScreeningRecords && selectedClinic === 'ALL' ? (
              <>NHPPD: ทั่วไป {stats.generalNhppd} / คัดกรอง <strong className="text-cyan-800">{stats.screeningNhppd}</strong> ชม. | มาตรฐาน: {settings.stdHr} ชม.</>
            ) : (
              <>NHPPD: {stats.generalNhppd} ชม. (หน่วยคัดกรอง {stats.screeningNhppd}) | ชม.มาตรฐาน: {settings.stdHr} ชม.</>
            )}
          </div>
        </div>

        {/* Step 3: Output Required / Day */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-gray-500 text-xs">
            <span className="font-semibold">ข้อ 3) Output (ต้องการ/วัน)</span>
            <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-mono">FTC*2080 / (245*8)</span>
          </div>
          <div className="text-2xl font-extrabold text-emerald-900">
            {stats.output.toFixed(2)}{' '}
            <span className="text-xs font-normal text-gray-500">แรง/วัน</span>
          </div>
          <div className="text-[11px] text-gray-500">
            อัตรากำลังที่ต้องการคำนวณจากภาระงานจริง
          </div>
        </div>

        {/* Step 4: Input Scheduled / Day */}
        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-gray-500 text-xs">
            <span className="font-semibold">ข้อ 4) Input (จัดเฉลี่ย/วัน)</span>
            <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded font-mono">(RN+PN+NA) / Days</span>
          </div>
          <div className="text-2xl font-extrabold text-cyan-900">
            {stats.input.toFixed(2)}{' '}
            <span className="text-xs font-normal text-gray-500">แรง/วัน</span>
          </div>
          <div className="text-[11px] text-gray-500">
            กำลังคนการพยาบาลจัดจริง (ไม่รวม HN)
          </div>
        </div>

        {/* Step 5: Productivity % */}
        <div className={`rounded-2xl p-4 border-2 shadow-sm space-y-1.5 ${
          stats.productivity > 115 ? 'bg-red-50/50 border-red-300' :
          stats.productivity >= 85 ? 'bg-emerald-50/50 border-emerald-300' :
          'bg-amber-50/50 border-amber-300'
        }`}>
          <div className="flex items-center justify-between text-gray-600 text-xs">
            <span className="font-bold">ข้อ 5) Productivity (%)</span>
            <span className="text-[10px] bg-white px-2 py-0.5 rounded-full font-mono font-bold">
              (Output / Input) * 100
            </span>
          </div>
          <div className={`text-3xl font-black ${
            stats.productivity > 115 ? 'text-red-900' :
            stats.productivity >= 85 ? 'text-emerald-900' :
            'text-amber-900'
          }`}>
            {stats.productivity.toFixed(1)}%
          </div>
          <div className="text-[11px] font-semibold text-gray-700">
            เกณฑ์มาตรฐาน: 85.0% - 115.0%
          </div>
        </div>

        {/* Step 6: Skill Mix % */}
        <div className="bg-white rounded-2xl p-4 border border-purple-200 shadow-2xs space-y-1.5">
          <div className="flex items-center justify-between text-gray-500 text-xs">
            <span className="font-bold text-purple-900">ข้อ 6) Skill Mix (%)</span>
            <span className="text-[10px] bg-purple-50 px-2 py-0.5 rounded-full text-purple-800 font-mono">
              RN / (RN+PN+NA)
            </span>
          </div>
          <div className="text-3xl font-extrabold text-purple-900">
            {stats.skillMix.toFixed(1)}%
          </div>
          <div className="text-[11px] text-gray-500">
            สัดส่วนพยาบาลวิชาชีพ RN ต่อบุคลากรการพยาบาลทั้งหมด
          </div>
        </div>
      </div>

      {/* Productivity Status Banner & Recommendations */}
      <div className={`rounded-2xl p-5 border ${status.color} shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4`}>
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-white shadow-xs shrink-0">
            <StatusIcon className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-base leading-tight">
                สถานะ Productivity: {stats.productivity.toFixed(1)}%
              </h4>
              {status.badge && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white shadow-2xs">
                  {status.badge}
                </span>
              )}
            </div>
            <p className="text-xs font-medium mt-1">
              {status.label}
            </p>
            {status.advice && (
              <p className="text-xs mt-1.5 opacity-90 flex items-center gap-1.5 font-normal">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span><strong>ข้อเสนอแนะทาง Informatics:</strong> {status.advice}</span>
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Skill Mix Breakdown Visual Bar */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-3">
        <h3 className="text-xs font-bold text-gray-900 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-purple-600" />
            สัดส่วนองค์ประกอบบุคลากรการพยาบาล (Nursing Staff Mix)
          </span>
          <span className="text-gray-500 font-normal">
            รวม: {stats.totalNursingStaff.toFixed(1)} แรง-เวร
          </span>
        </h3>

        {/* Proportion Bar */}
        {stats.totalNursingStaff > 0 ? (
          <div className="space-y-2">
            <div className="h-6 w-full rounded-xl overflow-hidden flex bg-gray-100 shadow-inner">
              <div
                style={{ width: `${(stats.sumRN / stats.totalNursingStaff) * 100}%` }}
                className="bg-blue-600 h-full text-white text-[10px] font-bold flex items-center justify-center transition-all"
                title={`RN: ${stats.sumRN} (${((stats.sumRN / stats.totalNursingStaff) * 100).toFixed(1)}%)`}
              >
                {((stats.sumRN / stats.totalNursingStaff) * 100) > 10 && `RN ${((stats.sumRN / stats.totalNursingStaff) * 100).toFixed(0)}%`}
              </div>
              <div
                style={{ width: `${(stats.sumPN / stats.totalNursingStaff) * 100}%` }}
                className="bg-teal-500 h-full text-white text-[10px] font-bold flex items-center justify-center transition-all"
                title={`PN: ${stats.sumPN} (${((stats.sumPN / stats.totalNursingStaff) * 100).toFixed(1)}%)`}
              >
                {((stats.sumPN / stats.totalNursingStaff) * 100) > 10 && `PN ${((stats.sumPN / stats.totalNursingStaff) * 100).toFixed(0)}%`}
              </div>
              <div
                style={{ width: `${(stats.sumNA / stats.totalNursingStaff) * 100}%` }}
                className="bg-emerald-500 h-full text-white text-[10px] font-bold flex items-center justify-center transition-all"
                title={`NA: ${stats.sumNA} (${((stats.sumNA / stats.totalNursingStaff) * 100).toFixed(1)}%)`}
              >
                {((stats.sumNA / stats.totalNursingStaff) * 100) > 10 && `NA ${((stats.sumNA / stats.totalNursingStaff) * 100).toFixed(0)}%`}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
              <div className="bg-blue-50 text-blue-900 p-2 rounded-lg border border-blue-200">
                <div className="font-bold">RN (พยาบาลวิชาชีพ)</div>
                <div className="text-sm font-extrabold">{stats.sumRN.toFixed(1)} แรง</div>
                <div className="text-[10px] text-blue-700">{stats.skillMix.toFixed(1)}% ของทั้งหมด</div>
              </div>
              <div className="bg-teal-50 text-teal-900 p-2 rounded-lg border border-teal-200">
                <div className="font-bold">PN (ผู้ช่วยพยาบาล)</div>
                <div className="text-sm font-extrabold">{stats.sumPN.toFixed(1)} แรง</div>
                <div className="text-[10px] text-teal-700">
                  {((stats.sumPN / stats.totalNursingStaff) * 100).toFixed(1)}% ของทั้งหมด
                </div>
              </div>
              <div className="bg-emerald-50 text-emerald-900 p-2 rounded-lg border border-emerald-200">
                <div className="font-bold">NA (ผู้ช่วยคนไข้)</div>
                <div className="text-sm font-extrabold">{stats.sumNA.toFixed(1)} แรง</div>
                <div className="text-[10px] text-emerald-700">
                  {((stats.sumNA / stats.totalNursingStaff) * 100).toFixed(1)}% ของทั้งหมด
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6 text-center text-gray-400 text-xs">ยังไม่มีข้อมูลบุคลากรในเดือนนี้</div>
        )}
      </div>

      {/* Comparison Table by Clinic */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4">
        <h3 className="text-xs font-bold text-gray-900 flex items-center justify-between border-b pb-2">
          <span>เปรียบเทียบภาระงานและ Productivity แยกรายห้องตรวจ ({clinicBreakdown.length} คลินิก)</span>
          <span className="text-[11px] font-normal text-gray-500">จัดเรียงตามจำนวนผู้ป่วย</span>
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b">
              <tr>
                <th className="py-2.5 px-3">ห้องตรวจ</th>
                <th className="py-2.5 px-2 text-center">NHPPD</th>
                <th className="py-2.5 px-2 text-right">ผู้ป่วยรวม (คน)</th>
                <th className="py-2.5 px-2 text-right">เฉลี่ย/วัน (คน)</th>
                <th className="py-2.5 px-2 text-right">กำลังคนพยาบาล/วัน (แรง)</th>
                <th className="py-2.5 px-2 text-right">Skill Mix (% RN)</th>
                <th className="py-2.5 px-3 text-center">Productivity (%)</th>
                <th className="py-2.5 px-2 text-center">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {clinicBreakdown.map((item) => {
                const itemStatus = getProductivityStatus(item.productivity);
                const isScreening = item.clinicName === SCREENING_CLINIC_NAME;
                return (
                  <tr key={item.clinicName} className="hover:bg-slate-50/80">
                    <td className="py-2 px-3 font-bold text-gray-900">{item.clinicName}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        isScreening
                          ? 'bg-cyan-100 text-cyan-800 border border-cyan-300'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {item.clinicNhppd}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-right text-gray-700">{item.totalPt.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right font-medium text-blue-900">{item.avgPt}</td>
                    <td className="py-2 px-2 text-right text-gray-800">{item.nursingStaffPerDay}</td>
                    <td className="py-2 px-2 text-right font-medium text-purple-900">{item.skillMix}%</td>
                    <td className="py-2 px-3 text-center font-extrabold text-sm">
                      <span className={
                        item.productivity > 115 ? 'text-red-700' :
                        item.productivity >= 85 ? 'text-emerald-700' :
                        'text-amber-700'
                      }>
                        {item.productivity}%
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                        item.productivity > 115 ? 'bg-red-100 text-red-800' :
                        item.productivity >= 85 ? 'bg-emerald-100 text-emerald-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {itemStatus.badge || 'N/A'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
