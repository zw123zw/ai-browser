# 浏览器命令功能参考

AI 通过语义骨架理解页面结构，生成结构化指令（Command），由执行引擎转化为浏览器 DOM 操作。

## 功能总览

| Action | 用途 | 需要元素 | 需要骨架 | 关键参数 |
|--------|------|---------|---------|---------|
| click | 点击元素 | 是 | 是 | elementId, fallbackSelector, text |
| type | 输入文本 | 是 | 是 | elementId, text |
| clear | 清空输入框 | 是 | 是 | elementId |
| scroll | 滚动页面 | 否 | 否 | direction, amount |
| navigate | 导航到 URL | 否 | 否 | url |
| select | 下拉选择 | 是 | 是 | elementId, text |
| keyboard / press | 键盘按键 | 否 | 否 | key, description |
| focus | 聚焦元素 | 是 | 是 | elementId |
| hover | 悬停元素 | 是 | 是 | elementId |
| wait | 等待 | 否 | 否 | ms |
| video | 视频控制 | 是 | 是 | subAction, value |
| newTab | 新建标签页 | 否 | 否 | url（可选） |
| closeTab | 关闭标签页 | 否 | 否 | 无 |
| switchTab | 切换标签页 | 否 | 否 | tabQuery |
| nextTab / prevTab | 前后切换标签页 | 否 | 否 | 无 |
| download | 提取页面数据 | 否 | 是 | description |
| summarize | 分析总结页面 | 否 | 是 | description |
| end | 结束任务 | 否 | 否 | done |

---

## 语义骨架结构

### SemanticSkeleton 字段

```typescript
interface SemanticSkeleton {
  url: string                    // 当前页面 URL
  title: string                  // 页面标题
  viewport: { width: number; height: number }  // 视口尺寸
  scroll: { y: number; height: number }        // 滚动位置和文档总高度
  hasModal: boolean              // 是否有弹窗遮罩阻挡交互
  loading: boolean               // document.readyState !== 'complete'
  focusedElement?: string        // 当前焦点元素的 skeletonId
  totalInteractive: number       // 页面总可交互元素数（去重前）
  truncated: boolean             // 元素列表是否被截断（>200 上限）
  alerts?: string[]              // 页面错误/状态提示
  elements: SkeletonElement[]    // 可交互元素列表
}
```

### SkeletonElement 字段

```typescript
interface SkeletonElement {
  // 身份标识
  id: string           // 唯一标识 e1, e2, ...（对应 data-skeleton-id）
  tag: string          // 标签名
  role?: string        // ARIA role

  // 内容信息
  text?: string        // 用户可见文字（截断 100 字符）
  label?: string       // 表单元素关联的 label 文本
  ariaLabel?: string   // aria-label / title / img[alt]
  placeholder?: string // 输入框占位提示（截断 50 字符）

  // 导航信息
  href?: string        // <a> 标签目标 URL（截断 80 字符）

  // 表单属性
  inputType?: string   // input type: text/password/email/tel/search/number/date/file
  value?: string       // 当前输入值（截断 20 字符，密码框不提取）
  checked?: boolean    // checkbox/radio 是否选中
  required?: boolean   // 是否必填

  // 交互状态
  disabled?: boolean   // 是否禁用
  expanded?: boolean   // 展开/折叠状态
  selected?: boolean   // 选中状态

  // 上下文位置
  parent?: string      // 父级地标标签（nav/header/main/aside/footer）
}
```

---

## 元素查找机制（三重降级）

| 优先级 | 定位方式 | 数据来源 | 可靠性 |
|--------|----------|----------|--------|
| 1 | `elementId` → `data-skeleton-id` | 骨架提取时标记的稳定 ID | 最高 |
| 2 | `fallbackSelector` → CSS 选择器 | AI 根据页面结构生成 | 中等 |
| 3 | `description` → 文本内容匹配 | AI 从用户意图提取的关键词 | 最低（兜底） |

**文本匹配**分两轮搜索：
1. 优先搜索交互元素（`a`/`button`/`input`/`select`/`textarea`/`label`/`[role="button"]`/`[onclick]`/`[tabindex]`）
2. 兜底搜索所有元素（覆盖 `div`/`span` + SVG 图标按钮），过滤不可见元素

匹配范围：`textContent`、`aria-label`、`title`、`placeholder`，使用 `includes()` 模糊匹配。

---

## 骨架提取规则

### 可交互元素判定

满足以下任一条件即判定为可交互：

- 原生交互标签：`a`, `button`, `input`, `select`, `textarea`, `label`, `summary`, `details`
- 媒体元素：`video`, `audio`
- `contenteditable="true"` 或 `contenteditable=""`
- `onclick` 属性存在
- `role` 为 `button`/`link`/`menuitem`/`tab`/`option`/`switch`/`checkbox`/`radio`
- `tabindex` 属性存在
- CSS `cursor: pointer`

