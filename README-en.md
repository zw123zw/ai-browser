# LingBot — AI Voice Browser Assistant

> 🌐 **[中文](./README.md)**

> Chrome extension: AI Voice Browser Assistant. WXT + Vue 3 + TypeScript + Pinia, running in Shadow DOM.

**Version 1.8.3** | [User Guide](./docs/site/guide-en.md) | [Architecture](./docs/architecture/README-en.md)

## Tech Stack

| Layer | Technology | Description |
|---|---|---|
| Build | WXT (Manifest V3) | Chrome extension framework with HMR support |
| UI | Vue 3 + `<script setup>` | Composition API, Shadow DOM isolation |
| State | Pinia (setup store) | Composition API style, reactive responses |
| Types | TypeScript + `vue-tsc` | Strict type checking |
| Styles | Pure CSS (`aib-` prefix) | `src/styles/global.css`, avoids style conflicts |
| Logging | Logger -> `chrome.storage.local` | No console, unified storage logging |
| AI Adapters | Factory + Strategy pattern | 11 providers, unified `chat()` interface |
| Proxy | Background Service Worker | `proxyFetchStream` for CORS bypass |

## Architecture Layers

```mermaid
graph TB
    subgraph UI["UI Layer -- Content Script (Shadow DOM)"]
        App[App.vue]
        ChatPanel[ChatPanel]
        InputBar[InputBar]
        FAB[FloatingActionButton]
    end

    subgraph Composable["Composable Layer"]
        usePipeline[usePipeline]
        useSettings[useSettingsStore]
        useConversations[useConversationsStore]
    end

    subgraph Input["Input Processing Layer"]
        InputRouter[InputRouter -- 3 routes: builtin/capability/ai]
        IntentDetector[IntentDetector -- Phase 1 intent detection]
        InputPipeline[InputPipeline -- Phase 2 streaming execution]
        TagParser[TagParser -- extractTags]
        Prompts[Prompts -- phase1/phase2/extract/summarize]
    end

    subgraph Browser["Browser Execution Layer"]
        ActionExecutor[ActionExecutor -- click/type/scroll/video/...]
        SkeletonManager[SkeletonManager -- SemanticSkeleton]
    end

    subgraph Adapters["AI Adapter Layer"]
        BaseAdapter[BaseAdapter -- abstract chat + parseSSE]
        OpenAIAdapter[OpenAIAdapter -- OpenAI + Anthropic]
        Factory[createAdapter -- factory function]
    end

    subgraph State["State Management Layer"]
        SettingsStore[settingsStore]
        ConversationsStore[conversationsStore]
        VoiceStore[voiceStore]
    end

    subgraph Storage["Storage Layer"]
        SettingsStorage[settingsStorage]
        ConversationStorage[conversationStorage]
        QueuedTaskStorage[queuedTaskStorage]
    end

    subgraph Background["Background Service Worker"]
        ProxyFetch[proxy-fetch]
        ProxyFetchStream[proxy-fetch-stream]
        TabAction[tab-action]
    end

    App --> ChatPanel
    App --> InputBar
    App --> FAB
    ChatPanel --> usePipeline
    InputBar --> usePipeline
    usePipeline --> InputPipeline
    InputPipeline --> InputRouter
    InputPipeline --> IntentDetector
    InputPipeline --> TagParser
    InputPipeline --> ActionExecutor
    InputPipeline --> SkeletonManager
    IntentDetector --> Prompts
    InputPipeline --> Prompts
    InputPipeline --> Factory
    ActionExecutor --> Background
    Factory --> BaseAdapter
    BaseAdapter --> OpenAIAdapter
    OpenAIAdapter --> ProxyFetchStream
    usePipeline --> useSettings
    usePipeline --> useConversations
    useSettings --> SettingsStorage
    useConversations --> ConversationStorage
    InputPipeline --> QueuedTaskStorage
```

## Module Documentation

| Module | Document | Core Responsibility |
|---|---|---|
| Input Pipeline | [input-pipeline-en.md](./docs/architecture/input-pipeline-en.md) | Routing, Phase 1/2, tag extraction, command execution loop |
| Browser Command | [browser-command-en.md](./docs/architecture/browser-command-en.md) | Semantic skeleton, element targeting, action execution engine |
| AI Adapters | [ai-adapters-en.md](./docs/architecture/ai-adapters-en.md) | Multi-provider protocol adaptation, streaming proxy |
| Content Script | [content-script-en.md](./docs/architecture/content-script-en.md) | Shadow DOM mounting, translation init, cross-tab tasks |
| State Management | [state-management-en.md](./docs/architecture/state-management-en.md) | Pinia store, session management, cross-tab sync |
| Storage Layer | [storage-en.md](./docs/architecture/storage-en.md) | Chrome storage abstraction, persistence |
| Background Service | [background-service-en.md](./docs/architecture/background-service-en.md) | Request proxy, tab operations, streaming |
| Voice | [voice-en.md](./docs/architecture/voice-en.md) | Dual-engine recognition, state machine, TTS, command parsing |
| Translation | [translation-en.md](./docs/architecture/translation-en.md) | Selection, auto, click translation modes |
| File Parsing | [file-parsing-en.md](./docs/architecture/file-parsing-en.md) | Attachment parsing (OCR, PDF, Office), file generation |
| Voice Automation | [automation-en.md](./docs/architecture/automation-en.md) | Action execution, selector adaptation |
| Internationalization | [i18n-en.md](./docs/architecture/i18n-en.md) | Chinese/English support, responsive switching |

