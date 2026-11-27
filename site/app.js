// ---------- Data ----------
const APP_VERSION = "v77";
// Day "type" is now something you assign per date from the Log tab,
// not a fixed weekly rotation. Every loggable day works identically — its
// own exercise list, bank-integrated add/edit, circuits, and an optional
// finisher list. Rest is the only exception (no logging needed).
const LS_DAY_DESIGNATIONS = "iron-log-day-designations";
const DEFAULT_DAY_DESIGNATIONS = [
  { id:"upper", label:"Upper Lift", loggable:true, primaryValue:"upper" },
  { id:"lower", label:"Lower Lift", loggable:true, primaryValue:"lower" },
  { id:"core", label:"Core", loggable:true, primaryValue:"core" },
  { id:"mobility", label:"Mobility", loggable:true, primaryValue:"mob" },
  { id:"pilates", label:"Pilates", loggable:true, primaryValue:"pilates" },
  { id:"cardio", label:"Cardio", loggable:true, primaryValue:"cardio" },
  { id:"rest", label:"Rest", loggable:false, primaryValue:"rest" },
  { id:"mindful-recovery", label:"Mindful Recovery Day", loggable:true, primaryValue:"mindful-recovery" },
];
function normalizeDayDesignations(input) {
  const retiredDayTypes = new Set(["upper-b", "lower-b"]);
  const saved = Array.isArray(input) ? input.filter(d => d && d.id && d.label && !retiredDayTypes.has(d.id)) : [];
  const byId = new Map(saved.map(d => [d.id, { ...d }]));
  DEFAULT_DAY_DESIGNATIONS.forEach(defaultDay => {
    if (!byId.has(defaultDay.id)) byId.set(defaultDay.id, { ...defaultDay });
    else byId.set(defaultDay.id, { ...defaultDay, ...byId.get(defaultDay.id), id:defaultDay.id });
  });
  return [...byId.values()].map(d => {
    let label = String(d.label).trim();
    // Return only the generated Version 70 labels to their pre-block defaults.
    if (d.id === "upper" && label === "Upper A") label = "Upper Lift";
    if (d.id === "lower" && label === "Lower A") label = "Lower Lift";
    return { ...d, label, loggable:d.loggable !== false };
  });
}
function mergeDayDesignationLists(remoteList, localList, preferLocal) {
  const merged = new Map();
  (Array.isArray(remoteList) ? remoteList : []).forEach(d => { if (d?.id) merged.set(d.id, d); });
  (Array.isArray(localList) ? localList : []).forEach(d => { if (d?.id && (preferLocal || !merged.has(d.id))) merged.set(d.id, d); });
  return normalizeDayDesignations([...merged.values()]);
}
function loadDayDesignations() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_DAY_DESIGNATIONS) || "null");
    const normalized = normalizeDayDesignations(raw);
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) localStorage.setItem(LS_DAY_DESIGNATIONS, JSON.stringify(normalized));
    return normalized;
  }
  catch { return normalizeDayDesignations(null); }
}
let dayDesignations = loadDayDesignations();
const DAYS = [];
function refreshDayDefinitions() {
  DAYS.splice(0, DAYS.length, ...dayDesignations.map(d => ({
    id:d.id, label:d.label, short:d.short || d.label.replace(/\s+Day$/i, "").slice(0, 8).toUpperCase(),
    loggable:d.loggable !== false, primaryValue:d.primaryValue || d.id,
  })));
}
refreshDayDefinitions();
function exerciseDays() { return DAYS.filter(d => d.loggable); }
function dayDesignationLabel(id) { return dayDesignations.find(d => d.id === id)?.label || id || "Unassigned"; }
function saveDayDesignations() {
  dayDesignations = normalizeDayDesignations(dayDesignations);
  refreshDayDefinitions();
  localStorage.setItem(LS_DAY_DESIGNATIONS, JSON.stringify(dayDesignations));
  touchLocalUpdatedAt();
  schedulePush();
}

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

// Legacy classification retained for older progression paths. Version 69
// stores reusable routine templates for every loggable day type and finisher.
// Reads/writes the correct exercise list for a given date + list key,
// transparently routing shared types (Upper/Lower) to the library and
// everything else to that specific date's own storage.
function getExerciseList(date, listKey) {
  const dayLog = logs[date];
  const perDate = dayLog?.lists?.[listKey];
  // A date-specific override is used only when the user explicitly chooses
  // "this workout only", or when an already-started workout is frozen.
  if (dayLog?.routineOverrides?.[listKey] && Array.isArray(perDate)) return perDate;
  if (Array.isArray(library[listKey])) return library[listKey];
  return Array.isArray(perDate) ? perDate : [];
}
function setExerciseList(date, listKey, list, scope = (state?.editScope || "routine")) {
  if (!logs[date]) logs[date] = { dayId: listKey.replace(/_finisher$/, ""), entries: {} };
  const dayLog = logs[date];
  if (scope === "today") {
    dayLog.lists ||= {};
    dayLog.routineOverrides ||= {};
    dayLog.lists[listKey] = list;
    dayLog.routineOverrides[listKey] = true;
    saveLogs(logs);
    return;
  }
  // Preserve historical exercise definitions before changing a shared
  // routine. This matters for dates whose old Upper/Lower lists were shared
  // rather than copied into the dated log.
  const baseDayId = listKey.replace(/_finisher$/, "");
  for (const [loggedDate, historicalDay] of Object.entries(logs)) {
    if (historicalDay?.dayId !== baseDayId || !dayLogHasRealData(historicalDay, loggedDate)) continue;
    preserveCompletedExerciseDetails(loggedDate);
    if (!historicalDay.routineOverrides?.[listKey]) {
      historicalDay.lists ||= {};
      historicalDay.routineOverrides ||= {};
      historicalDay.lists[listKey] = getExerciseList(loggedDate, listKey).map(e => ({...e}));
      historicalDay.routineOverrides[listKey] = true;
    }
  }
  // If this workout has already been logged, preserve the exact list it
  // started with. The revised template applies to future workouts.
  if (dayLogHasRealData(dayLog, date)) {
    state.routineNotice = "Saved routine updated for future workouts. This workout keeps the version it started with.";
  }
  if (dayLogHasRealData(dayLog, date) && !dayLog.routineOverrides?.[listKey]) {
    dayLog.lists ||= {};
    dayLog.routineOverrides ||= {};
    dayLog.lists[listKey] = getExerciseList(date, listKey).map(e => ({...e}));
    dayLog.routineOverrides[listKey] = true;
  } else if (!dayLogHasRealData(dayLog, date) && dayLog.routineOverrides) {
    delete dayLog.routineOverrides[listKey];
    if (dayLog.lists) delete dayLog.lists[listKey];
  }
  library[listKey] = list;
  saveLibrary(library);
  saveLogs(logs);
}

// Upgrade legacy date-specific exercise lists into reusable routine templates.
// Completed historical dates remain frozen as snapshots; unstarted dates use
// the reusable template so future workouts inherit the saved order.
function migrateRoutineTemplates() {
  const keys = new Set([...DAYS.filter(d => d.loggable).map(d => d.id), ...DAYS.filter(d => d.loggable).map(d => finisherKey(d.id)), ...Object.keys(library)]);
  let libraryChanged = false, logsChanged = false;
  for (const key of keys) {
    if (Array.isArray(library[key]) && library[key].length) continue;
    const candidates = Object.entries(logs).filter(([, day]) => Array.isArray(day?.lists?.[key]) && day.lists[key].length).sort((a,b) => a[0].localeCompare(b[0]));
    if (candidates.length) {
      // Latest known configuration is the best available starting template.
      library[key] = candidates[candidates.length - 1][1].lists[key]
        .filter(e => !String(e?.id || "").startsWith("v70-"))
        .map(e => ({...e}));
      libraryChanged = true;
    }
  }
  for (const [date, day] of Object.entries(logs)) {
    for (const [key, list] of Object.entries(day.lists || {})) {
      if (!Array.isArray(list) || !list.length) continue;
      if (dayLogHasRealData(day, date)) {
        day.routineOverrides ||= {};
        if (!day.routineOverrides[key]) { day.routineOverrides[key] = true; logsChanged = true; }
      }
    }
  }
  if (libraryChanged) saveLibrary(library);
  if (logsChanged) saveLogs(logs);
  return libraryChanged || logsChanged;
}

// Strength routine keys are initialized here. Other day-type and finisher
// templates are added to this same library as the user creates them.
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
const LS_LIBRARY_UPDATED_AT = "iron-log-library-updated-at";
const LS_LOGS = "iron-log-logs";
const LS_BANK = "iron-log-bank";
const LS_BANK_UPDATED_AT = "iron-log-bank-updated-at";
const LS_LOCAL_UPDATED_AT = "iron-log-local-updated-at";
let libraryUpdatedAt = Number(localStorage.getItem(LS_LIBRARY_UPDATED_AT) || 0);
let bankUpdatedAt = Number(localStorage.getItem(LS_BANK_UPDATED_AT) || 0);

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
  libraryUpdatedAt = Math.max(Date.now(), libraryUpdatedAt + 1);
  localStorage.setItem(LS_LIBRARY_UPDATED_AT, String(libraryUpdatedAt));
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
  bankUpdatedAt = Math.max(Date.now(), bankUpdatedAt + 1);
  localStorage.setItem(LS_BANK_UPDATED_AT, String(bankUpdatedAt));
  localStorage.setItem(LS_BANK, JSON.stringify(bank));
  touchLocalUpdatedAt();
  schedulePush();
}
function chooseBankSnapshot(remoteBank, localBank, remoteRevision, localRevision, preferLocalOnTie) {
  const remoteVersion = Number(remoteRevision) || 0;
  const localVersion = Number(localRevision) || 0;
  const remote = remoteBank || {};
  const local = localBank || {};
  if (remoteVersion && localVersion) {
    if (localVersion > remoteVersion || (localVersion === remoteVersion && preferLocalOnTie)) return { bank:{...local}, revision:localVersion };
    return { bank:{...remote}, revision:remoteVersion };
  }
  if (remoteVersion && !localVersion) return { bank:{...remote}, revision:remoteVersion };
  if (localVersion && !remoteVersion) return { bank:{...local}, revision:localVersion };
  return {
    bank:preferLocalOnTie ? {...remote, ...local} : {...local, ...remote},
    revision:Math.max(remoteVersion, localVersion),
  };
}
function chooseLibrarySnapshot(remoteLibrary, localLibrary, remoteRevision, localRevision, preferLocalOnTie) {
  const remoteVersion = Number(remoteRevision) || 0;
  const localVersion = Number(localRevision) || 0;
  const remote = remoteLibrary || {};
  const local = localLibrary || {};
  if (remoteVersion && localVersion) {
    if (localVersion > remoteVersion || (localVersion === remoteVersion && preferLocalOnTie)) return {library:{...local}, revision:localVersion};
    return {library:{...remote}, revision:remoteVersion};
  }
  if (remoteVersion && !localVersion) return {library:{...remote}, revision:remoteVersion};
  if (localVersion && !remoteVersion) return {library:{...local}, revision:localVersion};
  const merged = preferLocalOnTie ? {...remote,...local} : {...local,...remote};
  const keys = new Set([...Object.keys(remote), ...Object.keys(local)]);
  for (const key of keys) {
    const remoteList = Array.isArray(remote[key]) ? remote[key] : [];
    const localList = Array.isArray(local[key]) ? local[key] : [];
    if (remoteList.length && !localList.length) merged[key] = remoteList;
    else if (localList.length && !remoteList.length) merged[key] = localList;
  }
  return {library:merged, revision:0};
}
function canonicalDayDesignationId(dayId) {
  if (!dayId) return "";
  const base = dayId.replace(/_finisher$/, "");
  if (base === "mob") return "mobility";
  if (base === "fullbody") return "upper";
  return dayDesignations.some(d => d.id === base) ? base : "";
}
function inferBankDesignation(name, entry = {}) {
  if (entry.type === "upper" || entry.type === "lower") return entry.type;
  const matches = new Set();
  const normalizedName = bankKey(name || "");
  const inspectList = (listKey, list) => {
    if (!(list || []).some(ex => bankKey(ex.name || "") === normalizedName)) return;
    const designation = canonicalDayDesignationId(listKey);
    if (designation) matches.add(designation);
  };
  Object.entries(library || {}).forEach(([listKey,list]) => inspectList(listKey,list));
  Object.values(logs || {}).forEach(day => Object.entries(day.lists || {}).forEach(([listKey,list]) => inspectList(listKey,list)));
  return matches.size === 1 ? [...matches][0] : "";
}
function hasMeaningfulLocalData() {
  if (Object.values(library || {}).some(list => Array.isArray(list) && list.length)) return true;
  if (Object.keys(logs || {}).length || (classes || []).length) return true;
  if (marathon?.settings || Object.keys(marathon?.runs || {}).length) return true;
  if (dayDesignations.some(day => {
    const original = DEFAULT_DAY_DESIGNATIONS.find(item => item.id === day.id);
    return !original || day.label !== original.label || day.loggable !== original.loggable;
  })) return true;
  return Object.keys(bank || {}).length > 0;
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
    alternatives: Array.isArray(ex.alternatives) ? [...ex.alternatives] : (bank[key]?.alternatives || []),
    archived: Object.prototype.hasOwnProperty.call(ex, "archived") ? !!ex.archived : !!bank[key]?.archived,
    dayDesignation: Object.prototype.hasOwnProperty.call(ex, "dayDesignation")
      ? (ex.dayDesignation || "")
      : (bank[key]?.dayDesignation || ""),
  };
  saveBank(bank);
}

// ---------- Cross-device sync (Netlify Blobs via a serverless function) ----------
// Local storage above stays the fast, offline-first source of truth for the
// current screen. This layer keeps a shared remote copy in sync in the
// background so the same data shows up on every device.
const REMOTE_ENDPOINT = "/api/data";
let pushTimer = null;
let pushChain = Promise.resolve(); // serialize writes so an older in-flight push cannot finish last
let forceRemoteReplace = false; // set only by an explicit full-backup restore
let suppressPush = false; // true while applying a just-pulled remote copy, so we don't immediately push it back
let remoteDataHydrated = false;

