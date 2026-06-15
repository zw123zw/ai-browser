/**
 * 浏览器命令执行层类型定义
 *
 * 定义语义骨架、指令结构、执行结果等核心类型
 */

/** 骨架中的单个元素 */
export interface SkeletonElement {
  id: string                // 唯一标识 e1, e2, ...
  tag: string               // 标签名
  text?: string             // 可见文字（截断 100 字符）
  href?: string             // a 标签的 href
  src?: string              // img/video/audio 的 src
  type?: string             // input 的 type
  name?: string             // input 的 name
  placeholder?: string      // input 的 placeholder
  value?: string            // input/textarea 的当前值
  role?: string             // ARIA role
  ariaLabel?: string        // aria-label
  title?: string            // title 属性（按钮/链接的提示文字）
  parent?: string           // 父级地标标签（nav/header/main 等）
  class?: string            // 仅保留 data-testid 等定位属性
}

/** 页面语义骨架 */
export interface SemanticSkeleton {
  url: string
  title: string
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
}

/** 执行结果 */
export interface ActionResult {
  success: boolean
  message: string
}

/** [need_html] 请求 */
export interface NeedHtmlRequest {
  keywords: string[] // AI 对用户意图分词，用于在页面 HTML 中搜索
  reason: string     // 为什么需要 HTML
  description: string // 操作描述
}
