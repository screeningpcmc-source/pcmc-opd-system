import React, { useState, useMemo, useEffect } from 'react';
import { User } from 'firebase/auth';
import { 
  StaffMember, 
  StaffPosition, 
  StaffStatus, 
  SystemSettings, 
  ALL_POSITIONS, 
  IN_TIME_CLINICS,
  OUT_TIME_CLINICS,
  DEFAULT_PREMIUM_SUB_CLINICS,
  LEAVE_TYPES,
  POSITION_LABELS,
  formatPositionLabel,
  CustomHoliday,
  AdminPinEntry,
  compareStaffByPositionAndStartDate,
  REFERRAL_CLINIC_NAME,
  isDailyWagePosition,
  DEFAULT_OT_COST_CENTER,
  DEFAULT_OT_CONTROLLER_NAME,
  DEFAULT_OT_HOURLY_RATES,
  getOtHourlyRate,
  getStaffEmployeeCode,
  isLegacyGeneratedStaffId,
  isValidEmployeeCodeValue
} from '../types';
import { markReferralClinicRemovedByAdmin } from '../services/sheetsService';
import { formatThaiShortDate, getLocalTodayIso } from '../utils/thaiDate';
import { getHolidaysForYear } from '../utils/thaiHolidays';
import {
  verifyAdminPinWithOwner,
  DEFAULT_PRIMARY_ADMIN_OWNER,
  DEFAULT_ADDITIONAL_ADMIN_SLOTS,
  buildDefaultAdditionalAdminPins
} from '../services/adminSecurity';
import { ThaiDateInput } from './ThaiDateInput';
import { 
  ShieldCheck, 
  Users, 
  UserPlus, 
  Search, 
  Settings2, 
  FileSpreadsheet, 
  Save, 
  RotateCcw, 
  Check, 
  Sparkles, 
  AlertCircle,
  ExternalLink,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  RefreshCw,
  CheckCircle2,
  Building2,
  Plus,
  Trash2,
  Link2,
  Share2,
  Copy,
  Unlink,
  CalendarOff,
  Pencil,
  Calendar,
  X
} from 'lucide-react';

interface AdminPanelTabProps {
  staffList: StaffMember[];
  settings: SystemSettings;
  inTimeClinics: string[];
  outTimeClinics: string[];
  premiumSubClinics?: string[];
  leaveTypes: string[];
  isAdmin: boolean;
  isAdminUnlocked?: boolean;
  adminOwnerName?: string;
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
  isLoggingIn: boolean;
  onAddStaff: (staff: StaffMember) => void;
  onUpdateStaff?: (staff: StaffMember, previousStaffId?: string) => void;
  onDeleteStaff: (staffId: string) => void;
  onUpdateStaffStatus: (staffId: string, status: StaffStatus) => void;
  onSaveSettings: (settings: SystemSettings) => void;
  onResetData: () => void;
  onSetupSpreadsheet: () => void;
  onSyncSpreadsheet: () => void;
  isSettingUpSheet: boolean;
  isSyncingSheet: boolean;
  onCopyShareLink: () => void;
  onUnlockAdmin?: (pin: string) => boolean;
  onLockAdmin?: () => void;
  lastSyncedAt?: string | null;
  onToggleAutoSync?: (enabled: boolean) => void;
}

