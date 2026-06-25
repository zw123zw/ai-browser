# 笔记系统功能

## Goal

为 AI Browser 扩展添加完整的笔记系统，支持划词笔记、点击笔记、自动笔记三种模式，以及笔记的查看、编辑、导入导出等功能。

## What I already know

### 用户需求摘要

1. **笔记模式配置**：在设置 → 通用配置 → 翻译配置下方添加"笔记配置"，包含四种模式：
   - 划词笔记（selection）— 选中文本后弹出浮层，AI 优化后收藏
   - 点击笔记（click）— 点击段落后底部出现笔记框，AI 优化后收藏
   - 自动笔记（auto）— 页面加载/跳转时自动提取文本，AI 分析总结
   - 关闭（off）— 不启用笔记功能

2. **笔记模式复用翻译模式的 UI 和逻辑**：
   - 划词笔记 → 复用 translate-popup.ts 的浮层
   - 点击笔记 → 复用 translate-click.ts 的底部框
   - 浮层底部按钮：复制 + 收藏笔记

3. **笔记内容**：AI 输出的 markdown 内容（用 renderMarkdown 渲染）

4. **收藏笔记流程**：
   - 点击"收藏笔记"按钮 → 弹框选择输入新标题或选择已有标题
   - 新标题 → 新增笔记；已有标题 → 追加内容到该标题下
   - 笔记图标在清除会话左边，点击可查看笔记

5. **笔记查看弹框**：
   - 左侧：笔记标题列表（带删除按钮）
   - 右侧：笔记内容（markdown 渲染）
   - 同一标题下可追加多条笔记
   - 右侧从上往下时间线：每条笔记的 URL、时间、滚动条位置、划词内容
   - 点击时间线条目 → 新开页面跳转并滚动到对应位置，划词内容高亮背景闪 2 次
   - 笔记内容可长按编辑，点击区域外保存
   - 左侧标题有删除按钮，确认弹框后删除

6. **聊天消息收藏笔记**：
   - 右键消息 → 收藏（现有 bookmark 功能升级）
   - 右键菜单改名为：复制、收藏、删除
   - 聊天方式收藏没有"选择已有标题"选项，自动确认后收藏
   - 文字/语音形式收藏同理

7. **自动笔记**：
   - 每次页面加载/跳转时触发（类似 command:description）
   - 提取页面全部文本 → AI 分析总结
   - 仅支持聊天方式收藏（右键消息 → 收藏）

8. **导入导出**：笔记支持 markdown 格式导入导出

### 现有架构关键点

- **翻译系统**：TranslateService + translate-popup.ts（纯 DOM 浮层）+ translate-click.ts（语义父元素检测 + insertAfter）
- **设置系统**：AppSettings 类型 + SettingsModal.vue（通用配置 tab）+ settingsStorage
- **消息右键菜单**：MessageContextMenu.vue（复制/收藏/删除，收藏是简单 append 到 aib-bookmarks）
- **Header 区域**：ChatDrawer.vue 的 aib-header-actions（清除/设置/分隔/关闭按钮）
- **Markdown 渲染**：markdown.ts 的 renderMarkdown()
- **页面导航检测**：pushState/replaceState monkey-patch + popstate/hashchange 事件
- **命令系统**：capability domain list + pipeline Phase 1/Phase 2

## Assumptions (temporary)

- 笔记存储使用 chrome.storage.local（与现有 bookmark 一致）
- 笔记 AI 优化复用现有 adapter 系统（不走 Phase 1/2 pipeline）
- 自动笔记的触发时机与 auto-translate 相同（URL change + MutationObserver）
- 长按编辑使用 contenteditable 或 textarea 切换

## Open Questions

- 笔记浮层是否需要 markdown 实时渲染（vs 纯文本）？
- 自动笔记的触发频率限制（防抖时间、单页最大次数）？
- 笔记导入导出的文件格式细节？
- 时间线中"跳转并高亮"的实现方式？

## Requirements (evolving)

- 待 brainstorm 确认

## Acceptance Criteria (evolving)

- [ ] 设置中可切换笔记模式（selection/click/auto/off）
- [ ] 划词笔记浮层正常显示 AI 优化内容
- [ ] 点击笔记底部框正常显示 AI 优化内容
- [ ] 自动笔记在页面加载时触发
- [ ] 收藏笔记弹框支持标题选择/输入
- [ ] 笔记查看弹框正常显示
- [ ] 时间线跳转+高亮功能正常
- [ ] 笔记可编辑、可删除
- [ ] 聊天消息右键可收藏为笔记
- [ ] 笔记支持 markdown 导入导出

## Definition of Done

- Tests added/updated
- Lint/typecheck/CI green
- Docs updated if behavior changes

## Out of Scope

- 待 brainstorm 确认

## Technical Notes

- 复用 translate-popup.ts 和 translate-click.ts 的模式（纯 DOM 实现）
- 笔记存储建议新增 notesStorage（WXT storage.defineItem）
- 设置类型需扩展 AppSettings 添加 noteMode 字段
- 右键菜单 MessageContextMenu.vue 需更新文案
- ChatDrawer.vue header 需添加笔记图标按钮