async function pullRemote(isInitial) {
  try {
    const res = await fetch(REMOTE_ENDPOINT, { cache: "no-store" });
    if (!res.ok) throw new Error("pull failed: " + res.status);
    const remote = await res.json();
    remoteDataHydrated = true;
    if (remote && (remote.library || remote.logs || remote.bank || remote.classes || remote.dayDesignations)) {
      // If this device wrote something locally more recently than the remote
      // copy was saved, trust the local copy and push it up instead of
      // clobbering a change that hasn't finished syncing yet (e.g. a quick
      // refresh right after tapping something).
      const remoteTime = remote.updatedAt ? Date.parse(remote.updatedAt) : 0;
      const localTime = getLocalUpdatedAt();
      if (localTime > 0 && localTime >= remoteTime && hasMeaningfulLocalData()) {
        // Keep newer local workout data, but ALWAYS merge the class catalog
        // from the remote snapshot before pushing. The timestamp covers all
        // data, so a recent workout edit on a device with an empty/stale local
        // class catalog must not erase classes saved by another tab/device.
        dayDesignations = mergeDayDesignationLists(remote.dayDesignations, dayDesignations, true);
        refreshDayDefinitions();
        localStorage.setItem(LS_DAY_DESIGNATIONS, JSON.stringify(dayDesignations));
        const localClasses = Array.isArray(classes) ? classes : [];
        const remoteClasses = Array.isArray(remote.classes) ? remote.classes : [];
        const merged = new Map(remoteClasses.filter(c => c && c.id).map(c => [c.id, c]));
        localClasses.forEach(c => { if (c && c.id) merged.set(c.id, c); });
        classes = [...merged.values()];
        const selectedLibrary = chooseLibrarySnapshot(remote.library, library, remote.libraryUpdatedAt, libraryUpdatedAt, true);
        library = {...structuredClone(DEFAULT_LIBRARY), ...selectedLibrary.library};
        libraryUpdatedAt = selectedLibrary.revision;
        localStorage.setItem(LS_LIB, JSON.stringify(library));
        localStorage.setItem(LS_LIBRARY_UPDATED_AT, String(libraryUpdatedAt));
        const selectedBank = chooseBankSnapshot(remote.bank, bank, remote.bankUpdatedAt, bankUpdatedAt, true);
        bank = selectedBank.bank;
        bankUpdatedAt = selectedBank.revision;
        localStorage.setItem(LS_BANK, JSON.stringify(bank));
        localStorage.setItem(LS_BANK_UPDATED_AT, String(bankUpdatedAt));
        migrateWalkRunClassTitles();
        localStorage.setItem(LS_CLASSES, JSON.stringify(classes));
        if (runV77Migrations()) {
          localStorage.setItem(LS_LIB, JSON.stringify(library));
          localStorage.setItem(LS_LOGS, JSON.stringify(logs));
          localStorage.setItem(LS_BANK, JSON.stringify(bank));
        }
        setSyncStatus("syncing");
        pushRemote();
        render();
        return;
      }
      const localClassesBeforePull = Array.isArray(classes) ? classes : [];
      const localBankBeforePull = bank || {};
      const localLibraryBeforePull = library || {};
      const localLogsBeforePull = logs || {};
      const remoteHasDayDesignations = Array.isArray(remote.dayDesignations);
      const repairRemoteDayDesignations = !remoteHasDayDesignations;
      const remoteHasClasses = Array.isArray(remote.classes);
      const remoteClasses = remoteHasClasses ? remote.classes : [];
      let repairRemoteClasses = !remoteHasClasses;
      let repairRemoteWorkoutData = false;
      let relabeledClassTitles = false;
      suppressPush = true;
      const selectedLibrary = chooseLibrarySnapshot(remote.library, localLibraryBeforePull, remote.libraryUpdatedAt, libraryUpdatedAt, false);
      library = { ...structuredClone(DEFAULT_LIBRARY), ...selectedLibrary.library };
      libraryUpdatedAt = selectedLibrary.revision;
      // An empty or partial snapshot from one device must not erase routines
      // and dates already stored on another device. Merge by date, preferring
      // the remote copy for dates it actually contains.
      if (Object.keys(library).length > Object.keys(remote.library || {}).length) repairRemoteWorkoutData = true;
      logs = { ...(localLogsBeforePull || {}), ...(remote.logs || {}) };
      if (Object.keys(logs).length > Object.keys(remote.logs || {}).length) repairRemoteWorkoutData = true;
      const selectedBank = chooseBankSnapshot(remote.bank, localBankBeforePull, remote.bankUpdatedAt, bankUpdatedAt, false);
      bank = selectedBank.bank;
      bankUpdatedAt = selectedBank.revision;
      dayDesignations = mergeDayDesignationLists(remote.dayDesignations, dayDesignations, false);
      refreshDayDefinitions();
      if (migrateRoutineTemplates()) repairRemoteWorkoutData = true;
      if (runV77Migrations()) repairRemoteWorkoutData = true;
      if (!remoteHasClasses || (remoteClasses.length === 0 && localClassesBeforePull.length > 0)) {
        // An older backend or stale/empty remote payload must not wipe classes
        // already stored on this device. Preserve them and repair remote below.
        classes = localClassesBeforePull;
        repairRemoteClasses = true;
      } else {
        const mergedClasses = new Map(remoteClasses.filter(c => c && c.id).map(c => [c.id, c]));
        localClassesBeforePull.forEach(c => {
          if (c && c.id && !mergedClasses.has(c.id)) mergedClasses.set(c.id, c);
        });
        classes = [...mergedClasses.values()];
        if (classes.length > remoteClasses.length) repairRemoteClasses = true;
      }
      relabeledClassTitles = migrateWalkRunClassTitles();
      // Older copies of the sync function didn't store the marathon plan —
      // if the remote has none, keep this device's copy instead of wiping it.
      if (remote.marathon) marathon = { ...structuredClone(DEFAULT_MARATHON), ...remote.marathon };
      localStorage.setItem(LS_LIB, JSON.stringify(library));
      localStorage.setItem(LS_LIBRARY_UPDATED_AT, String(libraryUpdatedAt));
      localStorage.setItem(LS_LOGS, JSON.stringify(logs));
      localStorage.setItem(LS_BANK, JSON.stringify(bank));
      localStorage.setItem(LS_BANK_UPDATED_AT, String(bankUpdatedAt));
      localStorage.setItem(LS_DAY_DESIGNATIONS, JSON.stringify(dayDesignations));
      localStorage.setItem(LS_CLASSES, JSON.stringify(classes));
      localStorage.setItem(LS_MARATHON, JSON.stringify(marathon));
      suppressPush = false;
      if (repairRemoteClasses || repairRemoteDayDesignations || repairRemoteWorkoutData || relabeledClassTitles) {
        touchLocalUpdatedAt();
        schedulePush();
      } else {
        setSyncStatus("synced");
      }
      render();
    } else if (isInitial || !Object.keys(bank).length) {
      // Seed only after confirming the remote store is empty. Seeding before this
      // point stamps local storage as newer and can overwrite data on a new device.
      runV77Migrations();
      if (migrateWalkRunClassTitles()) localStorage.setItem(LS_CLASSES, JSON.stringify(classes));
      pushRemote();
      render();
    } else {
      setSyncStatus("synced");
    }
  } catch (e) {
    runV77Migrations();
    setSyncStatus(navigator.onLine ? "error" : "offline");
    render();
  }
}

function schedulePush() {
  if (suppressPush) return;
  setSyncStatus("syncing");
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushRemote, 1200);
}

function pushRemote() {
  // Serialize writes. Each queued write reads the latest in-memory state when
  // it begins, preventing overlapping requests from leaving an older snapshot
  // as the final cloud copy.
  const write = async () => {
    try {
      const res = await fetch(REMOTE_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ library, librarySnapshotVersion:77, libraryUpdatedAt, logs, bank, bankUpdatedAt, marathon, classes, dayDesignations,
          replaceAll: forceRemoteReplace }),
      });
      if (!res.ok) throw new Error("push failed: " + res.status);
      if (forceRemoteReplace) forceRemoteReplace = false;
      setSyncStatus("synced");
      return true;
    } catch (e) {
      setSyncStatus(navigator.onLine ? "error" : "offline");
      return false;
    }
  };
  pushChain = pushChain.then(write, write);
  return pushChain;
}

// ---------- State ----------
let library = loadLibrary();
let logs = loadLogs();
let bank = loadBank();
// Show the updated class label even offline. Do not stamp this local-only
// rename as a user edit; the next successful remote merge migrates and pushes
// the merged catalog without making stale local workout data look newer.
if (migrateWalkRunClassTitles()) localStorage.setItem(LS_CLASSES, JSON.stringify(classes));
let state = {
  tab: "overview",
  overviewMode: "day",
  selectedDate: todayISO(),
  selectedDayId: null,
  progressExId: null,
  editScope: "routine",
  routineBuilderListKey: "upper",
  routineNotice: "",
  runCalIdx: null, // which calendar week the Run tab is showing (null = current)
};

// The standalone file preview uses the live site's verified Monday snapshot
// when it has no local tracker data. This sample stays in memory only and is
// never written to localStorage or used on the deployed HTTPS app.
if (location.protocol === "file:" && Object.keys(logs).length === 0 && classes.length === 0 && !marathon.settings && !Object.keys(marathon.runs || {}).length) {
  const previewWeek = "2026-10-26";
  state.selectedDate = previewWeek;
  const classIds = {
    cycle3:"preview-cycle-ep03-tyrell", elliptical98:"preview-walk-run-ep98-sherica",
    walkRun2:"preview-walk-run-ep02-am", walkRun1:"preview-walk-run-ep01-am",
    cycle288:"preview-cycle-ep288-tyrell", walkRun10:"preview-walk-run-ep10-sam",
  };
  classes = [
    { id:classIds.cycle3, title:"Cycle", episode:"03", instructor:"Tyrell", exercise:"Recumbent Bike" },
    { id:classIds.elliptical98, title:"Stride", episode:"98", instructor:"Sherica", exercise:"Elliptical" },
    { id:classIds.walkRun2, title:"Stride", episode:"02", instructor:"AM", exercise:"Walking Outside" },
    { id:classIds.walkRun1, title:"Stride", episode:"01", instructor:"AM", exercise:"Walking Outside" },
    { id:classIds.cycle288, title:"Cycle", episode:"288", instructor:"Tyrell", exercise:"Recumbent Bike" },
    { id:classIds.walkRun10, title:"Stride", episode:"10", instructor:"Sam", exercise:"Elliptical" },
  ];
  const sampleDay = (dayId, primary, extra = {}) => ({ dayId, entries:{}, plan:{ primary }, ...extra });
  logs[previewWeek] = sampleDay("lower", "lower", { classSessions:{ previewBike:{ exerciseName:"Bike (Recumbent)", classId:classIds.cycle3 } } });
  logs[addDaysIso(previewWeek,1)] = sampleDay("cardio", "cardio", {
    lists:{ cardio:[{id:"preview-swim",name:"Swim (Laps)"},{id:"preview-elliptical",name:"Elliptical"}] },
    classSessions:{ "preview-elliptical":{ exerciseName:"Elliptical", classId:classIds.elliptical98 }, [MARATHON_RUN_CLASS_ID]:{ exerciseName:"Marathon walk/run", classId:classIds.walkRun2 } }
  });
  logs[addDaysIso(previewWeek,2)] = sampleDay("upper", "upper", { classSessions:{ [MARATHON_RUN_CLASS_ID]:{ exerciseName:"Marathon walk/run", classId:classIds.walkRun1 } } });
  logs[addDaysIso(previewWeek,3)] = sampleDay("core", "core", { classSessions:{ [MARATHON_RUN_CLASS_ID]:{ exerciseName:"Marathon walk/run", classId:classIds.walkRun2 } } });
  logs[addDaysIso(previewWeek,4)] = sampleDay("mobility", "mob", { classSessions:{ previewCycleFriday:{ exerciseName:"Bike (Recumbent)", classId:classIds.cycle288 } } });
  logs[addDaysIso(previewWeek,5)] = sampleDay("cardio", "cardio", {
    lists:{ cardio:[{id:"preview-saturday-elliptical",name:"Elliptical"}] },
    classSessions:{ "preview-saturday-elliptical":{ exerciseName:"Elliptical", classId:classIds.walkRun10 }, [MARATHON_RUN_CLASS_ID]:{ exerciseName:"Marathon walk/run", classId:classIds.walkRun2 } }
  });
  logs[addDaysIso(previewWeek,6)] = sampleDay("cardio", "swim", { lists:{ cardio:[{id:"preview-sunday-swim",name:"Swim (Laps)"}] } });
  if (!marathon.settings) marathon.settings = { startDate:previewWeek, raceName:"", raceDate:"" };
  if (!marathon.sequence.length) marathon.sequence = [{ w:1 }];
}

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
// A saved class selection is a plan. It becomes history only when a workout
// entry was logged, the user explicitly added a past class, or completion data
// was recorded for that class session.
function classSessionHasCompletion(exerciseId, session, dayLog, date) {
  if (!session) return false;
  return session.completed === true || String(exerciseId).startsWith("past_") ||
    (session.actual != null && String(session.actual).trim() !== "") ||
    entryHasData(dayLog?.entries?.[exerciseId]) ||
    // Some activities allow multiple class records, which have their own
    // generated IDs instead of the exercise ID. A real workout on that date
    // completes those assigned classes too, without requiring effort entry.
    Object.values(dayLog?.entries || {}).some(entry => entryHasData(entry)) ||
    (exerciseId === MARATHON_RUN_CLASS_ID && !!date && runHasData(runRecord(date)));
}
function dayLogHasRealData(dayLog, date) {
  if (!dayLog) return false;
  const hasEntry = Object.values(dayLog.entries || {}).some((e) => entryHasData(e));
  const hasCompletedClass = Object.entries(dayLog.classSessions || {}).some(([id, session]) => classSessionHasCompletion(id, session, dayLog, date));
  return hasEntry || !!dayLog.note || !!dayLog.finisherNote || hasCompletedClass;
}

