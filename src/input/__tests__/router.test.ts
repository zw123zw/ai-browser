import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InputRouter } from '../router'
import type { InputContext } from '../types'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

vi.mock('../prompts/common', () => ({
  CAPABILITY_DOMAIN_LIST: [
    { id: 'navigate', desc: '打开URL', needSkeleton: false },
    { id: 'click', desc: '点击元素', needSkeleton: true },
    { id: 'scroll', desc: '滚动页面', needSkeleton: false },
  ],
}))

describe('InputRouter', () => {
  let router: InputRouter

  beforeEach(() => {
    router = new InputRouter()
    vi.clearAllMocks()
  })

  describe('内置命令', () => {
    it('/stop → builtin stop', () => {
      const ctx: InputContext = { text: '/stop', mode: 'text' }
      const result = router.route(ctx)

      expect(result.type).toBe('builtin')
      if (result.type === 'builtin') {
        expect(result.command).toBe('stop')
      }
    })

    it('/pause → builtin pause', () => {
      const ctx: InputContext = { text: '/pause', mode: 'text' }
      const result = router.route(ctx)

      expect(result.type).toBe('builtin')
      if (result.type === 'builtin') {
        expect(result.command).toBe('pause')
      }
    })

    it('/resume → builtin resume', () => {
      const ctx: InputContext = { text: '/resume', mode: 'text' }
      const result = router.route(ctx)

      expect(result.type).toBe('builtin')
      if (result.type === 'builtin') {
        expect(result.command).toBe('resume')
      }
    })

    it('/list → builtin list', () => {
      const ctx: InputContext = { text: '/list', mode: 'text' }
      const result = router.route(ctx)

      expect(result.type).toBe('builtin')
      if (result.type === 'builtin') {
        expect(result.command).toBe('list')
      }
    })

    it('/help → builtin help', () => {
      const ctx: InputContext = { text: '/help', mode: 'text' }
      const result = router.route(ctx)

      expect(result.type).toBe('builtin')
      if (result.type === 'builtin') {
        expect(result.command).toBe('help')
      }
    })

    it('/unknown → builtin unknown', () => {
      const ctx: InputContext = { text: '/unknown', mode: 'text' }
      const result = router.route(ctx)

      expect(result.type).toBe('builtin')
      if (result.type === 'builtin') {
        expect(result.command).toBe('unknown')
      }
    })
  })

  describe('能力域指令', () => {
    it('/navigate → capability', () => {
      const ctx: InputContext = { text: '/navigate https://example.com', mode: 'text' }
      const result = router.route(ctx)

      expect(result.type).toBe('capability')
      if (result.type === 'capability') {
        expect(result.command).toBe('navigate')
        expect(result.args).toBe('https://example.com')
      }
    })

    it('/click → capability', () => {
      const ctx: InputContext = { text: '/click 登录', mode: 'text' }
      const result = router.route(ctx)

      expect(result.type).toBe('capability')
      if (result.type === 'capability') {
        expect(result.command).toBe('click')
        expect(result.args).toBe('登录')
      }
    })
  })

  describe('AI 路由', () => {
    it('普通文本 → ai', () => {
      const ctx: InputContext = { text: '你好', mode: 'text' }
      const result = router.route(ctx)

      expect(result.type).toBe('ai')
    })

    it('带空格文本 → ai（trim 处理）', () => {
      const ctx: InputContext = { text: '  打开百度  ', mode: 'text' }
      const result = router.route(ctx)

      expect(result.type).toBe('ai')
    })

    it('空字符串 → ai', () => {
      const ctx: InputContext = { text: '', mode: 'text' }
      const result = router.route(ctx)

      expect(result.type).toBe('ai')
    })
  })
})
