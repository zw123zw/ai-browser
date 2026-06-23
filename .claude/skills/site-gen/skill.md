---
name: site-gen
description: "扫描项目代码和 PRD，生成使用指南（guide.md + guide.html），输出到 docs/site/ 文件夹。支持增量更新。"
---

# Site Gen — 使用文档生成

扫描项目代码库，提取所有用户可见功能，生成使用指南，输出到 `docs/site/` 文件夹。

## 输出文件

```
docs/site/
├── guide.html    # 使用指南 HTML
└── guide.md      # 使用指南 Markdown
```

> **注意：** 首页 `index.html` 手动维护，此技能不生成也不修改。

## 触发命令

- `/site-gen` — 生成 guide.md + guide.html（首次全量，后续增量）

---

## 项目信息来源

从 `package.json` 读取：

| 字段 | 用途 |
|------|------|
| `name` | 产品名称 |
| `description` | 产品描述 |
| `author.name` | 作者 |
| `license` | 许可证 |
| `homepage` | 项目主页链接 |
| `repository.url` | 仓库地址 |

**版本号规则：** `git tag --sort=-creatordate | head -1`，无 tag 回退到 `package.json` 的 `version`。

---

## 核心原则

- **覆盖所有产品功能** — 每个按钮、每个交互、每个状态都要写到
- **以用户视角描述** — 不写内部实现，只写"是什么、怎么用、有什么效果"
- **每个功能配触发示例** — 用户该怎么说/输入才能触发对应功能
- **截图标记保留** — `📸 截图：xxx` 方便后续补图
- **HTML 自包含** — 单文件、内联样式、无外部依赖，可离线浏览

---

## 增量更新机制

### 首次检测

检查 `docs/site/guide.md` 是否存在：
- **不存在** → 全量生成
- **存在** → 增量更新

### 章节与源文件映射

guide.md 的每个章节对应一组源文件，用于增量检测：

| 章节 | 关键源文件 |
|------|-----------|
| 快速开始 | `package.json`, `entrypoints/content/index.ts`, `entrypoints/content/App.vue` |
| AI 对话 | `src/input/pipeline.ts`, `src/input/router.ts`, `src/composables/usePipeline.ts`, `entrypoints/content/components/ChatPanel.vue`, `entrypoints/content/components/MessageList.vue`, `entrypoints/content/components/InputBar.vue`, `entrypoints/content/components/EmptyChat.vue` |
| 网页自动化 | `src/automation/**/*`, `src/browser/action-executor.ts`, `src/browser/skeleton.ts` |
| 语音控制 | `src/voice/**/*`, `entrypoints/content/components/VoicePanel.vue` |
| 智能翻译 | `src/browser/translate-service.ts`, `src/browser/translate-popup.ts`, `src/browser/translate-click.ts`, `src/browser/translate-parser.ts` |
| 文件处理 | `src/utils/file-parsers.ts`, `src/utils/file-type.ts`, `src/utils/file-generators.ts`, `src/utils/file-tag-parser.ts`, `src/utils/ocr.ts` |
| 图表生成 | `src/utils/echart-renderer.ts`, `src/utils/file-generators.ts` |
| 设置说明 | `entrypoints/content/components/SettingsModal.vue`, `src/stores/settings.ts`, `src/themes.ts` |
| 主题 | `src/themes.ts`, `src/styles/global.css` |
| 快捷命令 | `src/input/prompts/common.ts`, `src/input/tag-parser.ts` |
| 使用技巧 | 依赖以上所有模块变化 |
| 常见问题 | 依赖以上所有模块变化 |

### 增量更新流程

```
1. 读取现有 guide.md，按 ## 标题拆分为章节列表
2. 用 git diff 或文件 mtime 检测自上次生成以来哪些源文件有变化
3. 匹配章节映射表，确定需要更新的章节集合
4. 只重新生成有变化的章节内容（读取对应源文件 → 重新写该章节）
5. 未变化的章节保留原样
6. 检测新增模块（有源文件但无对应章节）→ 追加新章节
7. 检测已删除功能（有章节但源文件已不存在）→ 移除该章节
8. 基于更新后的 guide.md 重新生成 guide.html
```

### 变化检测方式

优先使用 `git diff`（精确），回退到文件 mtime：

```bash
# 方式1：git diff 检测变化的源文件
git diff --name-only HEAD~1 -- src/ entrypoints/ | head -50

# 方式2：检测最近修改的文件（fallback）
find src/ entrypoints/ -name "*.ts" -o -name "*.vue" -newer docs/site/guide.md | head -50
```

### 增量报告