### 可见性检测

- 排除 `display: none` 和 `visibility: hidden`
- `offsetParent` 非 null 或 `position: fixed` 判定为可见

### 元素上限

- **视口骨架**：最多 200 元素（`MAX_SKELETON_ELEMENTS`）
- **全页骨架**：无元素上限（`[need_full]` 触发时使用）

### 弹窗检测

检测页面是否有弹窗/遮罩层阻挡交互：

1. 原生 `dialog[open]`
2. ARIA `role="dialog"` / `role="alertdialog"` / `aria-modal="true"`
3. 框架弹窗：Bootstrap (`.modal.show`)、Element UI (`.el-dialog__wrapper`)、Ant Design (`.ant-modal-wrap`)、Material UI (`.MuiDialog-root`)、Vuetify (`.v-dialog--active`)
4. 通用遮罩：`[class*="overlay"]`、`[class*="mask"]` 等面积 > 50% 视口的 fixed/absolute 元素

### 页面提示（alerts）

扫描页面上的错误/状态提示文本，写入 `SemanticSkeleton.alerts`：

- `role="alert"` 或 `aria-live="assertive/polite"` 元素
- `class`/`id` 含 `error`/`alert`/`toast`/`notice`/`warning`/`tip` 的可见元素
- 最多 5 条，每条 < 200 字符

---

## 各操作详解

### click — 点击元素

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| elementId | string | 骨架元素 ID（主定位） |
| fallbackSelector | string | CSS 选择器（备选定位） |
| text | string | 文本内容（兜底定位） |
| description | string | 操作描述 |

**行为：**

触发完整的鼠标事件序列：
```
PointerEvent('pointerdown') → MouseEvent('mousedown') → FocusEvent('focus')
→ PointerEvent('pointerup') → MouseEvent('mouseup') → MouseEvent('click')
```

每个事件都携带正确的 `clientX`/`clientY`（元素中心点坐标）、`bubbles: true`、`cancelable: true`。

**特殊处理：**

- **Label 转发**：点击 `<label>` 时自动查找关联表单元素
  - `label[for="id"]` → `document.getElementById()`
  - label 内嵌的表单元素
  - 同级容器内的表单元素（Element UI 等组件库模式）
- **`<a>` 标签**：
  - `href` 为空/`#`/`javascript:` → patch window.open 后触发点击
  - 真实 URL + `target="_self"` → `window.location.href` 跳转
  - 真实 URL + `target="_blank"` → `window.open` 新窗口
- **新标签页检测**：临时替换 `window.open` 为检测函数，点击后恢复

---

### type — 输入文本

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| elementId | string | 骨架元素 ID |
| text | string | 要输入的文本 |

**行为（按优先级尝试）：**

1. **CodeMirror 编辑器**：`cmElement.CodeMirror.setValue(text)`
2. **Monaco 编辑器**：`monacoElement.__editor.setValue(text)`
3. **Ace 编辑器**：`aceElement.env.editor.session.setValue(text)`
4. **contenteditable**（Quill/TinyMCE/CKEditor 等）：`document.execCommand('selectAll')` + `document.execCommand('insertText')`
5. **标准 input/textarea**：`nativeInputValueSetter` 绕过 React/Vue 受控组件 + `Event('input')` + `Event('change')`

---

### scroll — 页面滚动

**参数：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| direction | string | — | `up`/`down`/`left`/`right`/`top`/`bottom`/`auto`/`stop`/`pause`/`resume` |
| amount | number | 视口 80% | 滚动像素距离 |

**一次性滚动：**
- `up`/`down`：`scrollBy({ top: ±amount, behavior: 'smooth' })`
- `top`：`scrollTo({ top: 0 })`
- `bottom`：`scrollTo({ top: scrollHeight })`

**自动滚动（持久化到 chrome.storage.local，跨页面/标签页共享）：**
- `auto`：开始自动向下滚动（requestAnimationFrame 循环，速度 1px/帧）
- `stop`：停止自动滚动
- `pause`：暂停（滚轮向上触发）
- `resume`：恢复（滚轮向下触发）
- 滚轮向上自动暂停，向下自动恢复
- 到达底部自动停止

---

### navigate — 导航到 URL

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| url | string | 目标 URL |

**行为：** 通过 background 的 `tab-action` 消息在新标签页打开 URL。

---

### video — 视频控制

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| subAction | string | 子操作类型 |
| value | number | 数值参数 |

**子操作：**

