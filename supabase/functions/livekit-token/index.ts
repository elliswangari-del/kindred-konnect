import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors });
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const auth = req.headers.get("Authorization");
  if (!auth) return Response.json({ error: "Sign in required" }, { status: 401, headers: cors });
  const supabase = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return Response.json({ error: "Invalid session" }, { status: 401, headers: cors });
  const { data: profile, error } = await supabase.from("profiles").select("display_name,status").eq("id", user.id).single();
  if (error || profile?.status !== "approved") return Response.json({ error: "Approved membership required" }, { status: 403, headers: cors });
  const key = Deno.env.get("LIVEKIT_API_KEY"), secret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!key || !secret) return Response.json({ error: "Call service is not configured" }, { status: 503, headers: cors });
  let body: { room?: string; kind?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Invalid request" }, { status: 400, headers: cors }); }
  if (body.room !== "kindred-community" || !["audio", "video"].includes(body.kind ?? "")) return Response.json({ error: "Invalid call room" }, { status: 400, headers: cors });
  const token = new AccessToken(key, secret, { identity: user.id, name: profile.display_name, ttl: "2h" });
  token.addGrant({ roomJoin: true, room: body.room, canPublish: true, canSubscribe: true });
  return Response.json({ token: await token.toJwt() }, { headers: cors });
});
