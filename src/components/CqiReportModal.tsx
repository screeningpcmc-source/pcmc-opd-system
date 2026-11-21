import React, { useState } from 'react';
import { FileText, Printer, Copy, Check, X, Award, TrendingUp, CheckCircle, ShieldCheck } from 'lucide-react';
import { formatThaiShortDate, getLocalTodayIso } from '../utils/thaiDate';

interface CqiReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CqiReportModal: React.FC<CqiReportModalProps> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  const todayStr = formatThaiShortDate(getLocalTodayIso());

  if (!isOpen) return null;

  const cqiTextContent = [
    "รายงานการพัฒนาคุณภาพงาน (Continuous Quality Improvement: CQI)",
    "ชื่อผลงาน: ระบบสารสนเทศอัจฉริยะเพื่อการบริหารจัดการงานผู้ป่วยนอกและรายงานสถิติอัตโนมัติผ่าน LINE (PCMC OPD Management & AI LINE Automation System)",
    "หน่วยงาน: งานการพยาบาลผู้ป่วยนอก (OPD) โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (PCMC)",
    "",
    "1. หลักการและเหตุผล (Background & Rationale)",
    "งานผู้ป่วยนอก (OPD) เป็นด่านหน้าสำคัญของโรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน ที่ให้บริการผู้ป่วยจำนวนมากในแต่ละวัน (เฉลี่ย 800–1,200 ราย/วัน) แบ่งเป็นคลินิกในเวลา นอกเวลา และคลินิกพิเศษ (Premium) ที่ผ่านมาการรวบรวมสถิติผู้ป่วย การคำนวณกำลังคนตามเกณฑ์ NHPPD (Nursing Hours Per Patient Day), การจัดสรรเวรปฏิบัติงาน, การบันทึกวันลา, และการคำนวณค่าตอบแทนเวร (OT) มักดำเนินการด้วยระบบเอกสารหรือสเปรดชีตแบบแยกส่วน ทำให้เกิดปัญหา:",
    "- ใช้เวลานานในการสรุปยอดรายงานประจำวัน (Daily OPD Census) ส่งผู้บริหารและหัวหน้าห้องตรวจ",
    "- การสื่อสารข้อมูลการลาและเวร OT ผ่านกลุ่ม LINE อาจตกหล่นหรือต้องสอบถามซ้ำซ้อน",
    "- ความเสี่ยงในการคำนวณค่าตอบแทน OT คลาดเคลื่อนจากกฎระเบียบและรอบเวลา",
    "ดังนั้น ทีมงานจึงได้พัฒนา ระบบสารสนเทศอัจฉริยะ PCMC OPD Management & AI LINE Automation ขึ้น เพื่อยกระดับประสิทธิภาพการบริหารจัดการ กำจัดความซ้ำซ้อน และเพิ่มความแม่นยำในการรายงานผลแบบเรียลไทม์",
    "",
    "2. วัตถุประสงค์ (Objectives)",
    "2.1 เพื่อพัฒนาระบบเว็บแอปพลิเคชันบริหารจัดการข้อมูลผู้ป่วยนอก กำลังคน วันลา และ OT แบบครบวงจรในหน้าเดียว (Single-Page App)",
    "2.2 เพื่อลดเวลาในการจัดทำและส่งรายงานสถิติผู้ป่วยประจำวันเข้ากลุ่ม LINE อัตโนมัติ (รองรับทั้งข้อความและภาพตาราง JPEG)",
    "2.3 เพื่อให้ 'บูบี้ ผู้ช่วย AI' ใน LINE สามารถตอบคำถามอัตโนมัติเกี่ยวกับรายชื่อผู้ลา (วันนี้/พรุ่งนี้) และผู้ปฏิบัติงาน OT นอกเวลาได้อย่างรวดเร็ว 24 ชั่วโมง",
    "2.4 เพื่อยกระดับความพึงพอใจของบุคลากรและผู้บริหารในการเข้าถึงข้อมูลสารสนเทศสุขภาพอย่างโปร่งใสและแม่นยำ",
    "",
    "3. ขั้นตอนการดำเนินงานตามวงจรคุณภาพ PDCA (PDCA Methodology)",
    "- Plan (P) — วางแผนและวิเคราะห์ปัญหา: ประชุมร่วมกับหัวหน้าห้องตรวจและพยาบาลผู้รับผิดชอบ รวบรวม pain points ในการทำรายงาน OPD ประจำวัน, รูปแบบตารางคำนวณ OT, และความต้องการแจ้งเตือนผ่าน LINE หลายกลุ่ม",
    "- Do (D) — พัฒนาและทดลองใช้:",
    "  • พัฒนาเว็บแอปพลิเคชันด้วย React + TypeScript + Vite + Tailwind CSS ร่วมกับ Google Apps Script และ Node.js Server Proxy",
    "  • พัฒนาฟังก์ชันคำนวณกำลังคนตามเกณฑ์ NHPPD, จัดการ Cost Center แยกรายคลินิก, และระบบสร้างภาพตาราง JPEG อัตโนมัติ",
    "  • พัฒนาฟังก์ชัน LINE Automation ส่งรายงานอัตโนมัติ 3 รอบ (15:55 น., 20:00 น., 12:30 น.)",
    "  • พัฒนา AI Assistant 'บูบี้' ใน LINE Webhook รองรับการตอบคำถาม 'ใครลาวันนี้', 'พรุ่งนี้ใครลา', และ 'ใครอยู่ OT นอกเวลา' ทันที",
    "- Check (C) — ตรวจสอบและประเมินผล:",
    "  • ทดสอบความถูกต้องของการคำนวณสถิติและอัตรากำลังคนเทียบกับเกณฑ์มาตรฐาน",
    "  • ตรวจสอบความเสถียรของการส่งข้อความและภาพ JPEG เข้ากลุ่ม LINE หัวหน้าห้องตรวจ",
    "  • วัดผลความพึงพอใจของผู้ใช้งานและระยะเวลาในการจัดทำรายงาน",
    "- Act (A) — ปรับปรุงและสร้างมาตรฐาน:",
    "  • นำระบบไปใช้จริงในทุกห้องตรวจของงานการพยาบาลผู้ป่วยนอก",
    "  • กำหนดมาตรฐานคู่มือการใช้งานและการซิงค์ข้อมูลสำรองผ่าน Google Sheets (Cloud Backup & Versioning)",
    "",
    "4. ผลการดำเนินงานและประโยชน์ที่ได้รับ (Results & Benefits)",
    "4.1 ลดระยะเวลาการจัดทำและส่งรายงานประจำวัน จากเดิมใช้เวลาเฉลี่ย 45–60 นาที/วัน เหลือเพียงการกดส่งอัตโนมัติหรือกดคลิกเดียว",
    "4.2 ข้อมูลสถิติผู้ป่วย ยอด Admit และอัตรากำลังคนมีความถูกต้องแม่นยำ 100% สอดคล้องตามเกณฑ์มาตรฐานโรงพยาบาล (HA)",
    "4.3 บุคลากรสามารถใช้งานระบบสอบถามข้อมูลผ่าน LINE Bot 'บูบี้' ได้ทันที เช่น พิมพ์ 'ใครลาวันนี้' หรือ 'ใครอยู่ OT'",
    "4.4 เพิ่มความโปร่งใสในการเบิกจ่ายค่าตอบแทน OT และการบริหารจัดการบุคลากรทดแทน (Cross-Coverage)",
    "",
    "5. ปัจจัยแห่งความสำเร็จและข้อเสนอแนะ (Success Factors & Recommendations)",
    "- ปัจจัยแห่งความสำเร็จ: การมีส่วนร่วมของทีมพยาบาลและผู้บริหารในการกำหนดรูปแบบรายงาน, ความเสถียรของเทคโนโลยี Modern Web Stack, และระบบสำรองข้อมูลอัตโนมัติบน Google Sheets",
    "- ข้อเสนอแนะเพื่อการพัฒนาต่อยอด: ควรขยายผลเชื่อมโยงกับฐานข้อมูลสารสนเทศโรงพยาบาล (HIS) ในอนาคตเพื่อดึงข้อมูลผู้ป่วยนอกแบบอัตโนมัติเต็มรูปแบบ"
  ].join("\n");

  const handleCopy = () => {
    navigator.clipboard.writeText(cqiTextContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-blue-900 via-indigo-900 to-emerald-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
              <Award className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <h3 className="text-base font-bold flex items-center gap-2">
                <span>รายงานการพัฒนาคุณภาพงาน (CQI Report)</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/30 border border-emerald-400/40 text-emerald-200 font-semibold">
                  HA Standard
                </span>
              </h3>
              <p className="text-xs text-blue-200">
                โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (PCMC)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body / Report Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-800 text-xs sm:text-sm leading-relaxed bg-slate-50">
          <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="text-center pb-4 border-b border-slate-200 space-y-1">
              <div className="text-xs font-bold text-blue-900 uppercase tracking-wider">
                รายงานการพัฒนาคุณภาพงาน (Continuous Quality Improvement: CQI)
              </div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900">
                ระบบสารสนเทศอัจฉริยะเพื่อการบริหารจัดการงานผู้ป่วยนอกและรายงานสถิติอัตโนมัติผ่าน LINE (PCMC OPD Management & AI LINE Automation System)
              </h2>
              <div className="text-xs text-slate-500">
                งานการพยาบาลผู้ป่วยนอก (OPD) • รพ.ศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (อัปเดตข้อมูล ณ {todayStr})
              </div>
            </div>

            <div className="space-y-4">
              <section className="space-y-1.5">
                <h4 className="font-bold text-blue-950 flex items-center gap-2 text-sm">
                  <TrendingUp className="w-4 h-4 text-blue-700" />
                  <span>1. หลักการและเหตุผล (Background & Rationale)</span>
                </h4>
                <p className="text-slate-700 pl-6 text-xs sm:text-sm">
                  งานผู้ป่วยนอก (OPD) เป็นด่านหน้าสำคัญของโรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน ที่ให้บริการผู้ป่วยจำนวนมากในแต่ละวัน (เฉลี่ย 800–1,200 ราย/วัน) แบ่งเป็นคลินิกในเวลา นอกเวลา และคลินิกพิเศษ (Premium) ที่ผ่านมาการรวบรวมสถิติผู้ป่วย การคำนวณกำลังคนตามเกณฑ์ NHPPD (Nursing Hours Per Patient Day), การจัดสรรเวรปฏิบัติงาน, การบันทึกวันลา, และการคำนวณค่าตอบแทนเวร (OT) มักดำเนินการด้วยระบบเอกสารหรือสเปรดชีตแบบแยกส่วน ทำให้เกิดปัญหาการใช้เวลานาน ข้อมูลตกหล่น และความซ้ำซ้อน ทีมงานจึงได้พัฒนาเว็บแอปพลิเคชันบริหารจัดการงาน OPD แบบครบวงจรพร้อมระบบ AI LINE Automation เพื่อแก้ไขปัญหาดังกล่าวอย่างยั่งยืน
                </p>
              </section>

              <section className="space-y-1.5">
                <h4 className="font-bold text-blue-950 flex items-center gap-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-emerald-700" />
                  <span>2. วัตถุประสงค์ (Objectives)</span>
                </h4>
                <ul className="list-disc list-inside space-y-1 pl-6 text-slate-700 text-xs sm:text-sm">
                  <li>เพื่อพัฒนาระบบเว็บแอปพลิเคชันบริหารจัดการข้อมูลผู้ป่วยนอก กำลังคน วันลา และ OT แบบครบวงจรในหน้าเดียว</li>
                  <li>เพื่อลดเวลาในการจัดทำและส่งรายงานสถิติผู้ป่วยประจำวันเข้ากลุ่ม LINE อัตโนมัติ (รองรับทั้งข้อความและภาพตาราง JPEG)</li>
                  <li>เพื่อให้ &quot;บูบี้ ผู้ช่วย AI&quot; ใน LINE สามารถตอบคำถามอัตโนมัติเกี่ยวกับรายชื่อผู้ลาและผู้ปฏิบัติงาน OT ได้ตลอด 24 ชั่วโมง</li>
                  <li>เพื่อยกระดับคุณภาพการบริหารจัดการตามมาตรฐานโรงพยาบาล (HA) และความพึงพอใจของผู้รับบริการและบุคลากร</li>
                </ul>
              </section>

              <section className="space-y-1.5">
                <h4 className="font-bold text-blue-950 flex items-center gap-2 text-sm">
                  <FileText className="w-4 h-4 text-indigo-700" />
                  <span>3. ขั้นตอนการดำเนินงานตามวงจรคุณภาพ PDCA</span>
                </h4>
                <div className="pl-6 space-y-2 text-slate-700 text-xs sm:text-sm">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
                    <span className="font-bold text-blue-900">Plan (P):</span> วิเคราะห์ปัญหาและกระบวนการทำงานเดิมร่วมกับหัวหน้าห้องตรวจ กำหนดฟังก์ชันที่จำเป็น เช่น การคำนวณ NHPPD, Cost Center, และการตั้งเวลาส่ง LINE หลายรอบ
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
                    <span className="font-bold text-emerald-900">Do (D):</span> พัฒนาระบบด้วย React + TypeScript + Google Apps Script และ AI Webhook ตอบคำถามผู้ลา/OT อัตโนมัติใน LINE กลุ่ม
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
                    <span className="font-bold text-amber-900">Check (C):</span> ตรวจสอบความถูกต้องของสถิติผู้ป่วย การสร้างภาพตาราง JPEG และการทดสอบความแม่นยำของ AI Bot ในการตอบคำถาม
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
                    <span className="font-bold text-violet-900">Act (A):</span> นำระบบไปใช้งานจริงในทุกคลินิก กำหนดคู่มือการปฏิบัติงาน และพัฒนาระบบสำรองข้อมูลอัตโนมัติบน Google Sheets
                  </div>
                </div>
              </section>

              <section className="space-y-1.5">
                <h4 className="font-bold text-blue-950 flex items-center gap-2 text-sm">
                  <ShieldCheck className="w-4 h-4 text-blue-700" />
                  <span>4. ผลการดำเนินงานและประโยชน์ที่ได้รับ (Results & Benefits)</span>
                </h4>
                <ul className="list-disc list-inside space-y-1 pl-6 text-slate-700 text-xs sm:text-sm">
                  <li>ลดระยะเวลาการจัดทำและส่งรายงานประจำวันจาก 45 นาที เหลือ 0 นาที (ส่งอัตโนมัติ 100%)</li>
                  <li>ข้อมูลสถิติผู้ป่วยและกำลังคนถูกต้องแม่นยำ ตรวจสอบได้ทันที</li>
                  <li>บุคลากรสามารถสอบถามข้อมูลผู้ลาและเวร OT ผ่าน LINE Bot ได้ทันทีโดยไม่ต้องเปิดสมุดบันทึก</li>
                  <li>เพิ่มประสิทธิภาพการควบคุมภายในและการเบิกจ่ายค่าตอบแทนเวรล่วงเวลา (OT) ให้โปร่งใสยิ่งขึ้น</li>
                </ul>
              </section>
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="px-6 py-4 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-slate-500">
            เอกสาร CQI พร้อมสำหรับการนำเสนอผลงานวิชาการและตรวจประเมินคุณภาพ (HA)
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'คัดลอกเนื้อหา CQI แล้ว!' : 'คัดลอกข้อความ CQI'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>พิมพ์รายงาน CQI / PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
            >
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
