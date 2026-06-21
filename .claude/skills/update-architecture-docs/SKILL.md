---
name: update-architecture-docs
description: "扫描项目代码库，生成或增量更新架构文档（docs/architecture/）和功能文档（docs/features/）。架构文档关注设计与实现，功能文档关注支持什么、怎么用、具体细节。"
---

# 更新架构文档与功能文档

智能生成和增量更新项目文档，包含两个维度：
- **架构文档**（`docs/architecture/`）— 模块怎么设计的、怎么实现的
- **功能文档**（`docs/features/`）— 模块支持什么功能、怎么用、具体参数和行为

---

## 使用场景

* 新功能开发完成后，更新对应模块文档
* 重大重构后，刷新受影响的文档
* 新成员入职时，首次生成全套文档
* 审查项目结构时
* 用户询问「XX 支持哪些操作」「XX 怎么用」时

---

## 文档体系

```
docs/
├── architecture/          # 架构文档：设计、实现、数据流
│   ├── README.md          # 总体架构概览
│   ├── browser-command.md
│   ├── input-pipeline.md
│   ├── ai-adapters.md
│   ├── state-management.md
│   ├── background-service.md
│   ├── content-script.md
│   ├── translation.md
│   ├── voice.md
│   ├── storage.md
│   └── file-parsing.md
│
└── features/              # 功能文档：支持什么、怎么用、细节
    ├── README.md          # 功能总览索引
    ├── browser-commands.md    # 浏览器命令参考（16 种操作）
    ├── automation-actions.md  # 语音自动化操作参考
    ├── input-system.md        # 输入系统（路由、意图检测、管线）
    ├── ai-providers.md        # AI 适配器配置与能力
    ├── voice-features.md      # 语音功能（识别、TTS、命令）
    ├── file-features.md       # 文件功能（解析、生成、OCR）
    └── translation-features.md # 翻译功能（三种模式）
```

### 两类文档的分工

| 维度 | 架构文档 | 功能文档 |
|------|---------|---------|
| 关注点 | 怎么设计的、为什么这样设计 | 支持什么、怎么用、具体行为 |
| 读者 | 开发者（理解代码结构） | 开发者 + 用户（了解能力边界） |
| 内容 | 分层图、类图、数据流、设计决策 | 功能清单、参数说明、使用示例、边界行为 |
| 图表 | Mermaid 架构图、序列图 | 参数表格、流程图、示例代码 |

---

## 两种模式

### 模式 A：首次全量生成

当 `docs/architecture/` 或 `docs/features/` 目录不存在或为空时，执行全量扫描和生成。

### 模式 B：增量更新（默认）

当两个目录都已有文档时，执行增量更新：
1. 检测哪些模块的代码发生了变化
2. 只重写有变化的模块文档（架构 + 功能同步更新）
3. 更新两个 README.md 中的模块列表
4. 未变化的文档保持原样

---

## 模块与源文件映射

### 架构文档映射

| 文档 | 源文件 |
|------|--------|
| `README.md` | `package.json`, `entrypoints/background.ts`, `entrypoints/content/index.ts`, `entrypoints/content/App.vue`, 所有模块的关键导出文件 |
| `browser-command.md` | `src/browser/types.ts`, `src/browser/skeleton.ts`, `src/browser/action-executor.ts`, `src/browser/local-html.ts`, `src/browser/index.ts` |
| `input-pipeline.md` | `src/input/types.ts`, `src/input/router.ts`, `src/input/intent-detector.ts`, `src/input/pipeline.ts`, `src/input/tag-parser.ts`, `src/input/prompts.ts`, `src/input/index.ts` |
| `ai-adapters.md` | `src/adapters/base.ts`, `src/adapters/openai.ts`, `src/adapters/qwen.ts`, `src/adapters/wenxin.ts`, `src/adapters/gemini.ts`, `src/adapters/doubao.ts`, `src/adapters/proxy.ts`, `src/adapters/index.ts` |
| `state-management.md` | `src/stores/settings.ts`, `src/stores/conversations.ts`, `src/stores/voice.ts` |
| `background-service.md` | `entrypoints/background.ts` |
| `content-script.md` | `entrypoints/content/index.ts`, `entrypoints/content/App.vue`, `entrypoints/content/components/**/*.vue` |
| `translation.md` | `src/browser/translate-service.ts`, `src/browser/translate-popup.ts`, `src/browser/translate-click.ts`, `src/browser/translate-parser.ts` |
| `voice.md` | `src/voice/**/*` |
| `storage.md` | `src/storage/index.ts` |
| `file-parsing.md` | `src/utils/file-parsers.ts`, `src/utils/file-type.ts`, `src/utils/file-generators.ts`, `src/utils/file-tag-parser.ts`, `src/utils/echart-renderer.ts`, `src/utils/ocr.ts` |

