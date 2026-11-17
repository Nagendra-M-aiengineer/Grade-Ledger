# GradeLedger — VTU Results, SGPA · CGPA · Percentage Calculator & Student Portal

A modern, university-grade web application for Visvesvaraya Technological University (VTU) engineering students. Check, fetch, and import official examination results directly from `results.vtu.ac.in`, store verified marksheets in student accounts, track degree progress, and automatically synchronize marks, credits, and grades across live SGPA and CGPA calculators.

---

## 🌟 Key Features

### 1. ⚡ Branch-Based Subject Auto-fill & Full Inline Editing
- **Supported Engineering Disciplines**:
  - **CSE / ISE**: Computer Science & Engineering / Information Science
  - **AIML / AIDS**: Artificial Intelligence & Machine Learning / Data Science
  - **ECE**: Electronics & Communication Engineering
  - **EEE**: Electrical & Electronics Engineering
  - **MECH**: Mechanical Engineering
  - **CIVIL**: Civil Engineering
  - **Sem 1 & Sem 2**: Common Physics Cycle (P-Cycle) and Chemistry Cycle (C-Cycle)
- **Auto-fill in SGPA Calculator**: Select your Branch and Semester, click **"⚡ Auto-fill Subjects"**, and all syllabus course codes, course names, and standard credits populate instantly.
- **100% Fully Editable**: If any elective, lab, or course differs for your college:
  - Edit any Subject Code, Course Title, Credits, or Marks directly inline.
  - Add custom subject/lab rows with **"+ Add Subject"**.
  - Remove unwanted rows with **"✕"**.
  - Live recalculation of grade points and SGPA as you type!

---

### 2. 🔄 Live Automatic Sync with SGPA & CGPA Calculators
- Once a result is fetched, checked, or edited in the **VTU Result Portal**:
  1. **SGPA Calculator Auto-Sync**: Automatically updates the SGPA table with the exact subjects, credits, and marks, and computes the semester SGPA.
  2. **CGPA Calculator Auto-Sync**: Automatically updates or inserts the semester into the CGPA ledger table with its total credits and SGPA, instantly recomputing cumulative CGPA!
  3. **Dashboard Strip Live Update**: Instantly refreshes **Latest SGPA**, **Latest CGPA**, and **Percentage** chips without requiring manual re-entry.
  4. **Student Profile Archive**: Permanently saves the verified marksheet to the student's profile transcript.

---

### 3. 🎓 Official VTU Result Portal Integration
- **Direct Live Links**: Instant access to official university result portals:
  - `https://results.vtu.ac.in` (Master Results Portal)
  - `https://results.vtu.ac.in/DJcbcs24/index.php` (Dec 2024 / Jan 2025 Regular & Revaluation)
  - `https://results.vtu.ac.in/FMEcbcs24/index.php` (June / July 2024 Regular & Revaluation)
- **Fast USN Lookup & Marksheet Importer**: Enter your 10-character USN (e.g. `1MS21CS089`) and choose your semester (Sem 1 to Sem 8) to fetch or load verified syllabus marksheets.
- **Auto-Calculations**:
  - Internal marks ($\text{CIE} \le 50$) $+$ External marks ($\text{SEE} \le 50$) $=$ Total Marks ($\le 100$).
  - Letter grade & grade points: $\text{O}=10, \text{A+}=9, \text{A}=8, \text{B+}=7, \text{B}=6, \text{C}=5, \text{P}=4, \text{F}=0$.
  - Semester SGPA: $\text{SGPA} = \frac{\sum (\text{Credits} \times \text{Grade Points})}{\sum \text{Credits}}$.
  - Official VTU Equivalent Percentage formula: $\text{Percentage} = (\text{SGPA} − 0.75) \times 10$.
- **Actions**:
  - **Save to Student Profile**: Permanently saves the semester marksheet to your student account.
  - **Send to SGPA Calculator**: Pre-fills the SGPA calculator table for further edits.
  - **Print Marksheet**: Generates a clean printable marksheet transcript.

---

### 4. 👤 Student Account & Profile
- **Authentication**:
  - Sign in with your USN & Password/PIN.
  - Register new student accounts (Name, USN, College, Branch, Scheme, Current Semester).
  - **⚡ Instant Demo Login**: Pre-loads demo student (*Nagendra M - 1MS21CS089*) with realistic records.
- **Academic Dashboard & Degree Progress**:
  - Cumulative CGPA tallied across all recorded semesters.
  - Degree progress bar (e.g., 5 of 8 semesters completed, 62.5%).
  - Class of Degree classification:
    - **First Class with Distinction (FCD)**: $\text{CGPA} \ge 7.75$
    - **First Class (FC)**: $\text{CGPA} \ge 6.75$
    - **Second Class (SC)**: $\text{CGPA} \ge 5.75$
    - **Pass Class**: $\text{CGPA} < 5.75$
- **Semester Transcripts Archive**:
  - Full archive of saved semester results with expandable subject tables.
  - Individual semester deletion and reload into calculators.

---

### 5. 📊 SGPA & CGPA Calculators & Converters
- **SGPA Calculator**: Mark-based (0–100) or letter-grade mode with customizable credits.
- **CGPA Calculator**: Combines multiple semester loads with one-click import from saved history.
- **Percentage Converter**: Bidirectional conversion with VTU, AICTE/CBSE, Standard, and custom multipliers/offsets.
- **Custom Grading Scales**: Built-in 10-point and 4.0 scales, plus custom grading schemes.

---

## 🚀 How to Run

1. **With Node.js**:
   ```bash
   node server.js
   ```
   Then open `http://localhost:3000` in your browser.

2. **Direct Browser**:
   Open `index.html` directly in any web browser (`file://`).

---

## 🔒 Data & Privacy
All student accounts, saved semester results, and calculations are stored securely in your browser's `localStorage` (`gradeledger_student_account_v1` and `gradeledger_state_v1`). No personal data is sent to external servers.
