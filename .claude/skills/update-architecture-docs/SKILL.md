---
name: update-architecture-docs
description: "扫描项目代码，生成/增量更新各模块架构文档中英文版本（docs/architecture/）。首次全量生成，后续只更新变化模块。"
---

# 架构文档生成

扫描项目代码，生成并维护架构文档到 `docs/architecture/`，每个模块生成中文 + 英文两份。首次全量生成，后续增量更新变化模块。

**核心原则：文档必须反映代码的真实状态。首次全量生成，后续只更新有变化的模块。每个模块中英文各一份。**

---

## 输出目录

```
docs/architecture/
├── README.md              # 总体架构概览（中文）
├── README-en.md           # 总体架构概览（英文）
├── browser-command.md     # 浏览器命令引擎（中文）
├── browser-command-en.md  # 浏览器命令引擎（英文）
├── input-pipeline.md      # 输入管线（中文）
├── input-pipeline-en.md   # 输入管线（英文）
├── ai-adapters.md         # AI 适配器（中文）
├── ai-adapters-en.md      # AI 适配器（英文）
├── state-management.md    # 状态管理（中文）
├── state-management-en.md # 状态管理（英文）
├── background-service.md  # 后台服务（中文）
├── background-service-en.md # 后台服务（英文）
├── content-script.md      # 内容脚本（中文）
├── content-script-en.md   # 内容脚本（英文）
├── translation.md         # 翻译系统（中文）
├── translation-en.md      # 翻译系统（英文）
├── voice.md               # 语音系统（中文）
├── voice-en.md            # 语音系统（英文）
├── storage.md             # 存储层（中文）
├── storage-en.md          # 存储层（英文）
├── file-parsing.md        # 文件处理（中文）
├── file-parsing-en.md     # 文件处理（英文）
└── utils.md               # 工具函数（中文）
└── utils-en.md            # 工具函数（英文）
```

### 命名规则

| 文件 | 语言 | 后缀 |
|------|------|------|
| `xxx.md` | 中文 | 无后缀 |
| `xxx-en.md` | 英文 | `-en` |

### 文档间导航

每个文档顶部添加语言切换链接：

中文文档顶部：
```markdown
> **🌐 English version: [xxx-en.md](./xxx-en.md)**
```

英文文档顶部：
```markdown
> **🌐 中文版本：[xxx.md](./xxx.md)**
```

---

## 模块与源文件映射

| 文档 | 源文件 |
|------|--------|
| `README.md` | `package.json`, `entrypoints/background.ts`, `entrypoints/content/index.ts`, `entrypoints/content/App.vue` |
| `browser-command.md` | `src/browser/*.ts`（排除 `__tests__/` 和 `*.test.ts`） |
| `input-pipeline.md` | `src/input/**/*.ts`, `src/composables/usePipeline.ts` |
| `ai-adapters.md` | `src/adapters/*.ts` |
| `state-management.md` | `src/stores/*.ts`, `src/utils/storage-sync.ts` |
| `background-service.md` | `entrypoints/background.ts` |
| `content-script.md` | `entrypoints/content/index.ts`, `entrypoints/content/App.vue`, `entrypoints/content/components/**/*.vue`, `src/composables/usePipeline.ts`, `src/composables/useToast.ts` |
| `translation.md` | `src/browser/translate-*.ts`, `src/browser/code-filter.ts` |
| `voice.md` | `src/voice/**/*.ts` |
| `storage.md` | `src/storage/**/*.ts`, `src/utils/storage-sync.ts` |
| `file-parsing.md` | `src/utils/file-*.ts`, `src/utils/echart-renderer.ts`, `src/utils/ocr.ts` |
| `utils.md` | `src/utils/logger.ts`, `src/utils/log-storage.ts`, `src/utils/cache.ts`, `src/utils/shortcut.ts`, `src/utils/markdown.ts` |

---

## 增量更新机制

