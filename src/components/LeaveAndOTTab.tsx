import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  StaffMember,
  StaffPosition,
  LeaveRecord,
  OTAttendance,
  DailyWorkload,
  LeaveType,
  LEAVE_TYPES,
  WorkShift,
  OT_SHIFTS,
  OUT_TIME_CLINICS,
  IN_TIME_CLINICS,
  ALL_POSITIONS,
  POSITION_LABELS,
  formatPositionLabel,
} from '../types';
import {
  CalendarClock,
  CalendarDays,
  UserPlus,
  Users,
  CheckSquare,
  Square,
  Search,
  Download,
  FileCheck2,
  Trash2,
  Award,
  Filter,
  Clock,
  Building,
  User,
  Calendar,
  Pencil,
  Save,
  X,
  ChevronDown,
  AlertCircle,
  BadgePlus,
} from 'lucide-react';

interface LeaveAndOTTabProps {
  staffList: StaffMember[];
  leaves: LeaveRecord[];
  otRecords: OTAttendance[];
  workloads?: DailyWorkload[];
  inTimeClinics?: string[];
  outTimeClinics?: string[];
  isAdmin?: boolean;
  onSaveLeave: (leave: LeaveRecord) => void;
  onSaveBatchOT: (records: OTAttendance[]) => void;
  onUpdateLeave?: (updated: LeaveRecord) => void;
  onDeleteLeave: (id: string) => void;
  onUpdateOT?: (updated: OTAttendance) => void;
  onDeleteOT: (id: string) => void;
}

interface ExternalOtDraft {
  tempId: string;
  name: string;
  position: StaffPosition;
  affiliation: string;
}

