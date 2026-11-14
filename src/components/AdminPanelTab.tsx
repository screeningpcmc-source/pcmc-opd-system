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
  LEAVE_TYPES,
  POSITION_LABELS,
  formatPositionLabel
} from '../types';
import { verifyAdminPin } from '../services/adminSecurity';
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
  LogOut,
  RefreshCw,
  CheckCircle2,
  Building2,
  Plus,
  Trash2,
  Link2,
  Share2,
  Copy,
  Unlink,
  CalendarOff
} from 'lucide-react';

interface AdminPanelTabProps {
  staffList: StaffMember[];
  settings: SystemSettings;
  inTimeClinics: string[];
  outTimeClinics: string[];
  leaveTypes: string[];
  isAdmin: boolean;
  isAdminUnlocked?: boolean;
  user: User | null;
  onLogin: () => void;
  onLogout: () => void;
  isLoggingIn: boolean;
  onAddStaff: (staff: StaffMember) => void;
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
}

export const AdminPanelTab: React.FC<AdminPanelTabProps> = ({
  staffList,
  settings,
  inTimeClinics,
  outTimeClinics,
  leaveTypes,
  isAdminUnlocked = false,
  user,
  onLogin,
  onLogout,
  isLoggingIn,
  onAddStaff,
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
}) => {
  // Staff search & filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [positionFilter, setPositionFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [clinicFilter, setClinicFilter] = useState<string>('ALL');

  // Add new staff form state (No visible Staff ID)
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [newName, setNewName] = useState<string>('');
  const [newPosition, setNewPosition] = useState<StaffPosition>('RN');
  const [newClinic, setNewClinic] = useState<string>(inTimeClinics[0] || IN_TIME_CLINICS[0]);
  const [newStatus, setNewStatus] = useState<StaffStatus>('Active');
  const [confirmDeleteStaffId, setConfirmDeleteStaffId] = useState<string | null>(null);
  const [confirmResetAll, setConfirmResetAll] = useState<boolean>(false);
  const [copiedShareLink, setCopiedShareLink] = useState<boolean>(false);
  const [inlineError, setInlineError] = useState<string>('');

  // Clinic & Leave Type Management state
  const [newInClinicName, setNewInClinicName] = useState<string>('');
  const [newOutClinicName, setNewOutClinicName] = useState<string>('');
  const [newLeaveTypeName, setNewLeaveTypeName] = useState<string>('');
  const [showSheetLinkConfig, setShowSheetLinkConfig] = useState<boolean>(false);

  // PIN Security Gate State
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [showPinInputMask, setShowPinInputMask] = useState<boolean>(false);
  const [adminPinSetting, setAdminPinSetting] = useState<string>(settings.adminPin || '');
  const [showAdminPinSetting, setShowAdminPinSetting] = useState<boolean>(false);

  // Settings form state (kept in sync with persisted settings)
  const [nhppd, setNhppd] = useState<number>(settings.nhppd);
  const [stdHr, setStdHr] = useState<number>(settings.stdHr);
  const [annualHr, setAnnualHr] = useState<number>(settings.annualHr);
  const [workDays, setWorkDays] = useState<number>(settings.workDays);
  const [adminEmailsStr, setAdminEmailsStr] = useState<string>(settings.adminEmails.join(', '));
  const [customSheetUrl, setCustomSheetUrl] = useState<string>(settings.spreadsheetUrl || '');
  const [settingsSaved, setSettingsSaved] = useState<boolean>(false);

  useEffect(() => {
    setNhppd(settings.nhppd);
    setStdHr(settings.stdHr);
    setAnnualHr(settings.annualHr);
    setWorkDays(settings.workDays);
    setAdminEmailsStr(settings.adminEmails.join(', '));
    setAdminPinSetting(settings.adminPin || '');
    setCustomSheetUrl(settings.spreadsheetUrl || '');
  }, [settings]);

  useEffect(() => {
    if (inTimeClinics.length > 0 && !inTimeClinics.includes(newClinic)) {
      setNewClinic(inTimeClinics[0]);
    }
  }, [inTimeClinics, newClinic]);

  const handlePinSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (verifyAdminPin(pinInput, settings.adminPin)) {
      setPinError('');
      if (onUnlockAdmin) {
        onUnlockAdmin(pinInput.trim());
      }
      setPinInput('');
    } else {
      setPinError('รหัสผ่านไม่ถูกต้อง กรุณาระบุรหัสผ่านความปลอดภัย 4 หลักที่ถูกต้อง');
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
        if (next.length === 4 && verifyAdminPin(next, settings.adminPin)) {
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

  // Filtered staff list (search by name, position label, or clinic — no ID)
  const filteredStaff = useMemo(() => {
    return staffList.filter(s => {
      const q = searchQuery.toLowerCase().trim();
      const posLabel = formatPositionLabel(s.position).toLowerCase();
      const matchSearch = !q ||
        s.name.toLowerCase().includes(q) ||
        s.position.toLowerCase().includes(q) ||
        posLabel.includes(q) ||
        s.homeClinic.toLowerCase().includes(q);
      const matchPos = positionFilter === 'ALL' || s.position === positionFilter;
      const matchStat = statusFilter === 'ALL' || s.status === statusFilter;
      const matchClinic = clinicFilter === 'ALL' || s.homeClinic === clinicFilter;

      return matchSearch && matchPos && matchStat && matchClinic;
    });
  }, [staffList, searchQuery, positionFilter, statusFilter, clinicFilter]);

  // Statistics
  const activeCount = staffList.filter(s => s.status === 'Active').length;
  const resignedCount = staffList.filter(s => s.status === 'Resigned').length;
  const retiredCount = staffList.filter(s => s.status === 'Retired').length;

  // Handle Add Staff (auto-generate invisible internal key)
  const handleAddStaffSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) {
      setInlineError('กรุณาระบุชื่อ-นามสกุลเจ้าหน้าที่');
      return;
    }
    setInlineError('');

    const staff: StaffMember = {
      staffId: `STF-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: newName.trim(),
      position: newPosition,
      homeClinic: newClinic,
      status: newStatus,
    };

    onAddStaff(staff);
    setNewName('');
    setNewStatus('Active');
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
    onSaveSettings({
      ...settings,
      inTimeClinics: [...IN_TIME_CLINICS],
      outTimeClinics: [...OUT_TIME_CLINICS],
    });
  };

  // Save custom spreadsheet link/ID
  const handleSaveSheetLink = () => {
    const raw = customSheetUrl.trim();
    if (!raw) {
      onSaveSettings({
        ...settings,
        spreadsheetId: undefined,
        spreadsheetUrl: undefined,
      });
      return;
    }
    const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    const extractedId = idMatch ? idMatch[1] : raw;
    const normalizedUrl = raw.startsWith('http')
      ? raw
      : `https://docs.google.com/spreadsheets/d/${extractedId}/edit`;

    onSaveSettings({
      ...settings,
      spreadsheetId: extractedId,
      spreadsheetUrl: normalizedUrl,
    });
  };

  const handleUnlinkSheet = () => {
    setCustomSheetUrl('');
    onSaveSettings({
      ...settings,
      spreadsheetId: undefined,
      spreadsheetUrl: undefined,
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
    return settings.spreadsheetId
      ? `${base}?sheetId=${encodeURIComponent(settings.spreadsheetId)}`
      : base;
  }, [settings.spreadsheetId]);

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

  // Handle Save Settings
  const handleSaveSettingsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const emails = adminEmailsStr
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0);

    const updated: SystemSettings = {
      ...settings,
      nhppd: Number(nhppd) || 0.4,
      stdHr: Number(stdHr) || 7,
      annualHr: Number(annualHr) || 2080,
      workDays: Number(workDays) || 245,
      adminEmails: emails.length > 0 ? emails : settings.adminEmails,
      adminPin: adminPinSetting.trim(),
      inTimeClinics,
      outTimeClinics,
      leaveTypes,
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
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-emerald-800 bg-emerald-100/90 border border-emerald-300 rounded-full">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>ปลดล็อกสิทธิ์ Admin แล้ว</span>
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

      {/* SECTION 1: Google Workspace, Google Sheets (5 ชีท) & Share Link */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-cyan-900 text-white rounded-2xl p-5 shadow-md space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-sm font-bold flex items-center gap-2 text-emerald-200">
              <FileSpreadsheet className="w-5 h-5 text-emerald-300" />
              <span>การเชื่อมต่อ Google Sheets (5 ชีท) และแชร์ลิงก์ให้บุคลากร OPD</span>
            </h3>
            <p className="text-xs text-emerald-100/80">
              {settings.spreadsheetId
                ? 'เชื่อมโยงฐานข้อมูล Google Sheets เรียบร้อยแล้ว (ซ่อนรหัสและลิงก์ชีทเพื่อความปลอดภัย)'
                : 'ลงชื่อเข้าใช้ Google เพื่อสร้างฐานข้อมูล 5 ชีทใหม่ หรือตั้งค่าลิงก์ Google Sheets'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* 1. When Sheet Link/ID already exists -> Open Sheet + Sync (NO Create New!) */}
            {settings.spreadsheetId || settings.spreadsheetUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={settings.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${settings.spreadsheetId}/edit`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-100 border border-emerald-400/50 rounded-xl transition-colors"
                >
                  <ExternalLink className="w-4 h-4 text-emerald-300" />
                  <span>เปิด Google Sheets (5 ชีท)</span>
                </a>
                <button
                  type="button"
                  onClick={onSyncSpreadsheet}
                  disabled={isSyncingSheet}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white border border-teal-400/40 rounded-xl shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                  title="ซิงค์ข้อมูลไป-กลับระหว่างหน้าเว็บกับ Google Sheet ปัจจุบัน (ไม่สร้างไฟล์ใหม่)"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
                  <span>{isSyncingSheet ? 'กำลังซิงค์ข้อมูล...' : 'ซิงค์ข้อมูลกับ Google Sheet'}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onSetupSpreadsheet}
                disabled={isSettingUpSheet}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white border border-teal-400/40 rounded-xl shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                {isSettingUpSheet ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                    <span>กำลังสร้างชีท...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-yellow-300" />
                    <span>สร้าง 5 ชีทใน Google Drive</span>
                  </>
                )}
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
              title="คัดลอกลิงก์หน้าเว็บ (พร้อมผูก ID ชีทให้อัตโนมัติ) ส่งให้บุคลากร OPD ใช้งาน"
            >
              {copiedShareLink ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4 text-cyan-300" />}
              <span>{copiedShareLink ? 'คัดลอกลิงก์แล้ว!' : 'คัดลอกลิงก์แชร์ให้ OPD'}</span>
            </button>

            {/* Discrete toggle for Sheet ID config (hidden by default per Image 2) */}
            <button
              type="button"
              onClick={() => setShowSheetLinkConfig((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-semibold bg-black/20 hover:bg-black/35 text-emerald-100/80 border border-white/15 rounded-xl transition-colors cursor-pointer"
              title="แสดง/ซ่อนช่องตั้งค่าลิงก์ Google Sheets"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{showSheetLinkConfig ? 'ซ่อนตั้งค่าลิงก์' : 'ตั้งค่าลิงก์ชีท'}</span>
            </button>

            {/* 3. Google Sign-In / Account Status (persisted across reloads) */}
            {user ? (
              <div className="flex items-center gap-2 bg-black/25 backdrop-blur px-3 py-1.5 rounded-xl border border-white/15">
                <div className="text-right">
                  <div className="text-xs font-semibold text-white truncate max-w-[160px]">
                    {user.displayName || user.email?.split('@')[0]}
                  </div>
                  <div className="text-[10px] text-emerald-200 flex items-center gap-1 justify-end">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 inline" />
                    <span>{user.email}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onLogout}
                  className="p-1.5 hover:bg-white/20 rounded-lg text-red-200 hover:text-red-100 transition-colors cursor-pointer"
                  title="ออกจากระบบ Google"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onLogin}
                disabled={isLoggingIn}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold bg-white text-gray-800 hover:bg-gray-50 rounded-xl shadow transition-all cursor-pointer disabled:opacity-60"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
                <span>{isLoggingIn ? 'กำลังเข้าสู่ระบบ...' : 'Sign in with Google'}</span>
              </button>
            )}
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
              {(settings.spreadsheetId || settings.spreadsheetUrl) && (
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

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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
            </div>

            <div className="flex justify-end pt-2">
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
              placeholder="ค้นหาชื่อ, ตำแหน่ง, คลินิก..."
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

        {/* Staff Table (Staff ID Column Removed) */}
        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full text-left text-xs border border-gray-100 rounded-lg">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b sticky top-0 z-10">
              <tr>
                <th className="py-2.5 px-3">ชื่อ - นามสกุล</th>
                <th className="py-2.5 px-2">ตำแหน่งวิชาชีพ</th>
                <th className="py-2.5 px-3">ห้องตรวจสังกัด</th>
                <th className="py-2.5 px-2 text-center">สถานะ</th>
                <th className="py-2.5 px-3 text-center">เปลี่ยนสถานะ / ลบรายชื่อ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    ไม่พบบุคลากรตามเงื่อนไขที่ค้นหา
                  </td>
                </tr>
              ) : (
                filteredStaff.map((staff) => (
                  <tr key={staff.staffId} className="hover:bg-slate-50/80">
                    <td className="py-2 px-3 font-bold text-gray-900">{staff.name}</td>
                    <td className="py-2 px-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                        staff.position === 'HN' ? 'bg-purple-100 text-purple-800' :
                        staff.position === 'RN' ? 'bg-blue-100 text-blue-800' :
                        staff.position === 'PN' ? 'bg-teal-100 text-teal-800' :
                        (staff.position === 'NA' || staff.position === 'PCA') ? 'bg-emerald-100 text-emerald-800' :
                        staff.position === 'Clerk' ? 'bg-amber-100 text-amber-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {formatPositionLabel(staff.position)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-700">{staff.homeClinic}</td>
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
                ))
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
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">
                NHPPD (ชม.การพยาบาล/คน)
              </label>
              <input
                type="number"
                step="0.05"
                min="0.1"
                value={nhppd}
                onChange={(e) => setNhppd(Number(e.target.value))}
                className="w-full text-xs rounded-lg border-gray-300 py-2 px-3 border font-bold text-gray-900"
              />
              <span className="text-[10px] text-gray-500">มาตรฐาน OPD สป.สธ. = 0.4</span>
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

          <div className="bg-red-50/50 border border-red-200/70 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-red-950 flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-red-600" />
                <span>รหัสผ่านความปลอดภัย Admin PIN (ความลับ)</span>
              </label>
              <button
                type="button"
                onClick={() => setShowAdminPinSetting(!showAdminPinSetting)}
                className="text-xs text-red-700 hover:text-red-900 flex items-center gap-1 font-semibold cursor-pointer"
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
            <div className="relative">
              <input
                type={showAdminPinSetting ? 'text' : 'password'}
                value={adminPinSetting}
                onChange={(e) => setAdminPinSetting(e.target.value)}
                maxLength={10}
                placeholder="ปล่อยว่างเพื่อใช้รหัสหลัก (VITE_ADMIN_PIN) หรือกรอกรหัสใหม่"
                className="w-full text-sm rounded-lg border-red-300 py-2 px-3 border font-mono tracking-wider bg-white font-bold text-red-950"
              />
            </div>
            <p className="text-[11px] text-red-800">
              * ใช้สำหรับปลดล็อกเข้าสู่หน้าจัดการบุคลากรและการแก้ไข/ลบรายการบันทึก
            </p>
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
    </div>
  );
};
