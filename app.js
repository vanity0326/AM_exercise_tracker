// ---------- Data ----------
const APP_VERSION = "v41";
// Day "type" is now something you assign per date (like the Sunday Planner),
// not a fixed weekly rotation. Every loggable day works identically — its
// own exercise list, bank-integrated add/edit, circuits, and an optional
// finisher list. Rest is the only exception (no logging needed).
const DAYS = [
  { id: "upper", label: "Upper Body", short: "UP", loggable: true },
  { id: "lower", label: "Lower Body", short: "LOW", loggable: true },
  { id: "core", label: "Core", short: "CORE", loggable: true },
  { id: "mobility", label: "Mobility", short: "MOB", loggable: true },
  { id: "cardio", label: "Cardio", short: "CARDIO", loggable: true },
  { id: "rest", label: "Rest", short: "REST", loggable: false },
];
const EXERCISE_DAYS = DAYS.filter((d) => d.loggable);

// A "finisher" list is a second exercise list per day (e.g. an elliptical
// finisher after Upper lifting), stored under its own library key so it
// works exactly like a primary day's exercises — same Add/Edit/bank/
// progression — without changing the day's actual type.
function finisherKey(dayId) {
  return dayId + "_finisher";
}
function listLabel(listKey) {
  if (listKey.endsWith("_finisher")) {
    const base = listKey.slice(0, -"_finisher".length);
    const d = DAYS.find((x) => x.id === base);
    return `${d ? d.label : base} Finisher`;
  }
  return DAYS.find((d) => d.id === listKey)?.label || listKey;
}

// Only Upper and Lower are shared across every date of that type — that's
// correct for strength training, where you want the same exercise list with
// progressing weights across sessions. Everything else (Core, Mobility,
// Cardio, and every finisher list) is scoped to the specific calendar date —
// removing "Walking Outside" from Sept 4th's Cardio must never remove it
// from Sept 1st's Cardio too.
const SHARED_LIST_TYPES = new Set(["upper", "lower"]);
function isSharedList(listKey) {
  return SHARED_LIST_TYPES.has(listKey);
}

// Reads/writes the correct exercise list for a given date + list key,
// transparently routing shared types (Upper/Lower) to the library and
// everything else to that specific date's own storage.
function getExerciseList(date, listKey) {
  if (isSharedList(listKey)) return library[listKey] || [];
  const perDate = logs[date]?.lists?.[listKey];
  if (perDate) return perDate;
  // Fallback for exercises added before per-date lists existed — shown as a
  // starting point on any date that hasn't been individually modified yet.
  // The moment this date's list is changed, it gets saved as its own
  // independent copy and stops being affected by (or affecting) other dates.
  return library[listKey] || [];
}
function setExerciseList(date, listKey, list) {
  if (isSharedList(listKey)) {
    library[listKey] = list;
    saveLibrary(library);
    return;
  }
  if (!logs[date]) logs[date] = { dayId: listKey.replace(/_finisher$/, ""), entries: {} };
  if (!logs[date].lists) logs[date].lists = {};
  logs[date].lists[listKey] = list;
  saveLogs(logs);
}

// No preloaded exercises — starts empty, everything added via the + button.
// Only the two shared (strength) types live here now; Core/Mobility/Cardio
// and finishers are stored per-date instead (see getExerciseList above).
const DEFAULT_LIBRARY = { upper: [], lower: [] };

const PROGRESSION_BUMP = { upper: 5, lower: 10, other: 5 };
const DEFAULT_TARGET_REPS = 10;
const DEFAULT_TARGET_SECONDS = 30;
const DEFAULT_TARGET_MINUTES = 20;
const BODYWEIGHT_REP_BUMP = 2;
const TIME_BUMP_SECONDS = 10;
const DURATION_BUMP_MINUTES = 5;
const ZONE_BUMP_MINUTES = 5;

// Every exercise has a trackType controlling how it's logged:
//   weight     — lbs + reps per set (default, e.g. Chest Press)
//   bodyweight — reps only per set, no weight (e.g. Cat-Cow, or laps for swim)
//   time       — seconds held per set, no weight (e.g. a static stretch)
//   duration   — minutes per set, no weight (e.g. elliptical, treadmill)
//   hr_zones   — minutes spent in each of 4 fixed heart-rate zones per
//                session (always exactly 4 slots — Zone 1/2/3/4, not "sets")
const TRACK_TYPES = {
  weight: { label: "Weight + Reps" },
  bodyweight: { label: "Bodyweight (reps only)" },
  time: { label: "Time held (seconds)" },
  duration: { label: "Duration (minutes)" },
  hr_zones: { label: "Heart Rate Zones (Z1–Z4 minutes)" },
};
function exUnitLabel(ex) {
  if (ex.customUnit) return ex.customUnit;
  if (ex.trackType === "time") return "sec";
  if (ex.trackType === "duration" || ex.trackType === "hr_zones") return "min";
  return "reps";
}
function isZoneTracked(ex) {
  return ex.trackType === "hr_zones";
}
function exNumSets(ex) {
  if (isZoneTracked(ex)) return 4; // always exactly Z1–Z4
  const n = ex.numSets;
  return Number.isInteger(n) && n >= 1 ? n : 3;
}
function setLabelFor(ex, i) {
  return isZoneTracked(ex) ? `Zone ${i + 1}` : `Set ${i + 1}`;
}
// Per-set targets are fully custom per exercise — no baked-in pattern.
// ex.targets is a [t1, t2, ...] array (length = exNumSets(ex)) you set when
// adding the exercise — any set can be higher or lower than the others, or
// all the same, whatever fits that movement.
function targetForSet(ex, setIndex) {
  if (Array.isArray(ex.targets) && ex.targets[setIndex] != null) return ex.targets[setIndex];
  // Fallback for exercises saved before per-set targets existed.
  if (ex.target != null) return ex.target;
  if (ex.trackType === "time") return DEFAULT_TARGET_SECONDS;
  if (ex.trackType === "duration" || ex.trackType === "hr_zones") return DEFAULT_TARGET_MINUTES;
  return DEFAULT_TARGET_REPS;
}
function defaultTargets(trackType, n) {
  const base = trackType === "time" ? DEFAULT_TARGET_SECONDS
    : (trackType === "duration" || trackType === "hr_zones") ? DEFAULT_TARGET_MINUTES
    : DEFAULT_TARGET_REPS;
  return Array.from({ length: n || 3 }, () => base);
}
function targetLabelFor(ex) {
  const n = exNumSets(ex);
  const vals = Array.from({ length: n }, (_, i) => targetForSet(ex, i));
  if (isZoneTracked(ex)) {
    const total = vals.reduce((sum, v) => sum + v, 0);
    return vals.map((v, i) => `Z${i + 1}: ${v}min`).join(" / ") + ` (Total: ${total} min)`;
  }
  const suffix = ex.customUnit ? ` ${ex.customUnit}`
    : ex.trackType === "time" ? "s"
    : ex.trackType === "duration" ? " min"
    : "";
  if (vals.every((v) => v === vals[0])) return `${vals[0]}${suffix} · all ${n} set${n === 1 ? "" : "s"}`;
  return vals.map((v) => `${v}${suffix}`).join(" / ");
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
    customUnit: ex.customUnit || null,
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
      // Older copies of the sync function didn't store the marathon plan —
      // if the remote has none, keep this device's copy (it gets pushed up
      // on the next save) instead of wiping it.
      if (remote.marathon) marathon = { ...structuredClone(DEFAULT_MARATHON), ...remote.marathon };
      localStorage.setItem(LS_LIB, JSON.stringify(library));
      localStorage.setItem(LS_LOGS, JSON.stringify(logs));
      localStorage.setItem(LS_BANK, JSON.stringify(bank));
      localStorage.setItem(LS_MARATHON, JSON.stringify(marathon));
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
      body: JSON.stringify({ library, logs, bank, marathon }),
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
  runCalIdx: null, // which calendar week the Run tab is showing (null = current)
};

// ---------- Helpers ----------
// Local calendar date (not UTC). toISOString() is UTC, which in Central
// time rolled "today" over to tomorrow every evening after 7pm.
function todayISO() {
  const d = new Date();
  return partsToIso(d.getFullYear(), d.getMonth(), d.getDate());
}
function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
// An entry only counts as "actually logged" if at least one set has a real
// value — an entry that exists but has every set empty (e.g. from touching
// a weight box without ever entering reps) is noise, not a workout.
function entryHasData(entry) {
  return !!entry && Array.isArray(entry.sets) && entry.sets.some((s) => s.reps != null);
}
function dayLogHasRealData(dayLog) {
  if (!dayLog) return false;
  const hasEntry = Object.values(dayLog.entries || {}).some((e) => entryHasData(e));
  return hasEntry || !!dayLog.note || !!dayLog.finisherNote;
}

