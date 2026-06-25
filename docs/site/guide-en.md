# LingBot User Guide

> AI Voice Browser Assistant

**Version:** v1.4.1 | **License:** MIT

---

## Table of Contents

1. [🚀 Quick Start](#1--quick-start)
2. [💬 AI Chat](#2--ai-chat)
3. [🌐 Web Automation](#3--web-automation)
4. [🎤 Voice Control](#4--voice-control)
5. [🌍 Smart Translation](#5--smart-translation)
6. [📎 File Processing](#6--file-processing)
7. [📊 Charts & File Output](#7--charts--file-output)
8. [⚙️ Settings](#8-️-settings)
9. [🎨 Themes](#9--themes)
10. [⌨️ Quick Commands](#10-️-quick-commands)
11. [💡 Tips](#11--tips)
12. [❓ FAQ](#12--faq)

---

## 1. 🚀 Quick Start

📸 Screenshot: [Extension installation and initial setup flow]

### 1.1 Installation

1. Download the latest CRX package
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the extracted folder
5. The toolbar icon and a floating button will appear after installation

### 1.2 Initial Model Setup

1. Click the floating button or press `Ctrl+`` ` to open the sidebar
2. Click the ⚙️ gear icon in the top-right corner
3. In the "AI" tab, click "New Model"
4. Click a provider preset button (e.g., DeepSeek) to auto-fill
5. Enter your API Key and click "Save"

> **Tip:** 10 one-click presets available: OpenAI, Anthropic, DeepSeek, MiMo, Qwen, Kimi, Zhipu, Baidu, MiniMax, SiliconFlow.

### 1.3 Opening the Sidebar

| Method | Action | Description |
|------|------|------|
| Toolbar icon | Click the browser toolbar icon | Most common |
| Shortcut | `Ctrl+`` ` | Customizable |
| Floating button | Click the floating button at bottom-right | Available on any page |

> **Note:** Sidebar state is synced across all tabs.

### 1.4 Floating Button

- **Click** — Toggle sidebar
- **Drag** — Drag to any position (3px threshold)
- **Position memory** — Auto-saved, persists across refresh

### 1.5 Resize Sidebar

Drag the left edge handle of the sidebar (min 60px, max 95% viewport width). Width is auto-synced across all tabs.

---

## 2. 💬 AI Chat

📸 Screenshot: [AI chat interface with model selector and message thread]

### 2.1 Supported AI Providers (11)

| Provider | Models |
|--------|----------|
| OpenAI | GPT-4o, GPT-4, GPT-3.5 |
| Anthropic | Claude 3.5 Sonnet, Claude 4 |
| Google Gemini | Gemini 1.5 Pro, Gemini 2.0 |
| DeepSeek | DeepSeek-V3, DeepSeek-R1 |
| MiMo | MiMo-v2.5-pro |
| Qwen | Qwen-Max, Qwen-Plus |
| Kimi (Moonshot) | Moonshot-v1-128k |
| Zhipu (ChatGLM) | GLM-4 |
| Wenxin | ERNIE-4.0 |
| MiniMax | MiniMax-Text |
| SiliconFlow | Various models |
| Doubao | Doubao-pro |
| Grok | Grok-2 |
| Custom | Any OpenAI-compatible API |

### 2.2 Sending Messages

Type your message and press **Enter** to send, **Shift+Enter** for a new line. AI responses stream in real-time; click ⏹ to stop.

> **💡 Try saying:**
>
> - "Hello, introduce yourself"
> - "Help me write a leave request email"
> - "Write a quicksort in Python"
> - "Explain what quantum computing is"

### 2.3 Switching Models

Click the **model name pill** below the input box → select from the dropdown → switch instantly. Each conversation uses its own model independently.

### 2.4 Deep Thinking Mode

Click the 💡 lightbulb icon to enable (only for reasoning-capable models like DeepSeek-R1, Claude 3.7+). AI will show a collapsible "💭 Deep Thinking" block first.

> **💡 Try saying:**
>
> - "Analyze the pros and cons of React and Vue in depth"
> - "Design an e-commerce system architecture with detailed thinking"

### 2.5 File Attachments

| Method | Action |
|------|------|
| Click upload | 📎 Paperclip icon, multi-select supported |
| Paste image | Paste screenshots directly |
| Paste URL | Auto-fetches page content |
| Paste local path | e.g. `C:\Users\...\file.txt` |

**Supported Formats:**

| Type | Formats | Limit | Processing |
|------|------|------|------|
| Image | jpg, png, gif, webp, bmp, svg | 20 MB | Auto OCR |
| Text | txt, log, csv, tsv, etc. | 2 MB | Direct read |
| Code | js, ts, py, etc. 60+ types | 2 MB | Language detection |
| PDF | pdf | 10 MB | Page-by-page extraction |
| Word | doc, docx | 10 MB | Text extraction |
| Excel | xls, xlsx, csv, tsv | 10 MB | Export CSV |

> **Note:** Scanned PDFs (image-only) will show a warning. Multi-sheet Excel files are labeled per sheet.

> **💡 Try saying:**
>
> - (After uploading a screenshot) "Extract the text from this image and translate it to English"
> - (After uploading a PDF) "Summarize the key points of this document"
> - (After uploading code) "Review this code and suggest improvements"

### 2.6 Auto-send Selected Text

| Mode | Behavior |
|------|------|
| **Auto** (default) | Send directly to AI |
| **Manual** | Fill input box, confirm manually |
| **Off** | No action |

### 2.7 Message Management

| Action | Method |
|------|------|
| Clear chat | Header 🗑️ icon |
| Delete one | Right-click → Delete |
| Copy | Right-click → Copy |
| Bookmark | Right-click → Bookmark |
| Stop reply | ⏹ Stop button |
| Scroll to bottom | ⬇ Floating button |

> **💡 Try this:** Right-click any AI reply → select "Bookmark" to save the message to local storage.

### 2.8 Message Content Interaction

- **Code blocks** — Copy button with 1.5s feedback
- **Tables** — Download button (Excel export)
- **Deep thinking** — Collapsible block
- **Errors** — Red banner; Aborted — Yellow banner

### 2.9 Input History

Press **↑** in an empty input to browse history (up to 100 entries), **↓** to go forward.

### 2.10 Context Management

Default context window is 100 messages, adjustable in settings (100-500).

### 2.11 Interactive AI Input

AI can pause during task execution to request user input, then continue after receiving the information. No need to re-describe the task.

---

## 3. 🌐 Web Automation

📸 Screenshot: [Web automation commands and natural language page interaction]

### 3.1 How It Works

AI analyzes page structure → generates action commands → executes step by step → auto-retries on error (max 5 times) → max 20 steps.

### 3.2 Natural Language Operations

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

### 3.3 Quick Commands (Instant)

| Command | Description | Example |
|------|------|------|
| `/navigate` | Open URL | `/navigate https://github.com` |
| `/scroll` | Scroll | `/scroll down`, `/scroll auto` |
| `/newTab` | New tab | `/newTab` |
| `/closeTab` | Close tab | `/closeTab` |
| `/nextTab` / `/prevTab` | Switch tab | `/nextTab` |
| `/switchTab` | Switch by keyword | `/switchTab github` |
| `/keyboard` | Simulate key | `/keyboard Enter` |
| `/wait` | Wait | `/wait 2000` |

### 3.4 Page Action Commands

| Command | Description | Example |
|------|------|------|
| `/search` | Web search | `/search AI news` |
| `/click` | Click element | `/click login button` |
| `/type` | Type text | `/type search box hello world` |
| `/clear` | Clear input | `/clear search box` |
| `/select` | Select dropdown | `/select country USA` |
| `/focus` | Focus element | `/focus email input` |
| `/hover` | Hover element | `/hover menu item` |
| `/download` | Extract & export | `/download` |
| `/summarize` | Summarize page | `/summarize` |

### 3.5 Control Commands

| Command | Description |
|------|------|
| `/stop` | Stop current operation |
| `/pause` | Pause |
| `/resume` | Resume |

### 3.6 Scroll Control

| Direction | Description | Example |
|------|------|------|
| `up` / `down` | Scroll 80% viewport | `/scroll down` |
| `top` / `bottom` | To top/bottom | `/scroll top` |
| `auto` | Auto continuous scroll | `/scroll auto` |
| `stop` / `pause` / `resume` | Control auto scroll | `/scroll pause` |

Auto-scroll features: persists across page refresh, scroll wheel up pauses / down resumes, stops automatically at page bottom.

### 3.7 Video Control

> **💡 Try saying:**
>
> - "Play video" / "Pause video"
> - "Set volume to 50%"
> - "Mute" / "Unmute"
> - "Forward 30 seconds" / "Back 10 seconds"
> - "Jump to 2 minutes"
> - "Play at 2x speed"

> **Note:** Fullscreen requires user gesture and cannot be triggered by AI.

### 3.8 Tab Management

> **💡 Try saying:**
>
> - "Open a new tab"
> - "Close the current tab"
> - "Switch to Bilibili"
> - "Switch to the GitHub tab"

Supports Chinese aliases: B站→bilibili.com, 淘宝→taobao.com, 京东→jd.com, 百度→baidu.com, 知乎→zhihu.com, etc.

### 3.9 Data Extraction & Page Summary

Page summary uses a 3-layer progressive analysis framework, outputting structured Markdown that can be bookmarked as notes:

- **Layer 1 · Extract** — Identify page topic, content type, target audience
- **Layer 2 · Analyze** — Break down key arguments, data evidence, logical flow
- **Layer 3 · Insight** — Deep insights, blind spots, action recommendations

> **💡 Try saying:**
>
> - "Summarize this page"
> - "Analyze the key points of this technical article"
> - "Extract all links from this page"
> - "Organize the product info on this page into a table"
> - "Download this page's data as Excel"

### 3.10 Rich Editor Support

AI can automatically detect and type into these rich editors: CodeMirror 5/6, Monaco Editor, Ace Editor, Quill, TinyMCE, CKEditor, ProseMirror/TipTap, Draft.js, WangEditor, and generic contenteditable elements.

### 3.11 Cross-tab Task Recovery

Progress is auto-saved on page navigation and restored on the new page (30-second expiry protection).

### 3.12 Batch Commands

AI can return multiple commands in one response, executed in sequence. A single failure does not block subsequent commands.

### 3.13 iframe Element Interaction

AI can interact with elements inside iframes (e.g., embedded editors, forms) via script injection for cross-frame interaction.

---

## 4. 🎤 Voice Control

📸 Screenshot: [Voice control panel with microphone button and status indicators]

### 4.1 Getting Started

Click the 🎙️ icon to the left of the input box → Voice panel → Click the large microphone button to start.

### 4.2 Recognition Engines

| Engine | Type | Features |
|------|------|------|
| Sherpa-ONNX (Preferred) | Local offline | No internet needed, bilingual |
| Web Speech API (Fallback) | Online | Browser native |

### 4.3 Status Indicators

| Status | Color | Text |
|------|------|------|
| Idle | Gray | "Click mic to start" |
| Listening | Green pulse | "Listening..." |
| Processing | Theme pulse | "Processing..." |
| Speaking | Purple pulse | "Speaking..." |

Automatically returns to listening after speaking — no need to click again.

### 4.4 Voice Message Types

- 🗣️ You — Right-aligned, theme background
- 🤖 AI — Left-aligned, card background
- ℹ️ System — Centered, small gray text
- ✅ Success / ❌ Failed

> **💡 Try saying:**
>
> - "Open Baidu"
> - "Search for AI news"
> - "Search for Vue tutorials on this site"
> - "Open the third one"
> - "Next page" / "Previous page"
> - "Play video" / "Pause video"
> - "What's the weather today"

> **Note:** Disabling automation switches to pure chat mode. Multiple commands in a single voice input are supported.

---

## 5. 🌍 Smart Translation

📸 Screenshot: [Translation modes selection and popup translation example]

### 5.1 Translation Modes

| Mode | Best for |
|------|----------|
| Selection | Occasional word lookup |
| Auto | Full page reading |
| Click | On-demand paragraph translation |
| Off | No translation needed |

Configure in Settings → General → Translation Mode.

### 5.2 Selection Translation

Select text → popup appears automatically → shows translation → copy button → click outside to close.

### 5.3 Auto Translation

All visible text is auto-translated; identical text is translated only once; `<code>` elements are preserved; dynamically loaded content is also translated. A loading spinner shows during translation. Disabling auto-translate restores all original text.

### 5.4 Click Translation

Click a paragraph to translate, click again to restore, click a third time to show translation again. Supports paragraphs, lists, tables, headings, etc. Click a table row to translate the entire table.

### 5.5 Target Languages (8)

中文、English、日本語、한국어、Français、Deutsch、Español、Русский

### 5.6 Code Protection

`<pre>`/`<code>`/`<samp>` elements are skipped entirely; elements with `hljs`, `language-` classes are skipped; inline code is replaced with placeholders and restored after translation.

---

## 6. 📎 File Processing

📸 Screenshot: [File upload interface and preview panel]

### 6.1 Upload Methods

📎 Paperclip icon (multi-select) · Paste image · Paste URL · Paste local path

### 6.2 Image OCR

Auto-recognizes Chinese and English text with a progress bar, 30-second timeout. Results are sent with the message to AI.

> **💡 Try saying:**
>
> - (After uploading a screenshot) "Extract text from this image"
> - (After uploading a screenshot) "Translate the English in this image to Chinese"

### 6.3 File Preview

Click an attachment to preview: full-size images, syntax-highlighted code (60+ languages), Markdown rendering, PDF/Word text extraction. Close with Escape or click the overlay.

### 6.4 File Download

Smart format handling: prefers original file, otherwise regenerates (xlsx/docx/pdf/txt). Supports 30+ text format extensions for download reconstruction.

---

## 7. 📊 Charts & File Output

📸 Screenshot: [Chart types and AI-generated file download examples]

### 7.1 AI File Generation

AI embeds downloadable files via `[FILE]` tags: text, CSV, Excel, JSON, PDF, charts.

> **💡 Try saying:**
>
> - "Generate a Markdown file of Vue3 learning notes"
> - "Save the analysis results as an Excel spreadsheet"
> - "Generate a project report in PDF format"
> - "Output a JSON configuration file"

### 7.2 Chart Types

Bar chart · Line chart · Pie chart (solid/doughnut) · Radar chart

> **💡 Try saying:**
>
> - "Show quarterly sales in a bar chart: Q1 1.2M, Q2 1.5M, Q3 1.8M, Q4 2M"
> - "Draw a pie chart for market share: Company A 35%, B 25%, C 20%, D 20%"
> - "Plot a line chart of the last 7 days' temperature"

### 7.3 Chart Operations

- **Download PNG** — 2x resolution
- **Download JSON** — Re-importable ECharts config

---

## 8. ⚙️ Settings

📸 Screenshot: [Settings panel with model configuration and general options]

Click the ⚙️ gear icon in the top-right corner of the sidebar to open settings.

### 8.1 Model Configuration

- Add/edit/delete models
- 10 one-click presets
- Show/hide API Key toggle
- Export/import config (JSON, team-shareable)
- 4 authentication methods: Bearer Token, API Key, Access Token, Authorization Header
- Each model has its own API URL and Key

### 8.2 General Settings

| Setting | Description |
|--------|------|
| Theme | 10 themes, instant switch |
| Shortcut | Customize sidebar shortcut |
| Automation | Toggle AI web operations (confirm dialog) |
| Selection action | Auto / Manual / Off |
| Translate target | 8 languages dropdown |
| Translate mode | Selection / Auto / Click / Off |

### 8.3 User Settings

| Setting | Description |
|--------|------|
| Context messages | 100-500 (default 100) |
| Cache management | Usage bar + clear button (30MB limit) |
| Language | 中文 / English |
| Documentation | Built-in Markdown doc viewer |
| Version | Current version number |

Clear cache: removes sessions/logs/history, preserves model configs/themes/shortcuts and other personalized settings.

---

## 9. 🎨 Themes

📸 Screenshot: [Theme grid showing dark and light theme options]

### Dark (5)

| Theme | Accent | Style |
|------|--------|------|
| Cyberpunk | `#00e5ff` Cyan | Tech |
| Obsidian Gold | `#d4a853` Gold | Luxe |
| Purple Haze | `#a855f7` Purple | Dreamy |
| Midnight | `#0090FF` Blue | Calm |
| Emerald | `#10b981` Green | Fresh |

### Light (5)

| Theme | Accent | Style |
|------|--------|------|
| Classic | `#4f46e5` Indigo | Default |
| Rose Gold | `#b76e79` Rose | Elegant |
| Sakura | `#db2777` Pink | Soft |
| Pearl | `#b8860b` Dark Gold | Classy |
| Lavender | `#0ea5e9` Sky Blue | Bright |

Settings → General → click a theme in the grid to switch instantly.

---

## 10. ⌨️ Quick Commands

📸 Screenshot: [Command selector popup and keyboard shortcut reference]

### Command Selector

Type `/` → menu appears → ↑↓ to navigate → Tab/Enter to select → Escape to close

> **Note:** Only available when "Web Automation" is enabled.

### Keyboard Shortcuts

| Shortcut | Description |
|--------|------|
| `Ctrl+`` ` | Toggle sidebar |
| `Enter` | Send message |
| `Shift+Enter` | New line |
| `↑` (empty input) | Browse input history |
| `↓` (history mode) | Forward to newer history |
| `Escape` | Close menu/preview |

---

## 11. 💡 Tips

📸 Screenshot: [Tips and best practices overview]

### Chat Efficiency

- **Be specific** — "Click the login button" works better than "help me with this"
- **Break complex tasks into steps** — step-by-step execution is more reliable
- **Use context** — "Continue from where we left off"
- **Interrupt and retry** — click Stop, then re-describe

### File Processing

- **OCR + Translate** — upload a screenshot and ask "extract text and translate to English"
- **PDF analysis** — upload a PDF and ask "summarize the key points"
- **Code review** — upload code and ask "review this code and suggest improvements"

### Translation

- **Selection translate** is best for occasional lookups; **Auto translate** for full-page reading
- **Click translate** is lightest — on-demand without disrupting reading

### Settings

- **Model import/export** — share configs with your team
- **Context 100-200** — sufficient for daily conversations
- **Cache management** — clean regularly to keep things smooth (30MB limit)

---

## 12. ❓ FAQ

📸 Screenshot: [FAQ section with expandable question cards]

**Q: Sidebar doesn't open?** Check if a model is configured, API Key is correct, and network is available.

**Q: AI replies are slow?** Reduce context messages, switch to a faster model, check your network.

**Q: Automation can't click?** The element may be in an iframe or obscured. Retry with a more precise description.

**Q: Voice recognition is inaccurate?** Ensure microphone permission, quiet environment, and clear speech.

**Q: File upload failed?** Check size limits: images 20MB, text 2MB, PDF/Office 10MB.

**Q: How to switch models?** Click the model name pill below the input box.

**Q: How to resize the sidebar?** Drag the left edge handle.

**Q: How to backup settings?** Settings → Model Config → Export.

**Q: What does clearing cache remove?** Sessions/logs/history only; personalized settings are preserved.

**Q: Floating button blocks content?** Drag it elsewhere — position is auto-saved.

**Q: Command selector doesn't appear?** Ensure automation is enabled and type `/` to trigger.

---

> **LingBot** v1.4.1 | MIT License