function allExercises() {
  const map = {};
  Object.values(library).forEach((list) => (list || []).forEach((e) => (map[e.id] = e)));
  Object.values(logs).forEach((dayLog) => {
    Object.values(dayLog.lists || {}).forEach((list) => (list || []).forEach((e) => (map[e.id] = e)));
    Object.entries(dayLog.completedExercises || {}).forEach(([id,e]) => { map[id] = e; });
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
  app.classList.toggle("app-overview-mode", state.tab === "overview");
  app.classList.toggle("app-week-overview-mode", state.tab === "overview" && state.overviewMode === "week");
  app.appendChild(renderHeader());
  app.appendChild(renderOfflineBanner());
  app.appendChild(renderTabs());

  if (state.tab === "overview") app.appendChild(renderOverview());
  if (state.tab === "plan") app.appendChild(renderPlan());
  if (state.tab === "today") app.appendChild(renderToday());
  if (state.tab === "run") app.appendChild(renderRun());
  if (state.tab === "history") app.appendChild(renderHistory());
  if (state.tab === "classes") app.appendChild(renderClasses());
  if (state.tab === "progress") app.appendChild(renderProgress());
  if (state.tab === "routines") app.appendChild(renderRoutines());

  if (state.tab === "today" && selectedDayInfo()) app.appendChild(renderFab());
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
migrateRoutineTemplates();

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
  [["overview", "AT A GLANCE"], ["plan", "PLAN"], ["today", "LOG"], ["routines", "ROUTINES"], ["run", "RUN"], ["history", "HISTORY"], ["classes", "CLASSES"], ["progress", "PROGRESS"]].forEach(([id, label]) => {
    const btn = el(`<button class="tab-btn ${state.tab === id ? "active" : ""}">${label}</button>`);
    btn.onclick = () => { state.tab = id; render(); };
    wrap.appendChild(btn);
  });
  return wrap;
}

function renderRoutines() {
  const wrap = el(`<main class="routines-page"><h2>Routine Builder</h2><p class="field-hint">Build reusable exercise lists for each day type and finisher. Changes here update the saved routine for future workouts. In Log, you can still change an individual day without changing its routine.</p><div class="form-row"><label for="routine-builder-list">Routine to build</label><select id="routine-builder-list"></select></div><div class="modal-actions"><button class="btn-primary" id="routine-builder-add">+ Add exercise</button><button class="btn-secondary" id="routine-builder-group">🔗 Create Superset</button></div><div id="routine-builder-items"></div></main>`);
  const selector = wrap.querySelector("#routine-builder-list");
  const listKeys = dayDesignations.filter(day => day.loggable).flatMap(day => [day.id, finisherKey(day.id)]);
  if (!listKeys.includes(state.routineBuilderListKey)) state.routineBuilderListKey = listKeys[0] || "upper";
  listKeys.forEach(key => {
    const base = key.replace(/_finisher$/, "");
    const label = dayDesignationLabel(base) + (key.endsWith("_finisher") ? " · Finisher" : " · Routine");
    selector.appendChild(el(`<option value="${safeText(key)}">${safeText(label)}</option>`));
  });
  selector.value = state.routineBuilderListKey;
  selector.onchange = () => { state.routineBuilderListKey = selector.value; render(); };
  const listKey = state.routineBuilderListKey;
  const items = wrap.querySelector("#routine-builder-items");
  const list = Array.isArray(library[listKey]) ? library[listKey] : [];
  if (!list.length) items.appendChild(el(`<div class="empty-state">This saved routine is empty. Add exercises here; the day remains editable in Log.</div>`));
  list.forEach((ex, index) => {
    const row = el(`<article class="hist-card routine-builder-row"><div class="hist-card-top"><b>${safeText(ex.name)}</b><span>${exNumSets(ex)} sets</span></div><div class="field-hint">Targets: ${safeText(targetLabelFor(ex))}${ex.trackType === "weight" ? ` · Weights: ${safeText((ex.weights || []).join(" / "))} lbs` : ""}${ex.groupId ? " · Superset" : ""}</div><div class="cl-actions"><button class="btn-secondary routine-edit">Edit</button><button class="btn-secondary routine-up" ${index===0?"disabled":""}>Move up</button><button class="btn-secondary routine-down" ${index===list.length-1?"disabled":""}>Move down</button><button class="btn-secondary routine-remove">Remove</button></div></article>`);
    row.querySelector(".routine-edit").onclick = () => openEditExerciseModal(listKey, ex.id, true);
    row.querySelector(".routine-up").onclick = () => moveExerciseInList(listKey, ex.id, -1, true);
    row.querySelector(".routine-down").onclick = () => moveExerciseInList(listKey, ex.id, 1, true);
    row.querySelector(".routine-remove").onclick = () => removeExerciseFromDay(listKey, ex.id, true);
    items.appendChild(row);
  });
  wrap.querySelector("#routine-builder-add").onclick = () => openAddExerciseModal(listKey, true);
  const groupButton = wrap.querySelector("#routine-builder-group");
  groupButton.disabled = list.filter(ex => !ex.groupId).length < 2;
  groupButton.onclick = () => openGroupModal(listKey, true);
  return wrap;
}

// Weekly planning lives in Log and saves into the same per-date record as the
// former planner. At a Glance only reads these values.
function weekPrimaryOptions() {
  const options = [
    ["", "— Choose Primary —"], ["upper", dayDesignationLabel("upper")], ["lower", dayDesignationLabel("lower")],
    ["fullbody", "Full Body"], ["core", dayDesignationLabel("core")], ["mob", dayDesignationLabel("mobility")],
    ["pilates", dayDesignationLabel("pilates")], ["swim", "Swim"], ["ellip", "Elliptical"],
    ["cardio", dayDesignationLabel("cardio")], ["walk", "Walking"], ["treadmill", "Treadmill"],
    ["run", `Marathon run (${dayDesignationLabel(marathonDesignationId())})`], ["rest", dayDesignationLabel("rest")],
  ];
  const included = new Set(options.map(([value]) => value));
  dayDesignations.forEach(day => {
    const value = day.primaryValue || day.id;
    if (!included.has(value)) { options.push([value, day.label]); included.add(value); }
  });
  Object.entries(bank).filter(([,entry]) => !entry?.archived).sort((a,b) => a[1].name.localeCompare(b[1].name)).forEach(([key,entry]) => {
    if (entry?.name) options.push([`bank-primary:${key}`, entry.name]);
  });
  return options;
}
const WEEK_LEVELUP_OPTIONS = [["", "— Choose from Exercise Bank —"]];
const PLAN_TO_TRACKER_DAY = {
  upper:"upper", "upper-b":"upper", lower:"lower", "lower-b":"lower", core:"core", mob:"mobility", pilates:"pilates",
  rest:"rest", cardio:"cardio", swim:"cardio", ellip:"cardio", "cardio-class":"cardio",
  walk:"cardio", treadmill:"cardio", run:"cardio", fullbody:"upper",
};
function marathonDesignationId() { return bank[bankKey("Marathon Training")]?.dayDesignation || "cardio"; }
function trackerDayForPlanPrimary(primary) {
  if (primary?.startsWith("bank-primary:")) {
    const item = bank[primary.slice("bank-primary:".length)];
    return item?.dayDesignation && DAYS.some(day => day.id === item.dayDesignation) ? item.dayDesignation : null;
  }
  const designation = dayDesignations.find(day => day.primaryValue === primary);
  if (designation) return designation.id;
  if (primary === "run") return marathonDesignationId();
  return PLAN_TO_TRACKER_DAY[primary] || (DAYS.some(day => day.id === primary) ? primary : null);
}
function planPrimaryLabel(value, plan = null) {
  if (!value) return "";
  if (value.startsWith("bank-primary:")) return bank[value.slice("bank-primary:".length)]?.name || plan?.primaryName || "Bank exercise";
  if (value === "run") return `Marathon run (${dayDesignationLabel(marathonDesignationId())})`;
  const customDay = dayDesignations.find(day => day.primaryValue === value || day.id === value);
  return customDay?.label || PLAN_LABELS[value] || value;
}
function planOptionsHTML(options, selected, includeExerciseBank = false, savedBankLabel = "", savedPrimaryLabel = "") {
  const shown = selected === "cardio-class" ? "cardio" : selected;
  let html = options.map(([value,label]) => `<option value="${safeText(value)}"${value === shown ? " selected" : ""}>${safeText(label)}</option>`).join("");
  if (!includeExerciseBank) {
    if (shown && !options.some(([value]) => value === shown)) html += `<option value="${safeText(shown)}" selected disabled>Previously planned: ${safeText(savedPrimaryLabel || PLAN_LABELS[shown] || shown)}</option>`;
    return html;
  }
  const bankEntries = Object.entries(bank)
    .filter(([key, entry]) => key && entry?.name && !entry?.archived)
    .sort((a,b) => a[1].name.localeCompare(b[1].name));
  const selectedBankKey = shown.startsWith("lu-bank:") ? shown.slice("lu-bank:".length) : "";
  const selectedBankEntryExists = !!(selectedBankKey && bank[selectedBankKey]?.name && !bank[selectedBankKey]?.archived);
  const selectedIsPreset = options.some(([value]) => value === shown);
  if (shown && !selectedBankEntryExists && !selectedIsPreset) {
    const legacyLabel = shown === "lu-marathon"
      ? savedBankLabel || PLAN_LABELS[shown] || "Marathon Program"
      : PLAN_LABELS[shown] || savedBankLabel || "Previous Level Up";
    const displayLabel = shown === "lu-marathon" ? legacyLabel : `Previously planned: ${legacyLabel}`;
    html += `<option value="${safeText(shown)}" selected disabled>${safeText(displayLabel)}</option>`;
  }
  html += `<optgroup label="Exercise bank">${bankEntries.map(([key,entry]) => {
    const value = `lu-bank:${key}`;
     return `<option value="${safeText(value)}"${value === shown ? " selected" : ""}>${safeText(entry.name)}</option>`;
  }).join("")}`;
  if (selectedBankKey && !selectedBankEntryExists && savedBankLabel) {
    const value = `lu-bank:${selectedBankKey}`;
    html += `<option value="${safeText(value)}" selected>${safeText(savedBankLabel)} (no longer in bank)</option>`;
  }
  html += `</optgroup>`;
  return html;
}
function planOptionLabel(value, plan = null) {
  if (value?.startsWith("lu-bank:")) {
    const key = value.slice("lu-bank:".length);
    return bank[key]?.name || (plan?.levelup === value ? plan.levelupName : "") || "Banked exercise";
  }
  if (value === "lu-marathon") return plan?.levelupName || PLAN_LABELS[value] || "Marathon Program";
  return PLAN_LABELS[value] || value || "";
}
function planForDate(date) { return logs[date]?.plan || {}; }

// Preload the six-week strength block once. Existing dated plans are preserved;
// blank dates receive editable suggestions, never locked appointments.
// Remove only untouched suggestions and auto-installed starter routines from
// the retired Version 70 holiday block. Keep edited dates and workout history.
const V70_HOLIDAY_ASSIGNMENTS = {
  "2026-11-23":"lower", "2026-11-24":"upper", "2026-11-25":"swim", "2026-11-27":"upper-b", "2026-11-28":"lower-b",
  "2026-11-30":"lower", "2026-12-01":"upper", "2026-12-02":"swim", "2026-12-03":"lower-b", "2026-12-04":"upper-b",
  "2026-12-07":"lower", "2026-12-08":"upper", "2026-12-09":"swim", "2026-12-10":"lower-b", "2026-12-11":"upper-b",
  "2026-12-14":"lower", "2026-12-15":"upper", "2026-12-16":"swim", "2026-12-17":"lower-b", "2026-12-18":"upper-b",
  "2026-12-21":"lower", "2026-12-22":"upper", "2026-12-23":"swim", "2026-12-24":"lower-b", "2026-12-26":"upper-b",
  "2026-12-28":"lower", "2026-12-29":"upper", "2026-12-30":"swim", "2026-12-31":"lower-b", "2027-01-02":"upper-b", "2027-01-03":"rest"
};
function removeHolidayBlockDefaults() {
  const marker = "iron-log-v75-holiday-block-removed";
  let changed = false, logsChanged = false, libraryChanged = false, bankChanged = false, designationsChanged = false;
  const planKeys = new Set(["primary", "isCommute", "setDayType", "v70Suggested", "v72Suggested"]);
  Object.entries(logs || {}).forEach(([date, day]) => {
    const plan = day?.plan;
    if (!plan || (!plan.v70Suggested && !plan.v72Suggested)) return;
    const expected = V70_HOLIDAY_ASSIGNMENTS[date];
    const noWorkoutData = !dayLogHasRealData(day, date) && Object.keys(day.entries || {}).length === 0 &&
      Object.keys(day.lists || {}).length === 0 && Object.keys(day.routineOverrides || {}).length === 0 &&
      Object.keys(day.classSessions || {}).length === 0 && !day.note && !day.finisherNote;
    const untouched = !!expected && plan.primary === expected && !plan.levelup && !plan.levelupName &&
      !plan.primaryName && plan.isCommute !== true && noWorkoutData && Object.keys(plan).every(key => planKeys.has(key));
    const cleanPlan = {...plan};
    delete cleanPlan.v70Suggested;
    delete cleanPlan.v72Suggested;
    if (untouched) {
      delete day.plan;
      if (day.dayId === (trackerDayForPlanPrimary(expected) || expected) && plan.setDayType) delete day.dayId;
    } else {
      day.plan = cleanPlan;
    }
    logs[date] = day;
    changed = true;
    logsChanged = true;
  });
  Object.entries(logs || {}).forEach(([date, day]) => {
    if (!Object.keys(day?.entries || {}).some(id => id.startsWith("v70-")) || !dayLogHasRealData(day, date)) return;
    const before = Object.keys(day.completedExercises || {}).length;
    preserveCompletedExerciseDetails(date);
    if (Object.keys(day.completedExercises || {}).length !== before) { changed = true; logsChanged = true; }
  });
  for (const key of ["upper", "lower", "upper-b", "lower-b"]) {
    const list = library[key];
    if (!Array.isArray(list) || !list.some(ex => String(ex.id || "").startsWith("v70-"))) continue;
    list.filter(ex => String(ex.id || "").startsWith("v70-")).forEach(ex => {
      const id = bankKey(ex.name || "");
      if (id && !bank[id]) {
        bank[id] = {name:ex.name, type:ex.type || "other", trackType:ex.trackType || "weight",
          weights:Array.isArray(ex.weights) ? [...ex.weights] : [], targets:Array.isArray(ex.targets) ? [...ex.targets] : null,
          customUnit:ex.customUnit || null, archived:false, dayDesignation:""};
        bankChanged = true;
      }
    });
    library[key] = list.filter(ex => !String(ex.id || "").startsWith("v70-"));
    libraryChanged = true;
    changed = true;
  }
  const retiredDayTypes = {"upper-b":"upper", "lower-b":"lower"};
  Object.entries(logs || {}).forEach(([date, day]) => {
    if (!day) return;
    const oldDayId = day.dayId;
    if (retiredDayTypes[oldDayId]) { day.dayId = retiredDayTypes[oldDayId]; logsChanged = true; changed = true; }
    if (retiredDayTypes[day.plan?.primary]) {
      day.plan.primary = retiredDayTypes[day.plan.primary];
      if (day.plan.primaryName === "Upper B" || day.plan.primaryName === "Lower B") delete day.plan.primaryName;
      logsChanged = true; changed = true;
    }
    if (retiredDayTypes[day.plan?.primaryDayId]) { day.plan.primaryDayId = retiredDayTypes[day.plan.primaryDayId]; logsChanged = true; changed = true; }
    for (const [oldId, nextId] of Object.entries(retiredDayTypes)) {
      if (day.lists?.[oldId] && !day.lists[nextId]) {
        day.lists[nextId] = day.lists[oldId];
        if (day.routineOverrides?.[oldId]) { day.routineOverrides[nextId] = true; }
        logsChanged = true; changed = true;
      }
      if (Array.isArray(day.planListKeys) && day.planListKeys.includes(oldId) && !day.planListKeys.includes(nextId)) {
        day.planListKeys = day.planListKeys.map(key => key === oldId ? nextId : key);
        logsChanged = true; changed = true;
      }
    }
  });
  Object.values(library || {}).flat().forEach(ex => {
    if (!retiredDayTypes[ex?.dayDesignation]) return;
    ex.dayDesignation = retiredDayTypes[ex.dayDesignation]; libraryChanged = true; changed = true;
  });
  Object.values(bank || {}).forEach(ex => {
    if (!retiredDayTypes[ex?.dayDesignation]) return;
    ex.dayDesignation = retiredDayTypes[ex.dayDesignation]; bankChanged = true; changed = true;
  });
  const withoutRetiredTypes = dayDesignations.filter(d => !retiredDayTypes[d.id]);
  if (withoutRetiredTypes.length !== dayDesignations.length) {
    dayDesignations = withoutRetiredTypes;
    designationsChanged = true; changed = true;
  }
  if (designationsChanged) {
    dayDesignations = normalizeDayDesignations(dayDesignations);
    refreshDayDefinitions();
    localStorage.setItem(LS_DAY_DESIGNATIONS, JSON.stringify(dayDesignations));
  }
  if (logsChanged) saveLogs(logs);
  if (libraryChanged) saveLibrary(library);
  if (bankChanged) saveBank(bank);
  localStorage.setItem(marker, "complete");
  return changed;
}
function clearPlansFromV77(localAuthoritative = false) {
  const marker = "iron-log-v77-schedules-cleared-from-2026-11-27";
  if (localStorage.getItem(marker) === "complete") return false;
  let changed = false;
  for (const [date, day] of Object.entries(logs || {})) {
    if (date < "2026-11-27" || !day) continue;
    const hasHistory = dayLogHasRealData(day, date);
    if (hasHistory) preserveCompletedExerciseDetails(date);
    if (day.plan) { delete day.plan; changed = true; }
    for (const key of ["lists", "routineOverrides", "planListKeys"]) {
      if (day[key] !== undefined) { delete day[key]; changed = true; }
    }
    if (day.classSessions) {
      for (const [id, session] of Object.entries(day.classSessions)) {
        if (!classSessionHasCompletion(id, session, day, date)) { delete day.classSessions[id]; changed = true; }
      }
      if (!Object.keys(day.classSessions).length) { delete day.classSessions; changed = true; }
    }
    if (!hasHistory) {
      if (day.dayId !== undefined) { delete day.dayId; changed = true; }
      if (day.entries && Object.keys(day.entries).length) { day.entries = {}; changed = true; }
      if (day.completedExercises && Object.keys(day.completedExercises).length) { day.completedExercises = {}; changed = true; }
    }
  }
  if (changed) saveLogs(logs);
  if (remoteDataHydrated || localAuthoritative) localStorage.setItem(marker, "complete");
  return changed;
}
function runV77Migrations(localAuthoritative = false) {
  const holidayChanged = removeHolidayBlockDefaults();
  const plansChanged = clearPlansFromV77(localAuthoritative);
  return holidayChanged || plansChanged;
}
function bankExerciseForPlan(key) {
  const entry = bank[key];
  if (!entry) return null;
  const existing = Object.values(library).flat().concat(...Object.values(logs).flatMap(day => Object.values(day.lists || {}).flat()))
    .find(ex => bankKey(ex.name || "") === key);
  return { ...(existing || {}), id:existing?.id || `bank_${key.replace(/[^a-z0-9]+/g,"_")}`, name:entry.name,
    type:entry.type || "other", trackType:entry.trackType || "weight", numSets:existing?.numSets || entry.targets?.length || entry.weights?.length || 3, weights:[...(entry.weights || [20,20,20])],
    targets:Array.isArray(entry.targets) ? [...entry.targets] : null, customUnit:entry.customUnit || null };
}
function preserveCompletedExerciseDetails(date) {
  const dayLog = logs[date];
  if (!dayLog) return;
  const exerciseMap = allExercises();
  const activeDayId = dayLog.dayId || "";
  [activeDayId, activeDayId ? finisherKey(activeDayId) : ""].filter(Boolean).forEach(key => {
    getExerciseList(date, key).forEach(ex => { if (ex?.id) exerciseMap[ex.id] = ex; });
  });
  Object.values(dayLog.lists || {}).flat().forEach(ex => { if (ex?.id) exerciseMap[ex.id] = ex; });
  dayLog.completedExercises ||= {};
  Object.entries(dayLog.entries || {}).forEach(([id, entry]) => {
    if (entryHasData(entry) && exerciseMap[id] && !dayLog.completedExercises[id]) {
      const ex = exerciseMap[id];
      dayLog.completedExercises[id] = { ...ex, dayDesignation:bank[bankKey(ex.name || "")]?.dayDesignation || "" };
    }
  });
}
function populatePlannedExercises(date, primary) {
  const dayLog = logs[date] ||= { entries:{} };
  const dayId = trackerDayForPlanPrimary(primary) || (primary?.startsWith("bank-primary:") ? dayLog.plan?.primaryDayId || "cardio" : null);
  preserveCompletedExerciseDetails(date);
  if (!dayId || dayId === "rest") return;
  let assigned;
  if (primary?.startsWith("bank-primary:")) {
    const one = bankExerciseForPlan(primary.slice("bank-primary:".length));
    assigned = one ? [one] : [];
  } else {
    assigned = Object.entries(bank).filter(([,entry]) => !entry?.archived && entry?.dayDesignation === dayId)
      .sort((a,b) => a[1].name.localeCompare(b[1].name)).map(([key]) => bankExerciseForPlan(key)).filter(Boolean);
  }
  // Planning selects a routine; it does not replace the user's saved order.
  // Newly assigned bank exercises are appended to the template, preserving
  // the user's existing order and any manually added exercises.
  const template = Array.isArray(library[dayId]) ? [...library[dayId]] : [];
  const existingNames = new Set(template.map(ex => bankKey(ex.name || "")));
  let templateChanged = !Array.isArray(library[dayId]);
  assigned.forEach(ex => {
    const key = bankKey(ex.name || "");
    if (key && !existingNames.has(key)) { template.push(ex); existingNames.add(key); templateChanged = true; }
  });
  if (templateChanged) setExerciseList(date, dayId, template, "routine");
  if (!dayLogHasRealData(dayLog,date)) dayLog.dayId = dayId;
}
function syncPlannedLevelUpActivity(date) {
  const dayLog = logs[date];
  const plan = dayLog?.plan;
  if (!dayLog || !plan) return;
  const bankKeyValue = plan.levelup?.startsWith("lu-bank:") ? plan.levelup.slice(8) : "";
  const oldId = plan.levelupExerciseId;
  const oldListKey = plan.levelupExerciseListKey;
  const samePlannedExercise = !!(bankKeyValue && bank[bankKeyValue] && plan.levelupExerciseKey === bankKeyValue);
  if (oldId && oldListKey && !samePlannedExercise) {
    preserveCompletedExerciseDetails(date);
    const oldIsOwned = plan.levelupExerciseOwned === true || (plan.levelupExerciseOwned == null && oldId.startsWith("levelup_") && oldListKey.endsWith("_finisher"));
    if (oldIsOwned && !entryHasData(dayLog.entries?.[oldId])) {
      setExerciseList(date, oldListKey, getExerciseList(date, oldListKey).filter(ex => ex.id !== oldId), "today");
    }
    delete plan.levelupExerciseId;
    delete plan.levelupExerciseKey;
    delete plan.levelupExerciseListKey;
    delete plan.levelupExerciseOwned;
  }
  if (!bankKeyValue || !bank[bankKeyValue]) return;
  if (oldId && samePlannedExercise && oldListKey && getExerciseList(date, oldListKey).some(ex => ex.id === oldId)) return;
  if (oldId && samePlannedExercise && entryHasData(dayLog.entries?.[oldId])) return;

  const primaryDayId = trackerDayForPlanPrimary(plan.primary) || plan.primaryDayId || dayLog.dayId || "cardio";
  const targetListKey = finisherKey(primaryDayId);
  // Only reuse activities already present in this date's log. Static routines
  // are templates, not evidence that the exercise is already logged today.
  const keys = new Set(Object.keys(dayLog.lists || {}));
  const candidates = [];
  keys.forEach(listKey => getExerciseList(date, listKey).forEach(ex => {
    if (bankKey(ex.name || "") === bankKeyValue) candidates.push({ listKey, ex });
  }));
  const primaryListKey = primaryDayId;
  const candidate = candidates.sort((a,b) => {
    const score = item => item.ex.id === oldId ? 0 : item.listKey === primaryListKey ? 1 : item.listKey === targetListKey ? 2 : 3;
    return score(a) - score(b);
  })[0];
  if (candidate) {
    plan.levelupExerciseId = candidate.ex.id;
    plan.levelupExerciseKey = bankKeyValue;
    plan.levelupExerciseListKey = candidate.listKey;
    plan.levelupExerciseOwned = false;
    return;
  }

  const exercise = bankExerciseForPlan(bankKeyValue);
  if (!exercise) return;
  const id = `levelup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
  exercise.id = id;
  setExerciseList(date, targetListKey, [...getExerciseList(date, targetListKey), exercise], "today");
  plan.levelupExerciseId = id;
  plan.levelupExerciseKey = bankKeyValue;
  plan.levelupExerciseListKey = targetListKey;
  plan.levelupExerciseOwned = true;
}
function saveInlinePlan(date, slot, value) {
  const dayLog = logs[date] || { entries:{} };
  logs[date] = dayLog;
  dayLog.plan = { ...(dayLog.plan || {}), [slot]:value, isCommute:false };
  if (slot === "primary") {
    if (value.startsWith("bank-primary:")) {
      dayLog.plan.primaryName = bank[value.slice("bank-primary:".length)]?.name || dayLog.plan.primaryName || "Bank exercise";
      dayLog.plan.primaryDayId = trackerDayForPlanPrimary(value) || "cardio";
    } else {
      delete dayLog.plan.primaryName;
      delete dayLog.plan.primaryDayId;
    }
  }
  if (slot === "levelup") {
    if (value.startsWith("lu-bank:")) {
      const key = value.slice("lu-bank:".length);
      dayLog.plan.levelupName = bank[key]?.name || dayLog.plan.levelupName || "Banked exercise";
    } else {
      delete dayLog.plan.levelupName;
    }
  }
  if (dayLog.plan.primary === "cardio-class") dayLog.plan.primary = "cardio";
  const mapped = trackerDayForPlanPrimary(dayLog.plan.primary);
  if (slot === "primary" && value) populatePlannedExercises(date, value);
  if (slot === "primary" || slot === "levelup") syncPlannedLevelUpActivity(date);
  if (!dayLogHasRealData(dayLog, date)) {
    if (mapped) { dayLog.dayId = mapped; dayLog.plan.setDayType = true; }
    else if (slot === "primary" && !value && dayLog.plan.setDayType) {
      // Clearing a planned activity also clears its linked day type when no
      // completed workout has been recorded for the date.
      delete dayLog.dayId;
      dayLog.plan.setDayType = false;
    }
  }
  saveLogs(logs);
  render();
}
function weeklyBalance(start) {
  const counts = { upper:0, lower:0, core:0, mobility:0, rest:0 };
  for (let i=0;i<7;i++) {
    const p = planForDate(addDaysIso(start,i));
    const primary = p.primary || "", levelup = p.levelup || "";
    const categories = new Set();
    const addDesignation = id => {
      if (!id) return;
      if (id === "upper" || id === "upper-b") categories.add("upper");
      if (id === "lower" || id === "lower-b") categories.add("lower");
      if (id === "core" || id === "rest") categories.add(id);
      if (id === "mobility" || id === "mob") categories.add("mobility");
      if (id === "pilates") { categories.add("core"); categories.add("mobility"); }
    };
    addDesignation(primary === "lu-core" ? "core" : primary === "lu-mob" ? "mobility" : primary === "lu-pilates" ? "pilates" : primary === "run" ? marathonDesignationId() : primary);
    if (levelup === "lu-core") addDesignation("core");
    else if (levelup === "lu-mob") addDesignation("mobility");
    else if (levelup === "lu-pilates") addDesignation("pilates");
    else if (levelup === "lu-marathon") addDesignation(marathonDesignationId());
    else if (levelup.startsWith("lu-bank:")) addDesignation(bank[levelup.slice(8)]?.dayDesignation);
    categories.forEach(key => counts[key]++);
  }
  return counts;
}
function renderActivityDateBar() {
  const bar = el(`<div class="log-activity-date"><div><strong>Activity date</strong><span></span></div></div>`);
  bar.querySelector("span").textContent = state.tab === "plan"
    ? "The planner week follows this shared date."
    : "Log the activity planned for this date.";
  bar.appendChild(renderDateButton(state.selectedDate, (iso) => {
    state.selectedDate = iso;
    state.selectedDayId = null;
    state.editScope = "routine";
    render();
  }, "log-activity-date-btn"));
  return bar;
}
function renderPlan() {
  const page = el(`<main class="plan-page"></main>`);
  page.appendChild(renderActivityDateBar());
  page.appendChild(renderWeeklyPlan());
  return page;
}
function renderWeeklyPlan() {
  const start = mondayOfIso(state.selectedDate);
  const end = addDaysIso(start,6);
  const range = `${fmtDate(start)} – ${fmtDate(end)}, ${isoToParts(end).year}`;
  const panel = el(`<section class="log-week-plan"><div class="log-week-head"><div><div class="log-week-kicker">WEEKLY PLAN</div><h2></h2><p>The planner week follows this activity date. Choose a Primary for each dated activity and select Level Up from the exercise bank. Pilates Reformer covers both Core and Mobility once.</p></div></div><div class="log-week-days"></div><div class="log-week-balance"><div class="log-week-balance-head"><strong>Weekly balance</strong><span>Upper/Lower strength target 2 each · recovery as needed</span></div><div class="log-week-counts"></div></div></section>`);
  panel.querySelector("h2").textContent = range;
  const days = panel.querySelector(".log-week-days");
  WEEKDAY_LABELS.forEach((label,i) => {
    const date = addDaysIso(start,i), dateObj = new Date(date + "T12:00:00"), plan = planForDate(date);
    const card = el(`<article class="log-week-day"><div class="log-week-dayhead"><div><strong></strong><span class="log-week-day-status"></span></div><button type="button" class="log-week-open">Open Log</button></div><label>Primary<select class="log-plan-primary"></select></label><label>Level Up<select class="log-plan-levelup"></select></label></article>`);
    card.querySelector(".log-week-dayhead strong").textContent = `${label} · ${dateObj.toLocaleDateString(undefined,{month:"short",day:"numeric"})}`;
    const hasPlan = !!(plan.primary || plan.levelup);
    const hasCompleted = dayLogHasRealData(logs[date],date) || runHasData(runRecord(date));
    const status = card.querySelector(".log-week-day-status");
    status.textContent = hasCompleted ? (hasPlan ? "Planned · logged" : "Logged") : hasPlan ? "Planned" : "";
    card.querySelector(".log-week-open").onclick = () => { state.selectedDate = date; state.selectedDayId = null; state.editScope = "routine"; state.tab = "today"; render(); window.scrollTo({top:0,behavior:"smooth"}); };
    const primary = card.querySelector(".log-plan-primary"), levelup = card.querySelector(".log-plan-levelup");
    primary.innerHTML = planOptionsHTML(weekPrimaryOptions(), plan.primary || "", false, "", plan.primaryName || "");
    levelup.innerHTML = planOptionsHTML(WEEK_LEVELUP_OPTIONS, plan.levelup || "", true, plan.levelupName || "");
    primary.onchange = () => saveInlinePlan(date,"primary",primary.value);
    levelup.onchange = () => saveInlinePlan(date,"levelup",levelup.value);
    days.appendChild(card);
  });
  const balance = weeklyBalance(start), holder = panel.querySelector(".log-week-counts");
  const targets = {upper:2,lower:2,core:1,mobility:1,rest:1};
  [["Upper","upper"],["Lower","lower"],["Core","core"],["Mobility","mobility"],["Rest","rest"]].forEach(([label,key]) => {
    const count = balance[key], exactTarget = key === "upper" || key === "lower";
    const status = exactTarget ? (count === 2 ? "On target" : count < 2 ? `Need ${2-count}` : "Over target") : (count >= targets[key] ? "Target met" : "Need 1");
    const stateClass = status === "On target" || status === "Target met" ? "met" : status === "Over target" ? "over" : "needed";
    const item = el(`<div class="log-week-count ${stateClass}"><span></span><strong></strong><small></small></div>`);
    item.querySelector("span").textContent = label;
    item.querySelector("strong").textContent = `${count} / ${targets[key]}`;
    item.querySelector("small").textContent = status;
    holder.appendChild(item);
  });
  return panel;
}
// Read-only day overview. It draws from the same per-date planner, tracker,
// class, and marathon records as the other tabs; it never changes completion history.
const OVERVIEW_QUOTES = [
  "Small steps still move you forward.",
  "Show up with patience; progress will follow.",
  "A steady pace is a strong pace.",
  "Make room for progress, and for recovery.",
  "Consistency grows one day at a time.",
  "You can do today's work one step at a time.",
  "Keep going gently. Every effort counts.",
  "Strength is built with effort and rest.",
];
function overviewQuote(iso) {
  let hash = 0;
  for (const c of iso) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return OVERVIEW_QUOTES[Math.abs(hash) % OVERVIEW_QUOTES.length];
}
function atAGlanceDayLabel(label) { return /day$/i.test(label) ? label : label + " Day"; }
function overviewDayLabel(date) {
  const day = logs[date] || {};
  const plannedId = day.plan?.primary === "run" ? marathonDesignationId() : {upper:"upper", "upper-b":"upper-b", lower:"lower", "lower-b":"lower-b", core:"core",mob:"mobility",pilates:"pilates",rest:"rest",cardio:"cardio","lu-core":"core","lu-mob":"mobility","lu-rest":"rest"}[day.plan?.primary];
  const id = plannedId || (!day.plan?.primary ? day.dayId : null) || (DAYS.find(d => d.id === day.plan?.primary || d.primaryValue === day.plan?.primary)?.id) || null;
  const names = {upper:"Upper Lift Day","upper-b":"Upper Lift Day",lower:"Lower Lift Day","lower-b":"Lower Lift Day",core:"Core Day",mobility:"Mobility Day",pilates:"Pilates Reformer",rest:"Rest Day",cardio:"Cardio Day"};
  const primary = (DAYS.find(d => d.id === id) ? atAGlanceDayLabel(DAYS.find(d => d.id === id).label) : null) || (day.plan?.primary ? planOptionLabel(day.plan.primary, day.plan) : null);
  const extra = day.plan?.levelup ? planOptionLabel(day.plan.levelup, day.plan) : "";
  return [primary,extra].filter(Boolean).join(" · ") || null;
}
function overviewCardioIcon(name) {
  const value = String(name || "").toLowerCase();
  if (/swim/.test(value)) return "🏊";
  if (/bike|cycle/.test(value)) return "🚴";
  if (/ellip/.test(value)) return "⟳";
  if (/run|walk|treadmill/.test(value)) return "🏃";
  if (/pilates|yoga/.test(value)) return "🧘";
  return "♥";
}
function overviewPTState() {
  try { return JSON.parse(localStorage.getItem("achilles-rehab-log-v1") || "{}"); }
  catch { return {}; }
}
function overviewPTNextDay(data = overviewPTState()) {
  const value = Number(data.nextRotationDay);
  return Number.isInteger(value) && value >= 1 && value <= 3 ? value : 1;
}
function overviewPT(date, completedOnly = false) {
  const data = overviewPTState(), entry = data[date] || {};
  const completed = entry.ptCompleted === true || (entry.ptCompleted == null && (entry.completed || []).length > 0);
  if (completedOnly && !completed) return { title:"No PT session marked complete", minutes:"", items:[] };
  let day = Number(entry.ptRotationDay);
  if (!(day >= 1 && day <= 3)) {
    if (entry.planned === "Towel exercise day") day = 2;
    else if (entry.planned === "Stretch + balance day") day = 1;
    else day = overviewPTNextDay(data);
  }
  const routines = {
    1:{title:"Day 1 — Existing PT routine",minutes:"6 MIN",items:[
      ["Straight-knee calf stretch","30 sec × 3 (1.5 min)","Gentle stretch only; do not force the ankle forward or push into heel pain."],
      ["Bent-knee calf stretch","30 sec × 3 (1.5 min)","Gentle stretch; avoid deep ankle movement or pain at the heel attachment."],
      ["Single-leg balance · firm floor","1 min × 3 (3 min)","Stand near a sturdy counter and use support as needed. No balance board."]
    ]},
    2:{title:"Day 2 — Towel Day",minutes:"9 MIN",items:[["Towel toe curls and uncurls","3 min × 3 rounds","Curl and uncurl the towel with your toes for the full 3 minutes each round."]] },
    3:{title:"Day 3 — Feet Flex & Stretch",minutes:"",items:[
      ["Feet flex & stretch (up/down)","15 reps × 3 sets","Move the feet up and down through a comfortable range."],
      ["Feet side-to-side","15 reps × 3 sets","Move the feet side to side through a comfortable range."],
      ["Ankle circles","15 reps × 3 sets","Make smooth circles with each ankle."]
    ]}
  };
  const routine = routines[day] || routines[1];
  return completed ? {...routine,title:"Completed · " + routine.title} : {...routine,title:"Next PT session · " + routine.title};
}
function overviewActivitiesFor(date) {
  const dayLog = logs[date] || {};
  const run = planSlotFor(date);
  const sessions = Object.entries(dayLog.classSessions || {}).map(([id, saved]) => {
    const ex = allExercises()[id];
    const cls = classFor(saved.classId);
    return { id, name:saved.exerciseName || ex?.name || id, cls };
  }).filter(session => session.cls);
  const marathonAudioSession = marathonAudioClassSessionFor(date);
  const cardioSessions = sessions.filter(session => session.id !== marathonAudioSession?.sourceId && session.id !== MARATHON_RUN_CLASS_ID && session.cls.id !== marathonAudioSession?.session?.classId && /cardio|walk|run|bike|cycle|ellip|swim|treadmill/i.test(`${session.name} ${session.cls.exercise||""} ${session.cls.title||""}`));
  const cardioExercises = (dayLog.dayId === "cardio" ? getExerciseList(date, "cardio") : []).filter(ex => !(dayLog.plan?.primary === "pilates" && /pilates/i.test(ex.name || ""))).map(ex => {
    const saved = dayLog.classSessions?.[ex.id] || {};
    const savedClass = classFor(saved.classId);
    const belongsToMarathon = savedClass && marathonAudioSession?.session?.classId === saved.classId;
    return { id:ex.id, name:saved.exerciseName || ex.name || ex.id, cls:belongsToMarathon ? null : savedClass };
  });
  const planDayIds = { fullbody:"upper", mob:"mobility", "lu-core":"core", "lu-mob":"mobility", "lu-rest":"rest" };
  const plannedDayId = dayLog.plan?.primary;
  const finisherDayId = planDayIds[plannedDayId] || (DAYS.some(day => day.id === plannedDayId) ? plannedDayId : dayLog.dayId);
  const finishers = DAYS.some(day => day.id === finisherDayId)
    ? getExerciseList(date, finisherKey(finisherDayId)).map(ex => {
        const saved = dayLog.classSessions?.[ex.id] || {};
        return { id:ex.id, name:saved.exerciseName || ex.name || ex.id, cls:classFor(saved.classId) };
      })
    : [];
  const plannedActivities = [...cardioExercises, ...finishers];
  const activities = [];
  const activityByName = new Map();
  const addActivity = (name, cls, detail = "", classToken = "") => {
    const key = bankKey(name || "");
    if (key && activityByName.has(key)) {
      const existing = activities[activityByName.get(key)];
      if (cls) {
        const label = classLabel(cls);
        const token = classToken || label;
        if (!existing.classTokens.includes(token)) {
          existing.classTokens.push(token);
          existing.classNames.push(label);
        }
        existing.className = existing.classNames.join(" | ");
      }
      if (!existing.detail && detail) existing.detail = detail;
      return;
    }
    if (key) activityByName.set(key, activities.length);
    const classNames = cls ? [classLabel(cls)] : [];
    const classTokens = cls ? [classToken || classLabel(cls)] : [];
    activities.push({ name, classNames, classTokens, className:classNames.join(" | "), detail });
  };
  plannedActivities.forEach(activity => addActivity(activity.name, activity.cls, "", activity.id));
  cardioSessions.forEach(session => addActivity(session.name, session.cls, "", session.id));
  if (run?.workout) {
    addActivity("Marathon walk/run", classFor(marathonAudioSession?.session?.classId), [run.workout.title, run.workout.detail].filter(Boolean).join(" · "), marathonAudioSession?.sourceId || MARATHON_RUN_CLASS_ID);
  } else if (!activities.length && dayLog.plan?.primary) {
    addActivity(planPrimaryLabel(dayLog.plan.primary, dayLog.plan), null);
  }
  return activities;
}

function overviewWeekStart(date) {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return partsToIso(d.getFullYear(), d.getMonth(), d.getDate());
}
function overviewWeekRange(start) {
  const end = addDaysIso(start, 6);
  const a = new Date(start + "T12:00:00");
  const b = new Date(end + "T12:00:00");
  const monthDay = (d) => d.toLocaleDateString(undefined, { month:"long", day:"numeric" });
  const left = a.getMonth() === b.getMonth()
    ? `${a.toLocaleDateString(undefined,{month:"long"})} ${a.getDate()}`
    : monthDay(a);
  return `${left} – ${monthDay(b)}, ${b.getFullYear()}`;
}
function renderOverview() {
  return state.overviewMode === "week" ? renderWeekOverview() : renderDayOverview();
}
function renderOverviewModeToggle(activeMode) {
  const toggle = el(`<div class="overview-mode-toggle" role="group" aria-label="At a Glance view"></div>`);
  [["day","Day"],["week","Week"]].forEach(([mode,label]) => {
    const button = el(`<button type="button" class="${mode === activeMode ? "active" : ""}" aria-pressed="${mode === activeMode}">${label}</button>`);
    button.onclick = () => { state.overviewMode = mode; render(); };
    toggle.appendChild(button);
  });
  return toggle;
}
function renderDayOverview() {
  const date = state.selectedDate;
  const label = overviewDayLabel(date);
  const wrap = el(`<main class="overview-wrap"></main>`);
  const dateTitle = new Date(date + "T12:00:00").toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"});
  const hero = el(`<section class="overview-hero"><div><div class="overview-eyebrow">YOUR DAY</div><h1></h1><div class="overview-quote"></div></div><div class="overview-date-tools"></div></section>`);
  hero.querySelector("h1").textContent = dateTitle;
  hero.querySelector(".overview-quote").textContent = `“${overviewQuote(date)}”`;
  const dateTools = hero.querySelector(".overview-date-tools");
  dateTools.appendChild(renderOverviewModeToggle("day"));
  dateTools.appendChild(renderDateButton(date, iso => { state.selectedDate = iso; state.selectedDayId = null; state.editScope = "routine"; render(); }, "overview-date"));
  wrap.appendChild(hero);

  const grid = el(`<div class="overview-grid"><div class="overview-main"></div><aside class="overview-side"></aside></div>`);
  const main = grid.querySelector(".overview-main");
  const side = grid.querySelector(".overview-side");
  const planCard = el(`<section class="overview-card"><div class="overview-card-head"><div><h2>Today's Plan</h2></div></div></section>`);
  if (label) {
    const icon = label === "Mobility Day" ? "🧘" : label === "Rest Day" ? "🌿" : label === "Cardio Day" ? "🏃" : label === "Core Day" ? "🧩" : "💪";
    const slot = el(`<div class="overview-slot"><span class="overview-icon"></span><div><strong></strong></div></div>`);
    slot.querySelector(".overview-icon").textContent = icon;
    slot.querySelector("strong").textContent = label;
    planCard.appendChild(slot);
  } else {
    planCard.appendChild(el(`<div class="overview-empty">No day plan is saved for this date yet. Set the week in Log.</div>`));
  }
  main.appendChild(planCard);

  const activities = overviewActivitiesFor(date);
  if (activities.length) {
    const cardio = el(`<section class="overview-card"><div class="overview-card-head"><div><h2>Cardio</h2></div></div></section>`);
    activities.forEach(activity => {
      const row = el(`<div class="overview-slot"><span class="overview-icon"></span><div><strong></strong></div></div>`);
      row.querySelector(".overview-icon").textContent = overviewCardioIcon(activity.name);
      row.querySelector("strong").textContent = activity.name;
      const content = row.querySelector(".overview-slot > div");
      if (activity.className) {
        const classLine = document.createElement("small");
        classLine.textContent = activity.className;
        content.appendChild(classLine);
      }
      if (activity.detail) {
        const detailLine = document.createElement("small");
        detailLine.textContent = activity.detail;
        content.appendChild(detailLine);
      }
      cardio.appendChild(row);
    });
    main.appendChild(cardio);
  }

  const pt = overviewPT(date);
  const ptCard = el(`<section class="overview-card overview-pt"><div class="overview-card-head"><div><h2>Achilles PT</h2><p class="overview-muted"></p></div><span class="overview-pill gold"></span></div></section>`);
  ptCard.querySelector(".overview-muted").textContent = pt.title;
  ptCard.querySelector(".overview-pill").textContent = pt.minutes;
  pt.items.forEach(([name,dose,instruction]) => {
    const row = el(`<div class="overview-pt-row"><strong></strong><span></span><p></p></div>`);
    row.querySelector("strong").textContent = name;
    row.querySelector("span").textContent = dose;
    row.querySelector("p").textContent = instruction;
    ptCard.appendChild(row);
  });
  side.appendChild(ptCard);
  side.appendChild(el(`<section class="overview-card"><div class="overview-card-head"><div><h2>Recovery</h2></div></div><div class="overview-recovery"><strong>Heel check-in</strong><p>Pay attention during and after activity, and to next-morning stiffness. If symptoms trend upward or affect walking, reduce loading and contact your PT.</p></div></section>`));
  wrap.appendChild(grid);
  return wrap;
}
function renderWeekOverview() {
  const weekStart = overviewWeekStart(state.selectedDate);
  const wrap = el(`<main class="week-overview-wrap"></main>`);
  const top = el(`<section class="week-overview-top"><div><div class="week-overview-kicker">WEEK AT A GLANCE</div><h1>Monday through Sunday</h1><div class="week-overview-range"></div></div><div class="week-overview-controls"></div></section>`);
  top.querySelector(".week-overview-range").textContent = overviewWeekRange(weekStart);
  const controls = top.querySelector(".week-overview-controls");
  controls.appendChild(renderOverviewModeToggle("week"));
  const moveWeek = (amount) => { state.selectedDate = addDaysIso(weekStart, amount * 7); state.editScope = "routine"; render(); };
  const previous = el(`<button type="button" class="week-overview-nav" aria-label="Previous week">‹</button>`);
  previous.onclick = () => moveWeek(-1);
  const choose = el(`<button type="button" class="week-overview-choose">Choose week</button>`);
  choose.onclick = () => openDatePickerModal(state.selectedDate, iso => { state.selectedDate = iso; state.editScope = "routine"; render(); });
  const next = el(`<button type="button" class="week-overview-nav" aria-label="Next week">›</button>`);
  next.onclick = () => moveWeek(1);
  const print = el(`<button type="button" class="week-overview-print">Print</button>`);
  print.onclick = () => window.print();
  controls.append(previous, choose, next, print);
  wrap.appendChild(top);
  const ptNote = el(`<p class="overview-muted"></p>`);
  const nextPTNames = {1:"Day 1 — Existing PT routine",2:"Day 2 — Towel Day",3:"Day 3 — Feet Flex & Stretch"};
  ptNote.textContent = "PT rotation: next is " + nextPTNames[overviewPTNextDay()] + ". It advances only when a session is marked complete; rest days do not advance it.";
  wrap.appendChild(ptNote);

  const days = el(`<div class="week-overview-days"></div>`);
  for (let i = 0; i < 7; i++) {
    const date = addDaysIso(weekStart, i);
    const dateObj = new Date(date + "T12:00:00");
    const weekday = dateObj.toLocaleDateString(undefined, { weekday:"long" });
    const day = el(`<section class="week-overview-day"><div class="week-overview-date"><span class="week-overview-weekday"></span><strong></strong></div><div class="week-overview-plan"></div><div class="week-overview-activities"></div><div class="week-overview-pt"></div></section>`);
    day.querySelector(".week-overview-weekday").textContent = weekday;
    day.querySelector(".week-overview-date strong").textContent = dateObj.toLocaleDateString(undefined, { month:"short", day:"numeric" });
    const plan = overviewDayLabel(date);
    day.querySelector(".week-overview-plan").textContent = plan || "—";

    const activityHolder = day.querySelector(".week-overview-activities");
    const activities = overviewActivitiesFor(date);
    if (!activities.length) {
      const none = el(`<div class="week-overview-empty">—</div>`);
      activityHolder.appendChild(none);
    } else {
      activities.forEach(activity => {
        const row = el(`<div class="week-overview-activity"><strong></strong><div class="week-overview-class"></div><div class="week-overview-detail"></div></div>`);
        row.querySelector("strong").textContent = activity.name;
        if (activity.className) row.querySelector(".week-overview-class").textContent = activity.className;
        else row.querySelector(".week-overview-class").remove();
        if (activity.detail) row.querySelector(".week-overview-detail").textContent = activity.detail;
        else row.querySelector(".week-overview-detail").remove();
        activityHolder.appendChild(row);
      });
    }

    const pt = overviewPT(date, true);
    const ptHolder = day.querySelector(".week-overview-pt");
    const ptHead = el(`<div class="week-overview-pt-title"></div>`);
    ptHead.textContent = `ACHILLES PT · ${pt.title}${pt.minutes ? " · " + pt.minutes : ""}`;
    ptHolder.appendChild(ptHead);
    pt.items.forEach(([name, dose]) => {
      const item = el(`<div class="week-overview-pt-item"><strong></strong><span></span></div>`);
      item.querySelector("strong").textContent = name;
      item.querySelector("span").textContent = dose;
      ptHolder.appendChild(item);
    });
    days.appendChild(day);
  }
  wrap.appendChild(days);
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
  const dayLog = logs[state.selectedDate];
  const savedType = dayLog?.dayId;
  const legacyPilatesPlan = savedType === "cardio" && dayLog?.plan?.primary === "pilates" && !dayLogHasRealData(dayLog,state.selectedDate);
  const plannedType = trackerDayForPlanPrimary(dayLog?.plan?.primary) || dayLog?.plan?.primaryDayId;
  const id = legacyPilatesPlan ? "pilates" : (plannedType || savedType || state.selectedDayId);
  return DAYS.find((d) => d.id === id) || null;
}

function setDayType(dayId) {
  const date = state.selectedDate;
  const existing = logs[date];
  // If this date already has real logged data under a different type,
  // switching it needs an explicit confirmation — a stray pill tap (e.g.
  // just glancing at another day-type's list) shouldn't silently relabel
  // an already-completed session.
  if (existing && existing.dayId && existing.dayId !== dayId && dayLogHasRealData(existing, state.selectedDate)) {
    const existingLabel = DAYS.find((d) => d.id === existing.dayId)?.label || existing.dayId;
    const newLabel = DAYS.find((d) => d.id === dayId)?.label || dayId;
    const ok = confirm(`${fmtDate(date)} already has logged ${existingLabel} data.\n\nSwitch this date's type to ${newLabel} instead? The logged exercises stay visible in History either way — this only changes which type this date is tagged as.`);
    if (!ok) return;
  }
  if (!logs[date]) logs[date] = { dayId, entries: {} };
  logs[date].dayId = dayId;
  // Keep the weekly plan in step: changing the type here updates that
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
  syncPlannedLevelUpActivity(state.selectedDate);
  const wrap = document.createElement("div");
  wrap.appendChild(renderActivityDateBar());
  const current = selectedDayInfo();
  const header = el(`<div class="day-header"><div class="day-name">${current ? current.label : "No activity planned"}</div></div>`);
  wrap.appendChild(header);
  if (current && current.id !== "rest") {
    const scopeWrap = el(`<label class="routine-scope-control">Changes apply to <select aria-label="Editing scope"><option value="routine">Saved routine</option><option value="today">This workout only</option></select></label>`);
    const scopeSelect = scopeWrap.querySelector("select");
    scopeSelect.value = state.editScope || "routine";
    scopeSelect.onchange = () => { state.editScope = scopeSelect.value; };
    wrap.appendChild(scopeWrap);
    if (state.routineNotice) {
      wrap.appendChild(el(`<div class="routine-save-notice">${safeText(state.routineNotice)}</div>`));
      state.routineNotice = "";
    }
  }
  wrap.appendChild(renderDayClassSection(state.selectedDate));

  // Marathon plan: today's prescribed run (if the plan is set up and this
  // date falls inside it). Independent of the lifting day type below.
  const planNote = renderPlanNote(state.selectedDate);
  if (planNote) wrap.appendChild(planNote);

  const runStrip = renderRunStrip(state.selectedDate);
  if (runStrip) wrap.appendChild(runStrip);

  if (!current) {
    const prompt = el(`<div class="empty-state">Choose this date’s Primary activity in Plan, then return here to log it.</div>`);
    const button = el(`<button class="btn-primary plan-from-log">Open Plan</button>`);
    button.onclick = () => { state.tab = "plan"; render(); };
    prompt.appendChild(button);
    wrap.appendChild(prompt);
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
        No exercises are assigned to ${current.label} yet. Assign exercises in Exercise Bank to have Planning add them here, or add one directly below.
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
    const groupBtn = el(`<button class="group-btn">🔗 Create Superset</button>`);
    groupBtn.onclick = () => openGroupModal(current.id);
    actionRow.appendChild(groupBtn);
  }

  const hasLoggedToday = dayLogHasRealData(todayLog, todayISO());
  if (hasLoggedToday) {
    const clearDayBtn = el(`<button class="clear-day-btn">🗑 Clear This Day's Log</button>`);
    clearDayBtn.onclick = () => clearSingleDay(state.selectedDate);
    actionRow.appendChild(clearDayBtn);
  }
  wrap.appendChild(actionRow);

  wrap.appendChild(renderFinisherSection(current.id, todayLog, tabCursor, new Set(dayExercises.map(ex => bankKey(ex.name || "")))));

  return wrap;
}

// What the weekly plan has down for this date (if anything).
const PLAN_LABELS = {
  swim: "Swim", ellip: "Elliptical", upper: "Upper Lift", "upper-b": "Upper Lift", lower: "Lower Lift", "lower-b": "Lower Lift", fullbody: "Full Body",
  core: "Core", mob: "Mobility", pilates: "Pilates Reformer", "cardio-class": "Cardio", walk: "Walking",
  treadmill: "Treadmill", run: "Marathon run", rest: "Rest", cardio: "Cardio",
  "lu-swim": "Swim", "lu-ellip": "Elliptical", "lu-dance": "Dance", "lu-yoga": "Yoga", "lu-meditation": "Meditation",
  "lu-pilates": "Pilates", "lu-walk": "Walking", "lu-treadmill": "Treadmill", "lu-aquafit": "Aquafit", "lu-marathon": "Marathon training",
  "lu-cooldown": "Mindful Cooldown", "lu-rest": "Just rest!", "lu-core": "Core Toning", "lu-mob": "Mobility",
  "walk-lunch": "Walk at lunch",
};
function planPrimaryForTracker(date, dayId) {
  if (dayId === "mobility") return "mob";
  if (dayId === "pilates") return "pilates";
  if (dayId !== "cardio") return dayId; // upper, lower, core, rest match 1:1
  const names = getExerciseList(date, "cardio").map((e) => (e.name || "").toLowerCase()).join(" | ");
  if (/swim|pool|lap/.test(names)) return "swim";
  if (/ellip/.test(names)) return "ellip";
  if (/treadmill/.test(names)) return "treadmill";
  if (/walk/.test(names)) return "walk";
  if (/pilates/.test(names)) return "pilates";
  if (/class/.test(names)) return "cardio";
  return "cardio";
}
function renderPlanNote(date) {
  const plan = logs[date]?.plan;
  if (!plan) return null;
  let text;
  if (plan.isCommute) text = `Commute day: ${PLAN_LABELS[plan.commute] || "walk at lunch"}`;
  else {
    const parts = [];
    if (plan.primary) parts.push(planPrimaryLabel(plan.primary, plan));
    if (plan.levelup) parts.push(planOptionLabel(plan.levelup, plan));
    if (!parts.length) return null;
    text = parts.join(", ");
  }
  return el(`<div class="plan-note">📋 Planned: ${text}</div>`);
}

// A finisher list works exactly like a primary day's exercises — same
// cards, same Add Exercise modal (bank included), same edit/delete/superset
// grouping — just stored under its own key and shown in a separate section.
// sharedTabCursor continues the SAME tabindex sequence as the primary list
// above it — using a fresh cursor here would hand out duplicate tabindex
// values, and the browser resolves duplicates by jumping to whichever one
// comes first in the DOM (i.e. back up to the primary list).
function renderFinisherSection(dayId, todayLog, sharedTabCursor, excludedNames = new Set()) {
  const wrap = document.createElement("div");
  const fKey = finisherKey(dayId);
  const finisherExercises = getExerciseList(state.selectedDate, fKey).filter(ex => !excludedNames.has(bankKey(ex.name || "")));

  if (finisherExercises.length > 0) {
    wrap.appendChild(el(`<div class="finisher-heading">🏃 Additional Activities / Finishers</div>`));
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

  if (finisherExercises.filter(e => !e.groupId).length >= 2) {
    const groupBtn = el(`<button class="group-btn finisher-group-btn">🔗 Create Superset</button>`);
    groupBtn.onclick = () => openGroupModal(fKey);
    wrap.appendChild(groupBtn);
  }
  const addBtn = el(`<button class="finisher-add-btn">🏃 + Add Activity / Finisher</button>`);
  addBtn.onclick = () => openAddExerciseModal(fKey);
  wrap.appendChild(addBtn);

  return wrap;
}

// Groups exercises sharing a groupId into one combined superset render item,
// preserving first-appearance order; everything else renders solo as before.
function buildRenderPlan(dayExercises) {
  const plan = [];
  const seen = new Set();
  const seenNames = new Set();
  dayExercises.forEach((ex) => {
    if (seen.has(ex.id)) return;
    const normalizedName = bankKey(ex.name || "");
    if (normalizedName && seenNames.has(normalizedName)) return;
    if (normalizedName) seenNames.add(normalizedName);
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
        <span class="circuit-label">🔗 Superset · ${members.length} exercises</span>
        <div class="superset-actions"><button class="superset-move-up-btn" title="Move entire superset up">▲</button><button class="superset-move-down-btn" title="Move entire superset down">▼</button><button class="circuit-ungroup-btn">Separate for this workout</button></div>
      </div>
    </div>
  `);
  members.forEach((ex) => {
    const entry = todayLog.entries?.[ex.id];
    const sets = entry?.sets || defaultSets(ex);
    const blockSize = sets.length * (ex.trackType === "weight" ? 2 : 1);
    wrapper.appendChild(renderExerciseCard(ex, sets, tabCursor.next(blockSize), dayId));
  });
  wrapper.querySelector(".circuit-ungroup-btn").onclick = () => ungroupCircuit(dayId, groupId, true);
  wrapper.querySelector(".superset-move-up-btn").onclick = () => moveExerciseInList(dayId, members[0].id, -1);
  wrapper.querySelector(".superset-move-down-btn").onclick = () => moveExerciseInList(dayId, members[0].id, 1);
  return wrapper;
}

function ungroupCircuit(listKey, groupId, temporary = false) {
  const date = state.selectedDate;
  if (!confirm(temporary
    ? "Separate this superset for this workout only? Your saved superset will remain unchanged."
    : "Remove this superset grouping from the saved routine?")) return;
  const list = getExerciseList(date, listKey).map((e) => e.groupId === groupId ? { ...e, groupId: undefined } : e);
  state.editScope = temporary ? "today" : "routine";
  setExerciseList(date, listKey, list, state.editScope);
  render();
}

function generateGroupId() {
  return "grp_" + Math.random().toString(36).slice(2, 8);
}

function openGroupModal(dayId, routineBuilder = false) {
  const date = state.selectedDate;
  const dayExercises = routineBuilder ? (library[dayId] || []) : getExerciseList(date, dayId);
  const ungrouped = dayExercises.filter((e) => !e.groupId);
  if (ungrouped.length < 2) {
    alert("You need at least 2 ungrouped exercises in this routine to create a superset.");
    return;
  }

  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`
    <div class="modal">
      <h3>Create Superset</h3>
      <div class="field-hint" style="margin-bottom:14px;">Pick 2 or more ungrouped exercises. Each exercise can belong to only one superset. ${routineBuilder ? "This updates the reusable routine only; dated workouts remain editable." : "You can save the group with the routine or use it for this workout only."}</div>
      <div id="group-check-list" class="check-grid one-col"></div>
      <div class="modal-actions">
        <button class="btn-secondary" id="group-cancel-btn">Cancel</button>
        ${routineBuilder ? "" : '<button class="btn-secondary" id="group-save-today-btn">This workout only</button>'}
        <button class="btn-primary" id="group-save-btn">Save to routine</button>
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
  const saveGroup = (scope) => {
    const selected = [...list.querySelectorAll("input:checked")].map((c) => c.value);
    if (selected.length < 2) { alert("Pick at least 2 exercises."); return; }
    const groupId = generateGroupId();
    const source = routineBuilder ? (library[dayId] || []) : getExerciseList(date, dayId);
    const updated = source.map((e) => selected.includes(e.id) ? { ...e, groupId } : e);
    if (!routineBuilder) state.editScope = scope;
    setExerciseList(date, dayId, updated, scope);
    document.body.removeChild(overlay);
    render();
  };
  modal.querySelector("#group-save-btn").onclick = () => saveGroup("routine");
  if (!routineBuilder) modal.querySelector("#group-save-today-btn").onclick = () => saveGroup("today");

  document.body.appendChild(overlay);
  trapFocus(overlay);
}

function openSubstituteModal(dayId, exId) {
  const date = state.selectedDate;
  const current = getExerciseList(date, dayId).find(e => e.id === exId);
  if (!current) return;
  const options = Object.entries(bank).filter(([key, entry]) => !entry?.archived && key !== bankKey(current.name || ""));
  if (!options.length) { alert("Add another exercise to the Exercise Bank before substituting."); return; }
  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`<div class="modal"><h3>Substitute ${safeText(current.name)}</h3>
    <div class="form-row"><label for="substitute-choice">Replacement exercise</label><select id="substitute-choice"></select></div>
    <div class="field-hint">Use the replacement for this workout, or remember it as an alternative to the original exercise.</div>
    <div class="modal-actions"><button class="btn-secondary" id="sub-cancel">Cancel</button><button class="btn-secondary" id="sub-once">Use this workout</button><button class="btn-primary" id="sub-remember">Use & remember alternative</button></div>
  </div>`);
  const select = modal.querySelector('#substitute-choice');
  const savedAlternatives = new Set(bank[bankKey(current.name || "")]?.alternatives || []);
  options.sort((a,b)=>Number(savedAlternatives.has(b[0]))-Number(savedAlternatives.has(a[0])) || a[1].name.localeCompare(b[1].name)).forEach(([key,entry]) => { const opt=document.createElement('option'); opt.value=key; opt.textContent=entry.name + (savedAlternatives.has(key) ? " · saved alternative" : ""); select.appendChild(opt); });
  const apply = (remember, scope) => {
    const key = select.value, entry = bank[key]; if (!entry) return;
    const bankReplacement = bankExerciseForPlan(key);
    if (!bankReplacement) return;
    const replacement = {...bankReplacement, id:`sub_${slugify(bankReplacement.name)}`, substitutedFrom:current.id};
    if (remember) {
      const originalKey = bankKey(current.name || '');
      bank[originalKey] ||= {name:current.name, type:current.type, trackType:current.trackType, weights:current.weights || [], targets:current.targets || null};
      const alternatives = new Set(bank[originalKey].alternatives || []); alternatives.add(key);
      bank[originalKey].alternatives = [...alternatives]; saveBank(bank);
    }
    const updated = getExerciseList(date, dayId).map(e => e.id === exId ? {...replacement, groupId:e.groupId} : e);
    state.editScope = scope;
    setExerciseList(date, dayId, updated, scope);
    overlay.remove(); render();
  };
  modal.querySelector('#sub-cancel').onclick=()=>overlay.remove();
  modal.querySelector('#sub-once').onclick=()=>apply(false, 'today');
  modal.querySelector('#sub-remember').onclick=()=>apply(true, state.editScope || 'routine');
  overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};
  document.body.appendChild(overlay); trapFocus(overlay);
}

function latestLoggedWeights(ex, beforeDate) {
  const wantedName = bankKey(ex?.name || "");
  const exerciseMap = allExercises();
  const dates = Object.keys(logs || {}).filter(date => date < beforeDate).sort().reverse();
  for (const date of dates) {
    const day = logs[date];
    const candidates = Object.entries(day?.entries || {}).filter(([id, entry]) => {
      if (!Array.isArray(entry?.sets) || !entry.sets.some(set => set.weight != null && set.weight !== "" && Number.isFinite(Number(set.weight)))) return false;
      if (id === ex.id) return true;
      const definition = day.completedExercises?.[id] || Object.values(day.lists || {}).flat().find(item => item.id === id) || exerciseMap[id];
      return !!wantedName && bankKey(definition?.name || "") === wantedName;
    });
    if (candidates.length) return candidates[candidates.length - 1][1].sets.map(set => set.weight);
  }
  return [];
}
function numericWeight(value) {
  return value != null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
}
function defaultSets(ex, date = state.selectedDate) {
  const n = exNumSets(ex);
  if (ex.trackType === "weight") {
    const recent = Array.isArray(bank[bankKey(ex.name || "")]?.weights) ? bank[bankKey(ex.name || "")].weights : [];
    const historical = latestLoggedWeights(ex, date);
    const planned = Array.isArray(ex.weights) ? ex.weights : [];
    const fallback = [...recent, ...historical, ...planned].map(numericWeight).filter(value => value != null).at(-1) ?? 20;
    return Array.from({length:n},(_,i) => ({
      weight:numericWeight(recent[i]) ?? numericWeight(historical[i]) ?? numericWeight(planned[i]) ?? fallback,
      reps:null,
    }));
  }
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

  const card = el(`<div class="ex-card ${allTopped ? "topped" : ""}" data-ex-id="${ex.id}" data-list-key="${dayId}"></div>`);
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
        <button class="ex-substitute-btn" title="Substitute exercise">⇄</button>
        <button class="ex-delete-btn" title="Remove exercise">✕</button>
      </div>
    </div>
  `);
  top.querySelector(".plate-stack").appendChild(buildPlates(sets, ex));
  top.querySelector(".ex-move-up-btn").onclick = () => moveExerciseInList(dayId, ex.id, -1);
  top.querySelector(".ex-move-down-btn").onclick = () => moveExerciseInList(dayId, ex.id, 1);
  top.querySelector(".ex-edit-btn").onclick = () => openEditExerciseModal(dayId, ex.id);
  top.querySelector(".ex-substitute-btn").onclick = () => openSubstituteModal(dayId, ex.id);
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
      inputs[0].onchange = (e) => updateSet(ex.id, i, "weight", Number(e.target.value), dayId, ex);
    }
    repsInput.onchange = (e) => {
      const val = e.target.value === "" ? null : Number(e.target.value);
      e.target.classList.toggle("has-reps", val != null);
      updateSet(ex.id, i, "reps", val, dayId, ex);
    };
    setRow.appendChild(col);
  });
  card.appendChild(setRow);

  if (!zoneTracked) {
    const addSetBtn = el(`<button type="button" class="summary-btn add-set-btn">+ Add Set</button>`);
    addSetBtn.onclick = () => addWorkoutSet(ex, dayId);
    card.appendChild(addSetBtn);
  }

  const footer = el(`<div class="ex-card-footer"></div>`);
  fillCardFooter(footer, ex, allTopped, dayId);
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

function fillCardFooter(footer, ex, allTopped, listKey = null) {
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
  applyBtn.onclick = () => applyProgression(ex.id, listKey);
  footer.appendChild(applyBtn);
}

// Updates just one exercise card's visuals in place (plate stack + footer) —
// deliberately does NOT touch the <input> elements, so focus and native Tab
// order are never disturbed while you're logging sets.
function refreshExerciseCard(exId, sets, exerciseSnapshot = null) {
  const card = document.querySelector(`.ex-card[data-ex-id="${cssEscape(exId)}"]`);
  const ex = exerciseSnapshot || allExercises()[exId];
  if (!ex || !card) return;
  const allTopped = computeAllTopped(sets, ex);
  card.classList.toggle("topped", allTopped);
  const plateStack = card.querySelector(".plate-stack");
  plateStack.innerHTML = "";
  plateStack.appendChild(buildPlates(sets, ex));
  fillCardFooter(card.querySelector(".ex-card-footer"), ex, allTopped, card.dataset.listKey);
}

function refreshActiveDayPillDone() {
  const pill = document.querySelector(".day-pill.active");
  if (!pill) return;
  const date = state.selectedDate;
  pill.classList.toggle("done", dayLogHasRealData(logs[date], date));
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

// Clears logged data for exactly one date — nothing else. Exercise library
// and bank are never touched by this.
function clearSingleDay(date) {
  const dayLog = logs[date];
  if (!dayLogHasRealData(dayLog, date)) {
    alert("Nothing logged on this day yet.");
    return;
  }
  const dayInfo = DAYS.find((d) => d.id === dayLog.dayId);
  const ok = confirm(`Clear all logged data for ${fmtDate(date)} (${dayInfo ? dayInfo.label : "this day"})?\n\nOnly this one day is affected — nothing else is touched. This can't be undone.`);
  if (!ok) return;
  // Keep the weekly plan for this date; only the logged data goes.
  const plan = logs[date].plan;
  const lists = logs[date].lists;
  const planListKeys = logs[date].planListKeys;
  const routineOverrides = logs[date].routineOverrides;
  delete logs[date];
  if (plan || lists || routineOverrides) logs[date] = { dayId: dayLog.dayId, entries: {}, ...(plan ? {plan} : {}), ...(lists ? {lists} : {}), ...(planListKeys ? {planListKeys} : {}), ...(routineOverrides ? {routineOverrides} : {}) };
  saveLogs(logs);
  render();
}

function moveExerciseInList(listKey, exId, direction, routineBuilder = false) {
  const date = state.selectedDate;
  const list = [...(routineBuilder ? (library[listKey] || []) : getExerciseList(date, listKey))];
  const idx = list.findIndex((e) => e.id === exId);
  if (idx === -1) return;
  const groupId = list[idx].groupId || null;
  const block = groupId ? list.filter(e => e.groupId === groupId) : [list[idx]];
  const blockIds = new Set(block.map(e => e.id));
  const remaining = list.filter(e => !blockIds.has(e.id));
  const firstOriginal = Math.min(...list.map((e,i) => blockIds.has(e.id) ? i : Infinity));
  const insertionBefore = list.slice(0, firstOriginal).filter(e => !blockIds.has(e.id)).length;
  const currentIndex = insertionBefore;
  const targetIndex = direction < 0 ? currentIndex - 1 : currentIndex;
  if (targetIndex < 0 || targetIndex >= remaining.length) return;
  const neighbor = remaining[targetIndex];
  const neighborGroup = neighbor.groupId || null;
  const neighborBlock = neighborGroup ? remaining.filter(e => e.groupId === neighborGroup) : [neighbor];
  const neighborIds = new Set(neighborBlock.map(e => e.id));
  const neighborStart = remaining.findIndex(e => neighborIds.has(e.id));
  const insertAt = direction < 0 ? neighborStart : neighborStart + neighborBlock.length;
  remaining.splice(insertAt, 0, ...block);
  setExerciseList(date, listKey, remaining, routineBuilder ? "routine" : undefined);
  render();
}

function removeExerciseFromDay(dayId, exId, routineBuilder = false) {
  const date = state.selectedDate;
  const sourceList = routineBuilder ? (library[dayId] || []) : getExerciseList(date, dayId);
  const ex = sourceList.find(item => item.id === exId) || allExercises()[exId];
  if (!ex) return;
  const scopeOptions = routineBuilder
    ? `<option value="routine">Remove from the saved routine</option><option value="archive">Archive from Exercise Bank</option><option value="delete">Permanently delete from Exercise Bank</option>`
    : `<option value="today">Remove from this workout only</option><option value="routine">Remove from the saved routine</option><option value="archive">Archive from Exercise Bank</option><option value="delete">Permanently delete from Exercise Bank</option>`;
  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`<div class="modal"><h3>Remove ${safeText(ex.name)}</h3>
    <div class="form-row"><label for="remove-scope">What would you like to do?</label>
      <select id="remove-scope">${scopeOptions}</select>
    </div>
    <div class="field-hint">Workout history is retained. Permanent deletion cannot be undone.</div>
    <div class="modal-actions"><button class="btn-secondary" id="remove-cancel">Cancel</button><button class="btn-primary" id="remove-confirm">Continue</button></div>
  </div>`);
  overlay.appendChild(modal);
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  modal.querySelector('#remove-cancel').onclick = () => overlay.remove();
  modal.querySelector('#remove-confirm').onclick = () => {
    const choice = modal.querySelector('#remove-scope').value;
    if (choice === 'delete' && !confirm(`Permanently delete ${ex.name} from the Exercise Bank? Historical workout records will remain, but the bank entry cannot be recovered.`)) return;
    preserveCompletedExerciseDetails(date);
    if (logs[date]?.plan?.levelupExerciseId === exId) {
      logs[date].plan.levelup = '';
      delete logs[date].plan.levelupName; delete logs[date].plan.levelupExerciseId;
      delete logs[date].plan.levelupExerciseKey; delete logs[date].plan.levelupExerciseListKey;
    }
    const updated = (routineBuilder ? (library[dayId] || []) : getExerciseList(date, dayId)).filter(e => e.id !== exId);
    if (ex.groupId) {
      const remaining = updated.filter(e => e.groupId === ex.groupId);
      if (remaining.length === 1) { const i = updated.findIndex(e => e.id === remaining[0].id); updated[i] = {...updated[i], groupId:undefined}; }
    }
    if (choice === 'today' || choice === 'routine') {
      if (!routineBuilder) state.editScope = choice;
      setExerciseList(date, dayId, updated, choice);
      if (choice === 'routine' && !dayId.endsWith('_finisher')) {
        const key = bankKey(ex.name || "");
        if (bank[key]?.dayDesignation === dayId) { bank[key].dayDesignation = ""; saveBank(bank); }
      }
    }
    // Archiving/deleting from the Bank does not silently remove an exercise
    // from existing routines or historical workouts.
    if (choice === 'archive') { bank[bankKey(ex.name)] = {...(bank[bankKey(ex.name)] || {}), archived:true}; saveBank(bank); }
    if (choice === 'delete') { delete bank[bankKey(ex.name)]; saveBank(bank); }
    overlay.remove(); render();
  };
  document.body.appendChild(overlay); trapFocus(overlay);
}

function updateSet(exId, idx, field, value, listKey = null, exerciseSnapshot = null) {
  const dayId = selectedDayInfo()?.id || state.selectedDayId;
  const snapshotKey = listKey || dayId;
  const date = state.selectedDate;
  const ex = exerciseSnapshot || allExercises()[exId];
  const current = logs[date]?.entries?.[exId]?.sets || defaultSets(ex);
  const newSets = current.map((s, i) => (i === idx ? { ...s, [field]: value } : s));

  if (!logs[date]) logs[date] = { dayId, entries: {} };
  logs[date].dayId = dayId;
  // Freeze the routine configuration the first time a workout is logged.
  if (!logs[date].routineOverrides?.[snapshotKey]) {
    logs[date].lists ||= {};
    logs[date].routineOverrides ||= {};
    logs[date].lists[snapshotKey] = getExerciseList(date, snapshotKey).map(e => ({...e}));
    logs[date].routineOverrides[snapshotKey] = true;
  }

  // Only actually persist an entry once there's real data (at least one
  // set with a value entered) — touching a weight box without ever logging
  // reps shouldn't leave a stray "logged" entry behind.
  if (entryHasData({ sets: newSets })) {
    logs[date].entries[exId] = { sets: newSets };
  } else {
    delete logs[date].entries[exId];
  }
  // Capture the exact exercise definition used by this dated workout before
  // later routine edits or same-ID reuse in another routine can change it.
  preserveCompletedExerciseDetails(date);
  saveLogs(logs);

  if (field === "weight" && ex.trackType === "weight") {
    upsertBank({ name: ex.name, type: ex.type, trackType: ex.trackType, weights: newSets.map((s) => s.weight), targets: ex.targets, customUnit: ex.customUnit });
  }

  refreshExerciseCard(exId, newSets, ex);
  refreshActiveDayPillDone();
}

function addWorkoutSet(ex, listKey) {
  const date = state.selectedDate;
  const dayId = selectedDayInfo()?.id || state.selectedDayId;
  const snapshotKey = listKey || dayId;
  const current = logs[date]?.entries?.[ex.id]?.sets || defaultSets(ex);
  const last = current[current.length - 1] || { weight:null, reps:null };
  const sets = [...current, { weight:ex.trackType === "weight" ? (last.weight ?? 20) : null, reps:null }];

  if (!logs[date]) logs[date] = { dayId, entries:{} };
  logs[date].dayId = dayId;
  logs[date].lists ||= {};
  logs[date].routineOverrides ||= {};
  if (!logs[date].routineOverrides[snapshotKey]) {
    logs[date].lists[snapshotKey] = getExerciseList(date, snapshotKey).map(item => ({...item}));
    logs[date].routineOverrides[snapshotKey] = true;
  }
  const updated = (logs[date].lists[snapshotKey] || []).map(item => item.id === ex.id
    ? {...item, numSets:sets.length,
      weights:ex.trackType === "weight" ? [...(item.weights || []), last.weight ?? 20] : item.weights,
      targets:[...(item.targets || Array.from({length:current.length},(_,i)=>targetForSet(ex,i))), targetForSet(ex,current.length)]}
    : item);
  logs[date].lists[snapshotKey] = updated;
  logs[date].entries[ex.id] = { sets };
  preserveCompletedExerciseDetails(date);
  saveLogs(logs);
  render();
}

function applyProgression(exId, listKeyHint = null) {
  const date = state.selectedDate;
  const activeDayId = selectedDayInfo()?.id || state.selectedDayId;
  const candidateKeys = [listKeyHint, activeDayId, activeDayId ? finisherKey(activeDayId) : null].filter(Boolean);
  let listKey = candidateKeys.find(key => getExerciseList(date, key).some(e => e.id === exId));
  if (!listKey) listKey = Object.keys(logs[date]?.lists || {}).find(key => getExerciseList(date, key).some(e => e.id === exId));
  if (!listKey) return;
  const currentList = getExerciseList(date, listKey);
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
  setExerciseList(date, listKey, newList);
  if (updatedEx) upsertBank(updatedEx);
  render();
}

// ---- History tab ----
function renderHistory() {
  const wrap = document.createElement("div");
  const today = todayISO();
  const dates = [...new Set([
    ...Object.keys(logs).filter((d) => d <= today && dayLogHasRealData(logs[d], d)),
    ...runDatesWithData().filter((d) => d <= today),
  ])].sort().reverse();

  const exportBtn = el(`<button class="summary-btn" style="margin-bottom:14px;">⬇ Export CSV</button>`);
  exportBtn.onclick = openExportModal;
  wrap.appendChild(exportBtn);
  const backupBtn = el(`<button class="summary-btn" style="margin:0 0 14px 8px;">Backup / Restore</button>`);
  backupBtn.onclick = openBackupRestoreModal;
  wrap.appendChild(backupBtn);
  const historicAddBtn = el(`<button class="summary-btn" style="margin:0 0 14px 8px;">+ Add Past Class</button>`);
  historicAddBtn.onclick = openHistoricClassEntry;
  wrap.appendChild(historicAddBtn);
  const missingToggle = el(`<label style="display:block;margin:0 0 12px"><input type="checkbox" id="cl-missing-filter"> Show only workouts missing a class</label>`);
  missingToggle.querySelector('input').onchange = () => {
    const only = missingToggle.querySelector('input').checked;
    wrap.querySelectorAll('.hist-card[data-missing-class]').forEach(card => { card.hidden = only && card.dataset.missingClass !== 'true'; });
  };
  wrap.appendChild(missingToggle);

  if (dates.length === 0) {
    wrap.appendChild(el(`<div class="empty-state">No sessions logged yet.</div>`));
    return wrap;
  }

  const exMap = allExercises();
  dates.forEach((date) => {
    const dayLog = logs[date] || { entries: {} };
    const runLine = runHistoryLine(date);
    const dayInfo = DAYS.find((d) => d.id === dayLog.dayId);
    const marathonDayInfo = dayLog.plan?.primary === "run" || runLine
      ? DAYS.find((d) => d.id === marathonDesignationId())
      : null;
    const dayLabels = [...new Set([
      dayInfo?.label || "",
      marathonDayInfo && marathonDayInfo.id !== dayInfo?.id ? marathonDayInfo.label : "",
      runLine ? "Run" : "",
    ].filter(Boolean))].join(" + ");
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
      const ex = dayLog.completedExercises?.[exId] || exMap[exId];
      if (!ex || !entryHasData(entry)) return;
      const designation = dayLog.completedExercises?.[exId]?.dayDesignation || bank[bankKey(ex.name)]?.dayDesignation;
      const designationTag = designation ? ` <span class="hist-ex-designation">${safeText(dayDesignationLabel(designation))}</span>` : "";
      const unit = exUnitLabel(ex);
      const setStr = entry.sets.map((s, i) => {
        if (s.reps == null) return "–";
        const prefix = isZoneTracked(ex) ? `Z${i + 1}: ` : "";
        return ex.trackType === "weight" ? `${s.weight}×${s.reps}` : `${prefix}${s.reps}${unit === "sec" ? "s" : " " + unit}`;
      }).join(", ");
      const totalStr = isZoneTracked(ex)
        ? ` (Total: ${entry.sets.reduce((sum, s) => sum + (s.reps || 0), 0)} min)`
        : "";
      card.appendChild(el(`<div class="hist-line"><b>${ex.name}:</b>${designationTag} ${setStr}${totalStr}</div>`));
    });
    // Show only classes actually associated with a saved workout session.
    // A class existing in the library alone never counts as completed.
    const completedClassSessions = dayLog.classSessions || {};
    Object.entries(completedClassSessions).forEach(([exerciseId, session]) => {
      if (!session?.classId || !classSessionHasCompletion(exerciseId, session, dayLog, date)) return;
      const completedClass = classFor(session.classId);
      if (!completedClass) return;
      const exercise = exMap[exerciseId];
      const exerciseName = session.exerciseName || exercise?.name || '';
      const summary = el(`<div class="cl-completed-summary" aria-label="Completed guided class">
        <span class="cl-completed-check" aria-hidden="true">✓</span>
        <div class="cl-completed-text">
          <strong>${safeText(classLabel(completedClass))}</strong>
          <small>${safeText([exerciseName, completedClass.platform, 'Class completed'].filter(Boolean).join(' · '))}</small>
        </div>
      </div>`);
      card.appendChild(summary);
    });
    if (dayLog.note) {
      card.appendChild(el(`<div class="hist-line"><b>Notes:</b> ${dayLog.note}</div>`));
    }
    if (dayLog.finisherNote) {
      card.appendChild(el(`<div class="hist-line"><b>🏃 Cardio Finisher:</b> ${dayLog.finisherNote}</div>`));
    }
    const histIds = Object.entries(dayLog.entries || {}).filter(([,e]) => entryHasData(e)).map(([id])=>id);
    card.dataset.missingClass = String(histIds.some(id => !logs[date]?.classSessions?.[id]?.classId));
    attachHistoryClassButtons(card, date, dayLog, exMap);
    wrap.appendChild(card);
  });

  return wrap;
}

