# PRD：语义骨架字段优化

> 版本：v1.0 | 日期：2026-06-20 | 状态：待评审

---

## 1. 背景与目标

### 1.1 现状问题

当前骨架提取存在两个核心问题：

**页面级信息缺失**：AI 不知道视口尺寸、滚动位置、是否有弹窗等页面状态，导致：
- 不知道哪些元素在可视范围内
- 尝试点击被弹窗遮罩挡住的元素
- 页面加载中时提取不完整骨架

**元素级信息不足**：每个元素只提取 `id/tag/text/label/parent`，导致：
- 图标按钮只有 `(icon)`，AI 不知道干嘛的
- 不知道 `<a>` 标签的 href 目标
- 不知道 input 的类型（password/email/tel）
- 不知道元素是否 disabled/checked/expanded
- `ariaLabel/title` 被合并进 `text`，丢失语义区分

### 1.2 目标

1. **页面级**：扩展 `SemanticSkeleton`，新增视口/滚动/弹窗/焦点等页面状态字段
2. **元素级**：扩展 `SkeletonElement`，按 AI 决策维度分组新增字段
3. **消息简化**：用整块 skeleton JSON 替代散落拼接，减少代码复杂度
4. **对齐无障碍树**：role + name + description + state，与 AI Agent 最佳实践一致

### 1.3 非目标

- 不改变骨架提取的范围策略（viewport/full）
- 不改变去重逻辑
- 不改变 200 元素上限
- 不改变 alerts 提取逻辑

---

## 2. 接口设计

### 2.1 SemanticSkeleton（页面级）

```ts
interface SemanticSkeleton {
  // ═══ 页面标识 ═══
  url: string              // 当前页面 URL
  title: string            // 页面标题

  // ═══ 视口 & 滚动 ═══
  viewport: {
    width: number          // window.innerWidth
    height: number         // window.innerHeight
  }
  scroll: {
    y: number              // window.scrollY
    height: number         // document.documentElement.scrollHeight
  }

  // ═══ 页面状态 ═══
  hasModal: boolean        // 是否有弹窗/遮罩层阻挡交互
  loading: boolean         // document.readyState !== 'complete'
  focusedElement?: string  // 当前焦点元素的 skeletonId

  // ═══ 骨架统计 ═══
  totalInteractive: number // 页面总可交互元素数（去重前）
  truncated: boolean       // 元素列表是否被截断

  // ═══ 提示 & 元素 ═══
  alerts?: string[]        // 错误/状态提示
  elements: SkeletonElement[]
}
```

### 2.2 SkeletonElement（元素级）

```ts
interface SkeletonElement {
  // ═══ 1. 身份标识 ═══
  id: string            // e1, e2 ...
  tag: string           // a, button, input ...
  role?: string         // ARIA role: button, link, tab, checkbox ...

  // ═══ 2. 内容信息 ═══
  text?: string         // 用户可见文字（截断 100 字符）
  label?: string        // 关联 <label> 文本（表单元素专用）
  ariaLabel?: string    // aria-label / title / img[alt]
  placeholder?: string  // 输入框占位提示

  // ═══ 3. 导航信息 ═══
  href?: string         // <a> 标签目标 URL（截断 80 字符）

  // ═══ 4. 表单属性 ═══
  inputType?: string    // text/password/email/tel/search/number/date/file ...
  value?: string        // 当前输入值（截断 20 字符）
  checked?: boolean     // checkbox/radio 是否选中
  required?: boolean    // 是否必填

  // ═══ 5. 交互状态 ═══
  disabled?: boolean    // 是否禁用
  expanded?: boolean    // 展开/折叠状态
  selected?: boolean    // 选中状态（tab/option）

  // ═══ 6. 上下文 ═══
  parent?: string       // 地标父级: nav/header/main/aside/footer
}
```

### 2.3 字段分组说明

| 分组 | 字段 | 适用元素 | AI 用途 |
|------|------|---------|---------|
| 身份 | id, tag, role | 所有 | 元素定位与类型识别 |
| 内容 | text, label, ariaLabel, placeholder | 所有/表单/图标/输入 | 理解元素含义 |
| 导航 | href | `<a>` | 知道链接去向 |
| 表单 | inputType, value, checked, required | input/select/textarea | 表单填写决策 |
| 状态 | disabled, expanded, selected | 交互元素 | 避免操作无效元素 |
| 上下文 | parent | 所有 | 理解页面结构 |

---

## 3. 字段提取规则

### 3.1 role 提取

