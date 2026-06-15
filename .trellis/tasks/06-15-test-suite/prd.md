# 06-15-test-suite: 全项目自动化测试方案

## Goal

为 ai-browser 项目建立完整的自动化测试体系，覆盖所有已实现模块的单元测试。用户可以通过 `npm test` 运行测试，通过 `npm run test:coverage` 查看覆盖率报告。

---

## 现状分析

- **零测试基础设施**：无 test runner、无 test 文件、无测试脚本
- **纯 TypeScript 项目**：WXT + Vue 3 + Pinia
- **已有手动测试用例**：`docs/test.md` 有 30+ 手动测试场景（仅 Phase1）
- **构建工具**：WXT (基于 Vite)，TypeScript 5.7

---

## 技术方案选型

### 测试框架：Vitest（推荐）

**理由**：
1. **与 WXT/Vite 生态完美兼容** — WXT 底层是 Vite，Vitest 共享同一套配置，零摩擦集成
2. **原生 ESM 支持** — 项目使用 `"type": "module"`，Vitest 原生支持，无需额外配置
3. **TypeScript 一等公民** — 无需 ts-jest，直接运行 .ts 文件
4. **速度极快** — 比 Jest 快 3-10x（基于 Vite 的 HMR 转换）
5. **Vue 官方推荐** — Vue 生态已全面转向 Vitest
6. **内置覆盖率** — 通过 `@vitest/coverage-v8` 即可生成覆盖率报告
7. **API 兼容 Jest** — 迁移成本为零，describe/it/expect 完全一致

**替代方案对比**：

| 方案 | 优势 | 劣势 |
|------|------|------|
| Vitest | Vite 原生、ESM 支持、速度最快 | 较新 |
| Jest | 生态最成熟 | ESM 支持差、需 ts-jest、与 Vite 配置不共享 |
| Playwright Test | 适合 E2E | 过重、不适合纯单元测试 |

### 覆盖率：@vitest/coverage-v8

- 无需 Istanbul/c8 额外配置
- 支持 HTML + Text + JSON 报告
- 可设置阈值（建议 80%）

### 浏览器 API Mock：vitest + 手动 mock

- `chrome.runtime` — 手动 mock（项目已有类似模式）
- `document/window` — happy-dom（比 jsdom 快 2-3x，Vitest 默认支持）
- `File/FileReader` — Node.js 20+ 原生支持
- `SpeechRecognition/speechSynthesis` — 手动 mock

---

## 测试分层策略

### 第一层：纯函数单元测试（无需 mock，最高优先级）

| 模块 | 函数 | 测试文件 | 用例数 |
|------|------|----------|--------|
| `src/input/tag-parser.ts` | `extractTags`, `isChatOnlyReply`, `getChatText` | `tag-parser.test.ts` | ~20 |
| `src/input/router.ts` | `InputRouter.route()` | `router.test.ts` | ~12 |
| `src/input/prompts.ts` | `buildPhase2UserMessage`, `buildRetryUserMessage`, `buildNeedHtmlUserMessage` | `prompts.test.ts` | ~10 |
| `src/adapters/index.ts` | `createAdapter()` | `adapters-factory.test.ts` | ~10 |
| `src/voice/commandParser.ts` | `parseBatchCommand()` | `command-parser.test.ts` | ~15 |
| `src/utils/file-type.ts` | `getExtension`, `detectFileType`, `getCodeLang`, `formatFileSize` | `file-type.test.ts` | ~25 |
| `src/utils/shortcut.ts` | `matchShortcut`, `eventToShortcut` | `shortcut.test.ts` | ~15 |
| `src/utils/markdown.ts` | `renderMarkdown` | `markdown.test.ts` | ~8 |
| `src/utils/logger.ts` | `Logger`, `setLogLevel` | `logger.test.ts` | ~8 |
| `src/themes.ts` | `getThemeById`, `THEMES` | `themes.test.ts` | ~6 |

**小计：~129 个用例**

### 第二层：带 Mock 的模块测试（中等优先级）

