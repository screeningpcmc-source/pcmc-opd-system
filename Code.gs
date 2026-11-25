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
var DEFAULT_LINE_AUTO_TIME = '15:55';
var LINE_REPORT_DRIVE_FOLDER_NAME = 'OPD_PCMC_LINE_Reports';
var DEFAULT_LINE_SCHEDULES = [
  {
    id: 'WORKDAY_REG',
    label: 'ในเวลาราชการ (จันทร์-ศุกร์)',
    time: '15:55',
    dayRule: 'WORKDAYS_MON_FRI',
    shift: 'ในเวลา 08:00-16:00',
    reportDayMode: 'TODAY',
    enabled: true
  },
  {
    id: 'WORKDAY_EVENING',
    label: 'นอกเวลาราชการ (จันทร์-ศุกร์)',
    time: '20:00',
    dayRule: 'WORKDAYS_MON_FRI',
    shift: 'นอกเวลาเย็น 16:00-20:00',
    reportDayMode: 'TODAY',
    enabled: true
  },
  {
    id: 'HOLIDAY_MORNING',
    label: 'นอกเวลาราชการ (เสาร์-อาทิตย์ / วันหยุดนักขัตฤกษ์)',
    time: '12:30',
    dayRule: 'WEEKENDS_AND_HOLIDAYS',
    shift: 'นอกเวลาวันหยุด 08:00-12:00',
    reportDayMode: 'TODAY',
    enabled: true
  }
];

var SHEET_NAMES = {
  STAFF: 'Staff_Master',
  WORKLOAD: 'Daily_Workload',
  LEAVE: 'Leave_Records',
  OT: 'OT_Attendance',
  SETTINGS: 'Settings',
  AUDIT: 'Audit_Logs',
  GROUP_NOTES: 'Group_Notes'
};

