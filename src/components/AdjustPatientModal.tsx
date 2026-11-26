import React, { useEffect, useMemo, useState } from 'react';
import {
  DailyWorkload,
  ReferralCenterData,
  REFERRAL_ITEM_DEFINITIONS,
  createEmptyReferralData,
  getCanonicalReferralSignature,
  getEffectiveTotalPt,
  getReferralAdmitCount,
  getReferralTotalCount,
  isPremiumGroupName,
  isReferralWorkload,
  normalizeReferralData,
} from '../types';
import { formatThaiShortDate } from '../utils/thaiDate';
import {
  Activity,
  AlertCircle,
  Bed,
  Minus,
  Plus,
  Save,
  UserCheck,
  Users,
  X,
} from 'lucide-react';

export interface AdjustPatientPatch {
  adultPt: number;
  childPt: number;
  totalPt: number;
  admit: number;
  referralData?: ReferralCenterData;
}

interface AdjustPatientModalProps {
  workload: DailyWorkload | null;
  defaultAdjusterName?: string;
  onClose: () => void;
  onConfirm: (
    target: DailyWorkload,
    patch: AdjustPatientPatch,
    adjusterName: string,
    reason: string
  ) => void;
}

const PATIENT_ADJUST_REASON_PRESETS = [
  'ส่งตรวจเพิ่ม (Consult)',
  'ผู้ป่วยมาตรวจเพิ่มหลังบันทึก',
  'ยกเลิก/ลดยอดผู้ป่วย',
  'ตรวจทานตัวเลขเพิ่มเติม',
];

