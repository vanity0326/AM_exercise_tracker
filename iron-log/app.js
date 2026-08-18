// ---------- Data ----------
const APP_VERSION = "v13";
// Day "type" is now something you assign per date (like the Sunday Planner),
// not a fixed weekly rotation. EXERCISE_DAYS hold logged sets; Cardio takes a
// free-text note; Rest takes nothing.
const DAYS = [
  { id: "upper", label: "Upper Body", short: "UP", loggable: true },
  { id: "lower", label: "Lower Body", short: "LOW", loggable: true },
  { id: "core", label: "Core", short: "CORE", loggable: true },
  { id: "mobility", label: "Mobility", short: "MOB", loggable: true },
  { id: "cardio", label: "Cardio", short: "CARDIO", loggable: false, isCardio: true },
  { id: "rest", label: "Rest", short: "REST", loggable: false },
];
const EXERCISE_DAYS = DAYS.filter((d) => d.loggable);

// No preloaded exercises — starts empty, everything added via the + button.
const DEFAULT_LIBRARY = { upper: [], lower: [], core: [], mobility: [] };

const PROGRESSION_BUMP = { upper: 5, lower: 10, other: 5 };
const DEFAULT_TARGET_REPS = 10;
const DEFAULT_TARGET_SECONDS = 30;
const BODYWEIGHT_REP_BUMP = 2;
const TIME_BUMP_SECONDS = 10;

// Every exercise has a trackType controlling how it's logged:
//   weight     — lbs + reps per set (default, e.g. Chest Press)
//   bodyweight — reps only per set, no weight (e.g. Cat-Cow)
//   time       — seconds held per set, no weight (e.g. a static stretch)
const TRACK_TYPES = {
  weight: { label: "Weight + Reps" },
  bodyweight: { label: "Bodyweight (reps only)" },
  time: { label: "Time held (seconds)" },
};
function exUnitLabel(ex) {
  return ex.trackType === "time" ? "sec" : "reps";
}
// Per-set targets are fully custom per exercise — no baked-in pattern.
// ex.targets is always a [t1, t2, t3] array you set when adding the
// exercise (defaults to a flat value, but you can make any set higher or
// lower than the others, or all the same — whatever fits that movement).
function targetForSet(ex, setIndex) {
  if (Array.isArray(ex.targets) && ex.targets[setIndex] != null) return ex.targets[setIndex];
  // Fallback for exercises saved before per-set targets existed.
  if (ex.target != null) return ex.target;
  return ex.trackType === "time" ? DEFAULT_TARGET_SECONDS : DEFAULT_TARGET_REPS;
}
function defaultTargets(trackType) {
  const base = trackType === "time" ? DEFAULT_TARGET_SECONDS : DEFAULT_TARGET_REPS;
  return [base, base, base];
}
function targetLabelFor(ex) {
  const t1 = targetForSet(ex, 0), t2 = targetForSet(ex, 1), t3 = targetForSet(ex, 2);
  const suffix = ex.trackType === "time" ? "s" : "";
  if (t1 === t2 && t2 === t3) return `${t1}${suffix} · all sets`;
  return `${t1}${suffix} / ${t2}${suffix} / ${t3}${suffix}`;
}

// ---------- Storage ----------
const LS_LIB = "iron-log-library";
const LS_LOGS = "iron-log-logs";
const LS_BANK = "iron-log-bank";
const LS_LOCAL_UPDATED_AT = "iron-log-local-updated-at";

// Stamped (synchronously, so it survives even an immediate page refresh)
// every time this device writes data locally. Used to avoid a race where a
// reload pulls a slightly-stale remote copy before this device's most recent
// change has finished pushing up, which would otherwise silently overwrite it.
function touchLocalUpdatedAt() {
  localStorage.setItem(LS_LOCAL_UPDATED_AT, String(Date.now()));
}
function getLocalUpdatedAt() {
  return Number(localStorage.getItem(LS_LOCAL_UPDATED_AT) || 0);
}

function loadLibrary() {
  try {
    const raw = localStorage.getItem(LS_LIB);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed ? { ...structuredClone(DEFAULT_LIBRARY), ...parsed } : structuredClone(DEFAULT_LIBRARY);
  } catch (e) {
    return structuredClone(DEFAULT_LIBRARY);
  }
}
function saveLibrary(lib) {
  localStorage.setItem(LS_LIB, JSON.stringify(lib));
  touchLocalUpdatedAt();
  schedulePush();
}
function loadLogs() {
  try {
    const raw = localStorage.getItem(LS_LOGS);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
function saveLogs(logs) {
  localStorage.setItem(LS_LOGS, JSON.stringify(logs));
  touchLocalUpdatedAt();
  schedulePush();
}

// Exercise bank: every exercise ever added, shared across all day-types, keyed
// by lowercased name. Stores the most recently used weights so re-adding the
// same exercise anywhere pre-fills with what you last lifted.
function loadBank() {
  try {
    const raw = localStorage.getItem(LS_BANK);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
function saveBank(bank) {
  localStorage.setItem(LS_BANK, JSON.stringify(bank));
  touchLocalUpdatedAt();
  schedulePush();
}
function bankKey(name) {
  return name.trim().toLowerCase();
}
// Accepts a full exercise-like object: { name, type, trackType, weights, targets }
function upsertBank(ex) {
  const key = bankKey(ex.name);
  if (!key) return;
  bank[key] = {
    name: ex.name.trim(),
    type: ex.type || "other",
    trackType: ex.trackType || "weight",
    weights: ex.weights ? [...ex.weights] : [20, 20, 20],
    targets: Array.isArray(ex.targets) ? [...ex.targets] : null,
  };
  saveBank(bank);
}

// ---------- Cross-device sync (Netlify Blobs via a serverless function) ----------
// Local storage above stays the fast, offline-first source of truth for the
// current screen. This layer keeps a shared remote copy in sync in the
// background so the same data shows up on every device.
const REMOTE_ENDPOINT = "/api/data";
let pushTimer = null;
let suppressPush = false; // true while applying a just-pulled remote copy, so we don't immediately push it back

async function pullRemote(isInitial) {
  try {
    const res = await fetch(REMOTE_ENDPOINT, { cache: "no-store" });
    if (!res.ok) throw new Error("pull failed: " + res.status);
    const remote = await res.json();
    if (remote && (remote.library || remote.logs || remote.bank)) {
      // If this device wrote something locally more recently than the remote
      // copy was saved, trust the local copy and push it up instead of
      // clobbering a change that hasn't finished syncing yet (e.g. a quick
      // refresh right after tapping something).
      const remoteTime = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
      const localTime = getLocalUpdatedAt();
      if (localTime > remoteTime) {
        setSyncStatus("syncing");
        pushRemote();
        return;
      }
      suppressPush = true;
      library = { ...structuredClone(DEFAULT_LIBRARY), ...(remote.library || {}) };
      logs = remote.logs || {};
      bank = remote.bank || {};
      localStorage.setItem(LS_LIB, JSON.stringify(library));
      localStorage.setItem(LS_LOGS, JSON.stringify(logs));
      localStorage.setItem(LS_BANK, JSON.stringify(bank));
      suppressPush = false;
      setSyncStatus("synced");
      render();
    } else if (isInitial) {
      // Nothing saved remotely yet — seed it with whatever's on this device.
      pushRemote();
    } else {
      setSyncStatus("synced");
    }
  } catch (e) {
    setSyncStatus(navigator.onLine ? "error" : "offline");
  }
}

function schedulePush() {
  if (suppressPush) return;
  setSyncStatus("syncing");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushRemote, 1200);
}

async function pushRemote() {
  try {
    const res = await fetch(REMOTE_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ library, logs, bank }),
    });
    if (!res.ok) throw new Error("push failed: " + res.status);
    setSyncStatus("synced");
  } catch (e) {
    setSyncStatus(navigator.onLine ? "error" : "offline");
  }
}

