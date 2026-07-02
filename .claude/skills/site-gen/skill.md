---
name: site-gen
description: "扫描项目代码和 PRD，生成中英文使用指南（guide-zh.md + guide-en.md），同步项目信息到 index.html、README.md、README-en.md 和 package.json，输出到 docs/site/ 和 public/ 文件夹。"
---

# Site Gen — 使用文档生成

扫描项目代码库，提取所有用户可见功能，生成使用指南。

## 输出文件

```
docs/site/                              public/
├── guide.html                          (渲染壳，引用 assets/guide-*.md)
├── index.html                          (首页，项目信息同步)
└── assets/       ──────────────────→   (整个文件夹拷贝到 public/)
    ├── guide-zh.md   ──────────────→   guide-zh.md   (中文，App 内文档 + Web 站)
    ├── guide-en.md   ──────────────→   guide-en.md   (英文，App 内文档 + Web 站)
    └── img/                            img/            (截图/图片资源)
        └── *.png                           └── *.png

README.md                               (中文版，项目信息 + 文档链接同步)
README-en.md                            (英文版，项目信息 + 文档链接同步)
package.json                            (项目根目录，项目信息同步)
```

> **本技能生成 `assets/guide-zh.md` 和 `assets/guide-en.md`，并同步 `index.html`、`README.md`、`README-en.md` 和 `package.json` 中的项目信息。**
> guide.html 和 assets/ 在同一个 docs/site/ 目录下，部署到 Cloudflare Pages 时路径天然正确，不需要拷贝。
> 扩展内弹框通过 Vite `?raw` import 打包，也不需要拷贝。

## 触发命令

- `/site-gen` — 生成 guide-zh.md + guide-en.md（首次全量，后续增量），同步项目信息到 index.html、README.md、README-en.md 和 package.json

---

## 项目信息来源

从 `package.json` 读取：

| 字段 | 用途 |
|------|------|
| `name` | 产品名称 |
| `description` | 产品描述 |
| `author.name` | 作者 |
| `author.email` | 联系邮箱 |
| `license` | 许可证 |
| `homepage` | 项目主页链接 |
| `repository.url` | 仓库地址 |
| `keywords` | 项目标签 |

**版本号规则：** `git tag --sort=-creatordate | head -1` 为权威来源，同步到 `package.json`、`index.html`、`README.md`。无 tag 时回退到 `package.json` 的 `version`。

---

## 核心原则

- **覆盖所有产品功能** — 每个按钮、每个交互、每个状态都要写到
- **以用户视角描述** — 不写内部实现，只写"是什么、怎么用、有什么效果"
- **每个功能配触发示例** — 用户该怎么说/输入才能触发对应功能
- **截图标记保留** — 每个 `##` 章节开头加 `📸 截图：[描述]` 方便后续补图
- **纯单语言** — guide-zh.md 只有中文，guide-en.md 只有英文，不混在一起

---

## 文件格式

### guide-zh.md 格式

```markdown
# 小灵 LingBot 使用指南

> AI 语音浏览器助手

**版本：** v1.4.1 | **许可证：** MIT

---

## 1. 🚀 快速开始

📸 截图：[扩展安装与首次配置界面]

### 1.1 安装扩展

安装扩展后，点击工具栏图标即可开始使用。

> **💡 试试这样说：**
>
> - "你好，介绍一下你自己"
```

### guide-en.md 格式

```markdown
# LingBot User Guide

> AI Voice Browser Assistant

**Version:** v1.4.1 | **License:** MIT

---

## 1. 🚀 Quick Start

📸 Screenshot: [Extension installation and initial setup flow]

### 1.1 Installation

After installing the extension, click the toolbar icon to get started.

> **💡 Try saying:**
>
> - "Hello, introduce yourself"
```

### 规则

- 两个文件结构完全对应（章节编号、标题层级一致）
- guide-zh.md：纯中文，无英文混排
- guide-en.md：纯英文，无中文混排
- 每个 `##` 章节开头加截图占位（中文用 `📸 截图：`，英文用 `📸 Screenshot:`）
- 触发示例：中文用 `> **💡 试试这样说：**`，英文用 `> **💡 Try saying：**`

---

## 增量更新机制

### 首次检测

检查 `docs/site/assets/guide-zh.md` 是否存在：
- **不存在** → 全量生成
- **存在** → 增量更新

### 章节与源文件映射

