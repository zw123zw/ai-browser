# 每日架构文档更新技能

## 目标

创建一个 Claude Code skill，用于每天完成后自动更新项目技术架构和功能逻辑文档。该 skill 会扫描整个项目代码，生成一个包含总体架构方案、功能流程说明、每个功能具体实现和架构的文档文件夹。

## 已知信息

* 项目是一个浏览器扩展（Chrome Extension），使用 WXT 框架 + Vue 3 + TypeScript
* 项目包含多个功能模块：浏览器命令执行、AI 适配器、输入处理、翻译功能、设置管理等
* 用户希望生成类似 `.trellis/tasks/06-14-browser-command-arch/prd.md` 格式的文档
* 文档需要包含：总体架构方案（类似 README.md）+ 每个功能的具体实现（类似 PRD 格式）
* 需要自动化运行，每天完成后更新

## 假设（临时）

* skill 需要扫描整个 src/ 和 entrypoints/ 目录
* 生成的文档应该放在一个专门的文件夹中（如 `docs/architecture/`）
* 文档应该反映最新的代码实现，而不是设计文档
* 需要能够识别项目中的主要功能模块并分别生成文档

## 已解决的问题

* 文档输出目录：`docs/architecture/`
* 版本控制：直接覆盖（不保留历史）
* 图表格式：Mermaid 图表
* 系统集成：独立运行（不与 trellis 集成）

## 需求（最终）

* 创建一个 Claude Code skill，可以通过命令触发
* skill 会扫描项目代码，识别主要功能模块
* 为每个功能模块生成详细的架构文档
* 生成总体架构概览文档
* 文档格式参考现有的 PRD 格式
* 输出目录：`docs/architecture/`
* 使用 Mermaid 图表

## 验收标准

* [x] skill 可以通过 `/update-architecture-docs` 命令触发
* [x] 扫描整个项目代码结构
* [x] 识别主要功能模块（如 browser、input、adapters、stores 等）
* [x] 为每个模块生成详细的架构文档
* [x] 生成总体架构概览文档
* [x] 文档格式清晰、结构化，包含 Mermaid 图表
* [x] 支持直接覆盖更新

## 完成标准

* skill 代码实现完成
* 文档生成逻辑正确
* 输出格式符合要求
* 可以正常运行并生成文档

## 不在范围内

* 自定义模板
* 多种输出格式（HTML、PDF）
* 增量更新
* 与 CI/CD 集成
* 自动生成 API 文档

## 技术说明

* 项目使用 WXT 框架（Chrome Extension 开发框架）
* 主要源代码在 `src/` 和 `entrypoints/` 目录
* 现有的 PRD 文档在 `.trellis/tasks/` 目录下
* 参考文档格式：`.trellis/tasks/06-14-browser-command-arch/prd.md`

## 扩展考虑

### 1. 未来演化

* 文档可能需要支持多种输出格式（Markdown、HTML、PDF）
* 可能需要支持自定义文档模板
* 可能需要与 CI/CD 集成，自动生成文档

### 2. 相关场景

* 可能需要为其他项目生成类似的文档
* 可能需要支持增量更新，只更新变化的模块
* 可能需要生成 API 文档

### 3. 失败和边缘情况

* 代码解析失败时的处理
* 模块识别不准确时的处理
* 文档生成过程中断时的处理

## 决策记录

**背景**: 需要创建一个 Claude Code skill 来自动生成项目架构文档

**决策**: 创建一个独立的 skill，扫描项目代码，生成 Mermaid 图表和详细的架构文档

**后果**:
* 需要维护 skill 代码
* 文档质量依赖于代码解析的准确性
* 可能需要定期更新以适应项目结构变化

## 最终需求

**目标**: 创建一个 Claude Code skill，自动生成项目全部功能的设计实现思路和架构方案

**需求**:
* 创建 skill `update-architecture-docs`
* 扫描整个项目代码
* 识别所有功能模块
* 为每个模块生成详细的架构文档
* 生成总体架构概览
* 输出目录：`docs/architecture/`
* 文档格式：Markdown，包含 Mermaid 图表

**验收标准**:
* [x] skill 可以通过 `/update-architecture-docs` 命令触发
* [x] 扫描整个项目代码结构
* [x] 识别主要功能模块
* [x] 为每个模块生成详细的架构文档
* [x] 生成总体架构概览文档
* [x] 文档格式清晰、结构化，包含 Mermaid 图表
* [x] 支持直接覆盖更新

**不在范围内**:
* 自定义模板
* 多种输出格式（HTML、PDF）
* 增量更新
* 与 CI/CD 集成

**技术方案**:
* 使用 Claude Code 的 skill 系统
* 通过 Bash 工具扫描项目文件
* 使用 Read 工具读取源代码
* 使用 Write 工具生成文档
* 使用 Mermaid 语法生成图表

## 输出结构

```
docs/architecture/
├── README.md                    # 总体架构概览
├── browser-command.md           # 浏览器命令执行架构
├── input-pipeline.md            # 输入处理流水线架构
├── ai-adapters.md               # AI 适配器架构
├── state-management.md          # 状态管理架构
├── background-service.md        # Background Service Worker 架构
├── content-script.md            # Content Script 架构
├── translation.md               # 翻译功能架构
├── voice.md                     # 语音功能架构
└── storage.md                   # 存储架构
```

## 文档格式

每个文档包含：
1. **目标** — 模块做什么
2. **架构图** — Mermaid 分层图
3. **核心设计决策** — 关键选择和原因
4. **详细实现** — 每个部分如何工作
5. **数据流图** — Mermaid 序列图
6. **关键方法签名** — 重要 API
7. **错误处理** — 如何处理错误