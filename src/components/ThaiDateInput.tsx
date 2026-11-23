import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { THAI_MONTHS, THAI_SHORT_MONTHS } from '../utils/thaiDate';

interface ThaiDateInputProps {
  value: string; // YYYY-MM-DD (Gregorian ISO internally) or ''
  onChange: (isoDate: string) => void;
  allowClear?: boolean;
  disabled?: boolean;
  minBeYear?: number;
  maxBeYear?: number;
  className?: string;
  selectClassName?: string;
  required?: boolean;
  placeholder?: string;
}

function daysInGregorianMonth(ceYear: number, month1To12: number): number {
  return new Date(ceYear, month1To12, 0).getDate();
}

function parseIsoParts(iso: string): { ceYear: number; month: number; day: number } | null {
  const m = (iso || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const ceYear = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!ceYear || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { ceYear, month, day };
}

function toIsoString(ceYear: number, month: number, day: number): string {
  const maxD = daysInGregorianMonth(ceYear, month);
  const clampedDay = Math.min(Math.max(1, day), maxD);
  return `${String(ceYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

function formatIsoToBeSlash(iso: string): string {
  const p = parseIsoParts(iso);
  if (!p) return '';
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.ceYear + 543}`;
}

function parseBeSlashToIso(raw: string, minBeYear: number, maxBeYear: number): string | null {
  const trimmed = raw.trim();
  const isoDirect = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoDirect) {
    const rawY = Number(isoDirect[1]);
    const month = Number(isoDirect[2]);
    const day = Number(isoDirect[3]);
    if (month < 1 || month > 12 || day < 1) return null;
    const ceYear = rawY >= 2400 ? rawY - 543 : rawY;
    const beYear = ceYear + 543;
    if (beYear < minBeYear || beYear > maxBeYear) return null;
    if (day > daysInGregorianMonth(ceYear, month)) return null;
    return toIsoString(ceYear, month, day);
  }

  const cleaned = trimmed.replace(/[-.\s]+/g, '/');
  const m = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const rawYear = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;

  let beYear: number;
  if (rawYear < 100) {
    if (rawYear >= 55) {
      beYear = 2500 + rawYear;
    } else if (rawYear >= 20 && rawYear <= 49) {
      beYear = 2000 + rawYear + 543;
    } else {
      beYear = 2500 + rawYear;
    }
  } else {
    beYear = rawYear >= 2400 ? rawYear : rawYear + 543;
  }
  if (beYear < minBeYear || beYear > maxBeYear) return null;
  const ceYear = beYear - 543;
  const maxD = daysInGregorianMonth(ceYear, month);
  if (day > maxD) return null;
  return toIsoString(ceYear, month, day);
}

const WEEKDAY_LABELS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;