function allExercises() {
  const map = {};
  Object.values(library).forEach((list) => (list || []).forEach((e) => (map[e.id] = e)));
  Object.values(logs).forEach((dayLog) => {
    Object.values(dayLog.lists || {}).forEach((list) => (list || []).forEach((e) => (map[e.id] = e)));
  });
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

// Traps Tab navigation inside a modal overlay. Without this, pressing Tab
// jumps to whatever's behind the modal — exercise cards on the Log tab carry
// explicit tabindex values (for the lbs→lbs→lbs→reps→reps→reps flow), and
// browsers give those priority over the modal's own unnumbered fields,
// yanking focus (and sometimes the modal itself) right out from under you.
function trapFocus(overlay) {
  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusable = Array.from(
      overlay.querySelectorAll("input, select, textarea, button")
    ).filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) return;
    e.preventDefault();
    const currentIndex = focusable.indexOf(document.activeElement);
    let nextIndex;
    if (e.shiftKey) {
      nextIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
    } else {
      nextIndex = currentIndex === -1 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
    }
    focusable[nextIndex].focus();
  });
}

// ---------- Custom date picker (Monday-first) ----------
// Native <input type="date"> follows the device's system Region setting for
// which day starts the week — not something a webpage can override. This
// replaces it with a fully custom calendar so the week always starts on
// Monday here, regardless of device settings.
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isoToParts(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { year: y, month: m - 1, day: d };
}
function partsToIso(year, month, day) {
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}
function mondayFirstWeekday(year, month, day) {
  const jsDay = new Date(year, month, day).getDay(); // 0=Sun..6=Sat
  return (jsDay + 6) % 7; // 0=Mon..6=Sun
}

function buildCalendarGrid(year, month, selectedIso, onSelectIso) {
  const grid = el(`<div class="cal-grid"></div>`);
  WEEKDAY_LABELS.forEach((d) => grid.appendChild(el(`<div class="cal-weekday">${d}</div>`)));

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = mondayFirstWeekday(year, month, 1);
  for (let i = 0; i < leadingBlanks; i++) grid.appendChild(el(`<div class="cal-day cal-blank"></div>`));

  const todayIso = todayISO();
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = partsToIso(year, month, day);
    const isSelected = iso === selectedIso;
    const isToday = iso === todayIso;
    const cell = el(`<button type="button" class="cal-day ${isSelected ? "selected" : ""} ${isToday ? "today" : ""}">${day}</button>`);
    cell.onclick = () => onSelectIso(iso);
    grid.appendChild(cell);
  }
  return grid;
}

// Renders a button that looks like a date field; tapping it opens the
// custom Monday-first calendar. onChange receives the new ISO date string.
function renderDateButton(currentIso, onChange, extraClass) {
  const btn = el(`<button type="button" class="date-btn ${extraClass || ""}">${fmtDate(currentIso)}, ${isoToParts(currentIso).year}</button>`);
  btn.onclick = () => openDatePickerModal(currentIso, onChange);
  return btn;
}

function openDatePickerModal(currentIso, onSelect) {
  let { year, month } = isoToParts(currentIso);
  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`
    <div class="modal cal-modal">
      <div class="cal-header">
        <button type="button" class="cal-nav-btn" id="cal-prev">‹</button>
        <div class="cal-month-label" id="cal-month-label"></div>
        <button type="button" class="cal-nav-btn" id="cal-next">›</button>
      </div>
      <div id="cal-grid-holder"></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cal-cancel-btn" style="flex:1">Cancel</button>
      </div>
    </div>
  `);
  const monthLabel = modal.querySelector("#cal-month-label");
  const gridHolder = modal.querySelector("#cal-grid-holder");

  function refresh() {
    monthLabel.textContent = `${MONTH_NAMES[month]} ${year}`;
    gridHolder.innerHTML = "";
    gridHolder.appendChild(buildCalendarGrid(year, month, currentIso, (iso) => {
      onSelect(iso);
      document.body.removeChild(overlay);
    }));
  }
  modal.querySelector("#cal-prev").onclick = () => {
    month--; if (month < 0) { month = 11; year--; }
    refresh();
  };
  modal.querySelector("#cal-next").onclick = () => {
    month++; if (month > 11) { month = 0; year++; }
    refresh();
  };
  refresh();

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  modal.querySelector("#cal-cancel-btn").onclick = () => document.body.removeChild(overlay);

  document.body.appendChild(overlay);
  trapFocus(overlay);
}

// ---------- Rendering ----------
const app = document.getElementById("app");

