// 拿用户存好的 refresh token，去 Google 换一个新鲜的 access token。
// client secret 只存在 Supabase 的环境变量里，永远不出现在浏览器。
//
// 刻意零依赖：Edge Runtime 启动时带 --no-remote，不会去下载远程 import。
// 直接部署（API / 后台粘贴）时，任何 https:// 的 import 都会让函数起不来（BOOT_ERROR）。
// 这里要的三件事用裸 fetch 打 Supabase 自己的接口就够了。

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REST = `${URL_}/rest/v1/gcal_tokens`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
const srvHeaders = { apikey: SRV, Authorization: `Bearer ${SRV}` };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "no_auth" }, 401);

  // 谁在问？让 Supabase 自己去验这张 JWT，别信请求体里传来的任何 id
  const meRes = await fetch(`${URL_}/auth/v1/user`, {
    headers: { apikey: SRV, Authorization: `Bearer ${jwt}` },
  });
  if (!meRes.ok) return json({ error: "bad_jwt" }, 401);
  const uid = (await meRes.json())?.id;
  if (!uid) return json({ error: "bad_jwt" }, 401);

  // service role 读表 —— 前端没有 select 策略，永远读不到这一行
  const rowRes = await fetch(
    `${REST}?user_id=eq.${encodeURIComponent(uid)}&select=refresh_token`,
    { headers: srvHeaders },
  );
  const rows = rowRes.ok ? await rowRes.json() : [];
  const refresh = rows?.[0]?.refresh_token;
  if (!refresh) return json({ error: "no_refresh_token" }, 404);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const t = await res.json();

  if (!res.ok) {
    // 你在 Google 那边撤销了授权，或者改了密码 —— 这张 refresh token 作废了，
    // 删掉它，让前端提示你重新走一次同意
    if (t.error === "invalid_grant") {
      await fetch(`${REST}?user_id=eq.${encodeURIComponent(uid)}`, {
        method: "DELETE",
        headers: srvHeaders,
      });
      return json({ error: "revoked" }, 410);
    }
    return json({ error: t.error ?? "refresh_failed", detail: t.error_description }, 502);
  }

  return json({ access_token: t.access_token, expires_in: t.expires_in ?? 3600 });
});
