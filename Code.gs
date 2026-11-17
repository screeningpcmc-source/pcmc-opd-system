/**
 * ==============================================================================
 * ส่วนขยาย Google Sheets (Google Apps Script Connector)
 * ระบบบริหารจัดการข้อมูล OPD โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (PCMC)
 * ==============================================================================
 * วิธีติดตั้งใช้งาน (ทำครั้งเดียว):
 * 1. เปิดไฟล์ Google Sheets ฐานข้อมูล OPD -> เมนู "ส่วนขยาย (Extensions)" -> "Apps Script"
 * 2. วางโค้ดไฟล์นี้ทั้งหมดทับของเดิม แล้วกดปุ่ม "บันทึก (Ctrl+S)"
 * 3. กดปุ่ม "ทำให้ใช้งานได้ (Deploy)" -> "การทำให้ใช้งานได้รายการใหม่ (New deployment)"
 *    - ประเภท: เว็บแอป (Web app)
 *    - ดำเนินการในชื่อ (Execute as): ฉัน (Me)
 *    - ผู้ที่มีสิทธิ์เข้าถึง (Who has access): ทุกคน (Anyone)
 * 4. คัดลอก Web App URL (/exec) ไปใส่ในเมนู "🏥 ระบบ OPD รพ.ชลประทาน" บนหน้า Google Sheets
 *    หรือวางในหน้าเว็บ Admin -> ตั้งค่าลิงก์ชีท เพื่อสร้างลิงก์แชร์ให้เจ้าหน้าที่ OPD
 *    (เจ้าหน้าที่ทุกคนจะดึงรายชื่อ/ข้อมูล และนำข้อมูลเข้าชีทได้อัตโนมัติทันทีโดยไม่ต้องแสดงแถบล็อกอิน
 *     ส่วนการแก้ไขหรือลบข้อมูลยังคงสงวนสิทธิ์เฉพาะผู้ที่มีรหัส Admin PIN เท่านั้น)
 * ==============================================================================
 */

var DEFAULT_WEB_APP_CLIENT_URL = 'https://screeningpcmc-source.github.io/pcmc-opd-system/';

var SHEET_NAMES = {
  STAFF: 'Staff_Master',
  WORKLOAD: 'Daily_Workload',
  LEAVE: 'Leave_Records',
  OT: 'OT_Attendance',
  SETTINGS: 'Settings',
  AUDIT: 'Audit_Logs'
};

var DEFAULT_IN_TIME_CLINICS = [
  'กุมารเวชกรรม', 'สูติ-นรีเวชกรรม', 'ศัลยกรรมกระดูก', 'เวชศาสตร์ฟื้นฟู', 'ศัลยกรรม',
  'จักษุวิทยา', 'ศูนย์เลสิก', 'โสต ศอ นาสิก', 'อายุรกรรม', 'ตรวจโรคทั่วไป',
  'Echo', 'AAIRC', 'ODS', 'ประกันสังคม', 'หน่วยคัดกรอง'
];

var DEFAULT_OUT_TIME_CLINICS = [
  'ตรวจโรคทั่วไป', 'กุมารเวชกรรม', 'สูติ-นรีเวชกรรม', 'ศัลยกรรมกระดูก', 'ศัลยกรรม',
  'จักษุวิทยา', 'โสต ศอ นาสิก', 'อายุรกรรม', 'คลินิกหัวใจ', 'หน่วยคัดกรอง'
];

var DEFAULT_PREMIUM_SUB_CLINICS = [
  'อายุรกรรม-Premium', 'ศัลยกรรม-Premium', 'จักษุวิทยา-Premium', 'โสต ศอ นาสิก-Premium',
  'ศัลยกรรม-กระดูก-Premium', 'เวชศาสตร์ฟื้นฟู-Premium', 'กุมารเวชกรรม-Premium', 'สูติ-นรีเวชกรรม-Premium',
  'คลินิกหัวใจฯ-Premium', 'คลินิกภูมิแพ้ฯ-Premium', 'จิตเวช-Premium', 'เวชศาสตร์ครอบครัว-Premium'
];

var WORKLOAD_BASE_HEADERS = [
  'Date', 'Shift', 'Clinic', 'Total_Pt', 'Adult_Pt', 'Child_Pt',
  'Admit', 'HN', 'RN', 'PN', 'NA', 'Clerk', 'Service_Worker', 'Note', 'Reporter',
  'Clinic_Group', 'Pool_ID', 'Record_Type'
];

var DEFAULT_LEAVE_TYPES = [
  'ลาป่วย', 'ลากิจ', 'ลาพักผ่อน', 'ลาคลอด', 'ไปอบรม/ประชุม', 'ขาดเวร/อื่นๆ'
];

/**
 * เพิ่มเมนูช่วยเชื่อมต่อบนแถบเครื่องมือ Google Sheets โดยอัตโนมัติเมื่อเปิดไฟล์
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('🏥 ระบบ OPD รพ.ชลประทาน')
      .addItem('🔗 สร้างลิงก์เชื่อมต่ออัตโนมัติ (แชร์ทีม OPD)', 'showShareLinkDialog')
      .addItem('⚙️ บันทึก Web App URL (/exec) ลงในชีท', 'promptAndSaveGasUrl')
      .addSeparator()
      .addItem('📋 ตรวจสอบ/สร้างหัวตารางทั้ง 6 ชีท', 'setupOpdDatabase')
      .addToUi();
  } catch (e) {
    // Ignore when executed outside Sheets UI context
  }
}

/**
 * สร้างหรือตรวจสอบหัวตารางทั้ง 6 ชีท (ไม่มีข้อมูลเดโม่)
 */
function setupOpdDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var schemas = [
    {
      name: SHEET_NAMES.STAFF,
      headers: ['Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status', 'Start_Date', 'End_Date', 'Employee_Code'],
      color: '#1e3a8a',
      rows: []
    },
    {
      name: SHEET_NAMES.WORKLOAD,
      headers: WORKLOAD_BASE_HEADERS,
      color: '#047857',
      rows: []
    },
    {
      name: SHEET_NAMES.LEAVE,
      headers: ['Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note'],
      color: '#b45309',
      rows: []
    },
    {
      name: SHEET_NAMES.OT,
      headers: ['Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic', 'Hours', 'Employee_Code'],
      color: '#6d28d9',
      rows: []
    },
    {
      name: SHEET_NAMES.AUDIT,
      headers: ['Timestamp', 'Action', 'Target_Name', 'Summary', 'Reason', 'Edited_By'],
      color: '#991b1b',
      rows: []
    },
    {
      name: SHEET_NAMES.SETTINGS,
      headers: ['Key', 'Value'],
      color: '#374151',
      rows: [
        ['NHPPD', '0.4'],
        ['Screening_NHPPD', '0.1'],
        ['Std_Hr', '7'],
        ['Annual_Hr', '2080'],
        ['Work_Days', '245'],
        ['Admin_Emails', 'screening.pcmc@gmail.com, admin.opd@pcmc.ac.th, headnurse@pcmc.ac.th'],
        ['In_Time_Clinics', DEFAULT_IN_TIME_CLINICS.join(', ')],
        ['Out_Time_Clinics', DEFAULT_OUT_TIME_CLINICS.join(', ')],
        ['Premium_Sub_Clinics', DEFAULT_PREMIUM_SUB_CLINICS.join(', ')],
        ['Leave_Types', DEFAULT_LEAVE_TYPES.join(', ')],
        ['Custom_Holidays', '[]'],
        ['Gas_Web_App_URL', getSavedGasUrl_()]
      ]
    }
  ];

  schemas.forEach(function(schema) {
    var sheet = ss.getSheetByName(schema.name);
    if (!sheet) {
      sheet = ss.insertSheet(schema.name);
    }
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, schema.headers.length).setValues([schema.headers]);
      sheet.getRange(1, 1, 1, schema.headers.length)
        .setBackground(schema.color)
        .setFontColor('#ffffff')
        .setFontWeight('bold')
        .setHorizontalAlignment('center');
      sheet.setFrozenRows(1);
      if (schema.rows && schema.rows.length > 0) {
        sheet.getRange(2, 1, schema.rows.length, schema.headers.length).setValues(schema.rows);
      }
    }
  });

  var detectedUrl = getServiceExecUrl_();
  if (detectedUrl) {
    saveGasUrlToSettings_(detectedUrl);
  }

  try {
    SpreadsheetApp.getUi().alert('เตรียมโครงสร้างฐานข้อมูลทั้ง 6 ชีทเรียบร้อยแล้ว!');
  } catch (e) {
    // Headless execution
  }
  return { success: true, spreadsheetId: ss.getId(), gasUrl: getSavedGasUrl_() };
}

/**
 * แสดงหน้าต่างคัดลอกลิงก์แชร์สำหรับส่งให้เจ้าหน้าที่ OPD (เชื่อมต่ออัตโนมัติ)
 */
function showShareLinkDialog() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var gasUrl = getSavedGasUrl_();

  if (!gasUrl) {
    var res = ui.prompt(
      'ตั้งค่า Web App URL (/exec)',
      'กรุณาวางลิงก์ Web App URL ที่ได้จากการกด Deploy (ลงท้ายด้วย /exec) เพื่อให้เจ้าหน้าที่ OPD นำข้อมูลเข้าชีทได้อัตโนมัติโดยไม่ต้องล็อกอิน:',
      ui.ButtonSet.OK_CANCEL
    );
    if (res.getSelectedButton() !== ui.Button.OK) return;
    gasUrl = String(res.getResponseText() || '').trim();
    if (gasUrl) {
      saveGasUrlToSettings_(gasUrl);
    }
  }

  var clientBase = PropertiesService.getScriptProperties().getProperty('WEB_APP_CLIENT_URL') || DEFAULT_WEB_APP_CLIENT_URL;
  var shareUrl = clientBase + '?sheetId=' + encodeURIComponent(ss.getId());
  if (gasUrl) {
    shareUrl += '&gasUrl=' + encodeURIComponent(gasUrl);
  }

  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;padding:12px;line-height:1.5;">' +
    '<h3 style="margin:0 0 8px;color:#065f46;">ลิงก์สำหรับแชร์ให้เจ้าหน้าที่ OPD</h3>' +
    '<p style="font-size:12px;color:#334155;margin:0 0 10px;">ส่งลิงก์ด้านล่างให้เจ้าหน้าที่เปิดใช้งานได้ทันที — ระบบจะดึงข้อมูลและส่งเฉพาะรายการที่บันทึกใหม่เข้าชีทนี้อัตโนมัติ (การแก้ไข/ลบต้องใส่รหัส Admin PIN)</p>' +
    '<textarea id="linkBox" readonly style="width:100%;height:76px;padding:8px;font-size:12px;border:1px solid #cbd5e1;border-radius:8px;box-sizing:border-box;">' +
    escapeHtml_(shareUrl) +
    '</textarea>' +
    '<div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end;">' +
    '<button onclick="navigator.clipboard.writeText(document.getElementById(\'linkBox\').value);this.innerText=\'คัดลอกแล้ว ✓\';" ' +
    'style="background:#059669;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-weight:bold;cursor:pointer;">คัดลอกลิงก์</button>' +
    '<button onclick="google.script.host.close();" style="background:#e2e8f0;color:#1e293b;border:none;padding:8px 12px;border-radius:8px;cursor:pointer;">ปิด</button>' +
    '</div></div>'
  ).setWidth(520).setHeight(240);

  ui.showModalDialog(html, 'แชร์ลิงก์ระบบ OPD (เชื่อมต่อ Google Sheets อัตโนมัติ)');
}

/**
 * บันทึก Web App URL (/exec) ด้วยตนเองผ่านเมนู Google Sheets
 */