function render() {
  app.innerHTML = "";
  app.appendChild(renderHeader());
  app.appendChild(renderOfflineBanner());
  app.appendChild(renderTabs());

  if (state.tab === "today") app.appendChild(renderToday());
  if (state.tab === "run") app.appendChild(renderRun());
  if (state.tab === "history") app.appendChild(renderHistory());
  if (state.tab === "progress") app.appendChild(renderProgress());

  if (state.tab !== "run") app.appendChild(renderFab());
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
          <div class="title">TONI'S TOTAL TRAINING TRACKER</div>
          <div class="subtitle">${APP_VERSION}</div>
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
  [["today", "LOG"], ["run", "RUN"], ["history", "HISTORY"], ["progress", "PROGRESS"]].forEach(([id, label]) => {
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
  const existing = logs[date];
  // If this date already has real logged data under a different type,
  // switching it needs an explicit confirmation — a stray pill tap (e.g.
  // just glancing at another day-type's list) shouldn't silently relabel
  // an already-completed session.
  if (existing && existing.dayId && existing.dayId !== dayId && dayLogHasRealData(existing)) {
    const existingLabel = DAYS.find((d) => d.id === existing.dayId)?.label || existing.dayId;
    const newLabel = DAYS.find((d) => d.id === dayId)?.label || dayId;
    const ok = confirm(`${fmtDate(date)} already has logged ${existingLabel} data.\n\nSwitch this date's type to ${newLabel} instead? The logged exercises stay visible in History either way — this only changes which type this date is tagged as.`);
    if (!ok) return;
  }
  if (!logs[date]) logs[date] = { dayId, entries: {} };
  logs[date].dayId = dayId;
  // Keep the Sunday Planner in step: changing the type here updates that
  // date's planned session (Level Up and commute picks stay as they were).
  const plan = logs[date].plan;
  if (plan && !plan.isCommute) {
    plan.primary = planPrimaryForTracker(date, dayId);
    plan.setDayType = false;
  }
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
    const hasLogged = logs[state.selectedDate]?.dayId === d.id && dayLogHasRealData(logs[state.selectedDate]);
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
    </div>
  `);
  header.appendChild(renderDateButton(state.selectedDate, (iso) => {
    state.selectedDate = iso;
    state.selectedDayId = null;
    render();
  }));
  wrap.appendChild(header);

  // Marathon plan: today's prescribed run (if the plan is set up and this
  // date falls inside it). Independent of the lifting day type below.
  const planNote = renderPlanNote(state.selectedDate);
  if (planNote) wrap.appendChild(planNote);

  const runStrip = renderRunStrip(state.selectedDate);
  if (runStrip) wrap.appendChild(runStrip);

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

  const dayExercises = getExerciseList(state.selectedDate, current.id);
  const todayLog = logs[state.selectedDate] || { dayId: current.id, entries: {} };

  if (dayExercises.length === 0) {
    wrap.appendChild(el(`
      <div class="empty-state">
        No exercises added for ${current.label} yet. Tap the + button to add one.
      </div>
    `));
    wrap.appendChild(renderFinisherSection(current.id, todayLog));
    return wrap;
  }

  const tabCursor = makeTabCursor();
  const plan = buildRenderPlan(dayExercises);
  plan.forEach((item) => {
    if (item.type === "solo") {
      const ex = item.ex;
      const entry = todayLog.entries?.[ex.id];
      const sets = entry?.sets || defaultSets(ex);
      const blockSize = sets.length * (ex.trackType === "weight" ? 2 : 1);
      wrap.appendChild(renderExerciseCard(ex, sets, tabCursor.next(blockSize), current.id));
    } else {
      wrap.appendChild(renderCircuitCard(item.exercises, item.groupId, tabCursor, todayLog, current.id));
    }
  });

  const actionRow = el(`<div class="log-action-row"></div>`);
  const summaryBtn = el(`<button class="summary-btn">✓ View Workout Summary</button>`);
  summaryBtn.onclick = () => openWorkoutSummaryModal(current.id);
  actionRow.appendChild(summaryBtn);

  if (dayExercises.filter((e) => !e.groupId).length >= 2) {
    const groupBtn = el(`<button class="group-btn">🔗 Group into Circuit</button>`);
    groupBtn.onclick = () => openGroupModal(current.id);
    actionRow.appendChild(groupBtn);
  }

  const hasLoggedToday = dayLogHasRealData(todayLog);
  if (hasLoggedToday) {
    const clearDayBtn = el(`<button class="clear-day-btn">🗑 Clear This Day's Log</button>`);
    clearDayBtn.onclick = () => clearSingleDay(state.selectedDate);
    actionRow.appendChild(clearDayBtn);
  }
  wrap.appendChild(actionRow);

  wrap.appendChild(renderFinisherSection(current.id, todayLog, tabCursor));

  return wrap;
}

// What the Sunday Planner has down for this date (if anything).
const PLAN_LABELS = {
  swim: "Swim", ellip: "Elliptical", upper: "Upper lifting", lower: "Lower lifting", fullbody: "Full Body",
  core: "Core Toning", mob: "Mobility", pilates: "Pilates", "cardio-class": "Cardio Class", walk: "Walking",
  treadmill: "Treadmill", run: "Marathon run", rest: "Rest", cardio: "Cardio",
  "lu-swim": "Swim", "lu-ellip": "Elliptical", "lu-dance": "Dance", "lu-yoga": "Yoga", "lu-meditation": "Meditation",
  "lu-pilates": "Pilates", "lu-walk": "Walking", "lu-treadmill": "Treadmill", "lu-aquafit": "Aquafit",
  "lu-cooldown": "Mindful Cooldown", "lu-rest": "Just rest!", "lu-core": "Core Toning", "lu-mob": "Mobility",
  "walk-lunch": "Walk at lunch",
};
function planPrimaryForTracker(date, dayId) {
  if (dayId === "mobility") return "mob";
  if (dayId !== "cardio") return dayId; // upper, lower, core, rest match 1:1
  const names = getExerciseList(date, "cardio").map((e) => (e.name || "").toLowerCase()).join(" | ");
  if (/swim|pool|lap/.test(names)) return "swim";
  if (/ellip/.test(names)) return "ellip";
  if (/treadmill/.test(names)) return "treadmill";
  if (/walk/.test(names)) return "walk";
  if (/pilates/.test(names)) return "pilates";
  if (/class/.test(names)) return "cardio-class";
  return "cardio";
}
function renderPlanNote(date) {
  const plan = logs[date]?.plan;
  if (!plan) return null;
  let text;
  if (plan.isCommute) text = `Commute day: ${PLAN_LABELS[plan.commute] || "walk at lunch"}`;
  else {
    const parts = [];
    if (plan.primary) parts.push(PLAN_LABELS[plan.primary] || plan.primary);
    if (plan.levelup) parts.push(`Level Up: ${PLAN_LABELS[plan.levelup] || plan.levelup}`);
    if (!parts.length) return null;
    text = parts.join(", ");
  }
  return el(`<div class="plan-note">📋 Planned: ${text}</div>`);
}

// A finisher list works exactly like a primary day's exercises — same
// cards, same Add Exercise modal (bank included), same edit/delete/circuit
// grouping — just stored under its own key and shown in a separate section.
// sharedTabCursor continues the SAME tabindex sequence as the primary list
// above it — using a fresh cursor here would hand out duplicate tabindex
// values, and the browser resolves duplicates by jumping to whichever one
// comes first in the DOM (i.e. back up to the primary list).
function renderFinisherSection(dayId, todayLog, sharedTabCursor) {
  const wrap = document.createElement("div");
  const fKey = finisherKey(dayId);
  const finisherExercises = getExerciseList(state.selectedDate, fKey);

  if (finisherExercises.length > 0) {
    wrap.appendChild(el(`<div class="finisher-heading">🏃 Cardio Finisher</div>`));
    const tabCursor = sharedTabCursor || makeTabCursor();
    const plan = buildRenderPlan(finisherExercises);
    plan.forEach((item) => {
      if (item.type === "solo") {
        const ex = item.ex;
        const entry = todayLog.entries?.[ex.id];
        const sets = entry?.sets || defaultSets(ex);
        const blockSize = sets.length * (ex.trackType === "weight" ? 2 : 1);
        wrap.appendChild(renderExerciseCard(ex, sets, tabCursor.next(blockSize), fKey));
      } else {
        wrap.appendChild(renderCircuitCard(item.exercises, item.groupId, tabCursor, todayLog, fKey));
      }
    });
  }

  const addBtn = el(`<button class="finisher-add-btn">🏃 + Add Cardio Finisher Exercise</button>`);
  addBtn.onclick = () => openAddExerciseModal(fKey);
  wrap.appendChild(addBtn);

  return wrap;
}

// Groups exercises sharing a groupId into one combined "circuit" render item,
// preserving first-appearance order; everything else renders solo as before.
function buildRenderPlan(dayExercises) {
  const plan = [];
  const seen = new Set();
  dayExercises.forEach((ex) => {
    if (seen.has(ex.id)) return;
    if (ex.groupId) {
      const members = dayExercises.filter((e) => e.groupId === ex.groupId);
      members.forEach((m) => seen.add(m.id));
      plan.push({ type: "circuit", groupId: ex.groupId, exercises: members });
    } else {
      seen.add(ex.id);
      plan.push({ type: "solo", ex });
    }
  });
  return plan;
}

// One combined card containing each member's full exercise card (name,
// plate-stack, sets, progression) — visually grouped and clearly labeled so
// you know to do them back-to-back, while every exercise still logs its own
// sets exactly as it does standalone. Supports any number of members, not
// just pairs.
function renderCircuitCard(members, groupId, tabCursor, todayLog, dayId) {
  const wrapper = el(`
    <div class="circuit-card">
      <div class="circuit-header">
        <span class="circuit-label">🔗 Circuit · ${members.length} exercises</span>
        <button class="circuit-ungroup-btn">Ungroup</button>
      </div>
    </div>
  `);
  members.forEach((ex) => {
    const entry = todayLog.entries?.[ex.id];
    const sets = entry?.sets || defaultSets(ex);
    const blockSize = sets.length * (ex.trackType === "weight" ? 2 : 1);
    wrapper.appendChild(renderExerciseCard(ex, sets, tabCursor.next(blockSize), dayId));
  });
  wrapper.querySelector(".circuit-ungroup-btn").onclick = () => ungroupCircuit(dayId, groupId);
  return wrapper;
}

function ungroupCircuit(listKey, groupId) {
  if (!confirm("Ungroup this circuit? The exercises stay — they just won't be linked together anymore.")) return;
  const date = state.selectedDate;
  const list = getExerciseList(date, listKey).map((e) =>
    e.groupId === groupId ? { ...e, groupId: undefined } : e
  );
  setExerciseList(date, listKey, list);
  render();
}

function generateGroupId() {
  return "grp_" + Math.random().toString(36).slice(2, 8);
}

function openGroupModal(dayId) {
  const date = state.selectedDate;
  const dayExercises = getExerciseList(date, dayId);
  const ungrouped = dayExercises.filter((e) => !e.groupId);
  if (ungrouped.length < 2) {
    alert("You need at least 2 ungrouped exercises on this day to make a circuit.");
    return;
  }

  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`
    <div class="modal">
      <h3>Group into Circuit</h3>
      <div class="field-hint" style="margin-bottom:14px;">Pick 2 or more exercises to do back-to-back as one circuit. Add more members later, or ungroup anytime — nothing is permanent.</div>
      <div id="group-check-list" class="check-grid one-col"></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="group-cancel-btn">Cancel</button>
        <button class="btn-primary" id="group-save-btn">Create Circuit</button>
      </div>
    </div>
  `);
  const list = modal.querySelector("#group-check-list");
  ungrouped.forEach((ex) => {
    list.appendChild(el(`
      <label class="check-item">
        <input type="checkbox" value="${ex.id}" />
        <span>${ex.name}</span>
      </label>
    `));
  });

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  modal.querySelector("#group-cancel-btn").onclick = () => document.body.removeChild(overlay);
  modal.querySelector("#group-save-btn").onclick = () => {
    const selected = [...list.querySelectorAll("input:checked")].map((c) => c.value);
    if (selected.length < 2) {
      alert("Pick at least 2 exercises.");
      return;
    }
    const groupId = generateGroupId();
    const updated = getExerciseList(date, dayId).map((e) =>
      selected.includes(e.id) ? { ...e, groupId } : e
    );
    setExerciseList(date, dayId, updated);
    document.body.removeChild(overlay);
    render();
  };

  document.body.appendChild(overlay);
  trapFocus(overlay);
}

function defaultSets(ex) {
  const n = exNumSets(ex);
  if (ex.trackType === "weight") return ex.weights.slice(0, n).map((w) => ({ weight: w, reps: null }));
  return Array.from({ length: n }, () => ({ weight: null, reps: null }));
}

