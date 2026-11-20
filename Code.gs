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
var DEFAULT_LINE_GROUP_ID = 'C21630721218bccf814848fcf793e1746';

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
      .addItem('⏰ ตั้งเวลาส่งรายงานเข้า LINE อัตโนมัติ (03:59 น.)', 'setupLineDailyTrigger0359Ui')
      .addItem('📨 ทดสอบส่งรายงานผู้ป่วยประจำวันเข้า LINE ทันที', 'manualSendDailyCensusToLineUi')
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
        ['Gas_Web_App_URL', getSavedGasUrl_()],
        ['Line_Auto_Enabled', 'false'],
        ['Line_Auto_Time', '03:59'],
        ['Line_Auto_Report_Day', 'YESTERDAY'],
        ['Line_Auto_Shift', 'ALL'],
        ['Line_Target_Id', DEFAULT_LINE_GROUP_ID]
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

    // Handle LINE Messaging API Webhook Events (auto-detect Group ID when bot joins or receives a message)
    if (req && Array.isArray(req.events)) {
      return jsonResponse_(handleLineWebhookEvents_(req.events));
    }

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
      'addStaff', 'updateStaff', 'deleteStaff',
      'updateSettingsKeys',
      'updateWorkload', 'deleteWorkload',
      'updateLeave', 'deleteLeave',
      'updateOT', 'deleteOT',
      'configureLineAutomation', 'sendLineReportNow', 'getLineAutomationStatus'
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
      if (action === 'addStaff') {
        return jsonResponse_(addStaffFromApi_(payload || {}));
      }
      if (action === 'updateStaff') {
        return jsonResponse_(updateStaffRowFromApi_(payload || {}));
      }
      if (action === 'deleteStaff') {
        return jsonResponse_(deleteStaffRowFromApi_(payload || {}));
      }
      if (action === 'updateSettingsKeys') {
        return jsonResponse_(updateSettingsKeysFromApi_(payload || {}));
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
      if (action === 'configureLineAutomation') {
        return jsonResponse_(configureLineAutomationFromApi_(payload || {}));
      }
      if (action === 'sendLineReportNow') {
        return jsonResponse_(sendDailyCensusToLineNowFromApi_(payload || {}));
      }
      if (action === 'getLineAutomationStatus') {
        return jsonResponse_(getLineAutomationStatusFromApi_());
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
  for (var i = 0; i < expectedTail.length; i++) {
    // Only fill genuinely blank header cells so existing/custom headers are never overwritten
    if (!headers[baseColCount + i]) {
      sheet.getRange(1, baseColCount + 1 + i).setValue(expectedTail[i]);
    }
  }
}

function ensureStaffColumns_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) return;
  var col8 = String(sheet.getRange(1, 8).getValue() || '').trim();
  if (!col8) {
    sheet.getRange(1, 8).setValue('Employee_Code');
  }
}

function ensureOtColumns_(sheet) {
  if (!sheet || sheet.getLastRow() === 0) return;
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var baseCol = (firstHeader === 'OT_ID') ? 7 : 6;
  var hHours = String(sheet.getRange(1, baseCol + 1).getValue() || '').trim();
  var hCode = String(sheet.getRange(1, baseCol + 2).getValue() || '').trim();
  if (!hHours) {
    sheet.getRange(1, baseCol + 1).setValue('Hours');
  }
  if (!hCode) {
    sheet.getRange(1, baseCol + 2).setValue('Employee_Code');
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
      .filter(function(r) {
        return r[0] && r[0] !== 'Admin_Pin' && r[0] !== 'Line_Channel_Token';
      })
      .map(function(r) { return r.slice(0, 2); });

    var hasLineToken = Boolean(String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim());
    var hasTokenSetRow = settingsRows.some(function(r) { return r[0] === 'Line_Channel_Token_Set'; });
    if (!hasTokenSetRow) {
      settingsRows.push(['Line_Channel_Token_Set', hasLineToken ? 'true' : 'false']);
    } else {
      settingsRows = settingsRows.map(function(r) {
        return r[0] === 'Line_Channel_Token_Set' ? ['Line_Channel_Token_Set', hasLineToken ? 'true' : 'false'] : r;
      });
    }

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

  var hasLineTokenProp = Boolean(String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim());
  var lineAutoEnabledVal = settings.lineAutoEnabled !== undefined
    ? (settings.lineAutoEnabled ? 'true' : 'false')
    : (existingMap['Line_Auto_Enabled'] || 'false');
  var lineAutoTimeVal = String(settings.lineAutoTime || existingMap['Line_Auto_Time'] || '03:59').trim() || '03:59';
  var lineAutoReportDayVal = String(settings.lineAutoReportDayMode || existingMap['Line_Auto_Report_Day'] || 'YESTERDAY').trim() || 'YESTERDAY';
  var lineAutoShiftVal = String(settings.lineAutoShift || existingMap['Line_Auto_Shift'] || 'ALL').trim() || 'ALL';
  var lineTargetIdVal = settings.lineTargetId !== undefined
    ? String(settings.lineTargetId || DEFAULT_LINE_GROUP_ID).trim()
    : String(existingMap['Line_Target_Id'] || DEFAULT_LINE_GROUP_ID).trim();

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
    ['OT_Controller_Name', resolvedOtControllerName],
    ['Line_Auto_Enabled', lineAutoEnabledVal],
    ['Line_Auto_Time', lineAutoTimeVal],
    ['Line_Auto_Report_Day', lineAutoReportDayVal],
    ['Line_Auto_Shift', lineAutoShiftVal],
    ['Line_Target_Id', lineTargetIdVal],
    ['Line_Channel_Token_Set', hasLineTokenProp ? 'true' : 'false']
  ];
  if (existingMap['Line_Last_Sent_At']) entries.push(['Line_Last_Sent_At', existingMap['Line_Last_Sent_At']]);
  if (existingMap['Line_Last_Sent_Report_Date']) entries.push(['Line_Last_Sent_Report_Date', existingMap['Line_Last_Sent_Report_Date']]);
  if (existingMap['Line_Last_Status']) entries.push(['Line_Last_Status', existingMap['Line_Last_Status']]);
  if (existingMap['Line_Detected_Group_ID']) entries.push(['Line_Detected_Group_ID', existingMap['Line_Detected_Group_ID']]);
  if (existingMap['Line_Detected_Group_Name']) entries.push(['Line_Detected_Group_Name', existingMap['Line_Detected_Group_Name']]);
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
    if (payload.insertIfMissing) {
      var newRowValues = workloadObjToRowArray_(updated, hasId, updated.id || '');
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, newRowValues.length).setValues([newRowValues]);
      SpreadsheetApp.flush();
      if (auditEntry) {
        appendAuditRowsToSheet_([auditEntry]);
      }
      var insRes = buildPublicReadAllPayload_();
      insRes.targeted = true;
      insRes.inserted = true;
      return insRes;
    }
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

  if (rowIdx === -1) {
    if (payload.insertIfMissing) {
      var newRowValues = hasId ? [String(updated.id || ('LV-' + Date.now()))].concat(baseRow) : baseRow;
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, newRowValues.length).setValues([newRowValues]);
      SpreadsheetApp.flush();
      if (auditEntry) {
        appendAuditRowsToSheet_([auditEntry]);
      }
      var insRes = buildPublicReadAllPayload_();
      insRes.targeted = true;
      insRes.inserted = true;
      return insRes;
    }
    var notFoundRes = buildPublicReadAllPayload_();
    notFoundRes.success = false;
    notFoundRes.targeted = true;
    notFoundRes.notFound = true;
    notFoundRes.error = 'ไม่พบรายการวันลาเดิมใน Google Sheets (อาจถูกแก้ไขหรือลบจากเครื่องอื่นไปแล้ว)';
    return notFoundRes;
  }

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

  if (rowIdx === -1) {
    if (payload.insertIfMissing) {
      var newRowValues = hasId ? [String(updated.id || ('OT-' + Date.now()))].concat(baseRow) : baseRow;
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, newRowValues.length).setValues([newRowValues]);
      SpreadsheetApp.flush();
      if (auditEntry) {
        appendAuditRowsToSheet_([auditEntry]);
      }
      var insRes = buildPublicReadAllPayload_();
      insRes.targeted = true;
      insRes.inserted = true;
      return insRes;
    }
    var notFoundRes = buildPublicReadAllPayload_();
    notFoundRes.success = false;
    notFoundRes.targeted = true;
    notFoundRes.notFound = true;
    notFoundRes.error = 'ไม่พบรายการเวร OT เดิมใน Google Sheets (อาจถูกแก้ไขหรือลบจากเครื่องอื่นไปแล้ว)';
    return notFoundRes;
  }

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