function promptAndSaveGasUrl() {
  var ui = SpreadsheetApp.getUi();
  var current = getSavedGasUrl_();
  var res = ui.prompt(
    'บันทึก Web App URL (/exec)',
    'วางลิงก์ Web App URL จาก Deploy > Manage deployments (ลงท้ายด้วย /exec):' +
    (current ? '\n(ค่าปัจจุบัน: ' + current + ')' : ''),
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var url = String(res.getResponseText() || '').trim();
  if (!url) return;
  saveGasUrlToSettings_(url);
  ui.alert('บันทึก Web App URL ลงในชีท Settings และ Script Properties เรียบร้อยแล้ว!');
}

/**
 * ==============================================================================
 * Web App HTTP Endpoints (เชื่อมต่อโดยตรงจากหน้าเว็บ OPD)
 * ==============================================================================
 */

/**
 * GET ?action=readAll -> ส่งข้อมูลทั้งหมดให้หน้าเว็บอัตโนมัติ (ไม่ส่งรหัส Admin_Pin)
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'readAll') {
    return jsonResponse_(buildPublicReadAllPayload_());
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return jsonResponse_({
    success: true,
    service: 'PCMC OPD Google Sheets Connector',
    spreadsheetId: ss.getId(),
    gasUrl: getSavedGasUrl_()
  });
}

/**
 * POST -> รับการ "นำข้อมูลเข้า" (Append Only) สำหรับเจ้าหน้าที่ OPD โดยไม่ต้อง Sign in
 * และรองรับการซิงค์ฐานข้อมูลผู้ดูแลระบบ (Staff / Settings / แก้ไข / ลบ / Audit) เมื่อยืนยันรหัส Admin PIN
 */
function doPost(e) {
  var lock = null;
  try {
    var bodyText = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var req = JSON.parse(bodyText);
    var action = String(req.action || '').trim();
    var payload = req.payload;
    var adminPin = String(req.adminPin || (payload && payload.adminPin) || '').trim();

    lock = LockService.getScriptLock();
    lock.waitLock(15000);

    if (action === 'appendWorkload') {
      var workloadInput = (req.records !== undefined) ? req.records : payload;
      return jsonResponse_(appendWorkloadFromApi_(workloadInput));
    }
    if (action === 'appendLeave') {
      return jsonResponse_(appendLeaveFromApi_(payload));
    }
    if (action === 'appendOT') {
      return jsonResponse_(appendOTFromApi_(payload));
    }

    var adminActions = [
      'syncAdminAll', 'syncStaff', 'syncSettings', 'appendAudit',
      'updateWorkload', 'deleteWorkload',
      'updateLeave', 'deleteLeave',
      'updateOT', 'deleteOT'
    ];
    if (adminActions.indexOf(action) !== -1) {
      if (!verifyAdminPinInGas_(adminPin)) {
        return jsonResponse_({
          success: false,
          error: 'รหัส Admin PIN ไม่ถูกต้อง หรือไม่มีสิทธิ์แก้ไขข้อมูลผู้ดูแลระบบ'
        });
      }
      if (action === 'syncAdminAll') {
        return jsonResponse_(syncAdminAllFromApi_(payload || {}));
      }
      if (action === 'updateWorkload') {
        return jsonResponse_(updateWorkloadRowFromApi_(payload || {}));
      }
      if (action === 'deleteWorkload') {
        return jsonResponse_(deleteWorkloadRowFromApi_(payload || {}));
      }
      if (action === 'updateLeave') {
        return jsonResponse_(updateLeaveRowFromApi_(payload || {}));
      }
      if (action === 'deleteLeave') {
        return jsonResponse_(deleteLeaveRowFromApi_(payload || {}));
      }
      if (action === 'updateOT') {
        return jsonResponse_(updateOtRowFromApi_(payload || {}));
      }
      if (action === 'deleteOT') {
        return jsonResponse_(deleteOtRowFromApi_(payload || {}));
      }
      if (action === 'syncStaff') {
        writeStaffRowsToSheet_(Array.isArray(payload) ? payload : (payload && payload.staff) || []);
        return jsonResponse_(buildPublicReadAllPayload_());
      }
      if (action === 'syncSettings') {
        writeSettingsToSheet_((payload && payload.settings) || payload || {});
        return jsonResponse_(buildPublicReadAllPayload_());
      }
      if (action === 'appendAudit') {
        appendAuditRowsToSheet_(Array.isArray(payload) ? payload : [payload]);
        return jsonResponse_({ success: true });
      }
    }

    return jsonResponse_({
      success: false,
      error: 'การแก้ไขหรือลบข้อมูลสงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น'
    });
  } catch (err) {
    return jsonResponse_({ success: false, error: err.toString() });
  } finally {
    try {
      if (lock) lock.releaseLock();
    } catch (lockErr) {
      // ignore lock release error
    }
  }
}

/**
 * ==============================================================================
 * Internal Helpers
 * ==============================================================================
 */

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function escapeHtml_(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getServiceExecUrl_() {
  try {
    var url = String(ScriptApp.getService().getUrl() || '').trim();
    if (url && /\/exec$/.test(url)) return url;
  } catch (e) {
    // ignore
  }
  return '';
}

function getSavedGasUrl_() {
  var propUrl = String(PropertiesService.getScriptProperties().getProperty('GAS_WEB_APP_URL') || '').trim();
  if (propUrl) return propUrl;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (sheet && sheet.getLastRow() > 1) {
    var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0] || '').trim() === 'Gas_Web_App_URL') {
        var val = String(vals[i][1] || '').trim();
        if (val) return val;
      }
    }
  }
  return getServiceExecUrl_();
}

function saveGasUrlToSettings_(gasUrl) {
  var cleanUrl = String(gasUrl || '').trim();
  if (!cleanUrl) return;
  PropertiesService.getScriptProperties().setProperty('GAS_WEB_APP_URL', cleanUrl);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.SETTINGS, ['Key', 'Value']);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0] || '').trim() === 'Gas_Web_App_URL') {
        sheet.getRange(i + 2, 2).setValue(cleanUrl);
        return;
      }
    }
  }
  sheet.appendRow(['Gas_Web_App_URL', cleanUrl]);
}

function formatCellValue_(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Bangkok', 'yyyy-MM-dd');
  }
  return val === null || val === undefined ? '' : String(val);
}

function getSheetRowsNormalized_(sheetName, minCols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return { headers: [], rows: [] };
  var lastCol = Math.max(minCols, sheet.getLastColumn());
  var allValues = sheet.getRange(1, 1, sheet.getLastRow(), lastCol).getValues();
  var headers = allValues[0].map(function(h) { return String(h || '').trim(); });
  var rows = allValues.slice(1).map(function(r) {
    return r.map(formatCellValue_);
  });
  return { headers: headers, rows: rows };
}

function ensureWorkloadColumns_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) return;
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, Math.max(lastCol, 1)).getValues()[0].map(function(h) {
    return String(h || '').trim();
  });
  var firstHeader = headers[0] || '';
  var expectedTail = ['Clinic_Group', 'Pool_ID', 'Record_Type'];
  var baseColCount = (firstHeader === 'Record_ID') ? 16 : 15;
  var needsUpdate = false;
  for (var i = 0; i < expectedTail.length; i++) {
    if (headers[baseColCount + i] !== expectedTail[i]) {
      needsUpdate = true;
      break;
    }
  }
  if (needsUpdate) {
    sheet.getRange(1, baseColCount + 1, 1, expectedTail.length).setValues([expectedTail]);
  }
}

function ensureStaffColumns_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) return;
  var col8 = String(sheet.getRange(1, 8).getValue() || '').trim();
  if (col8 !== 'Employee_Code') {
    sheet.getRange(1, 8).setValue('Employee_Code');
  }
}

function ensureOtColumns_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) return;
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var baseCol = (firstHeader === 'OT_ID') ? 7 : 6;
  var hHours = String(sheet.getRange(1, baseCol + 1).getValue() || '').trim();
  var hCode = String(sheet.getRange(1, baseCol + 2).getValue() || '').trim();
  if (hHours !== 'Hours' || hCode !== 'Employee_Code') {
    sheet.getRange(1, baseCol + 1, 1, 2).setValues([['Hours', 'Employee_Code']]);
  }
}

