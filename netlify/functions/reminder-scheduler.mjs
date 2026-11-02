import { getStore } from "@netlify/blobs";
import webpush from "web-push";

export const config = { schedule: "0 * * * *" };

function zoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  });
  const parts = {};
  formatter.formatToParts(date).forEach(function (part) { parts[part.type] = part.value; });
  return { date: parts.year + "-" + parts.month + "-" + parts.day, hour: parts.hour };
}
function daysBetween(start, end) {
  const a = Date.parse(start + "T00:00:00Z");
  const b = Date.parse(end + "T00:00:00Z");
  return Math.floor((b - a) / 86400000);
}
function validZone(zone) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date()); return true; }
  catch { return false; }
}

export default async function () {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return new Response("VAPID keys are not configured.", { status: 503 });

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const store = getStore("daily-tracker-reminders");
  const registry = (await store.get("subscribers", { type: "json" })) || {};
  const now = new Date();
  let changed = false;

  for (const userId of Object.keys(registry)) {
    const item = registry[userId];
    if (!item || !item.subscription || !item.lastLogDate) continue;
    const zone = validZone(item.timeZone) ? item.timeZone : "America/Chicago";
    const local = zoneParts(now, zone);
    const preferredHour = String(item.time || "09:00").slice(0, 2);
    if (local.hour !== preferredHour) continue;

    const missedDays = daysBetween(item.lastLogDate, local.date);
    let payload = null;
    if (missedDays >= 4 && !item.firstSentDate) {
      payload = {
        title: "A gentle check-in",
        body: "It’s been a few days since your last log. Even one small entry is a good way to resume.",
        tag: "daily-tracker-first-reminder"
      };
      item.firstSentDate = local.date;
    } else if (missedDays >= 5 && item.firstSentDate && item.firstSentDate < local.date && !item.repeatSentDate) {
      payload = {
        title: "One more gentle reminder",
        body: "Whenever you’re ready, add an entry and continue from today.",
        tag: "daily-tracker-repeat-reminder"
      };
      item.repeatSentDate = local.date;
    }
    if (!payload) continue;

    try {
      await webpush.sendNotification(item.subscription, JSON.stringify(payload), { TTL: 86400, urgency: "normal" });
      changed = true;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        delete registry[userId];
        changed = true;
      } else {
        if (payload.tag === "daily-tracker-first-reminder") item.firstSentDate = null;
        if (payload.tag === "daily-tracker-repeat-reminder") item.repeatSentDate = null;
        console.error("Push delivery failed:", error.statusCode || error.message);
        changed = true;
      }
    }
  }

  if (changed) await store.setJSON("subscribers", registry);
  return new Response("Reminder check completed.", { status: 200 });
}
