// ---------- Couch to Marathon (50-week run plan) ----------
// Loaded BEFORE app.js. Only defines data + functions here; everything that
// touches app.js globals (el, state, render, schedulePush…) runs at call
// time, never at load time.
//
// Storage shape (synced alongside library/logs/bank):
//   marathon = {
//     settings: { startDate: "YYYY-MM-DD" (a Monday), raceName, raceDate } | null,
//     sequence: [ { w: planWeek, repeat?: true }, ... ]  // calendar week i -> plan week
//     runs: { "YYYY-MM-DD": { done, miles, secs, feel, pain, note,
//                             planWeek, label, kind, plannedMiles } }
//   }
// Runs live in their own store (not in logs) so a run and a lifting session
// on the same date never collide, and History/Export can show both.

const LS_MARATHON = "iron-log-marathon";
const DEFAULT_MARATHON = { settings: null, sequence: [], runs: {} };

function loadMarathon() {
  try {
    const raw = localStorage.getItem(LS_MARATHON);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed ? { ...structuredClone(DEFAULT_MARATHON), ...parsed } : structuredClone(DEFAULT_MARATHON);
  } catch (e) {
    return structuredClone(DEFAULT_MARATHON);
  }
}
function saveMarathon() {
  localStorage.setItem(LS_MARATHON, JSON.stringify(marathon));
  touchLocalUpdatedAt();
  schedulePush();
}
let marathon = loadMarathon();

// ---- The plan (transcribed from the Couch to Marathon wall chart) ----
const PHASES = [
  { n: 1, name: "Couch to 5K", from: 1, to: 9, goal: "Run 30 minutes nonstop (5K test, week 9)" },
  { n: 2, name: "Build a base", from: 10, to: 20, goal: "Long run of 6.5 mi; 10K checkpoint (week 20)" },
  { n: 3, name: "Half marathon", from: 21, to: 32, goal: "Long run of 12 mi; half marathon (week 32)" },
  { n: 4, name: "Marathon", from: 33, to: 50, goal: "20-mile long run (week 47); marathon (week 50)" },
];
function phaseFor(week) {
  return PHASES.find((p) => week >= p.from && week <= p.to) || PHASES[0];
}

const RUN_RULES = [
  "Most runs should feel easy — you can talk in full sentences.",
  "Never add more than about 10% to your weekly miles.",
  "Walk breaks are allowed anytime, including on race day.",
  "Easy weeks are lighter recovery weeks. Don't skip them.",
  "Missed a day? Move on. Don't cram two runs together.",
  "Missed a week or more? Repeat the last week you finished.",
  "Pain that changes your stride means stop and rest.",
  "Long runs of 10+ mi: practice fueling every 30–45 min.",
  "Replace shoes every 300–500 miles.",
  "Get a checkup before starting if you have health concerns.",
];

// Phase 1 (weeks 1–9): run/walk intervals on Tue/Thu/Sat, optional walk Wed.
// [run min, walk min, reps]  — or a single nonstop number of minutes.
const C25K = [
  [1, 1.5, 8], [1.5, 2, 6], [2, 2, 5], [3, 1.5, 5], [5, 2, 3], [10, 2, 2], [20], [25], [30],
];
// Weeks 10–50: [tue easy, thu, sat long, sun very easy, note]
// thu is a number (easy miles) or [total, quality miles, "tempo"|"goal"|"strides"].
// sat can be a special race/test marker.
const BUILD = {
  10: [2, 2.5, 4, 2], 11: [2.5, 2.5, 4, 2], 12: [2.5, 3, 4.5, 2], 13: [2, 2.5, 3, 2, "Easy week"],
  14: [3, 3, 5, 2], 15: [3, 3.5, 5, 2.5], 16: [3, 3.5, 5.5, 3], 17: [2.5, 3, 4, 2, "Easy week"],
  18: [3.5, 4, 6, 3], 19: [4, 4, 6.5, 3], 20: [3, 3, "10k", 2],
  21: [4, 4, 7, 3], 22: [4, 4.5, 7, 3], 23: [4, [5, 2, "tempo"], 8, 3], 24: [3, 4, 6, 3, "Easy week"],
  25: [4, [5, 2, "tempo"], 9, 3], 26: [4.5, [5, 2, "tempo"], 9, 3.5], 27: [5, [5, 2, "tempo"], 10, 3.5],
  28: [4, 4, 7, 3, "Easy week"], 29: [5, [5.5, 2, "tempo"], 11, 3.5], 30: [5, [5, 2, "tempo"], 12, 3],
  31: [4, 4, 8, 3, "Taper"], 32: [3, [3, 0, "strides"], "half", null, "Race week"],
  33: [4, 5, 10, 3], 34: [4, [5, 3, "goal"], 11, 3], 35: [5, [6, 4, "goal"], 12, 3], 36: [4, 5, 9, 3, "Easy week"],
  37: [5, [6, 4, "goal"], 13, 4], 38: [5, [6, 4, "goal"], 14, 4], 39: [5, [7, 5, "goal"], 15, 4], 40: [4, 5, 10, 3, "Easy week"],
  41: [6, [7, 5, "goal"], 16, 4], 42: [6, [7, 5, "goal"], 14, 4], 43: [6, [8, 5, "goal"], 17, 4], 44: [5, 6, 12, 3, "Easy week"],
  45: [6, [8, 5, "goal"], 18, 4], 46: [6, [8, 5, "goal"], 14, 4], 47: [6, [8, 5, "goal"], 20, 4, "Peak week"],
  48: [5, 6, 12, 4, "Taper"], 49: [4, 5, 8, 3, "Taper"], 50: [3, [3, 0, "strides"], "shakeout", "marathon", "Race week"],
};

