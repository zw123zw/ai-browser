import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DoubaoAdapter } from '../doubao'
import type { ChatRequestOptions, StreamChunk } from '@/src/types'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

vi.mock('../proxy', () => ({
  proxyFetchStream: vi.fn(),
}))

import { proxyFetchStream } from '../proxy'

describe('DoubaoAdapter', () => {
  let adapter: DoubaoAdapter

  beforeEach(() => {
    adapter = new DoubaoAdapter()
    vi.clearAllMocks()
  })

  it('name 应为 doubao', () => {
    expect(adapter.name).toBe('doubao')
  })

  describe('chat()', () => {
    const baseOpts: ChatRequestOptions = {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'test-key',
      modelName: 'doubao-pro',
      messages: [{ id: '1', role: 'user', content: '你好', timestamp: Date.now() }],
    }

    it('应使用 /chat/completions 端点', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any) => {
        expect(opts.url).toContain('/chat/completions')
      })

      await adapter.chat(baseOpts, vi.fn())
    })

    it('应使用 OpenAI 兼容格式', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any) => {
        const body = JSON.parse(opts.body)
        expect(body.model).toBe('doubao-pro')
        expect(body.stream).toBe(true)
        expect(body.messages).toBeDefined()
      })

      await adapter.chat(baseOpts, vi.fn())
    })

    it('应解析 choices 响应', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any, onChunk: Function) => {
        onChunk('data: {"choices":[{"delta":{"content":"你好"}}]}\n')
        onChunk('data: {"choices":[{"delta":{"content":"世界"},"finish_reason":"stop"}]}\n')
      })

      const chunks: StreamChunk[] = []
      await adapter.chat(baseOpts, (chunk) => chunks.push(chunk))

      expect(chunks.some(c => c.delta === '你好')).toBe(true)
      expect(chunks.some(c => c.delta === '世界')).toBe(true)
      expect(chunks.some(c => c.done === true)).toBe(true)
    })
  })
})
