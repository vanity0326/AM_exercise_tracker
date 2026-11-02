export const config = { path: "/api/reminder-config" };

export default async function () {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";
  return new Response(JSON.stringify({ publicKey }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
