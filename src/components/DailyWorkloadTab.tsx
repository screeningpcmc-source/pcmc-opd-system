import React, { useState, useEffect, useMemo } from 'react';
import { 
  DailyWorkload, 
  StaffMember, 
  WorkShift, 
  IN_TIME_CLINICS, 
  OUT_TIME_CLINICS, 
  DEFAULT_PREMIUM_SUB_CLINICS,
  PREMIUM_CLINIC_GROUP,
  LEGACY_PREMIUM_CLINIC_GROUP,
  PREMIUM_POOL_CLINIC_NAME,
  isPremiumGroupName,
  isPremiumPoolClinicName,
  LeaveType,
  LEAVE_TYPES,
  formatPositionLabel,
  getEffectiveTotalPt,
  compareStaffByPositionAndStartDate
} from '../types';
import {
  formatThaiShortDate,
  formatThaiDateTime,
} from '../utils/thaiDate';
import { ThaiDateInput } from './ThaiDateInput';
import { 
  ClipboardPen, 
  Users, 
  Plus, 
  Minus, 
  Sparkles, 
  Calendar, 
  Clock, 
  Building, 
  Bed, 
  Activity, 
  Trash2, 
  FileCheck2,
  CheckCircle2,
  HelpCircle,
  ArrowRightLeft,
  Lock,
  ShieldCheck,
  Pencil,
  X,
  Save,
  Search,
  CheckSquare,
  Square,
  GraduationCap,
  CalendarOff,
  AlertCircle
} from 'lucide-react';

interface DailyWorkloadTabProps {
  workloads: DailyWorkload[];
  staffList: StaffMember[];
  inTimeClinics?: string[];
  outTimeClinics?: string[];
  premiumSubClinics?: string[];
  leaveTypes?: string[];
  onSaveWorkload: (
    entry: DailyWorkload, 
    leaveData?: { staffName: string; leaveType: LeaveType; note: string }[] | null,
    crossCoverageData?: { staffName: string; targetClinic: string } | null,
    trainingData?: { staffName: string; topic: string; note: string }[] | null
  ) => void;
  onSaveBatchWorkloads?: (
    entries: DailyWorkload[],
    leaveData?: { staffName: string; leaveType: LeaveType; note: string }[] | null,
    crossCoverageData?: { staffName: string; targetClinic: string } | null,
    trainingData?: { staffName: string; topic: string; note: string }[] | null
  ) => void;
  onUpdateWorkload?: (updated: DailyWorkload, reason: string) => void;
  onDeleteWorkload: (id: string, reason: string) => void;
  defaultReporter?: string;
  isAdmin?: boolean;
  onPromptAdminUnlock?: () => void;
}