### 功能文档映射

| 文档 | 源文件 |
|------|--------|
| `README.md` | 所有功能文档 |
| `browser-commands.md` | `src/browser/types.ts`（Command/SkeletonElement/ActionResult 类型）, `src/browser/action-executor.ts`（所有 action 实现）, `src/browser/skeleton.ts`（骨架提取逻辑）, `src/input/prompts.ts`（CAPABILITY_DOMAIN_LIST） |
| `automation-actions.md` | `src/automation/actions.ts`, `src/automation/selectors.ts`, `src/voice/commandParser.ts` |
| `input-system.md` | `src/input/router.ts`, `src/input/intent-detector.ts`, `src/input/pipeline.ts`, `src/input/tag-parser.ts`, `src/input/prompts.ts`, `src/input/types.ts` |
| `ai-providers.md` | `src/adapters/*.ts`, `src/types.ts`（Provider/ModelConfig/AppSettings）, `src/local-config.json` |
| `voice-features.md` | `src/voice/recognition.ts`, `src/voice/sherpa-recognition.ts`, `src/voice/broadcast.ts`, `src/voice/session.ts`, `src/voice/commandParser.ts`, `src/stores/voice.ts` |
| `file-features.md` | `src/utils/file-parsers.ts`, `src/utils/file-type.ts`, `src/utils/file-generators.ts`, `src/utils/file-tag-parser.ts`, `src/utils/echart-renderer.ts`, `src/utils/ocr.ts`, `src/utils/file.ts` |
| `translation-features.md` | `src/browser/translate-service.ts`, `src/browser/translate-popup.ts`, `src/browser/translate-click.ts`, `src/browser/translate-parser.ts`, `src/browser/code-filter.ts`, `src/input/prompts.ts`（TRANSLATE_SYSTEM_PROMPT） |

---

## 实现步骤

当 skill 被调用时，按以下步骤执行：

### 第一步：判断模式

检查 `docs/architecture/` 和 `docs/features/` 目录：
- **任一不存在或为空** → 进入模式 A（全量生成）
- **都已有文档** → 进入模式 B（增量更新）

### 第二步：检测变化（仅模式 B）

对每个模块，执行以下操作：

1. 使用 `git diff --name-only HEAD~1` 或检查文件内容，识别自上次文档更新以来哪些源文件发生了变化
2. 构建变化映射：`{ 文档名: [变化的源文件列表] }`
3. 如果没有检测到 git 历史，退化为全量读取源文件，与现有文档内容对比关键签名/结构是否匹配

**变化检测策略（按优先级）：**

```
策略 1: git diff（最可靠）
  - 检查 docs/ 中文档的最后 git 提交时间
  - 对比源文件在该时间之后是否有新提交
  - git log --since="<doc_last_commit_time>" -- <source_file>

策略 2: 文件修改时间对比（fallback）
  - 对比源文件的 mtime 与对应文档的 mtime
  - 源文件更新 → 需要重新生成该文档

策略 3: 内容结构对比（最终 fallback）
  - 读取现有文档中的关键方法签名
  - 读取源文件中的实际方法签名
  - 不匹配 → 需要更新
```

**向用户报告变化摘要：**
```
检测到以下模块需要更新：
  - input-pipeline.md（src/input/router.ts 新增了 redirect 方法）
  - browser-commands.md（action-executor.ts 新增了 video action）
  - translation.md（src/browser/translate-click.ts 重构）

以下模块无需更新：
  - ai-adapters.md, state-management.md, ...
```

### 第三步：读取源文件

**模式 A：** 读取所有源文件（见模块映射表）

**模式 B：** 只读取有变化的模块对应的源文件。对于两个 `README.md`，始终检查是否需要更新。

### 第四步：生成/更新文档

#### 4.1 架构文档（docs/architecture/）

