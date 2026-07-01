# brainstorm: 文件生成 loading 状态 + 文件卡片重新设计

## Goal

改善 AI 生成文件/图表时的用户体验：流式输出时隐藏 `[FILE]` 标签原始内容，改为展示文件生成中的 loading 状态；完成后展示重新设计的文件卡片（非当前丑陋的卡片样式）。

## What I already know

### 当前行为（来自代码探索）
- **流式阶段**：`MessageItem.vue` 的 `renderedContent` 在 `isStreaming=true` 时直接渲染原始内容，包含 `[FILE:xxx]...[/FILE]` 标签的原始 JSON/文本
- **完成阶段**：流式结束后，`textWithoutFiles` 去掉 `[FILE]` 标签，`parsedFiles` 解析后通过 `FileCard.vue` 渲染
- **FileCard 当前设计**：固定 350px 宽卡片，圆角 12px，emoji 图标 + 文件名 + 大小 + 操作按钮，图表类型占满宽度

### 现有标签格式
```
[FILE:filename.ext]
content here...
[/FILE]
```
图表用 `.chart` 扩展名，内容是 ECharts option JSON。

### 现有 loading 实现
- 打字机三点动画 `.aib-typing`
- OCR 进度覆盖层 `.aib-ocr-overlay`
- 无文件生成 loading 状态

### 关键文件
- `entrypoints/content/components/MessageItem.vue` — 消息渲染核心
- `entrypoints/content/components/FileCard.vue` — 文件卡片组件
- `src/utils/file-tag-parser.ts` — 文件标签解析
- `src/utils/echart-renderer.ts` — 图表渲染
- `src/styles/global.css` — 全局样式

## Assumptions (temporary)

- 流式输出中 `[FILE:` 开始到 `[/FILE]` 结束之间，需要隐藏原始标签内容
- loading 状态需要展示文件图标 + 进度指示
- 文件卡片需要重新设计，不是简单的圆角卡片

## Open Questions

（已收敛）

## Requirements (evolving)

### 设计方向：内联卡片 Inline Card（参考 OpenClaw）
- 文件卡片嵌入消息气泡内，与文本段落 8px 间距分隔
- 多文件垂直堆叠，间距 12px
- **用户上传文件 + AI 生成文件统一使用同一组件样式**

### 两阶段状态
1. **生成中**：检测到 `[FILE:` 未检测到 `[/FILE]` → 紧凑占位条（旋转图标 + 脉冲动画），按钮灰色不可点击
2. **生成完成**：检测到 `[/FILE]` → 完整卡片（opacity+transform 过渡 0.3s）

### 卡片结构（4 层）
1. 头部：左侧 4px 色条 + 文件类型图标 20x20 + 文件名 + 右侧后缀标签
2. 元数据：12px 浅灰，文件类型说明 ・ 大小/行数 ・ 状态
3. 预览区（差异化）：文档 140px 简化 markdown / 代码 110px 语法高亮 / 图表自适应 ECharts / 图片缩略图
4. 操作按钮：主按钮（下载）+ 次按钮（预览/复制），高 36px，圆角 8px

### 色条配色
- 文档(Word/md/txt): #3b82f6 蓝
- 代码(vue/js/html): #10b981 青绿
- 表格(Excel/CSV): #f97316 橙
- 图表(.chart): #8b5cf6 紫
- 其他/压缩包: #6b7280 灰

## Acceptance Criteria (evolving)

*待 Q&A 确定*

## Definition of Done

- 流式输出中 `[FILE]` 标签内容不展示，改为 loading 状态
- 文件生成完成后展示新设计的文件卡片
- 图表类型正确渲染 ECharts
- 所有下载/预览功能正常
- 类型检查通过（`npm run compile`）

## Out of Scope (explicit)

*待 Q&A 确定*

## Technical Notes

- 流式检测需要在 `renderedContent` 计算逻辑中处理，或者在模板层判断
- 可能需要新的 `FileGeneratingLoader.vue` 组件
- FileCard 需要重新设计样式，可能拆分为不同类型