export const DailyWorkloadTab: React.FC<DailyWorkloadTabProps> = ({
  workloads,
  staffList,
  inTimeClinics = [...IN_TIME_CLINICS],
  outTimeClinics = [...OUT_TIME_CLINICS],
  premiumSubClinics = [...DEFAULT_PREMIUM_SUB_CLINICS],
  leaveTypes = [...LEAVE_TYPES],
  onSaveWorkload,
  onSaveBatchWorkloads,
  onUpdateWorkload,
  onDeleteWorkload,
  defaultReporter = '',
  isAdmin = false,
  onPromptAdminUnlock,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const [date, setDate] = useState<string>(todayStr);
  const [shift, setShift] = useState<WorkShift>('ในเวลา 08:00-16:00');
  const [clinic, setClinic] = useState<string>(inTimeClinics[0] || IN_TIME_CLINICS[0]);

  // Admin Editing / Deleting Modal & Form Error State
  const [formError, setFormError] = useState<string>('');
  const [editingWorkload, setEditingWorkload] = useState<DailyWorkload | null>(null);
  const [editWorkloadReason, setEditWorkloadReason] = useState<string>('');
  const [editWorkloadReasonError, setEditWorkloadReasonError] = useState<string>('');
  const [editModalError, setEditModalError] = useState<string>('');
  const [deletingWorkload, setDeletingWorkload] = useState<DailyWorkload | null>(null);
  const [deleteWorkloadReason, setDeleteWorkloadReason] = useState<string>('');
  const [deleteWorkloadReasonError, setDeleteWorkloadReasonError] = useState<string>('');
  
  // Patients & Admit
  const [totalPt, setTotalPt] = useState<number>(0);
  const [adultPt, setAdultPt] = useState<number>(0);
  const [childPt, setChildPt] = useState<number>(0);
  const [admit, setAdmit] = useState<number>(0);

  // Staff on duty (supports 0.5 steps)
  const [hn, setHn] = useState<number>(1);
  const [rn, setRn] = useState<number>(2);
  const [pn, setPn] = useState<number>(1);
  const [na, setNa] = useState<number>(1);
  const [clerk, setClerk] = useState<number>(1);
  const [serviceWorker, setServiceWorker] = useState<number>(1);

  // Notes & Reporter (empty by default & required)
  const [note, setNote] = useState<string>('');
  const [reporter, setReporter] = useState<string>(defaultReporter);

  // Section 4: Leave / Training-Meeting / Cross-Coverage
  const [hasStaffLeave, setHasStaffLeave] = useState<boolean>(false);
  const [selectedLeaveStaffIds, setSelectedLeaveStaffIds] = useState<string[]>([]);
  const [leaveSearch, setLeaveSearch] = useState<string>('');
  const [leaveType, setLeaveType] = useState<LeaveType>('ลาป่วย');
  const [leaveNote, setLeaveNote] = useState<string>('');

  const [hasTraining, setHasTraining] = useState<boolean>(false);
  const [selectedTrainingStaffIds, setSelectedTrainingStaffIds] = useState<string[]>([]);
  const [trainingSearch, setTrainingSearch] = useState<string>('');
  const [trainingTopic, setTrainingTopic] = useState<string>('');
  const [trainingNote, setTrainingNote] = useState<string>('');

  const [hasCrossCover, setHasCrossCover] = useState<boolean>(false);
  const [crossStaffSearch, setCrossStaffSearch] = useState<string>('');
  const [crossStaffName, setCrossStaffName] = useState<string>('');
  const [crossTargetClinic, setCrossTargetClinic] = useState<string>('');

  // ศูนย์ปัญญาภิรมย์ sub-department inputs
  const [premiumInputs, setPremiumInputs] = useState<
    Record<string, { adultPt: number; childPt: number; admit: number }>
  >({});

  const regularLeaveOptions = useMemo(() => {
    const filtered = leaveTypes.filter(lt => lt !== 'ไปอบรม/ประชุม');
    return filtered.length > 0 ? filtered : ['ลาป่วย', 'ลากิจ', 'ลาพักผ่อน'];
  }, [leaveTypes]);

  useEffect(() => {
    if (regularLeaveOptions.length > 0 && !regularLeaveOptions.includes(leaveType)) {
      setLeaveType(regularLeaveOptions[0]);
    }
  }, [regularLeaveOptions, leaveType]);

  // Shift & Clinics logic (exclude group names so "★ ศูนย์ปัญญาภิรมย์" renders once at bottom)
  const isOutTime = shift !== 'ในเวลา 08:00-16:00';
  const availableClinics = useMemo(
    () =>
      (isOutTime ? outTimeClinics : inTimeClinics).filter(
        c => c !== PREMIUM_CLINIC_GROUP && c !== LEGACY_PREMIUM_CLINIC_GROUP
      ),
    [isOutTime, outTimeClinics, inTimeClinics]
  );
  const isEchoClinic = clinic === 'Echo';
  const isPremiumClinic = clinic === PREMIUM_CLINIC_GROUP;

  const existingPremiumPool = useMemo(() => {
    return (
      workloads.find(
        w =>
          w.date === date &&
          w.shift === shift &&
          (w.recordType === 'PREMIUM_POOL' || isPremiumPoolClinicName(w.clinic))
      ) || null
    );
  }, [workloads, date, shift]);

  const existingPremiumSubClinics = useMemo(() => {
    return new Set(
      workloads
        .filter(
          w =>
            w.date === date &&
            w.shift === shift &&
            (w.recordType === 'PREMIUM_SUB' ||
              ((isPremiumGroupName(w.clinicGroup) || /-Premium$/i.test(w.clinic)) &&
                !isPremiumPoolClinicName(w.clinic)))
        )
        .map(w => w.clinic)
    );
  }, [workloads, date, shift]);

  const premiumSummary = useMemo(() => {
    let activeCount = 0;
    let adultSum = 0;
    let childSum = 0;
    let admitSum = 0;
    premiumSubClinics.forEach(sub => {
      const item = premiumInputs[sub];
      if (!item) return;
      const a = Number(item.adultPt) || 0;
      const c = Number(item.childPt) || 0;
      const adm = Number(item.admit) || 0;
      if (a + c > 0 || adm > 0) {
        activeCount += 1;
        adultSum += a;
        childSum += c;
        admitSum += adm;
      }
    });
    return {
      activeCount,
      adultSum,
      childSum,
      totalSum: adultSum + childSum,
      admitSum,
    };
  }, [premiumSubClinics, premiumInputs]);

  const updatePremiumSubInput = (
    subClinic: string,
    field: 'adultPt' | 'childPt' | 'admit',
    value: number
  ) => {
    const cleanVal = Math.max(0, Number(value) || 0);
    setPremiumInputs(prev => ({
      ...prev,
      [subClinic]: {
        adultPt: prev[subClinic]?.adultPt || 0,
        childPt: prev[subClinic]?.childPt || 0,
        admit: prev[subClinic]?.admit || 0,
        [field]: cleanVal,
      },
    }));
  };

  useEffect(() => {
    if (
      clinic !== PREMIUM_CLINIC_GROUP &&
      availableClinics.length > 0 &&
      !availableClinics.includes(clinic)
    ) {
      setClinic(availableClinics[0]);
    }
  }, [availableClinics, clinic]);

  // Handle shift change
  const handleShiftChange = (newShift: WorkShift) => {
    setShift(newShift);
    const newClinics = (newShift !== 'ในเวลา 08:00-16:00' ? outTimeClinics : inTimeClinics).filter(
      c => c !== PREMIUM_CLINIC_GROUP && c !== LEGACY_PREMIUM_CLINIC_GROUP
    );
    if (clinic !== PREMIUM_CLINIC_GROUP && newClinics.length > 0 && !newClinics.includes(clinic)) {
      setClinic(newClinics[0]);
    }
  };

  // Adjust patient counts so adult + child always sum into totalPt
  const handleTotalPtChange = (val: number) => {
    const v = Math.max(0, val);
    setTotalPt(v);
    if (!isEchoClinic) {
      setAdultPt(Math.max(0, v - childPt));
    }
  };

  const handleAdultPtChange = (val: number) => {
    const v = Math.max(0, val);
    setAdultPt(v);
    setTotalPt(v + childPt);
  };

  const handleChildPtChange = (val: number) => {
    const v = Math.max(0, val);
    setChildPt(v);
    setTotalPt(adultPt + v);
  };

  // Filter & sort staff by position rank (1→6) and startDate
  const clinicStaff = useMemo(
    () =>
      staffList
        .filter(
          s =>
            s.status === 'Active' &&
            (isPremiumClinic
              ? s.homeClinic === PREMIUM_CLINIC_GROUP || s.homeClinic === LEGACY_PREMIUM_CLINIC_GROUP
              : s.homeClinic === clinic)
        )
        .sort(compareStaffByPositionAndStartDate),
    [staffList, clinic, isPremiumClinic]
  );
  const activeStaffAll = useMemo(
    () =>
      staffList
        .filter(s => s.status === 'Active')
        .sort(compareStaffByPositionAndStartDate),
    [staffList]
  );

  const adjustStaff = (setter: React.Dispatch<React.SetStateAction<number>>, delta: number) => {
    setter(prev => Math.max(0, Math.round((prev + delta) * 10) / 10));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!reporter.trim()) {
      setFormError('กรุณาระบุชื่อผู้รายงานก่อนบันทึก');
      return;
    }

    let leaveData = null;
    if (hasStaffLeave && selectedLeaveStaffIds.length > 0) {
      leaveData = selectedLeaveStaffIds.map(staffId => {
        const staff = staffList.find(s => s.staffId === staffId);
        return {
          staffName: staff?.name || staffId,
          leaveType,
          note: leaveNote || `บันทึกอัตโนมัติจากห้องตรวจ ${clinic}`,
        };
      });
    }

    let trainingData = null;
    if (hasTraining && selectedTrainingStaffIds.length > 0) {
      trainingData = selectedTrainingStaffIds.map(staffId => {
        const staff = staffList.find(s => s.staffId === staffId);
        return {
          staffName: staff?.name || staffId,
          topic: trainingTopic.trim() || 'ไปอบรม/ประชุม',
          note: trainingNote.trim(),
        };
      });
    }

    let crossCoverageData = null;
    if (hasCrossCover && crossStaffName && crossTargetClinic) {
      crossCoverageData = {
        staffName: crossStaffName,
        targetClinic: crossTargetClinic,
      };
    }

    if (isPremiumClinic) {
      const activeSubs = premiumSubClinics
        .map(sub => {
          const item = premiumInputs[sub];
          const adult = Number(item?.adultPt || 0);
          const child = Number(item?.childPt || 0);
          const adm = Number(item?.admit || 0);
          return { sub, adult, child, total: adult + child, admit: adm };
        })
        .filter(item => item.total > 0 || item.admit > 0);

      if (activeSubs.length === 0) {
        setFormError(
          existingPremiumPool
            ? 'พบกำลังคนรวมในกะนี้แล้ว กรุณากรอกยอดผู้ป่วยหรือ Admit อย่างน้อย 1 แผนกย่อยในตาราง'
            : 'กรุณากรอกยอดผู้ป่วยหรือ Admit อย่างน้อย 1 แผนกย่อยในตารางศูนย์ปัญญาภิรมย์'
        );
        return;
      }

      const nowMs = Date.now();
      const nowIso = new Date().toISOString();
      const poolId = existingPremiumPool?.poolId || `POOL-${date}-${nowMs}`;
      const recordsToSave: DailyWorkload[] = [];

      if (!existingPremiumPool) {
        recordsToSave.push({
          id: `WL-POOL-${nowMs}`,
          date,
          shift,
          clinic: PREMIUM_POOL_CLINIC_NAME,
          totalPt: 0,
          adultPt: 0,
          childPt: 0,
          admit: 0,
          hn: Number(hn) || 0,
          rn: Number(rn) || 0,
          pn: Number(pn) || 0,
          na: Number(na) || 0,
          pca: Number(na) || 0,
          clerk: Number(clerk) || 0,
          serviceWorker: Number(serviceWorker) || 0,
          note: note.trim(),
          reporter: reporter.trim(),
          clinicGroup: PREMIUM_CLINIC_GROUP,
          poolId,
          recordType: 'PREMIUM_POOL',
          timestamp: nowIso,
        });
      }

      activeSubs.forEach((subItem, idx) => {
        recordsToSave.push({
          id: `WL-SUB-${nowMs}-${idx}`,
          date,
          shift,
          clinic: subItem.sub,
          totalPt: subItem.total,
          adultPt: subItem.adult,
          childPt: subItem.child,
          admit: subItem.admit,
          hn: 0,
          rn: 0,
          pn: 0,
          na: 0,
          pca: 0,
          clerk: 0,
          serviceWorker: 0,
          note: note.trim(),
          reporter: reporter.trim(),
          clinicGroup: PREMIUM_CLINIC_GROUP,
          poolId,
          recordType: 'PREMIUM_SUB',
          timestamp: nowIso,
        });
      });

      if (onSaveBatchWorkloads) {
        onSaveBatchWorkloads(recordsToSave, leaveData, crossCoverageData, trainingData);
      } else {
        recordsToSave.forEach((rec, idx) => {
          onSaveWorkload(
            rec,
            idx === 0 ? leaveData : null,
            idx === 0 ? crossCoverageData : null,
            idx === 0 ? trainingData : null
          );
        });
      }

      setPremiumInputs({});
      setNote('');
      setHasStaffLeave(false);
      setSelectedLeaveStaffIds([]);
      setLeaveSearch('');
      setLeaveNote('');
      setHasTraining(false);
      setSelectedTrainingStaffIds([]);
      setTrainingSearch('');
      setTrainingTopic('');
      setTrainingNote('');
      setHasCrossCover(false);
      setCrossStaffSearch('');
      setCrossStaffName('');
      setCrossTargetClinic('');
      return;
    }

    const finalTotal = Math.max(Number(totalPt) || 0, (Number(adultPt) || 0) + (Number(childPt) || 0));
    const calculatedChild = Number(childPt) || 0;
    const calculatedAdult = isEchoClinic ? (Number(adultPt) || 0) : Math.max(0, finalTotal - calculatedChild);

    const newEntry: DailyWorkload = {
      id: `WL-${Date.now()}`,
      date,
      shift,
      clinic,
      totalPt: finalTotal,
      adultPt: calculatedAdult,
      childPt: calculatedChild,
      admit: Number(admit) || 0,
      hn: Number(hn) || 0,
      rn: Number(rn) || 0,
      pn: Number(pn) || 0,
      na: Number(na) || 0,
      pca: Number(na) || 0,
      clerk: Number(clerk) || 0,
      serviceWorker: Number(serviceWorker) || 0,
      note,
      reporter,
      clinicGroup: '',
      poolId: '',
      recordType: 'STANDARD',
      timestamp: new Date().toISOString(),
    };

    onSaveWorkload(newEntry, leaveData, crossCoverageData, trainingData);

    // Reset sensitive fields
    setTotalPt(0);
    setAdultPt(0);
    setChildPt(0);
    setAdmit(0);
    setNote('');
    setHasStaffLeave(false);
    setSelectedLeaveStaffIds([]);
    setLeaveSearch('');
    setLeaveNote('');
    setHasTraining(false);
    setSelectedTrainingStaffIds([]);
    setTrainingSearch('');
    setTrainingTopic('');
    setTrainingNote('');
    setHasCrossCover(false);
    setCrossStaffSearch('');
    setCrossStaffName('');
    setCrossTargetClinic('');
  };

  // Filter workloads for selected date
  const todayWorkloads = workloads.filter(w => w.date === date);

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50 border border-emerald-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <ClipboardPen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-emerald-950">
              เมนูที่ 1: บันทึกภาระงานประจำวัน (Daily Clinic Workload Entry)
            </h2>
            <p className="text-xs text-emerald-800">
              บันทึกสถิติผู้ป่วย, Admit, และกำลังคนปฏิบัติงานจริง (รองรับ 0.5 แรง) พร้อมซิงค์ชีทอัตโนมัติ
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 bg-white/80 px-3 py-1.5 rounded-lg border border-emerald-200">
          <Calendar className="w-4 h-4 text-emerald-600" />
          <span>วันที่เลือก: {formatThaiShortDate(date)}</span>
          <span className="text-emerald-400">|</span>
          <span className="text-emerald-700 font-bold">{todayWorkloads.length} รายการ</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Form: 7 cols */}
        <div className="lg:col-span-7">
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 sm:p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                ข้อมูลห้องตรวจและกะเวลา
              </h3>
              <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
                {isOutTime ? `กะนอกเวลา (${availableClinics.length} ห้อง)` : `กะในเวลา (${availableClinics.length} ห้อง)`}
              </span>
            </div>

            {/* Row 1: Date (พ.ศ.), Shift, Clinic */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-gray-400" />
                  วันที่ปฏิบัติงาน <span className="text-red-500">*</span>
                </label>
                <ThaiDateInput
                  value={date}
                  onChange={setDate}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-gray-400" />
                  กะเวลา <span className="text-red-500">*</span>
                </label>
                <select
                  value={shift}
                  onChange={(e) => handleShiftChange(e.target.value as WorkShift)}
                  required
                  className="w-full text-sm rounded-lg border-gray-300 shadow-2xs focus:border-emerald-500 focus:ring-emerald-500 py-2 px-3 border bg-white"
                >
                  <option value="ในเวลา 08:00-16:00">ในเวลา 08:00-16:00</option>
                  <option value="นอกเวลาเย็น 16:00-20:00">นอกเวลาเย็น 16:00-20:00</option>
                  <option value="นอกเวลาวันหยุด 08:00-12:00">นอกเวลาวันหยุด 08:00-12:00</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1 flex items-center gap-1">
                  <Building className="w-3.5 h-3.5 text-gray-400" />
                  ห้องตรวจ / แผนก <span className="text-red-500">*</span>
                </label>
                <select
                  value={clinic}
                  onChange={(e) => {
                    setClinic(e.target.value);
                    setFormError('');
                  }}
                  required
                  className={`w-full text-sm rounded-lg shadow-2xs py-2 px-3 border bg-white font-medium ${
                    isPremiumClinic
                      ? 'border-orange-400 text-orange-950 focus:border-orange-500 focus:ring-orange-500'
                      : 'border-gray-300 text-emerald-950 focus:border-emerald-500 focus:ring-emerald-500'
                  }`}
                >
                  {availableClinics.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  <option value={PREMIUM_CLINIC_GROUP}>
                    ★ {PREMIUM_CLINIC_GROUP} (กำลังคนรวมหลายแผนก)
                  </option>
                </select>
              </div>
            </div>

            {isPremiumClinic ? (
              <div className="space-y-4">
                {/* Premium Header Banner */}
                <div className="bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50 border border-orange-300/80 rounded-xl p-3.5 flex items-start gap-2.5">
                  <Sparkles className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-orange-950 space-y-0.5">
                    <div className="font-bold">
                      โหมดศูนย์ปัญญาภิรมย์ (Pooled Staffing Model — 1 ชุดกำลังคนรวมหลายแผนก)
                    </div>
                    <p className="text-[11px] text-orange-900/85">
                      บันทึกกำลังคนปฏิบัติงานรวม 1 ชุดต่อกะ และกรอกยอดผู้ป่วยแยกเฉพาะแผนกที่มีแพทย์ออกตรวจจริง เพื่อไม่ให้นับจำนวนเจ้าหน้าที่ซ้ำซ้อน
                    </p>
                  </div>
                </div>

                {/* Part 1: Pooled Staffing */}
                <div className={`border rounded-xl p-4 space-y-3 ${
                  existingPremiumPool
                    ? 'border-amber-300 bg-amber-50/40'
                    : 'border-orange-200 bg-orange-50/40'
                }`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-orange-950 flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-orange-600" />
                      <span>ส่วนที่ 1: กำลังคนรวมทั้งศูนย์ปัญญาภิรมย์ (1 ชุดต่อกะ)</span>
                    </h4>
                    <span className="text-[11px] font-semibold text-orange-900 bg-white px-2.5 py-0.5 rounded-full border border-orange-200">
                      กำลังคนพยาบาล (RN+PN+NA):{' '}
                      {(existingPremiumPool
                        ? (existingPremiumPool.rn || 0) +
                          (existingPremiumPool.pn || 0) +
                          (existingPremiumPool.na ?? existingPremiumPool.pca ?? 0)
                        : rn + pn + na
                      ).toFixed(1)}{' '}
                      แรง
                    </span>
                  </div>

                  {existingPremiumPool && (
                    <div className="bg-amber-100/80 border border-amber-300 rounded-lg p-2.5 flex items-start gap-2 text-xs text-amber-950">
                      <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">พบการบันทึกกำลังคนรวมในวันที่และกะเวลานี้แล้ว:</span>{' '}
                        ระบบล็อกช่องกรอกกำลังคนเพื่อป้องกันการคูณซ้ำ (รายงานโดย {existingPremiumPool.reporter}) คุณสามารถกรอกเพิ่มเฉพาะยอดผู้ป่วยแผนกย่อยในส่วนที่ 2 ได้เลย
                      </div>
                    </div>
                  )}

                  {(() => {
                    const dispHn = existingPremiumPool ? existingPremiumPool.hn : hn;
                    const dispRn = existingPremiumPool ? existingPremiumPool.rn : rn;
                    const dispPn = existingPremiumPool ? existingPremiumPool.pn : pn;
                    const dispNa = existingPremiumPool
                      ? (existingPremiumPool.na ?? existingPremiumPool.pca ?? 0)
                      : na;
                    const dispClerk = existingPremiumPool ? existingPremiumPool.clerk : clerk;
                    const dispSw = existingPremiumPool ? existingPremiumPool.serviceWorker : serviceWorker;
                    const isLocked = Boolean(existingPremiumPool);

                    const cards = [
                      { label: 'HN (หัวหน้าเวร)', val: dispHn, setter: setHn, border: 'border-gray-200', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-900' },
                      { label: 'RN (พยาบาลวิชาชีพ)', val: dispRn, setter: setRn, border: 'border-blue-200', text: 'text-blue-700', badge: 'bg-blue-50 text-blue-800' },
                      { label: 'PN (ผู้ช่วยพยาบาล)', val: dispPn, setter: setPn, border: 'border-teal-200', text: 'text-teal-700', badge: 'bg-teal-50 text-teal-800' },
                      { label: 'NA (ผู้ช่วยคนไข้)', val: dispNa, setter: setNa, border: 'border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-50 text-emerald-800' },
                      { label: 'ผู้ปฏิบัติงานทั่วไป', val: dispClerk, setter: setClerk, border: 'border-gray-200', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-900' },
                      { label: 'พนักงานบริการ', val: dispSw, setter: setServiceWorker, border: 'border-gray-200', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-900' },
                    ];

                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {cards.map((c) => (
                          <div
                            key={c.label}
                            className={`p-2.5 rounded-lg border shadow-2xs ${
                              isLocked ? 'bg-gray-100/80 border-gray-200 opacity-80' : `bg-white ${c.border}`
                            }`}
                          >
                            <div className="flex justify-between items-center mb-1">
                              <span className={`text-xs font-bold ${c.text}`}>{c.label}</span>
                              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${c.badge}`}>
                                {Number(c.val || 0).toFixed(1)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={() => adjustStaff(c.setter, -0.5)}
                                className="p-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 cursor-pointer"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                disabled={isLocked}
                                value={c.val}
                                onChange={(e) => c.setter(Math.max(0, Number(e.target.value) || 0))}
                                className="w-full text-center text-xs font-bold py-1 border rounded border-gray-200 disabled:bg-gray-100"
                              />
                              <button
                                type="button"
                                disabled={isLocked}
                                onClick={() => adjustStaff(c.setter, 0.5)}
                                className="p-1 rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Part 2: Sub-Department Patient Counts Table */}
                <div className="bg-white border border-orange-200/90 rounded-xl p-4 space-y-3 shadow-2xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-orange-100 pb-2.5">
                    <div>
                      <h4 className="text-xs font-bold text-orange-950 flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-orange-600" />
                        <span>ส่วนที่ 2: ตารางกรอกยอดผู้ป่วยแยกตามแผนกแพทย์ ({premiumSubClinics.length} แผนก)</span>
                      </h4>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        กรอกเฉพาะแผนกที่มีแพทย์ออกตรวจจริงในกะนี้ (ระบบจะบันทึกเฉพาะแผนกที่มียอดผู้ป่วย &gt; 0 หรือ Admit &gt; 0)
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span className="px-2 py-0.5 rounded-full bg-orange-100 text-orange-900 font-bold border border-orange-200">
                        เปิดตรวจ: {premiumSummary.activeCount} แผนก
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-900 font-bold border border-blue-200">
                        รวม: {premiumSummary.totalSum} ราย
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-bold border border-red-200">
                        Admit: {premiumSummary.admitSum}
                      </span>
                      {premiumSummary.activeCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setPremiumInputs({})}
                          className="px-2 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold cursor-pointer"
                        >
                          ล้างค่า
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="overflow-x-auto border border-orange-100 rounded-xl">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-orange-50/90 text-orange-950 font-bold border-b border-orange-200">
                        <tr>
                          <th className="py-2 px-2.5 text-center w-10">ที่</th>
                          <th className="py-2 px-3">แผนกย่อย (ศูนย์ปัญญาภิรมย์)</th>
                          <th className="py-2 px-2 text-center w-24">ผู้ใหญ่</th>
                          <th className="py-2 px-2 text-center w-24">เด็ก</th>
                          <th className="py-2 px-2 text-center w-24 text-red-700">Admit</th>
                          <th className="py-2 px-2.5 text-right w-20 bg-orange-100/60">รวม</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-orange-100/80">
                        {premiumSubClinics.map((sub, idx) => {
                          const rowVal = premiumInputs[sub] || { adultPt: 0, childPt: 0, admit: 0 };
                          const rowTotal = rowVal.adultPt + rowVal.childPt;
                          const isRowActive = rowTotal > 0 || rowVal.admit > 0;
                          const alreadySaved = existingPremiumSubClinics.has(sub);
                          return (
                            <tr
                              key={sub}
                              className={isRowActive ? 'bg-orange-50/70' : 'hover:bg-slate-50/70'}
                            >
                              <td className="py-1.5 px-2.5 text-center text-gray-500 font-medium">
                                {idx + 1}
                              </td>
                              <td className="py-1.5 px-3">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`font-semibold ${isRowActive ? 'text-orange-950' : 'text-gray-800'}`}>
                                    {sub}
                                  </span>
                                  {alreadySaved && (
                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                                      บันทึกแล้วในกะนี้
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  value={rowVal.adultPt || ''}
                                  onChange={(e) =>
                                    updatePremiumSubInput(sub, 'adultPt', Number(e.target.value) || 0)
                                  }
                                  className="w-full text-center text-xs font-semibold rounded-lg border border-gray-300 focus:border-orange-500 focus:ring-orange-500 py-1 px-1.5 bg-white"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  value={rowVal.childPt || ''}
                                  onChange={(e) =>
                                    updatePremiumSubInput(sub, 'childPt', Number(e.target.value) || 0)
                                  }
                                  className="w-full text-center text-xs font-semibold rounded-lg border border-gray-300 focus:border-orange-500 focus:ring-orange-500 py-1 px-1.5 bg-white"
                                />
                              </td>
                              <td className="py-1.5 px-2">
                                <input
                                  type="number"
                                  min="0"
                                  placeholder="0"
                                  value={rowVal.admit || ''}
                                  onChange={(e) =>
                                    updatePremiumSubInput(sub, 'admit', Number(e.target.value) || 0)
                                  }
                                  className="w-full text-center text-xs font-bold rounded-lg border border-red-200 bg-red-50/30 text-red-700 focus:border-red-400 py-1 px-1.5"
                                />
                              </td>
                              <td className="py-1.5 px-2.5 text-right font-extrabold text-orange-950 bg-orange-50/40">
                                {rowTotal}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-orange-100/70 text-orange-950 font-extrabold border-t border-orange-200">
                        <tr>
                          <td colSpan={2} className="py-2 px-3">
                            สรุปรวมศูนย์ปัญญาภิรมย์ ({premiumSummary.activeCount} แผนกที่เปิดตรวจ)
                          </td>
                          <td className="py-2 px-2 text-center">{premiumSummary.adultSum.toLocaleString()}</td>
                          <td className="py-2 px-2 text-center">{premiumSummary.childSum.toLocaleString()}</td>
                          <td className="py-2 px-2 text-center text-red-700">{premiumSummary.admitSum.toLocaleString()}</td>
                          <td className="py-2 px-2.5 text-right text-sm">{premiumSummary.totalSum.toLocaleString()}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <>
            {/* Echo Notice */}
            {isEchoClinic && (
              <div className="bg-amber-50 border border-amber-200/90 rounded-xl p-3 flex items-start gap-2.5">
                <Sparkles className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900">
                  <span className="font-bold">ระบบตรวจพบคลินิก Echo:</span> เปิดช่องแยกกรอกจำนวนผู้ใหญ่และเด็กพิเศษอัตโนมัติ โดยยอดรวมผู้ป่วยจะคำนวณจาก (ผู้ใหญ่ + เด็ก)
                </div>
              </div>
            )}

            {/* Row 2: Patient Counts & Admit */}
            <div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200/80 space-y-3">
              <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-emerald-600" />
                ภาระงานผู้ป่วย (Patients & Admissions)
              </h4>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    จำนวนผู้ป่วยทั้งหมด (คน) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={totalPt || ''}
                    onChange={(e) => handleTotalPtChange(Number(e.target.value) || 0)}
                    disabled={isEchoClinic}
                    placeholder="0"
                    className={`w-full text-base font-bold rounded-lg border py-2 px-3 shadow-2xs ${
                      isEchoClinic 
                        ? 'bg-amber-100/50 border-amber-300 text-amber-950' 
                        : 'border-slate-300 bg-white text-emerald-900 focus:border-emerald-500 focus:ring-emerald-500'
                    }`}
                  />
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    = ผู้ใหญ่ ({adultPt}) + เด็ก ({childPt})
                  </span>
                </div>

                <div>
                  <label className={`block text-xs font-semibold mb-1 ${isEchoClinic ? 'text-amber-800' : 'text-slate-700'}`}>
                    ผู้ป่วยผู้ใหญ่ (คน)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={adultPt || ''}
                    onChange={(e) => handleAdultPtChange(Number(e.target.value) || 0)}
                    placeholder="0"
                    className={`w-full text-sm font-semibold rounded-lg border py-2 px-3 shadow-2xs ${
                      isEchoClinic
                        ? 'border-amber-300 bg-white text-amber-900 focus:border-amber-500 focus:ring-amber-500'
                        : 'border-slate-300 bg-white text-slate-800'
                    }`}
                  />
                </div>

                <div>
                  <label className={`block text-xs font-semibold mb-1 ${isEchoClinic ? 'text-amber-800' : 'text-slate-700'}`}>
                    ผู้ป่วยเด็ก
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={childPt || ''}
                    onChange={(e) => handleChildPtChange(Number(e.target.value) || 0)}
                    placeholder="0"
                    className={`w-full text-sm font-semibold rounded-lg border py-2 px-3 shadow-2xs ${
                      isEchoClinic
                        ? 'border-amber-300 bg-white text-amber-900 focus:border-amber-500 focus:ring-amber-500'
                        : 'border-slate-300 bg-white text-slate-800'
                    }`}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-red-700 mb-1 flex items-center gap-1">
                    <Bed className="w-3.5 h-3.5 text-red-500" />
                    ยอดรับไว้รักษา (Admit)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={admit || ''}
                    onChange={(e) => setAdmit(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                    className="w-full text-base font-bold rounded-lg border border-red-200 bg-red-50/40 text-red-900 py-2 px-3 shadow-2xs focus:border-red-400 focus:ring-red-400"
                  />
                </div>
              </div>
            </div>

            {/* Row 3: Staff Counts with 0.5 Support */}
            <div className="border border-emerald-100 bg-emerald-50/30 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-emerald-600" />
                  จำนวนบุคลากรปฏิบัติงานจริง (รองรับ 0.5 แรง ช่วยข้ามห้องตรวจ)
                </h4>
                <span className="text-[11px] font-semibold text-emerald-800">
                  กำลังคนการพยาบาล (RN+PN+NA): {(rn + pn + na).toFixed(1)} แรง
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {/* HN */}
                <div className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-2xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-gray-700">HN (หัวหน้าเวร)</span>
                    <span className="text-xs font-bold text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">
                      {hn.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustStaff(setHn, -0.5)}
                      className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={hn}
                      onChange={(e) => setHn(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-center text-xs font-bold py-1 border rounded border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => adjustStaff(setHn, 0.5)}
                      className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* RN */}
                <div className="bg-white p-2.5 rounded-lg border border-blue-200 shadow-2xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-blue-700">RN (พยาบาลวิชาชีพ)</span>
                    <span className="text-xs font-bold text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded">
                      {rn.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustStaff(setRn, -0.5)}
                      className="p-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={rn}
                      onChange={(e) => setRn(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-center text-xs font-bold py-1 border rounded border-blue-200 text-blue-900"
                    />
                    <button
                      type="button"
                      onClick={() => adjustStaff(setRn, 0.5)}
                      className="p-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* PN */}
                <div className="bg-white p-2.5 rounded-lg border border-teal-200 shadow-2xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-teal-700">PN (ผู้ช่วยพยาบาล)</span>
                    <span className="text-xs font-bold text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded">
                      {pn.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustStaff(setPn, -0.5)}
                      className="p-1 rounded bg-teal-50 hover:bg-teal-100 text-teal-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={pn}
                      onChange={(e) => setPn(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-center text-xs font-bold py-1 border rounded border-teal-200 text-teal-900"
                    />
                    <button
                      type="button"
                      onClick={() => adjustStaff(setPn, 0.5)}
                      className="p-1 rounded bg-teal-50 hover:bg-teal-100 text-teal-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* NA */}
                <div className="bg-white p-2.5 rounded-lg border border-emerald-200 shadow-2xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-emerald-700">NA (ผู้ช่วยคนไข้)</span>
                    <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded">
                      {na.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustStaff(setNa, -0.5)}
                      className="p-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={na}
                      onChange={(e) => setNa(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-center text-xs font-bold py-1 border rounded border-emerald-200 text-emerald-900"
                    />
                    <button
                      type="button"
                      onClick={() => adjustStaff(setNa, 0.5)}
                      className="p-1 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Clerk -> ผู้ปฏิบัติงานทั่วไป */}
                <div className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-2xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-gray-700">ผู้ปฏิบัติงานทั่วไป</span>
                    <span className="text-xs font-bold text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">
                      {clerk.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustStaff(setClerk, -0.5)}
                      className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={clerk}
                      onChange={(e) => setClerk(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-center text-xs font-bold py-1 border rounded border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => adjustStaff(setClerk, 0.5)}
                      className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Service Worker -> พนักงานบริการ */}
                <div className="bg-white p-2.5 rounded-lg border border-gray-200 shadow-2xs">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-gray-700">พนักงานบริการ</span>
                    <span className="text-xs font-bold text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">
                      {serviceWorker.toFixed(1)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => adjustStaff(setServiceWorker, -0.5)}
                      className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={serviceWorker}
                      onChange={(e) => setServiceWorker(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-center text-xs font-bold py-1 border rounded border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={() => adjustStaff(setServiceWorker, 0.5)}
                      className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
              </>
            )}

            {/* Row 4: Redesigned Cohesive Section — Staff Leave, Training/Meeting, Cross-Coverage */}
            <div className="rounded-2xl border border-teal-200/80 bg-gradient-to-br from-emerald-50/50 via-teal-50/40 to-cyan-50/30 p-4 space-y-3.5 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-teal-950 block">
                      การเชื่อมโยงวันลา, ไปอบรม/ประชุม หรือช่วยงานห้องอื่นในวันนี้
                    </span>
                    <span className="text-[11px] text-teal-700/80">
                      เลือกได้มากกว่า 1 หัวข้อและระบุรายชื่อได้หลายคนพร้อมกัน
                    </span>
                  </div>
                </div>

                {/* Toggle Pill Buttons */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setHasStaffLeave(!hasStaffLeave)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      hasStaffLeave
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-amber-300 hover:bg-amber-50/50'
                    }`}
                  >
                    <CalendarOff className="w-3.5 h-3.5" />
                    <span>มีเจ้าหน้าที่ลา</span>
                    {selectedLeaveStaffIds.length > 0 && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${hasStaffLeave ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-800'}`}>
                        {selectedLeaveStaffIds.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setHasTraining(!hasTraining)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      hasTraining
                        ? 'bg-cyan-700 text-white border-cyan-700 shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-cyan-300 hover:bg-cyan-50/50'
                    }`}
                  >
                    <GraduationCap className="w-3.5 h-3.5" />
                    <span>ไปอบรม/ประชุม</span>
                    {selectedTrainingStaffIds.length > 0 && (
                      <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${hasTraining ? 'bg-white/25 text-white' : 'bg-cyan-100 text-cyan-800'}`}>
                        {selectedTrainingStaffIds.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setHasCrossCover(!hasCrossCover)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      hasCrossCover
                        ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-emerald-300 hover:bg-emerald-50/50'
                    }`}
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    <span>ไปช่วยห้องอื่น</span>
                  </button>
                </div>
              </div>

              {/* Block 1: Staff Leave (Multi-select + Type-to-search) */}
              {hasStaffLeave && (
                <div className="bg-white rounded-xl border border-amber-200/90 p-3.5 space-y-3 shadow-2xs text-xs">
                  <div className="flex items-center justify-between border-b border-amber-100 pb-2">
                    <span className="font-bold text-amber-950 flex items-center gap-1.5">
                      <CalendarOff className="w-4 h-4 text-amber-600" />
                      1. รายชื่อเจ้าหน้าที่ที่ลาวันนี้ (เลือกได้หลายคน)
                    </span>
                    <span className="text-[11px] font-semibold text-amber-700">
                      เลือกแล้ว {selectedLeaveStaffIds.length} คน
                    </span>
                  </div>

                  {/* Selected Chips */}
                  {selectedLeaveStaffIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedLeaveStaffIds.map(id => {
                        const s = staffList.find(st => st.staffId === id);
                        if (!s) return null;
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 font-semibold text-[11px]"
                          >
                            <span>{s.name} ({formatPositionLabel(s.position)})</span>
                            <button
                              type="button"
                              onClick={() => setSelectedLeaveStaffIds(prev => prev.filter(x => x !== id))}
                              className="text-amber-600 hover:text-red-600 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="พิมพ์ค้นหาชื่อ, ตำแหน่ง, หรือคลินิก..."
                      value={leaveSearch}
                      onChange={(e) => setLeaveSearch(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-slate-50/60 focus:bg-white pl-8 pr-8 py-1.5 text-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                    />
                    {leaveSearch && (
                      <button
                        type="button"
                        onClick={() => setLeaveSearch('')}
                        className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Clean Scrollable Picker */}
                  <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                    {activeStaffAll
                      .filter(s => {
                        const q = leaveSearch.toLowerCase().trim();
                        if (!q) return true;
                        return (
                          s.name.toLowerCase().includes(q) ||
                          s.position.toLowerCase().includes(q) ||
                          formatPositionLabel(s.position).toLowerCase().includes(q) ||
                          s.homeClinic.toLowerCase().includes(q)
                        );
                      })
                      .map(s => {
                        const checked = selectedLeaveStaffIds.includes(s.staffId);
                        return (
                          <div
                            key={s.staffId}
                            onClick={() => {
                              setSelectedLeaveStaffIds(prev =>
                                checked ? prev.filter(id => id !== s.staffId) : [...prev, s.staffId]
                              );
                            }}
                            className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all ${
                              checked
                                ? 'bg-amber-50/90 border-amber-300 text-amber-950 font-semibold'
                                : 'bg-white border-gray-100 hover:bg-slate-50 text-gray-700'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {checked ? (
                                <CheckSquare className="w-4 h-4 text-amber-600 shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-300 shrink-0" />
                              )}
                              <span>{s.name}</span>
                              <span className="text-[10px] text-gray-400">({s.homeClinic})</span>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                              {formatPositionLabel(s.position)}
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ประเภทการลา</label>
                      <select
                        value={leaveType}
                        onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                        className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs bg-white"
                      >
                        {regularLeaveOptions.map(lt => (
                          <option key={lt} value={lt}>{lt}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">หมายเหตุการลา</label>
                      <input
                        type="text"
                        value={leaveNote}
                        onChange={(e) => setLeaveNote(e.target.value)}
                        placeholder="เช่น มีไข้หวัด, กิจธุระส่วนตัว"
                        className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Block 2: Training / Meeting (Multi-select + Type-to-search) */}
              {hasTraining && (
                <div className="bg-white rounded-xl border border-cyan-200/90 p-3.5 space-y-3 shadow-2xs text-xs">
                  <div className="flex items-center justify-between border-b border-cyan-100 pb-2">
                    <span className="font-bold text-cyan-950 flex items-center gap-1.5">
                      <GraduationCap className="w-4 h-4 text-cyan-600" />
                      2. รายชื่อเจ้าหน้าที่ไปอบรม / ประชุม (เลือกได้หลายคน & พิมพ์ค้นหา)
                    </span>
                    <span className="text-[11px] font-semibold text-cyan-700">
                      เลือกแล้ว {selectedTrainingStaffIds.length} คน
                    </span>
                  </div>

                  {/* Selected Chips */}
                  {selectedTrainingStaffIds.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedTrainingStaffIds.map(id => {
                        const s = staffList.find(st => st.staffId === id);
                        if (!s) return null;
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-cyan-50 border border-cyan-200 text-cyan-900 font-semibold text-[11px]"
                          >
                            <span>{s.name} ({formatPositionLabel(s.position)})</span>
                            <button
                              type="button"
                              onClick={() => setSelectedTrainingStaffIds(prev => prev.filter(x => x !== id))}
                              className="text-cyan-600 hover:text-red-600 cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="พิมพ์ค้นหาชื่อเจ้าหน้าที่เพื่อเลือกไปอบรม/ประชุม..."
                      value={trainingSearch}
                      onChange={(e) => setTrainingSearch(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-slate-50/60 focus:bg-white pl-8 pr-8 py-1.5 text-xs outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                    />
                    {trainingSearch && (
                      <button
                        type="button"
                        onClick={() => setTrainingSearch('')}
                        className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Clean Scrollable Picker */}
                  <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                    {activeStaffAll
                      .filter(s => {
                        const q = trainingSearch.toLowerCase().trim();
                        if (!q) return true;
                        return (
                          s.name.toLowerCase().includes(q) ||
                          s.position.toLowerCase().includes(q) ||
                          formatPositionLabel(s.position).toLowerCase().includes(q) ||
                          s.homeClinic.toLowerCase().includes(q)
                        );
                      })
                      .map(s => {
                        const checked = selectedTrainingStaffIds.includes(s.staffId);
                        return (
                          <div
                            key={s.staffId}
                            onClick={() => {
                              setSelectedTrainingStaffIds(prev =>
                                checked ? prev.filter(id => id !== s.staffId) : [...prev, s.staffId]
                              );
                            }}
                            className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-all ${
                              checked
                                ? 'bg-cyan-50/90 border-cyan-300 text-cyan-950 font-semibold'
                                : 'bg-white border-gray-100 hover:bg-slate-50 text-gray-700'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {checked ? (
                                <CheckSquare className="w-4 h-4 text-cyan-600 shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-300 shrink-0" />
                              )}
                              <span>{s.name}</span>
                              <span className="text-[10px] text-gray-400">({s.homeClinic})</span>
                            </div>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                              {formatPositionLabel(s.position)}
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">หัวข้อการอบรม / ประชุม</label>
                      <input
                        type="text"
                        value={trainingTopic}
                        onChange={(e) => setTrainingTopic(e.target.value)}
                        placeholder="เช่น ประชุม HA, อบรม CPR ประจำปี"
                        className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">สถานที่ / หมายเหตุ</label>
                      <input
                        type="text"
                        value={trainingNote}
                        onChange={(e) => setTrainingNote(e.target.value)}
                        placeholder="เช่น ห้องประชุมชั้น 4, เต็มวัน"
                        className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Block 3: Cross-Coverage input block */}
              {hasCrossCover && (
                <div className="bg-white rounded-xl border border-emerald-200/90 p-3.5 space-y-2.5 shadow-2xs text-xs">
                  <div className="font-bold text-emerald-950 flex items-center gap-1.5 border-b border-emerald-100 pb-2">
                    <ArrowRightLeft className="w-4 h-4 text-emerald-600" />
                    <span>3. เจ้าหน้าที่ไปช่วยปฏิบัติงานห้องตรวจอื่น</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="block font-semibold text-gray-700">เจ้าหน้าที่ไปช่วยงาน</label>
                      <div className="relative">
                        <Search className="w-3 h-3 text-gray-400 absolute left-2.5 top-2" />
                        <input
                          type="text"
                          value={crossStaffSearch}
                          onChange={(e) => setCrossStaffSearch(e.target.value)}
                          placeholder="พิมพ์กรองชื่อเจ้าหน้าที่..."
                          className="w-full rounded-lg border border-gray-200 bg-slate-50/70 pl-7 pr-2 py-1 text-[11px]"
                        />
                      </div>
                      <select
                        value={crossStaffName}
                        onChange={(e) => setCrossStaffName(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs bg-white"
                      >
                        <option value="">-- เลือกเจ้าหน้าที่ --</option>
                        {(clinicStaff.length > 0 && !crossStaffSearch.trim() ? clinicStaff : activeStaffAll)
                          .filter(s => {
                            const q = crossStaffSearch.toLowerCase().trim();
                            return !q || s.name.toLowerCase().includes(q) || s.homeClinic.toLowerCase().includes(q);
                          })
                          .map(s => (
                            <option key={s.staffId} value={s.name}>
                              {s.name} ({formatPositionLabel(s.position)} - {s.homeClinic})
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-gray-700 mb-1">ห้องตรวจที่ไปปฏิบัติงาน</label>
                      <select
                        value={crossTargetClinic}
                        onChange={(e) => setCrossTargetClinic(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 py-1.5 px-2.5 text-xs bg-white mt-7"
                      >
                        <option value="">-- เลือกห้องตรวจเป้าหมาย --</option>
                        {availableClinics.filter(c => c !== clinic).map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Row 5: Notes & Reporter */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  หมายเหตุ / กิจกรรมพิเศษ
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="เช่น ทำหัตถการพิเศษ, ผู้ป่วยส่งต่อฉุกเฉิน"
                  className="w-full text-xs rounded-lg border-gray-300 shadow-2xs py-2 px-3 border"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  ผู้บันทึกรายงาน <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={reporter}
                  onChange={(e) => {
                    setReporter(e.target.value);
                    if (formError) setFormError('');
                  }}
                  placeholder="ระบุชื่อ-สกุล และตำแหน่ง"
                  required
                  className="w-full text-xs rounded-lg border-gray-300 shadow-2xs py-2 px-3 border font-medium"
                />
              </div>
            </div>

            {formError && (
              <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 font-medium">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Submit Button */}
            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                className={`inline-flex items-center gap-2 px-6 py-2.5 text-white font-semibold text-sm rounded-xl shadow-md transition-all cursor-pointer hover:shadow-lg ${
                  isPremiumClinic
                    ? 'bg-orange-600 hover:bg-orange-500 active:bg-orange-700'
                    : 'bg-emerald-700 hover:bg-emerald-600 active:bg-emerald-800'
                }`}
              >
                <FileCheck2 className="w-4 h-4" />
                <span>
                  {isPremiumClinic
                    ? 'บันทึกข้อมูลศูนย์ปัญญาภิรมย์ (กำลังคน + ยอดผู้ป่วย)'
                    : 'บันทึกภาระงานห้องตรวจนี้'}
                </span>
              </button>
            </div>
          </form>
        </div>

        {/* Right Info & Today's Records: 5 cols */}
        <div className="lg:col-span-5 space-y-4">
          {/* Quick Summary Card */}
          <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-4">
            <h3 className="text-xs font-bold text-gray-800 mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                รายการที่บันทึกแล้วในวันที่ {formatThaiShortDate(date)}
              </span>
              <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded text-[11px]">
                {todayWorkloads.length} รายการ
              </span>
            </h3>

            {todayWorkloads.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-xs">
                ยังไม่มีข้อมูลการบันทึกภาระงานในวันที่เลือก
              </div>
            ) : (
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {todayWorkloads.map((item) => {
                  const isPoolRow =
                    item.recordType === 'PREMIUM_POOL' || isPremiumPoolClinicName(item.clinic);
                  const isSubRow =
                    item.recordType === 'PREMIUM_SUB' ||
                    (!isPoolRow && isPremiumGroupName(item.clinicGroup));
                  return (
                  <div
                    key={item.id}
                    className={`p-3 rounded-xl border transition-all text-xs ${
                      isPoolRow
                        ? 'border-orange-300 bg-orange-50/70'
                        : isSubRow
                        ? 'border-orange-200/80 bg-orange-50/30'
                        : 'border-gray-100 hover:border-emerald-200 bg-slate-50/70 hover:bg-emerald-50/20'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-gray-900 text-sm">
                            {isPoolRow ? PREMIUM_POOL_CLINIC_NAME : item.clinic}
                          </span>
                          {isPoolRow && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-orange-600 text-white font-bold">
                              กำลังคนรวม
                            </span>
                          )}
                          {isSubRow && (
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-orange-100 text-orange-800 border border-orange-200 font-semibold">
                              ศูนย์ปัญญาภิรมย์
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500">{item.shift}</div>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1">
                          {onUpdateWorkload && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingWorkload({ ...item, totalPt: getEffectiveTotalPt(item) });
                                setEditWorkloadReason('');
                                setEditWorkloadReasonError('');
                                setEditModalError('');
                              }}
                              className="text-gray-400 hover:text-blue-600 p-1 rounded transition-colors cursor-pointer"
                              title="แก้ไขรายการนี้ (ผู้ดูแลระบบ Admin)"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingWorkload(item);
                              setDeleteWorkloadReason('');
                              setDeleteWorkloadReasonError('');
                            }}
                            className="text-gray-400 hover:text-red-500 p-1 rounded transition-colors cursor-pointer"
                            title="ลบรายการนี้ (เฉพาะผู้ดูแลระบบ Admin)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 text-center my-2">
                      <div className="bg-white p-1.5 rounded border border-gray-200">
                        <span className="block text-[10px] text-gray-500">ผู้ป่วย</span>
                        <span className="font-bold text-emerald-800 text-sm">
                          {isPoolRow ? '-' : getEffectiveTotalPt(item)}
                        </span>
                      </div>
                      <div className="bg-white p-1.5 rounded border border-gray-200">
                        <span className="block text-[10px] text-gray-500">Admit</span>
                        <span className="font-bold text-red-600 text-sm">
                          {isPoolRow ? '-' : item.admit}
                        </span>
                      </div>
                      <div className="bg-white p-1.5 rounded border border-gray-200">
                        <span className="block text-[10px] text-gray-500">RN+PN+NA</span>
                        <span className="font-bold text-blue-800 text-sm">
                          {isSubRow
                            ? 'ร่วม'
                            : (item.rn + item.pn + (item.na ?? item.pca ?? 0)).toFixed(1)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-gray-500 border-t border-gray-200/60 pt-1.5">
                      <span>ผู้รายงาน: {item.reporter}</span>
                      {item.note && <span className="text-gray-600 truncate max-w-[120px]" title={item.note}>{item.note}</span>}
                    </div>
                    {(item.lastEditReason || item.lastEditedAt) && (
                      <div className="mt-1.5 text-[10px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-md px-2 py-1">
                        <span className="font-semibold">แก้ไขล่าสุด:</span> {item.lastEditReason || '-'}
                        {item.lastEditedAt && (
                          <span className="text-amber-700 ml-1">• {formatThaiDateTime(item.lastEditedAt)}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
                })}
              </div>
            )}

            {todayWorkloads.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-gray-100">
                {isAdmin ? (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg py-1 px-2 text-center flex items-center justify-center gap-1.5 text-[11px] text-emerald-800 font-medium">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                    <span>โหมด Admin: แสดงปุ่มถังขยะสำหรับลบรายการบันทึกแล้ว</span>
                  </div>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg py-1.5 px-2 text-center flex items-center justify-between text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Lock className="w-3 h-3 text-slate-400" />
                      รูปถังขยะอนุญาตให้เห็นเฉพาะ Admin
                    </span>
                    {onPromptAdminUnlock && (
                      <button
                        type="button"
                        onClick={onPromptAdminUnlock}
                        className="text-emerald-700 font-bold hover:underline cursor-pointer"
                      >
                        ปลดล็อกด้วยรหัสผ่าน
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Clinical Informatics Reference Card */}
          <div className="bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-2xl p-4 shadow-sm text-xs space-y-2.5">
            <div className="flex items-center gap-2 text-emerald-400 font-bold">
              <HelpCircle className="w-4 h-4" />
              <span>หลักการคำนวณกำลังคนทางการพยาบาล OPD</span>
            </div>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              • <strong>อัตรากำลังปฏิบัติงาน (Input):</strong> นับรวมเฉพาะผู้ปฏิบัติงานทางการพยาบาล ได้แก่ <strong>RN + PN + NA</strong> โดยไม่รวม HN ตามเกณฑ์จำแนกภาระงาน
            </p>
            <p className="text-slate-300 text-[11px] leading-relaxed">
              • <strong>การเกลี่ยอัตรากำลัง 0.5:</strong> สำหรับเจ้าหน้าที่ที่หมุนเวียนปฏิบัติงานครึ่งวัน หรือช่วยงานข้ามแผนกในชั่วโมงเร่งด่วน
            </p>
          </div>
        </div>
      </div>

      {/* Admin Edit Workload Modal */}
      {editingWorkload && onUpdateWorkload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-gray-900">
                  แก้ไขข้อมูลภาระงานห้องตรวจ (เฉพาะ Admin)
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
              {/* Row 1: Date (พ.ศ.), Clinic, Shift */}
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

              {/* Row 2: Patient counts & Admit */}
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

              {/* Row 3: Staffing (HN, RN, PN, NA, Clerk, Service Worker) */}
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

              {/* Row 4: Reporter & Note */}
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
                    editWorkloadReasonError ? 'border-red-400 focus:ring-red-400' : 'border-amber-300'
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

            {/* Modal Actions */}
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
                  if (!editingWorkload.reporter.trim()) {
                    setEditModalError('กรุณาระบุชื่อผู้บันทึกรายงาน');
                    return;
                  }
                  if (!editWorkloadReason.trim()) {
                    setEditWorkloadReasonError('กรุณาระบุเหตุผลการแก้ไขรายการก่อนบันทึก');
                    return;
                  }
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
      {deletingWorkload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
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
