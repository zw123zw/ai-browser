---
name: update-architecture-docs
description: "全量扫描项目代码，生成各模块详细架构文档（docs/architecture/）。写清技术方案、实现细节、架构设计。"
---

# 架构文档生成

全量扫描项目代码，重写全部架构文档到 `docs/architecture/`。每次执行都读取所有源文件，确保文档与代码完全同步。

**核心原则：文档必须反映代码的真实状态，每次执行都从源文件重新生成。**

---

## 输出目录

```
docs/architecture/
├── README.md              # 总体架构概览
├── browser-command.md     # 浏览器命令引擎
├── input-pipeline.md      # 输入管线
├── ai-adapters.md         # AI 适配器
├── state-management.md    # 状态管理
├── background-service.md  # 后台服务
├── content-script.md      # 内容脚本
├── translation.md         # 翻译系统
├── voice.md               # 语音系统
├── storage.md             # 存储层
└── file-parsing.md        # 文件处理
```

---

## 执行模式：全量扫描

**每次调用都扫描全部源文件并重写全部文档。** 不做增量更新。

原因：增量更新容易遗漏隐式变化（函数签名不变但行为变了、依赖变了、注释变了）。

流程：
1. 并行读取所有源文件
2. 分析代码结构和依赖关系
3. 重写所有架构文档
4. 同步根目录 README.md

---

## 模块与源文件映射

| 文档 | 源文件 |
|------|--------|
| `README.md` | `package.json`, `entrypoints/background.ts`, `entrypoints/content/index.ts`, `entrypoints/content/App.vue` |
| `browser-command.md` | `src/browser/types.ts`, `src/browser/skeleton.ts`, `src/browser/action-executor.ts`, `src/browser/local-html.ts`, `src/browser/index.ts` |
| `input-pipeline.md` | `src/input/types.ts`, `src/input/router.ts`, `src/input/intent-detector.ts`, `src/input/pipeline.ts`, `src/input/tag-parser.ts`, `src/input/prompts/*.ts`, `src/input/index.ts`, `src/composables/usePipeline.ts` |
| `ai-adapters.md` | `src/adapters/base.ts`, `src/adapters/openai.ts`, `src/adapters/qwen.ts`, `src/adapters/wenxin.ts`, `src/adapters/gemini.ts`, `src/adapters/doubao.ts`, `src/adapters/proxy.ts`, `src/adapters/index.ts` |
| `state-management.md` | `src/stores/settings.ts`, `src/stores/conversations.ts`, `src/stores/voice.ts` |
| `background-service.md` | `entrypoints/background.ts` |
| `content-script.md` | `entrypoints/content/index.ts`, `entrypoints/content/App.vue`, `entrypoints/content/components/**/*.vue`, `src/composables/usePipeline.ts` |
| `translation.md` | `src/browser/translate-service.ts`, `src/browser/translate-popup.ts`, `src/browser/translate-click.ts`, `src/browser/translate-parser.ts` |
| `voice.md` | `src/voice/**/*` |
| `storage.md` | `src/storage/index.ts` |
| `file-parsing.md` | `src/utils/file-parsers.ts`, `src/utils/file-type.ts`, `src/utils/file-generators.ts`, `src/utils/file-tag-parser.ts`, `src/utils/echart-renderer.ts`, `src/utils/ocr.ts` |

---

## 文档内容标准

每个架构文档必须包含以下章节，**写清技术方案和实现细节**：

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

## README.md 生成规则

`docs/architecture/README.md` 包含：

1. **项目概述** — 一句话描述
2. **技术栈** — 框架、库、工具
3. **分层架构图** — Mermaid 图展示整体分层
4. **模块列表** — 每个模块的一句话描述 + 链接
5. **数据流概览** — 从用户输入到最终输出的完整链路
6. **关键设计决策** — 架构层面的重要选择和原因

同步到根目录 README.md 时，模块链接使用 `./docs/architecture/` 前缀。

---

## 执行步骤

### Step 1: 发现模块

1. 扫描 `src/` 目录下的所有子目录
2. 扫描 `entrypoints/` 目录下的所有子目录
3. 对比已有的 `docs/architecture/` 文档列表
4. 识别新增模块（有目录但无文档）和已删除模块（有文档但无目录）

### Step 2: 并行读取全部源文件

按模块映射表 + 新发现模块，使用并行 Agent 读取所有源文件。必须覆盖每一个文件。

### Step 3: 分析代码结构

- 识别模块间的依赖关系
- 提取关键类型定义和函数签名
- 理解数据流和调用链
- 识别设计模式的使用

### Step 4: 生成架构文档

使用 Write 工具全量覆盖每个文档。按文档内容标准写入详细内容。

**新发现的模块：** 自动生成对应架构文档，文件名用 kebab-case，内容遵循文档内容标准。

**已删除的模块：** 删除对应的孤立文档，从 README 中移除条目。

### Step 5: 同步根目录 README

将 `docs/architecture/README.md` 同步到项目根目录 `README.md`。

### Step 6: 报告摘要

```
✅ 架构文档更新完成

扫描文件：N 个
生成文档：M 篇
新增文档：X 篇（列出新模块名）
删除文档：Y 篇（列出已删除模块名）

文档列表：
  - README.md（总体架构）
  - browser-command.md
  - input-pipeline.md
  - ...
```
