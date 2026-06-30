# brainstorm: 设置弹框优化 + 使用条款

## Goal

优化设置弹框的整体布局和功能入口，增加使用条款/隐私政策等法律信息。

## What I already know

- 设置弹框结构：header → settings-body(sidebar tabs + pane)
- 每个 tab 内有自己的 `.aib-tab-footer`(保存/取消)，随内容滚动
- 用户配置 tab 有：激活码、上下文消息数、缓存管理、日志管理、语言、使用文档、版本号
- 语音配置 tab 右上角已加"📖 使用指南"按钮
- 有 docs-modal 全屏弹框（markdown 渲染使用文档）
- 有 VoiceGuideModal 弹框（5 tab 语音指南）
- CSS 在 `src/styles/global.css`，`.aib-modal-settings` 固定 88vh 高度

## Requirements (evolving)

1. 底部操作栏固定到弹框最底部（不随内容滚动）
2. 使用条款、联系邮箱、官网地址放到用户配置 tab
3. 首次加载是否展示隐私政策弹框？
4. 使用文档/使用指南入口统一到设置弹框 header 右上角
5. 使用条款和权限说明内容怎么写

## Technical Notes

- `.aib-settings-body` 是 flex 布局（sidebar + pane）
- 需要把 footer 从各 tab 内部提取出来，放到 modal 最底部
- 用户配置 tab 的版本号可作为 footer 的一部分