| 章节 | 关键源文件（用通配符覆盖目录下所有文件） |
|------|-----------|
| 快速开始 | `package.json`, `entrypoints/content/index.ts`, `entrypoints/content/App.vue` |
| AI 对话 | `src/input/**/*.ts`, `src/composables/usePipeline.ts`, `entrypoints/content/components/Chat*.vue`, `entrypoints/content/components/Message*.vue`, `entrypoints/content/components/Input*.vue`, `entrypoints/content/components/Empty*.vue` |
| 网页自动化 | `src/automation/**/*.ts`, `src/browser/action-executor.ts`, `src/browser/skeleton*.ts` |
| 语音控制 | `src/voice/**/*.ts`, `entrypoints/content/components/Voice*.vue` |
| 智能翻译 | `src/browser/translate-*.ts`, `src/browser/code-filter.ts` |
| 文件处理 | `src/utils/file-*.ts`, `src/utils/ocr.ts`, `src/utils/echart-renderer.ts` |
| 图表生成 | `src/utils/echart-renderer.ts`, `src/utils/file-generators.ts` |
| 设置说明 | `entrypoints/content/components/Settings*.vue`, `src/stores/settings.ts`, `src/themes.ts` |
| 主题 | `src/themes.ts`, `src/styles/global.css` |
| 快捷命令 | `src/input/prompts/**/*.ts`, `src/input/tag-parser.ts`, `src/input/router.ts` |
| 使用技巧 | 依赖以上所有模块变化 |
| 常见问题 | 依赖以上所有模块变化 |

### 增量更新流程

```
1. 读取现有 guide-zh.md，按 ## 标题拆分为章节列表
2. 用 git diff + git ls-files --others 检测自上次生成以来哪些源文件有变化
3. 匹配章节映射表，确定需要更新的章节集合
4. ★ 读取变化章节涉及的【所有】源文件（不是只读变化的文件），重新生成该章节
5. 未变化的章节保留原样
6. 检测新增模块（有源文件但无对应章节）→ 读取所有源文件，追加新章节
7. 检测已删除功能（有章节但源文件已不存在）→ 移除该章节
8. 同步更新 guide-en.md 中对应的英文章节
9. 生成文件保存到 docs/site/assets/（guide-zh.md + guide-en.md）
10. 不需要拷贝 — guide.html 和 assets/ 同目录，部署时路径天然正确
```

### 变化检测方式

```bash
# 三合一检查（必须同时检查已暂存、已修改、未跟踪文件）
git diff --name-only HEAD -- src/ entrypoints/ 2>/dev/null
git diff --name-only --cached -- src/ entrypoints/ 2>/dev/null
git ls-files --others --exclude-standard -- src/ entrypoints/ 2>/dev/null
# fallback: 文件 mtime
find src/ entrypoints/ -name "*.ts" -o -name "*.vue" -newer docs/site/assets/guide-zh.md
```

### 增量报告

```
✅ 使用指南更新完成（增量模式）

检测变化：N 个源文件
更新章节：X 个（列出章节名）
新增章节：Y 个（如有）
删除章节：Z 个（如有）
未变更章节：W 个（跳过）

文档：docs/site/assets/guide-zh.md + guide-en.md
同步：cp -r docs/site/assets public/assets（guide + 图片一起拷贝）
```

---

## 执行流程

### Step 0: 读取项目信息

```bash
cat package.json
git tag --sort=-creatordate | head -1
```

同步项目信息到 `index.html`、`README.md` 和 `package.json`（详见下方"项目信息同步"章节）。

### Step 1: 判断模式

检查 `docs/site/assets/guide-zh.md` 是否存在：
- 不存在 → **全量模式**，执行 Step 2a
- 存在 → **增量模式**，执行 Step 2b

### Step 2a: 全量扫描

并行读取所有组件和功能入口文件：

