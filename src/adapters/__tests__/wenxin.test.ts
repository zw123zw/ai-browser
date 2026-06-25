import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WenxinAdapter } from '../wenxin'
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

describe('WenxinAdapter', () => {
  let adapter: WenxinAdapter

  beforeEach(() => {
    adapter = new WenxinAdapter()
    vi.clearAllMocks()
  })

  it('name 应为 wenxin', () => {
    expect(adapter.name).toBe('wenxin')
  })

  describe('chat()', () => {
    const baseOpts: ChatRequestOptions = {
      baseUrl: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop',
      apiKey: 'test-key',
      modelName: 'ernie-bot',
      messages: [{ id: '1', role: 'user', content: '你好', timestamp: Date.now() }],
    }

    it('应使用 /chat/completions 端点', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any) => {
        expect(opts.url).toContain('/chat/completions')
      })

      await adapter.chat(baseOpts, vi.fn())
    })

    it('应解析 result 字段', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any, onChunk: Function) => {
        onChunk('data: {"result":"你好世界"}\n')
        onChunk('data: {"is_end":true}\n')
      })

      const chunks: StreamChunk[] = []
      await adapter.chat(baseOpts, (chunk) => chunks.push(chunk))

      expect(chunks.some(c => c.delta === '你好世界')).toBe(true)
      expect(chunks.some(c => c.done === true)).toBe(true)
    })

    it('应处理错误响应', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any, onChunk: Function) => {
        onChunk('data: {"error_code":100,"error_msg":"Invalid API key"}\n')
      })

      const chunks: StreamChunk[] = []
      // Wenxin 错误在 processChunk 中抛出，由 proxyStream 传播
      await adapter.chat(baseOpts, (chunk) => chunks.push(chunk))
      // 不应崩溃，错误被 catch
    })
  })
})