function staffObjToRowArrayGas_(s) {
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
}

function findStaffSheetRowIndex_(sheet, targetObj, previousStaffId) {
  if (!sheet || sheet.getLastRow() <= 1) return -1;
  var allValues = sheet.getRange(1, 1, sheet.getLastRow(), Math.max(8, sheet.getLastColumn())).getValues();
  var candidates = [];
  if (previousStaffId) candidates.push(String(previousStaffId).trim());
  if (targetObj && targetObj.staffId) candidates.push(String(targetObj.staffId).trim());
  if (targetObj && targetObj.employeeCode && isValidEmployeeCodeGas_(targetObj.employeeCode)) {
    candidates.push(String(targetObj.employeeCode).trim());
  }

  for (var c = 0; c < candidates.length; c++) {
    var needle = candidates[c];
    if (!needle) continue;
    for (var i = 1; i < allValues.length; i++) {
      var colId = String(allValues[i][0] || '').trim();
      var colCode = String(allValues[i][7] || '').trim();
      if (colId === needle || (isValidEmployeeCodeGas_(needle) && colCode === needle)) {
        return i + 1;
      }
    }
  }

  var targetName = String((targetObj && targetObj.name) || '').trim();
  if (targetName) {
    for (var j = 1; j < allValues.length; j++) {
      if (String(allValues[j][1] || '').trim() === targetName) {
        return j + 1;
      }
    }
  }
  return -1;
}

function propagateStaffIdentityToOtRows_(oldName, newName, newCode, oldStaffId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.OT);
  if (!sheet || sheet.getLastRow() <= 1) return;
  ensureOtColumns_(sheet);
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(9, sheet.getLastColumn());
  var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var hasId = String(allValues[0][0] || '').trim() === 'OT_ID';
  var offset = hasId ? 1 : 0;

  var cleanOldName = String(oldName || '').trim();
  var cleanNewName = String(newName || '').trim();
  var cleanNewCode = isValidEmployeeCodeGas_(newCode) ? String(newCode).trim() : '';
  var cleanOldStaffId = isValidEmployeeCodeGas_(oldStaffId) ? String(oldStaffId).trim() : '';

  for (var i = 1; i < allValues.length; i++) {
    var rowName = String(allValues[i][offset + 2] || '').trim();
    var rowCode = String(allValues[i][offset + 7] || '').trim();
    var matchedByCode =
      (cleanNewCode && rowCode === cleanNewCode) ||
      (cleanOldStaffId && rowCode === cleanOldStaffId);
    var matchedByName =
      (cleanOldName && rowName === cleanOldName) ||
      (cleanNewName && rowName === cleanNewName);

    if (!matchedByCode && !matchedByName) continue;

    var rIdx = i + 1;
    if (cleanNewName && rowName !== cleanNewName) {
      sheet.getRange(rIdx, offset + 3).setValue(cleanNewName);
    }
    if (cleanNewCode && rowCode !== cleanNewCode) {
      sheet.getRange(rIdx, offset + 8).setValue(cleanNewCode);
    }
  }
  SpreadsheetApp.flush();
}

function addStaffFromApi_(payload) {
  var updated = payload.updated || payload.staff;
  var auditEntry = payload.auditEntry;
  if (!updated || !updated.name) return { success: false, error: 'ไม่มีข้อมูลบุคลากรที่จะเพิ่ม' };

  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.STAFF, [
    'Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status', 'Start_Date', 'End_Date', 'Employee_Code'
  ]);
  ensureStaffColumns_(sheet);

  var rowValues = staffObjToRowArrayGas_(updated);
  var existingRowIdx = findStaffSheetRowIndex_(sheet, updated, payload.previousStaffId);
  if (existingRowIdx !== -1) {
    sheet.getRange(existingRowIdx, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, rowValues.length).setValues([rowValues]);
  }
  SpreadsheetApp.flush();

  if (payload.propagateOt) {
    var ids = resolveStaffCodeAndIdGas_(updated);
    propagateStaffIdentityToOtRows_(updated.name, updated.name, ids.employeeCode, payload.previousStaffId || updated.staffId);
  }
  if (auditEntry) {
    appendAuditRowsToSheet_([auditEntry]);
  }
  var res = buildPublicReadAllPayload_();
  res.targeted = true;
  res.inserted = existingRowIdx === -1;
  return res;
}