### 首次检测

检查 `docs/architecture/README.md` 是否存在：
- **不存在** → 全量生成所有文档（中英文）
- **存在** → 增量更新

### 变化检测

```bash
# 方式1：git diff 检测变化的源文件（含未提交的改动）
git diff --name-only HEAD -- src/ entrypoints/
git diff --name-only --cached -- src/ entrypoints/
git ls-files --others --exclude-standard -- src/ entrypoints/

# 方式2：检测最近修改的文件（fallback）
find src/ entrypoints/ -name "*.ts" -o -name "*.vue" -newer docs/architecture/README.md
```

**注意：必须同时检查已暂存、已修改、未跟踪的文件，不能只看 HEAD~1。**

### 增量流程

```
1. 扫描 src/ 和 entrypoints/ 目录，获取当前所有模块
2. 读取 docs/architecture/ 已有文档列表（中文 + 英文）
3. 检测源文件变化（git diff + git ls-files --others）
4. ★ 检测缺失的英文版：遍历所有中文文档 xxx.md，检查 xxx-en.md 是否存在
5. 匹配模块映射表，确定需要更新的文档集合（源文件变化 + 缺失英文版）
6. ★ 读取需要更新模块的【所有】源文件（不是只读变化的文件），重新生成对应文档
7. 先生成中文版，再生成英文版（结构完全对应）
8. 检测新增模块（有目录但无文档）→ 读取所有源文件，生成中英文新文档
9. 检测已删除模块（有文档但源目录已不存在）→ 删除中英文孤立文档
10. 更新 README.md 和 README-en.md（模块列表可能变化）
```

### ⚠️ 缺失英文版 = 需要补充

**增量模式下，中文版存在但英文版缺失，必须补充生成。** 这不是"无变化跳过"，而是"缺失需要补齐"。

检测方式：
```
遍历 docs/architecture/*.md（排除 README.md 和 *-en.md）：
  对每个 xxx.md，检查 xxx-en.md 是否存在
  不存在 → 加入待生成列表，读取源文件，生成英文版
```

### ⚠️ 关键规则：必须读取模块内所有源文件

**增量模式不等于只读变化的文件。** 当确定某个模块需要更新时：

1. 用 `Glob` 扫描该模块目录下所有 `.ts` 文件（排除 `__tests__/` 和 `.test.ts`）
2. 用 `Read` 逐个读取每个源文件的完整内容
3. 基于所有源文件的完整理解生成文档

**禁止：只读 diff 中变化的 1-2 个文件就写文档。** 这会导致遗漏跨文件依赖、类型定义、设计模式。

### 新增模块处理

发现新的 `src/` 或 `entrypoints/` 子目录不在映射表中时：
1. 读取该模块所有源文件
2. 按文档内容标准生成架构文档
3. 文件名用 kebab-case（目录名转 kebab-case）
4. 添加到 README.md 的模块列表
5. 在映射表中记录对应关系

### 已删除模块处理

发现映射表中的源目录已不存在时：
1. 删除对应的文档文件
2. 从 README.md 的模块列表中移除

---

## 执行模式

### 全量模式（首次）

1. 并行读取所有源文件
2. 分析代码结构和依赖关系
3. 生成所有架构文档（先中文，再英文）

### 增量模式（后续）

1. 检测变化的源文件
2. 只读取变化模块的源文件
3. 只更新/新增/删除变化模块的文档（中英文同步）
4. 更新 README.md 和 README-en.md（如有模块增删）

### 增量报告

每次执行后输出：

```
✅ 架构文档更新完成（增量模式）

扫描文件：N 个
更新文档：M 篇 × 2 语言（列出文档名）
新增文档：X 篇 × 2 语言（列出新模块名）
删除文档：Y 篇 × 2 语言（如有）
未变更文档：Z 篇（跳过）

文档列表：
  - README.md + README-en.md（总体架构）
  - browser-command.md + browser-command-en.md
  - input-pipeline.md + input-pipeline-en.md
  - ...
```