保持原有结构不变，每个文档包含：
1. **目标** — 这个模块做什么
2. **架构概览** — 分层架构图（Mermaid）
3. **核心设计决策** — 关键选择和原因
4. **详细实现** — 每个部分如何工作
5. **数据流** — 序列图/流程图（Mermaid）
6. **关键方法签名** — 重要 API
7. **错误处理** — 如何处理错误
8. **目录结构** — 文件组织

#### 4.2 功能文档（docs/features/）— 新增

每个功能文档遵循统一结构：

```markdown
# [模块名] 功能参考

## 功能总览
一句话概括 + 功能清单表格

## 功能 1：[名称]

### 用途
这个功能解决什么问题

### 怎么使用
调用方式、触发条件、用户操作路径

### 参数/配置
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|

### 具体行为
- 正常情况下的行为
- 边界情况和特殊处理
- 错误情况

### 示例
代码片段或操作步骤

## 功能 2：[名称]
...
```

#### 4.3 各功能文档的具体内容要求

##### browser-commands.md — 浏览器命令参考

必须包含以下内容：

**命令总览表格：**
| Action | 用途 | 需要骨架 | 需要元素ID | 参数 |

**16 种 Action 逐一说明：**

1. **click** — 点击元素
   - 参数：`elementId`, `fallbackSelector`, `text`（三级查找）
   - 行为：完整鼠标事件序列（mousedown → focus → mouseup → click）
   - 特殊：label 点击自动转发到关联表单元素

2. **type** — 输入文本
   - 参数：`elementId`, `text`
   - 行为：使用 native value setter（绕过 React/Vue 受控组件）
   - 特殊：自动聚焦目标元素

3. **clear** — 清空输入
   - 参数：`elementId`
   - 行为：清空 input/textarea 的值

4. **scroll** — 页面滚动
   - 参数：`direction`（up/down/left/right）, `amount`（像素）
   - 行为：平滑滚动指定方向和距离

5. **navigate** — 导航到 URL
   - 参数：`url`
   - 行为：通过 background 的 tab-action 打开（避免弹窗拦截）
   - 特殊：同域直接跳转，跨域通过新标签页

6. **select** — 下拉选择
   - 参数：`elementId`, `text`
   - 行为：选中 option 的文本匹配

7. **keyboard / press** — 键盘按键
   - 参数：`key`（键名）, `description`
   - 行为：映射 key 名到 KeyboardEvent.code
   - 特殊：Enter 键自动触发表单提交

8. **focus** — 聚焦元素
   - 参数：`elementId`
   - 行为：focus() + focusin 事件

9. **hover** — 悬停元素
   - 参数：`elementId`
   - 行为：mouseenter → mouseover 事件序列

10. **wait** — 等待
    - 参数：`ms`（毫秒）
    - 行为：setTimeout 延迟

11. **newTab** — 新标签页
    - 参数：`url`（可选）
    - 行为：通过 background 创建新标签页

12. **closeTab** — 关闭标签页
    - 参数：无
    - 行为：关闭当前标签页

13. **switchTab** — 切换标签页
    - 参数：`tabQuery`（关键词）
    - 行为：按关键词匹配标签页标题/URL，支持站点别名
    - 别名表：bilibili→bilibili.com, taobao→taobao.com, jd→jd.com 等

14. **nextTab / prevTab** — 前后切换标签页
    - 参数：无
    - 行为：相对切换

15. **video** — 视频控制
    - 参数：`subAction`（play/pause/volume/mute/unmute/seek/jump/speed/fullscreen）, `value`
    - 子操作详解：
      - play/pause：播放/暂停
      - volume(0-1)：设置音量
      - mute/unmute：静音/取消静音
      - seek(seconds)：跳转到指定时间
      - jump(seconds)：相对跳转（正/负）
      - speed(rate)：设置播放速率
      - fullscreen：切换全屏

**元素查找机制（三级降级）：**
1. elementId（data-skeleton-id）→ 精确匹配
2. fallbackSelector（CSS 选择器）→ 选择器匹配
3. text（文本内容）→ 模糊匹配

**骨架提取规则：**
- 可交互元素判定：原生标签（a/button/input/select/textarea/label/summary/details）、contenteditable、onclick、role 属性、tabindex、cursor:pointer
- 可见性检查、视口边界检查、父子去重
- 视口骨架最多 200 元素，全页骨架无限制
- 同源 iframe 支持
- 模态框检测（dialog、ARIA modal、Bootstrap/Element UI/Ant Design/Material/Vuetify）

##### automation-actions.md — 语音自动化操作

