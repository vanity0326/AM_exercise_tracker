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
    const previousLibraryKeyUpdatedAt = previous?.libraryKeyUpdatedAt || {};
    const incomingLibraryKeyUpdatedAt = body.libraryKeyUpdatedAt || {};
    let library = {};
    const libraryKeyUpdatedAt = {};
    if (replaceAll) {
      library = { ...incomingLibrary };
      Object.assign(libraryKeyUpdatedAt, incomingLibraryKeyUpdatedAt);
    } else {
      const keys = new Set([...Object.keys(previousLibrary), ...Object.keys(incomingLibrary)]);
      for (const key of keys) {
        const oldList = Array.isArray(previousLibrary[key]) ? previousLibrary[key] : [];
        const newList = Array.isArray(incomingLibrary[key]) ? incomingLibrary[key] : [];
        const oldRevision = Number(previousLibraryKeyUpdatedAt[key]) || (oldList.length ? previousLibraryUpdatedAt : 0);
        // Older clients only have a whole-library timestamp. Treat it as a
        // key update only when they send actual exercises; an empty legacy
        // snapshot must never erase another device's saved routine.
        const newRevision = Number(incomingLibraryKeyUpdatedAt[key]) || (newList.length ? incomingLibraryUpdatedAt : 0);
        const staleLegacyClient = previousLibraryVersion >= 79 && incomingLibraryVersion < 79;
        const takeIncoming = !staleLegacyClient && (newRevision > oldRevision || (newRevision === oldRevision && incomingLibraryVersion >= 79 && Object.prototype.hasOwnProperty.call(incomingLibrary, key)));
        if (takeIncoming) {
          library[key] = newList;
          if (newRevision) libraryKeyUpdatedAt[key] = newRevision;
        } else {
          if (Object.prototype.hasOwnProperty.call(previousLibrary, key)) library[key] = oldList;
          if (oldRevision) libraryKeyUpdatedAt[key] = oldRevision;
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
      libraryKeyUpdatedAt,
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
