import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authorization = req.headers.get("Authorization");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!authorization || !supabaseUrl || !anonKey) {
    return json({ error: "A valid administrator session is required" }, 401);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: "Invalid session" }, 401);

  const { data: profile, error: profileError } = await supabase
    .from("profiles").select("role,status").eq("id", user.id).maybeSingle();
  if (profileError) return json({ error: "Could not verify administrator access" }, 500);
  if (profile?.role !== "admin" || profile.status !== "approved") {
    return json({ error: "Administrator access required" }, 403);
  }

  let body: { target_user_id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (!body.target_user_id || !["approved", "rejected"].includes(body.status ?? "")) {
    return json({ error: "Invalid membership notification" }, 400);
  }

  const { data: members, error: membersError } = await supabase.rpc("admin_list_members");
  if (membersError) return json({ error: "Could not verify the membership record" }, 500);
  const member = (members ?? []).find((item: { id: string; display_name: string; email: string; role: string; status: string }) =>
    item.id === body.target_user_id && item.role === "member" && item.status === body.status);
  if (!member) return json({ error: "Matching member status was not found" }, 404);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!apiKey || !from) return json({ error: "Email service is not configured" }, 503);

  const approved = body.status === "approved";
  const name = escapeHtml(member.display_name);
  const message = {
    from,
    to: [member.email],
    subject: approved ? "Your Kindred Konnect membership is approved" : "Kindred Konnect membership update",
    html: approved
      ? `<p>Hello ${name},</p><p>Your Kindred Konnect membership has been approved. Welcome to the community!</p>`
      : `<p>Hello,</p><p>Thank you for your interest, ${name}. Your Kindred Konnect membership request has been declined. Please contact the community administrator if you have questions.</p>`,
    text: approved
      ? `Hello ${member.display_name}, your Kindred Konnect membership has been approved. Welcome to the community!`
      : `Thank you for your interest, ${member.display_name}. Your Kindred Konnect membership request has been declined. Please contact the community administrator if you have questions.`,
  };

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  } catch {
    return json({ error: "Resend could not be reached" }, 502);
  }
  if (!response.ok) return json({ error: "Resend rejected the membership email" }, 502);
  return json({ sent: true });
});
