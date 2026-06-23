# 跨域 iframe 骨架提取 + 操作执行

## Goal

mail.163.com 的登录表单在动态创建的跨域 iframe（`x-URS-iframe`）内，当前扩展无法识别也无法操作。需要增量支持 iframe 的骨架提取和操作执行，不影响现有功能。

## Requirements

### R1. 骨架提取：同源 iframe 直接提取 + 跨域 iframe 注入提取
- 同源 iframe：直接访问 `contentDocument`，打标 + 提取，同步零开销
- 跨域 iframe：通过 `chrome.scripting.executeScript({ allFrames: true })` 注入提取
- iframe 内的 INPUT/BUTTON 等元素合并到骨架中
- 每个 iframe 元素标记 `frameId` 用于后续操作定位

### R2. 操作执行：click/type 等操作能作用于 iframe 内元素
- ActionExecutor 识别 iframe 元素（通过 `cmd.frameId`）
- 使用 `chrome.scripting.executeScript({ frameId })` 注入操作函数到目标 iframe
- 支持 click、type、clear、select、focus、hover

### R3. 零影响：无 iframe 页面不受影响
- `extractSkeleton()` 主文档提取逻辑不改
- `ActionExecutor` 主文档操作逻辑不改
- 无 iframe 时零额外开销

## Technical Approach

### 骨架提取层（三种场景）

```
extractSkeleton(document)
        ↓
主文档提取（不变）
        ↓
遍历 iframe：
  ├─ 同源 iframe → contentDocument 可访问
  │    → ensureAllSkeletonIdsForDoc(iframeDoc) 打标
  │    → extractFromDoc(iframeDoc, offsetX, offsetY, parent) 直接合并
  │
  └─ 跨域 iframe → contentDocument 抛异常
       → 收集到 inaccessibleIframes 列表
       → chrome.scripting.executeScript({ allFrames: true }) 注入提取
       → 合并结果，标记 frameId
```

### 操作执行层

```
ActionExecutor.execute(cmd)
        ↓
cmd.frameId 存在？
  ├─ 是 → executeIframeAction(cmd)
  │    → chrome.scripting.executeScript({ frameId, func: actionFunc })
  │    → 注入函数：find element → click/type/... → 返回结果
  │
  └─ 否 → 现有逻辑（不变）
```

### frameId 传递方式

**Command 类型加 `frameId?: number` 字段**
- `SkeletonElement` 加 `frameId?: number`
- Pipeline 解析 AI 输出时，从骨架查找元素的 frameId，写入 Command
- `Command` 加 `frameId?: number`
- ActionExecutor 检查 `cmd.frameId` 决定走哪个分支
- 同源 iframe 元素也需要标记 frameId（用 iframe 在文档中的索引）

## 改动文件

### 1. `src/browser/types.ts` — 加字段（2 行）

```typescript
SkeletonElement 加 frameId?: number
Command 加 frameId?: number
```

### 2. `src/browser/skeleton.ts` — 核心改动（~100 行新增）

**修改 `extractSkeleton()` 内的 iframe 处理（替换已删除的死代码）：**

```typescript
// 同源 iframe 直接提取 + 跨域 iframe 收集
const inaccessibleIframes: HTMLIFrameElement[] = []
let iframeIndex = 0
for (const iframe of doc.querySelectorAll('iframe')) {
  const iframeEl = iframe as HTMLIFrameElement
  let iframeDoc: Document | null = null
  try { iframeDoc = iframeEl.contentDocument } catch { /* 跨域 */ }

  if (iframeDoc?.body) {
    // 同源：直接打标 + 提取
    ensureAllSkeletonIdsForDoc(iframeDoc)
    const rect = iframeEl.getBoundingClientRect()
    const label = iframeEl.id || iframeEl.getAttribute('name') || 'iframe'
    extractFromDoc(iframeDoc, rect.left, rect.top, `iframe.${label}`)
    // 标记 frameId
    for (const el of elements) {
      if (el.parent === `iframe.${label}`) el.frameId = iframeIndex
    }
  } else if (iframeEl.getBoundingClientRect().width >= 1) {
    inaccessibleIframes.push(iframeEl)
  }
  iframeIndex++
}
```