function updateStaffRowFromApi_(payload) {
  var target = payload.target;
  var updated = payload.updated;
  var auditEntry = payload.auditEntry;
  if (!updated) return { success: false, error: 'ไม่มีข้อมูลบุคลากรที่จะแก้ไข' };

  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.STAFF, [
    'Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status', 'Start_Date', 'End_Date', 'Employee_Code'
  ]);
  ensureStaffColumns_(sheet);

  var rowIdx = findStaffSheetRowIndex_(sheet, target || updated, payload.previousStaffId);
  var rowValues = staffObjToRowArrayGas_(updated);

  if (rowIdx === -1) {
    if (payload.insertIfMissing) {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, rowValues.length).setValues([rowValues]);
      SpreadsheetApp.flush();
      if (payload.propagateOt) {
        var insIds = resolveStaffCodeAndIdGas_(updated);
        propagateStaffIdentityToOtRows_((target && target.name) || updated.name, updated.name, insIds.employeeCode, payload.previousStaffId || (target && target.staffId));
      }
      if (auditEntry) {
        appendAuditRowsToSheet_([auditEntry]);
      }
      var insRes = buildPublicReadAllPayload_();
      insRes.targeted = true;
      insRes.inserted = true;
      return insRes;
    }
    var notFoundRes = buildPublicReadAllPayload_();
    notFoundRes.success = false;
    notFoundRes.targeted = true;
    notFoundRes.notFound = true;
    notFoundRes.error = 'ไม่พบรายชื่อบุคลากรเดิมใน Google Sheets';
    return notFoundRes;
  }

  sheet.getRange(rowIdx, 1, 1, rowValues.length).setValues([rowValues]);
  SpreadsheetApp.flush();

  if (payload.propagateOt) {
    var ids = resolveStaffCodeAndIdGas_(updated);
    propagateStaffIdentityToOtRows_(
      (target && target.name) || updated.name,
      updated.name,
      ids.employeeCode,
      payload.previousStaffId || (target && target.staffId)
    );
  }
  if (auditEntry) {
    appendAuditRowsToSheet_([auditEntry]);
  }
  var res = buildPublicReadAllPayload_();
  res.targeted = true;
  return res;
}

function deleteStaffRowFromApi_(payload) {
  var target = payload.target;
  var auditEntry = payload.auditEntry;
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.STAFF, [
    'Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status', 'Start_Date', 'End_Date', 'Employee_Code'
  ]);
  var rowIdx = findStaffSheetRowIndex_(sheet, target, payload.previousStaffId);
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

function updateSettingsKeysFromApi_(payload) {
  var entries = Array.isArray(payload.entries) ? payload.entries : [];
  var auditEntry = payload.auditEntry;
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.SETTINGS, ['Key', 'Value']);

  var existingRowByKey = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      var k = String(keys[i][0] || '').trim();
      if (k && !existingRowByKey[k]) {
        existingRowByKey[k] = i + 2;
      }
    }
  }

  for (var e = 0; e < entries.length; e++) {
    var pair = entries[e];
    if (!Array.isArray(pair) || pair.length < 2) continue;
    var key = String(pair[0] || '').trim();
    var val = String(pair[1] === undefined || pair[1] === null ? '' : pair[1]);
    if (!key) continue;

    if (key === 'Gas_Web_App_URL' && val) {
      PropertiesService.getScriptProperties().setProperty('GAS_WEB_APP_URL', val);
    }

    var existingRow = existingRowByKey[key];
    if (existingRow) {
      sheet.getRange(existingRow, 2).setValue(val);
    } else {
      sheet.appendRow([key, val]);
      existingRowByKey[key] = sheet.getLastRow();
    }
  }
  SpreadsheetApp.flush();

  if (auditEntry) {
    appendAuditRowsToSheet_([auditEntry]);
  }
  var res = buildPublicReadAllPayload_();
  res.targeted = true;
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

/**
 * ==============================================================================
 * LINE Messaging API Automation (Daily OPD Census Report at 03:59 Asia/Bangkok)
 * ==============================================================================
 */

function readSettingsMapGas_() {
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.SETTINGS, ['Key', 'Value']);
  var data = getSheetRowsNormalized_(SHEET_NAMES.SETTINGS, 2);
  var map = {};
  data.rows.forEach(function(r) {
    if (r[0]) map[String(r[0]).trim()] = String(r[1] || '').trim();
  });
  return map;
}

function upsertSettingsEntriesGas_(pairs) {
  if (!pairs || pairs.length === 0) return;
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.SETTINGS, ['Key', 'Value']);
  var existingRowByKey = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      var k = String(keys[i][0] || '').trim();
      if (k && !existingRowByKey[k]) {
        existingRowByKey[k] = i + 2;
      }
    }
  }
  for (var j = 0; j < pairs.length; j++) {
    var key = String(pairs[j][0] || '').trim();
    var val = String(pairs[j][1] === undefined || pairs[j][1] === null ? '' : pairs[j][1]);
    if (!key) continue;
    var rIdx = existingRowByKey[key];
    if (rIdx) {
      sheet.getRange(rIdx, 2).setValue(val);
    } else {
      sheet.appendRow([key, val]);
      existingRowByKey[key] = sheet.getLastRow();
    }
  }
  SpreadsheetApp.flush();
}

function parseLineAutoTimeGas_(timeStr) {
  var m = String(timeStr || '03:59').trim().match(/^(\d{1,2}):(\d{1,2})$/);
  var hh = m ? Math.min(23, Math.max(0, Number(m[1]))) : 3;
  var mm = m ? Math.min(59, Math.max(0, Number(m[2]))) : 59;
  return {
    hour: hh,
    minute: mm,
    formatted: (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
  };
}

function getBangkokDatePartsGas_(dateObj) {
  var d = dateObj || new Date();
  var ymd = Utilities.formatDate(d, 'Asia/Bangkok', 'yyyy-MM-dd');
  var hm = Utilities.formatDate(d, 'Asia/Bangkok', 'HH:mm');
  var p = ymd.split('-');
  return {
    ymd: ymd,
    hm: hm,
    year: Number(p[0]),
    month: Number(p[1]),
    day: Number(p[2])
  };
}

function addDaysIsoGas_(ymd, deltaDays) {
  var p = String(ymd || '').split('-');
  if (p.length !== 3) return getBangkokDatePartsGas_().ymd;
  var dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + Number(deltaDays || 0)));
  return dt.getUTCFullYear() + '-' +
    (dt.getUTCMonth() + 1 < 10 ? '0' : '') + (dt.getUTCMonth() + 1) + '-' +
    (dt.getUTCDate() < 10 ? '0' : '') + dt.getUTCDate();
}

