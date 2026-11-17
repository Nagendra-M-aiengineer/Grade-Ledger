"use strict";

/* ==========================================================================
   Constants & storage
   ========================================================================== */
const STORAGE_KEY = "gradeledger_state_v1";

const BUILTIN_SCALES = {
  standard10: {
    name: "Standard 10-point",
    builtin: true,
    grades: [
      { letter: "O", point: 10, minMarks: 90, maxMarks: 100 },
      { letter: "A+", point: 9, minMarks: 80, maxMarks: 89 },
      { letter: "A", point: 8, minMarks: 70, maxMarks: 79 },
      { letter: "B+", point: 7, minMarks: 60, maxMarks: 69 },
      { letter: "B", point: 6, minMarks: 50, maxMarks: 59 },
      { letter: "C", point: 5, minMarks: 45, maxMarks: 49 },
      { letter: "P", point: 4, minMarks: 40, maxMarks: 44 },
      { letter: "F", point: 0, minMarks: 0, maxMarks: 39 },
    ],
  },
  scale4: {
    name: "4.0 Scale (US style)",
    builtin: true,
    grades: [
      { letter: "A", point: 4.0, minMarks: 93, maxMarks: 100 },
      { letter: "A-", point: 3.7, minMarks: 90, maxMarks: 92 },
      { letter: "B+", point: 3.3, minMarks: 87, maxMarks: 89 },
      { letter: "B", point: 3.0, minMarks: 83, maxMarks: 86 },
      { letter: "B-", point: 2.7, minMarks: 80, maxMarks: 82 },
      { letter: "C+", point: 2.3, minMarks: 77, maxMarks: 79 },
      { letter: "C", point: 2.0, minMarks: 73, maxMarks: 76 },
      { letter: "C-", point: 1.7, minMarks: 70, maxMarks: 72 },
      { letter: "D", point: 1.0, minMarks: 60, maxMarks: 69 },
      { letter: "F", point: 0.0, minMarks: 0, maxMarks: 59 },
    ],
  },
};

function defaultState() {
  return {
    scales: JSON.parse(JSON.stringify(BUILTIN_SCALES)),
    activeScaleId: "standard10",
    scoreInputMode: "marks", // "marks" | "grade"
    history: [],
    percentFormula: { preset: "offset75", multiplier: 10, offset: 0.75 },
  };
}

/* ==========================================================================
   Utilities
   ========================================================================== */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

const RING_CIRCUMFERENCE_LARGE = 2 * Math.PI * 52; // matches r=52 in result-ring svgs
const RING_CIRCUMFERENCE_MINI = 2 * Math.PI * 27; // matches r=27 in mini dashboard rings

/** Sets a circular progress ring's fill. fraction is 0..1 (values above 1 are clamped). */
function setRingProgress(elId, fraction, circumference) {
  const el = document.getElementById(elId);
  if (!el) return;
  const clamped = Math.max(0, Math.min(1, fraction || 0));
  const offset = circumference * (1 - clamped);
  el.style.strokeDasharray = String(circumference);
  el.style.strokeDashoffset = String(offset);
}

/** Returns a grade-point "tier" (high/mid/low) relative to the active scale's max point, for badge coloring. */
function tierForPoint(point) {
  const scale = activeScale();
  const maxPoint = Math.max(...scale.grades.map((g) => g.point), 1);
  const ratio = point / maxPoint;
  if (ratio >= 0.75) return "high";
  if (ratio >= 0.45) return "mid";
  return "low";
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return iso;
  }
}

/* ==========================================================================
   State load / save
   ========================================================================== */
let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // Basic shape validation with graceful fallback
    if (!parsed || typeof parsed !== "object" || !parsed.scales || !parsed.activeScaleId) {
      return defaultState();
    }
    if (!Array.isArray(parsed.history)) parsed.history = [];
    if (!parsed.percentFormula) parsed.percentFormula = { preset: "offset75", multiplier: 10, offset: 0.75 };
    if (!parsed.scoreInputMode) parsed.scoreInputMode = "marks";
    // Ensure built-in scales have mark ranges
    Object.keys(BUILTIN_SCALES).forEach((scaleId) => {
      if (parsed.scales[scaleId]) {
        parsed.scales[scaleId].grades.forEach((g, idx) => {
          const defaultG = BUILTIN_SCALES[scaleId].grades[idx];
          if (defaultG && g.minMarks === undefined) {
            g.minMarks = defaultG.minMarks;
            g.maxMarks = defaultG.maxMarks;
          }
        });
      }
    });
    return parsed;
  } catch (err) {
    console.error("GradeLedger: failed to load saved data, starting fresh.", err);
    return defaultState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("GradeLedger: failed to save data.", err);
    showToast("Couldn't save — your browser storage may be full or blocked.", true);
  }
}

/* ==========================================================================
   Theme (light / dark)
   ========================================================================== */
const THEME_KEY = "gradeledger_theme_v1";

function initTheme() {
  let theme = "light";
  try {
    theme = localStorage.getItem(THEME_KEY) ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  } catch (err) {
    console.error("GradeLedger: couldn't read theme preference.", err);
  }
  applyTheme(theme);

  document.getElementById("themeToggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch (err) { /* non-fatal */ }
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
}

/* ==========================================================================
   Dashboard summary strip
   ========================================================================== */
const lastComputed = { sgpa: null, cgpa: null, percent: null };

function primeLastComputedFromHistory() {
  const latestSgpaEntry = state.history.find((h) => h.type === "sgpa");
  const latestCgpaEntry = state.history.find((h) => h.type === "cgpa");
  if (latestSgpaEntry) lastComputed.sgpa = { value: latestSgpaEntry.sgpa, label: latestSgpaEntry.name };
  if (latestCgpaEntry) lastComputed.cgpa = { value: latestCgpaEntry.cgpa, label: latestCgpaEntry.name };
}

function getMaxScalePoint() {
  const scale = activeScale();
  if (!scale || !scale.grades || scale.grades.length === 0) return 10;
  return Math.max(...scale.grades.map((g) => g.point), 1);
}

function updateDashboard() {
  const maxPt = getMaxScalePoint();
  // SGPA
  if (lastComputed.sgpa) {
    document.getElementById("miniSgpaValue").textContent = lastComputed.sgpa.value.toFixed(2);
    document.getElementById("miniSgpaSub").textContent = lastComputed.sgpa.label || "Calculated";
    setRingProgress("miniSgpaRing", lastComputed.sgpa.value / maxPt, RING_CIRCUMFERENCE_MINI);
  }
  // CGPA
  if (lastComputed.cgpa) {
    document.getElementById("miniCgpaValue").textContent = lastComputed.cgpa.value.toFixed(2);
    document.getElementById("miniCgpaSub").textContent = lastComputed.cgpa.label || "Calculated";
    setRingProgress("miniCgpaRing", lastComputed.cgpa.value / maxPt, RING_CIRCUMFERENCE_MINI);
  }
  // Percentage
  if (lastComputed.percent !== null) {
    document.getElementById("miniPercentValue").textContent = lastComputed.percent.toFixed(1);
    document.getElementById("miniPercentSub").textContent = "of 100";
    setRingProgress("miniPercentRing", lastComputed.percent / 100, RING_CIRCUMFERENCE_MINI);
  }
  // History count
  const count = state.history.length;
  document.getElementById("historyCountValue").textContent = `${count} ${count === 1 ? "entry" : "entries"}`;
}

/* ==========================================================================
   Toasts
   ========================================================================== */
function showToast(message, isError) {
  const container = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " toast-error" : "");
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("toast-out");
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

/* ==========================================================================
   Tabs
   ========================================================================== */
function initTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab-btn"));
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activateTab(tab.dataset.panel));
  });
}

function activateTab(panelName) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    const active = btn.dataset.panel === panelName;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    const active = panel.id === "panel-" + panelName;
    panel.classList.toggle("is-active", active);
    panel.hidden = !active;
  });
  if (panelName === "history") renderHistory();
  if (panelName === "vtu") initVtuPortalView();
  if (panelName === "profile") renderStudentProfile();
  if (panelName === "percentage") {
    const input = document.getElementById("percentCgpaInput");
    if (input && (!input.value || input.value.trim() === "")) {
      if (lastComputed.cgpa && lastComputed.cgpa.value > 0) {
        input.value = lastComputed.cgpa.value.toFixed(2);
      } else if (lastComputed.sgpa && lastComputed.sgpa.value > 0) {
        input.value = lastComputed.sgpa.value.toFixed(2);
      }
    }
  }
}

/* ==========================================================================
   Grading scale helpers
   ========================================================================== */
function activeScale() {
  return state.scales[state.activeScaleId] || state.scales.standard10;
}

function populateScaleSelectors() {
  const active = document.getElementById("gradeScaleActive");
  const settings = document.getElementById("scaleSelector");
  [active, settings].forEach((sel) => (sel.innerHTML = ""));
  Object.entries(state.scales).forEach(([id, scale]) => {
    const optA = document.createElement("option");
    optA.value = id;
    optA.textContent = scale.name;
    active.appendChild(optA);

    const optB = optA.cloneNode(true);
    settings.appendChild(optB);
  });
  active.value = state.activeScaleId;
  settings.value = state.activeScaleId;
}

function gradeOptionsHtml(selectedLetter) {
  const scale = activeScale();
  let html = '<option value="">Select…</option>';
  scale.grades.forEach((g) => {
    const sel = g.letter === selectedLetter ? " selected" : "";
    html += `<option value="${escapeHtml(g.letter)}"${sel}>${escapeHtml(g.letter)} (${g.point})</option>`;
  });
  return html;
}

function pointForGrade(letter) {
  const scale = activeScale();
  const found = scale.grades.find((g) => g.letter === letter);
  return found ? found.point : null;
}

function gradeAndPointForMarks(marks) {
  if (marks === "" || marks === null || marks === undefined) return null;
  const m = Number(marks);
  if (isNaN(m) || m < 0) return null;
  const scale = activeScale();
  
  // Find grade entry by range
  for (const g of scale.grades) {
    const min = g.minMarks !== undefined ? Number(g.minMarks) : 0;
    const max = g.maxMarks !== undefined ? Number(g.maxMarks) : 100;
    if (m >= min && m <= max) {
      return { letter: g.letter, point: g.point };
    }
  }

  // Fallback defaults for 10-point scale
  if (m >= 90) return { letter: "O", point: 10 };
  if (m >= 80) return { letter: "A+", point: 9 };
  if (m >= 70) return { letter: "A", point: 8 };
  if (m >= 60) return { letter: "B+", point: 7 };
  if (m >= 50) return { letter: "B", point: 6 };
  if (m >= 45) return { letter: "C", point: 5 };
  if (m >= 40) return { letter: "P", point: 4 };
  return { letter: "F", point: 0 };
}

function refreshAllGradeDropdowns() {
  document.querySelectorAll("#subjectRows .ledger-row").forEach((row) => {
    const select = row.querySelector(".subj-grade");
    if (select) {
      const current = select.value;
      select.innerHTML = gradeOptionsHtml(current);
      if (!select.value) select.value = "";
    }
    updateRowPointDisplay(row);
  });
  recalcSgpaLive();
}

/* ---- Grading Scale panel (editable table) ---- */
function renderGradeScaleTable() {
  const tbody = document.getElementById("gradeScaleRows");
  tbody.innerHTML = "";
  const scale = activeScale();
  scale.grades.forEach((g) => addGradeRow(g.letter, g.minMarks, g.maxMarks, g.point));
  toggleScaleEditability();
}

function addGradeRow(letter, minMarks, maxMarks, point) {
  const tbody = document.getElementById("gradeScaleRows");
  const tpl = document.getElementById("gradeRowTemplate");
  const row = tpl.content.firstElementChild.cloneNode(true);
  row.querySelector(".grade-letter").value = letter || "";
  row.querySelector(".grade-min").value = minMarks ?? "";
  row.querySelector(".grade-max").value = maxMarks ?? "";
  row.querySelector(".grade-point").value = point ?? "";
  row.querySelector(".row-remove").addEventListener("click", () => row.remove());
  tbody.appendChild(row);
}

function toggleScaleEditability() {
  const scale = activeScale();
  const deleteBtn = document.getElementById("deleteScaleBtn");
  deleteBtn.disabled = !!scale.builtin;
  deleteBtn.style.opacity = scale.builtin ? "0.4" : "1";
  deleteBtn.title = scale.builtin ? "Built-in scales can't be deleted" : "Delete this scale";
}

function collectGradeRowsFromDom() {
  const rows = Array.from(document.querySelectorAll("#gradeScaleRows .ledger-row"));
  const grades = [];
  const seen = new Set();
  for (const row of rows) {
    const letter = row.querySelector(".grade-letter").value.trim();
    const minRaw = row.querySelector(".grade-min").value;
    const maxRaw = row.querySelector(".grade-max").value;
    const pointRaw = row.querySelector(".grade-point").value;
    if (!letter && minRaw === "" && maxRaw === "" && pointRaw === "") continue; // skip fully empty rows
    if (!letter) throw new Error("Every grade needs a letter (e.g. A, B+).");
    if (pointRaw === "" || isNaN(Number(pointRaw))) throw new Error(`Grade "${letter}" needs a numeric point value.`);
    const point = Number(pointRaw);
    if (point < 0 || point > 10) throw new Error(`Grade "${letter}" point value should be between 0 and 10.`);
    const minMarks = minRaw !== "" ? Number(minRaw) : 0;
    const maxMarks = maxRaw !== "" ? Number(maxRaw) : 100;
    if (isNaN(minMarks) || isNaN(maxMarks) || minMarks < 0 || maxMarks > 100 || minMarks > maxMarks) {
      throw new Error(`Grade "${letter}" marks range must be between 0 and 100 with Min marks ≤ Max marks.`);
    }
    if (seen.has(letter.toUpperCase())) throw new Error(`Grade "${letter}" is listed more than once.`);
    seen.add(letter.toUpperCase());
    grades.push({ letter, minMarks, maxMarks, point });
  }
  if (grades.length === 0) throw new Error("Add at least one grade to the scale.");
  return grades;
}