function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

// Returns { n, phase, note, days: [7 × workout|null] } where workout =
// { kind, title, detail, miles, minutes, optional, milestone }
function buildPlanWeek(n) {
  const days = [null, null, null, null, null, null, null];
  let note = "";
  if (n <= 9) {
    const c = C25K[n - 1];
    let title, minutes;
    if (c.length === 3) {
      title = `Run ${fmtNum(c[0])} min / walk ${fmtNum(c[1])} min × ${c[2]}`;
      minutes = (c[0] + c[1]) * c[2];
    } else {
      title = `Run ${c[0]} min nonstop`;
      minutes = c[0];
    }
    const run = { kind: "interval", title, detail: `About ${fmtNum(minutes)} min total`, miles: null, minutes };
    days[1] = { ...run };
    days[3] = { ...run };
    days[5] = { ...run };
    if (n === 9) {
      days[5] = { kind: "test", title: "5K test: run 30 min / 3 mi", detail: "Phase 1 finish line", miles: 3, minutes: 30, milestone: true };
    }
    days[2] = { kind: "walk", title: "Optional walk", detail: "20–30 min, any pace", miles: null, minutes: 25, optional: true };
    return { n, phase: phaseFor(n), note: n === 1 ? "Phase 1 starts" : "", days };
  }

  const [tue, thu, sat, sun, wkNote] = BUILD[n];
  note = wkNote || "";
  days[1] = { kind: "easy", title: `${fmtNum(tue)} mi easy`, detail: "Conversational pace", miles: tue };

  if (Array.isArray(thu)) {
    const [total, q, type] = thu;
    if (type === "tempo") days[3] = { kind: "tempo", title: `${fmtNum(total)} mi with ${q} mi tempo`, detail: "Tempo = comfortably hard, a pace you could hold about an hour", miles: total };
    else if (type === "goal") days[3] = { kind: "goal", title: `${fmtNum(total)} mi with ${q} at goal pace`, detail: "Goal pace = the pace you plan to run the marathon", miles: total };
    else days[3] = { kind: "strides", title: `${fmtNum(total)} mi easy + 4 strides`, detail: "Strides = 4 × 20-sec quick, relaxed pickups", miles: total };
  } else {
    days[3] = { kind: "easy", title: `${fmtNum(thu)} mi easy`, detail: "Conversational pace", miles: thu };
  }

  if (sat === "10k") days[5] = { kind: "test", title: "10K checkpoint (6.2 mi)", detail: "Phase 2 finish line", miles: 6.2, milestone: true };
  else if (sat === "half") days[5] = { kind: "race", title: "Half marathon — 13.1 mi", detail: "Walk breaks are allowed on race day too", miles: 13.1, milestone: true };
  else if (sat === "shakeout") days[5] = { kind: "shakeout", title: "2 mi shakeout or rest", detail: "Very easy, or take the day off", miles: 2, optional: true };
  else days[5] = { kind: "long", title: `Long run ${fmtNum(sat)} mi`, detail: sat >= 10 ? "Practice fueling every 30–45 min" : "Easy pace, walk breaks welcome", miles: sat, milestone: n === 47 };

  if (sun === "marathon") days[6] = { kind: "race", title: "Marathon — 26.2 mi", detail: "This is the one", miles: 26.2, milestone: true };
  else if (sun != null) days[6] = { kind: "veryeasy", title: `${fmtNum(sun)} mi very easy`, detail: "Recovery pace, slower than easy", miles: sun };

  if (!note && [10, 21, 33].includes(n)) note = `Phase ${phaseFor(n).n} starts`;
  return { n, phase: phaseFor(n), note, days };
}
const RUN_PLAN = Array.from({ length: 50 }, (_, i) => buildPlanWeek(i + 1));

// Weeks 1–9 are time-based run/walk, so they have no mileage target.
function plannedMiles(planWeek) {
  if (planWeek.n < 10) return 0;
  return planWeek.days.reduce((sum, d) => sum + (d && !d.optional && d.miles ? d.miles : 0), 0);
}
function plannedRunCount(planWeek) {
  return planWeek.days.filter((d) => d && !d.optional).length;
}

