# LingBot User Guide

> AI Voice Browser Assistant

**Version:** v1.8.3 | **License:** MIT

---

## Table of Contents

1. [🚀 Quick Start](#1--quick-start)
2. [💬 AI Chat](#2--ai-chat)
3. [🌐 Web Automation](#3--web-automation)
4. [🎤 Voice Control](#4--voice-control)
5. [🌍 Smart Translation](#5--smart-translation)
6. [📎 File Processing](#6--file-processing)
7. [📊 Charts & File Output](#7--charts--file-output)
8. [📝 Notes & Bookmarks](#8--notes--bookmarks)
9. [⚙️ Settings](#9-️-settings)
10. [🎨 Themes](#10--themes)
11. [⌨️ Quick Commands](#11-️-quick-commands)
12. [💡 Tips](#12--tips)
13. [❓ FAQ](#13--faq)

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

### 2.1 Supported AI Providers (14)

| Provider | Models |
|--------|----------|
| OpenAI | GPT-4o, GPT-4, GPT-3.5 |
| Anthropic | Claude Sonnet 4, Claude 3.5 Sonnet |
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
| Image | jpg, png, gif, webp, bmp, svg | 20 MB | Auto OCR (with progress bar) |
| Text | txt, log, csv, tsv, etc. | 2 MB | Direct read |
| Code | js, ts, py, etc. 60+ types | 2 MB | Language detection |
| PDF | pdf | 10 MB | Page-by-page extraction |
| Word | doc, docx | 10 MB | Text extraction |
| Excel | xls, xlsx, csv, tsv | 10 MB | Export CSV |

> **Note:** Scanned PDFs (image-only) will show a warning. Multi-sheet Excel files are labeled per sheet. Image attachments show an OCR progress bar.

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
| Bookmark as note | Right-click → Bookmark (choose title to archive) |
| Stop reply | ⏹ Stop button |
| Scroll to bottom | ⬇ Floating button |

### 2.8 Message Content Interaction

- **Code blocks** — Copy button with 1.5s feedback and language label
- **Tables** — Download button (Excel export)
- **Deep thinking** — Collapsible block
- **Errors** — Red banner; Aborted — Yellow banner
- **Math formulas** — LaTeX rendering support

### 2.9 Input History

Press **↑** in an empty input to browse history (up to 100 entries), **↓** to go forward.

### 2.10 Context Management

Default context window is 100 messages, adjustable in settings (100-500).

### 2.11 Interactive AI Input

AI can pause during task execution to request user input (passwords, verification codes, etc.), then continue after receiving the information. No need to re-describe the task. The input bar shows the AI's prompt text.

> **💡 Try saying:**
>
> - "Help me log in, username admin, password 123456"
> - AI will automatically ask for missing information during execution

### 2.12 Voice Mode Toggle

Click the 🎙️ icon to the left of the input box to switch to voice mode. The voice panel replaces the chat panel. Click the back arrow to return to text mode. Voice mode state persists across pages.

### 2.13 AI Action Feedback

When AI executes web operations, real-time feedback appears in the chat:

- `🔧 Executing instruction N: action description` — Starting execution
- `✅ Action succeeded — details` — Execution succeeded
- `❌ Action failed — error reason` — Execution failed
- `🔄 Retrying instruction N (5/50)` — Retrying after failure
- `⏹ Stopped` — User interrupted

---

## 3. 🌐 Web Automation

📸 Screenshot: [Web automation commands and natural language page interaction]

### 3.1 How It Works

AI analyzes page structure → generates action commands → executes step by step → auto-retries on error (max 50 steps) → up to 20 batch commands.

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
| `/upload` | Upload file | Upload file to file input |
| `/slider` | Drag slider | Drag slider to a specific value |
| `/closeModal` | Close modal | Auto-close page modals/dialogs |
| `/download` | Extract & export | `/download` |
| `/summarize` | Summarize page | `/summarize` |
| `/translate` | Translate page | Translate current page content |
| `/note` | Generate note | Generate AI note from page content |

### 3.5 Control Commands

| Command | Description |
|------|------|
| `/stop` | Stop current operation |
| `/help` | Show available commands |

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

Progress is auto-saved on page navigation and restored on the new page (30-second expiry protection). Tasks also transfer when clicking links that open new tabs.

### 3.12 Batch Commands

AI can return multiple commands (up to 20) in one response, executed in sequence. A single failure does not block subsequent commands.

### 3.13 iframe & Shadow DOM Element Interaction

AI can interact with elements inside iframes and Shadow DOM boundaries. Supports same-origin iframes (up to 5 levels deep), cross-origin iframes, and Shadow DOM (up to 10 levels deep).

### 3.14 Auto-close Modals

AI can automatically close page modals/dialogs, supporting native dialogs, ARIA dialogs, and framework modals from Bootstrap, Element UI, Ant Design, Material UI, and Vuetify.

### 3.15 File Upload Operations

AI can programmatically upload files to page file inputs, with smart detection of hidden upload components used by frameworks like Element UI and Ant Design.

---

## 4. 🎤 Voice Control

📸 Screenshot: [Voice control panel with microphone button and status indicators]

### 4.1 Getting Started

Click the 🎙️ icon to the left of the input box → Voice panel → Click the large microphone button to start.

### 4.2 Voice Engines (4)

| Engine | Type | Features | Free Quota |
|------|------|------|---------|
| Web Speech API | Online | Zero config, browser native | Unlimited (requires Google services access) |
| iFlytek | Online | 20+ dialects, top Chinese recognition | 500K calls/year |
| Baidu | Online | Excellent Chinese, Cantonese/Sichuan/Shanghai dialects | 3000 min/month |
| Tencent | Online | Excellent Chinese, Cantonese support | 1000 min/month |

For domestic China users, iFlytek, Baidu, or Tencent engines are recommended. Registration and real-name verification required on the respective platforms.

### 4.3 Wake Word

Default wake word is "你好，小灵" (Hello, Xiao Ling), customizable in settings. You can combine the wake word and command in one utterance:

> **💡 Try saying:**
>
> - "Hello Xiao Ling, open Baidu"
> - "Hello Xiao Ling, search for today's tech news"

### 4.4 Status Indicators

| Status | Color | Text |
|------|------|------|
| Idle | Gray | "Click mic to start" |
| Waiting for wake word | Green pulse | "Waiting for wake word..." |
| Listening for command | Green fast pulse | "Please speak your command" |
| Processing | Theme pulse | "Processing..." |
| Speaking | Theme pulse | "Speaking..." |

The microphone button shows a ripple animation during active listening. The status bar displays real-time interim recognition text.

### 4.5 Voice Message Types

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
> - "Summarize this page"

### 4.6 Voice Playback (TTS)

When enabled, AI responses are read aloud automatically. Adjustable speech rate (0.5x–2.0x) and volume (0%–100%). Speaking during playback automatically interrupts and enters command mode.

### 4.7 Always-on Voice Mode

When "Always-on voice" is enabled, the voice engine runs continuously — no need to manually activate the microphone. The assistant can be woken even when the sidebar is closed.

### 4.8 Voice Setup Guide

Click the 📖 guide button in the voice panel to open a 5-tab guide: Quick Start, Engine Configuration, Permissions, Tips & Notes, and FAQ.

> **Note:** Disabling automation switches to pure chat mode. Multiple commands in a single voice input are supported. Only one tab can hold the microphone at a time.

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

Select text → popup appears automatically → shows translation → copy button → click outside to close. The popup supports dragging to reposition and resizing from all edges.

### 5.3 Auto Translation

All visible text is auto-translated; identical text is translated only once; `<code>` elements are preserved; dynamically loaded content is also translated. A loading spinner shows during translation. Disabling auto-translate restores all original text.

### 5.4 Click Translation

Click a paragraph to translate, click again to hide, click a third time to show the cached result. Supports paragraphs, lists, tables, headings, etc. Click a table row to translate the entire table.

### 5.5 Target Languages (8)

中文、English、日本語、한국어、Français、Deutsch、Español、Русский

### 5.6 Code Protection

Three-layer protection ensures code is not mistranslated:

- **Tag blacklist** — `<pre>`/`<code>`/`<samp>` elements are skipped entirely
- **Class blacklist** — Elements with `hljs`, `language-`, `prism`, `shiki` classes are skipped
- **Regex replacement** — Inline code, URLs, function calls, JSON fragments are replaced with placeholders and restored after translation

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

Click an attachment to preview: full-size images, syntax-highlighted code (60+ languages), Markdown rendering (with LaTeX formulas), PDF/Word text extraction. Close with Escape or click the overlay.

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

## 8. 📝 Notes & Bookmarks

📸 Screenshot: [Note bookmark and viewer interface]

### 8.1 What Is the Note System

The note system saves AI-generated content, page summaries, and translations as structured Markdown notes, organized by title groups, with export and import support.

### 8.2 Bookmarking Notes

Multiple ways to trigger bookmarking:

| Method | Action |
|------|------|
| Right-click message | Right-click any AI reply → Bookmark |
| Selection translate popup | Click ⭐ bookmark button in translation result |
| Click translate card | Click ⭐ bookmark button in translation result |
| Auto-note | Auto-generates notes on page load (enable in settings) |

A dialog appears for entering or selecting an existing title. Title autocomplete is supported.

> **💡 Try saying:**
>
> - "Summarize this page" (then bookmark the generated note)
> - "Translate this text" (then bookmark the translation)

### 8.3 Viewing Notes

Click the 📓 notebook icon in the sidebar header to open the note viewer:

- **Left sidebar** — Note title list, click to switch
- **Center area** — Note content with Markdown rendering
- **Right sidebar** — Timeline showing source links and timestamps for each note

### 8.4 Editing Notes

**Double-click** note content to enter edit mode with Markdown editing. Press **Ctrl+Enter** or click the save button to confirm, **Escape** to cancel.

### 8.5 Jump to Source

Click a link in the timeline to navigate to the original page at the saved scroll position, with the referenced text highlighted and flashing.

### 8.6 Export & Import

| Operation | Description |
|------|------|
| Export single title | Hover title → download icon → `.md` file |
| Export all | Click "Export All" → `.zip` archive |
| Import notes | Click "Import" → select `.zip` or `.md` file |

Exported Markdown files preserve complete metadata (source URL, scroll position, selected text, etc.). Imports automatically merge and deduplicate.

### 8.7 Deleting Notes

Hover a title to reveal the delete button, or click delete at the bottom of a note card. Deletion requires confirmation.

---

## 9. ⚙️ Settings

📸 Screenshot: [Settings panel with model configuration and general options]

Click the ⚙️ gear icon in the top-right corner of the sidebar to open settings. Settings contain 4 tabs.

### 9.1 Model Configuration

- Add/edit/delete models
- 10 one-click presets (OpenAI, Anthropic, DeepSeek, MiMo, Qwen, Kimi, Zhipu, Baidu, MiniMax, SiliconFlow)
- Show/hide API Key toggle
- Export/import config (JSON, team-shareable)
- 11 provider types: OpenAI-compatible, Anthropic, Google Gemini, Qwen, Wenxin, Doubao, Zhipu, DeepSeek, Kimi, Grok, Custom
- 4 authentication methods: Bearer Token, API Key, Access Token, Authorization Header
- Each model has its own API URL and Key

### 9.2 General Settings

| Setting | Description |
|--------|------|
| Theme | 10 themes, instant switch |
| Shortcut | Customize sidebar shortcut |
| Automation | Toggle AI web operations (confirm dialog) |
| Selection action | Auto / Manual / Off |
| Translate target | 8 languages dropdown |
| Translate mode | Selection / Auto / Click / Off |
| Note mode | Selection / Auto / Click / Off |

### 9.3 Voice Settings

| Setting | Description |
|--------|------|
| Recognition engine | Web Speech / iFlytek / Baidu / Tencent |
| Engine credentials | App ID, API Key, API Secret (for cloud engines) |
| Recognition language | Chinese / English |
| Wake word | Customizable (default: Hello, Xiao Ling) |
| Always-on voice | Keep voice engine running continuously |
| TTS playback | Enable/disable text-to-speech |
| TTS rate | 0.5x – 2.0x |
| TTS volume | 0% – 100% |
| Buffer timeout | 0.5s – 5.0s (speech segmentation interval) |
| Idle timeout | 2s – 15s (auto-return to wake word listening) |

### 9.4 User Settings

| Setting | Description |
|--------|------|
| Context messages | 100-500 (default 100) |
| Cache management | Usage bar + clear button (30MB limit) |
| Language | 中文 / English |
| Documentation | Built-in Markdown doc viewer |
| Version | Current version number |

Clear cache: removes sessions/logs/history, preserves model configs/themes/shortcuts and other personalized settings.

---

## 10. 🎨 Themes

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
| Clear Sky | `#0ea5e9` Sky Blue | Bright |

Settings → General → click a theme in the grid to switch instantly.

---

## 11. ⌨️ Quick Commands

📸 Screenshot: [Command selector popup and keyboard shortcut reference]

### Command Selector

Type `/` → menu appears → ↑↓ to navigate → Tab/Enter to select → Escape to close. Supports input filtering to show only matching commands.

> **Note:** Only available when "Web Automation" is enabled.

### All Commands at a Glance

| Command | Description | Command | Description |
|------|------|------|------|
| `/navigate` | Open URL | `/click` | Click element |
| `/scroll` | Scroll page | `/type` | Type text |
| `/newTab` | New tab | `/clear` | Clear input |
| `/closeTab` | Close tab | `/select` | Select dropdown |
| `/nextTab` | Next tab | `/focus` | Focus element |
| `/prevTab` | Previous tab | `/hover` | Hover element |
| `/switchTab` | Switch by keyword | `/upload` | Upload file |
| `/keyboard` | Simulate key | `/slider` | Drag slider |
| `/wait` | Wait | `/closeModal` | Close modal |
| `/search` | Web search | `/download` | Extract data |
| `/summarize` | Summarize page | `/translate` | Translate page |
| `/note` | Generate note | `/stop` | Stop operation |
| `/help` | Show help | | |

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

## 12. 💡 Tips

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

### Translation & Notes

- **Selection translate** is best for occasional lookups; **Auto translate** for full-page reading
- **Click translate** is lightest — on-demand without disrupting reading
- **Note mode** can auto-generate page notes; bookmark for later reference
- Translation and note results can both be bookmarked with one click

### Voice Control

- Combine wake word + command in one sentence: "Hello Xiao Ling, open Baidu"
- Speaking during playback automatically interrupts and enters command mode
- Always-on voice mode keeps the microphone active without manual activation
- Quiet environment and clear speech improve recognition accuracy

### Note Management

- Name notes by topic for easy archiving and retrieval
- Use title autocomplete to quickly file into existing categories
- Export as `.zip` to back up all notes
- Click timeline links to jump back to the original page

### Settings

- **Model import/export** — share configs with your team
- **Context 100-200** — sufficient for daily conversations
- **Cache management** — clean regularly to keep things smooth (30MB limit)
- **Voice engine switching** — domestic users: iFlytek/Baidu/Tencent; overseas: Web Speech

---

## 13. ❓ FAQ

📸 Screenshot: [FAQ section with expandable question cards]

**Q: Sidebar doesn't open?** Check if a model is configured, API Key is correct, and network is available.

**Q: AI replies are slow?** Reduce context messages, switch to a faster model, check your network.

**Q: Automation can't click?** The element may be in an iframe or obscured. AI automatically tries to find elements in iframes and Shadow DOM. Retry with a more precise description.

**Q: Voice recognition is inaccurate?** Ensure microphone permission, quiet environment, and clear speech. Try switching engines (iFlytek/Baidu/Tencent each have their strengths).

**Q: Wake word not responding?** Check microphone permission, confirm wake word setting is correct, try speaking more clearly. The wake word supports fuzzy matching with minor tolerance for errors.

**Q: Do I need to reconfigure when switching voice engines?** No, each engine's credentials are saved independently. Previous configurations are preserved when switching.

**Q: File upload failed?** Check size limits: images 20MB, text 2MB, PDF/Office 10MB.

**Q: How to switch models?** Click the model name pill below the input box.

**Q: How to resize the sidebar?** Drag the left edge handle.

**Q: How to backup settings?** Settings → Model Config → Export.

**Q: How to backup notes?** Note viewer → Export All → download `.zip` file.

**Q: What does clearing cache remove?** Sessions/logs/history only; personalized settings and notes are preserved.

**Q: Floating button blocks content?** Drag it elsewhere — position is auto-saved.

**Q: Command selector doesn't appear?** Ensure automation is enabled and type `/` to trigger.

**Q: Translation also translated my code?** Code is automatically protected — `<code>`/`<pre>` elements are not translated. Please report if you encounter issues.

**Q: Note source link doesn't work?** The original page may have been deleted or moved. The link will attempt to open and scroll to the saved position.

**Q: Multiple tabs with voice will conflict?** Only one tab can hold the microphone at a time. Other tabs automatically release it.

---

> **LingBot** v1.8.3 | MIT License
