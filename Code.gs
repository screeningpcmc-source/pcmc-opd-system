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
      headers: ['Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status', 'Start_Date', 'End_Date'],
      color: '#1e3a8a',
      rows: []
    },
    {
      name: SHEET_NAMES.WORKLOAD,
      headers: [
        'Date', 'Shift', 'Clinic', 'Total_Pt', 'Adult_Pt', 'Child_Pt',
        'Admit', 'HN', 'RN', 'PN', 'NA', 'Clerk', 'Service_Worker', 'Note', 'Reporter'
      ],
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
      headers: ['Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic'],
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
 * POST -> รับเฉพาะการ "นำข้อมูลเข้า" (Append Only) สำหรับเจ้าหน้าที่ OPD
 * การแก้ไขหรือลบข้อมูลทั้งหมดสงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น
 */
function doPost(e) {
  try {
    var bodyText = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var req = JSON.parse(bodyText);
    var action = String(req.action || '').trim();
    var payload = req.payload;

    if (action === 'appendWorkload') {
      return jsonResponse_(appendWorkloadFromApi_(payload));
    }
    if (action === 'appendLeave') {
      return jsonResponse_(appendLeaveFromApi_(payload));
    }
    if (action === 'appendOT') {
      return jsonResponse_(appendOTFromApi_(payload));
    }

    return jsonResponse_({
      success: false,
      error: 'การแก้ไขหรือลบข้อมูลสงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin PIN) เท่านั้น'
    });
  } catch (err) {
    return jsonResponse_({ success: false, error: err.toString() });
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

function buildPublicReadAllPayload_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var staffData = getSheetRowsNormalized_(SHEET_NAMES.STAFF, 7);
    var workloadData = getSheetRowsNormalized_(SHEET_NAMES.WORKLOAD, 15);
    var leaveData = getSheetRowsNormalized_(SHEET_NAMES.LEAVE, 8);
    var otData = getSheetRowsNormalized_(SHEET_NAMES.OT, 6);
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

    return {
      success: true,
      spreadsheetId: ss.getId(),
      gasUrl: activeGasUrl,
      staffRows: staffData.rows.map(function(r) { return r.slice(0, 7); }),
      workloadRows: workloadData.rows.map(function(r) {
        return workloadHasId ? r.slice(1, 16) : r.slice(0, 15);
      }),
      leaveRows: leaveData.rows.map(function(r) {
        return leaveHasId ? r.slice(1, 9) : r.slice(0, 8);
      }),
      otRows: otData.rows.map(function(r) {
        return otHasId ? r.slice(1, 7) : r.slice(0, 6);
      }),
      settingsRows: settingsRows,
      auditRows: auditData.rows.map(function(r) { return r.slice(0, 6); })
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
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.WORKLOAD, [
    'Date', 'Shift', 'Clinic', 'Total_Pt', 'Adult_Pt', 'Child_Pt',
    'Admit', 'HN', 'RN', 'PN', 'NA', 'Clerk', 'Service_Worker', 'Note', 'Reporter'
  ]);
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
      String(entry.reporter || '')
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
  return { success: true, appended: rowsToAppend.length };
}

function appendOTFromApi_(payload) {
  var list = Array.isArray(payload) ? payload : [payload];
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.OT, [
    'Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic'
  ]);
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
      String(ot.workClinic || '')
    ];
    if (firstHeader === 'OT_ID') {
      var otId = ot.id || ('OT-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000));
      rowsToAppend.push([otId].concat(baseRow).concat([ot.isExternal ? 'External' : 'OPD']));
    } else {
      rowsToAppend.push(baseRow);
    }
  });

  if (rowsToAppend.length === 0) {
    return { success: false, error: 'ข้อมูลเวรนอกเวลาไม่ครบถ้วน' };
  }
  sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
  return { success: true, appended: rowsToAppend.length };
}