function formatThaiFullDateGas_(ymd) {
  var p = String(ymd || '').split('-');
  if (p.length !== 3) return String(ymd || '-');
  var y = Number(p[0]);
  var m = Number(p[1]);
  var d = Number(p[2]);
  var thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  var thaiMonths = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
  ];
  var dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return 'วัน' + thaiDays[dow] + 'ที่ ' + d + ' ' + thaiMonths[m - 1] + ' พ.ศ. ' + (y + 543);
}

function computeNextBangkokRunEpochGas_(timeStr, forceNextDay) {
  var t = parseLineAutoTimeGas_(timeStr);
  var bkk = getBangkokDatePartsGas_(new Date());
  var targetEpoch = Date.UTC(bkk.year, bkk.month - 1, bkk.day, t.hour - 7, t.minute, 0, 0);
  if (forceNextDay || targetEpoch <= Date.now() + 60000) {
    targetEpoch = Date.UTC(bkk.year, bkk.month - 1, bkk.day + 1, t.hour - 7, t.minute, 0, 0);
  }
  return targetEpoch;
}

function removeLineTriggersGas_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'runLineDailyCensusTrigger_' || fn === 'runLineDailyBackupTrigger_' || fn === 'runLineDailyCensusTrigger') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function syncLineAutomationTriggers_(enabled, timeStr) {
  removeLineTriggersGas_();
  if (!enabled) {
    return { installed: false, count: 0, nextRunAt: '' };
  }
  var parsed = parseLineAutoTimeGas_(timeStr);
  var nextEpoch = computeNextBangkokRunEpochGas_(parsed.formatted, false);
  ScriptApp.newTrigger('runLineDailyCensusTrigger_')
    .timeBased()
    .at(new Date(nextEpoch))
    .create();

  // Safety-net daily trigger (~10 minutes later) ensures tomorrow's exact HH:mm trigger is always refreshed
  var totalMins = parsed.hour * 60 + parsed.minute + 10;
  var backupHour = Math.floor((totalMins % 1440) / 60);
  var backupMin = totalMins % 60;
  ScriptApp.newTrigger('runLineDailyBackupTrigger_')
    .timeBased()
    .everyDays(1)
    .atHour(backupHour)
    .nearMinute(backupMin)
    .inTimezone('Asia/Bangkok')
    .create();

  var nextRunThai = Utilities.formatDate(new Date(nextEpoch), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
  PropertiesService.getScriptProperties().setProperty('LINE_NEXT_RUN_AT', nextRunThai);
  return { installed: true, count: 2, nextRunAt: nextRunThai };
}

function buildDailyCensusLineMessageGas_(targetDate, shiftFilter, settingsMap) {
  var workloadData = getSheetRowsNormalized_(SHEET_NAMES.WORKLOAD, 19);
  var hasId = workloadData.headers[0] === 'Record_ID';
  var off = hasId ? 1 : 0;

  var premiumSubRaw = (settingsMap && settingsMap['Premium_Sub_Clinics']) || DEFAULT_PREMIUM_SUB_CLINICS.join(', ');
  var premiumSubs = premiumSubRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var shiftTarget = String(shiftFilter || 'ALL').trim() || 'ALL';

  var parsedRows = [];
  workloadData.rows.forEach(function(r) {
    var d = String(r[off] || '').trim();
    var sh = String(r[off + 1] || '').trim();
    var cl = String(r[off + 2] || '').trim();
    if (!d || !cl) return;
    if (d !== targetDate) return;
    if (shiftTarget !== 'ALL' && sh !== shiftTarget) return;

    var adultPt = Number(r[off + 4] || 0) || 0;
    var childPt = Number(r[off + 5] || 0) || 0;
    var totalPt = Math.max(Number(r[off + 3] || 0) || 0, adultPt + childPt);
    var admit = Number(r[off + 6] || 0) || 0;
    var hn = Number(r[off + 7] || 0) || 0;
    var rn = Number(r[off + 8] || 0) || 0;
    var pn = Number(r[off + 9] || 0) || 0;
    var na = Number(r[off + 10] || 0) || 0;
    var rawNote = String(r[off + 13] || '').trim();
    var reporter = String(r[off + 14] || '').trim();
    var clinicGroup = String(r[off + 15] || '').trim();
    var recordType = String(r[off + 17] || 'STANDARD').trim();

    var referralData = null;
    var refMatch = rawNote.match(/\[\[REFERRAL_JSON:([\s\S]*?)\]\]/);
    if (refMatch) {
      try {
        referralData = JSON.parse(refMatch[1]);
      } catch (e) {
        referralData = null;
      }
    }

    var isOffDuty = false;
    var offDutyReason = '';
    var offDutyMatch = rawNote.match(/\[\[OFF_DUTY_JSON:([\s\S]*?)\]\]/);
    if (offDutyMatch) {
      isOffDuty = true;
      try {
        var parsedOff = JSON.parse(offDutyMatch[1]);
        offDutyReason = String((parsedOff && (parsedOff.r || parsedOff.reason)) || '').trim();
      } catch (e2) {
        offDutyReason = '';
      }
    }

    var offDutyStaffList = [];
    var offStaffMatch = rawNote.match(/\[\[OFF_STAFF_JSON:([\s\S]*?)\]\]/);
    if (offStaffMatch) {
      try {
        var parsedOffStaff = JSON.parse(offStaffMatch[1]);
        if (Array.isArray(parsedOffStaff)) offDutyStaffList = parsedOffStaff;
      } catch (e3) {
        offDutyStaffList = [];
      }
    }

    var isPremium = recordType === 'PREMIUM_POOL' || recordType === 'PREMIUM_SUB' ||
      clinicGroup === 'ศูนย์ปัญญาภิรมย์' || clinicGroup === 'คลินิกพิเศษ PREMIUM' ||
      cl.indexOf('ศูนย์ปัญญาภิรมย์') === 0 || /-Premium$/i.test(cl) || premiumSubs.indexOf(cl) !== -1;

    parsedRows.push({
      date: d, shift: sh, clinic: cl,
      totalPt: totalPt, adultPt: adultPt, childPt: childPt, admit: admit,
      hn: hn, rn: rn, pn: pn, na: na,
      reporter: reporter,
      recordType: isPremium ? (recordType === 'PREMIUM_POOL' || cl.indexOf('กำลังคนรวม') !== -1 ? 'PREMIUM_POOL' : 'PREMIUM_SUB') : 'STANDARD',
      isPremium: isPremium,
      referralData: referralData,
      isOffDuty: isOffDuty,
      offDutyReason: offDutyReason,
      offDutyStaffList: offDutyStaffList
    });
  });

  var formattedThaiDate = formatThaiFullDateGas_(targetDate);
  var shiftLabel = shiftTarget === 'ALL' ? 'สรุปภาพรวมทุกกะ' : shiftTarget;

  if (parsedRows.length === 0) {
    return {
      text: '📊 รายงานสถิติผู้ป่วยนอก OPD PCMC\n🏥 รพ.ศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน\n📅 ประจำวันที่: ' + formattedThaiDate + ' (' + shiftLabel + ')\n──────────────────\n⚠️ ยังไม่พบข้อมูลบันทึกภาระงานในวันที่และกะเวลาที่กำหนด',
      clinicCount: 0,
      totalPt: 0
    };
  }

  var regularRows = [];
  var premiumGroupsMap = {};
  parsedRows.forEach(function(w) {
    if (!w.isPremium) {
      regularRows.push(w);
      return;
    }
    var gKey = w.date + '|' + w.shift;
    if (!premiumGroupsMap[gKey]) {
      premiumGroupsMap[gKey] = { shift: w.shift, poolRows: [], subRows: [] };
    }
    if (w.recordType === 'PREMIUM_POOL') premiumGroupsMap[gKey].poolRows.push(w);
    else premiumGroupsMap[gKey].subRows.push(w);
  });

  var refKeys = [
    { key: 'admitPrivate', label: 'Admit พิเศษ' },
    { key: 'admitGeneral', label: 'Admit สามัญ' },
    { key: 'referIn', label: 'Refer in' },
    { key: 'referOut', label: 'Refer out' },
    { key: 'reservePrivateRoom', label: 'จองห้องพิเศษ' },
    { key: 'cancelPrivateRoom', label: 'ยกเลิกห้องพิเศษ' }
  ];

  var totals = { totalPt: 0, adultPt: 0, childPt: 0, admit: 0, rn: 0, pn: 0, na: 0 };
  var regularLines = [];
  var referralRows = [];
  var offDutyCount = 0;

  var formatOffStaffListGas_ = function(list) {
    if (!Array.isArray(list) || list.length === 0) return '';
    var labels = list.map(function(os) {
      var nm = String(os.n || os.staffName || '').trim();
      if (!nm) return '';
      var amtVal = Number(os.a !== undefined ? os.a : os.amount);
      var lbl = String(os.l || os.periodLabel || '').trim();
      var rsn = String(os.r || os.reason || '').trim();
      var amtStr = amtVal === 0.5 ? (' 0.5' + (lbl ? ' ' + lbl : '')) : '';
      return nm + ' [รายวัน] (Off เวร' + amtStr + (rsn ? ' - ' + rsn : '') + ')';
    }).filter(Boolean);
    return labels.length > 0 ? (' | Off เวรรายวัน: ' + labels.join(', ')) : '';
  };

  regularRows.forEach(function(w) {
    if (w.isOffDuty) {
      offDutyCount += 1;
      regularLines.push('• ' + w.clinic + ' (' + w.shift + '): ⏸️ Off เวร' + (w.offDutyReason ? ' (' + w.offDutyReason + ')' : ''));
      return;
    }
    var effPt = w.totalPt;
    if ((w.clinic === 'ศูนย์รับ - ส่งต่อผู้ป่วย' || w.referralData) && w.referralData) {
      referralRows.push(w);
      var rTot = 0;
      refKeys.forEach(function(rk) {
        rTot += Number((w.referralData[rk.key] && w.referralData[rk.key].count) || 0);
      });
      effPt = rTot;
    }
    totals.totalPt += effPt;
    totals.adultPt += w.adultPt;
    totals.childPt += w.childPt;
    totals.admit += w.admit;
    totals.rn += w.rn;
    totals.pn += w.pn;
    totals.na += w.na;
    var nursing = w.rn + w.pn + w.na;
    var offStaffStr = formatOffStaffListGas_(w.offDutyStaffList);
    regularLines.push('• ' + w.clinic + ' (' + w.shift + '): ' + effPt + ' ราย' + (w.admit > 0 ? ' | Admit ' + w.admit : '') + ' | พยาบาล ' + nursing.toFixed(1) + offStaffStr);
  });

  var premiumBlocks = [];
  var premKeys = Object.keys(premiumGroupsMap);
  premKeys.forEach(function(pk) {
    var grp = premiumGroupsMap[pk];
    var allPoolOff = grp.subRows.length === 0 && grp.poolRows.length > 0 && grp.poolRows.every(function(pr) { return pr.isOffDuty; });
    if (allPoolOff) {
      offDutyCount += 1;
      var gOffReason = '';
      grp.poolRows.forEach(function(pr) { if (!gOffReason && pr.offDutyReason) gOffReason = pr.offDutyReason; });
      premiumBlocks.push('🌟 ศูนย์ปัญญาภิรมย์ (' + grp.shift + '): ⏸️ Off เวร' + (gOffReason ? ' (' + gOffReason + ')' : ''));
      return;
    }
    var staffSrc = grp.poolRows.length > 0 ? grp.poolRows : grp.subRows;
    var pAdult = 0, pChild = 0, pTotal = 0, pAdmit = 0, pRn = 0, pPn = 0, pNa = 0;
    var pOffStaffList = [];
    grp.subRows.forEach(function(sr) {
      pAdult += sr.adultPt; pChild += sr.childPt; pTotal += sr.totalPt; pAdmit += sr.admit;
    });
    staffSrc.forEach(function(sr) {
      pRn += sr.rn; pPn += sr.pn; pNa += sr.na;
      if (Array.isArray(sr.offDutyStaffList) && sr.offDutyStaffList.length > 0) {
        pOffStaffList = pOffStaffList.concat(sr.offDutyStaffList);
      }
    });
    pTotal = Math.max(pTotal, pAdult + pChild);
    totals.totalPt += pTotal; totals.adultPt += pAdult; totals.childPt += pChild; totals.admit += pAdmit;
    totals.rn += pRn; totals.pn += pPn; totals.na += pNa;
    var pNursing = pRn + pPn + pNa;
    var pOffStaffStr = formatOffStaffListGas_(pOffStaffList);
    var lines = ['🌟 ศูนย์ปัญญาภิรมย์ (' + grp.shift + '): ' + pTotal + ' ราย (Admit ' + pAdmit + ') | พยาบาล ' + pNursing.toFixed(1) + ' แรง' + pOffStaffStr];
    grp.subRows.forEach(function(sr) {
      lines.push('  ↳ ' + sr.clinic + ': ' + sr.totalPt + ' ราย' + (sr.admit > 0 ? ' (Admit ' + sr.admit + ')' : ''));
    });
    premiumBlocks.push(lines.join('\n'));
  });

  var referralSection = '';
  if (referralRows.length > 0) {
    var refSum = 0;
    var refLines = refKeys.map(function(rk) {
      var cnt = 0;
      var reasons = [];
      referralRows.forEach(function(rr) {
        var entry = rr.referralData && rr.referralData[rk.key];
        if (entry) {
          cnt += Number(entry.count || 0);
          if (entry.reason) reasons.push(String(entry.reason).trim());
        }
      });
      refSum += cnt;
      return '  • ' + rk.label + ': ' + (cnt > 0 ? cnt : '-') + (reasons.length > 0 ? ' (' + reasons.join(', ') + ')' : '');
    });
    var reporters = referralRows.map(function(rr) { return rr.reporter; }).filter(Boolean);
    referralSection = '\n──────────────────\n🚑 ห้องรับ - ส่งต่อผู้ป่วย (รวม ' + refSum + ' รายการ)\n' + refLines.join('\n') +
      (reporters.length > 0 ? '\nผู้รายงาน: ' + reporters.join(', ') : '');
  }

  var totalNursing = totals.rn + totals.pn + totals.na;
  var clinicCount = regularRows.length + premKeys.length;
  var msg = '📊 รายงานภาระงานผู้ป่วยนอก OPD PCMC\n' +
    '🏥 รพ.ศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน\n' +
    '📅 ประจำวันที่: ' + formattedThaiDate + ' (' + shiftLabel + ')\n' +
    '──────────────────\n' +
    '👥 ผู้ป่วยนอกรวม: ' + totals.totalPt + ' ราย (ผู้ใหญ่ ' + totals.adultPt + ' | เด็ก ' + totals.childPt + ')\n' +
    '🛌 รับไว้รักษา (Admit): ' + totals.admit + ' ราย\n' +
    '👩‍⚕️ กำลังคนพยาบาลปฏิบัติงาน (RN+PN+NA): ' + totalNursing.toFixed(1) + ' แรง\n' +
    '(RN: ' + totals.rn.toFixed(1) + ' | PN: ' + totals.pn.toFixed(1) + ' | NA: ' + totals.na.toFixed(1) + ')' +
    (regularLines.length > 0 ? '\n──────────────────\n📋 รายละเอียดแยกห้องตรวจ:\n' + regularLines.join('\n') : '') +
    (premiumBlocks.length > 0 ? '\n──────────────────\n' + premiumBlocks.join('\n') : '') +
    referralSection +
    '\n──────────────────\nบันทึกทั้งหมด ' + clinicCount + ' คลินิกหลัก' +
    (offDutyCount > 0 ? ' (เปิดบริการ ' + (clinicCount - offDutyCount) + ' | Off เวร ' + offDutyCount + ')' : '');

  if (msg.length > 4950) {
    msg = msg.slice(0, 4900) + '\n...(ข้อความถูกย่อตามขีดจำกัด LINE)';
  }
  return { text: msg, clinicCount: clinicCount, totalPt: totals.totalPt };
}

function pushLineMessageGas_(channelAccessToken, targetId, text) {
  var token = String(channelAccessToken || '').trim();
  var to = String(targetId || '').trim();
  if (!token) return { ok: false, error: 'ยังไม่ได้ตั้งค่า LINE Channel Access Token' };
  if (!to) return { ok: false, error: 'ยังไม่ได้ระบุ LINE Group ID / Target ID' };

  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      to: to,
      messages: [{ type: 'text', text: String(text || '') }]
    }),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code >= 200 && code < 300) {
    return { ok: true };
  }
  return { ok: false, error: 'LINE API HTTP ' + code + ': ' + res.getContentText() };
}