| 目的 | 路径（用 Glob 扫描，再逐个 Read） |
|------|------|
| UI 组件 | `entrypoints/content/components/*.vue` |
| 输入系统 | `src/input/**/*.ts` |
| 浏览器命令 | `src/browser/*.ts`（排除 `__tests__/` 和 `*.test.ts`） |
| AI 适配器 | `src/adapters/*.ts` |
| 语音功能 | `src/voice/**/*.ts` |
| 翻译功能 | `src/browser/translate-*.ts`, `src/browser/code-filter.ts` |
| 文件处理 | `src/utils/file-*.ts`, `src/utils/ocr.ts`, `src/utils/echart-renderer.ts` |
| 存储与状态 | `src/stores/*.ts`, `src/storage/**/*.ts`, `src/utils/storage-sync.ts` |
| 工具函数 | `src/utils/logger.ts`, `src/utils/cache.ts`, `src/utils/shortcut.ts`, `src/utils/markdown.ts` |
| 主题样式 | `src/themes.ts`, `src/styles/global.css` |
| 类型定义 | `src/types.ts` |
| PRD | `.trellis/tasks/*/prd.md` |

扫描时提取每个组件的：
- 所有可见 UI 元素（按钮、图标、文字、标签）
- 所有用户交互（点击、拖拽、键盘、粘贴）
- 所有状态变化和视觉反馈
- 所有提示文字和默认值

### Step 2b: 增量扫描

```bash
git diff --name-only HEAD -- src/ entrypoints/ 2>/dev/null
git diff --name-only --cached -- src/ entrypoints/ 2>/dev/null
git ls-files --others --exclude-standard -- src/ entrypoints/ 2>/dev/null
find src/ entrypoints/ -name "*.ts" -o -name "*.vue" -newer docs/site/assets/guide-zh.md
```

1. 读取现有 `docs/site/assets/guide-zh.md`，按 `##` 标题拆分为章节
2. 匹配章节映射表，确定需要更新的章节
3. ★ **读取变化章节对应的【所有】源文件**（不是只读变化的文件）
4. 检测新增模块/已删除模块

### ⚠️ 关键规则：必须读取章节涉及的所有源文件

**增量模式不等于只读变化的文件。** 当确定某个章节需要更新时：

1. 用 `Glob` 扫描该章节映射表中列出的**所有目录**下的 `.ts` / `.vue` 文件
2. 用 `Read` 逐个读取每个源文件的完整内容
3. 基于所有源文件的完整理解重新生成该章节

**示例：** "AI 对话"章节映射了 `src/input/` 和 `src/composables/`，如果 `pipeline.ts` 变了：
- ❌ 错误：只读 `pipeline.ts` → 重写章节
- ✅ 正确：读取 `src/input/` 下所有 `.ts` + `src/composables/usePipeline.ts` → 重写章节

### Step 3: 生成 guide-zh.md + guide-en.md

1. **先生成 `docs/site/assets/guide-zh.md`**（纯中文）
2. **再生成 `docs/site/assets/guide-en.md`**（纯英文，结构与中文版完全对应）
3. **不需要拷贝** — guide.html 和 assets/ 同目录，部署时路径天然正确

---

## 内容标准

每个功能必须包含：
1. **是什么** — 一句话说明
2. **怎么用** — 操作步骤
3. **触发示例** — 用户该怎么说/输入
4. **📸 截图** — 截图占位
5. **⚠️ 注意** — 仅在有坑时写

### 不写的内容

- ❌ 源文件路径、类名、函数名、变量名
- ❌ TypeScript 接口/类型定义
- ❌ 内部架构（适配器、骨架、SSE、存储 key）
- ❌ 实现参数（防抖间隔、重试次数、最大步数等）
- ❌ 开发命令（dev/build/test）

---

## 常见错误与避免

### ❌ 错误 1：只读变化的文件就写章节

```
# 错误做法
git diff → 发现 pipeline.ts 变了 → 只读 pipeline.ts → 重写"AI 对话"章节
```

**后果：** 遗漏 `router.ts`、`tag-parser.ts`、`usePipeline.ts` 等同章节文件的功能描述。

```
# 正确做法
git diff → 发现 pipeline.ts 变了 → 读取 src/input/ 下所有 .ts + src/composables/usePipeline.ts → 重写章节
```

### ❌ 错误 2：只检查 HEAD~1 的 diff

```
# 错误做法
git diff --name-only HEAD~1 -- src/
```

**后果：** 未 commit 的改动、多次 commit 的累积变化被遗漏。

```
# 正确做法（三合一检查）
git diff --name-only HEAD -- src/           # 已修改未暂存
git diff --name-only --cached -- src/       # 已暂存未提交
git ls-files --others --exclude-standard    # 未跟踪的新文件
```

### ❌ 错误 3：凭记忆写文档，不读源码

**后果：** 功能描述过时、触发示例错误、遗漏新增功能。

