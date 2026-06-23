# Translation Module

## 模块概述

翻译模块提供三种网页翻译模式：划词翻译（selection popup）、自动翻译（IntersectionObserver 批量）、点击翻译（semantic parent detection）。绕过 Phase1/Phase2 pipeline 直接调用 AI adapter，实现网页内容的实时翻译。

**源文件**:
- `src/browser/translate-service.ts` - 翻译服务核心（AI 调用 + DOM 替换）
- `src/browser/translate-popup.ts` - 划词翻译浮层弹窗
- `src/browser/translate-click.ts` - 点击翻译
- `src/browser/translate-parser.ts` - AI 翻译结果解析器

## 架构设计

```
┌───────────────────────────────────────────────────────────┐
│                    Translation Module                      │
│                                                           │
│  ┌─────────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ TranslateService│  │ TranslatePopup│  │TranslateClick│ │
│  │                 │  │              │  │              │ │
│  │ translateSelection │ showLoading  │  │ initClick    │ │
│  │ translateVisible│  │ updateResult │  │ findSemantic │ │
│  │ abort/restoreAll│  │ hidePopup    │  │ toggle show  │ │
│  └────────┬────────┘  └──────────────┘  └──────────────┘ │
│           │                                               │
│  ┌────────▼────────┐  ┌──────────────┐                   │
│  │ IntersectionObs │  │TranslateParser│                   │
│  │ onIntersection  │  │ parseResponse │                   │
│  │ 200ms debounce  │  │ 3-layer parse │                   │
│  │ flushPending    │  │              │                   │
│  └─────────────────┘  └──────────────┘                   │
│                                                           │
│  ┌─────────────────┐  ┌──────────────┐                   │
│  │ Code Filter     │  │ Skeleton ID  │                   │
│  │ filterCodeText  │  │ ensureAll... │                   │
│  │ {{ic_N}} holder │  │ data-attr    │                   │
│  └─────────────────┘  └──────────────┘                   │
└───────────────────────────────────────────────────────────┘
```

## 核心类型定义

```typescript
// 单个待翻译元素
interface TranslateElement {
  id: string;           // skeletonId
  text: string;         // 原始文本
  el: HTMLElement;       // DOM 元素引用
  inlineCodes: Map<string, string>;  // {{ic_N}} -> 原始代码
}

// 批量翻译结果
interface TranslateResult {
  id: string;
  translated: string;
}

// TranslateService 内部状态
// translatedList: Array<{ id, original, translated }>
// pendingElements: TranslateElement[]
// observedIds: Set<string>
// isTranslating: boolean
```

## 实现细节

### TranslateService 核心类

#### 划词翻译 (translateSelection)

1. `filterCodeText(text)` 过滤内联代码，替换为 `{{ic_N}}` 占位符
2. `callAI()` 调用 adapter 流式获取翻译结果
3. `parseSingleTranslation()` 解析 AI 回复（去除前后说明文字）
4. `restorePlaceholders()` 回填代码占位符
5. 返回译文字符串

#### 自动翻译 (translateVisible)

基于 IntersectionObserver 的批量翻译流程：

1. `ensureAllSkeletonIds()` 全量打标（`data-skeleton-id` 属性）
2. `extractAllTextElements()` 提取页面所有文本元素
   - 过滤代码元素（`isCodeElement`）
   - 过滤不可见元素（`display:none`、`visibility:hidden`）
   - 过滤纯数字/符号文本
   - 父子去重：父子文本完全相同时跳过子元素
3. 为新元素注册 IntersectionObserver
4. 元素进入可视区域 -> `onIntersection` 回调
   - 提取直接子节点文本 + 内联代码占位符
   - 加入 `pendingElements` 队列
   - 200ms 防抖后调用 `flushPending()`

#### flushPending 批量翻译

1. 取出队列并清空
2. 按原始文本去重（相同文本只翻译一次）
3. 给所有元素添加 loading 旋转圈圈
4. `callAIBatch()` 发送给 AI 批量翻译
5. 解析返回的 JSON 数组
6. 翻译结果回填到所有相同文本的元素
7. `replaceElementText()` 处理内联代码结构保留

#### DOM 文本替换 (replaceElementText)

处理含 `{{ic_N}}` 占位符的译文：
- 按占位符拆分译文
- 收集原始 `<code>/<samp>` 元素
- 清空元素内容
- 重建：文本节点 + 占位符对应的原始 `<code>` 元素

### 内联代码过滤

`getDirectTextWithCodes()` 只遍历直接子节点（不递归）：
- `TEXT_NODE` -> 直接拼接
- `<code>/<samp>` -> 替换为 `{{ic_N}}` 占位符，记录原始代码
- 其他元素子节点 -> 跳过（让子元素自己被提取翻译）

这样容器元素（如 `<div>`）不会被翻译，只有叶子元素（如 `<p>`）才会。