function replyLineMessageGas_(channelAccessToken, replyToken, text) {
  if (!channelAccessToken || !replyToken) return;
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + channelAccessToken },
      payload: JSON.stringify({
        replyToken: replyToken,
        messages: [{ type: 'text', text: String(text || '') }]
      }),
      muteHttpExceptions: true
    });
  } catch (e) {
    // ignore reply failure
  }
}

function fetchLineGroupNameGas_(channelAccessToken, groupId) {
  if (!channelAccessToken || !groupId) return '';
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/group/' + encodeURIComponent(groupId) + '/summary', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + channelAccessToken },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      var data = JSON.parse(res.getContentText());
      return String(data.groupName || '').trim();
    }
  } catch (e) {
    // ignore
  }
  return '';
}

function handleLineWebhookEvents_(events) {
  var token = String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim();
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (!ev || !ev.source) continue;
    var detectedId = String(ev.source.groupId || ev.source.roomId || ev.source.userId || '').trim();
    if (!detectedId) continue;

    var groupName = ev.source.groupId ? fetchLineGroupNameGas_(token, detectedId) : '';
    var updates = [['Line_Detected_Group_ID', detectedId]];
    if (groupName) updates.push(['Line_Detected_Group_Name', groupName]);
    upsertSettingsEntriesGas_(updates);

    var txt = ev.type === 'message' && ev.message && ev.message.type === 'text'
      ? String(ev.message.text || '').trim().toLowerCase()
      : '';
    if (token && ev.replyToken && (txt === '/id' || txt === '/groupid' || txt === 'ขอรหัสกลุ่ม' || txt === 'id')) {
      replyLineMessageGas_(
        token,
        ev.replyToken,
        'รหัสกลุ่ม LINE (Group ID) สำหรับตั้งค่าออโตเมชั่น OPD:\n' + detectedId + (groupName ? '\nกลุ่ม: ' + groupName : '')
      );
    }
  }
  return { success: true };
}

