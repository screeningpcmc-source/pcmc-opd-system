import React from 'react';
import { 
  Building2, 
  ShieldCheck,
  Lock,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';

interface NavbarProps {
  isAdmin: boolean;
  onLockAdmin?: () => void;
  hasSpreadsheet?: boolean;
  isSyncingSheet?: boolean;
  autoSyncEnabled?: boolean;
  lastSyncedAt?: string | null;
  onManualSync?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  isAdmin,
  onLockAdmin,
  hasSpreadsheet = false,
  isSyncingSheet = false,
  autoSyncEnabled = true,
  lastSyncedAt = null,
  onManualSync,
}) => {
  return (
    <header className="no-print bg-gradient-to-r from-emerald-800 via-teal-800 to-cyan-900 text-white shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* Hospital Branding */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center shadow-inner text-emerald-300">
            <Building2 className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg sm:text-xl tracking-tight leading-tight text-white">
                โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน
              </h1>
              <span className="hidden sm:inline-block px-2 py-0.5 text-xs font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 rounded-full">
                PCMC OPD
              </span>
            </div>
            <p className="text-xs sm:text-sm text-emerald-100/80 font-normal">
              ระบบบริหารจัดการภาระงานผู้ป่วย เวรนอกเวลา และ Productivity กลุ่มงานการพยาบาล
            </p>
          </div>
        </div>

        {/* Sync Status + Manual Sync Button + Admin Mode Indicator */}
        <div className="flex flex-wrap items-center gap-2">
          {hasSpreadsheet && onManualSync && (
            <div className="flex items-center gap-2">
              <div
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/20 border border-white/15 text-[11px] text-emerald-100"
                title={
                  autoSyncEnabled
                    ? 'ระบบจะซิงค์ข้อมูลกับ Google Sheet อัตโนมัติเมื่อเปิดเว็บ, หลังแก้ไขข้อมูล และทุก 3 นาที'
                    : 'ปิดโหมด Auto ซิงค์อยู่ (สามารถกดปุ่มซิงค์ด้วยตนเองได้)'
                }
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isSyncingSheet
                      ? 'bg-amber-400 animate-ping'
                      : autoSyncEnabled
                      ? 'bg-emerald-400'
                      : 'bg-slate-400'
                  }`}
                />
                <span>{autoSyncEnabled ? 'Auto ซิงค์' : 'ซิงค์ด้วยตนเอง'}</span>
                {lastSyncedAt && (
                  <span className="text-emerald-200/80 flex items-center gap-0.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-300" />
                    {lastSyncedAt}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={onManualSync}
                disabled={isSyncingSheet}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white border border-teal-400/50 rounded-full shadow-sm transition-colors cursor-pointer disabled:opacity-60"
                title="กดเพื่อซิงค์ข้อมูลไป-กลับกับ Google Sheet ทันที"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheet ? 'animate-spin' : ''}`} />
                <span>{isSyncingSheet ? 'กำลังซิงค์...' : 'ซิงค์ข้อมูลกับ Google Sheet'}</span>
              </button>
            </div>
          )}

          {isAdmin && (
            <div className="inline-flex items-center gap-1.5 bg-emerald-500/25 text-emerald-100 border border-emerald-400/40 rounded-lg px-2.5 py-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
              <span className="text-xs font-semibold">โหมด Admin</span>
              {onLockAdmin && (
                <button
                  type="button"
                  onClick={onLockAdmin}
                  className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-red-600/90 hover:bg-red-500 text-white rounded-md transition-colors cursor-pointer"
                  title="ออกจากระบบ Admin (ล็อกสิทธิ์)"
                >
                  <Lock className="w-3 h-3" />
                  <span>ล็อกสิทธิ์</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