var DEFAULT_IN_TIME_CLINICS = [
  'กุมารเวชกรรม', 'สูติ-นรีเวชกรรม', 'ศัลยกรรมกระดูก', 'เวชศาสตร์ฟื้นฟู', 'ศัลยกรรม',
  'จักษุวิทยา', 'ศูนย์เลสิก', 'โสต ศอ นาสิก', 'อายุรกรรม', 'ตรวจโรคทั่วไป',
  'Echo', 'AAIRC', 'ODS', 'ประกันสังคม', 'หน่วยคัดกรอง', 'ศูนย์รับ - ส่งต่อผู้ป่วย'
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
      .addItem('⏰ ตั้งเวลาส่งรายงานเข้า LINE อัตโนมัติ (15:55 / 20:00 / 12:30 น.)', 'setupLineDailyTrigger0359Ui')
      .addItem('🔑 อัปเดต LINE Token ใหม่ (แก้ Error 401)', 'updateLineTokenUi')
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
      name: SHEET_NAMES.GROUP_NOTES,
      headers: ['Note_ID', 'Timestamp', 'Category', 'Content', 'Saved_By', 'Group_ID', 'Keywords', 'Status'],
      color: '#0f766e',
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
        ['Default_Cost_Center', '2012000000'],
        ['Clinic_Cost_Centers', '{}'],
        ['Line_Auto_Enabled', 'false'],
        ['Line_Auto_Time', DEFAULT_LINE_AUTO_TIME],
        ['Line_Auto_Report_Day', 'TODAY'],
        ['Line_Auto_Shift', 'ในเวลา 08:00-16:00'],
        ['Line_Target_Id', DEFAULT_LINE_GROUP_ID],
        ['Line_Target_Groups', JSON.stringify([{ id: DEFAULT_LINE_GROUP_ID, name: 'หัวหน้าห้องตรวจ OPD', enabled: true }])],
        ['Line_Schedules', JSON.stringify(DEFAULT_LINE_SCHEDULES)],
        ['Line_Send_As_Image', 'true'],
        ['Line_Send_Format', 'BOTH'],
        ['Booby_Owner_Name', 'คุณทรงยศ'],
        ['Booby_Owner_User_ID', ''],
        ['Booby_Group_Mention_Only', 'true']
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
        var bodyRange = sheet.getRange(2, 1, schema.rows.length, schema.headers.length);
        if (schema.name === SHEET_NAMES.SETTINGS) {
          sheet.getRange(2, 2, schema.rows.length, 1).setNumberFormat('@');
        }
        bodyRange.setValues(schema.rows);
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
    if (action === 'saveUnitCostCenter') {
      return jsonResponse_(saveUnitCostCenterFromApi_(payload || {}));
    }
    if (action === 'uploadLineReportJpeg') {
      return jsonResponse_(uploadLineReportJpegFromApi_(payload || {}));
    }
    if (action === 'sendAutoScheduledLineReport') {
      return jsonResponse_(sendAutoScheduledLineReportFromClientApi_(payload || {}));
    }

    var adminActions = [
      'syncAdminAll', 'syncStaff', 'syncSettings', 'appendAudit',
      'addStaff', 'updateStaff', 'deleteStaff',
      'updateSettingsKeys',
      'updateWorkload', 'deleteWorkload',
      'updateLeave', 'deleteLeave', 'deduplicateLeaves',
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
      if (action === 'deduplicateLeaves') {
        return jsonResponse_(deduplicateLeaveSheetRows_());
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
    if (val.getFullYear() <= 1900) {
      return Utilities.formatDate(val, 'Asia/Bangkok', 'HH:mm');
    }
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
      .map(function(r) {
        var key = String(r[0] || '').trim();
        var val = String(r[1] || '');
        if (key === 'Line_Auto_Time') {
          val = parseLineAutoTimeGas_(val).formatted;
        }
        return [key, val];
      });

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
  var hasId = (firstHeader === 'Record_ID');
  var off = hasId ? 1 : 0;

  var existingIds = {};
  var existingSlots = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var colCount = Math.min(sheet.getLastColumn(), off + 18);
    var existingRows = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
    for (var i = 0; i < existingRows.length; i++) {
      var r = existingRows[i];
      if (hasId) {
        var exId = String(r[0] || '').trim();
        if (exId) existingIds[exId] = true;
      }
      var exDate = normalizeSheetDateGas_(r[off]);
      var exShift = String(r[off + 1] || '').replace(/\s+/g, ' ').trim();
      var exClinic = String(r[off + 2] || '').trim();
      var exRawType = String(r[off + 17] || 'STANDARD').trim().toUpperCase();
      var exTypeGroup = (exRawType === 'PREMIUM_SUB') ? 'PREMIUM_SUB' : ((exRawType === 'PREMIUM_POOL') ? 'PREMIUM_POOL' : 'STANDARD');
      if (exDate && exClinic) {
        existingSlots[exDate + '|' + exShift + '|' + exClinic + '|' + exTypeGroup] = true;
      }
    }
  }

  var rowsToAppend = [];
  var validInputCount = 0;
  var skippedDuplicates = 0;

  list.forEach(function(entry) {
    if (!entry || !entry.date || !entry.clinic) return;
    validInputCount += 1;

    var entryId = String(entry.id || '').trim();
    var normDate = normalizeSheetDateGas_(entry.date);
    var normShift = String(entry.shift || '').replace(/\s+/g, ' ').trim();
    var normClinic = String(entry.clinic || '').trim();
    var rawType = String(entry.recordType || 'STANDARD').trim().toUpperCase();
    var typeGroup = (rawType === 'PREMIUM_SUB') ? 'PREMIUM_SUB' : ((rawType === 'PREMIUM_POOL') ? 'PREMIUM_POOL' : 'STANDARD');
    var slotKey = normDate + '|' + normShift + '|' + normClinic + '|' + typeGroup;

    if ((entryId && existingIds[entryId]) || (normDate && normClinic && existingSlots[slotKey])) {
      skippedDuplicates += 1;
      return;
    }

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
    if (hasId) {
      var recId = entryId || ('REC-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000));
      existingIds[recId] = true;
      rowsToAppend.push([recId].concat(baseRow));
    } else {
      rowsToAppend.push(baseRow);
    }
    if (normDate && normClinic) {
      existingSlots[slotKey] = true;
    }
  });

  if (validInputCount === 0) {
    return { success: false, error: 'ข้อมูลภาระงานไม่ครบถ้วน' };
  }
  if (rowsToAppend.length === 0) {
    return { success: true, appended: 0, skippedDuplicates: skippedDuplicates };
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  SpreadsheetApp.flush();
  return { success: true, appended: rowsToAppend.length, skippedDuplicates: skippedDuplicates };
}

function normalizeStaffNameGas_(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function isTrainingLeaveGas_(leaveType) {
  var lt = String(leaveType || '').trim();
  return lt.indexOf('อบรม') !== -1 || lt.indexOf('ประชุม') !== -1;
}

function parseLeavePeriodGas_(note) {
  var text = String(note || '');
  if (text.indexOf('ครึ่งวันเช้า') !== -1) return 'ครึ่งวันเช้า';
  if (text.indexOf('ครึ่งวันบ่าย') !== -1) return 'ครึ่งวันบ่าย';
  return '';
}

function normalizeLeaveRangeGas_(startRaw, endRaw) {
  var s = normalizeSheetDateGas_(startRaw);
  var e = normalizeSheetDateGas_(endRaw || startRaw) || s;
  if (!s) return { start: '', end: '' };
  return s <= e ? { start: s, end: e } : { start: e, end: s };
}

function isLeaveConflictGas_(existing, candidate, excludeId) {
  if (!existing || !candidate) return false;
  if (excludeId && String(existing.id || '').trim() === String(excludeId).trim()) return false;
  var exName = normalizeStaffNameGas_(existing.staffName);
  var caName = normalizeStaffNameGas_(candidate.staffName);
  if (!exName || !caName || exName !== caName) return false;

  var exRange = normalizeLeaveRangeGas_(existing.startDate, existing.endDate);
  var caRange = normalizeLeaveRangeGas_(candidate.startDate, candidate.endDate);
  if (!exRange.start || !caRange.start) return false;
  if (!(exRange.start <= caRange.end && exRange.end >= caRange.start)) return false;

  var exIsTrain = isTrainingLeaveGas_(existing.leaveType);
  var caIsTrain = isTrainingLeaveGas_(candidate.leaveType);
  if (exIsTrain === caIsTrain) return true;

  var exDays = Number(existing.days || 1) || 1;
  var caDays = Number(candidate.days || 1) || 1;
  var exPeriod = parseLeavePeriodGas_(existing.note);
  var caPeriod = parseLeavePeriodGas_(candidate.note);
  if (
    exRange.start === exRange.end &&
    caRange.start === caRange.end &&
    exDays === 0.5 &&
    caDays === 0.5 &&
    exPeriod &&
    caPeriod &&
    exPeriod !== caPeriod
  ) {
    return false;
  }
  return true;
}

function scoreLeaveObjGas_(leave) {
  var score = 0;
  var noteText = String((leave && leave.note) || '')
    .replace(/^\s*\[(?:ครึ่งวันเช้า|ครึ่งวันบ่าย)\]\s*/, '')
    .replace(/\s*\((?:ครึ่งวันเช้า|ครึ่งวันบ่าย)\)\s*$/, '')
    .trim();
  if (noteText) {
    var isAuto =
      /^บันทึกอัตโนมัติจากห้องตรวจ/.test(noteText) ||
      /^ไปอบรม\/ประชุม\s*\(บันทึกจาก/.test(noteText);
    score += isAuto ? 10 : 300;
  }
  var id = String((leave && leave.id) || '').trim();
  if (id && !/^(LV-AUTO-|TRN-AUTO-|LV-GS-|LV-CHK-)/.test(id)) {
    score += 50;
  } else if (/^(LV-AUTO-|TRN-AUTO-)/.test(id)) {
    score += 20;
  }
  score += Math.min(30, Number((leave && leave.days) || 0));
  if (String((leave && leave.clinic) || '').trim()) score += 5;
  return score;
}

function deduplicateLeaveObjectsGas_(leaves) {
  var list = Array.isArray(leaves) ? leaves : [];
  var seenIds = {};
  var byStaff = {};
  var result = [];

  for (var i = 0; i < list.length; i++) {
    var raw = list[i];
    if (!raw) continue;
    var staffName = normalizeStaffNameGas_(raw.staffName);
    var range = normalizeLeaveRangeGas_(raw.startDate, raw.endDate);
    if (!staffName || !range.start) continue;

    var item = {
      id: String(raw.id || '').trim(),
      startDate: range.start,
      endDate: range.end,
      staffName: staffName,
      position: String(raw.position || 'RN').trim() || 'RN',
      clinic: String(raw.clinic || '').trim(),
      leaveType: String(raw.leaveType || 'ลาป่วย').trim(),
      days: Number(raw.days) > 0 ? Number(raw.days) : 1,
      note: String(raw.note || '').trim()
    };

    if (item.id && seenIds[item.id]) continue;

    var indices = byStaff[staffName] || [];
    var conflictIdx = -1;
    for (var j = 0; j < indices.length; j++) {
      if (isLeaveConflictGas_(result[indices[j]], item)) {
        conflictIdx = indices[j];
        break;
      }
    }

    if (conflictIdx !== -1) {
      if (scoreLeaveObjGas_(item) > scoreLeaveObjGas_(result[conflictIdx])) {
        result[conflictIdx] = item;
      }
      if (item.id) seenIds[item.id] = true;
      continue;
    }

    if (item.id) seenIds[item.id] = true;
    byStaff[staffName] = indices.concat([result.length]);
    result.push(item);
  }
  return result;
}

function deduplicateLeaveSheetRows_() {
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.LEAVE, [
    'Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note'
  ]);
  var lastRow = sheet.getLastRow();
  if (lastRow <= 2) {
    var okRes = buildPublicReadAllPayload_();
    okRes.removedDuplicates = 0;
    return okRes;
  }
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var hasId = (firstHeader === 'Leave_ID');
  var off = hasId ? 1 : 0;
  var colCount = Math.min(Math.max(sheet.getLastColumn(), off + 8), off + 8);
  var rawRows = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
  var objs = [];
  for (var i = 0; i < rawRows.length; i++) {
    var r = rawRows[i];
    var sDate = normalizeSheetDateGas_(r[off]);
    var sName = normalizeStaffNameGas_(r[off + 2]);
    if (!sDate || !sName) continue;
    objs.push({
      id: hasId ? String(r[0] || '').trim() : '',
      startDate: sDate,
      endDate: normalizeSheetDateGas_(r[off + 1] || r[off]) || sDate,
      staffName: sName,
      position: String(r[off + 3] || 'RN').trim(),
      clinic: String(r[off + 4] || '').trim(),
      leaveType: String(r[off + 5] || 'ลาป่วย').trim(),
      days: Number(r[off + 6] || 1),
      note: String(r[off + 7] || '').trim()
    });
  }
  var deduped = deduplicateLeaveObjectsGas_(objs);
  var removed = Math.max(0, objs.length - deduped.length);
  if (removed > 0) {
    writeLeaveRowsToSheet_(deduped);
  }
  var res = buildPublicReadAllPayload_();
  res.removedDuplicates = removed;
  return res;
}

function appendLeaveFromApi_(payload) {
  var list = Array.isArray(payload) ? payload : [payload];
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.LEAVE, [
    'Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note'
  ]);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var hasId = (firstHeader === 'Leave_ID');
  var off = hasId ? 1 : 0;

  var existingIds = {};
  var existingItems = [];
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var colCount = Math.min(sheet.getLastColumn(), off + 8);
    var existingRows = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
    for (var i = 0; i < existingRows.length; i++) {
      var r = existingRows[i];
      var exId = hasId ? String(r[0] || '').trim() : '';
      if (exId) existingIds[exId] = true;
      var exRange = normalizeLeaveRangeGas_(r[off], r[off + 1] || r[off]);
      var exName = normalizeStaffNameGas_(r[off + 2]);
      if (exRange.start && exName) {
        existingItems.push({
          id: exId,
          startDate: exRange.start,
          endDate: exRange.end,
          staffName: exName,
          leaveType: String(r[off + 5] || '').trim(),
          days: Number(r[off + 6] || 1),
          note: String(r[off + 7] || '').trim()
        });
      }
    }
  }

  var rowsToAppend = [];
  var validInputCount = 0;
  var skippedDuplicates = 0;

  list.forEach(function(leave) {
    if (!leave || !leave.startDate || !leave.staffName) return;
    var normName = normalizeStaffNameGas_(leave.staffName);
    var range = normalizeLeaveRangeGas_(leave.startDate, leave.endDate || leave.startDate);
    if (!normName || !range.start) return;
    validInputCount += 1;

    var leaveId = String(leave.id || '').trim();
    var candidate = {
      id: leaveId,
      startDate: range.start,
      endDate: range.end,
      staffName: normName,
      leaveType: String(leave.leaveType || 'ลาป่วย').trim(),
      days: Number(leave.days || 1),
      note: String(leave.note || '').trim()
    };

    var hasConflict = (leaveId && existingIds[leaveId]) || existingItems.some(function(ex) {
      return isLeaveConflictGas_(ex, candidate);
    });
    if (hasConflict) {
      skippedDuplicates += 1;
      return;
    }

    var baseRow = [
      range.start,
      range.end,
      normName,
      String(leave.position || 'RN'),
      String(leave.clinic || ''),
      candidate.leaveType,
      Number(leave.days || 1),
      candidate.note
    ];
    if (hasId) {
      var lvId = leaveId || ('LV-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000));
      existingIds[lvId] = true;
      candidate.id = lvId;
      rowsToAppend.push([lvId].concat(baseRow));
    } else {
      rowsToAppend.push(baseRow);
    }
    existingItems.push(candidate);
  });

  if (validInputCount === 0) {
    return { success: false, error: 'ข้อมูลวันลาไม่ครบถ้วน' };
  }
  if (rowsToAppend.length === 0) {
    return { success: true, appended: 0, skippedDuplicates: skippedDuplicates };
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  SpreadsheetApp.flush();
  return { success: true, appended: rowsToAppend.length, skippedDuplicates: skippedDuplicates };
}

function appendOTFromApi_(payload) {
  var list = Array.isArray(payload) ? payload : [payload];
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.OT, [
    'Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic', 'Hours', 'Employee_Code'
  ]);
  ensureOtColumns_(sheet);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
  var hasId = (firstHeader === 'OT_ID');
  var off = hasId ? 1 : 0;

  var existingIds = {};
  var existingKeys = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var colCount = Math.min(sheet.getLastColumn(), off + 8);
    var existingRows = sheet.getRange(2, 1, lastRow - 1, colCount).getValues();
    for (var i = 0; i < existingRows.length; i++) {
      var r = existingRows[i];
      if (hasId) {
        var exId = String(r[0] || '').trim();
        if (exId) existingIds[exId] = true;
      }
      var oKey = [
        normalizeSheetDateGas_(r[off]),
        String(r[off + 1] || '').replace(/\s+/g, ' ').trim(),
        String(r[off + 2] || '').replace(/\s+/g, ' ').trim()
      ].join('|');
      existingKeys[oKey] = true;
    }
  }

  var rowsToAppend = [];
  var validInputCount = 0;
  var skippedDuplicates = 0;

  list.forEach(function(ot) {
    if (!ot || !ot.date || !ot.staffName) return;
    validInputCount += 1;
    var rawOtId = String(ot.id || '').trim();
    var oKey = [
      normalizeSheetDateGas_(ot.date),
      String(ot.shift || '').replace(/\s+/g, ' ').trim(),
      String(ot.staffName || '').replace(/\s+/g, ' ').trim()
    ].join('|');
    if ((rawOtId && existingIds[rawOtId]) || existingKeys[oKey]) {
      skippedDuplicates += 1;
      return;
    }

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
    if (hasId) {
      var otId = rawOtId || ('OT-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000));
      existingIds[otId] = true;
      rowsToAppend.push([otId].concat(baseRow));
    } else {
      rowsToAppend.push(baseRow);
    }
    existingKeys[oKey] = true;
  });

  if (validInputCount === 0) {
    return { success: false, error: 'ข้อมูลเวรนอกเวลาไม่ครบถ้วน' };
  }
  if (rowsToAppend.length === 0) {
    return { success: true, appended: 0, skippedDuplicates: skippedDuplicates };
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  SpreadsheetApp.flush();
  return { success: true, appended: rowsToAppend.length, skippedDuplicates: skippedDuplicates };
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
    if (sheet.getName() === SHEET_NAMES.SETTINGS && rows[0].length >= 2) {
      sheet.getRange(2, 2, rows.length, 1).setNumberFormat('@');
    }
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
  var cleanLeaves = deduplicateLeaveObjectsGas_(leaves || []);
  var rows = cleanLeaves.map(function(leave, idx) {
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
  var lineAutoTimeVal = parseLineAutoTimeGas_(settings.lineAutoTime || existingMap['Line_Auto_Time'] || DEFAULT_LINE_AUTO_TIME).formatted;
  var lineAutoReportDayVal = String(settings.lineAutoReportDayMode || existingMap['Line_Auto_Report_Day'] || 'TODAY').trim() || 'TODAY';
  var lineAutoShiftVal = String(settings.lineAutoShift || existingMap['Line_Auto_Shift'] || 'ในเวลา 08:00-16:00').trim() || 'ในเวลา 08:00-16:00';
  var lineTargetIdVal = settings.lineTargetId !== undefined
    ? String(settings.lineTargetId || DEFAULT_LINE_GROUP_ID).trim()
    : String(existingMap['Line_Target_Id'] || DEFAULT_LINE_GROUP_ID).trim();
  var lineTargetGroupsVal = Array.isArray(settings.lineTargetGroups)
    ? JSON.stringify(settings.lineTargetGroups)
    : (existingMap['Line_Target_Groups'] || JSON.stringify([{ id: lineTargetIdVal || DEFAULT_LINE_GROUP_ID, name: 'หัวหน้าห้องตรวจ OPD', enabled: true }]));
  var lineSchedulesVal = Array.isArray(settings.lineSchedules)
    ? JSON.stringify(settings.lineSchedules)
    : (existingMap['Line_Schedules'] || JSON.stringify(DEFAULT_LINE_SCHEDULES));
  var lineSendAsImageVal = settings.lineSendAsImage !== undefined
    ? (settings.lineSendAsImage ? 'true' : 'false')
    : (existingMap['Line_Send_As_Image'] || 'true');
  var lineSendFormatVal = normalizeLineSendFormatGas_(
    settings.lineSendFormat || existingMap['Line_Send_Format'],
    lineSendAsImageVal !== 'false'
  );

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
    ['Line_Target_Groups', lineTargetGroupsVal],
    ['Line_Schedules', lineSchedulesVal],
    ['Line_Send_As_Image', lineSendFormatVal !== 'TEXT_ONLY' ? 'true' : 'false'],
    ['Line_Send_Format', lineSendFormatVal],
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

function normGasKeyText_(val) {
  return String(val || '').replace(/\s+/g, ' ').trim();
}

function buildWorkloadFullKeyGas_(r, offset) {
  var adult = Number(r[offset + 4] || 0);
  var child = Number(r[offset + 5] || 0);
  var total = Math.max(Number(r[offset + 3] || 0), adult + child);
  return [
    normalizeSheetDateGas_(r[offset]),
    normGasKeyText_(r[offset + 1]),
    normGasKeyText_(r[offset + 2]),
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
    normGasKeyText_(r[offset + 13]),
    normGasKeyText_(r[offset + 14]),
    normGasKeyText_(r[offset + 15]),
    normGasKeyText_(r[offset + 17] || 'STANDARD') || 'STANDARD'
  ].join('|');
}

function buildWorkloadObjFullKeyGas_(w) {
  var adult = Number(w.adultPt || 0);
  var child = Number(w.childPt || 0);
  var total = Math.max(Number(w.totalPt || 0), adult + child);
  return [
    normalizeSheetDateGas_(w.date),
    normGasKeyText_(w.shift),
    normGasKeyText_(w.clinic),
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
    normGasKeyText_(w.note),
    normGasKeyText_(w.reporter),
    normGasKeyText_(w.clinicGroup),
    normGasKeyText_(w.recordType || 'STANDARD') || 'STANDARD'
  ].join('|');
}

function buildWorkloadCoreKeyGas_(date, shift, clinic, totalPt, reporter) {
  return [
    normalizeSheetDateGas_(date),
    normGasKeyText_(shift),
    normGasKeyText_(clinic),
    Number(totalPt || 0),
    normGasKeyText_(reporter)
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

  var tDate = normalizeSheetDateGas_(targetObj.date);
  var tShift = normGasKeyText_(targetObj.shift);
  var tClinic = normGasKeyText_(targetObj.clinic);
  var tRecType = normGasKeyText_(targetObj.recordType || 'STANDARD') || 'STANDARD';
  var tripletMatches = [];
  for (var m = 1; m < allValues.length; m++) {
    var normM = allValues[m].map(formatCellValue_);
    var mDate = normalizeSheetDateGas_(normM[offset]);
    var mShift = normGasKeyText_(normM[offset + 1]);
    var mClinic = normGasKeyText_(normM[offset + 2]);
    var mRecType = normGasKeyText_(normM[offset + 17] || 'STANDARD') || 'STANDARD';
    if (mDate === tDate && mShift === tShift && mClinic === tClinic && mRecType === tRecType) {
      tripletMatches.push(m + 1);
    }
  }
  if (tripletMatches.length === 1) {
    return tripletMatches[0];
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
  var sNorm = normalizeSheetDateGas_(startDate);
  var eNorm = normalizeSheetDateGas_(endDate) || sNorm;
  return [
    sNorm,
    eNorm,
    normGasKeyText_(staffName),
    normGasKeyText_(clinic),
    normGasKeyText_(leaveType),
    Number(days || 1),
    normGasKeyText_(note)
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

  var ts = normalizeSheetDateGas_(targetObj.startDate);
  var te = normalizeSheetDateGas_(targetObj.endDate) || ts;
  var tName = normGasKeyText_(targetObj.staffName);
  var tType = normGasKeyText_(targetObj.leaveType);
  var uniqueMatches = [];
  for (var m = 1; m < allValues.length; m++) {
    var rm = allValues[m].map(formatCellValue_);
    var ms = normalizeSheetDateGas_(rm[offset]);
    var me = normalizeSheetDateGas_(rm[offset + 1]) || ms;
    var mName = normGasKeyText_(rm[offset + 2]);
    var mType = normGasKeyText_(rm[offset + 5]);
    if (ms === ts && me === te && mName === tName && mType === tType) {
      uniqueMatches.push(m + 1);
    }
  }
  if (uniqueMatches.length === 1) return uniqueMatches[0];
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
      var insertRes = appendLeaveFromApi_(updated);
      if (insertRes && insertRes.appended > 0 && auditEntry) {
        appendAuditRowsToSheet_([auditEntry]);
      }
      var insRes = buildPublicReadAllPayload_();
      insRes.targeted = true;
      insRes.inserted = Boolean(insertRes && insertRes.appended > 0);
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
  return normGasKeyText_(workClinic)
    .replace(/\s*\(\d+(?:\.\d+)?\s*ชม\.\)\s*$/, '')
    .trim();
}

function buildOtKeyGas_(date, shift, staffName, homeClinic, workClinic) {
  return [
    normalizeSheetDateGas_(date),
    normGasKeyText_(shift),
    normGasKeyText_(staffName),
    normGasKeyText_(homeClinic),
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

  var tDate = normalizeSheetDateGas_(targetObj.date);
  var tShift = normGasKeyText_(targetObj.shift);
  var tName = normGasKeyText_(targetObj.staffName);
  var tWork = stripOtHourTagGas_(targetObj.workClinic);
  var uniqueMatches = [];
  for (var m = 1; m < allValues.length; m++) {
    var rm = allValues[m].map(formatCellValue_);
    if (
      normalizeSheetDateGas_(rm[offset]) === tDate &&
      normGasKeyText_(rm[offset + 1]) === tShift &&
      normGasKeyText_(rm[offset + 2]) === tName &&
      stripOtHourTagGas_(rm[offset + 5]) === tWork
    ) {
      uniqueMatches.push(m + 1);
    }
  }
  if (uniqueMatches.length === 1) return uniqueMatches[0];
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
      sheet.getRange(existingRow, 2).setNumberFormat('@').setValue(val);
    } else {
      var nextRow = sheet.getLastRow() + 1;
      sheet.getRange(nextRow, 1, 1, 2).setNumberFormats([['@', '@']]).setValues([[key, val]]);
      existingRowByKey[key] = nextRow;
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

function saveUnitCostCenterFromApi_(payload) {
  var clinic = String((payload && payload.clinic) || '').trim();
  var costCenter = String((payload && payload.costCenter) || '').trim();
  if (!clinic) {
    return { success: false, error: 'กรุณาระบุชื่อหน่วยงานหรือห้องตรวจ' };
  }

  var settingsMap = readSettingsMapGas_();
  if (clinic === 'ALL') {
    var finalDefault = costCenter || '2012000000';
    upsertSettingsEntriesGas_([['Default_Cost_Center', finalDefault]]);
    return { success: true, clinic: 'ALL', costCenter: finalDefault };
  }

  var mapObj = {};
  try {
    var parsed = JSON.parse(settingsMap['Clinic_Cost_Centers'] || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      mapObj = parsed;
    }
  } catch (e) {
    mapObj = {};
  }

  if (costCenter) {
    mapObj[clinic] = costCenter;
  } else {
    delete mapObj[clinic];
  }

  upsertSettingsEntriesGas_([['Clinic_Cost_Centers', JSON.stringify(mapObj)]]);
  return {
    success: true,
    clinic: clinic,
    costCenter: costCenter,
    clinicCostCenters: mapObj
  };
}

function getOrCreateLineReportFolderGas_() {
  var folders = DriveApp.getFoldersByName(LINE_REPORT_DRIVE_FOLDER_NAME);
  if (folders.hasNext()) {
    return folders.next();
  }
  return DriveApp.createFolder(LINE_REPORT_DRIVE_FOLDER_NAME);
}

function cleanupOldLineReportFilesGas_(folder, maxAgeDays) {
  try {
    var cutoffMs = Date.now() - (Number(maxAgeDays || 14) * 86400000);
    var files = folder.getFiles();
    var removed = 0;
    while (files.hasNext() && removed < 20) {
      var f = files.next();
      if (f.getDateCreated().getTime() < cutoffMs) {
        f.setTrashed(true);
        removed += 1;
      }
    }
  } catch (e) {
    // ignore cleanup failure
  }
}

function uploadLineReportJpegFromApi_(payload) {
  try {
    var rawB64 = String((payload && (payload.base64Jpeg || payload.imageBase64)) || '').trim();
    rawB64 = rawB64.replace(/^data:image\/\w+;base64,/, '');
    if (!rawB64) {
      return { success: false, error: 'ไม่พบข้อมูลไฟล์ภาพ .jpeg' };
    }

    var safeFilename = String((payload && payload.filename) || ('OPD_Census_' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd_HHmmss') + '.jpeg'))
      .replace(/[^\w.\-\u0E00-\u0E7F]/g, '_');
    if (!/\.jpe?g$/i.test(safeFilename)) {
      safeFilename += '.jpeg';
    }

    var bytes = Utilities.base64Decode(rawB64);
    var blob = Utilities.newBlob(bytes, 'image/jpeg', safeFilename);
    var folder = getOrCreateLineReportFolderGas_();
    cleanupOldLineReportFilesGas_(folder, 14);

    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    var fileId = file.getId();

    var candidates = [
      'https://lh3.googleusercontent.com/d/' + fileId + '=w2000',
      'https://drive.google.com/uc?export=view&id=' + fileId,
      'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w2000'
    ];
    var chosenUrl = candidates[0];
    for (var i = 0; i < candidates.length; i++) {
      try {
        var checkRes = UrlFetchApp.fetch(candidates[i], {
          method: 'get',
          muteHttpExceptions: true,
          followRedirects: true
        });
        var headers = checkRes.getAllHeaders();
        var ct = String(headers['Content-Type'] || headers['content-type'] || '').toLowerCase();
        if (checkRes.getResponseCode() === 200 && ct.indexOf('image/') === 0) {
          chosenUrl = candidates[i];
          break;
        }
      } catch (fetchErr) {
        // try next candidate
      }
    }

    var previewUrl = chosenUrl.indexOf('lh3.googleusercontent.com') !== -1
      ? ('https://lh3.googleusercontent.com/d/' + fileId + '=w1000')
      : chosenUrl;

    return {
      success: true,
      fileId: fileId,
      imageUrl: chosenUrl,
      previewImageUrl: previewUrl
    };
  } catch (err) {
    return {
      success: false,
      error: 'อัปโหลดภาพไปยัง Google Drive ไม่สำเร็จ: ' + String(err && err.message ? err.message : err)
    };
  }
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
  } else {
    deduplicateLeaveSheetRows_();
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
      sheet.getRange(rIdx, 2).setNumberFormat('@').setValue(val);
    } else {
      var nextRow = sheet.getLastRow() + 1;
      sheet.getRange(nextRow, 1, 1, 2).setNumberFormats([['@', '@']]).setValues([[key, val]]);
      existingRowByKey[key] = nextRow;
    }
  }
  SpreadsheetApp.flush();
}

function parseLineAutoTimeGas_(timeStr) {
  if (timeStr instanceof Date) {
    var f = Utilities.formatDate(timeStr, 'Asia/Bangkok', 'HH:mm');
    var df = f.split(':');
    return { hour: Number(df[0]), minute: Number(df[1]), formatted: f };
  }
  var s = String(timeStr || DEFAULT_LINE_AUTO_TIME).trim();
  var m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  var hh = m ? Math.min(23, Math.max(0, Number(m[1]))) : 15;
  var mm = m ? Math.min(59, Math.max(0, Number(m[2]))) : 55;
  return {
    hour: hh,
    minute: mm,
    formatted: (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm
  };
}

var THAI_FIXED_HOLIDAYS_GAS_ = [
  '01-01', '04-06', '04-13', '04-14', '04-15', '05-04', '06-03',
  '07-28', '08-12', '10-13', '10-23', '12-05', '12-10', '12-31'
];

var THAI_LUNAR_HOLIDAYS_GAS_ = {
  2024: [
    { date: '2024-02-24' }, { date: '2024-05-10', noSub: true }, { date: '2024-05-22' },
    { date: '2024-07-20' }, { date: '2024-07-21' }
  ],
  2025: [
    { date: '2025-02-12' }, { date: '2025-05-09', noSub: true }, { date: '2025-05-11' },
    { date: '2025-07-10' }, { date: '2025-07-11' }
  ],
  2026: [
    { date: '2026-03-03' }, { date: '2026-05-13', noSub: true }, { date: '2026-05-31' },
    { date: '2026-07-29' }, { date: '2026-07-30' }
  ],
  2027: [
    { date: '2027-02-21' }, { date: '2027-05-20' }, { date: '2027-07-18' }, { date: '2027-07-19' }
  ],
  2028: [
    { date: '2028-02-10' }, { date: '2028-05-08' }, { date: '2028-07-06' }, { date: '2028-07-07' }
  ]
};

function addDaysIsoGas_(ymd, deltaDays) {
  var p = String(ymd || '').split('-');
  if (p.length !== 3) return getBangkokDatePartsGas_().ymd;
  var dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + Number(deltaDays || 0)));
  return dt.getUTCFullYear() + '-' +
    (dt.getUTCMonth() + 1 < 10 ? '0' : '') + (dt.getUTCMonth() + 1) + '-' +
    (dt.getUTCDate() < 10 ? '0' : '') + dt.getUTCDate();
}

function getThaiHolidaySetForYearGas_(year, customHolidaysList) {
  var map = {};
  var pendingSubs = [];
  var register = function(iso, noSub) {
    map[iso] = true;
    var p = iso.split('-');
    if (p.length !== 3) return;
    var dow = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay();
    if (!noSub && (dow === 0 || dow === 6)) {
      pendingSubs.push(iso);
    }
  };
  THAI_FIXED_HOLIDAYS_GAS_.forEach(function(md) {
    register(year + '-' + md, false);
  });
  var prevDec31Dow = new Date(Date.UTC(year - 1, 11, 31)).getUTCDay();
  if (prevDec31Dow === 0 || prevDec31Dow === 6) {
    pendingSubs.push((year - 1) + '-12-31');
  }
  (THAI_LUNAR_HOLIDAYS_GAS_[year] || []).forEach(function(item) {
    register(item.date, Boolean(item.noSub));
  });
  pendingSubs.forEach(function(baseIso) {
    var cursor = addDaysIsoGas_(baseIso, 1);
    for (var g = 0; g < 14; g++) {
      var p = cursor.split('-');
      var dow = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay();
      if (dow !== 0 && dow !== 6 && !map[cursor]) {
        if (Number(p[0]) === year) map[cursor] = true;
        break;
      }
      cursor = addDaysIsoGas_(cursor, 1);
    }
  });
  (customHolidaysList || []).forEach(function(ch) {
    if (ch && ch.date && String(ch.date).indexOf(String(year) + '-') === 0) {
      map[String(ch.date).trim()] = true;
    }
  });
  return map;
}

function isWeekendOrThaiHolidayGas_(ymd, settingsMap) {
  var p = String(ymd || '').split('-');
  if (p.length !== 3) return false;
  var year = Number(p[0]);
  var dow = new Date(Date.UTC(year, Number(p[1]) - 1, Number(p[2]))).getUTCDay();
  if (dow === 0 || dow === 6) return true;
  var customList = [];
  try {
    var parsedCustom = JSON.parse((settingsMap && settingsMap['Custom_Holidays']) || '[]');
    if (Array.isArray(parsedCustom)) customList = parsedCustom;
  } catch (e) {}
  var hMap = getThaiHolidaySetForYearGas_(year, customList);
  return Boolean(hMap[ymd]);
}

function matchesLineDayRuleGas_(ymd, dayRule, settingsMap) {
  if (!dayRule || dayRule === 'ALL_DAYS') return true;
  var isHol = isWeekendOrThaiHolidayGas_(ymd, settingsMap);
  return dayRule === 'WEEKENDS_AND_HOLIDAYS' ? isHol : !isHol;
}

function getLineSchedulesFromSettingsMap_(settingsMap) {
  try {
    var raw = settingsMap && settingsMap['Line_Schedules'];
    if (raw) {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(function(s, idx) {
          return {
            id: String(s.id || ('SCH-' + (idx + 1))),
            label: String(s.label || ('รอบที่ ' + (idx + 1))),
            time: parseLineAutoTimeGas_(s.time || DEFAULT_LINE_AUTO_TIME).formatted,
            dayRule: String(s.dayRule || 'ALL_DAYS'),
            shift: String(s.shift || 'ในเวลา 08:00-16:00'),
            reportDayMode: String(s.reportDayMode || 'TODAY'),
            sendAsImage: s.sendAsImage !== false,
            enabled: s.enabled !== false
          };
        });
      }
    }
  } catch (e) {}
  var singleTime = parseLineAutoTimeGas_((settingsMap && settingsMap['Line_Auto_Time']) || DEFAULT_LINE_AUTO_TIME).formatted;
  var singleShift = String((settingsMap && settingsMap['Line_Auto_Shift']) || 'ในเวลา 08:00-16:00').trim();
  var singleMode = String((settingsMap && settingsMap['Line_Auto_Report_Day']) || 'TODAY').trim();
  return DEFAULT_LINE_SCHEDULES.map(function(d, idx) {
    if (idx === 0) {
      return {
        id: d.id,
        label: d.label,
        time: singleTime,
        dayRule: d.dayRule,
        shift: singleShift || d.shift,
        reportDayMode: singleMode || d.reportDayMode,
        enabled: true
      };
    }
    return d;
  });
}

function resolveLineTargetIdsGas_(settingsMap, explicitTargetIds, explicitTargetId) {
  var seen = {};
  var out = [];
  var add = function(id) {
    var clean = String(id || '').trim();
    if (clean && !seen[clean]) {
      seen[clean] = true;
      out.push(clean);
    }
  };
  if (Array.isArray(explicitTargetIds) && explicitTargetIds.length > 0) {
    explicitTargetIds.forEach(add);
  }
  if (out.length === 0 && explicitTargetId) {
    add(explicitTargetId);
  }
  if (out.length === 0 && settingsMap && settingsMap['Line_Target_Groups']) {
    try {
      var groups = JSON.parse(settingsMap['Line_Target_Groups']);
      if (Array.isArray(groups)) {
        groups.forEach(function(g) {
          if (g && g.enabled !== false && g.id) add(g.id);
        });
      }
    } catch (e) {}
  }
  if (out.length === 0 && settingsMap && settingsMap['Line_Target_Id']) {
    add(settingsMap['Line_Target_Id']);
  }
  if (out.length === 0) add(DEFAULT_LINE_GROUP_ID);
  return out;
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

function computeNextMatchingRunEpochGas_(schedules, settingsMap) {
  var activeSchedules = (schedules || []).filter(function(s) { return s && s.enabled !== false; });
  if (activeSchedules.length === 0) return null;
  var bkk = getBangkokDatePartsGas_(new Date());
  var nowMs = Date.now();
  var earliest = null;

  for (var offset = 0; offset <= 10; offset++) {
    var candidateYmd = addDaysIsoGas_(bkk.ymd, offset);
    var cp = candidateYmd.split('-');
    var cy = Number(cp[0]), cm = Number(cp[1]), cd = Number(cp[2]);
    for (var sIdx = 0; sIdx < activeSchedules.length; sIdx++) {
      var sch = activeSchedules[sIdx];
      if (!matchesLineDayRuleGas_(candidateYmd, sch.dayRule, settingsMap)) continue;
      var parsed = parseLineAutoTimeGas_(sch.time);
      var epoch = Date.UTC(cy, cm - 1, cd, parsed.hour - 7, parsed.minute, 0, 0);
      if (epoch <= nowMs + 45000) continue;
      if (!earliest || epoch < earliest.epoch) {
        earliest = { epoch: epoch, schedule: sch };
      }
    }
    if (earliest) break;
  }
  return earliest;
}

function removeLineTriggersGas_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (
      fn === 'runLineDailyCensusTrigger_' ||
      fn === 'runLineDailyBackupTrigger_' ||
      fn === 'runLineGraceRetryTrigger_' ||
      fn === 'runLineDailyCensusTrigger'
    ) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function syncLineAutomationTriggers_(enabled, timeStr, settingsMapOverride) {
  removeLineTriggersGas_();
  if (!enabled) {
    PropertiesService.getScriptProperties().deleteProperty('LINE_NEXT_RUN_AT');
    return { installed: false, count: 0, nextRunAt: '' };
  }
  var settingsMap = settingsMapOverride || readSettingsMapGas_();
  var schedules = getLineSchedulesFromSettingsMap_(settingsMap);
  var nextInfo = computeNextMatchingRunEpochGas_(schedules, settingsMap);
  var fallbackParsed = parseLineAutoTimeGas_(timeStr || DEFAULT_LINE_AUTO_TIME);
  var nextEpoch = nextInfo ? nextInfo.epoch : (function() {
    var bkk = getBangkokDatePartsGas_(new Date());
    var e = Date.UTC(bkk.year, bkk.month - 1, bkk.day, fallbackParsed.hour - 7, fallbackParsed.minute, 0, 0);
    if (e <= Date.now() + 45000) {
      e = Date.UTC(bkk.year, bkk.month - 1, bkk.day + 1, fallbackParsed.hour - 7, fallbackParsed.minute, 0, 0);
    }
    return e;
  })();

  ScriptApp.newTrigger('runLineDailyCensusTrigger_')
    .timeBased()
    .at(new Date(nextEpoch))
    .create();

  // Hourly safety-net ensures multi-round triggers (15:55 / 20:00 / 12:30) always chain and catch up
  ScriptApp.newTrigger('runLineDailyBackupTrigger_')
    .timeBased()
    .everyHours(1)
    .create();

  var nextRunThai = Utilities.formatDate(new Date(nextEpoch), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss') +
    (nextInfo && nextInfo.schedule ? ' (' + nextInfo.schedule.label + ')' : '');
  PropertiesService.getScriptProperties().setProperty('LINE_NEXT_RUN_AT', nextRunThai);
  return { installed: true, count: 2, nextRunAt: nextRunThai };
}

function buildDailyCensusLineMessageGas_(targetDate, shiftFilter, settingsMap) {
  var workloadData = getSheetRowsNormalized_(SHEET_NAMES.WORKLOAD, 19);
  var hasId = workloadData.headers[0] === 'Record_ID';
  var off = hasId ? 1 : 0;

  var normTargetDate = normalizeSheetDateGas_(targetDate) || String(targetDate || '').trim();
  var premiumSubRaw = (settingsMap && settingsMap['Premium_Sub_Clinics']) || DEFAULT_PREMIUM_SUB_CLINICS.join(', ');
  var premiumSubs = premiumSubRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  var shiftTarget = String(shiftFilter || 'ALL').replace(/\s+/g, ' ').trim() || 'ALL';

  var parsedRows = [];
  workloadData.rows.forEach(function(r) {
    var d = normalizeSheetDateGas_(r[off]);
    var sh = String(r[off + 1] || '').replace(/\s+/g, ' ').trim();
    var cl = String(r[off + 2] || '').trim();
    if (!d || !cl) return;
    if (d !== normTargetDate) return;
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
  var includeRowShiftTag = (shiftTarget === 'ALL');

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
    var rowShiftSuffix = includeRowShiftTag ? (' (' + w.shift + ')') : '';
    if (w.isOffDuty) {
      offDutyCount += 1;
      regularLines.push('• ' + w.clinic + rowShiftSuffix + ': ⏸️ Off เวร' + (w.offDutyReason ? ' (' + w.offDutyReason + ')' : ''));
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
    regularLines.push('• ' + w.clinic + rowShiftSuffix + ': ' + effPt + ' ราย' + (w.admit > 0 ? ' | Admit ' + w.admit : '') + ' | พยาบาล ' + nursing.toFixed(1) + offStaffStr);
  });

  var premiumBlocks = [];
  var premKeys = Object.keys(premiumGroupsMap);
  premKeys.forEach(function(pk) {
    var grp = premiumGroupsMap[pk];
    var grpShiftSuffix = includeRowShiftTag ? (' (' + grp.shift + ')') : '';
    var allPoolOff = grp.subRows.length === 0 && grp.poolRows.length > 0 && grp.poolRows.every(function(pr) { return pr.isOffDuty; });
    if (allPoolOff) {
      offDutyCount += 1;
      var gOffReason = '';
      grp.poolRows.forEach(function(pr) { if (!gOffReason && pr.offDutyReason) gOffReason = pr.offDutyReason; });
      premiumBlocks.push('🌟 ศูนย์ปัญญาภิรมย์' + grpShiftSuffix + ': ⏸️ Off เวร' + (gOffReason ? ' (' + gOffReason + ')' : ''));
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
    var lines = ['🌟 ศูนย์ปัญญาภิรมย์' + grpShiftSuffix + ': ' + pTotal + ' ราย (Admit ' + pAdmit + ') | พยาบาล ' + pNursing.toFixed(1) + ' แรง' + pOffStaffStr];
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

function normalizeLineSendFormatGas_(rawFmt, legacySendAsImage) {
  var s = String(rawFmt || '').trim().toUpperCase();
  if (s === 'IMAGE_ONLY' || s === 'IMAGE') return 'IMAGE_ONLY';
  if (s === 'TEXT_ONLY' || s === 'TEXT') return 'TEXT_ONLY';
  if (s === 'BOTH') return 'BOTH';
  if (legacySendAsImage === false) return 'TEXT_ONLY';
  return 'BOTH';
}

function pushLineMessageGas_(channelAccessToken, targetIdsInput, text, imageUrl, previewImageUrl, sendFormat, allowTextFallbackOnMissingImg) {
  var token = String(channelAccessToken || '').trim();
  var targetList = Array.isArray(targetIdsInput)
    ? targetIdsInput
    : (String(targetIdsInput || '').trim() ? [String(targetIdsInput || '').trim()] : []);
  targetList = targetList.map(function(t) { return String(t || '').trim(); }).filter(Boolean);

  if (!token) return { ok: false, error: 'ยังไม่ได้ตั้งค่า LINE Channel Access Token' };
  if (targetList.length === 0) return { ok: false, error: 'ยังไม่ได้ระบุ LINE Group ID / Target ID' };

  var fmt = normalizeLineSendFormatGas_(sendFormat, true);
  var messages = [];
  var cleanImageUrl = String(imageUrl || '').trim();
  var cleanPreviewUrl = String(previewImageUrl || cleanImageUrl).trim();
  if (fmt !== 'TEXT_ONLY' && cleanImageUrl.indexOf('https://') === 0) {
    messages.push({
      type: 'image',
      originalContentUrl: cleanImageUrl,
      previewImageUrl: cleanPreviewUrl.indexOf('https://') === 0 ? cleanPreviewUrl : cleanImageUrl
    });
  }
  if ((fmt !== 'IMAGE_ONLY' || (allowTextFallbackOnMissingImg && messages.length === 0)) && String(text || '').trim()) {
    messages.push({ type: 'text', text: String(text || '') });
  }
  if (fmt === 'IMAGE_ONLY' && messages.length === 0) {
    return { ok: false, error: 'เลือกส่งเฉพาะรูปภาพ (.jpeg) แต่ไม่สามารถสร้างหรืออัปโหลดภาพขึ้น Google Drive ได้' };
  }
  if (messages.length === 0) {
    return { ok: false, error: 'ไม่มีข้อความหรือรูปภาพที่จะส่ง' };
  }

  var errors = [];
  var sentCount = 0;
  for (var i = 0; i < targetList.length; i++) {
    var to = targetList[i];
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ to: to, messages: messages }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var bodyText = res.getContentText() || '';
    if (code >= 200 && code < 300) {
      sentCount += 1;
    } else if (code === 401) {
      return {
        ok: false,
        sentCount: sentCount,
        httpCode: 401,
        error: 'LINE API HTTP 401: Channel Access Token ใน Google Apps Script (ScriptProperties) ไม่ถูกต้องหรือหมดอายุ/ถูก Reissue ใหม่แล้ว กรุณาอัปเดตผ่านเมนู Google Sheets "🏥 ระบบ OPD รพ.ชลประทาน → 🔑 อัปเดต LINE Token ใหม่ (แก้ Error 401)"'
      };
    } else if (code === 429 || /monthly limit/i.test(bodyText)) {
      return {
        ok: false,
        sentCount: sentCount,
        httpCode: 429,
        quotaExceeded: true,
        error: 'โควต้าส่งข้อความ Push รายเดือนของ LINE OA เต็มแล้ว (HTTP 429 — แพ็กเกจฟรีจำกัด 200 ข้อความ/เดือน) แนะนำรอขึ้นเดือนถัดไปหรืออัปเกรดแพ็กเกจ LINE OA (หมายเหตุ: การแชทถาม-ตอบกับ @บูบี้ ในกลุ่มยังใช้งานได้ฟรีตามปกติ)'
      };
    } else {
      errors.push(to + ': HTTP ' + code + ' ' + bodyText);
    }
  }

  if (errors.length > 0 && sentCount === 0) {
    return { ok: false, sentCount: 0, error: errors.join(' | ') };
  }
  return {
    ok: true,
    sentCount: sentCount,
    partialErrors: errors.length > 0 ? errors.join(' | ') : ''
  };
}

function verifyLineTokenGas_(channelAccessToken, targetId) {
  var token = String(channelAccessToken || '').trim();
  if (!token) {
    return { ok: false, error: 'ยังไม่ได้ตั้งค่า LINE Channel Access Token' };
  }
  try {
    var botRes = UrlFetchApp.fetch('https://api.line.me/v2/bot/info', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    var botCode = botRes.getResponseCode();
    if (botCode !== 200) {
      return {
        ok: false,
        code: botCode,
        error: botCode === 401
          ? 'Token ไม่ถูกต้อง หมดอายุ หรือถูกกด Reissue ใหม่แล้ว (HTTP 401)'
          : ('LINE API HTTP ' + botCode + ': ' + botRes.getContentText())
      };
    }
    var botData = JSON.parse(botRes.getContentText() || '{}');
    var botName = String(botData.displayName || '').trim();
    var cleanTarget = String(targetId || '').trim();
    var groupName = '';
    var groupVerified = false;
    var groupError = '';
    if (cleanTarget && cleanTarget.indexOf('C') === 0) {
      var grpRes = UrlFetchApp.fetch('https://api.line.me/v2/bot/group/' + encodeURIComponent(cleanTarget) + '/summary', {
        method: 'get',
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });
      if (grpRes.getResponseCode() === 200) {
        var grpData = JSON.parse(grpRes.getContentText() || '{}');
        groupName = String(grpData.groupName || '').trim();
        groupVerified = true;
      } else {
        groupError = 'ไม่พบข้อมูลกลุ่ม (HTTP ' + grpRes.getResponseCode() + ') กรุณาตรวจว่าบอทอยู่ในกลุ่มแล้ว';
      }
    }

    var quotaType = '';
    var quotaLimit = null;
    var quotaUsed = null;
    var quotaRemaining = null;
    try {
      var qRes = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota', {
        method: 'get',
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });
      var cRes = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/quota/consumption', {
        method: 'get',
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });
      if (qRes.getResponseCode() === 200) {
        var qData = JSON.parse(qRes.getContentText() || '{}');
        quotaType = String(qData.type || '');
        if (typeof qData.value === 'number') quotaLimit = qData.value;
      }
      if (cRes.getResponseCode() === 200) {
        var cData = JSON.parse(cRes.getContentText() || '{}');
        if (typeof cData.totalUsage === 'number') quotaUsed = cData.totalUsage;
      }
      if (quotaLimit !== null && quotaUsed !== null) {
        quotaRemaining = Math.max(0, quotaLimit - quotaUsed);
      }
    } catch (qErr) {
      // ignore non-critical quota lookup failures
    }

    return {
      ok: true,
      botName: botName,
      groupVerified: groupVerified,
      groupName: groupName,
      groupError: groupError,
      quotaType: quotaType,
      quotaLimit: quotaLimit,
      quotaUsed: quotaUsed,
      quotaRemaining: quotaRemaining
    };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
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

function normalizeSheetDateGas_(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    var y = Number(iso[1]);
    if (y >= 2400) y -= 543;
    return y + '-' + String(Number(iso[2])).padStart(2, '0') + '-' + String(Number(iso[3])).padStart(2, '0');
  }
  var slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (slash) {
    var d = Number(slash[1]);
    var m = Number(slash[2]);
    var yr = Number(slash[3]);
    if (yr < 100) yr += (yr >= 60 ? 2500 - 543 : 2000);
    else if (yr >= 2400) yr -= 543;
    return yr + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  return s;
}

function parseThaiQueryTargetDateGas_(rawText, todayYmd) {
  var thaiDigits = '๐๑๒๓๔๕๖๗๘๙';
  var txt = String(rawText || '').trim().toLowerCase().replace(/[๐-๙]/g, function(ch) {
    var idx = thaiDigits.indexOf(ch);
    return idx !== -1 ? String(idx) : ch;
  }).replace(/\s+/g, ' ');

  var p = String(todayYmd || '').split('-').map(Number);
  var baseYear = p.length === 3 ? p[0] : new Date().getFullYear();
  var baseMonth = p.length === 3 ? p[1] : (new Date().getMonth() + 1);
  var baseDay = p.length === 3 ? p[2] : new Date().getDate();
  var curDow = p.length === 3 ? new Date(Date.UTC(baseYear, baseMonth - 1, baseDay)).getUTCDay() : new Date().getDay();

  var pad2 = function(n) { return (n < 10 ? '0' : '') + n; };
  var makeYmd = function(y, m, d) {
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (isNaN(dt.getTime())) return todayYmd;
    return dt.getUTCFullYear() + '-' + pad2(dt.getUTCMonth() + 1) + '-' + pad2(dt.getUTCDate());
  };
  var lastDayOfMonth = function(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  };
  var normalizeYear = function(rawY, fallbackYear) {
    if (!rawY && rawY !== 0) return fallbackYear;
    var n = Number(rawY);
    if (!isFinite(n) || n <= 0) return fallbackYear;
    if (n < 100) {
      if (n >= 55) return 2500 + n - 543; // e.g. 69 -> 2569 BE -> 2026 CE
      if (n >= 20 && n <= 45) return 2000 + n; // e.g. 26 -> 2026 CE
      return fallbackYear;
    }
    if (n >= 2400) return n - 543;
    if (n >= 1900 && n <= 2150) return n;
    return fallbackYear;
  };
  var singleResult = function(ymd, relLabel, isFallback) {
    return { ymd: ymd, endYmd: ymd, isRange: false, relLabel: relLabel || '', hasExplicitDate: !isFallback };
  };
  var rangeResult = function(startYmd, endYmd, relLabel) {
    if (startYmd > endYmd) {
      var tmp = startYmd; startYmd = endYmd; endYmd = tmp;
    }
    return { ymd: startYmd, endYmd: endYmd, isRange: startYmd !== endYmd, relLabel: relLabel || '', hasExplicitDate: true };
  };

  var thaiMonthMap = {
    'มกราคม': 1, 'มกรา': 1, 'มค': 1,
    'กุมภาพันธ์': 2, 'กุมภา': 2, 'กพ': 2,
    'มีนาคม': 3, 'มีนา': 3, 'มีค': 3,
    'เมษายน': 4, 'เมษา': 4, 'เมย': 4,
    'พฤษภาคม': 5, 'พฤษภา': 5, 'พค': 5,
    'มิถุนายน': 6, 'มิถุนา': 6, 'มิย': 6,
    'กรกฎาคม': 7, 'กรกฎา': 7, 'กค': 7,
    'สิงหาคม': 8, 'สิงหา': 8, 'สค': 8,
    'กันยายน': 9, 'กันยา': 9, 'กย': 9,
    'ตุลาคม': 10, 'ตุลา': 10, 'ตค': 10,
    'พฤศจิกายน': 11, 'พฤศจิกา': 11, 'พย': 11,
    'ธันวาคม': 12, 'ธันวา': 12, 'ธค': 12
  };
  var monthPattern = '(มกราคม|มกรา|ม\\.?\\s*ค\\.?|กุมภาพันธ์|กุมภา|ก\\.?\\s*พ\\.?|มีนาคม|มีนา|มี\\.?\\s*ค\\.?|เมษายน|เมษา|เม\\.?\\s*ย\\.?|พฤษภาคม|พฤษภา|พ\\.?\\s*ค\\.?|มิถุนายน|มิถุนา|มิ\\.?\\s*ย\\.?|กรกฎาคม|กรกฎา|ก\\.?\\s*ค\\.?|สิงหาคม|สิงหา|ส\\.?\\s*ค\\.?|กันยายน|กันยา|ก\\.?\\s*ย\\.?|ตุลาคม|ตุลา|ต\\.?\\s*ค\\.?|พฤศจิกายน|พฤศจิกา|พ\\.?\\s*ย\\.?|ธันวาคม|ธันวา|ธ\\.?\\s*ค\\.?)';
  var resolveMonth = function(rawM) {
    return thaiMonthMap[String(rawM || '').replace(/[\s\.]/g, '')] || 0;
  };

  // 1. Explicit ISO range / single ISO YYYY-MM-DD
  var isoRangeRe = /(\d{4})-(\d{1,2})-(\d{1,2})\s*(?:-|–|—|ถึง)\s*(\d{4})-(\d{1,2})-(\d{1,2})/;
  var isoRM = txt.match(isoRangeRe);
  if (isoRM) {
    return rangeResult(
      makeYmd(normalizeYear(isoRM[1], baseYear), Number(isoRM[2]), Number(isoRM[3])),
      makeYmd(normalizeYear(isoRM[4], baseYear), Number(isoRM[5]), Number(isoRM[6])),
      ''
    );
  }
  var isoM = txt.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoM) {
    return singleResult(makeYmd(normalizeYear(isoM[1], baseYear), Number(isoM[2]), Number(isoM[3])), '');
  }

  // 2. Explicit Thai month date range: "20-23 พ.ย.", "28 พ.ย. - 2 ธ.ค. 69", "วันที่ 20 ถึง 23 พ.ย."
  var tmCrossRe = new RegExp('(?:ที่\\s*)?(\\d{1,2})\\s*' + monthPattern + '(?:\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{2,4})(?!\\s*[:.]\\d|\\s*น\\.))?\\s*(?:-|–|—|ถึง)\\s*(?:ที่\\s*)?(\\d{1,2})\\s*' + monthPattern + '(?:\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{2,4})(?!\\s*[:.]\\d|\\s*น\\.))?');
  var tmCross = txt.match(tmCrossRe);
  if (tmCross) {
    var cd1 = Number(tmCross[1]), cm1 = resolveMonth(tmCross[2]), cy1 = normalizeYear(tmCross[3], baseYear);
    var cd2 = Number(tmCross[4]), cm2 = resolveMonth(tmCross[5]), cy2 = normalizeYear(tmCross[6], cy1);
    if (cm1 && cm2 && cd1 >= 1 && cd1 <= 31 && cd2 >= 1 && cd2 <= 31) {
      return rangeResult(makeYmd(cy1, cm1, cd1), makeYmd(cy2, cm2, cd2), '');
    }
  }
  var tmSameRe = new RegExp('(?:ที่\\s*)?(\\d{1,2})\\s*(?:-|–|—|ถึง)\\s*(\\d{1,2})\\s*' + monthPattern + '(?:\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{2,4})(?!\\s*[:.]\\d|\\s*น\\.))?');
  var tmSame = txt.match(tmSameRe);
  if (tmSame) {
    var sd1 = Number(tmSame[1]), sd2 = Number(tmSame[2]), smm = resolveMonth(tmSame[3]), syy = normalizeYear(tmSame[4], baseYear);
    if (smm && sd1 >= 1 && sd1 <= 31 && sd2 >= 1 && sd2 <= 31) {
      return rangeResult(makeYmd(syy, smm, sd1), makeYmd(syy, smm, sd2), '');
    }
  }

  // 3. Explicit Single Thai month date: "23 พ.ย.", "23 พ.ย. 69", "23 พฤศจิกายน พ.ศ. 2569"
  var tmSingleRe = new RegExp('(?:ที่\\s*)?(\\d{1,2})\\s*' + monthPattern + '(?:\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{2,4})(?!\\s*[:.]\\d|\\s*น\\.))?');
  var tmMatch = txt.match(tmSingleRe);
  if (tmMatch) {
    var td = Number(tmMatch[1]);
    var tm = resolveMonth(tmMatch[2]);
    if (tm && td >= 1 && td <= 31) {
      var ty = normalizeYear(tmMatch[3], baseYear);
      return singleResult(makeYmd(ty, tm, td), '');
    }
  }

  // 4. Numeric DD/MM(/YYYY) range & single, plus DD.MM.YYYY
  var slashRangeM = txt.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\s*(?:-|–|—|ถึง)\s*(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (slashRangeM) {
    var rsd1 = Number(slashRangeM[1]), rsm1 = Number(slashRangeM[2]), rsy1 = normalizeYear(slashRangeM[3], baseYear);
    var rsd2 = Number(slashRangeM[4]), rsm2 = Number(slashRangeM[5]), rsy2 = normalizeYear(slashRangeM[6], rsy1);
    if (rsd1 >= 1 && rsd1 <= 31 && rsm1 >= 1 && rsm1 <= 12 && rsd2 >= 1 && rsd2 <= 31 && rsm2 >= 1 && rsm2 <= 12) {
      return rangeResult(makeYmd(rsy1, rsm1, rsd1), makeYmd(rsy2, rsm2, rsd2), '');
    }
  }
  var slashM = txt.match(/(?:ที่\s*)?(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (slashM) {
    var sd = Number(slashM[1]), sm = Number(slashM[2]);
    if (sd >= 1 && sd <= 31 && sm >= 1 && sm <= 12) {
      var sy = normalizeYear(slashM[3], baseYear);
      return singleResult(makeYmd(sy, sm, sd), '');
    }
  }
  var dotM = txt.match(/(?:ที่\s*)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (dotM) {
    var dd1 = Number(dotM[1]), dm1 = Number(dotM[2]), dy1 = normalizeYear(dotM[3], baseYear);
    if (dd1 >= 1 && dd1 <= 31 && dm1 >= 1 && dm1 <= 12) {
      return singleResult(makeYmd(dy1, dm1, dd1), '');
    }
  }

  // 5. Relative single days & numeric/word offsets
  if (txt.indexOf('เมื่อวานซืน') !== -1 || txt.indexOf('วานซืน') !== -1) {
    return singleResult(addDaysIsoGas_(todayYmd, -2), 'เมื่อวานซืน');
  }
  if (txt.indexOf('เมื่อวาน') !== -1 || txt.indexOf('วานนี้') !== -1) {
    return singleResult(addDaysIsoGas_(todayYmd, -1), 'เมื่อวาน');
  }
  if (txt.indexOf('มะเรื่อง') !== -1) {
    return singleResult(addDaysIsoGas_(todayYmd, 3), 'มะเรื่อง');
  }
  if (txt.indexOf('มะรืน') !== -1) {
    return singleResult(addDaysIsoGas_(todayYmd, 2), 'มะรืนนี้');
  }
  if (txt.indexOf('พรุ่งนี้') !== -1 || txt.indexOf('พรุ้งนี้') !== -1) {
    return singleResult(addDaysIsoGas_(todayYmd, 1), 'พรุ่งนี้');
  }
  if (txt.indexOf('วันนี้') !== -1) {
    return singleResult(todayYmd, 'วันนี้');
  }

  var thaiNumWords = {
    'หนึ่ง': 1, 'สอง': 2, 'สาม': 3, 'สี่': 4, 'ห้า': 5,
    'หก': 6, 'เจ็ด': 7, 'แปด': 8, 'เก้า': 9, 'สิบ': 10
  };
  var parseCountWord = function(w) {
    if (!w) return 0;
    if (/^\d+$/.test(w)) return Number(w);
    return thaiNumWords[w] || 0;
  };
  var pastDaysM = txt.match(/(\d+|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*(?:วันก่อน|วันที่แล้ว)/);
  if (pastDaysM) {
    var pn = parseCountWord(pastDaysM[1]);
    if (pn > 0 && pn <= 90) return singleResult(addDaysIsoGas_(todayYmd, -pn), pn + ' วันที่แล้ว');
  }
  var fwdDaysM = txt.match(/(?:อีก\s*(\d+|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*วัน|(\d+|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ)\s*วันข้างหน้า)/);
  if (fwdDaysM) {
    var fn = parseCountWord(fwdDaysM[1] || fwdDaysM[2]);
    if (fn > 0 && fn <= 90) return singleResult(addDaysIsoGas_(todayYmd, fn), 'อีก ' + fn + ' วัน');
  }

  // Normalize "วันอาทิตย์" before distinguishing week-meaning "อาทิตย์นี้/หน้า/ที่แล้ว/ที่ผ่านมา"
  var txtMarked = txt.replace(/วัน\s*อาทิตย์/g, 'วัน__sun__');
  var hasLastWeekMod = /(?:สัปดาห์ที่แล้ว|สัปดาห์ที่ผ่านมา|สัปดาห์ก่อน|อาทิตย์ที่แล้ว|อาทิตย์ที่ผ่านมา|อาทิตย์ก่อน|วีคที่แล้ว|วีคก่อน)/.test(txtMarked);
  var hasNextWeekMod = /(?:สัปดาห์หน้า|สัปดาห์ถัดไป|อาทิตย์หน้า|อาทิตย์ถัดไป|วีคหน้า)/.test(txtMarked);
  var hasThisWeekMod = /(?:สัปดาห์นี้|อาทิตย์นี้|วีคนี้)/.test(txtMarked);
  var hasPastMod = /(?:ที่ผ่านมา|ที่แล้ว|ก่อนหน้า|ก่อนนี้|เมื่อวัน|ล่าสุด)/.test(txt) || /(?:^|\s)เมื่อ/.test(txt);
  var hasFutureMod = /(?:หน้า|ถัดไป|ที่จะถึง|ข้างหน้า)/.test(txt);

  // 6. Thai weekdays (handles "วันศุกร์ที่ผ่านมา", "เมื่อวันจันทร์", "วันจันทร์หน้า", "วันพุธสัปดาห์ที่แล้ว", etc.)
  var weekdayRules = [
    { kw: 'วัน__sun__', dow: 0 },
    { kw: 'จันทร์', dow: 1 },
    { kw: 'อังคาร', dow: 2 },
    { kw: 'พุธ', dow: 3 },
    { kw: 'พฤหัส', dow: 4 },
    { kw: 'ศุกร์', dow: 5 },
    { kw: 'เสาร์', dow: 6 }
  ];
  for (var wi = 0; wi < weekdayRules.length; wi++) {
    if (txtMarked.indexOf(weekdayRules[wi].kw) !== -1) {
      var targetDow = weekdayRules[wi].dow;
      if (hasLastWeekMod) {
        var monOffsetBack = (curDow === 0 ? -6 : 1 - curDow) - 7;
        var dayInWeek = (targetDow === 0 ? 6 : targetDow - 1);
        return singleResult(addDaysIsoGas_(todayYmd, monOffsetBack + dayInWeek), '');
      }
      if (hasNextWeekMod) {
        var monOffsetFwd = (curDow === 0 ? -6 : 1 - curDow) + 7;
        var dayInWeekFwd = (targetDow === 0 ? 6 : targetDow - 1);
        return singleResult(addDaysIsoGas_(todayYmd, monOffsetFwd + dayInWeekFwd), '');
      }
      if (hasPastMod) {
        var backDiff = (curDow - targetDow + 7) % 7;
        if (backDiff === 0) backDiff = 7;
        return singleResult(addDaysIsoGas_(todayYmd, -backDiff), '');
      }
      if (hasFutureMod) {
        var fwdDiff = (targetDow - curDow + 7) % 7;
        if (fwdDiff === 0) fwdDiff = 7;
        return singleResult(addDaysIsoGas_(todayYmd, fwdDiff), '');
      }
      var defaultDiff = (targetDow - curDow + 7) % 7;
      return singleResult(addDaysIsoGas_(todayYmd, defaultDiff), '');
    }
  }

  // Helper for relative month shifts ("เดือนหน้า", "เดือนที่แล้ว")
  var targetMonthOffset = 0;
  if (/เดือนที่แล้ว|เดือนที่ผ่านมา|เดือนก่อน/.test(txt)) targetMonthOffset = -1;
  else if (/เดือนหน้า|เดือนถัดไป/.test(txt)) targetMonthOffset = 1;
  var shiftedDt = new Date(Date.UTC(baseYear, baseMonth - 1 + targetMonthOffset, 1));
  var effYear = shiftedDt.getUTCFullYear();
  var effMonth = shiftedDt.getUTCMonth() + 1;

  // 7. Day-of-month range or single day number: e.g. "วันที่ 20-23", "วันที่ 5 เดือนหน้า", "วันที่ 23"
  var dayRangeM = txt.match(/(?:วันที่|ที่)\s*(\d{1,2})\s*(?:-|–|—|ถึง)\s*(\d{1,2})(?!\d)/);
  if (dayRangeM) {
    var dr1 = Number(dayRangeM[1]), dr2 = Number(dayRangeM[2]);
    if (dr1 >= 1 && dr1 <= 31 && dr2 >= 1 && dr2 <= 31) {
      return rangeResult(makeYmd(effYear, effMonth, dr1), makeYmd(effYear, effMonth, dr2), '');
    }
  }
  var dayOnlyM = txt.match(/(?:วันที่|ที่)\s*(\d{1,2})(?!\d)/);
  if (dayOnlyM) {
    var dd = Number(dayOnlyM[1]);
    if (dd >= 1 && dd <= 31) {
      return singleResult(makeYmd(effYear, effMonth, dd), '');
    }
  }

  // 8. Whole Week queries ("สัปดาห์นี้", "อาทิตย์ที่ผ่านมา", "สัปดาห์หน้า", etc.)
  if (hasLastWeekMod) {
    var lwMon = addDaysIsoGas_(todayYmd, (curDow === 0 ? -6 : 1 - curDow) - 7);
    return rangeResult(lwMon, addDaysIsoGas_(lwMon, 6), 'สัปดาห์ที่ผ่านมา');
  }
  if (hasNextWeekMod) {
    var nwMon = addDaysIsoGas_(todayYmd, (curDow === 0 ? -6 : 1 - curDow) + 7);
    return rangeResult(nwMon, addDaysIsoGas_(nwMon, 6), 'สัปดาห์หน้า');
  }
  if (hasThisWeekMod) {
    var twMon = addDaysIsoGas_(todayYmd, curDow === 0 ? -6 : 1 - curDow);
    return rangeResult(twMon, addDaysIsoGas_(twMon, 6), 'สัปดาห์นี้');
  }

  // 9. Whole Month queries ("เดือนนี้", "เดือนที่แล้ว", "เดือนหน้า", "เดือน พ.ย.", "เดือนพฤศจิกายน 2569")
  var explicitMonthRe = new RegExp('(?:เดือน\\s*)' + monthPattern + '(?:\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{2,4}))?');
  var expMM = txt.match(explicitMonthRe);
  if (expMM) {
    var em = resolveMonth(expMM[1]);
    if (em) {
      var ey = normalizeYear(expMM[2], baseYear);
      return rangeResult(makeYmd(ey, em, 1), makeYmd(ey, em, lastDayOfMonth(ey, em)), '');
    }
  }
  if (/เดือนนี้|เดือนที่แล้ว|เดือนที่ผ่านมา|เดือนก่อน|เดือนหน้า|เดือนถัดไป/.test(txt)) {
    var mLabel = targetMonthOffset < 0 ? 'เดือนที่ผ่านมา' : targetMonthOffset > 0 ? 'เดือนหน้า' : 'เดือนนี้';
    return rangeResult(makeYmd(effYear, effMonth, 1), makeYmd(effYear, effMonth, lastDayOfMonth(effYear, effMonth)), mLabel);
  }

  return singleResult(todayYmd, 'วันนี้', true);
}

function fetchLineSenderNameGas_(token, evSource) {
  if (!token || !evSource || !evSource.userId) return 'สมาชิกกลุ่ม';
  try {
    var uid = String(evSource.userId).trim();
    var gid = String(evSource.groupId || '').trim();
    var url = gid
      ? ('https://api.line.me/v2/bot/group/' + encodeURIComponent(gid) + '/member/' + encodeURIComponent(uid))
      : ('https://api.line.me/v2/bot/profile/' + encodeURIComponent(uid));
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    });
    if (res.getResponseCode() === 200) {
      var data = JSON.parse(res.getContentText() || '{}');
      if (data.displayName) return String(data.displayName).trim();
    }
  } catch (e) {
    // ignore profile fetch errors
  }
  return 'สมาชิกกลุ่ม';
}

function detectGroupNoteCategoryGas_(content) {
  var c = String(content || '').toLowerCase();
  if (/ลงนัด|นัดหมาย|ตารางนัด|มีนัด|นัดประชุม|เตือนความจำ|เตือนให้|reminder/.test(c)) return 'นัดหมาย/เตือนความจำ';
  if (/สั่งงาน|งานค้าง|มอบหมาย|action item|to-do|todo/.test(c)) return 'งานที่ต้องทำ/To-Do';
  if (/สลับเวร|อยู่เวร|ตารางเวร|นอกเวลา|\bot\b|โอที/.test(c)) return 'ตารางเวร/สลับเวร';
  if (/ข้อตกลง|มติ|กติกา|เงื่อนไข|ตกลงตาม/.test(c)) return 'ข้อตกลง/มติ';
  if (/ประกาศ|แจ้งเวียน|ประชุม|ปิดบริการ|งดตรวจ|วันหยุด/.test(c)) return 'ประกาศ/แจ้งเวียน';
  return 'บันทึกช่วยจำ';
}

function extractNoteKeywordsGas_(content) {
  var tokens = String(content || '').toLowerCase().replace(/[^\u0E00-\u0E7Fa-z0-9\s]/g, ' ').split(/\s+/).filter(function(t) {
    return t.length >= 2;
  });
  var uniq = [];
  tokens.forEach(function(t) {
    if (uniq.indexOf(t) === -1 && uniq.length < 15) uniq.push(t);
  });
  return uniq.join(', ');
}

function saveLineGroupNoteGas_(content, savedBy, groupId, explicitCategory, isPrivateScope) {
  var headers = ['Note_ID', 'Timestamp', 'Category', 'Content', 'Saved_By', 'Group_ID', 'Keywords', 'Status'];
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.GROUP_NOTES, headers);
  var nowTs = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
  var idTag = 'N-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMMdd-HHmm') + '-' + String(Math.floor(10 + Math.random() * 89));
  var baseCat = explicitCategory || detectGroupNoteCategoryGas_(content);
  var category = isPrivateScope && baseCat.indexOf('[ส่วนตัว]') === -1 ? ('[ส่วนตัว] ' + baseCat) : baseCat;
  var storedGroupId = String(groupId || '').trim();
  if (isPrivateScope && storedGroupId.indexOf('PRIVATE:') !== 0) {
    storedGroupId = 'PRIVATE:' + storedGroupId;
  }
  var keywords = extractNoteKeywordsGas_(content);
  var row = [idTag, nowTs, category, String(content || '').trim(), String(savedBy || 'สมาชิกกลุ่ม'), storedGroupId, keywords, 'ACTIVE'];
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  SpreadsheetApp.flush();
  return { id: idTag, timestamp: nowTs, category: category, content: row[3], savedBy: row[4], groupId: storedGroupId };
}

function readActiveGroupNotesGas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.GROUP_NOTES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  var vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getValues();
  var list = [];
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var status = String(r[7] || 'ACTIVE').trim().toUpperCase();
    var content = String(r[3] || '').trim();
    if (!content || status === 'ARCHIVED' || status === 'DELETED' || status === 'DONE') continue;
    list.push({
      rowNumber: i + 2,
      id: String(r[0] || '').trim(),
      timestamp: String(r[1] || '').trim(),
      category: String(r[2] || 'บันทึกช่วยจำ').trim(),
      content: content,
      savedBy: String(r[4] || 'สมาชิกกลุ่ม').trim(),
      groupId: String(r[5] || '').trim(),
      keywords: String(r[6] || '').trim(),
      status: status
    });
  }
  return list;
}

function isPrivateNoteRecordGas_(n) {
  if (!n) return false;
  return String(n.groupId || '').indexOf('PRIVATE:') === 0 || String(n.category || '').indexOf('[ส่วนตัว]') !== -1;
}

function readVisibleNotesForEventGas_(isGroupChat, userId) {
  var all = readActiveGroupNotesGas_();
  var uid = String(userId || '').trim();
  return all.filter(function(n) {
    var priv = isPrivateNoteRecordGas_(n);
    if (isGroupChat) {
      return !priv;
    }
    if (!priv) return true;
    var gid = String(n.groupId || '').trim();
    if (gid === 'PRIVATE:' || gid === 'PRIVATE') return true;
    return uid ? gid === ('PRIVATE:' + uid) : false;
  });
}

function archiveGroupNotesGas_(queryOrId, scopedList, targetStatus) {
  var active = Array.isArray(scopedList) ? scopedList : readActiveGroupNotesGas_();
  if (active.length === 0) return { archived: [], count: 0 };
  var q = String(queryOrId || '').trim().toLowerCase();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.GROUP_NOTES);
  var newStatus = targetStatus || 'ARCHIVED';
  var targets = [];

  if (!q || q === 'ล่าสุด' || q === 'ข้อล่าสุด') {
    targets.push(active[active.length - 1]);
  } else if (/^#?\d{1,3}$/.test(q)) {
    var idx = Number(q.replace('#', '')) - 1;
    if (idx >= 0 && idx < active.length) targets.push(active[idx]);
  } else {
    var cleanQ = q.replace(/^#/, '');
    for (var i = 0; i < active.length; i++) {
      var n = active[i];
      if (n.id.toLowerCase() === cleanQ || n.content.toLowerCase().indexOf(cleanQ) !== -1) {
        targets.push(n);
      }
    }
  }
  targets.forEach(function(t) {
    sheet.getRange(t.rowNumber, 8).setValue(newStatus);
  });
  if (targets.length > 0) SpreadsheetApp.flush();
  return { archived: targets, count: targets.length };
}

function formatBoobyPersonaReplyGas_(rawText, speakerCall, addClosingWit) {
  var txt = String(rawText || '').trim();
  if (!txt) return '';
  var lines = txt.split('\n');
  var outLines = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*$/.test(line)) continue;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      var cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(function(c) { return c.trim(); }).filter(Boolean);
      if (cells.length > 0) outLines.push('• ' + cells.join(' — '));
      continue;
    }
    outLines.push(line);
  }
  var cleaned = outLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (addClosingWit && cleaned.length > 60 && cleaned.indexOf('☕') === -1 && cleaned.indexOf('✨ หาก') === -1) {
    var closingOffers = [
      '\n\n☕ หากต้องการให้บูบี้ช่วยจัดทำรายงาน หรือดำเนินการเพิ่มเติมในจุดใด แจ้งได้เลยนะครับ',
      '\n\n✨ หากมีข้อมูลส่วนใดให้บูบี้ช่วยกลั่นกรองเพิ่มเติม บอกได้ทุกเมื่อเลยครับ',
      '\n\n🎩 หากต้องการให้สรุปส่งเข้าที่ประชุมหรือปรับแก้จุดใด แจ้งบูบี้ได้ทันทีครับ'
    ];
    var pickIdx = (cleaned.length + (speakerCall ? speakerCall.length : 0)) % closingOffers.length;
    cleaned += closingOffers[pickIdx];
  }
  return cleaned;
}

function stripThaiHonorificsGas_(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/^(?:นางสาว|นาง|นาย|น\.ส\.|ดร\.|ผศ\.|รศ\.|ศ\.|พว\.|นพ\.|พญ\.|ทพ\.|ภก\.|คุณ|พี่|น้อง|หัวหน้า)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStaffMatchesGas_(txt, staffRows, leaveRows, lOff, otRows, oOff) {
  var normTxt = String(txt || '').toLowerCase().replace(/\s+/g, ' ');
  var stopTokens = {
    'ลา': 1, 'วัน': 1, 'คน': 1, 'งาน': 1, 'เวร': 1, 'คลินิก': 1, 'ห้อง': 1, 'ตรวจ': 1,
    'วันนี้': 1, 'พรุ่งนี้': 1, 'เมื่อวาน': 1, 'เดือน': 1, 'สัปดาห์': 1, 'อาทิตย์': 1,
    'ใคร': 1, 'บ้าง': 1, 'ไหน': 1, 'เท่าไหร่': 1, 'กี่คน': 1, 'อายุรกรรม': 1, 'ศัลยกรรม': 1,
    'กุมารเวชกรรม': 1, 'จักษุวิทยา': 1, 'ทั่วไป': 1, 'คัดกรอง': 1, 'พยาบาล': 1, 'ผู้ช่วย': 1
  };
  var directoryMap = {};
  var addPerson = function(name, pos, clinic, status, empCode) {
    var clean = String(name || '').trim();
    if (!clean) return;
    if (!directoryMap[clean]) {
      directoryMap[clean] = {
        name: clean,
        pos: String(pos || '').trim(),
        clinic: String(clinic || '').trim(),
        status: String(status || 'Active').trim(),
        empCode: String(empCode || '').trim()
      };
    } else {
      if (!directoryMap[clean].pos && pos) directoryMap[clean].pos = String(pos).trim();
      if (!directoryMap[clean].clinic && clinic) directoryMap[clean].clinic = String(clinic).trim();
      if (!directoryMap[clean].empCode && empCode) directoryMap[clean].empCode = String(empCode).trim();
    }
  };
  for (var si = 0; si < staffRows.length; si++) {
    var sr = staffRows[si];
    addPerson(sr[1], sr[2], sr[3], sr[4], sr[7]);
  }
  for (var li = 0; li < leaveRows.length; li++) {
    var lr = leaveRows[li];
    addPerson(lr[lOff + 2], lr[lOff + 3], lr[lOff + 4], 'Active', '');
  }
  for (var oi = 0; oi < otRows.length; oi++) {
    var orow = otRows[oi];
    addPerson(orow[oOff + 2], orow[oOff + 3], orow[oOff + 4] || orow[oOff + 5], 'Active', orow[oOff + 7]);
  }

  var matches = [];
  var fullNames = Object.keys(directoryMap);
  for (var fi = 0; fi < fullNames.length; fi++) {
    var full = fullNames[fi];
    var stripped = stripThaiHonorificsGas_(full);
    if (stripped.length >= 2 && normTxt.indexOf(stripped) !== -1) {
      matches.push({ staff: directoryMap[full], score: stripped.length + 100 });
      continue;
    }
    var parts = stripped.split(/\s+/).filter(function(tk) {
      return tk.length >= 2 && !stopTokens[tk];
    });
    for (var pi = 0; pi < parts.length; pi++) {
      var tk = parts[pi];
      if (normTxt.indexOf(tk) !== -1) {
        matches.push({ staff: directoryMap[full], score: tk.length });
        break;
      }
    }
  }
  matches.sort(function(a, b) { return b.score - a.score; });
  return {
    matchedStaff: matches.map(function(m) { return m.staff; }),
    directoryCount: fullNames.length,
    directoryList: fullNames.map(function(k) { return directoryMap[k]; })
  };
}

function extractCandidatePersonBeforeQueryGas_(rawTxt) {
  var cleaned = String(rawTxt || '')
    .trim()
    .replace(/^@?บูบี้\s*/i, '')
    .replace(/^(?:ช่วยเช็ค|ช่วยดู|เช็ค|สอบถาม|ถามหน่อย|อยากรู้ว่า|ดูให้หน่อยว่า)\s*/i, '')
    .replace(/^(?:นาย|นางสาว|นาง|น\.ส\.|พว\.|นพ\.|พญ\.|คุณ|พี่|น้อง)\s*/i, '')
    .trim();
  var m = cleaned.match(/^([\u0E00-\u0E7Fa-zA-Z\.]{2,30}(?:\s+[\u0E00-\u0E7Fa-zA-Z\.]{2,30})?)\s+(?:ลา|อยู่\s*ot|ขึ้นเวร|อยู่เวร|อยู่คลินิก|ตำแหน่ง|รหัส|เบิก|มี\s*ot)/i);
  if (!m) return '';
  var cand = String(m[1] || '').trim();
  if (/^(?:ใคร|วัน|พรุ่งนี้|วันนี้|เมื่อวาน|มะรืน|สัปดาห์|อาทิตย์|เดือน|คลินิก|ห้อง|ทั้งหมด|สรุป|ยอด|ช่วย|ที่|มี|ทำไม|หรือ)$/i.test(cand)) return '';
  return cand;
}

function parseWorkloadMetaGas_(rawNote) {
  var noteStr = String(rawNote || '').trim();
  var referralData = null;
  var refM = noteStr.match(/\[\[REFERRAL_JSON:([\s\S]*?)\]\]/);
  if (refM) {
    try { referralData = JSON.parse(refM[1]); } catch (e) { referralData = null; }
  }
  var isOffDuty = false;
  var offDutyReason = '';
  var offM = noteStr.match(/\[\[OFF_DUTY_JSON:([\s\S]*?)\]\]/);
  if (offM) {
    isOffDuty = true;
    try {
      var po = JSON.parse(offM[1]);
      if (po && (po.r || po.reason)) offDutyReason = String(po.r || po.reason).trim();
    } catch (e2) {}
  }
  var offDutyStaff = [];
  var osM = noteStr.match(/\[\[OFF_STAFF_JSON:([\s\S]*?)\]\]/);
  if (osM) {
    try {
      var arr = JSON.parse(osM[1]);
      if (Array.isArray(arr)) {
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i];
          if (it && (it.staffName || it.n)) {
            offDutyStaff.push({
              staffName: String(it.staffName || it.n || '').trim(),
              position: String(it.position || it.p || 'RN').trim(),
              amount: Number(it.amount !== undefined ? it.amount : it.a) === 0.5 ? 0.5 : 1,
              periodLabel: String(it.periodLabel || it.l || '').trim(),
              reason: String(it.reason || it.r || '').trim()
            });
          }
        }
      }
    } catch (e3) {}
  }
  return {
    referralData: referralData,
    isOffDuty: isOffDuty,
    offDutyReason: offDutyReason,
    offDutyStaff: offDutyStaff
  };
}

function getThaiHolidayDetailsForYearGas_(ceYear, customHolidaysList) {
  var fixedNamed = [
    ['01-01', 'วันขึ้นปีใหม่'],
    ['04-06', 'วันจักรี'],
    ['04-13', 'วันสงกรานต์'],
    ['04-14', 'วันสงกรานต์'],
    ['04-15', 'วันสงกรานต์'],
    ['05-04', 'วันฉัตรมงคล'],
    ['06-03', 'วันเฉลิมพระชนมพรรษา พระบรมราชินี'],
    ['07-28', 'วันเฉลิมพระชนมพรรษา ในหลวง ร.10'],
    ['08-12', 'วันแม่แห่งชาติ'],
    ['10-13', 'วันนวมินทรมหาราช'],
    ['10-23', 'วันปิยมหาราช'],
    ['12-05', 'วันพ่อแห่งชาติ / วันชาติ'],
    ['12-10', 'วันรัฐธรรมนูญ'],
    ['12-31', 'วันสิ้นปี']
  ];
  var lunarNamedByYear = {
    2024: [
      { date: '2024-02-24', name: 'วันมาฆบูชา' },
      { date: '2024-05-10', name: 'วันพืชมงคล', noSub: true },
      { date: '2024-05-22', name: 'วันวิสาขบูชา' },
      { date: '2024-07-20', name: 'วันอาสาฬหบูชา' },
      { date: '2024-07-21', name: 'วันเข้าพรรษา' }
    ],
    2025: [
      { date: '2025-02-12', name: 'วันมาฆบูชา' },
      { date: '2025-05-09', name: 'วันพืชมงคล', noSub: true },
      { date: '2025-05-11', name: 'วันวิสาขบูชา' },
      { date: '2025-07-10', name: 'วันอาสาฬหบูชา' },
      { date: '2025-07-11', name: 'วันเข้าพรรษา' }
    ],
    2026: [
      { date: '2026-03-03', name: 'วันมาฆบูชา' },
      { date: '2026-05-13', name: 'วันพืชมงคล', noSub: true },
      { date: '2026-05-31', name: 'วันวิสาขบูชา' },
      { date: '2026-07-29', name: 'วันอาสาฬหบูชา' },
      { date: '2026-07-30', name: 'วันเข้าพรรษา' }
    ],
    2027: [
      { date: '2027-02-21', name: 'วันมาฆบูชา' },
      { date: '2027-05-20', name: 'วันวิสาขบูชา' },
      { date: '2027-07-18', name: 'วันอาสาฬหบูชา' },
      { date: '2027-07-19', name: 'วันเข้าพรรษา' }
    ],
    2028: [
      { date: '2028-02-10', name: 'วันมาฆบูชา' },
      { date: '2028-05-08', name: 'วันวิสาขบูชา' },
      { date: '2028-07-06', name: 'วันอาสาฬหบูชา' },
      { date: '2028-07-07', name: 'วันเข้าพรรษา' }
    ]
  };
  var map = {};
  var pendingSubs = [];
  for (var i = 0; i < fixedNamed.length; i++) {
    var md = fixedNamed[i][0];
    var hName = fixedNamed[i][1];
    var iso = ceYear + '-' + md;
    var p = iso.split('-');
    var dow = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay();
    map[iso] = { name: hName, isCustom: false };
    if (dow === 0 || dow === 6) pendingSubs.push({ iso: iso, name: 'วันหยุดชดเชย' + hName });
  }
  var prevDecDow = new Date(Date.UTC(ceYear - 1, 11, 31)).getUTCDay();
  if (prevDecDow === 0 || prevDecDow === 6) {
    pendingSubs.push({ iso: (ceYear - 1) + '-12-31', name: 'วันหยุดชดเชยวันสิ้นปี' });
  }
  var lunList = lunarNamedByYear[ceYear] || [];
  for (var li = 0; li < lunList.length; li++) {
    var lItem = lunList[li];
    var lp = lItem.date.split('-');
    var lDow = new Date(Date.UTC(Number(lp[0]), Number(lp[1]) - 1, Number(lp[2]))).getUTCDay();
    map[lItem.date] = { name: lItem.name, isCustom: false };
    if (!lItem.noSub && (lDow === 0 || lDow === 6)) {
      pendingSubs.push({ iso: lItem.date, name: 'วันหยุดชดเชย' + lItem.name });
    }
  }
  for (var si = 0; si < pendingSubs.length; si++) {
    var sub = pendingSubs[si];
    var cursor = addDaysIsoGas_(sub.iso, 1);
    for (var g = 0; g < 14; g++) {
      var cp = cursor.split('-');
      var cDow = new Date(Date.UTC(Number(cp[0]), Number(cp[1]) - 1, Number(cp[2]))).getUTCDay();
      if (cDow !== 0 && cDow !== 6 && !map[cursor]) {
        if (Number(cp[0]) === ceYear) map[cursor] = { name: sub.name, isCustom: false };
        break;
      }
      cursor = addDaysIsoGas_(cursor, 1);
    }
  }
  for (var ci = 0; ci < (customHolidaysList || []).length; ci++) {
    var ch = customHolidaysList[ci];
    var dNorm = normalizeSheetDateGas_(ch && ch.date);
    if (dNorm && dNorm.indexOf(String(ceYear) + '-') === 0) {
      map[dNorm] = { name: String((ch && ch.name) || 'วันหยุดพิเศษ รพ.').trim(), isCustom: true };
    }
  }
  return map;
}

function extractClinicMatchGas_(txt, settingsMap) {
  var q = String(txt || '').toLowerCase();
  var aliases = [
    { kw: 'ศูนย์ปัญญาภิรมย์', target: 'ศูนย์ปัญญาภิรมย์' },
    { kw: 'ปัญญาภิรมย์', target: 'ศูนย์ปัญญาภิรมย์' },
    { kw: 'พรีเมียม', target: 'ศูนย์ปัญญาภิรมย์' },
    { kw: 'premium', target: 'ศูนย์ปัญญาภิรมย์' },
    { kw: 'ศูนย์รับ - ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
    { kw: 'ศูนย์รับ-ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
    { kw: 'ห้องรับ-ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
    { kw: 'รับ - ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
    { kw: 'รับ-ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
    { kw: 'ศูนย์รับส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
    { kw: 'ส่งต่อ', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
    { kw: 'refer', target: 'ศูนย์รับ - ส่งต่อผู้ป่วย' },
    { kw: 'ศัลยกรรมกระดูก', target: 'ศัลยกรรมกระดูก' },
    { kw: 'ออร์โธ', target: 'ศัลยกรรมกระดูก' },
    { kw: 'ortho', target: 'ศัลยกรรมกระดูก' },
    { kw: 'กระดูก', target: 'ศัลยกรรมกระดูก' },
    { kw: 'เวชศาสตร์ฟื้นฟู', target: 'เวชศาสตร์ฟื้นฟู' },
    { kw: 'ฟื้นฟู', target: 'เวชศาสตร์ฟื้นฟู' },
    { kw: 'กายภาพ', target: 'เวชศาสตร์ฟื้นฟู' },
    { kw: 'สูติ-นรีเวชกรรม', target: 'สูติ-นรีเวชกรรม' },
    { kw: 'สูติ', target: 'สูติ-นรีเวชกรรม' },
    { kw: 'นรีเวช', target: 'สูติ-นรีเวชกรรม' },
    { kw: 'กุมารเวชกรรม', target: 'กุมารเวชกรรม' },
    { kw: 'กุมาร', target: 'กุมารเวชกรรม' },
    { kw: 'คลินิกเด็ก', target: 'กุมารเวชกรรม' },
    { kw: 'ตรวจโรคทั่วไป', target: 'ตรวจโรคทั่วไป' },
    { kw: 'ตรวจโรค', target: 'ตรวจโรคทั่วไป' },
    { kw: 'gp', target: 'ตรวจโรคทั่วไป' },
    { kw: 'โสต ศอ นาสิก', target: 'โสต ศอ นาสิก' },
    { kw: 'หูคอจมูก', target: 'โสต ศอ นาสิก' },
    { kw: 'หู คอ จมูก', target: 'โสต ศอ นาสิก' },
    { kw: 'โสต', target: 'โสต ศอ นาสิก' },
    { kw: 'ent', target: 'โสต ศอ นาสิก' },
    { kw: 'ศูนย์เลสิก', target: 'ศูนย์เลสิก' },
    { kw: 'เลสิก', target: 'ศูนย์เลสิก' },
    { kw: 'จักษุวิทยา', target: 'จักษุวิทยา' },
    { kw: 'จักษุ', target: 'จักษุวิทยา' },
    { kw: 'คลินิกตา', target: 'จักษุวิทยา' },
    { kw: 'อายุรกรรม', target: 'อายุรกรรม' },
    { kw: 'อายุร', target: 'อายุรกรรม' },
    { kw: 'ศัลยกรรม', target: 'ศัลยกรรม' },
    { kw: 'ศัลย์', target: 'ศัลยกรรม' },
    { kw: 'หน่วยคัดกรอง', target: 'หน่วยคัดกรอง' },
    { kw: 'คัดกรอง', target: 'หน่วยคัดกรอง' },
    { kw: 'ประกันสังคม', target: 'ประกันสังคม' },
    { kw: 'คลินิกหัวใจ', target: 'คลินิกหัวใจ' },
    { kw: 'หัวใจ', target: 'คลินิกหัวใจ' },
    { kw: 'echo', target: 'Echo' },
    { kw: 'aairc', target: 'AAIRC' },
    { kw: 'ods', target: 'ODS' }
  ];
  var extraClinics = []
    .concat(String(settingsMap['In_Time_Clinics'] || '').split(','))
    .concat(String(settingsMap['Out_Time_Clinics'] || '').split(','))
    .concat(String(settingsMap['Premium_Sub_Clinics'] || '').split(','));
  var containsClinicKw = function(keyword) {
    var k = String(keyword || '').toLowerCase();
    if (!k) return false;
    if (/^[a-z0-9\s-]+$/.test(k)) {
      var esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp('(?:^|[^a-z0-9])' + esc + '(?:[^a-z0-9]|$)').test(q);
    }
    return q.indexOf(k) !== -1;
  };
  for (var ei = 0; ei < extraClinics.length; ei++) {
    var cName = String(extraClinics[ei] || '').trim();
    if (cName && containsClinicKw(cName)) return cName;
  }
  for (var ai = 0; ai < aliases.length; ai++) {
    if (containsClinicKw(aliases[ai].kw)) return aliases[ai].target;
  }
  return '';
}

function getOtHourlyRateGas_(pos, customRatesMap) {
  var p = String(pos || '').trim().toUpperCase();
  if (customRatesMap && isFinite(Number(customRatesMap[pos])) && Number(customRatesMap[pos]) > 0) {
    return Number(customRatesMap[pos]);
  }
  if (p.indexOf('HN') !== -1 || p.indexOf('RN') !== -1 || p.indexOf('พยาบาลวิชาชีพ') !== -1 || p === 'พยาบาล') return 150;
  if (p.indexOf('CLERK') !== -1 || p.indexOf('SERVICE') !== -1 || p.indexOf('พนักงาน') !== -1 || p.indexOf('ธุรการ') !== -1) return 75;
  return 95;
}

function handleLineWebhookEvents_(events) {
  var token = String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim();
  var bkk = getBangkokDatePartsGas_(new Date());
  var todayYmd = bkk.ymd;
  var thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  var thaiShortMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  var formatShortThaiDate = function(ymd) {
    var p = String(ymd || '').split('-');
    if (p.length !== 3) return String(ymd || '');
    var y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
    var dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return 'วัน' + thaiDays[dow] + 'ที่ ' + d + ' ' + (thaiShortMonths[m - 1] || p[1]) + ' ' + (y + 543);
  };
  var formatCompactThaiDate = function(ymd) {
    var p = String(ymd || '').split('-');
    if (p.length !== 3) return String(ymd || '');
    return Number(p[2]) + ' ' + (thaiShortMonths[Number(p[1]) - 1] || p[1]) + ' ' + (Number(p[0]) + 543);
  };

  var settingsMap = readSettingsMapGas_();
  var ownerCallName = String(settingsMap['Booby_Owner_Name'] || 'คุณทรงยศ').trim() || 'คุณทรงยศ';
  var ownerUserId = String(settingsMap['Booby_Owner_User_ID'] || '').trim();
  var groupMentionOnly = String(settingsMap['Booby_Group_Mention_Only'] || 'true').toLowerCase() !== 'false';

  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (!ev || !ev.source) continue;
    var isGroupChat = Boolean(ev.source.groupId || ev.source.roomId);
    var detectedId = String(ev.source.groupId || ev.source.roomId || ev.source.userId || '').trim();
    if (!detectedId) continue;

    var groupName = ev.source.groupId ? fetchLineGroupNameGas_(token, detectedId) : '';
    if (isGroupChat) {
      var updates = [['Line_Detected_Group_ID', detectedId]];
      if (groupName) updates.push(['Line_Detected_Group_Name', groupName]);
      upsertSettingsEntriesGas_(updates);
    }

    var rawText = ev.type === 'message' && ev.message && ev.message.type === 'text'
      ? String(ev.message.text || '').trim()
      : '';
    var txt = rawText.toLowerCase();
    if (!token || !ev.replyToken || !txt) continue;

    // Chat Environment Gate:
    // - 1-on-1 Private Chat: respond immediately
    // - Group Chat: when groupMentionOnly=true, respond ONLY when called ("บูบี้", "@บูบี้", "booby"), Replied/Quoted, or /id
    var isIdCmd = (txt === '/id' || txt === '/groupid' || txt === 'ขอรหัสกลุ่ม' || txt === 'id' || txt === 'whoami');
    var isMentioned = /บูบี้|booby/i.test(rawText);
    var isReplyToQuote = Boolean(ev.message && ev.message.quotedMessageId);
    if (isGroupChat && groupMentionOnly && !isIdCmd && !isMentioned && !isReplyToQuote) {
      continue;
    }

    var senderName = fetchLineSenderNameGas_(token, ev.source);
    var ownerStripped = stripThaiHonorificsGas_(ownerCallName);
    var senderStripped = stripThaiHonorificsGas_(senderName);
    var isOwner = Boolean(
      (ownerUserId && ev.source.userId === ownerUserId) ||
      (!isGroupChat) ||
      (ownerStripped && senderStripped && (senderStripped.indexOf(ownerStripped) !== -1 || ownerStripped.indexOf(senderStripped) !== -1))
    );
    var speakerCall = isOwner
      ? ownerCallName
      : (senderName && senderName !== 'สมาชิกกลุ่ม' ? ('คุณ' + senderName.replace(/^คุณ\s*/, '')) : 'ทุกท่าน');

    var replyText = '';
    var addClosingWit = false;
    var cmdText = rawText.replace(/@?บูบี้/gi, '').replace(/\bbooby\b/gi, '').trim();
    var cmdLower = cmdText.toLowerCase();
    var wantsPrivateScope = (!isGroupChat) || /ส่วนตัว|เฉพาะผม|เฉพาะฉัน|ความลับ/.test(cmdLower);
    var noteGroupScopeId = wantsPrivateScope ? ('PRIVATE:' + String(ev.source.userId || detectedId)) : detectedId;
    var visibleNotes = readVisibleNotesForEventGas_(isGroupChat, ev.source.userId);

    // 1. LINE ID / WhoAmI Command
    if (isIdCmd) {
      if (isGroupChat) {
        replyText = '🎩 ' + speakerCall + ' ครับ รหัสกลุ่ม LINE (Group ID) สำหรับตั้งค่าออโตเมชั่น OPD:\n' +
          detectedId + (groupName ? '\nกลุ่ม: ' + groupName : '');
      } else {
        replyText = '🎩 สวัสดีครับ ' + speakerCall + ' รหัส LINE User ID ของท่านคือ:\n' +
          String(ev.source.userId || detectedId) +
          '\n\n💡 นำรหัส U... นี้ไปใส่ในหน้า Admin เพื่อยืนยันสิทธิ์เลขาส่วนตัว 1-on-1 ได้เลยครับ';
      }
      replyLineMessageGas_(token, ev.replyToken, replyText);
      continue;
    }

    // 2. Secretarial Capability 1: Appointments & Reminders (📅 จัดการตารางนัดหมาย & เตือนความจำ)
    var apptCancelMatch = cmdText.match(/^(?:ยกเลิกนัด|ลบนัด|เลื่อนนัด(?:ออก)?)\s*(.*)/i);
    if (apptCancelMatch) {
      var apptPool = visibleNotes.filter(function(n) { return n.category.indexOf('นัดหมาย') !== -1; });
      var cRes = archiveGroupNotesGas_(apptCancelMatch[1], apptPool, 'ARCHIVED');
      if (cRes.count > 0) {
        var cLines = cRes.archived.map(function(n) { return '• #' + n.id + ': ' + n.content.split('\n')[0]; });
        replyText = '🗑️ เรียบร้อยครับ ' + speakerCall + ' บูบี้ยกเลิกนัดหมายออกจากตารางแล้ว (' + cRes.count + ' รายการ):\n' + cLines.join('\n');
      } else {
        replyText = '🔍 ยังไม่พบนัดหมายที่ตรงกับ "' + String(apptCancelMatch[1] || 'ล่าสุด').trim() + '" ครับ ' + speakerCall + ' (ลองพิมพ์ "ดูตารางนัด" ก่อนได้นะครับ)';
      }
      replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, false));
      continue;
    }

    var isApptRecall = /(?:ดูนัด|เช็คนัด|เช็กนัด|ตารางนัด|มีนัดอะไร|นัดหมายอะไร|นัดอะไรบ้าง|เตือนความจำอะไร|มีนัดไหม|มีนัดมั้ย)/.test(cmdLower);
    var isApptCreate = /^(?:ลงนัด|เพิ่มนัด|นัดหมาย|ตั้งเตือน|เตือนความจำ|เตือนให้|บันทึกนัด|ช่วยจำนัด|มีนัด(?:เรื่อง|กับ|ที่))/.test(cmdLower);
    if (isApptRecall && !isApptCreate) {
      var appts = visibleNotes.filter(function(n) { return n.category.indexOf('นัดหมาย') !== -1; });
      var apptDateFilter = parseThaiQueryTargetDateGas_(cmdLower, todayYmd);
      var filteredAppts = appts;
      if (apptDateFilter.hasExplicitDate) {
        var compactDate = formatCompactThaiDate(apptDateFilter.ymd);
        filteredAppts = appts.filter(function(n) {
          return n.content.indexOf(apptDateFilter.ymd) !== -1 || n.content.indexOf(compactDate) !== -1;
        });
      }
      if (filteredAppts.length === 0) {
        replyText = '📅 ' + speakerCall + ' ครับ ' + (apptDateFilter.hasExplicitDate ? 'ประจำ' + formatShortThaiDate(apptDateFilter.ymd) + ' ' : 'ขณะนี้') +
          'ยังไม่มีกำหนดการนัดหมายที่บันทึกไว้ในระบบครับ\n💡 พิมพ์ "ลงนัด <วันที่> เวลา <เวลา> เรื่อง <หัวข้อ>" เพื่อให้บูบี้ลงตารางให้ได้เลยครับ';
      } else {
        var aLines = filteredAppts.slice(-10).map(function(n, idx) {
          var scopeTag = isPrivateNoteRecordGas_(n) ? '🔒 ส่วนตัว' : '👥 ทีม/กลุ่ม';
          return (idx + 1) + '. [#' + n.id + ' • ' + scopeTag + ']\n' + n.content;
        });
        replyText = '📅 ตารางนัดหมายและการแจ้งเตือนของ ' + speakerCall + ' (' + filteredAppts.length + ' รายการ):\n\n' + aLines.join('\n\n');
        addClosingWit = true;
      }
      replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, addClosingWit));
      continue;
    }

    if (isApptCreate) {
      if (isGroupChat && /ส่วนตัว|ลับ/.test(cmdLower)) {
        replyText = '🔒 ' + speakerCall + ' ครับ เพื่อรักษาความลับ บูบี้ขอแนะนำให้ส่งนัดหมายส่วนตัวมาที่แชตส่วนตัว 1-on-1 ของบูบี้นะครับ';
        replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, false));
        continue;
      }
      var apptDateInfo = parseThaiQueryTargetDateGas_(cmdLower, todayYmd);
      var apptTimeMatch = cmdText.match(/(\d{1,2}[:.]\d{2}\s*(?:น\.?)?|\d{1,2}\s*โมง(?:\s*(?:เช้า|เย็น|ค่ำ|ครึ่ง))?|เที่ยง(?:ตรง|วัน)?|บ่าย\s*\d{1,2}\s*โมง)/i);
      if (!apptDateInfo.hasExplicitDate || !apptTimeMatch) {
        var missingParts = [];
        if (!apptDateInfo.hasExplicitDate) missingParts.push('วันที่ (เช่น พรุ่งนี้, วันศุกร์, 25 พ.ย.)');
        if (!apptTimeMatch) missingParts.push('เวลา (เช่น 09:00 น., 13:30 น.)');
        replyText = '🎩 ' + speakerCall + ' ครับ เพื่อไม่ให้ลงตารางคลาดเคลื่อน บูบี้ขอทราบรายละเอียดเพิ่มเติมเล็กน้อยครับ:\n• ระบุ ' +
          missingParts.join(' และ ') + ' ได้เลยครับ เดี๋ยวบูบี้จัดระเบียบลงตารางให้ทันทีครับ';
        replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, false));
        continue;
      }
      var timeClean = String(apptTimeMatch[1]).replace(/\s+/g, ' ').trim();
      if (timeClean.indexOf('น.') === -1 && /\d/.test(timeClean)) timeClean += ' น.';
      var prepMatch = cmdText.match(/(?:เตรียม|สิ่งที่ต้องเตรียม|นำ)\s*[:\-]?\s*(.+)$/i);
      var prepText = prepMatch ? String(prepMatch[1] || '').trim() : 'เตรียมประเด็น/เอกสารที่เกี่ยวข้อง';
      var topicText = cmdText
        .replace(/^(?:ลงนัด|เพิ่มนัด|นัดหมาย|ตั้งเตือน|เตือนความจำ|เตือนให้|บันทึกนัด|ช่วยจำนัด)\s*[:\-]?\s*/i, '')
        .replace(apptTimeMatch[0], ' ')
        .replace(/(?:เตรียม|สิ่งที่ต้องเตรียม)\s*[:\-]?\s*.+$/i, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      var locMatch = topicText.match(/(?:ที่|ณ|ห้อง)\s+([^\s]+(?:\s+[^\s]+)?)/);
      var formattedAppt = '📌 ' + formatShortThaiDate(apptDateInfo.ymd) + ' เวลา ' + timeClean + '\n' +
        '📍 ' + (topicText || 'นัดหมายสำคัญ') + (locMatch ? '' : '') + '\n' +
        '🎒 เตรียม: ' + prepText;
      var savedAppt = saveLineGroupNoteGas_(formattedAppt, speakerCall, noteGroupScopeId, 'นัดหมาย/เตือนความจำ', wantsPrivateScope);
      replyText = '📅 บันทึกนัดหมายเรียบร้อยครับ ' + speakerCall + ' (#' + savedAppt.id +
        (wantsPrivateScope ? ' • 🔒 ส่วนตัว' : ' • 👥 กลุ่ม') + ')\n\n' + formattedAppt;
      addClosingWit = true;
      replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, addClosingWit));
      continue;
    }

    // 3. Secretarial Capability 2: Chat Summary & To-Do / Action Items (📝 สรุปแชตกลุ่ม & แยกงาน)
    var todoDoneMatch = cmdText.match(/^(?:ปิดงาน|ทำเสร็จแล้ว|เสร็จแล้ว|เคลียร์งาน)\s*(.*)/i);
    if (todoDoneMatch) {
      var todoPool = visibleNotes.filter(function(n) { return n.category.indexOf('To-Do') !== -1 || n.category.indexOf('งานที่ต้องทำ') !== -1; });
      var doneRes = archiveGroupNotesGas_(todoDoneMatch[1], todoPool, 'DONE');
      if (doneRes.count > 0) {
        var dLines = doneRes.archived.map(function(n) { return '✅ #' + n.id + ': ' + n.content; });
        replyText = '🎉 ยอดเยี่ยมครับ ' + speakerCall + ' บูบี้ปิดงานเรียบร้อยแล้ว (' + doneRes.count + ' รายการ):\n' + dLines.join('\n');
      } else {
        replyText = '🔍 ไม่พบรายการงานค้างที่ตรงกับ "' + String(todoDoneMatch[1] || 'ล่าสุด').trim() + '" ครับ (พิมพ์ "งานค้าง" เพื่อดูเลข #ID ได้ครับ)';
      }
      replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, false));
      continue;
    }

    var isTodoRecall = /(?:งานค้าง|ดูงาน|รายการงาน|เช็คงาน|เช็กงาน|มีงานอะไรบ้าง|to-do|todo)/.test(cmdLower) && !/^(?:สั่งงาน|มอบหมาย|เพิ่มงาน|แยกงาน)/.test(cmdLower);
    if (isTodoRecall) {
      var todos = visibleNotes.filter(function(n) { return n.category.indexOf('To-Do') !== -1 || n.category.indexOf('งานที่ต้องทำ') !== -1; });
      if (todos.length === 0) {
        replyText = '✅ ' + speakerCall + ' ครับ ขณะนี้ไม่มีงานค้าง (To-Do) ในรายการครับ ทุกอย่างเรียบร้อยดีครับ';
      } else {
        var tLines = todos.slice(-15).map(function(n, idx) {
          return (idx + 1) + '. [#' + n.id + '] ' + n.content;
        });
        replyText = '📝 รายการงานค้าง (Action Items) จำนวน ' + todos.length + ' รายการ:\n\n' + tLines.join('\n\n') +
          '\n\n💡 พิมพ์ "ปิดงาน #<เลขID>" เมื่อดำเนินการเสร็จสิ้นครับ';
        addClosingWit = true;
      }
      replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, addClosingWit));
      continue;
    }

    var isChatSummaryCmd = /^(?:สรุปแชต|สรุปข้อความ|สรุปบทสนทนา|สรุปประชุม|แยกงาน)/.test(cmdLower);
    var isTodoAddCmd = /^(?:สั่งงาน|มอบหมายงาน|มอบหมาย|เพิ่มงาน|to-do|todo)\s*[:\-]?\s*(.+)/i.exec(cmdText);
    if (isChatSummaryCmd) {
      var bodyToSummarize = cmdText.replace(/^(?:สรุปแชต|สรุปข้อความ|สรุปบทสนทนา|สรุปประชุม|แยกงาน)\s*[:\-]?\s*/i, '').trim();
      var rawLines = bodyToSummarize.split(/\r?\n/).map(function(l) { return l.trim(); }).filter(function(l) { return l.length >= 3; });
      if (rawLines.length === 0) {
        replyText = '📝 ' + speakerCall + ' ครับ กรุณาวางข้อความแชตกลุ่มหรือบันทึกการประชุมต่อท้ายคำสั่ง "สรุปแชต:" ได้เลยครับ เดี๋ยวบูบี้สกัดประเด็นสำคัญและแยก Action Items ให้ทันทีครับ';
        replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, false));
        continue;
      }
      var bulletSummary = rawLines.slice(0, 5).map(function(l) { return '📌 ' + (l.length > 140 ? l.slice(0, 137) + '...' : l); });
      var actionLines = [];
      for (var li = 0; li < rawLines.length; li++) {
        var ln = rawLines[li];
        if (/คุณ|ส่ง|ทำ|เตรียม|แจ้ง|แก้|ประสาน|ตรวจ|กำหนด|ก่อน|ภายใน|พว\.|หัวหน้า/.test(ln)) {
          var whoM = ln.match(/(?:คุณ|พว\.|พี่|น้อง)\s*([^\s:,-]+)/);
          var dlInfo = parseThaiQueryTargetDateGas_(ln.toLowerCase(), todayYmd);
          var whoStr = whoM ? whoM[0] : 'ทีมผู้เกี่ยวข้อง';
          var dlStr = dlInfo.hasExplicitDate ? formatCompactThaiDate(dlInfo.ymd) : 'แจ้งกำหนดเพิ่มเติม';
          actionLines.push('• ' + ln + ' — ผู้รับผิดชอบ: ' + whoStr + ' — กำหนดส่ง: ' + dlStr);
          saveLineGroupNoteGas_(ln + ' — ผู้รับผิดชอบ: ' + whoStr + ' — กำหนดส่ง: ' + dlStr, speakerCall, noteGroupScopeId, 'งานที่ต้องทำ/To-Do', wantsPrivateScope);
        }
      }
      replyText = '📝 สรุปสาระสำคัญจากบทสนทนาครับ ' + speakerCall + ':\n\n' +
        bulletSummary.join('\n') +
        (actionLines.length > 0
          ? '\n\n✅ Action Items ที่แยกและบันทึกลง To-Do แล้ว (' + actionLines.length + ' งาน):\n' + actionLines.slice(0, 8).join('\n')
          : '\n\n💡 หากต้องการมอบหมายงานชิ้นใด พิมพ์ "สั่งงาน: <ชื่องาน> ให้คุณ<ชื่อ> ภายใน <วัน>" ได้เลยครับ');
      addClosingWit = true;
      replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, addClosingWit));
      continue;
    }

    if (isTodoAddCmd && isTodoAddCmd[1]) {
      var taskRaw = String(isTodoAddCmd[1]).trim();
      var assigneeM = taskRaw.match(/(?:ให้|ผู้รับผิดชอบ\s*[:\-]?)\s*((?:คุณ|พว\.|พี่|น้อง)?\s*[\u0E00-\u0E7Fa-zA-Z]+)/);
      var taskDateInfo = parseThaiQueryTargetDateGas_(taskRaw.toLowerCase(), todayYmd);
      var assigneeStr = assigneeM ? String(assigneeM[1]).trim() : 'ยังไม่ระบุ';
      var deadlineStr = taskDateInfo.hasExplicitDate ? formatShortThaiDate(taskDateInfo.ymd) : 'ไม่ระบุกำหนดส่ง';
      var formattedTask = taskRaw + ' — ผู้รับผิดชอบ: ' + assigneeStr + ' — กำหนดส่ง: ' + deadlineStr;
      var savedTask = saveLineGroupNoteGas_(formattedTask, speakerCall, noteGroupScopeId, 'งานที่ต้องทำ/To-Do', wantsPrivateScope);
      replyText = '📝 บูบี้บันทึกงานเข้ากระดาน To-Do เรียบร้อยครับ ' + speakerCall + ' (#' + savedTask.id + ')\n\n' +
        '• งาน: ' + taskRaw + '\n' +
        '• ผู้รับผิดชอบ: ' + assigneeStr + '\n' +
        '• กำหนดส่ง: ' + deadlineStr;
      addClosingWit = true;
      replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, addClosingWit));
      continue;
    }

    // 4. Secretarial Capability 3: Drafting Announcements & Coordination Messages (✍️ ร่างประกาศ 2 สไตล์)
    var isDraftCmd = /^(?:ร่างข้อความ|ร่างประกาศ|เขียนประกาศ|ร่างไลน์|ขอข้อความแจ้ง|ช่วยพิมพ์แจ้ง|ช่วยเขียนแจ้ง|ร่างคำชี้แจง)/.test(cmdLower);
    if (isDraftCmd) {
      var draftTopic = cmdText
        .replace(/^(?:ร่างข้อความ|ร่างประกาศ|เขียนประกาศ|ร่างไลน์|ขอข้อความแจ้ง|ช่วยพิมพ์แจ้ง|ช่วยเขียนแจ้ง|ร่างคำชี้แจง)\s*(?:เรื่อง|เกี่ยวกับ)?\s*[:\-]?\s*/i, '')
        .trim();
      if (!draftTopic || draftTopic.length < 3) {
        replyText = '✍️ ' + speakerCall + ' ครับ ต้องการให้บูบี้ร่างข้อความหรือประกาศเรื่องอะไร และส่งถึงกลุ่มใดครับ แจ้งสั้นๆ ได้เลยครับ เดี๋ยวจัดให้ครบทั้งแบบทางการและแบบเป็นกันเองครับ';
      } else {
        replyText = '✍️ บูบี้ร่างข้อความให้เลือก 2 รูปแบบตามระดับผู้รับสารครับ ' + speakerCall + ':\n\n' +
          '1️⃣ แบบทางการสุภาพ (สำหรับผู้บริหาร / หัวหน้าหน่วยงาน / หนังสือเวียน)\n' +
          'เรียน ทุกท่านที่เกี่ยวข้อง\n' +
          'ขออนุญาตแจ้งประชาสัมพันธ์เรื่อง "' + draftTopic + '" เพื่อให้การปฏิบัติงานและประสานงานของกลุ่มงานการพยาบาลผู้ป่วยนอก (OPD) เป็นไปด้วยความเรียบร้อย จึงเรียนมาเพื่อโปรดทราบและถือปฏิบัติโดยพร้อมเพรียงกัน\n' +
          'ขอแสดงความนับถือ\n\n' +
          '2️⃣ แบบกระชับเป็นกันเอง (สำหรับกลุ่ม LINE ทีมงาน OPD)\n' +
          '📢 แจ้งทีม OPD ทราบครับทุกคน\n' +
          '📌 เรื่อง: ' + draftTopic + '\n' +
          'รบกวนทุกท่านรับทราบและช่วยกันดำเนินการตามนี้นะครับ หากมีข้อสงสัยแจ้งในกลุ่มนี้ได้เลย ขอบคุณทุกท่านมากครับ 🙏';
        addClosingWit = true;
      }
      replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, addClosingWit));
      continue;
    }

    // 5. Group Memory: Write / Save New Agreement or Group Memo
    var saveNoteMatch = cmdText.match(/^(?:จำไว้ว่า|จำไว้หน่อยว่า|จำไว้หน่อย|จำไว้|ฝากจำว่า|ฝากจำ|จดไว้ว่า|จดไว้|จดบันทึก|บันทึกข้อตกลงใหม่|บันทึกข้อตกลง|ข้อตกลงใหม่|ข้อตกลงกลุ่ม|ข้อตกลง|มติที่ประชุม|มติกลุ่ม|มติ|ตกลงตามนี้|ประกาศใหม่|แจ้งเวียน|โน้ตไว้|เพิ่มบันทึก|บันทึกช่วยจำ|เงื่อนไขใหม่)[:\s-]*(.+)/i);
    var passiveSaveMatch = !saveNoteMatch && cmdText.match(/^(?:.*?(?:จำไว้ว่า|จดไว้ว่า|บันทึกไว้ว่า))\s*[:\-]?\s*(.+)/i);
    var noteContentToSave = saveNoteMatch ? String(saveNoteMatch[1] || '').trim() : (passiveSaveMatch ? String(passiveSaveMatch[1] || '').trim() : '');
    var looksLikeRecallNoteQuestion = !noteContentToSave ||
      /^(?:อะไรบ้าง|มีอะไร|กี่|ทั้งหมด|เรื่อง|ที่จำ|ไหม|มั้ย|มั๊ย|ได้ไหม|ได้มั้ย|\?)/.test(noteContentToSave) ||
      /(?:อะไรบ้าง|มีอะไรบ้าง|กี่ข้อ|กี่เรื่อง|ไหม|มั้ย|มั๊ย|\?)\s*$/.test(noteContentToSave);
    if (noteContentToSave && !looksLikeRecallNoteQuestion) {
      var savedNote = saveLineGroupNoteGas_(noteContentToSave, speakerCall, noteGroupScopeId, '', wantsPrivateScope);
      replyText = '📝 บูบี้จดจำ' + (wantsPrivateScope ? 'บันทึกส่วนตัว' : 'ข้อตกลงกลุ่ม') + 'เรียบร้อยแล้วครับ ' + speakerCall + ' (#' + savedNote.id + ')\n\n' +
        '📂 หมวดหมู่: ' + savedNote.category + '\n' +
        '📌 "' + savedNote.content + '"\n' +
        '👤 โดย: ' + savedNote.savedBy + ' (' + savedNote.timestamp.slice(11, 16) + ' น.)\n' +
        '💡 พิมพ์ "สรุปข้อตกลง" เพื่อเรียกดูได้ตลอดครับ';
      replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, true));
      continue;
    }

    // 6. Group Memory: Delete / Archive Note
    var delNoteMatch = cmdText.match(/^(?:ลบข้อตกลง|ลบบันทึก|ลืมเรื่อง|ลืมข้อตกลง|ยกเลิกข้อตกลง|ลบโน้ต)\s*(.*)/i);
    if (delNoteMatch) {
      var delRes = archiveGroupNotesGas_(delNoteMatch[1], visibleNotes, 'ARCHIVED');
      if (delRes.count > 0) {
        var delLines = delRes.archived.map(function(n) { return '• #' + n.id + ': "' + n.content + '"'; });
        replyText = '🗑️ จัดเก็บบันทึกเรียบร้อยครับ ' + speakerCall + ' (' + delRes.count + ' รายการ):\n' + delLines.join('\n');
      } else {
        replyText = '🔍 ไม่พบบันทึกข้อตกลงที่ตรงกับเงื่อนไขลบครับ ' + speakerCall + ' (ลองพิมพ์ "สรุปข้อตกลง" เพื่อดูเลข #ID ก่อนได้ครับ)';
      }
      replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(replyText, speakerCall, false));
      continue;
    }

    // Load database sheets & settings for intelligent querying + Executive Briefing
    var staffData = getSheetRowsNormalized_(SHEET_NAMES.STAFF, 8);
    var leaveData = getSheetRowsNormalized_(SHEET_NAMES.LEAVE, 9);
    var lOff = (leaveData.headers[0] === 'Leave_ID') ? 1 : 0;
    var otData = getSheetRowsNormalized_(SHEET_NAMES.OT, 9);
    var oOff = (otData.headers[0] === 'OT_ID') ? 1 : 0;

    var parsedTarget = parseThaiQueryTargetDateGas_(txt, todayYmd);
    var startYmd = parsedTarget.ymd;
    var endYmd = parsedTarget.endYmd || startYmd;
    var hasExplicitDate = Boolean(parsedTarget.hasExplicitDate);
    var isRange = Boolean(parsedTarget.isRange && startYmd !== endYmd);
    var dateHeader = isRange
      ? (parsedTarget.relLabel ? parsedTarget.relLabel + ' (' : '') + formatCompactThaiDate(startYmd) + ' - ' + formatCompactThaiDate(endYmd) + (parsedTarget.relLabel ? ')' : '')
      : (parsedTarget.relLabel ? parsedTarget.relLabel + ' (' : '') + formatShortThaiDate(startYmd) + (parsedTarget.relLabel ? ')' : '');

    // Secretarial Capability 4: Executive Briefing (🗂️ กลั่นกรองข้อมูลก่อนตัดสินใจ)
    var isExecutiveBriefing = /(?:สรุปผู้บริหาร|executive|briefing|ภาพรวมวันนี้|สรุปภาพรวมทั้งหมด|ต้องตัดสินใจอะไรบ้าง|สถานการณ์วันนี้|สรุปสำหรับหัวหน้า)/.test(cmdLower);
    if (isExecutiveBriefing) {
      var briefDate = hasExplicitDate ? startYmd : todayYmd;
      var briefReport = buildDailyCensusLineMessageGas_(briefDate, 'ALL', settingsMap);
      var bLeaves = leaveData.rows.filter(function(r) {
        var s = normalizeSheetDateGas_(r[lOff]);
        var e = normalizeSheetDateGas_(r[lOff + 1]) || s;
        return s && s <= briefDate && e >= briefDate;
      });
      var bOt = otData.rows.filter(function(r) {
        return normalizeSheetDateGas_(r[oOff]) === briefDate;
      });
      var bAppts = visibleNotes.filter(function(n) { return n.category.indexOf('นัดหมาย') !== -1; });
      var bTodos = visibleNotes.filter(function(n) { return n.category.indexOf('To-Do') !== -1 || n.category.indexOf('งานที่ต้องทำ') !== -1; });

      var execAdvice = 'สถานการณ์อยู่ในเกณฑ์ปกติ สามารถบริหารอัตรากำลังตามแผนได้ครับ';
      if (briefReport.clinicCount === 0 && bLeaves.length > 0) {
        execAdvice = 'วันนี้มีผู้ลา ' + bLeaves.length + ' ท่าน แนะนำตรวจการจัดคนทดแทนและติดตามการบันทึกยอด Census ช่วงปิดเวรครับ';
      } else if (bLeaves.length >= 3) {
        execAdvice = 'วันนี้มีผู้ลา ' + bLeaves.length + ' ท่าน (ค่อนข้างหนาแน่น) แนะนำพิจารณาเกลี่ยอัตรากำลังคลินิกรองหรือจัดเวร OT เสริมครับ';
      } else if (bTodos.length > 0) {
        execAdvice = 'ภาระงานโดยรวมคุมได้ แนะนำติดตามงานค้าง (To-Do) ' + bTodos.length + ' รายการ และตรวจสอบความครบถ้วนก่อนปิดเวรครับ';
      }

      var bSummary = '🗂️ Executive Briefing — ' + formatShortThaiDate(briefDate) + '\n' +
        '💡 ข้อเสนอแนะเชิงบริหาร: ' + execAdvice + '\n\n' +
        '📊 ภาระงานผู้ป่วยนอก: ' + (briefReport.clinicCount > 0 ? (briefReport.clinicCount + ' คลินิก • ' + briefReport.totalPt.toLocaleString() + ' ราย') : 'ยังไม่มีบันทึกยอดประจำวัน') + '\n' +
        '🏥 ผู้ลาวันนี้: ' + bLeaves.length + ' รายการ' + (bLeaves.length > 0 ? ' (' + bLeaves.slice(0, 4).map(function(r) { return String(r[lOff + 2] || '').trim(); }).join(', ') + (bLeaves.length > 4 ? '...' : '') + ')' : '') + '\n' +
        '⏰ เวร OT นอกเวลา: ' + bOt.length + ' รายการ' + '\n' +
        '📅 นัดหมายที่บันทึกไว้: ' + bAppts.length + ' รายการ\n' +
        '📝 งานค้าง (To-Do): ' + bTodos.length + ' รายการ';
      replyLineMessageGas_(token, ev.replyToken, formatBoobyPersonaReplyGas_(bSummary, speakerCall, true));
      continue;
    }

    var staffExtract = extractStaffMatchesGas_(txt, staffData.rows, leaveData.rows, lOff, otData.rows, oOff);
    var matchedStaff = staffExtract.matchedStaff;
    var candidateName = matchedStaff.length > 0 ? matchedStaff[0].name : extractCandidatePersonBeforeQueryGas_(rawText);
    var isPersonQuery = matchedStaff.length > 0 || Boolean(candidateName);
    var asksOpenWhen = /(?:วันไหน|เมื่อไหร่|ช่วงไหน|วันที่เท่าไหร่|วันอะไร|บ่อยแค่ไหน|กี่ครั้ง|กี่วัน|ทั้งหมด|ล่าสุด|เคยลา|เคยขึ้น)/.test(txt);

    var matchedClinic = extractClinicMatchGas_(txt, settingsMap);
    var shiftFilter = '';
    if (txt.indexOf('นอกเวลาวันหยุด') !== -1 || (txt.indexOf('นอกเวลา') !== -1 && (txt.indexOf('วันหยุด') !== -1 || txt.indexOf('12:00') !== -1))) {
      shiftFilter = 'นอกเวลาวันหยุด 08:00-12:00';
    } else if (txt.indexOf('นอกเวลาเย็น') !== -1 || (txt.indexOf('นอกเวลา') !== -1 && (txt.indexOf('เย็น') !== -1 || txt.indexOf('16:00') !== -1 || txt.indexOf('20:00') !== -1))) {
      shiftFilter = 'นอกเวลาเย็น 16:00-20:00';
    } else if (txt.indexOf('ในเวลา') !== -1 && txt.indexOf('นอกเวลา') === -1) {
      shiftFilter = 'ในเวลา 08:00-16:00';
    } else if (txt.indexOf('นอกเวลา') !== -1) {
      shiftFilter = 'OUT_TIME_ALL';
    }

    // Group Memory Recall / Search Intent (Respecting Group vs 1-on-1 Privacy Scope)
    var asksRecallNotes = /(?:สรุปข้อตกลง|ข้อตกลง|บันทึกที่จำ|ความจำ|จำอะไรไว้|จำเรื่อง|โน้ตที่|มติที่ประชุม|มติกลุ่ม|ประกาศที่บันทึก|บันทึกใหม่)/.test(txt);

    // Structured Intents across OPD System
    var txtNoTimeWord = txt.replace(/นอกเวลา|ในเวลา|เวลา/g, '');
    var asksLeave = (
      txtNoTimeWord.indexOf('ใครลา') !== -1 ||
      txtNoTimeWord.indexOf('ลาวันนี้') !== -1 ||
      txtNoTimeWord.indexOf('ลาบ้าง') !== -1 ||
      txtNoTimeWord.indexOf('ลาวันไหน') !== -1 ||
      txtNoTimeWord.indexOf('คนลา') !== -1 ||
      txtNoTimeWord.indexOf('ผู้ลา') !== -1 ||
      txtNoTimeWord.indexOf('ลาป่วย') !== -1 ||
      txtNoTimeWord.indexOf('ลากิจ') !== -1 ||
      txtNoTimeWord.indexOf('ลาพัก') !== -1 ||
      txtNoTimeWord.indexOf('ลางาน') !== -1 ||
      txtNoTimeWord.indexOf('ยอดลา') !== -1 ||
      txtNoTimeWord.indexOf('ไปอบรม') !== -1 ||
      /(?:ใคร|คน|ผู้|ยื่น|ขอ|หยุด|แจ้ง|มี|กี่คน|วันไหน|เมื่อไหร่|เคย).*ลา|ลา.*(?:ใคร|บ้าง|กี่คน|กี่วัน|วันไหน|เมื่อไหร่|ไหม|มั้ย|วัน|สัปดาห์|อาทิตย์|เดือน|พรุ่งนี้|มะรืน|เมื่อวาน|\d)/.test(txtNoTimeWord)
    );
    var asksOtPayment = /(?:เบิก\s*ot|เบิกค่า|หลักฐานจ่าย|หักภาษี|ภาษี\s*5%|เรท\s*ot|อัตราค่าตอบแทน|ค่าตอบแทนรายชั่วโมง|เงินสุทธิ|ยอดเบิก|สรุปเงิน\s*ot|ยอดค่าตอบแทน|ค่าเวรรวม)/.test(txt);
    var asksFiscalSummary = /(?:ปีงบ|ปีงบประมาณ|12\s*เดือน|สรุปทั้งปี|สรุปรายปี)/.test(txt);
    var asksOt = (
      !asksOtPayment &&
      !asksFiscalSummary &&
      (txt.indexOf('ot') !== -1 ||
        txt.indexOf('โอที') !== -1 ||
        txt.indexOf('นอกเวลา') !== -1 ||
        txt.indexOf('อยู่เวร') !== -1 ||
        txt.indexOf('ขึ้นเวร') !== -1 ||
        txt.indexOf('ค่าตอบแทน') !== -1 ||
        txt.indexOf('ค่าเวร') !== -1 ||
        txt.indexOf('เวร') !== -1) &&
      !/(?:off\s*เวร|ออฟเวร)/.test(txt)
    );
    var asksUnreportedClinics = /(?:ยังไม่ได้รายงาน|ยังไม่รายงาน|ไม่ได้รายงาน|ยังไม่ส่ง|ไม่ได้ส่ง|ขาดรายงาน|ขาดส่ง|รายงานครบ|ส่งครบ|เหลือคลินิก|เหลือหน่วย|คลินิกไหนยัง|หน่วยงานไหนยัง|แผนกไหนยัง)/.test(txt);
    var asksReferral = /(?:ส่งต่อ|refer|รับย้าย|ห้องพิเศษ|จองห้อง|ยกเลิกห้อง|ศูนย์รับ)/.test(txt) && !asksUnreportedClinics;
    var asksOffDuty = /(?:off\s*เวร|ออฟเวร|ปิดคลินิก|ไม่ได้เปิดตรวจ|หยุดบริการ|งดตรวจ|รายวัน\s*off)/.test(txt);
    var asksCensusMeta = /(?:admit\s*rate|อัตรา\s*admit|สัดส่วนผู้ป่วยต่อพยาบาล|pt\/nurse|ส่งไลน์ล่าสุด|ส่งรายงานล่าสุด)/.test(txt);
    var asksProductivity = /(?:productivity|โปรดัก|ประสิทธิผล|nhppd|\bftc\b|skill\s*mix|สกิลมิกซ์|\boutput\b|\binput\b|กำลังคน|อัตรากำลัง|ขาดคน|เกินเกณฑ์|ภาระงานหนัก|โหลดสุด)/.test(txt);
    var asksWorkload = (
      !asksUnreportedClinics &&
      !asksFiscalSummary &&
      (/(?:ภาระงาน|ยอดภาระงาน|จำนวนผู้ป่วย|ยอดบริการ|เปิดตรวจ|ปิดตรวจ|ศูนย์ปัญญาภิรมย์|อัตราส่วน|ยอดผู้ป่วย|ผู้ป่วย|คนไข้|ยอดคนไข้|ยอดตรวจ|ยอดรวม|สรุปยอด|census|admit|แอดมิท|รับไว้|กี่ราย|เยอะสุด|มากสุด)/.test(txt) ||
        asksCensusMeta)
    );
    var asksCostCenter = /(?:cost\s*center|คอสเซ็นเตอร์|คอลเซ็นเตอร์|รหัสศูนย์ต้นทุน)/.test(txt);
    var asksScheduleInfo = /(?:ตั้งเวลา|ตารางส่ง|รอบส่งรายงาน|ส่งรายงานกี่โมง|ออโต้ส่งกี่โมง|ส่งไลน์ล่าสุด|ส่งรายงานล่าสุด)/.test(txt);
    var asksHolidays = /(?:วันหยุด|นักขัตฤกษ์|วันหยุดพิเศษ|วันหยุดราชการ)/.test(txt) && !/นอกเวลาวันหยุด/.test(txt);
    var asksAuditLogs = /(?:ประวัติแก้ไข|ประวัติลบ|audit|แก้ไขล่าสุด|ลบล่าสุด|ใครแก้|ใครลบ)/.test(txt);
    var asksStaffInfo = (
      /(?:อยู่คลินิกไหน|อยู่หน่วยไหน|ตำแหน่งอะไร|รหัสพนักงาน|รหัสประจำตัว|กี่คนในหน่วย|มีพยาบาลกี่คน|มีบุคลากรกี่คน|รายชื่อเจ้าหน้าที่|รายชื่อบุคลากร|staff|อัตรากำลังประจำ|ลาออก|เกษียณ|รายวัน)/.test(txt) ||
      (isPersonQuery && !asksLeave && !asksOt && !asksOtPayment && !asksFiscalSummary && !asksWorkload && !asksProductivity && !asksRecallNotes)
    );

    var replySections = [];

    // --- Section: Recall Group Notes (Strictly scoped by Private vs Group) ---
    if (asksRecallNotes) {
      if (visibleNotes.length === 0) {
        replySections.push('📒 ' + speakerCall + ' ครับ ยังไม่มีข้อตกลงหรือบันทึกที่จดจำไว้ในขอบเขตห้องแชตนี้ครับ\n💡 พิมพ์ขึ้นต้นว่า "จำไว้ว่า ..." หรือ "บันทึกข้อตกลง: ..." เพื่อให้บูบี้จำให้ได้เลยครับ');
      } else {
        var noteTopic = rawText
          .replace(/(?:@?บูบี้|สรุปข้อตกลงทั้งหมด|สรุปข้อตกลง|ข้อตกลงทั้งหมด|ข้อตกลงกลุ่ม|มีข้อตกลง|ข้อตกลง|มติที่ประชุม|มติกลุ่ม|มติ|บันทึกที่จำ|บันทึกทั้งหมด|ความจำ|จำอะไรไว้บ้าง|จำอะไรไว้|ที่จำไว้|เรื่อง|เกี่ยวกับ|มีอะไรบ้าง|อะไรบ้าง|ทั้งหมด|โน้ตที่|มี|ไหม|มั้ย|มั๊ย|บ้าง|\?)/gi, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
        var filteredNotes = visibleNotes;
        if (noteTopic.length >= 2) {
          filteredNotes = visibleNotes.filter(function(n) {
            return n.content.toLowerCase().indexOf(noteTopic) !== -1 || n.category.toLowerCase().indexOf(noteTopic) !== -1;
          });
        }
        if (filteredNotes.length > 0) {
          var noteLines = filteredNotes.slice(-15).reverse().map(function(n, idx) {
            return (idx + 1) + '. [#' + n.id + ' • ' + n.category + '] ' + n.content + ' (โดย ' + n.savedBy + ' • ' + n.timestamp.slice(0, 10) + ')';
          });
          replySections.push('📒 ข้อตกลง/บันทึกที่บูบี้จำไว้' + (noteTopic.length >= 2 ? ' (ค้นหา: "' + noteTopic + '")' : '') + ':\nรวม ' + filteredNotes.length + ' รายการ\n' + noteLines.join('\n'));
        } else {
          replySections.push('🔍 ไม่พบข้อตกลงเกี่ยวกับ "' + noteTopic + '" ครับ ' + speakerCall + ' (ปัจจุบันมีบันทึกทั้งหมด ' + visibleNotes.length + ' รายการ — พิมพ์ "สรุปข้อตกลง" เพื่อดูทั้งหมด)');
        }
      }
    }

    // --- Section: Cost Center / Settings / Schedule Info ---
    if (asksCostCenter) {
      var defaultCC = String(settingsMap['Default_Cost_Center'] || '2012000000').trim();
      var clinicCCMap = {};
      try { clinicCCMap = JSON.parse(settingsMap['Clinic_Cost_Centers'] || '{}') || {}; } catch (e) {}
      if (matchedClinic) {
        var foundCC = clinicCCMap[matchedClinic] || defaultCC;
        replySections.push('🏷️ Cost Center ของ "' + matchedClinic + '":\n' + foundCC + (clinicCCMap[matchedClinic] ? ' (กำหนดเฉพาะหน่วย)' : ' (ใช้ค่าหลัก OPD)'));
      } else {
        var ccKeys = Object.keys(clinicCCMap).filter(function(k) { return clinicCCMap[k]; });
        var ccLines = ccKeys.map(function(k) { return '• ' + k + ': ' + clinicCCMap[k]; });
        replySections.push('🏷️ ข้อมูล Cost Center OPD:\n• ค่าหลักหน่วยงาน: ' + defaultCC + (ccLines.length > 0 ? '\n' + ccLines.join('\n') : '\n(ทุกห้องตรวจใช้ค่าหลักนี้)'));
      }
    }

    if (asksScheduleInfo) {
      var autoEn = String(settingsMap['Line_Auto_Enabled'] || '').toLowerCase() === 'true';
      var scheds = getLineSchedulesFromSettingsMap_(settingsMap);
      var schedLines = scheds.map(function(s, idx) {
        return (idx + 1) + '. ' + (s.enabled === false ? '⏸️ ' : '✅ ') + (s.label || s.shift) + ' — เวลา ' + s.time + ' น. [' + (s.shift || '') + ']';
      });
      var lastSentAt = String(settingsMap['Line_Last_Sent_At'] || '').trim();
      var lastStatus = String(settingsMap['Line_Last_Status'] || '').trim();
      var lastPushInfo = lastSentAt ? ('\n📤 ส่งไลน์ล่าสุด: ' + lastSentAt + ' (' + (lastStatus || 'สำเร็จ') + ')') : '';
      replySections.push('⏰ ตารางส่งรายงานอัตโนมัติเข้า LINE: ' + (autoEn ? 'เปิดใช้งานอยู่' : 'ปิดอยู่') + '\n' + schedLines.join('\n') + lastPushInfo);
    }

    // --- Section: Holidays (Public + Hospital Custom Holidays) ---
    if (asksHolidays) {
      var customHolsArr = [];
      try {
        var parsedCh = JSON.parse(settingsMap['Custom_Holidays'] || '[]');
        if (Array.isArray(parsedCh)) customHolsArr = parsedCh;
      } catch (eCh) {}
      var targetHolYr = Number(startYmd.slice(0, 4)) || Number(todayYmd.slice(0, 4));
      var holDetailMap = getThaiHolidayDetailsForYearGas_(targetHolYr, customHolsArr);
      var filterHolMonth = (hasExplicitDate && isRange && startYmd.slice(0, 7) === endYmd.slice(0, 7)) ? startYmd.slice(0, 7) : '';
      var allHolKeys = Object.keys(holDetailMap).sort();
      var filteredHolKeys = allHolKeys.filter(function(d) {
        return filterHolMonth ? (d.indexOf(filterHolMonth) === 0) : (d >= todayYmd);
      });
      var showHolKeys = filteredHolKeys.length > 0 ? filteredHolKeys : allHolKeys;
      if (showHolKeys.length > 0) {
        var hLines = showHolKeys.slice(0, 15).map(function(d, idx) {
          var info = holDetailMap[d];
          return (idx + 1) + '. ' + formatShortThaiDate(d) + ' — ' + info.name + (info.isCustom ? ' (วันหยุดพิเศษ รพ.)' : '');
        });
        var holTitle = filterHolMonth
          ? (' เดือน ' + (thaiShortMonths[Number(filterHolMonth.slice(5, 7)) - 1] || filterHolMonth.slice(5, 7)) + ' ' + (targetHolYr + 543))
          : (' ปี พ.ศ. ' + (targetHolYr + 543));
        replySections.push('📅 วันหยุดราชการและวันหยุดพิเศษ รพ.' + holTitle + ' (' + showHolKeys.length + ' วัน):\n' + hLines.join('\n'));
      } else {
        replySections.push('📅 ไม่พบวันหยุดในช่วงที่สอบถามของปี พ.ศ. ' + (targetHolYr + 543) + ' ครับ');
      }
    }

    // --- Section: Audit Logs (Admin History) ---
    if (asksAuditLogs) {
      var auditData = getSheetRowsNormalized_(SHEET_NAMES.AUDIT, 6);
      if (auditData.rows.length === 0) {
        replySections.push('🛡️ ยังไม่พบประวัติการแก้ไขหรือลบข้อมูล (Audit_Logs) ในระบบครับ');
      } else {
        var recentAudits = auditData.rows.slice(-10).reverse();
        var aLines = recentAudits.map(function(r, idx) {
          var ts = String(r[0] || '').replace('T', ' ').slice(0, 16);
          return (idx + 1) + '. [' + ts + '] ' + (r[1] || 'แก้ไข') + ' — ' + (r[2] || '-') + ' (' + (r[3] || '') + ') | เหตุผล: ' + (r[4] || '-') + ' • โดย ' + (r[5] || 'Admin');
        });
        replySections.push('🛡️ ประวัติการแก้ไข/ลบข้อมูลล่าสุด (Audit Logs ' + auditData.rows.length + ' รายการ):\n' + aLines.join('\n'));
      }
    }

    // --- Section: Unreported Clinics Check (Menu 1 & Menu 3) ---
    var wlDataCached = null;
    var getWlDataGas = function() {
      if (!wlDataCached) wlDataCached = getSheetRowsNormalized_(SHEET_NAMES.WORKLOAD, 19);
      return wlDataCached;
    };

    if (asksUnreportedClinics) {
      var targetCheckDate = hasExplicitDate ? startYmd : todayYmd;
      var isHolCheck = isWeekendOrThaiHolidayGas_(targetCheckDate, settingsMap);
      var effShift = (shiftFilter && shiftFilter !== 'OUT_TIME_ALL') ? shiftFilter : '';
      if (!effShift) {
        if (shiftFilter === 'OUT_TIME_ALL') {
          effShift = isHolCheck ? 'นอกเวลาวันหยุด 08:00-12:00' : 'นอกเวลาเย็น 16:00-20:00';
        } else if (isHolCheck) {
          effShift = 'นอกเวลาวันหยุด 08:00-12:00';
        } else {
          var bkkHrNow = Number(bkk.hm.slice(0, 2)) || 12;
          effShift = (targetCheckDate === todayYmd && bkkHrNow >= 16) ? 'นอกเวลาเย็น 16:00-20:00' : 'ในเวลา 08:00-16:00';
        }
      }
      var inClinicsRaw = String(settingsMap['In_Time_Clinics'] || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      var inClinicsCfg = inClinicsRaw.length > 0 ? inClinicsRaw.slice() : DEFAULT_IN_TIME_CLINICS.slice();
      if (inClinicsCfg.indexOf('ศูนย์ปัญญาภิรมย์') === -1) inClinicsCfg.push('ศูนย์ปัญญาภิรมย์');
      if (inClinicsCfg.indexOf('ศูนย์รับ - ส่งต่อผู้ป่วย') === -1) inClinicsCfg.push('ศูนย์รับ - ส่งต่อผู้ป่วย');
      var outClinicsRaw = String(settingsMap['Out_Time_Clinics'] || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      var outClinicsCfg = outClinicsRaw.length > 0 ? outClinicsRaw.slice() : DEFAULT_OUT_TIME_CLINICS.slice();
      var expectedClinics = (effShift === 'ในเวลา 08:00-16:00') ? inClinicsCfg : outClinicsCfg;

      var wlChk = getWlDataGas();
      var wChkOff = (wlChk.headers[0] === 'Record_ID') ? 1 : 0;
      var reportedActiveMap = {};
      var reportedOffDutyMap = {};
      for (var uci = 0; uci < wlChk.rows.length; uci++) {
        var ur = wlChk.rows[uci];
        var ud = normalizeSheetDateGas_(ur[wChkOff]);
        var uSh = String(ur[wChkOff + 1] || '').replace(/\s+/g, ' ').trim();
        var uCl = String(ur[wChkOff + 2] || '').trim();
        if (ud !== targetCheckDate || uSh !== effShift || !uCl) continue;
        var uRt = String(ur[wChkOff + 17] || '').trim().toUpperCase();
        var uIsPrem = (uCl.indexOf('ปัญญาภิรมย์') !== -1 || /-Premium$/i.test(uCl) || uRt === 'PREMIUM_SUB' || uRt === 'PREMIUM_POOL');
        var mappedUCl = uIsPrem ? 'ศูนย์ปัญญาภิรมย์' : uCl;
        var uMeta = parseWorkloadMetaGas_(ur[wChkOff + 13]);
        if (uMeta.isOffDuty) reportedOffDutyMap[mappedUCl] = true;
        else reportedActiveMap[mappedUCl] = true;
      }
      var missingClinics = expectedClinics.filter(function(c) {
        return !reportedActiveMap[c] && !reportedOffDutyMap[c];
      });
      var reportedActCnt = Object.keys(reportedActiveMap).length;
      var offDutyKeys = Object.keys(reportedOffDutyMap);
      var reportedTotal = expectedClinics.length - missingClinics.length;
      var missingLines = missingClinics.map(function(c, idx) { return (idx + 1) + '. ' + c; });
      replySections.push(
        '📋 ตรวจสอบความครบถ้วนการรายงานภาระงาน ประจำ' + formatShortThaiDate(targetCheckDate) + ' (' + effShift + '):\n' +
        '• รายงานแล้ว: ' + reportedTotal + '/' + expectedClinics.length + ' หน่วยงาน' +
        ((reportedActCnt > 0 || offDutyKeys.length > 0)
          ? (' (' + (reportedActCnt > 0 ? 'เปิดตรวจ ' + reportedActCnt : '') +
            (offDutyKeys.length > 0 ? (reportedActCnt > 0 ? ', ' : '') + 'Off เวร ' + offDutyKeys.length : '') + ')')
          : '') + '\n' +
        (missingClinics.length === 0
          ? '✅ ส่งข้อมูลครบทุกหน่วยงานแล้วครับ!'
          : ('⏳ ยังไม่ได้รายงาน (' + missingClinics.length + ' หน่วยงาน):\n' + missingLines.join('\n'))) +
        (offDutyKeys.length > 0 ? '\n🏖️ แจ้ง Off เวร/ปิดคลินิก: ' + offDutyKeys.join(', ') : '')
      );
    }

    // --- Section: Referral Center (ศูนย์รับ - ส่งต่อผู้ป่วย) ---
    if (asksReferral) {
      var wlRef = getWlDataGas();
      var wRefOff = (wlRef.headers[0] === 'Record_ID') ? 1 : 0;
      var refTotals = {
        admitPrivate: 0,
        admitGeneral: 0,
        referIn: 0,
        referOut: 0,
        reservePrivateRoom: 0,
        cancelPrivateRoom: 0
      };
      var refReasons = [];
      var refRowCount = 0;
      var refKeys = ['admitPrivate', 'admitGeneral', 'referIn', 'referOut', 'reservePrivateRoom', 'cancelPrivateRoom'];
      for (var rfi = 0; rfi < wlRef.rows.length; rfi++) {
        var rfr = wlRef.rows[rfi];
        var rfd = normalizeSheetDateGas_(rfr[wRefOff]);
        if (!rfd || rfd < startYmd || rfd > endYmd) continue;
        var rfClinic = String(rfr[wRefOff + 2] || '').trim();
        var rfMeta = parseWorkloadMetaGas_(rfr[wRefOff + 13]);
        if (rfClinic.indexOf('ส่งต่อ') === -1 && !rfMeta.referralData) continue;
        refRowCount += 1;
        var rd = rfMeta.referralData || {};
        for (var rki = 0; rki < refKeys.length; rki++) {
          var rk = refKeys[rki];
          var itemObj = rd[rk];
          if (itemObj) {
            refTotals[rk] += (Number(itemObj.count || 0) || 0);
            if (itemObj.reason) refReasons.push('• ' + rk + ': ' + itemObj.reason);
          }
        }
      }
      if (refRowCount === 0) {
        replySections.push('🚑 ไม่พบข้อมูลบันทึกของ "ศูนย์รับ - ส่งต่อผู้ป่วย" ประจำ' + dateHeader + ' ครับ');
      } else {
        var grandRef = refTotals.admitPrivate + refTotals.admitGeneral + refTotals.referIn + refTotals.referOut + refTotals.reservePrivateRoom + refTotals.cancelPrivateRoom;
        replySections.push(
          '🚑 สรุปข้อมูลศูนย์รับ - ส่งต่อผู้ป่วย ประจำ' + dateHeader + ' (รวม ' + grandRef + ' รายการ จาก ' + refRowCount + ' บันทึก):\n' +
          '• Admit พิเศษ: ' + refTotals.admitPrivate + ' ราย\n' +
          '• Admit สามัญ: ' + refTotals.admitGeneral + ' ราย\n' +
          '• Refer in (รับเข้า): ' + refTotals.referIn + ' ราย\n' +
          '• Refer out (ส่งต่อ): ' + refTotals.referOut + ' ราย\n' +
          '• จองห้องพิเศษ: ' + refTotals.reservePrivateRoom + ' ราย\n' +
          '• ยกเลิกห้องพิเศษ: ' + refTotals.cancelPrivateRoom + ' ราย' +
          (refReasons.length > 0 ? '\n📝 เหตุผล/หมายเหตุ:\n' + refReasons.slice(0, 6).join('\n') : '')
        );
      }
    }

    // --- Section: Off-Duty Clinics & Daily-Wage Staff Off-Duty ---
    if (asksOffDuty) {
      var wlOff = getWlDataGas();
      var wOffIdx = (wlOff.headers[0] === 'Record_ID') ? 1 : 0;
      var offClinics = [];
      var offStaffList = [];
      for (var ofi = 0; ofi < wlOff.rows.length; ofi++) {
        var ofr = wlOff.rows[ofi];
        var ofd = normalizeSheetDateGas_(ofr[wOffIdx]);
        if (!ofd || ofd < startYmd || ofd > endYmd) continue;
        var ofSh = String(ofr[wOffIdx + 1] || '').trim();
        var ofCl = String(ofr[wOffIdx + 2] || '').trim();
        var ofMeta = parseWorkloadMetaGas_(ofr[wOffIdx + 13]);
        var dTagOff = isRange ? ('[' + formatCompactThaiDate(ofd) + '] ') : '';
        if (ofMeta.isOffDuty) {
          offClinics.push('• ' + dTagOff + ofCl + ' (' + ofSh + ')' + (ofMeta.offDutyReason ? ' — ' + ofMeta.offDutyReason : ''));
        }
        if (ofMeta.offDutyStaff.length > 0) {
          for (var osi = 0; osi < ofMeta.offDutyStaff.length; osi++) {
            var os = ofMeta.offDutyStaff[osi];
            offStaffList.push(
              '• ' + dTagOff + os.staffName + ' (' + os.position + ' • ' + ofCl + ') — ' +
              (os.amount === 0.5 ? ('0.5 แรง [' + (os.periodLabel || 'ครึ่งเวร') + ']') : '1 แรง') +
              (os.reason ? (' (' + os.reason + ')') : '')
            );
          }
        }
      }
      if (offClinics.length === 0 && offStaffList.length === 0) {
        replySections.push('✅ ไม่พบรายการ Off เวรห้องตรวจหรือ Off เวรพนักงานรายวัน ประจำ' + dateHeader + ' ครับ');
      } else {
        replySections.push(
          '🏖️ รายการ Off เวร ประจำ' + dateHeader + ':\n' +
          (offClinics.length > 0 ? ('🏥 ปิดคลินิก/Off เวร (' + offClinics.length + '):\n' + offClinics.slice(0, 15).join('\n') + '\n') : '') +
          (offStaffList.length > 0 ? ('👤 พนักงานรายวัน Off เวร (' + offStaffList.length + ' คน):\n' + offStaffList.slice(0, 15).join('\n')) : '')
        );
      }
    }

    // --- Section: Staff Directory / Personal Info (Active, Resigned, Retired, Daily-Wage) ---
    if (asksStaffInfo) {
      if (matchedStaff.length > 0) {
        var pLines = matchedStaff.slice(0, 5).map(function(st) {
          return '👤 ' + st.name +
            (st.pos ? '\n• ตำแหน่ง: ' + st.pos : '') +
            (st.clinic ? '\n• หน่วยหลัก: ' + st.clinic : '') +
            (st.empCode ? '\n• รหัสบุคลากร: ' + st.empCode : '') +
            (st.status ? '\n• สถานะ: ' + st.status : '');
        });
        replySections.push(pLines.join('\n\n'));
      } else if (txt.indexOf('ลาออก') !== -1 || txt.indexOf('เกษียณ') !== -1) {
        var wantStatus = txt.indexOf('เกษียณ') !== -1 ? 'Retired' : 'Resigned';
        var stMatched = staffData.rows.filter(function(r) { return String(r[4] || '').trim() === wantStatus; });
        var stLabel = wantStatus === 'Retired' ? 'เกษียณอายุ (Retired)' : 'ลาออก/ย้าย (Resigned)';
        if (stMatched.length > 0) {
          replySections.push(
            '📋 รายชื่อบุคลากรสถานะ ' + stLabel + ' (' + stMatched.length + ' คน):\n' +
            stMatched.slice(0, 25).map(function(r, idx) {
              return (idx + 1) + '. ' + String(r[1] || '').trim() + ' (' + String(r[2] || '').trim() + ' • ' + String(r[3] || '').trim() + ')';
            }).join('\n')
          );
        } else {
          replySections.push('✅ ไม่มีบุคลากรสถานะ ' + stLabel + ' ใน Staff_Master ครับ');
        }
      } else if (txt.indexOf('รายวัน') !== -1) {
        var dwStaff = staffData.rows.filter(function(r) {
          return String(r[4] || 'Active').trim() === 'Active' && String(r[2] || '').indexOf('รายวัน') !== -1;
        });
        if (dwStaff.length > 0) {
          replySections.push(
            '👥 บุคลากรตำแหน่งจ้างรายวัน (Active ' + dwStaff.length + ' คน):\n' +
            dwStaff.slice(0, 30).map(function(r, idx) {
              return (idx + 1) + '. ' + String(r[1] || '').trim() + ' (' + String(r[2] || '').trim() + ' • ' + String(r[3] || '').trim() + ')';
            }).join('\n')
          );
        } else {
          replySections.push('✅ ไม่พบรายชื่อตำแหน่งจ้างรายวันใน Staff_Master ครับ');
        }
      } else if (matchedClinic) {
        var cStaff = staffExtract.directoryList.filter(function(st) {
          return st.status !== 'Inactive' && st.status !== 'Resigned' && st.status !== 'Retired' &&
            st.clinic && st.clinic.toLowerCase().indexOf(matchedClinic.toLowerCase()) !== -1;
        });
        if (cStaff.length > 0) {
          var csLines = cStaff.slice(0, 30).map(function(st, idx) {
            return (idx + 1) + '. ' + st.name + (st.pos ? ' (' + st.pos + ')' : '');
          });
          replySections.push('👩‍⚕️ บุคลากรประจำ "' + matchedClinic + '" (' + cStaff.length + ' คน):\n' + csLines.join('\n'));
        } else {
          replySections.push('🔍 ไม่พบรายชื่อบุคลากรประจำ "' + matchedClinic + '" ใน Staff_Master ครับ');
        }
      } else {
        var activeStaffRows = staffData.rows.filter(function(r) { return String(r[1] || '').trim() && String(r[4] || 'Active').trim() === 'Active'; });
        var resignedCnt = staffData.rows.filter(function(r) { return String(r[4] || '').trim() === 'Resigned'; }).length;
        var retiredCnt = staffData.rows.filter(function(r) { return String(r[4] || '').trim() === 'Retired'; }).length;
        var posCounts = {};
        activeStaffRows.forEach(function(r) {
          var pKey = String(r[2] || 'ไม่ระบุ').trim();
          posCounts[pKey] = (posCounts[pKey] || 0) + 1;
        });
        var posSummary = Object.keys(posCounts).map(function(k) { return '• ' + k + ': ' + posCounts[k] + ' คน'; });
        replySections.push(
          '👩‍⚕️ สรุปบุคลากร OPD (Staff_Master ทั้งหมด ' + staffData.rows.length + ' คน):\n' +
          '• ปฏิบัติงาน (Active): ' + activeStaffRows.length + ' คน | ลาออก/ย้าย: ' + resignedCnt + ' | เกษียณ: ' + retiredCnt + '\n' +
          posSummary.join('\n')
        );
      }
    }

    // --- Section: Thai Fiscal Year Summary (Oct - Sep, Menu 2) ---
    if (asksFiscalSummary) {
      var fyYearMatch = txt.match(/(?:ปีงบ(?:ประมาณ)?\s*)(25\d{2}|20\d{2})/);
      var curCeY = Number(todayYmd.slice(0, 4));
      var curCeM = Number(todayYmd.slice(5, 7));
      var fyBe = curCeM >= 10 ? (curCeY + 544) : (curCeY + 543);
      if (fyYearMatch) {
        var rawFy = Number(fyYearMatch[1]);
        fyBe = rawFy >= 2400 ? rawFy : (rawFy + 543);
      }
      var fyStartCe = fyBe - 543 - 1;
      var fyStartYmd = fyStartCe + '-10-01';
      var fyEndYmd = (fyStartCe + 1) + '-09-30';
      var personToksFy = matchedStaff.length > 0 ? matchedStaff.map(function(s) { return stripThaiHonorificsGas_(s.name); }) : [];

      var fyLeaveDays = 0;
      var fyLeaveTotal = 0;
      var fyTrainingCount = 0;
      var fyTrainingDays = 0;
      for (var fli = 0; fli < leaveData.rows.length; fli++) {
        var flr = leaveData.rows[fli];
        var fls = normalizeSheetDateGas_(flr[lOff]);
        if (!fls || fls < fyStartYmd || fls > fyEndYmd) continue;
        var flCl = String(flr[lOff + 4] || '').trim();
        if (matchedClinic && flCl.toLowerCase().indexOf(matchedClinic.toLowerCase()) === -1) continue;
        if (personToksFy.length > 0) {
          var flNm = stripThaiHonorificsGas_(flr[lOff + 2]);
          var flOk = personToksFy.some(function(pt) { return pt && (flNm.indexOf(pt) !== -1 || pt.indexOf(flNm) !== -1); });
          if (!flOk) continue;
        }
        fyLeaveTotal += 1;
        var fdVal = Number(flr[lOff + 6] || 1) || 1;
        var flTyp = String(flr[lOff + 5] || '');
        if (flTyp.indexOf('อบรม') !== -1 || flTyp.indexOf('ประชุม') !== -1) {
          fyTrainingCount += 1;
          fyTrainingDays += fdVal;
        } else {
          fyLeaveDays += fdVal;
        }
      }

      var fyOtCount = 0;
      var fyOtHrs = 0;
      var fyOtPeopleMap = {};
      for (var foi = 0; foi < otData.rows.length; foi++) {
        var forow = otData.rows[foi];
        var fod = normalizeSheetDateGas_(forow[oOff]);
        if (!fod || fod < fyStartYmd || fod > fyEndYmd) continue;
        var foCl = String(forow[oOff + 5] || '').trim();
        if (matchedClinic && foCl.toLowerCase().indexOf(matchedClinic.toLowerCase()) === -1) continue;
        var foName = String(forow[oOff + 2] || '').trim();
        if (personToksFy.length > 0) {
          var foNm = stripThaiHonorificsGas_(foName);
          var foOk = personToksFy.some(function(pt) { return pt && (foNm.indexOf(pt) !== -1 || pt.indexOf(foNm) !== -1); });
          if (!foOk) continue;
        }
        fyOtCount += 1;
        if (foName) fyOtPeopleMap[foName] = true;
        var fHrs = Number(forow[oOff + 6]);
        if (!isFinite(fHrs) || fHrs <= 0) {
          fHrs = String(forow[oOff + 1] || '').indexOf('ในเวลาราชการ') !== -1 ? 7 : 4;
        }
        fyOtHrs += fHrs;
      }
      var fyOtPeople = Object.keys(fyOtPeopleMap).length;
      replySections.push(
        '📊 สรุปวันลา/อบรม & OT ปีงบประมาณ ' + fyBe + ' (ต.ค. ' + (fyBe - 1 - 2500) + ' – ก.ย. ' + (fyBe - 2500) + ')' +
        (matchedStaff.length > 0 ? (' — ' + matchedStaff[0].name) : matchedClinic ? (' — ' + matchedClinic) : '') + ':\n' +
        '• วันลาจริง (ไม่รวมอบรม): ' + fyLeaveDays + ' วันทำการ (' + (fyLeaveTotal - fyTrainingCount) + ' รายการ)\n' +
        '• ไปอบรม/ประชุม: ' + fyTrainingCount + ' ครั้ง (' + fyTrainingDays + ' วัน)\n' +
        '• เวรนอกเวลา (OT): ' + fyOtCount + ' เวร (' + fyOtPeople + ' คน) • รวม ' + fyOtHrs + ' ชม.'
      );
    }

    // --- Section: OT Payment Proof / Payroll Summary (Menu 2) ---
    if (asksOtPayment) {
      var payStart = startYmd;
      var payEnd = endYmd;
      var payHeader = dateHeader;
      if (!hasExplicitDate) {
        var pBp = todayYmd.split('-').map(Number);
        var pLast = new Date(Date.UTC(pBp[0], pBp[1], 0)).getUTCDate();
        var pMm = (pBp[1] < 10 ? '0' : '') + pBp[1];
        var pDd = (pLast < 10 ? '0' : '') + pLast;
        payStart = pBp[0] + '-' + pMm + '-01';
        payEnd = pBp[0] + '-' + pMm + '-' + pDd;
        payHeader = 'เดือนนี้ (' + thaiShortMonths[pBp[1] - 1] + ' ' + (pBp[0] + 543) + ')';
      }
      var otRatesPayMap = {};
      try { otRatesPayMap = JSON.parse(settingsMap['OT_Hourly_Rates'] || '{}') || {}; } catch (ePayR) {}
      var matchedPayOt = [];
      for (var poi = 0; poi < otData.rows.length; poi++) {
        var porow = otData.rows[poi];
        var pod = normalizeSheetDateGas_(porow[oOff]);
        if (!pod || pod < payStart || pod > payEnd) continue;
        var poWorkCl = String(porow[oOff + 5] || '').trim();
        var poShift = String(porow[oOff + 1] || '').trim();
        if (matchedClinic && poWorkCl.toLowerCase().indexOf(matchedClinic.toLowerCase()) === -1) continue;
        if (shiftFilter === 'OUT_TIME_ALL' && poShift.indexOf('ในเวลา 08:00') === 0) continue;
        else if (shiftFilter && shiftFilter !== 'OUT_TIME_ALL' && poShift !== shiftFilter) continue;
        matchedPayOt.push(porow);
      }
      if (matchedPayOt.length === 0) {
        replySections.push('💰 ไม่พบข้อมูลเวร OT สำหรับคำนวณหลักฐานจ่ายประจำ' + payHeader + ' ครับ');
      } else {
        var pTotalHrs = 0;
        var pTotalGross = 0;
        var pOpdCnt = 0;
        var pExtCnt = 0;
        var pPeopleMap = {};
        var pPosStats = {};
        for (var pmi = 0; pmi < matchedPayOt.length; pmi++) {
          var pmr = matchedPayOt[pmi];
          var pmSh = String(pmr[oOff + 1] || '');
          var pmHrs = Number(pmr[oOff + 6]);
          if (!isFinite(pmHrs) || pmHrs <= 0) pmHrs = pmSh.indexOf('ในเวลาราชการ') !== -1 ? 7 : 4;
          var pmPos = String(pmr[oOff + 3] || 'RN').trim();
          var pmRate = getOtHourlyRateGas_(pmPos, otRatesPayMap);
          var pmGross = pmHrs * pmRate;
          pTotalHrs += pmHrs;
          pTotalGross += pmGross;
          var pmName = String(pmr[oOff + 2] || '').trim();
          if (pmName) pPeopleMap[pmName] = true;
          var pmHome = String(pmr[oOff + 4] || '').trim();
          if (pmHome.indexOf('ภายนอก') !== -1 || pmHome.indexOf('เฉพาะกิจ') !== -1) pExtCnt += 1;
          else pOpdCnt += 1;
          if (!pPosStats[pmPos]) pPosStats[pmPos] = { hrs: 0, gross: 0 };
          pPosStats[pmPos].hrs += pmHrs;
          pPosStats[pmPos].gross += pmGross;
        }
        var pTax5 = Math.round(pTotalGross * 0.05 * 100) / 100;
        var pNetPay = pTotalGross - pTax5;
        var pPosLines = Object.keys(pPosStats).map(function(p) {
          return '• ' + p + ' (' + getOtHourlyRateGas_(p, otRatesPayMap) + ' บ./ชม.): ' + pPosStats[p].hrs + ' ชม. = ' + pPosStats[p].gross.toLocaleString() + ' บ.';
        });
        replySections.push(
          '💰 สรุปหลักฐานจ่ายค่าตอบแทน OT' + (matchedClinic ? ' (' + matchedClinic + ')' : '') + ' ประจำ' + payHeader + ':\n' +
          '• จำนวน ' + Object.keys(pPeopleMap).length + ' คน (' + matchedPayOt.length + ' เวร: OPD ' + pOpdCnt + ' / เฉพาะกิจ ' + pExtCnt + ') • ' + pTotalHrs + ' ชม.\n' +
          '• ยอดเบิกก่อนหักภาษี: ' + pTotalGross.toLocaleString() + ' บาท\n' +
          '• หักภาษี ณ ที่จ่าย 5%: ' + pTax5.toLocaleString() + ' บาท\n' +
          '• รับสุทธิทั้งหมด: ' + pNetPay.toLocaleString() + ' บาท\n' +
          pPosLines.slice(0, 6).join('\n')
        );
      }
    }

    // --- Section: Leave Records (Supports Person-Centric Open Search + Date/Clinic/Type Filters) ---
    if (asksLeave) {
      var leaveRowsAll = leaveData.rows;
      var matchedLeaves = [];
      var leaveTypeFilter = '';
      if (txtNoTimeWord.indexOf('ลาป่วย') !== -1) leaveTypeFilter = 'ลาป่วย';
      else if (txtNoTimeWord.indexOf('ลากิจ') !== -1) leaveTypeFilter = 'ลากิจ';
      else if (txtNoTimeWord.indexOf('ลาพัก') !== -1) leaveTypeFilter = 'ลาพัก';
      else if (txtNoTimeWord.indexOf('อบรม') !== -1 || txtNoTimeWord.indexOf('ประชุม') !== -1) leaveTypeFilter = 'อบรม';

      var personTokens = matchedStaff.length > 0
        ? matchedStaff.map(function(st) { return stripThaiHonorificsGas_(st.name); })
        : (candidateName ? [stripThaiHonorificsGas_(candidateName)] : []);

      for (var lri = 0; lri < leaveRowsAll.length; lri++) {
        var lr = leaveRowsAll[lri];
        var lsDate = normalizeSheetDateGas_(lr[lOff]);
        var leDate = normalizeSheetDateGas_(lr[lOff + 1]) || lsDate;
        var lsName = String(lr[lOff + 2] || '').trim();
        var lClinic = String(lr[lOff + 4] || '').trim();
        var lType = String(lr[lOff + 5] || 'ลา').trim();
        if (!lsDate || !lsName) continue;

        if (isPersonQuery) {
          var normLs = stripThaiHonorificsGas_(lsName);
          var matchedName = personTokens.some(function(pt) {
            return pt && (normLs.indexOf(pt) !== -1 || pt.indexOf(normLs) !== -1);
          });
          if (!matchedName) continue;
          if (hasExplicitDate && (lsDate > endYmd || leDate < startYmd)) continue;
        } else {
          if (lsDate > endYmd || leDate < startYmd) continue;
          if (matchedClinic && lClinic.toLowerCase().indexOf(matchedClinic.toLowerCase()) === -1) continue;
        }
        if (leaveTypeFilter && lType.indexOf(leaveTypeFilter) === -1) continue;

        matchedLeaves.push({
          sDate: lsDate,
          eDate: leDate,
          name: lsName,
          pos: String(lr[lOff + 3] || '').trim(),
          clinic: lClinic,
          leaveType: lType,
          days: Number(lr[lOff + 6] || 1),
          note: String(lr[lOff + 7] || '').trim()
        });
      }

      var targetPersonLabel = matchedStaff.length > 0 ? matchedStaff[0].name : candidateName;
      if (isPersonQuery) {
        if (matchedLeaves.length > 0) {
          matchedLeaves.sort(function(a, b) {
            var aUp = a.eDate >= todayYmd ? 0 : 1;
            var bUp = b.eDate >= todayYmd ? 0 : 1;
            if (aUp !== bUp) return aUp - bUp;
            return aUp === 0 ? (a.sDate < b.sDate ? -1 : 1) : (a.sDate > b.sDate ? -1 : 1);
          });
          var totalDays = 0;
          var pLeaveLines = matchedLeaves.slice(0, 20).map(function(item, idx) {
            totalDays += (isFinite(item.days) && item.days > 0 ? item.days : 1);
            var tag = item.eDate >= todayYmd ? '🔜 ' : '📌 ';
            var dStr = formatShortThaiDate(item.sDate) + (item.eDate !== item.sDate ? ' ถึง ' + formatShortThaiDate(item.eDate) : '');
            var periodMatch = item.note.match(/\[(ครึ่งวันเช้า|ครึ่งวันบ่าย)\]/);
            var periodTxt = periodMatch ? ' [' + periodMatch[1] + ']' : '';
            return (idx + 1) + '. ' + tag + dStr + ' — ' + item.leaveType + periodTxt + (item.days ? ' (' + item.days + ' วัน)' : '');
          });
          var extraL = matchedLeaves.length > 20 ? '\n...และอีก ' + (matchedLeaves.length - 20) + ' รายการ' : '';
          replySections.push(
            '🗓️ ประวัติวันลาของ "' + targetPersonLabel + '"' + (hasExplicitDate ? ' ประจำ' + dateHeader : ' (ทั้งหมดในระบบ)') + ':\n' +
            'รวม ' + matchedLeaves.length + ' รายการ (' + totalDays + ' วันทำการ)\n' +
            pLeaveLines.join('\n') + extraL
          );
        } else {
          replySections.push(
            '✅ ไม่พบข้อมูลวันลาของ "' + targetPersonLabel + '"' +
            (hasExplicitDate ? ' ประจำ' + dateHeader : ' ในระบบครับ')
          );
        }
      } else if (matchedLeaves.length > 0) {
        var leaveLines = matchedLeaves.slice(0, 35).map(function(item, idx) {
          var periodMatch = item.note.match(/\[(ครึ่งวันเช้า|ครึ่งวันบ่าย)\]/);
          var periodTxt = periodMatch ? ' [' + periodMatch[1] + ']' : '';
          var dateSpan = isRange
            ? ' [' + formatCompactThaiDate(item.sDate) + (item.eDate !== item.sDate ? ' - ' + formatCompactThaiDate(item.eDate) : '') + ']'
            : '';
          var meta = [item.pos, item.clinic].filter(Boolean).join(' • ');
          return (idx + 1) + '. ' + item.name + (meta ? ' (' + meta + ')' : '') + ' — ' + item.leaveType + periodTxt + dateSpan;
        });
        replySections.push(
          '🏥 รายชื่อผู้ลา' + (matchedClinic ? ' (' + matchedClinic + ')' : '') + ' ประจำ' + dateHeader + ':\nรวม ' + matchedLeaves.length + ' รายการ\n' + leaveLines.join('\n')
        );
      } else {
        replySections.push('✅ ไม่พบรายชื่อผู้ลา' + (matchedClinic ? ' (' + matchedClinic + ')' : '') + ' ประจำ' + dateHeader + ' ครับ');
      }
    }

    // --- Section: OT / นอกเวลา (Supports Person-Centric, Clinic, Shift, Hours & Pay Estimation) ---
    if (asksOt) {
      var otRatesMap = {};
      try { otRatesMap = JSON.parse(settingsMap['OT_Hourly_Rates'] || '{}') || {}; } catch (e) {}
      var otRowsAll = otData.rows;
      var matchedOt = [];
      var uniqueOtPeople = {};
      var totalOtHrs = 0;
      var totalOtPay = 0;
      var personTokensOt = matchedStaff.length > 0
        ? matchedStaff.map(function(st) { return stripThaiHonorificsGas_(st.name); })
        : (candidateName ? [stripThaiHonorificsGas_(candidateName)] : []);

      for (var oi = 0; oi < otRowsAll.length; oi++) {
        var orow = otRowsAll[oi];
        var oDate = normalizeSheetDateGas_(orow[oOff]);
        var oName = String(orow[oOff + 2] || '').trim();
        var oPos = String(orow[oOff + 3] || '').trim();
        var oShift = String(orow[oOff + 1] || '').trim();
        var oWorkClinic = String(orow[oOff + 5] || '').trim();
        if (!oDate || !oName) continue;

        if (isPersonQuery) {
          var normOn = stripThaiHonorificsGas_(oName);
          var okName = personTokensOt.some(function(pt) {
            return pt && (normOn.indexOf(pt) !== -1 || pt.indexOf(normOn) !== -1);
          });
          if (!okName) continue;
          if (hasExplicitDate && (oDate < startYmd || oDate > endYmd)) continue;
        } else {
          if (oDate < startYmd || oDate > endYmd) continue;
          if (matchedClinic && oWorkClinic.toLowerCase().indexOf(matchedClinic.toLowerCase()) === -1) continue;
        }
        if (shiftFilter === 'OUT_TIME_ALL' && oShift.indexOf('ในเวลา 08:00') === 0) continue;
        else if (shiftFilter && shiftFilter !== 'OUT_TIME_ALL' && oShift !== shiftFilter) continue;

        var oHrsNum = Number(orow[oOff + 6]);
        if (!isFinite(oHrsNum) || oHrsNum <= 0) {
          oHrsNum = oShift.indexOf('ในเวลาราชการ') !== -1 ? 7 : 4;
        }
        var rate = getOtHourlyRateGas_(oPos, otRatesMap);
        var pay = oHrsNum * rate;
        totalOtHrs += oHrsNum;
        totalOtPay += pay;
        uniqueOtPeople[oName] = true;
        matchedOt.push({
          date: oDate,
          name: oName,
          pos: oPos,
          workClinic: oWorkClinic,
          shift: oShift,
          hours: oHrsNum,
          pay: pay
        });
      }

      var otTargetPerson = matchedStaff.length > 0 ? matchedStaff[0].name : candidateName;
      if (isPersonQuery) {
        if (matchedOt.length > 0) {
          matchedOt.sort(function(a, b) { return a.date > b.date ? -1 : a.date < b.date ? 1 : 0; });
          var pOtLines = matchedOt.slice(0, 25).map(function(item, idx) {
            return (idx + 1) + '. ' + formatShortThaiDate(item.date) + ' • ' + (item.workClinic || 'นอกเวลา') + ' (' + item.hours + ' ชม. ≈ ' + item.pay.toLocaleString() + ' บ.)';
          });
          replySections.push(
            '⏰ ประวัติขึ้นเวร OT ของ "' + otTargetPerson + '"' + (hasExplicitDate ? ' ประจำ' + dateHeader : ' (ทั้งหมดในระบบ)') + ':\n' +
            'รวม ' + matchedOt.length + ' เวร • ' + totalOtHrs + ' ชม. (ประมาณ ' + totalOtPay.toLocaleString() + ' บาท)\n' +
            pOtLines.join('\n')
          );
        } else {
          replySections.push(
            '✅ ไม่พบข้อมูลขึ้นเวร OT ของ "' + otTargetPerson + '"' +
            (hasExplicitDate ? ' ประจำ' + dateHeader : ' ในระบบครับ')
          );
        }
      } else if (matchedOt.length > 0) {
        matchedOt.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        var uniqueCount = Object.keys(uniqueOtPeople).length;
        var otLines = matchedOt.slice(0, 40).map(function(item, idx) {
          var dTag = isRange ? '[' + formatCompactThaiDate(item.date) + '] ' : '';
          return (idx + 1) + '. ' + dTag + item.name + (item.pos ? ' (' + item.pos + ')' : '') + ' • ' + (item.workClinic || 'นอกเวลา') + (item.shift ? ' [' + item.shift + ']' : '') + ' (' + item.hours + ' ชม.)';
        });
        var extraNote = matchedOt.length > 40 ? '\n...และอีก ' + (matchedOt.length - 40) + ' รายการ' : '';
        var countSummary = uniqueCount === matchedOt.length
          ? 'รวม ' + uniqueCount + ' คน • ' + totalOtHrs + ' ชม. (ประมาณ ' + totalOtPay.toLocaleString() + ' บ.)'
          : 'รวม ' + uniqueCount + ' คน (' + matchedOt.length + ' รายการ) • ' + totalOtHrs + ' ชม. (ประมาณ ' + totalOtPay.toLocaleString() + ' บ.)';
        replySections.push('⏰ รายชื่อผู้ปฏิบัติงาน OT / นอกเวลา' + (matchedClinic ? ' (' + matchedClinic + ')' : '') + ' ประจำ' + dateHeader + ':\n' + countSummary + '\n' + otLines.join('\n') + extraNote);
      } else {
        replySections.push('✅ ไม่พบข้อมูลเวร OT' + (matchedClinic ? ' (' + matchedClinic + ')' : '') + ' ประจำ' + dateHeader + ' ในระบบครับ');
      }
    }

    // --- Section: Workload & Productivity (Daily_Workload + NHPPD) ---
    if (asksWorkload || asksProductivity) {
      var wlData = getWlDataGas();
      var wOff = (wlData.headers[0] === 'Record_ID') ? 1 : 0;
      var wlStart = startYmd;
      var wlEnd = endYmd;
      var wlHeader = dateHeader;
      if (asksProductivity && !hasExplicitDate) {
        var bParts = todayYmd.split('-').map(Number);
        var mLastDay = new Date(Date.UTC(bParts[0], bParts[1], 0)).getUTCDate();
        var wMmStr = (bParts[1] < 10 ? '0' : '') + bParts[1];
        var wDdStr = (mLastDay < 10 ? '0' : '') + mLastDay;
        wlStart = bParts[0] + '-' + wMmStr + '-01';
        wlEnd = bParts[0] + '-' + wMmStr + '-' + wDdStr;
        wlHeader = 'เดือนนี้ (' + thaiShortMonths[bParts[1] - 1] + ' ' + (bParts[0] + 543) + ')';
      }

      var excludeLasik = /(?:ไม่รวมเลสิก|คัดเลสิก|ไม่นับเลสิก|ยกเว้นเลสิก)/.test(txt);
      var excludeReferral = /(?:ไม่รวมศูนย์รับ|คัดศูนย์รับ|ไม่นับศูนย์รับ)/.test(txt);
      var asksLowest = /(?:ต่ำสุด|น้อยสุด)/.test(txt);

      var generalNhppd = Number(settingsMap['NHPPD']) > 0 ? Number(settingsMap['NHPPD']) : 0.4;
      var screeningNhppd = Number(settingsMap['Screening_NHPPD']) > 0 ? Number(settingsMap['Screening_NHPPD']) : 0.1;
      var stdHr = Number(settingsMap['Std_Hr']) > 0 ? Number(settingsMap['Std_Hr']) : 7;
      var annualHr = Number(settingsMap['Annual_Hr']) > 0 ? Number(settingsMap['Annual_Hr']) : 2080;
      var workDays = Number(settingsMap['Work_Days']) > 0 ? Number(settingsMap['Work_Days']) : 245;

      var allWlDates = {};
      var matchedWl = [];
      for (var wi = 0; wi < wlData.rows.length; wi++) {
        var wr = wlData.rows[wi];
        var wd = normalizeSheetDateGas_(wr[wOff]);
        var wShift = String(wr[wOff + 1] || '').trim();
        var wClinic = String(wr[wOff + 2] || '').trim();
        if (!wd || !wClinic) continue;
        allWlDates[wd] = true;
        if (wd < wlStart || wd > wlEnd) continue;
        if (shiftFilter === 'OUT_TIME_ALL' && wShift === 'ในเวลา 08:00-16:00') continue;
        else if (shiftFilter && shiftFilter !== 'OUT_TIME_ALL' && wShift !== shiftFilter) continue;

        var recType = String(wr[wOff + 17] || '').trim().toUpperCase();
        var isPrem = (wClinic.indexOf('ปัญญาภิรมย์') !== -1 || /-Premium$/i.test(wClinic) || recType === 'PREMIUM_SUB' || recType === 'PREMIUM_POOL');
        var groupClinic = isPrem ? 'ศูนย์ปัญญาภิรมย์' : wClinic;
        if (excludeLasik && groupClinic.indexOf('เลสิก') !== -1) continue;
        if (excludeReferral && groupClinic.indexOf('ส่งต่อ') !== -1) continue;
        if (matchedClinic && groupClinic.toLowerCase().indexOf(matchedClinic.toLowerCase()) === -1 && wClinic.toLowerCase().indexOf(matchedClinic.toLowerCase()) === -1) {
          continue;
        }
        var pt = Math.max(Number(wr[wOff + 3] || 0), Number(wr[wOff + 4] || 0) + Number(wr[wOff + 5] || 0));
        matchedWl.push({
          date: wd,
          shift: wShift,
          clinic: wClinic,
          groupClinic: groupClinic,
          recType: recType,
          totalPt: pt,
          adultPt: Number(wr[wOff + 4] || 0),
          childPt: Number(wr[wOff + 5] || 0),
          admit: Number(wr[wOff + 6] || 0),
          hn: Number(wr[wOff + 7] || 0),
          rn: Number(wr[wOff + 8] || 0),
          pn: Number(wr[wOff + 9] || 0),
          na: Number(wr[wOff + 10] || 0),
          clerk: Number(wr[wOff + 11] || 0),
          sw: Number(wr[wOff + 12] || 0),
          note: String(wr[wOff + 13] || '').trim()
        });
      }

      if (matchedWl.length === 0) {
        var latestDates = Object.keys(allWlDates).sort();
        var latestHint = latestDates.length > 0 ? '\n💡 ล่าสุดที่มีข้อมูลในระบบคือ ' + formatShortThaiDate(latestDates[latestDates.length - 1]) : '';
        var missShiftTag = (shiftFilter && shiftFilter !== 'OUT_TIME_ALL') ? (' [' + shiftFilter + ']') : '';
        replySections.push('✅ ไม่พบข้อมูลภาระงานผู้ป่วย' + (matchedClinic ? ' (' + matchedClinic + ')' : '') + missShiftTag + ' ประจำ' + wlHeader + ' ครับ' + latestHint);
      } else {
        var sumPt = 0, sumAdult = 0, sumChild = 0, sumAdmit = 0, sumHN = 0, sumRN = 0, sumPN = 0, sumNA = 0, sumClerk = 0, sumSW = 0;
        var activeDaysSet = {};
        var byClinicMap = {};
        matchedWl.forEach(function(r) {
          sumPt += r.totalPt;
          sumAdult += r.adultPt;
          sumChild += r.childPt;
          sumAdmit += r.admit;
          sumHN += r.hn;
          sumRN += r.rn;
          sumPN += r.pn;
          sumNA += r.na;
          sumClerk += r.clerk;
          sumSW += r.sw;
          if (r.totalPt > 0 || (r.rn + r.pn + r.na) > 0) activeDaysSet[r.date] = true;
          if (!byClinicMap[r.groupClinic]) {
            byClinicMap[r.groupClinic] = { name: r.groupClinic, pt: 0, admit: 0, rn: 0, pn: 0, na: 0, days: {} };
          }
          var bc = byClinicMap[r.groupClinic];
          bc.pt += r.totalPt; bc.admit += r.admit; bc.rn += r.rn; bc.pn += r.pn; bc.na += r.na;
          bc.days[r.date] = true;
        });

        var wDaysCount = Object.keys(activeDaysSet).length || 1;
        var totalNursing = sumRN + sumPN + sumNA;
        var avgPtPerDay = sumPt / wDaysCount;
        var admitRatePct = sumPt > 0 ? (sumAdmit / sumPt) * 100 : 0;
        var ptPerNurse = totalNursing > 0 ? (sumPt / totalNursing) : 0;
        var clinicArr = Object.keys(byClinicMap).map(function(k) {
          var c = byClinicMap[k];
          var cd = Object.keys(c.days).length || 1;
          var cNhppd = k === 'หน่วยคัดกรอง' ? screeningNhppd : generalNhppd;
          var cAvgPt = c.pt / cd;
          var cFtc = (cAvgPt * cNhppd) / stdHr;
          var cOut = (cFtc * annualHr) / (workDays * 8);
          var cInput = (c.rn + c.pn + c.na) / cd;
          var cProd = cInput > 0 ? (cOut / cInput) * 100 : 0;
          return { name: k, pt: c.pt, admit: c.admit, nursing: c.rn + c.pn + c.na, prod: cProd, nhppd: cNhppd };
        });
        var ftcSum = 0;
        clinicArr.forEach(function(c) {
          ftcSum += ((c.pt / wDaysCount) * c.nhppd) / stdHr;
        });
        var outputVal = (ftcSum * annualHr) / (workDays * 8);
        var inputVal = totalNursing / wDaysCount;
        var prodPct = inputVal > 0 ? (outputVal / inputVal) * 100 : 0;
        var skillMixPct = totalNursing > 0 ? (sumRN / totalNursing) * 100 : 0;
        var prodStatusTxt = prodPct === 0 ? 'ไม่มีกำลังคน' : (prodPct > 115 ? '🔴 สูงเกินเกณฑ์ (>115% ภาระงานหนัก)' : (prodPct >= 85 ? '🟢 เหมาะสมตามเกณฑ์ (85-115%)' : '🟡 ต่ำกว่าเกณฑ์ (<85%)'));

        if (asksWorkload) {
          var topClinics = clinicArr.slice().sort(function(a, b) {
            return asksLowest ? (a.pt - b.pt) : (b.pt - a.pt);
          }).slice(0, 6).map(function(c, idx) {
            return (idx + 1) + '. ' + c.name + ': ' + c.pt.toLocaleString() + ' ราย' + (c.admit > 0 ? ' (Admit ' + c.admit + ')' : '');
          });
          var wlShiftTag = (shiftFilter && shiftFilter !== 'OUT_TIME_ALL') ? (' [' + shiftFilter + ']') : (shiftFilter === 'OUT_TIME_ALL' ? ' [นอกเวลา]' : '');
          replySections.push(
            '📊 สรุปภาระงานผู้ป่วยนอก' + (matchedClinic ? ' (' + matchedClinic + ')' : '') + wlShiftTag + ' ประจำ' + wlHeader + ' (' + clinicArr.length + ' หน่วย):\n' +
            '👥 ผู้ป่วยรวม: ' + sumPt.toLocaleString() + ' ราย (ผู้ใหญ่ ' + sumAdult.toLocaleString() + ' • เด็ก ' + sumChild.toLocaleString() + ')\n' +
            '🛌 Admit: ' + sumAdmit.toLocaleString() + ' ราย (Admit Rate ' + admitRatePct.toFixed(2) + '%) | สัดส่วน Pt/Nurse: ' + ptPerNurse.toFixed(1) + ' คน/แรง\n' +
            '👩‍⚕️ กำลังคนพยาบาล: ' + totalNursing.toFixed(1) + ' แรง (RN ' + sumRN.toFixed(1) + ' / PN ' + sumPN.toFixed(1) + ' / NA ' + sumNA.toFixed(1) + ')' +
            ((sumHN + sumClerk + sumSW > 0) ? (' • HN ' + sumHN.toFixed(1) + ' / ทั่วไป ' + sumClerk.toFixed(1) + ' / บริการ ' + sumSW.toFixed(1)) : '') +
            (wDaysCount > 1 ? ('\n📆 เฉลี่ย ' + avgPtPerDay.toFixed(1) + ' ราย/วัน (' + wDaysCount + ' วัน)') : '') +
            (!matchedClinic && topClinics.length > 0 ? ('\n🏆 ' + (asksLowest ? 'อันดับคลินิกยอดน้อยสุด' : 'อันดับคลินิกยอดสูงสุด') + ':\n' + topClinics.join('\n')) : '')
          );
        }

        if (asksProductivity) {
          var sortedLoad = clinicArr.filter(function(c) { return c.prod > 0; }).sort(function(a, b) {
            return asksLowest ? (a.prod - b.prod) : (b.prod - a.prod);
          }).slice(0, 4).map(function(c) {
            return '• ' + c.name + ': ' + c.prod.toFixed(1) + '% (' + c.pt.toLocaleString() + ' ราย)';
          });
          replySections.push(
            '📈 วิเคราะห์ Productivity & กำลังคน' + (matchedClinic ? ' (' + matchedClinic + ')' : '') + (excludeLasik ? ' [ไม่รวมเลสิก]' : '') + ' ประจำ' + wlHeader + ':\n' +
            '• Productivity: ' + prodPct.toFixed(1) + '% — ' + prodStatusTxt + '\n' +
            '• Skill Mix (สัดส่วน RN): ' + skillMixPct.toFixed(1) + '%\n' +
            '• Output ต้องการ: ' + outputVal.toFixed(2) + ' แรง/วัน | Input จัดจริง: ' + inputVal.toFixed(2) + ' แรง/วัน (FTC ' + ftcSum.toFixed(2) + ')\n' +
            '• เกณฑ์ NHPPD: ทั่วไป ' + generalNhppd + ' / คัดกรอง ' + screeningNhppd + ' (Std ' + stdHr + ' ชม.)' +
            (!matchedClinic && sortedLoad.length > 0 ? ('\n' + (asksLowest ? '📉 คลินิกภาระงานต่ำสุด' : '🔥 คลินิกภาระงานสูงสุด') + ':\n' + sortedLoad.join('\n')) : '')
          );
        }
      }
    }

    var isPureHelpOrGreeting =
      cmdLower === '' ||
      /(?:วิธีใช้|คู่มือ|คำสั่ง|เมนู|ทำอะไรได้|ความสามารถ|แนะนำตัว|\bbot\b|\bhelp\b)/.test(cmdLower) ||
      (cmdLower.length <= 22 && /^(?:สวัสดี|หวัดดี|ดีครับ|ฮัลโหล|hello|hi|hey)/.test(cmdLower));

    if (replySections.length > 0) {
      replyText = formatBoobyPersonaReplyGas_(replySections.join('\n\n'), speakerCall, replySections.length >= 2);
    } else if (isPureHelpOrGreeting) {
      var rawHelp = '🎩 สวัสดีครับ ' + speakerCall + ' ผม "บูบี้" (Booby) เลขานุการส่วนตัวและผู้ช่วย AI ระบบ OPD รพ.ชลประทาน พร้อมดูแลครบทั้ง 5 เมนูบนเว็บแอปครับ:\n\n' +
        '1️⃣ ภาระงาน & ส่งต่อ/Off เวร: "ยอดภาระงานในเวลาวันนี้", "หน่วยงานไหนยังไม่ได้รายงานบ้าง", "ยอดศูนย์รับ-ส่งต่อ", "ใคร Off เวร"\n' +
        '2️⃣ วันลา อบรม OT & เบิกเงิน: "วันนี้ใครลาบ้าง", "วันศุกร์มี OT กี่คน", "สรุปเงิน OT เดือนนี้", "สรุปปีงบประมาณ"\n' +
        '3️⃣ Productivity & กำลังคน: "Productivity เดือนนี้", "คลินิกไหนโหลดสุด", "Admit Rate วันนี้"\n' +
        '4️⃣ ทะเบียนบุคลากร วันหยุด Cost Center & Audit: "วันหยุดเดือนนี้", "ประวัติแก้ไขล่าสุด", "รายชื่อบุคลากรรายวัน", "Cost Center"\n' +
        '5️⃣ เลขาส่วนตัว & ความจำกลุ่ม: "สรุปผู้บริหาร", "ลงนัด ...", "สั่งงาน: ...", "สรุปแชต: ...", "ร่างประกาศ: ...", "จำไว้ว่า ..."\n' +
        '• "/id" (ดูรหัสห้อง/User ID)';
      replyText = formatBoobyPersonaReplyGas_(rawHelp, speakerCall, true);
    } else {
      // Passive keyword fallback search in scoped Notes if user asks a random topic stored in memory
      if (visibleNotes.length > 0 && /[?？]|ไหม|มั้ย|อะไร|ยังไง|ข้อตกลง|เรื่อง/.test(txt)) {
        var qTokens = txt.replace(/[^\u0E00-\u0E7Fa-z0-9\s]/g, ' ').split(/\s+/).filter(function(tk) {
          return tk.length >= 2 && !/^(?:อะไร|ไหม|มั้ย|เรื่อง|บูบี้|ช่วย|หน่อย|ข้อตกลง|ถาม)$/.test(tk);
        });
        var memMatched = visibleNotes.filter(function(n) {
          return qTokens.some(function(tk) { return n.content.toLowerCase().indexOf(tk) !== -1; });
        });
        if (memMatched.length > 0) {
          var mLines = memMatched.slice(-5).map(function(n, idx) {
            return (idx + 1) + '. [#' + n.id + '] ' + n.content + ' (โดย ' + n.savedBy + ')';
          });
          replyText = formatBoobyPersonaReplyGas_('📒 ' + speakerCall + ' ครับ พบข้อตกลง/บันทึกที่เกี่ยวข้องในความจำ:\n' + mLines.join('\n'), speakerCall, false);
        }
      }
      if (!replyText && (!isGroupChat || isMentioned || isReplyToQuote)) {
        replyText = formatBoobyPersonaReplyGas_(
          '🎩 ' + speakerCall + ' ครับ บูบี้พร้อมช่วยจัดระเบียบงานครับ ลองระบุคำสั่งสั้นๆ เช่น "ยอดภาระงานในเวลาวันนี้", "หน่วยงานไหนยังไม่ได้รายงานบ้าง", "ใครลาวันนี้", หรือพิมพ์ "เมนู" เพื่อดูความสามารถทั้งหมดได้เลยครับ',
          speakerCall,
          false
        );
      }
    }

    if (replyText) {
      if (replyText.length > 4950) replyText = replyText.slice(0, 4900) + '\n...(ข้อความถูกย่อตามขีดจำกัด LINE)';
      replyLineMessageGas_(token, ev.replyToken, replyText);
    }
  }
  return { success: true };
}

function resolveAutoReportTargetDateGas_(mode, bkkTodayYmd) {
  if (mode === 'YESTERDAY') return addDaysIsoGas_(bkkTodayYmd, -1);
  if (mode === 'LATEST_WITH_DATA') {
    var workloadData = getSheetRowsNormalized_(SHEET_NAMES.WORKLOAD, 19);
    var hasId = workloadData.headers[0] === 'Record_ID';
    var off = hasId ? 1 : 0;
    var dates = [];
    workloadData.rows.forEach(function(r) {
      var d = normalizeSheetDateGas_(r[off]);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && dates.indexOf(d) === -1) dates.push(d);
    });
    dates.sort();
    return dates.length > 0 ? dates[dates.length - 1] : bkkTodayYmd;
  }
  return bkkTodayYmd;
}

