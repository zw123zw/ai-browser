# feat: 设置弹框增加清除缓存按钮

## Goal

在设置弹框的「用户配置」tab 中增加「清除缓存」按钮，让用户可以手动清除会话消息、日志和输入历史。同时保留现有的 4MB 日志自动清除逻辑。功能在所有环境（prod/debug）都可用。

## Requirements

- 在「用户配置」tab 增加「清除缓存」按钮
- 清除范围：会话消息 + 日志 + 输入历史
- 保留范围：模型配置、主题、快捷键、悬浮按钮位置等设置
- 保留 log-storage.ts 中 4MB 自动清除逻辑
- 移除原有的「日志管理」section（仅 debug 可见），改为统一的「清除缓存」按钮（所有环境可见）
- 按钮样式与现有 UI 风格统一

## Acceptance Criteria

- [ ] 「用户配置」tab 中显示「清除缓存」按钮
- [ ] 点击按钮弹出确认对话框
- [ ] 确认后清除 chrome.storage.local 中的：`aib-conversation`、`logs:frontend`、`logs:api`、`aib-input-history`
- [ ] 不清除：`aib-settings`、`aib-fab-pos`、`aib-drawer-open`
- [ ] 清除完成后显示 toast 提示
- [ ] 4MB 日志自动清除逻辑保留
- [ ] prod 和 debug 环境都可见此按钮

## Technical Approach

### 清除范围

| 键 | 内容 | 操作 |
|---|---|---|
| `aib-conversation` | 当前会话消息 | 清除 |
| `logs:frontend` | 前端日志 | 清除 |
| `logs:api` | API 日志 | 清除 |
| `aib-input-history` | 输入历史 | 清除 |
| `aib-settings` | 模型配置等 | 保留 |
| `aib-fab-pos` | 悬浮按钮位置 | 保留 |
| `aib-drawer-open` | 抽屉展开状态 | 保留 |

### 实现方案

1. **新增 `clearCache()` 函数**（在 `src/utils/log-storage.ts` 或新建 `src/utils/cache.ts`）
   - 调用 `chrome.storage.local.remove()` 清除指定键
   - 返回清除的数据大小（可选，用于提示）

2. **修改 `SettingsModal.vue`**
   - 移除 `logEnabled` 条件判断
   - 移除原有「日志管理」section
   - 新增「清除缓存」按钮，放在「激活码」下方
   - 样式复用 `aib-btn-icon` 类

3. **保留 4MB 自动清除**
   - `log-storage.ts` 中的 `MAX_STORAGE_BYTES` 和 `doAppend()` 逻辑不变

## Out of Scope

- 不清除模型配置等设置数据
- 不添加缓存大小显示（可后续迭代）
- 不添加定时自动清除（仅保留现有的 4MB 阈值清除）

## Technical Notes

- `chrome.storage.local` 的键名在 `src/storage/index.ts` 中定义
- 日志存储在 `src/utils/log-storage.ts`
- 现有 UI 组件样式在 `SettingsModal.vue` 的 `<style scoped>` 中
