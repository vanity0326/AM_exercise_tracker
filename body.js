// Body Progress dashboard storage (Netlify Blobs), separate from the
// tracker's own data so neither app can overwrite the other.
// GET -> saved dashboard JSON (or null). PUT -> saves it, stamps updatedAt.
import { getStore } from "@netlify/blobs";

const KEY = "body";

export default async (req) => {
  const store = getStore("iron-log");
  if (req.method === "GET") {
    const data = await store.get(KEY, { type: "json" });
    return new Response(JSON.stringify(data || null), { headers: { "Content-Type": "application/json" } });
  }
  if (req.method === "PUT" || req.method === "POST") {
    let body;
    try { body = await req.json(); } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const toSave = { ...body, updatedAt: new Date().toISOString() };
    await store.setJSON(KEY, toSave);
    return new Response(JSON.stringify(toSave), { headers: { "Content-Type": "application/json" } });
  }
  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/body" };
