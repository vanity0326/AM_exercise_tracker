import { getStore } from "@netlify/blobs";

export const config = { path: "/api/reminders" };

function reply(body, status) {
  return new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function authorized(request) {
  const secret = process.env.REMINDER_API_KEY;
  if (!secret) return false;
  return request.headers.get("authorization") === "Bearer " + secret;
}

export default async function (request) {
  if (!process.env.REMINDER_API_KEY) return reply({ error: "Reminder service is not configured." }, 503);
  if (!authorized(request)) return reply({ error: "Unauthorized." }, 401);
  if (request.method !== "PUT" && request.method !== "DELETE") return reply({ error: "Method not allowed." }, 405);

  let body;
  try { body = await request.json(); } catch { return reply({ error: "Invalid JSON." }, 400); }
  const userId = String(body.userId || "");
  if (!/^[A-Za-z0-9-]{12,128}$/.test(userId)) return reply({ error: "Invalid user id." }, 400);

  const store = getStore("daily-tracker-reminders");
  const registry = (await store.get("subscribers", { type: "json" })) || {};
  if (request.method === "DELETE") {
    delete registry[userId];
    await store.setJSON("subscribers", registry);
    return reply({ ok: true }, 200);
  }

  const sub = body.subscription;
  if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") || !sub.keys || !sub.keys.auth || !sub.keys.p256dh) {
    return reply({ error: "Invalid push subscription." }, 400);
  }
  if (typeof body.lastLogDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.lastLogDate)) return reply({ error: "Invalid last log date." }, 400);
  if (typeof body.time !== "string" || !/^\d{2}:\d{2}$/.test(body.time)) return reply({ error: "Invalid reminder time." }, 400);

  const old = registry[userId] || {};
  const reset = old.lastLogDate !== body.lastLogDate;
  registry[userId] = {
    subscription: sub,
    lastLogDate: body.lastLogDate,
    time: body.time,
    timeZone: String(body.timeZone || "America/Chicago"),
    firstSentDate: reset ? null : old.firstSentDate || null,
    repeatSentDate: reset ? null : old.repeatSentDate || null,
    updatedAt: new Date().toISOString()
  };
  await store.setJSON("subscribers", registry);
  return reply({ ok: true }, 200);
}
