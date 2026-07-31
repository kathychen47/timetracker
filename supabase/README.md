# 让 Google 日历「登上去就不掉下来」

## 为什么会掉

Google 的 access token **只活 1 小时**，这是死规定，改不了。

要让它自动续，必须拿 **refresh token** 去换新的 —— 而换的时候要带 **client secret**。
静态网页（GitHub Pages）里放 secret 等于公开，所以纯前端**永远做不到不掉线**。
以前那套「静默续期」靠的是第三方 Cookie，浏览器现在基本都拦，于是就变成了弹窗。

解决办法：**找个地方替你保管 refresh token**。你已经有 Supabase 了，加一个 Edge Function 就够。

```
浏览器 ──(自己的登录凭证)──▶ Edge Function ──(refresh token + secret)──▶ Google
       ◀────── 新鲜的 access token ──────┘
```

secret 和 refresh token 都在 Supabase 里，浏览器碰不到。

---

## 五步，大约 20 分钟

全程在 <https://supabase.com/dashboard> 你自己的项目（`xypppmvwpbkytzdwbytc`）里。

### 1. 建表

左边 **SQL Editor** → New query → 把 [`gcal_tokens.sql`](gcal_tokens.sql) 整个粘进去 → Run。

> 这张表**故意没有 select 策略**：浏览器只能写、读不回来，只有 Edge Function 读得到。

### 2. 拿到 Google 的 client id / secret

左边 **Authentication → Sign In / Providers → Google**，把里面已经填好的
**Client ID** 和 **Client Secret** 复制出来。

> Client Secret 要是显示成一堆圆点复制不出来，就去
> [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
> 点开那个 OAuth client（`707528813420-…`）拿。
> 注意 Management API 读到的 `external_google_secret` 是 **Supabase 加密后的形态**
> （64 位 hex），不是真的 secret，拿去用会得到 `invalid_client`。

⚠️ 一定要用这里的这一对。refresh token 是 Supabase 这套 OAuth 流程拿到的，
换 token 时必须用**同一个** client，用别的会报 `invalid_client`。

### 3. 存成 Edge Function 的密钥

左边 **Edge Functions → Secrets**（或 Project Settings → Edge Functions），加两条：

| 名字 | 值 |
|---|---|
| `GOOGLE_CLIENT_ID` | 第 2 步的 Client ID |
| `GOOGLE_CLIENT_SECRET` | 第 2 步的 Client Secret |

（`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 是自带的，不用加。）

### 4. 部署函数

左边 **Edge Functions → Deploy a new function**，名字必须是 **`gcal-token`**，
把 [`functions/gcal-token/index.ts`](functions/gcal-token/index.ts) 整个粘进去 → Deploy。

部署好之后，进这个函数的 **Details → Verify JWT** 关掉（`verify_jwt: false`）。

> 为什么要关：浏览器跨域前会先发一个**不带凭证**的 OPTIONS 预检，
> 开着网关校验的话这一下会被拒（503），函数在网页里根本调不通。
> 安全性不受影响 —— 函数自己第一件事就是拿 JWT 去 `/auth/v1/user` 验，
> 不合格直接 401。可以自己试：
>
> ```bash
> curl -X POST https://<ref>.supabase.co/functions/v1/gcal-token >      -H "Authorization: Bearer 随便编一个"     # → 401 bad_jwt
> ```

⚠️ 改这个函数时**不要加任何 `import`**。Edge Runtime 启动时带 `--no-remote`，
直接部署的代码不会去下载远程依赖，写了 `import ... from "https://..."`
会直接 `BOOT_ERROR` 起不来（CLI 部署会预先打包，所以 CLI 没这个限制）。
现在这份是零依赖的，全用裸 `fetch`。

### 5. 重新登录一次

打开 <https://kathychen47.github.io/timetracker/> → 设置 → 👤 账号 → **先退出、再用 Google 登录**。

这一次会多问你一遍「是否允许访问日历」——**必须点同意**。
Google 只在"明确同意"的那一次给 refresh token，所以这一步跳不掉。

登完去 **设置 → 📅 Google 日历**，看到这行就成了：

> ✅ 自动续期已开启 —— 授权存在你自己的 Supabase 里，过期会自动续，不会再弹窗

---

## 之后会怎样

- 关掉标签页几天再打开 → 自动续，不弹窗
- 手机上打开 → 自动续，不弹窗
- 浏览器禁了第三方 Cookie → 照样自动续（这条路根本不用 Cookie）
- 你在 Google 账号里撤销了授权 → 函数返回 410，前端会提示你重新授权一次

## 没做这一步会怎样

一切照旧：授权管 1 小时，过期后在设置里或事件弹窗里点一次「重新授权」。
不会报错，只是要你手动点。

## 排查

在设置页打开浏览器控制台，看那次 `functions/v1/gcal-token` 请求：

| 返回 | 意思 | 怎么办 |
|---|---|---|
| `404 no_refresh_token` | 表里没有你的 refresh token | 回到第 5 步，退出重登并点同意 |
| `410 revoked` | 你在 Google 那边撤销了授权 | 同上，重登一次 |
| `502 invalid_client` | client id/secret 和 Supabase 里的对不上 | 回到第 2、3 步核对 |
| 连不上 / CORS | 函数没部署或名字写错 | 名字必须正好是 `gcal-token` |
