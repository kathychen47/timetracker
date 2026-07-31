// 拿用户存好的 refresh token，去 Google 换一个新鲜的 access token。
// client secret 只存在 Supabase 的环境变量里，永远不出现在浏览器。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "no_auth" }, 401);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 谁在问？以 JWT 为准，别信请求体里传来的任何 id
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user) return json({ error: "bad_jwt" }, 401);
  const uid = who.user.id;

  const { data: row } = await admin
    .from("gcal_tokens").select("refresh_token").eq("user_id", uid).maybeSingle();
  if (!row?.refresh_token) return json({ error: "no_refresh_token" }, 404);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const t = await res.json();

  if (!res.ok) {
    // 你在 Google 那边撤销了授权，或者密码改了 —— 这张 refresh token 作废，删掉让前端重新走一次同意
    if (t.error === "invalid_grant") {
      await admin.from("gcal_tokens").delete().eq("user_id", uid);
      return json({ error: "revoked" }, 410);
    }
    return json({ error: t.error ?? "refresh_failed", detail: t.error_description }, 502);
  }

  return json({ access_token: t.access_token, expires_in: t.expires_in ?? 3600 });
});
