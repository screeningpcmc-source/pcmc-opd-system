# ระบบบริหารจัดการข้อมูล OPD โรงพยาบาลศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน (PCMC)

เว็บแอปพลิเคชันสำหรับบริหารจัดการภาระงานผู้ป่วย เวรนอกเวลา (OT) การลา/อบรม การสรุปจำนวนผู้ป่วยประจำวัน (Daily Census) และการคำนวณ **Productivity, FTC และ Skill Mix** ของกลุ่มงานการพยาบาลผู้ป่วยนอก (OPD)

รองรับการใช้งานทั้งในรูปแบบ **React Web Application (Deploy บน GitHub Pages ได้ทันที)** และ **Google Apps Script (`Code.gs` + `gas/Index.html`) เชื่อมต่อ Google Sheets โดยตรง**

---

## ความสามารถหลักของระบบ (5 โมดูล)

1. **บันทึกภาระงานประจำวัน (Daily Workload Entry)**
   - บันทึกยอดผู้ป่วยทั้งหมด ผู้ใหญ่ เด็ก และยอดรับไว้รักษา (Admit) พร้อมคำนวณยอดรวมอัตโนมัติ
   - บันทึกกำลังคนปฏิบัติงานจริง (`HN`, `RN`, `PN`, `NA`, `ผู้ปฏิบัติงานทั่วไป`, `พนักงานบริการ`) รองรับหน่วย `0.5` แรง
   - เชื่อมโยงการลา, ไปอบรม/ประชุม (เลือกได้หลายคนพร้อมค้นหาชื่อ) หรือช่วยงานห้องอื่นภายในหน้าเดียว
   - ระบบซ่อนปุ่มแก้ไข/ถังขยะสำหรับผู้ใช้ทั่วไป และเปิดใช้งานเต็มรูปแบบเมื่อปลดล็อกสิทธิ์ Admin
2. **บันทึกเวรนอกเวลา & วันลา (OT & Leave Management)**
   - บันทึก OT ทั้งในเวลาราชการ (กรณีเจ้าหน้าที่นอกแผนกช่วยงาน), นอกเวลาเย็น และวันหยุด
   - บันทึกและติดตามประวัติการลา/อบรมรายบุคคล แยกรายเดือน รายบุคคล และหน่วยงาน พร้อมตารางสรุปปีงบประมาณ
3. **รายงานผู้ป่วยประจำวัน (Daily Census)**
   - ตารางสรุปยอดผู้ป่วยและกำลังคนแยกตามคลินิก/กะเวลา พร้อมแถวสรุปรวมทั้งสิ้น และปุ่มพิมพ์ / ส่งออก CSV
4. **สรุป Productivity & FTC**
   - คำนวณ `FTC`, `Output`, `Input`, `%Productivity` และ `Skill Mix (RN : PN : NA)` แยกรายเดือน พร้อมตัวเลือกคัดศูนย์เลสิกออก
5. **จัดการบุคลากร & ตั้งค่า (Admin)**
   - ระบบล็อกความปลอดภัยด้วยรหัสผ่าน Admin (ไม่ฝังรหัสผ่านไว้ในซอร์สโค้ด)
   - เพิ่ม/ลบ/ค้นหารายชื่อบุคลากร ปรับค่าคงที่ `NHPPD`, `Std Hr`, `Annual Hr`, `Work Days` และจัดการรายชื่อคลินิกในเวลา/นอกเวลา

---

## การติดตั้งและรันบนเครื่อง (Local Development)

### ข้อกำหนดเบื้องต้น
- Node.js เวอร์ชัน 20 ขึ้นไป

### ขั้นตอนการติดตั้ง
1. ติดตั้งแพ็กเกจทั้งหมด:
   ```bash
   npm install
   ```
2. คัดลอกไฟล์ตัวอย่างเพื่อสร้างไฟล์ตั้งค่าเฉพาะเครื่อง (`.env.local` จะไม่ถูกอัปโหลดขึ้น GitHub):
   ```bash
   cp .env.example .env.local
   ```
3. เปิดไฟล์ `.env.local` แล้วกำหนดค่าที่ต้องการ:
   - `VITE_ADMIN_PIN="รหัสผ่าน_Admin_ของคุณ"`
   - (ตัวเลือก) กำหนดค่า `VITE_FIREBASE_*` หากต้องการใช้งานปุ่ม **Sign in with Google** เพื่อสร้าง/บันทึกเข้า Google Sheets โดยตรง
4. รันเซิร์ฟเวอร์พัฒนา:
   ```bash
   npm run dev
   ```
   เปิดเบราว์เซอร์ไปที่ `http://localhost:3000`

---

## การอัปโหลดขึ้น GitHub และ Deploy บน GitHub Pages

> **หมายเหตุความปลอดภัย:** โปรเจกต์นี้ตั้งค่า `.gitignore` ให้ข้าม `.env*` และ `firebase-applet-config.json` และไม่ฝังรหัสผ่าน Admin ไว้ในซอร์สโค้ดแล้ว ก่อน Push สามารถตรวจสอบด้วยคำสั่ง `git status` ได้ทันที

### 1. สร้าง Repository บน GitHub และ Push โค้ด
1. สร้าง Repository ใหม่บน GitHub (เช่น `pcmc-opd-system`) โดยไม่ต้องติ๊กสร้าง README หรือ `.gitignore` ซ้ำ
2. เชื่อมต่อ Remote และ Push จากโฟลเดอร์โปรเจกต์:
   ```bash
   git remote add origin https://github.com/<USERNAME>/<REPO_NAME>.git
   git branch -M main
   git push -u origin main
   ```

