# 本地开发日志系统

## Goal

为浏览器扩展实现日志系统，前端打印日志和后端 API 请求日志分开存储，通过打包命令区分测试/生产环境。测试包可在设置弹框中下载或清除日志，生产包不显示日志相关功能。

## Requirements

### 打包命令区分

- `npm run build` — 生产包，不含日志功能，设置弹框不显示日志按钮
- `npm run build:debug` — 测试包，含日志功能，设置弹框显示下载/清除日志按钮
- 通过环境变量 `VITE_LOG_ENABLED=true` 控制，Vite tree-shaking 自动移除生产包中的日志代码

### 日志存储

- 使用 `chrome.storage.local` 存储日志
- 前端日志和 API 日志分开存储（两个 key）
- 自动轮转，每个类型最多保留 **10000 条**，超出丢弃最旧记录
- 不需要额外的 `unlimitedStorage` 权限

### 日志格式

每条日志结构：

```json
{
  "time": "2024-01-15 14:32:05",
  "level": "INFO",
  "module": "ContentScript",
  "msg": "Vue 应用已挂载"
}
```

### 日志类型

**前端日志（frontend.log）**
- 来源：现有 Logger 类的所有输出
- 内容：UI 操作、组件状态、语音识别、文件解析等

**API 日志（api.log）**
- 来源：proxy.ts 的请求/响应
- 内容：请求 URL、方法、耗时、状态码、错误信息

### 设置弹框 — UI 设计

在「通用配置」tab 底部（保存按钮之前）新增日志区块，复用现有 `.aib-form-row` + `.aib-section-title` 布局体系。

#### 日志管理（仅 debug 包可见）

```
┌─────────────────────────────────────────────┐
│  开发工具                                    │  ← .aib-section-title
│                                             │
│  日志管理                                    │  ← label
│  [📥 下载日志]    [🗑️ 清除日志]              │  ← 两个按钮并排
│                                             │
└─────────────────────────────────────────────┘
```

- 标题：`.aib-section-title` 显示「开发工具」
- label：复用 `.aib-form-row > label` 显示「日志管理」
- 下载日志按钮：`.aib-btn` 样式，左侧加下载 SVG 图标
- 清除日志按钮：`.aib-btn .aib-btn-danger` 样式（红色危险按钮），左侧加垃圾桶 SVG 图标
- 两个按钮用 `display: flex; gap: 10px` 并排排列
- 整个区块用 `v-if="import.meta.env.VITE_LOG_ENABLED"` 控制，生产包完全不渲染

#### 样式规范（匹配现有设计）

所有新增元素复用现有 CSS 变量和类名，无需新增样式规则：

| 元素 | 复用样式 | 说明 |
|------|---------|------|
| 区块标题 | `.aib-section-title` | 15px, font-weight 600, 底部 border |
| 行容器 | `.aib-form-row` | label + 内容纵向布局 |
| 输入框 | `.aib-input` | 圆角 8px, 边框 `--aib-border`, 聚焦 `--aib-primary` |
| 输入框+按钮组合 | `.aib-input-group` | 输入框左圆角，按钮右圆角，无缝拼接 |
| 主按钮 | `.aib-btn .aib-btn-primary` | `--aib-primary` 背景，白色文字，glow 阴影 |
| 危险按钮 | `.aib-btn .aib-btn-danger` | 红色边框+背景，hover 加深 |
| 普通按钮 | `.aib-btn` | 透明背景，`--aib-border` 边框 |
| 分隔线 | `border-top: 1px solid var(--aib-border)` | 区块间分隔 |

#### 交互细节

- 下载日志：点击后通过 `<a download>` 触发浏览器下载，生成 `frontend-{日期}.log` 和 `api-{日期}.log`
- 清除日志：点击后弹出 `confirm()` 确认框，确认后清空 storage 中的日志，显示 toast 提示「日志已清除」

## Acceptance Criteria

- [ ] `npm run build` 打包后，设置弹框无日志相关按钮
- [ ] `npm run build:debug` 打包后，设置弹框显示下载/清除日志按钮
- [ ] 测试包运行时，前端日志自动写入 storage
- [ ] 测试包运行时，API 请求日志自动写入 storage
- [ ] 点击下载日志，浏览器下载两个 `.log` 文件
- [ ] 点击清除日志，弹出确认框，确认后清空所有日志
- [ ] 日志超过 10000 条时自动轮转，不超出 storage 限制

## Definition of Done

- 代码实现完成，功能可用
- `build` 和 `build:debug` 两种打包结果符合预期
- 日志文件格式清晰，前端/API 日志分开
- 设置弹框 UI 与现有风格一致

## Out of Scope

- 生产环境日志收集
- 日志上传到远程服务器
- 日志实时查看（仅支持导出文件查看）

## Technical Notes

### 环境变量

WXT 使用 Vite 构建，支持 `import.meta.env.VITE_*` 变量：

```typescript
if (import.meta.env.VITE_LOG_ENABLED) {
  // 仅 debug 包执行
}
```

生产包中该分支被 tree-shaking 移除。

### Storage 结构

```typescript
// chrome.storage.local 中的 key
"logs:frontend" → LogEntry[]   // 前端日志
"logs:api"      → LogEntry[]   // API 日志
```

### 现有代码改动

- `src/utils/logger.ts` — Logger 类增加写 storage 逻辑
- `src/adapters/proxy.ts` — proxyFetch / proxyFetchStream 增加日志记录
- `entrypoints/content/components/SettingsModal.vue` — 新增日志区域

### 新增文件

- `src/utils/log-storage.ts` — 日志存储操作（save / get / clear / export）

### 打包命令

```json
"build:debug": "cross-env VITE_LOG_ENABLED=true wxt build"
```

需要安装 `cross-env` 作为 devDependency，支持跨平台环境变量设置。
