/**
 * ==============================================================================
 * ระบบบริหารจัดการข้อมูล OPD โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (PCMC)
 * ไฟล์: Code.gs (Google Apps Script Backend)
 * 5 ชีทฐานข้อมูลพร้อม Row_ID ทุกตาราง: Staff_Master, Daily_Workload, Leave_Records, OT_Attendance, Settings
 * ==============================================================================
 */

var SHEET_NAMES = {
  STAFF: 'Staff_Master',
  WORKLOAD: 'Daily_Workload',
  LEAVE: 'Leave_Records',
  OT: 'OT_Attendance',
  SETTINGS: 'Settings',
  AUDIT: 'Audit_Logs'
};

var DEFAULT_PIN_SHA256 = '7ec7bbd3677bee60f1e0c58b2967299b9985afad73acfde38966d76f30cc4f88';

function getConfiguredAdminPin_() {
  var propPin = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  if (propPin) return String(propPin).trim();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] === 'Admin_Pin' && String(data[i][1] || '').trim()) {
        return String(data[i][1]).trim();
      }
    }
  }
  return '';
}

function setAdminPinSecret(newPin) {
  var cleanPin = String(newPin || '').trim();
  if (cleanPin.length < 4) {
    return { success: false, error: 'รหัสผ่านต้องมีอย่างน้อย 4 หลัก' };
  }
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', cleanPin);
  return { success: true, message: 'บันทึกรหัสผ่าน Admin ลงใน Script Properties เรียบร้อยแล้ว' };
}

function sha256Hex_(input) {
  var rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(input || ''), Utilities.Charset.UTF_8);
  var txtHash = '';
  for (var i = 0; i < rawHash.length; i++) {
    var hashVal = rawHash[i];
    if (hashVal < 0) hashVal += 256;
    var byteStr = hashVal.toString(16);
    if (byteStr.length === 1) txtHash += '0';
    txtHash += byteStr;
  }
  return txtHash;
}
var DEFAULT_IN_TIME_CLINICS = [
  'กุมารเวชกรรม', 'สูติ-นรีเวชกรรม', 'ศัลยกรรมกระดูก', 'เวชศาสตร์ฟื้นฟู', 'ศัลยกรรม',
  'จักษุวิทยา', 'ศูนย์เลสิก', 'โสต ศอ นาสิก', 'อายุรกรรม', 'ตรวจโรคทั่วไป',
  'Echo', 'AAIRC', 'ODS', 'ประกันสังคม', 'หน่วยคัดกรอง'
];
var DEFAULT_OUT_TIME_CLINICS = [
  'ตรวจโรคทั่วไป', 'กุมารเวชกรรม', 'สูติ-นรีเวชกรรม', 'ศัลยกรรมกระดูก', 'ศัลยกรรม',
  'จักษุวิทยา', 'โสต ศอ นาสิก', 'อายุรกรรม', 'คลินิกหัวใจ', 'หน่วยคัดกรอง'
];

/**
 * 1. ฟังก์ชันแสดงผลหน้าเว็บ Single-Page Web App หรือตอบกลับ JSON API (สำหรับซิงค์ลิงก์แชร์)
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'readAll') {
    return jsonResponse_(buildPublicReadAllPayload_());
  }
  var template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('ระบบบริหารจัดการภาระงานและ Productivity OPD รพ.ชลประทาน')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, shrink-to-fit=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 1.1 Webhook สำหรับรับเฉพาะการ "นำข้อมูลเข้า" (Append Only) จากบุคลากร OPD ที่เปิดลิงก์แชร์
 * ไม่อนุญาตให้แก้ไขหรือลบข้อมูลผ่าน Endpoint สาธารณะ (สงวนสิทธิ์เฉพาะ Admin PIN)
 */