// ---------- State ----------
let library = loadLibrary();
let logs = loadLogs();
let bank = loadBank();
let state = {
  tab: "today",
  selectedDate: todayISO(),
  selectedDayId: null,
  progressExId: null,
};

// ---------- Helpers ----------
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function allExercises() {
  const map = {};
  Object.values(library).forEach((list) => list.forEach((e) => (map[e.id] = e)));
  return map;
}
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + Math.random().toString(36).slice(2, 6);
}
function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- Rendering ----------
const app = document.getElementById("app");

function render() {
  app.innerHTML = "";
  app.appendChild(renderHeader());
  app.appendChild(renderOfflineBanner());
  app.appendChild(renderTabs());

  if (state.tab === "today") app.appendChild(renderToday());
  if (state.tab === "history") app.appendChild(renderHistory());
  if (state.tab === "progress") app.appendChild(renderProgress());

  app.appendChild(renderFab());
}

function renderOfflineBanner() {
  const div = el(`<div class="offline-banner ${navigator.onLine ? "" : "show"}" id="offlineBanner">Offline — changes save locally and stay on this device</div>`);
  return div;
}

const SYNC_LABELS = {
  idle: { text: "● —", cls: "" },
  syncing: { text: "● Syncing…", cls: "syncing" },
  synced: { text: "● Synced", cls: "synced" },
  offline: { text: "● Offline — saved locally", cls: "offline" },
  error: { text: "● Sync error — saved locally", cls: "offline" },
};
let syncStatus = "idle";

function renderHeader() {
  const s = SYNC_LABELS[syncStatus];
  return el(`
    <div class="header">
      <div class="header-top">
        <div>
          <div class="title">IRON LOG</div>
          <div class="subtitle">Block 2 · Systems Builder · ${APP_VERSION}</div>
        </div>
        <div class="sync-badge ${s.cls}" id="syncBadge">${s.text}</div>
      </div>
    </div>
  `);
}

function setSyncStatus(next) {
  syncStatus = next;
  const badge = document.getElementById("syncBadge");
  if (badge) {
    const s = SYNC_LABELS[next];
    badge.textContent = s.text;
    badge.className = `sync-badge ${s.cls}`;
  }
}

function renderTabs() {
  const wrap = el(`<div class="tabs"></div>`);
  [["today", "LOG"], ["history", "HISTORY"], ["progress", "PROGRESS"]].forEach(([id, label]) => {
    const btn = el(`<button class="tab-btn ${state.tab === id ? "active" : ""}">${label}</button>`);
    btn.onclick = () => { state.tab = id; render(); };
    wrap.appendChild(btn);
  });
  return wrap;
}

function renderFab() {
  const btn = el(`<button class="fab" title="Add exercise">+</button>`);
  btn.onclick = () => openAddExerciseModal();
  return btn;
}

function renderImportFab() {
  const btn = el(`<button class="fab fab-secondary" title="Import a list of exercises">⇩</button>`);
  btn.onclick = () => openImportModal();
  return btn;
}

// ---- Today / Log tab ----
function selectedDayInfo() {
  // Prefer the day-type already saved for this date; otherwise fall back to the in-session pick.
  const savedType = logs[state.selectedDate]?.dayId;
  const id = savedType || state.selectedDayId;
  return DAYS.find((d) => d.id === id) || null;
}

function setDayType(dayId) {
  const date = state.selectedDate;
  if (!logs[date]) logs[date] = { dayId, entries: {} };
  logs[date].dayId = dayId;
  saveLogs(logs);
  state.selectedDayId = dayId;
  render();
}