function canonicalLineScheduleKeyGas_(specificSchedule, extraPayload) {
  var rawId = String((specificSchedule && specificSchedule.id) || (extraPayload && extraPayload.scheduleId) || '').trim().toLowerCase();
  if (rawId === 'sch-regular' || rawId === 'workday_reg') return 'WORKDAY_REG';
  if (rawId === 'sch-ot-weekday' || rawId === 'workday_evening') return 'WORKDAY_EVENING';
  if (rawId === 'sch-ot-holiday' || rawId === 'holiday_morning') return 'HOLIDAY_MORNING';
  var rawTime = String((specificSchedule && specificSchedule.time) || (extraPayload && extraPayload.scheduleTime) || '').trim();
  var parsedTime = rawTime ? parseLineAutoTimeGas_(rawTime).formatted : '';
  var rawShift = String((specificSchedule && specificSchedule.shift) || (extraPayload && extraPayload.shift) || '').replace(/\s+/g, ' ').trim();
  if (parsedTime && rawShift) return parsedTime + '|' + rawShift;
  if (rawId) return rawId.toUpperCase();
  return 'DEFAULT';
}

function sendScheduledCensusReportGas_(sourceTag, specificSchedule, extraPayload) {
  var settingsMap = readSettingsMapGas_();
  var enabled = String(settingsMap['Line_Auto_Enabled'] || '').toLowerCase() === 'true';
  if (!enabled && sourceTag !== 'MANUAL') {
    return { success: false, skipped: true, reason: 'Automation disabled' };
  }

  var token = String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim();
  var targetIds = resolveLineTargetIdsGas_(
    settingsMap,
    extraPayload && extraPayload.targetIds,
    extraPayload && extraPayload.targetId
  );
  var reportDayMode = String(
    (specificSchedule && specificSchedule.reportDayMode) ||
    (extraPayload && extraPayload.reportDayMode) ||
    settingsMap['Line_Auto_Report_Day'] ||
    'TODAY'
  ).trim();
  var shiftFilter = String(
    (specificSchedule && specificSchedule.shift) ||
    (extraPayload && extraPayload.shift) ||
    settingsMap['Line_Auto_Shift'] ||
    'ในเวลา 08:00-16:00'
  ).trim() || 'ในเวลา 08:00-16:00';

  var bkk = getBangkokDatePartsGas_(new Date());
  var bkkMonth = bkk.ymd.slice(0, 7);
  var targetDate = normalizeSheetDateGas_(String((extraPayload && extraPayload.date) || '').trim()) ||
    resolveAutoReportTargetDateGas_(reportDayMode, bkk.ymd);

  var scheduleKey = canonicalLineScheduleKeyGas_(specificSchedule, extraPayload);
  var dedupePropKey = 'LINE_LAST_TRIGGER_BKK_DAY_' + scheduleKey;
  var dedupeImgPropKey = 'LINE_LAST_TRIGGER_BKK_IMG_' + scheduleKey;
  var clientHasImg = Boolean(extraPayload && (extraPayload.imageUrl || extraPayload.imageBase64));

  if (sourceTag !== 'MANUAL') {
    var props = PropertiesService.getScriptProperties();
    var quotaPausedMonth = String(props.getProperty('LINE_QUOTA_EXCEEDED_MONTH') || '').trim();
    if (quotaPausedMonth === bkkMonth) {
      return {
        success: false,
        skipped: true,
        quotaExceeded: true,
        error: 'โควต้าส่งข้อความ Push รายเดือนของ LINE OA เต็มแล้ว (' + bkkMonth + ') ระบบพักการส่งอัตโนมัติจนกว่าจะขึ้นเดือนใหม่',
        reason: 'Monthly LINE Push quota exceeded for ' + bkkMonth
      };
    }
    var lastSentImgDay = String(props.getProperty(dedupeImgPropKey) || '').trim();
    if (lastSentImgDay === bkk.ymd) {
      return {
        success: true,
        skipped: true,
        alreadySentWithImage: true,
        reason: 'Already sent with image today (' + bkk.ymd + ' / ' + scheduleKey + ')'
      };
    }
    if (!(sourceTag === 'CLIENT_AUTO' && clientHasImg)) {
      var lastSentTriggerDay = String(props.getProperty(dedupePropKey) || '').trim();
      if (lastSentTriggerDay === bkk.ymd) {
        return { success: true, skipped: true, reason: 'Already sent today (' + bkk.ymd + ' / ' + scheduleKey + ')' };
      }
    }
  }

  var legacyImgPref = String(settingsMap['Line_Send_As_Image'] || 'true').toLowerCase() !== 'false';
  var resolvedSendFormat = normalizeLineSendFormatGas_(
    (extraPayload && extraPayload.sendFormat) || settingsMap['Line_Send_Format'],
    (specificSchedule && specificSchedule.sendAsImage !== undefined) ? Boolean(specificSchedule.sendAsImage) : legacyImgPref
  );

  // ALWAYS compute live report directly from Google Sheets first to prevent stale 0-clinic client tabs from overriding live data!
  var report = buildDailyCensusLineMessageGas_(targetDate, shiftFilter, settingsMap);
  var extraMsg = String((extraPayload && extraPayload.message) || '').trim();
  var clientClinicCount = (extraPayload && extraPayload.clientClinicCount !== undefined && extraPayload.clientClinicCount !== null)
    ? Number(extraPayload.clientClinicCount)
    : null;
  var clientReportedEmpty = (
    clientClinicCount === 0 ||
    extraMsg.indexOf('ยังไม่พบข้อมูลบันทึกภาระงาน') !== -1 ||
    extraMsg.indexOf('0 คลินิก') !== -1
  );

  var imageUrl = '';
  var previewImageUrl = '';
  var textToSend = report.text;
  var allowFallbackText = (sourceTag === 'AUTO_EXACT' || sourceTag === 'AUTO_TRIGGER' || sourceTag === 'AUTO_BACKUP' || sourceTag === 'AUTO_RETRY');

  if (clientReportedEmpty && report.clinicCount > 0) {
    // Discard stale client 0-clinic JPEG & text; send authoritative Google Sheets report text instead
    allowFallbackText = true;
    textToSend = report.text;
  } else {
    imageUrl = String((extraPayload && extraPayload.imageUrl) || '').trim();
    previewImageUrl = String((extraPayload && extraPayload.previewImageUrl) || imageUrl).trim();
    if (resolvedSendFormat !== 'TEXT_ONLY' && !imageUrl && extraPayload && extraPayload.imageBase64) {
      var upRes = uploadLineReportJpegFromApi_({
        base64Jpeg: extraPayload.imageBase64,
        filename: 'OPD_Census_' + targetDate + '.jpeg'
      });
      if (upRes.success && upRes.imageUrl) {
        imageUrl = upRes.imageUrl;
        previewImageUrl = upRes.previewImageUrl || upRes.imageUrl;
      }
    }
    textToSend = extraMsg || report.text;
  }

  var pushRes = pushLineMessageGas_(
    token,
    targetIds,
    textToSend,
    imageUrl,
    previewImageUrl,
    resolvedSendFormat,
    allowFallbackText
  );
  var nowThai = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');

  if (pushRes.ok) {
    var propsOk = PropertiesService.getScriptProperties();
    propsOk.deleteProperty('LINE_QUOTA_EXCEEDED_MONTH');
    if (sourceTag !== 'MANUAL') {
      propsOk.setProperty(dedupePropKey, bkk.ymd);
      propsOk.setProperty('LINE_LAST_TRIGGER_BKK_DAY', bkk.ymd);
      if (imageUrl) {
        propsOk.setProperty(dedupeImgPropKey, bkk.ymd);
      }
    }
    var schedTag = specificSchedule && specificSchedule.label ? (' [' + specificSchedule.label + ']') : '';
    var imgTag = imageUrl ? ' + ภาพ.jpeg' : '';
    var okStatus = 'ส่งสำเร็จ' + schedTag + imgTag + ' (' + targetIds.length + ' กลุ่ม • ' + report.clinicCount + ' คลินิก, ' + report.totalPt + ' ราย)';
    upsertSettingsEntriesGas_([
      ['Line_Last_Sent_At', nowThai],
      ['Line_Last_Sent_Report_Date', targetDate],
      ['Line_Last_Status', okStatus]
    ]);
    return {
      success: true,
      targetDate: targetDate,
      statusText: okStatus,
      sentAt: nowThai,
      sentCount: pushRes.sentCount,
      imageUrl: imageUrl
    };
  } else {
    if (pushRes.quotaExceeded) {
      PropertiesService.getScriptProperties().setProperty('LINE_QUOTA_EXCEEDED_MONTH', bkkMonth);
    }
    var errStatus = 'ส่งไม่สำเร็จ: ' + pushRes.error;
    upsertSettingsEntriesGas_([
      ['Line_Last_Sent_At', nowThai],
      ['Line_Last_Status', errStatus]
    ]);
    return {
      success: false,
      error: pushRes.error,
      statusText: errStatus,
      quotaExceeded: Boolean(pushRes.quotaExceeded)
    };
  }
}

