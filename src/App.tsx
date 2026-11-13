/**
 * PCMC OPD Workload & Productivity Management System
 * โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (PCMC)
 */

import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import confetti from 'canvas-confetti';
import { 
  StaffMember, 
  DailyWorkload, 
  LeaveRecord, 
  OTAttendance, 
  SystemSettings, 
  StaffStatus,
  LeaveType,
  IN_TIME_CLINICS,
  OUT_TIME_CLINICS
} from './types';
import { 
  loadLocalDatabase, 
  saveLocalDatabase, 
  createGoogleSpreadsheet,
  appendDailyWorkloadToSheet,
  appendLeaveToSheet,
  appendOTToSheet
} from './services/sheetsService';
import { 
  initAuth, 
  googleSignIn, 
  logout, 
  getAccessToken 
} from './services/firebaseAuth';
import { verifyAdminPin } from './services/adminSecurity';
import { Navbar } from './components/Navbar';
import { DailyWorkloadTab } from './components/DailyWorkloadTab';
import { LeaveAndOTTab } from './components/LeaveAndOTTab';
import { DailyCensusTab } from './components/DailyCensusTab';
import { ProductivityTab } from './components/ProductivityTab';
import { AdminPanelTab } from './components/AdminPanelTab';
import { GasExportModal } from './components/GasExportModal';
import { 
  ClipboardPen, 
  CalendarClock, 
  FileText, 
  Calculator, 
  UsersRound, 
  CheckCircle2, 
  AlertCircle,
  X
} from 'lucide-react';