必须包含：

**操作总览：**
| 操作 | 用途 | 参数 | 触发方式 |

**8 种操作逐一说明：**
1. `open_site` — 打开网站（参数：url）
2. `search` — 百度搜索（参数：query）
3. `site_search` — 站内搜索（参数：query）
4. `open_item` — 点击第 N 个搜索结果（参数：index）
5. `page_next` — 翻到下一页
6. `page_prev` — 翻到上一页
7. `video_play` — 播放视频
8. `video_pause` — 暂停视频

**选择器适配表：**
| 站点 | 搜索输入框 | 搜索结果 | 翻页按钮 |
|------|-----------|---------|---------|
| 百度 | #kw | .result h3 a | #page .nxt |
| Google | input[name=q] | #search .g a | #pnnext |
| Bing | #sb_form_q | #b_results .b_algo h2 a | .b_pag a.sb_pagN |
| 通用 | input[type=search], input[name=q], ... | ... | ... |

**命令解析格式：**
语音 AI 回复中的命令标签：`【code】type:params【/code】`

##### input-system.md — 输入系统

必须包含：

**路由规则：**
| 输入前缀 | 路由目标 | 示例 |
|---------|---------|------|
| `/` | 内置命令 | `/stop`, `/pause`, `/resume`, `/list`, `/help` |
| 其他 | AI 意图检测 | 任意自然语言 |

**内置命令说明：**
| 命令 | 用途 |
|------|------|
| `/stop` | 停止当前操作 |
| `/pause` | 暂停执行 |
| `/resume` | 恢复执行 |
| `/list` | 列出可用命令 |
| `/help` | 显示帮助 |

**Phase 1 意图检测：**
- 输入：用户文本 + 历史上下文（最近 6 条消息）
- AI 输出四种格式：
  1. `[command]{...}[/command]` — 快速命令，直接执行
  2. `[action]` — 需要页面操作，进入 Phase 2
  3. `[FILE:xxx]...[/FILE]` — 文件生成请求
  4. 直接回复 — 纯聊天

**Phase 2 命令执行：**
- 输入：用户文本 + 页面骨架
- AI 输出三种格式：
  1. `[command]{...}[/command]` — 执行命令
  2. `[need_full]` — 请求全页骨架
  3. `[need_input]{...}[/need_input]` — 请求用户输入
- 执行模式：流式循环（每次 AI 返回 1 个命令 → 执行 → 反馈 → 下一个）
- 最大步数：20 步
- 错误处理：重试（最多 3 次）、去重、跨标签页任务传递

**Command JSON 结构：**
```json
{
  "action": "click",
  "elementId": "e5",
  "fallbackSelector": "#submit-btn",
  "text": "提交",
  "url": "https://...",
  "key": "Enter",
  "direction": "down",
  "amount": 500,
  "ms": 1000,
  "description": "点击提交按钮",
  "tabAction": "newTab",
  "tabQuery": "google",
  "done": true,
  "subAction": "play",
  "value": 0.8
}
```

##### ai-providers.md — AI 适配器

必须包含：

**支持的 Provider 列表：**
| Provider | 适配器类 | API 格式 | 特殊能力 |
|----------|---------|---------|---------|
| openai | OpenAIAdapter | OpenAI Chat Completions | — |
| anthropic | OpenAIAdapter | Anthropic Messages | thinking/reasoning delta |
| gemini | GeminiAdapter | Google Generative Language | systemInstruction, thinking model |
| qwen | QwenAdapter | DashScope | 独立 system 字段 |
| wenxin | WenxinAdapter | /chat/completions | result 字段, is_end |
| doubao | DoubaoAdapter | OpenAI 兼容 | — |
| zhipu | OpenAIAdapter | OpenAI 兼容 | — |
| deepseek | OpenAIAdapter | OpenAI 兼容 | — |
| moonshot | OpenAIAdapter | OpenAI 兼容 | — |
| grok | OpenAIAdapter | OpenAI 兼容 | — |
| custom | OpenAIAdapter | OpenAI 兼容 | 自定义 baseUrl |

**配置参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| provider | Provider | AI 提供商标识 |
| baseUrl | string | API 基础 URL |
| apiKey | string | API 密钥 |
| modelName | string | 模型名称 |
| messages | ChatMessage[] | 消息数组 |
| signal | AbortSignal | 中止信号 |