export const AdminPanelTab: React.FC<AdminPanelTabProps> = ({
  staffList,
  settings,
  inTimeClinics,
  outTimeClinics,
  premiumSubClinics = [...DEFAULT_PREMIUM_SUB_CLINICS],
  leaveTypes,
  isAdminUnlocked = false,
  adminOwnerName = '',
  user: _user,
  onLogin: _onLogin,
  onLogout: _onLogout,
  isLoggingIn: _isLoggingIn,
  onAddStaff,
  onUpdateStaff,
  onDeleteStaff,
  onUpdateStaffStatus,
  onSaveSettings,
  onResetData,
  onSetupSpreadsheet,
  onSyncSpreadsheet,
  isSettingUpSheet,
  isSyncingSheet,
  onCopyShareLink,
  onUnlockAdmin,
  onLockAdmin,
  lastSyncedAt = null,
  onToggleAutoSync,
}) => {
  // Staff search & filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [positionFilter, setPositionFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [clinicFilter, setClinicFilter] = useState<string>('ALL');

  // Add new staff form state (No visible internal Staff ID, with Employee Code)
  const todayStr = getLocalTodayIso();
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [newEmployeeCode, setNewEmployeeCode] = useState<string>('');
  const [newName, setNewName] = useState<string>('');
  const [newPosition, setNewPosition] = useState<StaffPosition>('RN');
  const [newClinic, setNewClinic] = useState<string>(inTimeClinics[0] || IN_TIME_CLINICS[0]);
  const [newStatus, setNewStatus] = useState<StaffStatus>('Active');
  const [newStartDate, setNewStartDate] = useState<string>(todayStr);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [editingOriginalStaffId, setEditingOriginalStaffId] = useState<string | null>(null);
  const [editModalError, setEditModalError] = useState<string>('');
  const [confirmDeleteStaffId, setConfirmDeleteStaffId] = useState<string | null>(null);
  const [confirmResetAll, setConfirmResetAll] = useState<boolean>(false);
  const [copiedShareLink, setCopiedShareLink] = useState<boolean>(false);
  const [inlineError, setInlineError] = useState<string>('');

  const openEditStaffModal = (staff: StaffMember) => {
    const resolvedCode = getStaffEmployeeCode(staff);
    setEditingOriginalStaffId(staff.staffId);
    setEditModalError('');
    setEditingStaff({
      ...staff,
      employeeCode: resolvedCode || undefined,
    });
  };

  // Clinic, Leave Type & Custom Holiday Management state
  const [newInClinicName, setNewInClinicName] = useState<string>('');
  const [newOutClinicName, setNewOutClinicName] = useState<string>('');
  const [newPremiumClinicName, setNewPremiumClinicName] = useState<string>('');
  const [newLeaveTypeName, setNewLeaveTypeName] = useState<string>('');
  const [newHolidayDate, setNewHolidayDate] = useState<string>(todayStr);
  const [newHolidayName, setNewHolidayName] = useState<string>('');
  const [showBuiltInHolidays, setShowBuiltInHolidays] = useState<boolean>(false);
  const [holidayPreviewYear, setHolidayPreviewYear] = useState<number>(new Date().getFullYear());
  const [showSheetLinkConfig, setShowSheetLinkConfig] = useState<boolean>(false);

  // PIN Security Gate State
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [showPinInputMask, setShowPinInputMask] = useState<boolean>(false);
  const [adminPinSetting, setAdminPinSetting] = useState<string>(settings.adminPin || '');
  const [primaryAdminOwner, setPrimaryAdminOwner] = useState<string>(
    settings.primaryAdminOwner || DEFAULT_PRIMARY_ADMIN_OWNER
  );
  const [additionalAdminPins, setAdditionalAdminPins] = useState<AdminPinEntry[]>(() =>
    settings.additionalAdminPins && settings.additionalAdminPins.length > 0
      ? settings.additionalAdminPins
      : buildDefaultAdditionalAdminPins()
  );
  const [showAdminPinSetting, setShowAdminPinSetting] = useState<boolean>(false);

  // Settings form state (kept in sync with persisted settings)
  const [nhppd, setNhppd] = useState<number>(settings.nhppd);
  const [screeningNhppd, setScreeningNhppd] = useState<number>(settings.screeningNhppd ?? 0.1);
  const [stdHr, setStdHr] = useState<number>(settings.stdHr);
  const [annualHr, setAnnualHr] = useState<number>(settings.annualHr);
  const [workDays, setWorkDays] = useState<number>(settings.workDays);
  const [adminEmailsStr, setAdminEmailsStr] = useState<string>(settings.adminEmails.join(', '));
  const [customSheetUrl, setCustomSheetUrl] = useState<string>(settings.spreadsheetUrl || '');
  const [customGasUrl, setCustomGasUrl] = useState<string>(settings.gasUrl || '');
  const [defaultCostCenter, setDefaultCostCenter] = useState<string>(
    settings.defaultCostCenter || DEFAULT_OT_COST_CENTER
  );
  const [otControllerName, setOtControllerName] = useState<string>(
    settings.otControllerName || DEFAULT_OT_CONTROLLER_NAME
  );
  const [clinicCostCenters, setClinicCostCenters] = useState<Record<string, string>>(
    settings.clinicCostCenters || {}
  );
  const [selectedCostCenterClinic, setSelectedCostCenterClinic] = useState<string>(
    inTimeClinics[0] || IN_TIME_CLINICS[0]
  );
  const [clinicCostCenterDraft, setClinicCostCenterDraft] = useState<string>('');
  const [otRateNurse, setOtRateNurse] = useState<number>(() =>
    getOtHourlyRate('RN', settings.otHourlyRates)
  );
  const [otRatePn, setOtRatePn] = useState<number>(() =>
    getOtHourlyRate('PN', settings.otHourlyRates)
  );
  const [otRateNa, setOtRateNa] = useState<number>(() =>
    getOtHourlyRate('NA', settings.otHourlyRates)
  );
  const [otRateClerk, setOtRateClerk] = useState<number>(() =>
    getOtHourlyRate('Clerk', settings.otHourlyRates)
  );
  const [otRateServiceWorker, setOtRateServiceWorker] = useState<number>(() =>
    getOtHourlyRate('Service Worker', settings.otHourlyRates)
  );
  const [settingsSaved, setSettingsSaved] = useState<boolean>(false);

  useEffect(() => {
    setNhppd(settings.nhppd);
    setScreeningNhppd(settings.screeningNhppd ?? 0.1);
    setStdHr(settings.stdHr);
    setAnnualHr(settings.annualHr);
    setWorkDays(settings.workDays);
    setAdminEmailsStr(settings.adminEmails.join(', '));
    setAdminPinSetting(settings.adminPin || '');
    setPrimaryAdminOwner(settings.primaryAdminOwner || DEFAULT_PRIMARY_ADMIN_OWNER);
    setAdditionalAdminPins(
      settings.additionalAdminPins && settings.additionalAdminPins.length > 0
        ? settings.additionalAdminPins
        : buildDefaultAdditionalAdminPins()
    );
    setCustomSheetUrl(settings.spreadsheetUrl || '');
    setCustomGasUrl(settings.gasUrl || '');
    setDefaultCostCenter(settings.defaultCostCenter || DEFAULT_OT_COST_CENTER);
    setOtControllerName(settings.otControllerName || DEFAULT_OT_CONTROLLER_NAME);
    setClinicCostCenters(settings.clinicCostCenters || {});
    setOtRateNurse(getOtHourlyRate('RN', settings.otHourlyRates));
    setOtRatePn(getOtHourlyRate('PN', settings.otHourlyRates));
    setOtRateNa(getOtHourlyRate('NA', settings.otHourlyRates));
    setOtRateClerk(getOtHourlyRate('Clerk', settings.otHourlyRates));
    setOtRateServiceWorker(getOtHourlyRate('Service Worker', settings.otHourlyRates));
  }, [settings]);

  useEffect(() => {
    if (inTimeClinics.length > 0 && !inTimeClinics.includes(newClinic)) {
      setNewClinic(inTimeClinics[0]);
    }
  }, [inTimeClinics, newClinic]);

  const handlePinSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const match = verifyAdminPinWithOwner(pinInput, settings);
    if (match.valid) {
      setPinError('');
      if (onUnlockAdmin) {
        onUnlockAdmin(pinInput.trim());
      }
      setPinInput('');
    } else {
      setPinError('รหัสผ่านไม่ถูกต้อง กรุณาระบุรหัสผ่านความปลอดภัยที่ถูกต้อง');
    }
  };

  const handleKeypadPress = (val: string) => {
    setPinError('');
    if (val === 'CLEAR') {
      setPinInput('');
    } else if (val === 'BACK') {
      setPinInput(prev => prev.slice(0, -1));
    } else {
      if (pinInput.length < 8) {
        const next = pinInput + val;
        setPinInput(next);
        if (next.length === 4 && verifyAdminPinWithOwner(next, settings).valid) {
          setTimeout(() => {
            if (onUnlockAdmin) onUnlockAdmin(next);
            setPinInput('');
            setPinError('');
          }, 150);
        }
      }
    }
  };

  // Combined clinic list for filter dropdown
  const allClinicsForFilter = useMemo(() => {
    return Array.from(new Set([...inTimeClinics, ...outTimeClinics]));
  }, [inTimeClinics, outTimeClinics]);

  // Filtered staff list (sorted strictly by Position 1→6 then Start Date ascending)
  const filteredStaff = useMemo(() => {
    return staffList
      .filter(s => {
        const q = searchQuery.toLowerCase().trim();
        const posLabel = formatPositionLabel(s.position).toLowerCase();
        const resolvedCode = getStaffEmployeeCode(s).toLowerCase();
        const matchSearch = !q ||
          s.name.toLowerCase().includes(q) ||
          resolvedCode.includes(q) ||
          s.staffId.toLowerCase().includes(q) ||
          s.position.toLowerCase().includes(q) ||
          posLabel.includes(q) ||
          s.homeClinic.toLowerCase().includes(q);
        const matchPos = positionFilter === 'ALL' || s.position === positionFilter;
        const matchStat = statusFilter === 'ALL' || s.status === statusFilter;
        const matchClinic = clinicFilter === 'ALL' || s.homeClinic === clinicFilter;

        return matchSearch && matchPos && matchStat && matchClinic;
      })
      .sort(compareStaffByPositionAndStartDate);
  }, [staffList, searchQuery, positionFilter, statusFilter, clinicFilter]);

  // Statistics
  const activeCount = staffList.filter(s => s.status === 'Active').length;
  const resignedCount = staffList.filter(s => s.status === 'Resigned').length;
  const retiredCount = staffList.filter(s => s.status === 'Retired').length;

  // Handle Add Staff (use employee code as canonical Staff_ID)
  const handleAddStaffSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = newEmployeeCode.trim();
    const cleanName = newName.trim();
    if (!cleanCode) {
      setInlineError('กรุณาระบุรหัสบุคลากร (ใช้เป็น Staff_ID เช่น 20708302)');
      return;
    }
    if (!isValidEmployeeCodeValue(cleanCode)) {
      setInlineError('รหัสบุคลากรไม่ถูกต้อง (กรุณาระบุเลขรหัสบุคลากรจริง เช่น 20708302)');
      return;
    }
    const dupCodeStaff = staffList.find(
      (s) => s.staffId === cleanCode || getStaffEmployeeCode(s) === cleanCode
    );
    if (dupCodeStaff) {
      setInlineError(`รหัสบุคลากร "${cleanCode}" มีอยู่ในระบบแล้ว (${dupCodeStaff.name})`);
      return;
    }
    if (!cleanName) {
      setInlineError('กรุณาระบุชื่อ-นามสกุลเจ้าหน้าที่');
      return;
    }
    setInlineError('');

    const staff: StaffMember = {
      staffId: cleanCode,
      employeeCode: cleanCode,
      name: cleanName,
      position: newPosition,
      homeClinic: newClinic,
      status: newStatus,
      startDate: newStartDate || todayStr,
    };

    onAddStaff(staff);
    setNewEmployeeCode('');
    setNewName('');
    setNewStatus('Active');
    setNewStartDate(getLocalTodayIso());
    setShowAddForm(false);
  };

  // Clinic Management Handlers (immediately saved & persisted)
  const handleAddInTimeClinic = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newInClinicName.trim();
    if (!trimmed) return;
    if (inTimeClinics.includes(trimmed)) {
      setInlineError(`แผนก "${trimmed}" มีอยู่ในรายการในเวลาแล้ว`);
      return;
    }
    setInlineError('');
    if (trimmed === REFERRAL_CLINIC_NAME) {
      markReferralClinicRemovedByAdmin(false);
    }
    onSaveSettings({
      ...settings,
      inTimeClinics: [...inTimeClinics, trimmed],
      outTimeClinics,
    });
    setNewInClinicName('');
  };

  const handleRemoveInTimeClinic = (clinicName: string) => {
    if (inTimeClinics.length <= 1) {
      setInlineError('ต้องมีแผนกตรวจในเวลาอย่างน้อย 1 แผนก');
      return;
    }
    setInlineError('');
    if (clinicName === REFERRAL_CLINIC_NAME) {
      markReferralClinicRemovedByAdmin(true);
    }
    onSaveSettings({
      ...settings,
      inTimeClinics: inTimeClinics.filter(c => c !== clinicName),
      outTimeClinics,
    });
  };

  const handleAddOutTimeClinic = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newOutClinicName.trim();
    if (!trimmed) return;
    if (outTimeClinics.includes(trimmed)) {
      setInlineError(`แผนก "${trimmed}" มีอยู่ในรายการนอกเวลาแล้ว`);
      return;
    }
    setInlineError('');
    onSaveSettings({
      ...settings,
      inTimeClinics,
      outTimeClinics: [...outTimeClinics, trimmed],
    });
    setNewOutClinicName('');
  };

  const handleRemoveOutTimeClinic = (clinicName: string) => {
    if (outTimeClinics.length <= 1) {
      setInlineError('ต้องมีแผนกตรวจนอกเวลาอย่างน้อย 1 แผนก');
      return;
    }
    setInlineError('');
    onSaveSettings({
      ...settings,
      inTimeClinics,
      outTimeClinics: outTimeClinics.filter(c => c !== clinicName),
    });
  };

  const handleRestoreDefaultClinics = () => {
    setInlineError('');
    markReferralClinicRemovedByAdmin(false);
    onSaveSettings({
      ...settings,
      inTimeClinics: [...IN_TIME_CLINICS],
      outTimeClinics: [...OUT_TIME_CLINICS],
    });
  };

  const handleAddPremiumSubClinic = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPremiumClinicName.trim();
    if (!trimmed) return;
    if (premiumSubClinics.includes(trimmed)) {
      setInlineError(`แผนก "${trimmed}" มีอยู่ในศูนย์ปัญญาภิรมย์แล้ว`);
      return;
    }
    setInlineError('');
    onSaveSettings({
      ...settings,
      inTimeClinics,
      outTimeClinics,
      premiumSubClinics: [...premiumSubClinics, trimmed],
    });
    setNewPremiumClinicName('');
  };

  const handleRemovePremiumSubClinic = (clinicName: string) => {
    if (premiumSubClinics.length <= 1) {
      setInlineError('ต้องมีแผนกย่อยในศูนย์ปัญญาภิรมย์อย่างน้อย 1 แผนก');
      return;
    }
    setInlineError('');
    onSaveSettings({
      ...settings,
      inTimeClinics,
      outTimeClinics,
      premiumSubClinics: premiumSubClinics.filter(c => c !== clinicName),
    });
  };

  const handleRestoreDefaultPremiumSubClinics = () => {
    setInlineError('');
    onSaveSettings({
      ...settings,
      inTimeClinics,
      outTimeClinics,
      premiumSubClinics: [...DEFAULT_PREMIUM_SUB_CLINICS],
    });
  };

  // Save custom spreadsheet link/ID (+ optional Apps Script Web App URL)
  const handleSaveSheetLink = () => {
    const raw = customSheetUrl.trim();
    const trimmedGas = customGasUrl.trim();
    if (!raw && !trimmedGas) {
      onSaveSettings({
        ...settings,
        spreadsheetId: undefined,
        spreadsheetUrl: undefined,
        gasUrl: undefined,
        isUnlinked: true,
      });
      return;
    }
    const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const extractedId = raw ? (idMatch ? idMatch[1] : raw) : settings.spreadsheetId;
    const normalizedUrl = raw
      ? raw.startsWith('http')
        ? raw
        : `https://docs.google.com/spreadsheets/d/${extractedId}/edit`
      : settings.spreadsheetUrl;

    onSaveSettings({
      ...settings,
      spreadsheetId: extractedId,
      spreadsheetUrl: normalizedUrl,
      gasUrl: trimmedGas || undefined,
      isUnlinked: false,
    });
  };

  const handleUnlinkSheet = () => {
    setCustomSheetUrl('');
    setCustomGasUrl('');
    onSaveSettings({
      ...settings,
      spreadsheetId: undefined,
      spreadsheetUrl: undefined,
      gasUrl: undefined,
      isUnlinked: true,
    });
  };

  const handleCopyLinkClick = () => {
    onCopyShareLink();
    setCopiedShareLink(true);
    setTimeout(() => setCopiedShareLink(false), 2500);
  };

  const shareableOpdUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const base = `${window.location.origin}${window.location.pathname}`;
    const qp = new URLSearchParams();
    if (settings.spreadsheetId) qp.set('sheetId', settings.spreadsheetId);
    if (settings.gasUrl?.trim()) qp.set('gasUrl', settings.gasUrl.trim());
    const qs = qp.toString();
    return qs ? `${base}?${qs}` : base;
  }, [settings.spreadsheetId, settings.gasUrl]);

  // Leave Type Management Handlers (Admin Add / Remove)
  const handleAddLeaveType = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newLeaveTypeName.trim();
    if (!trimmed) return;
    if (leaveTypes.includes(trimmed)) {
      setInlineError(`ประเภทการลา "${trimmed}" มีอยู่ในรายการแล้ว`);
      return;
    }
    setInlineError('');
    onSaveSettings({
      ...settings,
      leaveTypes: [...leaveTypes, trimmed],
    });
    setNewLeaveTypeName('');
  };

  const handleRemoveLeaveType = (typeName: string) => {
    if (leaveTypes.length <= 1) {
      setInlineError('ต้องมีประเภทการลาอย่างน้อย 1 รายการ');
      return;
    }
    setInlineError('');
    onSaveSettings({
      ...settings,
      leaveTypes: leaveTypes.filter((lt) => lt !== typeName),
    });
  };

  const handleRestoreDefaultLeaveTypes = () => {
    setInlineError('');
    onSaveSettings({
      ...settings,
      leaveTypes: [...LEAVE_TYPES],
    });
  };

  // Custom Hospital Holiday Handlers
  const customHolidays: CustomHoliday[] = useMemo(() => {
    return [...(settings.customHolidays || [])].sort((a, b) => a.date.localeCompare(b.date));
  }, [settings.customHolidays]);

  const builtInHolidaysForPreview = useMemo(() => {
    const map = getHolidaysForYear(holidayPreviewYear, []);
    return Array.from(map.entries())
      .map(([date, info]) => ({ date, name: info.name }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [holidayPreviewYear]);

  const handleAddCustomHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    const dateVal = newHolidayDate.trim();
    const nameVal = newHolidayName.trim();
    if (!dateVal) {
      setInlineError('กรุณาเลือกวันที่วันหยุดพิเศษ');
      return;
    }
    if (!nameVal) {
      setInlineError('กรุณาระบุชื่อวันหยุดพิเศษ');
      return;
    }
    setInlineError('');
    const nextList = [
      ...customHolidays.filter((h) => h.date !== dateVal),
      { date: dateVal, name: nameVal },
    ].sort((a, b) => a.date.localeCompare(b.date));

    onSaveSettings({
      ...settings,
      customHolidays: nextList,
    });
    setNewHolidayName('');
  };

  const handleRemoveCustomHoliday = (dateVal: string) => {
    setInlineError('');
    onSaveSettings({
      ...settings,
      customHolidays: customHolidays.filter((h) => h.date !== dateVal),
    });
  };

  // Handle Save Settings
  const handleSaveSettingsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const emails = adminEmailsStr
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0);

    const normalizedExtraPins = DEFAULT_ADDITIONAL_ADMIN_SLOTS.map((slot, idx) => {
      const current = additionalAdminPins.find(item => item.id === slot.id) || additionalAdminPins[idx];
      return {
        id: slot.id,
        ownerName: current?.ownerName?.trim() || slot.defaultOwnerName,
        pin: current?.pin?.trim() || '',
      };
    });

    const nurseRate = Number(otRateNurse) > 0 ? Number(otRateNurse) : DEFAULT_OT_HOURLY_RATES.RN;
    const pnRate = Number(otRatePn) > 0 ? Number(otRatePn) : DEFAULT_OT_HOURLY_RATES.PN;
    const naRate = Number(otRateNa) > 0 ? Number(otRateNa) : DEFAULT_OT_HOURLY_RATES.NA;
    const clerkRate = Number(otRateClerk) > 0 ? Number(otRateClerk) : DEFAULT_OT_HOURLY_RATES.Clerk;
    const swRate =
      Number(otRateServiceWorker) > 0
        ? Number(otRateServiceWorker)
        : DEFAULT_OT_HOURLY_RATES['Service Worker'];

    const updated: SystemSettings = {
      ...settings,
      nhppd: Number(nhppd) > 0 ? Number(nhppd) : 0.4,
      screeningNhppd: Number(screeningNhppd) > 0 ? Number(screeningNhppd) : 0.1,
      stdHr: Number(stdHr) || 7,
      annualHr: Number(annualHr) || 2080,
      workDays: Number(workDays) || 245,
      adminEmails: emails.length > 0 ? emails : settings.adminEmails,
      adminPin: adminPinSetting.trim(),
      primaryAdminOwner: primaryAdminOwner.trim() || DEFAULT_PRIMARY_ADMIN_OWNER,
      additionalAdminPins: normalizedExtraPins,
      inTimeClinics,
      outTimeClinics,
      premiumSubClinics,
      leaveTypes,
      gasUrl: settings.isUnlinked ? undefined : customGasUrl.trim() || settings.gasUrl || undefined,
      isUnlinked: settings.isUnlinked,
      defaultCostCenter: defaultCostCenter.trim() || DEFAULT_OT_COST_CENTER,
      clinicCostCenters,
      otControllerName: otControllerName.trim() || DEFAULT_OT_CONTROLLER_NAME,
      otHourlyRates: {
        HN: nurseRate,
        RN: nurseRate,
        'RN (Daily Wage)': nurseRate,
        PN: pnRate,
        'PN (Daily Wage)': pnRate,
        NA: naRate,
        PCA: naRate,
        'NA (Daily Wage)': naRate,
        Clerk: clerkRate,
        'Clerk (Referral)': clerkRate,
        'Clerk (Daily Wage)': clerkRate,
        'Service Worker': swRate,
        'Service Worker (Daily Wage)': swRate,
      },
    };

    onSaveSettings(updated);
    setSettingsSaved(true);
    setTimeout(() => setSettingsSaved(false), 2500);
  };

  // If locked, render PIN Security Gate
  if (!isAdminUnlocked) {
    return (
      <div className="max-w-md mx-auto my-8 bg-white rounded-3xl shadow-xl border border-gray-200/90 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-red-800 via-rose-900 to-slate-900 text-white p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur border border-white/20 mx-auto flex items-center justify-center mb-3 shadow-inner">
            <Lock className="w-8 h-8 text-rose-300" />
          </div>
          <h2 className="text-lg font-bold">ระบบความปลอดภัย Admin</h2>
          <p className="text-xs text-rose-200 mt-1">
            เมนูที่ 5: จัดการบุคลากร & ตั้งค่า (จำกัดสิทธิ์เฉพาะผู้ดูแลระบบ)
          </p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          <div className="text-center space-y-1">
            <span className="text-xs font-semibold text-gray-700">กรุณาระบุรหัสผ่านความปลอดภัย (PIN 4 หลัก)</span>
            <p className="text-[11px] text-gray-400">
              รหัสผ่านนี้ใช้สำหรับเข้าถึงฐานข้อมูลบุคลากร การตั้งค่าระบบ และการเชื่อมต่อ Google Drive
            </p>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <div className="relative">
              <input
                type={showPinInputMask ? 'text' : 'password'}
                maxLength={8}
                value={pinInput}
                onChange={(e) => {
                  setPinInput(e.target.value);
                  setPinError('');
                }}
                placeholder="••••"
                autoFocus
                className="w-full text-center text-2xl font-mono tracking-widest py-3 px-4 rounded-xl border border-gray-300 focus:border-red-600 focus:ring-2 focus:ring-red-100 outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPinInputMask(!showPinInputMask)}
                className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600 cursor-pointer"
                title={showPinInputMask ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              >
                {showPinInputMask ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {pinError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs text-center font-medium flex items-center justify-center gap-1.5 animate-bounce">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                <span>{pinError}</span>
              </div>
            )}

            {/* Virtual Numeric Keypad */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLEAR', '0', 'BACK'].map((btn) => (
                <button
                  key={btn}
                  type="button"
                  onClick={() => handleKeypadPress(btn)}
                  className={`py-3 rounded-xl font-bold text-sm transition-all cursor-pointer select-none active:scale-95 ${
                    btn === 'CLEAR'
                      ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs'
                      : btn === 'BACK'
                      ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs flex items-center justify-center'
                      : 'bg-slate-50 border border-gray-200 hover:bg-red-50 hover:border-red-300 text-gray-800 text-base'
                  }`}
                >
                  {btn === 'CLEAR' ? 'ล้าง (C)' : btn === 'BACK' ? '⌫ ลบ' : btn}
                </button>
              ))}
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-red-700 hover:bg-red-600 active:bg-red-800 text-white font-bold text-sm rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <KeyRound className="w-4 h-4" />
              <span>ยืนยันรหัสผ่านเพื่อปลดล็อก</span>
            </button>
          </form>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center text-[11px] text-amber-800">
            🔒 ระบบกำหนดให้ต้องกรอก Admin PIN ใหม่ทุกครั้งที่เปิดหรือรีเฟรชหน้าเว็บ (บัญชี Google ใช้สำหรับเชื่อมต่อ Google Sheets เท่านั้น)
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <div className="bg-gradient-to-r from-red-50 via-rose-50 to-orange-50 border border-red-200/80 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-600 text-white flex items-center justify-center shrink-0 shadow-sm">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-red-950">
              เมนูที่ 5: ตั้งค่าและจัดการบุคลากร (Admin Panel & Master Settings)
            </h2>
            <p className="text-xs text-red-800">
              จัดการรายชื่อบุคลากร, เพิ่ม/ลดแผนกตรวจ, ตั้งค่าสูตรคำนวณ และเชื่อมต่อ Google Workspace (บันทึกค่าอัตโนมัติ)
            </p>
          </div>
        </div>

        {/* Admin Badge & Lock Button */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-emerald-800 bg-emerald-100/90 border border-emerald-300 rounded-full">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>ปลดล็อกสิทธิ์ Admin แล้ว{adminOwnerName ? ` (${adminOwnerName})` : ''}</span>
          </span>

          {onLockAdmin && (
            <button
              type="button"
              onClick={onLockAdmin}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-700 hover:text-white bg-white hover:bg-red-600 border border-red-300 rounded-full shadow-2xs transition-colors cursor-pointer"
              title="ออกจากระบบ Admin และกลับสู่หน้าใส่ PIN"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>ออกจากระบบ Admin (ล็อกสิทธิ์)</span>
            </button>
          )}
        </div>
      </div>

      {/* SECTION 1: Google Sheets & Share Link (Zero Google Sign-In) */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-cyan-900 text-white rounded-2xl p-5 shadow-md space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold flex items-center gap-2 text-emerald-200">
              <FileSpreadsheet className="w-5 h-5 text-emerald-300" />
              <span>การเชื่อมต่อ Google Sheets และแชร์ลิงก์ให้บุคลากร OPD</span>
            </h3>
            <p className="text-xs text-emerald-100/80">
              {settings.spreadsheetId || settings.gasUrl
                ? 'เชื่อมโยงฐานข้อมูล Google Sheets เรียบร้อยแล้ว — ซิงค์อัตโนมัติโดยไม่ต้อง Sign in Google (ซ่อนรหัสและลิงก์ชีทเพื่อความปลอดภัย)'
                : 'เชื่อมต่อฐานข้อมูล Google Sheets ผ่านลิงก์ชีท / Web App URL (Code.gs) โดยไม่ต้อง Sign in Google'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* 1. When Sheet Link/ID or GAS URL exists -> Open Sheet + Sync (Zero Sign-In!) */}
            {settings.spreadsheetId || settings.spreadsheetUrl || settings.gasUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                {(settings.spreadsheetUrl || settings.spreadsheetId) && (
                  <a
                    href={settings.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-100 border border-emerald-400/50 rounded-xl transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 text-emerald-300" />
                    <span>เปิด Google Sheets</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={onSyncSpreadsheet}
                  disabled={isSyncingSheet}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white border border-teal-400/40 rounded-xl shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                  title="ซิงค์ข้อมูลไป-กลับระหว่างหน้าเว็บกับ Google Sheet ปัจจุบันโดยไม่ต้อง Sign in Google"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
                  <span>{isSyncingSheet ? 'กำลังซิงค์ข้อมูล...' : 'ซิงค์ข้อมูลกับ Google Sheet'}</span>
                </button>
                {onToggleAutoSync && (
                  <button
                    type="button"
                    onClick={() => onToggleAutoSync(!(settings.autoSync !== false))}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer ${
                      settings.autoSync !== false
                        ? 'bg-emerald-500/25 text-emerald-100 border-emerald-400/50 hover:bg-emerald-500/35'
                        : 'bg-black/25 text-slate-300 border-white/15 hover:bg-black/35'
                    }`}
                    title="เปิด/ปิด การซิงค์ข้อมูลกับ Google Sheet อัตโนมัติทุกครั้งที่มีการกดบันทึก"
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isSyncingSheet
                          ? 'bg-amber-300 animate-ping'
                          : settings.autoSync !== false
                          ? 'bg-emerald-400'
                          : 'bg-slate-400'
                      }`}
                    />
                    <span>{settings.autoSync !== false ? 'ซิงค์เมื่อบันทึก: เปิด' : 'Auto ซิงค์: ปิด'}</span>
                    {lastSyncedAt && (
                      <span className="text-[10px] text-emerald-200/80">({lastSyncedAt})</span>
                    )}
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowSheetLinkConfig(true)}
                disabled={isSettingUpSheet}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white border border-teal-400/40 rounded-xl shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4 text-yellow-300" />
                <span>เชื่อมต่อ Google Sheets (ไม่ต้อง Sign in)</span>
              </button>
            )}

            {/* 2. Copy Share Link for OPD Staff */}
            <button
              type="button"
              onClick={handleCopyLinkClick}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                copiedShareLink
                  ? 'bg-emerald-500 text-emerald-950 border-emerald-300 shadow-sm'
                  : 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-100 border-cyan-300/40'
              }`}
              title="คัดลอกลิงก์หน้าเว็บ (พร้อมผูกชีทให้อัตโนมัติ) ส่งให้บุคลากร OPD ใช้งาน"
            >
              {copiedShareLink ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4 text-cyan-300" />}
              <span>{copiedShareLink ? 'คัดลอกลิงก์แล้ว!' : 'คัดลอกลิงก์แชร์ให้ OPD'}</span>
            </button>

            {/* Discrete toggle for Sheet ID & Web App URL config */}
            <button
              type="button"
              onClick={() => setShowSheetLinkConfig((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold bg-black/20 hover:bg-black/35 text-emerald-100/80 border border-white/15 rounded-xl transition-colors cursor-pointer"
              title="แสดง/ซ่อนช่องตั้งค่าลิงก์ Google Sheets และ Web App URL"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{showSheetLinkConfig ? 'ซ่อนตั้งค่าลิงก์' : 'ตั้งค่าลิงก์ชีท'}</span>
            </button>

            {/* Zero Sign-In Status Pill */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-black/25 text-emerald-200 border border-emerald-400/30 rounded-xl">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>ซิงค์ไม่ต้อง Sign in</span>
            </div>
          </div>
        </div>

        {/* Hidden by default (Image 2): Existing Spreadsheet URL/ID & Share Link */}
        {showSheetLinkConfig && (
          <div className="bg-black/20 rounded-xl p-3 border border-white/10 space-y-2.5">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-emerald-200 font-semibold shrink-0">
                <Link2 className="w-4 h-4" />
                <span>ลิงก์ / ID Google Sheets ที่ต้องการจำค่า:</span>
              </div>
              <input
                type="text"
                value={customSheetUrl}
                onChange={(e) => setCustomSheetUrl(e.target.value)}
                placeholder="วาง URL หรือ Spreadsheet ID ที่มีอยู่เพื่อบันทึกลิงก์ถาวร..."
                className="flex-1 text-xs bg-white/95 text-gray-900 rounded-lg px-3 py-1.5 border border-white/20 outline-none"
              />
              <button
                type="button"
                onClick={handleSaveSheetLink}
                className="px-3.5 py-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-emerald-950 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                จำค่าลิงก์ชีท
              </button>
              {(settings.spreadsheetId || settings.spreadsheetUrl || settings.gasUrl) && (
                <button
                  type="button"
                  onClick={handleUnlinkSheet}
                  className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-white/10 hover:bg-red-500/30 text-red-100 border border-white/15 rounded-lg transition-colors cursor-pointer shrink-0"
                  title="ล้างลิงก์ที่จำไว้ออก"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>ยกเลิกเชื่อมโยง</span>
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
              <div className="flex items-center gap-1.5 text-[11px] text-cyan-200 font-semibold shrink-0">
                <span>Web App URL ซิงค์อัตโนมัติ (ไม่บังคับ):</span>
              </div>
              <input
                type="url"
                value={customGasUrl}
                onChange={(e) => setCustomGasUrl(e.target.value)}
                placeholder="https://script.google.com/macros/s/.../exec (ช่วยให้ OPD บันทึกข้อมูลเข้าชีทได้ทันทีโดยไม่ต้องล็อกอิน)"
                className="flex-1 text-xs bg-white/95 text-gray-900 rounded-lg px-3 py-1.5 border border-white/20 outline-none"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-white/10 text-[11px] text-emerald-100/85">
              <div className="truncate">
                <span className="font-semibold text-cyan-200">ลิงก์สำหรับแชร์บุคลากร OPD: </span>
                <span className="font-mono text-white/90 select-all">{shareableOpdUrl}</span>
              </div>
              <button
                type="button"
                onClick={handleCopyLinkClick}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-white/10 hover:bg-white/20 text-white rounded-md font-semibold transition-colors cursor-pointer shrink-0 self-start sm:self-auto"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedShareLink ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {inlineError && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{inlineError}</span>
          </div>
          <button
            type="button"
            onClick={() => setInlineError('')}
            className="text-red-500 hover:text-red-800 font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Staff Master Statistics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-2xs">
          <span className="text-xs font-semibold text-gray-500 block">บุคลากรทั้งหมดในระบบ</span>
          <div className="text-2xl font-black text-gray-900 mt-1">
            {staffList.length} <span className="text-xs font-normal text-gray-500">คน</span>
          </div>
          <span className="text-[11px] text-gray-400">ฐานข้อมูล Staff_Master</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-emerald-200 shadow-2xs">
          <span className="text-xs font-semibold text-emerald-700 block">กำลังปฏิบัติงาน (Active)</span>
          <div className="text-2xl font-black text-emerald-700 mt-1">
            {activeCount} <span className="text-xs font-normal text-gray-500">คน</span>
          </div>
          <span className="text-[11px] text-emerald-600">พร้อมขึ้นเวรและปฏิบัติงาน</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-amber-200 shadow-2xs">
          <span className="text-xs font-semibold text-amber-700 block">ลาออก / ย้าย (Resigned)</span>
          <div className="text-2xl font-black text-amber-700 mt-1">
            {resignedCount} <span className="text-xs font-normal text-gray-500">คน</span>
          </div>
          <span className="text-[11px] text-amber-600">คงประวัติภาระงานย้อนหลัง</span>
        </div>

        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
          <span className="text-xs font-semibold text-slate-700 block">เกษียณอายุ (Retired)</span>
          <div className="text-2xl font-black text-slate-700 mt-1">
            {retiredCount} <span className="text-xs font-normal text-gray-500">คน</span>
          </div>
          <span className="text-[11px] text-slate-500">ปลดประจำการ</span>
        </div>
      </div>

      {/* SECTION 2: Staff Management Section (No Staff ID) */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-red-600" />
            <h3 className="text-sm font-bold text-gray-900">
              บัญชีรายชื่อบุคลากร OPD รพ.ชลประทาน (Staff_Master)
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-red-700 hover:bg-red-600 text-white rounded-lg shadow-2xs transition-colors cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{showAddForm ? 'ปิดฟอร์มเพิ่ม' : 'เพิ่มบุคลากรใหม่'}</span>
            </button>
          </div>
        </div>

        {/* Add Staff Form (Collapsible — No Staff ID input) */}
        {showAddForm && (
          <form onSubmit={handleAddStaffSubmit} className="bg-red-50/50 border border-red-200 rounded-xl p-4 space-y-3">
            <h4 className="text-xs font-bold text-red-950 flex items-center gap-1.5">
              <UserPlus className="w-4 h-4 text-red-600" />
              กรอกข้อมูลบุคลากรใหม่
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  รหัสบุคลากร (Staff_ID) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="เช่น 20708302"
                  value={newEmployeeCode}
                  onChange={(e) => setNewEmployeeCode(e.target.value)}
                  required
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border font-mono font-semibold bg-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  ชื่อ - นามสกุล (พร้อมคำนำหน้า) <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="เช่น พว.สมหญิง วรรณรัตน์"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border font-medium bg-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">ตำแหน่ง</label>
                <select
                  value={newPosition}
                  onChange={(e) => setNewPosition(e.target.value as StaffPosition)}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white"
                >
                  {ALL_POSITIONS.map(p => (
                    <option key={p} value={p}>{POSITION_LABELS[p]}</option>
                  ))}
                </select>
                {newPosition === 'Clerk (Referral)' && (
                  <p className="text-[10px] text-emerald-700 font-medium mt-1">
                    ตำแหน่งพิเศษของศูนย์รับ-ส่งต่อผู้ป่วย: ระบบนับภาระงานและกำลังคนประจำวันเทียบเท่า NA
                  </p>
                )}
                {isDailyWagePosition(newPosition) && (
                  <p className="text-[10px] text-sky-700 font-medium mt-1">
                    ตำแหน่งจ้างรายวัน: นับรวมในภาระงานประจำวันตามกลุ่มตำแหน่งหลัก โดยยังคงชื่อตำแหน่งจ้างรายวันไว้สำหรับทะเบียน วันลา และ OT/Unit Cost
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">คลินิกสังกัด</label>
                <select
                  value={newClinic}
                  onChange={(e) => setNewClinic(e.target.value)}
                  className="w-full text-xs rounded-lg border-gray-300 py-1.5 px-2.5 border bg-white"
                >
                  {inTimeClinics.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  วันเริ่มงาน (วันแรก • พ.ศ.)
                </label>
                <ThaiDateInput
                  value={newStartDate}
                  onChange={setNewStartDate}
                  selectClassName="w-full text-xs rounded-lg border border-gray-300 py-1.5 pl-2.5 pr-8 bg-white font-medium text-gray-900 outline-none focus:border-red-500"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <span className="text-[11px] text-gray-500">
                * ระบบจะตั้งวันเริ่มงานเป็นวันที่เพิ่มรายชื่อโดยอัตโนมัติ (สามารถแก้ไขภายหลังได้)
              </span>
              <button
                type="submit"
                className="px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white font-semibold text-xs rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                บันทึกเข้าสู่ Staff_Master
              </button>
            </div>
          </form>
        )}

        {/* Search & Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              placeholder="ค้นหารหัส, ชื่อ, ตำแหน่ง, คลินิก..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs rounded-lg border-gray-200 pl-8 pr-3 py-1.5 border"
            />
          </div>

          <div>
            <select
              value={positionFilter}
              onChange={(e) => setPositionFilter(e.target.value)}
              className="w-full text-xs rounded-lg border-gray-200 py-1.5 px-2.5 border bg-white"
            >
              <option value="ALL">-- ทุกตำแหน่งวิชาชีพ --</option>
              {ALL_POSITIONS.map(p => (
                <option key={p} value={p}>{POSITION_LABELS[p]}</option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={clinicFilter}
              onChange={(e) => setClinicFilter(e.target.value)}
              className="w-full text-xs rounded-lg border-gray-200 py-1.5 px-2.5 border bg-white"
            >
              <option value="ALL">-- ทุกห้องตรวจ / แผนก --</option>
              {allClinicsForFilter.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full text-xs rounded-lg border-gray-200 py-1.5 px-2.5 border bg-white"
            >
              <option value="ALL">-- ทุกสถานะ --</option>
              <option value="Active">Active (กำลังปฏิบัติงาน)</option>
              <option value="Resigned">Resigned (ลาออก/ย้าย)</option>
              <option value="Retired">Retired (เกษียณอายุ)</option>
            </select>
          </div>
        </div>

        {/* Staff Table */}
        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full text-left text-xs border border-gray-100 rounded-lg">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b sticky top-0 z-10">
              <tr>
                <th className="py-2.5 px-2.5 whitespace-nowrap">รหัสบุคลากร (Staff_ID)</th>
                <th className="py-2.5 px-3">ชื่อ - นามสกุล</th>
                <th className="py-2.5 px-2">ตำแหน่งวิชาชีพ</th>
                <th className="py-2.5 px-3">ห้องตรวจสังกัด</th>
                <th className="py-2.5 px-2 whitespace-nowrap">วันเริ่มงาน / ลาออก</th>
                <th className="py-2.5 px-2 text-center">สถานะ</th>
                <th className="py-2.5 px-3 text-center">เปลี่ยนสถานะ / แก้ไข / ลบ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-400">
                    ไม่พบบุคลากรตามเงื่อนไขที่ค้นหา
                  </td>
                </tr>
              ) : (
                filteredStaff.map((staff) => {
                  const displayCode = getStaffEmployeeCode(staff);
                  return (
                  <tr key={staff.staffId} className="hover:bg-slate-50/80">
                    <td className="py-2 px-2.5 font-mono text-[11px] font-semibold text-gray-700 whitespace-nowrap">
                      {displayCode ? (
                        <span>{displayCode}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openEditStaffModal(staff)}
                          className="text-[10px] text-gray-400 hover:text-blue-600 hover:underline cursor-pointer font-sans"
                        >
                          + ระบุรหัส
                        </button>
                      )}
                    </td>
                    <td className="py-2 px-3 font-bold text-gray-900">{staff.name}</td>
                    <td className="py-2 px-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                        staff.position === 'HN' ? 'bg-purple-100 text-purple-800' :
                        staff.position === 'RN' ? 'bg-blue-100 text-blue-800' :
                        staff.position === 'PN' ? 'bg-teal-100 text-teal-800' :
                        (staff.position === 'NA' || staff.position === 'PCA') ? 'bg-emerald-100 text-emerald-800' :
                        staff.position === 'Clerk (Referral)' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                        staff.position === 'Clerk' ? 'bg-amber-100 text-amber-800' :
                        isDailyWagePosition(staff.position) ? 'bg-sky-100 text-sky-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {formatPositionLabel(staff.position)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-700">{staff.homeClinic}</td>
                    <td className="py-2 px-2 text-[11px] text-gray-600 whitespace-nowrap">
                      <div className="space-y-0.5">
                        <div>
                          <span className="text-gray-400">เริ่ม: </span>
                          {staff.startDate ? (
                            <span className="font-semibold text-emerald-800">{formatThaiShortDate(staff.startDate)}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openEditStaffModal(staff)}
                              className="text-blue-600 hover:underline font-medium cursor-pointer"
                            >
                              + เติมวันเริ่มงาน
                            </button>
                          )}
                        </div>
                        {(staff.endDate || staff.status !== 'Active') && (
                          <div>
                            <span className="text-gray-400">สิ้นสุด: </span>
                            {staff.endDate ? (
                              <span className="font-semibold text-amber-800">{formatThaiShortDate(staff.endDate)}</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openEditStaffModal(staff)}
                                className="text-amber-700 hover:underline font-medium cursor-pointer"
                              >
                                + ระบุวันที่
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        staff.status === 'Active' ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' :
                        staff.status === 'Resigned' ? 'bg-amber-50 text-amber-800 border border-amber-300' :
                        'bg-gray-100 text-gray-600 border border-gray-300'
                      }`}>
                        {staff.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <div className="inline-flex items-center justify-center gap-2 flex-wrap">
                        <div className="inline-flex rounded-md shadow-2xs" role="group">
                          <button
                            type="button"
                            onClick={() => onUpdateStaffStatus(staff.staffId, 'Active')}
                            className={`px-2 py-1 text-[10px] font-semibold rounded-l-md border cursor-pointer ${
                              staff.status === 'Active' 
                                ? 'bg-emerald-600 text-white border-emerald-600' 
                                : 'bg-white text-gray-600 hover:bg-gray-50 border-gray-300'
                            }`}
                          >
                            Active
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateStaffStatus(staff.staffId, 'Resigned')}
                            className={`px-2 py-1 text-[10px] font-semibold border-t border-b cursor-pointer ${
                              staff.status === 'Resigned' 
                                ? 'bg-amber-600 text-white border-amber-600' 
                                : 'bg-white text-gray-600 hover:bg-gray-50 border-gray-300'
                            }`}
                          >
                            Resigned
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateStaffStatus(staff.staffId, 'Retired')}
                            className={`px-2 py-1 text-[10px] font-semibold rounded-r-md border cursor-pointer ${
                              staff.status === 'Retired' 
                                ? 'bg-gray-700 text-white border-gray-700' 
                                : 'bg-white text-gray-600 hover:bg-gray-50 border-gray-300'
                            }`}
                          >
                            Retired
                          </button>
                        </div>

                        {onUpdateStaff && (
                          <button
                            type="button"
                            onClick={() => openEditStaffModal(staff)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-700 hover:text-white bg-blue-50 hover:bg-blue-600 border border-blue-200 hover:border-blue-600 rounded-md transition-colors cursor-pointer"
                            title={`แก้ไขข้อมูล / วันเริ่มงาน ${staff.name}`}
                          >
                            <Pencil className="w-3 h-3" />
                            <span>แก้ไข</span>
                          </button>
                        )}

                        {confirmDeleteStaffId === staff.staffId ? (
                          <div className="inline-flex items-center gap-1 bg-red-50 border border-red-200 rounded-md px-1.5 py-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteStaff(staff.staffId);
                                setConfirmDeleteStaffId(null);
                              }}
                              className="px-2 py-0.5 text-[10px] font-bold bg-red-600 hover:bg-red-700 text-white rounded cursor-pointer"
                            >
                              ยืนยันลบ
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteStaffId(null)}
                              className="px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 hover:text-gray-900 cursor-pointer"
                            >
                              ยกเลิก
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteStaffId(staff.staffId)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-red-600 hover:text-white bg-red-50 hover:bg-red-600 border border-red-200 hover:border-red-600 rounded-md transition-colors cursor-pointer"
                            title={`ลบบุคลากร ${staff.name}`}
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>ลบ</span>
                          </button>
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
      </div>

      {/* SECTION 3: Clinic / Department Management (Admin Add / Remove Clinics) */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-teal-700" />
            <div>
              <h3 className="text-sm font-bold text-gray-900">
                จัดการรายชื่อห้องตรวจ / แผนก OPD (เพิ่ม / ลดแผนกตรวจ)
              </h3>
              <p className="text-[11px] text-gray-500">
                รายการที่เพิ่มหรือลดจะถูกจำค่าและอัปเดตไปยังเมนูบันทึกภาระงาน, เวรนอกเวลา และรายงานอัตโนมัติ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRestoreDefaultClinics}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-800 hover:bg-slate-100 rounded-lg border border-gray-200 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>คืนค่ารายชื่อแผนกมาตรฐาน</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* In-Time Clinics */}
          <div className="bg-emerald-50/40 border border-emerald-200/80 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-emerald-950">
                แผนกตรวจในเวลาราชการ 08:00-16:00 ({inTimeClinics.length} แผนก)
              </h4>
            </div>

            <form onSubmit={handleAddInTimeClinic} className="flex gap-2">
              <input
                type="text"
                value={newInClinicName}
                onChange={(e) => setNewInClinicName(e.target.value)}
                placeholder="พิมพ์ชื่อแผนกในเวลาที่ต้องการเพิ่ม..."
                className="flex-1 text-xs rounded-lg border border-emerald-300 bg-white px-3 py-1.5 outline-none focus:ring-2 focus:ring-emerald-200"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>เพิ่มแผนก</span>
              </button>
            </form>

            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pt-1">
              {inTimeClinics.map((c) => (
                <div
                  key={c}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-emerald-200 rounded-lg text-xs font-medium text-emerald-950 shadow-2xs"
                >
                  <span>{c}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveInTimeClinic(c)}
                    className="text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                    title={`ลบแผนก ${c}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Out-Time Clinics */}
          <div className="bg-teal-50/40 border border-teal-200/80 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-teal-950">
                แผนกตรวจนอกเวลา / OT ({outTimeClinics.length} แผนก)
              </h4>
            </div>

            <form onSubmit={handleAddOutTimeClinic} className="flex gap-2">
              <input
                type="text"
                value={newOutClinicName}
                onChange={(e) => setNewOutClinicName(e.target.value)}
                placeholder="พิมพ์ชื่อแผนกนอกเวลาที่ต้องการเพิ่ม..."
                className="flex-1 text-xs rounded-lg border border-teal-300 bg-white px-3 py-1.5 outline-none focus:ring-2 focus:ring-teal-200"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-teal-700 hover:bg-teal-600 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>เพิ่มแผนก</span>
              </button>
            </form>

            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pt-1">
              {outTimeClinics.map((c) => (
                <div
                  key={c}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-teal-200 rounded-lg text-xs font-medium text-teal-950 shadow-2xs"
                >
                  <span>{c}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveOutTimeClinic(c)}
                    className="text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                    title={`ลบแผนก ${c}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ศูนย์ปัญญาภิรมย์ Sub-Departments (Orange Theme) */}
        <div className="bg-orange-50/60 border border-orange-200/90 rounded-xl p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-orange-950 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-orange-600" />
                <span>ศูนย์ปัญญาภิรมย์ — รายชื่อแผนกย่อย ({premiumSubClinics.length} แผนก)</span>
              </h4>
              <p className="text-[11px] text-orange-800/80 mt-0.5">
                ใช้โครงสร้างกำลังคนรวม 1 ชุดต่อกะ (Pooled Staffing) ร่วมกับยอดผู้ป่วยแยกตามแผนกแพทย์ที่เปิดตรวจจริง และบันทึกลงชีท Settings
              </p>
            </div>
            <button
              type="button"
              onClick={handleRestoreDefaultPremiumSubClinics}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-orange-800 hover:bg-orange-100 bg-white rounded-lg border border-orange-200 transition-colors cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3 h-3" />
              <span>คืนค่า 12 แผนกเริ่มต้น</span>
            </button>
          </div>

          <form onSubmit={handleAddPremiumSubClinic} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newPremiumClinicName}
              onChange={(e) => setNewPremiumClinicName(e.target.value)}
              placeholder="พิมพ์ชื่อแผนกย่อยศูนย์ปัญญาภิรมย์ (เช่น อายุรกรรม-Premium)..."
              className="flex-1 text-xs rounded-lg border border-orange-300 bg-white px-3 py-1.5 outline-none focus:ring-2 focus:ring-orange-200"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1 px-3.5 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>เพิ่มแผนกย่อย</span>
            </button>
          </form>

          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pt-1">
            {premiumSubClinics.map((c) => (
              <div
                key={c}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-orange-200 rounded-lg text-xs font-medium text-orange-950 shadow-2xs"
              >
                <span>{c}</span>
                <button
                  type="button"
                  onClick={() => handleRemovePremiumSubClinic(c)}
                  className="text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                  title={`ลบแผนก ${c}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 3.5: Leave Type Management (Admin Add / Remove Leave Types - Image 5) */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
          <div className="flex items-center gap-2">
            <CalendarOff className="w-5 h-5 text-amber-600" />
            <div>
              <h3 className="text-sm font-bold text-gray-900">
                จัดการประเภทการลา / สิทธิ์การลา (เพิ่ม / ลดประเภทการลา)
              </h3>
              <p className="text-[11px] text-gray-500">
                ประเภทการลาที่เพิ่มจะไปแสดงในเมนูบันทึกวันลา, เมนูบันทึกภาระงาน และรายงานสรุปวันลาอัตโนมัติ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRestoreDefaultLeaveTypes}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-gray-800 hover:bg-slate-100 rounded-lg border border-gray-200 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>คืนค่าประเภทการลามาตรฐาน</span>
          </button>
        </div>

        <div className="bg-amber-50/40 border border-amber-200/80 rounded-xl p-4 space-y-3">
          <form onSubmit={handleAddLeaveType} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newLeaveTypeName}
              onChange={(e) => setNewLeaveTypeName(e.target.value)}
              placeholder="พิมพ์ชื่อประเภทการลาที่ต้องการเพิ่ม (เช่น ลาดูแลบุตร, ลาช่วยภริยาคลอด)..."
              className="flex-1 text-xs rounded-lg border border-amber-300 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-amber-200"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>เพิ่มประเภทการลา</span>
            </button>
          </form>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {leaveTypes.map((lt) => (
              <div
                key={lt}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-amber-200 rounded-lg text-xs font-medium text-amber-950 shadow-2xs"
              >
                <span>{lt}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveLeaveType(lt)}
                  className="text-gray-400 hover:text-red-600 transition-colors cursor-pointer"
                  title={`ลบประเภทการลา ${lt}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 3.6: Custom Hospital Holidays Management */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-rose-600" />
            <div>
              <h3 className="text-sm font-bold text-gray-900">
                จัดการวันหยุดพิเศษที่โรงพยาบาลกำหนดเอง (สำหรับคำนวณวันลาราชการ)
              </h3>
              <p className="text-[11px] text-gray-500">
                ระบบนับวันลาเฉพาะวันราชการ (ตัดเสาร์-อาทิตย์ และวันหยุดนักขัตฤกษ์ไทยรวมวันหยุดชดเชยอัตโนมัติ) พร้อมหักวันหยุดพิเศษที่กำหนดที่นี่
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowBuiltInHolidays((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 rounded-lg border border-rose-200 transition-colors cursor-pointer"
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>{showBuiltInHolidays ? 'ซ่อนปฏิทินวันหยุดไทยในระบบ' : 'ดูปฏิทินวันหยุดนักขัตฤกษ์ไทย'}</span>
          </button>
        </div>

        <div className="bg-rose-50/40 border border-rose-200/80 rounded-xl p-4 space-y-3">
          <form onSubmit={handleAddCustomHoliday} className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
            <div className="sm:col-span-3">
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                วันที่หยุดพิเศษ (พ.ศ.) <span className="text-red-500">*</span>
              </label>
              <ThaiDateInput
                value={newHolidayDate}
                onChange={setNewHolidayDate}
                selectClassName="w-full text-xs rounded-lg border border-rose-300 py-1.5 pl-2.5 pr-8 bg-white font-medium text-gray-900 outline-none focus:ring-2 focus:ring-rose-200"
              />
            </div>
            <div className="sm:col-span-7">
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                ชื่อวันหยุดพิเศษที่โรงพยาบาลกำหนด <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={newHolidayName}
                onChange={(e) => setNewHolidayName(e.target.value)}
                placeholder="เช่น วันหยุดราชการพิเศษตามมติ ครม., วันหยุดสถาปนาโรงพยาบาล"
                className="w-full text-xs rounded-lg border border-rose-300 bg-white px-3 py-1.5 outline-none focus:ring-2 focus:ring-rose-200"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>เพิ่มวันหยุด</span>
              </button>
            </div>
          </form>

          {customHolidays.length === 0 ? (
            <div className="text-xs text-gray-500 bg-white/80 border border-dashed border-rose-200 rounded-lg p-3 text-center">
              ยังไม่มีวันหยุดพิเศษที่โรงพยาบาลกำหนดเพิ่มเติม (ระบบยังตัดเสาร์-อาทิตย์ และวันหยุดนักขัตฤกษ์ไทยให้อัตโนมัติ)
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
              {customHolidays.map((h) => (
                <div
                  key={h.date}
                  className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-rose-200 rounded-lg text-xs shadow-2xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-rose-900">{formatThaiShortDate(h.date)}</div>
                    <div className="text-[11px] text-gray-700 truncate" title={h.name}>
                      {h.name}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveCustomHoliday(h.date)}
                    className="text-gray-400 hover:text-red-600 p-1 rounded transition-colors cursor-pointer shrink-0"
                    title={`ลบวันหยุด ${h.name}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {showBuiltInHolidays && (
            <div className="mt-3 pt-3 border-t border-rose-200/70 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-rose-950">
                  วันหยุดนักขัตฤกษ์และวันหยุดชดเชยตามปฏิทินไทยในระบบ
                </span>
                <select
                  value={holidayPreviewYear}
                  onChange={(e) => setHolidayPreviewYear(Number(e.target.value))}
                  className="text-xs rounded-lg border border-rose-200 bg-white px-2.5 py-1 font-semibold text-rose-900"
                >
                  {[2024, 2025, 2026, 2027, 2028].map((y) => (
                    <option key={y} value={y}>
                      ปี พ.ศ. {y + 543}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 max-h-56 overflow-y-auto pr-1">
                {builtInHolidaysForPreview.map((item) => (
                  <div
                    key={item.date}
                    className="px-2.5 py-1.5 bg-white/90 border border-slate-200 rounded-lg text-[11px] flex items-center justify-between gap-2"
                  >
                    <span className="font-semibold text-slate-800 shrink-0">
                      {formatThaiShortDate(item.date)}
                    </span>
                    <span className="text-gray-600 truncate" title={item.name}>
                      {item.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SECTION 4: Settings & Formula Constants Section */}
      <div className="bg-white rounded-2xl shadow-xs border border-gray-200/90 p-5 space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-gray-700" />
            <h3 className="text-sm font-bold text-gray-900">
              ค่าคงที่สูตรคำนวณ Productivity และสิทธิ์ผู้ดูแลระบบ (จำค่าถาวร)
            </h3>
          </div>
          {settingsSaved && (
            <span className="text-xs text-emerald-600 font-bold flex items-center gap-1">
              <Check className="w-4 h-4" /> บันทึกการตั้งค่าเรียบร้อยแล้ว
            </span>
          )}
        </div>

        <form onSubmit={handleSaveSettingsSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                NHPPD หน่วยตรวจทั่วไป (ชม./คน)
              </label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                value={nhppd}
                onChange={(e) => setNhppd(Number(e.target.value))}
                className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border font-bold text-gray-900"
              />
              <span className="text-[10px] text-gray-500">มาตรฐานทุกหน่วยตรวจ = 0.4 (ยกเว้นหน่วยคัดกรอง)</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-cyan-800 mb-1">
                NHPPD หน่วยคัดกรอง (ชม./คน)
              </label>
              <input
                type="number"
                step="0.05"
                min="0.05"
                value={screeningNhppd}
                onChange={(e) => setScreeningNhppd(Number(e.target.value))}
                className="w-full text-xs rounded-lg border-cyan-300 bg-cyan-50/40 py-2 px-3 border font-bold text-cyan-950"
              />
              <span className="text-[10px] text-cyan-700 font-medium">เฉพาะหน่วยคัดกรองหน่วยเดียว = 0.1</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Std_Hr (ชม.ทำงานมาตรฐาน/วัน)
              </label>
              <input
                type="number"
                step="0.5"
                min="1"
                value={stdHr}
                onChange={(e) => setStdHr(Number(e.target.value))}
                className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border font-bold text-gray-900"
              />
              <span className="text-[10px] text-gray-500">มาตรฐาน = 7 ชั่วโมง</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Annual_Hr (ชม.ทำงาน/คน/ปี)
              </label>
              <input
                type="number"
                step="10"
                min="500"
                value={annualHr}
                onChange={(e) => setAnnualHr(Number(e.target.value))}
                className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border font-bold text-gray-900"
              />
              <span className="text-[10px] text-gray-500">มาตรฐาน = 2080 ชั่วโมง</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                Work_Days (วันทำงาน/ปี)
              </label>
              <input
                type="number"
                step="1"
                min="100"
                value={workDays}
                onChange={(e) => setWorkDays(Number(e.target.value))}
                className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border font-bold text-gray-900"
              />
              <span className="text-[10px] text-gray-500">มาตรฐาน = 245 วัน</span>
            </div>
          </div>

          {/* OT Compensation & Cost Center Settings */}
          <div className="bg-violet-50/50 border border-violet-200/80 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-violet-950">
                  ตั้งค่าค่าตอบแทน OT & Cost Center (สำหรับออกหลักฐานการจ่ายเงินค่าตอบแทน OT)
                </h4>
                <p className="text-[11px] text-violet-800/80 mt-0.5">
                  ใช้อ้างอิงอัตราค่าตอบแทนรายชั่วโมง ภาษี 5% และรหัส Cost Center ในแบบฟอร์มเบิกจ่ายเมนูที่ 2
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  Cost Center หลัก (มุมขวาบนแบบฟอร์ม)
                </label>
                <input
                  type="text"
                  value={defaultCostCenter}
                  onChange={(e) => setDefaultCostCenter(e.target.value)}
                  placeholder="เช่น 2012000000"
                  className="w-full text-xs rounded-lg border border-violet-200 py-1.5 px-2.5 font-mono font-bold text-gray-900 bg-white"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                  ชื่อผู้ควบคุม (หัวหน้าหน่วยการพยาบาลผู้ป่วยนอก บนแบบฟอร์มจ่าย OT)
                </label>
                <input
                  type="text"
                  value={otControllerName}
                  onChange={(e) => setOtControllerName(e.target.value)}
                  placeholder={DEFAULT_OT_CONTROLLER_NAME}
                  className="w-full text-xs rounded-lg border border-violet-200 py-1.5 px-2.5 font-semibold text-gray-900 bg-white"
                />
              </div>
            </div>

            <div>
              <span className="block text-[11px] font-bold text-violet-950 mb-2">
                อัตราค่าตอบแทน OT ต่อชั่วโมง (บาท/ชั่วโมง • ครอบคลุมทั้งประจำและจ้างรายวัน)
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">พยาบาล (HN/RN)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={otRateNurse}
                    onChange={(e) => setOtRateNurse(Number(e.target.value))}
                    className="w-full text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 font-bold text-blue-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">ผู้ช่วยพยาบาล (PN)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={otRatePn}
                    onChange={(e) => setOtRatePn(Number(e.target.value))}
                    className="w-full text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 font-bold text-teal-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">ผู้ช่วยคนไข้ (NA)</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={otRateNa}
                    onChange={(e) => setOtRateNa(Number(e.target.value))}
                    className="w-full text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 font-bold text-emerald-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">ผู้ปฏิบัติงานทั่วไป</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={otRateClerk}
                    onChange={(e) => setOtRateClerk(Number(e.target.value))}
                    className="w-full text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 font-bold text-amber-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">พนักงานบริการ</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={otRateServiceWorker}
                    onChange={(e) => setOtRateServiceWorker(Number(e.target.value))}
                    className="w-full text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 font-bold text-gray-900 bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white/90 rounded-lg border border-violet-200/80 p-3 space-y-2">
              <div className="text-[11px] font-bold text-gray-800">
                กำหนด Cost Center เฉพาะห้องตรวจ (ถ้าต่างจากค่าหลัก)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                <div className="sm:col-span-5">
                  <select
                    value={selectedCostCenterClinic}
                    onChange={(e) => {
                      const c = e.target.value;
                      setSelectedCostCenterClinic(c);
                      setClinicCostCenterDraft(clinicCostCenters[c] || '');
                    }}
                    className="w-full text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 bg-white font-medium"
                  >
                    {allClinicsForFilter.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-5">
                  <input
                    type="text"
                    value={clinicCostCenterDraft}
                    onChange={(e) => setClinicCostCenterDraft(e.target.value)}
                    placeholder={`ระบุ Cost Center ของ ${selectedCostCenterClinic}`}
                    className="w-full text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 font-mono bg-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedCostCenterClinic) return;
                      const trimmed = clinicCostCenterDraft.trim();
                      setClinicCostCenters((prev) => {
                        const next = { ...prev };
                        if (trimmed) next[selectedCostCenterClinic] = trimmed;
                        else delete next[selectedCostCenterClinic];
                        return next;
                      });
                    }}
                    className="w-full py-1.5 px-2.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    กำหนด/อัปเดต
                  </button>
                </div>
              </div>
              {Object.keys(clinicCostCenters).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {Object.entries(clinicCostCenters).map(([cl, cc]) => (
                    <span
                      key={cl}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-violet-100 text-violet-900 text-[11px] font-medium"
                    >
                      <span>{cl}: <strong className="font-mono">{cc}</strong></span>
                      <button
                        type="button"
                        onClick={() =>
                          setClinicCostCenters((prev) => {
                            const next = { ...prev };
                            delete next[cl];
                            return next;
                          })
                        }
                        className="text-violet-600 hover:text-red-600 cursor-pointer"
                        title="ลบ Cost Center เฉพาะห้องนี้"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Admin_Emails (อีเมลผู้มีสิทธิ์ดูแลระบบ คั่นด้วยเครื่องหมายจุลภาค ,)
            </label>
            <input
              type="text"
              value={adminEmailsStr}
              onChange={(e) => setAdminEmailsStr(e.target.value)}
              placeholder="screening.pcmc@gmail.com, admin@pcmc.ac.th"
              className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border font-mono"
            />
          </div>

          <div className="bg-red-50/50 border border-red-200/70 rounded-xl p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-bold text-red-950 flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-red-600" />
                  <span>รหัสผ่านความปลอดภัย Admin PIN (รหัสหลัก + รหัสแอดมินเพิ่มเติม 3 รหัส พร้อมระบุเจ้าของรหัส)</span>
                </label>
                <p className="text-[11px] text-red-800/80 mt-0.5">
                  ระบบจะบันทึกชื่อเจ้าของรหัสแอดมินกำกับทุกครั้งที่มีการแก้ไขหรือลบข้อมูล
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminPinSetting(!showAdminPinSetting)}
                className="text-xs text-red-700 hover:text-red-900 flex items-center gap-1 font-semibold cursor-pointer shrink-0"
              >
                {showAdminPinSetting ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" /> <span>ซ่อนรหัส</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" /> <span>แสดงรหัส</span>
                  </>
                )}
              </button>
            </div>

            {/* Primary Admin PIN (Default 4217 = หัวหน้าพยาบาล) */}
            <div className="bg-white rounded-xl border border-red-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-red-900">
                  รหัสแอดมินหลัก (รหัสเริ่มต้น: 4217)
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-bold">
                  Primary Admin
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    ชื่อเจ้าของรหัสหลัก *
                  </label>
                  <input
                    type="text"
                    value={primaryAdminOwner}
                    onChange={(e) => setPrimaryAdminOwner(e.target.value)}
                    placeholder="หัวหน้าพยาบาล"
                    className="w-full text-xs rounded-lg border border-red-200 py-1.5 px-2.5 font-semibold text-gray-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                    รหัส PIN หลัก (ปล่อยว่างเพื่อใช้ค่าเริ่มต้น 4217)
                  </label>
                  <input
                    type={showAdminPinSetting ? 'text' : 'password'}
                    value={adminPinSetting}
                    onChange={(e) => setAdminPinSetting(e.target.value)}
                    maxLength={10}
                    placeholder="ค่าเริ่มต้น: 4217"
                    className="w-full text-xs rounded-lg border border-red-200 py-1.5 px-2.5 font-mono tracking-wider bg-white font-bold text-red-950"
                  />
                </div>
              </div>
            </div>

            {/* 3 Additional Admin PIN Slots */}
            <div className="space-y-2">
              <div className="text-[11px] font-bold text-red-950">
                รหัสแอดมินเพิ่มเติม 3 รหัส (ระบุชื่อ/ตำแหน่งเจ้าของรหัสเพื่อติดตามการแก้ไขข้อมูล)
              </div>
              <div className="grid grid-cols-1 gap-2.5">
                {DEFAULT_ADDITIONAL_ADMIN_SLOTS.map((slot, idx) => {
                  const entry =
                    additionalAdminPins.find((p) => p.id === slot.id) ||
                    additionalAdminPins[idx] || {
                      id: slot.id,
                      ownerName: slot.defaultOwnerName,
                      pin: '',
                    };
                  const defaultCodeHint = idx === 0 ? '4218' : idx === 1 ? '4219' : '4220';

                  const updateSlot = (patch: Partial<AdminPinEntry>) => {
                    setAdditionalAdminPins((prev) => {
                      const base =
                        prev.length === DEFAULT_ADDITIONAL_ADMIN_SLOTS.length
                          ? prev
                          : buildDefaultAdditionalAdminPins();
                      return base.map((item, i) =>
                        item.id === slot.id || i === idx ? { ...item, ...patch } : item
                      );
                    });
                  };

                  return (
                    <div
                      key={slot.id}
                      className="bg-white rounded-xl border border-red-200/80 p-3 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
                    >
                      <div className="sm:col-span-2">
                        <span className="inline-block px-2 py-1 rounded-lg bg-rose-100 text-rose-900 font-bold text-[11px]">
                          รหัสแอดมิน {idx + 2}
                        </span>
                      </div>
                      <div className="sm:col-span-6">
                        <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                          ชื่อ / ตำแหน่งเจ้าของรหัส *
                        </label>
                        <input
                          type="text"
                          value={entry.ownerName}
                          onChange={(e) => updateSlot({ ownerName: e.target.value })}
                          placeholder={slot.defaultOwnerName}
                          className="w-full text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 font-semibold text-gray-900 bg-white"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-semibold text-gray-700 mb-1">
                          รหัส PIN (ค่าเริ่มต้น: {defaultCodeHint})
                        </label>
                        <input
                          type={showAdminPinSetting ? 'text' : 'password'}
                          value={entry.pin}
                          onChange={(e) => updateSlot({ pin: e.target.value })}
                          maxLength={10}
                          placeholder={`ปล่อยว่าง = ${defaultCodeHint}`}
                          className="w-full text-xs rounded-lg border border-gray-300 py-1.5 px-2.5 font-mono tracking-wider bg-white font-bold text-red-950"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
            {confirmResetAll ? (
              <div className="inline-flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                <span className="text-xs font-semibold text-red-800">ยืนยันล้างข้อมูลทั้งหมด?</span>
                <button
                  type="button"
                  onClick={() => {
                    onResetData();
                    setConfirmResetAll(false);
                  }}
                  className="px-2.5 py-1 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-md cursor-pointer"
                >
                  ยืนยันล้างข้อมูล
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmResetAll(false)}
                  className="px-2 py-1 text-xs font-semibold text-gray-600 hover:text-gray-900 cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmResetAll(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>ล้างข้อมูลทั้งหมดเพื่อเริ่มต้นใช้งานจริง (Reset Data)</span>
              </button>
            )}

            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 bg-gray-900 hover:bg-gray-800 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>บันทึกการตั้งค่าสูตรและสิทธิ์</span>
            </button>
          </div>
        </form>
      </div>

      {/* Edit Staff Modal (Name, Position, Clinic, Status, Start Date & End Date) */}
      {editingStaff && onUpdateStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-gray-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                <h3 className="text-base font-bold text-gray-900">
                  แก้ไขข้อมูลบุคลากร &amp; วันที่เริ่ม/สิ้นสุดปฏิบัติงาน
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingStaff(null);
                  setEditingOriginalStaffId(null);
                  setEditModalError('');
                }}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {editModalError && (
              <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{editModalError}</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">
                    รหัสบุคลากร (Staff_ID)
                  </label>
                  <input
                    type="text"
                    placeholder="เช่น 20708302"
                    value={
                      editingStaff.employeeCode ??
                      (!isLegacyGeneratedStaffId(editingStaff.staffId) ? editingStaff.staffId : '')
                    }
                    onChange={(e) => {
                      setEditModalError('');
                      setEditingStaff({ ...editingStaff, employeeCode: e.target.value });
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-mono font-semibold"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-gray-700 mb-1">ชื่อ - นามสกุล</label>
                  <input
                    type="text"
                    value={editingStaff.name}
                    onChange={(e) => setEditingStaff({ ...editingStaff, name: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-semibold"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">สถานะ</label>
                  <select
                    value={editingStaff.status}
                    onChange={(e) => {
                      const nextStatus = e.target.value as StaffStatus;
                      setEditingStaff({
                        ...editingStaff,
                        status: nextStatus,
                        endDate:
                          nextStatus === 'Active'
                            ? undefined
                            : editingStaff.endDate || todayStr,
                      });
                    }}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white font-semibold"
                  >
                    <option value="Active">Active (กำลังปฏิบัติงาน)</option>
                    <option value="Resigned">Resigned (ลาออก/ย้าย)</option>
                    <option value="Retired">Retired (เกษียณอายุ)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ตำแหน่งวิชาชีพ</label>
                  <select
                    value={editingStaff.position}
                    onChange={(e) => setEditingStaff({ ...editingStaff, position: e.target.value as StaffPosition })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    {ALL_POSITIONS.map(p => (
                      <option key={p} value={p}>{POSITION_LABELS[p]}</option>
                    ))}
                  </select>
                  {isDailyWagePosition(editingStaff.position) && (
                    <p className="text-[10px] text-sky-700 font-medium mt-1">
                      ตำแหน่งจ้างรายวัน: นับรวมในภาระงานประจำวันตามกลุ่มตำแหน่งหลัก โดยยังคงชื่อตำแหน่งจ้างรายวันไว้สำหรับทะเบียน วันลา และ OT/Unit Cost
                    </p>
                  )}
                </div>
                <div>
                  <label className="block font-semibold text-gray-700 mb-1">ห้องตรวจสังกัด</label>
                  <select
                    value={editingStaff.homeClinic}
                    onChange={(e) => setEditingStaff({ ...editingStaff, homeClinic: e.target.value })}
                    className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    {allClinicsForFilter.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/40">
                  <label className="block font-semibold text-emerald-800 mb-1.5">
                    วันเริ่มปฏิบัติงาน (วันแรก • พ.ศ.)
                  </label>
                  <ThaiDateInput
                    allowClear
                    value={editingStaff.startDate || ''}
                    onChange={(val) =>
                      setEditingStaff({
                        ...editingStaff,
                        startDate: val || undefined,
                      })
                    }
                  />
                </div>

                <div className="p-2.5 rounded-xl border border-amber-200 bg-amber-50/40">
                  <label className="block font-semibold text-amber-800 mb-1.5">
                    วันลาออก / เกษียณ (พ.ศ.)
                  </label>
                  <ThaiDateInput
                    allowClear
                    value={editingStaff.endDate || ''}
                    onChange={(val) =>
                      setEditingStaff({
                        ...editingStaff,
                        endDate: val || undefined,
                      })
                    }
                  />
                </div>
              </div>

              <p className="text-[11px] text-gray-500 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                ระบบ <strong>สรุป 12 เดือนปีงบประมาณ</strong> จะคำนวณวันทำงานตามช่วงระหว่างวันเริ่มปฏิบัติงานถึงวันลาออก/เกษียณ (หากยังไม่ระบุวันเริ่มงาน จะนับตั้งแต่วันแรกของปีงบประมาณ)
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 border-t pt-3">
              <button
                type="button"
                onClick={() => {
                  setEditingStaff(null);
                  setEditingOriginalStaffId(null);
                  setEditModalError('');
                }}
                className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  const cleanName = editingStaff.name.trim();
                  if (!cleanName) {
                    setEditModalError('กรุณาระบุชื่อ - นามสกุล');
                    return;
                  }
                  const rawCode = (editingStaff.employeeCode ?? '').trim();
                  if (rawCode && !isValidEmployeeCodeValue(rawCode)) {
                    setEditModalError('รหัสบุคลากรไม่ถูกต้อง (กรุณาระบุเลขรหัสบุคลากรจริง เช่น 20708302)');
                    return;
                  }
                  const originalId = editingOriginalStaffId || editingStaff.staffId;
                  if (rawCode) {
                    const dup = staffList.find(
                      (s) =>
                        s.staffId !== originalId &&
                        (s.staffId === rawCode || getStaffEmployeeCode(s) === rawCode)
                    );
                    if (dup) {
                      setEditModalError(`รหัสบุคลากร "${rawCode}" ซ้ำกับ ${dup.name} ในระบบ`);
                      return;
                    }
                  }
                  onUpdateStaff(
                    {
                      ...editingStaff,
                      staffId: rawCode || editingStaff.staffId,
                      employeeCode: rawCode || undefined,
                      name: cleanName,
                    },
                    originalId
                  );
                  setEditingStaff(null);
                  setEditingOriginalStaffId(null);
                  setEditModalError('');
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>บันทึกข้อมูลบุคลากร</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