// Hands out sequential tabindex blocks (one weight + one reps input per set,
// weight-tracked exercises only need the reps block for bodyweight/time) so
// Tab moves lbs → lbs → lbs → reps → reps → reps within a card, then on to
// the next card's lbs. Block size adapts to however many sets this exercise
// actually has.
function makeTabCursor() {
  let n = 1;
  return {
    next: (blockSize) => { const start = n; n += blockSize; return start; },
  };
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
      <div class="ex-card-actions">
        <button class="ex-move-up-btn" title="Move up">▲</button>
        <button class="ex-move-down-btn" title="Move down">▼</button>
        <button class="ex-edit-btn" title="Edit targets/weights">✎</button>
        <button class="ex-delete-btn" title="Remove exercise">✕</button>
      </div>
    </div>
  `);
  top.querySelector(".plate-stack").appendChild(buildPlates(sets, ex));
  top.querySelector(".ex-move-up-btn").onclick = () => moveExerciseInList(dayId, ex.id, -1);
  top.querySelector(".ex-move-down-btn").onclick = () => moveExerciseInList(dayId, ex.id, 1);
  top.querySelector(".ex-edit-btn").onclick = () => openEditExerciseModal(dayId, ex.id);
  top.querySelector(".ex-delete-btn").onclick = () => removeExerciseFromDay(dayId, ex.id);
  card.appendChild(top);

  const isWeighted = ex.trackType === "weight";
  const zoneTracked = isZoneTracked(ex);
  const n = sets.length;
  const setRow = el(`<div class="set-row"></div>`);
  sets.forEach((s, i) => {
    const topLabel = isWeighted ? "lbs" : zoneTracked ? `Zone ${i + 1}` : ex.customUnit ? ex.customUnit : unit === "sec" ? "hold" : unit === "min" ? "time" : "BW";
    const col = el(`
      <div class="set-col">
        ${isWeighted ? `<label>${topLabel}</label><input type="number" value="${s.weight}" tabindex="${tabStart + i}" />` : `<label>${topLabel}</label>`}
        <input type="number" placeholder="${unit}" value="${s.reps ?? ""}" class="${s.reps != null ? "has-reps" : ""}" tabindex="${isWeighted ? tabStart + n + i : tabStart + i}" />
        ${!isWeighted ? `<span class="set-unit-suffix">${unit}</span>` : ""}
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

// A zone-tracked exercise with a target of 0 for a given zone means "not
// planning to spend time here" — it shouldn't block the exercise from
// showing as topped out, or require a value to be entered at all.
function isSetSkippable(ex, i) {
  return isZoneTracked(ex) && targetForSet(ex, i) === 0;
}

function computeAllTopped(sets, ex) {
  return sets.every((s, i) => isSetSkippable(ex, i) || (s.reps != null && s.reps >= targetForSet(ex, i)));
}

function buildPlates(sets, ex) {
  const allTopped = computeAllTopped(sets, ex);
  const frag = document.createDocumentFragment();
  sets.forEach((s, i) => {
    const filled = s.reps != null;
    const skippable = isSetSkippable(ex, i);
    const isTop = skippable || (filled && s.reps >= targetForSet(ex, i));
    const flag = allTopped && i === sets.length - 1;
    const h = 34 + i * 5;
    const display = filled ? s.reps : skippable ? "–" : i + 1;
    frag.appendChild(el(`<div class="plate ${filled || skippable ? "filled" : ""} ${isTop ? "topped" : ""} ${flag ? "flag" : ""}" style="height:${h}px">${display}</div>`));
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
  } else if (ex.trackType === "duration") {
    bumpLabel = `+${DURATION_BUMP_MINUTES} min`;
  } else if (ex.trackType === "hr_zones") {
    bumpLabel = `+${ZONE_BUMP_MINUTES} min per zone`;
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
  pill.classList.toggle("done", dayLogHasRealData(logs[date]));
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// Clears logged data for exactly one date — nothing else. Exercise library
// and bank are never touched by this.
function clearSingleDay(date) {
  const dayLog = logs[date];
  if (!dayLogHasRealData(dayLog)) {
    alert("Nothing logged on this day yet.");
    return;
  }
  const dayInfo = DAYS.find((d) => d.id === dayLog.dayId);
  const ok = confirm(`Clear all logged data for ${fmtDate(date)} (${dayInfo ? dayInfo.label : "this day"})?\n\nOnly this one day is affected — nothing else is touched. This can't be undone.`);
  if (!ok) return;
  // Keep the Sunday Planner's pick for this date; only the logged data goes.
  const plan = logs[date].plan;
  delete logs[date];
  if (plan) logs[date] = { dayId: dayLog.dayId, entries: {}, plan };
  saveLogs(logs);
  render();
}

function moveExerciseInList(listKey, exId, direction) {
  const date = state.selectedDate;
  const list = [...getExerciseList(date, listKey)];
  const idx = list.findIndex((e) => e.id === exId);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= list.length) return;
  [list[idx], list[newIdx]] = [list[newIdx], list[idx]];
  setExerciseList(date, listKey, list);
  render();
}

function removeExerciseFromDay(dayId, exId) {
  const date = state.selectedDate;
  const ex = allExercises()[exId];
  const dayLabel = listLabel(dayId);
  const shared = isSharedList(dayId);
  const message = shared
    ? `Permanently remove ${ex ? ex.name : "this exercise"} from your ${dayLabel} routine — every ${dayLabel} day, past and future, not just today?\n\nSkipping a single day doesn't need this — just tag that date differently, or leave it unset. Past logged history for this exercise stays in History; the exercise itself stays in your bank if you want to re-add it later.`
    : `Remove ${ex ? ex.name : "this exercise"} from ${dayLabel} on ${fmtDate(date)}?\n\nThis only affects this one date — other ${dayLabel} days keep whatever exercises they already have. Past logged history stays in History; the exercise itself stays in your bank.`;
  const ok = confirm(message);
  if (!ok) return;

  const updated = getExerciseList(date, dayId).filter((e) => e.id !== exId);
  // A "circuit" of one doesn't mean anything — auto-ungroup any group left with a single member.
  if (ex && ex.groupId) {
    const remaining = updated.filter((e) => e.groupId === ex.groupId);
    if (remaining.length === 1) {
      const idx = updated.findIndex((e) => e.id === remaining[0].id);
      updated[idx] = { ...updated[idx], groupId: undefined };
    }
  }
  setExerciseList(date, dayId, updated);
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

  // Only actually persist an entry once there's real data (at least one
  // set with a value entered) — touching a weight box without ever logging
  // reps shouldn't leave a stray "logged" entry behind.
  if (entryHasData({ sets: newSets })) {
    logs[date].entries[exId] = { sets: newSets };
  } else {
    delete logs[date].entries[exId];
  }
  saveLogs(logs);

  if (field === "weight" && ex.trackType === "weight") {
    upsertBank({ name: ex.name, type: ex.type, trackType: ex.trackType, weights: newSets.map((s) => s.weight), targets: ex.targets, customUnit: ex.customUnit });
  }

  refreshExerciseCard(exId, newSets);
  refreshActiveDayPillDone();
}

function applyProgression(exId) {
  const date = state.selectedDate;

  // Search this date's own per-date lists first, then the shared library
  // (Upper/Lower), then fall back to legacy shared data for a non-shared
  // type that hasn't been materialized for this date yet — in that last
  // case, applying progression is itself the modification that splits this
  // date off into its own independent copy.
  const perDateLists = logs[date]?.lists || {};
  let listKey = Object.keys(perDateLists).find((k) => (perDateLists[k] || []).some((e) => e.id === exId));
  let source = listKey ? "perDate" : null;

  if (!listKey) {
    listKey = Object.keys(library).find((k) => isSharedList(k) && (library[k] || []).some((e) => e.id === exId));
    if (listKey) source = "shared";
  }
  if (!listKey) {
    listKey = Object.keys(library).find((k) => !isSharedList(k) && (library[k] || []).some((e) => e.id === exId));
    if (listKey) source = "legacy";
  }
  if (!listKey) return;

  const currentList = source === "shared" ? (library[listKey] || []) : getExerciseList(date, listKey);
  let updatedEx = null;
  const newList = currentList.map((e) => {
    if (e.id !== exId) return e;
    if (e.trackType === "weight") {
      const bump = PROGRESSION_BUMP[e.type] || PROGRESSION_BUMP.other;
      updatedEx = { ...e, weights: e.weights.map((w) => w + bump) };
    } else if (e.trackType === "time") {
      const targets = Array.from({ length: exNumSets(e) }, (_, i) => targetForSet(e, i) + TIME_BUMP_SECONDS);
      updatedEx = { ...e, targets };
    } else if (e.trackType === "duration") {
      const targets = Array.from({ length: exNumSets(e) }, (_, i) => targetForSet(e, i) + DURATION_BUMP_MINUTES);
      updatedEx = { ...e, targets };
    } else if (e.trackType === "hr_zones") {
      const targets = Array.from({ length: exNumSets(e) }, (_, i) => targetForSet(e, i) + ZONE_BUMP_MINUTES);
      updatedEx = { ...e, targets };
    } else {
      const targets = Array.from({ length: exNumSets(e) }, (_, i) => targetForSet(e, i) + BODYWEIGHT_REP_BUMP);
      updatedEx = { ...e, targets };
    }
    return updatedEx;
  });

  if (source === "shared") {
    library[listKey] = newList;
    saveLibrary(library);
  } else {
    setExerciseList(date, listKey, newList);
  }
  if (updatedEx) upsertBank(updatedEx);
  render();
}

// ---- History tab ----
function renderHistory() {
  const wrap = document.createElement("div");
  const dates = [...new Set([
    ...Object.keys(logs).filter((d) => dayLogHasRealData(logs[d])),
    ...runDatesWithData(),
  ])].sort().reverse();

  const exportBtn = el(`<button class="summary-btn" style="margin-bottom:14px;">⬇ Export CSV</button>`);
  exportBtn.onclick = openExportModal;
  wrap.appendChild(exportBtn);

  if (dates.length === 0) {
    wrap.appendChild(el(`<div class="empty-state">No sessions logged yet.</div>`));
    return wrap;
  }

  const exMap = allExercises();
  dates.forEach((date) => {
    const dayLog = dayLogHasRealData(logs[date]) ? logs[date] : { entries: {} };
    const dayInfo = DAYS.find((d) => d.id === dayLog.dayId);
    const runLine = runHistoryLine(date);
    const dayLabels = [dayInfo ? dayInfo.label : "", runLine ? "Run" : ""].filter(Boolean).join(" + ");
    const card = el(`
      <div class="hist-card">
        <div class="hist-card-top">
          <span class="date">${fmtDate(date)}</span>
          <span class="day">${dayLabels}</span>
        </div>
      </div>
    `);
    if (runLine) card.appendChild(el(runLine));
    Object.entries(dayLog.entries || {}).forEach(([exId, entry]) => {
      const ex = exMap[exId];
      if (!ex || !entryHasData(entry)) return;
      const unit = exUnitLabel(ex);
      const setStr = entry.sets.map((s, i) => {
        if (s.reps == null) return "–";
        const prefix = isZoneTracked(ex) ? `Z${i + 1}: ` : "";
        return ex.trackType === "weight" ? `${s.weight}×${s.reps}` : `${prefix}${s.reps}${unit === "sec" ? "s" : " " + unit}`;
      }).join(", ");
      const totalStr = isZoneTracked(ex)
        ? ` (Total: ${entry.sets.reduce((sum, s) => sum + (s.reps || 0), 0)} min)`
        : "";
      card.appendChild(el(`<div class="hist-line"><b>${ex.name}:</b> ${setStr}${totalStr}</div>`));
    });
    if (dayLog.note) {
      card.appendChild(el(`<div class="hist-line"><b>Notes:</b> ${dayLog.note}</div>`));
    }
    if (dayLog.finisherNote) {
      card.appendChild(el(`<div class="hist-line"><b>🏃 Cardio Finisher:</b> ${dayLog.finisherNote}</div>`));
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
  const dates = [...Object.keys(logs), ...runDatesWithData()].sort();
  const earliest = dates[0] || todayISO();
  const latest = dates[dates.length - 1] || todayISO();

  const modal = el(`
    <div class="modal">
      <h3>Export CSV</h3>
      <div class="form-row">
        <label>Date range</label>
        <div class="weights-row" id="exp-date-row"></div>
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

  let fromIso = earliest;
  let toIso = latest;
  const dateRow = modal.querySelector("#exp-date-row");
  function refreshDateButtons() {
    dateRow.innerHTML = "";
    dateRow.appendChild(renderDateButton(fromIso, (iso) => { fromIso = iso; refreshDateButtons(); }));
    dateRow.appendChild(renderDateButton(toIso, (iso) => { toIso = iso; refreshDateButtons(); }));
  }
  refreshDateButtons();

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
  dayChecks.appendChild(el(`
    <label class="check-item">
      <input type="checkbox" value="run" checked />
      <span>Runs</span>
    </label>
  `));

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  modal.querySelector("#exp-cancel-btn").onclick = () => document.body.removeChild(overlay);
  modal.querySelector("#exp-go-btn").onclick = () => {
    const from = fromIso || "0000-01-01";
    const to = toIso || "9999-12-31";
    const checkedDays = new Set(
      [...dayChecks.querySelectorAll("input:checked")].map((c) => c.value)
    );
    const exerciseId = modal.querySelector("#exp-exercise").value || null;

    const ok = exportCSV({ from, to, days: checkedDays, exerciseId });
    if (ok) document.body.removeChild(overlay);
  };

  document.body.appendChild(overlay);
  trapFocus(overlay);
}

// ---- CSV export ----
// Long-format: one row per exercise per day, matching the wide/columnar
// style of the existing spreadsheet so it drops straight into a pivot table.
// filters: { from, to, days: Set<dayId>, exerciseId } — all optional; called
// with no args exports everything.
function exportCSV(filters) {
  const f = filters || {};
  const exMap = allExercises();
  // Long format: one row per set. Handles any number of sets per exercise
  // without needing fixed Set1/2/3 columns.
  const rows = [["Date", "Day Type", "Exercise", "Tracking", "Set Number", "Weight(lbs)", "Value", "Notes"]];

  Object.keys(logs).sort().forEach((date) => {
    if (f.from && date < f.from) return;
    if (f.to && date > f.to) return;
    const dayLog = logs[date];
    if (f.days && !f.days.has(dayLog.dayId)) return;
    const dayLabel = DAYS.find((d) => d.id === dayLog.dayId)?.label || dayLog.dayId || "";
    const entries = dayLog.entries || {};

    Object.entries(entries).forEach(([exId, entry]) => {
      if (f.exerciseId && exId !== f.exerciseId) return;
      if (!entryHasData(entry)) return; // skip stray entries with nothing actually logged
      const ex = exMap[exId];
      const name = ex ? ex.name : exId;
      const trackType = ex ? ex.trackType : "";
      const sets = entry.sets || [];
      sets.forEach((s, i) => {
        rows.push([
          date,
          dayLabel,
          name,
          trackType,
          i + 1,
          trackType === "weight" ? (s.weight ?? "") : "",
          s.reps ?? "",
          "",
        ]);
      });
    });

    if (dayLog.note && !f.exerciseId) {
      rows.push([date, dayLabel, "", "cardio-note", "", "", "", dayLog.note]);
    }
    if (dayLog.finisherNote && !f.exerciseId) {
      rows.push([date, dayLabel, "", "finisher-note", "", "", "", dayLog.finisherNote]);
    }
  });

  if (!f.exerciseId && (!f.days || f.days.has("run"))) {
    rows.push(...runCsvRows(f.from, f.to));
    // Keep everything in date order (sort is stable, so same-day rows keep their order).
    const header = rows.shift();
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    rows.unshift(header);
  }

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
// logged before that, any log entries pointing at exercise IDs that no
// longer exist anywhere in the current library (leftover debris from the
// sync-race incident before v7), and any entries with no real data in them
// (e.g. a weight box touched without ever entering reps, left over from
// before updateSet started auto-cleaning those). Runs once automatically on
// load, guarded by a flag so it never runs again — no permanent button, no
// ongoing UI. Safe to leave in: if there's nothing to clean (e.g. on a
// second device after the first already cleaned the shared store), it's a
// silent no-op.
const CLEANUP_FLOOR_DATE = "2026-08-17";
const CLEANUP_FLAG_KEY = "iron-log-cleanup-v26-done";

function runOneTimeCleanupIfNeeded() {
  if (localStorage.getItem(CLEANUP_FLAG_KEY)) return;

  const exMap = allExercises();
  const datesToRemove = Object.keys(logs).filter((d) => d < CLEANUP_FLOOR_DATE);
  let orphanedCount = 0;
  let emptyCount = 0;

  Object.keys(logs).forEach((date) => {
    if (date < CLEANUP_FLOOR_DATE) return; // whole date already counted above
    const entries = logs[date].entries || {};
    Object.entries(entries).forEach(([exId, entry]) => {
      if (!exMap[exId]) orphanedCount++;
      else if (!entryHasData(entry)) emptyCount++;
    });
  });

  if (datesToRemove.length > 0 || orphanedCount > 0 || emptyCount > 0) {
    datesToRemove.forEach((d) => delete logs[d]);
    Object.keys(logs).forEach((date) => {
      const entries = logs[date].entries || {};
      Object.entries(entries).forEach(([exId, entry]) => {
        if (!exMap[exId] || !entryHasData(entry)) delete entries[exId];
      });
    });
    saveLogs(logs);
    console.log(`Iron Log: one-time cleanup removed ${datesToRemove.length} old day(s), ${orphanedCount} orphaned entr${orphanedCount === 1 ? "y" : "ies"}, and ${emptyCount} empty entr${emptyCount === 1 ? "y" : "ies"}.`);
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
  const zoneTracked = currentEx && isZoneTracked(currentEx);
  const metricLabel = currentEx && currentEx.customUnit ? currentEx.customUnit
    : currentEx && currentEx.trackType === "time" ? "sec held"
    : zoneTracked ? "total min (all zones)"
    : currentEx && currentEx.trackType === "duration" ? "min"
    : isWeighted ? "lbs" : "reps";

  const points = [];
  Object.entries(logs).sort(([a], [b]) => (a < b ? -1 : 1)).forEach(([date, dayLog]) => {
    const entry = dayLog.entries?.[state.progressExId];
    if (entry) {
      const completed = entry.sets.filter((s) => s.reps != null);
      if (completed.length > 0) {
        const value = isWeighted
          ? Math.max(...entry.sets.map((s) => s.weight || 0))
          : zoneTracked
          ? entry.sets.reduce((sum, s) => sum + (s.reps || 0), 0)
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
  const dayExercises = getExerciseList(date, dayId);
  const finisherExercises = getExerciseList(date, finisherKey(dayId));
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

  function appendExerciseRows(exercises) {
    let anyLogged = false;
    exercises.forEach((ex) => {
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
        const prefix = isZoneTracked(ex) ? `Z${i + 1}: ` : "";
        return `<span class="summary-set ${missing ? "missing" : ""}">${missing ? "not logged" : `${prefix}${weightPart}${s.reps} ${unit}`}</span>`;
      }).join(`<span class="summary-sep">·</span>`);
      const totalLine = isZoneTracked(ex)
        ? `<div class="summary-total">Total: ${sets.reduce((sum, s) => sum + (s.reps || 0), 0)} min</div>`
        : "";

      row.innerHTML = `
        <div class="summary-row-top">
          <span class="summary-ex-name">${ex.name}</span>
          <span class="summary-status">${allTopped ? "✓ topped out" : hasAnyValue ? "" : "⚠ not started"}</span>
        </div>
        <div class="summary-sets">${line}</div>
        ${totalLine}
      `;
      list.appendChild(row);
    });
    return anyLogged;
  }

  if (dayExercises.length === 0 && finisherExercises.length === 0) {
    list.appendChild(el(`<div class="empty-state">No exercises set up for ${dayLabel} yet.</div>`));
  } else {
    const anyLoggedPrimary = appendExerciseRows(dayExercises);
    let anyLoggedFinisher = false;
    if (finisherExercises.length > 0) {
      list.appendChild(el(`<div class="finisher-heading" style="margin-top:6px;">🏃 Cardio Finisher</div>`));
      anyLoggedFinisher = appendExerciseRows(finisherExercises);
    }
    if (!anyLoggedPrimary && !anyLoggedFinisher) {
      list.appendChild(el(`<div class="field-hint" style="margin-top:10px;">Nothing logged yet today for ${dayLabel}.</div>`));
    }
  }

  if (todayLog.note) {
    list.appendChild(el(`<div class="summary-row"><div class="summary-row-top"><span class="summary-ex-name">Notes</span></div><div class="summary-sets">${todayLog.note}</div></div>`));
  }
  if (todayLog.finisherNote) {
    list.appendChild(el(`<div class="summary-row"><div class="summary-row-top"><span class="summary-ex-name">🏃 Cardio Finisher Notes</span></div><div class="summary-sets">${todayLog.finisherNote || "(no notes added)"}</div></div>`));
  }

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  modal.querySelector("#summary-close-btn").onclick = () => document.body.removeChild(overlay);
  document.body.appendChild(overlay);
  trapFocus(overlay);
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
    const date = state.selectedDate;
    let added = 0, updated = 0, skipped = 0;

    items.forEach((item) => {
      const name = (item.name || "").trim();
      const day = item.day;
      const type = ["upper", "lower", "other"].includes(item.type) ? item.type : "other";
      const trackType = ["weight", "bodyweight", "time", "duration", "hr_zones"].includes(item.trackType) ? item.trackType : "weight";
      const weights = Array.isArray(item.weights) && item.weights.length >= 1
        ? item.weights.map((w) => Number(w) || 0)
        : [20, 20, 20];
      const numSets = Array.isArray(item.targets) && item.targets.length >= 1
        ? item.targets.length
        : weights.length;
      const targets = Array.isArray(item.targets) && item.targets.length >= 1
        ? item.targets.map((t) => Number(t) || 0)
        : defaultTargets(trackType, numSets);
      const customUnit = item.customUnit || null;

      if (!name || !validDays.has(day)) { skipped++; return; }

      const currentList = getExerciseList(date, day);
      const existingIdx = currentList.findIndex((e) => bankKey(e.name) === bankKey(name));
      let newList;
      if (existingIdx !== -1) {
        newList = currentList.map((e, i) => i === existingIdx ? { ...e, weights, type, trackType, targets, numSets, customUnit } : e);
        updated++;
      } else {
        newList = [...currentList, { id: slugify(name), name, type, trackType, numSets, weights, targets, customUnit }];
        added++;
      }
      setExerciseList(date, day, newList);
      upsertBank({ name, type, trackType, weights, targets, customUnit });
    });

    resultBox.textContent = `Added ${added}, updated ${updated}${skipped ? `, skipped ${skipped} (missing name or invalid day)` : ""}.`;
    resultBox.className = "import-result success";
    render();
    setTimeout(() => { if (document.body.contains(overlay)) document.body.removeChild(overlay); }, 1400);
  };

  document.body.appendChild(overlay);
  trapFocus(overlay);
  textarea.focus();
}

// ---- Add Exercise modal ----
// Shared helpers for the dynamic "N sets" weight/target input rows used by
// both Add and Edit exercise modals.
function setNumberRow(container, count, values, labelFn) {
  container.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const val = values && values[i] != null ? values[i] : "";
    const input = document.createElement("input");
    input.type = "number";
    input.placeholder = labelFn ? labelFn(i) : `Set ${i + 1}`;
    input.value = val;
    container.appendChild(input);
  }
}
function readNumberRow(container) {
  return Array.from(container.querySelectorAll("input")).map((i) => Number(i.value) || 0);
}
// Safety net so weights/targets always match numSets exactly at save time,
// regardless of whether the rebuild-on-input handler had a chance to fire —
// pads by repeating the last value, or truncates if there are extras.
function padToLength(arr, n, fallback) {
  const result = arr.slice(0, n);
  while (result.length < n) {
    result.push(result.length ? result[result.length - 1] : fallback);
  }
  return result;
}

// ---- Bank Manager modal ----
// Prunes the exercise bank (the "From your bank" quick-pick list) directly.
// Deleting here never touches exercises already placed on any day, or any
// logged history — it only removes the reuse shortcut.
function openBankManagerModal(onClose) {
  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`
    <div class="modal">
      <h3>Manage Exercise Bank</h3>
      <div class="field-hint" style="margin-bottom:14px;">Removing something here only affects this quick-pick list — it won't touch exercises already placed on any day, or any logged history.</div>
      <div class="modal-actions" style="margin-bottom:16px;">
        <button class="btn-secondary" id="bank-export-btn" style="flex:1">⬇ Export Backup</button>
        <button class="btn-secondary" id="bank-import-btn" style="flex:1">⬆ Restore Backup</button>
      </div>
      <input type="file" id="bank-import-file" accept="application/json" style="display:none" />
      <div id="bank-manager-list"></div>
      <div class="modal-actions">
        <button class="btn-primary" id="bank-manager-close-btn" style="flex:1">Done</button>
      </div>
    </div>
  `);
  const list = modal.querySelector("#bank-manager-list");

  function renderList() {
    list.innerHTML = "";
    const entries = Object.entries(bank).sort((a, b) => a[1].name.localeCompare(b[1].name));
    if (entries.length === 0) {
      list.appendChild(el(`<div class="empty-state">Bank is empty.</div>`));
      return;
    }
    entries.forEach(([key, entry]) => {
      const row = el(`
        <div class="bank-row">
          <div>
            <div class="bank-row-name">${entry.name}</div>
            <div class="bank-row-meta">${TRACK_TYPES[entry.trackType]?.label || entry.trackType}</div>
          </div>
          <button class="bank-row-delete-btn" title="Remove from bank">✕</button>
        </div>
      `);
      row.querySelector(".bank-row-delete-btn").onclick = () => {
        if (!confirm(`Remove "${entry.name}" from your bank?\n\nIt stays untouched on any day it's currently placed on, and in logged history — this only removes it from the quick-pick list.`)) return;
        delete bank[key];
        saveBank(bank);
        renderList();
      };
      list.appendChild(row);
    });
  }
  renderList();

  modal.querySelector("#bank-export-btn").onclick = () => {
    const entryCount = Object.keys(bank).length;
    if (entryCount === 0) {
      alert("Bank is empty — nothing to back up yet.");
      return;
    }
    const data = JSON.stringify(bank, null, 2);
    downloadFile(data, `bank-backup-${todayISO()}.json`, "application/json");
  };

  const fileInput = modal.querySelector("#bank-import-file");
  modal.querySelector("#bank-import-btn").onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        alert("That file doesn't look like a valid backup — couldn't parse it as JSON.");
        return;
      }
      let added = 0, updated = 0, skipped = 0;
      Object.values(parsed).forEach((entry) => {
        if (!entry || !entry.name) { skipped++; return; }
        const key = bankKey(entry.name);
        if (bank[key]) updated++; else added++;
        bank[key] = {
          name: entry.name,
          type: entry.type || "other",
          trackType: entry.trackType || "weight",
          weights: Array.isArray(entry.weights) ? entry.weights : [20, 20, 20],
          targets: Array.isArray(entry.targets) ? entry.targets : null,
        };
      });
      saveBank(bank);
      renderList();
      alert(`Restored: ${added} added, ${updated} updated${skipped ? `, ${skipped} skipped (missing name)` : ""}.`);
    };
    reader.readAsText(file);
    fileInput.value = "";
  };

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) { document.body.removeChild(overlay); if (onClose) onClose(); } };
  modal.querySelector("#bank-manager-close-btn").onclick = () => {
    document.body.removeChild(overlay);
    if (onClose) onClose();
  };

  document.body.appendChild(overlay);
  trapFocus(overlay);
}

