// Shared cross-device storage for Iron Log, backed by Netlify Blobs.
// GET  -> returns the current { library, logs, bank, updatedAt } JSON, or null if nothing saved yet.
// PUT  -> saves the posted { library, logs, bank } JSON, stamps updatedAt, returns it.
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
    const toSave = {
      library: body.library || {},
      logs: body.logs || {},
      bank: body.bank || {},
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