function doPost(e) {
  try {
    var bodyText = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var req = JSON.parse(bodyText);
    var action = String(req.action || '').trim();
    var payload = req.payload || {};

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

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
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
    var staffData = getSheetRowsNormalized_(SHEET_NAMES.STAFF, 7);
    var workloadData = getSheetRowsNormalized_(SHEET_NAMES.WORKLOAD, 15);
    var leaveData = getSheetRowsNormalized_(SHEET_NAMES.LEAVE, 8);
    var otData = getSheetRowsNormalized_(SHEET_NAMES.OT, 6);
    var settingsData = getSheetRowsNormalized_(SHEET_NAMES.SETTINGS, 2);
    var auditData = getSheetRowsNormalized_(SHEET_NAMES.AUDIT, 6);

    var workloadHasId = workloadData.headers[0] === 'Record_ID';
    var leaveHasId = leaveData.headers[0] === 'Leave_ID';
    var otHasId = otData.headers[0] === 'OT_ID';

    return {
      success: true,
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
      settingsRows: settingsData.rows
        .filter(function(r) { return r[0] && r[0] !== 'Admin_Pin'; })
        .map(function(r) { return r.slice(0, 2); }),
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

function appendWorkloadFromApi_(entry) {
  if (!entry || !entry.date || !entry.clinic) {
    return { success: false, error: 'ข้อมูลภาระงานไม่ครบถ้วน' };
  }
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.WORKLOAD, [
    'Date', 'Shift', 'Clinic', 'Total_Pt', 'Adult_Pt', 'Child_Pt',
    'Admit', 'HN', 'RN', 'PN', 'NA', 'Clerk', 'Service_Worker', 'Note', 'Reporter'
  ]);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
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
    sheet.appendRow([recId].concat(baseRow));
  } else {
    sheet.appendRow(baseRow);
  }
  return { success: true };
}

function appendLeaveFromApi_(leave) {
  if (!leave || !leave.startDate || !leave.staffName) {
    return { success: false, error: 'ข้อมูลวันลาไม่ครบถ้วน' };
  }
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.LEAVE, [
    'Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note'
  ]);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
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
    sheet.appendRow([lvId].concat(baseRow));
  } else {
    sheet.appendRow(baseRow);
  }
  return { success: true };
}