export const LeaveAndOTTab: React.FC<LeaveAndOTTabProps> = ({
  staffList,
  leaves,
  otRecords,
  workloads = [],
  inTimeClinics = [...IN_TIME_CLINICS],
  outTimeClinics = [...OUT_TIME_CLINICS],
  isAdmin = false,
  onSaveLeave,
  onSaveBatchOT,
  onUpdateLeave,
  onDeleteLeave,
  onUpdateOT,
  onDeleteOT,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const [activeSubTab, setActiveSubTab] = useState<'leave' | 'ot' | 'fiscalSummary'>('leave');

  const activeStaff = useMemo(() => {
    return staffList.filter((s) => s.status === 'Active');
  }, [staffList]);

  const allClinics = useMemo(() => {
    return Array.from(new Set([...inTimeClinics, ...outTimeClinics]));
  }, [inTimeClinics, outTimeClinics]);

  // --- Sub-Tab 1: Leave Entry State ---
  const [leaveStartDate, setLeaveStartDate] = useState<string>(todayStr);
  const [leaveEndDate, setLeaveEndDate] = useState<string>(todayStr);
  const [leaveStaffId, setLeaveStaffId] = useState<string>('');
  const [leaveStaffQuery, setLeaveStaffQuery] = useState<string>('');
  const [isLeaveDropdownOpen, setIsLeaveDropdownOpen] = useState<boolean>(false);
  const [leaveFormError, setLeaveFormError] = useState<string>('');
  const leaveDropdownRef = useRef<HTMLDivElement | null>(null);

  const [leaveType, setLeaveType] = useState<LeaveType>('ลาพักผ่อน');
  const [leaveDays, setLeaveDays] = useState<number>(1);
  const [leaveNote, setLeaveNote] = useState<string>('');

  // Dual Filter for Leave History (Search staff name + Filter leave type)
  const [leaveSearchStaff, setLeaveSearchStaff] = useState<string>('');
  const [leaveFilterType, setLeaveFilterType] = useState<string>('ALL');
  const [editingLeave, setEditingLeave] = useState<LeaveRecord | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (leaveDropdownRef.current && !leaveDropdownRef.current.contains(event.target as Node)) {
        setIsLeaveDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedLeaveStaff = useMemo(() => {
    return activeStaff.find((s) => s.staffId === leaveStaffId) || null;
  }, [activeStaff, leaveStaffId]);

  const filteredLeaveDropdownStaff = useMemo(() => {
    const q = leaveStaffQuery.toLowerCase().trim();
    if (!q) return activeStaff;
    return activeStaff.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        formatPositionLabel(s.position).toLowerCase().includes(q) ||
        s.homeClinic.toLowerCase().includes(q)
    );
  }, [activeStaff, leaveStaffQuery]);

  const filteredLeaves = useMemo(() => {
    return leaves.filter((lv) => {
      const matchStaff =
        !leaveSearchStaff.trim() ||
        lv.staffName.toLowerCase().includes(leaveSearchStaff.toLowerCase().trim());
      const matchType = leaveFilterType === 'ALL' || lv.leaveType === leaveFilterType;
      return matchStaff && matchType;
    });
  }, [leaves, leaveSearchStaff, leaveFilterType]);

  const totalFilteredLeaveDays = useMemo(() => {
    return filteredLeaves.reduce((sum, l) => sum + (Number(l.days) || 0), 0);
  }, [filteredLeaves]);

  const calculateLeaveDays = (start: string, end: string) => {
    try {
      const d1 = new Date(start);
      const d2 = new Date(end);
      const diffTime = Math.abs(d2.getTime() - d1.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
      setLeaveDays(diffDays > 0 ? diffDays : 1);
    } catch {
      setLeaveDays(1);
    }
  };

  const handleStartDateChange = (d: string) => {
    setLeaveStartDate(d);
    if (d > leaveEndDate) setLeaveEndDate(d);
    calculateLeaveDays(d, leaveEndDate >= d ? leaveEndDate : d);
  };

  const handleEndDateChange = (d: string) => {
    setLeaveEndDate(d);
    calculateLeaveDays(leaveStartDate, d);
  };

  // --- Sub-Tab 2: OT Entry State (Multi-Select + External Substitute) ---
  const [otDate, setOtDate] = useState<string>(todayStr);
  const [otShift, setOtShift] = useState<WorkShift>('นอกเวลาเย็น 16:00-20:00');
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [workClinic, setWorkClinic] = useState<string>(outTimeClinics[0] || OUT_TIME_CLINICS[0]);
  const [otSearch, setOtSearch] = useState<string>('');
  const [otFormError, setOtFormError] = useState<string>('');

  // External substitute staff state
  const [extName, setExtName] = useState<string>('');
  const [extPosition, setExtPosition] = useState<StaffPosition>('RN');
  const [extAffiliation, setExtAffiliation] = useState<string>('');
  const [extError, setExtError] = useState<string>('');
  const [externalOtStaff, setExternalOtStaff] = useState<ExternalOtDraft[]>([]);

  // OT History search & edit modal
  const [otHistorySearch, setOtHistorySearch] = useState<string>('');
  const [editingOT, setEditingOT] = useState<OTAttendance | null>(null);

  const otWorkClinicOptions = useMemo(() => {
    if (otShift === 'OT ในเวลาราชการ 08:00-16:00') {
      return allClinics;
    }
    return outTimeClinics;
  }, [otShift, allClinics, outTimeClinics]);

  useEffect(() => {
    if (otWorkClinicOptions.length > 0 && !otWorkClinicOptions.includes(workClinic)) {
      setWorkClinic(otWorkClinicOptions[0]);
    }
  }, [otWorkClinicOptions, workClinic]);

  const totalOtSelectedCount = selectedStaffIds.length + externalOtStaff.length;

  const filteredOtRecords = useMemo(() => {
    const q = otHistorySearch.toLowerCase().trim();
    if (!q) return otRecords;
    return otRecords.filter(
      (o) =>
        o.staffName.toLowerCase().includes(q) ||
        o.workClinic.toLowerCase().includes(q) ||
        (o.affiliation || o.homeClinic).toLowerCase().includes(q) ||
        o.shift.toLowerCase().includes(q) ||
        o.date.includes(q)
    );
  }, [otRecords, otHistorySearch]);

  // --- Sub-Tab 3: Fiscal Summary Filter States ---
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number>(2570);
  const [shiftFilter, setShiftFilter] = useState<'ALL' | 'IN_TIME' | 'OT'>('ALL');
  const [clinicFilter, setClinicFilter] = useState<string>('ALL');
  const [staffFilter, setStaffFilter] = useState<string>('ALL');
  const [monthFilter, setMonthFilter] = useState<string>('ALL');
  const [summarySearchQuery, setSummarySearchQuery] = useState<string>('');

  // Handle Save Leave
  const handleSaveLeaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const staff = staffList.find((s) => s.staffId === leaveStaffId);
    if (!staff) {
      setLeaveFormError('กรุณาพิมพ์ค้นหาและเลือกเจ้าหน้าที่จากรายการ');
      return;
    }
    setLeaveFormError('');

    const newLeave: LeaveRecord = {
      id: `LV-${Date.now()}`,
      startDate: leaveStartDate,
      endDate: leaveEndDate,
      staffName: staff.name,
      position: staff.position,
      clinic: staff.homeClinic,
      leaveType,
      days: Number(leaveDays) || 1,
      note: leaveNote,
    };

    onSaveLeave(newLeave);
    setLeaveNote('');
    setLeaveStaffId('');
    setLeaveStaffQuery('');
  };

  // Handle Add External Staff to Batch OT
  const handleAddExternalStaff = () => {
    const trimmedName = extName.trim();
    const trimmedAff = extAffiliation.trim();
    if (!trimmedName || !trimmedAff) {
      setExtError('กรุณากรอกทั้ง ชื่อ-สกุล และ สังกัด / หน่วยงานต้นสังกัด');
      return;
    }
    setExtError('');
    setOtFormError('');
    setExternalOtStaff((prev) => [
      ...prev,
      {
        tempId: `EXT-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        name: trimmedName,
        position: extPosition,
        affiliation: trimmedAff,
      },
    ]);
    setExtName('');
    setExtAffiliation('');
  };

  // Handle Save Batch OT
  const handleSaveBatchOTSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (totalOtSelectedCount === 0) {
      setOtFormError('กรุณาเลือกเจ้าหน้าที่ OPD หรือเพิ่มเจ้าหน้าที่เฉพาะกิจอย่างน้อย 1 คน');
      return;
    }
    setOtFormError('');

    const opdRecords: OTAttendance[] = selectedStaffIds.map((id) => {
      const staff = staffList.find((s) => s.staffId === id);
      return {
        id: `OT-${Date.now()}-${id}`,
        date: otDate,
        shift: otShift,
        staffName: staff ? staff.name : id,
        position: staff ? staff.position : 'RN',
        homeClinic: staff ? staff.homeClinic : 'OPD',
        workClinic,
        isExternal: false,
      };
    });

    const extRecords: OTAttendance[] = externalOtStaff.map((ext, idx) => ({
      id: `OT-EXT-${Date.now()}-${idx}`,
      date: otDate,
      shift: otShift,
      staffName: ext.name,
      position: ext.position,
      homeClinic: ext.affiliation,
      workClinic,
      isExternal: true,
      affiliation: ext.affiliation,
    }));

    onSaveBatchOT([...opdRecords, ...extRecords]);
    setSelectedStaffIds([]);
    setExternalOtStaff([]);
  };

  const toggleSelectStaff = (id: string) => {
    setOtFormError('');
    setSelectedStaffIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const clearSelectedStaff = () => {
    setSelectedStaffIds([]);
    setExternalOtStaff([]);
  };

  // --- Fiscal Year Calculation (12 Months: Oct - Sep) ---
  const fiscalMonths = useMemo(
    () => [
      { name: 'ต.ค.', fullName: 'ตุลาคม', key: '10', yearOffset: -1 },
      { name: 'พ.ย.', fullName: 'พฤศจิกายน', key: '11', yearOffset: -1 },
      { name: 'ธ.ค.', fullName: 'ธันวาคม', key: '12', yearOffset: -1 },
      { name: 'ม.ค.', fullName: 'มกราคม', key: '01', yearOffset: 0 },
      { name: 'ก.พ.', fullName: 'กุมภาพันธ์', key: '02', yearOffset: 0 },
      { name: 'มี.ค.', fullName: 'มีนาคม', key: '03', yearOffset: 0 },
      { name: 'เม.ย.', fullName: 'เมษายน', key: '04', yearOffset: 0 },
      { name: 'พ.ค.', fullName: 'พฤษภาคม', key: '05', yearOffset: 0 },
      { name: 'มิ.ย.', fullName: 'มิถุนายน', key: '06', yearOffset: 0 },
      { name: 'ก.ค.', fullName: 'กรกฎาคม', key: '07', yearOffset: 0 },
      { name: 'ส.ค.', fullName: 'สิงหาคม', key: '08', yearOffset: 0 },
      { name: 'ก.ย.', fullName: 'กันยายน', key: '09', yearOffset: 0 },
    ],
    []
  );

  const fiscalSummaryData = useMemo(() => {
    const targetCeEndYear = selectedFiscalYear - 543;
    const targetCeStartYear = targetCeEndYear - 1;

    const clinicOperationalDaysMap = new Map<string, Set<string>>();
    workloads.forEach((w) => {
      if (w.shift === 'ในเวลา 08:00-16:00') {
        const [y, m] = w.date.split('-');
        const key = `${y}-${m}-${w.clinic}`;
        if (!clinicOperationalDaysMap.has(key)) {
          clinicOperationalDaysMap.set(key, new Set());
        }
        clinicOperationalDaysMap.get(key)!.add(w.date);
      }
    });

    return activeStaff.map((staff) => {
      const monthDetails: Record<
        string,
        {
          inTime: number;
          ot: number;
          leaves: number;
          total: number;
          otClinics: string[];
          leaveTypes: string[];
        }
      > = {};

      let totalInTime = 0;
      let totalOT = 0;
      let totalLeaves = 0;

      fiscalMonths.forEach((m) => {
        const year = m.yearOffset === -1 ? targetCeStartYear : targetCeEndYear;
        const ymPrefix = `${year}-${m.key}`;

        const staffOts = otRecords.filter(
          (o) => o.staffName === staff.name && o.date.startsWith(ymPrefix)
        );
        const otCount = staffOts.length;
        const otClinics = Array.from(new Set(staffOts.map((o) => o.workClinic)));

        const staffLeaves = leaves.filter(
          (l) =>
            l.staffName === staff.name &&
            (l.startDate.startsWith(ymPrefix) || l.endDate.startsWith(ymPrefix))
        );
        const leaveDays = staffLeaves.reduce((sum, l) => sum + (l.days || 1), 0);
        const leaveTypes = Array.from(
          new Set(staffLeaves.map((l) => `${l.leaveType} (${l.days} วัน)`))
        );

        const clinicKey = `${year}-${m.key}-${staff.homeClinic}`;
        const recordedDatesSet = clinicOperationalDaysMap.get(clinicKey);
        const recordedCount = recordedDatesSet ? recordedDatesSet.size : 0;

        let inTimeDays = 0;
        if (recordedCount > 0) {
          inTimeDays = Math.max(0, recordedCount - leaveDays);
        } else {
          const isPastOrCurrent = year < 2026 || (year === 2026 && Number(m.key) <= 11);
          inTimeDays = isPastOrCurrent ? Math.max(0, 20 - leaveDays) : 0;
        }

        const totalMonthDays = inTimeDays + otCount;

        monthDetails[m.key] = {
          inTime: inTimeDays,
          ot: otCount,
          leaves: leaveDays,
          total: totalMonthDays,
          otClinics,
          leaveTypes,
        };

        totalInTime += inTimeDays;
        totalOT += otCount;
        totalLeaves += leaveDays;
      });

      const grandTotal = totalInTime + totalOT;

      return {
        staff,
        monthDetails,
        totalInTime,
        totalOT,
        totalLeaves,
        grandTotal,
      };
    });
  }, [activeStaff, otRecords, leaves, workloads, selectedFiscalYear, fiscalMonths]);

  const filteredSummaryData = useMemo(() => {
    return fiscalSummaryData
      .filter((item) => {
        if (clinicFilter !== 'ALL' && item.staff.homeClinic !== clinicFilter) {
          return false;
        }
        if (staffFilter !== 'ALL' && item.staff.staffId !== staffFilter) {
          return false;
        }
        if (summarySearchQuery.trim()) {
          const q = summarySearchQuery.toLowerCase().trim();
          const match =
            item.staff.name.toLowerCase().includes(q) ||
            item.staff.homeClinic.toLowerCase().includes(q) ||
            item.staff.position.toLowerCase().includes(q) ||
            formatPositionLabel(item.staff.position).toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (shiftFilter === 'IN_TIME') {
          if (monthFilter !== 'ALL') {
            return (
              (b.monthDetails[monthFilter]?.inTime || 0) -
              (a.monthDetails[monthFilter]?.inTime || 0)
            );
          }
          return b.totalInTime - a.totalInTime;
        }
        if (shiftFilter === 'OT') {
          if (monthFilter !== 'ALL') {
            return (b.monthDetails[monthFilter]?.ot || 0) - (a.monthDetails[monthFilter]?.ot || 0);
          }
          return b.totalOT - a.totalOT;
        }
        if (monthFilter !== 'ALL') {
          return (
            (b.monthDetails[monthFilter]?.total || 0) - (a.monthDetails[monthFilter]?.total || 0)
          );
        }
        return b.grandTotal - a.grandTotal;
      });
  }, [fiscalSummaryData, clinicFilter, staffFilter, summarySearchQuery, shiftFilter, monthFilter]);

  const summaryKpis = useMemo(() => {
    if (monthFilter === 'ALL') {
      const totalInTime = filteredSummaryData.reduce((acc, d) => acc + d.totalInTime, 0);
      const totalOT = filteredSummaryData.reduce((acc, d) => acc + d.totalOT, 0);
      const totalLeaves = filteredSummaryData.reduce((acc, d) => acc + d.totalLeaves, 0);
      const totalWork = totalInTime + totalOT;
      return { totalInTime, totalOT, totalLeaves, totalWork, staffCount: filteredSummaryData.length };
    } else {
      const totalInTime = filteredSummaryData.reduce(
        (acc, d) => acc + (d.monthDetails[monthFilter]?.inTime || 0),
        0
      );
      const totalOT = filteredSummaryData.reduce(
        (acc, d) => acc + (d.monthDetails[monthFilter]?.ot || 0),
        0
      );
      const totalLeaves = filteredSummaryData.reduce(
        (acc, d) => acc + (d.monthDetails[monthFilter]?.leaves || 0),
        0
      );
      const totalWork = totalInTime + totalOT;
      return { totalInTime, totalOT, totalLeaves, totalWork, staffCount: filteredSummaryData.length };
    }
  }, [filteredSummaryData, monthFilter]);

  // Dynamic Export to CSV based on active filters (No Staff_ID column)
  const exportFiscalSummaryCsv = () => {
    const shiftLabel =
      shiftFilter === 'IN_TIME'
        ? 'เฉพาะในเวลา'
        : shiftFilter === 'OT'
          ? 'เฉพาะนอกเวลา_OT'
          : 'ในเวลาและนอกเวลา';

    if (monthFilter === 'ALL') {
      const headers = [
        'ชื่อ-สกุล',
        'ตำแหน่ง',
        'หน่วยงานสังกัด',
        ...fiscalMonths.map((m) => m.name),
        'รวมในเวลา (วัน)',
        'รวมเวรนอกเวลา (เวร)',
        'รวมวันลา (วัน)',
        'รวมทั้งสิ้น (วัน)',
      ];

      const rows = filteredSummaryData.map((item) => [
        `"${item.staff.name}"`,
        `"${formatPositionLabel(item.staff.position)}"`,
        `"${item.staff.homeClinic}"`,
        ...fiscalMonths.map((m) => {
          const d = item.monthDetails[m.key];
          if (shiftFilter === 'IN_TIME') return d?.inTime || 0;
          if (shiftFilter === 'OT') return d?.ot || 0;
          return `${d?.total || 0} (ใน:${d?.inTime || 0}/OT:${d?.ot || 0})`;
        }),
        item.totalInTime,
        item.totalOT,
        item.totalLeaves,
        item.grandTotal,
      ]);

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `สรุปวันทำงาน_12เดือน_${shiftLabel}_ปีงบ_${selectedFiscalYear}_PCMC.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      const selectedMObj = fiscalMonths.find((m) => m.key === monthFilter);
      const monthName = selectedMObj ? selectedMObj.fullName : monthFilter;

      const headers = [
        'ชื่อ-สกุล',
        'ตำแหน่ง',
        'หน่วยงานสังกัด',
        'วันทำงานในเวลา (วัน)',
        'เวรนอกเวลา OT (เวร)',
        'วันลา (วัน)',
        'รวมวันทำงานสุทธิ (วัน)',
        'คลินิกที่ขึ้นเวรนอกเวลา',
        'ประวัติการลา',
      ];

      const rows = filteredSummaryData.map((item) => {
        const d = item.monthDetails[monthFilter] || {
          inTime: 0,
          ot: 0,
          leaves: 0,
          total: 0,
          otClinics: [],
          leaveTypes: [],
        };
        return [
          `"${item.staff.name}"`,
          `"${formatPositionLabel(item.staff.position)}"`,
          `"${item.staff.homeClinic}"`,
          d.inTime,
          d.ot,
          d.leaves,
          d.total,
          `"${d.otClinics.join(', ') || '-'}"`,
          `"${d.leaveTypes.join(', ') || '-'}"`,
        ];
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `สรุปวันทำงาน_รายเดือน_${monthName}_ปีงบ_${selectedFiscalYear}_PCMC.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Header Banner */}
      <div className="bg-gradient-to-r from-teal-50 via-cyan-50 to-emerald-50 border border-teal-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <CalendarClock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-teal-950">
              เมนูที่ 2: บันทึกเวรนอกเวลา & วันลา (Leave & OT Tracker)
            </h2>
            <p className="text-xs text-teal-800">
              บันทึกวันลา/ไปอบรม, บันทึกเวรนอกเวลา & OT ในเวลาราชการ (รวมเจ้าหน้าที่เฉพาะกิจ), และสรุปปีงบประมาณ
            </p>
          </div>
        </div>

        {/* Sub Navigation Buttons */}
        <div className="flex items-center gap-1 bg-white/90 p-1 rounded-xl border border-teal-200">
          <button
            type="button"
            onClick={() => setActiveSubTab('leave')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              activeSubTab === 'leave'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-teal-800'
            }`}
          >
            1) บันทึกวันลา
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('ot')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              activeSubTab === 'ot'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-teal-800'
            }`}
          >
            2) บันทึกเวร OT / ปฏิบัติแทน
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('fiscalSummary')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
              activeSubTab === 'fiscalSummary'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-teal-800'
            }`}
          >
            3) สรุป 12 เดือนปีงบประมาณ
          </button>
        </div>
      </div>

      {/* --- SUB-TAB 1: LEAVE ENTRY --- */}
      {activeSubTab === 'leave' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5">
            <form
              onSubmit={handleSaveLeaveSubmit}
              className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4"
            >
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 border-b pb-2">
                <CalendarDays className="w-4 h-4 text-amber-600" />
                แบบฟอร์มบันทึกวันลาของบุคลากร
              </h3>

              {/* Searchable Staff Combobox */}
              <div ref={leaveDropdownRef} className="relative">
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  เลือกเจ้าหน้าที่ (พิมพ์ค้นหาด้วยชื่อ) <span className="text-red-500">*</span>
                </label>
                {selectedLeaveStaff ? (
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-amber-300 bg-amber-50/70">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-gray-900 truncate">
                        {selectedLeaveStaff.name}
                      </div>
                      <div className="text-[11px] text-amber-800">
                        {formatPositionLabel(selectedLeaveStaff.position)} •{' '}
                        {selectedLeaveStaff.homeClinic}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setLeaveStaffId('');
                        setLeaveStaffQuery('');
                        setIsLeaveDropdownOpen(true);
                      }}
                      className="text-gray-500 hover:text-red-600 p-1 rounded-md hover:bg-white cursor-pointer shrink-0"
                      title="เปลี่ยนเจ้าหน้าที่"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={leaveStaffQuery}
                      onFocus={() => setIsLeaveDropdownOpen(true)}
                      onChange={(e) => {
                        setLeaveStaffQuery(e.target.value);
                        setIsLeaveDropdownOpen(true);
                        setLeaveFormError('');
                      }}
                      placeholder="พิมพ์ชื่อเจ้าหน้าที่, ตำแหน่ง หรือคลินิกเพื่อค้นหา..."
                      className="w-full text-xs rounded-lg border-gray-300 py-2 pl-8 pr-8 border bg-white focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setIsLeaveDropdownOpen((prev) => !prev)}
                      className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 cursor-pointer"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>

                    {isLeaveDropdownOpen && (
                      <div className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto bg-white rounded-xl border border-gray-200 shadow-lg divide-y divide-gray-100">
                        {filteredLeaveDropdownStaff.length === 0 ? (
                          <div className="p-3 text-center text-xs text-gray-400">
                            ไม่พบรายชื่อเจ้าหน้าที่ที่ตรงกับคำค้นหา
                          </div>
                        ) : (
                          filteredLeaveDropdownStaff.map((s) => (
                            <button
                              key={s.staffId}
                              type="button"
                              onClick={() => {
                                setLeaveStaffId(s.staffId);
                                setLeaveStaffQuery(s.name);
                                setIsLeaveDropdownOpen(false);
                                setLeaveFormError('');
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-amber-50 flex items-center justify-between gap-2 cursor-pointer transition-colors"
                            >
                              <div className="min-w-0">
                                <span className="text-xs font-semibold text-gray-900 block truncate">
                                  {s.name}
                                </span>
                                <span className="text-[11px] text-gray-500">{s.homeClinic}</span>
                              </div>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 shrink-0">
                                {formatPositionLabel(s.position)}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
                {leaveFormError && (
                  <p className="mt-1 text-[11px] text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{leaveFormError}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  ประเภทการลา (สิทธิ์การลา) <span className="text-red-500">*</span>
                </label>
                <select
                  value={leaveType}
                  onChange={(e) => setLeaveType(e.target.value as LeaveType)}
                  required
                  className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border bg-white font-medium text-amber-900"
                >
                  {LEAVE_TYPES.map((lt) => (
                    <option key={lt} value={lt}>
                      {lt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    วันที่เริ่มต้นลา <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={leaveStartDate}
                    onChange={(e) => handleStartDateChange(e.target.value)}
                    required
                    className="w-full text-xs rounded-lg border-gray-300 py-2 px-2.5 border"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    วันที่สิ้นสุดลา <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={leaveEndDate}
                    onChange={(e) => handleEndDateChange(e.target.value)}
                    required
                    className="w-full text-xs rounded-lg border-gray-300 py-2 px-2.5 border"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  จำนวนวันลา (คำนวณอัตโนมัติ)
                </label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={leaveDays}
                  onChange={(e) => setLeaveDays(Number(e.target.value) || 1)}
                  className="w-full text-sm font-bold text-center rounded-lg border-gray-300 bg-amber-50/50 py-1.5 px-3 border text-amber-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  หมายเหตุ / เหตุผลการลา / หัวข้ออบรม
                </label>
                <input
                  type="text"
                  value={leaveNote}
                  onChange={(e) => setLeaveNote(e.target.value)}
                  placeholder="เช่น ใบรับรองแพทย์, ลาพักผ่อนประจำปี, ประชุมวิชาการ"
                  className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <FileCheck2 className="w-4 h-4" />
                <span>บันทึกประวัติการลา</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-7">
            <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                <h3 className="text-xs font-bold text-gray-900 flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-amber-600" />
                  <span>ประวัติการลาและไปอบรม/ประชุม ({leaves.length} รายการทั้งหมด)</span>
                </h3>
                <span className="text-[11px] font-normal text-gray-500">บันทึกลง Leave_Records</span>
              </div>

              {/* Dual Filter: Staff Search + Leave Type Filter */}
              <div className="bg-slate-50 p-3 rounded-xl border border-gray-200/80 space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-gray-400" />
                    <input
                      type="text"
                      value={leaveSearchStaff}
                      onChange={(e) => setLeaveSearchStaff(e.target.value)}
                      placeholder="พิมพ์ค้นหาชื่อเจ้าหน้าที่..."
                      className="w-full pl-8 pr-7 py-1.5 bg-white border border-gray-300 rounded-lg text-xs"
                    />
                    {leaveSearchStaff && (
                      <button
                        type="button"
                        onClick={() => setLeaveSearchStaff('')}
                        className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600 text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div>
                    <select
                      value={leaveFilterType}
                      onChange={(e) => setLeaveFilterType(e.target.value)}
                      className="w-full py-1.5 px-2.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700"
                    >
                      <option value="ALL">-- ทุกประเภทการลา / อบรม --</option>
                      {LEAVE_TYPES.map((lt) => (
                        <option key={lt} value={lt}>
                          {lt}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Filter Summary Badge */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-gray-200/60 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-600 font-medium">ผลการกรอง:</span>
                    <span className="bg-amber-100 text-amber-900 font-extrabold px-2.5 py-0.5 rounded-lg border border-amber-300 text-xs">
                      รวมวันลาที่เลือก: {totalFilteredLeaveDays} วัน
                    </span>
                    <span className="text-gray-500 text-[11px]">
                      ({filteredLeaves.length} รายการที่ตรงเงื่อนไข)
                    </span>
                  </div>
                  {(leaveSearchStaff || leaveFilterType !== 'ALL') && (
                    <button
                      type="button"
                      onClick={() => {
                        setLeaveSearchStaff('');
                        setLeaveFilterType('ALL');
                      }}
                      className="text-amber-800 hover:underline font-semibold text-[11px] cursor-pointer"
                    >
                      ล้างตัวกรองทั้งหมด
                    </button>
                  )}
                </div>
              </div>

              {filteredLeaves.length === 0 ? (
                <div className="py-10 text-center text-gray-400 text-xs">
                  {leaves.length === 0
                    ? 'ยังไม่มีประวัติการลา'
                    : 'ไม่พบรายการที่ตรงกับเงื่อนไขการค้นหา'}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-700 font-semibold border-b">
                      <tr>
                        <th className="py-2.5 px-3">ชื่อ-สกุล</th>
                        <th className="py-2.5 px-2">ตำแหน่ง</th>
                        <th className="py-2.5 px-2">คลินิก</th>
                        <th className="py-2.5 px-2">ประเภทลา</th>
                        <th className="py-2.5 px-2 text-center">ระยะเวลา</th>
                        <th className="py-2.5 px-2 text-center">วัน</th>
                        <th className="py-2.5 px-2 text-center">จัดการ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredLeaves.map((lv) => {
                        const isTraining = lv.leaveType === 'ไปอบรม/ประชุม';
                        return (
                          <tr key={lv.id} className="hover:bg-slate-50/80">
                            <td className="py-2 px-3">
                              <div className="font-semibold text-gray-900">{lv.staffName}</div>
                              {lv.note && (
                                <div className="text-[10px] text-gray-400 truncate max-w-[180px]">
                                  {lv.note}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-2 text-gray-600">
                              {formatPositionLabel(lv.position)}
                            </td>
                            <td className="py-2 px-2 text-gray-600">{lv.clinic}</td>
                            <td className="py-2 px-2">
                              <span
                                className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                  isTraining
                                    ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                                    : 'bg-amber-50 text-amber-800 border-amber-200'
                                }`}
                              >
                                {lv.leaveType}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-center text-[11px] text-gray-500">
                              {lv.startDate === lv.endDate
                                ? lv.startDate
                                : `${lv.startDate} ถึง ${lv.endDate}`}
                            </td>
                            <td className="py-2 px-2 text-center font-bold text-gray-800">
                              {lv.days}
                            </td>
                            <td className="py-2 px-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                {isAdmin && onUpdateLeave && (
                                  <button
                                    type="button"
                                    onClick={() => setEditingLeave(lv)}
                                    className="text-gray-400 hover:text-blue-600 p-1 cursor-pointer"
                                    title="แก้ไขรายการ (Admin)"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {isAdmin ? (
                                  <button
                                    type="button"
                                    onClick={() => onDeleteLeave(lv.id)}
                                    className="text-gray-400 hover:text-red-500 p-1 cursor-pointer"
                                    title="ลบรายการ (Admin)"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <span className="text-gray-300 text-[10px]">-</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-TAB 2: OT MULTI-SELECT + IN-TIME OT + EXTERNAL SUBSTITUTE ENTRY --- */}
      {activeSubTab === 'ot' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Controls: 5 cols */}
            <div className="lg:col-span-5">
              <form
                onSubmit={handleSaveBatchOTSubmit}
                className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4"
              >
                <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2 border-b pb-2">
                  <Users className="w-4 h-4 text-teal-600" />
                  บันทึกเวรนอกเวลา & ปฏิบัติหน้าที่แทน (พร้อมกันหลายคน)
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      วันที่ปฏิบัติงานเวร <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={otDate}
                      onChange={(e) => setOtDate(e.target.value)}
                      required
                      className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      กะเวลาเวร / OT <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={otShift}
                      onChange={(e) => setOtShift(e.target.value as WorkShift)}
                      required
                      className="w-full text-xs rounded-lg border-gray-300 py-2 px-2.5 border bg-white font-medium"
                    >
                      {OT_SHIFTS.map((sh) => (
                        <option key={sh.value} value={sh.value}>
                          {sh.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {otShift === 'OT ในเวลาราชการ 08:00-16:00' && (
                  <div className="p-2.5 rounded-xl bg-cyan-50 border border-cyan-200 text-[11px] text-cyan-900">
                    สำหรับบันทึกเจ้าหน้าที่จากหน่วยงานอื่น (นอก OPD) ที่มาขึ้น OT ปฏิบัติหน้าที่แทนในเวลาราชการ
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    ห้องตรวจที่ไปปฏิบัติงานจริง (Work Clinic) <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={workClinic}
                    onChange={(e) => setWorkClinic(e.target.value)}
                    required
                    className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border bg-white font-medium text-teal-900"
                  >
                    {otWorkClinicOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Ad-hoc External Substitute Staff Box */}
                <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-200/90 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                    <UserPlus className="w-4 h-4 text-indigo-600" />
                    <span>เจ้าหน้าที่เฉพาะกิจ (กรณีที่ไม่ใช่คนของ OPD)</span>
                  </div>
                  <p className="text-[11px] text-indigo-800/90">
                    ระบุชื่อ-สกุล และหน่วยงานต้นสังกัดของเจ้าหน้าที่ภายนอกที่มาช่วยปฏิบัติหน้าที่
                  </p>

                  <div className="space-y-2">
                    <input
                      type="text"
                      value={extName}
                      onChange={(e) => {
                        setExtName(e.target.value);
                        setExtError('');
                      }}
                      placeholder="ชื่อ-สกุล * (เช่น พว.สุภาภรณ์ ดีมาก)"
                      className="w-full text-xs rounded-lg border-indigo-200 py-1.5 px-2.5 border bg-white"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={extPosition}
                        onChange={(e) => setExtPosition(e.target.value as StaffPosition)}
                        className="w-full text-xs rounded-lg border-indigo-200 py-1.5 px-2 border bg-white"
                      >
                        {ALL_POSITIONS.map((p) => (
                          <option key={p} value={p}>
                            {POSITION_LABELS[p]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={extAffiliation}
                        onChange={(e) => {
                          setExtAffiliation(e.target.value);
                          setExtError('');
                        }}
                        placeholder="สังกัด * (เช่น ER, ICU, Ward 5)"
                        className="w-full text-xs rounded-lg border-indigo-200 py-1.5 px-2.5 border bg-white"
                      />
                    </div>
                    {extError && (
                      <p className="text-[11px] text-red-600 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{extError}</span>
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleAddExternalStaff}
                      className="w-full py-1.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <BadgePlus className="w-3.5 h-3.5" />
                      <span>เพิ่มชื่อเจ้าหน้าที่เฉพาะกิจเข้าชุดบันทึก</span>
                    </button>
                  </div>

                  {externalOtStaff.length > 0 && (
                    <div className="pt-2 border-t border-indigo-200/70 space-y-1.5">
                      <div className="text-[11px] font-bold text-indigo-900">
                        รายชื่อเฉพาะกิจที่เพิ่มไว้ ({externalOtStaff.length} คน):
                      </div>
                      {externalOtStaff.map((ext) => (
                        <div
                          key={ext.tempId}
                          className="flex items-center justify-between gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-indigo-200 text-xs"
                        >
                          <div className="min-w-0">
                            <span className="font-bold text-gray-900 block truncate">
                              {ext.name}
                            </span>
                            <span className="text-[10px] text-indigo-700">
                              {formatPositionLabel(ext.position)} • สังกัด: {ext.affiliation}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setExternalOtStaff((prev) =>
                                prev.filter((item) => item.tempId !== ext.tempId)
                              )
                            }
                            className="text-gray-400 hover:text-red-600 p-0.5 cursor-pointer shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected Staff Counter */}
                <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-teal-950 block">เลือกแล้วทั้งหมด:</span>
                    <span className="text-sm font-bold text-teal-700">
                      {totalOtSelectedCount} คน{' '}
                      <span className="text-[11px] font-normal text-teal-600">
                        (OPD {selectedStaffIds.length} + เฉพาะกิจ {externalOtStaff.length})
                      </span>
                    </span>
                  </div>
                  {totalOtSelectedCount > 0 && (
                    <button
                      type="button"
                      onClick={clearSelectedStaff}
                      className="text-xs text-red-600 hover:underline cursor-pointer"
                    >
                      ล้างที่เลือกทั้งหมด
                    </button>
                  )}
                </div>

                {otFormError && (
                  <p className="text-[11px] text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{otFormError}</span>
                  </p>
                )}

                <button
                  type="submit"
                  disabled={totalOtSelectedCount === 0}
                  className="w-full py-2.5 bg-teal-700 hover:bg-teal-600 active:bg-teal-800 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>บันทึกเวรปฏิบัติงาน ({totalOtSelectedCount} คน)</span>
                </button>
              </form>
            </div>

            {/* Staff Multi-Select Grid: 7 cols */}
            <div className="lg:col-span-7">
              <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-3 h-full">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
                  <h3 className="text-xs font-bold text-gray-900">
                    คลิกเลือกเจ้าหน้าที่ OPD ที่จะขึ้นเวร ({activeStaff.length} คน)
                  </h3>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      placeholder="ค้นหาชื่อ, ตำแหน่ง, คลินิก..."
                      value={otSearch}
                      onChange={(e) => setOtSearch(e.target.value)}
                      className="text-xs rounded-lg border-gray-200 pl-8 pr-3 py-1.5 border w-56"
                    />
                  </div>
                </div>

                {/* Staff Items List */}
                <div className="max-h-[540px] overflow-y-auto space-y-1.5 pr-1">
                  {activeStaff
                    .filter(
                      (s) =>
                        s.name.toLowerCase().includes(otSearch.toLowerCase()) ||
                        s.position.toLowerCase().includes(otSearch.toLowerCase()) ||
                        formatPositionLabel(s.position)
                          .toLowerCase()
                          .includes(otSearch.toLowerCase()) ||
                        s.homeClinic.toLowerCase().includes(otSearch.toLowerCase())
                    )
                    .map((s) => {
                      const isSelected = selectedStaffIds.includes(s.staffId);
                      return (
                        <div
                          key={s.staffId}
                          onClick={() => toggleSelectStaff(s.staffId)}
                          className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer transition-all ${
                            isSelected
                              ? 'bg-teal-50 border-teal-300 text-teal-950 font-medium'
                              : 'bg-slate-50/50 border-gray-100 hover:border-teal-200 text-gray-700'
                          }`}
                        >
                          <div className="flex items-center gap-2.5">
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-teal-600 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-gray-300 shrink-0" />
                            )}
                            <div>
                              <span className="text-xs font-bold block">{s.name}</span>
                              <span className="text-[11px] text-gray-500">
                                สังกัด: {s.homeClinic}
                              </span>
                            </div>
                          </div>

                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                              s.position === 'RN'
                                ? 'bg-blue-100 text-blue-800'
                                : s.position === 'PN'
                                  ? 'bg-teal-100 text-teal-800'
                                  : s.position === 'NA' || s.position === 'PCA'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {formatPositionLabel(s.position)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>

          {/* OT & Substitute Attendance History Table */}
          <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-teal-700" />
                <h3 className="text-xs sm:text-sm font-bold text-gray-900">
                  รายการบันทึกเวรนอกเวลา & ปฏิบัติหน้าที่แทน ({otRecords.length} รายการ)
                </h3>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  value={otHistorySearch}
                  onChange={(e) => setOtHistorySearch(e.target.value)}
                  placeholder="ค้นหาชื่อ, สังกัด, คลินิก, วันที่..."
                  className="w-full text-xs rounded-lg border border-gray-300 pl-8 pr-3 py-1.5 bg-white"
                />
              </div>
            </div>

            {filteredOtRecords.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">
                ยังไม่มีประวัติการบันทึกเวรนอกเวลาหรือปฏิบัติหน้าที่แทน
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-700 font-semibold border-b">
                    <tr>
                      <th className="py-2.5 px-3">วันที่</th>
                      <th className="py-2.5 px-2">กะเวลา / ประเภท OT</th>
                      <th className="py-2.5 px-3">ชื่อ-สกุล</th>
                      <th className="py-2.5 px-2">ตำแหน่ง</th>
                      <th className="py-2.5 px-2">สังกัด / หน่วยงานต้นทาง</th>
                      <th className="py-2.5 px-2">ห้องตรวจที่ปฏิบัติงาน</th>
                      <th className="py-2.5 px-2 text-center">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredOtRecords.map((o) => {
                      const isInTimeOT = o.shift === 'OT ในเวลาราชการ 08:00-16:00';
                      const origin = o.affiliation || o.homeClinic;
                      return (
                        <tr key={o.id} className="hover:bg-slate-50/80">
                          <td className="py-2 px-3 text-gray-700 font-medium whitespace-nowrap">
                            {o.date}
                          </td>
                          <td className="py-2 px-2">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                isInTimeOT
                                  ? 'bg-cyan-50 text-cyan-800 border-cyan-200'
                                  : 'bg-purple-50 text-purple-800 border-purple-200'
                              }`}
                            >
                              {o.shift}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-gray-900">{o.staffName}</span>
                              {o.isExternal && (
                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
                                  เฉพาะกิจนอก OPD
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-gray-600">
                            {formatPositionLabel(o.position)}
                          </td>
                          <td className="py-2 px-2 text-gray-600">{origin}</td>
                          <td className="py-2 px-2 font-semibold text-teal-800">{o.workClinic}</td>
                          <td className="py-2 px-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {isAdmin && onUpdateOT && (
                                <button
                                  type="button"
                                  onClick={() => setEditingOT(o)}
                                  className="text-gray-400 hover:text-blue-600 p-1 cursor-pointer"
                                  title="แก้ไขรายการ (Admin)"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => onDeleteOT(o.id)}
                                  className="text-gray-400 hover:text-red-500 p-1 cursor-pointer"
                                  title="ลบรายการ (Admin)"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <span className="text-gray-300 text-[10px]">-</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- SUB-TAB 3: FISCAL YEAR SUMMARY (12 MONTHS / MONTHLY / CLINIC / INDIVIDUAL) --- */}
      {activeSubTab === 'fiscalSummary' && (
        <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4">
          {/* Header Title & Actions */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b pb-4">
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Award className="w-5 h-5 text-teal-700" />
                <span>3. สรุปวันทำงานและเวรนอกเวลา (In-Time & OT Analytics)</span>
              </h3>
              <p className="text-xs text-gray-500 mt-0.5">
                เลือกดูข้อมูลจำนวนวันทำงานทั้งในเวลาและนอกเวลา (เวร OT) แยกรายบุคคล หน่วยงาน และรายเดือน
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 bg-slate-100 px-2.5 py-1 rounded-lg">
                <Calendar className="w-3.5 h-3.5 text-teal-700" />
                <span>ปีงบประมาณ:</span>
                <select
                  value={selectedFiscalYear}
                  onChange={(e) => setSelectedFiscalYear(Number(e.target.value))}
                  className="bg-transparent font-bold text-teal-900 outline-none cursor-pointer"
                >
                  <option value={2569}>2569 (ต.ค. 68 - ก.ย. 69)</option>
                  <option value={2570}>2570 (ต.ค. 69 - ก.ย. 70)</option>
                  <option value={2571}>2571 (ต.ค. 70 - ก.ย. 71)</option>
                </select>
              </div>

              <button
                type="button"
                onClick={exportFiscalSummaryCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>ส่งออก CSV ตามตัวกรอง</span>
              </button>
            </div>
          </div>

          {/* Interactive Filters Grid */}
          <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <Filter className="w-4 h-4 text-teal-700" />
              <span>ตัวกรองการแสดงผล (Filters)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* 1. Shift Filter */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-teal-700" />
                  <span>ประเภทเวลาปฏิบัติงาน:</span>
                </label>
                <select
                  value={shiftFilter}
                  onChange={(e) => setShiftFilter(e.target.value as 'ALL' | 'IN_TIME' | 'OT')}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-medium text-gray-900 focus:ring-1 focus:ring-teal-500"
                >
                  <option value="ALL">ทั้งหมด (ในเวลา + นอกเวลา)</option>
                  <option value="IN_TIME">เฉพาะในเวลา (08:00 - 16:00)</option>
                  <option value="OT">เฉพาะนอกเวลา (เวร OT)</option>
                </select>
              </div>

              {/* 2. Clinic Filter */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <Building className="w-3 h-3 text-teal-700" />
                  <span>หน่วยงาน / คลินิกสังกัด:</span>
                </label>
                <select
                  value={clinicFilter}
                  onChange={(e) => setClinicFilter(e.target.value)}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-medium text-gray-900 focus:ring-1 focus:ring-teal-500"
                >
                  <option value="ALL">-- ทุกหน่วยงาน (ทุกคลินิก OPD) --</option>
                  {allClinics.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Month Filter */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-teal-700" />
                  <span>ช่วงเวลา / รายเดือน:</span>
                </label>
                <select
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-medium text-gray-900 focus:ring-1 focus:ring-teal-500"
                >
                  <option value="ALL">สรุปทั้งปีงบประมาณ (12 เดือน ต.ค. - ก.ย.)</option>
                  {fiscalMonths.map((m) => (
                    <option key={m.key} value={m.key}>
                      รายเดือน: {m.fullName} ({m.name})
                    </option>
                  ))}
                </select>
              </div>

              {/* 4. Individual Staff Filter */}
              <div>
                <label className="block text-[11px] font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <User className="w-3 h-3 text-teal-700" />
                  <span>เลือกดูเฉพาะรายบุคคล:</span>
                </label>
                <select
                  value={staffFilter}
                  onChange={(e) => setStaffFilter(e.target.value)}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white font-medium text-gray-900 focus:ring-1 focus:ring-teal-500"
                >
                  <option value="ALL">-- บุคลากรทุกคน ({activeStaff.length} คน) --</option>
                  {activeStaff.map((s) => (
                    <option key={s.staffId} value={s.staffId}>
                      {s.name} ({formatPositionLabel(s.position)} - {s.homeClinic})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Quick Search Box & Reset Filter Button */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-slate-200/60">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
                <input
                  type="text"
                  placeholder="พิมพ์ค้นหาชื่อเจ้าหน้าที่, ตำแหน่ง, คลินิก..."
                  value={summarySearchQuery}
                  onChange={(e) => setSummarySearchQuery(e.target.value)}
                  className="w-full text-xs rounded-lg border-gray-200 pl-8 pr-3 py-1.5 border bg-white"
                />
              </div>

              <div className="flex items-center gap-2">
                {(shiftFilter !== 'ALL' ||
                  clinicFilter !== 'ALL' ||
                  staffFilter !== 'ALL' ||
                  monthFilter !== 'ALL' ||
                  summarySearchQuery) && (
                  <button
                    type="button"
                    onClick={() => {
                      setShiftFilter('ALL');
                      setClinicFilter('ALL');
                      setStaffFilter('ALL');
                      setMonthFilter('ALL');
                      setSummarySearchQuery('');
                    }}
                    className="text-xs text-red-600 hover:text-red-700 font-semibold cursor-pointer"
                  >
                    ล้างตัวกรองทั้งหมด
                  </button>
                )}
                <span className="text-xs text-gray-500">
                  พบข้อมูล: <strong>{filteredSummaryData.length}</strong> คน
                </span>
              </div>
            </div>
          </div>

          {/* KPI Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-2xl p-3.5 border border-teal-200/70 shadow-2xs">
              <span className="text-[11px] font-bold text-teal-800 block">
                {monthFilter === 'ALL' ? 'รวมวันทำงานทั้งสิ้น (ปีงบ)' : 'รวมวันทำงานในเดือนนี้'}
              </span>
              <div className="text-2xl font-black text-teal-950 mt-1">
                {summaryKpis.totalWork} <span className="text-xs font-normal text-teal-700">วัน</span>
              </div>
              <span className="text-[10px] text-teal-600">ในเวลา + นอกเวลา</span>
            </div>

            <div className="bg-white rounded-2xl p-3.5 border border-blue-200 shadow-2xs">
              <span className="text-[11px] font-bold text-blue-800 block">
                วันทำงานในเวลา (08:00-16:00)
              </span>
              <div className="text-2xl font-black text-blue-900 mt-1">
                {summaryKpis.totalInTime}{' '}
                <span className="text-xs font-normal text-blue-600">วัน</span>
              </div>
              <span className="text-[10px] text-blue-500">ตามบันทึกภาระงานคลินิก</span>
            </div>

            <div className="bg-white rounded-2xl p-3.5 border border-purple-200 shadow-2xs">
              <span className="text-[11px] font-bold text-purple-800 block">เวรนอกเวลา (OT)</span>
              <div className="text-2xl font-black text-purple-900 mt-1">
                {summaryKpis.totalOT}{' '}
                <span className="text-xs font-normal text-purple-600">เวร</span>
              </div>
              <span className="text-[10px] text-purple-500">เวรเย็น, วันหยุด & OT ในเวลา</span>
            </div>

            <div className="bg-white rounded-2xl p-3.5 border border-amber-200 shadow-2xs">
              <span className="text-[11px] font-bold text-amber-800 block">วันลาสะสม</span>
              <div className="text-2xl font-black text-amber-900 mt-1">
                {summaryKpis.totalLeaves}{' '}
                <span className="text-xs font-normal text-amber-600">วัน</span>
              </div>
              <span className="text-[10px] text-amber-500">ลาป่วย/ลากิจ/ลาพักผ่อน/อบรม</span>
            </div>
          </div>

          {/* VIEW A: 12-Month Grid View */}
          {monthFilter === 'ALL' ? (
            <div className="overflow-x-auto border border-gray-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-800 font-bold border-b text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3 whitespace-nowrap">ชื่อ - นามสกุล</th>
                    <th className="py-2.5 px-2 text-center whitespace-nowrap">ตำแหน่ง</th>
                    <th className="py-2.5 px-2 whitespace-nowrap">หน่วยงานสังกัด</th>
                    {fiscalMonths.map((m) => (
                      <th
                        key={m.key}
                        className="py-2.5 px-2 text-center bg-slate-200/50 whitespace-nowrap"
                      >
                        {m.name}
                      </th>
                    ))}
                    <th className="py-2.5 px-2 text-center bg-blue-50 text-blue-900 whitespace-nowrap">
                      ในเวลา
                    </th>
                    <th className="py-2.5 px-2 text-center bg-purple-50 text-purple-900 whitespace-nowrap">
                      เวร OT
                    </th>
                    <th className="py-2.5 px-2 text-center bg-amber-50 text-amber-900 whitespace-nowrap">
                      วันลา
                    </th>
                    <th className="py-2.5 px-3 text-center bg-teal-700 text-white font-extrabold whitespace-nowrap">
                      รวมทั้งสิ้น
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSummaryData.length === 0 ? (
                    <tr>
                      <td colSpan={19} className="py-8 text-center text-gray-400">
                        ไม่พบข้อมูลตามตัวกรองที่เลือก
                      </td>
                    </tr>
                  ) : (
                    filteredSummaryData.map((item, idx) => {
                      const { staff, monthDetails, totalInTime, totalOT, totalLeaves, grandTotal } =
                        item;
                      return (
                        <tr
                          key={staff.staffId}
                          className={
                            idx % 2 === 0
                              ? 'bg-white hover:bg-slate-50'
                              : 'bg-slate-50/50 hover:bg-slate-100/60'
                          }
                        >
                          <td className="py-2 px-3 font-semibold text-gray-900 whitespace-nowrap">
                            {staff.name}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                                staff.position === 'HN'
                                  ? 'bg-purple-100 text-purple-800'
                                  : staff.position === 'RN'
                                    ? 'bg-blue-100 text-blue-800'
                                    : staff.position === 'PN'
                                      ? 'bg-teal-100 text-teal-800'
                                      : staff.position === 'NA' || staff.position === 'PCA'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {formatPositionLabel(staff.position)}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-gray-600 truncate max-w-[130px]">
                            {staff.homeClinic}
                          </td>

                          {/* 12 Month columns */}
                          {fiscalMonths.map((m) => {
                            const detail = monthDetails[m.key];
                            const inTime = detail?.inTime || 0;
                            const ot = detail?.ot || 0;
                            const val =
                              shiftFilter === 'IN_TIME'
                                ? inTime
                                : shiftFilter === 'OT'
                                  ? ot
                                  : inTime + ot;

                            return (
                              <td
                                key={m.key}
                                className={`py-2 px-1.5 text-center text-[11px] ${
                                  val > 0 ? 'font-bold text-teal-950' : 'text-gray-300'
                                }`}
                                title={`ในเวลา: ${inTime} วัน, OT: ${ot} เวร, ลา: ${detail?.leaves || 0} วัน`}
                              >
                                {val > 0 ? (
                                  shiftFilter === 'ALL' ? (
                                    <span className="inline-flex flex-col items-center">
                                      <span>{val}</span>
                                      <span className="text-[9px] font-normal text-gray-400">
                                        {inTime}/{ot}
                                      </span>
                                    </span>
                                  ) : (
                                    val
                                  )
                                ) : (
                                  '-'
                                )}
                              </td>
                            );
                          })}

                          <td className="py-2 px-2 text-center font-bold text-blue-900 bg-blue-50/50">
                            {totalInTime}
                          </td>
                          <td className="py-2 px-2 text-center font-bold text-purple-900 bg-purple-50/50">
                            {totalOT}
                          </td>
                          <td className="py-2 px-2 text-center text-amber-800 bg-amber-50/50">
                            {totalLeaves > 0 ? totalLeaves : '-'}
                          </td>
                          <td className="py-2 px-3 text-center font-black text-sm text-teal-950 bg-teal-50">
                            {shiftFilter === 'IN_TIME'
                              ? totalInTime
                              : shiftFilter === 'OT'
                                ? totalOT
                                : grandTotal}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            /* VIEW B: Monthly Detailed Table */
            <div className="overflow-x-auto border border-gray-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-800 font-bold border-b text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3 whitespace-nowrap">ชื่อ - นามสกุล</th>
                    <th className="py-2.5 px-2 text-center whitespace-nowrap">ตำแหน่ง</th>
                    <th className="py-2.5 px-3 whitespace-nowrap">หน่วยงานสังกัด</th>
                    <th className="py-2.5 px-3 text-center bg-blue-50 text-blue-950 whitespace-nowrap font-bold">
                      วันทำงานในเวลา
                    </th>
                    <th className="py-2.5 px-3 text-center bg-purple-50 text-purple-950 whitespace-nowrap font-bold">
                      เวรนอกเวลา (OT)
                    </th>
                    <th className="py-2.5 px-3 text-center bg-amber-50 text-amber-950 whitespace-nowrap font-bold">
                      วันลา (วัน)
                    </th>
                    <th className="py-2.5 px-3 text-center bg-teal-100 text-teal-950 whitespace-nowrap font-extrabold">
                      รวมวันทำงานสุทธิ
                    </th>
                    <th className="py-2.5 px-3 whitespace-nowrap">
                      คลินิกที่ขึ้นเวรนอกเวลา & ประวัติวันลา
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredSummaryData.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-gray-400">
                        ไม่พบข้อมูลตามตัวกรองที่เลือกในเดือนนี้
                      </td>
                    </tr>
                  ) : (
                    filteredSummaryData.map((item, idx) => {
                      const { staff, monthDetails } = item;
                      const d = monthDetails[monthFilter] || {
                        inTime: 0,
                        ot: 0,
                        leaves: 0,
                        total: 0,
                        otClinics: [],
                        leaveTypes: [],
                      };
                      return (
                        <tr
                          key={staff.staffId}
                          className={
                            idx % 2 === 0
                              ? 'bg-white hover:bg-slate-50'
                              : 'bg-slate-50/50 hover:bg-slate-100/60'
                          }
                        >
                          <td className="py-2 px-3 font-semibold text-gray-900 whitespace-nowrap">
                            {staff.name}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                                staff.position === 'HN'
                                  ? 'bg-purple-100 text-purple-800'
                                  : staff.position === 'RN'
                                    ? 'bg-blue-100 text-blue-800'
                                    : staff.position === 'PN'
                                      ? 'bg-teal-100 text-teal-800'
                                      : staff.position === 'NA' || staff.position === 'PCA'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {formatPositionLabel(staff.position)}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-gray-600 whitespace-nowrap">
                            {staff.homeClinic}
                          </td>
                          <td className="py-2 px-3 text-center font-bold text-blue-900 bg-blue-50/30">
                            {d.inTime > 0 ? `${d.inTime} วัน` : '-'}
                          </td>
                          <td className="py-2 px-3 text-center font-bold text-purple-900 bg-purple-50/30">
                            {d.ot > 0 ? `${d.ot} เวร` : '-'}
                          </td>
                          <td className="py-2 px-3 text-center font-semibold text-amber-800 bg-amber-50/30">
                            {d.leaves > 0 ? `${d.leaves} วัน` : '-'}
                          </td>
                          <td className="py-2 px-3 text-center font-black text-sm text-teal-950 bg-teal-50">
                            {shiftFilter === 'IN_TIME'
                              ? d.inTime
                              : shiftFilter === 'OT'
                                ? d.ot
                                : d.total}{' '}
                            วัน
                          </td>
                          <td className="py-2 px-3 text-[11px] text-gray-600">
                            <div className="space-y-0.5">
                              {d.otClinics.length > 0 && (
                                <div className="text-purple-800 font-medium">
                                  ขึ้นเวร: {d.otClinics.join(', ')}
                                </div>
                              )}
                              {d.leaveTypes.length > 0 && (
                                <div className="text-amber-800">
                                  การลา: {d.leaveTypes.join(', ')}
                                </div>
                              )}
                              {d.otClinics.length === 0 && d.leaveTypes.length === 0 && (
                                <span className="text-gray-400">ปฏิบัติงานปกติประจำหน่วยงาน</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Admin Edit Leave Modal */}
      {editingLeave && onUpdateLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-amber-600" />
                <h3 className="text-base font-bold text-gray-900">
                  แก้ไขข้อมูลประวัติการลา (เฉพาะ Admin)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingLeave(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">ชื่อเจ้าหน้าที่</label>
                <input
                  type="text"
                  value={editingLeave.staffName}
                  disabled
                  className="w-full px-2.5 py-1.5 bg-gray-100 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ตำแหน่ง</label>
                  <input
                    type="text"
                    value={formatPositionLabel(editingLeave.position)}
                    disabled
                    className="w-full px-2.5 py-1.5 bg-gray-100 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">คลินิกสังกัด</label>
                  <input
                    type="text"
                    value={editingLeave.clinic}
                    disabled
                    className="w-full px-2.5 py-1.5 bg-gray-100 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ตั้งแต่วันที่</label>
                  <input
                    type="date"
                    value={editingLeave.startDate}
                    onChange={(e) => setEditingLeave({ ...editingLeave, startDate: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ถึงวันที่</label>
                  <input
                    type="date"
                    value={editingLeave.endDate}
                    onChange={(e) => setEditingLeave({ ...editingLeave, endDate: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ประเภทการลา</label>
                  <select
                    value={editingLeave.leaveType}
                    onChange={(e) =>
                      setEditingLeave({ ...editingLeave, leaveType: e.target.value as LeaveType })
                    }
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-medium"
                  >
                    {LEAVE_TYPES.map((lt) => (
                      <option key={lt} value={lt}>
                        {lt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">จำนวนวันลา (วัน)</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={editingLeave.days}
                    onChange={(e) =>
                      setEditingLeave({ ...editingLeave, days: Number(e.target.value) || 1 })
                    }
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">หมายเหตุ</label>
                <input
                  type="text"
                  value={editingLeave.note || ''}
                  onChange={(e) => setEditingLeave({ ...editingLeave, note: e.target.value })}
                  placeholder="เช่น ใบรับรองแพทย์, ลาพักผ่อนประจำปี"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setEditingLeave(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateLeave(editingLeave);
                  setEditingLeave(null);
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>บันทึกการแก้ไข</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Edit OT Modal */}
      {editingOT && onUpdateOT && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-teal-600" />
                <h3 className="text-base font-bold text-gray-900">
                  แก้ไขข้อมูลเวรนอกเวลา & ปฏิบัติแทน (เฉพาะ Admin)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingOT(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-gray-700 mb-1">ชื่อ-สกุล</label>
                <input
                  type="text"
                  value={editingOT.staffName}
                  onChange={(e) => setEditingOT({ ...editingOT, staffName: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-semibold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ตำแหน่ง</label>
                  <select
                    value={editingOT.position}
                    onChange={(e) =>
                      setEditingOT({ ...editingOT, position: e.target.value as StaffPosition })
                    }
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    {ALL_POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {POSITION_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    สังกัด / หน่วยงานต้นทาง
                  </label>
                  <input
                    type="text"
                    value={editingOT.affiliation || editingOT.homeClinic}
                    onChange={(e) =>
                      setEditingOT({
                        ...editingOT,
                        homeClinic: e.target.value,
                        affiliation: editingOT.isExternal ? e.target.value : editingOT.affiliation,
                      })
                    }
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">วันที่</label>
                  <input
                    type="date"
                    value={editingOT.date}
                    onChange={(e) => setEditingOT({ ...editingOT, date: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">กะเวลา</label>
                  <select
                    value={editingOT.shift}
                    onChange={(e) =>
                      setEditingOT({ ...editingOT, shift: e.target.value as WorkShift })
                    }
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    {OT_SHIFTS.map((sh) => (
                      <option key={sh.value} value={sh.value}>
                        {sh.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-gray-700 mb-1">
                  ห้องตรวจที่ปฏิบัติงาน
                </label>
                <select
                  value={editingOT.workClinic}
                  onChange={(e) => setEditingOT({ ...editingOT, workClinic: e.target.value })}
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                >
                  {allClinics.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setEditingOT(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdateOT(editingOT);
                  setEditingOT(null);
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-teal-700 hover:bg-teal-800 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
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
