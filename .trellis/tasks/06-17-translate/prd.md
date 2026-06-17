# 翻译功能：划词翻译 + 自动翻译

## Goal

在 AI 浏览器助手扩展中实现翻译功能，包含两种场景：
1. **划词翻译** — 用户手动选中文本后翻译，浮层弹窗展示译文
2. **自动翻译** — 自动翻译可视窗口内所有文本元素，直接替换原文，滚动时增量翻译

翻译设置放在 SettingsModal 的「通用配置」tab 的「划词操作」下方。

核心设计原则：前端本地过滤代码块，完全不把代码丢给翻译 AI，三层过滤（标签黑名单 + class 黑名单 + 文本正则），成本更低、翻译效果更好。

## Decision (ADR-lite)

**Context**: 翻译功能需要确定展示方式、AI 通信格式、滚动策略等多个设计决策。

**Decision**:
| 决策 | 选择 | 理由 |
|------|------|------|
| 划词翻译展示 | 浮层弹窗（原文+译文） | 局部文本替换会断裂上下文，浮层可关闭/复制 |
| 自动翻译展示 | 直接替换原文 | 全量翻译场景，浮层太多干扰，替换最干净 |
| 设置 UI | 两个独立开关 + 目标语言下拉 | 划词翻译和自动翻译独立控制，互不影响 |
| 目标语言 | 设置里选择，源语言 AI 自动识别 | 用户明确需求 |
| 滚动策略 | 防抖 500ms | 避免滚动中频繁请求，体验平滑 |
| 翻译模型 | 用默认模型 | 零配置 |
| 批量通信格式 | JSON 数组（10 条/批） | 解析简单可靠，比编号列表不易出错 |

**Consequences**: 翻译绕过 Phase1/Phase2 pipeline，直接调用 adapter。需要新增翻译专用 prompt 和标签解析逻辑。

## Requirements

### 一、设置 UI（SettingsModal.vue 通用配置 tab）

在「划词操作」radio group 下方新增翻译配置区块：

```
划词操作: [自动发送] [手动发送] [关闭]

--- 翻译配置 ---
目标语言: [下拉选择: 中文 / English / 日本語 / 한국어 / Français / Deutsch / Español / Русский]
☑ 划词翻译    选中文字后弹出翻译浮层
☑ 自动翻译    页面文本自动翻译为目标语言
```

- 目标语言、划词翻译开关、自动翻译开关 → 存入 AppSettings 持久化
- 新增字段：`translateTargetLang?: string`、`selectionTranslate?: boolean`、`autoTranslate?: boolean`

### 二、划词翻译流程

```
用户选中文本 (mouseup)
  ↓
获取 Selection 对象 → rangeCount > 0
  ↓
提取选中文本 + 所在父元素的 skeletonId
  ↓
三层代码过滤（标签 + class + 正则）
代码替换为 {{code_01}} 占位符，记录原始代码
  ↓
调用 translateText(filteredText, targetLang)
  ↓
AI 返回翻译结果
  ↓
前端回填占位符（{{code_01}} → 原始代码）
  ↓
在选区附近显示浮层弹窗（译文 + 复制按钮 + 关闭按钮）
```

**浮层弹窗设计**：
- 定位：选区 getBoundingClientRect() 附近
- 内容：译文文本 + 「复制」按钮 + 「✕」关闭
- 样式：圆角卡片，阴影，最大宽度 400px，超长可滚动
- 点击页面其他区域自动关闭

### 三、自动翻译流程

**首次翻译**：
```
页面加载完成 + autoTranslate 开启
  ↓
ensureAllSkeletonIds() 全量打标
  ↓
遍历可视窗口内所有元素
  ↓
提取有文本的元素 → 生成翻译列表 [{id, original}]
  ↓
三层代码过滤（跳过 pre/code/hljs 等容器，内联代码用占位符）
  ↓
批量翻译（10 条/批，JSON 数组格式）
  ↓
AI 返回翻译 → 按 id 匹配 → 替换 DOM textContent
  ↓
存入已翻译 Map<id, original> 用于去重
```

**滚动增量翻译**：
```
监听 scroll 事件（passive: true）
  ↓
防抖 500ms
  ↓
ensureAllSkeletonIds() 给新元素打标
  ↓
提取可视窗口内有文本的元素
  ↓
与已翻译 Map 去重 → 仅保留新增元素
  ↓
批量翻译新增元素 → 替换 DOM
  ↓
更新已翻译 Map
```

### 四、代码过滤三层机制

新建 `src/browser/code-filter.ts`：

**Layer 1 — 标签黑名单**（直接跳过，不提取文本）：
- `pre`, `code`, `samp`

**Layer 2 — Class 黑名单**（直接跳过）：
- 匹配 class 包含：`hljs`, `language-`, `code-block`, `highlight`, `syntax`

