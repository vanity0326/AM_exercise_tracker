(function () {
  "use strict";
  const KEY = "daily-health-tracker-v1";
  const app = document.getElementById("view-content");
  const navButtons = Array.from(document.querySelectorAll(".tab"));
  const seed = window.DAILY_TRACKER_HISTORY_SEED || { dailyLogDays: {}, weighIns: {}, importSummary: {} };
  const BASE = { food: 11900, move: 5250, exercise: 4375, steps: 10000 };
  const CURRENT = { food: 11900, move: 5250, exercise: 2000, steps: 5600 };
  const BUILT_IN_MEASUREMENTS = [
    { name: "Neck", unit: "in" }, { name: "Shoulders", unit: "in" },
    { name: "Chest", unit: "in" }, { name: "Band (chest)", unit: "in" },
    { name: "Bicep", unit: "in" }, { name: "Waist", unit: "in" },
    { name: "Hips", unit: "in" }, { name: "Thigh", unit: "in" }, { name: "Calf", unit: "in" }
  ];
  const WEIGHT_METRICS = [
    { label: "Weight", key: "weightLbs", unit: "lb", digits: 1 },
    { label: "Fat Mass %", key: "fatMassPct", unit: "%", digits: 1 },
    { label: "Lean Mass %", key: "leanMassPct", unit: "%", digits: 1 },
    { label: "BMI", key: "bmi", unit: "", digits: 1 },
    { label: "Muscle Mass %", key: "muscleMassPct", unit: "%", digits: 1 }
  ];
  let flash = "";
  let state;
  let syncStatus = "loading";
  let syncETag = null;
  let lastSharedState = null;
  let syncTimer = null;
  let syncInFlight = false;
  let syncQueued = false;
  let appReady = false;
  const SYNC_URL = "/api/data";

  function copy(x) { return JSON.parse(JSON.stringify(x)); }
  function localISO(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function today() { return localISO(new Date()); }
  function dateObj(s) { return new Date(s + "T12:00:00"); }
  function addDays(s, n) { const d = dateObj(s); d.setDate(d.getDate() + n); return localISO(d); }
  function monday(s) {
    const d = dateObj(s);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return localISO(d);
  }
  function nextMonday(s) { return addDays(monday(s), 7); }
  function fmt(s, options) {
    return new Intl.DateTimeFormat("en-US", options || { month: "short", day: "numeric" }).format(dateObj(s));
  }
  function number(v, digits) {
    return Number(v).toLocaleString("en-US", { maximumFractionDigits: digits || 0 });
  }
  function randomId() {
    return window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
  }
  function node(tag, cls, text) {
    const x = document.createElement(tag);
    if (cls) x.className = cls;
    if (text !== undefined && text !== null) x.textContent = String(text);
    return x;
  }
  function button(text, cls, action) {
    const b = node("button", cls || "secondary-button", text);
    b.type = "button";
    if (action) b.dataset.action = action;
    return b;
  }
  function field(labelText, name, value, opts) {
    opts = opts || {};
    const wrap = node("div", "field");
    const label = node("label", "", labelText);
    label.htmlFor = opts.id || name;
    const input = document.createElement(opts.select ? "select" : "input");
    input.id = opts.id || name;
    input.name = name;
    if (opts.select) {
      opts.options.forEach(function (item) {
        const option = node("option", "", item.label);
        option.value = item.value;
        input.appendChild(option);
      });
      input.value = value == null ? "" : String(value);
    } else {
      input.type = opts.type || "number";
      if (opts.type !== "text" && opts.type !== "time" && opts.type !== "month" && opts.type !== "date") {
        input.min = "0";
        input.step = opts.step || "1";
      }
      if (value !== null && value !== undefined) input.value = String(value);
      if (opts.placeholder) input.placeholder = opts.placeholder;
      if (opts.maxlength) input.maxLength = opts.maxlength;
    }
    wrap.append(label, input);
    return wrap;
  }
  function datePicker(id, value, label) {
    const wrap = node("label", "date-control-wrap");
    wrap.appendChild(node("span", "field-hint", label));
    const input = document.createElement("input");
    input.type = "date";
    input.id = id;
    input.value = value;
    input.className = "date-control";
    wrap.appendChild(input);
    return wrap;
  }
  function monthPicker(id, value, label) {
    const wrap = node("label", "date-control-wrap");
    wrap.appendChild(node("span", "field-hint", label));
    const input = document.createElement("input");
    input.type = "month";
    input.id = id;
    input.value = value;
    input.className = "date-control";
    wrap.appendChild(input);
    return wrap;
  }
  function card(title, subtitle) {
    const c = node("section", "card");
    if (title) c.appendChild(node("h3", "", title));
    if (subtitle) c.appendChild(node("p", "card-intro", subtitle));
    return c;
  }
  function form(id, cls) {
    const f = node("form", cls === undefined ? "card" : cls);
    f.id = id;
    return f;
  }
  function titleBlock(title, subtitle, extra) {
    const wrap = node("div", "page-title");
    const left = node("div");
    left.append(node("h2", "", title), node("p", "", subtitle));
    wrap.appendChild(left);
    if (extra) wrap.appendChild(extra);
    return wrap;
  }
  function messageNode(text, warning) { return node("p", warning ? "message warning" : "message", text); }
  function empty(text) { return node("p", "empty-state", text); }
  function addFlash(container) { if (flash) container.appendChild(messageNode(flash)); }

  function getTargets(date) {
    const start = monday(date);
    const entries = state.settings.targets.slice().sort(function (a, b) { return a.effectiveFrom.localeCompare(b.effectiveFrom); });
    let result = entries[0] || Object.assign({ effectiveFrom: "2026-01-05" }, BASE);
    entries.forEach(function (entry) { if (entry.effectiveFrom <= start) result = entry; });
    return result;
  }
  function guides(date) {
    const t = getTargets(date);
    const out = { foodDaily: t.food / 7, moveDaily: t.move / 7, exerciseDaily: t.exercise / 7, stepsDaily: t.steps };
    const override = state.settings.dailyOverrides[date] || {};
    Object.keys(out).forEach(function (key) { if (Number.isFinite(override[key])) out[key] = override[key]; });
    return out;
  }
  function foodBounds(date) {
    const upper = guides(date).foodDaily;
    return { lower: Math.min(upper, Math.max(1200, upper - 200)), upper: upper };
  }
  function foodStatus(value, date) {
    const range = foodBounds(date);
    if (value < range.lower) return { key: "below", text: "Below range by " + number(range.lower - value) + " calories" };
    if (value > range.upper) return { key: "above", text: "Above range by " + number(value - range.upper) + " calories" };
    return { key: "within", text: "Within range · " + number(range.lower) + "–" + number(range.upper) + " calories" };
  }
  function foodRangeVisual(date, value) {
    const range = foodBounds(date);
    const scaleMax = Math.max(2400, Math.ceil(range.upper * 1.4 / 100) * 100,
      value === null ? 0 : Math.ceil(value * 1.1 / 100) * 100);
    const visual = node("div", "food-range-visual");
    visual.setAttribute("role", "img");
    visual.setAttribute("aria-label", value === null
      ? "Daily food target range " + number(range.lower) + " to " + number(range.upper) + " calories"
      : "Food intake " + number(value) + " calories. " + foodStatus(value, date).text);
    const track = node("div", "food-range-track");
    const band = node("span", "food-range-band");
    band.style.left = (range.lower / scaleMax * 100) + "%";
    band.style.width = ((range.upper - range.lower) / scaleMax * 100) + "%";
    track.appendChild(band);
    if (value !== null) {
      const marker = node("span", "food-range-marker " + foodStatus(value, date).key);
      marker.style.left = Math.min(100, Math.max(0, value / scaleMax * 100)) + "%";
      track.appendChild(marker);
    }
    visual.appendChild(track);
    const axis = node("div", "food-range-axis");
    axis.append(node("span", "", "0"), node("span", "", "Target " + number(range.lower) + "–" + number(range.upper)), node("span", "", number(scaleMax) + "+"));
    visual.appendChild(axis);
    return visual;
  }
  function getMetric(log, metric) {
    if (!log) return null;
    if (metric === "exercise") {
      if (!log.exerciseLogged && !(log.sessions || []).length) return null;
      return (log.sessions || []).reduce(function (sum, session) { return sum + (Number(session.activeCalories) || 0); }, 0);
    }
    return Number.isFinite(log[metric]) ? log[metric] : null;
  }
  function hasEntry(log) {
    return !!log && (Number.isFinite(log.food) || Number.isFinite(log.move) ||
      Number.isFinite(log.steps) || log.exerciseLogged === true ||
      !!(log.sessions && log.sessions.length) || !!log.historicalActivityType);
  }
  function daysOf(start) { return Array.from({ length: 7 }, function (_, i) { return addDays(start, i); }); }
  function weekData(start) {
    const result = {};
    ["food", "move", "exercise", "steps"].forEach(function (key) {
      const values = daysOf(start).map(function (day) { return getMetric(state.logs[day], key); }).filter(function (v) { return v !== null; });
      result[key] = { sum: values.reduce(function (a, b) { return a + b; }, 0), count: values.length, average: values.length ? values.reduce(function (a, b) { return a + b; }, 0) / values.length : null };
    });
    return result;
  }
  function shortDay(s) { return ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][dateObj(s).getDay()]; }
  function dayStrip(metric, start, selected, compactSteps) {
    const strip = node("div", "day-strip");
    strip.setAttribute("aria-label", metric + " entries by day");
    daysOf(start).forEach(function (day) {
      const value = getMetric(state.logs[day], metric);
      const foodState = metric === "food" && value !== null ? foodStatus(value, day).key : null;
      const cls = "day-cell" + (day === selected ? " selected" : "") +
        (value === null ? " empty" : metric === "food" ? " food-entry food-" + foodState : " recorded");
      const b = button("", cls, "select-date");
      b.dataset.date = day;
      const foodLabel = foodState ? " · " + foodStatus(value, day).text : "";
      b.setAttribute("aria-label", shortDay(day) + ", " + (value === null ? "not logged" : number(value) + (metric === "steps" ? " steps" : " calories" + foodLabel)));
      b.appendChild(node("span", "dow", shortDay(day)));
      let shown = value === null ? "—" : number(value);
      if (compactSteps && value !== null && value >= 10000) shown = (value / 1000).toFixed(0) + "k";
      b.appendChild(node("span", "day-value", shown));
      strip.appendChild(b);
    });
    return strip;
  }
  function dateRange(s) { return fmt(s) + "–" + fmt(addDays(s, 6), { month: "short", day: "numeric" }); }
  function addWeeklyTotal(container, actual, target, label, count) {
    const row = node("div", "weekly-total");
    row.append(node("strong", "", actual), node("span", "", label + " · " + count + " of 7 days with entries"));
    row.appendChild(node("span", "", "Target: " + number(target)));
    container.appendChild(row);
  }
  function makeDateActions(date) {
    const wrap = node("div", "date-row");
    const prev = button("‹", "date-nav", "shift-date");
    const next = button("›", "date-nav", "shift-date");
    prev.dataset.delta = "-1"; next.dataset.delta = "1";
    wrap.append(prev, datePicker("selectedDate", date, "Selected day"), next);
    if (date !== today()) wrap.appendChild(button("Today", "text-button", "jump-today"));
    return wrap;
  }

  function renderToday() {
    const date = state.ui.selectedDate;
    const weekStart = monday(date);
    const target = getTargets(date);
    const log = state.logs[date] || {};
    const totals = weekData(weekStart);
    const foodValue = getMetric(log, "food");
    app.appendChild(titleBlock("Daily log", fmt(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }), makeDateActions(date)));
    addFlash(app);
    const status = node("div", "log-status");
    status.append(node("span", "positive-note", hasEntry(log) ? "This date is logged. You can add more later." : "A partial entry is enough to get started."));
    status.append(node("span", "tag", hasEntry(log) ? "Saved" : "Not logged yet"));
    app.appendChild(status);

    const foodRange = foodBounds(date);
    const foodCard = card("Food", "Daily range · weekly goal " + number(target.food) + " calories");
    const head = node("div", "card-head");
    const headLeft = node("div");
    headLeft.appendChild(node("p", "card-intro", foodValue === null ? "No food total entered yet." : number(foodValue) + " calories logged for this date"));
    head.append(headLeft, node("span", "tag", "Target " + number(foodRange.lower) + "–" + number(foodRange.upper)));
    foodCard.appendChild(head);
    foodCard.appendChild(foodRangeVisual(date, foodValue));
    if (foodValue !== null) {
      const detail = node("div", "food-values");
      detail.append(node("span", "", number(foodValue) + " logged"), node("strong", "food-range-status " + foodStatus(foodValue, date).key, foodStatus(foodValue, date).text));
      foodCard.appendChild(detail);
    } else foodCard.appendChild(empty("Log a total to see whether it falls below, within, or above your range."));
    addWeeklyTotal(foodCard, totals.food.count ? number(totals.food.sum) + " cal" : "No totals yet", target.food, "This week", totals.food.count);
    foodCard.appendChild(dayStrip("food", weekStart, date, false));
    app.appendChild(foodCard);

    const dailyForm = form("dailyForm");
    dailyForm.append(node("h3", "", "Entries for this date"), node("p", "card-intro", "Save what you have now and update it later."));
    const hiddenDate = document.createElement("input"); hiddenDate.type = "hidden"; hiddenDate.name = "date"; hiddenDate.value = date;
    dailyForm.appendChild(hiddenDate);
    const inputGrid = node("div", "form-grid");
    inputGrid.append(
      field("Food total (calories)", "food", log.food, { placeholder: "One total for the day" }),
      field("Move · all-day Active Calories", "move", log.move, { placeholder: "From Apple Fitness" }),
      field("Steps", "steps", log.steps, { placeholder: "Daily total" })
    );
    dailyForm.appendChild(inputGrid);
    const noWorkoutLabel = node("label", "form-check");
    const noWorkout = document.createElement("input");
    noWorkout.type = "checkbox"; noWorkout.name = "noWorkout"; noWorkout.checked = !!log.noWorkout;
    noWorkout.disabled = !!(log.sessions && log.sessions.length);
    noWorkoutLabel.append(noWorkout, node("span", "", "No workout on this date (record 0 Active Calories)"));
    dailyForm.append(noWorkoutLabel);
    const saveDaily = button("Save daily entries", "primary-button"); saveDaily.type = "submit";
    dailyForm.appendChild(saveDaily); app.appendChild(dailyForm);

    const sessions = log.sessions || [];
    const exerciseTotal = getMetric(log, "exercise");
    const workoutCard = card("Exercise sessions", "Record workout Active Calories from Apple Fitness. Multiple sessions add together.");
    workoutCard.appendChild(node("div", "weekly-total", (exerciseTotal === null ? "No exercise entry" : number(exerciseTotal) + " Active Calories for this date") + " · " + number(target.exercise) + " per week"));
    if (sessions.length) {
      const list = node("div", "session-list");
      sessions.forEach(function (session) {
        const row = node("div", "session-row");
        const details = node("div");
        details.append(node("strong", "", session.name || "Workout"), node("small", "", number(session.activeCalories) + " Active Calories" + (session.source === "spreadsheet" ? " · imported daily total" : "")));
        const remove = button("Remove", "remove", "remove-session");
        remove.dataset.id = session.id; remove.dataset.date = date;
        row.append(details, remove); list.appendChild(row);
      });
      workoutCard.appendChild(list);
    } else workoutCard.appendChild(empty(log.noWorkout ? "No workout recorded for this day." : "No workout sessions entered for this day."));
    const workoutForm = form("workoutForm", "");
    const workoutDate = document.createElement("input"); workoutDate.type = "hidden"; workoutDate.name = "date"; workoutDate.value = date;
    workoutForm.appendChild(workoutDate);
    const workoutFields = node("div", "form-grid");
    workoutFields.append(field("Workout", "name", "", { type: "text", maxlength: 60, placeholder: "e.g., Swim, Elliptical" }));
    workoutFields.append(field("Active Calories", "activeCalories", "", { placeholder: "From workout details" }));
    workoutForm.appendChild(workoutFields);
    const addWorkout = button("Add workout session", "secondary-button"); addWorkout.type = "submit";
    workoutForm.appendChild(addWorkout); workoutCard.appendChild(workoutForm);
    workoutCard.appendChild(node("p", "hint", "Move is the all-day Active Calories total. Exercise is workout-only and kept separate."));
    app.appendChild(workoutCard);

    const pointsCard = card("Logging reward", "One point for your first saved daily entry each calendar day, even when you log yesterday. Missed days never erase points.");
    pointsCard.appendChild(node("div", "big-value", String(state.settings.logPoints.length) + " points"));
    app.appendChild(pointsCard);
  }

  function reviewMetric(container, title, metric, target, unit, weekStart) {
    const data = weekData(weekStart)[metric];
    const actual = metric === "steps" ? data.average : data.sum;
    const end = addDays(weekStart, 6);
    let detail = data.count ? (end < today() ? data.count + " of 7 days recorded" : data.count + " days recorded so far") + (metric === "steps" ? " · mean of recorded days" : "") : "No entries; blank days are not zero.";
    if (metric === "food" && data.count) {
      const inRange = daysOf(weekStart).filter(function (day) {
        const value = getMetric(state.logs[day], "food");
        return value !== null && value >= foodBounds(day).lower && value <= foodBounds(day).upper;
      }).length;
      detail += " · avg " + number(data.average) + " cal/day · " + inRange + " of " + data.count + " logged in range";
    }
    const wrap = node("div", "target-row");
    const left = node("div");
    left.append(node("strong", "", title), node("div", "target-label", detail));
    const actualText = actual === null ? "—" : number(actual) + (metric === "steps" ? " steps/day" : " " + unit);
    wrap.append(left, node("span", "target-number", actualText), node("span", "target-label", "Target " + number(target) + (metric === "steps" ? " avg/day" : " " + unit)));
    container.appendChild(wrap);
  }
  function lastMondayWeights(weekStart) {
    const end = addDays(weekStart, 6);
    const dates = Object.keys(state.weighIns).filter(function (d) { return d <= end && Number.isFinite(state.weighIns[d].weightLbs); }).sort();
    if (!dates.length) return [];
    const latest = dates[dates.length - 1];
    const from = addDays(latest, -28);
    return dates.filter(function (d) { return d >= from; });
  }
  function renderReview() {
    const start = state.ui.reviewWeek || monday(today());
    const targets = getTargets(start);
    const right = node("div", "date-row");
    const prev = button("‹", "date-nav", "shift-week"); prev.dataset.delta = "-1";
    const next = button("›", "date-nav", "shift-week"); next.dataset.delta = "1";
    right.append(prev, node("span", "tag", dateRange(start)), next);
    app.appendChild(titleBlock("Weekly review", "See weekly totals and the four-week weight trend.", right));
    addFlash(app);
    const c = card("Progress this week", "Review the week without treating missing entries as zero.");
    reviewMetric(c, "Food", "food", targets.food, "calories", start);
    reviewMetric(c, "Move", "move", targets.move, "calories", start);
    reviewMetric(c, "Exercise · Active Calories", "exercise", targets.exercise, "Active Calories", start);
    reviewMetric(c, "Steps", "steps", targets.steps, "steps", start);
    app.appendChild(c);
    const trend = card("Four-week weight trend", "Monday readings from your Withings scale.");
    trend.appendChild(node("div", "tag", "Goal: lose " + number(state.settings.weightLossGoalPerWeek, 1) + " lb/week"));
    const points = lastMondayWeights(start);
    if (!points.length) trend.appendChild(empty("Your Monday readings will build the trend here."));
    else if (points.length < 5) {
      trend.appendChild(node("p", "hint", points.length + " Monday reading" + (points.length === 1 ? "" : "s") + " in the current window. Five readings span four weeks."));
      points.forEach(function (day) {
        const row = node("div", "list-row");
        row.append(node("span", "", fmt(day, { month: "short", day: "numeric" })), node("strong", "", number(state.weighIns[day].weightLbs, 1) + " lb"));
        trend.appendChild(row);
      });
    } else {
      const first = state.weighIns[points[0]].weightLbs;
      const last = state.weighIns[points[points.length - 1]].weightLbs;
      const delta = last - first;
      const rate = delta / 4;
      const sign = delta > 0 ? "+" : "";
      const rateSign = rate > 0 ? "+" : "";
      trend.appendChild(node("div", "trend-summary", sign + number(delta, 1) + " lb over four weeks · " + rateSign + number(rate, 1) + " lb/week"));
      const values = node("div", "trend-values");
      points.forEach(function (day) {
        const chip = node("span", "", fmt(day, { month: "short", day: "numeric" }));
        chip.appendChild(node("strong", "", number(state.weighIns[day].weightLbs, 1) + " lb"));
        values.appendChild(chip);
      });
      trend.appendChild(values);
      trend.appendChild(node("p", "hint", "Compare with your 2 lb/week aim. Review your logs and decide whether to adjust targets; nothing changes automatically."));
    }
    app.appendChild(trend);
    const nextCard = card("Adjusting targets", "Weekly changes start the following Monday. You stay in control of adjustments.");
    nextCard.appendChild(button("Review targets and reminders", "secondary-button", "go-settings"));
    app.appendChild(nextCard);
  }

  function pct(v) { return v == null ? "—" : number(v, 1) + "%"; }
  function renderWeight() {
    const selected = state.ui.weightDate || monday(today());
    const record = state.weighIns[selected] || {};
    app.appendChild(titleBlock("Monday weigh-in", "Enter the Withings scale reading for a Monday.", datePicker("weightDate", selected, "Weigh-in date")));
    addFlash(app);
    const f = form("weightForm");
    f.append(node("h3", "", "Withings reading"), node("p", "card-intro", "Record what the scale shows and leave unavailable fields blank."));
    if (dateObj(selected).getDay() !== 1) f.appendChild(messageNode("Choose a Monday for the weekly weigh-in.", true));
    const grid = node("div", "form-grid");
    [["Weight (lb)", "weightLbs"], ["Fat mass (%)", "fatMassPct"], ["Lean mass (%)", "leanMassPct"], ["BMI", "bmi"], ["Muscle mass (%)", "muscleMassPct"]].forEach(function (pair) {
      grid.appendChild(field(pair[0], pair[1], record[pair[1]], { step: "0.1", placeholder: "Optional" }));
    });
    f.appendChild(grid);
    const hidden = document.createElement("input"); hidden.type = "hidden"; hidden.name = "date"; hidden.value = selected;
    const saveWeight = button("Save Monday reading", "primary-button"); saveWeight.type = "submit";
    f.append(hidden, saveWeight); app.appendChild(f);
    const history = card("Recent weigh-ins", "Imported scale history; unavailable values remain blank.");
    const dates = Object.keys(state.weighIns).filter(function (day) { return Number.isFinite(state.weighIns[day].weightLbs); }).sort().reverse().slice(0, 8);
    if (!dates.length) history.appendChild(empty("No weigh-ins recorded."));
    dates.forEach(function (day) {
      const r = node("div", "list-row");
      const h = node("div", "list-row-head");
      h.append(node("strong", "", fmt(day, { month: "long", day: "numeric", year: "numeric" })), node("span", "small-value", number(state.weighIns[day].weightLbs, 1) + " lb"));
      const v = state.weighIns[day];
      r.append(h, node("p", "hint", "Fat " + pct(v.fatMassPct) + " · Lean " + pct(v.leanMassPct) + " · BMI " + (v.bmi == null ? "—" : number(v.bmi, 1)) + " · Muscle " + pct(v.muscleMassPct)));
      history.appendChild(r);
    });
    app.appendChild(history);
  }

  function monthString(s) { return s.slice(0, 7); }
  function shiftMonth(month, delta) {
    const parts = month.split("-").map(Number);
    const d = new Date(parts[0], parts[1] - 1 + delta, 1, 12);
    return localISO(d).slice(0, 7);
  }
  function monthLabel(month) {
    const p = month.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(p[0], p[1] - 1, 1, 12));
  }
  function registeredMeasurementTypes() {
    const types = new Map();
    BUILT_IN_MEASUREMENTS.forEach(function (type) { types.set(type.name.toLowerCase(), type); });
    (state.settings.measurementTypes || []).forEach(function (type) {
      if (type && type.name) types.set(type.name.toLowerCase(), { name: type.name, unit: type.unit || "in" });
    });
    state.measurements.forEach(function (item) {
      if (item && item.name && !types.has(item.name.toLowerCase())) types.set(item.name.toLowerCase(), { name: item.name, unit: item.unit || "in" });
    });
    return Array.from(types.values()).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }
  function measurementTrend(container, type, month) {
    const records = state.measurements.filter(function (item) {
      return item.name.toLowerCase() === type.name.toLowerCase() && item.month <= month;
    }).sort(function (a, b) { return a.month.localeCompare(b.month); }).slice(-6);
    if (!records.length) {
      container.appendChild(empty("No entries yet. Your first monthly reading will start the trend."));
      return;
    }
    const latest = records[records.length - 1];
    const previous = records.length > 1 ? records[records.length - 2] : null;
    const summary = node("div", "measurement-current");
    summary.appendChild(node("strong", "", number(latest.value, 1) + " " + (latest.unit || type.unit)));
    summary.appendChild(node("span", "", monthLabel(latest.month)));
    container.appendChild(summary);
    if (previous) {
      const delta = latest.value - previous.value;
      const prefix = delta > 0 ? "+" : "";
      container.appendChild(node("p", "measurement-change", prefix + number(delta, 1) + " " + (latest.unit || type.unit) + " since " + monthLabel(previous.month)));
      const svgNS = "http://www.w3.org/2000/svg";
      const chart = document.createElementNS(svgNS, "svg");
      chart.setAttribute("viewBox", "0 0 300 56");
      chart.setAttribute("role", "img");
      chart.setAttribute("aria-label", type.name + " monthly trend in " + (latest.unit || type.unit));
      const title = document.createElementNS(svgNS, "title");
      title.textContent = type.name + " monthly measurements";
      chart.appendChild(title);
      const values = records.map(function (item) { return item.value; });
      const low = Math.min.apply(null, values), high = Math.max.apply(null, values);
      const span = high - low || 1;
      const coords = records.map(function (item, index) {
        return { x: 8 + index * (284 / Math.max(1, records.length - 1)), y: 43 - ((item.value - low) / span) * 32, item: item };
      });
      const baseline = document.createElementNS(svgNS, "path");
      baseline.setAttribute("class", "measurement-baseline");
      baseline.setAttribute("d", "M4 47H296");
      chart.appendChild(baseline);
      const line = document.createElementNS(svgNS, "path");
      line.setAttribute("class", "measurement-line");
      line.setAttribute("d", coords.map(function (point, index) { return (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1); }).join(" "));
      chart.appendChild(line);
      coords.forEach(function (point, index) {
        const dot = document.createElementNS(svgNS, "circle");
        dot.setAttribute("cx", point.x.toFixed(1)); dot.setAttribute("cy", point.y.toFixed(1));
        dot.setAttribute("r", index === coords.length - 1 ? "4" : "3");
        chart.appendChild(dot);
      });
      container.appendChild(chart);
      const labels = node("div", "measurement-months");
      labels.style.gridTemplateColumns = "repeat(" + records.length + ", minmax(0, 1fr))";
      records.forEach(function (item) { labels.appendChild(node("span", "", monthLabel(item.month).split(" ")[0])); });
      container.appendChild(labels);
    } else {
      container.appendChild(node("p", "hint", "One reading recorded · add another month to see a trend."));
    }
  }
  function latestWeightRecords(metric) {
    return Object.keys(state.weighIns).filter(function (day) {
      return day <= today() && Number.isFinite(state.weighIns[day][metric.key]);
    }).sort().slice(-6).map(function (day) { return { day: day, value: state.weighIns[day][metric.key] }; });
  }
  function monthlyWeightRecords() {
    const firstByMonth = {};
    Object.keys(state.weighIns).filter(function (day) {
      return day <= today() && Number.isFinite(state.weighIns[day].weightLbs);
    }).sort().forEach(function (day) {
      const month = monthString(day);
      if (!firstByMonth[month]) firstByMonth[month] = { month: month, day: day, value: state.weighIns[day].weightLbs };
    });
    return Object.keys(firstByMonth).sort().slice(-12).map(function (month) { return firstByMonth[month]; });
  }
  function weightMetricCard(metric) {
    const c = card(metric.label, "Latest saved reading from the Weight tab");
    const records = latestWeightRecords(metric);
    if (!records.length) {
      c.appendChild(empty("No " + metric.label.toLowerCase() + " readings yet. Add them on the Weight tab."));
      return c;
    }
    const latest = records[records.length - 1], previous = records.length > 1 ? records[records.length - 2] : null;
    const summary = node("div", "measurement-current");
    summary.appendChild(node("strong", "", number(latest.value, metric.digits) + (metric.unit ? " " + metric.unit : "")));
    summary.appendChild(node("span", "", fmt(latest.day, { month: "short", day: "numeric", year: "numeric" })));
    c.appendChild(summary);
    if (previous) {
      const delta = latest.value - previous.value;
      c.appendChild(node("p", "measurement-change", (delta > 0 ? "+" : "") + number(delta, metric.digits) + (metric.unit ? " " + metric.unit : "") + " since " + fmt(previous.day, { month: "short", day: "numeric" })));
      const svgNS = "http://www.w3.org/2000/svg", chart = document.createElementNS(svgNS, "svg");
      chart.setAttribute("viewBox", "0 0 300 56"); chart.setAttribute("role", "img");
      chart.setAttribute("aria-label", metric.label + " weekly trend from Weight tab");
      const values = records.map(function (item) { return item.value; });
      const low = Math.min.apply(null, values), high = Math.max.apply(null, values), span = high - low || 1;
      const coords = records.map(function (item, index) { return { x: 8 + index * (284 / Math.max(1, records.length - 1)), y: 43 - ((item.value - low) / span) * 32 }; });
      const baseline = document.createElementNS(svgNS, "path"); baseline.setAttribute("class", "measurement-baseline"); baseline.setAttribute("d", "M4 47H296"); chart.appendChild(baseline);
      const line = document.createElementNS(svgNS, "path"); line.setAttribute("class", "measurement-line");
      line.setAttribute("d", coords.map(function (point, index) { return (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1); }).join(" ")); chart.appendChild(line);
      coords.forEach(function (point, index) { const dot = document.createElementNS(svgNS, "circle"); dot.setAttribute("cx", point.x.toFixed(1)); dot.setAttribute("cy", point.y.toFixed(1)); dot.setAttribute("r", index === coords.length - 1 ? "4" : "3"); chart.appendChild(dot); });
      c.appendChild(chart);
      const labels = node("div", "measurement-months"); labels.style.gridTemplateColumns = "repeat(" + records.length + ", minmax(0, 1fr))";
      records.forEach(function (item) { labels.appendChild(node("span", "", fmt(item.day, { month: "short", day: "numeric" }))); });
      c.appendChild(labels);
    } else c.appendChild(node("p", "hint", "One weigh-in recorded · another Monday reading will add to this trend."));
    return c;
  }
  function monthlyWeightTrendCard() {
    const c = card("Monthly Weight Trend", "Closest saved weigh-in on or after the first day of each month · last 12 months");
    const records = monthlyWeightRecords();
    if (!records.length) {
      c.appendChild(empty("The monthly trend will begin when a weigh-in is saved this month."));
      return c;
    }
    const svgNS = "http://www.w3.org/2000/svg", chart = document.createElementNS(svgNS, "svg");
    chart.setAttribute("viewBox", "0 0 300 72");
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", "Monthly weight trend using the first available weigh-in in each month");
    const title = document.createElementNS(svgNS, "title");
    title.textContent = "Weight at the first available weigh-in of each month";
    chart.appendChild(title);
    const values = records.map(function (item) { return item.value; });
    const low = Math.min.apply(null, values), high = Math.max.apply(null, values), span = high - low || 1;
    const coords = records.map(function (item, index) {
      return { x: 8 + index * (284 / Math.max(1, records.length - 1)), y: 53 - ((item.value - low) / span) * 40, item: item };
    });
    const baseline = document.createElementNS(svgNS, "path");
    baseline.setAttribute("class", "measurement-baseline"); baseline.setAttribute("d", "M4 57H296"); chart.appendChild(baseline);
    const line = document.createElementNS(svgNS, "path"); line.setAttribute("class", "measurement-line");
    line.setAttribute("d", coords.map(function (point, index) { return (index ? "L" : "M") + point.x.toFixed(1) + " " + point.y.toFixed(1); }).join(" ")); chart.appendChild(line);
    coords.forEach(function (point, index) {
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", point.x.toFixed(1)); dot.setAttribute("cy", point.y.toFixed(1));
      dot.setAttribute("r", index === coords.length - 1 ? "4" : "3");
      const pointTitle = document.createElementNS(svgNS, "title");
      pointTitle.textContent = monthLabel(point.item.month) + ": " + number(point.item.value, 1) + " lb (" + fmt(point.item.day, { month: "short", day: "numeric" }) + ")";
      dot.appendChild(pointTitle); chart.appendChild(dot);
    });
    chart.classList.add("monthly-weight-chart");
    c.appendChild(chart);
    const labels = node("div", "measurement-months");
    labels.style.gridTemplateColumns = "repeat(" + records.length + ", minmax(0, 1fr))";
    records.forEach(function (item) { labels.appendChild(node("span", "", monthLabel(item.month).split(" ")[0].slice(0, 3))); });
    c.appendChild(labels);
    return c;
  }
  function renderMeasurementTypeForm() {
    const f = form("measurementTypeForm", "card");
    f.append(node("h3", "", "Add a measurement type"), node("p", "card-intro", "Name any measurement you want to follow and choose its unit."));
    const grid = node("div", "measure-grid");
    grid.append(field("Name", "name", "", { type: "text", maxlength: 40, placeholder: "e.g., waist" }));
    grid.append(field("Unit", "unit", "in", { type: "text", maxlength: 12, placeholder: "in, cm, etc." }));
    const actions = node("div", "button-row");
    const add = button("Add type", "primary-button"); add.type = "submit";
    actions.append(add, button("Cancel", "text-button", "cancel-measurement-type"));
    f.append(grid, actions);
    return f;
  }
  function renderMeasurementEntryForm(month, types) {
    if (!types.length) return null;
    const name = state.ui.measurementType && types.some(function (item) { return item.name === state.ui.measurementType; }) ? state.ui.measurementType : types[0].name;
    const type = types.find(function (item) { return item.name === name; }) || types[0];
    const f = form("measurementForm", "card");
    f.append(node("h3", "", "Log a monthly measurement"), node("p", "card-intro", "Add one reading for the selected month. You can update it later."));
    const hidden = document.createElement("input"); hidden.type = "hidden"; hidden.name = "month"; hidden.value = month;
    f.appendChild(hidden);
    const grid = node("div", "measure-grid");
    grid.append(field("Measurement type", "name", name, { select: true, id: "measurementTypeSelect", options: types.map(function (item) { return { label: item.name, value: item.name }; }) }));
    grid.append(field("Value", "value", "", { step: "0.1", placeholder: "Monthly reading" }));
    grid.appendChild(node("span", "measurement-unit-hint", "Unit: " + type.unit));
    const add = button("Save reading", "primary-button"); add.type = "submit";
    const actions = node("div", "button-row");
    actions.append(add, button("Cancel", "text-button", "cancel-measurement-entry"));
    f.append(grid, actions);
    return f;
  }
  function renderMeasurements() {
    const month = state.ui.measurementMonth || monthString(today());
    const types = registeredMeasurementTypes();
    const extra = node("div", "date-row");
    extra.appendChild(monthPicker("measurementMonth", month, "Month to log"));
    app.appendChild(titleBlock("Measurements", "Latest Weight-tab readings and monthly body measurements, together.", extra));
    addFlash(app);
    app.appendChild(node("h2", "section-title", "From your Weight tab"));
    app.appendChild(node("p", "card-intro", "These cards always show your latest saved Weight-tab readings, regardless of the month selected below. The monthly graph uses the first available weigh-in in each calendar month."));
    const weightCards = node("div", "measurement-cards measurement-source-cards");
    WEIGHT_METRICS.forEach(function (metric) { weightCards.appendChild(weightMetricCard(metric)); });
    weightCards.appendChild(monthlyWeightTrendCard());
    app.appendChild(weightCards);
    app.appendChild(node("h2", "section-title", "Monthly measurements"));
    app.appendChild(node("p", "card-intro", "Log these once a month. Add any other measurement and unit whenever you want."));
    const controls = node("div", "button-row");
    controls.appendChild(button("＋ Add measurement type", "secondary-button", "open-measurement-type"));
    app.appendChild(controls);
    if (state.ui.measurementTypeFormOpen) app.appendChild(renderMeasurementTypeForm());
    if (state.ui.measurementFormOpen) app.appendChild(renderMeasurementEntryForm(month, types));
    const list = node("div", "measurement-cards");
    types.forEach(function (type) {
      const c = card(type.name, "Monthly measurement · " + type.unit);
      const trend = node("div", "measurement-trend");
      measurementTrend(trend, type, month);
      c.appendChild(trend);
      const action = node("div", "button-row");
      const log = button("Log " + monthLabel(month), "secondary-button", "log-measurement");
      log.dataset.name = type.name;
      action.appendChild(log);
      c.appendChild(action);
      list.appendChild(c);
    });
    app.appendChild(list);
  }

  function renderHistory(month) {
    const data = Object.keys(state.logs).filter(function (day) { return monthString(day) === month && hasEntry(state.logs[day]); }).sort().reverse();
    if (!data.length) return empty("No daily entries recorded for " + monthLabel(month) + ".");
    const wrap = node("div");
    data.forEach(function (day) {
      const log = state.logs[day];
      const line = node("div", "list-row");
      const head = node("div", "list-row-head");
      head.appendChild(node("strong", "", fmt(day, { month: "short", day: "numeric", year: "numeric" })));
      const open = button("Open day", "text-button", "edit-date"); open.dataset.date = day; head.appendChild(open);
      const details = [];
      [["Food", "food"], ["Move", "move"], ["Exercise", "exercise"], ["Steps", "steps"]].forEach(function (pair) {
        const value = getMetric(log, pair[1]);
        details.push(pair[0] + " " + (value === null ? "—" : number(value)));
      });
      line.append(head, node("p", "hint", details.join(" · ") + (log.historicalActivityType ? " · " + log.historicalActivityType : "")));
      wrap.appendChild(line);
    });
    return wrap;
  }

  function renderTargetsTable() {
    const wrap = node("div", "table-wrap");
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Starts Monday", "Food/wk", "Move/wk", "Exercise/wk", "Steps avg/day"].forEach(function (text) { headRow.appendChild(node("th", "", text)); });
    head.appendChild(headRow); table.appendChild(head);
    const body = document.createElement("tbody");
    state.settings.targets.slice().sort(function (a, b) { return a.effectiveFrom.localeCompare(b.effectiveFrom); }).forEach(function (t) {
      const row = document.createElement("tr");
      [fmt(t.effectiveFrom, { month: "short", day: "numeric", year: "numeric" }), number(t.food), number(t.move), number(t.exercise), number(t.steps)].forEach(function (text) { row.appendChild(node("td", "", text)); });
      body.appendChild(row);
    });
    table.appendChild(body); wrap.appendChild(table);
    return wrap;
  }

  function renderMore() {
    const start = nextMonday(today());
    const targets = getTargets(start);
    app.appendChild(titleBlock("More", "Targets, reminders, history, and backup."));
    addFlash(app);
    const targetsCard = card("Weekly targets", "Changes start the following Monday and carry forward. One-week changes return to prior targets; one-day guides are separate.");
    targetsCard.appendChild(messageNode("Next target change date: " + fmt(start, { weekday: "long", month: "long", day: "numeric" }) + "."));
    const targetsForm = form("weeklyTargetsForm", "");
    const grid = node("div", "form-grid");
    grid.append(field("Food (calories/week)", "food", targets.food, { step: "1" }));
    grid.append(field("Move (Active Calories/week)", "move", targets.move, { step: "1" }));
    grid.append(field("Exercise (workout Active Calories/week)", "exercise", targets.exercise, { step: "1" }));
    grid.append(field("Steps (daily average)", "steps", targets.steps, { step: "1" }));
    targetsForm.appendChild(grid);
    targetsForm.appendChild(field("Duration", "duration", "ongoing", { select: true, options: [{ label: "Carry forward until changed", value: "ongoing" }, { label: "One week, then return to prior targets", value: "one-week" }] }));
    const saveGoals = button("Schedule target change", "primary-button"); saveGoals.type = "submit";
    targetsForm.appendChild(saveGoals); targetsCard.appendChild(targetsForm);
    targetsCard.append(node("hr", "section-divider"), node("h4", "", "Target history"), node("p", "hint", "Earlier weekly targets stay attached to the weeks they applied to."));
    targetsCard.appendChild(renderTargetsTable()); app.appendChild(targetsCard);

    const overrideCard = card("One-day target override", "Use a different daily guide for one date; weekly totals remain unchanged.");
    const overrideForm = form("dailyOverrideForm", "");
    overrideForm.appendChild(datePicker("overrideDate", state.ui.overrideDate, "Override date"));
    const values = state.settings.dailyOverrides[state.ui.overrideDate] || {};
    const overrideGrid = node("div", "form-grid");
    [["Food guide (calories)", "foodDaily"], ["Move guide (calories)", "moveDaily"], ["Exercise guide (Active Calories)", "exerciseDaily"], ["Steps guide", "stepsDaily"]].forEach(function (x) {
      overrideGrid.appendChild(field(x[0], x[1], values[x[1]], { placeholder: "Use weekly default" }));
    });
    overrideForm.appendChild(overrideGrid);
    const saveOverride = button("Save one-day override", "secondary-button"); saveOverride.type = "submit";
    overrideForm.append(saveOverride, button("Clear override", "text-button", "clear-override"));
    overrideCard.appendChild(overrideForm); app.appendChild(overrideCard);

    const remindersCard = card("Device reminders", "After three consecutive unlogged days: one gentle notification, then one repeat the following day. Any saved entry resets the count.");
    const remindersForm = form("reminderForm", "");
    const reminderGrid = node("div", "form-grid");
    reminderGrid.append(field("Reminder time (local)", "time", state.settings.reminder.time || "09:00", { type: "time" }));
    reminderGrid.append(field("Private setup key", "apiKey", state.settings.reminder.apiKey || "", { type: "password", placeholder: "Set during deployment" }));
    remindersForm.appendChild(reminderGrid);
    remindersForm.appendChild(node("p", "hint", "The app must be installed and deployed with push keys. Reminder settings are per device; tracker data syncs across devices when online."));
    const enable = button(state.settings.reminder.enabled ? "Update reminder settings" : "Enable device reminders", "primary-button"); enable.type = "submit";
    remindersForm.appendChild(enable);
    if (state.settings.reminder.enabled) remindersForm.appendChild(button("Turn reminders off", "secondary-button", "disable-reminders"));
    remindersForm.appendChild(node("p", "hint", state.settings.reminder.enabled ? "Reminders are enabled on this device." : "Reminders are currently off."));
    remindersCard.appendChild(remindersForm); app.appendChild(remindersCard);

    const summary = state.settings.importSummary || {};
    const range = summary.firstDailyDate ? fmt(summary.firstDailyDate, { month: "short", day: "numeric", year: "numeric" }) + "–" + fmt(summary.lastDailyDate, { month: "short", day: "numeric", year: "numeric" }) : "no daily records";
    const historyCard = card("History and backup", "Imported " + number(summary.dailyRecordDays || 0) + " days with at least one spreadsheet entry (" + range + ") and " + number(summary.weighIns || 0) + " Monday weigh-ins. Missing values stay blank.");
    historyCard.appendChild(node("p", "hint", "Workbook exercise calories were daily totals, so each imported amount stays one dated total rather than a fabricated session breakdown. Imported history does not add reward points."));
    const row = node("div", "button-row");
    row.append(button("Download backup", "secondary-button", "export-backup"), button("Restore backup", "secondary-button", "open-restore"));
    const restore = document.createElement("input"); restore.type = "file"; restore.accept = "application/json"; restore.id = "restoreFile"; restore.className = "hidden";
    row.appendChild(restore); historyCard.appendChild(row);
    historyCard.appendChild(node("p", "hint", "Workbook history is included automatically. New logs, targets, weigh-ins, and measurements sync through Netlify when online; a local copy keeps the app usable offline."));
    historyCard.appendChild(node("hr", "section-divider"));
    const historyHead = node("div", "card-head");
    const left = node("div");
    left.append(node("h4", "", "Daily history"), node("p", "hint", "Open a recorded day to review or edit it."));
    historyHead.append(left, monthPicker("historyMonth", state.ui.historyMonth, "History month"));
    historyCard.appendChild(historyHead);
    historyCard.appendChild(renderHistory(state.ui.historyMonth));
    app.appendChild(historyCard);
  }

  function monthPicker(id, value, label) {
    const wrap = node("label", "date-control-wrap");
    wrap.appendChild(node("span", "field-hint", label));
    const input = document.createElement("input");
    input.type = "month"; input.id = id; input.value = value; input.className = "date-control";
    wrap.appendChild(input);
    return wrap;
  }

  function render() {
    navButtons.forEach(function (b) { b.classList.toggle("active", b.dataset.view === state.ui.view); });
    const points = document.getElementById("logPoints");
    points.textContent = state.settings.logPoints.length + " log point" + (state.settings.logPoints.length === 1 ? "" : "s");
    app.replaceChildren();
    const pages = { today: renderToday, review: renderReview, weight: renderWeight, measurements: renderMeasurements, more: renderMore };
    (pages[state.ui.view] || renderToday)();
    const status = document.getElementById("saveStatus");
    if (status) status.textContent = syncLabel();
  }
  function syncLabel() {
    if (!supportsRemoteSync()) return "Saved on this device";
    return ({ loading: "Connecting…", syncing: "Syncing…", synced: "Synced across devices", offline: "Saved here · will sync when online", error: "Saved here · sync unavailable" })[syncStatus] || "Saved on this device";
  }
  function updateSyncLabel() {
    const badge = document.getElementById("saveStatus");
    if (badge) badge.textContent = syncLabel();
    const footer = document.getElementById("syncFooter");
    if (footer) footer.textContent = supportsRemoteSync() ? "Changes sync across devices when online." : "Entries save on this device only.";
  }
  function supportsRemoteSync() {
    return location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  }
  function sharedState() {
    const settings = copy(state.settings);
    delete settings.reminder;
    return {
      schemaVersion: 1,
      logs: copy(state.logs),
      weighIns: copy(state.weighIns),
      measurements: copy(state.measurements),
      settings
    };
  }
  function mergeHistoryIntoState(target, incoming) {
    if (!incoming || incoming.source !== "MASTER_SPREADSHEET.xlsx") return false;
    let changed = false;
    Object.entries(incoming.dailyLogDays || {}).forEach(function (pair) {
      const date = pair[0], imported = pair[1], current = target.logs[date];
      if (!current) { target.logs[date] = copy(imported); changed = true; return; }
      Object.keys(imported).forEach(function (key) {
        if (key === "sessions") {
          if (!(current.sessions || []).length && !current.noWorkout && imported.sessions && imported.sessions.length) { current.sessions = copy(imported.sessions); changed = true; }
        } else if (key === "exerciseLogged" && imported[key] === true && current[key] !== true && !current.noWorkout) { current[key] = true; changed = true; }
        else if (current[key] === null || current[key] === undefined) { current[key] = imported[key]; changed = true; }
      });
    });
    Object.entries(incoming.weighIns || {}).forEach(function (pair) {
      const date = pair[0], imported = pair[1], current = target.weighIns[date] || {};
      Object.keys(imported).forEach(function (key) {
        if (current[key] === null || current[key] === undefined) { current[key] = imported[key]; changed = true; }
      });
      target.weighIns[date] = current;
    });
    target.settings.importSummary = incoming.importSummary || target.settings.importSummary || {};
    target.settings.importedFrom = incoming.source;
    return changed;
  }
  function recordKeysChanged(before, after) {
    const oldMap = before || {}, newMap = after || {};
    return Array.from(new Set(Object.keys(oldMap).concat(Object.keys(newMap)))).filter(function (key) {
      return JSON.stringify(oldMap[key]) !== JSON.stringify(newMap[key]);
    });
  }
  function mapById(items) {
    const result = {};
    (items || []).forEach(function (item) { result[String(item.id)] = item; });
    return result;
  }
  function addDirtyChanges(before, after) {
    const sync = state._sync || (state._sync = { dirtyKeys: { logs: [], weighIns: [], measurements: [], settings: false } });
    const dirty = sync.dirtyKeys || (sync.dirtyKeys = { logs: [], weighIns: [], measurements: [], settings: false });
    ["logs", "weighIns"].forEach(function (section) {
      const keys = recordKeysChanged(before && before[section], after[section]);
      dirty[section] = Array.from(new Set((dirty[section] || []).concat(keys)));
    });
    const measureChanges = recordKeysChanged(mapById(before && before.measurements), mapById(after.measurements));
    dirty.measurements = Array.from(new Set((dirty.measurements || []).concat(measureChanges)));
    if (JSON.stringify(before && before.settings) !== JSON.stringify(after.settings)) dirty.settings = true;
  }
  function hasDirtyChanges() {
    const d = state._sync && state._sync.dirtyKeys;
    return !!d && (d.settings || ["logs", "weighIns", "measurements"].some(function (key) { return (d[key] || []).length > 0; }));
  }
  function clearDirtyChanges() {
    state._sync = state._sync || {};
    state._sync.dirtyKeys = { logs: [], weighIns: [], measurements: [], settings: false };
  }
  function mergeConcurrent(remote, local) {
    const merged = copy(remote || local);
    const dirty = state._sync && state._sync.dirtyKeys || {};
    ["logs", "weighIns"].forEach(function (section) {
      merged[section] = Object.assign({}, (remote && remote[section]) || {});
      (dirty[section] || []).forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call((local && local[section]) || {}, key)) merged[section][key] = copy(local[section][key]);
        else delete merged[section][key];
      });
    });
    const mergedMeasures = mapById((remote && remote.measurements) || []);
    const localMeasures = mapById((local && local.measurements) || []);
    (dirty.measurements || []).forEach(function (id) {
      if (Object.prototype.hasOwnProperty.call(localMeasures, id)) mergedMeasures[id] = copy(localMeasures[id]);
      else delete mergedMeasures[id];
    });
    merged.measurements = Object.values(mergedMeasures);
    if (dirty.settings) merged.settings = copy(local.settings);
    return merged;
  }
  function applySharedState(shared) {
    const localUi = state.ui || {};
    const localReminder = state.settings && state.settings.reminder;
    state = Object.assign({}, copy(shared), {
      ui: localUi,
      settings: Object.assign({}, copy(shared.settings || {}), { reminder: localReminder || { enabled: false, time: "09:00", apiKey: "", userId: randomId(), lastLogDate: null } }),
      _sync: state._sync || {}
    });
    state.logs = state.logs || {};
    state.weighIns = state.weighIns || {};
    state.measurements = state.measurements || [];
    state.settings.targets = state.settings.targets || [{ effectiveFrom: "2026-01-05", ...BASE }, { effectiveFrom: "2026-11-02", ...CURRENT }];
    state.settings.dailyOverrides = state.settings.dailyOverrides || {};
    state.settings.measurementTypes = state.settings.measurementTypes || [];
    state.settings.logPoints = state.settings.logPoints || [];
  }
  function persistLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch { const status = document.getElementById("saveStatus"); if (status) status.textContent = "Could not save"; return false; }
  }
  function scheduleRemoteSync() {
    if (!supportsRemoteSync() || !appReady) return;
    clearTimeout(syncTimer);
    syncTimer = window.setTimeout(function () { syncNow(false); }, 700);
  }
  async function putSharedState(shared) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const headers = { "Content-Type": "application/json" };
      if (syncETag) headers["If-Match"] = syncETag;
      const response = await fetch(SYNC_URL, { method: "PUT", headers, body: JSON.stringify({ state: shared }) });
      const payload = await response.json().catch(function () { return {}; });
      if (response.status === 409 && payload.state) {
        const currentLocal = sharedState();
        const merged = mergeConcurrent(payload.state, currentLocal);
        syncETag = payload.etag || null;
        state._sync.etag = syncETag;
        applySharedState(merged);
        shared = sharedState();
        continue;
      }
      if (!response.ok) throw new Error(payload.error || "Could not sync tracker data.");
      syncETag = payload.etag || syncETag;
      state._sync.etag = syncETag;
      const savedShared = sharedState();
      if (JSON.stringify(savedShared) === JSON.stringify(shared)) {
        state._sync.dirty = false;
        clearDirtyChanges();
        lastSharedState = copy(savedShared);
        syncStatus = "synced";
        updateSyncLabel();
      } else {
        state._sync.dirty = true;
        scheduleRemoteSync();
      }
      persistLocal();
      return;
    }
    throw new Error("Tracker data changed on another device. Try syncing again.");
  }
  async function syncNow(refreshView) {
    if (!supportsRemoteSync()) { syncStatus = "local"; updateSyncLabel(); return; }
    if (syncInFlight) { syncQueued = true; return; }
    syncInFlight = true;
    syncStatus = navigator.onLine ? "syncing" : "offline";
    updateSyncLabel();
    try {
      const response = await fetch(SYNC_URL, { cache: "no-store" });
      if (!response.ok) throw new Error("Shared storage is not available.");
      const payload = await response.json();
      if (payload.state) {
        if (state._sync && state._sync.dirty && hasDirtyChanges()) {
          const merged = mergeConcurrent(payload.state, sharedState());
          syncETag = payload.etag || null;
          state._sync.etag = syncETag;
          applySharedState(merged);
          await putSharedState(sharedState());
        } else {
          syncETag = payload.etag || null;
          applySharedState(payload.state);
          state._sync.etag = syncETag;
          state._sync.dirty = false;
          clearDirtyChanges();
          lastSharedState = copy(sharedState());
          persistLocal();
          syncStatus = "synced";
          updateSyncLabel();
          if (refreshView) render();
        }
      } else {
        state._sync = state._sync || {};
        state._sync.dirty = true;
        if (!hasDirtyChanges()) {
          state._sync.dirtyKeys = { logs: Object.keys(state.logs), weighIns: Object.keys(state.weighIns), measurements: Object.keys(mapById(state.measurements)), settings: true };
        }
        await putSharedState(sharedState());
      }
    } catch {
      syncStatus = navigator.onLine ? "error" : "offline";
      updateSyncLabel();
    } finally {
      syncInFlight = false;
      if (syncQueued) { syncQueued = false; syncNow(true); }
    }
  }
  function save() {
    const after = sharedState();
    if (lastSharedState) addDirtyChanges(lastSharedState, after);
    lastSharedState = copy(after);
    state._sync = state._sync || { dirty: false, dirtyKeys: { logs: [], weighIns: [], measurements: [], settings: false } };
    if (hasDirtyChanges()) state._sync.dirty = true;
    persistLocal();
    if (state._sync.dirty) scheduleRemoteSync();
    updateSyncLabel();
  }
  function notify(message) {
    flash = message; render();
    window.setTimeout(function () { flash = ""; render(); }, 4500);
  }
  function awardPoint() {
    const loggedOn = today();
    if (!state.settings.logPoints.includes(loggedOn)) state.settings.logPoints.push(loggedOn);
  }

  async function syncReminder(date) {
    const r = state.settings.reminder;
    if (!r.enabled || !r.apiKey) return;
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (!sub) return;
      await fetch("./api/reminders", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + r.apiKey },
        body: JSON.stringify({ userId: r.userId, subscription: sub.toJSON(), lastLogDate: date,
          time: r.time || "09:00", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago" })
      });
      r.lastLogDate = date; save();
    } catch { /* An offline entry remains saved locally. */ }
  }

  async function submitDaily(f) {
    const date = f.elements.date.value;
    const current = state.logs[date] || { sessions: [] };
    const next = Object.assign({}, current);
    next.sessions = (current.sessions || []).slice();
    ["food", "move", "steps"].forEach(function (key) {
      const raw = String(f.elements[key].value).trim();
      if (!raw) delete next[key]; else next[key] = Number(raw);
    });
    if (f.elements.noWorkout.checked && next.sessions.length) { notify("Remove the workout sessions before marking a no-workout day."); return; }
    if (f.elements.noWorkout.checked) { next.noWorkout = true; next.exerciseLogged = true; next.sessions = []; }
    else if (!next.sessions.length) { next.noWorkout = false; next.exerciseLogged = false; }
    if (hasEntry(next)) { state.logs[date] = next; awardPoint(); }
    else delete state.logs[date];
    save(); render();
    if (hasEntry(next)) await syncReminder(today());
    notify("Saved. Add another entry whenever you’re ready.");
  }
  async function submitWorkout(f) {
    const date = f.elements.date.value;
    const name = f.elements.name.value.trim();
    const raw = String(f.elements.activeCalories.value).trim();
    if (!name || raw === "" || !Number.isFinite(Number(raw))) { notify("Enter the workout name and its Active Calories."); return; }
    const log = state.logs[date] || { sessions: [] };
    log.sessions = log.sessions || [];
    log.sessions.push({ id: randomId(), name: name, activeCalories: Number(raw), source: "manual" });
    log.exerciseLogged = true; log.noWorkout = false; state.logs[date] = log;
    awardPoint(); save(); render();
    await syncReminder(today());
    notify("Workout added to the daily exercise total.");
  }
  function submitWeight(f) {
    const date = f.elements.date.value;
    if (dateObj(date).getDay() !== 1) { notify("Choose a Monday for the weekly Withings reading."); return; }
    const record = {};
    ["weightLbs", "fatMassPct", "leanMassPct", "bmi", "muscleMassPct"].forEach(function (key) {
      const v = String(f.elements[key].value).trim(); if (v !== "") record[key] = Number(v);
    });
    if (Object.keys(record).length) state.weighIns[date] = record; else delete state.weighIns[date];
    save(); render(); notify("Monday weigh-in saved.");
  }
  function submitMeasurementType(f) {
    const name = f.elements.name.value.trim(), unit = f.elements.unit.value.trim();
    if (!name || !unit) { notify("Enter a measurement name and unit."); return; }
    state.settings.measurementTypes = state.settings.measurementTypes || [];
    if (registeredMeasurementTypes().some(function (item) { return item.name.toLowerCase() === name.toLowerCase(); })) {
      notify("That measurement type already exists."); return;
    }
    state.settings.measurementTypes.push({ name: name, unit: unit });
    state.ui.measurementType = name;
    state.ui.measurementTypeFormOpen = false;
    state.ui.measurementFormOpen = true;
    save(); render(); notify(name + " added. Enter a monthly reading whenever you’re ready.");
  }
  function submitMeasurement(f) {
    const month = f.elements.month.value, name = f.elements.name.value.trim(), raw = String(f.elements.value.value).trim();
    if (!name || raw === "" || !Number.isFinite(Number(raw))) { notify("Choose a measurement type and enter its monthly value."); return; }
    const type = registeredMeasurementTypes().find(function (item) { return item.name === name; });
    if (!type) { notify("Add this measurement type first."); return; }
    state.measurements = state.measurements.filter(function (m) { return !(m.month === month && m.name.toLowerCase() === name.toLowerCase()); });
    state.measurements.push({ id: randomId(), month: month, name: name, value: Number(raw), unit: type.unit });
    state.ui.measurementFormOpen = false;
    save(); render(); notify("Monthly measurement saved.");
  }
  function submitTargets(f) {
    const start = nextMonday(today()), target = {};
    for (const key of ["food", "move", "exercise", "steps"]) {
      const v = String(f.elements[key].value).trim();
      if (v === "" || Number(v) < 0) { notify("Enter all four weekly targets."); return; }
      target[key] = Number(v);
    }
    const revert = getTargets(addDays(start, 7));
    state.settings.targets = state.settings.targets.filter(function (t) { return t.effectiveFrom < start; });
    state.settings.targets.push(Object.assign({ effectiveFrom: start }, target));
    if (f.elements.duration.value === "one-week") state.settings.targets.push(Object.assign({}, revert, { effectiveFrom: addDays(start, 7) }));
    state.settings.targets.sort(function (a, b) { return a.effectiveFrom.localeCompare(b.effectiveFrom); });
    save(); render(); notify("Target change scheduled for Monday, " + fmt(start, { month: "long", day: "numeric" }) + ".");
  }
  function submitOverride(f) {
    const date = state.ui.overrideDate, values = {};
    ["foodDaily", "moveDaily", "exerciseDaily", "stepsDaily"].forEach(function (key) {
      const v = String(f.elements[key].value).trim(); if (v !== "") values[key] = Number(v);
    });
    if (Object.keys(values).length) state.settings.dailyOverrides[date] = values;
    else delete state.settings.dailyOverrides[date];
    save(); render(); notify("One-day guide saved.");
  }

  function downloadBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "daily-tracker-backup-" + today() + ".json"; a.click();
    URL.revokeObjectURL(url); notify("Backup downloaded.");
  }
  async function restoreBackup(file) {
    try {
      const incoming = JSON.parse(await file.text());
      if (!incoming || incoming.schemaVersion !== 1 || !incoming.logs || !incoming.weighIns || !incoming.settings) throw new Error("That file is not a Daily Tracker backup.");
      if (!window.confirm("Replace the data on this device with this backup?")) return;
      state = incoming; state.ui = state.ui || { view: "today", selectedDate: today(), reviewWeek: monday(today()) };
      save(); render(); notify("Backup restored.");
    } catch (err) { notify(err.message || "Could not read that backup."); }
  }
  async function importWorkbookHistory(file) {
    try {
      const incoming = JSON.parse(await file.text());
      if (!incoming || incoming.source !== "MASTER_SPREADSHEET.xlsx" || !incoming.dailyLogDays || !incoming.weighIns) {
        throw new Error("Select the Daily Tracker workbook history import file.");
      }
      if (!window.confirm("Add the workbook history to this device? Existing app entries take priority; missing values stay blank.")) return;
      const incomingDays = Object.entries(incoming.dailyLogDays);
      incomingDays.forEach(function (pair) {
        const date = pair[0], imported = pair[1], current = state.logs[date];
        if (!current) state.logs[date] = copy(imported);
        else {
          Object.keys(imported).forEach(function (key) {
            if (key === "sessions") {
              if (!(current.sessions || []).length && !current.noWorkout && imported.sessions && imported.sessions.length) current.sessions = copy(imported.sessions);
            } else if (key === "exerciseLogged" && imported[key] === true && current[key] !== true && !current.noWorkout) current[key] = true;
            else if (current[key] === null || current[key] === undefined) current[key] = imported[key];
          });
        }
      });
      Object.entries(incoming.weighIns).forEach(function (pair) {
        const date = pair[0], imported = pair[1], current = state.weighIns[date] || {};
        Object.keys(imported).forEach(function (key) {
          if (current[key] === null || current[key] === undefined) current[key] = imported[key];
        });
        state.weighIns[date] = current;
      });
      state.settings.importSummary = incoming.importSummary || {};
      state.settings.importedFrom = incoming.source;
      state.settings.historyImportedAt = new Date().toISOString();
      save(); render();
      notify("Imported " + incomingDays.length + " daily record dates and " + Object.keys(incoming.weighIns).length + " weigh-ins. Blank fields remain blank.");
    } catch (error) { notify(error.message || "Could not import workbook history."); }
  }

  function base64Bytes(key) {
    const base = (key + "=".repeat((4 - key.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(base), function (c) { return c.charCodeAt(0); });
  }
  async function enableReminder(f) {
    const time = f.elements.time.value || "09:00";
    const apiKey = f.elements.apiKey.value.trim();
    if (!apiKey) { notify("Enter the private setup key after the reminder service is configured."); return; }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) { notify("Install this app in a browser that supports device push reminders."); return; }
    if (location.protocol !== "https:" && location.hostname !== "localhost") { notify("Device reminders need the app's secure web address."); return; }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { notify("Allow notifications in your device settings to enable reminders."); return; }
      const configResponse = await fetch("./api/reminder-config", { cache: "no-store" });
      if (!configResponse.ok) throw new Error("The reminder service is not configured yet.");
      const cfg = await configResponse.json();
      if (!cfg.publicKey) throw new Error("The app host has no push public key configured.");
      await navigator.serviceWorker.register("./sw.js");
      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      if (!sub) sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64Bytes(cfg.publicKey) });
      const r = state.settings.reminder;
      r.enabled = true; r.time = time; r.apiKey = apiKey; r.userId = r.userId || randomId(); r.lastLogDate = today();
      const response = await fetch("./api/reminders", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
        body: JSON.stringify({ userId: r.userId, subscription: sub.toJSON(), lastLogDate: today(),
          time: time, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago" })
      });
      if (!response.ok) throw new Error("The reminder service rejected the setup key or subscription.");
      save(); render(); notify("Device reminders enabled. The three-day count starts today.");
    } catch (err) { state.settings.reminder.enabled = false; save(); render(); notify(err.message || "Could not enable device reminders."); }
  }
  async function disableReminder() {
    const r = state.settings.reminder;
    try {
      if (r.apiKey && r.userId) await fetch("./api/reminders", { method: "DELETE", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + r.apiKey }, body: JSON.stringify({ userId: r.userId }) });
      const reg = await navigator.serviceWorker.getRegistration("./");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch {}
    r.enabled = false; save(); render(); notify("Device reminders turned off.");
  }

  app.addEventListener("click", async function (event) {
    const tab = event.target.closest("[data-view]");
    if (tab) { state.ui.view = tab.dataset.view; flash = ""; save(); render(); return; }
    const b = event.target.closest("[data-action]");
    if (!b) return;
    const action = b.dataset.action;
    if (action === "jump-today") { state.ui.selectedDate = today(); save(); render(); }
    else if (action === "open-measurement-type") { state.ui.measurementTypeFormOpen = true; state.ui.measurementFormOpen = false; save(); render(); }
    else if (action === "cancel-measurement-type") { state.ui.measurementTypeFormOpen = false; save(); render(); }
    else if (action === "cancel-measurement-entry") { state.ui.measurementFormOpen = false; save(); render(); }
    else if (action === "log-measurement") { state.ui.measurementType = b.dataset.name; state.ui.measurementFormOpen = true; state.ui.measurementTypeFormOpen = false; save(); render(); }
    else if (action === "shift-date") { state.ui.selectedDate = addDays(state.ui.selectedDate, Number(b.dataset.delta)); save(); render(); }
    else if (action === "shift-week") { state.ui.reviewWeek = addDays(state.ui.reviewWeek, Number(b.dataset.delta) * 7); save(); render(); }
    else if (action === "select-date" || action === "edit-date") { state.ui.selectedDate = b.dataset.date; state.ui.view = "today"; save(); render(); }
    else if (action === "remove-session") {
      const log = state.logs[b.dataset.date]; if (!log) return;
      log.sessions = (log.sessions || []).filter(function (s) { return s.id !== b.dataset.id; });
      if (!log.sessions.length && !log.noWorkout) log.exerciseLogged = false;
      if (!hasEntry(log)) delete state.logs[b.dataset.date];
      save(); render(); notify("Workout removed.");
    } else if (action === "go-settings") { state.ui.view = "more"; save(); render(); }
    else if (action === "clear-override") { delete state.settings.dailyOverrides[state.ui.overrideDate]; save(); render(); notify("One-day override cleared."); }
    else if (action === "remove-measurement") { state.measurements = state.measurements.filter(function (x) { return x.id !== b.dataset.id; }); save(); render(); notify("Measurement removed."); }
    else if (action === "export-backup") downloadBackup();
    else if (action === "open-restore") document.getElementById("restoreFile").click();
    else if (action === "open-history-import") document.getElementById("historyImportFile").click();
    else if (action === "disable-reminders") await disableReminder();
  });
  app.addEventListener("change", function (event) {
    const e = event.target;
    if (e.id === "selectedDate") state.ui.selectedDate = e.value || today();
    else if (e.id === "weightDate") state.ui.weightDate = e.value || monday(today());
    else if (e.id === "measurementMonth") state.ui.measurementMonth = e.value || monthString(today());
    else if (e.id === "measurementTypeSelect") state.ui.measurementType = e.value;
    else if (e.id === "historyMonth") state.ui.historyMonth = e.value || monthString(today());
    else if (e.id === "overrideDate") state.ui.overrideDate = e.value || today();
    else if (e.id === "restoreFile" && e.files && e.files[0]) { restoreBackup(e.files[0]); return; }
    else if (e.id === "historyImportFile" && e.files && e.files[0]) { importWorkbookHistory(e.files[0]); return; }
    else return;
    save(); render();
  });
  app.addEventListener("submit", async function (event) {
    const f = event.target;
    if (!(f instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (f.id === "dailyForm") await submitDaily(f);
    else if (f.id === "workoutForm") await submitWorkout(f);
    else if (f.id === "weightForm") submitWeight(f);
    else if (f.id === "measurementForm") submitMeasurement(f);
    else if (f.id === "measurementTypeForm") submitMeasurementType(f);
    else if (f.id === "weeklyTargetsForm") submitTargets(f);
    else if (f.id === "dailyOverrideForm") submitOverride(f);
    else if (f.id === "reminderForm") await enableReminder(f);
  });

  function initialState() {
    return {
      schemaVersion: 1,
      logs: copy(seed.dailyLogDays || {}),
      weighIns: copy(seed.weighIns || {}),
      measurements: [],
      settings: {
        targets: [{ effectiveFrom: "2026-01-05", ...BASE }, { effectiveFrom: "2026-11-02", ...CURRENT }],
        dailyOverrides: {},
        measurementTypes: [],
        weightLossGoalPerWeek: 2,
        logPoints: [],
        reminder: { enabled: false, time: "09:00", apiKey: "", userId: randomId(), lastLogDate: null },
        importedFrom: "MASTER_SPREADSHEET.xlsx",
        importSummary: copy(seed.importSummary || {}),
        firstUseDate: today()
      },
      ui: { view: "today", selectedDate: today(), reviewWeek: monday(today()), weightDate: monday(today()),
        measurementMonth: monthString(today()), historyMonth: monthString(today()), overrideDate: today() }
    };
  }
  let hadLocalState = false;
  try {
    const saved = localStorage.getItem(KEY);
    hadLocalState = !!saved;
    state = saved ? JSON.parse(saved) : initialState();
  } catch { state = initialState(); }
  if (!state || state.schemaVersion !== 1) { state = initialState(); hadLocalState = false; }
  state.logs = state.logs || {};
  state.weighIns = state.weighIns || {};
  state.measurements = state.measurements || [];
  state.settings = state.settings || {};
  state.settings.targets = state.settings.targets || [{ effectiveFrom: "2026-01-05", ...BASE }, { effectiveFrom: "2026-11-02", ...CURRENT }];
  state.settings.dailyOverrides = state.settings.dailyOverrides || {};
  state.settings.measurementTypes = state.settings.measurementTypes || [];
  state.settings.logPoints = state.settings.logPoints || [];
  state.settings.reminder = state.settings.reminder || { enabled: false, time: "09:00", apiKey: "", userId: randomId(), lastLogDate: null };
  state.settings.importSummary = state.settings.importSummary || copy(seed.importSummary || {});
  state.ui = state.ui || {};
  state.ui.view = "today";
  state.ui.selectedDate = addDays(today(), -1);
  state.ui.reviewWeek = state.ui.reviewWeek || monday(today());
  state.ui.weightDate = state.ui.weightDate || monday(today());
  state.ui.measurementMonth = state.ui.measurementMonth || monthString(today());
  state.ui.measurementTypeFormOpen = !!state.ui.measurementTypeFormOpen;
  state.ui.measurementFormOpen = !!state.ui.measurementFormOpen;
  state.ui.historyMonth = state.ui.historyMonth || monthString(today());
  state.ui.overrideDate = state.ui.overrideDate || today();
  const priorShared = sharedState();
  const historyAdded = mergeHistoryIntoState(state, seed);
  state._sync = state._sync || { etag: null, dirty: false, dirtyKeys: { logs: [], weighIns: [], measurements: [], settings: false } };
  state._sync.dirtyKeys = state._sync.dirtyKeys || { logs: [], weighIns: [], measurements: [], settings: false };
  if (hadLocalState && !state._sync.etag) {
    state._sync.dirtyKeys = { logs: Object.keys(state.logs), weighIns: Object.keys(state.weighIns), measurements: Object.keys(mapById(state.measurements)), settings: true };
    state._sync.dirty = true;
  }
  if (historyAdded) {
    addDirtyChanges(priorShared, sharedState());
    state._sync.dirty = true;
  }
  lastSharedState = copy(sharedState());
  persistLocal();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("./sw.js").catch(function () {});
  render();
  appReady = true;
  if (supportsRemoteSync()) syncNow(false);
  else { syncStatus = "local"; updateSyncLabel(); }
  window.addEventListener("online", function () { syncNow(true); });
  window.addEventListener("focus", function () { syncNow(true); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) syncNow(true); });
  if (supportsRemoteSync()) window.setInterval(function () { if (!document.hidden) syncNow(true); }, 45000);
  navButtons.forEach(function (b) { b.addEventListener("click", function () { state.ui.view = b.dataset.view; flash = ""; save(); render(); }); });
  document.querySelectorAll(".app-footer [data-view]").forEach(function (b) { b.addEventListener("click", function () { state.ui.view = b.dataset.view; flash = ""; save(); render(); }); });
  render();
})();