```
优先级：
1. el.getAttribute('role')  → 直接取 ARIA role
2. 语义标签自动映射：
   <a> → "link"（有 href 时）
   <button> → "button"
   <input type="checkbox"> → "checkbox"
   <input type="radio"> → "radio"
   <select> → "combobox" 或 "listbox"
   <textarea> → "textbox"
   <details> → "group"
   <summary> → "button"
3. 无 role 且非语义标签 → 不输出
```

### 3.2 ariaLabel 提取（与 text 分离）

```
当前逻辑（有问题）：
  text = getDirectText(el)           // 优先取可见文字
  if (!text && hasIcon) {
    text = el.getAttribute('aria-label') || el.getAttribute('title')  // 合并进 text
  }

优化后逻辑：
  text = getDirectText(el)           // 仅可见文字
  ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || img.alt

  // 两者独立，不合并
  // 图标按钮：text 为空，ariaLabel = "搜索"
  // 文字按钮：text = "登录"，ariaLabel 可能为空
  // 两者都有时都输出
```

### 3.3 href 提取

```
仅 <a> 标签：
  href = el.getAttribute('href')
  截断 80 字符
  过滤 javascript:void(0) 和 #（不输出）
  相对路径转绝对路径
```

### 3.4 inputType 提取

```
仅 <input> 标签：
  inputType = el.type || 'text'
  常见值：text, password, email, tel, search, number, date, file, checkbox, radio
  checkbox/radio 不再提取 inputType，改用 checked 字段
```

### 3.5 value 提取

```
仅 input/textarea：
  value = el.value
  截断 20 字符
  密码框不提取 value（安全考虑）
  空值不输出
```

### 3.6 disabled 提取

```
适用：button, input, select, textarea, fieldset
  disabled = el.disabled || el.getAttribute('aria-disabled') === 'true'
  仅 true 时输出（节省 token）
```

### 3.7 checked 提取

```
仅 input[type=checkbox] 和 input[type=radio]：
  checked = el.checked
  仅 true 时输出
```

### 3.8 expanded 提取

```
适用：details, [aria-expanded], [role="menuitem"], [role="treeitem"]
  expanded = el.open || el.getAttribute('aria-expanded') === 'true'
  仅 true 时输出
```

### 3.9 selected 提取

```
适用：option, [role="tab"], [role="option"], [role="menuitem"]
  selected = el.selected || el.getAttribute('aria-selected') === 'true'
  仅 true 时输出
```

### 3.10 required 提取

```
仅表单元素：
  required = el.required || el.getAttribute('aria-required') === 'true'
  仅 true 时输出
```

### 3.11 placeholder 提取

```
仅 input/textarea：
  placeholder = el.getAttribute('placeholder')
  截断 50 字符
  空值不输出
```

### 3.12 hasModalOverlay 检测

```
按优先级检测：
1. dialog[open]                     → 原生 dialog
2. [role="dialog"]                  → ARIA dialog
3. [role="alertdialog"]             → ARIA alert dialog
4. [aria-modal="true"]              → ARIA modal
5. .modal.show                      → Bootstrap
6. .el-dialog__wrapper              → Element UI
7. .ant-modal-wrap                  → Ant Design
8. [class*="overlay/mask/backdrop"] → 通用遮罩（面积 > 50% 视口）

检测条件：元素可见 + 在视口内
```

### 3.13 focusedElement 提取

```
const focused = document.activeElement
if (focused && focused.dataset.skeletonId) {
  focusedElement = focused.dataset.skeletonId
}
```

### 3.14 loading 检测

```
loading = document.readyState !== 'complete'
```

---

## 4. 消息格式变更

### 4.1 之前（散落拼接）

```
[原始请求] 用户: "登录"

[已完成] 1. click e3 (首页)

[当前页面] https://example.com/login | 登录页面

[页面提示] 验证码错误

[当前页面骨架]
[{"id":"e1","tag":"a","text":"首页"}]
```

### 4.2 之后（整块序列化）

```
[原始请求] 用户: "登录"

[已完成] 1. click e3 (首页)

[页面骨架]
{"url":"https://example.com/login","title":"登录页面","viewport":{"width":1280,"height":720},"scroll":{"y":0,"height":2400},"hasModal":false,"loading":false,"focusedElement":"e5","totalInteractive":47,"truncated":false,"alerts":["验证码错误"],"elements":[{"id":"e1","tag":"a","text":"首页","href":"/","parent":"nav"},{"id":"e5","tag":"input","label":"手机号","inputType":"tel","placeholder":"请输入手机号","required":true}]}
```

### 4.3 消息构建函数变更