function hhmmToMinsGas_(hm) {
  var p = parseLineAutoTimeGas_(hm);
  return p.hour * 60 + p.minute;
}

function runDueLineSchedulesGas_(sourceTag) {
  var settingsMap = readSettingsMapGas_();
  var enabled = String(settingsMap['Line_Auto_Enabled'] || '').toLowerCase() === 'true';
  if (!enabled) {
    removeLineTriggersGas_();
    return { needsRetry: false };
  }
  var schedules = getLineSchedulesFromSettingsMap_(settingsMap);
  var bkk = getBangkokDatePartsGas_(new Date());
  var bkkMonth = bkk.ymd.slice(0, 7);
  var propsGlobal = PropertiesService.getScriptProperties();
  if (String(propsGlobal.getProperty('LINE_QUOTA_EXCEEDED_MONTH') || '').trim() === bkkMonth) {
    return { needsRetry: false, quotaExceeded: true };
  }
  var nowMins = hhmmToMinsGas_(bkk.hm);
  var needsRetry = false;
  var legacyImgPref = String(settingsMap['Line_Send_As_Image'] || 'true').toLowerCase() !== 'false';

  for (var i = 0; i < schedules.length; i++) {
    var sch = schedules[i];
    if (!sch || sch.enabled === false) continue;
    if (!matchesLineDayRuleGas_(bkk.ymd, sch.dayRule, settingsMap)) continue;
    var schMins = hhmmToMinsGas_(sch.time);
    var diff = nowMins - schMins;
    // Allow 2 mins early and up to 75 mins catch-up window
    if (diff >= -2 && diff <= 75) {
      var scheduleKey = canonicalLineScheduleKeyGas_(sch, null);
      var lastSentImgDay = String(propsGlobal.getProperty('LINE_LAST_TRIGGER_BKK_IMG_' + scheduleKey) || '').trim();
      var lastSentTriggerDay = String(propsGlobal.getProperty('LINE_LAST_TRIGGER_BKK_DAY_' + scheduleKey) || '').trim();
      if (lastSentImgDay === bkk.ymd || lastSentTriggerDay === bkk.ymd) continue;

      var schedSendFormat = normalizeLineSendFormatGas_(
        settingsMap['Line_Send_Format'],
        (sch.sendAsImage !== undefined) ? Boolean(sch.sendAsImage) : legacyImgPref
      );
      if (sch.sendAsImage === false) {
        schedSendFormat = 'TEXT_ONLY';
      }

      // If IMAGE_ONLY is selected, Apps Script cron cannot render HTML5 Canvas .jpeg headlessly; never fire plain-text fallback
      if (schedSendFormat === 'IMAGE_ONLY') {
        continue;
      }

      // Give open browser clients a 10-minute priority window to render & upload .jpeg before GAS sends text backup!
      if (schedSendFormat !== 'TEXT_ONLY' && diff < 10) {
        needsRetry = true;
        continue;
      }

      var targetDate = resolveAutoReportTargetDateGas_(sch.reportDayMode || settingsMap['Line_Auto_Report_Day'] || 'TODAY', bkk.ymd);
      var liveCheck = buildDailyCensusLineMessageGas_(targetDate, sch.shift || 'ในเวลา 08:00-16:00', settingsMap);
      // 15-minute grace period: if Sheet still has 0 clinics at :00..:14, hold & retry instead of locking blank 0-clinic report
      if (liveCheck.clinicCount === 0 && diff < 15) {
        needsRetry = true;
        continue;
      }
      var sentRes = sendScheduledCensusReportGas_(sourceTag, sch, null);
      if (sentRes && sentRes.quotaExceeded) {
        return { needsRetry: false, quotaExceeded: true };
      }
    }
  }
  return { needsRetry: needsRetry };
}

