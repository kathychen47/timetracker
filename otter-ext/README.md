# Otter 翻译 + 复制（Meowly）

挂在 Otter 网页版（otter.ai）上的 Chrome 扩展：

- 每一段下面加一行中文翻译（Google / MyMemory / 本地 Ollama 可选），实时录音时最后一句说完再翻
- 一键复制：全部 / 最近 5 分钟 / 最近 N 分钟，带时间戳和说话人，可选带译文，直接贴给 AI 问

## 装上

1. Chrome 地址栏打开 `chrome://extensions`
2. 右上角打开「开发者模式」
3. 点「加载已解压的扩展程序」，选这个 `otter-ext` 文件夹
4. 刷新 Otter 页面，右下角会出现一个圆形的「文A」按钮

改了代码以后：在 `chrome://extensions` 里点这个扩展的刷新箭头，再刷新 Otter 页面。

## 怎么找句子

先认 Otter 自己的标记（`transcript-bubble-row`、`speaker-name`、`transcript-bubble-timestamp`、`.transcript-bubble-wrapper`）；
认不到就退回「按长相找」：只写着 `0:21` 这种时间的小元素 = 一段的时间戳。

Otter 长稿子只渲染看得见的部分，「复制全部」复制的是这次打开后出现过的段。回看旧录音时先从头滚到尾一遍再复制。

## 测试

`node tools/test-otter-ext.js`