function appendOTFromApi_(ot) {
  if (!ot || !ot.date || !ot.staffName) {
    return { success: false, error: 'ข้อมูลเวรนอกเวลาไม่ครบถ้วน' };
  }
  var sheet = ensureSheetWithHeaders_(SHEET_NAMES.OT, [
    'Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic'
  ]);
  var firstHeader = String(sheet.getRange(1, 1).getValue() || '').trim();
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
    sheet.appendRow([otId].concat(baseRow).concat([ot.isExternal ? 'External' : 'OPD']));
  } else {
    sheet.appendRow(baseRow);
  }
  return { success: true };
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 2. ฟังก์ชัน Setup Database อัตโนมัติในการรันครั้งแรก
 */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var schemas = [
    {
      name: SHEET_NAMES.STAFF,
      headers: ['Staff_ID', 'Name', 'Position', 'Home_Clinic', 'Status'],
      headerColor: '#1e3a8a',
      seedData: [
        ['STF-001', 'พว.สุดารัตน์ ศิริพรหม', 'HN', 'หน่วยคัดกรอง', 'Active'],
        ['STF-002', 'พว.ประภัสสร วงษ์สุวรรณ', 'HN', 'อายุรกรรม', 'Active'],
        ['STF-003', 'พว.รัตนาภรณ์ จันทร์สว่าง', 'HN', 'กุมารเวชกรรม', 'Active'],
        ['STF-004', 'พว.เพ็ญศรี พิทักษ์พงศ์', 'HN', 'ศัลยกรรม', 'Active'],
        ['STF-005', 'พว.นันทนา สุขสมบูรณ์', 'HN', 'สูติ-นรีเวชกรรม', 'Active'],
        ['STF-006', 'พว.วรรณา เจริญเกียรติ', 'HN', 'จักษุวิทยา', 'Active'],
        ['STF-007', 'พว.อารีย์ สถิตย์พร', 'HN', 'ศูนย์เลสิก', 'Active'],
        ['STF-008', 'พว.กมลวรรณ เทพประสิทธิ์', 'RN', 'หน่วยคัดกรอง', 'Active'],
        ['STF-009', 'พว.ชลธิชา บุญประสิทธิ์', 'RN', 'หน่วยคัดกรอง', 'Active'],
        ['STF-013', 'พว.ปวีณา บุญชู', 'RN', 'อายุรกรรม', 'Active'],
        ['STF-015', 'พว.พรทิพย์ สถาวร', 'RN', 'อายุรกรรม', 'Active'],
        ['STF-017', 'พว.รสริน อารีราษฎร์', 'RN', 'กุมารเวชกรรม', 'Active'],
        ['STF-038', 'พว.เยาวภา บุญมา', 'RN', 'Echo', 'Active'],
        ['STF-046', 'พท.กนกพร ลิ่มสกุล', 'PN', 'หน่วยคัดกรอง', 'Active'],
        ['STF-048', 'พท.จันทร์จิรา สมรภูมิ', 'PN', 'หน่วยคัดกรอง', 'Active'],
        ['STF-060', 'นายกิตติคุณ มั่นคง', 'NA', 'หน่วยคัดกรอง', 'Active'],
        ['STF-064', 'น.ส.ทิวารัตน์ สดใส', 'NA', 'สูติ-นรีเวชกรรม', 'Active'],
        ['STF-080', 'น.ส.เกศินี มหาวงศ์', 'Clerk', 'หน่วยคัดกรอง', 'Active'],
        ['STF-092', 'นายสมพร ใจกล้า', 'Service Worker', 'หน่วยคัดกรอง', 'Active']
      ]
    },
    {
      name: SHEET_NAMES.WORKLOAD,
      headers: [
        'Record_ID', 'Date', 'Shift', 'Clinic', 'Total_Pt', 'Adult_Pt', 'Child_Pt',
        'Admit', 'HN', 'RN', 'PN', 'NA', 'Clerk', 'Service_Worker', 'Note', 'Reporter'
      ],
      headerColor: '#047857',
      seedData: []
    },
    {
      name: SHEET_NAMES.LEAVE,
      headers: ['Leave_ID', 'Start_Date', 'End_Date', 'Staff_Name', 'Position', 'Clinic', 'Leave_Type', 'Days', 'Note'],
      headerColor: '#b45309',
      seedData: []
    },
    {
      name: SHEET_NAMES.OT,
      headers: ['OT_ID', 'Date', 'Shift', 'Staff_Name', 'Position', 'Home_Clinic', 'Work_Clinic', 'Is_External'],
      headerColor: '#6d28d9',
      seedData: []
    },
    {
      name: SHEET_NAMES.SETTINGS,
      headers: ['Key', 'Value'],
      headerColor: '#374151',
      seedData: [
        ['NHPPD', '0.4'],
        ['Std_Hr', '7'],
        ['Annual_Hr', '2080'],
        ['Work_Days', '245'],
        ['Admin_Emails', 'screening.pcmc@gmail.com, admin.opd@pcmc.ac.th, headnurse@pcmc.ac.th'],
        ['Admin_Pin', getConfiguredAdminPin_()],
        ['In_Time_Clinics', DEFAULT_IN_TIME_CLINICS.join(', ')],
        ['Out_Time_Clinics', DEFAULT_OUT_TIME_CLINICS.join(', ')]
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
      var headerRange = sheet.getRange(1, 1, 1, schema.headers.length);
      headerRange.setBackground(schema.headerColor)
                 .setFontColor('#ffffff')
                 .setFontWeight('bold')
                 .setHorizontalAlignment('center');
      sheet.setFrozenRows(1);

      if (schema.seedData && schema.seedData.length > 0) {
        sheet.getRange(2, 1, schema.seedData.length, schema.headers.length).setValues(schema.seedData);
      }
    }
  });

  return { success: true, message: 'สร้างฐานข้อมูล 5 ชีทเรียบร้อยแล้ว!' };
}

/**
 * 3. ฟังก์ชันดึงข้อมูลทั้งหมดสำหรับเริ่มต้นระบบ (Initial Data)
 */