export default function App() {
  // App Database State (pre-loaded from local storage or hospital defaults)
  const [db, setDb] = useState(() => loadLocalDatabase());
  const [activeTab, setActiveTab] = useState<'workload' | 'leave_ot' | 'census' | 'productivity' | 'admin'>('workload');

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [isSettingUpSheet, setIsSettingUpSheet] = useState<boolean>(false);

  // Modals & Toast State
  const [isGasModalOpen, setIsGasModalOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Auto-save local database whenever db changes
  useEffect(() => {
    saveLocalDatabase(db);
  }, [db]);

  // Initialize Firebase Auth listener
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser) => {
        setUser(currentUser);
      },
      () => {
        setUser(null);
      }
    );
    return () => unsubscribe();
  }, []);

  // Show toast notification
  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    if (type === 'success') {
      try {
        confetti({
          particleCount: 40,
          spread: 60,
          origin: { y: 0.85 },
          colors: ['#059669', '#0d9488', '#0891b2', '#3b82f6']
        });
      } catch {
        // Safe fallback
      }
    }
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Google Sign-In Handler
  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        showToast(`ยินดีต้อนรับ ${res.user.displayName || res.user.email}!`, 'success');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      showToast(`เข้าสู่ระบบไม่สำเร็จ: ${err.message || err}`, 'error');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Logout Handler
  const handleLogout = async () => {
    try {
      await logout();
      setUser(null);
      showToast('ออกจากระบบเรียบร้อยแล้ว', 'info');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Admin PIN Unlock State
  const [isAdminUnlocked, setIsAdminUnlocked] = useState<boolean>(() => {
    return sessionStorage.getItem('pcmc_admin_pin_unlocked') === 'true';
  });

  const handleUnlockAdmin = (pin: string) => {
    if (verifyAdminPin(pin, db.settings.adminPin)) {
      setIsAdminUnlocked(true);
      sessionStorage.setItem('pcmc_admin_pin_unlocked', 'true');
      showToast('ปลดล็อกสิทธิ์ผู้ดูแลระบบ (Admin) สำเร็จ!', 'success');
      return true;
    }
    return false;
  };

  const handleLockAdmin = () => {
    setIsAdminUnlocked(false);
    sessionStorage.removeItem('pcmc_admin_pin_unlocked');
    showToast('ล็อกสิทธิ์ผู้ดูแลระบบแล้ว', 'info');
  };

  // Check Admin permission: active if unlocked by PIN or Google user is in Admin_Emails
  const isGoogleAdmin = Boolean(
    user?.email && 
    db.settings.adminEmails.some(e => e.toLowerCase() === user.email?.toLowerCase())
  );
  const isAdmin = isAdminUnlocked || isGoogleAdmin;

  // Dynamic clinic lists managed by Admin (with fallback defaults)
  const inTimeClinics = db.settings.inTimeClinics && db.settings.inTimeClinics.length > 0
    ? db.settings.inTimeClinics
    : [...IN_TIME_CLINICS];
  const outTimeClinics = db.settings.outTimeClinics && db.settings.outTimeClinics.length > 0
    ? db.settings.outTimeClinics
    : [...OUT_TIME_CLINICS];

  // Setup Google Spreadsheet (Creates 5 sheets in Google Drive via Sheets API)
  const handleSetupSpreadsheet = async () => {
    let token = await getAccessToken();
    if (!token) {
      // Prompt user to sign in
      const confirmLogin = window.confirm(
        'การสร้าง Google Spreadsheet ต้องเชื่อมต่อสิทธิ์กับ Google บัญชีของคุณ\nต้องการเข้าสู่ระบบ Google ทันทีหรือไม่?'
      );
      if (!confirmLogin) return;

      try {
        const loginRes = await googleSignIn();
        if (!loginRes) return;
        token = loginRes.accessToken;
        setUser(loginRes.user);
      } catch (e: any) {
        showToast('การเข้าสู่ระบบถูกยกเลิก', 'error');
        return;
      }
    }

    if (!token) {
      showToast('ไม่พบคีย์การเข้าถึง Google', 'error');
      return;
    }

    setIsSettingUpSheet(true);
    try {
      const { spreadsheetId, spreadsheetUrl } = await createGoogleSpreadsheet(
        token,
        db.staff,
        db.settings
      );

      setDb(prev => ({
        ...prev,
        settings: {
          ...prev.settings,
          spreadsheetId,
          spreadsheetUrl,
        }
      }));

      showToast('สร้างฐานข้อมูล Google Sheets 5 ชีทเรียบร้อยแล้ว!', 'success');
    } catch (err: any) {
      console.error('Setup spreadsheet error:', err);
      showToast(`เกิดข้อผิดพลาดในการสร้างชีท: ${err.message || err}`, 'error');
    } finally {
      setIsSettingUpSheet(false);
    }
  };

  // Handler: Save Daily Workload
  const handleSaveWorkload = async (
    entry: DailyWorkload,
    leaveData?: { staffName: string; leaveType: LeaveType; note: string }[] | null,
    crossCoverageData?: { staffName: string; targetClinic: string } | null,
    trainingData?: { staffName: string; topic: string; note: string }[] | null
  ) => {
    const newLeaveEntries: LeaveRecord[] = [];
    const newOtEntries: OTAttendance[] = [];

    if (leaveData) {
      leaveData.forEach((ld, idx) => {
        const staff = db.staff.find(s => s.name === ld.staffName);
        newLeaveEntries.push({
          id: `LV-AUTO-${Date.now()}-${idx}-${ld.staffName}`,
          startDate: entry.date,
          endDate: entry.date,
          staffName: ld.staffName,
          position: staff ? staff.position : 'RN',
          clinic: staff ? staff.homeClinic : entry.clinic,
          leaveType: ld.leaveType,
          days: 1,
          note: ld.note,
        });
      });
    }

    if (trainingData) {
      trainingData.forEach((td, idx) => {
        const staff = db.staff.find(s => s.name === td.staffName);
        newLeaveEntries.push({
          id: `TRN-AUTO-${Date.now()}-${idx}-${td.staffName}`,
          startDate: entry.date,
          endDate: entry.date,
          staffName: td.staffName,
          position: staff ? staff.position : 'RN',
          clinic: staff ? staff.homeClinic : entry.clinic,
          leaveType: 'ไปอบรม/ประชุม',
          days: 1,
          note: [td.topic, td.note].filter(Boolean).join(' — ') || `ไปอบรม/ประชุม (บันทึกจาก ${entry.clinic})`,
        });
      });
    }

    if (crossCoverageData) {
      const staff = db.staff.find(s => s.name === crossCoverageData.staffName);
      newOtEntries.push({
        id: `OT-CROSS-${Date.now()}`,
        date: entry.date,
        shift: entry.shift,
        staffName: crossCoverageData.staffName,
        position: staff ? staff.position : 'RN',
        homeClinic: staff ? staff.homeClinic : entry.clinic,
        workClinic: crossCoverageData.targetClinic,
      });
    }

    setDb(prev => ({
      ...prev,
      workloads: [entry, ...prev.workloads],
      leaves: [...newLeaveEntries, ...prev.leaves],
      ot: [...newOtEntries, ...prev.ot],
    }));

    showToast(`บันทึกภาระงานห้องตรวจ ${entry.clinic} สำเร็จ!`, 'success');

    // Async sync to Google Sheets if connected
    const token = await getAccessToken();
    if (token && db.settings.spreadsheetId) {
      appendDailyWorkloadToSheet(token, db.settings.spreadsheetId, entry);
      newLeaveEntries.forEach(l => appendLeaveToSheet(token, db.settings.spreadsheetId!, l));
      newOtEntries.forEach(o => appendOTToSheet(token, db.settings.spreadsheetId!, o));
    }
  };

  // Handler: Update Daily Workload (Admin)
  const handleUpdateWorkload = (updated: DailyWorkload) => {
    setDb(prev => ({
      ...prev,
      workloads: prev.workloads.map(w => w.id === updated.id ? updated : w),
    }));
    showToast(`อัปเดตข้อมูลภาระงานห้องตรวจ ${updated.clinic} สำเร็จ!`, 'success');
  };

  // Handler: Delete Daily Workload
  const handleDeleteWorkload = (id: string) => {
    if (window.confirm('ยืนยันที่จะลบรายการบันทึกภาระงานนี้หรือไม่?')) {
      setDb(prev => ({
        ...prev,
        workloads: prev.workloads.filter(w => w.id !== id),
      }));
      showToast('ลบรายการเรียบร้อยแล้ว', 'info');
    }
  };

  // Handler: Save Leave
  const handleSaveLeave = async (leave: LeaveRecord) => {
    setDb(prev => ({
      ...prev,
      leaves: [leave, ...prev.leaves],
    }));
    showToast(`บันทึกวันลา ${leave.staffName} สำเร็จ!`, 'success');

    const token = await getAccessToken();
    if (token && db.settings.spreadsheetId) {
      appendLeaveToSheet(token, db.settings.spreadsheetId, leave);
    }
  };

  // Handler: Update Leave (Admin)
  const handleUpdateLeave = (updated: LeaveRecord) => {
    setDb(prev => ({
      ...prev,
      leaves: prev.leaves.map(l => l.id === updated.id ? updated : l),
    }));
    showToast(`อัปเดตประวัติการลา ${updated.staffName} เรียบร้อยแล้ว`, 'success');
  };

  // Handler: Delete Leave
  const handleDeleteLeave = (id: string) => {
    if (window.confirm('ยืนยันที่จะลบประวัติการลานี้หรือไม่?')) {
      setDb(prev => ({
        ...prev,
        leaves: prev.leaves.filter(l => l.id !== id),
      }));
      showToast('ลบประวัติการลาเรียบร้อยแล้ว', 'info');
    }
  };

  // Handler: Save Batch OT
  const handleSaveBatchOT = async (records: OTAttendance[]) => {
    setDb(prev => ({
      ...prev,
      ot: [...records, ...prev.ot],
    }));
    showToast(`บันทึกเวรนอกเวลาจำนวน ${records.length} คน เรียบร้อยแล้ว!`, 'success');

    const token = await getAccessToken();
    if (token && db.settings.spreadsheetId) {
      records.forEach(r => {
        appendOTToSheet(token, db.settings.spreadsheetId!, r);
      });
    }
  };

  // Handler: Update OT (Admin)
  const handleUpdateOT = (updated: OTAttendance) => {
    setDb(prev => ({
      ...prev,
      ot: prev.ot.map(o => o.id === updated.id ? updated : o),
    }));
    showToast(`อัปเดตเวรนอกเวลา ${updated.staffName} เรียบร้อยแล้ว`, 'success');
  };

  // Handler: Delete OT
  const handleDeleteOT = (id: string) => {
    setDb(prev => ({
      ...prev,
      ot: prev.ot.filter(o => o.id !== id),
    }));
    showToast('ลบรายการเวรนอกเวลาแล้ว', 'info');
  };

  // Handler: Add Staff Member
  const handleAddStaff = (staff: StaffMember) => {
    setDb(prev => ({
      ...prev,
      staff: [...prev.staff, staff],
    }));
    showToast(`เพิ่มเจ้าหน้าที่ ${staff.name} เข้าสู่ระบบแล้ว`, 'success');
  };

  // Handler: Update Staff Status (Active / Resigned / Retired)
  const handleUpdateStaffStatus = (staffId: string, status: StaffStatus) => {
    setDb(prev => ({
      ...prev,
      staff: prev.staff.map(s => s.staffId === staffId ? { ...s, status } : s),
    }));
    showToast(`อัปเดตสถานะเป็น ${status} สำเร็จ`, 'info');
  };

  // Handler: Save Settings
  const handleSaveSettings = (settings: SystemSettings) => {
    setDb(prev => ({
      ...prev,
      settings,
    }));
    showToast('บันทึกการตั้งค่าสูตรเรียบร้อยแล้ว', 'success');
  };

  // Handler: Reset to Initial Sample Data
  const handleResetData = () => {
    if (window.confirm('ต้องการรีเซ็ตข้อมูลทั้งหมดกลับเป็นค่าเริ่มต้นของโรงพยาบาลชลประทานหรือไม่?')) {
      localStorage.removeItem('pcmc_opd_system_db_v1');
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-800 flex flex-col font-sans">
      {/* Top Navbar */}
      <Navbar
        user={user}
        isAdmin={isAdmin}
      />

      {/* Floating Toast Message */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-bounce">
          <div className={`px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-2.5 text-xs font-semibold ${
            toastMessage.type === 'success' 
              ? 'bg-emerald-900 text-white border-emerald-700' 
              : toastMessage.type === 'error'
              ? 'bg-red-900 text-white border-red-700'
              : 'bg-slate-900 text-white border-slate-700'
          }`}>
            {toastMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            )}
            <span>{toastMessage.text}</span>
            <button 
              onClick={() => setToastMessage(null)}
              className="ml-2 hover:opacity-75 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex-1 w-full space-y-5">
        {/* 5 Main Tabs Navigation Bar */}
        <div className="no-print bg-white p-1.5 rounded-2xl shadow-xs border border-gray-200/90 flex flex-wrap gap-1">
          <button
            onClick={() => setActiveTab('workload')}
            className={`flex-1 min-w-[170px] py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'workload'
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-emerald-800 hover:bg-emerald-50/50'
            }`}
          >
            <ClipboardPen className="w-4 h-4" />
            <span>1. บันทึกภาระงานประจำวัน</span>
          </button>

          <button
            onClick={() => setActiveTab('leave_ot')}
            className={`flex-1 min-w-[170px] py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'leave_ot'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-teal-800 hover:bg-teal-50/50'
            }`}
          >
            <CalendarClock className="w-4 h-4" />
            <span>2. บันทึกเวรนอกเวลา & วันลา</span>
          </button>

          <button
            onClick={() => setActiveTab('census')}
            className={`flex-1 min-w-[170px] py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'census'
                ? 'bg-blue-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-blue-800 hover:bg-blue-50/50'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>3. รายงานผู้ป่วยประจำวัน</span>
          </button>

          <button
            onClick={() => setActiveTab('productivity')}
            className={`flex-1 min-w-[170px] py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'productivity'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'text-gray-600 hover:text-amber-800 hover:bg-amber-50/50'
            }`}
          >
            <Calculator className="w-4 h-4" />
            <span>4. สรุป Productivity & FTC</span>
          </button>

          <button
            onClick={() => setActiveTab('admin')}
            className={`flex-1 min-w-[170px] py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              activeTab === 'admin'
                ? 'bg-red-700 text-white shadow-xs'
                : 'text-gray-600 hover:text-red-800 hover:bg-red-50/50'
            }`}
          >
            <UsersRound className="w-4 h-4" />
            <span>5. จัดการบุคลากร & ตั้งค่า</span>
          </button>
        </div>

        {/* Tab 1: Daily Workload Entry */}
        {activeTab === 'workload' && (
          <DailyWorkloadTab
            workloads={db.workloads}
            staffList={db.staff}
            inTimeClinics={inTimeClinics}
            outTimeClinics={outTimeClinics}
            onSaveWorkload={handleSaveWorkload}
            onUpdateWorkload={handleUpdateWorkload}
            onDeleteWorkload={handleDeleteWorkload}
            defaultReporter=""
            isAdmin={isAdmin}
            onPromptAdminUnlock={() => setActiveTab('admin')}
          />
        )}

        {/* Tab 2: Leave & OT Tracker */}
        {activeTab === 'leave_ot' && (
          <LeaveAndOTTab
            staffList={db.staff}
            leaves={db.leaves}
            otRecords={db.ot}
            workloads={db.workloads}
            inTimeClinics={inTimeClinics}
            outTimeClinics={outTimeClinics}
            isAdmin={isAdmin}
            onSaveLeave={handleSaveLeave}
            onSaveBatchOT={handleSaveBatchOT}
            onUpdateLeave={handleUpdateLeave}
            onDeleteLeave={handleDeleteLeave}
            onUpdateOT={handleUpdateOT}
            onDeleteOT={handleDeleteOT}
          />
        )}

        {/* Tab 3: Daily OPD Census Report */}
        {activeTab === 'census' && (
          <DailyCensusTab
            workloads={db.workloads}
            isAdmin={isAdmin}
            onUpdateWorkload={handleUpdateWorkload}
            onDeleteWorkload={handleDeleteWorkload}
          />
        )}

        {/* Tab 4: Monthly Productivity & Skill Mix */}
        {activeTab === 'productivity' && (
          <ProductivityTab
            workloads={db.workloads}
            settings={db.settings}
            inTimeClinics={inTimeClinics}
            outTimeClinics={outTimeClinics}
          />
        )}

        {/* Tab 5: Admin Panel & Staff Master */}
        {activeTab === 'admin' && (
          <AdminPanelTab
            staffList={db.staff}
            settings={db.settings}
            inTimeClinics={inTimeClinics}
            outTimeClinics={outTimeClinics}
            isAdmin={isAdmin}
            isAdminUnlocked={isAdminUnlocked || isGoogleAdmin}
            user={user}
            onLogin={handleLogin}
            onLogout={handleLogout}
            isLoggingIn={isLoggingIn}
            onOpenGasModal={() => setIsGasModalOpen(true)}
            onAddStaff={handleAddStaff}
            onUpdateStaffStatus={handleUpdateStaffStatus}
            onSaveSettings={handleSaveSettings}
            onResetData={handleResetData}
            onSetupSpreadsheet={handleSetupSpreadsheet}
            isSettingUpSheet={isSettingUpSheet}
            onUnlockAdmin={handleUnlockAdmin}
            onLockAdmin={handleLockAdmin}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="no-print bg-white border-t border-gray-200 mt-12 py-5 text-center text-xs text-gray-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            © 2026 โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (PCMC) • กลุ่มงานการพยาบาลผู้ป่วยนอก
          </div>
          <div className="text-[11px] text-gray-400">
            ระบบบริหารจัดการภาระงานและ Productivity OPD • รองรับ Google Sheets & Apps Script
          </div>
        </div>
      </footer>

      {/* GAS Code Modal */}
      <GasExportModal
        isOpen={isGasModalOpen}
        onClose={() => setIsGasModalOpen(false)}
      />
    </div>
  );
}
