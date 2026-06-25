import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { executeAutomationAction } from '../actions'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

vi.mock('../selectors', () => ({
  SEARCH_INPUT_SELECTORS: ['input[type="search"]', 'input[name="q"]'],
  SEARCH_RESULT_SELECTORS: ['.result a', 'h3 a'],
  NEXT_PAGE_SELECTORS: ['.next', 'a[rel="next"]'],
  PREV_PAGE_SELECTORS: ['.prev', 'a[rel="prev"]'],
  findElement: vi.fn(),
  findElements: vi.fn(),
}))

import { findElement, findElements } from '../selectors'

describe('executeAutomationAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    vi.spyOn(window, 'open').mockReturnValue(null)
  })

  describe('open_site', () => {
    it('应打开指定 URL', () => {
      const result = executeAutomationAction('open_site', { url: 'https://example.com' })
      expect(result.success).toBe(true)
      expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank')
    })

    it('应自动添加 https 前缀', () => {
      executeAutomationAction('open_site', { url: 'example.com' })
      expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank')
    })

    it('未指定 URL 时应返回失败', () => {
      const result = executeAutomationAction('open_site', { url: '' })
      expect(result.success).toBe(false)
    })
  })

  describe('search', () => {
    it('应打开百度搜索', () => {
      const result = executeAutomationAction('search', { keyword: '天气' })
      expect(result.success).toBe(true)
      expect(window.open).toHaveBeenCalledWith(
        expect.stringContaining('baidu.com/s?wd='),
        '_blank',
      )
    })

    it('未指定关键词时应返回失败', () => {
      const result = executeAutomationAction('search', { keyword: '' })
      expect(result.success).toBe(false)
    })
  })

  describe('site_search', () => {
    it('应找到搜索框并填入关键词', () => {
      const input = document.createElement('input')
      document.body.appendChild(input)
      ;(findElement as any).mockReturnValue(input)

      const result = executeAutomationAction('site_search', { keyword: '测试' })
      expect(result.success).toBe(true)
      expect(input.value).toBe('测试')
    })

    it('未找到搜索框时应返回失败', () => {
      ;(findElement as any).mockReturnValue(null)
      const result = executeAutomationAction('site_search', { keyword: '测试' })
      expect(result.success).toBe(false)
    })
  })

  describe('open_item', () => {
    it('应点击第 N 个结果', () => {
      const link = document.createElement('a')
      link.click = vi.fn()
      ;(findElements as any).mockReturnValue([link])

      const result = executeAutomationAction('open_item', { index: 1 })
      expect(result.success).toBe(true)
    })

    it('无效序号应返回失败', () => {
      const result = executeAutomationAction('open_item', { index: 0 })
      expect(result.success).toBe(false)
    })

    it('无结果时应返回失败', () => {
      ;(findElements as any).mockReturnValue([])
      const result = executeAutomationAction('open_item', { index: 1 })
      expect(result.success).toBe(false)
    })
  })

  describe('page_next', () => {
    it('应点击下一页按钮', () => {
      const btn = document.createElement('a')
      btn.click = vi.fn()
      ;(findElement as any).mockReturnValue(btn)

      const result = executeAutomationAction('page_next', {})
      expect(result.success).toBe(true)
    })

    it('无下一页按钮时应滚动到底部', () => {
      ;(findElement as any).mockReturnValue(null)
      window.scrollTo = vi.fn()

      const result = executeAutomationAction('page_next', {})
      expect(result.success).toBe(true)
      expect(window.scrollTo).toHaveBeenCalled()
    })
  })

  describe('page_prev', () => {
    it('应点击上一页按钮', () => {
      const btn = document.createElement('a')
      btn.click = vi.fn()
      ;(findElement as any).mockReturnValue(btn)

      const result = executeAutomationAction('page_prev', {})
      expect(result.success).toBe(true)
    })

    it('无上一页按钮时应浏览器后退', () => {
      ;(findElement as any).mockReturnValue(null)
      window.history.back = vi.fn()

      const result = executeAutomationAction('page_prev', {})
      expect(result.success).toBe(true)
    })
  })

  describe('video_play / video_pause', () => {
    it('应播放视频', () => {
      const video = document.createElement('video')
      video.play = vi.fn().mockResolvedValue(undefined)
      document.body.appendChild(video)

      const result = executeAutomationAction('video_play', {})
      expect(result.success).toBe(true)
    })

    it('应暂停视频', () => {
      const video = document.createElement('video')
      video.pause = vi.fn()
      document.body.appendChild(video)

      const result = executeAutomationAction('video_pause', {})
      expect(result.success).toBe(true)
    })

    it('无视频元素时应返回失败', () => {
      const result = executeAutomationAction('video_play', {})
      expect(result.success).toBe(false)
    })
  })

  describe('未知 action', () => {
    it('应返回失败', () => {
      const result = executeAutomationAction('unknown_action' as any, {})
      expect(result.success).toBe(false)
    })
  })
})