function renderToday() {
  const wrap = document.createElement("div");

  const dayRow = el(`<div class="day-row"></div>`);
  const current = selectedDayInfo();
  DAYS.forEach((d) => {
    const isActive = current && current.id === d.id;
    const hasLogged =
      logs[state.selectedDate]?.dayId === d.id &&
      (Object.keys(logs[state.selectedDate]?.entries || {}).length > 0 || !!logs[state.selectedDate]?.note);
    const pill = el(`
      <button class="day-pill ${isActive ? "active" : ""} ${hasLogged ? "done" : ""}" title="${d.label}">
        <span>${d.short}</span>
        <span class="dot"></span>
      </button>
    `);
    pill.onclick = () => setDayType(d.id);
    dayRow.appendChild(pill);
  });
  wrap.appendChild(dayRow);

  const header = el(`
    <div class="day-header">
      <div class="day-name">${current ? current.label : "Pick a day type above"}</div>
      <input type="date" value="${state.selectedDate}" />
    </div>
  `);
  header.querySelector("input").onchange = (e) => {
    state.selectedDate = e.target.value;
    state.selectedDayId = null;
    render();
  };
  wrap.appendChild(header);

  if (!current) {
    wrap.appendChild(el(`
      <div class="empty-state">
        Tap Upper, Lower, Core, Mobility, Cardio, or Rest above to set what kind of day this is.
      </div>
    `));
    return wrap;
  }

  if (current.id === "rest") {
    wrap.appendChild(el(`<div class="empty-state">Rest day — no logging needed.</div>`));
    return wrap;
  }

  if (current.id === "cardio") {
    const todayLog = logs[state.selectedDate] || { dayId: current.id, entries: {} };
    const noteBox = el(`
      <div class="ex-card">
        <div class="ex-name" style="margin-bottom:10px;">Cardio notes</div>
        <textarea class="cardio-note" placeholder="Duration, distance, HR zone, how it felt...">${todayLog.note || ""}</textarea>
      </div>
    `);
    noteBox.querySelector("textarea").onchange = (e) => {
      if (!logs[state.selectedDate]) logs[state.selectedDate] = { dayId: current.id, entries: {} };
      logs[state.selectedDate].note = e.target.value;
      saveLogs(logs);
    };
    wrap.appendChild(noteBox);
    return wrap;
  }

  const dayExercises = library[current.id] || [];
  const todayLog = logs[state.selectedDate] || { dayId: current.id, entries: {} };

  if (dayExercises.length === 0) {
    wrap.appendChild(el(`
      <div class="empty-state">
        No exercises added for ${current.label} yet. Tap the + button to add one.
      </div>
    `));
    return wrap;
  }

  const tabCursor = makeTabCursor();
  dayExercises.forEach((ex) => {
    const entry = todayLog.entries?.[ex.id];
    const sets = entry?.sets || defaultSets(ex);
    wrap.appendChild(renderExerciseCard(ex, sets, tabCursor.next(), current.id));
  });

  const summaryBtn = el(`<button class="summary-btn">✓ View Workout Summary</button>`);
  summaryBtn.onclick = () => openWorkoutSummaryModal(current.id);
  wrap.appendChild(summaryBtn);

  return wrap;
}

function defaultSets(ex) {
  if (ex.trackType === "weight") return ex.weights.map((w) => ({ weight: w, reps: null }));
  return [{ weight: null, reps: null }, { weight: null, reps: null }, { weight: null, reps: null }];
}

// Hands out sequential tabindex blocks of 6 (3 weight inputs + 3 reps inputs)
// per exercise card, so Tab moves lbs → lbs → lbs → reps → reps → reps within
// a card, then on to the next card's lbs.
function makeTabCursor() {
  let n = 1;
  return { next: () => { const start = n; n += 6; return start; } };
}

function renderExerciseCard(ex, sets, tabStart, dayId) {
  const unit = exUnitLabel(ex);
  const allTopped = computeAllTopped(sets, ex);
  const targetLabel = targetLabelFor(ex);

  const card = el(`<div class="ex-card ${allTopped ? "topped" : ""}" data-ex-id="${ex.id}"></div>`);
  const top = el(`
    <div class="ex-card-top">
      <div>
        <div class="ex-name">${ex.name}</div>
        <div class="ex-target">Target ${targetLabel}</div>
      </div>
      <div class="plate-stack"></div>
      <button class="ex-delete-btn" title="Remove exercise">✕</button>
    </div>
  `);
  top.querySelector(".plate-stack").appendChild(buildPlates(sets, ex));
  top.querySelector(".ex-delete-btn").onclick = () => removeExerciseFromDay(dayId, ex.id);
  card.appendChild(top);

  const isWeighted = ex.trackType === "weight";
  const setRow = el(`<div class="set-row"></div>`);
  sets.forEach((s, i) => {
    const col = el(`
      <div class="set-col">
        ${isWeighted ? `<label>lbs</label><input type="number" value="${s.weight}" tabindex="${tabStart + i}" />` : `<label>${unit === "sec" ? "hold" : "BW"}</label>`}
        <input type="number" placeholder="${unit}" value="${s.reps ?? ""}" class="${s.reps != null ? "has-reps" : ""}" tabindex="${isWeighted ? tabStart + 3 + i : tabStart + i}" />
      </div>
    `);
    const inputs = col.querySelectorAll("input");
    const repsInput = inputs[inputs.length - 1];
    if (isWeighted) {
      inputs[0].onchange = (e) => updateSet(ex.id, i, "weight", Number(e.target.value));
    }
    repsInput.onchange = (e) => {
      const val = e.target.value === "" ? null : Number(e.target.value);
      e.target.classList.toggle("has-reps", val != null);
      updateSet(ex.id, i, "reps", val);
    };
    setRow.appendChild(col);
  });
  card.appendChild(setRow);

  const footer = el(`<div class="ex-card-footer"></div>`);
  fillCardFooter(footer, ex, allTopped);
  card.appendChild(footer);

  return card;
}

function computeAllTopped(sets, ex) {
  return sets.every((s, i) => s.reps != null && s.reps >= targetForSet(ex, i));
}

function buildPlates(sets, ex) {
  const allTopped = computeAllTopped(sets, ex);
  const frag = document.createDocumentFragment();
  sets.forEach((s, i) => {
    const filled = s.reps != null;
    const isTop = filled && s.reps >= targetForSet(ex, i);
    const flag = allTopped && i === sets.length - 1;
    const h = 34 + i * 5;
    frag.appendChild(el(`<div class="plate ${filled ? "filled" : ""} ${isTop ? "topped" : ""} ${flag ? "flag" : ""}" style="height:${h}px">${filled ? s.reps : i + 1}</div>`));
  });
  return frag;
}

