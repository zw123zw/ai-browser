# LingBot — AI Voice Browser Assistant

> Tell AI what to do in your browser — by voice or text.

---

## What is it

LingBot is a Chrome extension that adds a floating button to every web page. Click it to open a sidebar where you can:

- **Chat with AI** that can see the page you're browsing
- **Control your browser by voice** — say "open Google and search for weather" and it happens
- **Translate web pages** — selection, auto-translate on scroll, or click-to-translate
- **Take notes** — bookmark web content to a notebook, export as Markdown/ZIP
- **Parse files** — upload PDF/Word/Excel/images and ask AI questions about them

---

## Key Features

### 🤖 AI Chat

Connects to 11 major AI providers (OpenAI, Claude, DeepSeek, Qwen, Gemini, Doubao, Ernie, and more). Streaming output, file attachments, image support.

**What makes it different**: LingBot's AI can see the web page you're on. Ask "what's this page about?" and it answers based on the actual content — no copy-paste needed.

### 🎙️ Voice Control

Three speech engines:
- **Web Speech API**: Built into Chrome, zero setup
- **iFlytek**: High-accuracy Chinese recognition
- **Volcengine**: ByteDance's speech service

Supports wake word ("Xiao Ling"), continuous conversation, and voice readback.

**What voice can do**: Open websites, search, click buttons, type text, scroll, translate selections, generate notes — almost anything you can do with mouse and keyboard.

### 🌐 Smart Translation

Three modes:
- **Selection translate**: Select text to translate instantly
- **Auto translate**: Translates as you scroll, using IntersectionObserver lazy loading
- **Click translate**: Click any paragraph to translate

Automatically detects and skips code blocks during translation.

### 📝 Web Notes

Select text on any page, bookmark it with one click. Notes preserve the original text, source URL, and scroll position — click to jump back to the exact spot. Organize by title, export as Markdown or ZIP.

### 📎 File Parsing

Upload and parse:
- **Documents**: PDF, Word (.docx), Excel (.xlsx)
- **Images**: OCR for Chinese and English text
- **Code**: 70+ languages with syntax highlighting
- **Data**: CSV, JSON, Markdown

AI reads file contents and answers questions. Can also generate new files (Excel, Word, PDF, charts).

### 🖥️ Browser Automation

AI understands page structure and executes actions:
- Click buttons, links, menus
- Fill in form fields
- Scroll pages, navigate to new pages
- Upload files, drag sliders
- Control video playback
- Cross-tab operations (auto-continues in new tabs after navigation)

Technical highlight: Uses semantic skeleton extraction to understand pages. Supports Shadow DOM and cross-origin iframes. No reliance on fixed CSS selectors.

---

## Who is it for

| User | Use Case |
|------|----------|
| Developers | Quick browser control, translate technical docs, parse code files |
| Content creators | Web clipping, note management, multilingual translation |
| Cross-border e-commerce | Real-time translation, batch product info collection |
| Researchers | Extract key info, organize literature notes |
| Accessibility needs | Voice-controlled browsing, reduced mouse/keyboard dependency |

---

## Technical Highlights

- **Multi-model support**: No vendor lock-in, choose any AI provider
- **Local speech recognition**: Sherpa-ONNX WASM engine, works offline, no voice data leaves your device
- **Shadow DOM isolation**: Doesn't affect host page styles or functionality
- **Cross-tab sync**: Settings, conversations, and drawer state sync across all tabs
- **Manifest V3**: Compliant with latest Chrome extension security standards
- **Dark mode**: 5 themes, auto-adapts to system preference

---

## Installation

### From Chrome Web Store

Search "LingBot" on the Chrome Web Store and install.

### Manual Install (Developer Mode)

1. Download and extract `ai-browser.zip`
2. Open Chrome, go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the extracted folder
5. Done! A floating button appears in the bottom-right corner

---

## Quick Start

1. **Set up AI**: Click floating button → Settings → AI Config → Add model (enter API Key)
2. **Start chatting**: Type in the input box, or press `Ctrl+Shift+M` to toggle the panel
3. **Try voice**: Switch to voice mode, say "Xiao Ling" to wake, then give your command
4. **Translate**: Select any text, or enable auto-translate in settings
5. **Save notes**: Select text and click the bookmark button

---

## Free vs Pro

| Feature | Free | Pro |
|---------|------|-----|
| AI Chat | ✅ 3 models | ✅ Unlimited models |
| Web Translation | ✅ | ✅ |
| Browser Automation | ✅ 50/day | ✅ Unlimited |
| Voice (Web Speech) | ✅ | ✅ |
| Voice (iFlytek/Volcengine) | ❌ | ✅ |
| File Parsing | ✅ | ✅ |
| Web Notes | ✅ | ✅ |
| Priority Support | ❌ | ✅ |

---

## Privacy

- Your API keys are stored locally in the browser, never uploaded to any server
- AI requests go directly from your browser to the AI provider — no middleman
- Local speech recognition (Sherpa-ONNX) keeps voice data on your device
- Page content is only sent to AI when you initiate a conversation — no background collection
- All data stored in `chrome.storage.local`, cleared when you uninstall

---

## FAQ

**Q: Which browsers are supported?**
A: Chrome 116+, Edge 116+, Brave, and other Chromium-based browsers.

**Q: Do I need my own API key?**
A: Yes. LingBot doesn't bundle AI models. Register with an AI provider to get a key. Recommended: DeepSeek (affordable) or Qwen (free tier available).

**Q: Does voice recognition work offline?**
A: Web Speech API requires internet (browser service). iFlytek and Volcengine require internet. Sherpa-ONNX works fully offline (requires downloading model files).

**Q: Will it slow down my browser?**
A: No. LingBot uses Shadow DOM isolation. The full UI only loads when you click the floating button. Translation uses lazy loading — only visible areas are translated.

**Q: Is my data safe?**
A: All data stays in your browser. AI requests use HTTPS directly to the provider. Nothing passes through our servers. No user data is collected.

---

## Contact

- GitHub: https://github.com/zw123zw/ai-browser
- Issues: https://github.com/zw123zw/ai-browser/issues
