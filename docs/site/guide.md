# 小灵 LingBot 使用指南 / User Guide

> AI 语音浏览器助手 | AI Voice Browser Assistant

**版本 / Version：** v1.4.1 | **许可证 / License：** MIT

---

## 目录 / Table of Contents

1. [🚀 快速开始 / Quick Start](#1--快速开始--quick-start)
2. [💬 AI 对话 / AI Chat](#2--ai-对话--ai-chat)
3. [🌐 网页自动化 / Web Automation](#3--网页自动化--web-automation)
4. [🎤 语音控制 / Voice Control](#4--语音控制--voice-control)
5. [🌍 智能翻译 / Smart Translation](#5--智能翻译--smart-translation)
6. [📎 文件处理 / File Processing](#6--文件处理--file-processing)
7. [📊 图表生成与文件输出 / Charts & File Output](#7--图表生成与文件输出--charts--file-output)
8. [⚙️ 设置说明 / Settings](#8-️-设置说明--settings)
9. [🎨 主题 / Themes](#9--主题--themes)
10. [⌨️ 快捷命令 / Quick Commands](#10-️-快捷命令--quick-commands)
11. [💡 使用技巧 / Tips](#11--使用技巧--tips)
12. [❓ 常见问题 / FAQ](#12--常见问题--faq)

---

## 1. 🚀 快速开始 / Quick Start

### 1.1 安装扩展 / Installation

1. 下载最新 CRX 包
2. 打开 Chrome，地址栏输入 `chrome://extensions/`
3. 开启右上角「开发者模式」开关
4. 点击「加载已解压的扩展程序」按钮
5. 选择解压后的文件夹，确认加载

安装成功后，浏览器右上角工具栏会出现图标，页面右下角出现浮动按钮。

> 1. Download the latest CRX package
> 2. Open Chrome and go to `chrome://extensions/`
> 3. Enable "Developer mode" in the top-right corner
> 4. Click "Load unpacked" and select the extracted folder
> 5. The toolbar icon and a floating button will appear after installation

### 1.2 首次配置 AI 模型 / Initial Model Setup

1. 点击浮动按钮或按 `Ctrl+`` ` 打开侧边栏
2. 点击右上角 ⚙️ 齿轮图标进入设置
3. 在「AI」标签页，点击「新建模型」
4. 点击提供商预设按钮（如 DeepSeek），自动填充
5. 填写 API Key，点击「保存」

> **提示：** 提供 10 个一键预设：OpenAI、Anthropic、DeepSeek、MiMo、Qwen、Kimi、智谱、百度、MiniMax、硅基流动。

> 1. Click the floating button or press `Ctrl+`` ` to open the sidebar
> 2. Click the ⚙️ gear icon in the top-right corner
> 3. In the "AI" tab, click "New Model"
> 4. Click a provider preset button (e.g., DeepSeek) to auto-fill
> 5. Enter your API Key and click "Save"

> **Tip:** 10 one-click presets available: OpenAI, Anthropic, DeepSeek, MiMo, Qwen, Kimi, Zhipu, Baidu, MiniMax, SiliconFlow.

### 1.3 打开侧边栏 / Opening the Sidebar

| 方式 / Method | 操作 / Action | 说明 / Description |
|------|------|------|
| 工具栏图标 / Toolbar icon | 点击浏览器右上角图标 | 最常用 / Most common |
| 键盘快捷键 / Shortcut | `Ctrl+`` ` | 可自定义 / Customizable |
| 浮动按钮 / Floating button | 点击页面右下角浮动按钮 | 任何页面可用 / Available on any page |

> **注意：** 侧边栏状态在所有标签页间同步。
> **Note:** Sidebar state is synced across all tabs.

### 1.4 浮动按钮 / Floating Button

- **点击 / Click** — 打开/关闭侧边栏 / Toggle sidebar
- **拖拽 / Drag** — 拖到任意位置（移动超 3px 才算拖拽）/ Drag to any position (3px threshold)
- **位置记忆 / Position memory** — 自动保存，刷新后仍在原位 / Auto-saved, persists across refresh

### 1.5 调整侧边栏宽度 / Resize Sidebar

拖动侧边栏左边缘手柄（最小 60px，最大 95% 视口宽度），宽度自动同步所有标签页。

> Drag the left edge handle of the sidebar (min 60px, max 95% viewport width). Width is auto-synced across all tabs.

---

## 2. 💬 AI 对话 / AI Chat

### 2.1 支持的 AI 提供商（11 个）/ Supported AI Providers (11)

| 提供商 / Provider | 代表模型 / Models |
|--------|----------|
| OpenAI | GPT-4o、GPT-4、GPT-3.5 |
| Anthropic | Claude 3.5 Sonnet、Claude 4 |
| Google Gemini | Gemini 1.5 Pro、Gemini 2.0 |
| DeepSeek | DeepSeek-V3、DeepSeek-R1 |
| MiMo | MiMo-v2.5-pro |
| Qwen (通义千问) | Qwen-Max、Qwen-Plus |
| Kimi (Moonshot) | Moonshot-v1-128k |
| 智谱 (Zhipu/ChatGLM) | GLM-4 |
| 文心一言 (Wenxin) | ERNIE-4.0 |
| MiniMax | MiniMax-Text |
| 硅基流动 (SiliconFlow) | Various models |
| 豆包 (Doubao) | Doubao-pro |
| Grok | Grok-2 |
| 自定义 / Custom | 任何 OpenAI 兼容的 API / Any OpenAI-compatible API |

### 2.2 发送消息 / Sending Messages

在输入框输入文字，按 **Enter** 发送，**Shift+Enter** 换行。AI 实时流式输出回复，点击 ⏹ 可中断。

> Type your message and press **Enter** to send, **Shift+Enter** for a new line. AI responses stream in real-time; click ⏹ to stop.

> **💡 试试这样说：**
>
> - "你好，介绍一下你自己"
> - "帮我写一封请假邮件"
> - "用 Python 写一个快速排序"
> - "解释一下什么是量子计算"

> **💡 Try saying:**
>
> - "Hello, introduce yourself"
> - "Help me write a leave request email"
> - "Write a quicksort in Python"
> - "Explain what quantum computing is"

### 2.3 切换模型 / Switching Models

点击输入框下方的**模型名称药丸** → 下拉列表选择 → 立即切换。每个对话独立使用不同模型。

> Click the **model name pill** below the input box → select from the dropdown → switch instantly. Each conversation uses its own model independently.

### 2.4 深度思考模式 / Deep Thinking Mode

点击 💡 灯泡图标开启（仅支持 reasoning 的模型如 DeepSeek-R1、Claude 3.7+）。AI 会先展示可折叠的「💭 深度思考」区块。

> Click the 💡 lightbulb icon to enable (only for reasoning-capable models like DeepSeek-R1, Claude 3.7+). AI will show a collapsible "💭 Deep Thinking" block first.

> **💡 试试这样说：**
>
> - "分析一下 React 和 Vue 的优缺点，需要深度分析"
> - "帮我设计一个电商系统的架构，需要详细思考"

> **💡 Try saying:**
>
> - "Analyze the pros and cons of React and Vue in depth"
> - "Design an e-commerce system architecture with detailed thinking"

### 2.5 文件附件 / File Attachments

| 方式 / Method | 操作 / Action |
|------|------|
| 点击上传 / Click upload | 📎 回形针图标，支持多选 / Paperclip icon, multi-select supported |
| 粘贴图片 / Paste image | 直接粘贴截图 / Paste screenshots directly |
| 粘贴 URL / Paste URL | 自动抓取页面内容 / Auto-fetches page content |
| 粘贴本地路径 / Paste local path | 如 `C:\Users\...\file.txt` / e.g. `C:\Users\...\file.txt` |

**支持格式 / Supported Formats：**

| 类型 / Type | 格式 / Formats | 限制 / Limit | 处理 / Processing |
|------|------|------|------|
| 图片 / Image | jpg, png, gif, webp, bmp, svg | 20 MB | 自动 OCR / Auto OCR |
| 文本 / Text | txt, log, csv, tsv 等 | 2 MB | 直接读取 / Direct read |
| 代码 / Code | js, ts, py 等 60+ 种 | 2 MB | 语言检测 / Language detection |
| PDF | pdf | 10 MB | 逐页提取 / Page-by-page extraction |
| Word | doc, docx | 10 MB | 提取文本 / Text extraction |
| Excel | xls, xlsx, csv, tsv | 10 MB | 导出 CSV / Export CSV |

> **注意：** 扫描版 PDF（纯图片）会提示无法提取文本。Excel 多工作表会分别标注。
> **Note:** Scanned PDFs (image-only) will show a warning. Multi-sheet Excel files are labeled per sheet.

> **💡 试试这样说：**
>
> - （上传截图后）"提取图片中的文字并翻译成英文"
> - （上传 PDF 后）"总结这篇文档的要点"
> - （上传代码后）"检查这段代码的问题并给出改进建议"

> **💡 Try saying:**
>
> - (After uploading a screenshot) "Extract the text from this image and translate it to English"
> - (After uploading a PDF) "Summarize the key points of this document"
> - (After uploading code) "Review this code and suggest improvements"

### 2.6 选中文字自动发送 / Auto-send Selected Text

| 模式 / Mode | 行为 / Behavior |
|------|------|
| **自动发送 / Auto**（默认 / default） | 直接发送给 AI / Send directly to AI |
| **手动发送 / Manual** | 填入输入框，手动确认 / Fill input box, confirm manually |
| **关闭 / Off** | 不处理 / No action |

### 2.7 消息管理 / Message Management

| 操作 / Action | 方式 / Method |
|------|------|
| 清空对话 / Clear chat | 头部 🗑️ 图标 / Header 🗑️ icon |
| 删除单条 / Delete one | 右键消息 → 删除 / Right-click → Delete |
| 复制内容 / Copy | 右键消息 → 复制内容 / Right-click → Copy |
| 收藏消息 / Bookmark | 右键消息 → 收藏 / Right-click → Bookmark |
| 中断回复 / Stop reply | ⏹ 停止按钮 / ⏹ Stop button |
| 滚动到底 / Scroll to bottom | ⬇ 浮动按钮 / ⬇ Floating button |

> **💡 试试这样说：** 右键点击任意 AI 回复 → 选择「收藏」，消息会被保存到本地存储中。
> **💡 Try this:** Right-click any AI reply → select "Bookmark" to save the message to local storage.

### 2.8 消息内容交互 / Message Content Interaction

- **代码块 / Code blocks** — 右上角复制按钮（1.5s 确认反馈）/ Copy button with 1.5s feedback
- **表格 / Tables** — 右上角下载按钮（导出 Excel）/ Download button (Excel export)
- **深度思考 / Deep thinking** — 可折叠区块 / Collapsible block
- **错误 / Errors** — 红色横幅 / Red banner；停止 / Aborted — 黄色横幅 / Yellow banner

### 2.9 输入历史 / Input History

在空输入框按 **↑** 浏览历史（最多 100 条），**↓** 前进。

> Press **↑** in an empty input to browse history (up to 100 entries), **↓** to go forward.

### 2.10 上下文管理 / Context Management

默认携带最近 100 条消息，可在设置中调整（100-500）。

> Default context window is 100 messages, adjustable in settings (100-500).

### 2.11 交互式 AI 输入 / Interactive AI Input

AI 在执行任务过程中可暂停并请求用户输入，用户提供信息后继续执行。无需重新描述任务。

> AI can pause during task execution to request user input, then continue after receiving the information. No need to re-describe the task.

---

## 3. 🌐 网页自动化 / Web Automation

### 3.1 工作原理 / How It Works

AI 分析页面结构 → 生成操作命令 → 逐步执行 → 遇错自动重试（最多 5 次）→ 最多 20 步。

> AI analyzes page structure → generates action commands → executes step by step → auto-retries on error (max 5 times) → max 20 steps.

### 3.2 自然语言操作 / Natural Language Operations

> **💡 试试这样说：**
>
> - "滚动到页面底部"
> - "点击搜索按钮"
> - "在搜索框中输入 Vue3 教程"
> - "帮我打开百度搜索 AI 新闻"
> - "总结一下这个页面的内容"
> - "把页面上的表格下载为 Excel"
> - "帮我登录，用户名是 admin，密码是 123456"
> - "点击第三个搜索结果"
> - "打开新标签页，访问 GitHub"

> **💡 Try saying:**
>
> - "Scroll to the bottom of the page"
> - "Click the search button"
> - "Type Vue3 tutorial in the search box"
> - "Open Baidu and search for AI news"
> - "Summarize this page"
> - "Download the table on this page as Excel"
> - "Help me log in, username admin, password 123456"
> - "Click the third search result"
> - "Open a new tab and go to GitHub"

### 3.3 快速命令（即时执行）/ Quick Commands (Instant)

| 命令 / Command | 说明 / Description | 示例 / Example |
|------|------|------|
| `/navigate` | 打开 URL / Open URL | `/navigate https://github.com` |
| `/scroll` | 滚动 / Scroll | `/scroll down`、`/scroll auto` |
| `/newTab` | 新标签页 / New tab | `/newTab` |
| `/closeTab` | 关闭标签页 / Close tab | `/closeTab` |
| `/nextTab` / `/prevTab` | 切换标签页 / Switch tab | `/nextTab` |
| `/switchTab` | 按关键词切换 / Switch by keyword | `/switchTab github` |
| `/keyboard` | 模拟按键 / Simulate key | `/keyboard Enter` |
| `/wait` | 等待 / Wait | `/wait 2000` |

### 3.4 页面操作命令 / Page Action Commands

| 命令 / Command | 说明 / Description | 示例 / Example |
|------|------|------|
| `/search` | 网页搜索 / Web search | `/search AI 新闻` |
| `/click` | 点击元素 / Click element | `/click 登录按钮` |
| `/type` | 输入文字 / Type text | `/type 搜索框 hello world` |
| `/clear` | 清空输入 / Clear input | `/clear 搜索框` |
| `/select` | 选择下拉项 / Select dropdown | `/select 国家 中国` |
| `/focus` | 聚焦元素 / Focus element | `/focus 邮箱输入框` |
| `/hover` | 悬停元素 / Hover element | `/hover 菜单项` |
| `/download` | 提取数据导出 / Extract & export | `/download` |
| `/summarize` | 总结页面 / Summarize page | `/summarize` |

### 3.5 控制命令 / Control Commands

| 命令 / Command | 说明 / Description |
|------|------|
| `/stop` | 停止当前操作 / Stop current operation |
| `/pause` | 暂停 / Pause |
| `/resume` | 恢复 / Resume |

### 3.6 滚动控制 / Scroll Control

| 方向 / Direction | 说明 / Description | 示例 / Example |
|------|------|------|
| `up` / `down` | 上/下滚动 80% 视口 / Scroll 80% viewport | `/scroll down` |
| `top` / `bottom` | 到顶/到底 / To top/bottom | `/scroll top` |
| `auto` | 自动持续滚动 / Auto continuous scroll | `/scroll auto` |
| `stop` / `pause` / `resume` | 控制自动滚动 / Control auto scroll | `/scroll pause` |

自动滚动特性：刷新页面保持状态，滚轮上暂停、下恢复，到底自动停止。

> Auto-scroll features: persists across page refresh, scroll wheel up pauses / down resumes, stops automatically at page bottom.

### 3.7 视频控制 / Video Control

> **💡 试试这样说：**
>
> - "播放视频" / "暂停视频"
> - "把音量调到 50%"
> - "静音" / "取消静音"
> - "快进 30 秒" / "后退 10 秒"
> - "跳到 2 分钟的位置"
> - "2 倍速播放"

> **💡 Try saying:**
>
> - "Play video" / "Pause video"
> - "Set volume to 50%"
> - "Mute" / "Unmute"
> - "Forward 30 seconds" / "Back 10 seconds"
> - "Jump to 2 minutes"
> - "Play at 2x speed"

> **注意：** 全屏需用户手势，AI 无法触发。
> **Note:** Fullscreen requires user gesture and cannot be triggered by AI.

### 3.8 标签页管理 / Tab Management

> **💡 试试这样说：**
>
> - "打开新标签页"
> - "关闭当前标签页"
> - "切换到 B 站"
> - "帮我切换到 GitHub 标签页"

> **💡 Try saying:**
>
> - "Open a new tab"
> - "Close the current tab"
> - "Switch to Bilibili"
> - "Switch to the GitHub tab"

支持中文别名：B站→bilibili.com、淘宝→taobao.com、京东→jd.com、百度→baidu.com、知乎→zhihu.com 等。

> Supports Chinese aliases: B站→bilibili.com, 淘宝→taobao.com, 京东→jd.com, 百度→baidu.com, 知乎→zhihu.com, etc.

### 3.9 数据提取与页面总结 / Data Extraction & Page Summary

页面总结采用三层递进分析框架，输出结构化 Markdown，可直接收藏为笔记：

- **第一层 · 提取** — 快速识别页面主题、内容类型、目标读者
- **第二层 · 分析** — 深入拆解关键论点、数据证据、逻辑脉络
- **第三层 · 洞察** — 超越内容的深层见解、盲区、行动建议

> Page summary uses a 3-layer progressive analysis framework, outputting structured Markdown that can be bookmarked as notes:
>
> - **Layer 1 · Extract** — Identify page topic, content type, target audience
> - **Layer 2 · Analyze** — Break down key arguments, data evidence, logical flow
> - **Layer 3 · Insight** — Deep insights, blind spots, action recommendations

输出包含：核心摘要、深度分析（关键要点 + 数据与证据 + 逻辑脉络）、洞察与启发、行动建议、关键词标签。自动适配不同内容类型（文章、产品页、数据表格、文档、讨论帖）。

> **💡 试试这样说：**
>
> - "把这个页面的内容总结一下"
> - "分析一下这篇技术文章的核心观点"
> - "提取页面上的所有链接"
> - "把页面上的商品信息整理成表格"
> - "下载这个页面的数据为 Excel"

> **💡 Try saying:**
>
> - "Summarize this page"
> - "Analyze the key points of this technical article"
> - "Extract all links from this page"
> - "Organize the product info on this page into a table"
> - "Download this page's data as Excel"

### 3.10 富文本编辑器支持 / Rich Editor Support

AI 可以自动识别并输入以下富文本编辑器：CodeMirror 5/6、Monaco Editor、Ace Editor、Quill、TinyMCE、CKEditor、ProseMirror/TipTap、Draft.js、WangEditor，以及通用 contenteditable 元素。

> AI can automatically detect and type into these rich editors: CodeMirror 5/6, Monaco Editor, Ace Editor, Quill, TinyMCE, CKEditor, ProseMirror/TipTap, Draft.js, WangEditor, and generic contenteditable elements.

### 3.11 跨标签页任务恢复 / Cross-tab Task Recovery

页面跳转时进度自动保存，新页面自动恢复执行（30 秒过期保护）。

> Progress is auto-saved on page navigation and restored on the new page (30-second expiry protection).

### 3.12 批量命令 / Batch Commands

AI 可一次返回多个命令按序执行，单个失败不阻塞后续。

> AI can return multiple commands in one response, executed in sequence. A single failure does not block subsequent commands.

### 3.13 iframe 内元素操作 / iframe Element Interaction

AI 可以操作 iframe 内部的元素（如嵌入的编辑器、表单等），通过脚本注入实现跨框架交互。

> AI can interact with elements inside iframes (e.g., embedded editors, forms) via script injection for cross-frame interaction.

---

## 4. 🎤 语音控制 / Voice Control

### 4.1 开启 / Getting Started

点击输入框左侧 🎙️ 图标 → 语音面板 → 点击大麦克风按钮开始。

> Click the 🎙️ icon to the left of the input box → Voice panel → Click the large microphone button to start.

### 4.2 识别引擎 / Recognition Engines

| 引擎 / Engine | 类型 / Type | 特点 / Features |
|------|------|------|
| Sherpa-ONNX（优先 / Preferred） | 本地离线 / Local offline | 无需网络，中英双语 / No internet needed, bilingual |
| Web Speech API（备选 / Fallback） | 在线 / Online | 浏览器原生 / Browser native |

### 4.3 状态指示 / Status Indicators

| 状态 / Status | 颜色 / Color | 文字 / Text |
|------|------|------|
| 空闲 / Idle | 灰色 / Gray | "点击麦克风开始" / "Click mic to start" |
| 聆听 / Listening | 绿色脉冲 / Green pulse | "正在聆听..." / "Listening..." |
| 处理 / Processing | 主题色脉冲 / Theme pulse | "处理中..." / "Processing..." |
| 播报 / Speaking | 紫色脉冲 / Purple pulse | "播报中..." / "Speaking..." |

播报完成后自动回到聆听，无需重复点击。

> Automatically returns to listening after speaking — no need to click again.

### 4.4 语音消息类型 / Voice Message Types

- 🗣️ 你 / You — 右对齐，主题色背景 / Right-aligned, theme background
- 🤖 AI — 左对齐，卡片背景 / Left-aligned, card background
- ℹ️ 系统 / System — 居中，小字灰色 / Centered, small gray text
- ✅ 操作成功 / Success / ❌ 操作失败 / Failed

> **💡 试试这样说：**
>
> - "打开百度"
> - "搜索 AI 新闻"
> - "在站内搜索 Vue 教程"
> - "打开第三个"
> - "下一页" / "上一页"
> - "播放视频" / "暂停视频"
> - "今天天气怎么样"

> **💡 Try saying:**
>
> - "Open Baidu"
> - "Search for AI news"
> - "Search for Vue tutorials on this site"
> - "Open the third one"
> - "Next page" / "Previous page"
> - "Play video" / "Pause video"
> - "What's the weather today"

> **注意：** 关闭自动化后变为纯聊天模式。支持单次语音输入多条命令。
> **Note:** Disabling automation switches to pure chat mode. Multiple commands in a single voice input are supported.

---

## 5. 🌍 智能翻译 / Smart Translation

### 5.1 翻译模式 / Translation Modes

| 模式 / Mode | 适合场景 / Best for |
|------|----------|
| 划词翻译 / Selection | 偶尔查词 / Occasional word lookup |
| 自动翻译 / Auto | 整页阅读 / Full page reading |
| 点击翻译 / Click | 按需翻译段落 / On-demand paragraph translation |
| 关闭 / Off | 不需要翻译 / No translation needed |

在设置 → 通用配置 → 翻译模式中选择。

> Configure in Settings → General → Translation Mode.

### 5.2 划词翻译 / Selection Translation

选中文字 → 自动弹出浮窗 → 显示译文 → 复制按钮 → 点击外部关闭。

> Select text → popup appears automatically → shows translation → copy button → click outside to close.

### 5.3 自动翻译 / Auto Translation

所有可见文本自动翻译，相同文本只翻译一次，`<code>` 元素保留不翻译，动态加载内容也自动翻译。翻译过程中显示加载动画，关闭自动翻译后所有译文自动恢复原文。

> All visible text is auto-translated; identical text is translated only once; `<code>` elements are preserved; dynamically loaded content is also translated. A loading spinner shows during translation. Disabling auto-translate restores all original text.

### 5.4 点击翻译 / Click Translation

点击段落翻译，再次点击恢复原文，第三次显示译文。支持段落、列表、表格、标题等。点击表格行翻译整个表格。

> Click a paragraph to translate, click again to restore, click a third time to show translation again. Supports paragraphs, lists, tables, headings, etc. Click a table row to translate the entire table.

### 5.5 目标语言（8 种）/ Target Languages (8)

中文、English、日本語、한국어、Français、Deutsch、Español、Русский

### 5.6 代码保护 / Code Protection

`<pre>`/`<code>`/`<samp>` 整体跳过；含 `hljs`、`language-` 等类名的元素跳过；行内代码替换为占位符后恢复。

> `<pre>`/`<code>`/`<samp>` elements are skipped entirely; elements with `hljs`, `language-` classes are skipped; inline code is replaced with placeholders and restored after translation.

---

## 6. 📎 文件处理 / File Processing

### 6.1 上传方式 / Upload Methods

📎 回形针图标上传（多选） · 粘贴图片 · 粘贴 URL · 粘贴本地路径

> 📎 Paperclip icon (multi-select) · Paste image · Paste URL · Paste local path

### 6.2 图片 OCR / Image OCR

自动识别中英文，进度条显示，30 秒超时。结果随消息发送给 AI。

> Auto-recognizes Chinese and English text with a progress bar, 30-second timeout. Results are sent with the message to AI.

> **💡 试试这样说：**
>
> - （上传截图后）"提取图片中的文字"
> - （上传截图后）"把图片里的英文翻译成中文"

> **💡 Try saying:**
>
> - (After uploading a screenshot) "Extract text from this image"
> - (After uploading a screenshot) "Translate the English in this image to Chinese"

### 6.3 文件预览 / File Preview

点击附件打开预览：图片全尺寸、代码语法高亮（60+ 语言）、Markdown 渲染、PDF/Word 提取文本。Escape 或遮罩关闭。

> Click an attachment to preview: full-size images, syntax-highlighted code (60+ languages), Markdown rendering, PDF/Word text extraction. Close with Escape or click the overlay.

### 6.4 文件下载 / File Download

智能格式处理：优先原始文件，否则重新生成（xlsx/docx/pdf/txt）。支持 30+ 种文本格式的下载重建。

> Smart format handling: prefers original file, otherwise regenerates (xlsx/docx/pdf/txt). Supports 30+ text format extensions for download reconstruction.

---

## 7. 📊 图表生成与文件输出 / Charts & File Output

### 7.1 AI 生成文件 / AI File Generation

AI 通过 `[FILE]` 标签嵌入可下载文件：文本、CSV、Excel、JSON、PDF、图表。

> AI embeds downloadable files via `[FILE]` tags: text, CSV, Excel, JSON, PDF, charts.

> **💡 试试这样说：**
>
> - "给我生成一份 Vue3 学习笔记的 Markdown 文件"
> - "把分析结果保存为 Excel 表格"
> - "生成一份 PDF 格式的项目报告"
> - "输出一份 JSON 格式的配置文件"

> **💡 Try saying:**
>
> - "Generate a Markdown file of Vue3 learning notes"
> - "Save the analysis results as an Excel spreadsheet"
> - "Generate a project report in PDF format"
> - "Output a JSON configuration file"

### 7.2 图表类型 / Chart Types

柱状图 · 折线图 · 饼图（实心/环形） · 雷达图

> Bar chart · Line chart · Pie chart (solid/doughnut) · Radar chart

> **💡 试试这样说：**
>
> - "用柱状图展示各季度销售额：Q1 120万，Q2 150万，Q3 180万，Q4 200万"
> - "画一个饼图展示市场份额：A公司35%，B公司25%，C公司20%，D公司20%"
> - "用折线图展示最近7天的气温变化"

> **💡 Try saying:**
>
> - "Show quarterly sales in a bar chart: Q1 1.2M, Q2 1.5M, Q3 1.8M, Q4 2M"
> - "Draw a pie chart for market share: Company A 35%, B 25%, C 20%, D 20%"
> - "Plot a line chart of the last 7 days' temperature"

### 7.3 图表操作 / Chart Operations

- **下载 PNG** — 2 倍分辨率 / 2x resolution
- **下载 JSON** — 可重新导入 / Re-importable ECharts config

---

## 8. ⚙️ 设置说明 / Settings

点击侧边栏右上角 ⚙️ 齿轮图标打开设置。

> Click the ⚙️ gear icon in the top-right corner of the sidebar to open settings.

### 8.1 模型配置 / Model Configuration

- 添加/编辑/删除模型 / Add/edit/delete models
- 10 个一键预设 / 10 one-click presets
- API Key 显示/隐藏切换 / Show/hide API Key toggle
- 导出/导入配置（JSON，可团队共享）/ Export/import config (JSON, team-shareable)
- 4 种认证方式：Bearer Token、API Key、Access Token、Authorization Header
- 每个模型可单独配置 API 地址和 Key / Each model has its own API URL and Key

### 8.2 通用配置 / General Settings

| 设置项 / Setting | 说明 / Description |
|--------|------|
| 主题选择 / Theme | 10 款主题，点击即时切换 / 10 themes, instant switch |
| 快捷键录制 / Shortcut | 自定义打开侧边栏的快捷键 / Customize sidebar shortcut |
| 网页自动化开关 / Automation | 开启/关闭 AI 网页操作（切换时确认对话框）/ Toggle AI web operations (confirm dialog) |
| 选中文字操作 / Selection action | 自动发送 / 手动发送 / 关闭 / Auto / Manual / Off |
| 翻译目标语言 / Translate target | 8 种语言下拉选择 / 8 languages dropdown |
| 翻译模式 / Translate mode | 划词 / 自动 / 点击 / 关闭 / Selection / Auto / Click / Off |

### 8.3 用户配置 / User Settings

| 设置项 / Setting | 说明 / Description |
|--------|------|
| 上下文消息数 / Context messages | 100-500（默认 100）/ 100-500 (default 100) |
| 缓存管理 / Cache management | 使用量显示 + 清除按钮（上限 30MB）/ Usage bar + clear button (30MB limit) |
| 语言切换 / Language | 中文 / English |
| 使用文档 / Documentation | 内置 Markdown 文档查看器 / Built-in Markdown doc viewer |
| 版本信息 / Version | 当前版本号 / Current version number |

清除缓存：清除会话/日志/历史，保留模型配置/主题/快捷键等个性化配置。

> Clear cache: removes sessions/logs/history, preserves model configs/themes/shortcuts and other personalized settings.

---

## 9. 🎨 主题 / Themes

### 深色（5 款）/ Dark (5)

| 主题 / Theme | 主色调 / Accent | 风格 / Style |
|------|--------|------|
| 赛博朋克 / Cyberpunk | `#00e5ff` 青色 / Cyan | 科技感 / Tech |
| 暗金 / Obsidian Gold | `#d4a853` 金色 / Gold | 奢华 / Luxe |
| 紫晶 / Purple Haze | `#a855f7` 紫色 / Purple | 梦幻 / Dreamy |
| 午夜 / Midnight | `#0090FF` 蓝色 / Blue | 沉稳 / Calm |
| 翡翠 / Emerald | `#10b981` 绿色 / Green | 清新 / Fresh |

### 浅色（5 款）/ Light (5)

| 主题 / Theme | 主色调 / Accent | 风格 / Style |
|------|--------|------|
| 经典 / Classic | `#4f46e5` 靛蓝 / Indigo | 默认 / Default |
| 玫瑰金 / Rose Gold | `#b76e79` 玫瑰色 / Rose | 优雅 / Elegant |
| 樱花 / Sakura | `#db2777` 粉色 / Pink | 柔美 / Soft |
| 珍珠 / Pearl | `#b8860b` 暗金色 / Dark Gold | 典雅 / Classy |
| 晴空 / Lavender | `#0ea5e9` 天蓝色 / Sky Blue | 明朗 / Bright |

设置 → 通用配置 → 主题网格点击切换，即时生效。

> Settings → General → click a theme in the grid to switch instantly.

---

## 10. ⌨️ 快捷命令 / Quick Commands

### 命令选择器 / Command Selector

输入 `/` → 弹出菜单 → ↑↓ 导航 → Tab/Enter 选中 → Escape 关闭

> Type `/` → menu appears → ↑↓ to navigate → Tab/Enter to select → Escape to close

> **注意：** 仅在「网页自动化」开启时可用。
> **Note:** Only available when "Web Automation" is enabled.

### 键盘快捷键 / Keyboard Shortcuts

| 快捷键 / Shortcut | 说明 / Description |
|--------|------|
| `Ctrl+`` ` | 打开/关闭侧边栏 / Toggle sidebar |
| `Enter` | 发送消息 / Send message |
| `Shift+Enter` | 换行 / New line |
| `↑`（空输入框 / empty input） | 浏览输入历史 / Browse input history |
| `↓`（历史模式 / history mode） | 前进到更新历史 / Forward to newer history |
| `Escape` | 关闭菜单/预览 / Close menu/preview |

---

## 11. 💡 使用技巧 / Tips

### 对话效率 / Chat Efficiency

- **指令越明确越好** — "点击登录按钮" 比 "帮我操作" 效果好
- **复杂任务拆分多步** — 分步执行更可靠
- **利用上下文** — "接着刚才的继续"
- **中断重来** — 点停止按钮，重新描述

> - **Be specific** — "Click the login button" works better than "help me with this"
> - **Break complex tasks into steps** — step-by-step execution is more reliable
> - **Use context** — "Continue from where we left off"
> - **Interrupt and retry** — click Stop, then re-describe

### 文件处理 / File Processing

- **OCR + 翻译** — 上传截图要求"提取文字并翻译成英文"
- **PDF 分析** — 上传 PDF 要求"总结要点"
- **代码审查** — 上传代码要求"检查问题并给出改进建议"

> - **OCR + Translate** — upload a screenshot and ask "extract text and translate to English"
> - **PDF analysis** — upload a PDF and ask "summarize the key points"
> - **Code review** — upload code and ask "review this code and suggest improvements"

### 翻译 / Translation

- **划词翻译**适合偶尔查词，**自动翻译**适合整页阅读
- **点击翻译**最轻量，按需翻译不干扰阅读

> - **Selection translate** is best for occasional lookups; **Auto translate** for full-page reading
> - **Click translate** is lightest — on-demand without disrupting reading

### 设置 / Settings

- **模型导入导出** — 团队共享配置
- **上下文 100-200** — 日常对话足够
- **缓存管理** — 定期清理保持流畅（上限 30MB）

> - **Model import/export** — share configs with your team
> - **Context 100-200** — sufficient for daily conversations
> - **Cache management** — clean regularly to keep things smooth (30MB limit)

---

## 12. ❓ 常见问题 / FAQ

**Q: 打开侧边栏没反应？** 检查是否配置了模型、API Key 是否正确、网络是否正常。
**Q: Sidebar doesn't open?** Check if a model is configured, API Key is correct, and network is available.

**Q: AI 回复很慢？** 减少上下文消息数、切换更快模型、检查网络。
**Q: AI replies are slow?** Reduce context messages, switch to a faster model, check your network.

**Q: 自动化无法点击？** 元素可能在 iframe 中或被遮挡，用更精确的描述重试。
**Q: Automation can't click?** The element may be in an iframe or obscured. Retry with a more precise description.

**Q: 语音识别不准？** 确保麦克风权限、安静环境、说话清晰。
**Q: Voice recognition is inaccurate?** Ensure microphone permission, quiet environment, and clear speech.

**Q: 文件上传失败？** 检查大小限制：图片 20MB、文本 2MB、PDF/Office 10MB。
**Q: File upload failed?** Check size limits: images 20MB, text 2MB, PDF/Office 10MB.

**Q: 怎么切换模型？** 点击输入框下方的模型名称药丸。
**Q: How to switch models?** Click the model name pill below the input box.

**Q: 怎么调侧边栏宽度？** 拖动左边缘手柄。
**Q: How to resize the sidebar?** Drag the left edge handle.

**Q: 怎么备份配置？** 设置 → 模型配置 → 导出。
**Q: How to backup settings?** Settings → Model Config → Export.

**Q: 清除缓存丢失什么？** 清除会话/日志/历史，保留个性化配置。
**Q: What does clearing cache remove?** Sessions/logs/history only; personalized settings are preserved.

**Q: 浮动按钮挡内容？** 拖到其他位置，自动保存。
**Q: Floating button blocks content?** Drag it elsewhere — position is auto-saved.

**Q: 命令选择器不弹出？** 确保自动化开关已开启，输入以 `/` 开头。
**Q: Command selector doesn't appear?** Ensure automation is enabled and type `/` to trigger.

---

> **小灵 LingBot** v1.4.1 | MIT License