// ---- Export filters modal ----
function openBackupRestoreModal() {
  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`<div class="modal"><h3>Backup / Restore Tracker</h3>
    <p class="field-hint">A full backup includes routines, exercise order, saved supersets, the Exercise Bank, workout history, classes and tracker settings.</p>
    <div class="modal-actions"><button class="btn-primary" id="backup-download">Download full backup</button></div>
    <div class="form-row" style="margin-top:16px"><label for="backup-file">Restore from a backup file</label><input type="file" id="backup-file" accept="application/json,.json" /></div>
    <div class="field-hint">Restore replaces the current tracker data with the selected backup, preventing duplicate workout records. Download a current backup first if you may need it.</div>
    <div class="modal-actions"><button class="btn-secondary" id="backup-close">Close</button><button class="btn-primary" id="backup-restore" disabled>Restore backup</button></div>
  </div>`);
  let parsed = null;
  modal.querySelector('#backup-download').onclick = () => {
    const payload = {format:'total-transformation-tracker-backup', version:APP_VERSION, exportedAt:new Date().toISOString(), library, libraryUpdatedAt, logs, bank, bankUpdatedAt, classes, dayDesignations, marathon};
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`total-transformation-tracker-backup-${todayISO()}.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  modal.querySelector('#backup-file').onchange = async e => {
    const file=e.target.files?.[0]; parsed=null;
    if (!file) { modal.querySelector('#backup-restore').disabled=true; return; }
    try { const candidate=JSON.parse(await file.text()); if(candidate?.format!=='total-transformation-tracker-backup' || !candidate.library || !candidate.logs) throw new Error('This is not a supported tracker backup.'); parsed=candidate; modal.querySelector('#backup-restore').disabled=false; }
    catch(err) { alert(err.message || 'Could not read this backup file.'); modal.querySelector('#backup-restore').disabled=true; }
  };
  modal.querySelector('#backup-restore').onclick = () => {
    if (!parsed) return;
    if (!confirm('Replace the current tracker data with this backup? Current data will be overwritten. Download a backup first if you may need it.')) return;
    library={...structuredClone(DEFAULT_LIBRARY),...parsed.library}; libraryUpdatedAt=Math.max(Date.now(),Number(parsed.libraryUpdatedAt)||0); logs=parsed.logs || {}; bank=parsed.bank || {}; bankUpdatedAt=Math.max(Date.now(),Number(parsed.bankUpdatedAt)||0); classes=Array.isArray(parsed.classes)?parsed.classes:[];
    if (Array.isArray(parsed.dayDesignations)) { dayDesignations=normalizeDayDesignations(parsed.dayDesignations); refreshDayDefinitions(); }
    if (parsed.marathon) marathon={...structuredClone(DEFAULT_MARATHON),...parsed.marathon};
    localStorage.removeItem("iron-log-v77-schedules-cleared-from-2026-11-27");
    runV77Migrations(true);
    localStorage.setItem(LS_LIB,JSON.stringify(library)); localStorage.setItem(LS_LIBRARY_UPDATED_AT,String(libraryUpdatedAt)); localStorage.setItem(LS_LOGS,JSON.stringify(logs)); localStorage.setItem(LS_BANK,JSON.stringify(bank)); localStorage.setItem(LS_BANK_UPDATED_AT,String(bankUpdatedAt));
    localStorage.setItem(LS_CLASSES,JSON.stringify(classes)); localStorage.setItem(LS_DAY_DESIGNATIONS,JSON.stringify(dayDesignations)); localStorage.setItem(LS_MARATHON,JSON.stringify(marathon));
    state.selectedDate = todayISO(); state.selectedDayId = null; state.editScope = "routine"; state.tab = "overview";
    forceRemoteReplace = true; touchLocalUpdatedAt(); schedulePush(); overlay.remove(); render();
  };
  modal.querySelector('#backup-close').onclick=()=>overlay.remove();
  overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};
  document.body.appendChild(overlay); trapFocus(overlay);
}

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
function renderStrengthProgress() {
  const card = el(`<section class="strength-progress-card"><h2>Strength</h2><p class="strength-progress-note">Strength gains from your logged workouts. Choose an exercise to focus the table.</p><label class="strength-filter-label" for="strength-progress-filter">Filter by exercise</label><select id="strength-progress-filter"><option value="">All exercises</option></select><div class="strength-table-wrap"></div></section>`);
  const definitions = {};
  const addDefinitions = (items) => (items || []).forEach((exercise) => {
    if (exercise?.id) definitions[exercise.id] = exercise;
  });
  Object.values(library || {}).forEach(addDefinitions);
  Object.values(logs || {}).forEach((dayLog) => {
    Object.values(dayLog?.lists || {}).forEach(addDefinitions);
    Object.values(dayLog?.completedExercises || {}).forEach((exercise) => {
      if (exercise?.id) definitions[exercise.id] = exercise;
    });
  });

  const histories = {};
  Object.keys(logs || {}).sort().forEach((date) => {
    const dayLog = logs[date];
    Object.entries(dayLog?.entries || {}).forEach(([id, entry]) => {
      const exercise = definitions[id];
      if (!exercise || (exercise.trackType && exercise.trackType !== "weight")) return;
      const sets = (entry?.sets || []).filter((set) => set.reps != null && set.weight != null);
      if (!sets.length) return;
      (histories[id] ||= []).push({ date, top: Math.max(...sets.map((set) => Number(set.weight) || 0)) });
    });
  });

  const rows = Object.entries(histories)
    .filter(([, history]) => history.length >= 2)
    .map(([id, history]) => ({ id, name: definitions[id].name || "Exercise", first: history[0], last: history[history.length - 1], sessions: history.length }))
    .sort((a, b) => b.last.date.localeCompare(a.last.date) || a.name.localeCompare(b.name));
  const filter = card.querySelector("#strength-progress-filter");
  rows.forEach((row) => {
    const option = el(`<option></option>`);
    option.value = row.id;
    option.textContent = row.name;
    filter.appendChild(option);
  });
  const selectedId = rows.some((row) => row.id === state.strengthProgressFilterId) ? state.strengthProgressFilterId : "";
  state.strengthProgressFilterId = selectedId;
  filter.value = selectedId;
  filter.onchange = () => { state.strengthProgressFilterId = filter.value; render(); };

  const shownRows = selectedId ? rows.filter((row) => row.id === selectedId) : rows;
  const tableWrap = card.querySelector(".strength-table-wrap");
  if (!shownRows.length) {
    tableWrap.appendChild(el(`<div class="empty-state">Log a weighted exercise at least twice to see strength progress here.</div>`));
  } else {
    const table = el(`<table class="strength-progress-table"><thead><tr><th>Exercise</th><th>Progress</th><th>Change</th></tr></thead><tbody></tbody></table>`);
    const body = table.querySelector("tbody");
    shownRows.forEach((row) => {
      const delta = row.last.top - row.first.top;
      const tr = el(`<tr><th scope="row"></th><td></td><td></td></tr>`);
      tr.children[0].textContent = row.name;
      tr.children[1].textContent = `${row.first.top} → ${row.last.top} lbs · ${row.sessions} sessions since ${fmtDate(row.first.date)}`;
      tr.children[2].textContent = delta === 0 ? "±0" : `${delta > 0 ? "+" : ""}${delta}`;
      if (delta > 0) tr.children[2].classList.add("strength-gain");
      body.appendChild(tr);
    });
    tableWrap.appendChild(table);
  }
  return card;
}

function renderProgress() {
  const wrap = document.createElement("div");
  wrap.appendChild(renderStrengthProgress());
  const exMap = allExercises();
  const exList = Object.values(exMap);

  if (exList.length === 0) {
    wrap.appendChild(el(`<div class="empty-state">Add exercises to see individual progress charts.</div>`));
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

    const validDays = new Set(exerciseDays().map((d) => d.id));
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
      setExerciseList(date, day, newList, "routine");
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
      <div class="field-hint" style="margin-bottom:14px;">Removing something here only affects this quick-pick list — it won't touch exercises already placed on any day, or any logged history. For a full tracker backup including routines, supersets and workout history, use Backup / Restore in History.</div>
      <div class="modal-actions" style="margin-bottom:16px;">
        <button class="btn-secondary" id="bank-export-btn" style="flex:1">⬇ Export Bank</button>
        <button class="btn-secondary" id="bank-import-btn" style="flex:1">⬆ Restore Bank</button>
      </div>
      <input type="file" id="bank-import-file" accept="application/json" style="display:none" />
      <section class="bank-day-designations"><h4>Day assignments</h4><p class="field-hint">Assign exercises to a day for Planning to add them automatically. Leave an exercise Unassigned while you sort the bank; it stays available for direct Log and finisher selection. You can rename or add days at any time.</p><div class="form-row"><input id="new-day-designation" placeholder="Add a day name, e.g. Commute Day" /><button type="button" class="btn-primary" id="add-day-designation">Add day</button></div><div id="day-designation-list"></div></section><div id="bank-manager-list"></div>
      <div class="modal-actions">
        <button class="btn-primary" id="bank-manager-close-btn" style="flex:1">Done</button>
      </div>
    </div>
  `);
  const list = modal.querySelector("#bank-manager-list");
  const designationList = modal.querySelector("#day-designation-list");
  function renderDesignations() {
    designationList.innerHTML = "";
    dayDesignations.forEach((day,index) => {
      const row = el(`<label class="form-row"><span>Day name</span><input value="${safeText(day.label)}" aria-label="Day name" /></label>`);
      row.querySelector("input").onchange = e => { const label=e.target.value.trim(); if(!label){e.target.value=day.label;return;} dayDesignations[index]={...day,label}; saveDayDesignations(); render(); renderDesignations(); renderList(); };
      designationList.appendChild(row);
    });
  }
  modal.querySelector("#add-day-designation").onclick = () => {
    const label=modal.querySelector("#new-day-designation").value.trim(); if(!label)return;
    const id=label.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
    if(!id || dayDesignations.some(d=>d.id===id)){alert("That day name already exists.");return;}
    dayDesignations.push({id,label,loggable:true,primaryValue:id}); saveDayDesignations(); modal.querySelector("#new-day-designation").value=""; render(); renderDesignations(); renderList();
  };

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
            <div class="bank-row-name">${entry.name}${entry.archived ? ' <span class="bank-archived-label">Archived</span>' : ''}</div>
            <div class="bank-row-meta">${TRACK_TYPES[entry.trackType]?.label || entry.trackType}</div><div class="bank-current-designation">Currently: ${safeText(dayDesignationLabel(entry.dayDesignation) || "Unassigned")}</div><label class="bank-day-label">Change day designation<select class="bank-day-designation"><option value=""${entry.dayDesignation?"":" selected"}>Unassigned</option>${dayDesignations.map(d=>`<option value="${safeText(d.id)}"${entry.dayDesignation===d.id?" selected":""}>${safeText(d.label)}</option>`).join("")}</select></label><div class="bank-designation-preview" hidden></div><div class="bank-designation-actions" hidden><button type="button" class="btn-primary bank-designation-save">Save change</button><button type="button" class="btn-secondary bank-designation-cancel">Cancel</button></div>
          </div>
          <button class="bank-row-delete-btn" title="${entry.archived ? 'Restore to bank' : 'Archive from bank'}">${entry.archived ? 'Restore' : 'Archive'}</button>
        </div>
      `);
      const designationSelect = row.querySelector(".bank-day-designation");
      const savedDesignation = entry.dayDesignation || "";
      const preview = row.querySelector(".bank-designation-preview");
      const actions = row.querySelector(".bank-designation-actions");
      const saveDesignationButton = row.querySelector(".bank-designation-save");
      const cancelDesignationButton = row.querySelector(".bank-designation-cancel");
      const designationName = id => id ? dayDesignationLabel(id) : "Unassigned";
      const updateDesignationPreview = () => {
        const next = designationSelect.value;
        const changed = next !== savedDesignation;
        preview.hidden = !changed;
        actions.hidden = !changed;
        if (changed) preview.textContent = `${entry.name}: ${designationName(savedDesignation)} → ${designationName(next)}. This updates how plans, At a Glance, and History group or label this exercise. Its name, dates, and logged results stay the same.`;
      };
      designationSelect.onchange = updateDesignationPreview;
      saveDesignationButton.onclick = () => {
        const next = designationSelect.value;
        if (next === savedDesignation) return;
        bank[key].dayDesignation = next;
        saveBank(bank);
        render();
        renderList();
      };
      cancelDesignationButton.onclick = () => { designationSelect.value = savedDesignation; updateDesignationPreview(); };
      row.querySelector(".bank-row-delete-btn").onclick = () => {
        if (entry.archived) {
          bank[key].archived = false;
        } else {
          if (!confirm(`Archive "${entry.name}" from the Exercise Bank? It will remain in existing routines and workout history and can be restored here.`)) return;
          bank[key].archived = true;
        }
        saveBank(bank);
        renderList();
      };
      list.appendChild(row);
    });
  }
  renderDesignations();
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
          customUnit: entry.customUnit || null,
          dayDesignation: entry.dayDesignation || bank[key]?.dayDesignation || "",
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
  const closeBankManager = () => {
    document.body.removeChild(overlay);
    if (onClose) onClose();
    render();
  };
  overlay.onclick = (e) => { if (e.target === overlay) closeBankManager(); };
  modal.querySelector("#bank-manager-close-btn").onclick = closeBankManager;

  document.body.appendChild(overlay);
  trapFocus(overlay);
}

function openAddExerciseModal(explicitListKey, routineBuilder = false) {
  const overlay = el(`<div class="modal-overlay"></div>`);
  const bankEntries = Object.values(bank).sort((a, b) => a.name.localeCompare(b.name));
  const modal = el(`
    <div class="modal">
      <h3>${explicitListKey ? "Add Activity / Finisher" : "Add Exercise"}</h3>
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
      <div class="form-row">
        <label>Exercise Bank Day assignment (optional)</label>
        <select id="ex-bank-day"><option value="">Unassigned</option></select>
        <div class="field-hint">Planning uses this assignment to populate matching days automatically. Leave it Unassigned while sorting the bank; any bank exercise can still be added from the active Log or finisher.</div>
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
  const bankDaySelect = modal.querySelector("#ex-bank-day");
  const preferredDay = routineBuilder
    ? DAYS.find(day => day.id === explicitListKey?.replace(/_finisher$/, ""))
    : selectedDayInfo();
  const defaultDayId = preferredDay && preferredDay.loggable ? preferredDay.id : exerciseDays()[0]?.id;
  function refreshBankDayOptions(selected = "") {
    bankDaySelect.innerHTML = `<option value="">Unassigned</option>` + dayDesignations.map(d => `<option value="${safeText(d.id)}">${safeText(d.label)}</option>`).join("");
    bankDaySelect.value = selected || "";
  }
  refreshBankDayOptions();
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
    refreshBankDayOptions(bank[bankSelect.value]?.dayDesignation || "");
  }
  modal.querySelector("#manage-bank-btn").onclick = () => openBankManagerModal(() => {
    refreshBankOptions();
    refreshBankDayOptions(bank[bankSelect.value]?.dayDesignation || "");
  });

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
    if (!key) { refreshBankDayOptions(); return; } // "+ New exercise" — fresh entries start unassigned
    const entry = bank[key];
    if (!entry) return;
    refreshBankDayOptions(entry.dayDesignation || "");
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
    const selectedDay = selectedDayInfo();
    const dayId = explicitListKey || (selectedDay && selectedDay.loggable ? selectedDay.id : "");
    if (!dayId) { alert("Choose a Primary activity in Planning before adding an exercise to the Log."); return; }
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
    upsertBank({ ...newEx, dayDesignation: bankDaySelect.value || "" });
    // Only lists rendered in this date's Log are evidence of an existing
    // activity. Other stored list keys can be stale or belong to a different
    // activity type, so scanning every saved list can report invisible items.
    const visibleDayId = routineBuilder ? dayId.replace(/_finisher$/, "") : (selectedDayInfo()?.id || dayId);
    const primaryList = routineBuilder ? (library[visibleDayId] || []) : getExerciseList(date, visibleDayId);
    const finisherList = routineBuilder ? (library[finisherKey(visibleDayId)] || []) : getExerciseList(date, finisherKey(visibleDayId));
    const primaryNames = new Set(primaryList.map(ex => bankKey(ex.name || "")).filter(Boolean));
    const visibleExercises = [...primaryList, ...finisherList.filter(ex => !primaryNames.has(bankKey(ex.name || "")))];
    const alreadyOnDate = visibleExercises.some(ex => bankKey(ex.name || "") === bankKey(name));
    if (alreadyOnDate) {
      alert(`${name} is already in this ${routineBuilder ? "routine" : "date's Log"}. The existing activity remains in place.`);
      document.body.removeChild(overlay);
      render();
      return;
    }
    const baseList = routineBuilder ? (library[dayId] || []) : getExerciseList(date, dayId);
    setExerciseList(date, dayId, [...baseList, newEx], routineBuilder ? "routine" : undefined);

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
function openEditExerciseModal(dayId, exId, routineBuilder = false) {
  const date = state.selectedDate;
  const sourceList = routineBuilder ? (library[dayId] || []) : getExerciseList(date, dayId);
  const ex = sourceList.find((e) => e.id === exId);
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
      <div class="form-row" id="edit-scope-row">
        <label>Apply this edit to</label>
        <select id="edit-scope">
          <option value="routine">Reusable routine and future workouts</option>
          <option value="today">This workout only</option>
        </select>
        <div class="field-hint">For a workout that already has logged sets, this defaults to This workout only.</div>
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
  const editScopeSelect = modal.querySelector("#edit-scope");
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
  if (routineBuilder) modal.querySelector("#edit-scope-row").hidden = true;
  editScopeSelect.value = routineBuilder ? "routine" : (dayLogHasRealData(logs[date], date) ? "today" : (state.editScope === "today" ? "today" : "routine"));
  const starting = defaultSets(ex, date);
  const w0 = Array.from({length:n0},(_,i)=>starting[i]?.weight ?? 20);
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

    const scope = routineBuilder ? "routine" : (editScopeSelect.value === "today" ? "today" : "routine");
    if (!routineBuilder) state.editScope = scope;
    const newList = (routineBuilder ? (library[dayId] || []) : getExerciseList(date, dayId)).map((e) => (e.id === exId ? updatedEx : e));
    setExerciseList(date, dayId, newList, scope);
    // Routine edits affect future sessions; only a current-workout edit resizes
    // this date's saved set array. Completed values are never discarded.
    const dayLog = logs[date];
    const loggedSets = dayLog?.entries?.[exId]?.sets;
    if (scope === "today" && Array.isArray(loggedSets)) {
      const resized = [...loggedSets];
      while (resized.length < numSets) {
        const index = resized.length;
        resized.push({weight:trackType === "weight" ? (numericWeight(weights[index]) ?? numericWeight(weights.at(-1)) ?? 20) : null, reps:null});
      }
      while (resized.length > numSets && resized.at(-1)?.reps == null) resized.pop();
      dayLog.entries[exId] = {sets:resized};
      preserveCompletedExerciseDetails(date);
      saveLogs(logs);
    }
    upsertBank(updatedEx);

    document.body.removeChild(overlay);
    render();
  };

  document.body.appendChild(overlay);
  trapFocus(overlay);
  nameInput.focus();
}

// Keep open tabs on the same Class Library snapshot. Without this, a tab
// left open with an older in-memory `classes` array could push that stale list
// after another tab had added classes, making them disappear on refresh.
window.addEventListener("storage", (event) => {
  if (event.key === "iron-log-classes-v42" && event.newValue) {
    try {
      const next = JSON.parse(event.newValue);
      if (Array.isArray(next)) {
        classes = next;
        if (state.tab === "classes") render();
      }
    } catch (e) { console.warn("Could not read updated Class Library from another tab", e); }
  }
});

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
  runV77Migrations();
  runOneTimeCleanupIfNeeded();
  render();
}