---

## 文档内容标准

每个架构文档必须包含以下章节，**写清技术方案和实现细节**。中文版和英文版结构完全对应。

### 语言规则

- `xxx.md`：纯中文，无英文混排（专有名词除外，如 TypeScript、Vue 3）
- `xxx-en.md`：纯英文，无中文混排
- 两个文件章节编号、标题层级、Mermaid 图完全一致
- 英文版不是机翻，要自然流畅的技术英语

### 1. 模块概述

- 这个模块解决什么问题
- 在整体架构中的位置和职责
- 与其他模块的依赖关系

### 2. 架构设计

- 分层架构图（Mermaid）
- 核心类/函数的职责划分
- 设计模式的使用（工厂、策略、观察者等）
- **为什么这样设计**（设计决策和权衡）

### 3. 核心类型定义

- 列出模块中的关键 TypeScript 类型/接口
- 字段说明、类型约束、枚举值
- 代码块展示实际类型定义

### 4. 实现细节

**这是最重要的章节，必须详细到函数级别：**

- 每个核心函数的签名、参数、返回值
- 关键算法的步骤说明
- 边界条件的处理方式
- 错误处理策略
- 性能优化手段
- 代码块展示关键实现片段

### 5. 数据流

- Mermaid 序列图展示完整调用链
- 数据在模块间的传递方式
- 异步操作的处理（Promise、Stream、Event）

### 6. 配置与扩展

- 可配置的参数和默认值
- 扩展点（如何新增适配器、新增命令等）
- 与外部系统的接口

### 7. 已知限制

- 当前实现的限制和约束
- 已知的边界问题
- 未来改进方向

---

## 文档质量要求

- **基于实际代码**，不是设计文档 — 必须读取源文件后生成
- **方法签名、类型定义、常量值必须与代码完全一致**
- 使用 Mermaid 生成架构图、序列图、状态图
- 在有帮助的地方包含代码片段
- 每个文档独立完整、可读
- 保持图表简单、聚焦

---

## README 生成规则

### docs/architecture/README.md（中文）

1. **项目概述** — 一句话描述
2. **技术栈** — 框架、库、工具
3. **分层架构图** — Mermaid 图展示整体分层
4. **模块列表** — 每个模块的一句话描述 + 链接
5. **数据流概览** — 从用户输入到最终输出的完整链路
6. **关键设计决策** — 架构层面的重要选择和原因
7. **语言切换** — 顶部链接到 `README-en.md`

### docs/architecture/README-en.md（英文）

结构与中文版完全对应，纯英文。顶部链接到 `README.md`。

### 根目录 README.md 同步

架构文档技能**不负责**同步根目录 README.md 的链接。根目录 README.md 和 README-en.md 的文档链接由 `/site-gen` 技能统一维护。

---

## 常见错误与避免

### ❌ 错误 1：只读变化的文件就写文档

```
# 错误做法
git diff → 发现 skeleton.ts 变了 → 只读 skeleton.ts → 重写 browser-command.md
```

**后果：** 遗漏 `action-executor.ts`、`code-filter.ts`、`skeleton-id.ts` 等同模块文件的内容。

```
# 正确做法
git diff → 发现 skeleton.ts 变了 → 读取 src/browser/ 下所有 .ts 文件 → 重写 browser-command.md
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

**后果：** 函数签名、类型定义、常量值与代码不一致。

**规则：** 每次生成文档前，必须用 `Read` 工具读取源文件。读完再写，不读不写。

### ❌ 错误 4：映射表遗漏文件

**后果：** 新增的文件（如 `code-filter.ts`、`storage-sync.ts`）不在映射表中，增量更新时不会被读取。

**规则：** 映射表用 `src/module/*.ts` 通配符，而不是逐个列出文件名。新增文件自动纳入。