| subAction | 参数 | 说明 |
|-----------|------|------|
| play | 无 | 播放视频 |
| pause | 无 | 暂停视频 |
| volume | 0-1 | 设置音量（自动取消静音） |
| mute | 无 | 静音 |
| unmute | 无 | 取消静音 |
| seek | seconds | 相对跳转（正数快进，负数快退） |
| jump | seconds | 绝对跳转到指定时间 |
| speed | rate | 设置播放速率（如 1.5、2） |
| fullscreen | 无 | 因浏览器安全限制需用户手势，返回失败提示 |

---

### switchTab — 切换标签页

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| tabQuery | string | 目标标签页关键词 |

**行为：** 将关键词通过站点别名映射扩展为同义词列表，在所有标签页的 `title` 和 `url` 中查找匹配。

**站点别名表：**

| 用户说法 | 匹配关键词 |
|---------|-----------|
| b站 / bilibili / 哔哩哔哩 | bilibili, 哔哩哔哩 |
| 淘宝 | taobao, 淘宝 |
| 京东 | jd.com, 京东 |
| 谷歌 | google, 谷歌 |
| 油管 / youtube | youtube |
| 推特 / twitter | twitter, x.com |
| 知乎 | zhihu, 知乎 |
| 微博 | weibo, 微博 |
| 抖音 | douyin, 抖音, tiktok |
| 掘金 | juejin, 掘金 |
| 必应 | bing, 必应 |

---

### download — 提取页面数据

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| description | string | 用户的数据提取需求描述 |

**行为：**

1. `extractDataElements()` 提取页面所有有文本内容的元素（不限于可交互元素）
2. 提取表格 td/th（含 row/col 位置）、列表 li、段落 p、图片 img（src/alt）、链接 a（href）
3. `cleanDataForExtraction()` 清洗数据，限制 500 条
4. `buildExtractPrompt()` 构建提示词（`EXTRACT_SYSTEM_PROMPT` + 用户请求 + 骨架数据）
5. AI 生成 `[FILE:filename.ext]...[/FILE]` 标签
6. 通过 `onFileOutput` 回调返回给前端渲染和下载
7. 必须 `done:1`（一次性操作）

---

### summarize — 分析总结页面

**参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| description | string | 用户的分析需求描述 |

**行为：**

1. `extractPageText()` 通过 `document.body.innerText` 提取页面全文（限制 15000 字符）
2. `buildSummarizePrompt()` 构建提示词（`SUMMARIZE_SYSTEM_PROMPT` + 用户请求 + 页面全文）
3. AI 生成分析总结
4. 通过 `onChatStart` → `onChatDelta` → `onChatEnd` 以聊天消息形式返回
5. 必须 `done:1`（一次性操作）

---

## Command JSON 结构

```json
{
  "action": "click",
  "elementId": "e5",
  "fallbackSelector": "#submit-btn",
  "text": "提交",
  "url": "https://example.com",
  "key": "Enter",
  "direction": "down",
  "amount": 500,
  "ms": 1000,
  "description": "点击提交按钮",
  "tabAction": "newTab",
  "tabQuery": "google",
  "done": 1,
  "subAction": "play",
  "value": 0.8
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| action | string | 操作类型（必填） |
| elementId | string | 骨架元素 ID |
| fallbackSelector | string | CSS 选择器 |
| text | string | type/select 的文本 / click 的文本匹配 |
| url | string | navigate 的目标 URL |
| key | string | keyboard 的按键名 |
| direction | string | scroll 的方向 |
| amount | number | scroll 的像素距离 |
| ms | number | wait 的毫秒数 |
| description | string | 操作描述 |
| tabAction | string | 标签页操作类型 |
| tabQuery | string | switchTab 的关键词 |
| done | number | 1=最后一步，0=还有步骤 |
| subAction | string | video 的子操作类型 |
| value | number | video 的数值参数 |

---

## 错误处理

### 元素未找到的回退链

```
elementId 未命中 → fallbackSelector 未命中 → description 文本匹配未命中
  → 返回 ActionResult { success: false }
    → AI 输出 [need_full] → 提取全页骨架 → AI 用 elementId 生成新 Command
```

### 各操作的错误场景

| 操作 | 错误场景 | 处理方式 |
|------|----------|----------|
| findElement | CSS 选择器语法错误 | catch 后继续下一优先级 |
| navigate | chrome.runtime.sendMessage 失败 | 返回失败消息 |
| video | 未找到 video 元素 | 返回失败消息 |
| video/fullscreen | 浏览器安全限制 | 返回提示用 click 点击全屏按钮 |
| select | 目标不是 `<select>` 元素 | 返回失败消息 |
| scroll | 未知方向 | 返回失败消息 |
| 标签页操作 | background 通信失败 | 返回失败消息 |
