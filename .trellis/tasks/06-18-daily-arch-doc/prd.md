# brainstorm: daily architecture doc update skill

## Goal

创建一个 Claude Code skill，用于每天完成后自动更新项目技术架构和功能逻辑文档。该 skill 会扫描整个项目代码，生成一个包含总体架构方案、功能流程说明、每个功能具体实现和架构的文档文件夹。

## What I already know

* 项目是一个浏览器扩展（Chrome Extension），使用 WXT 框架 + Vue 3 + TypeScript
* 项目包含多个功能模块：浏览器命令执行、AI 适配器、输入处理、翻译功能、设置管理等
* 用户希望生成类似 `.trellis/tasks/06-14-browser-command-arch/prd.md` 格式的文档
* 文档需要包含：总体架构方案（类似 README.md）+ 每个功能的具体实现（类似 PRD 格式）
* 需要自动化运行，每天完成后更新

## Assumptions (temporary)

* skill 需要扫描整个 src/ 和 entrypoints/ 目录
* 生成的文档应该放在一个专门的文件夹中（如 `docs/architecture/`）
* 文档应该反映最新的代码实现，而不是设计文档
* 需要能够识别项目中的主要功能模块并分别生成文档

## Open Questions

* 文档输出目录应该放在哪里？（如 `docs/architecture/` 或其他位置）
* 是否需要版本控制或变更历史记录？
* 是否需要生成图表（如架构图、流程图）？
* 是否需要与现有的 `.trellis/tasks/` 系统集成？

## Requirements (evolving)

* 创建一个 Claude Code skill，可以通过命令触发
* skill 会扫描项目代码，识别主要功能模块
* 为每个功能模块生成详细的架构文档
* 生成总体架构概览文档
* 文档格式参考现有的 PRD 格式

## Acceptance Criteria (evolving)

* [ ] skill 可以通过 `/skill-name` 命令触发
* [ ] 扫描整个项目代码结构
* [ ] 识别主要功能模块（如 browser、input、adapters、stores 等）
* [ ] 为每个模块生成详细的架构文档
* [ ] 生成总体架构概览文档
* [ ] 文档格式清晰、结构化，包含代码片段和流程图
* [ ] 支持增量更新（只更新变化的模块）

## Definition of Done (team quality bar)

* skill 代码实现完成
* 文档生成逻辑正确
* 输出格式符合要求
* 可以正常运行并生成文档

## Out of Scope (explicit)

* 自动生成图表（如 Mermaid、PlantUML）
* 与 CI/CD 集成
* 自动生成 API 文档
* 文档翻译

## Technical Notes

* 项目使用 WXT 框架（Chrome Extension 开发框架）
* 主要源代码在 `src/` 和 `entrypoints/` 目录
* 现有的 PRD 文档在 `.trellis/tasks/` 目录下
* 参考文档格式：`.trellis/tasks/06-14-browser-command-arch/prd.md`

## Expansion Sweep

### 1. Future evolution

* 文档可能需要支持多种输出格式（Markdown、HTML、PDF）
* 可能需要支持自定义文档模板
* 可能需要与 CI/CD 集成，自动生成文档

### 2. Related scenarios

* 可能需要为其他项目生成类似的文档
* 可能需要支持增量更新，只更新变化的模块
* 可能需要生成 API 文档

### 3. Failure & edge cases

* 代码解析失败时的处理
* 模块识别不准确时的处理
* 文档生成过程中断时的处理

## Decision (ADR-lite)

**Context**: 需要创建一个 Claude Code skill 来自动生成项目架构文档

**Decision**: 创建一个独立的 skill，扫描项目代码，生成 Mermaid 图表和详细的架构文档

**Consequences**: 
* 需要维护 skill 代码
* 文档质量依赖于代码解析的准确性
* 可能需要定期更新以适应项目结构变化