import React, { useState } from 'react';
import { 
  X, 
  Code2, 
  FileCode, 
  Copy, 
  Check, 
  Download, 
  ExternalLink, 
  Sparkles, 
  CheckCircle2,
  Layers,
  HelpCircle
} from 'lucide-react';
import { CODE_GS_CONTENT, INDEX_HTML_CONTENT } from '../services/gasExportService';

interface GasExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GasExportModal: React.FC<GasExportModalProps> = ({ isOpen, onClose }) => {
  const [activeFile, setActiveFile] = useState<'codegs' | 'indexhtml'>('codegs');
  const [copiedCodeGs, setCopiedCodeGs] = useState<boolean>(false);
  const [copiedIndexHtml, setCopiedIndexHtml] = useState<boolean>(false);

  if (!isOpen) return null;

  const currentContent = activeFile === 'codegs' ? CODE_GS_CONTENT : INDEX_HTML_CONTENT;

  const handleCopy = (fileType: 'codegs' | 'indexhtml') => {
    const text = fileType === 'codegs' ? CODE_GS_CONTENT : INDEX_HTML_CONTENT;
    navigator.clipboard.writeText(text).then(() => {
      if (fileType === 'codegs') {
        setCopiedCodeGs(true);
        setTimeout(() => setCopiedCodeGs(false), 2500);
      } else {
        setCopiedIndexHtml(true);
        setTimeout(() => setCopiedIndexHtml(false), 2500);
      }
    });
  };

  const handleDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-5xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-emerald-800 to-teal-800 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center text-amber-300">
              <Code2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg">
                Google Apps Script Source Code (Code.gs & Index.html)
              </h3>
              <p className="text-xs text-emerald-200">
                โค้ดเบ็ดเสร็จในหน้าเดียวสำหรับนำไปติดตั้งใน Google Sheets และ Google Apps Script
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-emerald-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Instructions Bar */}
        <div className="bg-amber-50 px-6 py-3 border-b border-amber-200/80 flex flex-wrap items-center justify-between gap-3 text-xs text-amber-950 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>วิธีติดตั้ง:</strong> 1) เปิด Google Sheets &gt; ส่วนขยาย (Extensions) &gt; Apps Script 
              2) วาง <strong>Code.gs</strong> 3) เพิ่มไฟล์ HTML ตั้งชื่อ <strong>Index.html</strong> 
              4) เรียกฟังก์ชัน <code className="bg-white px-1.5 py-0.5 rounded border border-amber-300 font-mono">setupDatabase()</code> ครั้งแรก
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleDownload('Code.gs', CODE_GS_CONTENT)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-white border border-amber-300 rounded hover:bg-amber-100 transition-colors cursor-pointer"
            >
              <Download className="w-3 h-3" />
              <span>ดาวน์โหลด Code.gs</span>
            </button>
            <button
              onClick={() => handleDownload('Index.html', INDEX_HTML_CONTENT)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-white border border-amber-300 rounded hover:bg-amber-100 transition-colors cursor-pointer"
            >
              <Download className="w-3 h-3" />
              <span>ดาวน์โหลด Index.html</span>
            </button>
          </div>
        </div>

        {/* File Tabs & Actions */}
        <div className="px-6 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveFile('codegs')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeFile === 'codegs'
                  ? 'bg-emerald-700 text-white shadow-2xs'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Code.gs (Backend & setupDatabase)</span>
            </button>
            <button
              onClick={() => setActiveFile('indexhtml')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeFile === 'indexhtml'
                  ? 'bg-emerald-700 text-white shadow-2xs'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Index.html (Bootstrap 5 + Chart.js)</span>
            </button>
          </div>

          <button
            onClick={() => handleCopy(activeFile)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gray-900 text-white hover:bg-gray-800 rounded-lg shadow-2xs transition-colors cursor-pointer"
          >
            {(activeFile === 'codegs' ? copiedCodeGs : copiedIndexHtml) ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>คัดลอกสำเร็จแล้ว!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>คัดลอกโค้ด {activeFile === 'codegs' ? 'Code.gs' : 'Index.html'}</span>
              </>
            )}
          </button>
        </div>

        {/* Code Content Viewer */}
        <div className="flex-1 overflow-auto bg-slate-950 p-4 font-mono text-xs text-slate-100 leading-relaxed select-all">
          <pre className="whitespace-pre-wrap">{currentContent}</pre>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 bg-gray-100 border-t border-gray-200 flex items-center justify-between text-xs text-gray-600 shrink-0">
          <span>
            ไฟล์ต้นแบบพร้อมฟังก์ชัน <code className="text-emerald-700 font-bold">setupDatabase()</code> สำหรับสร้าง 5 ชีทครบถ้วน
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-semibold bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-800 cursor-pointer"
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
};