**新增 `ensureAllSkeletonIdsForDoc(doc)` 函数：**
- 和 `ensureAllSkeletonIds()` 逻辑一样，但接受指定 Document 参数
- 给 iframe 文档的所有元素打 `data-skeleton-id`

**SkeletonManager 新增两个异步方法：**
```typescript
async getSkeletonWithIframes(): Promise<SemanticSkeleton>
async getFullSkeletonWithIframes(): Promise<SemanticSkeleton>
```

**新增辅助函数：**
- `getInaccessibleIframes(doc)` — 收集不可访问 iframe
- `getTabId()` — 获取当前标签页 ID
- `iframeExtractFunc(scope, vpWidth, vpHeight)` — 注入到跨域 iframe 的自包含提取函数（~60 行）

### 3. `src/browser/action-executor.ts` — 新增 iframe 操作（~50 行新增）

**修改 `execute()` 方法开头：**
```typescript
if (cmd.frameId != null) {
  return await this.executeIframeAction(cmd)
}
```

**新增 `executeIframeAction(cmd)` 方法：**
- 获取 tabId
- `chrome.scripting.executeScript({ target: { tabId, frameId: cmd.frameId }, func, args })`
- 注入函数支持：click（完整 6 事件）、type、clear、select、focus、hover

### 4. `src/input/pipeline.ts` — 使用异步骨架方法（2 行改动）

```typescript
// Phase 2 循环内
const skeleton = await this.skeletonManager.getSkeletonWithIframes()
// need_full 处理
const fullSkeleton = await extractFullPageSkeletonAsync()
```

### 5. `src/browser/local-html.ts` — 新增异步版本（~15 行新增）

```typescript
export async function extractFullPageSkeletonAsync(): Promise<string | null>
```

### 6. `src/browser/index.ts` — 导出新函数（1 行）

```typescript
export { extractFullPageSkeleton, extractFullPageSkeletonAsync } from './local-html'
```

## Acceptance Criteria

- [ ] mail.163.com 骨架包含 iframe 内的 INPUT 元素（email 输入框、密码输入框、登录按钮）
- [ ] AI 能识别 iframe 内的表单元素并生成正确的 click/type 指令
- [ ] click/type 操作在 iframe 内生效（能看到输入内容、按钮被点击）
- [ ] zhihu.com 等普通网站行为完全不变
- [ ] `npm run compile` 通过
- [ ] `npm run build` 打包成功

## Out of Scope

- iframe 嵌套 iframe（只处理一层）
- iframe 内的 scroll 操作
- iframe 内的 keyboard 操作（Enter/Tab 等）
- CodeMirror/Monaco/Ace 等复杂编辑器在 iframe 内的支持

## Decision (ADR-lite)

| 决策 | 选择 | 原因 |
|------|------|------|
| frameId 传递方式 | Command 加 frameId 字段 | 语义清晰，改 Command 类型范围可控 |
| click 事件序列 | 完整 6 事件 | 兼容性最好，框架事件绑定都能触发 |
| 注入失败处理 | 静默忽略 | 骨架提取不阻塞，操作失败 AI 自然重试 |
| 同源 iframe | 直接提取 | contentDocument 可访问，零异步开销 |
| 跨域 iframe | chrome.scripting 注入 | 唯一能访问跨域 DOM 的方式 |
| 影响范围 | 纯增量 | 原有逻辑零改动 |

## Technical Notes

- 已有权限：`scripting` + `<all_urls>` host_permissions，不需要新权限
- `chrome.scripting.executeScript` 从内容脚本调用需要 tabId，通过 `chrome.runtime.sendMessage({ type: 'get-tab-id' })` 获取
- `allFrames: true` 会注入到所有 frame，主框架结果需要跳过
- `ensureAllSkeletonIds()` 只打标 `document.body`，需要新增 `ensureAllSkeletonIdsForDoc()` 支持指定文档
- **不加 ensurePageLoaded() 延迟**：动态创建的 iframe 靠 pipeline 每轮重新提取骨架自然捕获，不影响正常页面