function buildPublicReadAllPayload_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var staffData = getSheetRowsNormalized_(SHEET_NAMES.STAFF, 8);
    var workloadData = getSheetRowsNormalized_(SHEET_NAMES.WORKLOAD, 19);
    var leaveData = getSheetRowsNormalized_(SHEET_NAMES.LEAVE, 8);
    var otData = getSheetRowsNormalized_(SHEET_NAMES.OT, 9);
    var settingsData = getSheetRowsNormalized_(SHEET_NAMES.SETTINGS, 2);
    var auditData = getSheetRowsNormalized_(SHEET_NAMES.AUDIT, 6);

    var workloadHasId = workloadData.headers[0] === 'Record_ID';
    var leaveHasId = leaveData.headers[0] === 'Leave_ID';
    var otHasId = otData.headers[0] === 'OT_ID';

    var activeGasUrl = getSavedGasUrl_();
    var settingsRows = settingsData.rows
      .filter(function(r) { return r[0] && r[0] !== 'Admin_Pin'; })
      .map(function(r) { return r.slice(0, 2); });

    if (activeGasUrl) {
      var hasGasRow = settingsRows.some(function(r) { return r[0] === 'Gas_Web_App_URL' && r[1]; });
      if (!hasGasRow) {
        settingsRows.push(['Gas_Web_App_URL', activeGasUrl]);
      }
    }

    var nonEmptyStaff = staffData.rows.filter(function(r) { return String(r[1] || '').trim() !== ''; });
    var nonEmptyWorkloads = workloadData.rows.filter(function(r) {
      var dateCol = workloadHasId ? r[1] : r[0];
      var clinicCol = workloadHasId ? r[3] : r[2];
      return String(dateCol || '').trim() !== '' && String(clinicCol || '').trim() !== '';
    });
    var nonEmptyLeaves = leaveData.rows.filter(function(r) {
      var startCol = leaveHasId ? r[1] : r[0];
      var nameCol = leaveHasId ? r[3] : r[2];
      return String(startCol || '').trim() !== '' && String(nameCol || '').trim() !== '';
    });
    var nonEmptyOt = otData.rows.filter(function(r) {
      var dateCol = otHasId ? r[1] : r[0];
      var nameCol = otHasId ? r[3] : r[2];
      return String(dateCol || '').trim() !== '' && String(nameCol || '').trim() !== '';
    });
    var nonEmptyAudit = auditData.rows.filter(function(r) {
      return String(r[0] || '').trim() !== '' && String(r[1] || '').trim() !== '';
    });

    return {
      success: true,
      spreadsheetId: ss.getId(),
      gasUrl: activeGasUrl,
      staffRows: nonEmptyStaff.map(function(r) { return r.slice(0, 8); }),
      workloadRows: nonEmptyWorkloads.map(function(r) {
        return workloadHasId ? r.slice(1, 19) : r.slice(0, 18);
      }),
      leaveRows: nonEmptyLeaves.map(function(r) {
        return leaveHasId ? r.slice(1, 9) : r.slice(0, 8);
      }),
      otRows: nonEmptyOt.map(function(r) {
        return otHasId ? r.slice(1, 9) : r.slice(0, 8);
      }),
      settingsRows: settingsRows,
      auditRows: nonEmptyAudit.map(function(r) { return r.slice(0, 6); })
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function ensureSheetWithHeaders_(sheetName, defaultHeaders) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendWorkloadFromApi_(payload) {
  var list = Array.isArray(payload) ? payload : [payload];
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.WORKLOAD, WORKLOAD_BASE_HEADERS);
  ensureWorkloadColumns_(sheet);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var rowsToAppend = [];

  list.forEach(function(entry) {
    if (!entry || !entry.date || !entry.clinic) return;
    var adultPt = Number(entry.adultPt || 0);
    var childPt = Number(entry.childPt || 0);
    var totalPt = Math.max(Number(entry.totalPt || 0), adultPt + childPt);
    var baseRow = [
      String(entry.date || ''),
      String(entry.shift || ''),
      String(entry.clinic || ''),
      totalPt,
      adultPt,
      childPt,
      Number(entry.admit || 0),
      Number(entry.hn || 0),
      Number(entry.rn || 0),
      Number(entry.pn || 0),
      Number(entry.na !== undefined ? entry.na : (entry.pca || 0)),
      Number(entry.clerk || 0),
      Number(entry.serviceWorker || 0),
      String(entry.note || ''),
      String(entry.reporter || ''),
      String(entry.clinicGroup || ''),
      String(entry.poolId || ''),
      String(entry.recordType || 'STANDARD')
    ];
    if (firstHeader === 'Record_ID') {
      var recId = entry.id || ('REC-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000));
      rowsToAppend.push([recId].concat(baseRow));
    } else {
      rowsToAppend.push(baseRow);
    }
  });

  if (rowsToAppend.length === 0) {
    return { success: false, error: 'ข้อมูลภาระงานไม่ครบถ้วน' };
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  SpreadsheetApp.flush();
  return { success: true, appended: rowsToAppend.length };
}

function appendLeaveFromApi_(payload) {
  var list = Array.isArray(payload) ? payload : [payload];
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.LEAVE, [
    'Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note'
  ]);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var rowsToAppend = [];

  list.forEach(function(leave) {
    if (!leave || !leave.startDate || !leave.staffName) return;
    var baseRow = [
      String(leave.startDate || ''),
      String(leave.endDate || leave.startDate || ''),
      String(leave.staffName || ''),
      String(leave.position || 'RN'),
      String(leave.clinic || ''),
      String(leave.leaveType || 'ลาป่วย'),
      Number(leave.days || 1),
      String(leave.note || '')
    ];
    if (firstHeader === 'Leave_ID') {
      var lvId = leave.id || ('LV-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000));
      rowsToAppend.push([lvId].concat(baseRow));
    } else {
      rowsToAppend.push(baseRow);
    }
  });

  if (rowsToAppend.length === 0) {
    return { success: false, error: 'ข้อมูลวันลาไม่ครบถ้วน' };
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  SpreadsheetApp.flush();
  return { success: true, appended: rowsToAppend.length };
}

function appendOTFromApi_(payload) {
  var list = Array.isArray(payload) ? payload : [payload];
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.OT, [
    'Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic', 'Hours', 'Employee_Code'
  ]);
  ensureOtColumns_(sheet);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var rowsToAppend = [];

  list.forEach(function(ot) {
    if (!ot || !ot.date || !ot.staffName) return;
    var baseRow = [
      String(ot.date || ''),
      String(ot.shift || ''),
      String(ot.staffName || ''),
      String(ot.position || 'RN'),
      String(ot.homeClinic || ''),
      String(ot.workClinic || ''),
      ot.hours !== undefined && ot.hours !== null && ot.hours !== '' ? Number(ot.hours) : '',
      String(ot.employeeCode || '')
    ];
    if (firstHeader === 'OT_ID') {
      var otId = ot.id || ('OT-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000));
      rowsToAppend.push([otId].concat(baseRow));
    } else {
      rowsToAppend.push(baseRow);
    }
  });

  if (rowsToAppend.length === 0) {
    return { success: false, error: 'ข้อมูลเวรนอกเวลาไม่ครบถ้วน' };
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  SpreadsheetApp.flush();
  return { success: true, appended: rowsToAppend.length };
}

var DEFAULT_ADMIN_PIN_HASHES = [
  '7ec7bbd3677bee60f1e0c58b2967299b9985afad73acfde38966d76f30cc4f88',
  '89c1baf80810ed35b8cc4ab4bb30da6136d5ad7d4c0442988ed519e0dd68fc5e',
  '6a0a323dee59cd417b5071ea2a375702d16a9c40afe1f72ac8bf5d605b7c2c9d',
  'd81c15506dffe8152eec8216c52eb7b524fa7dc78010196d3e71c489f75001d'
];

function sha256HexGas_(text) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text || ''),
    Utilities.Charset.UTF_8
  );
  return digest.map(function(b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function verifyAdminPinInGas_(enteredPin) {
  var pin = String(enteredPin || '').trim();
  if (!pin) return false;
  var enteredHash = sha256HexGas_(pin);

  var settingsData = getSheetRowsNormalized_(SHEET_NAMES.SETTINGS, 2);
  var customPrimaryPin = '';
  var customAdditionalPinsJson = '';
  settingsData.rows.forEach(function(r) {
    var k = String(r[0] || '').trim();
    if (k === 'Admin_Pin') customPrimaryPin = String(r[1] || '').trim();
    if (k === 'Additional_Admin_Pins') customAdditionalPinsJson = String(r[1] || '').trim();
  });

  if (customPrimaryPin) {
    if (pin === customPrimaryPin) return true;
  } else if (enteredHash === DEFAULT_ADMIN_PIN_HASHES[0]) {
    return true;
  }

  if (customAdditionalPinsJson) {
    try {
      var slots = JSON.parse(customAdditionalPinsJson);
      if (Array.isArray(slots)) {
        for (var i = 0; i < slots.length; i++) {
          var slotPin = String((slots[i] && slots[i].pin) || '').trim();
          if (slotPin && pin === slotPin) return true;
        }
      }
    } catch (e) {
      // ignore invalid JSON
    }
  }

  for (var j = 1; j < DEFAULT_ADMIN_PIN_HASHES.length; j++) {
    if (enteredHash === DEFAULT_ADMIN_PIN_HASHES[j]) return true;
  }
  return false;
}

function replaceSheetBodyRows_(sheet, rows) {
  var lastRow = sheet.getLastRow();
  var maxCols = Math.max(sheet.getLastColumn(), (rows && rows.length > 0 ? rows[0].length : 1), 1);
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, maxCols).clearContent();
  }
  if (rows && rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  SpreadsheetApp.flush();
}

function isValidEmployeeCodeGas_(code) {
  var c = String(code || '').trim();
  if (!c) return false;
  if (/^STF-/i.test(c)) return false;
  if (/^(External|OPD|-)$/i.test(c)) return false;
  return true;
}

function resolveStaffCodeAndIdGas_(s) {
  var empCode = isValidEmployeeCodeGas_(s && s.employeeCode) ? String(s.employeeCode).trim() : '';
  var rawStaffId = String((s && s.staffId) || '').trim();
  var codeFromStaffId = isValidEmployeeCodeGas_(rawStaffId) ? rawStaffId : '';
  var resolvedCode = empCode || codeFromStaffId;
  return {
    staffId: resolvedCode || rawStaffId,
    employeeCode: resolvedCode
  };
}

function writeStaffRowsToSheet_(staffList) {
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.STAFF, [
    'Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status', 'Start_Date', 'End_Date', 'Employee_Code'
  ]);
  ensureStaffColumns_(sheet);
  var rows = (staffList || []).map(function(s) {
    var ids = resolveStaffCodeAndIdGas_(s);
    return [
      ids.staffId,
      String(s.name || ''),
      String(s.position || 'RN'),
      String(s.homeClinic || ''),
      String(s.status || 'Active'),
      String(s.startDate || ''),
      String(s.endDate || ''),
      ids.employeeCode
    ];
  });
  replaceSheetBodyRows_(sheet, rows);
}

function writeWorkloadRowsToSheet_(workloads) {
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.WORKLOAD, WORKLOAD_BASE_HEADERS);
  ensureWorkloadColumns_(sheet);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var rows = (workloads || []).map(function(entry, idx) {
    var adultPt = Number(entry.adultPt || 0);
    var childPt = Number(entry.childPt || 0);
    var totalPt = Math.max(Number(entry.totalPt || 0), adultPt + childPt);
    var baseRow = [
      String(entry.date || ''),
      String(entry.shift || ''),
      String(entry.clinic || ''),
      totalPt,
      adultPt,
      childPt,
      Number(entry.admit || 0),
      Number(entry.hn || 0),
      Number(entry.rn || 0),
      Number(entry.pn || 0),
      Number(entry.na !== undefined ? entry.na : (entry.pca || 0)),
      Number(entry.clerk || 0),
      Number(entry.serviceWorker || 0),
      String(entry.note || ''),
      String(entry.reporter || ''),
      String(entry.clinicGroup || ''),
      String(entry.poolId || ''),
      String(entry.recordType || 'STANDARD')
    ];
    if (firstHeader === 'Record_ID') {
      return [String(entry.id || ('REC-' + idx))].concat(baseRow);
    }
    return baseRow;
  });
  replaceSheetBodyRows_(sheet, rows);
}

function writeLeaveRowsToSheet_(leaves) {
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.LEAVE, [
    'Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note'
  ]);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var rows = (leaves || []).map(function(leave, idx) {
    var baseRow = [
      String(leave.startDate || ''),
      String(leave.endDate || leave.startDate || ''),
      String(leave.staffName || ''),
      String(leave.position || 'RN'),
      String(leave.clinic || ''),
      String(leave.leaveType || 'ลาป่วย'),
      Number(leave.days || 1),
      String(leave.note || '')
    ];
    if (firstHeader === 'Leave_ID') {
      return [String(leave.id || ('LV-' + idx))].concat(baseRow);
    }
    return baseRow;
  });
  replaceSheetBodyRows_(sheet, rows);
}

