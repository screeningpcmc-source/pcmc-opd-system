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
  CustomHoliday,
  AuditLogEntry,
  compareStaffByPositionAndStartDate,
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
  ImageDown,
  Printer,
  History,
} from 'lucide-react';
import {
  formatThaiLeaveRange,
  formatThaiShortDate,
  formatThaiDateTime,
  splitThaiName,
} from '../utils/thaiDate';
import {
  calculateGovernmentLeaveStats,
  countGovernmentWorkdaysInRange,
} from '../utils/thaiHolidays';
import { exportElementAsJpeg } from '../utils/exportImage';
import { ThaiDateInput } from './ThaiDateInput';

interface LeaveAndOTTabProps {
  staffList: StaffMember[];
  leaves: LeaveRecord[];
  otRecords: OTAttendance[];
  auditLogs?: AuditLogEntry[];
  workloads?: DailyWorkload[];
  inTimeClinics?: string[];
  outTimeClinics?: string[];
  leaveTypes?: string[];
  customHolidays?: CustomHoliday[];
  isAdmin?: boolean;
  onSaveLeave: (leave: LeaveRecord) => void;
  onSaveBatchOT: (records: OTAttendance[]) => void;
  onUpdateLeave?: (updated: LeaveRecord, reason: string) => void;
  onDeleteLeave: (id: string, reason: string) => void;
  onUpdateOT?: (updated: OTAttendance, reason: string) => void;
  onDeleteOT: (id: string, reason: string) => void;
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
  auditLogs = [],
  workloads: _workloads = [],
  inTimeClinics = [...IN_TIME_CLINICS],
  outTimeClinics = [...OUT_TIME_CLINICS],
  leaveTypes = [...LEAVE_TYPES],
  customHolidays = [],
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
  const [summaryReportMode, setSummaryReportMode] = useState<'ALL' | 'WORK_OT' | 'LEAVE_REPORT'>('ALL');
  const [onlyStaffWithLeaves, setOnlyStaffWithLeaves] = useState<boolean>(false);
  const [isExportingLeaveJpeg, setIsExportingLeaveJpeg] = useState<boolean>(false);
  const [printTarget, setPrintTarget] = useState<'NONE' | 'LEAVE_REPORT'>('NONE');
  const leaveReportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleAfterPrint = () => setPrintTarget('NONE');
    window.addEventListener('afterprint', handleAfterPrint);
    return () => window.removeEventListener('afterprint', handleAfterPrint);
  }, []);

  const activeStaff = useMemo(() => {
    return staffList
      .filter((s) => s.status === 'Active')
      .sort(compareStaffByPositionAndStartDate);
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

  const [leaveType, setLeaveType] = useState<LeaveType>(leaveTypes[0] || 'ลาพักผ่อน');
  const [leaveDays, setLeaveDays] = useState<number>(1);
  const [leaveNote, setLeaveNote] = useState<string>('');

  useEffect(() => {
    if (leaveTypes.length > 0 && !leaveTypes.includes(leaveType)) {
      setLeaveType(leaveTypes[0]);
    }
  }, [leaveTypes, leaveType]);

  // Dual Filter for Leave History (Search staff name + Filter leave type)
  const [leaveSearchStaff, setLeaveSearchStaff] = useState<string>('');
  const [leaveFilterType, setLeaveFilterType] = useState<string>('ALL');
  const [editingLeave, setEditingLeave] = useState<LeaveRecord | null>(null);
  const [editLeaveReason, setEditLeaveReason] = useState<string>('');
  const [editLeaveReasonError, setEditLeaveReasonError] = useState<string>('');
  const [deletingLeave, setDeletingLeave] = useState<LeaveRecord | null>(null);
  const [deleteLeaveReason, setDeleteLeaveReason] = useState<string>('');
  const [deleteLeaveReasonError, setDeleteLeaveReasonError] = useState<string>('');
  const [showLeaveAuditLog, setShowLeaveAuditLog] = useState<boolean>(false);

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

  const leaveDayStats = useMemo(() => {
    return calculateGovernmentLeaveStats(leaveStartDate, leaveEndDate, customHolidays);
  }, [leaveStartDate, leaveEndDate, customHolidays]);

  useEffect(() => {
    setLeaveDays(leaveDayStats.workDays);
  }, [leaveDayStats.workDays]);

  const handleStartDateChange = (d: string) => {
    setLeaveStartDate(d);
    if (d > leaveEndDate) setLeaveEndDate(d);
    setLeaveFormError('');
  };

  const handleEndDateChange = (d: string) => {
    if (d < leaveStartDate) {
      setLeaveEndDate(leaveStartDate);
    } else {
      setLeaveEndDate(d);
    }
    setLeaveFormError('');
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

  // OT History search & edit/delete modal with mandatory reason
  const [otHistorySearch, setOtHistorySearch] = useState<string>('');
  const [editingOT, setEditingOT] = useState<OTAttendance | null>(null);
  const [editOtReason, setEditOtReason] = useState<string>('');
  const [editOtReasonError, setEditOtReasonError] = useState<string>('');
  const [deletingOT, setDeletingOT] = useState<OTAttendance | null>(null);
  const [deleteOtReason, setDeleteOtReason] = useState<string>('');
  const [deleteOtReasonError, setDeleteOtReasonError] = useState<string>('');
  const [showOtAuditLog, setShowOtAuditLog] = useState<boolean>(false);

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
    const numericDays = Number(leaveDays) || 0;
    if (numericDays <= 0) {
      setLeaveFormError('ช่วงวันที่เลือกตรงกับวันหยุดราชการทั้งหมด (0 วัน) กรุณาเลือกวันทำการ หรือระบุจำนวนวันลาด้วยตนเอง');
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
      days: numericDays,
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

  const summaryEligibleStaff = useMemo(() => {
    const targetCeEndYear = selectedFiscalYear - 543;
    const targetCeStartYear = targetCeEndYear - 1;
    const fyStart = `${targetCeStartYear}-10-01`;
    const fyEnd = `${targetCeEndYear}-09-30`;

    return staffList
      .filter((s) => {
        if (s.status === 'Active') {
          if (s.startDate && s.startDate > fyEnd) return false;
          return true;
        }
        if (s.startDate || s.endDate) {
          const effStart = s.startDate || '0000-01-01';
          const effEnd = s.endDate || '9999-12-31';
          if (effStart <= fyEnd && effEnd >= fyStart) return true;
        }
        const hasOtInFy = otRecords.some(
          (o) => o.staffName === s.name && o.date >= fyStart && o.date <= fyEnd
        );
        const hasLeaveInFy = leaves.some(
          (l) => l.staffName === s.name && l.endDate >= fyStart && l.startDate <= fyEnd
        );
        return hasOtInFy || hasLeaveInFy;
      })
      .sort(compareStaffByPositionAndStartDate);
  }, [staffList, otRecords, leaves, selectedFiscalYear]);

  const fiscalSummaryData = useMemo(() => {
    const targetCeEndYear = selectedFiscalYear - 543;
    const targetCeStartYear = targetCeEndYear - 1;
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return summaryEligibleStaff.map((staff) => {
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
        const lastDay = new Date(year, Number(m.key), 0).getDate();
        const monthStart = `${ymPrefix}-01`;
        const monthEnd = `${ymPrefix}-${String(lastDay).padStart(2, '0')}`;

        const staffOts = otRecords.filter(
          (o) => o.staffName === staff.name && o.date.startsWith(ymPrefix)
        );
        const otCount = staffOts.length;
        const otClinics = Array.from(new Set(staffOts.map((o) => o.workClinic)));

        const staffLeaves = leaves.filter((l) => {
          const lStart = l.startDate || '';
          const lEnd = l.endDate || lStart;
          return l.staffName === staff.name && lStart <= monthEnd && lEnd >= monthStart;
        });
        const leaveDays = staffLeaves.reduce((sum, l) => {
          const lStart = l.startDate || '';
          const lEnd = l.endDate || lStart;
          if (lStart >= monthStart && lEnd <= monthEnd) {
            return sum + (Number(l.days) || 1);
          }
          const overlapStart = lStart > monthStart ? lStart : monthStart;
          const overlapEnd = lEnd < monthEnd ? lEnd : monthEnd;
          if (overlapStart > overlapEnd) return sum;
          return sum + countGovernmentWorkdaysInRange(overlapStart, overlapEnd, customHolidays);
        }, 0);
        const leaveTypes = Array.from(
          new Set(staffLeaves.map((l) => `${l.leaveType} (${l.days} วัน)`))
        );

        let inTimeDays = 0;
        const isNotYetStarted = Boolean(staff.startDate && staff.startDate > monthEnd);
        const isAlreadyEnded = Boolean(staff.endDate && staff.endDate < monthStart);
        const isInactiveWithoutEndDate = staff.status !== 'Active' && !staff.endDate;

        if (!isNotYetStarted && !isAlreadyEnded && !isInactiveWithoutEndDate) {
          const effectiveStart =
            staff.startDate && staff.startDate > monthStart ? staff.startDate : monthStart;
          const effectiveEnd =
            staff.endDate && staff.endDate < monthEnd ? staff.endDate : monthEnd;

          if (ymPrefix <= currentYm && effectiveStart <= effectiveEnd) {
            const baseWorkDays = countGovernmentWorkdaysInRange(
              effectiveStart,
              effectiveEnd,
              customHolidays
            );
            inTimeDays = Math.max(0, baseWorkDays - leaveDays);
          }
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
  }, [summaryEligibleStaff, otRecords, leaves, selectedFiscalYear, fiscalMonths, customHolidays]);

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
      .sort((a, b) => compareStaffByPositionAndStartDate(a.staff, b.staff));
  }, [fiscalSummaryData, clinicFilter, staffFilter, summarySearchQuery]);

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

  // --- Image 4 Official Leave Report Data & Columns ---
  const leaveReportColumns = useMemo(() => {
    const coreCols: { type: string; shortLabel: string }[] = [
      { type: 'ลาพักผ่อน', shortLabel: 'พักผ่อน' },
      { type: 'ลาป่วย', shortLabel: 'ป่วย' },
      { type: 'ลากิจ', shortLabel: 'กิจ' },
      { type: 'ลาคลอด', shortLabel: 'คลอด' },
    ];
    const coreTypesSet = new Set(coreCols.map((c) => c.type));
    const extraTypes = new Set<string>();
    leaveTypes.forEach((lt) => {
      if (!coreTypesSet.has(lt)) extraTypes.add(lt);
    });
    leaves.forEach((lv) => {
      if (lv.leaveType && !coreTypesSet.has(lv.leaveType)) extraTypes.add(lv.leaveType);
    });

    const formatShortCol = (t: string) => {
      if (t === 'ลาบวช') return 'บวช';
      if (t === 'ลาศึกษาต่อ') return 'ศึกษาต่อ';
      if (t === 'ไปอบรม/ประชุม') return 'อบรม/ประชุม';
      return t;
    };

    const extraCols = Array.from(extraTypes).map((t) => ({
      type: t,
      shortLabel: formatShortCol(t),
    }));

    return { coreCols, extraCols, allCols: [...coreCols, ...extraCols] };
  }, [leaveTypes, leaves]);

  const leaveReportData = useMemo(() => {
    const targetCeEndYear = selectedFiscalYear - 543;
    const targetCeStartYear = targetCeEndYear - 1;

    const allowedYearMonths = new Set<string>();
    fiscalMonths.forEach((m) => {
      if (monthFilter === 'ALL' || m.key === monthFilter) {
        const y = m.yearOffset === -1 ? targetCeStartYear : targetCeEndYear;
        allowedYearMonths.add(`${y}-${m.key}`);
      }
    });

    const periodLeaves = leaves.filter((lv) => {
      const startYm = (lv.startDate || '').slice(0, 7);
      const endYm = (lv.endDate || lv.startDate || '').slice(0, 7);
      if (allowedYearMonths.has(startYm) || allowedYearMonths.has(endYm)) return true;
      for (const ym of allowedYearMonths) {
        if (startYm && endYm && startYm <= ym && endYm >= ym) return true;
      }
      return false;
    });

    // Build roster combining activeStaff + any unlinked leave staff in the period
    const rosterMap = new Map<
      string,
      { id: string; name: string; position: StaffPosition; clinic: string; startDate?: string }
    >();
    activeStaff.forEach((s) => {
      rosterMap.set(s.name, {
        id: s.staffId,
        name: s.name,
        position: s.position,
        clinic: s.homeClinic,
        startDate: s.startDate,
      });
    });
    periodLeaves.forEach((lv) => {
      if (!rosterMap.has(lv.staffName)) {
        const matchedStaff = staffList.find((s) => s.name === lv.staffName);
        rosterMap.set(lv.staffName, {
          id: matchedStaff?.staffId || `UNLINKED-${lv.staffName}`,
          name: lv.staffName,
          position: lv.position,
          clinic: lv.clinic || '-',
          startDate: matchedStaff?.startDate,
        });
      }
    });

    const q = summarySearchQuery.toLowerCase().trim();
    const filteredRoster = Array.from(rosterMap.values())
      .filter((person) => {
        if (clinicFilter !== 'ALL' && person.clinic !== clinicFilter) return false;
        if (staffFilter !== 'ALL' && person.id !== staffFilter) return false;
        if (q) {
          const match =
            person.name.toLowerCase().includes(q) ||
            person.clinic.toLowerCase().includes(q) ||
            person.position.toLowerCase().includes(q) ||
            formatPositionLabel(person.position).toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .sort(compareStaffByPositionAndStartDate);

    const rows = filteredRoster
      .map((person) => {
        const personLeaves = periodLeaves
          .filter((lv) => lv.staffName === person.name)
          .sort((a, b) => a.startDate.localeCompare(b.startDate));

        const daysByType: Record<string, number> = {};
        let totalLeaveDays = 0;

        personLeaves.forEach((lv) => {
          const d = Number(lv.days) || 1;
          daysByType[lv.leaveType] = (daysByType[lv.leaveType] || 0) + d;
          totalLeaveDays += d;
        });

        const details = personLeaves.map((lv) => {
          const rangeText = formatThaiLeaveRange(lv.startDate, lv.endDate);
          const reasonSuffix = lv.note && lv.note.trim() ? ` (เหตุผล: ${lv.note.trim()})` : '';
          return `${lv.leaveType} ${lv.days} วัน ${rangeText}${reasonSuffix}`;
        });

        const { firstName, lastName } = splitThaiName(person.name);

        return {
          id: person.id,
          fullName: person.name,
          firstName,
          lastName,
          position: person.position,
          clinic: person.clinic,
          daysByType,
          totalLeaveDays,
          details,
        };
      })
      .filter((row) => !onlyStaffWithLeaves || row.totalLeaveDays > 0);

    const totalsByType: Record<string, number> = {};
    leaveReportColumns.allCols.forEach((c) => {
      totalsByType[c.type] = rows.reduce((sum, r) => sum + (r.daysByType[c.type] || 0), 0);
    });
    const grandTotalDays = rows.reduce((sum, r) => sum + r.totalLeaveDays, 0);

    return { rows, totalsByType, grandTotalDays };
  }, [
    selectedFiscalYear,
    fiscalMonths,
    monthFilter,
    leaves,
    activeStaff,
    staffList,
    clinicFilter,
    staffFilter,
    summarySearchQuery,
    onlyStaffWithLeaves,
    leaveReportColumns,
  ]);

  const leaveReportPeriodLabel = useMemo(() => {
    if (monthFilter === 'ALL') {
      return `ปีงบประมาณ ${selectedFiscalYear} (ต.ค. ${String(selectedFiscalYear - 1).slice(-2)} - ก.ย. ${String(selectedFiscalYear).slice(-2)})`;
    }
    const m = fiscalMonths.find((fm) => fm.key === monthFilter);
    const beYear = m?.yearOffset === -1 ? selectedFiscalYear - 1 : selectedFiscalYear;
    return `เดือน ${m?.fullName || monthFilter} พ.ศ. ${beYear}`;
  }, [monthFilter, selectedFiscalYear, fiscalMonths]);

  const exportLeaveReportCsv = () => {
    const headers = [
      'ลำดับ',
      'ชื่อ',
      'สกุล',
      'ตำแหน่ง',
      'คลินิกสังกัด',
      ...leaveReportColumns.allCols.map((c) => c.shortLabel),
      'รวมวันลา (วัน)',
      'เหตุผลการลาและวันที่ลา',
    ];
    const rows = leaveReportData.rows.map((r, i) => [
      i + 1,
      `"${r.firstName}"`,
      `"${r.lastName}"`,
      `"${formatPositionLabel(r.position)}"`,
      `"${r.clinic}"`,
      ...leaveReportColumns.allCols.map((c) => r.daysByType[c.type] || 0),
      r.totalLeaveDays,
      `"${r.details.join(' | ') || '-'}"`,
    ]);
    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `รายงานการลา_หน่วยการพยาบาลผู้ป่วยนอก_ปีงบ_${selectedFiscalYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportLeaveJpeg = async () => {
    if (!leaveReportRef.current || isExportingLeaveJpeg) return;
    setIsExportingLeaveJpeg(true);
    try {
      await exportElementAsJpeg(
        leaveReportRef.current,
        `รายงานสรุปวันลา_หน่วยการพยาบาลผู้ป่วยนอก_ปีงบ_${selectedFiscalYear}.jpeg`
      );
    } finally {
      setIsExportingLeaveJpeg(false);
    }
  };

  const handlePrintLeaveReport = () => {
    setPrintTarget('LEAVE_REPORT');
    setTimeout(() => {
      window.print();
    }, 60);
  };

  return (
    <div className="space-y-6">
      {/* Tab Header Banner (Hidden on Print) */}
      <div className="no-print bg-gradient-to-r from-teal-50 via-cyan-50 to-emerald-50 border border-teal-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
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
                  {leaveTypes.map((lt) => (
                    <option key={lt} value={lt}>
                      {lt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    วันที่เริ่มต้นลา (พ.ศ.) <span className="text-red-500">*</span>
                  </label>
                  <ThaiDateInput
                    value={leaveStartDate}
                    onChange={handleStartDateChange}
                    selectClassName="w-full text-xs rounded-lg border border-gray-300 py-2 pl-2.5 pr-8 bg-white font-medium text-gray-900 outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    วันที่สิ้นสุดลา (พ.ศ.) <span className="text-red-500">*</span>
                  </label>
                  <ThaiDateInput
                    value={leaveEndDate}
                    onChange={handleEndDateChange}
                    selectClassName="w-full text-xs rounded-lg border border-gray-300 py-2 pl-2.5 pr-8 bg-white font-medium text-gray-900 outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  จำนวนวันลา (นับเฉพาะวันราชการ - คำนวณอัตโนมัติ)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={leaveDays}
                  onChange={(e) => setLeaveDays(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full text-sm font-bold text-center rounded-lg border-gray-300 bg-amber-50/50 py-1.5 px-3 border text-amber-900"
                />
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/80 p-2.5 text-[11px] space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-1 text-slate-700">
                    <span>
                      รวมปฏิทิน <strong>{leaveDayStats.totalCalendarDays}</strong> วัน →{' '}
                      <strong className="text-emerald-800">
                        วันราชการ {leaveDayStats.workDays} วัน
                      </strong>
                    </span>
                    {leaveDayStats.weekendCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700 font-medium">
                        ตัดเสาร์-อาทิตย์ {leaveDayStats.weekendCount} วัน
                      </span>
                    )}
                  </div>
                  {leaveDayStats.holidaysInRange.length > 0 && (
                    <div className="text-rose-800 space-y-0.5 pt-1 border-t border-slate-200/80">
                      <div className="font-semibold">
                        ตัดวันหยุดนักขัตฤกษ์ / วันหยุด รพ. ({leaveDayStats.holidaysInRange.length} วัน):
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[10px]">
                        {leaveDayStats.holidaysInRange.map((h) => (
                          <li key={h.date}>
                            {formatThaiShortDate(h.date)} — {h.name}
                            {h.isCustom ? ' (วันหยุดพิเศษ รพ.)' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {leaveDayStats.workDays === 0 && (
                    <div className="text-amber-800 font-medium pt-0.5">
                      * ช่วงวันที่เลือกตรงกับวันหยุดทั้งหมด (สามารถแก้ไขเป็น 0.5 หรือระบุจำนวนวันเองได้)
                    </div>
                  )}
                </div>
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
                      {leaveTypes.map((lt) => (
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
                                <div className="text-[10px] text-gray-500 truncate max-w-[200px]" title={lv.note}>
                                  {lv.note}
                                </div>
                              )}
                              {lv.lastEditReason && (
                                <div
                                  className="text-[10px] text-blue-700 bg-blue-50/80 border border-blue-100 rounded px-1.5 py-0.5 mt-1 inline-block"
                                  title={`แก้ไขโดย ${lv.lastEditedBy || 'Admin'} เมื่อ ${lv.lastEditedAt ? formatThaiDateTime(lv.lastEditedAt) : '-'}`}
                                >
                                  แก้ไข: {lv.lastEditReason}
                                  {lv.lastEditedAt ? ` • ${formatThaiDateTime(lv.lastEditedAt)}` : ''}
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
                            <td className="py-2 px-2 text-center text-[11px] text-gray-600 whitespace-nowrap">
                              {lv.startDate === lv.endDate
                                ? formatThaiShortDate(lv.startDate)
                                : `${formatThaiShortDate(lv.startDate)} ถึง ${formatThaiShortDate(lv.endDate)}`}
                            </td>
                            <td className="py-2 px-2 text-center font-bold text-gray-800">
                              {lv.days}
                            </td>
                            <td className="py-2 px-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                {isAdmin && onUpdateLeave && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingLeave({ ...lv });
                                      setEditLeaveReason('');
                                      setEditLeaveReasonError('');
                                    }}
                                    className="text-gray-400 hover:text-blue-600 p-1 cursor-pointer"
                                    title="แก้ไขรายการและระบุเหตุผล (Admin)"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {isAdmin ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeletingLeave(lv);
                                      setDeleteLeaveReason('');
                                      setDeleteLeaveReasonError('');
                                    }}
                                    className="text-gray-400 hover:text-red-500 p-1 cursor-pointer"
                                    title="ลบรายการและบันทึกเหตุผล (Admin)"
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

              {/* Leave Audit Log Section */}
              {auditLogs.filter((a) => a.action === 'แก้ไขวันลา' || a.action === 'ลบวันลา').length > 0 && (
                <div className="pt-2 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={() => setShowLeaveAuditLog((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-amber-700 cursor-pointer"
                  >
                    <History className="w-3.5 h-3.5 text-amber-600" />
                    <span>
                      ประวัติการแก้ไข / ลบวันลา (
                      {auditLogs.filter((a) => a.action === 'แก้ไขวันลา' || a.action === 'ลบวันลา').length}{' '}
                      รายการ)
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${showLeaveAuditLog ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {showLeaveAuditLog && (
                    <div className="mt-2.5 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {auditLogs
                        .filter((a) => a.action === 'แก้ไขวันลา' || a.action === 'ลบวันลา')
                        .map((log) => (
                          <div
                            key={log.id}
                            className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] flex flex-col gap-1"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                                    log.action === 'ลบวันลา'
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-blue-100 text-blue-800'
                                  }`}
                                >
                                  {log.action}
                                </span>
                                <span className="font-bold text-gray-900">{log.targetName}</span>
                              </div>
                              <span className="text-[10px] text-gray-500">
                                {formatThaiDateTime(log.timestamp)}
                                {log.editedBy ? ` • โดย ${log.editedBy}` : ''}
                              </span>
                            </div>
                            <div className="text-gray-600">{log.summary}</div>
                            <div className="text-amber-900 font-semibold">
                              เหตุผล: {log.reason}
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
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
                      วันที่ปฏิบัติงานเวร (พ.ศ.) <span className="text-red-500">*</span>
                    </label>
                    <ThaiDateInput
                      value={otDate}
                      onChange={setOtDate}
                      selectClassName="w-full text-xs rounded-lg border border-gray-300 py-2 pl-2.5 pr-8 bg-white font-medium text-gray-900 outline-none focus:border-teal-500"
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
                            {formatThaiShortDate(o.date)}
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
                            {o.lastEditReason && (
                              <div
                                className="text-[10px] text-blue-700 bg-blue-50/80 border border-blue-100 rounded px-1.5 py-0.5 mt-1 inline-block"
                                title={`แก้ไขโดย ${o.lastEditedBy || 'Admin'} เมื่อ ${o.lastEditedAt ? formatThaiDateTime(o.lastEditedAt) : '-'}`}
                              >
                                แก้ไข: {o.lastEditReason}
                                {o.lastEditedAt ? ` • ${formatThaiDateTime(o.lastEditedAt)}` : ''}
                              </div>
                            )}
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
                                  onClick={() => {
                                    setEditingOT({ ...o });
                                    setEditOtReason('');
                                    setEditOtReasonError('');
                                  }}
                                  className="text-gray-400 hover:text-blue-600 p-1 cursor-pointer"
                                  title="แก้ไขรายการและระบุเหตุผล (Admin)"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDeletingOT(o);
                                    setDeleteOtReason('');
                                    setDeleteOtReasonError('');
                                  }}
                                  className="text-gray-400 hover:text-red-500 p-1 cursor-pointer"
                                  title="ลบรายการและบันทึกเหตุผล (Admin)"
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

            {/* OT Audit Log Section */}
            {auditLogs.filter((a) => a.action === 'แก้ไขเวร OT' || a.action === 'ลบเวร OT').length > 0 && (
              <div className="pt-2 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowOtAuditLog((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:text-teal-700 cursor-pointer"
                >
                  <History className="w-3.5 h-3.5 text-teal-600" />
                  <span>
                    ประวัติการแก้ไข / ลบเวร OT (
                    {auditLogs.filter((a) => a.action === 'แก้ไขเวร OT' || a.action === 'ลบเวร OT').length}{' '}
                    รายการ)
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${showOtAuditLog ? 'rotate-180' : ''}`}
                  />
                </button>

                {showOtAuditLog && (
                  <div className="mt-2.5 space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {auditLogs
                      .filter((a) => a.action === 'แก้ไขเวร OT' || a.action === 'ลบเวร OT')
                      .map((log) => (
                        <div
                          key={log.id}
                          className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] flex flex-col gap-1"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`px-1.5 py-0.5 rounded font-bold text-[10px] ${
                                  log.action === 'ลบเวร OT'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-blue-100 text-blue-800'
                                }`}
                              >
                                {log.action}
                              </span>
                              <span className="font-bold text-gray-900">{log.targetName}</span>
                            </div>
                            <span className="text-[10px] text-gray-500">
                              {formatThaiDateTime(log.timestamp)}
                              {log.editedBy ? ` • โดย ${log.editedBy}` : ''}
                            </span>
                          </div>
                          <div className="text-gray-600">{log.summary}</div>
                          <div className="text-teal-900 font-semibold">
                            เหตุผล: {log.reason}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- SUB-TAB 3: FISCAL YEAR SUMMARY (12 MONTHS / MONTHLY / CLINIC / INDIVIDUAL) --- */}
      {activeSubTab === 'fiscalSummary' && (
        <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4 print:border-none print:shadow-none print:p-0">
          {/* Header Title & Actions (Hidden on Print) */}
          <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b pb-4">
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

          {/* Sub-view Switcher inside Summary */}
          <div className="no-print flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200/80 rounded-xl p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSummaryReportMode('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  summaryReportMode === 'ALL'
                    ? 'bg-teal-700 text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:text-teal-800 border border-gray-200'
                }`}
              >
                แสดงทั้งหมด (วันทำงาน + รายงานการลา)
              </button>
              <button
                type="button"
                onClick={() => setSummaryReportMode('LEAVE_REPORT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  summaryReportMode === 'LEAVE_REPORT'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:text-amber-800 border border-gray-200'
                }`}
              >
                รายงานสรุปวันลารายบุคคล (แบบฟอร์ม)
              </button>
              <button
                type="button"
                onClick={() => setSummaryReportMode('WORK_OT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  summaryReportMode === 'WORK_OT'
                    ? 'bg-blue-700 text-white shadow-2xs'
                    : 'bg-white text-gray-600 hover:text-blue-800 border border-gray-200'
                }`}
              >
                ตารางวันทำงานในเวลา &amp; เวร OT
              </button>
            </div>
          </div>

          {/* Interactive Filters Grid (Hidden on Print) */}
          <div className="no-print bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-3">
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
                  <option value="ALL">-- บุคลากรทุกคน ({summaryEligibleStaff.length} คน) --</option>
                  {summaryEligibleStaff.map((s) => (
                    <option key={s.staffId} value={s.staffId}>
                      {s.name} ({formatPositionLabel(s.position)} - {s.homeClinic})
                      {s.status !== 'Active' ? ` [${s.status}]` : ''}
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

          {/* KPI Metrics Cards (Hidden on Print) */}
          <div className="no-print grid grid-cols-2 sm:grid-cols-4 gap-3">
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
              <span className="text-[10px] text-blue-500">วันราชการ (จ.-ศ. หักวันหยุด) - วันลา</span>
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

          {/* VIEW A & B: Work & OT Summary Grid */}
          {summaryReportMode !== 'LEAVE_REPORT' && (
            <div className={printTarget === 'LEAVE_REPORT' ? 'no-print' : ''}>
              {monthFilter === 'ALL' ? (
            <div className="overflow-x-auto border border-gray-200 rounded-xl print-fit-container">
              <table className="w-full text-left text-xs print:text-[8px] print-fit-table">
                <thead className="bg-slate-100 text-slate-800 font-bold border-b text-[11px] print:text-[8px]">
                  <tr>
                    <th className="py-2.5 px-3 whitespace-nowrap print:w-[82px] print:px-1 print:py-1">ชื่อ - นามสกุล</th>
                    <th className="py-2.5 px-2 text-center whitespace-nowrap print:w-[58px] print:px-0.5 print:py-1">ตำแหน่ง</th>
                    <th className="py-2.5 px-2 whitespace-nowrap print:w-[54px] print:px-0.5 print:py-1">หน่วยงานสังกัด</th>
                    {fiscalMonths.map((m) => {
                      const ceEnd = selectedFiscalYear - 543;
                      const mYear = m.yearOffset === -1 ? ceEnd - 1 : ceEnd;
                      const mLast = new Date(mYear, Number(m.key), 0).getDate();
                      const mGovDays = countGovernmentWorkdaysInRange(
                        `${mYear}-${m.key}-01`,
                        `${mYear}-${m.key}-${String(mLast).padStart(2, '0')}`,
                        customHolidays
                      );
                      return (
                        <th
                          key={m.key}
                          className="py-2.5 px-2 text-center bg-slate-200/50 whitespace-nowrap print:px-0.5 print:py-1"
                          title={`${m.fullName} ${mYear + 543}: วันราชการ ${mGovDays} วัน (จ.-ศ. หักวันหยุด)`}
                        >
                          <div>{m.name}</div>
                          <div className="text-[9px] font-medium text-slate-500 print:text-[7px]">
                            ({mGovDays}ว)
                          </div>
                        </th>
                      );
                    })}
                    <th className="py-2.5 px-2 text-center bg-blue-50 text-blue-900 whitespace-nowrap print:w-[28px] print:px-0.5 print:py-1">
                      ในเวลา
                    </th>
                    <th className="py-2.5 px-2 text-center bg-purple-50 text-purple-900 whitespace-nowrap print:w-[28px] print:px-0.5 print:py-1">
                      เวร OT
                    </th>
                    <th className="py-2.5 px-2 text-center bg-amber-50 text-amber-900 whitespace-nowrap print:w-[26px] print:px-0.5 print:py-1">
                      วันลา
                    </th>
                    <th className="py-2.5 px-3 text-center bg-teal-700 text-white font-extrabold whitespace-nowrap print:w-[32px] print:px-0.5 print:py-1">
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
                          <td className="py-2 px-3 font-semibold text-gray-900 whitespace-nowrap print:whitespace-normal print:px-1 print:py-1">
                            {staff.name}
                          </td>
                          <td className="py-2 px-2 text-center print:px-0.5 print:py-1">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap print:whitespace-normal print:px-0.5 print:text-[7.5px] ${
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
                          <td className="py-2 px-2 text-gray-600 truncate max-w-[130px] print:max-w-none print:whitespace-normal print:px-0.5 print:py-1">
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
                                className={`py-2 px-1.5 text-center text-[11px] print:text-[7.5px] print:px-0.5 print:py-1 ${
                                  val > 0 ? 'font-bold text-teal-950' : 'text-gray-300'
                                }`}
                                title={`ในเวลา: ${inTime} วัน, OT: ${ot} เวร, ลา: ${detail?.leaves || 0} วัน`}
                              >
                                {val > 0 ? (
                                  shiftFilter === 'ALL' ? (
                                    <span className="inline-flex flex-col items-center">
                                      <span>{val}</span>
                                      <span className="text-[9px] print:text-[6.5px] font-normal text-gray-400">
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

                          <td className="py-2 px-2 text-center font-bold text-blue-900 bg-blue-50/50 print:px-0.5 print:py-1">
                            {totalInTime}
                          </td>
                          <td className="py-2 px-2 text-center font-bold text-purple-900 bg-purple-50/50 print:px-0.5 print:py-1">
                            {totalOT}
                          </td>
                          <td className="py-2 px-2 text-center text-amber-800 bg-amber-50/50 print:px-0.5 print:py-1">
                            {totalLeaves > 0 ? totalLeaves : '-'}
                          </td>
                          <td className="py-2 px-3 text-center font-black text-sm print:text-[8.5px] text-teal-950 bg-teal-50 print:px-0.5 print:py-1">
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
            <div className="overflow-x-auto border border-gray-200 rounded-xl print-fit-container">
              <table className="w-full text-left text-xs print:text-[9px] print-fit-table">
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

          {/* OFFICIAL LEAVE SUMMARY REPORT (Image 4 Form + Leave Reason & Thai Date Range) */}
          {summaryReportMode !== 'WORK_OT' && (
            <div className="space-y-3 pt-4 border-t border-gray-200 print:border-none print:pt-0">
              <div className="no-print flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-amber-600" />
                    <span>รายงานสรุปวันลาประจำหน่วยงาน (แยกประเภทการลา พร้อมเหตุผลและวันที่ลา)</span>
                  </h4>
                  <p className="text-[11px] text-gray-500">
                    อ้างอิงตามช่วงเวลาและตัวกรองด้านบน • ช่วงข้อมูล: {leaveReportPeriodLabel}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 bg-slate-100 hover:bg-slate-200/70 px-2.5 py-1.5 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyStaffWithLeaves}
                      onChange={(e) => setOnlyStaffWithLeaves(e.target.checked)}
                      className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>แสดงเฉพาะผู้ที่มีประวัติลา</span>
                  </label>

                  <button
                    type="button"
                    onClick={exportLeaveReportCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-2xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>ส่งออก CSV รายงานการลา</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportLeaveJpeg}
                    disabled={isExportingLeaveJpeg}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white rounded-lg shadow-2xs cursor-pointer"
                  >
                    <ImageDown className="w-3.5 h-3.5" />
                    <span>{isExportingLeaveJpeg ? 'กำลังสร้างรูป...' : 'บันทึกเป็น .JPEG'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handlePrintLeaveReport}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg shadow-2xs cursor-pointer"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>พิมพ์รายงาน / PDF</span>
                  </button>
                </div>
              </div>

              <div
                ref={leaveReportRef}
                className="bg-white border border-gray-300 rounded-xl p-4 sm:p-6 space-y-4 print:border-none print:p-0 print:space-y-2 print:w-full"
              >
                <div className="text-center space-y-1 border-b border-gray-300 pb-3 print:pb-2">
                  <div className="text-sm sm:text-base font-extrabold text-gray-900 print:text-sm">
                    ชื่อหน่วยงาน : หน่วยการพยาบาลผู้ป่วยนอก
                  </div>
                  <div className="text-xs text-gray-600 font-medium print:text-[10px]">
                    รายงานสรุปวันลาบุคลากร • {leaveReportPeriodLabel}
                    {clinicFilter !== 'ALL' ? ` • คลินิก: ${clinicFilter}` : ''}
                  </div>
                </div>

                <div className="overflow-x-auto print-fit-container">
                  <table className="w-full text-xs border-collapse border border-gray-400 print:text-[8.5px] print-fit-table">
                    <thead className="bg-slate-100 text-gray-900 font-bold">
                      <tr>
                        <th className="border border-gray-400 py-2 px-2 text-center w-12 print:w-[26px] print:px-0.5 print:py-1">
                          ลำดับ
                        </th>
                        <th className="border border-gray-400 py-2 px-2.5 text-left whitespace-nowrap print:w-[68px] print:whitespace-normal print:px-1 print:py-1">
                          ชื่อ
                        </th>
                        <th className="border border-gray-400 py-2 px-2.5 text-left whitespace-nowrap print:w-[74px] print:whitespace-normal print:px-1 print:py-1">
                          สกุล
                        </th>
                        <th className="border border-gray-400 py-2 px-2 text-center whitespace-nowrap print:w-[76px] print:whitespace-normal print:px-1 print:py-1">
                          ตำแหน่ง
                        </th>
                        {leaveReportColumns.allCols.map((col) => (
                          <th
                            key={col.type}
                            className="border border-gray-400 py-2 px-2 text-center whitespace-nowrap min-w-[58px] print:min-w-0 print:whitespace-normal print:px-0.5 print:py-1 print:leading-tight"
                            title={col.type}
                          >
                            {col.shortLabel}
                          </th>
                        ))}
                        <th className="border border-gray-400 py-2 px-2 text-center bg-amber-50 whitespace-nowrap print:w-[34px] print:whitespace-normal print:px-0.5 print:py-1 print:leading-tight">
                          รวมวันลา
                        </th>
                        <th className="border border-gray-400 py-2 px-3 text-left min-w-[260px] print:min-w-0 print:w-[140px] print:px-1 print:py-1 print:leading-tight">
                          เหตุผลการลาและวันที่ลา
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaveReportData.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6 + leaveReportColumns.allCols.length}
                            className="border border-gray-400 py-8 text-center text-gray-400"
                          >
                            ไม่พบข้อมูลการลาในตัวกรองที่เลือก
                          </td>
                        </tr>
                      ) : (
                        leaveReportData.rows.map((row, idx) => (
                          <tr
                            key={row.id}
                            className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}
                          >
                            <td className="border border-gray-400 py-1.5 px-2 text-center text-gray-700 font-medium print:px-0.5 print:py-1">
                              {idx + 1}
                            </td>
                            <td className="border border-gray-400 py-1.5 px-2.5 text-gray-900 font-semibold whitespace-nowrap print:whitespace-normal print:px-1 print:py-1 print:leading-tight">
                              {row.firstName}
                            </td>
                            <td className="border border-gray-400 py-1.5 px-2.5 text-gray-900 whitespace-nowrap print:whitespace-normal print:px-1 print:py-1 print:leading-tight">
                              {row.lastName}
                            </td>
                            <td className="border border-gray-400 py-1.5 px-2 text-center font-semibold text-gray-800 whitespace-nowrap print:whitespace-normal print:px-1 print:py-1 print:leading-tight">
                              {formatPositionLabel(row.position)}
                            </td>
                            {leaveReportColumns.allCols.map((col) => {
                              const val = row.daysByType[col.type] || 0;
                              return (
                                <td
                                  key={col.type}
                                  className={`border border-gray-400 py-1.5 px-2 text-center print:px-0.5 print:py-1 ${
                                    val > 0 ? 'font-bold text-amber-900 bg-amber-50/40' : 'text-gray-400'
                                  }`}
                                >
                                  {val > 0 ? val : ''}
                                </td>
                              );
                            })}
                            <td className="border border-gray-400 py-1.5 px-2 text-center font-extrabold text-amber-950 bg-amber-50/60 print:px-0.5 print:py-1">
                              {row.totalLeaveDays > 0 ? row.totalLeaveDays : ''}
                            </td>
                            <td className="border border-gray-400 py-1.5 px-3 text-[11px] text-gray-800 print:px-1 print:py-1 print:text-[8px] print:leading-tight">
                              {row.details.length > 0 ? (
                                <ul className="space-y-0.5 list-disc list-inside print:list-outside print:pl-2.5">
                                  {row.details.map((d, dIdx) => (
                                    <li key={dIdx}>{d}</li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    {leaveReportData.rows.length > 0 && (
                      <tfoot className="bg-slate-100 font-bold text-gray-900">
                        <tr>
                          <td colSpan={4} className="border border-gray-400 py-2 px-3 text-right print:px-1 print:py-1">
                            รวมทั้งหมด ({leaveReportData.rows.length} คน)
                          </td>
                          {leaveReportColumns.allCols.map((col) => (
                            <td key={col.type} className="border border-gray-400 py-2 px-2 text-center print:px-0.5 print:py-1">
                              {leaveReportData.totalsByType[col.type] > 0
                                ? leaveReportData.totalsByType[col.type]
                                : '-'}
                            </td>
                          ))}
                          <td className="border border-gray-400 py-2 px-2 text-center bg-amber-100 text-amber-950 font-extrabold print:px-0.5 print:py-1">
                            {leaveReportData.grandTotalDays}
                          </td>
                          <td className="border border-gray-400 py-2 px-3 text-[11px] text-gray-600 font-normal print:px-1 print:py-1 print:text-[8px]">
                            หน่วยนับ: วันทำการ/วันลา
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>

                <div className="pt-4 grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-6 text-center text-xs print:text-[10px] text-gray-700 print:break-inside-avoid">
                  <div>
                    <p className="mb-8">ผู้จัดทำรายงาน</p>
                    <p>ลงชื่อ......................................................</p>
                    <p className="mt-1">(......................................................)</p>
                  </div>
                  <div>
                    <p className="mb-8">ผู้ตรวจทาน / รับรองข้อมูล</p>
                    <p>ลงชื่อ......................................................</p>
                    <p className="mt-1">(หัวหน้าหน่วยการพยาบาลผู้ป่วยนอก)</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Admin Edit Leave Modal (Mandatory Reason + Timestamp) */}
      {editingLeave && onUpdateLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-200 p-6 space-y-4">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ตั้งแต่วันที่ (พ.ศ.)</label>
                  <ThaiDateInput
                    value={editingLeave.startDate}
                    onChange={(nextStart) => {
                      const nextEnd = editingLeave.endDate >= nextStart ? editingLeave.endDate : nextStart;
                      const autoWorkDays = countGovernmentWorkdaysInRange(nextStart, nextEnd, customHolidays);
                      setEditingLeave({
                        ...editingLeave,
                        startDate: nextStart,
                        endDate: nextEnd,
                        days: autoWorkDays,
                      });
                    }}
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ถึงวันที่ (พ.ศ.)</label>
                  <ThaiDateInput
                    value={editingLeave.endDate}
                    onChange={(nextDate) => {
                      const nextEnd = nextDate >= editingLeave.startDate ? nextDate : editingLeave.startDate;
                      const autoWorkDays = countGovernmentWorkdaysInRange(editingLeave.startDate, nextEnd, customHolidays);
                      setEditingLeave({
                        ...editingLeave,
                        endDate: nextEnd,
                        days: autoWorkDays,
                      });
                    }}
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
                    {leaveTypes.map((lt) => (
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
                <label className="block font-semibold text-gray-700 mb-1">หมายเหตุการลา</label>
                <input
                  type="text"
                  value={editingLeave.note || ''}
                  onChange={(e) => setEditingLeave({ ...editingLeave, note: e.target.value })}
                  placeholder="เช่น ใบรับรองแพทย์, ลาพักผ่อนประจำปี"
                  className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs"
                />
              </div>

              {/* Mandatory Edit Reason */}
              <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
                <label className="block font-bold text-amber-950">
                  เหตุผลการแก้ไขรายการ (บังคับระบุ) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editLeaveReason}
                  onChange={(e) => {
                    setEditLeaveReason(e.target.value);
                    setEditLeaveReasonError('');
                  }}
                  placeholder="เช่น เปลี่ยนจากลาพักผ่อนเป็นลาป่วย, แก้ไขช่วงวันที่ลา"
                  className="w-full px-2.5 py-2 border border-amber-300 rounded-lg text-xs bg-white font-medium"
                />
                <div className="flex flex-wrap gap-1">
                  {[
                    'เปลี่ยนจากลาพักผ่อนเป็นลาป่วย',
                    'เปลี่ยนประเภทการลา',
                    'แก้ไขช่วงวันที่ลา',
                    'ปรับแก้จำนวนวันลา',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setEditLeaveReason(preset);
                        setEditLeaveReasonError('');
                      }}
                      className="px-2 py-0.5 text-[10px] rounded-md bg-white border border-amber-200 text-amber-900 hover:bg-amber-100 cursor-pointer"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
                {editLeaveReasonError && (
                  <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{editLeaveReasonError}</span>
                  </p>
                )}
                <p className="text-[10px] text-amber-800">
                  ระบบจะบันทึกเวลาที่แก้ไขอัตโนมัติ: {formatThaiDateTime(new Date().toISOString())}
                </p>
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
                  if (!editLeaveReason.trim()) {
                    setEditLeaveReasonError('กรุณาระบุเหตุผลการแก้ไขรายการก่อนบันทึก');
                    return;
                  }
                  onUpdateLeave(editingLeave, editLeaveReason.trim());
                  setEditingLeave(null);
                  setEditLeaveReason('');
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

      {/* Admin Delete Leave Confirmation Modal (Mandatory Reason + Timestamp) */}
      {deletingLeave && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-red-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                <h3 className="text-base font-bold text-red-950">
                  ยืนยันลบประวัติการลา (ระบุเหตุผล)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingLeave(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-bold text-gray-900">{deletingLeave.staffName}</div>
                <div className="text-gray-600">
                  {deletingLeave.leaveType} • {deletingLeave.days} วัน (
                  {formatThaiLeaveRange(deletingLeave.startDate, deletingLeave.endDate)})
                </div>
              </div>

              <div className="space-y-2">
                <label className="block font-bold text-red-950">
                  เหตุผลการลบรายการ (บังคับระบุ) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={deleteLeaveReason}
                  onChange={(e) => {
                    setDeleteLeaveReason(e.target.value);
                    setDeleteLeaveReasonError('');
                  }}
                  placeholder="เช่น ยกเลิกวันลา, บันทึกซ้ำซ้อน, บันทึกข้อมูลผิดคน"
                  autoFocus
                  className="w-full px-2.5 py-2 border border-red-300 rounded-lg text-xs font-medium"
                />
                <div className="flex flex-wrap gap-1">
                  {['ยกเลิกวันลา', 'เปลี่ยนแผนไม่ลาแล้ว', 'บันทึกข้อมูลซ้ำซ้อน', 'บันทึกผิดคน/ผิดวัน'].map(
                    (preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setDeleteLeaveReason(preset);
                          setDeleteLeaveReasonError('');
                        }}
                        className="px-2 py-0.5 text-[10px] rounded-md bg-red-50 border border-red-200 text-red-900 hover:bg-red-100 cursor-pointer"
                      >
                        + {preset}
                      </button>
                    )
                  )}
                </div>
                {deleteLeaveReasonError && (
                  <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{deleteLeaveReasonError}</span>
                  </p>
                )}
                <p className="text-[10px] text-gray-500">
                  บันทึกเวลาที่ลบอัตโนมัติ: {formatThaiDateTime(new Date().toISOString())}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setDeletingLeave(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!deleteLeaveReason.trim()) {
                    setDeleteLeaveReasonError('กรุณาระบุเหตุผลการลบรายการก่อนยืนยัน');
                    return;
                  }
                  onDeleteLeave(deletingLeave.id, deleteLeaveReason.trim());
                  setDeletingLeave(null);
                  setDeleteLeaveReason('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>ยืนยันลบและบันทึกเหตุผล</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Admin Edit OT Modal (Mandatory Reason + Timestamp) */}
      {editingOT && onUpdateOT && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-200 p-6 space-y-4">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">วันที่ (พ.ศ.)</label>
                  <ThaiDateInput
                    value={editingOT.date}
                    onChange={(nextDate) => setEditingOT({ ...editingOT, date: nextDate })}
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

              {/* Mandatory Edit Reason */}
              <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200 space-y-2">
                <label className="block font-bold text-teal-950">
                  เหตุผลการแก้ไขรายการ (บังคับระบุ) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editOtReason}
                  onChange={(e) => {
                    setEditOtReason(e.target.value);
                    setEditOtReasonError('');
                  }}
                  placeholder="เช่น เปลี่ยนห้องตรวจที่ขึ้นเวร, แก้ไขวันที่/กะเวลาเวร"
                  className="w-full px-2.5 py-2 border border-teal-300 rounded-lg text-xs bg-white font-medium"
                />
                <div className="flex flex-wrap gap-1">
                  {[
                    'เปลี่ยนคลินิกที่ปฏิบัติงาน',
                    'เปลี่ยนวันที่ขึ้นเวร',
                    'แก้ไขกะเวลาเวร',
                    'เปลี่ยนชื่อผู้ปฏิบัติแทน',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setEditOtReason(preset);
                        setEditOtReasonError('');
                      }}
                      className="px-2 py-0.5 text-[10px] rounded-md bg-white border border-teal-200 text-teal-900 hover:bg-teal-100 cursor-pointer"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>
                {editOtReasonError && (
                  <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{editOtReasonError}</span>
                  </p>
                )}
                <p className="text-[10px] text-teal-800">
                  ระบบจะบันทึกเวลาที่แก้ไขอัตโนมัติ: {formatThaiDateTime(new Date().toISOString())}
                </p>
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
                  if (!editOtReason.trim()) {
                    setEditOtReasonError('กรุณาระบุเหตุผลการแก้ไขรายการก่อนบันทึก');
                    return;
                  }
                  onUpdateOT(editingOT, editOtReason.trim());
                  setEditingOT(null);
                  setEditOtReason('');
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

      {/* Admin Delete OT Confirmation Modal (Mandatory Reason + Timestamp) */}
      {deletingOT && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-red-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600" />
                <h3 className="text-base font-bold text-red-950">
                  ยืนยันลบรายการเวร OT (ระบุเหตุผล)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDeletingOT(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <div className="font-bold text-gray-900">{deletingOT.staffName}</div>
                <div className="text-gray-600">
                  {formatThaiShortDate(deletingOT.date)} • {deletingOT.shift} •{' '}
                  {deletingOT.workClinic}
                </div>
              </div>

              <div className="space-y-2">
                <label className="block font-bold text-red-950">
                  เหตุผลการลบรายการ (บังคับระบุ) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={deleteOtReason}
                  onChange={(e) => {
                    setDeleteOtReason(e.target.value);
                    setDeleteOtReasonError('');
                  }}
                  placeholder="เช่น ยกเลิกเวร OT, แลกเวรเปลี่ยนคน, บันทึกซ้ำซ้อน"
                  autoFocus
                  className="w-full px-2.5 py-2 border border-red-300 rounded-lg text-xs font-medium"
                />
                <div className="flex flex-wrap gap-1">
                  {['ยกเลิกเวร OT', 'แลกเวรเปลี่ยนผู้ปฏิบัติงาน', 'บันทึกข้อมูลซ้ำซ้อน', 'บันทึกผิดวัน'].map(
                    (preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setDeleteOtReason(preset);
                          setDeleteOtReasonError('');
                        }}
                        className="px-2 py-0.5 text-[10px] rounded-md bg-red-50 border border-red-200 text-red-900 hover:bg-red-100 cursor-pointer"
                      >
                        + {preset}
                      </button>
                    )
                  )}
                </div>
                {deleteOtReasonError && (
                  <p className="text-[11px] text-red-600 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{deleteOtReasonError}</span>
                  </p>
                )}
                <p className="text-[10px] text-gray-500">
                  บันทึกเวลาที่ลบอัตโนมัติ: {formatThaiDateTime(new Date().toISOString())}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => setDeletingOT(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!deleteOtReason.trim()) {
                    setDeleteOtReasonError('กรุณาระบุเหตุผลการลบรายการก่อนยืนยัน');
                    return;
                  }
                  onDeleteOT(deletingOT.id, deleteOtReason.trim());
                  setDeletingOT(null);
                  setDeleteOtReason('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                <span>ยืนยันลบและบันทึกเหตุผล</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