每次执行后输出：

```
✅ 使用指南更新完成（增量模式）

检测变化：N 个源文件
更新章节：X 个（列出章节名）
新增章节：Y 个（如有）
删除章节：Z 个（如有）
未变更章节：W 个（跳过）

文档：docs/site/guide.md + guide.html
```

---

## 执行流程

### Step 0: 读取项目信息

```bash
cat package.json
git tag --sort=-creatordate | head -1
```

### Step 1: 判断模式

检查 `docs/site/guide.md` 是否存在：
- 不存在 → **全量模式**，执行 Step 2a
- 存在 → **增量模式**，执行 Step 2b

### Step 2a: 全量扫描

并行读取所有组件和功能入口文件：

| 目的 | 路径 |
|------|------|
| UI 组件 | `entrypoints/content/components/*.vue` |
| 命令定义 | `src/input/prompts/common.ts` |
| 浏览器命令 | `src/browser/action-executor.ts` |
| AI 提供商 | `src/types.ts` (Provider, AppSettings) |
| 语音命令 | `src/voice/commandParser.ts` |
| 翻译功能 | `src/browser/translate-service.ts`, `src/browser/translate-click.ts` |
| 文件类型 | `src/utils/file-parsers.ts`, `src/utils/file-type.ts` |
| 主题 | `src/themes.ts` |
| PRD | `.trellis/tasks/*/prd.md` |

扫描时提取每个组件的：
- 所有可见 UI 元素（按钮、图标、文字、标签）
- 所有用户交互（点击、拖拽、键盘、粘贴）
- 所有状态变化和视觉反馈
- 所有提示文字和默认值

### Step 2b: 增量扫描

```bash
# 检测变化的源文件
git diff --name-only HEAD~1 -- src/ entrypoints/ 2>/dev/null || \
find src/ entrypoints/ -name "*.ts" -o -name "*.vue" -newer docs/site/guide.md
```

1. 读取现有 `docs/site/guide.md`，按 `##` 标题拆分为章节
2. 匹配章节映射表，确定需要更新的章节
3. 只读取变化章节对应的源文件
4. 检测新增模块/已删除模块

### Step 3: 生成使用指南（guide.md + guide.html）

> **⚠️ 强制规则：每次执行必须同时更新 guide.md 和 guide.html，禁止只更新其中一个。**
> **⚠️ 强制规则：guide.html 必须基于最新的 guide.md 内容生成，内容必须完全一致。**

**全量模式** — 完整生成 `docs/site/guide.md`，结构：

```
# {产品名称} 使用指南

> {产品描述}

## 1. 🚀 快速开始
## 2. 💬 AI 对话
## 3. 🌐 网页自动化
## 4. 🎤 语音控制
## 5. 🌍 智能翻译
## 6. 📎 文件处理
## 7. 📊 图表生成与文件输出
## 8. ⚙️ 设置说明
## 9. 🎨 主题
## 10. ⌨️ 快捷命令
## 11. 💡 使用技巧
## 12. ❓ 常见问题
```

**增量模式** — 只替换有变化的章节，保留未变化的。

**每个章节必须包含「触发示例」区块：**

```markdown
> **💡 试试这样说：**
>
> - "滚动到页面底部"
> - "帮我打开百度，搜索 AI 新闻"
> - "/navigate https://github.com"
```

**再基于 MD 生成/更新 `docs/site/guide.html`**，要求：
- 单文件自包含（CSS 内联，无外部依赖）
- 左侧固定目录导航 + 顶部搜索框
- 表格斑马纹、代码块复制按钮
- 深色/浅色主题切换
- 页头：SVG Logo + 产品名称（package.json）+ 版本号（git tag）
- 页脚：`← 返回首页`（链接 index.html）+ GitHub + 下载 + 生成日期
- 触发示例用 `.trigger-tip` 样式（💡 图标 + 蓝色左边框）

---

## 内容标准

每个功能必须包含：
1. **是什么** — 一句话说明
2. **怎么用** — 操作步骤
3. **触发示例** — 用户该怎么说/输入（`> **💡 试试这样说：**`）
4. **使用示例** — 具体场景
5. **效果/反馈** — 操作后看到什么
6. **📸 截图** — 截图占位
7. **⚠️ 注意** — 仅在有坑时写

### 不写的内容

- ❌ 源文件路径、类名、函数名、变量名
- ❌ TypeScript 接口/类型定义
- ❌ 内部架构（适配器、骨架、SSE、存储 key）
- ❌ 实现参数（防抖间隔、重试次数、最大步数等）
- ❌ 开发命令（dev/build/test）