function writeOtRowsToSheet_(otList) {
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.OT, [
    'Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic', 'Hours', 'Employee_Code'
  ]);
  ensureOtColumns_(sheet);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var rows = (otList || []).map(function(ot, idx) {
    var baseRow = [
      String(ot.date || ''),
      String(ot.shift || ''),
      String(ot.staffName || ''),
      String(ot.position || 'RN'),
      String(ot.homeClinic || ''),
      String(ot.workClinic || ''),
      ot.hours !== undefined && ot.hours !== null && ot.hours !== '' ? Number(ot.hours) : '',
      String(ot.employeeCode || '')
    ];
    if (firstHeader === 'OT_ID') {
      return [String(ot.id || ('OT-' + idx))].concat(baseRow);
    }
    return baseRow;
  });
  replaceSheetBodyRows_(sheet, rows);
}

function writeSettingsToSheet_(settings) {
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.SETTINGS, ['Key', 'Value']);
  var existingData = getSheetRowsNormalized_(SHEET_NAMES.SETTINGS, 2);
  var existingMap = {};
  existingData.rows.forEach(function(r) {
    if (r[0]) existingMap[String(r[0]).trim()] = String(r[1] || '');
  });

  var resolvedGasUrl = String(settings.gasUrl || existingMap['Gas_Web_App_URL'] || getSavedGasUrl_() || '').trim();
  var resolvedPin = String(settings.adminPin || existingMap['Admin_Pin'] || '').trim();
  var resolvedDefaultCostCenter = String(settings.defaultCostCenter || existingMap['Default_Cost_Center'] || '2012000000').trim();
  var resolvedClinicCostCenters = settings.clinicCostCenters
    ? JSON.stringify(settings.clinicCostCenters)
    : (existingMap['Clinic_Cost_Centers'] || '{}');
  var resolvedOtHourlyRates = settings.otHourlyRates
    ? JSON.stringify(settings.otHourlyRates)
    : (existingMap['OT_Hourly_Rates'] || '{}');
  var resolvedOtControllerName = String(settings.otControllerName || existingMap['OT_Controller_Name'] || 'นางสาว ประภัสสร พันธุ์วา').trim();
  var resolvedStaffEmployeeCodes = settings.staffEmployeeCodes
    ? JSON.stringify(settings.staffEmployeeCodes)
    : (existingMap['Staff_Employee_Codes'] || '');

  var entries = [
    ['NHPPD', String(settings.nhppd || 0.4)],
    ['Screening_NHPPD', String(settings.screeningNhppd || 0.1)],
    ['Std_Hr', String(settings.stdHr || 7)],
    ['Annual_Hr', String(settings.annualHr || 2080)],
    ['Work_Days', String(settings.workDays || 245)],
    ['In_Time_Clinics', Array.isArray(settings.inTimeClinics) ? settings.inTimeClinics.join(', ') : DEFAULT_IN_TIME_CLINICS.join(', ')],
    ['Out_Time_Clinics', Array.isArray(settings.outTimeClinics) ? settings.outTimeClinics.join(', ') : DEFAULT_OUT_TIME_CLINICS.join(', ')],
    ['Premium_Sub_Clinics', Array.isArray(settings.premiumSubClinics) ? settings.premiumSubClinics.join(', ') : DEFAULT_PREMIUM_SUB_CLINICS.join(', ')],
    ['Leave_Types', Array.isArray(settings.leaveTypes) ? settings.leaveTypes.join(', ') : DEFAULT_LEAVE_TYPES.join(', ')],
    ['Custom_Holidays', JSON.stringify(settings.customHolidays || [])],
    ['Primary_Admin_Owner', String(settings.primaryAdminOwner || 'หัวหน้าพยาบาล')],
    ['Additional_Admin_Pins', JSON.stringify(settings.additionalAdminPins || [])],
    ['Gas_Web_App_URL', resolvedGasUrl],
    ['Default_Cost_Center', resolvedDefaultCostCenter],
    ['Clinic_Cost_Centers', resolvedClinicCostCenters],
    ['OT_Hourly_Rates', resolvedOtHourlyRates],
    ['OT_Controller_Name', resolvedOtControllerName]
  ];
  if (resolvedStaffEmployeeCodes && resolvedStaffEmployeeCodes !== '{}') {
    entries.push(['Staff_Employee_Codes', resolvedStaffEmployeeCodes]);
  }
  if (resolvedPin) {
    entries.push(['Admin_Pin', resolvedPin]);
  }
  replaceSheetBodyRows_(sheet, entries);
}