function resolveAutoReportTargetDateGas_(mode, bkkTodayYmd) {
  if (mode === 'TODAY') return bkkTodayYmd;
  if (mode === 'LATEST_WITH_DATA') {
    var workloadData = getSheetRowsNormalized_(SHEET_NAMES.WORKLOAD, 19);
    var hasId = workloadData.headers[0] === 'Record_ID';
    var off = hasId ? 1 : 0;
    var dates = [];
    workloadData.rows.forEach(function(r) {
      var d = String(r[off] || '').trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && dates.indexOf(d) === -1) dates.push(d);
    });
    dates.sort();
    return dates.length > 0 ? dates[dates.length - 1] : addDaysIsoGas_(bkkTodayYmd, -1);
  }
  return addDaysIsoGas_(bkkTodayYmd, -1);
}

function sendScheduledCensusReportGas_(sourceTag) {
  var settingsMap = readSettingsMapGas_();
  var enabled = String(settingsMap['Line_Auto_Enabled'] || '').toLowerCase() === 'true';
  if (!enabled && sourceTag !== 'MANUAL') {
    return { success: false, skipped: true, reason: 'Automation disabled' };
  }

  var token = String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim();
  var targetId = String(settingsMap['Line_Target_Id'] || DEFAULT_LINE_GROUP_ID).trim();
  var reportDayMode = String(settingsMap['Line_Auto_Report_Day'] || 'YESTERDAY').trim();
  var shiftFilter = String(settingsMap['Line_Auto_Shift'] || 'ALL').trim() || 'ALL';

  var bkk = getBangkokDatePartsGas_(new Date());
  var targetDate = resolveAutoReportTargetDateGas_(reportDayMode, bkk.ymd);

  if (sourceTag !== 'MANUAL') {
    var lastSentTriggerDay = String(PropertiesService.getScriptProperties().getProperty('LINE_LAST_TRIGGER_BKK_DAY') || '').trim();
    if (lastSentTriggerDay === bkk.ymd) {
      return { success: true, skipped: true, reason: 'Already sent today (' + bkk.ymd + ')' };
    }
  }

  var report = buildDailyCensusLineMessageGas_(targetDate, shiftFilter, settingsMap);
  var pushRes = pushLineMessageGas_(token, targetId, report.text);
  var nowThai = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');

  if (pushRes.ok) {
    if (sourceTag !== 'MANUAL') {
      PropertiesService.getScriptProperties().setProperty('LINE_LAST_TRIGGER_BKK_DAY', bkk.ymd);
    }
    var okStatus = 'ส่งสำเร็จ (' + report.clinicCount + ' คลินิก, ผู้ป่วย ' + report.totalPt + ' ราย)';
    upsertSettingsEntriesGas_([
      ['Line_Last_Sent_At', nowThai],
      ['Line_Last_Sent_Report_Date', targetDate],
      ['Line_Last_Status', okStatus]
    ]);
    return { success: true, targetDate: targetDate, statusText: okStatus, sentAt: nowThai };
  } else {
    var errStatus = 'ส่งไม่สำเร็จ: ' + pushRes.error;
    upsertSettingsEntriesGas_([
      ['Line_Last_Sent_At', nowThai],
      ['Line_Last_Status', errStatus]
    ]);
    return { success: false, error: pushRes.error, statusText: errStatus };
  }
}

