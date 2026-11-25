import React from 'react';
import { 
  Building2, 
  ShieldCheck,
  Lock,
  FileText
} from 'lucide-react';

interface NavbarProps {
  isAdmin: boolean;
  adminOwnerName?: string;
  activeTabLabel?: string;
  onLockAdmin?: () => void;
  onOpenCqi?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  isAdmin,
  adminOwnerName,
  activeTabLabel,
  onLockAdmin,
  onOpenCqi,
}) => {
  return (
    <>
      {/* Mobile & Tablet (Portrait + Landscape): iOS / iPadOS 27 Floating Liquid Glass Header */}
      <header className="no-print ui-mobile-tablet sticky top-2 z-50 mx-3 sm:mx-5 md:mx-6 mt-2">
        <div className="ios-glass-bar rounded-[22px] px-3 sm:px-4 h-14 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-[12px] bg-gradient-to-br from-emerald-500/90 to-teal-600/90 text-white flex items-center justify-center shadow-sm ring-1 ring-white/70 shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-sm sm:text-base tracking-tight text-slate-900 truncate leading-tight">
                <span className="md:hidden">รพ.ชลประทาน · PCMC OPD</span>
                <span className="hidden md:inline">โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน · PCMC OPD</span>
              </h1>
              <p className="hidden sm:block text-[11px] text-slate-600 truncate leading-tight">
                ระบบบริหารจัดการภาระงานผู้ป่วย เวรนอกเวลา และ Productivity
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onOpenCqi && (
              <button
                type="button"
                onClick={onOpenCqi}
                className="ios-glass-pill min-h-[40px] px-3 rounded-full inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 hover:text-emerald-800 cursor-pointer whitespace-nowrap shrink-0"
                title="ดูรายงานพัฒนาคุณภาพงาน (CQI)"
              >
                <FileText className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>CQI</span>
              </button>
            )}

            {isAdmin && (
              <div className="inline-flex items-center gap-1 bg-emerald-500/15 border border-emerald-500/30 rounded-full pl-2.5 pr-1 py-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span className="hidden sm:inline text-[11px] font-bold text-emerald-900 max-w-[110px] truncate">
                  {adminOwnerName || 'Admin'}
                </span>
                {onLockAdmin && (
                  <button
                    type="button"
                    onClick={onLockAdmin}
                    className="min-h-[32px] px-2.5 rounded-full bg-red-600/90 hover:bg-red-500 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                    title="ออกจากระบบ Admin (ล็อกสิทธิ์)"
                  >
                    <Lock className="w-3 h-3" />
                    <span>ล็อก</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* PC / MacBook Desktop: macOS 27 Golden Gate Translucent Menu Bar */}
      <header className="no-print ui-pc-desktop sticky top-0 z-50 macos-gg-menubar">
        <div className="max-w-[1440px] mx-auto px-5 h-9 flex items-center justify-between gap-4">
          {/* Left: App Identity & Active Module */}
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-5 h-5 rounded-[6px] bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-xs ring-1 ring-black/10 shrink-0">
              <Building2 className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold text-[13px] tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              PCMC OPD
            </span>
            <span className="text-slate-400 text-xs select-none" aria-hidden="true">·</span>
            <span className="text-[12px] font-medium text-slate-700 truncate">
              โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน
            </span>
            {activeTabLabel && (
              <>
                <span className="text-slate-400 text-xs select-none" aria-hidden="true">/</span>
                <span className="text-[12px] font-semibold text-slate-900 whitespace-nowrap shrink-0">
                  {activeTabLabel}
                </span>
              </>
            )}
          </div>

          {/* Right: Menu Bar Functional Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {onOpenCqi && (
              <button
                type="button"
                onClick={onOpenCqi}
                className="px-2.5 py-1 rounded-md hover:bg-slate-900/5 active:bg-slate-900/10 text-[12px] font-semibold text-slate-800 inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                title="ดูรายงานพัฒนาคุณภาพงาน (CQI)"
              >
                <FileText className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>รายงาน CQI</span>
              </button>
            )}

            {isAdmin && (
              <div className="inline-flex items-center gap-1.5 bg-emerald-500/15 border border-emerald-600/25 rounded-full pl-2.5 pr-1 py-0.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span className="text-[11.5px] font-semibold text-emerald-950 whitespace-nowrap">
                  โหมด Admin{adminOwnerName ? `: ${adminOwnerName}` : ''}
                </span>
                {onLockAdmin && (
                  <button
                    type="button"
                    onClick={onLockAdmin}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold bg-red-600/90 hover:bg-red-500 text-white rounded-full transition-colors cursor-pointer whitespace-nowrap shrink-0"
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
    </>
  );
};
