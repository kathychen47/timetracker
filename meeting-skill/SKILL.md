---
name: meeting
description: 会议 / 面试问答模式。Otter app 的实时稿子由 Meowly 桥写进 ~/meeting-live/，Claude 在当前项目 workspace 里一直盯着，对方一提问（或她在 Otter 面板点「问 AI」）就结合项目背景给出可以直接说出口的回答。她输入 /meeting、或说「开始问答模式 / 盯着会议」时用。参数可带时长，如 /meeting 60。
---

# /meeting：会议问答模式

她开会时 Otter app 在录音（从桌面「Otter (Meowly)」快捷方式打开，这样才有本机调试通道），
`bridge.js` 把稿子实时写进 `~/meeting-live/`（`transcript.md` 给人看，`state.json` 给程序用）。
你（Claude Code）在她当前打开的项目里，**只在有问题时**回答：别人说出问句，或她点了「问 AI」。
她自己说的话、普通陈述都不用管。

本目录：`C:\Users\<用户>\.claude\skills\meeting\`（下文用 `$SKILL` 指它，`$LIVE` 指 `~/meeting-live`）。

## 开始

1. **桥在不在**：`curl -s http://127.0.0.1:47321/ping`
   - 连不上 → 用 PowerShell 跑 `$SKILL\launch.ps1`（它会开 Otter 和桥；要先清掉 `ELECTRON_RUN_AS_NODE`，脚本里已经做了，需要关沙箱运行）。
     Otter 已经开着但不是从快捷方式开的，脚本会弹窗问她要不要重启 Otter —— **正在录音时不要替她重启**，告诉她录完从快捷方式重开。
   - `"otter":false` → 告诉她从桌面「Otter (Meowly)」快捷方式打开 Otter。
2. **写 session**（用 Write 工具写 `$LIVE/session.json`）：
   ```json
   {"active": true, "workspace": "<当前项目根目录的绝对路径>", "me": ["Kathy", "Kathy Chen", "Kaisi", "Kaisi Chen"], "until": <现在毫秒 + 时长>}
   ```
   时长默认 90 分钟，她给了就用她的。`workspace` 让桥把稿子同时存进这个项目的 `meetings/`（会自动加进 `.gitignore`）。
3. **先读背景**（快速、只读）：项目根目录的 `CLAUDE.md`、`README*`、`meeting-context.md`（如果有）、`meetings/` 里最近 1–2 份会议稿。
   目的是之后回答不用再翻，每次能在十几秒内答出来。别做大范围搜索。
4. **起监视**：后台运行 `node "$SKILL/wait.js" --fresh`（`run_in_background: true`）。
5. 告诉她一句：已经在盯了、到几点结束、怎么停（说「停」）。

## 被叫醒时（wait.js 退出）

读它的输出文件。退出码：
- **0 = 有问题要答**：输出里有「要回答的问题」和最近 6 分钟稿子。按下面的格式回答，然后**立刻**再起 `node "$SKILL/wait.js"`（不带 --fresh）。
- **5 = 9 分钟没问题**：什么都不用说，直接再起 wait.js。
- **3 = 到时间**、**4 = 已停止**：不再起，告诉她问答模式结束，问她要不要总结这场会。

## 回答格式（她在会上扫一眼就能用）

```
**Q（Speaker 2，12:40）：** <问题，简短>

- <英文要点 1，一句话，能直接说出口>
- <英文要点 2>
- <英文要点 3（可选）>

<一两句中文：意思 / 提醒 / 需要核对的地方>
```

- 要点用**英文**、口语、短句，按她的身份和项目实际情况说，具体到数字、方法、文件里的事实。
- 背景里查不到的，不要编：写「不确定，建议说：Let me double-check and get back to you」。
- 问题不是问她的（别人之间的对话）或者是寒暄 → 只回一行中文说明，别展开。
- 快比全重要：别在回答前做大段搜索；必要时只读一两个最相关的文件。

## 停止

她说「停」/「结束」：写 `$LIVE/session.json` 为 `{"active": false}`（wait.js 会自己退出），
告诉她已停止，稿子在 `meetings/` 和 `$LIVE/transcript.md`，问要不要总结 / 列待办。

## 文件

- `launch.ps1`：开 Otter（`--remote-debugging-port=9333`）+ 后台起桥。桌面快捷方式跑它。
- `bridge.js`：连 Otter，放翻译 / 复制 / 问 AI 面板，写稿子。日志 `$LIVE/bridge.log`。
- `wait.js`：等问题。`test-wait.js` 是它的离线测试。
- `content.js` / `content.css`：面板代码，和项目 `Timetracker/otter-ext/` 里同一份（桥优先读项目里那份）。
