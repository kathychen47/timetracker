# /meeting 会议问答 skill（备份）

真正生效的那份在 `C:\Users\<用户>\.claude\skills\meeting\`。换电脑时把这个文件夹拷过去，再把 `otter-ext/content.js`、`content.css` 也拷进去。

- `launch.ps1`：桌面「Otter (Meowly)」快捷方式跑它，开 Otter（本机调试通道 9333）+ 后台起桥
- `bridge.js`：往 Otter app 里放翻译 / 复制 / 问 AI 面板，稿子写进 `~/meeting-live/`，/meeting 所在项目的 `meetings/`（自动 .gitignore）
- `wait.js`：等问题，`test-wait.js` 是离线测试（9 条）
