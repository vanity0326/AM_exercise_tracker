// Shared cross-device storage for Iron Log, backed by Netlify Blobs.
// GET  -> returns the current { library, logs, bank, marathon, updatedAt } JSON, or null if nothing saved yet.
// PUT  -> saves the posted { library, logs, bank, marathon } JSON, stamps updatedAt, returns it.
//
// No login/auth — this mirrors the Kory planner setup: one shared data pool,
// reachable by anyone who has the URL. Fine for personal/family use; not for
// a public app.

import { getStore } from "@netlify/blobs";

const KEY = "data";

export default async (req) => {
  const store = getStore("iron-log");

  if (req.method === "GET") {
    const data = await store.get(KEY, { type: "json" });
    return new Response(JSON.stringify(data || null), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "PUT" || req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const previous = await store.get(KEY, { type: "json" });
    const previousLibrary = previous?.library || {};
    const incomingLibrary = body.library || {};
    const library = { ...previousLibrary, ...incomingLibrary };
    // Do not let an empty/stale browser snapshot erase shared routines.
    for (const [key, list] of Object.entries(previousLibrary)) {
      if (Array.isArray(list) && list.length && Array.isArray(incomingLibrary[key]) && incomingLibrary[key].length === 0) {
        library[key] = list;
      }
    }
    const toSave = {
      library,
      // Merge by date so a device with a partial cache cannot wipe other days
      // from shared storage. Newer edits for a date still replace that date.
      logs: { ...(previous?.logs || {}), ...(body.logs || {}) },
      bank: { ...(previous?.bank || {}), ...(body.bank || {}) },
      classes: Array.isArray(body.classes) && body.classes.length
        ? body.classes
        : (previous?.classes || body.classes || []),
      marathon: body.marathon || previous?.marathon || null,
      dayDesignations: Array.isArray(body.dayDesignations) ? body.dayDesignations : (previous?.dayDesignations || []),
      updatedAt: new Date().toISOString(),
    };
    await store.setJSON(KEY, toSave);
    return new Response(JSON.stringify(toSave), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/data" };
