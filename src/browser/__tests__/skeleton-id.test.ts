import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ensureSkeletonId, ensureAllSkeletonIds, initAllSkeletonIds } from '../skeleton-id'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

describe('skeleton-id', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.clearAllMocks()
  })

  describe('ensureSkeletonId', () => {
    it('应为新元素分配 data-skeleton-id', () => {
      const div = document.createElement('div')
      const id = ensureSkeletonId(div)

      expect(id).toMatch(/^e\d+$/)
      expect(div.dataset.skeletonId).toBe(id)
    })

    it('已有 id 时应返回现有 id', () => {
      const div = document.createElement('div')
      div.dataset.skeletonId = 'e42'

      const id = ensureSkeletonId(div)

      expect(id).toBe('e42')
    })

    it('连续分配应递增', () => {
      const d1 = document.createElement('div')
      const d2 = document.createElement('div')

      const id1 = ensureSkeletonId(d1)
      const id2 = ensureSkeletonId(d2)

      const num1 = parseInt(id1.slice(1), 10)
      const num2 = parseInt(id2.slice(1), 10)
      expect(num2).toBe(num1 + 1)
    })
  })

  describe('ensureAllSkeletonIds', () => {
    it('应给 body 下所有元素打 id', () => {
      const div = document.createElement('div')
      const span = document.createElement('span')
      const button = document.createElement('button')
      div.appendChild(span)
      document.body.appendChild(div)
      document.body.appendChild(button)

      ensureAllSkeletonIds()

      expect(div.dataset.skeletonId).toBeDefined()
      expect(span.dataset.skeletonId).toBeDefined()
      expect(button.dataset.skeletonId).toBeDefined()
    })

    it('已有 id 的元素不应被覆盖', () => {
      const div = document.createElement('div')
      div.dataset.skeletonId = 'e999'
      document.body.appendChild(div)

      ensureAllSkeletonIds()

      expect(div.dataset.skeletonId).toBe('e999')
    })
  })

  describe('initAllSkeletonIds', () => {
    it('应执行全量打标', () => {
      const div = document.createElement('div')
      document.body.appendChild(div)

      initAllSkeletonIds()

      expect(div.dataset.skeletonId).toBeDefined()
    })
  })
})