function getInitialData() {
  try {
    var currentUserEmail = Session.getActiveUser().getEmail() || '';
    var settings = getSettingsMap();
    var adminEmails = (settings['Admin_Emails'] || '').toLowerCase().split(',').map(function(e) { return e.trim(); });
    var isEmailAdmin = currentUserEmail ? adminEmails.indexOf(currentUserEmail.toLowerCase()) !== -1 : false;

    var safeSettings = Object.assign({}, settings);
    delete safeSettings['Admin_Pin'];

    return {
      success: true,
      currentUserEmail: currentUserEmail,
      isEmailAdmin: isEmailAdmin,
      hasAdminPinConfigured: Boolean(getConfiguredAdminPin_()),
      staff: getStaffList(),
      workloads: getWorkloadList(),
      leaves: getLeaveList(),
      ot: getOTList(),
      settings: safeSettings
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

/**
 * 4. Helper: ดึงการตั้งค่าเป็น Key-Value Map
 */
function getSettingsMap() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
  var defaults = {
    'NHPPD': '0.4',
    'Std_Hr': '7',
    'Annual_Hr': '2080',
    'Work_Days': '245',
    'Admin_Emails': 'screening.pcmc@gmail.com, admin.opd@pcmc.ac.th',
    'Admin_Pin': getConfiguredAdminPin_(),
    'In_Time_Clinics': DEFAULT_IN_TIME_CLINICS.join(', '),
    'Out_Time_Clinics': DEFAULT_OUT_TIME_CLINICS.join(', ')
  };
  if (!sheet || sheet.getLastRow() <= 1) {
    return defaults;
  }
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  var map = Object.assign({}, defaults);
  data.forEach(function(r) {
    if (r[0]) map[r[0]] = String(r[1]);
  });
  return map;
}

/**
 * 5. CRUD: Staff_Master
 */
function getStaffList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  return data.map(function(r) {
    return {
      staffId: String(r[0] || ''),
      name: String(r[1] || ''),
      position: String(r[2] || 'RN'),
      homeClinic: String(r[3] || ''),
      status: String(r[4] || 'Active')
    };
  });
}

function addStaff(staff) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (!sheet) { setupDatabase(); sheet = ss.getSheetByName(SHEET_NAMES.STAFF); }
    var staffId = staff.staffId || ('STF-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 100));
    sheet.appendRow([staffId, staff.name, staff.position, staff.homeClinic, staff.status || 'Active']);
    return { success: true, message: 'เพิ่มบุคลากรเรียบร้อยแล้ว', staffId: staffId };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function updateStaff(staffId, staff) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, error: 'ไม่พบชีทบุคลากร' };
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(staffId)) {
        var rowNum = i + 2;
        sheet.getRange(rowNum, 2, 1, 4).setValues([[staff.name, staff.position, staff.homeClinic, staff.status]]);
        return { success: true, message: 'อัปเดตข้อมูลบุคลากรเรียบร้อย' };
      }
    }
    return { success: false, error: 'ไม่พบข้อมูลบุคลากร ' + staffId };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function deleteStaff(staffId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, error: 'ไม่พบชีทบุคลากร' };
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]) === String(staffId)) {
        sheet.deleteRow(i + 2);
        return { success: true, message: 'ลบข้อมูลบุคลากรเรียบร้อย' };
      }
    }
    return { success: false, error: 'ไม่พบข้อมูลบุคลากร ' + staffId };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * 6. CRUD: Daily_Workload
 */
function getWorkloadList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.WORKLOAD);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 16).getValues();
  return data.map(function(r) {
    var dateVal = r[1] instanceof Date ? Utilities.formatDate(r[1], 'Asia/Bangkok', 'yyyy-MM-dd') : String(r[1] || '');
    return {
      id: String(r[0] || ''),
      date: dateVal,
      shift: String(r[2] || ''),
      clinic: String(r[3] || ''),
      totalPt: Number(r[4] || 0),
      adultPt: Number(r[5] || 0),
      childPt: Number(r[6] || 0),
      admit: Number(r[7] || 0),
      hn: Number(r[8] || 0),
      rn: Number(r[9] || 0),
      pn: Number(r[10] || 0),
      na: Number(r[11] || 0),
      clerk: Number(r[12] || 0),
      serviceWorker: Number(r[13] || 0),
      note: String(r[14] || ''),
      reporter: String(r[15] || '')
    };
  });
}

