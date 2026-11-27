// The Exercise Tracker's only /api/data handler. Shared cross-device storage
// for Iron Log, backed by Netlify Blobs.
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
    const replaceAll = body.replaceAll === true;
    const previousLibrary = previous?.library || {};
    const incomingLibrary = body.library || {};
    const previousLibraryVersion = Number(previous?.librarySnapshotVersion || 0);
    const incomingLibraryVersion = Number(body.librarySnapshotVersion || 0);
    const previousLibraryUpdatedAt = Number(previous?.libraryUpdatedAt || 0);
    const incomingLibraryUpdatedAt = Number(body.libraryUpdatedAt || 0);
    let library;
    if (replaceAll || (incomingLibraryVersion >= 75 && incomingLibraryUpdatedAt >= previousLibraryUpdatedAt)) {
      library = { ...incomingLibrary };
    } else if (previousLibraryVersion >= 75 || previousLibraryUpdatedAt > incomingLibraryUpdatedAt) {
      // Ignore stale pre-v75 devices after the v75 snapshot is authoritative.
      library = { ...previousLibrary };
    } else if (incomingLibraryVersion >= 75) {
      library = { ...incomingLibrary };
    } else {
      library = { ...previousLibrary, ...incomingLibrary };
      for (const [key, list] of Object.entries(previousLibrary)) {
        if (Array.isArray(list) && list.length && Array.isArray(incomingLibrary[key]) && incomingLibrary[key].length === 0) {
          library[key] = list;
        }
      }
    }
    const librarySnapshotVersion = Math.max(previousLibraryVersion, incomingLibraryVersion);
    const libraryUpdatedAt = Math.max(previousLibraryUpdatedAt, incomingLibraryUpdatedAt);
    const previousBankResetVersion = Number(previous?.bankResetVersion || 0);
    const incomingBankResetVersion = Number(body.bankResetVersion || 0);
    const bankResetVersion = Math.max(previousBankResetVersion, incomingBankResetVersion);
    const previousBankUpdatedAt = Number(previous?.bankUpdatedAt || 0);
    const incomingBankUpdatedAt = Number(body.bankUpdatedAt || 0);
    let bank;
    if (replaceAll || (incomingBankUpdatedAt > 0 && incomingBankUpdatedAt >= previousBankUpdatedAt)) {
      bank = { ...(body.bank || {}) };
    } else if (previousBankUpdatedAt > 0) {
      // An older app or stale device cannot restore a deleted bank entry.
      bank = { ...(previous?.bank || {}) };
    } else if (incomingBankResetVersion >= 65) {
      bank = { ...(body.bank || {}) };
    } else if (previousBankResetVersion >= 65) {
      bank = { ...(previous?.bank || {}) };
    } else {
      bank = { ...(previous?.bank || {}), ...(body.bank || {}) };
    }
    const bankUpdatedAt = Math.max(previousBankUpdatedAt, incomingBankUpdatedAt);
    const toSave = {
      library,
      librarySnapshotVersion,
      libraryUpdatedAt,
      // Merge by date during ordinary sync so a partial cache cannot wipe
      // history. An explicit backup restore replaces the full dated dataset.
      logs: replaceAll ? (body.logs || {}) : { ...(previous?.logs || {}), ...(body.logs || {}) },
      bank,
      bankUpdatedAt,
      bankResetVersion,
      classes: replaceAll
        ? (Array.isArray(body.classes) ? body.classes : [])
        : Array.isArray(body.classes) && body.classes.length
          ? body.classes
          : (previous?.classes || body.classes || []),
      marathon: replaceAll ? (body.marathon || null) : (body.marathon || previous?.marathon || null),
      dayDesignations: replaceAll
        ? (Array.isArray(body.dayDesignations) ? body.dayDesignations : [])
        : Array.isArray(body.dayDesignations) ? body.dayDesignations : (previous?.dayDesignations || []),
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