📖 [Architecture Overview](./docs/architecture/README-en.md)

## Core Data Flow

### User Input -> AI Chat

```mermaid
sequenceDiagram
    participant U as User
    participant IB as InputBar
    participant UP as usePipeline
    participant IP as InputPipeline
    participant IR as InputRouter
    participant ID as IntentDetector
    participant TP as TagParser
    participant AE as ActionExecutor
    participant SM as SkeletonManager

    U->>IB: Text / Voice input
    IB->>UP: processInput(text)
    UP->>IP: process(ctx, callbacks)

    IP->>IR: route(ctx)
    alt builtin
        IR-->>IP: { type: 'builtin', command, args }
        IP->>UP: onBuiltinCommand(command, args)
    else capability (/scroll, /navigate, etc.)
        IR-->>IP: { type: 'capability', command, args }
        IP->>IP: processPhase2WithRetry(commandText)
    else ai
        IR-->>IP: { type: 'ai' }
        IP->>ID: detectPhase1(text)
        ID-->>IP: Phase1Detection

        alt isChat
            IP->>UP: onChatDelta -> onChatEnd
        else commands (fast path)
            IP->>AE: execute(cmd) x N
            AE-->>IP: ActionResult
        else action
            IP->>IP: processPhase2WithRetry(text)
            loop Streaming execution (MAX_TOTAL_STEPS=20)
                IP->>SM: getSkeleton()
                IP->>ID: callStreamingAI(text, skeleton, completed)
                ID-->>IP: Phase2Result
                IP->>TP: extractTags(rawText)
                TP-->>IP: { commands, needFull, needInput }
                IP->>AE: execute(cmd)
                AE-->>IP: ActionResult
            end
        end
    end
```

### Streaming Proxy Request

```mermaid
sequenceDiagram
    participant CS as Content Script
    participant BG as Background SW
    participant API as AI Provider API

    CS->>BG: chrome.runtime.sendMessage -- type: 'proxy-fetch-stream'
    BG->>API: fetch(url, { stream: true })
    API-->>BG: ReadableStream

    loop Streaming
        BG-->>CS: { type: 'stream-chunk', requestId, chunk }
        CS->>CS: processChunk -> onChunk({ delta })
    end

    BG-->>CS: { type: 'stream-end', requestId }
    CS->>CS: onChunk({ done: true })

    opt User cancel
        CS->>BG: { type: 'abort-stream', requestId }
        BG->>API: AbortController.abort()
    end
```

## Key Design Decisions

### 1. Two-Phase Intent Detection + Fast Path

Phase 1 does lightweight classification (chat / [action] / [command] / [FILE]), Phase 2 handles complex operation decisions. Operations that don't need page skeleton (navigate, scroll, keyboard) are directly output as [command] by Phase 1, skipping Phase 2 to reduce one AI call.

### 2. Semantic Skeleton Without Caching

`SkeletonManager.getSkeleton()` re-extracts interactive elements in the viewport every time. No caching, no DOM mutation monitoring — simple, reliable, never stale. MAX_SKELETON_ELEMENTS=200 limits token consumption.

### 3. Streaming Single-Command Execution + Termination Verification

Phase 2 generates only 1 command per round, feeds back the result before generating the next. The `done:1` field marks whether the final goal is achieved, and `MAX_TOTAL_STEPS=20` prevents infinite loops.

### 4. Cross-Tab Task Resumption

After navigate/click(_blank), the current step is saved to `queuedTaskStorage` (30s expiry). When the new tab finishes loading, it detects the queued task, skips Phase 1, and resumes execution directly in Phase 2.

### 5. Background Streaming Proxy

All AI API requests go through `proxyFetchStream` via Background Service Worker to bypass Content Script CORS restrictions. Uses requestId to identify streams, supports AbortSignal cancellation.

### 6. Shadow DOM Style Isolation

UI components run inside Shadow DOM, CSS class names use `aib-` prefix to avoid conflicts with host page styles.

### 7. Dual-Engine Voice Recognition

Prioritizes Sherpa-ONNX local offline recognition (WASM), falls back to Web Speech API. Local engine needs no network, supports Chinese and English.

## Directory Structure

```
entrypoints/
  background.ts              # Background Service Worker (request proxy, tab ops)
  content/
    index.ts                 # Content Script entry (Shadow DOM mounting)
    App.vue                  # Root component
    components/              # All Vue components
src/
  adapters/                  # AI adapters (factory + strategy pattern)
  automation/                # Voice automation (action execution, selectors)
  browser/                   # Browser command execution engine
  composables/               # Vue composables
  i18n/                      # Internationalization (Chinese/English)
  input/                     # Unified input processing pipeline
  storage/                   # Chrome storage abstraction layer
  stores/                    # Pinia state management
  styles/                    # Global CSS
  utils/                     # Utilities (file parsing, OCR, charts, etc.)
  voice/                     # Voice recognition and session management
  types.ts                   # Shared type definitions
```

## 📄 License

MIT
