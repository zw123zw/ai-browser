/**
 * 浏览器命令执行层
 */

export { extractSkeleton, SkeletonManager } from './skeleton'
export { ActionExecutor } from './action-executor'
export { extractLocalHtml } from './local-html'
export type {
  SkeletonElement,
  SemanticSkeleton,
  Command,
  ActionResult,
  NeedHtmlRequest,
} from './types'
