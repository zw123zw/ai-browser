/**
 * data-skeleton-id 公共打标工具
 *
 * 统一管理骨架 ID 的分配，供骨架提取和关键词搜索共用。
 * idCounter 模块级持久化，跨调用不重置。
 *
 * 支持 Shadow DOM 递归打标：遍历所有 shadowRoot，给内部元素分配 ID。
 */

import { Logger } from '@/src/utils/logger'

const log = new Logger('SkeletonId')

/** 模块级 id 计数器 */
let idCounter = 0

/** 不需要打标的非交互元素标签 */
const SKIP_TAGS = 'script,style,noscript,meta,link,br,hr'

/** Shadow DOM 递归深度上限 */
const SHADOW_DOM_MAX_DEPTH = 10

/**
 * 扫描文档中已有 data-skeleton-id，同步 idCounter 到最大值
 */
function syncIdCounter(root: Document | ShadowRoot): void {
  const allElements = root.querySelectorAll(`*:not(${SKIP_TAGS})`)
  for (const el of allElements) {
    const existingId = (el as HTMLElement).dataset.skeletonId
    if (existingId) {
      // 提取数字部分（支持 e1, fi1, sd0_e1 等格式）
      const match = existingId.match(/(\d+)$/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (!isNaN(num) && num > idCounter) idCounter = num
      }
    }
    // 递归进入 shadowRoot
    const shadowRoot = (el as HTMLElement).shadowRoot
    if (shadowRoot) {
      syncIdCounter(shadowRoot)
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
 * 包含 Shadow DOM 递归打标。
 */
export function ensureAllSkeletonIds(): void {
  syncIdCounter(document)
  const allElements = document.body.querySelectorAll(`*:not(${SKIP_TAGS})`)
  for (const el of allElements) {
    ensureSkeletonId(el as HTMLElement)
    // 递归进入 shadowRoot 打标
    const shadowRoot = (el as HTMLElement).shadowRoot
    if (shadowRoot) {
      ensureShadowDomIds(shadowRoot, 1)
    }
  }
}

/**
 * 给 Shadow DOM 内部元素打 data-skeleton-id（递归）
 *
 * @param shadowRoot ShadowRoot 对象
 * @param depth 当前递归深度（从 1 开始）
 */
function ensureShadowDomIds(shadowRoot: ShadowRoot, depth: number): void {
  if (depth > SHADOW_DOM_MAX_DEPTH) return
  const allElements = shadowRoot.querySelectorAll(`*:not(${SKIP_TAGS})`)
  for (const el of allElements) {
    ensureSkeletonId(el as HTMLElement)
    const childShadow = (el as HTMLElement).shadowRoot
    if (childShadow) {
      ensureShadowDomIds(childShadow, depth + 1)
    }
  }
}

/**
 * 给指定文档（如 iframe 的 contentDocument）的所有元素打 data-skeleton-id
 *
 * 同源 iframe 骨架提取前调用，确保 iframe 内元素也有 id。
 * 包含 Shadow DOM 递归打标。
 */
export function ensureAllSkeletonIdsForDoc(doc: Document): void {
  syncIdCounter(doc)
  if (!doc.body) return
  const allElements = doc.body.querySelectorAll(`*:not(${SKIP_TAGS})`)
  for (const el of allElements) {
    ensureSkeletonId(el as HTMLElement)
    const shadowRoot = (el as HTMLElement).shadowRoot
    if (shadowRoot) {
      ensureShadowDomIds(shadowRoot, 1)
    }
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