| 模块 | 测试内容 | Mock 依赖 | 测试文件 | 用例数 |
|------|----------|-----------|----------|--------|
| `src/adapters/base.ts` | `parseSSE` 解析 | mock Response/ReadableStream | `base-adapter.test.ts` | ~8 |
| `src/adapters/proxy.ts` | `proxyFetch`, `proxyFetchStream` | mock chrome.runtime | `proxy.test.ts` | ~10 |
| `src/stores/voice.ts` | 状态管理 | Pinia test harness | `voice-store.test.ts` | ~10 |
| `src/stores/settings.ts` | `mergeSettings` | Pinia + storage mock | `settings-store.test.ts` | ~8 |
| `src/stores/conversations.ts` | `enforceMaxContext`, migration | Pinia + storage mock | `conversations-store.test.ts` | ~8 |
| `src/storage/index.ts` | `parseLocalModels` | mock wxt/storage | `storage.test.ts` | ~6 |
| `src/utils/storage-sync.ts` | `plain()` | 无 | `storage-sync.test.ts` | ~5 |
| `src/input/intent-detector.ts` | Phase1/Phase2 逻辑 | mock AI adapter | `intent-detector.test.ts` | ~10 |
| `src/input/pipeline.ts` | 重试循环、路由分支 | mock 所有依赖 | `pipeline.test.ts` | ~12 |

**小计：~77 个用例**

### 第三层：DOM 环境测试（需要 happy-dom）

| 模块 | 测试内容 | 测试文件 | 用例数 |
|------|----------|----------|--------|
| `src/browser/skeleton.ts` | `extractSkeleton` 语义骨架提取 | `skeleton.test.ts` | ~12 |
| `src/browser/local-html.ts` | `extractLocalHtml` 本地 HTML 提取 | `local-html.test.ts` | ~8 |
| `src/browser/action-executor.ts` | 15 种浏览器操作 | `action-executor.test.ts` | ~20 |

**小计：~40 个用例**

### 总计：~246 个测试用例

---

## 目录结构

```
E:\note\ai-browser\
├── vitest.config.ts              # Vitest 配置
├── src/
│   ├── input/
│   │   ├── __tests__/
│   │   │   ├── tag-parser.test.ts
│   │   │   ├── router.test.ts
│   │   │   ├── prompts.test.ts
│   │   │   ├── intent-detector.test.ts
│   │   │   └── pipeline.test.ts
│   ├── adapters/
│   │   ├── __tests__/
│   │   │   ├── adapters-factory.test.ts
│   │   │   ├── base-adapter.test.ts
│   │   │   └── proxy.test.ts
│   ├── voice/
│   │   ├── __tests__/
│   │   │   └── command-parser.test.ts
│   ├── browser/
│   │   ├── __tests__/
│   │   │   ├── skeleton.test.ts
│   │   │   ├── local-html.test.ts
│   │   │   └── action-executor.test.ts
│   ├── stores/
│   │   ├── __tests__/
│   │   │   ├── voice-store.test.ts
│   │   │   ├── settings-store.test.ts
│   │   │   └── conversations-store.test.ts
│   ├── storage/
│   │   ├── __tests__/
│   │   │   └── storage.test.ts
│   └── utils/
│       ├── __tests__/
│       │   ├── file-type.test.ts
│       │   ├── shortcut.test.ts
│       │   ├── markdown.test.ts
│       │   ├── logger.test.ts
│       │   └── storage-sync.test.ts
├── themes.test.ts                # 根级纯函数
└── test/
    └── setup.ts                  # 全局 mock 设置
```

---

## package.json 新增脚本

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui"
  }
}
```

---

## 需要安装的依赖

```json
{
  "devDependencies": {
    "vitest": "^3.2.0",
    "@vitest/coverage-v8": "^3.2.0",
    "happy-dom": "^18.0.0"
  }
}
```

---

## 测试用例详细清单

### 1. tag-parser.test.ts（核心，最高价值）

```
extractTags:
  - 空字符串 → hasAnyTag=false
  - 纯文本无标签 → hasAnyTag=false, rawText 保留
  - [action] 标签 → isAction=true
  - [chat] 标签含有效 JSON → chatText 正确提取
  - [chat] 标签含无效 JSON → 使用原始文本
  - [command] 标签含有效 JSON → commands 数组解析正确
  - [command] 含无效 JSON → 跳过，不崩溃
  - 多个 [command] 标签 → 全部收集
  - [skill] 标签 → name + userText 解析
  - [need_html] 标签 → contextId + description 解析
  - 混合标签（command + chat）→ 各字段独立正确
  - 标签嵌入自然语言文本中 → 正确提取不丢标签
  - JSON 中含嵌套括号 → 正确解析
  - [command] 含 null 字段 → 正确处理