function openAddExerciseModal(explicitListKey) {
  const overlay = el(`<div class="modal-overlay"></div>`);
  const bankEntries = Object.values(bank).sort((a, b) => a.name.localeCompare(b.name));
  const modal = el(`
    <div class="modal">
      <h3>${explicitListKey ? "Add Cardio Finisher Exercise" : "Add Exercise"}</h3>
      <div class="form-row">
        <label>From your bank</label>
        <select id="ex-bank">
          <option value="">+ New exercise</option>
          ${bankEntries.map((b) => `<option value="${bankKey(b.name)}">${b.name}</option>`).join("")}
        </select>
        <button type="button" class="manage-bank-link" id="manage-bank-btn">🗑 Manage bank</button>
      </div>
      <div class="form-row">
        <label>Exercise name</label>
        <input type="text" id="ex-name" placeholder="e.g. Cable Woodchop" />
      </div>
      <div class="form-row" id="ex-day-row" ${explicitListKey ? 'style="display:none"' : ""}>
        <label>Day</label>
        <select id="ex-day"></select>
      </div>
      <div class="form-row">
        <label>How is this tracked?</label>
        <select id="ex-track">
          <option value="weight">Weight + Reps</option>
          <option value="bodyweight">Bodyweight (reps only)</option>
          <option value="time">Time held (seconds)</option>
          <option value="duration">Duration (minutes)</option>
          <option value="hr_zones">Heart Rate Zones (Z1–Z4 minutes)</option>
        </select>
      </div>
      <div class="form-row">
        <label>Number of sets</label>
        <input type="number" id="ex-num-sets" min="1" value="3" style="width:80px" />
      </div>
      <div class="form-row" id="ex-custom-unit-row">
        <label>Custom unit label (optional)</label>
        <input type="text" id="ex-custom-unit" placeholder="e.g. laps, rounds — leave blank for default" />
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
          <div class="weights-row" id="ex-weights-row"></div>
        </div>
      </div>
      <div class="form-row">
        <label id="ex-targets-label">Target reps per set</label>
        <div class="weights-row" id="ex-targets-row"></div>
        <div class="field-hint">Set these however fits — equal, ascending, or a lighter last set. Nothing is assumed.</div>
        <div class="zone-total" id="ex-zone-total" style="display:none"></div>
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
  const numSetsInput = modal.querySelector("#ex-num-sets");
  const weightsRow = modal.querySelector("#ex-weights-row");
  const targetsRow = modal.querySelector("#ex-targets-row");
  const targetsLabel = modal.querySelector("#ex-targets-label");
  const bankSelect = modal.querySelector("#ex-bank");
  const trackSelect = modal.querySelector("#ex-track");
  const weightFields = modal.querySelector("#ex-weight-fields");
  const customUnitRow = modal.querySelector("#ex-custom-unit-row");
  const customUnitInput = modal.querySelector("#ex-custom-unit");

  const zoneTotalEl = modal.querySelector("#ex-zone-total");

  function refreshBankOptions() {
    const current = bankSelect.value;
    const entries = Object.values(bank).sort((a, b) => a.name.localeCompare(b.name));
    bankSelect.innerHTML = `<option value="">+ New exercise</option>` +
      entries.map((b) => `<option value="${bankKey(b.name)}">${b.name}</option>`).join("");
    bankSelect.value = entries.some((b) => bankKey(b.name) === current) ? current : "";
  }
  modal.querySelector("#manage-bank-btn").onclick = () => openBankManagerModal(refreshBankOptions);

  function updateZoneTotal() {
    if (trackSelect.value !== "hr_zones") {
      zoneTotalEl.style.display = "none";
      return;
    }
    const total = readNumberRow(targetsRow).reduce((sum, v) => sum + v, 0);
    zoneTotalEl.textContent = `Total planned: ${total} min`;
    zoneTotalEl.style.display = "block";
  }
  targetsRow.addEventListener("input", updateZoneTotal);

  function updateFieldVisibility() {
    const t = trackSelect.value;
    weightFields.style.display = t === "weight" ? "" : "none";
    customUnitRow.style.display = t === "hr_zones" ? "none" : "";
    targetsLabel.textContent = t === "time" ? "Target hold time per set (seconds)"
      : t === "duration" ? "Target duration per set (minutes)"
      : t === "hr_zones" ? "Target minutes per zone"
      : "Target reps per set";
    numSetsInput.disabled = t === "hr_zones";
    updateZoneTotal();
  }

  function labelFnFor(trackType) {
    return trackType === "hr_zones" ? (i) => `Zone ${i + 1}` : (i) => `Set ${i + 1}`;
  }

  function rebuildRows(count, weightVals, targetVals) {
    setNumberRow(weightsRow, count, weightVals, labelFnFor(trackSelect.value));
    setNumberRow(targetsRow, count, targetVals, labelFnFor(trackSelect.value));
    updateZoneTotal();
  }

  numSetsInput.oninput = () => {
    const n = Math.max(1, Number(numSetsInput.value) || 1);
    const prevW = readNumberRow(weightsRow);
    const prevT = readNumberRow(targetsRow);
    const lastW = prevW.length ? prevW[prevW.length - 1] : 20;
    const lastT = prevT.length ? prevT[prevT.length - 1] : (trackSelect.value === "time" ? 30 : trackSelect.value === "duration" ? 20 : 10);
    rebuildRows(
      n,
      Array.from({ length: n }, (_, i) => (prevW[i] != null ? prevW[i] : lastW)),
      Array.from({ length: n }, (_, i) => (prevT[i] != null ? prevT[i] : lastT))
    );
  };
  trackSelect.onchange = () => {
    updateFieldVisibility();
    const n = trackSelect.value === "hr_zones" ? 4 : Math.max(1, Number(numSetsInput.value) || 3);
    numSetsInput.value = n;
    setNumberRow(targetsRow, n, defaultTargets(trackSelect.value, n), labelFnFor(trackSelect.value));
    updateZoneTotal();
  };

  updateFieldVisibility();
  rebuildRows(3, [20, 20, 20], defaultTargets("weight", 3));

  bankSelect.onchange = () => {
    const key = bankSelect.value;
    if (!key) return; // "+ New exercise" — leave fields as-is for a fresh entry
    const entry = bank[key];
    if (!entry) return;
    nameInput.value = entry.name;
    typeSelect.value = entry.type;
    trackSelect.value = entry.trackType || "weight";
    customUnitInput.value = entry.customUnit || "";
    updateFieldVisibility();
    const n = entry.trackType === "hr_zones" ? 4 : (entry.targets && entry.targets.length) || (entry.weights && entry.weights.length) || 3;
    numSetsInput.value = n;
    rebuildRows(n, entry.weights || Array(n).fill(20), entry.targets || defaultTargets(entry.trackType || "weight", n));
  };

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  modal.querySelector("#cancel-btn").onclick = () => document.body.removeChild(overlay);
  modal.querySelector("#save-btn").onclick = () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const dayId = explicitListKey || modal.querySelector("#ex-day").value;
    const trackType = trackSelect.value;
    const type = typeSelect.value;
    const numSets = Math.max(1, Number(numSetsInput.value) || 1);
    const weights = padToLength(readNumberRow(weightsRow), numSets, 20);
    // A 0-minute zone target is valid — it just means "not planning to spend
    // time here." Only non-zone types need a hard floor of 1.
    const targetFallback = trackType === "time" ? 30 : (trackType === "duration" || trackType === "hr_zones") ? 20 : 10;
    const targets = padToLength(readNumberRow(targetsRow), numSets, targetFallback)
      .map((t) => (trackType === "hr_zones" ? Math.max(t, 0) : Math.max(t, 1)));
    const customUnit = trackType === "hr_zones" ? null : (customUnitInput.value.trim() || null);

    const newEx = { id: slugify(name), name, type, trackType, numSets, weights, targets, customUnit };
    const date = state.selectedDate;
    setExerciseList(date, dayId, [...getExerciseList(date, dayId), newEx]);
    upsertBank(newEx);

    if (!explicitListKey) state.selectedDayId = dayId;
    document.body.removeChild(overlay);
    render();
  };

  document.body.appendChild(overlay);
  trapFocus(overlay);
  nameInput.focus();
}

// ---- Edit Exercise modal ----
// Lets you adjust an existing exercise's name, weights, and per-set targets
// in place — same fields as Add Exercise, minus the bank picker and day
// (day stays fixed; delete + re-add if you want it under a different day).
function openEditExerciseModal(dayId, exId) {
  const date = state.selectedDate;
  const ex = getExerciseList(date, dayId).find((e) => e.id === exId);
  if (!ex) return;

  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`
    <div class="modal">
      <h3>Edit ${ex.name}</h3>
      <div class="form-row">
        <label>Exercise name</label>
        <input type="text" id="edit-name" value="${ex.name}" />
      </div>
      <div class="form-row">
        <label>How is this tracked?</label>
        <select id="edit-track">
          <option value="weight">Weight + Reps</option>
          <option value="bodyweight">Bodyweight (reps only)</option>
          <option value="time">Time held (seconds)</option>
          <option value="duration">Duration (minutes)</option>
          <option value="hr_zones">Heart Rate Zones (Z1–Z4 minutes)</option>
        </select>
      </div>
      <div class="form-row">
        <label>Number of sets</label>
        <input type="number" id="edit-num-sets" min="1" style="width:80px" />
      </div>
      <div class="form-row" id="edit-custom-unit-row">
        <label>Custom unit label (optional)</label>
        <input type="text" id="edit-custom-unit" placeholder="e.g. laps, rounds — leave blank for default" />
      </div>
      <div id="edit-weight-fields">
        <div class="form-row">
          <label>Progression type</label>
          <select id="edit-type">
            <option value="upper">Upper body (+5 lbs)</option>
            <option value="lower">Lower body (+10 lbs)</option>
            <option value="other">Other (+5 lbs)</option>
          </select>
        </div>
        <div class="form-row">
          <label>Current weight per set (lbs)</label>
          <div class="weights-row" id="edit-weights-row"></div>
        </div>
      </div>
      <div class="form-row">
        <label id="edit-targets-label">Target reps per set</label>
        <div class="weights-row" id="edit-targets-row"></div>
        <div class="field-hint">Set these however fits — equal, ascending, or a lighter last set. Nothing is assumed.</div>
        <div class="zone-total" id="edit-zone-total" style="display:none"></div>
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="edit-cancel-btn">Cancel</button>
        <button class="btn-primary" id="edit-save-btn">Save changes</button>
      </div>
    </div>
  `);

  const nameInput = modal.querySelector("#edit-name");
  const trackSelect = modal.querySelector("#edit-track");
  const typeSelect = modal.querySelector("#edit-type");
  const numSetsInput = modal.querySelector("#edit-num-sets");
  const weightFields = modal.querySelector("#edit-weight-fields");
  const targetsLabel = modal.querySelector("#edit-targets-label");
  const weightsRow = modal.querySelector("#edit-weights-row");
  const targetsRow = modal.querySelector("#edit-targets-row");
  const zoneTotalEl = modal.querySelector("#edit-zone-total");
  const customUnitRow = modal.querySelector("#edit-custom-unit-row");
  const customUnitInput = modal.querySelector("#edit-custom-unit");

  function labelFnFor(trackType) {
    return trackType === "hr_zones" ? (i) => `Zone ${i + 1}` : (i) => `Set ${i + 1}`;
  }

  function updateZoneTotal() {
    if (trackSelect.value !== "hr_zones") {
      zoneTotalEl.style.display = "none";
      return;
    }
    const total = readNumberRow(targetsRow).reduce((sum, v) => sum + v, 0);
    zoneTotalEl.textContent = `Total planned: ${total} min`;
    zoneTotalEl.style.display = "block";
  }
  targetsRow.addEventListener("input", updateZoneTotal);

  trackSelect.value = ex.trackType || "weight";
  typeSelect.value = ex.type || "other";
  customUnitInput.value = ex.customUnit || "";
  const n0 = exNumSets(ex);
  numSetsInput.value = n0;
  const w0 = ex.weights && ex.weights.length ? ex.weights : Array(n0).fill(20);
  setNumberRow(weightsRow, n0, w0, labelFnFor(trackSelect.value));
  setNumberRow(targetsRow, n0, Array.from({ length: n0 }, (_, i) => targetForSet(ex, i)), labelFnFor(trackSelect.value));

  function updateFieldVisibility() {
    const t = trackSelect.value;
    weightFields.style.display = t === "weight" ? "" : "none";
    customUnitRow.style.display = t === "hr_zones" ? "none" : "";
    targetsLabel.textContent = t === "time" ? "Target hold time per set (seconds)"
      : t === "duration" ? "Target duration per set (minutes)"
      : t === "hr_zones" ? "Target minutes per zone"
      : "Target reps per set";
    numSetsInput.disabled = t === "hr_zones";
    updateZoneTotal();
  }
  trackSelect.onchange = () => {
    updateFieldVisibility();
    if (trackSelect.value === "hr_zones") {
      numSetsInput.value = 4;
      setNumberRow(targetsRow, 4, defaultTargets("hr_zones", 4), labelFnFor("hr_zones"));
      setNumberRow(weightsRow, 4, Array(4).fill(20), labelFnFor("hr_zones"));
      updateZoneTotal();
    }
  };
  updateFieldVisibility();

  numSetsInput.oninput = () => {
    const n = Math.max(1, Number(numSetsInput.value) || 1);
    const prevW = readNumberRow(weightsRow);
    const prevT = readNumberRow(targetsRow);
    const lastW = prevW.length ? prevW[prevW.length - 1] : 20;
    const lastT = prevT.length ? prevT[prevT.length - 1] : (trackSelect.value === "time" ? 30 : trackSelect.value === "duration" ? 20 : 10);
    setNumberRow(weightsRow, n, Array.from({ length: n }, (_, i) => (prevW[i] != null ? prevW[i] : lastW)), labelFnFor(trackSelect.value));
    setNumberRow(targetsRow, n, Array.from({ length: n }, (_, i) => (prevT[i] != null ? prevT[i] : lastT)), labelFnFor(trackSelect.value));
  };

  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) document.body.removeChild(overlay); };
  modal.querySelector("#edit-cancel-btn").onclick = () => document.body.removeChild(overlay);
  modal.querySelector("#edit-save-btn").onclick = () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    const trackType = trackSelect.value;
    const type = typeSelect.value;
    const numSets = Math.max(1, Number(numSetsInput.value) || 1);
    const weights = padToLength(readNumberRow(weightsRow), numSets, 20);
    // A 0-minute zone target is valid — it just means "not planning to spend
    // time here." Only non-zone types need a hard floor of 1.
    const targetFallback = trackType === "time" ? 30 : (trackType === "duration" || trackType === "hr_zones") ? 20 : 10;
    const targets = padToLength(readNumberRow(targetsRow), numSets, targetFallback)
      .map((t) => (trackType === "hr_zones" ? Math.max(t, 0) : Math.max(t, 1)));
    const customUnit = trackType === "hr_zones" ? null : (customUnitInput.value.trim() || null);
    const updatedEx = { ...ex, name, trackType, type, numSets, weights, targets, customUnit };

    if (isSharedList(dayId)) {
      Object.assign(ex, updatedEx);
      saveLibrary(library);
    } else {
      const newList = getExerciseList(date, dayId).map((e) => (e.id === exId ? updatedEx : e));
      setExerciseList(date, dayId, newList);
    }
    upsertBank(updatedEx);

    document.body.removeChild(overlay);
    render();
  };

  document.body.appendChild(overlay);
  trapFocus(overlay);
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