export const AdjustPatientModal: React.FC<AdjustPatientModalProps> = ({
  workload,
  defaultAdjusterName = '',
  onClose,
  onConfirm,
}) => {
  const [adultPt, setAdultPt] = useState<number>(0);
  const [childPt, setChildPt] = useState<number>(0);
  const [totalPt, setTotalPt] = useState<number>(0);
  const [admit, setAdmit] = useState<number>(0);
  const [referralData, setReferralData] = useState<ReferralCenterData>(() =>
    createEmptyReferralData()
  );
  const [adjusterName, setAdjusterName] = useState<string>(defaultAdjusterName);
  const [reason, setReason] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  const isReferral = useMemo(
    () => (workload ? isReferralWorkload(workload) : false),
    [workload]
  );
  const isEcho = useMemo(
    () => (workload ? workload.clinic.trim() === 'Echo' : false),
    [workload]
  );
  const isSubPremium = useMemo(
    () =>
      workload
        ? workload.recordType === 'PREMIUM_SUB' || isPremiumGroupName(workload.clinicGroup)
        : false,
    [workload]
  );

  useEffect(() => {
    if (!workload) return;
    const origAdult = Math.max(0, Number(workload.adultPt || 0));
    const origChild = Math.max(0, Number(workload.childPt || 0));
    const origTotal = getEffectiveTotalPt(workload);
    const origAdmit = Math.max(0, Number(workload.admit || 0));

    if (isReferralWorkload(workload)) {
      const normRef = normalizeReferralData(workload.referralData);
      setReferralData(normRef);
      const rTotal = getReferralTotalCount(normRef);
      const rAdmit = getReferralAdmitCount(normRef);
      setAdultPt(rTotal);
      setChildPt(0);
      setTotalPt(rTotal);
      setAdmit(rAdmit);
    } else {
      setAdultPt(origAdult);
      setChildPt(origChild);
      setTotalPt(origTotal);
      setAdmit(origAdmit);
    }
    setAdjusterName((defaultAdjusterName || '').trim());
    setReason('');
    setErrorMsg('');
  }, [workload, defaultAdjusterName]);

  if (!workload) return null;

  const origTotal = isReferral
    ? getReferralTotalCount(normalizeReferralData(workload.referralData))
    : getEffectiveTotalPt(workload);
  const origAdmit = isReferral
    ? getReferralAdmitCount(normalizeReferralData(workload.referralData))
    : Math.max(0, Number(workload.admit || 0));

  const nextTotalDisplay = isReferral ? getReferralTotalCount(referralData) : totalPt;
  const nextAdmitDisplay = isReferral ? getReferralAdmitCount(referralData) : admit;
  const deltaTotal = nextTotalDisplay - origTotal;
  const deltaAdmit = nextAdmitDisplay - origAdmit;

  const handleTotalChange = (raw: number) => {
    if (isEcho) return;
    const nextTotal = Math.max(0, Math.round(Number(raw) || 0));
    setTotalPt(nextTotal);
    if (nextTotal >= childPt) {
      setAdultPt(nextTotal - childPt);
    } else {
      setAdultPt(0);
      setChildPt(nextTotal);
    }
    setErrorMsg('');
  };

  const handleAdultChange = (raw: number) => {
    const nextAdult = Math.max(0, Math.round(Number(raw) || 0));
    setAdultPt(nextAdult);
    setTotalPt(nextAdult + childPt);
    setErrorMsg('');
  };

  const handleChildChange = (raw: number) => {
    const nextChild = Math.max(0, Math.round(Number(raw) || 0));
    setChildPt(nextChild);
    setTotalPt(adultPt + nextChild);
    setErrorMsg('');
  };

  const handleAdmitChange = (raw: number) => {
    setAdmit(Math.max(0, Math.round(Number(raw) || 0)));
    setErrorMsg('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAdjuster = adjusterName.trim();
    const cleanReason = reason.trim();
    if (!cleanAdjuster) {
      setErrorMsg('กรุณาระบุชื่อผู้ปรับยอดผู้ป่วย');
      return;
    }
    if (!cleanReason) {
      setErrorMsg('กรุณาระบุเหตุผลการเพิ่มหรือลดยอดผู้ป่วย');
      return;
    }

    if (isReferral) {
      const normNext = normalizeReferralData(referralData);
      const normOrig = normalizeReferralData(workload.referralData);
      const nextT = getReferralTotalCount(normNext);
      const nextA = getReferralAdmitCount(normNext);
      if (
        nextT === origTotal &&
        nextA === origAdmit &&
        getCanonicalReferralSignature(normNext) === getCanonicalReferralSignature(normOrig)
      ) {
        setErrorMsg('ยังไม่มีการเปลี่ยนแปลงจำนวนผู้ป่วยหรือรายการส่งต่อ กรุณาปรับเพิ่มหรือลดตัวเลขก่อนบันทึก');
        return;
      }
      onConfirm(
        workload,
        {
          adultPt: nextT,
          childPt: 0,
          totalPt: nextT,
          admit: nextA,
          referralData: normNext,
        },
        cleanAdjuster,
        cleanReason
      );
      onClose();
      return;
    }

    const origAdult = Math.max(0, Number(workload.adultPt || 0));
    const origChild = Math.max(0, Number(workload.childPt || 0));
    const finalTotal = Math.max(totalPt, adultPt + childPt);
    if (
      finalTotal === origTotal &&
      adultPt === origAdult &&
      childPt === origChild &&
      admit === origAdmit
    ) {
      setErrorMsg('ยังไม่มีการเปลี่ยนแปลงจำนวนผู้ป่วยหรือ Admit กรุณาปรับเพิ่มหรือลดตัวเลขก่อนบันทึก');
      return;
    }

    onConfirm(
      workload,
      {
        adultPt,
        childPt,
        totalPt: finalTotal,
        admit,
      },
      cleanAdjuster,
      cleanReason
    );
    onClose();
  };

  const nursingTotal = (
    Number(workload.rn || 0) +
    Number(workload.pn || 0) +
    Number(workload.na !== undefined ? workload.na : workload.pca || 0)
  ).toFixed(1);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-emerald-200 max-w-xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto max-h-[92dvh] flex flex-col">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-emerald-800 to-teal-700 text-white flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="font-bold text-sm sm:text-base flex items-center gap-2">
              <Activity className="w-4 h-4 shrink-0 text-emerald-200" />
              <span className="truncate">ปรับเพิ่ม / ลดยอดผู้ป่วย</span>
            </h3>
            <p className="text-[11px] text-emerald-100 mt-0.5 truncate">
              {workload.clinic} • {formatThaiShortDate(workload.date)} • {workload.shift}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/15 cursor-pointer shrink-0"
            aria-label="ปิดหน้าต่าง"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Before -> After Summary Strip */}
          <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-600 font-medium">ยอดผู้ป่วยรวม:</span>
                <span className="px-2 py-0.5 rounded-md bg-white border border-gray-200 font-bold text-gray-700">
                  เดิม {origTotal}
                </span>
                <span className="text-gray-400 font-bold">→</span>
                <span className="px-2 py-0.5 rounded-md bg-emerald-700 text-white font-bold">
                  ใหม่ {nextTotalDisplay} คน
                </span>
                {deltaTotal !== 0 && (
                  <span
                    className={`px-2 py-0.5 rounded-md text-[11px] font-bold border ${
                      deltaTotal > 0
                        ? 'bg-blue-50 text-blue-800 border-blue-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    {deltaTotal > 0 ? `+${deltaTotal}` : deltaTotal} คน
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="text-gray-600">Admit:</span>
                <span className="font-bold text-red-700">
                  {origAdmit} → {nextAdmitDisplay}
                </span>
                {deltaAdmit !== 0 && (
                  <span className="px-1.5 py-0.2 rounded bg-red-100 text-red-800 font-bold">
                    {deltaAdmit > 0 ? `+${deltaAdmit}` : deltaAdmit}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-emerald-900/80 border-t border-emerald-200/70 pt-1.5">
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-emerald-700" />
                {isSubPremium
                  ? 'กำลังคน: ใช้กำลังคนรวมศูนย์ปัญญาภิรมย์ (คงเดิม)'
                  : `กำลังคนเดิม (คงที่): RN ${workload.rn} • PN ${workload.pn} • NA ${
                      workload.na ?? workload.pca ?? 0
                    } (รวม ${nursingTotal} แรง)`}
              </span>
              <span className="text-[10.5px] text-emerald-800">
                ผู้บันทึกเดิม: {workload.reporter || '-'}
              </span>
            </div>
          </div>

          {isReferral ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-indigo-950">
                  รายการรับ - ส่งต่อผู้ป่วย (6 หมวดหมู่)
                </label>
                <span className="text-[11px] text-indigo-700 font-semibold">
                  รวมทั้งหมด {nextTotalDisplay} • Admit {nextAdmitDisplay}
                </span>
              </div>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {REFERRAL_ITEM_DEFINITIONS.map((def) => {
                  const item = referralData[def.key] || { count: 0, reason: '' };
                  const updateItem = (nextCount: number, nextItemReason?: string) => {
                    setReferralData((prev) => ({
                      ...prev,
                      [def.key]: {
                        count: Math.max(0, Math.round(nextCount) || 0),
                        reason:
                          nextItemReason !== undefined
                            ? nextItemReason
                            : prev[def.key]?.reason || '',
                      },
                    }));
                    setErrorMsg('');
                  };
                  return (
                    <div
                      key={def.key}
                      className="p-2.5 rounded-xl border border-indigo-200 bg-indigo-50/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="text-xs font-semibold text-indigo-950 min-w-[140px]">
                        {def.label}
                      </div>
                      <div className="flex items-center gap-1.5 flex-1">
                        <button
                          type="button"
                          onClick={() => updateItem((item.count || 0) - 1)}
                          className="p-1.5 rounded-lg bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 cursor-pointer"
                          title="ลด 1"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="number"
                          min="0"
                          value={item.count}
                          onChange={(e) => updateItem(Number(e.target.value) || 0)}
                          className="w-16 text-center text-xs font-bold py-1.5 rounded-lg border border-indigo-300 bg-white focus:border-indigo-500 focus:ring-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => updateItem((item.count || 0) + 1)}
                          className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                          title="เพิ่ม 1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="text"
                          value={item.reason}
                          onChange={(e) => updateItem(item.count || 0, e.target.value)}
                          placeholder="หมายเหตุย่อย (ถ้ามี)"
                          className="flex-1 min-w-0 text-xs py-1.5 px-2.5 rounded-lg border border-gray-200 bg-white focus:border-indigo-400"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Main Total Patient Card */}
              <div className="p-3 rounded-xl border-2 border-emerald-200 bg-emerald-50/40 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-emerald-950">
                    จำนวนผู้ป่วยทั้งหมด (คน) *
                  </label>
                  <span className="text-[11px] text-emerald-800">
                    = ผู้ใหญ่ ({adultPt}) + เด็ก ({childPt})
                  </span>
                </div>
                {isEcho ? (
                  <div className="flex items-center justify-between bg-white/90 border border-emerald-200 rounded-lg px-3 py-2">
                    <span className="text-xs text-gray-600">
                      ห้อง Echo คำนวณอัตโนมัติจาก ผู้ใหญ่ + เด็ก
                    </span>
                    <span className="text-lg font-extrabold text-emerald-800">
                      {totalPt} คน
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleTotalChange(totalPt - 5)}
                      className="px-2.5 py-2 rounded-lg bg-white border border-gray-300 hover:bg-red-50 hover:border-red-300 text-xs font-bold text-gray-700 hover:text-red-700 cursor-pointer"
                    >
                      -5
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTotalChange(totalPt - 1)}
                      className="px-2.5 py-2 rounded-lg bg-white border border-gray-300 hover:bg-red-50 hover:border-red-300 text-xs font-bold text-gray-700 hover:text-red-700 cursor-pointer flex items-center gap-0.5"
                    >
                      <Minus className="w-3.5 h-3.5" />1
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={totalPt}
                      onChange={(e) => handleTotalChange(Number(e.target.value) || 0)}
                      className="flex-1 min-w-0 text-center text-base font-extrabold py-1.5 rounded-lg border-2 border-emerald-400 bg-white text-emerald-950 focus:border-emerald-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleTotalChange(totalPt + 1)}
                      className="px-2.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-bold text-white cursor-pointer flex items-center gap-0.5"
                    >
                      <Plus className="w-3.5 h-3.5" />1
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTotalChange(totalPt + 5)}
                      className="px-2.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-xs font-bold text-white cursor-pointer"
                    >
                      +5
                    </button>
                  </div>
                )}
              </div>

              {/* Adult, Child, Admit Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="p-2.5 rounded-xl border border-gray-200 bg-slate-50/70 space-y-1.5">
                  <label className="block text-[11px] font-bold text-gray-700">
                    ผู้ป่วยผู้ใหญ่ (คน)
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleAdultChange(adultPt - 1)}
                      className="p-1.5 rounded-lg bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={adultPt}
                      onChange={(e) => handleAdultChange(Number(e.target.value) || 0)}
                      className="w-full text-center text-sm font-bold py-1 rounded-lg border border-gray-300 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => handleAdultChange(adultPt + 1)}
                      className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl border border-gray-200 bg-slate-50/70 space-y-1.5">
                  <label className="block text-[11px] font-bold text-gray-700">
                    ผู้ป่วยเด็ก (คน)
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleChildChange(childPt - 1)}
                      className="p-1.5 rounded-lg bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={childPt}
                      onChange={(e) => handleChildChange(Number(e.target.value) || 0)}
                      className="w-full text-center text-sm font-bold py-1 rounded-lg border border-gray-300 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => handleChildChange(childPt + 1)}
                      className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl border border-red-200 bg-red-50/40 space-y-1.5">
                  <label className="flex items-center gap-1 text-[11px] font-bold text-red-700">
                    <Bed className="w-3.5 h-3.5" />
                    <span>รับไว้รักษา (Admit)</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleAdmitChange(admit - 1)}
                      className="p-1.5 rounded-lg bg-white border border-red-200 hover:bg-red-50 text-red-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={admit}
                      onChange={(e) => handleAdmitChange(Number(e.target.value) || 0)}
                      className="w-full text-center text-sm font-bold py-1 rounded-lg border border-red-300 bg-white text-red-800"
                    />
                    <button
                      type="button"
                      onClick={() => handleAdmitChange(admit + 1)}
                      className="p-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Adjuster Name */}
          <div>
            <label className="flex items-center gap-1 text-xs font-bold text-gray-800 mb-1">
              <UserCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>ชื่อผู้ปรับยอดผู้ป่วย *</span>
            </label>
            <input
              type="text"
              value={adjusterName}
              onChange={(e) => {
                setAdjusterName(e.target.value);
                setErrorMsg('');
              }}
              placeholder="ระบุชื่อ-สกุล หรือชื่อผู้รายงานที่ปรับยอด"
              className="w-full text-xs rounded-xl border border-gray-300 focus:border-emerald-500 focus:ring-emerald-500 px-3 py-2"
            />
          </div>

          {/* Mandatory Reason + Quick Presets */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-gray-800">
              เหตุผลการเพิ่ม/ลดยอดผู้ป่วย *
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PATIENT_ADJUST_REASON_PRESETS.map((preset) => {
                const selected = reason.trim() === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setReason(preset);
                      setErrorMsg('');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                      selected
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-slate-50 hover:bg-emerald-50 text-slate-700 border-slate-200 hover:border-emerald-300'
                    }`}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setErrorMsg('');
              }}
              placeholder="เช่น ส่งตรวจเพิ่ม (Consult), ผู้ป่วยมาตรวจเพิ่มหลังบันทึก หรือยกเลิกตรวจ..."
              className="w-full text-xs rounded-xl border border-gray-300 focus:border-emerald-500 focus:ring-emerald-500 px-3 py-2"
            />
          </div>

          {errorMsg && (
            <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-bold bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                บันทึกปรับยอดผู้ป่วย
                {deltaTotal !== 0
                  ? ` (${deltaTotal > 0 ? `+${deltaTotal}` : deltaTotal} คน)`
                  : ''}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