function saveDailyWorkload(entry) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.WORKLOAD);
    if (!sheet) { setupDatabase(); sheet = ss.getSheetByName(SHEET_NAMES.WORKLOAD); }

    var recordId = entry.id || ('REC-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000));
    var row = [
      recordId,
      entry.date,
      entry.shift,
      entry.clinic,
      Number(entry.totalPt || 0),
      Number(entry.adultPt || 0),
      Number(entry.childPt || 0),
      Number(entry.admit || 0),
      Number(entry.hn || 0),
      Number(entry.rn || 0),
      Number(entry.pn || 0),
      Number(entry.na !== undefined ? entry.na : (entry.pca || 0)),
      Number(entry.clerk || 0),
      Number(entry.serviceWorker || 0),
      entry.note || '',
      entry.reporter || ''
    ];
    sheet.appendRow(row);
    return { success: true, message: 'บันทึกข้อมูลเรียบร้อยแล้ว', id: recordId };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function updateDailyWorkload(recordId, entry) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.WORKLOAD);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, error: 'ไม่พบชีทภาระงาน' };
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(recordId)) {
        var rowNum = i + 2;
        var rowData = [
          entry.date,
          entry.shift,
          entry.clinic,
          Number(entry.totalPt || 0),
          Number(entry.adultPt || 0),
          Number(entry.childPt || 0),
          Number(entry.admit || 0),
          Number(entry.hn || 0),
          Number(entry.rn || 0),
          Number(entry.pn || 0),
          Number(entry.na !== undefined ? entry.na : (entry.pca || 0)),
          Number(entry.clerk || 0),
          Number(entry.serviceWorker || 0),
          entry.note || '',
          entry.reporter || ''
        ];
        sheet.getRange(rowNum, 2, 1, 15).setValues([rowData]);
        return { success: true, message: 'อัปเดตข้อมูลภาระงานเรียบร้อย' };
      }
    }
    return { success: false, error: 'ไม่พบ Record_ID ' + recordId };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function deleteDailyWorkload(recordId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.WORKLOAD);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, error: 'ไม่พบชีทภาระงาน' };
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(recordId)) {
        sheet.deleteRow(i + 2);
        return { success: true, message: 'ลบรายการภาระงานเรียบร้อย' };
      }
    }
    return { success: false, error: 'ไม่พบ Record_ID ' + recordId };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * 7. CRUD: Leave_Records
 */
function getLeaveList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.LEAVE);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var cols = Math.max(8, sheet.getLastColumn());
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, cols).getValues();
  return data.map(function(r) {
    var sDate = r[1] instanceof Date ? Utilities.formatDate(r[1], 'Asia/Bangkok', 'yyyy-MM-dd') : String(r[1] || '');
    var eDate = r[2] instanceof Date ? Utilities.formatDate(r[2], 'Asia/Bangkok', 'yyyy-MM-dd') : String(r[2] || '');
    return {
      id: String(r[0] || ''),
      startDate: sDate,
      endDate: eDate,
      staffName: String(r[3] || ''),
      position: String(r[4] || 'RN'),
      clinic: String(r[5] || ''),
      leaveType: String(r[6] || 'ลาป่วย'),
      days: Number(r[7] || 1),
      note: String(r[8] || '')
    };
  });
}

function saveLeaveRecord(leave) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.LEAVE);
    if (!sheet) { setupDatabase(); sheet = ss.getSheetByName(SHEET_NAMES.LEAVE); }
    var leaveId = leave.id || ('LV-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000));
    var row = [
      leaveId,
      leave.startDate,
      leave.endDate,
      leave.staffName,
      leave.position,
      leave.clinic,
      leave.leaveType,
      Number(leave.days || 1),
      leave.note || ''
    ];
    sheet.appendRow(row);
    return { success: true, message: 'บันทึกวันลาเรียบร้อยแล้ว', id: leaveId };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function saveBatchLeave(records) {
  try {
    if (!records || records.length === 0) return { success: true };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.LEAVE);
    if (!sheet) { setupDatabase(); sheet = ss.getSheetByName(SHEET_NAMES.LEAVE); }
    var rows = records.map(function(l) {
      var leaveId = l.id || ('LV-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000));
      return [
        leaveId,
        l.startDate,
        l.endDate,
        l.staffName,
        l.position,
        l.clinic,
        l.leaveType,
        Number(l.days || 1),
        l.note || ''
      ];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
    return { success: true, message: 'บันทึกวันลา ' + rows.length + ' รายการสำเร็จ' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function updateLeaveRecord(leaveId, leave) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.LEAVE);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, error: 'ไม่พบชีทวันลา' };
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(leaveId)) {
        var rowNum = i + 2;
        var rowData = [
          leave.startDate,
          leave.endDate,
          leave.staffName,
          leave.position,
          leave.clinic,
          leave.leaveType,
          Number(leave.days || 1),
          leave.note || ''
        ];
        sheet.getRange(rowNum, 2, 1, 8).setValues([rowData]);
        return { success: true, message: 'อัปเดตข้อมูลการลาเรียบร้อย' };
      }
    }
    return { success: false, error: 'ไม่พบ Leave_ID ' + leaveId };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function deleteLeaveRecord(leaveId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.LEAVE);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, error: 'ไม่พบชีทวันลา' };
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(leaveId)) {
        sheet.deleteRow(i + 2);
        return { success: true, message: 'ลบประวัติการลาเรียบร้อย' };
      }
    }
    return { success: false, error: 'ไม่พบ Leave_ID ' + leaveId };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * 8. CRUD: OT_Attendance
 */