// ---- Date helpers (local time, Monday-first) ----
function addDaysIso(iso, n) {
  const { year, month, day } = isoToParts(iso);
  const d = new Date(year, month, day + n);
  return partsToIso(d.getFullYear(), d.getMonth(), d.getDate());
}
function daysBetweenIso(a, b) {
  const pa = isoToParts(a), pb = isoToParts(b);
  return Math.round((Date.UTC(pb.year, pb.month, pb.day) - Date.UTC(pa.year, pa.month, pa.day)) / 86400000);
}
function mondayOfIso(iso) {
  const { year, month, day } = isoToParts(iso);
  return addDaysIso(iso, -mondayFirstWeekday(year, month, day));
}
function fmtLongDate(iso) {
  const { year, month, day } = isoToParts(iso);
  return new Date(year, month, day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Plan ↔ calendar mapping ----
function planActive() {
  return !!(marathon.settings && marathon.settings.startDate && marathon.sequence.length);
}
function planEndIso() {
  return addDaysIso(marathon.settings.startDate, marathon.sequence.length * 7 - 1);
}
function weekStartIso(calIdx) {
  return addDaysIso(marathon.settings.startDate, calIdx * 7);
}
// Where does a calendar date fall in the plan? null if outside it.
function planSlotFor(iso) {
  if (!planActive()) return null;
  const diff = daysBetweenIso(marathon.settings.startDate, iso);
  if (diff < 0) return null;
  const calIdx = Math.floor(diff / 7);
  if (calIdx >= marathon.sequence.length) return null;
  const seq = marathon.sequence[calIdx];
  const planWeek = RUN_PLAN[seq.w - 1];
  const dayIdx = diff % 7;
  return { calIdx, dayIdx, planWeek, isRepeat: !!seq.repeat, workout: planWeek.days[dayIdx] };
}
function currentCalIdx() {
  if (!planActive()) return 0;
  const diff = daysBetweenIso(marathon.settings.startDate, todayISO());
  if (diff < 0) return 0;
  return Math.min(Math.floor(diff / 7), marathon.sequence.length - 1);
}
// The calendar date of a plan milestone (first time that plan week appears).
function dateOfPlanDay(planWeekN, dayIdx) {
  const calIdx = marathon.sequence.findIndex((s) => s.w === planWeekN);
  return calIdx === -1 ? null : addDaysIso(weekStartIso(calIdx), dayIdx);
}

// ---- Run records ----
function runRecord(iso) {
  return marathon.runs[iso] || null;
}
function runHasData(r) {
  return !!r && (r.done || r.miles != null || r.secs != null || !!r.note);
}
function updateRun(iso, patch) {
  const slot = planSlotFor(iso);
  const prev = marathon.runs[iso] || {};
  const next = { ...prev, ...patch };
  // Snapshot what was prescribed, so History still reads right even if the
  // plan is later shifted or removed.
  if (slot && slot.workout) {
    next.planWeek = slot.planWeek.n;
    next.label = slot.workout.title;
    next.kind = slot.workout.kind;
    next.plannedMiles = slot.workout.miles ?? null;
  }
  if (!runHasData(next) && !next.pain && !next.feel) delete marathon.runs[iso];
  else marathon.runs[iso] = next;
  saveMarathon();
}

// Accepts "32", "32.5", "32:15", "1:05:30" → seconds. Returns null if blank/invalid.
function parseDuration(str) {
  const s = String(str || "").trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);
  const parts = s.split(":").map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p)) || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}
function fmtDuration(secs) {
  if (secs == null) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function fmtPace(r) {
  if (!r || !r.miles || !r.secs) return "";
  return `${fmtDuration(Math.round(r.secs / r.miles))}/mi`;
}
const FEELS = [["easy", "Easy"], ["solid", "Solid"], ["tough", "Tough"]];

function runSummaryText(r) {
  const bits = [];
  if (r.miles != null) bits.push(`${fmtNum(r.miles)} mi`);
  if (r.secs != null) bits.push(`in ${fmtDuration(r.secs)}`);
  const pace = fmtPace(r);
  if (pace) bits.push(`(${pace})`);
  if (r.feel) bits.push(`felt ${FEELS.find((f) => f[0] === r.feel)?.[1].toLowerCase() || r.feel}`);
  if (!bits.length && r.done) bits.push("done");
  return bits.join(" ");
}

// Actual miles logged in a calendar week.
function loggedMilesForWeek(calIdx) {
  const start = weekStartIso(calIdx);
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const r = runRecord(addDaysIso(start, i));
    if (r && r.miles) sum += r.miles;
  }
  return sum;
}
function doneRunsForWeek(calIdx) {
  const start = weekStartIso(calIdx);
  const pw = RUN_PLAN[marathon.sequence[calIdx].w - 1];
  let done = 0;
  pw.days.forEach((d, i) => {
    if (d && !d.optional && runRecord(addDaysIso(start, i))?.done) done++;
  });
  return done;
}