**Layer 3 — 文本正则兜底**（对提取到的文本做正则，替换为占位符）：
```typescript
// 匹配内联代码特征
const CODE_PATTERNS = [
  /`[^`]+`/g,                           // 反引号包裹
  /\{[^}]*\}/g,                         // 花括号块
  /\[[^\]]*\]/g,                        // 方括号块（排除中文标点）
  /\/\/[^\n]*/g,                        // 单行注释
  /\/\*[\s\S]*?\*\//g,                  // 多行注释
  /\b(function|const|let|var|return|import|export|class|if|else|for|while|switch|case|break|continue|try|catch|throw|new|this|typeof|instanceof)\b/g,  // 关键字
  /\b\w+\s*\([^)]*\)/g,                // 函数调用
  /https?:\/\/[^\s]+/g,                 // URL
  /\b\d+\.\d+\.\d+[\w.-]*\b/g,        // 版本号
  /\$ [^\n]*/g,                         // 命令行
  /> [^\n]*/g,                          // 命令行
]
```

**占位符规则**：
- 替换为 `{{code_N}}` 格式（N 从 01 递增）
- 翻译完成后前端按编号回填原始代码
- AI 提示词中明确说明：不要翻译 `{{code_N}}` 占位符，原样返回

### 五、AI 提示词设计（src/input/prompts.ts）

**翻译系统提示词**：
```typescript
export const TRANSLATE_SYSTEM_PROMPT = `\`\`\`
你是一个专业翻译。规则：
1. 只翻译自然语言文本，不要翻译 {{code_N}} 占位符
2. 保持原文的语气和风格
3. 不要添加解释、注释或额外内容
4. 只返回翻译结果，不要输出其他内容
\`\`\``
```

**划词翻译用户消息**：
```typescript
export function buildSelectionTranslateMessage(
  text: string,
  targetLang: string,
): string {
  return `将以下文本翻译为${targetLang}：\n\n${text}`
}
```

**自动翻译用户消息**：
```typescript
export function buildAutoTranslateMessage(
  texts: Array<{ id: string; text: string }>,
  targetLang: string,
): string {
  return `将以下文本翻译为${targetLang}。返回 JSON 数组格式，每个元素包含 id 和 translated 字段。不要翻译 {{code_N}} 占位符。

输入：
${JSON.stringify(texts)}

返回格式：
[{"id":"e1","translated":"译文1"},{"id":"e2","translated":"译文2"}]`
}
```

### 六、AI 回复解析

**划词翻译**：直接取 AI 返回的文本作为译文（无需解析标签）。

**自动翻译**：从 AI 回复中解析 JSON 数组。

新建 `src/browser/translate-parser.ts`：

```typescript
/**
 * 从 AI 回复中提取翻译结果
 * 
 * AI 可能返回纯 JSON，也可能在 JSON 前后包裹其他文本。
 * 需要鲁棒解析：
 * 1. 先尝试直接 JSON.parse
 * 2. 失败则用正则提取 [...] 块
 * 3. 再失败则逐行提取 {"id":...,"translated":...} 对象
 */
export function parseTranslateResponse(raw: string): TranslateResult[] {
  // 1. 直接解析
  try {
    const arr = JSON.parse(raw.trim())
    if (Array.isArray(arr)) return validateResults(arr)
  } catch {}
  
  // 2. 提取 JSON 数组块
  const jsonMatch = raw.match(/\[[\s\S]*?\]/)
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0])
      if (Array.isArray(arr)) return validateResults(arr)
    } catch {}
  }
  
  // 3. 逐行提取
  const results: TranslateResult[] = []
  const lineRegex = /\{"id"\s*:\s*"(e\d+)"\s*,\s*"translated"\s*:\s*"([^"]*)"\s*\}/g
  let m: RegExpExecArray | null
  while ((m = lineRegex.exec(raw)) !== null) {
    results.push({ id: m[1], translated: m[2] })
  }
  return results
}

function validateResults(arr: unknown[]): TranslateResult[] {
  return arr.filter(
    (item): item is TranslateResult =>
      typeof item === 'object' && item !== null &&
      typeof (item as any).id === 'string' &&
      typeof (item as any).translated === 'string'
  )
}
```

### 七、翻译服务层

新建 `src/browser/translate-service.ts`：

```typescript
/**
 * 翻译服务
 * 
 * 统一管理划词翻译和自动翻译的 AI 调用逻辑。
 * 绕过 Phase1/Phase2 pipeline，直接调用 adapter。
 */
export class TranslateService {
  private translatedMap = new Map<string, string>() // id → original
  private abortController: AbortController | null = null
  
  /** 划词翻译：单条文本 */
  async translateSelection(text: string, targetLang: string): Promise<string> {
    const filtered = filterCode(text)  // 三层过滤 + 占位符
    const result = await callAI(filtered.text, targetLang)
    return restorePlaceholders(result, filtered.placeholders)
  }
  
  /** 自动翻译：批量翻译可视窗口元素 */
  async translateVisible(targetLang: string): Promise<void> {
    const elements = extractVisibleTextElements()  // 提取可视窗口文本元素
    const newElements = elements.filter(el => !this.translatedMap.has(el.id))
    if (newElements.length === 0) return
    
    const batches = chunk(newElements, 10)  // 10 条/批
    for (const batch of batches) {
      const filtered = batch.map(el => ({
        id: el.id,
        text: filterCode(el.text).text,
      }))
      const results = await callAIBatch(filtered, targetLang)
      for (const { id, translated } of results) {
        replaceElementText(id, translated)
        this.translatedMap.set(id, translated)
      }
    }
  }
  