**规则：** 每次生成章节前，必须用 `Read` 工具读取源文件。读完再写，不读不写。

### ❌ 错误 4：中英文混在一个文件

**规则：** guide-zh.md 纯中文，guide-en.md 纯英文，不混排。

---

## 项目信息同步

`/site-gen` 执行时，除了生成使用指南，还会同步 `index.html`、`README.md`、`README-en.md` 和 `package.json` 中的项目信息。

### 同步字段

| 来源 | 目标文件 | 同步内容 |
|------|----------|----------|
| `git tag` → `package.json` | `package.json` | `version` 字段更新为最新 tag |
| `git tag` → `index.html` | `docs/site/index.html` | 版本号（hero-tag） |
| `git tag` → `README.md` | `README.md` | `**Version X.Y.Z**` |
| `git tag` → `README-en.md` | `README-en.md` | `**Version X.Y.Z**` |
| `package.json` → `index.html` | `docs/site/index.html` | 联系邮箱（footer）、产品名称 |
| `package.json` → `README.md` | `README.md` | 使用指南链接、架构文档链接、邮箱 |
| `package.json` → `README-en.md` | `README-en.md` | User Guide 链接、Architecture 链接、邮箱 |
| `docs/architecture/` → `README.md` | `README.md` | 扫描目录，同步架构文档链接列表 |
| `docs/architecture/` → `README-en.md` | `README-en.md` | 扫描目录，同步架构文档链接列表 |

### index.html 同步规则

1. **版本号**：从 `git tag` 或 `package.json` 的 `version` 读取，更新 `.hero-tag` 中的 `vX.Y.Z`
2. **联系邮箱**：从 `package.json` 的 `author.email` 读取，更新 footer 的 `mailto:` 链接
3. **产品名称**：保持 `package.json` 的 `name` 与页面标题一致
4. **页脚链接**：仅保留"使用指南"和"联系我们"

### README.md 同步规则（中文版）

1. **版本号**：从 `git tag` 读取，更新 `**Version X.Y.Z**`
2. **语言切换**：顶部有 `🌐 English` 链接指向 `README-en.md`
3. **使用指南链接**：指向 `./docs/site/guide-zh.md`
4. **架构文档链接**：指向 `./docs/architecture/README.md`
5. **模块文档表**：扫描 `docs/architecture/` 目录，列出所有 `xxx.md`（排除 `-en.md` 和 `README.md`）
6. **邮箱**：从 `package.json` 的 `author.email` 读取

### README-en.md 同步规则（英文版）

1. **版本号**：同 README.md
2. **语言切换**：顶部有 `🌐 中文` 链接指向 `README.md`
3. **User Guide 链接**：指向 `./docs/site/guide-en.md`
4. **Architecture 链接**：指向 `./docs/architecture/README-en.md`
5. **Module Docs 表**：扫描 `docs/architecture/` 目录，列出所有 `xxx-en.md`（排除 `README-en.md`）
6. **邮箱**：同 README.md

### package.json 同步规则

1. **version 字段**：以最新 git tag 为准，自动更新 `package.json` 的 `version`
2. **email 字段**：若 `author.email` 不存在，提示用户补充
3. **keywords 字段**：保持与页面 meta keywords 一致

### 同步流程

```
1. 读取 git tag，确定最新版本号（权威来源）
2. 读取 package.json，提取 author.email、keywords
3. 更新 package.json 的 version 为最新 git tag
4. 读取 docs/site/index.html，更新版本号、邮箱、关键词
5. 扫描 docs/architecture/ 目录，获取架构文档列表
6. 更新 README.md（版本号 + 语言切换 + 中文文档链接）
7. 更新 README-en.md（版本号 + 语言切换 + 英文文档链接）
8. 检查 package.json 的 author.email，缺失则提示
9. 输出同步报告
```

### 同步报告

```
✅ 项目信息同步完成

版本：v1.4.1 (来源：git tag)
邮箱：xiaoling6668882026@outlook.com
关键词：browser-extension, chrome-extension, ai, voice, automation, wxt, vue3, manifest-v3

更新文件：
- package.json（version: 1.3.1 → 1.4.1, author.email 已存在）
- docs/site/index.html（版本号、邮箱、关键词）
- README.md（版本号 + 12 个架构文档链接 + 使用指南链接）
- README-en.md（版本号 + 12 个架构文档链接 + User Guide 链接）
```