function runLineDailyCensusTrigger_() {
  var lock = LockService.getScriptLock();
  var dueResult = { needsRetry: false };
  try {
    lock.waitLock(20000);
    dueResult = runDueLineSchedulesGas_('AUTO_EXACT') || { needsRetry: false };
  } finally {
    var settingsMap = readSettingsMapGas_();
    var enabled = String(settingsMap['Line_Auto_Enabled'] || '').toLowerCase() === 'true';
    var timeStr = parseLineAutoTimeGas_(settingsMap['Line_Auto_Time'] || DEFAULT_LINE_AUTO_TIME).formatted;
    if (enabled) {
      var existing = ScriptApp.getProjectTriggers();
      for (var i = 0; i < existing.length; i++) {
        var fn = existing[i].getHandlerFunction();
        if (fn === 'runLineDailyCensusTrigger_' || fn === 'runLineGraceRetryTrigger_') {
          ScriptApp.deleteTrigger(existing[i]);
        }
      }
      if (dueResult.needsRetry) {
        // Schedule a 10-minute grace retry so client browsers can send .jpeg first and late saves get picked up cleanly
        ScriptApp.newTrigger('runLineGraceRetryTrigger_')
          .timeBased()
          .after(10 * 60 * 1000)
          .create();
      }
      var schedules = getLineSchedulesFromSettingsMap_(settingsMap);
      var nextInfo = computeNextMatchingRunEpochGas_(schedules, settingsMap);
      if (nextInfo) {
        ScriptApp.newTrigger('runLineDailyCensusTrigger_')
          .timeBased()
          .at(new Date(nextInfo.epoch))
          .create();
        var nextRunThai = Utilities.formatDate(new Date(nextInfo.epoch), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss') +
          (nextInfo.schedule ? ' (' + nextInfo.schedule.label + ')' : '');
        PropertiesService.getScriptProperties().setProperty('LINE_NEXT_RUN_AT', nextRunThai);
      } else {
        syncLineAutomationTriggers_(true, timeStr, settingsMap);
      }
    }
    try { lock.releaseLock(); } catch (e) {}
  }
}

function runLineGraceRetryTrigger_() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var existing = ScriptApp.getProjectTriggers();
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].getHandlerFunction() === 'runLineGraceRetryTrigger_') {
        ScriptApp.deleteTrigger(existing[i]);
      }
    }
    var settingsMap = readSettingsMapGas_();
    var enabled = String(settingsMap['Line_Auto_Enabled'] || '').toLowerCase() === 'true';
    if (!enabled) return;
    var retryRes = runDueLineSchedulesGas_('AUTO_BACKUP') || { needsRetry: false };
    if (retryRes.needsRetry) {
      ScriptApp.newTrigger('runLineGraceRetryTrigger_')
        .timeBased()
        .after(6 * 60 * 1000)
        .create();
    }
  } finally {
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
    runDueLineSchedulesGas_('AUTO_BACKUP');
    var hasExact = ScriptApp.getProjectTriggers().some(function(t) {
      return t.getHandlerFunction() === 'runLineDailyCensusTrigger_';
    });
    if (!hasExact) {
      var schedules = getLineSchedulesFromSettingsMap_(settingsMap);
      var nextInfo = computeNextMatchingRunEpochGas_(schedules, settingsMap);
      if (nextInfo) {
        ScriptApp.newTrigger('runLineDailyCensusTrigger_')
          .timeBased()
          .at(new Date(nextInfo.epoch))
          .create();
        var nextRunThai = Utilities.formatDate(new Date(nextInfo.epoch), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss') +
          (nextInfo.schedule ? ' (' + nextInfo.schedule.label + ')' : '');
        PropertiesService.getScriptProperties().setProperty('LINE_NEXT_RUN_AT', nextRunThai);
      }
    }
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function configureLineAutomationFromApi_(payload) {
  var enabled = Boolean(payload.enabled);
  var parsed = parseLineAutoTimeGas_(payload.time || DEFAULT_LINE_AUTO_TIME);
  var reportDayMode = String(payload.reportDayMode || 'TODAY').trim() || 'TODAY';
  var shift = String(payload.shift || 'ในเวลา 08:00-16:00').trim() || 'ในเวลา 08:00-16:00';
  var targetId = String(payload.targetId || DEFAULT_LINE_GROUP_ID).trim();
  var targetGroups = Array.isArray(payload.targetGroups) && payload.targetGroups.length > 0
    ? payload.targetGroups
    : [{ id: targetId || DEFAULT_LINE_GROUP_ID, name: 'หัวหน้าห้องตรวจ OPD', enabled: true }];
  var schedules = Array.isArray(payload.schedules) && payload.schedules.length > 0
    ? payload.schedules
    : DEFAULT_LINE_SCHEDULES;
  var sendFormat = normalizeLineSendFormatGas_(
    payload.sendFormat,
    payload.sendAsImage !== undefined ? Boolean(payload.sendAsImage) : true
  );
  var sendAsImage = sendFormat !== 'TEXT_ONLY';
  var incomingToken = String(payload.channelAccessToken || '').trim();

  if (payload.clearToken) {
    PropertiesService.getScriptProperties().deleteProperty('LINE_CHANNEL_ACCESS_TOKEN');
  } else if (incomingToken) {
    PropertiesService.getScriptProperties().setProperty('LINE_CHANNEL_ACCESS_TOKEN', incomingToken);
  }

  var hasToken = Boolean(String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim());

  var boobyOwnerName = String(payload.boobyOwnerName || 'คุณทรงยศ').trim() || 'คุณทรงยศ';
  var boobyOwnerUserId = String(payload.boobyOwnerUserId || '').trim();
  var boobyGroupMentionOnly = payload.boobyGroupMentionOnly !== undefined ? Boolean(payload.boobyGroupMentionOnly) : true;

  upsertSettingsEntriesGas_([
    ['Line_Auto_Enabled', enabled ? 'true' : 'false'],
    ['Line_Auto_Time', parsed.formatted],
    ['Line_Auto_Report_Day', reportDayMode],
    ['Line_Auto_Shift', shift],
    ['Line_Target_Id', targetId],
    ['Line_Target_Groups', JSON.stringify(targetGroups)],
    ['Line_Schedules', JSON.stringify(schedules)],
    ['Line_Send_As_Image', sendAsImage ? 'true' : 'false'],
    ['Line_Send_Format', sendFormat],
    ['Line_Channel_Token_Set', hasToken ? 'true' : 'false'],
    ['Booby_Owner_Name', boobyOwnerName],
    ['Booby_Owner_User_ID', boobyOwnerUserId],
    ['Booby_Group_Mention_Only', boobyGroupMentionOnly ? 'true' : 'false']
  ]);

  var freshSettingsMap = readSettingsMapGas_();
  var triggerInfo = syncLineAutomationTriggers_(enabled, parsed.formatted, freshSettingsMap);

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

function sendAutoScheduledLineReportFromClientApi_(payload) {
  var settingsMap = readSettingsMapGas_();
  var enabled = String(settingsMap['Line_Auto_Enabled'] || '').toLowerCase() === 'true';
  if (!enabled) {
    return { success: false, error: 'ระบบส่งรายงานอัตโนมัติปิดอยู่' };
  }
  var schedId = String((payload && payload.scheduleId) || 'CLIENT_AUTO').trim();
  var sch = {
    id: schedId,
    time: String((payload && payload.scheduleTime) || '').trim(),
    label: String((payload && payload.scheduleLabel) || 'อัตโนมัติ (ภาพ .jpeg)'),
    shift: String((payload && payload.shift) || settingsMap['Line_Auto_Shift'] || 'ในเวลา 08:00-16:00'),
    reportDayMode: String((payload && payload.reportDayMode) || settingsMap['Line_Auto_Report_Day'] || 'TODAY')
  };
  return sendScheduledCensusReportGas_('CLIENT_AUTO', sch, payload);
}

function sendDailyCensusToLineNowFromApi_(payload) {
  var settingsMap = readSettingsMapGas_();
  var token = String(payload.channelAccessToken || '').trim() ||
    String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim();
  var targetIds = resolveLineTargetIdsGas_(settingsMap, payload.targetIds, payload.targetId);

  if (payload.channelAccessToken) {
    PropertiesService.getScriptProperties().setProperty('LINE_CHANNEL_ACCESS_TOKEN', String(payload.channelAccessToken).trim());
  }

  var bkk = getBangkokDatePartsGas_(new Date());
  var targetDate = normalizeSheetDateGas_(String(payload.date || '').trim()) ||
    resolveAutoReportTargetDateGas_(String(payload.reportDayMode || settingsMap['Line_Auto_Report_Day'] || 'TODAY'), bkk.ymd);
  var shiftFilter = String(payload.shift || settingsMap['Line_Auto_Shift'] || 'ในเวลา 08:00-16:00').trim() || 'ในเวลา 08:00-16:00';

  var built = buildDailyCensusLineMessageGas_(targetDate, shiftFilter, settingsMap);
  var metaClinicCount = built.clinicCount;
  var metaTotalPt = built.totalPt;
  var rawClientMsg = String(payload.message || '').trim();
  var clientEmpty = (
    payload.clientClinicCount === 0 ||
    rawClientMsg.indexOf('ยังไม่พบข้อมูลบันทึกภาระงาน') !== -1 ||
    rawClientMsg.indexOf('0 คลินิก') !== -1
  );

  var legacyImgPref = String(settingsMap['Line_Send_As_Image'] || 'true').toLowerCase() !== 'false';
  var sendFormat = normalizeLineSendFormatGas_(
    payload.sendFormat || settingsMap['Line_Send_Format'],
    legacyImgPref
  );

  var imageUrl = '';
  var previewImageUrl = '';
  var textToSend = rawClientMsg || built.text;
  var allowTextFallback = false;

  if (clientEmpty && built.clinicCount > 0) {
    textToSend = built.text;
    allowTextFallback = true;
  } else {
    imageUrl = String(payload.imageUrl || '').trim();
    previewImageUrl = String(payload.previewImageUrl || imageUrl).trim();
    if (sendFormat !== 'TEXT_ONLY' && !imageUrl && payload.imageBase64) {
      var upRes = uploadLineReportJpegFromApi_({
        base64Jpeg: payload.imageBase64,
        filename: 'OPD_Census_' + targetDate + '.jpeg'
      });
      if (upRes.success && upRes.imageUrl) {
        imageUrl = upRes.imageUrl;
        previewImageUrl = upRes.previewImageUrl || upRes.imageUrl;
      }
    }
  }

  var pushRes = pushLineMessageGas_(token, targetIds, textToSend, imageUrl, previewImageUrl, sendFormat, allowTextFallback);
  var nowThai = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
  var bkkMonthNow = bkk.ymd.slice(0, 7);
  if (pushRes.ok) {
    PropertiesService.getScriptProperties().deleteProperty('LINE_QUOTA_EXCEEDED_MONTH');
  } else if (pushRes.quotaExceeded) {
    PropertiesService.getScriptProperties().setProperty('LINE_QUOTA_EXCEEDED_MONTH', bkkMonthNow);
  }
  var imgTag = sendFormat === 'IMAGE_ONLY'
    ? ' (เฉพาะภาพ .jpeg)'
    : sendFormat === 'TEXT_ONLY'
    ? ' (เฉพาะข้อความ)'
    : (imageUrl ? ' (ภาพ .jpeg + ข้อความ)' : '');
  var statusText = pushRes.ok
    ? (metaClinicCount > 0 ? 'ส่งทันทีสำเร็จ' + imgTag + ' (' + targetIds.length + ' กลุ่ม • ' + metaClinicCount + ' คลินิก, ' + metaTotalPt + ' ราย)' : 'ส่งรายงานเข้า LINE สำเร็จ' + imgTag + ' (' + targetIds.length + ' กลุ่ม)')
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
  res.quotaExceeded = Boolean(pushRes.quotaExceeded);
  res.statusText = statusText;
  res.sentAt = nowThai;
  res.targetDate = targetDate;
  res.sentCount = pushRes.sentCount || 0;
  return res;
}

function getLineAutomationStatusFromApi_() {
  var settingsMap = readSettingsMapGas_();
  var triggers = ScriptApp.getProjectTriggers().filter(function(t) {
    var fn = t.getHandlerFunction();
    return fn === 'runLineDailyCensusTrigger_' || fn === 'runLineDailyBackupTrigger_';
  });
  var token = String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim();
  var hasToken = Boolean(token);
  var targetId = String(settingsMap['Line_Target_Id'] || DEFAULT_LINE_GROUP_ID).trim();
  var tokenCheck = hasToken ? verifyLineTokenGas_(token, targetId) : { ok: false, error: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน ScriptProperties' };
  return {
    success: true,
    enabled: String(settingsMap['Line_Auto_Enabled'] || '').toLowerCase() === 'true',
    time: parseLineAutoTimeGas_(settingsMap['Line_Auto_Time'] || DEFAULT_LINE_AUTO_TIME).formatted,
    triggerInstalled: triggers.length > 0,
    triggerCount: triggers.length,
    nextRunAt: String(PropertiesService.getScriptProperties().getProperty('LINE_NEXT_RUN_AT') || ''),
    hasToken: hasToken,
    tokenVerified: Boolean(tokenCheck.ok),
    tokenError: tokenCheck.ok ? '' : String(tokenCheck.error || ''),
    botName: String(tokenCheck.botName || ''),
    groupVerified: Boolean(tokenCheck.groupVerified),
    groupName: String(tokenCheck.groupName || ''),
    targetId: targetId,
    detectedGroupId: String(settingsMap['Line_Detected_Group_ID'] || ''),
    detectedGroupName: String(settingsMap['Line_Detected_Group_Name'] || ''),
    lastSentAt: String(settingsMap['Line_Last_Sent_At'] || ''),
    lastSentReportDate: String(settingsMap['Line_Last_Sent_Report_Date'] || ''),
    lastStatus: String(settingsMap['Line_Last_Status'] || ''),
    quotaType: String(tokenCheck.quotaType || ''),
    quotaLimit: tokenCheck.quotaLimit !== undefined ? tokenCheck.quotaLimit : null,
    quotaUsed: tokenCheck.quotaUsed !== undefined ? tokenCheck.quotaUsed : null,
    quotaRemaining: tokenCheck.quotaRemaining !== undefined ? tokenCheck.quotaRemaining : null,
    quotaPausedMonth: String(PropertiesService.getScriptProperties().getProperty('LINE_QUOTA_EXCEEDED_MONTH') || '')
  };
}

function updateLineTokenUi() {
  var ui = SpreadsheetApp.getUi();
  var settingsMap = readSettingsMapGas_();
  var targetId = String(settingsMap['Line_Target_Id'] || DEFAULT_LINE_GROUP_ID).trim();
  var tokPrompt = ui.prompt(
    '🔑 อัปเดต LINE Channel Access Token ใหม่',
    'วาง Channel Access Token (Long-lived) ตัวล่าสุดจาก LINE Developers Console (ระบบจะตรวจสอบกับ LINE ทันทีก่อนบันทึก):',
    ui.ButtonSet.OK_CANCEL
  );
  if (tokPrompt.getSelectedButton() !== ui.Button.OK) return;
  var tokVal = String(tokPrompt.getResponseText() || '').trim();
  if (!tokVal) {
    ui.alert('ยกเลิก: ไม่ได้กรอก Token');
    return;
  }
  var check = verifyLineTokenGas_(tokVal, targetId);
  if (!check.ok) {
    ui.alert('❌ Token ไม่ผ่านการตรวจสอบกับ LINE API:\n' + check.error + '\n\nกรุณาคัดลอก Token ล่าสุดจาก LINE Developers Console (ห้ามกด Reissue ซ้ำหลังคัดลอก)');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('LINE_CHANNEL_ACCESS_TOKEN', tokVal);
  upsertSettingsEntriesGas_([
    ['Line_Channel_Token_Set', 'true'],
    ['Line_Target_Id', targetId]
  ]);
  ui.alert(
    '✅ บันทึกและยืนยัน LINE Token สำเร็จ!\n' +
    'บอท: ' + (check.botName || '-') + '\n' +
    'กลุ่ม: ' + (check.groupName || targetId)
  );
}

function setupLineDailyTrigger0359Ui() {
  var ui = SpreadsheetApp.getUi();
  var settingsMap = readSettingsMapGas_();
  var storedToken = String(PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '').trim();
  var targetId = String(settingsMap['Line_Target_Id'] || DEFAULT_LINE_GROUP_ID).trim();

  var needPromptToken = !storedToken;
  if (storedToken) {
    var existingCheck = verifyLineTokenGas_(storedToken, targetId);
    if (!existingCheck.ok) {
      needPromptToken = true;
    } else {
      var keepChoice = ui.alert(
        'พบ LINE Token ที่ใช้งานได้อยู่แล้ว',
        'บอทปัจจุบัน: ' + (existingCheck.botName || '-') + '\nต้องการใช้ Token เดิมนี้ต่อไปหรือไม่?\n(กด YES = ใช้เดิมต่อ | กด NO = วาง Token ใหม่)',
        ui.ButtonSet.YES_NO_CANCEL
      );
      if (keepChoice === ui.Button.CANCEL) return;
      if (keepChoice === ui.Button.NO) needPromptToken = true;
    }
  }

  if (needPromptToken) {
    var tokPrompt = ui.prompt(
      'LINE Channel Access Token',
      storedToken
        ? 'Token เดิมในระบบหมดอายุ/ไม่ถูกต้อง (HTTP 401)\nกรุณาวาง Channel Access Token (Long-lived) ตัวล่าสุดจาก LINE Developers:'
        : 'วาง Channel Access Token (Long-lived) จาก LINE Official Account / LINE Developers:',
      ui.ButtonSet.OK_CANCEL
    );
    if (tokPrompt.getSelectedButton() !== ui.Button.OK) return;
    var tokVal = String(tokPrompt.getResponseText() || '').trim();
    if (!tokVal) return;
    var newCheck = verifyLineTokenGas_(tokVal, targetId);
    if (!newCheck.ok) {
      ui.alert('❌ Token ที่วางไม่ผ่านการตรวจสอบ:\n' + newCheck.error);
      return;
    }
    PropertiesService.getScriptProperties().setProperty('LINE_CHANNEL_ACCESS_TOKEN', tokVal);
  }

  if (!targetId) {
    var grpPrompt = ui.prompt(
      'LINE Group ID (รหัสกลุ่ม)',
      'วาง LINE Group ID (ขึ้นต้นด้วย C...) ที่ต้องการให้ส่งรายงานอัตโนมัติ:',
      ui.ButtonSet.OK_CANCEL
    );
    if (grpPrompt.getSelectedButton() !== ui.Button.OK) return;
    targetId = String(grpPrompt.getResponseText() || '').trim();
    if (!targetId) return;
  }

  var schedulesJson = settingsMap['Line_Schedules'] || JSON.stringify(DEFAULT_LINE_SCHEDULES);
  upsertSettingsEntriesGas_([
    ['Line_Auto_Enabled', 'true'],
    ['Line_Auto_Time', DEFAULT_LINE_AUTO_TIME],
    ['Line_Auto_Report_Day', 'TODAY'],
    ['Line_Auto_Shift', 'ในเวลา 08:00-16:00'],
    ['Line_Target_Id', targetId],
    ['Line_Schedules', schedulesJson],
    ['Line_Send_As_Image', 'true'],
    ['Line_Send_Format', settingsMap['Line_Send_Format'] || 'BOTH'],
    ['Line_Channel_Token_Set', 'true']
  ]);
  var updatedMap = readSettingsMapGas_();
  var triggerInfo = syncLineAutomationTriggers_(true, DEFAULT_LINE_AUTO_TIME, updatedMap);
  ui.alert('ตั้งเวลาส่งรายงานผู้ป่วยประจำวันเข้า LINE อัตโนมัติ (15:55 / 20:00 / 12:30 น.) สำเร็จ!\nรอบถัดไป: ' + triggerInfo.nextRunAt);
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