isChatOnlyReply:
  - 有 isAction → false
  - 有 commands → false
  - 有 skill → false
  - 有 needHtml → false
  - 只有 chatText → true
  - 无标签但有 rawText → true
  - 全空 → false

getChatText:
  - chatText 存在 → 返回 chatText
  - chatText 不存在 → 返回 rawText
```

### 2. router.test.ts

```
InputRouter.route:
  - "/stop" → builtin, command=stop
  - "/pause" → builtin, command=pause
  - "/resume" → builtin, command=resume
  - "/list" → builtin, command=list
  - "/help" → builtin, command=help
  - "/stop all" → builtin, command=stop, args="all"
  - "/translate hello" → skill, skillName=translate, skillUserText="hello"
  - "/summarize" → skill, skillName=summarize, skillUserText=""
  - "打开百度" → ai
  - "  " → ai（纯空白）
  - "/" → ai（无命令名）
  - "/STOP" → ai（大小写敏感，不匹配 builtin）
```

### 3. command-parser.test.ts

```
parseBatchCommand:
  - 空字符串 → 无命令, plainText=""
  - 纯文本无【code】→ plainText=原始文本
  - 单个 open_site 命令 → commands[0] 正确
  - 单个 search 命令 → commands[0] 正确
  - 多个命令块 → 按顺序排列
  - 无效命令类型 → hasError=true
  - 缺少必需参数 → hasError=true
  - 无参命令(video_play) → 不需要参数
  - 参数含冒号(URL) → 只按第一个冒号分割
  - 【code】无匹配【/code】→ 处理为单块
  - 混合有效/无效命令 → hasError=true
```

### 4. prompts.test.ts

```
buildPhase2UserMessage:
  - 正常文本 + skeleton → 包含两部分
  - skeleton 为空对象 → 正常生成

buildRetryUserMessage:
  - errorType='exec' → 包含骨架更新提示
  - errorType='need_html' → 包含描述提示
  - errorType='extract' → 包含标签提示
  - recentMessages 非空 → 包含对话历史
  - recentMessages 为空 → 不含对话历史

buildNeedHtmlUserMessage:
  - 正常输入 → 包含 text + needHtml + localHtml
```

### 5. adapters-factory.test.ts

```
createAdapter:
  - 'qwen' → QwenAdapter 实例
  - 'wenxin' → WenxinAdapter 实例
  - 'openai' → OpenAIAdapter 实例
  - 'zhipu' → OpenAIAdapter 实例
  - 'deepseek' → OpenAIAdapter 实例
  - 'moonshot' → OpenAIAdapter 实例
  - 'anthropic' → OpenAIAdapter 实例
  - 'gemini' → OpenAIAdapter 实例
  - 未知 provider → OpenAIAdapter 实例（default）
```

### 6. file-type.test.ts

```
getExtension:
  - "file.txt" → "txt"
  - "file.min.js" → "js"
  - "FILE.PDF" → "pdf"（小写转换）
  - "noext" → ""
  - ".hidden" → ""

detectFileType:
  - image/png MIME → 'image'
  - .pdf 扩展名 → 'pdf'
  - .docx 扩展名 → 'word'
  - .xlsx MIME → 'excel'
  - .csv → 'text'（注意：不是 excel）
  - .tsv → 'text'
  - .js → 'code'
  - .py → 'code'
  - .txt → 'text'
  - .md → 'text'
  - 无扩展名 → 'text'
  - text/html MIME → 'text'
  - 未知 → 'binary'

formatFileSize:
  - 0 → "0 B"
  - 500 → "500 B"
  - 1024 → "1.00 KB"
  - 1048576 → "1.00 MB"
  - 1073741824 → "1.00 GB"
```

### 7. shortcut.test.ts

```
matchShortcut:
  - Ctrl+Shift+B 匹配 → true
  - 大小写不敏感 → true
  - 不匹配 → false
  - 空快捷键字符串 → false
  - alt/option 互换 → true
  - meta/cmd/command 互换 → true

eventToShortcut:
  - Ctrl+Shift+B → "Ctrl+Shift+B"
  - 仅 Ctrl → null（需要非修饰键）
  - 仅字母 → null（需要修饰键）
  - Space → "Space"
  - Ctrl+Space → "Ctrl+Space"
