# 翻译功能参考

三种翻译模式，直接替换页面 DOM 文本，绕过 Phase1/Phase2 AI 管道直接调用 adapter。

## 功能总览

| 模式 | 触发方式 | 输出形式 | 核心场景 |
|------|----------|----------|----------|
| 划词翻译 (selection) | 鼠标选中文本 | 选区附近浮层弹窗 | 用户主动选择片段翻译 |
| 自动翻译 (auto) | 页面滚动/加载 | 直接替换页面 DOM 文本 | 全页沉浸式翻译 |
| 点击翻译 (click) | 点击文本块 | 块级元素下方插入翻译卡片 | 按需逐段翻译 |

**模式控制：** `AppSettings.translateMode`，可选值：`'selection'`、`'auto'`、`'click'`、`'off'`（默认 `'off'`）。

---

## 划词翻译

**触发：** 鼠标选中文本后 `mouseup` 事件

**流程：**

1. 检测选中文本
2. 忽略来自扩展 UI 内部的事件
3. `showTranslateLoading(x, y, original)` 显示浮层弹窗（loading 状态）
4. `TranslateService.translateSelection()` 调用 AI
5. `updateTranslateResult(translated)` 更新浮层为译文

**弹窗功能：**
- 显示译文 + 原文（灰色小字）
- 复制按钮（翻译完成后显示）
- 重试按钮（翻译失败时显示）
- 自动定位（确保不超出视口，超出底部时翻转到选区上方）
- 自动关闭：外部点击（延迟 100ms 注册）+ 滚动事件（passive）

---

## 自动翻译

**触发：** 页面加载 + URL 变化 + DOM 变化

**监听机制：**

| 监听器 | 配置 | 防抖 | 说明 |
|--------|------|------|------|
| IntersectionObserver | `rootMargin: '0px', threshold: 0` | 200ms | 元素进入可视区域 |
| MutationObserver | `childList + subtree + characterData` | 200ms | DOM 动态变化 |
| URL 变化 | monkey-patch pushState/replaceState + popstate/hashchange | 800ms | SPA 路由跳转 |

**流程：**

1. `extractAllTextElements()` 扫描全页所有文本元素
2. IntersectionObserver 监听元素进入可视区域
3. 元素进入可视区域 → 加入 `pendingElements` 队列 → `unobserve`
4. 防抖 200ms → `flushPending()` 批量翻译
5. 按文本去重（`textGroupMap`）→ 发给 AI → 解析结果 → 替换 DOM

**文本去重：**
- **元素提取阶段**：父子去重（祖先文本完全相同则跳过后代）
- **批量翻译阶段**：相同文本只取第一个 id 发给 AI，翻译结果回填到所有相同文本的元素

---

## 点击翻译

**触发：** 点击页面文本区域

**语义父级查找算法（`findSemanticParent`）：**

从点击目标向上遍历 DOM：
1. `td/th/tr/thead/tbody/tfoot` → 找最近的 `<table>`
2. `dt/dd` → 找最近的 `<dl>`
3. `li`（多个）→ 找 `<ol>`/`<ul>`；单个 → 用 `<li>` 本身
4. 明确内容元素（p, h1-h6, blockquote...）→ 直接使用
5. 布局容器（div, section 有多个子块）→ 向下找离点击最近的叶子内容块
6. 内联元素 → 继续向上

**缓存：** `WeakMap<HTMLElement, { translated, resultEl }>`，元素从 DOM 移除后自动 GC。

**Toggle 行为：** 首次点击请求翻译；后续点击切换结果卡片的显示/隐藏。

---

## 代码过滤（三层机制）

### Layer 1：标签黑名单

`<pre>`、独立 `<code>`、`<samp>` 整体跳过，不提取翻译。

### Layer 2：Class 黑名单

包含以下类名的元素整体跳过：

`hljs`, `language-*`, `code-block`, `highlight`, `syntax`, `prism`, `shiki`, `codemirror`, `ace_`

### Layer 3：文本正则替换

将代码片段替换为 `{{code_NN}}` 占位符，翻译后恢复。13 种正则模式（按优先级排列）：

| 模式 | 示例 |
|------|------|
| 块注释 | `/* ... */` |
| 反引号字符串 | `` `template literal` `` |
| 行注释 | `// comment` |
| URL | `https://example.com/path` |
| CLI 命令 | `npm install --save` |
| JSON 片段 | `{"key": "value"}` |
| 函数调用 | `functionName(arg1, arg2)` |
| 属性链 | `obj.prop.subprop` |
| 花括号/方括号块 | `{ ... }` / `[ ... ]` |
| 连续编程关键字 | `const let var function` |
| 版本号 | `v1.2.3` |
| 文件路径 | `/usr/local/bin/node` |

**注意：** 纯中文内容不做替换，避免误杀中文标点。

---

## 内联代码保留

页面中 `<code>`、`<samp>` 等内联代码元素在翻译后保留原始结构。

**提取阶段（`getDirectTextWithCodes`）：**

遍历元素的直接子节点：
- `textNode` → 直接拼接
- `<code>` / `<samp>` → 替换为 `{{ic_N}}` 占位符，记录原始代码
- 其他元素子节点 → 跳过

**替换阶段（`replaceElementText`）：**

1. 检测译文是否包含 `{{ic_N}}` 占位符
2. 若有，按占位符拆分译文，保留原始 `<code>` 元素
3. 若无，直接替换第一个非空 textNode

---

## 翻译响应解析（三层容错）

### 批量翻译（自动翻译场景）

| 优先级 | 策略 | 说明 |
|--------|------|------|
| 1 | 直接 JSON.parse | AI 返回标准 JSON 数组 |
| 2 | 正则提取 `[...]` 块 | AI 返回 JSON 前后有说明文字，从最后一个匹配开始尝试 |
| 3 | 逐行提取 `{id, translated}` | AI 返回非标准格式 |

### 单条翻译（划词/点击场景）

1. 尝试 JSON.parse，提取 `.translated` 字段
2. 正则匹配 `"translated": "..."`
3. 去除常见前后缀（"以下是"、"翻译结果："、"希望..."、"以上..."）

---

## 翻译提示词

系统提示词（`TRANSLATE_SYSTEM_PROMPT`）：

```
你是一个专业翻译。严格遵守以下规则：
1. 只翻译自然语言文本，不要翻译 {{code_N}} 格式的占位符，原样返回
2. 保持原文的语气、风格和格式
3. 不要添加解释、注释、引言或额外内容
4. 划词翻译：只返回翻译后的文本
5. 批量翻译：只返回 JSON 数组，格式 [{"id":"e1","translated":"译文"}]
```

消息构建：将系统提示词和用户内容合并到单条 `user` 消息中，不使用 `system` 角色。

---

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| AI 调用失败 | 划词：`updateTranslateError` + 重试按钮；点击：`fillError` + 重试按钮 |
| AI 返回空结果 | 视为失败，显示 "翻译失败" + 重试 |
| AbortError | 静默忽略，清除所有 loading 标记 |
| 翻译进行中新请求 | 自动翻译：重新入队等待 |
