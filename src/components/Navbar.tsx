import React from 'react';
import { 
  Building2, 
  CheckCircle2,
  ShieldCheck
} from 'lucide-react';
import { User } from 'firebase/auth';

interface NavbarProps {
  user: User | null;
  isAdmin: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  isAdmin,
}) => {
  return (
    <header className="bg-gradient-to-r from-emerald-800 via-teal-800 to-cyan-900 text-white shadow-lg sticky top-0 z-50">
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

        {/* Clean Status Indicators (Auth/Sheets/GAS moved to Menu 5) */}
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-emerald-500/25 text-emerald-100 border border-emerald-400/40 rounded-lg">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
              <span>โหมด Admin</span>
            </span>
          )}
          {user && (
            <div className="flex items-center gap-2 bg-black/20 backdrop-blur px-3 py-1.5 rounded-lg border border-white/10">
              <div className="text-right">
                <div className="text-xs font-semibold text-white truncate max-w-[160px]">
                  {user.displayName || user.email?.split('@')[0]}
                </div>
                <div className="text-[10px] text-emerald-200 flex items-center gap-1 justify-end">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 inline" />
                  <span>เชื่อมต่อ Google แล้ว</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