```

### 8. skeleton.test.ts（需 happy-dom）

```
extractSkeleton:
  - 空文档 → 空数组
  - 含 button → 提取为交互元素
  - 含 input → 提取含 type/name/placeholder
  - 含 a[href] → 提取含 href
  - display:none 元素 → 跳过
  - 纯文本段落 → 提取文本内容
  - 含 aria-label → 提取无障碍属性
  - 含 role → 提取 landmark
  - SVG 图标 → 标记为 (icon)

SkeletonManager:
  - 首次调用 → 提取新骨架
  - URL 不变 → 返回缓存
  - URL 变化 → 重新提取
  - invalidate() → 下次调用重新提取
```

### 9. action-executor.test.ts（需 happy-dom + chrome mock）

```
execute:
  - click 找到元素 → 成功 + 事件触发
  - click 找不到元素 → 失败
  - type 到 input → 值设置 + input/change 事件
  - type 到 textarea → 值设置
  - type 到非输入元素 → 失败
  - clear 到 input → 值清空
  - scroll down → window.scrollBy 调用
  - navigate → window.open 调用
  - navigate 空 URL → 失败
  - select 到 select 元素 → 值设置
  - select 到非 select → 失败
  - keyboard Enter → 键盘事件
  - focus → focus() 调用
  - hover → mouseover 事件
  - wait → setTimeout
  - 未知 action → 失败
  - newTab → chrome.runtime.sendMessage
  - closeTab → chrome.runtime.sendMessage
```

---

## Acceptance Criteria

- [ ] `npm test` 运行全部测试并输出结果
- [ ] `npm run test:coverage` 输出覆盖率报告（text + HTML）
- [ ] 覆盖率 ≥ 80%（纯函数模块）
- [ ] 所有 Tier 1 纯函数测试通过
- [ ] 所有 Tier 2 Mock 测试通过
- [ ] 所有 Tier 3 DOM 测试通过
- [ ] 测试运行时间 < 30 秒
- [ ] CI 可运行（无浏览器依赖）

---

## Definition of Done

- vitest + coverage 依赖安装完成
- vitest.config.ts 配置完成
- 所有测试文件编写完成
- `npm test` 全部通过
- `npm run test:coverage` 覆盖率达标
- 测试报告可读（终端 + HTML）

---

## Out of Scope

- **E2E 测试**：需要真实浏览器环境，后续单独规划
- **Vue 组件测试**：需要 mount + Shadow DOM 配置，复杂度高，单独任务
- **视觉回归测试**：截图对比，不适用当前阶段
- **性能测试**：基准测试，不适用当前阶段
- **未实现功能的测试**：auto-send-selection, file-preview-ai, ocr-image-text, skill-workflow 都在 planning 状态，暂不测试

---

## Implementation Plan

### PR1: 基础设施搭建
- 安装 vitest + @vitest/coverage-v8 + happy-dom
- 创建 vitest.config.ts
- 创建 test/setup.ts（全局 mock）
- 更新 package.json scripts
- 验证 `npm test` 能运行空测试

### PR2: Tier 1 纯函数测试（129 个用例）
- tag-parser.test.ts（最高优先级）
- router.test.ts
- prompts.test.ts
- command-parser.test.ts
- adapters-factory.test.ts
- file-type.test.ts
- shortcut.test.ts
- markdown.test.ts
- logger.test.ts
- themes.test.ts

### PR3: Tier 2 Mock 测试（77 个用例）
- base-adapter.test.ts
- proxy.test.ts
- voice-store.test.ts
- settings-store.test.ts
- conversations-store.test.ts
- storage.test.ts
- storage-sync.test.ts
- intent-detector.test.ts
- pipeline.test.ts

### PR4: Tier 3 DOM 测试（40 个用例）
- skeleton.test.ts
- local-html.test.ts
- action-executor.test.ts

---

## Technical Notes

- WXT 使用 Vite 作为底层构建工具，Vitest 可直接复用 Vite 配置
- 项目的 `tsconfig.json` extends `.wxt/tsconfig.json`，Vitest 需要单独的 tsconfig 或内联配置
- `src/storage/index.ts` 依赖 `wxt/storage`，需要 mock 该模块
- `src/adapters/proxy.ts` 依赖 `chrome.runtime`，需要在 setup.ts 中全局 mock
- happy-dom 比 jsdom 快 2-3x，且 API 更完整，推荐使用
- 测试文件放在各模块的 `__tests__/` 目录下，与源码同级，便于维护
