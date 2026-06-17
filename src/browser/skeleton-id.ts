/**
 * data-skeleton-id 公共打标工具
 *
 * 统一管理骨架 ID 的分配，供骨架提取和关键词搜索共用。
 * idCounter 模块级持久化，跨调用不重置。
 */

import { Logger } from '@/src/utils/logger'

const log = new Logger('SkeletonId')

/** 模块级 id 计数器 */
let idCounter = 0

/** 不需要打标的非交互元素标签 */
const SKIP_TAGS = 'script,style,noscript,meta,link,br,hr'

/**
 * 扫描文档中已有 data-skeleton-id，同步 idCounter 到最大值
 */
function syncIdCounter(doc: Document): void {
  const allElements = doc.body.querySelectorAll(`*:not(${SKIP_TAGS})`)
  for (const el of allElements) {
    const existingId = (el as HTMLElement).dataset.skeletonId
    if (existingId) {
      const num = parseInt(existingId.slice(1), 10)
      if (!isNaN(num) && num > idCounter) idCounter = num
    }
  }
}

/**
 * 确保单个元素有 data-skeleton-id
 *
 * 有则返回现有 id，无则新增并返回。
 */
export function ensureSkeletonId(el: HTMLElement): string {
  const existing = el.dataset.skeletonId
  if (existing) return existing
  const id = `e${++idCounter}`
  el.dataset.skeletonId = id
  return id
}

/**
 * 全量打标：同步计数器 + 给 body 下所有元素打 data-skeleton-id
 *
 * 有则跳过，无则新增。骨架提取/关键词搜索前调用，确保懒加载元素也有 id。
 */
export function ensureAllSkeletonIds(): void {
  syncIdCounter(document)
  const allElements = document.body.querySelectorAll(`*:not(${SKIP_TAGS})`)
  for (const el of allElements) {
    ensureSkeletonId(el as HTMLElement)
  }
}

/**
 * 首次加载全量打标（带日志）
 */
export function initAllSkeletonIds(): void {
  ensureAllSkeletonIds()
  const count = document.body.querySelectorAll('*').length
  log.info('首次全量打标完成', { count, idCounter })
}
