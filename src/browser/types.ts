/**
 * 浏览器命令执行层类型定义
 *
 * 定义语义骨架、指令结构、执行结果等核心类型
 *
 * 骨架字段按 AI 决策维度分组：
 * 1. 身份标识 — id/tag/role
 * 2. 内容信息 — text/label/ariaLabel/placeholder
 * 3. 导航信息 — href
 * 4. 表单属性 — inputType/value/checked/required
 * 5. 交互状态 — disabled/expanded/selected
 * 6. 上下文位置 — parent
 */

/** 原生可交互元素标签（骨架提取 + 模糊匹配共用） */
export const INTERACTIVE_TAGS = ['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'details']

/** 骨架中的单个元素（精简版：只保留 AI 定位和识别所需的核心字段） */
export interface SkeletonElement {
  // ═══ 1. 身份标识 ═══
  id: string                // 唯一标识 e1, e2, ...
  tag: string               // 标签名
  role?: string             // ARIA role: button, link, tab, menuitem, checkbox, switch ...

  // ═══ 2. 内容信息 ═══
  text?: string             // 用户可见文字（截断 100 字符）
  label?: string            // 表单元素关联的 label 文本（如 input 关联 "活动名称"）
  ariaLabel?: string        // aria-label / title / img[alt] — 辅助说明（不与 text 合并）
  placeholder?: string      // 输入框占位提示（截断 50 字符）

  // ═══ 3. 导航信息 ═══
  href?: string             // <a> 标签目标 URL（截断 80 字符）

  // ═══ 4. 表单属性 ═══
  inputType?: string        // input type: text/password/email/tel/search/number/date/file ...
  value?: string            // 当前输入值（截断 20 字符，密码框不提取）
  checked?: boolean         // checkbox/radio 是否选中（仅 true 时输出）
  required?: boolean        // 是否必填（仅 true 时输出）

  // ═══ 5. 交互状态 ═══
  disabled?: boolean        // 是否禁用（仅 true 时输出）
  expanded?: boolean        // 展开/折叠状态（仅 true 时输出）
  selected?: boolean        // 选中状态（仅 true 时输出）

  // ═══ 6. 上下文位置 ═══
  parent?: string           // 父级地标标签（nav/header/main/aside/footer）
}

/** 页面视口信息 */
export interface ViewportInfo {
  width: number             // window.innerWidth
  height: number            // window.innerHeight
}

/** 页面滚动信息 */
export interface ScrollInfo {
  y: number                 // window.scrollY — 当前滚动位置
  height: number            // document.documentElement.scrollHeight — 文档总高度
}

/** 页面语义骨架 */
export interface SemanticSkeleton {
  // ═══ 页面标识 ═══
  url: string
  title: string

  // ═══ 视口 & 滚动 ═══
  viewport: ViewportInfo
  scroll: ScrollInfo

  // ═══ 页面状态 ═══
  hasModal: boolean         // 是否有弹窗/遮罩层阻挡交互
  loading: boolean          // document.readyState !== 'complete'
  focusedElement?: string   // 当前焦点元素的 skeletonId

  // ═══ 骨架统计 ═══
  totalInteractive: number  // 页面总可交互元素数（去重前）
  truncated: boolean        // 元素列表是否被截断（>200 上限）

  // ═══ 提示 & 元素 ═══
  alerts?: string[]         // 页面错误/状态提示（role=alert、aria-live、error/alert 类名等）
  elements: SkeletonElement[]
}

/** 浏览器指令 */
export interface Command {
  action: string           // 操作类型（AI 自由生成，在能力域内）
  elementId?: string       // 骨架中的元素 ID（主定位）
  fallbackSelector?: string // CSS 选择器（备选定位）
  text?: string            // type 操作的输入文字
  url?: string             // navigate 操作的目标 URL
  key?: string             // keyboard 操作的按键
  direction?: string       // scroll 操作的方向
  amount?: number          // scroll 操作的滚动像素
  ms?: number              // wait 操作的等待时间
  description?: string     // 操作描述（日志用 / 文本匹配兜底）
  tabAction?: 'newTab' | 'closeTab' | 'switchTab' | 'nextTab' | 'prevTab' // 标签页操作类型
  tabQuery?: string        // switchTab 的目标标签关键词（如 "B站"、"淘宝"）
  done?: number            // 1=最后一步，0=还有步骤（用于停止判断）
  subAction?: string       // video 操作的子类型（play/pause/volume/mute/seek/jump/speed/fullscreen）
  value?: number           // video 操作的值（音量 0-1、快进秒数、播放速度等）
}

/** 执行结果 */
export interface ActionResult {
  success: boolean
  message: string
  /** click 操作是否新开标签页（_blank / window.open） */
  openedNewTab?: boolean
}