function runLineDailyCensusTrigger_() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    sendScheduledCensusReportGas_('AUTO_EXACT');
  } finally {
    var settingsMap = readSettingsMapGas_();
    var enabled = String(settingsMap['Line_Auto_Enabled'] || '').toLowerCase() === 'true';
    var timeStr = String(settingsMap['Line_Auto_Time'] || '03:59').trim() || '03:59';
    if (enabled) {
      var parsed = parseLineAutoTimeGas_(timeStr);
      // Schedule specifically for tomorrow so it triggers once per day at HH:mm
      var existing = ScriptApp.getProjectTriggers();
      for (var i = 0; i < existing.length; i++) {
        if (existing[i].getHandlerFunction() === 'runLineDailyCensusTrigger_') {
          ScriptApp.deleteTrigger(existing[i]);
        }
      }
      var nextEpoch = computeNextBangkokRunEpochGas_(parsed.formatted, true);
      ScriptApp.newTrigger('runLineDailyCensusTrigger_')
        .timeBased()
        .at(new Date(nextEpoch))
        .create();
      var nextRunThai = Utilities.formatDate(new Date(nextEpoch), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
      PropertiesService.getScriptProperties().setProperty('LINE_NEXT_RUN_AT', nextRunThai);
    }
    try { lock.releaseLock(); } catch (e) {}
  }
}