**代理机制：**
所有 API 请求通过 `proxyFetchStream()` 经 background Service Worker 中转，规避 CORS 限制。流式传输基于 requestId 的 chunk 转发。

##### voice-features.md — 语音功能

必须包含：

**语音识别：**
| 引擎 | 类型 | 语言 | 特点 |
|------|------|------|------|
| Web Speech API | 在线 | 多语言 | 连续模式、自动重启、interim 结果 |
| Sherpa-ONNX | 离线 | 中英双语 | WebAssembly、16kHz、本地处理 |

**语音合成（TTS）：**
- Web Speech Synthesis API
- speak(text) 返回 Promise
- 支持 cancel、onStart/onEnd 回调

**语音会话状态机：**
```
IDLE → LISTENING → PROCESSING → SPEAKING → IDLE（循环）
```
- 优先使用 Sherpa 本地识别，降级到 Web Speech API
- 识别文本 + 页面上下文发送给 AI
- 解析 AI 回复中的命令标签
- 串行执行自动化操作
- TTS 播报结果
- 解析失败重试（最多 3 次）

**语音命令格式：**
AI 回复中的命令：`【code】type:params【/code】`
支持 8 种命令类型（同 automation-actions.md）

##### file-features.md — 文件功能

必须包含：

**文件解析支持：**
| 类型 | 格式 | 大小限制 | 处理方式 |
|------|------|---------|---------|
| image | png/jpg/gif/webp/svg | 20MB | dataURL + 可选 OCR |
| text | txt/md/csv/log | 2MB | 直接读取 |
| code | 60+ 语言扩展名 | 2MB | 语法高亮语言检测 |
| pdf | pdf | 10MB | pdfjs-dist 提取文本 |
| word | doc/docx | 10MB | mammoth 转 HTML |
| excel | xlsx/xls | 10MB | xlsx 解析 |
| binary | 其他 | 10MB | 文本降级 |

**OCR 能力：**
- Tesseract.js 引擎
- 语言：chi_sim + eng
- 超时：30 秒
- 语言包从扩展本地路径加载

**文件生成：**
| 格式 | 函数 | 说明 |
|------|------|------|
| XLSX | generateXlsx() | 从数据生成 Excel |
| CSV→XLSX | generateXlsxFromCsv() | CSV 转 Excel |
| DOCX | generateDocx() | 生成 Word 文档 |
| PDF | generatePdf() | html2canvas + jsPDF，A4 分页 |
| Markdown→PDF | generatePdfFromMarkdown() | Markdown 转 PDF |

**[FILE] 标签系统：**
AI 回复中的文件标签：`[FILE:type:name]...[/FILE]`
- type：text / data / excel / json / pdf / chart
- 下载方式：text→Blob, data→DataURL, excel→XLSX, json→JSON, pdf→PDF, chart→PNG

**ECharts 图表：**
- 动态加载 ECharts 库
- 支持渲染到 Canvas/SVG/Blob
- 模板函数：柱状图、折线图、饼图、雷达图
- 图表配置解析和验证

##### translation-features.md — 翻译功能

必须包含：

**三种翻译模式：**
| 模式 | 触发方式 | 实现 |
|------|---------|------|
| 选中翻译 | 鼠标选中文本 | translate-popup.ts（浮动弹窗） |
| 点击翻译 | 点击文本块 | translate-click.ts（段落下方显示） |
| 自动翻译 | 页面滚动/加载 | translate-service.ts（IntersectionObserver） |

**代码过滤（三层）：**
1. 标签黑名单：pre, code, samp
2. 类名黑名单：hljs, language-*, code-block, highlight, syntax, prism, shiki, codemirror, ace_
3. 正则匹配：注释、反引号、URL、CLI 命令、JSON、函数调用、属性链、花括号/方括号块、关键字、版本号、文件路径

代码替换为 `{{code_N}}` 占位符，翻译后恢复。

**翻译响应解析（三层降级）：**
1. 直接 JSON 解析
2. 正则提取 JSON
3. 逐行解析

**配置项：**
- 翻译模式切换（选中/点击/自动）
- 目标语言
- API 配置（复用 AI 适配器）

---

#### 4.4 README.md 生成规则

**架构 README（docs/architecture/README.md）：**
- 项目概述、技术栈、分层架构图（Mermaid）
- 模块列表和描述
- 数据流概览、关键设计决策