function appendAuditRowsToSheet_(auditList) {
  if (!auditList || auditList.length === 0) return;
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.AUDIT, [
    'Timestamp', 'Action', 'Target_Name', 'Summary', 'Reason', 'Edited_By'
  ]);
  var existingData = getSheetRowsNormalized_(SHEET_NAMES.AUDIT, 6);
  var existingKeys = {};
  existingData.rows.forEach(function(r) {
    existingKeys[String(r[0]) + '|' + String(r[1]) + '|' + String(r[2])] = true;
  });

  var toAppend = [];
  auditList.forEach(function(a) {
    if (!a || !a.timestamp) return;
    var k = String(a.timestamp) + '|' + String(a.action || '') + '|' + String(a.targetName || '');
    if (!existingKeys[k]) {
      existingKeys[k] = true;
      toAppend.push([
        String(a.timestamp || ''),
        String(a.action || ''),
        String(a.targetName || ''),
        String(a.summary || ''),
        String(a.reason || ''),
        String(a.editedBy || '')
      ]);
    }
  });

  if (toAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, 6).setValues(toAppend);
    SpreadsheetApp.flush();
  }
}

function deleteSheetBodyRowAt_(sheet, rowIdx) {
  var lastRow = sheet.getLastRow();
  if (rowIdx < 2 || rowIdx > lastRow) return;
  if (sheet.getMaxRows() - sheet.getFrozenRows() > 1) {
    sheet.deleteRow(rowIdx);
    SpreadsheetApp.flush();
    return;
  }
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  sheet.getRange(rowIdx, 1, 1, lastCol).clearContent();
  if (rowIdx < lastRow) {
    var belowVals = sheet.getRange(rowIdx + 1, 1, lastRow - rowIdx, lastCol).getValues();
    sheet.getRange(rowIdx, 1, belowVals.length, lastCol).setValues(belowVals);
    sheet.getRange(lastRow, 1, 1, lastCol).clearContent();
  }
  SpreadsheetApp.flush();
}

function buildWorkloadFullKeyGas_(r, offset) {
  var adult = Number(r[offset + 4] || 0);
  var child = Number(r[offset + 5] || 0);
  var total = Math.max(Number(r[offset + 3] || 0), adult + child);
  return [
    String(r[offset] || '').trim(),
    String(r[offset + 1] || '').trim(),
    String(r[offset + 2] || '').trim(),
    total,
    adult,
    child,
    Number(r[offset + 6] || 0),
    Number(r[offset + 7] || 0),
    Number(r[offset + 8] || 0),
    Number(r[offset + 9] || 0),
    Number(r[offset + 10] || 0),
    Number(r[offset + 11] || 0),
    Number(r[offset + 12] || 0),
    String(r[offset + 13] || '').trim(),
    String(r[offset + 14] || '').trim(),
    String(r[offset + 15] || '').trim(),
    String(r[offset + 17] || 'STANDARD').trim() || 'STANDARD'
  ].join('|');
}

function buildWorkloadObjFullKeyGas_(w) {
  var adult = Number(w.adultPt || 0);
  var child = Number(w.childPt || 0);
  var total = Math.max(Number(w.totalPt || 0), adult + child);
  return [
    String(w.date || '').trim(),
    String(w.shift || '').trim(),
    String(w.clinic || '').trim(),
    total,
    adult,
    child,
    Number(w.admit || 0),
    Number(w.hn || 0),
    Number(w.rn || 0),
    Number(w.pn || 0),
    Number(w.na !== undefined ? w.na : (w.pca || 0)),
    Number(w.clerk || 0),
    Number(w.serviceWorker || 0),
    String(w.note || '').trim(),
    String(w.reporter || '').trim(),
    String(w.clinicGroup || '').trim(),
    String(w.recordType || 'STANDARD').trim() || 'STANDARD'
  ].join('|');
}

function buildWorkloadCoreKeyGas_(date, shift, clinic, totalPt, reporter) {
  return [
    String(date || '').trim(),
    String(shift || '').trim(),
    String(clinic || '').trim(),
    Number(totalPt || 0),
    String(reporter || '').trim()
  ].join('|');
}

