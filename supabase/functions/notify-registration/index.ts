const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-webhook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: cors });
}

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
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

  const expectedSecret = Deno.env.get("KINDRED_WEBHOOK_SECRET");
  const suppliedSecret = req.headers.get("x-webhook-secret");
  if (!expectedSecret || !suppliedSecret || !sameSecret(expectedSecret, suppliedSecret)) {
    return json({ error: "Webhook authentication failed" }, 401);
  }

  let payload: {
    type?: string;
    schema?: string;
    table?: string;
    record?: { id?: string; display_name?: string; status?: string; created_at?: string };
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid webhook payload" }, 400);
  }

  const record = payload.record;
  if (payload.type !== "INSERT" || payload.schema !== "public" || payload.table !== "profiles" ||
      !record?.id || record.status !== "pending" || typeof record.display_name !== "string") {
    return json({ error: "Unsupported database event" }, 400);
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  const recipients = (Deno.env.get("ADMIN_NOTIFICATION_EMAILS") ?? "")
    .split(",").map((email) => email.trim()).filter(Boolean);
  if (!apiKey || !from || recipients.length === 0) {
    return json({ error: "Email service or administrator recipient is not configured" }, 503);
  }

  const name = escapeHtml(record.display_name);
  const siteUrl = Deno.env.get("SITE_URL")?.replace(/\/+$/, "");
  const dashboard = siteUrl ? `${siteUrl}/?page=admin` : "";
  const message = {
    from,
    to: recipients,
    subject: "New Kindred Konnect membership request",
    html: `<p>${name} has requested Kindred Konnect membership.</p><p>Review the request in the administrator portal${dashboard ? `: <a href="${escapeHtml(dashboard)}">Open dashboard</a>` : "."}</p>`,
    text: `${record.display_name} has requested Kindred Konnect membership.${dashboard ? ` Review the request: ${dashboard}` : ""}`,
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
  if (!response.ok) return json({ error: "Resend rejected the administrator notification" }, 502);
  return json({ sent: true });
});
