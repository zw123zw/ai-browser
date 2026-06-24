# 浏览器命令架构增强 - Shadow DOM / iframe / 复杂交互

## Goal

增强 AI 浏览器扩展的 DOM 交互能力，补齐 5 项缺失功能，使其能处理企业级后台（OA、钉钉、ERP）中的复杂场景。

## 确认范围（MVP）

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | Shadow DOM 遍历 | Vue3/WebComponent 页面的基础能力 |
| P0 | 嵌套 iframe 递归 | OA/ERP 多层嵌套，已有架构加递归 |
| P1 | 文件上传 | DataTransfer API，聊天框附件 → 自动填入页面 file input |
| P2 | 滑块（range input） | 读 min/max → 模拟 mouse 事件拖拽 |
| P2 | 弹窗自动关闭 | 已有检测逻辑，加 close action |

## Out of Scope

- 拖拽自动化（看板场景太小众，事件序列复杂）
- XHR/Fetch 拦截（侵入性强，只有前端加密表单一个场景）
- 步骤上限调整（保持 50 步不变）
- Shadow DOM 内 iframe 交叉场景（两个功能分开做，以后按需联动）

---

## 需求详情

### 1. Shadow DOM 遍历（P0）

**现状**：`document.querySelectorAll('*')` 不穿透 shadow boundary，目标页面的 WebComponent 内部元素完全不可见。

**目标**：skeleton 提取时递归遍历所有 `shadowRoot`，将 Shadow DOM 内部元素合并进全局元素列表，LLM 统一识别。

**技术方案**：
- 在 `skeleton.ts` 的 `extractSkeleton()` 中，遍历每个元素时检查 `el.shadowRoot`
- 若存在 shadowRoot，递归提取其内部元素
- 给 Shadow 内元素分配 `data-skeleton-id`，与普通元素统一编号
- closed mode shadowRoot 无法访问，跳过并标注
- ActionExecutor 的 `findElement()` 需支持跨 shadowRoot 定位

**关键文件**：`src/browser/skeleton.ts`, `src/browser/skeleton-id.ts`, `src/browser/action-executor.ts`

**验收标准**：
- [ ] 包含 WebComponent 的页面，skeleton 能提取到 Shadow DOM 内部的按钮/输入框
- [ ] AI 指令能正确操作 Shadow DOM 内的元素
- [ ] closed mode shadowRoot 被跳过，不影响其他元素提取
- [ ] 递归深度有上限（建议 10 层），防止无限递归

---

### 2. 嵌套 iframe 递归（P0）

**现状**：当前只处理顶层 `<iframe>`，iframe 内嵌套的 iframe 不处理。OA/ERP 系统常见 2-3 层嵌套。

**目标**：递归遍历所有层级 iframe，统一全局 DOM 索引。

**技术方案**：
- `skeleton.ts` 中 `extractFromIframe()` 递归调用自身处理子 iframe
- 同域 iframe：递归读取 `contentDocument`，继续扫描内部 iframe
- 跨域 iframe：通过 `chrome.scripting.executeScript({ allFrames: true })` 注入，background 返回结果后继续递归
- 元素 ID 前缀层级化：顶层 `e1`，第一层 iframe `fi1_e1`，第二层 `fi1_fi1_e1`
- 递归深度限制：建议最大 5 层

**关键文件**：`src/browser/skeleton.ts`, `entrypoints/background.ts`

**验收标准**：
- [ ] 3 层嵌套 iframe 内的元素全部可见
- [ ] 跨域 + 同域混合嵌套正确处理
- [ ] 超过 5 层时停止递归并标注
- [ ] iframe 内的 action 执行正确切换上下文

---

### 3. 文件上传（P1）

**现状**：AI 能找到 `<input type="file">` 但无法填入文件。

**目标**：用户在聊天框附件文件 → AI 自动找到页面上传框 → DataTransfer 填入 → 触发事件。