function runLineDailyBackupTrigger_() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var settingsMap = readSettingsMapGas_();
    var enabled = String(settingsMap['Line_Auto_Enabled'] || '').toLowerCase() === 'true';
    if (!enabled) {
      removeLineTriggersGas_();
      return;
    }
    var timeStr = String(settingsMap['Line_Auto_Time'] || '03:59').trim() || '03:59';
    var parsed = parseLineAutoTimeGas_(timeStr);
    var bkk = getBangkokDatePartsGas_(new Date());
    var lastSentDay = String(PropertiesService.getScriptProperties().getProperty('LINE_LAST_TRIGGER_BKK_DAY') || '').trim();
    if (lastSentDay !== bkk.ymd && bkk.hm >= parsed.formatted) {
      sendScheduledCensusReportGas_('AUTO_BACKUP');
    }
    // Ensure tomorrow's exact HH:mm trigger is present
    var hasExact = ScriptApp.getProjectTriggers().some(function(t) {
      return t.getHandlerFunction() === 'runLineDailyCensusTrigger_';
    });
    if (!hasExact) {
      var nextEpoch = computeNextBangkokRunEpochGas_(parsed.formatted, false);
      ScriptApp.newTrigger('runLineDailyCensusTrigger_')
        .timeBased()
        .at(new Date(nextEpoch))
        .create();
      var nextRunThai = Utilities.formatDate(new Date(nextEpoch), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
      PropertiesService.getScriptProperties().setProperty('LINE_NEXT_RUN_AT', nextRunThai);
    }
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function configureLineAutomationFromApi_(payload) {
  var enabled = Boolean(payload.enabled);
  var parsed = parseLineAutoTimeGas_(payload.time || '03:59');
  var reportDayMode = String(payload.reportDayMode || 'YESTERDAY').trim() || 'YESTERDAY';
  var shift = String(payload.shift || 'ALL').trim() || 'ALL';
  var targetId = String(payload.targetId || DEFAULT_LINE_GROUP_ID).trim();
  var incomingToken = String(payload.channelAccessToken || '').trim();

  if (payload.clearToken) {
    PropertiesService.getScriptProperties().deleteProperty('LINE_CHANNEL_ACCESS_TOKEN');
  } else if (incomingToken) {
    PropertiesService.getScriptProperties().setProperty('LINE_CHANNEL_ACCESS_TOKEN', incomingToken);
  }

  var hasToken = Boolean(String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim());
  var triggerInfo = syncLineAutomationTriggers_(enabled, parsed.formatted);

  upsertSettingsEntriesGas_([
    ['Line_Auto_Enabled', enabled ? 'true' : 'false'],
    ['Line_Auto_Time', parsed.formatted],
    ['Line_Auto_Report_Day', reportDayMode],
    ['Line_Auto_Shift', shift],
    ['Line_Target_Id', targetId],
    ['Line_Channel_Token_Set', hasToken ? 'true' : 'false']
  ]);

  var res = buildPublicReadAllPayload_();
  res.targeted = true;
  res.lineAutomation = {
    enabled: enabled,
    time: parsed.formatted,
    triggerInstalled: triggerInfo.installed,
    triggerCount: triggerInfo.count,
    nextRunAt: triggerInfo.nextRunAt,
    hasToken: hasToken
  };
  return res;
}

function sendDailyCensusToLineNowFromApi_(payload) {
  var settingsMap = readSettingsMapGas_();
  var token = String(payload.channelAccessToken || '').trim() ||
    String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim();
  var targetId = String(payload.targetId || settingsMap['Line_Target_Id'] || DEFAULT_LINE_GROUP_ID).trim();

  if (payload.channelAccessToken) {
    PropertiesService.getScriptProperties().setProperty('LINE_CHANNEL_ACCESS_TOKEN', String(payload.channelAccessToken).trim());
  }

  var bkk = getBangkokDatePartsGas_(new Date());
  var targetDate = String(payload.date || '').trim() ||
    resolveAutoReportTargetDateGas_(String(payload.reportDayMode || settingsMap['Line_Auto_Report_Day'] || 'YESTERDAY'), bkk.ymd);
  var shiftFilter = String(payload.shift || settingsMap['Line_Auto_Shift'] || 'ALL').trim() || 'ALL';

  var textToSend = String(payload.message || '').trim();
  var metaClinicCount = 0;
  var metaTotalPt = 0;
  if (!textToSend) {
    var built = buildDailyCensusLineMessageGas_(targetDate, shiftFilter, settingsMap);
    textToSend = built.text;
    metaClinicCount = built.clinicCount;
    metaTotalPt = built.totalPt;
  }

  var pushRes = pushLineMessageGas_(token, targetId, textToSend);
  var nowThai = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
  var statusText = pushRes.ok
    ? (metaClinicCount > 0 ? 'ส่งทันทีสำเร็จ (' + metaClinicCount + ' คลินิก, ผู้ป่วย ' + metaTotalPt + ' ราย)' : 'ส่งรายงานเข้า LINE สำเร็จ')
    : 'ส่งไม่สำเร็จ: ' + pushRes.error;

  upsertSettingsEntriesGas_([
    ['Line_Last_Sent_At', nowThai],
    ['Line_Last_Sent_Report_Date', targetDate],
    ['Line_Last_Status', statusText],
    ['Line_Channel_Token_Set', Boolean(token) ? 'true' : 'false']
  ]);

  var res = buildPublicReadAllPayload_();
  res.success = pushRes.ok;
  if (!pushRes.ok) res.error = pushRes.error;
  res.statusText = statusText;
  res.sentAt = nowThai;
  res.targetDate = targetDate;
  return res;
}

function getLineAutomationStatusFromApi_() {
  var settingsMap = readSettingsMapGas_();
  var triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    var fn = t.getHandlerFunction();
    return fn === 'runLineDailyCensusTrigger_' || fn === 'runLineDailyBackupTrigger_';
  });
  var hasToken = Boolean(String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim());
  return {
    success: true,
    enabled: String(settingsMap['Line_Auto_Enabled'] || '').toLowerCase() === 'true',
    time: String(settingsMap['Line_Auto_Time'] || '03:59'),
    triggerInstalled: triggers.length > 0,
    triggerCount: triggers.length,
    nextRunAt: String(PropertiesService.getScriptProperties().getProperty('LINE_NEXT_RUN_AT') || ''),
    hasToken: hasToken,
    targetId: String(settingsMap['Line_Target_Id'] || DEFAULT_LINE_GROUP_ID),
    detectedGroupId: String(settingsMap['Line_Detected_Group_ID'] || ''),
    detectedGroupName: String(settingsMap['Line_Detected_Group_Name'] || ''),
    lastSentAt: String(settingsMap['Line_Last_Sent_At'] || ''),
    lastSentReportDate: String(settingsMap['Line_Last_Sent_Report_Date'] || ''),
    lastStatus: String(settingsMap['Line_Last_Status'] || '')
  };
}

function setupLineDailyTrigger0359Ui() {
  var ui = SpreadsheetApp.getUi();
  var settingsMap = readSettingsMapGas_();
  var hasToken = Boolean(String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim());
  var targetId = String(settingsMap['Line_Target_Id'] || DEFAULT_LINE_GROUP_ID).trim();
  if (!hasToken) {
    var tokPrompt = ui.prompt(
      'LINE Channel Access Token',
      'วาง Channel Access Token (Long-lived) จาก LINE Official Account / LINE Developers:',
      ui.ButtonSet.OK_CANCEL
    );
    if (tokPrompt.getSelectedButton() !== ui.Button.OK) return;
    var tokVal = String(tokPrompt.getResponseText() || '').trim();
    if (!tokVal) return;
    PropertiesService.getScriptProperties().setProperty('LINE_CHANNEL_ACCESS_TOKEN', tokVal);
  }
  if (!targetId) {
    var grpPrompt = ui.prompt(
      'LINE Group ID (รหัสกลุ่ม)',
      'วาง LINE Group ID (ขึ้นต้นด้วย C...) ที่ต้องการให้ส่งรายงานเวลา 03:59 น.:',
      ui.ButtonSet.OK_CANCEL
    );
    if (grpPrompt.getSelectedButton() !== ui.Button.OK) return;
    targetId = String(grpPrompt.getResponseText() || '').trim();
    if (!targetId) return;
  }
  var triggerInfo = syncLineAutomationTriggers_(true, '03:59');
  upsertSettingsEntriesGas_([
    ['Line_Auto_Enabled', 'true'],
    ['Line_Auto_Time', '03:59'],
    ['Line_Auto_Report_Day', settingsMap['Line_Auto_Report_Day'] || 'YESTERDAY'],
    ['Line_Auto_Shift', settingsMap['Line_Auto_Shift'] || 'ALL'],
    ['Line_Target_Id', targetId],
    ['Line_Channel_Token_Set', 'true']
  ]);
  ui.alert('ตั้งเวลาส่งรายงานผู้ป่วยประจำวันเข้า LINE กลุ่มเวลา 03:59 น. (Asia/Bangkok) สำเร็จ!\nรอบถัดไป: ' + triggerInfo.nextRunAt);
}

function manualSendDailyCensusToLineUi() {
  var ui = SpreadsheetApp.getUi();
  var res = sendScheduledCensusReportGas_('MANUAL');
  if (res.success) {
    ui.alert('ส่งรายงานผู้ป่วยประจำวันเข้า LINE สำเร็จ!\n' + (res.statusText || ''));
  } else {
    ui.alert('ส่งเข้า LINE ไม่สำเร็จ: ' + (res.error || 'กรุณาตั้งค่า Token และ Group ID ก่อน'));
  }
}