function findWorkloadSheetRowIndex_(sheet, targetObj) {
  if (!targetObj || sheet.getLastRow() <= 1) return -1;
  var lastCol = Math.max(19, sheet.getLastColumn());
  var allValues = sheet.getRange(1, 1, sheet.getLastRow(), lastCol).getValues();
  var firstHeader = String(allValues[0][0] || '').trim();
  var hasId = firstHeader === 'Record_ID';
  var offset = hasId ? 1 : 0;

  var targetFull = buildWorkloadObjFullKeyGas_(targetObj);
  var targetTotal = Math.max(Number(targetObj.totalPt || 0), Number(targetObj.adultPt || 0) + Number(targetObj.childPt || 0));
  var targetCore = buildWorkloadCoreKeyGas_(targetObj.date, targetObj.shift, targetObj.clinic, targetTotal, targetObj.reporter);

  if (hasId && targetObj.id) {
    for (var i = 1; i < allValues.length; i++) {
      if (String(allValues[i][0] || '').trim() === String(targetObj.id).trim()) {
        return i + 1;
      }
    }
  }

  for (var j = 1; j < allValues.length; j++) {
    var norm = allValues[j].map(formatCellValue_);
    if (buildWorkloadFullKeyGas_(norm, offset) === targetFull) {
      return j + 1;
    }
  }

  for (var k = 1; k < allValues.length; k++) {
    var normK = allValues[k].map(formatCellValue_);
    var rowAdult = Number(normK[offset + 4] || 0);
    var rowChild = Number(normK[offset + 5] || 0);
    var rowTotal = Math.max(Number(normK[offset + 3] || 0), rowAdult + rowChild);
    var rowCore = buildWorkloadCoreKeyGas_(normK[offset], normK[offset + 1], normK[offset + 2], rowTotal, normK[offset + 14]);
    if (rowCore === targetCore) {
      return k + 1;
    }
  }
  return -1;
}

function workloadObjToRowArray_(entry, hasId, existingId) {
  var adultPt = Number(entry.adultPt || 0);
  var childPt = Number(entry.childPt || 0);
  var totalPt = Math.max(Number(entry.totalPt || 0), adultPt + childPt);
  var baseRow = [
    String(entry.date || ''),
    String(entry.shift || ''),
    String(entry.clinic || ''),
    totalPt,
    adultPt,
    childPt,
    Number(entry.admit || 0),
    Number(entry.hn || 0),
    Number(entry.rn || 0),
    Number(entry.pn || 0),
    Number(entry.na !== undefined ? entry.na : (entry.pca || 0)),
    Number(entry.clerk || 0),
    Number(entry.serviceWorker || 0),
    String(entry.note || ''),
    String(entry.reporter || ''),
    String(entry.clinicGroup || ''),
    String(entry.poolId || ''),
    String(entry.recordType || 'STANDARD')
  ];
  return hasId ? [String(existingId || entry.id || ('REC-' + Date.now()))].concat(baseRow) : baseRow;
}

function updateWorkloadRowFromApi_(payload) {
  var target = payload.target;
  var updated = payload.updated;
  var auditEntry = payload.auditEntry;
  if (!updated) return { success: false, error: 'ไม่มีข้อมูลภาระงานที่จะแก้ไข' };

  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.WORKLOAD, WORKLOAD_BASE_HEADERS);
  ensureWorkloadColumns_(sheet);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var hasId = firstHeader === 'Record_ID';
  var rowIdx = findWorkloadSheetRowIndex_(sheet, target || updated);

  if (rowIdx === -1) {
    var notFoundRes = buildPublicReadAllPayload_();
    notFoundRes.success = false;
    notFoundRes.targeted = true;
    notFoundRes.notFound = true;
    notFoundRes.error = 'ไม่พบรายการเดิมใน Google Sheets (อาจถูกแก้ไขหรือลบจากเครื่องอื่นไปแล้ว)';
    return notFoundRes;
  }

  var existingId = hasId ? String(sheet.getRange(rowIdx, 1).getValue() || '').trim() : '';
  var rowValues = workloadObjToRowArray_(updated, hasId, existingId);
  sheet.getRange(rowIdx, 1, 1, rowValues.length).setValues([rowValues]);
  SpreadsheetApp.flush();

  if (auditEntry) {
    appendAuditRowsToSheet_([auditEntry]);
  }
  var res = buildPublicReadAllPayload_();
  res.targeted = true;
  return res;
}

function deleteWorkloadRowFromApi_(payload) {
  var target = payload.target;
  var auditEntry = payload.auditEntry;
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.WORKLOAD, WORKLOAD_BASE_HEADERS);
  var rowIdx = findWorkloadSheetRowIndex_(sheet, target);

  if (rowIdx !== -1) {
    deleteSheetBodyRowAt_(sheet, rowIdx);
  }
  if (auditEntry) {
    appendAuditRowsToSheet_([auditEntry]);
  }
  var res = buildPublicReadAllPayload_();
  res.targeted = true;
  res.deleted = rowIdx !== -1;
  return res;
}

function buildLeaveKeyGas_(startDate, endDate, staffName, clinic, leaveType, days, note) {
  return [
    String(startDate || '').trim(),
    String(endDate || startDate || '').trim(),
    String(staffName || '').trim(),
    String(clinic || '').trim(),
    String(leaveType || '').trim(),
    Number(days || 1),
    String(note || '').trim()
  ].join('|');
}

function findLeaveSheetRowIndex_(sheet, targetObj) {
  if (!targetObj || sheet.getLastRow() <= 1) return -1;
  var lastCol = Math.max(9, sheet.getLastColumn());
  var allValues = sheet.getRange(1, 1, sheet.getLastRow(), lastCol).getValues();
  var hasId = String(allValues[0][0] || '').trim() === 'Leave_ID';
  var offset = hasId ? 1 : 0;

  var targetKey = buildLeaveKeyGas_(
    targetObj.startDate, targetObj.endDate, targetObj.staffName,
    targetObj.clinic, targetObj.leaveType, targetObj.days, targetObj.note
  );

  if (hasId && targetObj.id) {
    for (var i = 1; i < allValues.length; i++) {
      if (String(allValues[i][0] || '').trim() === String(targetObj.id).trim()) return i + 1;
    }
  }
  for (var j = 1; j < allValues.length; j++) {
    var r = allValues[j].map(formatCellValue_);
    var k = buildLeaveKeyGas_(r[offset], r[offset + 1], r[offset + 2], r[offset + 4], r[offset + 5], r[offset + 6], r[offset + 7]);
    if (k === targetKey) return j + 1;
  }
  return -1;
}

