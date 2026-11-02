import { getStore } from "@netlify/blobs";

export const config = { path: "/api/data" };

const STORE_NAME = "daily-health-tracker";
const STATE_KEY = "shared-state";
const MAX_BODY_BYTES = 2_000_000;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function isValidState(value) {
  return value && typeof value === "object" && value.schemaVersion === 1 &&
    value.logs && typeof value.logs === "object" &&
    value.weighIns && typeof value.weighIns === "object" &&
    Array.isArray(value.measurements) &&
    value.settings && typeof value.settings === "object" &&
    Array.isArray(value.settings.targets) &&
    value.settings.dailyOverrides && typeof value.settings.dailyOverrides === "object";
}

export default async function (request) {
  const store = getStore(STORE_NAME);

  if (request.method === "GET") {
    const entry = await store.getWithMetadata(STATE_KEY, { type: "json" });
    if (!entry) return json({ state: null, etag: null });
    return json({ state: entry.data, etag: entry.etag, updatedAt: entry.metadata?.updatedAt || null });
  }

  if (request.method !== "PUT") return json({ error: "Method not allowed." }, 405, { Allow: "GET, PUT" });

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "Tracker data is too large." }, 413);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON." }, 400); }
  if (!isValidState(body?.state)) return json({ error: "Invalid tracker data." }, 400);

  const serialized = JSON.stringify(body.state);
  if (new TextEncoder().encode(serialized).byteLength > MAX_BODY_BYTES) {
    return json({ error: "Tracker data is too large." }, 413);
  }

  const expectedETag = request.headers.get("if-match");
  const options = expectedETag ? { onlyIfMatch: expectedETag } : { onlyIfNew: true };
  const result = await store.setJSON(STATE_KEY, body.state, {
    ...options,
    metadata: { updatedAt: new Date().toISOString() }
  });

  if (!result.modified) {
    const current = await store.getWithMetadata(STATE_KEY, { type: "json" });
    return json({ error: "A newer copy was saved on another device.", state: current?.data || null, etag: current?.etag || null }, 409);
  }

  return json({ ok: true, etag: result.etag, updatedAt: new Date().toISOString() });
}