function fillCardFooter(footer, ex, allTopped) {
  footer.innerHTML = "";
  if (!allTopped) return;
  let bumpLabel;
  if (ex.trackType === "weight") {
    const bump = PROGRESSION_BUMP[ex.type] || PROGRESSION_BUMP.other;
    bumpLabel = `+${bump} lbs`;
  } else if (ex.trackType === "time") {
    bumpLabel = `+${TIME_BUMP_SECONDS}s hold`;
  } else {
    bumpLabel = `+${BODYWEIGHT_REP_BUMP} reps`;
  }
  footer.appendChild(el(`<div class="topped-note">● Topped out — next session try ${bumpLabel}</div>`));
  const applyBtn = el(`<button class="apply-btn">Apply ${bumpLabel} for next session</button>`);
  applyBtn.onclick = () => applyProgression(ex.id);
  footer.appendChild(applyBtn);
}

// Updates just one exercise card's visuals in place (plate stack + footer) —
// deliberately does NOT touch the <input> elements, so focus and native Tab
// order are never disturbed while you're logging sets.
function refreshExerciseCard(exId, sets) {
  const ex = allExercises()[exId];
  if (!ex) return;
  const card = document.querySelector(`.ex-card[data-ex-id="${cssEscape(exId)}"]`);
  if (!card) return;
  const allTopped = computeAllTopped(sets, ex);
  card.classList.toggle("topped", allTopped);
  const plateStack = card.querySelector(".plate-stack");
  plateStack.innerHTML = "";
  plateStack.appendChild(buildPlates(sets, ex));
  fillCardFooter(card.querySelector(".ex-card-footer"), ex, allTopped);
}