  /** 增量翻译（滚动后调用） */
  async translateIncremental(targetLang: string): Promise<void> {
    // 同 translateVisible 逻辑，已翻译的会被 filterCode 过滤掉
    await this.translateVisible(targetLang)
  }
  
  /** 取消翻译 */
  abort(): void {
    this.abortController?.abort()
    this.abortController = null
  }
  
  /** 重置（页面切换时调用） */
  reset(): void {
    this.translatedMap.clear()
    this.abort()
  }
}
```

### 八、DOM 操作

**提取可视窗口文本元素**（复用 skeleton.ts 的可视窗口检测逻辑）：
```typescript
function extractVisibleTextElements(): Array<{ id: string; text: string; el: HTMLElement }> {
  ensureAllSkeletonIds()
  const elements: Array<{ id: string; text: string; el: HTMLElement }> = []
  const allEls = document.body.querySelectorAll('*:not(script,style,noscript)')
  
  for (const el of allEls) {
    const htmlEl = el as HTMLElement
    if (!isElementVisible(htmlEl)) continue
    if (!isInViewport(htmlEl)) continue
    if (isCodeElement(htmlEl)) continue  // Layer 1+2 过滤
    
    const text = getDirectText(htmlEl)
    if (!text || text.length < 2) continue
    
    elements.push({
      id: htmlEl.dataset.skeletonId!,
      text,
      el: htmlEl,
    })
  }
  return elements
}
```

**替换元素文本**：
```typescript
function replaceElementText(skeletonId: string, translated: string): void {
  const el = document.querySelector(`[data-skeleton-id="${skeletonId}"]`)
  if (!el) return
  
  // 优先替换直接子文本节点
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      node.textContent = translated
      return
    }
  }
  
  // 回退：替换第一个子元素的文本
  for (const child of el.children) {
    if ((child as HTMLElement).innerText?.trim()) {
      (child as HTMLElement).innerText = translated
      return
    }
  }
}
```

### 九、事件监听

**划词翻译**（content script 中）：
```typescript
document.addEventListener('mouseup', (e) => {
  if (!settings.selectionTranslate) return
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const text = selection.toString().trim()
  if (!text || text.length < 2) return
  
  showTranslatePopup(e.clientX, e.clientY, text, settings.translateTargetLang)
})
```

**自动翻译滚动监听**：
```typescript
let scrollTimer: number | null = null
window.addEventListener('scroll', () => {
  if (!settings.autoTranslate) return
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = window.setTimeout(() => {
    translateService.translateIncremental(settings.translateTargetLang)
  }, 500)
}, { passive: true })
```

## Acceptance Criteria

- [ ] 划词翻译：选中文本 → 浮层弹窗显示译文 → 可复制
- [ ] 自动翻译：页面加载后可视窗口文本自动替换为译文
- [ ] 滚动增量：停止滚动 500ms 后新元素自动翻译，已翻译不重复
- [ ] 代码过滤：`<pre>` `<code>` `hljs` class 等代码块不被翻译
- [ ] 占位符回填：内联代码用 `{{code_N}}` 保护，翻译后正确回填
- [ ] 设置持久化：翻译配置保存到 AppSettings 并跨页面同步
- [ ] 取消翻译：支持中断正在进行的翻译请求
- [ ] AI 回复解析：鲁棒解析 JSON 数组，处理 AI 返回非标准格式
- [ ] 提示词：占位符不被翻译，AI 原样返回 `{{code_N}}`

## Definition of Done

- 代码通过 TypeScript 类型检查
- 新增模块有对应单元测试（code-filter、translate-parser）
- 提示词经过实际模型验证翻译质量
- 设置 UI 与现有风格一致

## Out of Scope (explicit)

- OCR 识图翻译（后续迭代）
- 翻译记忆/缓存（后续优化）
- 单独配置翻译模型（用默认模型）
- 代码注释翻译的特殊处理（后续迭代）
- 翻译历史记录

## Technical Notes

### 新增文件清单
| 文件 | 用途 |
|------|------|
| `src/browser/code-filter.ts` | 三层代码过滤 + 占位符替换/回填 |
| `src/browser/translate-parser.ts` | AI 翻译回复解析（鲁棒 JSON 提取） |
| `src/browser/translate-service.ts` | 翻译服务（划词 + 自动 + 增量） |
| `src/browser/translate-popup.ts` | 划词翻译浮层弹窗 UI |

### 修改文件清单
| 文件 | 修改内容 |
|------|----------|
| `src/input/prompts.ts` | 新增 TRANSLATE_SYSTEM_PROMPT + 消息构建函数 |
| `src/types.ts` | AppSettings 新增翻译相关字段 |
| `src/stores/settings.ts` | 设置 store 支持翻译字段 |
| `entrypoints/content/components/SettingsModal.vue` | 通用配置新增翻译 UI |
| `entrypoints/content/index.ts` | 初始化翻译事件监听 |