function updateLeaveRowFromApi_(payload) {
  var target = payload.target;
  var updated = payload.updated;
  var auditEntry = payload.auditEntry;
  if (!updated) return { success: false, error: 'ไม่มีข้อมูลวันลาที่จะแก้ไข' };

  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.LEAVE, [
    'Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note'
  ]);
  var hasId = String(sheet.getRange(1, 1).getValue() || '').trim() === 'Leave_ID';
  var rowIdx = findLeaveSheetRowIndex_(sheet, target || updated);

  if (rowIdx === -1) {
    var notFoundRes = buildPublicReadAllPayload_();
    notFoundRes.success = false;
    notFoundRes.targeted = true;
    notFoundRes.notFound = true;
    notFoundRes.error = 'ไม่พบรายการวันลาเดิมใน Google Sheets (อาจถูกแก้ไขหรือลบจากเครื่องอื่นไปแล้ว)';
    return notFoundRes;
  }

  var baseRow = [
    String(updated.startDate || ''),
    String(updated.endDate || updated.startDate || ''),
    String(updated.staffName || ''),
    String(updated.position || 'RN'),
    String(updated.clinic || ''),
    String(updated.leaveType || 'ลาป่วย'),
    Number(updated.days || 1),
    String(updated.note || '')
  ];
  var existingId = hasId ? String(sheet.getRange(rowIdx, 1).getValue() || '').trim() : '';
  var rowValues = hasId ? [String(existingId || updated.id || ('LV-' + Date.now()))].concat(baseRow) : baseRow;
  sheet.getRange(rowIdx, 1, 1, rowValues.length).setValues([rowValues]);
  SpreadsheetApp.flush();

  if (auditEntry) {
    appendAuditRowsToSheet_([auditEntry]);
  }
  var res = buildPublicReadAllPayload_();
  res.targeted = true;
  return res;
}

function deleteLeaveRowFromApi_(payload) {
  var target = payload.target;
  var auditEntry = payload.auditEntry;
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.LEAVE, [
    'Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note'
  ]);
  var rowIdx = findLeaveSheetRowIndex_(sheet, target);
  if (rowIdx !== -1) {
    deleteSheetBodyRowAt_(sheet, rowIdx);
  }
  if (auditEntry) {
    appendAuditRowsToSheet_([auditEntry]);
  }
  var res = buildPublicReadAllPayload_();
  res.targeted = true;
  res.deleted = rowIdx !== -1;
  return res;
}

function stripOtHourTagGas_(workClinic) {
  return String(workClinic || '')
    .replace(/\s*\(\d+(?:\.\d+)?\s*ชม\.\)\s*$/, '')
    .trim();
}

function buildOtKeyGas_(date, shift, staffName, homeClinic, workClinic) {
  return [
    String(date || '').trim(),
    String(shift || '').trim(),
    String(staffName || '').trim(),
    String(homeClinic || '').trim(),
    stripOtHourTagGas_(workClinic)
  ].join('|');
}

function findOtSheetRowIndex_(sheet, targetObj) {
  if (!targetObj || sheet.getLastRow() <= 1) return -1;
  var lastCol = Math.max(9, sheet.getLastColumn());
  var allValues = sheet.getRange(1, 1, sheet.getLastRow(), lastCol).getValues();
  var hasId = String(allValues[0][0] || '').trim() === 'OT_ID';
  var offset = hasId ? 1 : 0;

  var targetKey = buildOtKeyGas_(targetObj.date, targetObj.shift, targetObj.staffName, targetObj.homeClinic, targetObj.workClinic);
  if (hasId && targetObj.id) {
    for (var i = 1; i < allValues.length; i++) {
      if (String(allValues[i][0] || '').trim() === String(targetObj.id).trim()) return i + 1;
    }
  }
  for (var j = 1; j < allValues.length; j++) {
    var r = allValues[j].map(formatCellValue_);
    var k = buildOtKeyGas_(r[offset], r[offset + 1], r[offset + 2], r[offset + 4], r[offset + 5]);
    if (k === targetKey) return j + 1;
  }
  return -1;
}

function updateOtRowFromApi_(payload) {
  var target = payload.target;
  var updated = payload.updated;
  var auditEntry = payload.auditEntry;
  if (!updated) return { success: false, error: 'ไม่มีข้อมูลเวร OT ที่จะแก้ไข' };

  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.OT, [
    'Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic', 'Hours', 'Employee_Code'
  ]);
  ensureOtColumns_(sheet);
  var hasId = String(sheet.getRange(1, 1).getValue() || '').trim() === 'OT_ID';
  var rowIdx = findOtSheetRowIndex_(sheet, target || updated);

  if (rowIdx === -1) {
    var notFoundRes = buildPublicReadAllPayload_();
    notFoundRes.success = false;
    notFoundRes.targeted = true;
    notFoundRes.notFound = true;
    notFoundRes.error = 'ไม่พบรายการเวร OT เดิมใน Google Sheets (อาจถูกแก้ไขหรือลบจากเครื่องอื่นไปแล้ว)';
    return notFoundRes;
  }

  var baseRow = [
    String(updated.date || ''),
    String(updated.shift || ''),
    String(updated.staffName || ''),
    String(updated.position || 'RN'),
    String(updated.homeClinic || ''),
    String(updated.workClinic || ''),
    updated.hours !== undefined && updated.hours !== null && updated.hours !== '' ? Number(updated.hours) : '',
    String(updated.employeeCode || '')
  ];
  var existingId = hasId ? String(sheet.getRange(rowIdx, 1).getValue() || '').trim() : '';
  var rowValues = hasId
    ? [String(existingId || updated.id || ('OT-' + Date.now()))].concat(baseRow)
    : baseRow;
  sheet.getRange(rowIdx, 1, 1, rowValues.length).setValues([rowValues]);
  SpreadsheetApp.flush();

  if (auditEntry) {
    appendAuditRowsToSheet_([auditEntry]);
  }
  var res = buildPublicReadAllPayload_();
  res.targeted = true;
  return res;
}

function deleteOtRowFromApi_(payload) {
  var target = payload.target;
  var auditEntry = payload.auditEntry;
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.OT, [
    'Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic', 'Hours', 'Employee_Code'
  ]);
  var rowIdx = findOtSheetRowIndex_(sheet, target);
  if (rowIdx !== -1) {
    deleteSheetBodyRowAt_(sheet, rowIdx);
  }
  if (auditEntry) {
    appendAuditRowsToSheet_([auditEntry]);
  }
  var res = buildPublicReadAllPayload_();
  res.targeted = true;
  res.deleted = rowIdx !== -1;
  return res;
}

function syncAdminAllFromApi_(payload) {
  var dirty = payload.dirty || {};
  var staffData = getSheetRowsNormalized_(SHEET_NAMES.STAFF, 8);

  if (dirty.staff || (staffData.rows.length === 0 && Array.isArray(payload.staff) && payload.staff.length > 0)) {
    writeStaffRowsToSheet_(payload.staff || []);
  }
  if (dirty.workloads && Array.isArray(payload.workloads)) {
    writeWorkloadRowsToSheet_(payload.workloads);
  }
  if (dirty.leaves && Array.isArray(payload.leaves)) {
    writeLeaveRowsToSheet_(payload.leaves);
  }
  if (dirty.ot && Array.isArray(payload.ot)) {
    writeOtRowsToSheet_(payload.ot);
  }
  if (dirty.settings && payload.settings) {
    writeSettingsToSheet_(payload.settings);
  }
  if (Array.isArray(payload.auditLogs) && payload.auditLogs.length > 0) {
    appendAuditRowsToSheet_(payload.auditLogs);
  }
  return buildPublicReadAllPayload_();
}