// ---- Shared log form (used on the Log tab and in the Run tab's day modal) ----
function renderRunLogForm(iso, onChange) {
  const slot = planSlotFor(iso);
  const w = slot.workout;
  const r = runRecord(iso) || {};
  const form = el(`<div class="run-form"></div>`);

  const inputs = el(`
    <div class="run-inputs">
      <label class="run-field">
        <span>Miles</span>
        <input type="text" inputmode="decimal" class="run-miles" placeholder="${w.miles != null ? fmtNum(w.miles) : "–"}" value="${r.miles != null ? fmtNum(r.miles) : ""}" />
      </label>
      <label class="run-field">
        <span>Time</span>
        <input type="text" inputmode="numeric" class="run-time" placeholder="${w.minutes ? fmtNum(w.minutes) + ":00" : "mm:ss"}" value="${r.secs != null ? fmtDuration(r.secs) : ""}" />
      </label>
      <div class="run-field run-pace-field">
        <span>Pace</span>
        <div class="run-pace">${fmtPace(r) || "–"}</div>
      </div>
    </div>
  `);
  const milesIn = inputs.querySelector(".run-miles");
  const timeIn = inputs.querySelector(".run-time");
  const paceOut = inputs.querySelector(".run-pace");

  function commitNumbers() {
    const milesRaw = milesIn.value.trim();
    const miles = milesRaw === "" ? null : parseFloat(milesRaw);
    const secs = parseDuration(timeIn.value);
    timeIn.classList.toggle("invalid", timeIn.value.trim() !== "" && secs == null);
    const patch = {
      miles: miles != null && !isNaN(miles) && miles > 0 ? miles : null,
      secs,
    };
    // Entering a distance or time means it happened.
    if ((patch.miles != null || patch.secs != null) && !(runRecord(iso) || {}).done) patch.done = true;
    updateRun(iso, patch);
    paceOut.textContent = fmtPace(runRecord(iso)) || "–";
    if (onChange) onChange();
  }
  milesIn.addEventListener("change", commitNumbers);
  timeIn.addEventListener("change", commitNumbers);
  form.appendChild(inputs);

  const feelRow = el(`<div class="feel-row" role="group" aria-label="How did it feel?"></div>`);
  FEELS.forEach(([id, label]) => {
    const b = el(`<button type="button" class="feel-chip ${r.feel === id ? "active" : ""}" aria-pressed="${r.feel === id}">${label}</button>`);
    b.onclick = () => {
      const cur = runRecord(iso)?.feel;
      updateRun(iso, { feel: cur === id ? null : id });
      feelRow.querySelectorAll(".feel-chip").forEach((c) => { c.classList.remove("active"); c.setAttribute("aria-pressed", "false"); });
      if (cur !== id) { b.classList.add("active"); b.setAttribute("aria-pressed", "true"); }
      if (onChange) onChange();
    };
    feelRow.appendChild(b);
  });
  form.appendChild(feelRow);

  const painRow = el(`
    <label class="pain-row">
      <input type="checkbox" ${r.pain ? "checked" : ""} />
      <span>Pain that changed my stride</span>
    </label>
  `);
  const painHint = el(`<div class="pain-hint ${r.pain ? "show" : ""}">Stop and rest. If you miss a week or more, repeat the last week you finished.</div>`);
  painRow.querySelector("input").onchange = (e) => {
    updateRun(iso, { pain: e.target.checked || null });
    painHint.classList.toggle("show", e.target.checked);
  };
  form.appendChild(painRow);
  form.appendChild(painHint);

  const note = el(`<textarea class="run-note" rows="2" placeholder="Notes (route, weather, fuel…)">${escapeHtml(r.note || "")}</textarea>`);
  note.addEventListener("change", () => { updateRun(iso, { note: note.value.trim() || null }); if (onChange) onChange(); });
  form.appendChild(note);

  return form;
}

function renderDoneButton(iso, onToggle) {
  const r = runRecord(iso);
  const w = planSlotFor(iso).workout;
  const done = !!r?.done;
  const btn = el(`<button type="button" class="run-done-btn ${done ? "done" : ""}">${done ? "✓ Done" : w.optional ? "Mark walk done" : "Mark run done"}</button>`);
  btn.onclick = () => {
    updateRun(iso, { done: !runRecord(iso)?.done });
    onToggle();
  };
  return btn;
}

// ---- Log tab strip ----
function renderRunStrip(iso) {
  const slot = planSlotFor(iso);
  if (!slot) return null;
  const pw = slot.planWeek;
  const meta = `Marathon plan, week ${slot.calIdx + 1} of ${marathon.sequence.length}${slot.isRepeat ? ` (repeating week ${pw.n})` : pw.n !== slot.calIdx + 1 ? ` (plan week ${pw.n})` : ""}`;

  if (!slot.workout) {
    const strip = el(`<button type="button" class="run-strip rest">
      <span class="run-strip-meta">${meta}</span>
      <span class="run-strip-rest">No run today</span>
    </button>`);
    strip.onclick = () => { state.tab = "run"; state.runCalIdx = slot.calIdx; render(); };
    return strip;
  }

  const w = slot.workout;
  const card = el(`
    <div class="run-card ${w.milestone ? "milestone" : ""} ${w.optional ? "optional" : ""}">
      <div class="run-card-meta">${meta}</div>
      <div class="run-card-top">
        <div>
          <div class="run-title">${w.title}</div>
          <div class="run-detail">${w.detail || ""}</div>
        </div>
      </div>
    </div>
  `);
  const top = card.querySelector(".run-card-top");
  const refresh = () => render();
  top.appendChild(renderDoneButton(iso, refresh));

  const r = runRecord(iso);
  const details = el(`<details class="run-details" ${runHasData(r) && (r.miles != null || r.secs != null || r.note || r.feel) ? "open" : ""}><summary>${runHasData(r) && runSummaryText(r) !== "done" ? escapeHtml(runSummaryText(r)) : "Add distance, time, and notes"}</summary></details>`);
  details.appendChild(renderRunLogForm(iso, () => {
    const cur = runRecord(iso);
    details.querySelector("summary").textContent = cur && runSummaryText(cur) !== "done" && runSummaryText(cur) ? runSummaryText(cur) : "Add distance, time, and notes";
    const btn = card.querySelector(".run-done-btn");
    if (btn) {
      btn.classList.toggle("done", !!cur?.done);
      btn.textContent = cur?.done ? "✓ Done" : w.optional ? "Mark walk done" : "Mark run done";
    }
  }));
  card.appendChild(details);
  return card;
}

