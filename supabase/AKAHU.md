# 让 Westpac 的流水自己流进记账页

## 在解决什么

以前：每月登录 Westpac → 选账户 → 选日期 → 导 CSV → 手动导入。
现在：一次性授权，之后 Akahu 每天自己去银行拉，你再也不碰网银。

[Akahu](https://www.akahu.nz/) 是新西兰的 accredited requestor（正规开放银行参与方），
Westpac 是它官方支持的 11 家银行之一，走 OAuth2 授权，不是爬网页。

**访问你自己的数据不收费** —— Personal App 免费。那个 $0.50–$2.50/用户/月 的价目
是给商业 app 连别人账户用的，跟你没关系。

```
浏览器 ──(你的 Supabase 登录凭证)──▶ Edge Function ──(Akahu 两个 token)──▶ Akahu ──▶ Westpac
       ◀──────────── 精简过的交易列表 ────────────┘
```

两个 Akahu token 只存在 Supabase 环境变量里，浏览器碰不到。
**这一点不能省** —— `index.html` 在公开仓库里，token 写进去等于把银行数据挂到网上。

---

## 五步，大约 15 分钟

### 1. 注册 Akahu 并连上 Westpac

1. <https://my.akahu.nz> 用邮箱注册
2. 连银行 → 选 **Westpac** → 走它的授权流程（跳到 Westpac 登录并同意）
3. 等它第一次同步完（几分钟，能看到账户和交易就好了）

### 2. 建 Personal App，拿两个 token

<https://my.akahu.nz/developers> → **Create personal app**。

拿到两个值：

| 名字 | 长这样 | 用在哪 |
|---|---|---|
| **App ID Token** | `app_token_…` | 请求头 `X-Akahu-Id` |
| **User Access Token** | `user_token_…` | 请求头 `Authorization: Bearer …` |

> ⚠️ 这两个等于你银行流水的读取权。**不要发到聊天里、不要提交进 git**，
> 直接粘进下一步的 Supabase 后台。

### 3. 拿到你自己的 Supabase user id

打开 <https://kathychen47.github.io/timetracker/>，确认已经用 Google 登录，
然后 F12 打开控制台，粘这一行回车：

```js
(await window.__SB.auth.getUser()).data.user.id
```

> 没有 `__SB` 的话，去 Supabase 后台 **Authentication → Users**，
> 找到你那一行，复制 **UID** 那一列（一串 uuid）。

### 4. 存成 Edge Function 的密钥

Supabase 后台（项目 `xypppmvwpbkytzdwbytc`）→ 左边 **Edge Functions → Secrets**，加三条：

| 名字 | 值 |
|---|---|
| `AKAHU_APP_TOKEN` | 第 2 步的 App ID Token |
| `AKAHU_USER_TOKEN` | 第 2 步的 User Access Token |
| `AKAHU_OWNER_UID` | 第 3 步的 uuid |

`AKAHU_OWNER_UID` 这条**别漏**。函数里的 token 是写死的，不锁所有者的话，
任何人在这个 app 注册个号、调一下函数，就能看到你的银行流水。

### 5. 部署函数

左边 **Edge Functions → Deploy a new function**，名字必须正好是 **`akahu-sync`**，
把 [`functions/akahu-sync/index.ts`](functions/akahu-sync/index.ts) 整个粘进去 → Deploy。

部署好之后进这个函数的 **Details → Verify JWT 关掉**（`verify_jwt: false`）。

> 为什么要关：浏览器跨域前会先发一个**不带凭证**的 OPTIONS 预检，
> 开着网关校验这一下会被拒（503），函数在网页里根本调不通。
> 安全性不受影响 —— 函数自己第一件事就是拿 JWT 去 `/auth/v1/user` 验，
> 不合格 401，不是所有者 403。

⚠️ 改这个函数时**不要加任何 `import`**。Edge Runtime 启动时带 `--no-remote`，
后台直接粘贴的代码不会去下载远程依赖，写了 `import ... from "https://..."`
会直接 `BOOT_ERROR` 起不来。现在这份是零依赖的，全用裸 `fetch`。

---

## 验收

打开 app → **💰 记账** → 点 **🔄 同步**。

看到交易冒出来就成了。第一次可以点「拉全部历史」，之后每次只拉最近 90 天。

## 之后会怎样

- 打开记账页会自动同步（离上次 ≥1 小时才真的发请求，别捶人家接口）
- Akahu 那边每天自己去 Westpac 拉一次新交易
- 刷卡后**几小时到一天**才会出现 —— Personal App 是每日刷新，做不到实时，
  记账本来也不需要实时
- 开放银行的授权 consent 隔一阵要续一次（年度级别的事，不是每月）

## 排查

记账页点同步后 F12 看那次 `functions/v1/akahu-sync` 请求：

| 返回 | 意思 | 怎么办 |
|---|---|---|
| `503 not_configured` | 密钥没设或名字拼错 | 回第 4 步核对三个名字 |
| `401 bad_jwt` | 没登录 / 登录过期 | 在 app 里重新用 Google 登录 |
| `403 not_owner` | `AKAHU_OWNER_UID` 跟当前登录用户对不上 | 回第 3 步重新取 uuid |
| `401 akahu_auth` | 两个 Akahu token 错了，或你在 Akahu 撤了授权 | 回第 2 步重新生成 |
| `502 akahu_txn` | Akahu 那边出错了 | 看返回里的 `detail` |
| 连不上 / CORS | 函数没部署或名字写错 | 名字必须正好是 `akahu-sync` |

返回里带 `truncated: true` 的话，说明历史太长一次没拉完（超过 20 页），
分两次拉小一点的区间就行。

## 不做这一步会怎样

记账页照常能用，只是没有「同步」——
走 **📄 导入文件**：Westpac 网银导出交易（**只有桌面浏览器版有，手机 app 里没有**，
每个账户要分开导），选 CSV 格式，拖进来一样能记账。

---

## 搬旧账 / 多币种

**📄 导入文件** 同时吃 `.csv` 和 `.xlsx`，表头是中文还是英文都认：

| 认的列 | 中文 | 英文 |
|---|---|---|
| 日期 | 时间 / 日期 | Date / Transaction Date |
| 金额 | 金额 | Amount |
| 币种 | 币种 / 货币 | Currency |
| 收支 | 类型 | Type |
| 账户 | 账户1 / 账户 | Account |
| 摘要 | 分类 / 二级分类 / 备注 / 标签 | Other Party / Description / Particulars … |

**「类型」列很关键**：钱迹这类 app 导出的金额全是正数，靠这一列区分支出/收入。
少认这列，五年的账会全部变成收入。

xlsx 是直接在浏览器里解的（zip + 原生 `DecompressionStream`），没引任何库。
浏览器太老不支持的话，在 Excel 里另存为 CSV 一样能导。

**币种是硬隔离**：页面任何时候只看一种货币，顶上有下拉切换。
NZD 和 CNY 加在一起得出的数字没有意义，所以不提供「全部币种」这个选项。

## 收入 → 税务

记账页里 **NZD 的进账**会多一个「记入税务」按钮，点一下就进税务页的收入记录
（可以选含不含 GST）。两边各存各的，税务那份之后可以自己改金额；
在记账页点「已记税 ✓」能撤回，只会删掉它带过去的那一条，不碰你手工记的收入。

非 NZD 的进账没有这个按钮 —— 税务页算的是新西兰的 PAYE/ACC/GST，
人民币的收租记进去没有意义。
