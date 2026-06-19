/**
 * 浏览器命令执行层类型定义
 *
 * 定义语义骨架、指令结构、执行结果等核心类型
 */

/** 原生可交互元素标签（骨架提取 + 模糊匹配共用） */
export const INTERACTIVE_TAGS = ['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'details']

/** 骨架中的单个元素（精简版：只保留 AI 定位和识别所需的核心字段） */
export interface SkeletonElement {
  id: string                // 唯一标识 e1, e2, ...
  tag: string               // 标签名
  text?: string             // 可见文字（截断 100 字符，已含 ariaLabel/title/placeholder 的 fallback）
  label?: string            // 表单元素关联的 label 文本（如 input 关联 "活动名称"）
  parent?: string           // 父级地标标签（nav/header/main 等）
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
  done?: number            // 1=最后一步，0=还有步骤（用于停止判断）
  subAction?: string       // video 操作的子类型（play/pause/volume/mute/seek/jump/speed/fullscreen）
  value?: number           // video 操作的值（音量 0-1、快进秒数、播放速度等）
}

/** 执行结果 */
export interface ActionResult {
  success: boolean
  message: string
  /** navigate 操作返回的新标签页 ID（用于跨标签页续接） */
  tabId?: number
}