### 2. ตั้งค่า GitHub Secrets (ซ่อนรหัสผ่านและคีย์ระบบ)
ไปที่หน้า Repository บน GitHub -> **Settings** -> **Secrets and variables** -> **Actions** -> **New repository secret** แล้วเพิ่มค่าดังนี้:

| ชื่อ Secret | คำอธิบาย | จำเป็นหรือไม่ |
| :--- | :--- | :--- |
| `VITE_ADMIN_PIN` | รหัสผ่านสำหรับปลดล็อกสิทธิ์ Admin | แนะนำให้ตั้งค่า |
| `VITE_FIREBASE_API_KEY` | Firebase API Key (สำหรับ Google Sign-In) | เฉพาะกรณีใช้เชื่อมต่อ Google Sheets |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth Domain | เฉพาะกรณีใช้เชื่อมต่อ Google Sheets |
| `VITE_FIREBASE_PROJECT_ID` | Firebase / GCP Project ID | เฉพาะกรณีใช้เชื่อมต่อ Google Sheets |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage Bucket | เฉพาะกรณีใช้เชื่อมต่อ Google Sheets |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Sender ID | เฉพาะกรณีใช้เชื่อมต่อ Google Sheets |
| `VITE_FIREBASE_APP_ID` | Firebase Web App ID | เฉพาะกรณีใช้เชื่อมต่อ Google Sheets |

*(หากไม่ได้ตั้งค่า `VITE_FIREBASE_*` เว็บแอปบน GitHub Pages ยังสามารถใช้งานบันทึกข้อมูลแบบ Local, ดูรายงาน, คำนวณ Productivity และส่งออก CSV/GAS ได้ครบถ้วน)*

### 3. เปิดใช้งาน GitHub Pages
1. ไปที่ **Settings** -> **Pages**
2. ตรงหัวข้อ **Build and deployment** -> **Source** เลือกเป็น **`GitHub Actions`**
3. เมื่อ Push โค้ดขึ้น Branch `main` (หรือกดสั่งรันในแท็บ **Actions**) ระบบจะ Build และเผยแพร่เว็บแอปให้โดยอัตโนมัติที่ `https://<USERNAME>.github.io/<REPO_NAME>/`

---

## คู่มือติดตั้งและใช้งาน Google Apps Script (GAS + Google Sheets)

สำหรับหน่วยงานที่ต้องการรันระบบบน **Google Sheets + Google Apps Script** แบบเบ็ดเสร็จ:

### 1. เตรียม Google Sheets และ Apps Script
1. สร้าง Google Sheets ไฟล์ใหม่ใน Google Drive (เช่น `PCMC_OPD_Database`)
2. ไปที่เมนู **ส่วนขยาย (Extensions)** -> **Apps Script**
3. นำไฟล์ในโปรเจกต์ไปวางใน Apps Script Editor:
   - คัดลอกโค้ดทั้งหมดจากไฟล์ `Code.gs` ไปวางทับไฟล์ `Code.gs` ใน Editor
   - กดเครื่องหมาย `+` เพิ่มไฟล์ HTML ชื่อ **`Index`** (ไม่ต้องใส่นามสกุล `.html`) แล้วคัดลอกโค้ดทั้งหมดจากไฟล์ `gas/Index.html` ไปวางทับทั้งหมด

### 2. ตั้งค่ารหัสผ่าน Admin อย่างปลอดภัยใน Script Properties
เพื่อไม่ให้รหัสผ่าน Admin ปรากฏในโค้ด `Code.gs`:
1. ใน Apps Script Editor ไปที่ **Project Settings** (รูปเฟืองด้านซ้าย)
2. เลื่อนลงไปที่หัวข้อ **Script Properties** -> กด **Add script property**
   - **Property**: `ADMIN_PIN`
   - **Value**: กรอกรหัสผ่าน Admin ที่ต้องการใช้งาน
   - กด **Save script properties**

### 3. สร้างฐานข้อมูล 5 ชีทอัตโนมัติ
1. กลับไปที่ไฟล์ `Code.gs` ใน Editor
2. เลือกฟังก์ชัน **`setupDatabase`** จากแถบด้านบน แล้วกด **Run** (อนุญาตสิทธิ์การเข้าถึง Google Sheets ในครั้งแรก)
3. ระบบจะสร้างชีททั้ง 5 ตารางให้อัตโนมัติ ได้แก่ `Staff_Master`, `Daily_Workload`, `Leave_Records`, `OT_Attendance` และ `Settings` พร้อมหัวตารางและข้อมูลบุคลากรตัวอย่าง

### 4. Deploy เป็น Web App
1. กดปุ่ม **Deploy** (มุมขวาบน) -> **New deployment**
2. เลือกประเภทเป็น **Web app**
3. ตั้งค่า:
   - **Execute as**: `Me` (ผู้ดูแลระบบเจ้าของชีท)
   - **Who has access**: เลือกตามสิทธิ์ของหน่วยงาน (เช่น `Anyone within organization` หรือ `Anyone with Google account`)
4. กด **Deploy** แล้วนำ Web App URL ที่ได้ไปใช้งานร่วมกันได้ทันที

---

## โครงสร้างไฟล์สำคัญ

- `src/` — ซอร์สโค้ด React + TypeScript + Tailwind CSS
- `Code.gs` — Backend Google Apps Script สำหรับจัดการข้อมูล 5 ชีทและการยืนยันสิทธิ์ Admin
- `gas/Index.html` — หน้าเว็บ Single-Page Application สำหรับ Google Apps Script (Bootstrap 5 + jQuery + Select2 + Chart.js + SweetAlert2)
- `.github/workflows/deploy.yml` — สคริปต์ Build และ Deploy อัตโนมัติขึ้น GitHub Pages
- `.env.example` — ตัวอย่างตัวแปรสภาพแวดล้อมสำหรับตั้งค่าโปรเจกต์