// ---- Run tab ----
function renderRun() {
  const wrap = document.createElement("div");

  if (!planActive()) {
    const empty = el(`
      <div class="empty-state run-empty">
        <div class="run-empty-title">Couch to Marathon</div>
        <p>50 weeks, four phases: 5K, base building, half marathon, marathon. Pick your start date and every run lands on the calendar, on this tab and on the Log tab.</p>
      </div>
    `);
    const btn = el(`<button class="btn-primary run-setup-btn">Set up my plan</button>`);
    btn.onclick = openRunSetupModal;
    empty.appendChild(btn);
    wrap.appendChild(empty);
    return wrap;
  }

  const total = marathon.sequence.length;
  const todayIso = todayISO();
  const nowIdx = currentCalIdx();
  if (state.runCalIdx == null || state.runCalIdx >= total) state.runCalIdx = nowIdx;
  const calIdx = state.runCalIdx;
  const beforeStart = todayIso < marathon.settings.startDate;
  const afterEnd = todayIso > planEndIso();

  // Hero: race + countdown
  const raceIso = planEndIso();
  const daysToRace = daysBetweenIso(todayIso, raceIso);
  const s = marathon.settings;
  const nowPw = RUN_PLAN[marathon.sequence[nowIdx].w - 1];
  const hero = el(`
    <div class="run-hero">
      <div class="run-hero-race">${escapeHtml(s.raceName || "Marathon")}</div>
      <div class="run-hero-count">${afterEnd ? "Race day is behind you" : daysToRace === 0 ? "Race day" : `${daysToRace} days to go`}</div>
      <div class="run-hero-sub">${beforeStart ? `Starts ${fmtLongDate(s.startDate)}` : afterEnd ? `Finished ${fmtLongDate(raceIso)}` : `Week ${nowIdx + 1} of ${total}. Phase ${nowPw.phase.n}: ${nowPw.phase.name}`}</div>
    </div>
  `);
  hero.appendChild(renderPhaseTrack(nowIdx, beforeStart));
  wrap.appendChild(hero);

  if (s.raceDate && s.raceDate !== raceIso) {
    const diff = daysBetweenIso(raceIso, s.raceDate);
    wrap.appendChild(el(`<div class="run-warn">The plan ends ${fmtLongDate(raceIso)}, ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} ${diff > 0 ? "before" : "after"} your race date (${fmtLongDate(s.raceDate)}).${diff < 0 ? " Repeated weeks pushed it back. Consider skipping an easy week later on, or choosing a later race." : ""}</div>`));
  }

  // Week viewer
  wrap.appendChild(renderWeekCard(calIdx, nowIdx));

  // Mileage chart
  const chart = renderMileageChart(nowIdx);
  if (chart) wrap.appendChild(chart);

  // Milestones
  wrap.appendChild(renderMilestones());

  // Full plan list
  wrap.appendChild(renderPlanList(nowIdx));

  // Rules
  const rules = el(`<details class="run-rules"><summary>The rules</summary><ul>${RUN_RULES.map((r) => `<li>${r}</li>`).join("")}</ul></details>`);
  wrap.appendChild(rules);

  const settingsBtn = el(`<button class="clear-day-btn" style="margin-top:14px;">Edit plan dates</button>`);
  settingsBtn.onclick = openRunSetupModal;
  wrap.appendChild(settingsBtn);

  return wrap;
}

function renderPhaseTrack(nowIdx, beforeStart) {
  const total = marathon.sequence.length;
  const track = el(`<div class="phase-track" aria-hidden="true"></div>`);
  // One segment per phase, sized by how many calendar weeks it occupies.
  PHASES.forEach((p) => {
    const weeks = marathon.sequence.map((sq, i) => ({ sq, i })).filter(({ sq }) => sq.w >= p.from && sq.w <= p.to);
    if (!weeks.length) return;
    const doneWeeks = beforeStart ? 0 : weeks.filter(({ i }) => i < nowIdx).length + (weeks.some(({ i }) => i === nowIdx) ? 0.5 : 0);
    const seg = el(`<div class="phase-seg" style="flex:${weeks.length}"><div class="phase-fill" style="width:${Math.min(100, (doneWeeks / weeks.length) * 100)}%"></div><span>${p.n}</span></div>`);
    track.appendChild(seg);
  });
  return track;
}

function dayStatus(iso, w) {
  const r = runRecord(iso);
  const today = todayISO();
  if (!w) return "off";
  if (r?.done) return "done";
  if (iso === today) return "today";
  if (iso < today) return w.optional ? "skipped-opt" : "missed";
  return "upcoming";
}