function getOTList() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.OT);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var cols = Math.max(7, sheet.getLastColumn());
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, cols).getValues();
  return data.map(function(r) {
    var dVal = r[1] instanceof Date ? Utilities.formatDate(r[1], 'Asia/Bangkok', 'yyyy-MM-dd') : String(r[1] || '');
    return {
      id: String(r[0] || ''),
      date: dVal,
      shift: String(r[2] || ''),
      staffName: String(r[3] || ''),
      position: String(r[4] || 'RN'),
      homeClinic: String(r[5] || ''),
      workClinic: String(r[6] || ''),
      isExternal: r[7] === 'External' || r[7] === true || r[7] === 'TRUE'
    };
  });
}

function saveBatchOT(records) {
  try {
    if (!records || records.length === 0) return { success: true };
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.OT);
    if (!sheet) { setupDatabase(); sheet = ss.getSheetByName(SHEET_NAMES.OT); }
    var rows = records.map(function(o) {
      var otId = o.id || ('OT-' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 1000));
      return [
        otId,
        o.date,
        o.shift,
        o.staffName,
        o.position,
        o.homeClinic,
        o.workClinic,
        o.isExternal ? 'External' : 'OPD'
      ];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
    return { success: true, message: 'บันทึกเวรนอกเวลา ' + rows.length + ' คน สำเร็จ' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function updateOTRecord(otId, record) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.OT);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, error: 'ไม่พบชีท OT' };
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(otId)) {
        var rowNum = i + 2;
        var rowData = [
          record.date,
          record.shift,
          record.staffName,
          record.position,
          record.homeClinic,
          record.workClinic,
          record.isExternal ? 'External' : 'OPD'
        ];
        sheet.getRange(rowNum, 2, 1, 7).setValues([rowData]);
        return { success: true, message: 'อัปเดตข้อมูลเวรนอกเวลาเรียบร้อย' };
      }
    }
    return { success: false, error: 'ไม่พบ OT_ID ' + otId };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function deleteOTRecord(otId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.OT);
    if (!sheet || sheet.getLastRow() <= 1) return { success: false, error: 'ไม่พบชีท OT' };
    var ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(otId)) {
        sheet.deleteRow(i + 2);
        return { success: true, message: 'ลบรายการเวรนอกเวลาเรียบร้อย' };
      }
    }
    return { success: false, error: 'ไม่พบ OT_ID ' + otId };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * 9. Settings Management
 */
function saveSettings(settingsData) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
    if (!sheet) { setupDatabase(); sheet = ss.getSheetByName(SHEET_NAMES.SETTINGS); }

    var existingPin = getConfiguredAdminPin_();
    var nextPin = String(settingsData.adminPin || '').trim();
    if (nextPin) {
      PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', nextPin);
      existingPin = nextPin;
    }

    var rows = [
      ['NHPPD', String(settingsData.nhppd || '0.4')],
      ['Std_Hr', String(settingsData.stdHr || '7')],
      ['Annual_Hr', String(settingsData.annualHr || '2080')],
      ['Work_Days', String(settingsData.workDays || '245')],
      ['Admin_Emails', Array.isArray(settingsData.adminEmails) ? settingsData.adminEmails.join(', ') : String(settingsData.adminEmails || '')],
      ['Admin_Pin', existingPin],
      ['In_Time_Clinics', Array.isArray(settingsData.inTimeClinics) ? settingsData.inTimeClinics.join(', ') : String(settingsData.inTimeClinics || DEFAULT_IN_TIME_CLINICS.join(', '))],
      ['Out_Time_Clinics', Array.isArray(settingsData.outTimeClinics) ? settingsData.outTimeClinics.join(', ') : String(settingsData.outTimeClinics || DEFAULT_OUT_TIME_CLINICS.join(', '))]
    ];

    sheet.clearContents();
    sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
    sheet.getRange(1, 1, 1, 2).setBackground('#374151').setFontColor('#ffffff').setFontWeight('bold');
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);

    return { success: true, message: 'บันทึกการตั้งค่าเรียบร้อยแล้ว' };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function verifyAdminPin(pin) {
  var entered = String(pin || '').trim();
  if (!entered) return { success: false };
  var savedPin = getConfiguredAdminPin_();
  if (savedPin) {
    return { success: entered === savedPin };
  }
  return { success: sha256Hex_(entered) === DEFAULT_PIN_SHA256 };
}