**功能 README（docs/features/README.md）：**
- 功能分类总览
- 快速查找表（「我想做 XX → 看哪个文档」）
- 每个功能文档的一句话摘要

```markdown
# 功能文档索引

## 快速查找

| 我想... | 参考文档 |
|---------|---------|
| 用 AI 自动点击页面元素 | browser-commands.md → click |
| 让 AI 帮我填表单 | browser-commands.md → type + select |
| 控制页面上的视频 | browser-commands.md → video |
| 语音控制浏览器 | voice-features.md |
| 翻译整个页面 | translation-features.md → 自动翻译 |
| 解析上传的 PDF 文件 | file-features.md → 文件解析 |
| 让 AI 生成 Excel 文件 | file-features.md → [FILE] 标签 |
| 配置新的 AI 模型 | ai-providers.md |
| 了解输入命令的处理流程 | input-system.md |

## 文档列表
...
```

### 第五步：生成 Mermaid 图表

**架构文档** — 保持原有图表类型（架构图、序列图、类图）

**功能文档** — 使用更适合说明功能的图表：
- 流程图：展示功能执行流程
- 状态图：展示状态转换（如语音会话状态机）
- 决策图：展示路由/判断逻辑

### 第六步：写入文档

- **模式 A：** 使用 Write 工具创建所有文档
- **模式 B：** 使用 Edit 工具对有变化的部分进行局部修改；如果变化超过 60%，退化为 Write 全量重写该文档

### 第七步：同步根目录 README.md

每次更新文档后，将 `docs/architecture/README.md` 的最新内容同步到项目根目录 `README.md`。根目录 README 是项目的门面，必须与架构文档保持一致。模块链接路径使用 `./docs/architecture/` 前缀。

同时在根目录 README 中添加功能文档的链接：`📖 [功能文档](./docs/features/)`

### 第八步：报告更新摘要

输出本次更新的总结：

```
✅ 文档更新完成

更新模式：增量更新

架构文档更新：
  - input-pipeline.md（router.ts 新增 redirect 方法）
  - translation.md（translate-click.ts 重构）

功能文档更新：
  - browser-commands.md（action-executor.ts 新增 video action）
  - input-system.md（pipeline.ts 新增 need_input 处理）

跳过文档：ai-adapters.md, state-management.md, ...（共 N 个）
README.md：已更新模块列表和功能索引

变更详情：
  browser-commands.md:
    + 新增 video action 完整说明（7 个子操作）
    + 新增 fullscreen 子操作

  input-system.md:
    ~ 更新 need_input 流程说明
    ~ 更新最大步数（10 → 20）
```

---

## 文档质量要求

### 架构文档
* 使用 Mermaid 生成所有图表
* 专注于设计和实现，不是 API 参考
* 基于实际代码，不是设计文档
* 每个文档应该独立完整、可读
* 在有帮助的地方包含代码片段
* 保持图表简单、聚焦

### 功能文档（新增要求）
* **完整性**：列出所有支持的功能/操作，不遗漏
* **准确性**：参数类型、默认值、边界行为必须与代码一致
* **可操作性**：每个功能都要有使用示例或调用方式
* **细节到位**：
  - 浏览器命令：每个 action 的参数、行为、特殊处理
  - 自动化操作：每个操作的参数、选择器适配
  - 输入系统：路由规则、Phase1/Phase2 的输入输出格式
  - AI 适配器：每个 Provider 的差异和特殊配置
  - 语音功能：识别引擎对比、状态机、命令格式
  - 文件功能：支持格式、大小限制、生成方式
  - 翻译功能：三种模式差异、代码过滤规则
* 增量更新时保留原文的措辞风格，只改有变化的部分

---

## 特殊情况处理

### 新增模块

当发现源码中有新的模块目录但文档目录中没有对应文档时：
1. 自动生成对应的架构文档和功能文档
2. 在两个 README.md 中添加条目

### 删除模块

当文档目录中有文档但对应源码目录已不存在时：
1. 自动删除该孤立文档
2. 从两个 README.md 中移除对应条目

### 新增功能到现有模块

当现有模块新增了功能（如 action-executor.ts 新增了一种 action）：
1. 更新架构文档（如有设计变化）
2. 重点更新功能文档（新增功能的完整说明）
3. 更新功能 README 的快速查找表

### 无法判断变化

如果 git diff 和文件修改时间都无法判断，退化为全量对比模式：读取每个模块的源文件，与现有文档对比关键结构，有差异则更新。