function refreshActiveDayPillDone() {
  const pill = document.querySelector(".day-pill.active");
  if (!pill) return;
  const date = state.selectedDate;
  const hasLogged = Object.keys(logs[date]?.entries || {}).length > 0 || !!logs[date]?.note;
  pill.classList.toggle("done", hasLogged);
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function removeExerciseFromDay(dayId, exId) {
  const ex = allExercises()[exId];
  const dayLabel = DAYS.find((d) => d.id === dayId)?.label || "this day";
  const ok = confirm(`Remove ${ex ? ex.name : "this exercise"} from ${dayLabel}? Past logged history for it stays in History.`);
  if (!ok) return;
  library[dayId] = (library[dayId] || []).filter((e) => e.id !== exId);
  saveLibrary(library);
  render();
}

function updateSet(exId, idx, field, value) {
  const dayId = selectedDayInfo()?.id || state.selectedDayId;
  const date = state.selectedDate;
  const ex = allExercises()[exId];
  const current = logs[date]?.entries?.[exId]?.sets || defaultSets(ex);
  const newSets = current.map((s, i) => (i === idx ? { ...s, [field]: value } : s));

  if (!logs[date]) logs[date] = { dayId, entries: {} };
  logs[date].dayId = dayId;
  logs[date].entries[exId] = { sets: newSets };
  saveLogs(logs);

  if (field === "weight" && ex.trackType === "weight") {
    upsertBank({ name: ex.name, type: ex.type, trackType: ex.trackType, weights: newSets.map((s) => s.weight), targets: ex.targets });
  }

  refreshExerciseCard(exId, newSets);
  refreshActiveDayPillDone();
}

function applyProgression(exId) {
  const dayId = selectedDayInfo()?.id || state.selectedDayId;
  let updatedEx = null;
  library[dayId] = library[dayId].map((e) => {
    if (e.id !== exId) return e;
    if (e.trackType === "weight") {
      const bump = PROGRESSION_BUMP[e.type] || PROGRESSION_BUMP.other;
      updatedEx = { ...e, weights: e.weights.map((w) => w + bump) };
    } else if (e.trackType === "time") {
      const targets = [0, 1, 2].map((i) => targetForSet(e, i) + TIME_BUMP_SECONDS);
      updatedEx = { ...e, targets };
    } else {
      const targets = [0, 1, 2].map((i) => targetForSet(e, i) + BODYWEIGHT_REP_BUMP);
      updatedEx = { ...e, targets };
    }
    return updatedEx;
  });
  saveLibrary(library);
  if (updatedEx) upsertBank(updatedEx);
  render();
}

// ---- History tab ----
function renderHistory() {
  const wrap = document.createElement("div");
  const dates = Object.keys(logs)
    .filter((d) => Object.keys(logs[d].entries || {}).length > 0 || !!logs[d].note)
    .sort()
    .reverse();

  const exportBtn = el(`<button class="summary-btn" style="margin-bottom:14px;">⬇ Export CSV</button>`);
  exportBtn.onclick = openExportModal;
  wrap.appendChild(exportBtn);

  if (dates.length === 0) {
    wrap.appendChild(el(`<div class="empty-state">No sessions logged yet.</div>`));
    return wrap;
  }

  const exMap = allExercises();
  dates.forEach((date) => {
    const dayLog = logs[date];
    const dayInfo = DAYS.find((d) => d.id === dayLog.dayId);
    const card = el(`
      <div class="hist-card">
        <div class="hist-card-top">
          <span class="date">${fmtDate(date)}</span>
          <span class="day">${dayInfo ? dayInfo.label : ""}</span>
        </div>
      </div>
    `);
    Object.entries(dayLog.entries || {}).forEach(([exId, entry]) => {
      const ex = exMap[exId];
      if (!ex) return;
      const unit = exUnitLabel(ex);
      const setStr = entry.sets.map((s) => {
        if (s.reps == null) return "–";
        return ex.trackType === "weight" ? `${s.weight}×${s.reps}` : `${s.reps}${unit === "sec" ? "s" : " reps"}`;
      }).join(", ");
      card.appendChild(el(`<div class="hist-line"><b>${ex.name}:</b> ${setStr}</div>`));
    });
    if (dayLog.note) {
      card.appendChild(el(`<div class="hist-line"><b>Notes:</b> ${dayLog.note}</div>`));
    }
    wrap.appendChild(card);
  });

  return wrap;
}

// ---- Export filters modal ----
function openExportModal() {
  const overlay = el(`<div class="modal-overlay"></div>`);
  const exMap = allExercises();
  const exList = Object.values(exMap).sort((a, b) => a.name.localeCompare(b.name));
  const dates = Object.keys(logs).sort();
  const earliest = dates[0] || todayISO();
  const latest = dates[dates.length - 1] || todayISO();

  const modal = el(`
    <div class="modal">
      <h3>Export CSV</h3>
      <div class="form-row">
        <label>Date range</label>
        <div class="weights-row">
          <input type="date" id="exp-from" value="${earliest}" />
          <input type="date" id="exp-to" value="${latest}" />
        </div>
      </div>
      <div class="form-row">
        <label>Day types to include</label>
        <div id="exp-day-checks" class="check-grid"></div>
      </div>
      <div class="form-row">
        <label>Exercise</label>
        <select id="exp-exercise">
          <option value="">All exercises</option>
          ${exList.map((ex) => `<option value="${ex.id}">${ex.name}</option>`).join("")}
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="exp-cancel-btn">Cancel</button>
        <button class="btn-primary" id="exp-go-btn">Export</button>
      </div>
    </div>
  `);

  const dayChecks = modal.querySelector("#exp-day-checks");
  DAYS.forEach((d) => {
    const chk = el(`
      <label class="check-item">
        <input type="checkbox" value="${d.id}" checked />
        <span>${d.label}</span>
      </label>
    `);
    dayChecks.appendChild(chk);
  });

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  modal.querySelector("#exp-cancel-btn").onclick = () => document.body.removeChild(overlay);
  modal.querySelector("#exp-go-btn").onclick = () => {
    const from = modal.querySelector("#exp-from").value || "0000-01-01";
    const to = modal.querySelector("#exp-to").value || "9999-12-31";
    const checkedDays = new Set(
      [...dayChecks.querySelectorAll("input:checked")].map((c) => c.value)
    );
    const exerciseId = modal.querySelector("#exp-exercise").value || null;

    const ok = exportCSV({ from, to, days: checkedDays, exerciseId });
    if (ok) document.body.removeChild(overlay);
  };

  document.body.appendChild(overlay);
}

// ---- CSV export ----
// Long-format: one row per exercise per day, matching the wide/columnar
// style of the existing spreadsheet so it drops straight into a pivot table.
// filters: { from, to, days: Set<dayId>, exerciseId } — all optional; called
// with no args exports everything.
function exportCSV(filters) {
  const f = filters || {};
  const exMap = allExercises();
  const rows = [["Date", "Day Type", "Exercise", "Tracking", "Set1 Weight(lbs)", "Set1 Value", "Set2 Weight(lbs)", "Set2 Value", "Set3 Weight(lbs)", "Set3 Value", "Notes"]];

  Object.keys(logs).sort().forEach((date) => {
    if (f.from && date < f.from) return;
    if (f.to && date > f.to) return;
    const dayLog = logs[date];
    if (f.days && !f.days.has(dayLog.dayId)) return;
    const dayLabel = DAYS.find((d) => d.id === dayLog.dayId)?.label || dayLog.dayId || "";
    const entries = dayLog.entries || {};

    Object.entries(entries).forEach(([exId, entry]) => {
      if (f.exerciseId && exId !== f.exerciseId) return;
      const ex = exMap[exId];
      const name = ex ? ex.name : exId;
      const trackType = ex ? ex.trackType : "";
      const sets = entry.sets || [];
      const cells = [];
      for (let i = 0; i < 3; i++) {
        const s = sets[i] || {};
        cells.push(trackType === "weight" ? (s.weight ?? "") : "");
        cells.push(s.reps ?? "");
      }
      rows.push([date, dayLabel, name, trackType, ...cells, ""]);
    });

    if (dayLog.note && !f.exerciseId) {
      rows.push([date, dayLabel, "", "cardio-note", "", "", "", "", "", "", dayLog.note]);
    }
  });

  if (rows.length === 1) {
    alert("No logged sessions match those filters.");
    return false;
  }

  const csv = rows.map((r) => r.map(csvEscapeCell).join(",")).join("\r\n");
  const rangeTag = f.from || f.to ? `_${f.from || "start"}_to_${f.to || "end"}` : "";
  downloadFile(csv, `iron-log-export${rangeTag}-${todayISO()}.csv`, "text/csv;charset=utf-8;");
  return true;
}

function csvEscapeCell(v) {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- One-time data migration ----
// Program officially started 2026-08-17. This silently purges anything
// logged before that, plus any log entries pointing at exercise IDs that no
// longer exist anywhere in the current library (leftover debris from the
// sync-race incident before v7). Runs once automatically on load, guarded by
// a flag so it never runs again — no permanent button, no ongoing UI. Safe
// to leave in: if there's nothing to clean (e.g. on a second device after
// the first already cleaned the shared store), it's a silent no-op.
const CLEANUP_FLOOR_DATE = "2026-08-17";
const CLEANUP_FLAG_KEY = "iron-log-cleanup-v13-done";

function runOneTimeCleanupIfNeeded() {
  if (localStorage.getItem(CLEANUP_FLAG_KEY)) return;

  const exMap = allExercises();
  const datesToRemove = Object.keys(logs).filter((d) => d < CLEANUP_FLOOR_DATE);
  let orphanedCount = 0;

  Object.keys(logs).forEach((date) => {
    if (date < CLEANUP_FLOOR_DATE) return; // whole date already counted above
    const entries = logs[date].entries || {};
    Object.keys(entries).forEach((exId) => {
      if (!exMap[exId]) orphanedCount++;
    });
  });

  if (datesToRemove.length > 0 || orphanedCount > 0) {
    datesToRemove.forEach((d) => delete logs[d]);
    Object.keys(logs).forEach((date) => {
      const entries = logs[date].entries || {};
      Object.keys(entries).forEach((exId) => {
        if (!exMap[exId]) delete entries[exId];
      });
    });
    saveLogs(logs);
    console.log(`Iron Log: one-time cleanup removed ${datesToRemove.length} old day(s) and ${orphanedCount} orphaned entr${orphanedCount === 1 ? "y" : "ies"}.`);
  }

  localStorage.setItem(CLEANUP_FLAG_KEY, "1");
}

// ---- Progress tab ----
function renderProgress() {
  const wrap = document.createElement("div");
  const exMap = allExercises();
  const exList = Object.values(exMap);

  if (exList.length === 0) {
    wrap.appendChild(el(`<div class="empty-state">Add exercises to see progress charts.</div>`));
    return wrap;
  }

  if (!state.progressExId || !exMap[state.progressExId]) state.progressExId = exList[0].id;

  const select = el(`<select></select>`);
  exList.forEach((ex) => {
    const opt = el(`<option value="${ex.id}" ${ex.id === state.progressExId ? "selected" : ""}>${ex.name}</option>`);
    select.appendChild(opt);
  });
  select.onchange = (e) => { state.progressExId = e.target.value; render(); };
  wrap.appendChild(select);

  const currentEx = exMap[state.progressExId];
  const isWeighted = currentEx && currentEx.trackType === "weight";
  const metricLabel = currentEx && currentEx.trackType === "time" ? "sec held" : isWeighted ? "lbs" : "reps";

  const points = [];
  Object.entries(logs).sort(([a], [b]) => (a < b ? -1 : 1)).forEach(([date, dayLog]) => {
    const entry = dayLog.entries?.[state.progressExId];
    if (entry) {
      const completed = entry.sets.filter((s) => s.reps != null);
      if (completed.length > 0) {
        const value = isWeighted
          ? Math.max(...entry.sets.map((s) => s.weight || 0))
          : Math.max(...entry.sets.map((s) => s.reps || 0));
        points.push({ date: fmtDate(date), weight: value });
      }
    }
  });

  if (points.length < 2) {
    wrap.appendChild(el(`<div class="empty-state">Log at least 2 sessions for this exercise to see a trend.</div>`));
    return wrap;
  }

  const chartWrap = el(`<div class="chart-wrap"></div>`);
  chartWrap.appendChild(renderLineChart(points));
  wrap.appendChild(chartWrap);
  wrap.appendChild(el(`<div class="chart-metric-label">Tracking: ${metricLabel} (best set per session)</div>`));

  return wrap;
}

function renderLineChart(points) {
  const W = 400, H = 200, PAD = 32;
  const weights = points.map((p) => p.weight);
  const minW = Math.min(...weights) - 5;
  const maxW = Math.max(...weights) + 5;
  const xStep = (W - PAD * 2) / (points.length - 1 || 1);

  const xy = points.map((p, i) => {
    const x = PAD + i * xStep;
    const y = H - PAD - ((p.weight - minW) / (maxW - minW || 1)) * (H - PAD * 2);
    return [x, y];
  });

  const pathD = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", "100%");
  svg.style.display = "block";

  // grid lines
  for (let i = 0; i <= 3; i++) {
    const y = PAD + (i * (H - PAD * 2)) / 3;
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", PAD); line.setAttribute("x2", W - PAD);
    line.setAttribute("y1", y); line.setAttribute("y2", y);
    line.setAttribute("stroke", "#DDCB8E"); line.setAttribute("stroke-dasharray", "3,3");
    svg.appendChild(line);
  }

  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#B8720C");
  path.setAttribute("stroke-width", "2.5");
  svg.appendChild(path);

  xy.forEach(([x, y], i) => {
    const c = document.createElementNS(svgNS, "circle");
    c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", 4);
    c.setAttribute("fill", "#B8720C");
    svg.appendChild(c);

    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", x); label.setAttribute("y", H - 8);
    label.setAttribute("fill", "#4A4A3C"); label.setAttribute("font-size", "10");
    label.setAttribute("text-anchor", "middle");
    label.textContent = points[i].date;
    svg.appendChild(label);
  });

  return svg;
}

// ---- Workout Summary modal ----
// A focused, end-of-session recap of everything logged today for the current
// day type — so you can confirm every weight/rep (or rep/hold time) actually
// saved correctly before you leave the gym, without hunting through History.
function openWorkoutSummaryModal(dayId) {
  const date = state.selectedDate;
  const dayLabel = DAYS.find((d) => d.id === dayId)?.label || "Workout";
  const dayExercises = library[dayId] || [];
  const todayLog = logs[date] || { dayId, entries: {} };

  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`
    <div class="modal">
      <h3>${dayLabel} — ${fmtDate(date)}</h3>
      <div id="summary-list"></div>
      <div class="modal-actions">
        <button class="btn-primary" id="summary-close-btn" style="flex:1">Close</button>
      </div>
    </div>
  `);

  const list = modal.querySelector("#summary-list");
  if (dayExercises.length === 0) {
    list.appendChild(el(`<div class="empty-state">No exercises set up for ${dayLabel} yet.</div>`));
  } else {
    let anyLogged = false;
    dayExercises.forEach((ex) => {
      const entry = todayLog.entries?.[ex.id];
      const sets = entry?.sets || defaultSets(ex);
      const hasAnyValue = sets.some((s) => s.reps != null);
      if (hasAnyValue) anyLogged = true;
      const allTopped = computeAllTopped(sets, ex);
      const unit = exUnitLabel(ex);

      const row = el(`<div class="summary-row ${allTopped ? "complete" : ""}"></div>`);
      const line = sets.map((s, i) => {
        const missing = s.reps == null;
        const weightPart = ex.trackType === "weight" ? `${s.weight} lbs × ` : "";
        return `<span class="summary-set ${missing ? "missing" : ""}">${missing ? "not logged" : `${weightPart}${s.reps} ${unit}`}</span>`;
      }).join(`<span class="summary-sep">·</span>`);

      row.innerHTML = `
        <div class="summary-row-top">
          <span class="summary-ex-name">${ex.name}</span>
          <span class="summary-status">${allTopped ? "✓ topped out" : hasAnyValue ? "" : "⚠ not started"}</span>
        </div>
        <div class="summary-sets">${line}</div>
      `;
      list.appendChild(row);
    });

    if (!anyLogged) {
      list.appendChild(el(`<div class="field-hint" style="margin-top:10px;">Nothing logged yet today for ${dayLabel}.</div>`));
    }
  }

  if (todayLog.note) {
    list.appendChild(el(`<div class="summary-row"><div class="summary-row-top"><span class="summary-ex-name">Notes</span></div><div class="summary-sets">${todayLog.note}</div></div>`));
  }

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  modal.querySelector("#summary-close-btn").onclick = () => document.body.removeChild(overlay);
  document.body.appendChild(overlay);
}

// ---- Import modal ----
// Bulk-loads a JSON list of exercises, e.g. copied from a Sunday Planner PDF
// or typed up by hand: [{ "name": "...", "day": "upper|lower|core|mobility",
// "type": "upper|lower|other", "weights": [w1,w2,w3] }, ...]
// Matches existing exercises by name (case-insensitive) within the same day
// and updates their weights instead of creating a duplicate.
const STARTER_IMPORT_EXAMPLE = [
  { name: "Chest Press Converging", day: "upper", type: "upper", weights: [40, 50, 60] },
  { name: "Lat Pulldown Machine", day: "upper", type: "upper", weights: [65, 70, 75] },
  { name: "High Row Machine Iso Lateral (Right)", day: "upper", type: "upper", weights: [50, 50, 50] },
  { name: "High Row Machine Iso Lateral (Left)", day: "upper", type: "upper", weights: [50, 50, 50] },
  { name: "Tricep Extension Machine", day: "upper", type: "upper", weights: [55, 60, 65] },
  { name: "Biceps Curl H.S. (Right)", day: "upper", type: "upper", weights: [10, 10, 10] },
  { name: "Biceps Curl H.S. (Left)", day: "upper", type: "upper", weights: [10, 10, 10] },
  { name: "Pull-Up Machine Assisted", day: "upper", type: "upper", weights: [180, 180, 180] },
  { name: "Hang Machine Assisted", day: "upper", type: "upper", weights: [180, 180, 180] },
  { name: "Leg Press (Plates)", day: "lower", type: "lower", weights: [45, 45, 45] },
  { name: "Leg Curl (Prone)", day: "lower", type: "lower", weights: [40, 65, 70] },
  { name: "Glute Kickback (Right)", day: "lower", type: "lower", weights: [70, 70, 70] },
  { name: "Glute Kickback (Left)", day: "lower", type: "lower", weights: [70, 70, 70] },
  { name: "Hip Abduction Machine", day: "lower", type: "lower", weights: [150, 155, 160] },
  { name: "Calf-Raise Machine", day: "lower", type: "lower", weights: [120, 120, 130] },
];

function openImportModal() {
  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`
    <div class="modal">
      <h3>Import Exercises</h3>
      <div class="form-row">
        <label>Paste a list (JSON array — name, day, type, weights)</label>
        <textarea id="import-text" class="import-textarea" spellcheck="false"></textarea>
      </div>
      <div class="form-row import-hint">
        day: upper / lower / core / mobility &nbsp;·&nbsp; type: upper / lower / other
      </div>
      <div class="import-result" id="import-result"></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="import-cancel-btn">Cancel</button>
        <button class="btn-primary" id="import-save-btn">Import</button>
      </div>
    </div>
  `);
  const textarea = modal.querySelector("#import-text");
  textarea.value = JSON.stringify(STARTER_IMPORT_EXAMPLE, null, 2);
  const resultBox = modal.querySelector("#import-result");

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  modal.querySelector("#import-cancel-btn").onclick = () => document.body.removeChild(overlay);
  modal.querySelector("#import-save-btn").onclick = () => {
    let items;
    try {
      items = JSON.parse(textarea.value);
      if (!Array.isArray(items)) throw new Error("not an array");
    } catch (e) {
      resultBox.textContent = "That doesn't look like valid JSON — check for a missing bracket or comma.";
      resultBox.className = "import-result error";
      return;
    }

    const validDays = new Set(EXERCISE_DAYS.map((d) => d.id));
    let added = 0, updated = 0, skipped = 0;

    items.forEach((item) => {
      const name = (item.name || "").trim();
      const day = item.day;
      const type = ["upper", "lower", "other"].includes(item.type) ? item.type : "other";
      const trackType = ["weight", "bodyweight", "time"].includes(item.trackType) ? item.trackType : "weight";
      const weights = Array.isArray(item.weights) && item.weights.length === 3
        ? item.weights.map((w) => Number(w) || 0)
        : [20, 20, 20];
      const targets = Array.isArray(item.targets) && item.targets.length === 3
        ? item.targets.map((t) => Number(t) || 0)
        : defaultTargets(trackType);

      if (!name || !validDays.has(day)) { skipped++; return; }
      if (!library[day]) library[day] = [];

      const existing = library[day].find((e) => bankKey(e.name) === bankKey(name));
      if (existing) {
        existing.weights = weights;
        existing.type = type;
        existing.trackType = trackType;
        existing.targets = targets;
        updated++;
      } else {
        library[day].push({ id: slugify(name), name, type, trackType, weights, targets });
        added++;
      }
      upsertBank({ name, type, trackType, weights, targets });
    });

    saveLibrary(library);
    resultBox.textContent = `Added ${added}, updated ${updated}${skipped ? `, skipped ${skipped} (missing name or invalid day)` : ""}.`;
    resultBox.className = "import-result success";
    render();
    setTimeout(() => { if (document.body.contains(overlay)) document.body.removeChild(overlay); }, 1400);
  };

  document.body.appendChild(overlay);
  textarea.focus();
}