function renderWeekCard(calIdx, nowIdx) {
  const total = marathon.sequence.length;
  const seq = marathon.sequence[calIdx];
  const pw = RUN_PLAN[seq.w - 1];
  const start = weekStartIso(calIdx);
  const planned = plannedMiles(pw);
  const logged = loggedMilesForWeek(calIdx);
  const runsPlanned = plannedRunCount(pw);
  const runsDone = doneRunsForWeek(calIdx);

  const card = el(`<div class="week-card ${calIdx === nowIdx ? "current" : ""}"></div>`);
  const nav = el(`
    <div class="week-nav">
      <button type="button" class="cal-nav-btn" aria-label="Previous week" ${calIdx === 0 ? "disabled" : ""}>‹</button>
      <div class="week-nav-label">
        <div class="week-nav-title">Week ${calIdx + 1}${seq.repeat ? ` <span class="repeat-tag">repeat of ${pw.n}</span>` : pw.n !== calIdx + 1 ? ` <span class="repeat-tag">plan week ${pw.n}</span>` : ""}</div>
        <div class="week-nav-sub">${fmtDate(start)} – ${fmtDate(addDaysIso(start, 6))}${pw.note ? `, ${pw.note.toLowerCase()}` : ""}</div>
      </div>
      <button type="button" class="cal-nav-btn" aria-label="Next week" ${calIdx === total - 1 ? "disabled" : ""}>›</button>
    </div>
  `);
  const [prevBtn, nextBtn] = nav.querySelectorAll(".cal-nav-btn");
  prevBtn.onclick = () => { state.runCalIdx = Math.max(0, calIdx - 1); render(); };
  nextBtn.onclick = () => { state.runCalIdx = Math.min(total - 1, calIdx + 1); render(); };
  card.appendChild(nav);

  const days = el(`<div class="week-days"></div>`);
  pw.days.forEach((w, i) => {
    const iso = addDaysIso(start, i);
    const st = dayStatus(iso, w);
    const r = runRecord(iso);
    const row = el(`
      <button type="button" class="week-day ${st} ${w?.milestone ? "milestone" : ""} ${w?.optional ? "optional" : ""}" ${w ? "" : "disabled"}>
        <span class="wd-name">${WEEKDAY_LABELS[i]}</span>
        <span class="wd-body">
          <span class="wd-title">${w ? w.title : "No run"}</span>
          ${r && runSummaryText(r) && runSummaryText(r) !== "done" ? `<span class="wd-log">${escapeHtml(runSummaryText(r))}</span>` : ""}
        </span>
        <span class="wd-mark" aria-label="${st}">${st === "done" ? "✓" : st === "missed" ? "–" : ""}</span>
      </button>
    `);
    if (w) row.onclick = () => openRunDayModal(iso);
    days.appendChild(row);
  });
  card.appendChild(days);

  const foot = el(`
    <div class="week-foot">
      <span><b>${runsDone}</b> of ${runsPlanned} runs</span>
      ${planned > 0 ? `<span><b>${fmtNum(logged)}</b> of ${fmtNum(planned)} mi</span>` : ""}
    </div>
  `);
  card.appendChild(foot);

  const actions = el(`<div class="week-actions"></div>`);
  if (calIdx !== nowIdx) {
    const jump = el(`<button type="button" class="link-btn">Back to this week</button>`);
    jump.onclick = () => { state.runCalIdx = nowIdx; render(); };
    actions.appendChild(jump);
  }
  // "Missed a week+? Repeat the last week you finished."
  if (calIdx < total - 1 || seq.repeat) {
    const rep = el(`<button type="button" class="link-btn">Repeat this week next week</button>`);
    rep.onclick = () => {
      const ok = confirm(`Insert another copy of plan week ${pw.n} right after this one?\n\nEvery later week shifts back by 7 days, including race day.`);
      if (!ok) return;
      marathon.sequence.splice(calIdx + 1, 0, { w: seq.w, repeat: true });
      saveMarathon();
      state.runCalIdx = calIdx + 1;
      render();
    };
    actions.appendChild(rep);
  }
  if (seq.repeat) {
    const undo = el(`<button type="button" class="link-btn danger">Remove this repeat week</button>`);
    undo.onclick = () => {
      const ok = confirm("Remove this repeated week? Every later week moves up by 7 days. Runs you logged stay in History.");
      if (!ok) return;
      marathon.sequence.splice(calIdx, 1);
      saveMarathon();
      state.runCalIdx = Math.max(0, calIdx - 1);
      render();
    };
    actions.appendChild(undo);
  }
  card.appendChild(actions);
  return card;
}

function openRunDayModal(iso) {
  const slot = planSlotFor(iso);
  if (!slot || !slot.workout) return;
  const w = slot.workout;
  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`
    <div class="modal">
      <div class="run-card-meta">${fmtLongDate(iso)}, week ${slot.calIdx + 1}</div>
      <h3 style="margin-bottom:4px;">${w.title}</h3>
      <div class="run-detail" style="margin-bottom:16px;">${w.detail || ""}</div>
      <div id="run-modal-done"></div>
      <div id="run-modal-form"></div>
      <div class="modal-actions">
        <button class="btn-primary" id="run-modal-close" style="flex:1">Close</button>
      </div>
    </div>
  `);
  const doneHolder = modal.querySelector("#run-modal-done");
  const paintDone = () => {
    doneHolder.innerHTML = "";
    const b = renderDoneButton(iso, paintDone);
    b.classList.add("wide");
    doneHolder.appendChild(b);
  };
  paintDone();
  modal.querySelector("#run-modal-form").appendChild(renderRunLogForm(iso, paintDone));
  const close = () => { document.body.removeChild(overlay); render(); };
  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  modal.querySelector("#run-modal-close").onclick = close;
  document.body.appendChild(overlay);
  trapFocus(overlay);
}

function renderMileageChart(nowIdx) {
  // Last up-to-12 calendar weeks through the current one, distance weeks only.
  const from = Math.max(0, nowIdx - 11);
  const weeks = [];
  for (let i = from; i <= nowIdx; i++) {
    const pw = RUN_PLAN[marathon.sequence[i].w - 1];
    const planned = plannedMiles(pw);
    const logged = loggedMilesForWeek(i);
    if (planned > 0 || logged > 0) weeks.push({ i, planned, logged });
  }
  if (weeks.length < 2) return null;

  const W = 400, H = 170, PADL = 28, PADB = 22, PADT = 10;
  const maxV = Math.max(...weeks.map((w) => Math.max(w.planned, w.logged)), 5);
  const slot = (W - PADL - 6) / weeks.length;
  const bw = Math.min(22, slot * 0.6);
  const y = (v) => H - PADB - (v / maxV) * (H - PADB - PADT);
  let bars = "";
  weeks.forEach((w, k) => {
    const x = PADL + k * slot + (slot - bw) / 2;
    bars += `<rect x="${x}" y="${y(w.planned)}" width="${bw}" height="${H - PADB - y(w.planned)}" fill="none" stroke="#DDCB8E" stroke-width="1.5" rx="3"/>`;
    if (w.logged > 0) bars += `<rect x="${x + 3}" y="${y(w.logged)}" width="${bw - 6}" height="${H - PADB - y(w.logged)}" fill="${w.logged >= w.planned ? "#3F7A46" : "#2B5A85"}" rx="2"/>`;
    bars += `<text x="${x + bw / 2}" y="${H - 6}" font-size="10" fill="#4A4A3C" text-anchor="middle">${w.i + 1}</text>`;
  });
  const gridVals = [0, Math.round(maxV / 2), Math.round(maxV)];
  const grid = gridVals.map((v) => `<line x1="${PADL}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="#DDCB8E" stroke-dasharray="3,3"/><text x="${PADL - 5}" y="${y(v) + 3}" font-size="10" fill="#8C8A72" text-anchor="end">${v}</text>`).join("");

  const wrap = el(`<div class="chart-wrap run-chart"></div>`);
  wrap.innerHTML = `
    <div class="run-section-title">Weekly miles</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block" role="img" aria-label="Weekly miles, planned versus logged">${grid}${bars}</svg>
    <div class="chart-legend"><span class="lg planned"></span>Planned <span class="lg logged"></span>Logged <span class="lg hit"></span>Hit the plan</div>
  `;
  return wrap;
}