```ts
// 之前
export function buildStreamingUserMessage(text, skeleton, completed, ...) {
  parts.push(`[当前页面] ${skeleton.url} | ${skeleton.title}`)
  if (skeleton.alerts?.length) parts.push(`[页面提示] ${skeleton.alerts.join(' | ')}`)
  parts.push(`[当前页面骨架]\n${JSON.stringify(skeleton.elements)}`)
}

// 之后
export function buildStreamingUserMessage(text, skeleton, completed, ...) {
  parts.push(`[页面骨架]\n${JSON.stringify(skeleton)}`)
}
```

---

## 5. Token 成本分析

### 5.1 页面级字段增量

| 字段 | 增量（字符） | 出现频率 | 说明 |
|------|-------------|---------|------|
| viewport | +30 | 100% | 固定开销 |
| scroll | +30 | 100% | 固定开销 |
| hasModal | +14 | 100% | 布尔值 |
| loading | +12 | 100% | 布尔值 |
| focusedElement | +20 | ~30% | 仅焦点元素存在时 |
| totalInteractive | +22 | 100% | 数字 |
| truncated | +14 | ~10% | 仅截断时为 true |
| **小计** | **~100-140** | | |

### 5.2 元素级字段增量（每个元素）

| 字段 | 增量（字符） | 出现频率 | 说明 |
|------|-------------|---------|------|
| role | +15 | ~30% | 仅语义角色元素 |
| ariaLabel | +20 | ~15% | 替代合并进 text 的逻辑 |
| placeholder | +25 | ~5% | 仅 input/textarea |
| href | +20 | ~10% | 仅 `<a>` |
| inputType | +15 | ~5% | 仅 `<input>` |
| value | +15 | ~3% | 仅有值 input |
| checked | +12 | ~2% | 仅 checkbox/radio |
| required | +13 | ~3% | 仅必填表单 |
| disabled | +14 | ~2% | 仅禁用元素 |
| expanded | +14 | ~1% | 仅可展开元素 |
| selected | +14 | ~2% | 仅可选中元素 |
| **每个元素平均** | **+5~15** | | |

### 5.3 总体成本

- 页面级固定增量：~120 字符（~30 tokens）
- 元素级平均增量：~10 字符/元素 × 50 元素 = ~500 字符（~125 tokens）
- **总增量：~155 tokens/次请求**

对比收益：AI 决策准确度大幅提升，减少重试次数（每次重试消耗 ~2000 tokens），净收益为正。

---

## 6. 实现计划

### Phase 1：接口定义（Task #2, #3）
- 扩展 `SemanticSkeleton` 接口
- 扩展 `SkeletonElement` 接口
- 更新 `INTERACTIVE_TAGS` 常量

### Phase 2：元素级提取（Task #4）
- 改造 `extractElement()` 函数
- 新增 role/href/inputType/value/ariaLabel 等字段提取
- 优化 text/ariaLabel 分离逻辑

### Phase 3：页面级提取（Task #5, #6）
- 新增 `hasModalOverlay()` 函数
- 改造 `extractSkeleton()` 填充页面级字段
- 提取 focusedElement/loading/viewport/scroll

### Phase 4：消息简化（Task #7）
- 简化 `buildStreamingUserMessage()`
- 用整块 skeleton JSON 替代散落拼接

### Phase 5：测试（Task #8）
- 更新 `skeleton.test.ts`
- 覆盖新字段提取逻辑
- 覆盖弹窗检测

### Phase 6：Code Review（Task #9）
- 第一次：功能性审查
- 第二次：质量与性能审查

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Token 增量导致上下文窗口紧张 | 中 | 仅在有值时输出字段；历史消息用 stripHeavyData 清理 |
| 弹窗检测误判 | 低 | 多选择器组合检测，覆盖主流框架 |
| text/ariaLabel 分离导致去重失效 | 中 | 去重逻辑同时检查 text 和 ariaLabel |
| 密码框 value 泄露 | 高 | password 类型不提取 value |

---

## 8. 验收标准

- [ ] SemanticSkeleton 包含所有页面级字段
- [ ] SkeletonElement 包含所有元素级字段
- [ ] text 和 ariaLabel 正确分离
- [ ] href 仅在 `<a>` 标签输出
- [ ] inputType 仅在 `<input>` 输出
- [ ] disabled/checked/expanded/selected 仅在 true 时输出
- [ ] 弹窗检测覆盖 dialog/role=dialog/常见框架
- [ ] 密码框不提取 value
- [ ] 消息构建函数简化为整块 JSON
- [ ] 所有测试通过
- [ ] Code Review ×2 通过