// ---- Add Exercise modal ----
function openAddExerciseModal() {
  const overlay = el(`<div class="modal-overlay"></div>`);
  const bankEntries = Object.values(bank).sort((a, b) => a.name.localeCompare(b.name));
  const modal = el(`
    <div class="modal">
      <h3>Add Exercise</h3>
      <div class="form-row">
        <label>From your bank</label>
        <select id="ex-bank">
          <option value="">+ New exercise</option>
          ${bankEntries.map((b) => `<option value="${bankKey(b.name)}">${b.name}</option>`).join("")}
        </select>
      </div>
      <div class="form-row">
        <label>Exercise name</label>
        <input type="text" id="ex-name" placeholder="e.g. Cable Woodchop" />
      </div>
      <div class="form-row">
        <label>Day</label>
        <select id="ex-day"></select>
      </div>
      <div class="form-row">
        <label>How is this tracked?</label>
        <select id="ex-track">
          <option value="weight">Weight + Reps</option>
          <option value="bodyweight">Bodyweight (reps only)</option>
          <option value="time">Time held (seconds)</option>
        </select>
      </div>
      <div id="ex-weight-fields">
        <div class="form-row">
          <label>Progression type</label>
          <select id="ex-type">
            <option value="upper">Upper body (+5 lbs)</option>
            <option value="lower">Lower body (+10 lbs)</option>
            <option value="other">Other (+5 lbs)</option>
          </select>
        </div>
        <div class="form-row">
          <label>Starting weight per set (lbs)</label>
          <div class="weights-row">
            <input type="number" id="w1" placeholder="Set 1" value="20" />
            <input type="number" id="w2" placeholder="Set 2" value="20" />
            <input type="number" id="w3" placeholder="Set 3" value="20" />
          </div>
        </div>
      </div>
      <div class="form-row">
        <label id="ex-targets-label">Target reps per set</label>
        <div class="weights-row">
          <input type="number" id="t1" placeholder="Set 1" value="10" />
          <input type="number" id="t2" placeholder="Set 2" value="10" />
          <input type="number" id="t3" placeholder="Set 3" value="10" />
        </div>
        <div class="field-hint">Set these however fits — equal, ascending, or a lighter last set. Nothing is assumed.</div>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancel-btn">Cancel</button>
        <button class="btn-primary" id="save-btn">Add exercise</button>
      </div>
    </div>
  `);
  const daySelect = modal.querySelector("#ex-day");
  const preferredDay = selectedDayInfo();
  const defaultDayId = preferredDay && preferredDay.loggable ? preferredDay.id : EXERCISE_DAYS[0].id;
  EXERCISE_DAYS.forEach((d) => {
    daySelect.appendChild(el(`<option value="${d.id}" ${d.id === defaultDayId ? "selected" : ""}>${d.label}</option>`));
  });
  const typeSelect = modal.querySelector("#ex-type");
  if (defaultDayId === "upper") typeSelect.value = "upper";
  else if (defaultDayId === "lower") typeSelect.value = "lower";
  else typeSelect.value = "other";

  const nameInput = modal.querySelector("#ex-name");
  const w1Input = modal.querySelector("#w1");
  const w2Input = modal.querySelector("#w2");
  const w3Input = modal.querySelector("#w3");
  const t1Input = modal.querySelector("#t1");
  const t2Input = modal.querySelector("#t2");
  const t3Input = modal.querySelector("#t3");
  const targetsLabel = modal.querySelector("#ex-targets-label");
  const bankSelect = modal.querySelector("#ex-bank");
  const trackSelect = modal.querySelector("#ex-track");
  const weightFields = modal.querySelector("#ex-weight-fields");

  function setTargetInputs(trackType, targets) {
    const t = targets || defaultTargets(trackType);
    t1Input.value = t[0];
    t2Input.value = t[1];
    t3Input.value = t[2];
  }

  function updateFieldVisibility() {
    const t = trackSelect.value;
    weightFields.style.display = t === "weight" ? "" : "none";
    targetsLabel.textContent = t === "time" ? "Target hold time per set (seconds)" : "Target reps per set";
  }
  trackSelect.onchange = () => {
    updateFieldVisibility();
    setTargetInputs(trackSelect.value, null); // reset to sensible defaults when switching type
  };
  updateFieldVisibility();
  setTargetInputs("weight", null);

  bankSelect.onchange = () => {
    const key = bankSelect.value;
    if (!key) return; // "+ New exercise" — leave fields as-is for a fresh entry
    const entry = bank[key];
    if (!entry) return;
    nameInput.value = entry.name;
    typeSelect.value = entry.type;
    trackSelect.value = entry.trackType || "weight";
    updateFieldVisibility();
    const w = entry.weights || [20, 20, 20];
    w1Input.value = w[0] ?? 20;
    w2Input.value = w[1] ?? 20;
    w3Input.value = w[2] ?? 20;
    setTargetInputs(entry.trackType || "weight", entry.targets);
  };

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  modal.querySelector("#cancel-btn").onclick = () => document.body.removeChild(overlay);
  modal.querySelector("#save-btn").onclick = () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const dayId = modal.querySelector("#ex-day").value;
    const trackType = trackSelect.value;
    const type = typeSelect.value;
    const w1 = Number(w1Input.value) || 0;
    const w2 = Number(w2Input.value) || 0;
    const w3 = Number(w3Input.value) || 0;
    const weights = [w1, w2, w3];
    const targets = [Number(t1Input.value) || 1, Number(t2Input.value) || 1, Number(t3Input.value) || 1];

    const newEx = { id: slugify(name), name, type, trackType, weights, targets };
    if (!library[dayId]) library[dayId] = [];
    library[dayId].push(newEx);
    saveLibrary(library);
    upsertBank(newEx);

    state.selectedDayId = dayId;
    document.body.removeChild(overlay);
    render();
  };

  document.body.appendChild(overlay);
  nameInput.focus();
}

// ---- Boot ----
window.addEventListener("online", () => {
  render();
  pullRemote(false);
});
window.addEventListener("offline", () => {
  setSyncStatus("offline");
  render();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW registration failed", e));
  });
}

render();
if (navigator.onLine) {
  setSyncStatus("syncing");
  pullRemote(true).then(() => runOneTimeCleanupIfNeeded());
} else {
  setSyncStatus("offline");
  runOneTimeCleanupIfNeeded();
}