function renderMilestones() {
  const list = [
    { label: "5K test", week: 9, day: 5 },
    { label: "10K checkpoint", week: 20, day: 5 },
    { label: "Half marathon", week: 32, day: 5 },
    { label: "20-mile long run", week: 47, day: 5 },
    { label: "Marathon", week: 50, day: 6 },
  ];
  const wrap = el(`<div class="milestones"><div class="run-section-title">Milestones</div></div>`);
  list.forEach((m) => {
    const iso = dateOfPlanDay(m.week, m.day);
    if (!iso) return;
    const done = !!runRecord(iso)?.done;
    const past = iso < todayISO();
    wrap.appendChild(el(`
      <div class="ms-row ${done ? "done" : past ? "past" : ""}">
        <span class="ms-dot">${done ? "✓" : ""}</span>
        <span class="ms-label">${m.label}</span>
        <span class="ms-date">${fmtLongDate(iso)}</span>
      </div>
    `));
  });
  return wrap;
}

function renderPlanList(nowIdx) {
  const det = el(`<details class="plan-list"><summary>All ${marathon.sequence.length} weeks</summary></details>`);
  let lastPhase = null;
  marathon.sequence.forEach((seq, i) => {
    const pw = RUN_PLAN[seq.w - 1];
    if (pw.phase.n !== lastPhase) {
      lastPhase = pw.phase.n;
      det.appendChild(el(`<div class="plan-phase">Phase ${pw.phase.n}: ${pw.phase.name}<span>${pw.phase.goal}</span></div>`));
    }
    const planned = plannedMiles(pw);
    const done = doneRunsForWeek(i);
    const count = plannedRunCount(pw);
    const row = el(`
      <button type="button" class="plan-row ${i === nowIdx ? "current" : ""} ${i < nowIdx ? "past" : ""}">
        <span class="pr-wk">${i + 1}</span>
        <span class="pr-date">${fmtDate(weekStartIso(i))}${seq.repeat ? " (repeat)" : ""}${pw.note ? `<em>${pw.note}</em>` : ""}</span>
        <span class="pr-mi">${planned > 0 ? fmtNum(planned) + " mi" : count + " runs"}</span>
        <span class="pr-dots">${Array.from({ length: count }, (_, k) => `<i class="${k < done ? "on" : ""}"></i>`).join("")}</span>
      </button>
    `);
    row.onclick = () => { state.runCalIdx = i; render(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    det.appendChild(row);
  });
  return det;
}

// ---- Setup modal ----
function openRunSetupModal() {
  const s = marathon.settings || {};
  let startIso = s.startDate || mondayOfIso(todayISO());
  let raceIso = s.raceDate || null;
  let firstWeek = marathon.sequence[0]?.w || 1;
  const hasRepeats = marathon.sequence.some((x) => x.repeat);

  const overlay = el(`<div class="modal-overlay"></div>`);
  const modal = el(`
    <div class="modal">
      <h3>${planActive() ? "Edit marathon plan" : "Set up your marathon plan"}</h3>
      <div class="form-row">
        <label for="run-race-name">Race</label>
        <input type="text" id="run-race-name" placeholder="e.g. Chicago Marathon" value="${escapeHtml(s.raceName || "")}" />
      </div>
      <div class="form-row">
        <label>Race date (optional)</label>
        <div class="weights-row" id="run-race-date-row"></div>
        <div class="field-hint">Setting this counts back from race day to find your start.</div>
      </div>
      <div class="form-row">
        <label>Start date</label>
        <div class="weights-row" id="run-start-row"></div>
        <div class="field-hint">Weeks run Monday to Sunday, so this snaps to a Monday.</div>
      </div>
      <div class="form-row">
        <label for="run-first-week">Begin at</label>
        <select id="run-first-week" style="margin-bottom:0">
          ${RUN_PLAN.slice(0, 20).map((pw) => `<option value="${pw.n}" ${pw.n === firstWeek ? "selected" : ""}>Week ${pw.n}: ${pw.days[1].title}</option>`).join("")}
        </select>
        <div class="field-hint">Week 1 is for a true couch start. Only skip ahead if you can already do that week's runs comfortably.</div>
      </div>
      <div class="setup-preview" id="run-preview"></div>
      ${hasRepeats ? `<div class="field-hint" style="margin-top:8px;">Saving resets your repeated weeks.</div>` : ""}
      <div class="modal-actions">
        <button class="btn-secondary" id="run-cancel">Cancel</button>
        <button class="btn-primary" id="run-save">Save plan</button>
      </div>
      ${planActive() ? `<button class="clear-day-btn" id="run-remove" style="margin-top:14px;">Remove plan (logged runs stay in History)</button>` : ""}
    </div>
  `);
  const nameIn = modal.querySelector("#run-race-name");
  const weekSel = modal.querySelector("#run-first-week");
  const raceRow = modal.querySelector("#run-race-date-row");
  const startRow = modal.querySelector("#run-start-row");
  const preview = modal.querySelector("#run-preview");

  function weeksCount() { return 50 - Number(weekSel.value) + 1; }
  function planWeekDate(planN, dayIdx) {
    const offset = planN - Number(weekSel.value);
    return offset < 0 ? null : addDaysIso(startIso, offset * 7 + dayIdx);
  }
  function paint() {
    raceRow.innerHTML = "";
    if (raceIso) {
      raceRow.appendChild(renderDateButton(raceIso, (iso) => {
        raceIso = iso;
        startIso = addDaysIso(mondayOfIso(iso), -(weeksCount() - 1) * 7);
        paint();
      }));
      const clear = el(`<button type="button" class="link-btn">Clear</button>`);
      clear.onclick = () => { raceIso = null; paint(); };
      raceRow.appendChild(clear);
    } else {
      const pick = el(`<button type="button" class="date-btn">Pick race date</button>`);
      pick.onclick = () => openDatePickerModal(addDaysIso(startIso, weeksCount() * 7 - 1), (iso) => {
        raceIso = iso;
        startIso = addDaysIso(mondayOfIso(iso), -(weeksCount() - 1) * 7);
        paint();
      });
      raceRow.appendChild(pick);
    }
    startRow.innerHTML = "";
    startRow.appendChild(renderDateButton(startIso, (iso) => { startIso = mondayOfIso(iso); paint(); }));

    const end = addDaysIso(startIso, weeksCount() * 7 - 1);
    const half = planWeekDate(32, 5);
    const lines = [
      `Week 1 starts <b>${fmtLongDate(startIso)}</b>`,
      half ? `Half marathon <b>${fmtLongDate(half)}</b>` : "",
      `Marathon <b>${fmtLongDate(end)}</b>`,
    ].filter(Boolean);
    let warn = "";
    if (raceIso && raceIso !== end) {
      const diff = daysBetweenIso(end, raceIso);
      warn = `<div class="run-warn" style="margin:10px 0 0;">The plan's marathon Sunday is ${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} ${diff > 0 ? "before" : "after"} your race. ${Math.abs(diff) < 7 ? "Shift that last week's runs to fit race day." : "Adjust the start date or race date."}</div>`;
    }
    preview.innerHTML = lines.join("<br>") + warn;
  }
  weekSel.onchange = () => {
    if (raceIso) startIso = addDaysIso(mondayOfIso(raceIso), -(weeksCount() - 1) * 7);
    paint();
  };
  paint();

  const close = () => document.body.removeChild(overlay);
  overlay.appendChild(modal);
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  modal.querySelector("#run-cancel").onclick = close;
  modal.querySelector("#run-save").onclick = () => {
    const first = Number(weekSel.value);
    marathon.settings = { startDate: startIso, raceName: nameIn.value.trim() || null, raceDate: raceIso };
    marathon.sequence = Array.from({ length: 50 - first + 1 }, (_, i) => ({ w: first + i }));
    saveMarathon();
    state.runCalIdx = null;
    close();
    render();
  };
  const removeBtn = modal.querySelector("#run-remove");
  if (removeBtn) removeBtn.onclick = () => {
    if (!confirm("Remove the marathon plan? Your logged runs stay in History and the CSV export.")) return;
    marathon.settings = null;
    marathon.sequence = [];
    saveMarathon();
    close();
    render();
  };
  document.body.appendChild(overlay);
  trapFocus(overlay);
}

// ---- History / export helpers used by app.js ----
function runDatesWithData() {
  return Object.keys(marathon.runs || {}).filter((d) => runHasData(marathon.runs[d]));
}
function runHistoryLine(iso) {
  const r = runRecord(iso);
  if (!runHasData(r)) return null;
  const label = r.label ? `${escapeHtml(r.label)}${r.planWeek ? ` (wk ${r.planWeek})` : ""}` : "Run";
  const summary = runSummaryText(r);
  const extras = [r.pain ? "pain flagged" : "", r.note ? escapeHtml(r.note) : ""].filter(Boolean).join("; ");
  return `<div class="hist-line"><b>🏃 ${label}:</b> ${escapeHtml(summary)}${extras ? ` <span class="hist-run-extra">${extras}</span>` : ""}</div>`;
}
function runCsvRows(from, to) {
  return runDatesWithData().sort().filter((d) => (!from || d >= from) && (!to || d <= to)).map((d) => {
    const r = marathon.runs[d];
    const notes = [
      r.secs != null ? `Time ${fmtDuration(r.secs)}` : "",
      fmtPace(r) ? `Pace ${fmtPace(r)}` : "",
      r.feel ? `Felt ${r.feel}` : "",
      r.pain ? "Pain flagged" : "",
      r.plannedMiles != null ? `Planned ${fmtNum(r.plannedMiles)} mi` : "",
      r.planWeek ? `Plan week ${r.planWeek}` : "",
      r.note || "",
    ].filter(Boolean).join("; ");
    return [d, "Run", r.label || "Run", "run", "", "", r.miles ?? (r.done ? "done" : ""), notes];
  });
}