**技术方案**：
- 新增 `upload` action 到 ActionExecutor
- Content script 中用 DataTransfer API：
  ```typescript
  const dt = new DataTransfer();
  dt.items.add(new File([blob], name, { type: mimeType }));
  inputEl.files = dt.files;
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  ```
- 文件数据来源：用户聊天框附件（已有 `file-parsers.ts` 读取能力）
- Command 接口扩展：新增 `fileData: { base64, name, mimeType }` 字段
- 若页面框架未响应 change 事件，降级到 main-world 注入

**关键文件**：`src/browser/action-executor.ts`, `src/browser/types.ts`, `src/input/prompts/common.ts`

**验收标准**：
- [ ] 用户附件文件后，AI 能自动填入页面 file input
- [ ] 页面框架（React/Vue/Angular）能检测到文件变化
- [ ] 单文件和多文件场景均支持
- [ ] skeleton 提取时 `<input type="file">` 标注 accept 属性

---

### 4. 滑块 / range input（P2）

**现状**：`<input type="range">` 无专门处理，`type` 命令无法操作滑块。

**目标**：AI 能按文字描述（"拖到 80%"、"音量调到 50"）操作滑块。

**技术方案**：
- 新增 `slider` action 到 ActionExecutor
- 读取 `min`、`max`、`step` 属性，计算目标像素位置
- 模拟完整鼠标事件序列：`mousedown` → `mousemove`（多次）→ `mouseup`
- 对于非标准滑块（div + JS 实现），检测 role="slider" + aria-valuemin/max
- skeleton 提取时 range input 标注 min/max/value/accept

**关键文件**：`src/browser/action-executor.ts`, `src/browser/types.ts`

**验收标准**：
- [ ] 标准 `<input type="range">` 可拖拽到指定值
- [ ] 自定义滑块（role="slider"）可操作
- [ ] AI 能理解"拖到 80%"并转换为正确值

---

### 5. 弹窗自动关闭（P2）

**现状**：`hasModalOverlay()` 已能检测弹窗，但无自动关闭 action。

**目标**：AI 能自动识别并关闭遮罩弹窗、确认框。

**技术方案**：
- 新增 `closeModal` action 到 ActionExecutor
- 扫描策略：
  1. `dialog[open]` → 调用 `dialog.close()`
  2. ARIA dialog → 查找关闭按钮（aria-label="close"、×、取消、关闭）
  3. 框架弹窗（Bootstrap/Element UI/Ant Design）→ 查找 `.close` 按钮或遮罩点击
  4. 通用遮罩 → 查找固定定位元素内的关闭/取消按钮
- 多层弹窗：循环关闭直到无弹窗
- skeleton 提取时 `hasModal` 标记传递给 LLM

**关键文件**：`src/browser/action-executor.ts`, `src/browser/skeleton.ts`

**验收标准**：
- [ ] 能关闭原生 `<dialog>` 弹窗
- [ ] 能关闭 Bootstrap/Element UI/Ant Design 弹窗
- [ ] 多层弹窗逐层关闭
- [ ] 关闭后页面可正常交互

---

## Technical Notes

### 关键文件总览

| 文件 | 改动 |
|------|------|
| `src/browser/skeleton.ts` | Shadow DOM 遍历 + 嵌套 iframe 递归 |
| `src/browser/skeleton-id.ts` | Shadow DOM 元素 ID 分配 |
| `src/browser/action-executor.ts` | 新增 upload/slider/closeModal action |
| `src/browser/types.ts` | Command 接口扩展 |
| `src/input/prompts/common.ts` | CAPABILITY_DOMAIN_LIST 新增能力项 |
| `entrypoints/background.ts` | 嵌套 iframe 的 background 中转增强 |

### 架构约束

- Content script 在 isolated world，无法直接访问页面 JS 变量
- 文件上传通过 DataTransfer API 实现（Chrome 60+）
- 跨域 iframe 通过 `chrome.scripting.executeScript` 注入（权限已有）
- Shadow DOM closed mode 无法访问 `shadowRoot`，跳过
- 嵌套 iframe 递归上限 5 层，Shadow DOM 递归上限 10 层