### TranslatePopup (划词翻译浮层)

**单例模式**: 全局唯一 `currentPopup` 实例

**生命周期**:
1. `showTranslateLoading(x, y, original)` -> 创建浮层 + loading 动画
2. `updateTranslateResult(translated)` -> 替换内容 + 显示复制按钮
3. `updateTranslateError(message, onRetry)` -> 显示错误 + 刷新按钮
4. `hideTranslatePopup()` -> 移除 DOM + 清理事件监听

**定位策略**: 先临时定位测量尺寸，再根据视口边界调整（左右各留 12px 边距，底部溢出时翻转到选区上方）

**自动关闭**: 点击外部 (`mousedown`) + 页面滚动 (`scroll`)

### TranslateClick (点击翻译)

**语义父级查找 (findSemanticParent)**:

从点击目标向上遍历 DOM 树：
- `td/th/tr` -> `<table>`
- `dt/dd` -> `<dl>`
- `li` (多个) -> `<ol>/<ul>`
- 明确内容元素 (`p`, `h1-h6`, `blockquote`...) -> 直接使用
- 布局容器 (`div`, `section` 有多个子块) -> 向下找最近的叶子内容块

**叶子内容块判断 (isLeafContentBlock)**:
- 明确标签 (`P`, `H1-H6`, `BLOCKQUOTE` 等) -> true
- 没有块级子元素 -> true

**缓存机制**: `WeakMap<HTMLElement, { translated, resultEl }>` 缓存翻译结果，避免重复请求

**交互模式**: 点击 toggle 显示/隐藏，无缓存时请求 AI

### TranslateParser (翻译结果解析)

三层容错解析策略：

1. **直接 JSON.parse**: 纯 JSON 数组
2. **正则提取 `[...]` 块**: JSON 前后有说明文字时，从最后一个匹配开始尝试
3. **逐行提取对象**: 非标准格式，匹配 `{ "id": "eN", "translated": "..." }` 模式

单条翻译解析 (`parseSingleTranslation`):
- 尝试 JSON 解析 `{translated: "..."}`
- 正则提取 `"translated": "..."`
- 去除常见前后缀说明文字

## 数据流

### 划词翻译

```
用户选中文本 -> mouseup
    │
    ▼
showTranslateLoading(x, y, text)    <- 浮层 + loading
    │
    ▼
TranslateService.translateSelection(text, targetLang, settings)
    │ filterCodeText -> callAI -> parseSingleTranslation -> restorePlaceholders
    ▼
updateTranslateResult(translated)   <- 替换浮层内容
```

### 自动翻译

```
translateVisible(targetLang, settings, modelId)
    │
    ├─ ensureAllSkeletonIds()
    ├─ extractAllTextElements()
    ├─ new IntersectionObserver()
    ├─ observer.observe(el) x N
    │
    ▼ (元素进入可视区域)
onIntersection(entries)
    │ getDirectTextWithCodes -> pendingElements.push
    │ 200ms debounce
    ▼
flushPending()
    │
    ├─ 文本去重 -> addLoadingMark
    ├─ callAIBatch(items, targetLang, settings, signal)
    │       │ adapter.chat() 流式收集
    │       ▼ parseTranslateResponse(result)
    ├─ replaceElementText(el, translated) x N
    └─ removeLoadingMark -> translatedList.push
```

## 配置与扩展

- **翻译模式**: 由 `settings.translateMode` 控制 (`off` / `selection` / `auto` / `click`)
- **目标语言**: `settings.translateTargetLang`，默认 `'中文'`
- **模型选择**: 优先使用 `conversationStorage.modelId`（跟随用户在聊天区域的选择），否则用 `settings.defaultModelId`
- **防抖间隔**: IntersectionObserver 回调 200ms 防抖
- **弹窗最大宽度**: 400px
- **弹窗与选区间距**: 8px
- **文本截断**: 单元素文本最大 500 字符

## 已知限制

1. **批量翻译 JSON 格式依赖**: AI 需要严格按照 `[{id, translated}]` 格式返回，三层解析提供容错但仍可能解析失败。
2. **IntersectionObserver 性能**: 全量扫描 `document.body.querySelectorAll('*')` 在大型页面上可能较慢，`extractAllTextElements` 无分批处理。
3. **内联代码占位符冲突**: `{{ic_N}}` 格式理论上可能与页面文本冲突（概率极低）。
4. **翻译不可逆**: `replaceElementText` 直接修改 DOM 文本节点，如果 AI 翻译质量差，原始内容只能通过 `restoreAll()` 还原（依赖 `translatedList` 记录）。
5. **WeakMap 缓存局限**: 点击翻译的 WeakMap 缓存在元素被 GC 后丢失，但这是预期行为。
6. **单次翻译无并发**: `flushPending` 在 `isTranslating=true` 时将批次重新入队，不支持并行翻译请求。