function initScalePanel() {
  document.getElementById("scaleSelector").addEventListener("change", (e) => {
    state.activeScaleId = e.target.value;
    saveState();
    renderGradeScaleTable();
    populateScaleSelectors();
    refreshAllGradeDropdowns();
  });

  document.getElementById("addGradeRowBtn").addEventListener("click", () => addGradeRow("", ""));

  document.getElementById("createScaleBtn").addEventListener("click", () => {
    const input = document.getElementById("newScaleName");
    const name = input.value.trim();
    const errEl = document.getElementById("scaleError");
    errEl.textContent = "";
    if (!name) {
      errEl.textContent = "Give the new scale a name first.";
      return;
    }
    const id = "custom_" + uid();
    state.scales[id] = {
      name,
      builtin: false,
      grades: [
        { letter: "A", minMarks: 80, maxMarks: 100, point: 10 },
        { letter: "B", minMarks: 0, maxMarks: 79, point: 5 },
      ],
    };
    state.activeScaleId = id;
    saveState();
    input.value = "";
    populateScaleSelectors();
    renderGradeScaleTable();
    refreshAllGradeDropdowns();
    showToast(`Scale "${name}" created.`);
  });

  document.getElementById("deleteScaleBtn").addEventListener("click", () => {
    const scale = activeScale();
    if (scale.builtin) return;
    if (!confirm(`Delete the scale "${scale.name}"? This can't be undone.`)) return;
    delete state.scales[state.activeScaleId];
    state.activeScaleId = "standard10";
    saveState();
    populateScaleSelectors();
    renderGradeScaleTable();
    refreshAllGradeDropdowns();
    showToast("Scale deleted.");
  });

  document.getElementById("saveScaleBtn").addEventListener("click", () => {
    const errEl = document.getElementById("scaleError");
    errEl.textContent = "";
    try {
      const grades = collectGradeRowsFromDom();
      state.scales[state.activeScaleId].grades = grades;
      saveState();
      renderGradeScaleTable();
      refreshAllGradeDropdowns();
      showToast("Grading scale saved.");
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.getElementById("gradeScaleActive").addEventListener("change", (e) => {
    state.activeScaleId = e.target.value;
    saveState();
    document.getElementById("scaleSelector").value = e.target.value;
    refreshAllGradeDropdowns();
  });
}

/* ==========================================================================
   SGPA panel
   ========================================================================== */
function setScoreInputMode(mode) {
  state.scoreInputMode = mode;
  saveState();

  const isMarks = mode === "marks";
  const btnMarks = document.getElementById("modeMarksBtn");
  const btnGrade = document.getElementById("modeGradeBtn");
  if (btnMarks) btnMarks.classList.toggle("is-active", isMarks);
  if (btnGrade) btnGrade.classList.toggle("is-active", !isMarks);

  const head = document.getElementById("subjectColScoreHead");
  if (head) head.textContent = isMarks ? "Marks (0–100)" : "Grade";

  document.querySelectorAll("#subjectRows .ledger-row").forEach((row) => {
    const marksInput = row.querySelector(".subj-marks");
    const gradeSelect = row.querySelector(".subj-grade");
    if (marksInput) marksInput.hidden = !isMarks;
    if (gradeSelect) gradeSelect.hidden = isMarks;
    updateRowPointDisplay(row);
  });

  recalcSgpaLive();
}

function addSubjectRow(data) {
  const tbody = document.getElementById("subjectRows");
  const tpl = document.getElementById("subjectRowTemplate");
  const row = tpl.content.firstElementChild.cloneNode(true);

  const gradeSelect = row.querySelector(".subj-grade");
  const marksInput = row.querySelector(".subj-marks");

  gradeSelect.innerHTML = gradeOptionsHtml(data && data.grade);

  const isMarks = (state.scoreInputMode || "marks") === "marks";
  marksInput.hidden = !isMarks;
  gradeSelect.hidden = isMarks;

  if (data) {
    row.querySelector(".subj-name").value = data.name || "";
    row.querySelector(".subj-credit").value = data.credit ?? "";
    if (data.marks !== undefined && data.marks !== null) marksInput.value = data.marks;
    if (data.grade) gradeSelect.value = data.grade;
  }

  row.querySelector(".row-remove").addEventListener("click", () => {
    row.remove();
    recalcSgpaLive();
  });

  ["input", "change"].forEach((evt) => {
    row.querySelectorAll("input, select").forEach((el) =>
      el.addEventListener(evt, () => {
        updateRowPointDisplay(row);
        recalcSgpaLive();
      })
    );
  });

  tbody.appendChild(row);
  updateRowPointDisplay(row);
  return row;
}

function updateRowPointDisplay(row) {
  const display = row.querySelector(".subj-points-display");
  let pt = null;
  let letter = null;

  const isMarks = (state.scoreInputMode || "marks") === "marks";

  if (isMarks) {
    const marksRaw = row.querySelector(".subj-marks").value.trim();
    if (marksRaw !== "") {
      const info = gradeAndPointForMarks(marksRaw);
      if (info) {
        pt = info.point;
        letter = info.letter;
      }
    }
  } else {
    const grade = row.querySelector(".subj-grade").value;
    if (grade) {
      pt = pointForGrade(grade);
      letter = grade;
    }
  }

  if (pt === null) {
    display.textContent = "—";
    display.removeAttribute("data-tier");
    display.removeAttribute("title");
  } else {
    display.innerHTML = letter ? `${pt.toFixed(1)} <span class="subj-grade-badge">${escapeHtml(letter)}</span>` : pt.toFixed(1);
    display.setAttribute("data-tier", tierForPoint(pt));
    display.title = letter ? `Grade: ${letter} (${pt.toFixed(1)} pts)` : `${pt.toFixed(1)} pts`;
  }
}

function readSubjectRows() {
  return Array.from(document.querySelectorAll("#subjectRows .ledger-row")).map((row) => ({
    row,
    name: row.querySelector(".subj-name").value.trim(),
    creditRaw: row.querySelector(".subj-credit").value,
    marksRaw: row.querySelector(".subj-marks") ? row.querySelector(".subj-marks").value : "",
    grade: row.querySelector(".subj-grade") ? row.querySelector(".subj-grade").value : "",
  }));
}

function clearRowInvalid(row) {
  row.querySelectorAll("input, select").forEach((el) => el.classList.remove("invalid"));
}

/** Computes SGPA from current DOM rows.
 *  strict = true -> validates fully and returns {errors:[...]} if any row is incomplete/invalid
 *  strict = false -> silently ignores incomplete rows (for live preview) */
function computeSgpaFromRows(strict) {
  const rows = readSubjectRows();
  const errors = [];
  let totalCredits = 0;
  let weighted = 0;
  let countedSubjects = 0;
  const isMarks = (state.scoreInputMode || "marks") === "marks";

  // Filter rows that have any input entered
  const activeRows = rows.filter(({ name, creditRaw, marksRaw, grade }) =>
    name || creditRaw !== "" || (isMarks ? marksRaw !== "" : grade)
  );

  if (strict && activeRows.length === 0) {
    errors.push(`Add at least one subject with credits and ${isMarks ? "marks" : "a grade"} before calculating.`);
  }

  activeRows.forEach(({ row, name, creditRaw, marksRaw, grade }, idx) => {
    clearRowInvalid(row);
    const credit = Number(creditRaw);
    let rowValid = true;

    // Use name if provided, otherwise default to Subject N
    const effectiveName = name || `Subject ${idx + 1}`;

    if (creditRaw === "" || isNaN(credit) || credit <= 0 || credit > 30) {
      if (strict) {
        errors.push(`Row ${idx + 1} (${effectiveName}): credit must be a number greater than 0 (≤ 30).`);
        row.querySelector(".subj-credit").classList.add("invalid");
      }
      rowValid = false;
    }

    let point = null;
    if (isMarks) {
      const marks = Number(marksRaw);
      if (marksRaw === "" || isNaN(marks) || marks < 0 || marks > 100) {
        if (strict) {
          errors.push(`Row ${idx + 1} (${effectiveName}): enter valid marks between 0 and 100.`);
          row.querySelector(".subj-marks").classList.add("invalid");
        }
        rowValid = false;
      } else {
        const info = gradeAndPointForMarks(marks);
        if (!info) {
          if (strict) errors.push(`Row ${idx + 1}: could not determine grade point for marks.`);
          rowValid = false;
        } else {
          point = info.point;
        }
      }
    } else {
      if (!grade) {
        if (strict) {
          errors.push(`Row ${idx + 1} (${effectiveName}): choose a grade.`);
          row.querySelector(".subj-grade").classList.add("invalid");
        }
        rowValid = false;
      } else {
        point = pointForGrade(grade);
        if (point === null) {
          if (strict) errors.push(`Row ${idx + 1}: unrecognized grade.`);
          rowValid = false;
        }
      }
    }

    if (!rowValid || point === null) return;

    totalCredits += credit;
    weighted += credit * point;
    countedSubjects += 1;
  });

  const sgpa = totalCredits > 0 ? weighted / totalCredits : 0;
  return {
    errors,
    valid: errors.length === 0 && countedSubjects > 0,
    sgpa: round2(sgpa),
    totalCredits: round2(totalCredits),
    weighted: round2(weighted),
    subjectCount: countedSubjects,
  };
}

function recalcSgpaLive() {
  const result = computeSgpaFromRows(false);
  if (result.subjectCount > 0) {
    showSgpaResult(result);
  }
}

function showSgpaResult(result) {
  const card = document.getElementById("sgpaResultCard");
  card.hidden = false;
  document.getElementById("sgpaValue").textContent = result.sgpa.toFixed(2);
  document.getElementById("sgpaTotalCredits").textContent = result.totalCredits;
  document.getElementById("sgpaSubjectCount").textContent = result.subjectCount;
  document.getElementById("sgpaWeightedPoints").textContent = result.weighted.toFixed(2);
  setRingProgress("sgpaRingProgress", result.sgpa / getMaxScalePoint(), RING_CIRCUMFERENCE_LARGE);

  const name = document.getElementById("semesterName").value.trim() || "Current semester";
  lastComputed.sgpa = { value: result.sgpa, label: name };
  updateDashboard();
}

function getCurrentSubjectsSnapshot() {
  const isMarks = (state.scoreInputMode || "marks") === "marks";
  return readSubjectRows()
    .filter((r) => (r.name || r.creditRaw !== "") && (isMarks ? r.marksRaw !== "" : r.grade))
    .map((r, idx) => {
      let pt = 0;
      let letter = "";
      if (isMarks) {
        const info = gradeAndPointForMarks(r.marksRaw);
        if (info) {
          pt = info.point;
          letter = info.letter;
        }
      } else {
        pt = pointForGrade(r.grade) || 0;
        letter = r.grade;
      }
      return {
        name: r.name || `Subject ${idx + 1}`,
        credit: Number(r.creditRaw) || 0,
        marks: r.marksRaw !== "" ? Number(r.marksRaw) : null,
        grade: letter,
        point: pt,
      };
    });
}

function initSgpaPanel() {
  document.getElementById("modeMarksBtn").addEventListener("click", () => setScoreInputMode("marks"));
  document.getElementById("modeGradeBtn").addEventListener("click", () => setScoreInputMode("grade"));

  // Apply saved scoreInputMode
  setScoreInputMode(state.scoreInputMode || "marks");

  addSubjectRow();
  addSubjectRow();

  document.getElementById("addSubjectBtn").addEventListener("click", () => addSubjectRow());

  document.getElementById("calcSgpaBtn").addEventListener("click", () => {
    const errEl = document.getElementById("sgpaError");
    const result = computeSgpaFromRows(true);
    if (result.errors.length) {
      errEl.textContent = result.errors[0];
      showToast("Fix the highlighted fields before calculating.", true);
      return;
    }
    errEl.textContent = "";
    showSgpaResult(result);
    showToast("SGPA calculated.");
  });

  document.getElementById("clearSgpaBtn").addEventListener("click", () => {
    if (!confirm("Clear the current semester form?")) return;
    document.getElementById("subjectRows").innerHTML = "";
    document.getElementById("semesterName").value = "";
    document.getElementById("sgpaError").textContent = "";
    document.getElementById("sgpaResultCard").hidden = true;
    addSubjectRow();
    addSubjectRow();
  });

  document.getElementById("saveSemesterBtn").addEventListener("click", () => {
    const result = computeSgpaFromRows(true);
    const errEl = document.getElementById("sgpaError");
    if (result.errors.length) {
      errEl.textContent = result.errors[0];
      showToast("Fix the highlighted fields before saving.", true);
      return;
    }
    errEl.textContent = "";
    const nameInput = document.getElementById("semesterName");
    const name = nameInput.value.trim() || `Semester ${state.history.filter((h) => h.type === "sgpa").length + 1}`;
    const entry = {
      id: uid(),
      type: "sgpa",
      name,
      date: new Date().toISOString(),
      sgpa: result.sgpa,
      totalCredits: result.totalCredits,
      subjects: getCurrentSubjectsSnapshot(),
    };
    state.history.unshift(entry);
    saveState();
    updateDashboard();
    showToast(`"${name}" saved to history.`);
  });

  document.getElementById("sendToCgpaBtn").addEventListener("click", () => {
    const result = computeSgpaFromRows(true);
    const errEl = document.getElementById("sgpaError");
    if (result.errors.length) {
      errEl.textContent = result.errors[0];
      showToast("Fix the highlighted fields first.", true);
      return;
    }
    errEl.textContent = "";
    const name = document.getElementById("semesterName").value.trim() || "Semester";
    addSemesterRow({ name, credit: result.totalCredits, sgpa: result.sgpa });
    activateTab("cgpa");
    recalcCgpaLive();
    showToast("Sent to CGPA calculator.");
  });

  const sendSgpaToPercentBtn = document.getElementById("sendSgpaToPercentBtn");
  if (sendSgpaToPercentBtn) {
    sendSgpaToPercentBtn.addEventListener("click", () => {
      let result = computeSgpaFromRows(false);
      let sgpaVal = (result && result.valid && result.sgpa > 0) ? result.sgpa : (lastComputed.sgpa ? lastComputed.sgpa.value : null);
      if (!sgpaVal || sgpaVal <= 0) {
        result = computeSgpaFromRows(true);
        const errEl = document.getElementById("sgpaError");
        if (result.errors.length) {
          errEl.textContent = result.errors[0];
          showToast(result.errors[0], true);
        } else {
          showToast("Calculate or enter an SGPA first.", true);
        }
        return;
      }
      setPercentDirection("toPercent");
      const input = document.getElementById("percentCgpaInput");
      input.value = sgpaVal.toFixed(2);
      const select = document.getElementById("formulaPreset");
      if (select && (!select.value || select.value === "standard")) {
        select.value = "offset75";
      }
      activateTab("percentage");
      updateFormulaDisplay();
      document.getElementById("calcPercentBtn").click();
      showToast(`Converted SGPA ${sgpaVal.toFixed(2)} to percentage!`);
    });
  }
}

/* ==========================================================================
   CGPA panel
   ========================================================================== */
function addSemesterRow(data) {
  const tbody = document.getElementById("semesterRows");
  const tpl = document.getElementById("semesterRowTemplate");
  const row = tpl.content.firstElementChild.cloneNode(true);
  if (data) {
    row.querySelector(".sem-name").value = data.name || "";
    row.querySelector(".sem-credit").value = data.credit ?? "";
    row.querySelector(".sem-sgpa").value = data.sgpa ?? "";
  }
  if (data && data.sourceId) row.dataset.sourceId = data.sourceId;

  row.querySelector(".row-remove").addEventListener("click", () => {
    row.remove();
    recalcCgpaLive();
  });
  ["input", "change"].forEach((evt) => {
    row.querySelectorAll("input").forEach((el) =>
      el.addEventListener(evt, () => {
        updateSemesterWeightedDisplay(row);
        recalcCgpaLive();
      })
    );
  });

  tbody.appendChild(row);
  updateSemesterWeightedDisplay(row);
  return row;
}

function updateSemesterWeightedDisplay(row) {
  const credit = Number(row.querySelector(".sem-credit").value);
  const sgpa = Number(row.querySelector(".sem-sgpa").value);
  const display = row.querySelector(".sem-weighted-display");
  if (!credit || !sgpa || isNaN(credit) || isNaN(sgpa)) {
    display.textContent = "—";
  } else {
    display.textContent = round2(credit * sgpa).toFixed(2);
  }
}

function readSemesterRows() {
  return Array.from(document.querySelectorAll("#semesterRows .ledger-row")).map((row) => ({
    row,
    name: row.querySelector(".sem-name").value.trim(),
    creditRaw: row.querySelector(".sem-credit").value,
    sgpaRaw: row.querySelector(".sem-sgpa").value,
  }));
}

function computeCgpaFromRows(strict) {
  const rows = readSemesterRows();
  const errors = [];
  let totalCredits = 0;
  let weighted = 0;
  let countedSemesters = 0;

  // Clear invalid styling first on all rows
  rows.forEach(({ row }) => clearRowInvalid(row));

  // A row is considered entered if user typed an SGPA (non-empty)
  const enteredRows = rows.filter(({ sgpaRaw }) => sgpaRaw !== "" && sgpaRaw !== null && sgpaRaw !== undefined);

  if (strict && enteredRows.length === 0) {
    errors.push("Please enter SGPA for at least one semester before calculating.");
  }

  const maxPoint = Math.max(10, getMaxScalePoint());

  // Only validate rows that actually have an SGPA entered (or partially entered)
  enteredRows.forEach(({ row, name, creditRaw, sgpaRaw }, idx) => {
    const credit = Number(creditRaw);
    const sgpa = Number(sgpaRaw);
    let rowValid = true;

    // Use name if provided, otherwise default to Semester N
    const effectiveName = name || `Semester ${idx + 1}`;

    if (creditRaw === "" || isNaN(credit) || credit <= 0 || credit > 80) {
      if (strict) {
        errors.push(`Row ${idx + 1} (${effectiveName}): credits must be a number greater than 0 (≤ 80).`);
        row.querySelector(".sem-credit").classList.add("invalid");
      }
      rowValid = false;
    }
    if (isNaN(sgpa) || sgpa < 0 || sgpa > maxPoint) {
      if (strict) {
        errors.push(`Row ${idx + 1} (${effectiveName}): SGPA must be between 0 and ${maxPoint}.`);
        row.querySelector(".sem-sgpa").classList.add("invalid");
      }
      rowValid = false;
    }
    if (!rowValid) return;

    totalCredits += credit;
    weighted += credit * sgpa;
    countedSemesters += 1;
  });

  const cgpa = totalCredits > 0 ? weighted / totalCredits : 0;
  return {
    errors,
    valid: errors.length === 0 && countedSemesters > 0,
    cgpa: round2(cgpa),
    totalCredits: round2(totalCredits),
    weighted: round2(weighted),
    semesterCount: countedSemesters,
  };
}

function recalcCgpaLive() {
  const result = computeCgpaFromRows(false);
  if (result.semesterCount > 0) showCgpaResult(result);
}

function showCgpaResult(result) {
  const card = document.getElementById("cgpaResultCard");
  card.hidden = false;
  document.getElementById("cgpaValue").textContent = result.cgpa.toFixed(2);
  document.getElementById("cgpaTotalCredits").textContent = result.totalCredits;
  document.getElementById("cgpaSemesterCount").textContent = result.semesterCount;
  document.getElementById("cgpaWeightedPoints").textContent = result.weighted.toFixed(2);
  setRingProgress("cgpaRingProgress", result.cgpa / getMaxScalePoint(), RING_CIRCUMFERENCE_LARGE);

  lastComputed.cgpa = { value: result.cgpa, label: `${result.semesterCount} semester${result.semesterCount > 1 ? "s" : ""}` };
  updateDashboard();
}

function getCurrentSemestersSnapshot() {
  return readSemesterRows()
    .filter((r) => r.creditRaw !== "" && r.sgpaRaw !== "")
    .map((r, idx) => ({
      name: r.name || `Semester ${idx + 1}`,
      credit: Number(r.creditRaw),
      sgpa: Number(r.sgpaRaw),
    }));
}

function initCgpaPanel() {
  // Add initial empty rows if table is empty
  if (document.querySelectorAll("#semesterRows .ledger-row").length === 0) {
    addSemesterRow({ name: "Semester 1", credit: 20, sgpa: "" });
    addSemesterRow({ name: "Semester 2", credit: 20, sgpa: "" });
  }

  document.getElementById("addSemesterBtn").addEventListener("click", () => addSemesterRow());

  document.getElementById("importSemestersBtn").addEventListener("click", () => {
    const existingIds = new Set(
      Array.from(document.querySelectorAll("#semesterRows .ledger-row"))
        .map((r) => r.dataset.sourceId)
        .filter(Boolean)
    );
    const sgpaEntries = state.history.filter((h) => h.type === "sgpa");
    let imported = 0;
    sgpaEntries.forEach((entry) => {
      if (existingIds.has(entry.id)) return;
      addSemesterRow({ name: entry.name, credit: entry.totalCredits, sgpa: entry.sgpa, sourceId: entry.id });
      imported++;
    });
    if (imported === 0) {
      showToast(sgpaEntries.length ? "All saved semesters are already imported." : "No saved semesters yet — save one from the SGPA calculator first.");
    } else {
      showToast(`Imported ${imported} saved semester${imported > 1 ? "s" : ""}.`);
      recalcCgpaLive();
    }
  });

  document.getElementById("calcCgpaBtn").addEventListener("click", () => {
    const errEl = document.getElementById("cgpaError");
    const result = computeCgpaFromRows(true);
    if (result.errors.length) {
      errEl.textContent = result.errors[0];
      showToast("Fix the highlighted fields before calculating.", true);
      return;
    }
    errEl.textContent = "";
    showCgpaResult(result);
    showToast("CGPA calculated.");
  });

  document.getElementById("clearCgpaBtn").addEventListener("click", () => {
    if (!confirm("Clear the CGPA table?")) return;
    document.getElementById("semesterRows").innerHTML = "";
    document.getElementById("cgpaError").textContent = "";
    document.getElementById("cgpaResultCard").hidden = true;
    addSemesterRow({ name: "Semester 1", credit: 20, sgpa: "" });
    addSemesterRow({ name: "Semester 2", credit: 20, sgpa: "" });
  });

  document.getElementById("saveCgpaBtn").addEventListener("click", () => {
    const result = computeCgpaFromRows(true);
    const errEl = document.getElementById("cgpaError");
    if (result.errors.length) {
      errEl.textContent = result.errors[0];
      showToast("Fix the highlighted fields before saving.", true);
      return;
    }
    errEl.textContent = "";
    const entry = {
      id: uid(),
      type: "cgpa",
      name: `CGPA snapshot — ${result.semesterCount} semester${result.semesterCount > 1 ? "s" : ""}`,
      date: new Date().toISOString(),
      cgpa: result.cgpa,
      totalCredits: result.totalCredits,
      semesterCount: result.semesterCount,
      semesters: getCurrentSemestersSnapshot(),
    };
    state.history.unshift(entry);
    saveState();
    updateDashboard();
    showToast("CGPA snapshot saved to history.");
  });

  document.getElementById("sendToPercentBtn").addEventListener("click", () => {
    let result = computeCgpaFromRows(false);
    let cgpaVal = null;
    if (result && result.valid && result.cgpa > 0) {
      cgpaVal = result.cgpa;
    } else if (lastComputed.cgpa && lastComputed.cgpa.value > 0) {
      cgpaVal = lastComputed.cgpa.value;
    } else if (currentStudent && Array.isArray(currentStudent.savedResults) && currentStudent.savedResults.length > 0) {
      let tCred = 0, tW = 0;
      currentStudent.savedResults.forEach((r) => {
        tCred += r.totalCredits;
        tW += r.totalCredits * r.sgpa;
      });
      if (tCred > 0) cgpaVal = round2(tW / tCred);
    }

    if (cgpaVal === null || cgpaVal <= 0) {
      result = computeCgpaFromRows(true);
      const errEl = document.getElementById("cgpaError");
      if (result.errors.length) {
        errEl.textContent = result.errors[0];
        showToast(result.errors[0], true);
      } else {
        showToast("Enter SGPA for at least one semester before converting to percentage.", true);
      }
      return;
    }

    setPercentDirection("toPercent");
    const input = document.getElementById("percentCgpaInput");
    input.value = cgpaVal.toFixed(2);
    const select = document.getElementById("formulaPreset");
    if (select && (!select.value || select.value === "standard")) {
      select.value = "offset75";
    }
    activateTab("percentage");
    updateFormulaDisplay();
    // Auto convert immediately so percentage result card & ring appear right away!
    document.getElementById("calcPercentBtn").click();
    showToast(`Converted CGPA ${cgpaVal.toFixed(2)} to percentage!`);
  });
}

/* ==========================================================================
   Percentage panel (Bidirectional: CGPA/SGPA <-> Percentage)
   ========================================================================== */
let percentDirection = "toPercent"; // "toPercent" | "toCgpa"

function currentFormulaParams() {
  const preset = document.getElementById("formulaPreset").value;
  const isToCgpa = percentDirection === "toCgpa";

  let multiplier = 10;
  let offset = 0;

  if (preset === "standard") {
    multiplier = 10;
    offset = 0;
  } else if (preset === "aicte") {
    multiplier = 9.5;
    offset = 0;
  } else if (preset === "offset75") {
    multiplier = 10;
    offset = 0.75;
  } else if (preset === "offset25") {
    multiplier = 10;
    offset = 0.25;
  } else if (preset === "custom") {
    multiplier = Number(document.getElementById("customMultiplier").value) || 10;
    offset = Number(document.getElementById("customOffset").value) || 0;
  }

  let label = "";
  if (!isToCgpa) {
    if (preset === "standard") label = "Percentage = CGPA × 10";
    else if (preset === "aicte") label = "Percentage = CGPA × 9.5";
    else if (preset === "offset75") label = "Percentage = (CGPA − 0.75) × 10";
    else if (preset === "offset25") label = "Percentage = (CGPA − 0.25) × 10";
    else {
      const offsetPart = offset !== 0 ? ` − ${offset}` : "";
      label = `Percentage = (CGPA${offsetPart}) × ${multiplier}`;
    }
  } else {
    if (preset === "standard") label = "CGPA = Percentage ÷ 10";
    else if (preset === "aicte") label = "CGPA = Percentage ÷ 9.5";
    else if (preset === "offset75") label = "CGPA = (Percentage ÷ 10) + 0.75";
    else if (preset === "offset25") label = "CGPA = (Percentage ÷ 10) + 0.25";
    else {
      const offsetPart = offset !== 0 ? ` + ${offset}` : "";
      label = `CGPA = (Percentage ÷ ${multiplier})${offsetPart}`;
    }
  }

  return { multiplier, offset, label, preset };
}

function updateFormulaDisplay() {
  const { label } = currentFormulaParams();
  document.getElementById("formulaDisplay").textContent = label;
}

function updateFormulaOptions() {
  const select = document.getElementById("formulaPreset");
  const currentVal = select.value || "offset75";
  const isToCgpa = percentDirection === "toCgpa";

  if (!isToCgpa) {
    select.innerHTML = `
      <option value="offset75">VTU CBCS (Official) — Percentage = (CGPA − 0.75) × 10</option>
      <option value="standard">Standard — Percentage = CGPA × 10</option>
      <option value="aicte">AICTE / CBSE — Percentage = CGPA × 9.5</option>
      <option value="offset25">Offset formula — Percentage = (CGPA − 0.25) × 10</option>
      <option value="custom">Custom formula…</option>
    `;
  } else {
    select.innerHTML = `
      <option value="offset75">VTU CBCS (Official) — CGPA = (Percentage ÷ 10) + 0.75</option>
      <option value="standard">Standard — CGPA = Percentage ÷ 10</option>
      <option value="aicte">AICTE / CBSE — CGPA = Percentage ÷ 9.5</option>
      <option value="offset25">Offset formula — CGPA = (Percentage ÷ 10) + 0.25</option>
      <option value="custom">Custom formula…</option>
    `;
  }
  if (currentVal && select.querySelector(`option[value="${currentVal}"]`)) {
    select.value = currentVal;
  } else {
    select.value = "offset75";
  }
  updateCustomFieldLabels();
  updateFormulaDisplay();
}

function updateCustomFieldLabels() {
  const isToCgpa = percentDirection === "toCgpa";
  const offsetLabel = document.getElementById("customOffsetLabel");
  if (offsetLabel) {
    offsetLabel.textContent = isToCgpa ? "Offset (added after dividing)" : "Offset (subtracted before multiplying)";
  }
}

function setPercentDirection(direction) {
  percentDirection = direction;
  const isToCgpa = direction === "toCgpa";

  document.getElementById("dirCgpaToPercentBtn").classList.toggle("is-active", !isToCgpa);
  document.getElementById("dirPercentToCgpaBtn").classList.toggle("is-active", isToCgpa);

  const inputLabel = document.getElementById("percentInputLabel");
  const input = document.getElementById("percentCgpaInput");
  const errEl = document.getElementById("percentError");
  errEl.textContent = "";
  input.classList.remove("invalid");

  if (isToCgpa) {
    inputLabel.textContent = "Percentage (%) to convert";
    input.placeholder = "e.g. 82.60";
    input.min = "0";
    input.max = "100";
    input.step = "0.01";
  } else {
    inputLabel.textContent = "CGPA (or SGPA) to convert";
    input.placeholder = "e.g. 8.26";
    input.min = "0";
    input.max = "10";
    input.step = "0.01";
  }

  updateFormulaOptions();
  document.getElementById("percentResultCard").hidden = true;
}

function initPercentPanel() {
  const presetSelect = document.getElementById("formulaPreset");
  const customFields = document.getElementById("customFormulaFields");

  document.getElementById("dirCgpaToPercentBtn").addEventListener("click", () => setPercentDirection("toPercent"));
  document.getElementById("dirPercentToCgpaBtn").addEventListener("click", () => setPercentDirection("toCgpa"));

  presetSelect.addEventListener("change", () => {
    customFields.hidden = presetSelect.value !== "custom";
    updateFormulaDisplay();
  });

  ["customMultiplier", "customOffset"].forEach((id) =>
    document.getElementById(id).addEventListener("input", updateFormulaDisplay)
  );

  document.getElementById("percentCgpaInput").addEventListener("input", () => {
    document.getElementById("percentCgpaInput").classList.remove("invalid");
  });

  document.getElementById("calcPercentBtn").addEventListener("click", () => {
    const errEl = document.getElementById("percentError");
    const input = document.getElementById("percentCgpaInput");
    let rawVal = input.value.trim();
    let val = Number(rawVal);
    errEl.textContent = "";
    input.classList.remove("invalid");

    const isToCgpa = percentDirection === "toCgpa";

    if (isToCgpa) {
      if (rawVal === "" || isNaN(val) || val < 0 || val > 100) {
        errEl.textContent = "Enter a valid percentage between 0 and 100%.";
        input.classList.add("invalid");
        showToast("Enter a valid percentage to convert.", true);
        return;
      }

      const { multiplier, offset, label } = currentFormulaParams();
      if (multiplier === 0) {
        errEl.textContent = "Multiplier cannot be zero.";
        return;
      }
      const cgpa = round2((val / multiplier) + offset);

      const card = document.getElementById("percentResultCard");
      card.hidden = false;
      document.getElementById("percentValue").textContent = cgpa.toFixed(2);
      document.getElementById("percentResultLabel").textContent = "Equivalent CGPA / SGPA";

      const offsetPart = offset !== 0 ? ` + ${offset}` : "";
      document.getElementById("formulaUsedText").textContent =
        `${label}  →  (${val} ÷ ${multiplier})${offsetPart} = ${cgpa.toFixed(2)}`;

      const maxPt = getMaxScalePoint();
      setRingProgress("percentRingProgress", Math.min(1, Math.max(0, cgpa / maxPt)), RING_CIRCUMFERENCE_LARGE);

      const actions = document.getElementById("percentResultActions");
      actions.hidden = false;
      lastComputed.cgpa = { value: cgpa, label: "From percentage" };
      updateDashboard();
      showToast("Converted to CGPA successfully.");
    } else {
      const maxPt = Math.max(10, getMaxScalePoint());

      // Intelligent fallback: if input is empty, grab from active CGPA or SGPA
      if (rawVal === "" || isNaN(val)) {
        if (lastComputed.cgpa && lastComputed.cgpa.value > 0) {
          val = lastComputed.cgpa.value;
          input.value = val.toFixed(2);
          rawVal = input.value;
        } else if (lastComputed.sgpa && lastComputed.sgpa.value > 0) {
          val = lastComputed.sgpa.value;
          input.value = val.toFixed(2);
          rawVal = input.value;
        }
      }

      if (rawVal === "" || isNaN(val) || val < 0 || val > maxPt) {
        errEl.textContent = `Enter a valid CGPA or SGPA between 0 and ${maxPt}.`;
        input.classList.add("invalid");
        showToast("Enter a valid CGPA or SGPA to convert.", true);
        return;
      }

      const { multiplier, offset, label } = currentFormulaParams();
      // Ensure percentage is never negative if val < offset
      const percentage = Math.max(0, round2((val - offset) * multiplier));

      const card = document.getElementById("percentResultCard");
      card.hidden = false;
      document.getElementById("percentValue").innerHTML = `${percentage.toFixed(2)}<span class="unit">%</span>`;
      document.getElementById("percentResultLabel").textContent = "Equivalent Percentage";

      const cgpaPart = offset ? `${val} − ${offset}` : `${val}`;
      document.getElementById("formulaUsedText").textContent =
        `${label}  →  (${cgpaPart}) × ${multiplier} = ${percentage.toFixed(2)}%`;
      setRingProgress("percentRingProgress", Math.min(1, Math.max(0, percentage / 100)), RING_CIRCUMFERENCE_LARGE);

      const actions = document.getElementById("percentResultActions");
      actions.hidden = true;
      lastComputed.percent = percentage;
      updateDashboard();
      showToast("Converted to percentage successfully.");
    }
  });

  document.getElementById("sendConvertedToCgpaBtn").addEventListener("click", () => {
    const cgpaVal = parseFloat(document.getElementById("percentValue").textContent);
    if (isNaN(cgpaVal)) return;
    addSemesterRow({ name: "Semester (Converted)", credit: 20, sgpa: cgpaVal });
    activateTab("cgpa");
    recalcCgpaLive();
    showToast("Sent converted CGPA to semester table.");
  });

  document.getElementById("clearPercentBtn").addEventListener("click", () => {
    document.getElementById("percentCgpaInput").value = "";
    document.getElementById("percentError").textContent = "";
    document.getElementById("percentResultCard").hidden = true;
    presetSelect.value = "standard";
    customFields.hidden = true;
    updateFormulaOptions();
  });

  updateFormulaOptions();
}

/* ==========================================================================
   History panel
   ========================================================================== */
function renderHistory() {
  const list = document.getElementById("historyList");
  const empty = document.getElementById("historyEmpty");
  list.innerHTML = "";

  if (state.history.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  state.history.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.dataset.type = entry.type;

    if (entry.type === "sgpa") {
      item.innerHTML = `
        <div class="history-item-head">
          <div class="history-item-title">
            <h3>${escapeHtml(entry.name)}</h3>
            <span class="history-tag">SGPA</span>
          </div>
          <span class="history-item-date">${formatDate(entry.date)}</span>
        </div>
        <div class="history-item-stats">
          <span>SGPA: <strong>${entry.sgpa.toFixed(2)}</strong></span>
          <span>Credits: <strong>${entry.totalCredits}</strong></span>
          <span>Subjects: <strong>${entry.subjects.length}</strong></span>
        </div>
        <div class="history-subjects">${entry.subjects.map((s) => {
          const scoreInfo = (s.marks !== null && s.marks !== undefined)
            ? `${s.marks} marks · ${escapeHtml(s.grade || "")}`
            : escapeHtml(s.grade || "");
          return `${escapeHtml(s.name)} (${s.credit} cr, ${scoreInfo})`;
        }).join(" · ")}</div>
        <div class="history-actions">
          <button class="btn btn-outline btn-sm reload-btn">Reload into SGPA form</button>
          <button class="btn btn-ghost btn-danger-text delete-btn">Delete</button>
        </div>
      `;
      item.querySelector(".reload-btn").addEventListener("click", () => reloadSgpaEntry(entry));
    } else {
      item.innerHTML = `
        <div class="history-item-head">
          <div class="history-item-title">
            <h3>${escapeHtml(entry.name)}</h3>
            <span class="history-tag">CGPA</span>
          </div>
          <span class="history-item-date">${formatDate(entry.date)}</span>
        </div>
        <div class="history-item-stats">
          <span>CGPA: <strong>${entry.cgpa.toFixed(2)}</strong></span>
          <span>Credits: <strong>${entry.totalCredits}</strong></span>
          <span>Semesters: <strong>${entry.semesterCount}</strong></span>
        </div>
        <div class="history-subjects">${entry.semesters.map((s) => `${escapeHtml(s.name)} (${s.credit} cr, SGPA ${s.sgpa})`).join(" · ")}</div>
        <div class="history-actions">
          <button class="btn btn-outline btn-sm reload-btn">Reload into CGPA table</button>
          <button class="btn btn-ghost btn-danger-text delete-btn">Delete</button>
        </div>
      `;
      item.querySelector(".reload-btn").addEventListener("click", () => reloadCgpaEntry(entry));
    }

    item.querySelector(".delete-btn").addEventListener("click", () => {
      if (!confirm("Delete this saved entry? This can't be undone.")) return;
      state.history = state.history.filter((h) => h.id !== entry.id);
      saveState();
      renderHistory();
      updateDashboard();
      showToast("Entry deleted.");
    });

    list.appendChild(item);
  });
}

function reloadSgpaEntry(entry) {
  document.getElementById("subjectRows").innerHTML = "";
  document.getElementById("semesterName").value = entry.name;
  const hasMarks = entry.subjects.some((s) => s.marks !== null && s.marks !== undefined && s.marks !== "");
  setScoreInputMode(hasMarks ? "marks" : "grade");
  entry.subjects.forEach((s) => addSubjectRow(s));
  if (entry.subjects.length === 0) { addSubjectRow(); addSubjectRow(); }
  activateTab("sgpa");
  recalcSgpaLive();
  showToast(`"${entry.name}" loaded into the SGPA form — edit and recalculate as needed.`);
}

function reloadCgpaEntry(entry) {
  document.getElementById("semesterRows").innerHTML = "";
  entry.semesters.forEach((s) => addSemesterRow(s));
  activateTab("cgpa");
  recalcCgpaLive();
  showToast("Snapshot loaded into the CGPA table — edit and recalculate as needed.");
}

function initHistoryPanel() {
  document.getElementById("clearHistoryBtn").addEventListener("click", () => {
    if (state.history.length === 0) return;
    if (!confirm("Clear all saved history? This can't be undone.")) return;
    state.history = [];
    saveState();
    renderHistory();
    updateDashboard();
    showToast("History cleared.");
  });
}

/* ==========================================================================
   Help dialog
   ========================================================================== */
function initHelpDialog() {
  const dialog = document.getElementById("helpDialog");
  document.getElementById("helpToggle").addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("click", (e) => {
    const rect = dialog.getBoundingClientRect();
    const isInDialog = (
      rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX && e.clientX <= rect.left + rect.width
    );
    if (!isInDialog) {
      dialog.close();
    }
  });
}

/* ==========================================================================
   Init
   ========================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  populateScaleSelectors();
  initTabs();
  initScalePanel();
  renderGradeScaleTable();
  initSgpaPanel();
  initCgpaPanel();
  initPercentPanel();
  initHistoryPanel();
  initHelpDialog();
  renderHistory();
  primeLastComputedFromHistory();
  updateDashboard();
});


/* ==========================================================================
   VTU Result Portal, Branch Syllabus Engine & Student Account Module
   ========================================================================== */

const STUDENT_STORAGE_KEY = "gradeledger_student_account_v1";

// Comprehensive VTU CBCS Syllabus Catalog by Engineering Branch & Semester
const VTU_BRANCH_SYLLABUS = {
  // First Year Common Cycles
  common_p_cycle: [
    { code: "21MAT11", name: "Calculus and Linear Algebra", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
    { code: "21PHY12", name: "Applied Physics for Engineers", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
    { code: "21ELE13", name: "Basic Electrical Engineering", credit: 3, cie: 42, see: 40, total: 82, grade: "A+", points: 9, result: "P" },
    { code: "21CIV14", name: "Elements of Civil Engineering", credit: 3, cie: 46, see: 46, total: 92, grade: "O", points: 10, result: "P" },
    { code: "21EVN15", name: "Environmental Studies & Life Skills", credit: 1, cie: 48, see: 46, total: 94, grade: "O", points: 10, result: "P" },
    { code: "21PHYL16", name: "Engineering Physics Laboratory", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
    { code: "21ELEL17", name: "Basic Electrical Engg Laboratory", credit: 1, cie: 47, see: 47, total: 94, grade: "O", points: 10, result: "P" },
    { code: "21EGH18", name: "Professional Writing Skills in English", credit: 1, cie: 44, see: 44, total: 88, grade: "A+", points: 9, result: "P" }
  ],
  common_c_cycle: [
    { code: "21MAT21", name: "Advanced Calculus & Numerical Methods", credit: 3, cie: 43, see: 42, total: 85, grade: "A+", points: 9, result: "P" },
    { code: "21CHE22", name: "Engineering Chemistry", credit: 3, cie: 45, see: 44, total: 89, grade: "A+", points: 9, result: "P" },
    { code: "21PSP23", name: "Problem Solving through C Programming", credit: 3, cie: 47, see: 46, total: 93, grade: "O", points: 10, result: "P" },
    { code: "21ELN24", name: "Basic Electronics & Communication", credit: 3, cie: 42, see: 41, total: 83, grade: "A+", points: 9, result: "P" },
    { code: "21CHEL26", name: "Engineering Chemistry Laboratory", credit: 1, cie: 48, see: 48, total: 96, grade: "O", points: 10, result: "P" },
    { code: "21CPL27", name: "Computer Programming Laboratory", credit: 1, cie: 49, see: 47, total: 96, grade: "O", points: 10, result: "P" },
    { code: "21IDT28", name: "Innovation & Design Thinking", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
  ],

  // Computer Science & Engineering / Information Science
  CSE: {
    3: [
      { code: "21MAT31", name: "Transform Calculus, Fourier Series & Numerical Tech", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21CS32", name: "Data Structures and Applications", credit: 4, cie: 48, see: 46, total: 94, grade: "O", points: 10, result: "P" },
      { code: "21CS33", name: "Analog and Digital Electronics", credit: 4, cie: 42, see: 40, total: 82, grade: "A+", points: 9, result: "P" },
      { code: "21CS34", name: "Computer Organization and Architecture", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21CSL35", name: "Data Structures Laboratory", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21CIP37", name: "Constitution of India & Cyber Law", credit: 1, cie: 45, see: 45, total: 90, grade: "O", points: 10, result: "P" }
    ],
    4: [
      { code: "21MAT41", name: "Mathematical Foundations for Computing", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21CS42", name: "Design and Analysis of Algorithms", credit: 4, cie: 47, see: 45, total: 92, grade: "O", points: 10, result: "P" },
      { code: "21CS43", name: "Operating Systems Principles", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21CS44", name: "Microcontroller & Embedded Systems", credit: 3, cie: 41, see: 39, total: 80, grade: "A+", points: 9, result: "P" },
      { code: "21CSL46", name: "Algorithms Laboratory", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21UH49", name: "Universal Human Values", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    5: [
      { code: "21CS51", name: "Automata Theory and Compiler Design", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21CS52", name: "Computer Networks & Protocols", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21CS53", name: "Database Management Systems", credit: 4, cie: 47, see: 45, total: 92, grade: "O", points: 10, result: "P" },
      { code: "21CS54", name: "Artificial Intelligence & Machine Learning", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21CSL55", name: "DBMS Laboratory with Mini Project", credit: 1, cie: 48, see: 48, total: 96, grade: "O", points: 10, result: "P" },
      { code: "21RMI56", name: "Research Methodology and IPR", credit: 2, cie: 44, see: 43, total: 87, grade: "A+", points: 9, result: "P" },
      { code: "21CIV57", name: "Environmental Studies & Ethics", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    6: [
      { code: "21CS61", name: "Software Engineering & Project Management", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21CS62", name: "Full Stack Web Development", credit: 4, cie: 48, see: 46, total: 94, grade: "O", points: 10, result: "P" },
      { code: "21CS63", name: "Cloud Computing & DevOps", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21CS641", name: "Cyber Security & Digital Forensics", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21CSL66", name: "Full Stack Development Laboratory", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21CSP67", name: "Mini Project in CS", credit: 2, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" }
    ],
    7: [
      { code: "21CS71", name: "Big Data Analytics & Engineering", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21CS72", name: "Deep Learning Architectures", credit: 3, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21CS731", name: "Blockchain Technologies", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21CSO74", name: "Open Elective - Renewable Energy", credit: 3, cie: 42, see: 40, total: 82, grade: "A+", points: 9, result: "P" },
      { code: "21CSP75", name: "Major Project Work Phase - 1", credit: 2, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" }
    ],
    8: [
      { code: "21CS81", name: "Technical Seminar", credit: 1, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" },
      { code: "21CSP82", name: "Major Project Work Phase - 2", credit: 8, cie: 49, see: 47, total: 96, grade: "O", points: 10, result: "P" },
      { code: "21INT83", name: "Full Semester Industry Internship", credit: 5, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" }
    ]
  },

  // AI & Machine Learning / Data Science
  AIML: {
    3: [
      { code: "21MAT31", name: "Mathematics for Machine Learning", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21AI32", name: "Data Structures & Algorithm Design", credit: 4, cie: 47, see: 45, total: 92, grade: "O", points: 10, result: "P" },
      { code: "21AI33", name: "Foundations of Artificial Intelligence", credit: 4, cie: 48, see: 46, total: 94, grade: "O", points: 10, result: "P" },
      { code: "21AI34", name: "Object Oriented Programming with Java", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21AIL35", name: "Data Structures & AI Lab", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21CIP37", name: "Constitution of India & Cyber Law", credit: 1, cie: 45, see: 45, total: 90, grade: "O", points: 10, result: "P" }
    ],
    4: [
      { code: "21MAT41", name: "Applied Probability & Statistics for AI", credit: 3, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21AI42", name: "Design & Analysis of Algorithms", credit: 4, cie: 47, see: 45, total: 92, grade: "O", points: 10, result: "P" },
      { code: "21AI43", name: "Operating Systems with Virtualization", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21AI44", name: "Database Systems for Big Data", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21AIL46", name: "Python for Data Science Lab", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21UH49", name: "Universal Human Values", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    5: [
      { code: "21AI51", name: "Supervised & Unsupervised Machine Learning", credit: 4, cie: 48, see: 46, total: 94, grade: "O", points: 10, result: "P" },
      { code: "21AI52", name: "Deep Learning & Neural Networks", credit: 4, cie: 47, see: 45, total: 92, grade: "O", points: 10, result: "P" },
      { code: "21AI53", name: "Computer Vision Systems", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21AI54", name: "Natural Language Processing", credit: 3, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21AIL55", name: "Machine Learning Laboratory", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21RMI56", name: "Research Methodology and IPR", credit: 2, cie: 44, see: 43, total: 87, grade: "A+", points: 9, result: "P" },
      { code: "21CIV57", name: "Environmental Studies & Ethics", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    6: [
      { code: "21AI61", name: "Generative AI and Large Language Models", credit: 4, cie: 48, see: 46, total: 94, grade: "O", points: 10, result: "P" },
      { code: "21AI62", name: "Reinforcement Learning & Robotics", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21AI63", name: "AI in Cloud & MLOps Pipelines", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21AI642", name: "Healthcare & Biomedical Analytics", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21AIL66", name: "MLOps & Model Deployment Lab", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21AIP67", name: "Mini Project in AI Systems", credit: 2, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" }
    ],
    7: [
      { code: "21AI71", name: "Autonomous Systems & Edge AI", credit: 3, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21AI72", name: "AI Ethics, Governance & Safety", credit: 3, cie: 45, see: 44, total: 89, grade: "A+", points: 9, result: "P" },
      { code: "21AI73x", name: "Speech & Audio Processing", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21AIO74", name: "Open Elective - IoT Systems", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21AIP75", name: "Major Project Phase - 1", credit: 2, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" }
    ],
    8: [
      { code: "21AI81", name: "Technical Seminar in AI", credit: 1, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" },
      { code: "21AIP82", name: "Major Project Work Phase - 2", credit: 8, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21INT83", name: "Full Semester AI Industry Internship", credit: 5, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" }
    ]
  },

  // Electronics & Communication Engineering
  ECE: {
    3: [
      { code: "21MAT31", name: "Transform Calculus & Complex Analysis", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21EC32", name: "Electronic Devices & Circuit Theory", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21EC33", name: "Digital System Design with Verilog", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21EC34", name: "Network Theory & Signals Analysis", credit: 3, cie: 42, see: 40, total: 82, grade: "A+", points: 9, result: "P" },
      { code: "21ECL35", name: "Analog & Digital Circuits Lab", credit: 1, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" },
      { code: "21CIP37", name: "Constitution of India & Cyber Law", credit: 1, cie: 45, see: 45, total: 90, grade: "O", points: 10, result: "P" }
    ],
    4: [
      { code: "21MAT41", name: "Complex Variables & Linear Algebra", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21EC42", name: "Analog Communication & Information Theory", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21EC43", name: "Microcontroller Architecture & Interfacing", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21EC44", name: "Signals & Systems", credit: 3, cie: 42, see: 40, total: 82, grade: "A+", points: 9, result: "P" },
      { code: "21ECL46", name: "Microcontroller Laboratory", credit: 1, cie: 48, see: 48, total: 96, grade: "O", points: 10, result: "P" },
      { code: "21UH49", name: "Universal Human Values", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    5: [
      { code: "21EC51", name: "Digital Signal Processing", credit: 4, cie: 47, see: 45, total: 92, grade: "O", points: 10, result: "P" },
      { code: "21EC52", name: "Digital Communication Systems", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21EC53", name: "VLSI Design and Technology", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21EC54", name: "Electromagnetic Waves & Antennas", credit: 3, cie: 42, see: 40, total: 82, grade: "A+", points: 9, result: "P" },
      { code: "21ECL55", name: "DSP & Digital Communication Lab", credit: 1, cie: 48, see: 48, total: 96, grade: "O", points: 10, result: "P" },
      { code: "21RMI56", name: "Research Methodology and IPR", credit: 2, cie: 44, see: 43, total: 87, grade: "A+", points: 9, result: "P" },
      { code: "21CIV57", name: "Environmental Studies & Ethics", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    6: [
      { code: "21EC61", name: "Embedded Systems & IoT Architectures", credit: 4, cie: 48, see: 46, total: 94, grade: "O", points: 10, result: "P" },
      { code: "21EC62", name: "Microwave Engineering & Radar", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21EC63", name: "Wireless Communication & 5G Networks", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21EC641", name: "Automotive Electronics", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21ECL66", name: "Embedded & IoT Laboratory", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21ECP67", name: "Mini Project in Electronics", credit: 2, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" }
    ],
    7: [
      { code: "21EC71", name: "Optical Fiber Communication", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21EC72", name: "Satellite Communication & Navigation", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21EC731", name: "Deep Learning for Signal Processing", credit: 3, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21ECO74", name: "Open Elective - Embedded Sensors", credit: 3, cie: 42, see: 40, total: 82, grade: "A+", points: 9, result: "P" },
      { code: "21ECP75", name: "Major Project Work Phase - 1", credit: 2, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" }
    ],
    8: [
      { code: "21EC81", name: "Technical Seminar in ECE", credit: 1, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" },
      { code: "21ECP82", name: "Major Project Work Phase - 2", credit: 8, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21INT83", name: "Full Semester Industry Internship", credit: 5, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" }
    ]
  },

  // Electrical & Electronics Engineering
  EEE: {
    3: [
      { code: "21MAT31", name: "Transform Calculus & Numerical Methods", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21EE32", name: "Electric Circuit Analysis", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21EE33", name: "Transformers and Generators", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21EE34", name: "Analog Electronic Circuits", credit: 3, cie: 42, see: 40, total: 82, grade: "A+", points: 9, result: "P" },
      { code: "21EEL35", name: "Electrical Machines Laboratory - 1", credit: 1, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" },
      { code: "21CIP37", name: "Constitution of India & Cyber Law", credit: 1, cie: 45, see: 45, total: 90, grade: "O", points: 10, result: "P" }
    ],
    4: [
      { code: "21MAT41", name: "Applied Mathematics for Electrical Engineers", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21EE42", name: "Power Electronics and Drives", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21EE43", name: "Induction Machines and Synchronous Motors", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21EE44", name: "Electromagnetic Field Theory", credit: 3, cie: 41, see: 39, total: 80, grade: "A+", points: 9, result: "P" },
      { code: "21EEL46", name: "Power Electronics Laboratory", credit: 1, cie: 48, see: 48, total: 96, grade: "O", points: 10, result: "P" },
      { code: "21UH49", name: "Universal Human Values", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    5: [
      { code: "21EE51", name: "Power Systems Analysis - 1", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21EE52", name: "Control Systems Engineering", credit: 4, cie: 47, see: 45, total: 92, grade: "O", points: 10, result: "P" },
      { code: "21EE53", name: "Microcontroller Architecture & PLC", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21EE54", name: "Renewable Energy Sources", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21EEL55", name: "Control Systems Lab", credit: 1, cie: 48, see: 48, total: 96, grade: "O", points: 10, result: "P" },
      { code: "21RMI56", name: "Research Methodology and IPR", credit: 2, cie: 44, see: 43, total: 87, grade: "A+", points: 9, result: "P" },
      { code: "21CIV57", name: "Environmental Studies & Ethics", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    6: [
      { code: "21EE61", name: "Power Systems Analysis - 2", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21EE62", name: "Electric Vehicle Technologies", credit: 4, cie: 48, see: 46, total: 94, grade: "O", points: 10, result: "P" },
      { code: "21EE63", name: "High Voltage Engineering", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21EE641", name: "Smart Grid Infrastructure", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21EEL66", name: "Relay & High Voltage Lab", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21EEP67", name: "Mini Project in Electrical", credit: 2, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" }
    ],
    7: [
      { code: "21EE71", name: "Power System Protection & Switchgear", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21EE72", name: "Industrial Drives & Applications", credit: 3, cie: 45, see: 44, total: 89, grade: "A+", points: 9, result: "P" },
      { code: "21EE73x", name: "AI Applications in Power Systems", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21EEO74", name: "Open Elective - Energy Auditing", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21EEP75", name: "Major Project Work Phase - 1", credit: 2, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" }
    ],
    8: [
      { code: "21EE81", name: "Technical Seminar in EEE", credit: 1, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" },
      { code: "21EEP82", name: "Major Project Work Phase - 2", credit: 8, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21INT83", name: "Full Semester Industry Internship", credit: 5, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" }
    ]
  },

  // Mechanical Engineering
  MECH: {
    3: [
      { code: "21MAT31", name: "Transform Calculus & Numerical Methods", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21ME32", name: "Applied Thermodynamics", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21ME33", name: "Material Science and Metallurgy", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21ME34", name: "Mechanics of Materials", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21MEL35", name: "Material Testing Laboratory", credit: 1, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" },
      { code: "21CIP37", name: "Constitution of India & Cyber Law", credit: 1, cie: 45, see: 45, total: 90, grade: "O", points: 10, result: "P" }
    ],
    4: [
      { code: "21MAT41", name: "Applied Mathematics for Mechanical Engineers", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21ME42", name: "Fluid Mechanics & Machinery", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21ME43", name: "Kinematics of Machines", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21ME44", name: "Manufacturing Process Technology", credit: 3, cie: 42, see: 40, total: 82, grade: "A+", points: 9, result: "P" },
      { code: "21MEL46", name: "Fluid Mechanics Laboratory", credit: 1, cie: 48, see: 48, total: 96, grade: "O", points: 10, result: "P" },
      { code: "21UH49", name: "Universal Human Values", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    5: [
      { code: "21ME51", name: "Design of Machine Elements - 1", credit: 4, cie: 47, see: 45, total: 92, grade: "O", points: 10, result: "P" },
      { code: "21ME52", name: "Dynamics of Machinery", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21ME53", name: "Turbo Machines", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21ME54", name: "Heat Transfer Principles", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21MEL55", name: "Heat Transfer & Dynamics Lab", credit: 1, cie: 48, see: 48, total: 96, grade: "O", points: 10, result: "P" },
      { code: "21RMI56", name: "Research Methodology and IPR", credit: 2, cie: 44, see: 43, total: 87, grade: "A+", points: 9, result: "P" },
      { code: "21CIV57", name: "Environmental Studies & Ethics", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    6: [
      { code: "21ME61", name: "Design of Machine Elements - 2", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21ME62", name: "Finite Element Method (FEM)", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21ME63", name: "Mechatronics and Robotics", credit: 3, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21ME641", name: "Automobile Engineering Systems", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21MEL66", name: "Computer Aided Design & Analysis Lab", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21MEP67", name: "Mini Project in Mechanical Engg", credit: 2, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" }
    ],
    7: [
      { code: "21ME71", name: "Control Engineering & Automation", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21ME72", name: "Hydraulics and Pneumatics", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21ME731", name: "Additive Manufacturing (3D Printing)", credit: 3, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21MEO74", name: "Open Elective - Industrial Safety", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21MEP75", name: "Major Project Work Phase - 1", credit: 2, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" }
    ],
    8: [
      { code: "21ME81", name: "Technical Seminar in Mechanical", credit: 1, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" },
      { code: "21MEP82", name: "Major Project Work Phase - 2", credit: 8, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21INT83", name: "Full Semester Industry Internship", credit: 5, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" }
    ]
  },

  // Civil Engineering
  CIVIL: {
    3: [
      { code: "21MAT31", name: "Transform Calculus & Numerical Methods", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21CV32", name: "Strength of Materials", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21CV33", name: "Fluid Mechanics for Civil", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21CV34", name: "Basic Surveying & Geomatics", credit: 3, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21CVL35", name: "Surveying Practice Laboratory", credit: 1, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" },
      { code: "21CIP37", name: "Constitution of India & Cyber Law", credit: 1, cie: 45, see: 45, total: 90, grade: "O", points: 10, result: "P" }
    ],
    4: [
      { code: "21MAT41", name: "Applied Statistics for Civil Engineers", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21CV42", name: "Analysis of Determinate Structures", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21CV43", name: "Applied Hydraulics & Fluid Machines", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21CV44", name: "Concrete Technology Principles", credit: 3, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21CVL46", name: "Concrete and Material Testing Lab", credit: 1, cie: 48, see: 48, total: 96, grade: "O", points: 10, result: "P" },
      { code: "21UH49", name: "Universal Human Values", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    5: [
      { code: "21CV51", name: "Design of RC Structural Elements", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21CV52", name: "Analysis of Indeterminate Structures", credit: 4, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21CV53", name: "Geotechnical Engineering Principles", credit: 4, cie: 47, see: 45, total: 92, grade: "O", points: 10, result: "P" },
      { code: "21CV54", name: "Hydrology and Irrigation Engineering", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21CVL55", name: "Geotechnical Engineering Lab", credit: 1, cie: 48, see: 48, total: 96, grade: "O", points: 10, result: "P" },
      { code: "21RMI56", name: "Research Methodology and IPR", credit: 2, cie: 44, see: 43, total: 87, grade: "A+", points: 9, result: "P" },
      { code: "21CIV57", name: "Environmental Studies & Ethics", credit: 1, cie: 46, see: 45, total: 91, grade: "O", points: 10, result: "P" }
    ],
    6: [
      { code: "21CV61", name: "Design of Steel Structural Elements", credit: 4, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21CV62", name: "Highway & Transportation Engineering", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21CV63", name: "Water Supply and Wastewater Treatment", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21CV641", name: "Urban Transport Planning", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21CVL66", name: "Extensive Survey Project Laboratory", credit: 1, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21CVP67", name: "Mini Project in Civil Engineering", credit: 2, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" }
    ],
    7: [
      { code: "21CV71", name: "Quality Surveying and Contract Management", credit: 3, cie: 45, see: 43, total: 88, grade: "A+", points: 9, result: "P" },
      { code: "21CV72", name: "Design of Bridges & Retaining Walls", credit: 3, cie: 44, see: 42, total: 86, grade: "A+", points: 9, result: "P" },
      { code: "21CV731", name: "Earthquake Engineering & Retrofitting", credit: 3, cie: 46, see: 44, total: 90, grade: "O", points: 10, result: "P" },
      { code: "21CVO74", name: "Open Elective - GIS & Remote Sensing", credit: 3, cie: 43, see: 41, total: 84, grade: "A+", points: 9, result: "P" },
      { code: "21CVP75", name: "Major Project Work Phase - 1", credit: 2, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" }
    ],
    8: [
      { code: "21CV81", name: "Technical Seminar in Civil", credit: 1, cie: 48, see: 47, total: 95, grade: "O", points: 10, result: "P" },
      { code: "21CVP82", name: "Major Project Work Phase - 2", credit: 8, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" },
      { code: "21INT83", name: "Full Semester Industry Internship", credit: 5, cie: 49, see: 48, total: 97, grade: "O", points: 10, result: "P" }
    ]
  }
};

/**
 * Returns subjects for any given branch and semester.
 * Defaults smoothly if branch/semester not defined.
 */
function getSyllabusForBranchAndSem(branch, sem) {
  const semester = parseInt(sem, 10) || 1;
  if (semester === 1) return JSON.parse(JSON.stringify(VTU_BRANCH_SYLLABUS.common_p_cycle));
  if (semester === 2) return JSON.parse(JSON.stringify(VTU_BRANCH_SYLLABUS.common_c_cycle));

  const branchKey = branch && VTU_BRANCH_SYLLABUS[branch] ? branch : "CSE";
  const list = VTU_BRANCH_SYLLABUS[branchKey][semester] || VTU_BRANCH_SYLLABUS.CSE[semester] || VTU_BRANCH_SYLLABUS.CSE[5];
  return JSON.parse(JSON.stringify(list));
}

let currentStudent = null;
let currentLoadedMarksheet = null;

function getDemoStudent() {
  const sampleSavedResults = [];
  [1, 2, 3, 4, 5].forEach((sem) => {
    const subjects = getSyllabusForBranchAndSem("CSE", sem);
    let totalCredits = 0;
    let totalWeighted = 0;
    let totalMarks = 0;
    const maxMarks = subjects.length * 100;
    subjects.forEach((s) => {
      totalCredits += s.credit;
      totalWeighted += s.credit * s.points;
      totalMarks += s.total;
    });
    const sgpa = round2(totalWeighted / totalCredits);
    const vtuPercent = round2((sgpa - 0.75) * 10);
    sampleSavedResults.push({
      id: "sem_" + sem,
      semester: sem,
      semesterName: `Semester ${sem}`,
      branch: "CSE",
      examSession: sem % 2 === 1 ? "Dec 2024 / Jan 2025" : "June / July 2024",
      subjects: subjects,
      totalCredits: totalCredits,
      totalMarks: totalMarks,
      maxMarks: maxMarks,
      sgpa: sgpa,
      percentage: vtuPercent,
      savedAt: new Date(Date.now() - (6 - sem) * 86400000 * 90).toISOString()
    });
  });

  return {
    id: "student_demo",
    fullName: "Nagendra M",
    usn: "1MS21CS089",
    college: "Ramaiah Institute of Technology",
    branch: "CSE",
    branchName: "Computer Science & Engineering",
    scheme: "2021 Scheme (CBCS)",
    currentSem: 5,
    email: "nagendra.m@msrit.edu",
    savedResults: sampleSavedResults
  };
}

function loadStudentAccount() {
  try {
    const raw = localStorage.getItem(STUDENT_STORAGE_KEY);
    if (raw) {
      currentStudent = JSON.parse(raw);
    } else {
      currentStudent = getDemoStudent();
      saveStudentAccount();
    }
  } catch (err) {
    console.error("Failed to load student account:", err);
    currentStudent = getDemoStudent();
  }
}

function saveStudentAccount() {
  try {
    if (currentStudent) {
      localStorage.setItem(STUDENT_STORAGE_KEY, JSON.stringify(currentStudent));
    } else {
      localStorage.removeItem(STUDENT_STORAGE_KEY);
    }
  } catch (err) {
    console.error("Failed to save student account:", err);
  }
}

function updateStudentHeaderChip() {
  const nameEl = document.getElementById("headerStudentName");
  const usnEl = document.getElementById("headerStudentUsn");
  const avatarEl = document.getElementById("headerAvatar");

  if (!nameEl || !usnEl || !avatarEl) return;

  if (currentStudent) {
    nameEl.textContent = currentStudent.fullName;
    usnEl.textContent = currentStudent.usn;
    const initials = currentStudent.fullName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    avatarEl.textContent = initials || "S";
  } else {
    nameEl.textContent = "Student Login";
    usnEl.textContent = "VTU Account";
    avatarEl.textContent = "?";
  }
}

/* ==========================================================================
   Student Authentication Dialog
   ========================================================================== */
function initStudentAuth() {
  loadStudentAccount();
  updateStudentHeaderChip();

  const authBtn = document.getElementById("studentAccountBtn");
  const authDialog = document.getElementById("authDialog");
  const closeAuthBtn = document.getElementById("closeAuthDialogBtn");
  const tabSignIn = document.getElementById("authTabSignIn");
  const tabRegister = document.getElementById("authTabRegister");
  const signInForm = document.getElementById("signInForm");
  const registerForm = document.getElementById("registerForm");
  const demoLoginBtn = document.getElementById("demoStudentLoginBtn");
  const profileSignOutBtn = document.getElementById("profileSignOutBtn");
  const profileEditBtn = document.getElementById("profileEditBtn");

  const editDialog = document.getElementById("editProfileDialog");
  const closeEditBtn = document.getElementById("closeEditProfileBtn");
  const editProfileForm = document.getElementById("editProfileForm");

  authBtn.addEventListener("click", () => {
    if (currentStudent) {
      activateTab("profile");
    } else {
      authDialog.showModal();
    }
  });

  closeAuthBtn.addEventListener("click", () => authDialog.close());

  tabSignIn.addEventListener("click", () => {
    tabSignIn.classList.add("is-active");
    tabRegister.classList.remove("is-active");
    signInForm.hidden = false;
    registerForm.hidden = true;
  });

  tabRegister.addEventListener("click", () => {
    tabRegister.classList.add("is-active");
    tabSignIn.classList.remove("is-active");
    signInForm.hidden = true;
    registerForm.hidden = false;
  });

  demoLoginBtn.addEventListener("click", () => {
    currentStudent = getDemoStudent();
    saveStudentAccount();
    updateStudentHeaderChip();
    authDialog.close();
    showToast("Logged in as Demo Student: Nagendra M (1MS21CS089)");
    renderStudentProfile();
  });

  signInForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const usnInput = document.getElementById("loginUsn").value.trim().toUpperCase();
    if (!usnInput) return;

    if (!currentStudent) {
      currentStudent = getDemoStudent();
    }
    currentStudent.usn = usnInput;
    saveStudentAccount();
    updateStudentHeaderChip();
    authDialog.close();
    showToast(`Welcome back, ${currentStudent.fullName}!`);
    renderStudentProfile();
  });

  registerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("regFullName").value.trim();
    const usn = document.getElementById("regUsn").value.trim().toUpperCase();
    const college = document.getElementById("regCollege").value.trim();
    const branch = document.getElementById("regBranch").value.trim();
    const scheme = document.getElementById("regScheme").value;

    currentStudent = {
      id: "student_" + uid(),
      fullName: name,
      usn: usn,
      college: college,
      branch: "CSE",
      branchName: branch,
      scheme: scheme,
      currentSem: 1,
      savedResults: []
    };
    saveStudentAccount();
    updateStudentHeaderChip();
    authDialog.close();
    showToast(`Account created for ${name}!`);
    renderStudentProfile();
  });

  profileSignOutBtn.addEventListener("click", () => {
    if (!confirm("Are you sure you want to sign out?")) return;
    currentStudent = null;
    saveStudentAccount();
    updateStudentHeaderChip();
    showToast("Signed out of Student Portal.");
    activateTab("vtu");
  });

  profileEditBtn.addEventListener("click", () => {
    if (!currentStudent) return;
    document.getElementById("editFullName").value = currentStudent.fullName;
    document.getElementById("editUsn").value = currentStudent.usn;
    document.getElementById("editCollege").value = currentStudent.college;
    document.getElementById("editBranch").value = currentStudent.branchName || currentStudent.branch || "Computer Science";
    document.getElementById("editScheme").value = currentStudent.scheme || "2021 Scheme";
    document.getElementById("editCurrentSem").value = String(currentStudent.currentSem || 5);
    editDialog.showModal();
  });

  closeEditBtn.addEventListener("click", () => editDialog.close());

  editProfileForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!currentStudent) return;
    currentStudent.fullName = document.getElementById("editFullName").value.trim();
    currentStudent.usn = document.getElementById("editUsn").value.trim().toUpperCase();
    currentStudent.college = document.getElementById("editCollege").value.trim();
    currentStudent.branchName = document.getElementById("editBranch").value.trim();
    currentStudent.scheme = document.getElementById("editScheme").value;
    currentStudent.currentSem = parseInt(document.getElementById("editCurrentSem").value, 10) || 1;

    saveStudentAccount();
    updateStudentHeaderChip();
    editDialog.close();
    renderStudentProfile();
    showToast("Profile details updated successfully!");
  });
}

/* ==========================================================================
   SGPA Branch Syllabus Auto-fill Logic
   ========================================================================== */
function initSgpaBranchAutofill() {
  const autofillBtn = document.getElementById("sgpaAutofillBtn");
  const branchSelect = document.getElementById("sgpaBranchSelect");
  const semSelect = document.getElementById("sgpaSemSelect");

  if (!autofillBtn || !branchSelect || !semSelect) return;

  // Auto-fill from student profile if available
  if (currentStudent && currentStudent.branch && branchSelect) {
    if (["CSE", "AIML", "ECE", "EEE", "MECH", "CIVIL"].includes(currentStudent.branch)) {
      branchSelect.value = currentStudent.branch;
    }
  }

  function doAutofill() {
    const branch = branchSelect.value;
    const sem = parseInt(semSelect.value, 10) || 5;
    const subjects = getSyllabusForBranchAndSem(branch, sem);

    document.getElementById("semesterName").value = `Semester ${sem} (${branch})`;
    document.getElementById("subjectRows").innerHTML = "";

    subjects.forEach((s) => {
      addSubjectRow({
        name: `${s.code} - ${s.name}`,
        credit: s.credit,
        marks: s.total
      });
    });

    recalcSgpaLive();
    showToast(`⚡ Auto-filled ${subjects.length} subjects for ${branch} Sem ${sem}. Edit any credit or marks freely.`);
  }

  autofillBtn.addEventListener("click", doAutofill);
  branchSelect.addEventListener("change", doAutofill);
  semSelect.addEventListener("change", doAutofill);
}

/* ==========================================================================
   VTU Result Portal Logic & Multi-Calculator Live Sync
   ========================================================================== */
function initVtuPortal() {
  const fetchBtn = document.getElementById("vtuFetchBtn");
  const sampleBtn = document.getElementById("vtuSampleBtn");
  const saveResultBtn = document.getElementById("vtuSaveResultBtn");
  const sendSgpaBtn = document.getElementById("vtuSendSgpaBtn");
  const printBtn = document.getElementById("vtuPrintBtn");
  const addSubjectRowBtn = document.getElementById("vtuAddSubjectRowBtn");

  initVtuPortalView();

  sampleBtn.addEventListener("click", () => {
    const sem = parseInt(document.getElementById("vtuSemesterSelect").value, 10) || 5;
    const branch = document.getElementById("vtuBranchSelect").value || "CSE";
    loadVtuSemesterResult(sem, null, branch);
  });

  fetchBtn.addEventListener("click", () => {
    const usn = document.getElementById("vtuUsnInput").value.trim().toUpperCase();
    const sem = parseInt(document.getElementById("vtuSemesterSelect").value, 10) || 5;
    const branch = document.getElementById("vtuBranchSelect").value || "CSE";
    const errEl = document.getElementById("vtuLookupError");
    errEl.textContent = "";

    if (!usn) {
      errEl.textContent = "Please enter a valid 10-character VTU USN (e.g. 1MS21CS089).";
      return;
    }

    loadVtuSemesterResult(sem, usn, branch);
    showToast(`Loaded results for ${usn} (Sem ${sem} - ${branch})`);
  });

  saveResultBtn.addEventListener("click", saveLoadedResultToStudentAccount);

  sendSgpaBtn.addEventListener("click", () => {
    if (!currentLoadedMarksheet) return;
    loadMarksheetIntoSgpaCalculator(currentLoadedMarksheet);
  });

  printBtn.addEventListener("click", () => {
    window.print();
  });

  const convertPercentBtn = document.getElementById("vtuConvertPercentBtn");
  if (convertPercentBtn) {
    convertPercentBtn.addEventListener("click", () => {
      const currentSgpa = currentLoadedMarksheet ? currentLoadedMarksheet.sgpa : (lastComputed.sgpa ? lastComputed.sgpa.value : 8.5);
      setPercentDirection("toPercent");
      const input = document.getElementById("percentCgpaInput");
      input.value = currentSgpa.toFixed(2);
      const select = document.getElementById("formulaPreset");
      if (select) select.value = "offset75";
      activateTab("percentage");
      updateFormulaDisplay();
      document.getElementById("calcPercentBtn").click();
      showToast(`Converted semester SGPA ${currentSgpa.toFixed(2)} to VTU percentage!`);
    });
  }

  if (addSubjectRowBtn) {
    addSubjectRowBtn.addEventListener("click", () => {
      if (!currentLoadedMarksheet) return;
      currentLoadedMarksheet.subjects.push({
        code: "21ELE01",
        name: "Custom Elective / Lab Subject",
        credit: 3,
        cie: 45,
        see: 40,
        total: 85,
        grade: "A+",
        points: 9,
        result: "P"
      });
      renderVtuMarksheetCard(currentLoadedMarksheet);
      syncResultToCalculators(currentLoadedMarksheet);
      showToast("Added new subject row to marksheet. Edit its marks or name.");
    });
  }
}

function initVtuPortalView() {
  const usnInput = document.getElementById("vtuUsnInput");
  const branchSelect = document.getElementById("vtuBranchSelect");
  if (usnInput && currentStudent && !usnInput.value) {
    usnInput.value = currentStudent.usn;
  }
  if (branchSelect && currentStudent && currentStudent.branch) {
    branchSelect.value = currentStudent.branch;
  }
}

function loadVtuSemesterResult(semester, customUsn, customBranch) {
  const branch = customBranch || (document.getElementById("vtuBranchSelect") ? document.getElementById("vtuBranchSelect").value : "CSE");
  const subjects = getSyllabusForBranchAndSem(branch, semester);
  const usn = customUsn || (currentStudent ? currentStudent.usn : "1MS21CS089");
  const studentName = currentStudent ? currentStudent.fullName : "Nagendra M";
  const examSession = document.getElementById("vtuExamSelect").value;

  let totalCredits = 0;
  let totalWeighted = 0;
  let totalMarks = 0;
  const maxMarks = subjects.length * 100;

  subjects.forEach((s) => {
    totalCredits += s.credit;
    totalWeighted += s.credit * s.points;
    totalMarks += s.total;
  });

  const sgpa = round2(totalWeighted / totalCredits);
  const vtuPercent = round2((sgpa - 0.75) * 10);

  currentLoadedMarksheet = {
    id: "sem_" + semester,
    semester: semester,
    semesterName: `Semester ${semester}`,
    branch: branch,
    examSession: examSession,
    usn: usn,
    studentName: studentName,
    scheme: currentStudent?.scheme || "2021 CBCS Scheme",
    subjects: subjects,
    totalCredits: totalCredits,
    totalMarks: totalMarks,
    maxMarks: maxMarks,
    sgpa: sgpa,
    percentage: vtuPercent,
    savedAt: new Date().toISOString()
  };

  renderVtuMarksheetCard(currentLoadedMarksheet);

  // AUTO-SYNC: Automatically updates SGPA & CGPA calculators right away!
  syncResultToCalculators(currentLoadedMarksheet);
}

function renderVtuMarksheetCard(ms) {
  const card = document.getElementById("vtuResultCard");
  const nameEl = document.getElementById("vtuResultStudentName");
  const usnEl = document.getElementById("vtuResultUsn");
  const schemeEl = document.getElementById("vtuResultScheme");
  const tbody = document.getElementById("vtuMarksheetRows");

  nameEl.textContent = ms.studentName;
  usnEl.textContent = ms.usn;
  schemeEl.textContent = `${ms.scheme} · Sem ${ms.semester} (${ms.branch || "CSE"})`;

  tbody.innerHTML = "";
  ms.subjects.forEach((s, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.index = idx;
    tr.innerHTML = `
      <td><input type="text" class="ms-input ms-code" value="${escapeHtml(s.code)}" maxlength="10" /></td>
      <td><input type="text" class="ms-input ms-name" value="${escapeHtml(s.name)}" /></td>
      <td class="num-cell"><input type="number" class="ms-input ms-num ms-credit" value="${s.credit}" min="0.5" max="30" step="0.5" /></td>
      <td class="num-cell"><input type="number" class="ms-input ms-num ms-cie" value="${s.cie}" min="0" max="50" step="1" /></td>
      <td class="num-cell"><input type="number" class="ms-input ms-num ms-see" value="${s.see}" min="0" max="50" step="1" /></td>
      <td class="num-cell"><strong class="ms-total">${s.total}</strong></td>
      <td class="num-cell"><span class="badge-grade ms-grade-badge">${s.grade}</span></td>
      <td class="num-cell"><span class="ms-points">${s.points}</span></td>
      <td class="num-cell"><span class="badge-status ms-status-badge ${s.result === 'P' ? 'pass' : 'fail'}">${s.result === 'P' ? 'PASS' : 'FAIL'}</span></td>
      <td class="num-cell"><button type="button" class="row-remove-ms" title="Remove row">✕</button></td>
    `;

    // Live edit event listener on marks & credits
    tr.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", () => {
        recalculateSingleMarksheetRow(tr, idx);
        recalculateMarksheetTotals();
      });
    });

    tr.querySelector(".row-remove-ms").addEventListener("click", () => {
      ms.subjects.splice(idx, 1);
      renderVtuMarksheetCard(ms);
      syncResultToCalculators(ms);
    });

    tbody.appendChild(tr);
  });

  recalculateMarksheetTotals();
  card.hidden = false;
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function recalculateSingleMarksheetRow(tr, idx) {
  if (!currentLoadedMarksheet || !currentLoadedMarksheet.subjects[idx]) return;
  const s = currentLoadedMarksheet.subjects[idx];

  const codeVal = tr.querySelector(".ms-code").value.trim().toUpperCase();
  const nameVal = tr.querySelector(".ms-name").value.trim();
  const creditVal = Number(tr.querySelector(".ms-credit").value) || 1;
  const cieVal = Math.min(50, Math.max(0, Number(tr.querySelector(".ms-cie").value) || 0));
  const seeVal = Math.min(50, Math.max(0, Number(tr.querySelector(".ms-see").value) || 0));
  const totalVal = cieVal + seeVal;

  s.code = codeVal;
  s.name = nameVal;
  s.credit = creditVal;
  s.cie = cieVal;
  s.see = seeVal;
  s.total = totalVal;

  // VTU Grading Scale
  let grade = "F";
  let points = 0;
  if (totalVal >= 90) { grade = "O"; points = 10; }
  else if (totalVal >= 80) { grade = "A+"; points = 9; }
  else if (totalVal >= 70) { grade = "A"; points = 8; }
  else if (totalVal >= 60) { grade = "B+"; points = 7; }
  else if (totalVal >= 50) { grade = "B"; points = 6; }
  else if (totalVal >= 45) { grade = "C"; points = 5; }
  else if (totalVal >= 40) { grade = "P"; points = 4; }
  else { grade = "F"; points = 0; }

  // VTU passing criteria: SEE >= 18 and Total >= 40
  const isPass = totalVal >= 40 && seeVal >= 18;
  s.grade = grade;
  s.points = points;
  s.result = isPass ? "P" : "F";

  tr.querySelector(".ms-total").textContent = totalVal;
  tr.querySelector(".ms-points").textContent = points;

  const gradeBadge = tr.querySelector(".ms-grade-badge");
  gradeBadge.textContent = grade;
  gradeBadge.className = `badge-grade ms-grade-badge ${grade === 'O' ? 'o' : grade === 'A+' ? 'aplus' : grade === 'F' ? 'f' : ''}`;

  const statusBadge = tr.querySelector(".ms-status-badge");
  statusBadge.textContent = isPass ? "PASS" : "FAIL";
  statusBadge.className = `badge-status ms-status-badge ${isPass ? 'pass' : 'fail'}`;
}

function recalculateMarksheetTotals() {
  if (!currentLoadedMarksheet) return;
  const ms = currentLoadedMarksheet;

  let totalCredits = 0;
  let totalWeighted = 0;
  let totalMarks = 0;
  let allPass = true;

  ms.subjects.forEach((s) => {
    totalCredits += s.credit;
    totalWeighted += s.credit * s.points;
    totalMarks += s.total;
    if (s.result !== "P") allPass = false;
  });

  const maxMarks = ms.subjects.length * 100;
  const sgpa = totalCredits > 0 ? round2(totalWeighted / totalCredits) : 0;
  const vtuPercent = totalCredits > 0 ? round2((sgpa - 0.75) * 10) : 0;

  ms.totalCredits = totalCredits;
  ms.totalMarks = totalMarks;
  ms.maxMarks = maxMarks;
  ms.sgpa = sgpa;
  ms.percentage = vtuPercent;

  document.getElementById("vtuTotalMarksDisplay").textContent = `${totalMarks} / ${maxMarks}`;
  document.getElementById("vtuCreditsDisplay").textContent = totalCredits;
  document.getElementById("vtuSgpaDisplay").textContent = sgpa.toFixed(2);
  document.getElementById("vtuPercentageDisplay").textContent = `${vtuPercent.toFixed(2)}%`;

  const statusBadge = document.getElementById("vtuResultStatusBadge");
  if (statusBadge) {
    statusBadge.textContent = allPass ? "ALL SUBJECTS PASSED" : "BACKLOGS DETECTED";
    statusBadge.className = `badge-status ${allPass ? 'pass' : 'fail'}`;
  }

  // Syncs to SGPA and CGPA calculators on every edit!
  syncResultToCalculators(ms);
}

/**
 * Live Synchronizer: automatically updates SGPA Calculator, CGPA Calculator,
 * and Dashboard Strip when marksheet is checked or edited.
 */
function syncResultToCalculators(ms) {
  if (!ms) return;

  // 1. Sync to SGPA Calculator Table
  const sgpaNameInput = document.getElementById("semesterName");
  if (sgpaNameInput) {
    sgpaNameInput.value = `${ms.semesterName} (${ms.branch || "VTU"})`;
  }
  const sgpaRows = document.getElementById("subjectRows");
  if (sgpaRows) {
    sgpaRows.innerHTML = "";
    ms.subjects.forEach((s) => {
      addSubjectRow({
        name: `${s.code} - ${s.name}`,
        credit: s.credit,
        marks: s.total
      });
    });
    recalcSgpaLive();
  }

  // 2. Sync to CGPA Calculator Table
  const semTbody = document.getElementById("semesterRows");
  if (semTbody) {
    const semRows = Array.from(semTbody.querySelectorAll(".ledger-row"));
    const semLabel = `Semester ${ms.semester}`;
    let matchedRow = semRows.find((r) => r.querySelector(".sem-name").value.trim().toLowerCase() === semLabel.toLowerCase());

    if (matchedRow) {
      matchedRow.querySelector(".sem-credit").value = ms.totalCredits;
      matchedRow.querySelector(".sem-sgpa").value = ms.sgpa.toFixed(2);
      updateSemesterWeightedDisplay(matchedRow);
    } else {
      addSemesterRow({
        name: semLabel,
        credit: ms.totalCredits,
        sgpa: ms.sgpa
      });
    }
    recalcCgpaLive();
  }

  // 3. Update Dashboard Strip Live
  lastComputed.sgpa = { value: ms.sgpa, label: ms.semesterName };
  const cgpaResult = computeCgpaFromRows(false);
  if (cgpaResult && cgpaResult.valid) {
    lastComputed.cgpa = { value: cgpaResult.cgpa, label: "CGPA (All Sems)" };
    lastComputed.percent = round2((cgpaResult.cgpa - 0.75) * 10);
  } else {
    lastComputed.percent = ms.percentage;
  }
  updateDashboard();
}

function saveLoadedResultToStudentAccount() {
  if (!currentLoadedMarksheet) return;

  if (!currentStudent) {
    const authDialog = document.getElementById("authDialog");
    authDialog.showModal();
    showToast("Please sign in or create a student account to save your result.");
    return;
  }

  if (!Array.isArray(currentStudent.savedResults)) {
    currentStudent.savedResults = [];
  }

  const existingIdx = currentStudent.savedResults.findIndex(
    (r) => r.semester === currentLoadedMarksheet.semester
  );

  if (existingIdx >= 0) {
    currentStudent.savedResults[existingIdx] = currentLoadedMarksheet;
  } else {
    currentStudent.savedResults.push(currentLoadedMarksheet);
  }

  currentStudent.savedResults.sort((a, b) => a.semester - b.semester);
  saveStudentAccount();

  // Also sync to CGPA and SGPA calculators
  syncResultToCalculators(currentLoadedMarksheet);

  showToast(`✅ Semester ${currentLoadedMarksheet.semester} result saved to your Student Profile & auto-synced to CGPA!`);
}

function loadMarksheetIntoSgpaCalculator(ms) {
  document.getElementById("semesterName").value = `${ms.semesterName} (${ms.branch || "VTU"})`;
  document.getElementById("subjectRows").innerHTML = "";

  ms.subjects.forEach((s) => {
    addSubjectRow({
      name: `${s.code} - ${s.name}`,
      credit: s.credit,
      marks: s.total
    });
  });

  activateTab("sgpa");
  recalcSgpaLive();
  showToast(`Loaded ${ms.subjects.length} subjects from ${ms.semesterName} into SGPA Calculator.`);
}

/* ==========================================================================
   Student Profile & Transcripts Render
   ========================================================================== */
function renderStudentProfile() {
  if (!currentStudent) {
    const authDialog = document.getElementById("authDialog");
    authDialog.showModal();
    return;
  }

  document.getElementById("profileFullName").textContent = currentStudent.fullName;
  document.getElementById("profileUsnBadge").textContent = currentStudent.usn;
  document.getElementById("profileSchemeBadge").textContent = currentStudent.scheme || "2021 Scheme";
  document.getElementById("profileCollegeName").textContent = currentStudent.college;
  document.getElementById("profileBranchName").textContent = currentStudent.branchName || currentStudent.branch || "Computer Science";

  const initials = currentStudent.fullName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  document.getElementById("profileLargeAvatar").textContent = initials || "S";

  const results = currentStudent.savedResults || [];
  let totalCredits = 0;
  let totalWeighted = 0;

  results.forEach((r) => {
    totalCredits += r.totalCredits;
    totalWeighted += r.totalCredits * r.sgpa;
  });

  const cgpa = totalCredits > 0 ? round2(totalWeighted / totalCredits) : 0;
  const vtuPercent = cgpa > 0 ? round2((cgpa - 0.75) * 10) : 0;

  document.getElementById("profileCgpaVal").textContent = cgpa > 0 ? cgpa.toFixed(2) : "—";
  document.getElementById("profilePercentVal").textContent = cgpa > 0 ? `${vtuPercent.toFixed(2)}%` : "—";

  let classAward = "Pending (No results recorded)";
  if (cgpa >= 7.75) {
    classAward = "First Class with Distinction (FCD)";
  } else if (cgpa >= 6.75) {
    classAward = "First Class (FC)";
  } else if (cgpa >= 5.75) {
    classAward = "Second Class (SC)";
  } else if (cgpa > 0) {
    classAward = "Pass Class";
  }
  document.getElementById("profileClassBadge").textContent = classAward;

  const semCount = results.length;
  const progressRatio = Math.min(100, round2((semCount / 8) * 100));
  document.getElementById("degreeProgressLabel").textContent = `${semCount} of 8 Semesters Recorded (${progressRatio}%)`;
  document.getElementById("degreeProgressFill").style.width = `${progressRatio}%`;
  document.getElementById("savedSemCountLabel").textContent = `${semCount} ${semCount === 1 ? 'semester' : 'semesters'} saved`;

  const container = document.getElementById("savedTranscriptsContainer");
  container.innerHTML = "";

  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>No semester marksheets saved to your profile yet.<br>
        Visit the <a href="javascript:void(0)" onclick="activateTab('vtu')" style="color:var(--gold-deep); font-weight:600;">VTU Result Portal</a> to fetch and save your semester marksheets.</p>
      </div>
    `;
    return;
  }

  results.forEach((res) => {
    const card = document.createElement("div");
    card.className = "transcript-sem-card";

    let rowsHtml = "";
    res.subjects.forEach((s) => {
      rowsHtml += `
        <tr>
          <td><strong>${escapeHtml(s.code)}</strong></td>
          <td>${escapeHtml(s.name)}</td>
          <td class="num-cell">${s.credit}</td>
          <td class="num-cell">${s.cie}</td>
          <td class="num-cell">${s.see}</td>
          <td class="num-cell"><strong>${s.total}</strong></td>
          <td class="num-cell"><span class="badge-grade ${s.grade === 'O' ? 'o' : s.grade === 'A+' ? 'aplus' : s.grade === 'F' ? 'f' : ''}">${s.grade}</span></td>
          <td class="num-cell"><span class="badge-status ${s.result === 'P' ? 'pass' : 'fail'}">${s.result}</span></td>
        </tr>
      `;
    });

    card.innerHTML = `
      <div class="transcript-sem-head">
        <div class="sem-title-group">
          <h3>${escapeHtml(res.semesterName)} <span style="font-size:0.85rem; font-weight:normal; color:var(--text-secondary);">(${escapeHtml(res.branch || "VTU")})</span></h3>
          <span class="sem-exam-session">${escapeHtml(res.examSession)} · ${res.totalCredits} Credits</span>
        </div>
        <div class="sem-scores-row">
          <div class="sem-score-pill">
            <span>SGPA</span>
            <strong>${res.sgpa.toFixed(2)}</strong>
          </div>
          <div class="sem-score-pill">
            <span>Percentage</span>
            <strong>${res.percentage.toFixed(2)}%</strong>
          </div>
        </div>
      </div>
      
      <div style="overflow-x:auto; margin: 12px 0;">
        <table class="marksheet-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Subject Title</th>
              <th class="num-cell">Credits</th>
              <th class="num-cell">CIE</th>
              <th class="num-cell">SEE</th>
              <th class="num-cell">Total</th>
              <th class="num-cell">Grade</th>
              <th class="num-cell">Result</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
        <span style="font-size:0.75rem; color:var(--text-secondary);">Saved on ${formatDate(res.savedAt)}</span>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-outline btn-sm btn-reload-sgpa" data-sem="${res.semester}">
            Load into SGPA Calculator
          </button>
          <button class="btn btn-ghost btn-sm btn-delete-transcript btn-danger-text" data-sem="${res.semester}">
            Delete
          </button>
        </div>
      </div>
    `;

    card.querySelector(".btn-reload-sgpa").addEventListener("click", () => {
      loadMarksheetIntoSgpaCalculator(res);
    });

    card.querySelector(".btn-delete-transcript").addEventListener("click", () => {
      if (!confirm(`Delete ${res.semesterName} from your student profile?`)) return;
      currentStudent.savedResults = currentStudent.savedResults.filter((r) => r.semester !== res.semester);
      saveStudentAccount();
      renderStudentProfile();
      showToast(`Removed ${res.semesterName} from profile.`);
    });

    container.appendChild(card);
  });
}

// Hook into initial page startup
document.addEventListener("DOMContentLoaded", () => {
  initStudentAuth();
  initVtuPortal();
  initSgpaBranchAutofill();
});