export const ThaiDateInput: React.FC<ThaiDateInputProps> = ({
  value,
  onChange,
  allowClear = false,
  disabled = false,
  minBeYear = 2515,
  maxBeYear = 2580,
  className = '',
  selectClassName = '',
  required = false,
  placeholder = 'วว/ดด/ปปปป (พ.ศ.)',
}) => {
  const today = useMemo(() => new Date(), []);
  const todayIso = useMemo(
    () => toIsoString(today.getFullYear(), today.getMonth() + 1, today.getDate()),
    [today]
  );

  const parsed = useMemo(() => parseIsoParts(value), [value]);
  const [textVal, setTextVal] = useState<string>(() => formatIsoToBeSlash(value));
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [viewCeYear, setViewCeYear] = useState<number>(() =>
    parsed ? parsed.ceYear : today.getFullYear()
  );
  const [viewMonth, setViewMonth] = useState<number>(() =>
    parsed ? parsed.month : today.getMonth() + 1
  );
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const isFocusedRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isFocusedRef.current || parseBeSlashToIso(textVal, minBeYear, maxBeYear) !== value) {
      setTextVal(formatIsoToBeSlash(value));
    }
    if (parsed) {
      setViewCeYear(parsed.ceYear);
      setViewMonth(parsed.month);
    }
  }, [value, parsed]);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popWidth = 288;
    const popHeight = 328;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow >= popHeight || rect.top < popHeight
        ? Math.min(rect.bottom + 6, window.innerHeight - popHeight - 8)
        : Math.max(8, rect.top - popHeight - 6);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popWidth - 8));
    setPopoverPos({ top, left });
  };

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    const handleReposition = () => updatePosition();

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen]);

  const openCalendar = () => {
    if (disabled) return;
    if (parsed) {
      setViewCeYear(parsed.ceYear);
      setViewMonth(parsed.month);
    } else {
      setViewCeYear(today.getFullYear());
      setViewMonth(today.getMonth() + 1);
    }
    updatePosition();
    setIsOpen(true);
  };

  const commitTypedText = () => {
    const trimmed = textVal.trim();
    if (!trimmed) {
      if (allowClear) {
        onChange('');
      } else {
        setTextVal(formatIsoToBeSlash(value));
      }
      return;
    }
    const iso = parseBeSlashToIso(trimmed, minBeYear, maxBeYear);
    if (iso) {
      onChange(iso);
    } else {
      setTextVal(formatIsoToBeSlash(value));
    }
  };

  const shiftMonth = (delta: number) => {
    let nextM = viewMonth + delta;
    let nextY = viewCeYear;
    if (nextM < 1) {
      nextM = 12;
      nextY -= 1;
    } else if (nextM > 12) {
      nextM = 1;
      nextY += 1;
    }
    const nextBe = nextY + 543;
    if (nextBe < minBeYear || nextBe > maxBeYear) return;
    setViewCeYear(nextY);
    setViewMonth(nextM);
  };

  const beYears = useMemo(() => {
    const arr: number[] = [];
    for (let y = maxBeYear; y >= minBeYear; y--) arr.push(y);
    return arr;
  }, [minBeYear, maxBeYear]);

  const calendarCells = useMemo(() => {
    const firstWeekday = new Date(viewCeYear, viewMonth - 1, 1).getDay();
    const totalDays = daysInGregorianMonth(viewCeYear, viewMonth);
    const prevMonth = viewMonth === 1 ? 12 : viewMonth - 1;
    const prevYear = viewMonth === 1 ? viewCeYear - 1 : viewCeYear;
    const prevMonthDays = daysInGregorianMonth(prevYear, prevMonth);

    const cells: Array<{
      iso: string;
      day: number;
      inCurrentMonth: boolean;
      weekday: number;
    }> = [];

    for (let i = firstWeekday - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const iso = toIsoString(prevYear, prevMonth, d);
      cells.push({
        iso,
        day: d,
        inCurrentMonth: false,
        weekday: (firstWeekday - 1 - i) % 7,
      });
    }

    for (let d = 1; d <= totalDays; d++) {
      const iso = toIsoString(viewCeYear, viewMonth, d);
      const weekday = (firstWeekday + d - 1) % 7;
      cells.push({ iso, day: d, inCurrentMonth: true, weekday });
    }

    const nextMonth = viewMonth === 12 ? 1 : viewMonth + 1;
    const nextYear = viewMonth === 12 ? viewCeYear + 1 : viewCeYear;
    let nextDay = 1;
    while (cells.length < 42) {
      const iso = toIsoString(nextYear, nextMonth, nextDay);
      const weekday = cells.length % 7;
      cells.push({ iso, day: nextDay, inCurrentMonth: false, weekday });
      nextDay += 1;
    }

    return cells;
  }, [viewCeYear, viewMonth]);

  const inputBaseClass =
    selectClassName ||
    'w-full text-xs sm:text-sm rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-9 text-gray-900 font-medium shadow-2xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none disabled:bg-gray-100 disabled:text-gray-400';

  return (
    <div ref={triggerRef} className={`relative w-full ${className}`}>
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        required={required && !allowClear}
        value={textVal}
        placeholder={placeholder}
        onChange={(e) => {
          const nextVal = e.target.value;
          setTextVal(nextVal);
          if (!nextVal.trim()) {
            if (allowClear && value !== '') onChange('');
            return;
          }
          const nextIso = parseBeSlashToIso(nextVal, minBeYear, maxBeYear);
          if (nextIso && nextIso !== value) {
            onChange(nextIso);
          }
        }}
        onFocus={() => {
          isFocusedRef.current = true;
          if (!isOpen) openCalendar();
        }}
        onBlur={() => {
          isFocusedRef.current = false;
          commitTypedText();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitTypedText();
            setIsOpen(false);
          }
        }}
        className={`${inputBaseClass} ${allowClear && value ? 'pr-14' : 'pr-9'}`}
      />

      {allowClear && value && !disabled && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('');
            setIsOpen(false);
          }}
          className="absolute right-8 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-red-600 rounded transition-colors cursor-pointer"
          title="ล้างวันที่"
          aria-label="ล้างวันที่"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      <button
        type="button"
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (isOpen ? setIsOpen(false) : openCalendar())}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-600 hover:text-emerald-700 disabled:text-gray-300 rounded transition-colors cursor-pointer"
        title="เลือกวันที่จากปฏิทิน พ.ศ."
        aria-label="เปิดปฏิทิน พ.ศ."
      >
        <Calendar className="w-4 h-4" />
      </button>

      {isOpen &&
        !disabled &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ top: popoverPos.top, left: popoverPos.left }}
            className="fixed z-[9999] w-72 bg-white rounded-xl shadow-2xl border border-gray-200 p-3 text-xs select-none"
          >
            {/* Calendar Header: Prev / Month & พ.ศ. Year / Next */}
            <div className="flex items-center justify-between gap-1.5 mb-2.5">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 cursor-pointer shrink-0"
                title="เดือนก่อนหน้า"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-1 flex-1 min-w-0">
                <select
                  aria-label="เดือน"
                  value={viewMonth}
                  onChange={(e) => setViewMonth(Number(e.target.value))}
                  className="flex-1 min-w-0 text-xs font-bold text-gray-800 bg-slate-50 border border-gray-200 rounded-lg py-1 px-1.5 outline-none focus:border-emerald-500 cursor-pointer"
                >
                  {THAI_MONTHS.map((mName, idx) => (
                    <option key={mName} value={idx + 1}>
                      {mName}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="ปี พ.ศ."
                  value={viewCeYear + 543}
                  onChange={(e) => setViewCeYear(Number(e.target.value) - 543)}
                  className="w-[82px] text-xs font-bold text-emerald-900 bg-emerald-50/70 border border-emerald-200 rounded-lg py-1 px-1.5 outline-none focus:border-emerald-500 cursor-pointer"
                >
                  {beYears.map((be) => (
                    <option key={be} value={be}>
                      พ.ศ. {be}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => shiftMonth(1)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 cursor-pointer shrink-0"
                title="เดือนถัดไป"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Weekday Header */}
            <div className="grid grid-cols-7 text-center text-[11px] font-bold mb-1">
              {WEEKDAY_LABELS.map((w, idx) => (
                <div
                  key={w}
                  className={`py-1 ${
                    idx === 0
                      ? 'text-red-500'
                      : idx === 6
                      ? 'text-indigo-500'
                      : 'text-gray-500'
                  }`}
                >
                  {w}
                </div>
              ))}
            </div>

            {/* Day Grid */}
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {calendarCells.map((cell) => {
                const isSelected = value === cell.iso;
                const isToday = todayIso === cell.iso;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    onClick={() => {
                      onChange(cell.iso);
                      setIsOpen(false);
                    }}
                    className={`h-8 rounded-lg text-xs transition-colors cursor-pointer flex items-center justify-center ${
                      isSelected
                        ? 'bg-emerald-600 text-white font-bold shadow-xs'
                        : isToday
                        ? 'bg-emerald-50 text-emerald-800 font-bold ring-1 ring-emerald-500'
                        : !cell.inCurrentMonth
                        ? 'text-gray-300 hover:bg-gray-50'
                        : cell.weekday === 0
                        ? 'text-red-600 hover:bg-red-50 font-medium'
                        : cell.weekday === 6
                        ? 'text-indigo-600 hover:bg-indigo-50 font-medium'
                        : 'text-gray-800 hover:bg-emerald-50 font-medium'
                    }`}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
              {allowClear ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange('');
                    setIsOpen(false);
                  }}
                  className="text-[11px] font-semibold text-gray-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 cursor-pointer"
                >
                  ล้างวันที่
                </button>
              ) : (
                <span className="text-[10px] text-gray-400">ปฏิทินปี พ.ศ.</span>
              )}
              <button
                type="button"
                onClick={() => {
                  onChange(todayIso);
                  setIsOpen(false);
                }}
                className="text-[11px] font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-1 rounded-md cursor-pointer"
              >
                วันนี้ ({formatIsoToBeSlash(todayIso)})
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

interface ThaiMonthInputProps {
  value: string; // YYYY-MM
  onChange: (yyyyMm: string) => void;
  minBeYear?: number;
  maxBeYear?: number;
  className?: string;
}

export const ThaiMonthInput: React.FC<ThaiMonthInputProps> = ({
  value,
  onChange,
  minBeYear = 2565,
  maxBeYear = 2575,
  className = '',
}) => {
  const now = useMemo(() => new Date(), []);
  const m = (value || '').trim().match(/^(\d{4})-(\d{1,2})/);
  const ceYear = m ? Number(m[1]) : now.getFullYear();
  const month = m ? Number(m[2]) : now.getMonth() + 1;
  const beYear = ceYear + 543;

  const [isOpen, setIsOpen] = useState(false);
  const [viewBeYear, setViewBeYear] = useState(beYear);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setViewBeYear(beYear);
  }, [beYear]);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const popWidth = 264;
    const popHeight = 236;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow >= popHeight || rect.top < popHeight
        ? Math.min(rect.bottom + 6, window.innerHeight - popHeight - 8)
        : Math.max(8, rect.top - popHeight - 6);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - popWidth - 8));
    setPopoverPos({ top, left });
  };

  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    const handleReposition = () => updatePosition();

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen]);

  const beYears = useMemo(() => {
    const arr: number[] = [];
    for (let y = maxBeYear; y >= minBeYear; y--) arr.push(y);
    return arr;
  }, [minBeYear, maxBeYear]);

  const displayLabel = `${THAI_MONTHS[month - 1] || ''} พ.ศ. ${beYear}`;
  const currentMonthStr = `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div ref={triggerRef} className={`relative w-full ${className}`}>
      <button
        type="button"
        onClick={() => {
          setViewBeYear(beYear);
          updatePosition();
          setIsOpen((prev) => !prev);
        }}
        className="w-full text-left text-xs rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-9 font-semibold text-gray-800 shadow-2xs hover:border-amber-400 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none cursor-pointer flex items-center justify-between"
      >
        <span className="truncate">{displayLabel}</span>
        <Calendar className="w-4 h-4 text-gray-600 absolute right-2.5 top-1/2 -translate-y-1/2" />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ top: popoverPos.top, left: popoverPos.left }}
            className="fixed z-[9999] w-[264px] bg-white rounded-xl shadow-2xl border border-gray-200 p-3 text-xs select-none"
          >
            <div className="flex items-center justify-between gap-1 mb-2.5">
              <button
                type="button"
                onClick={() => setViewBeYear((y) => Math.max(minBeYear, y - 1))}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 cursor-pointer"
                title="ปีก่อนหน้า"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <select
                aria-label="ปี พ.ศ."
                value={viewBeYear}
                onChange={(e) => setViewBeYear(Number(e.target.value))}
                className="text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg py-1 px-2.5 outline-none cursor-pointer"
              >
                {beYears.map((be) => (
                  <option key={be} value={be}>
                    พ.ศ. {be}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setViewBeYear((y) => Math.min(maxBeYear, y + 1))}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600 cursor-pointer"
                title="ปีถัดไป"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              {THAI_SHORT_MONTHS.map((shortM, idx) => {
                const mNum = idx + 1;
                const nextIso = `${String(viewBeYear - 543).padStart(4, '0')}-${String(mNum).padStart(2, '0')}`;
                const isSelected = value === nextIso;
                const isCurrent = currentMonthStr === nextIso;
                return (
                  <button
                    key={shortM}
                    type="button"
                    onClick={() => {
                      onChange(nextIso);
                      setIsOpen(false);
                    }}
                    className={`py-2 px-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-amber-600 text-white font-bold shadow-xs'
                        : isCurrent
                        ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-400'
                        : 'text-gray-700 hover:bg-amber-50'
                    }`}
                  >
                    {shortM}
                  </button>
                );
              })}
            </div>

            <div className="mt-2.5 pt-2 border-t border-gray-100 flex items-center justify-between">
              <span className="text-[10px] text-gray-400">เดือนปี พ.ศ.</span>
              <button
                type="button"
                onClick={() => {
                  onChange(currentMonthStr);
                  setIsOpen(false);
                }}
                className="text-[11px] font-bold text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 px-2.5 py-1 rounded-md cursor-pointer"
              >
                เดือนนี้
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
