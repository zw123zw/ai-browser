/**
 * 浏览器命令执行层
 */

export { extractSkeleton, extractFullSkeleton, SkeletonManager } from './skeleton'
export type { SkeletonScope } from './skeleton'
export { ActionExecutor } from './action-executor'
export { extractFullPageSkeleton } from './local-html'
export type {
  SkeletonElement,
  SemanticSkeleton,
  Command,
  ActionResult,
} from './types'
