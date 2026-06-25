import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAIAdapter } from '../openai'
import type { ChatRequestOptions, StreamChunk } from '@/src/types'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

vi.mock('../proxy', () => ({
  proxyFetch: vi.fn(),
  proxyFetchStream: vi.fn(),
}))

import { proxyFetchStream } from '../proxy'

describe('OpenAIAdapter', () => {
  let adapter: OpenAIAdapter

  beforeEach(() => {
    adapter = new OpenAIAdapter()
    vi.clearAllMocks()
  })

  it('name 应为 openai', () => {
    expect(adapter.name).toBe('openai')
  })

  describe('chat()', () => {
    const baseOpts: ChatRequestOptions = {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      modelName: 'gpt-4',
      messages: [{ id: '1', role: 'user', content: '你好', timestamp: Date.now() }],
    }

    it('应通过 proxyStream 发送请求', async () => {
      const chunks: StreamChunk[] = []
      ;(proxyFetchStream as any).mockImplementation(async (opts: any, onChunk: Function) => {
        // 模拟 SSE 数据
        onChunk('data: {"choices":[{"delta":{"content":"你"}}]}\n')
        onChunk('data: {"choices":[{"delta":{"content":"好"}}]}\n')
        onChunk('data: {"choices":[{"finish_reason":"stop"}]}\n')
      })

      await adapter.chat(baseOpts, (chunk) => chunks.push(chunk))

      expect(proxyFetchStream).toHaveBeenCalled()
      expect(chunks.some(c => c.delta === '你')).toBe(true)
      expect(chunks.some(c => c.delta === '好')).toBe(true)
      expect(chunks.some(c => c.done === true)).toBe(true)
    })

    it('应处理 Anthropic 协议（provider=anthropic）', async () => {
      const anthropicOpts = { ...baseOpts, provider: 'anthropic' as const }
      ;(proxyFetchStream as any).mockImplementation(async (opts: any, onChunk: Function) => {
        onChunk('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n')
        onChunk('event: message_stop\ndata: {"type":"message_stop"}\n')
      })

      const chunks: StreamChunk[] = []
      await adapter.chat(anthropicOpts, (chunk) => chunks.push(chunk))

      expect(chunks.some(c => c.delta === 'hello')).toBe(true)
      expect(chunks.some(c => c.done === true)).toBe(true)
    })

    it('应处理 reasoning/thinking delta', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any, onChunk: Function) => {
        onChunk('data: {"choices":[{"delta":{"reasoning_content":"思考中"}}]}\n')
        onChunk('data: {"choices":[{"delta":{"content":"回答"}}]}\n')
        onChunk('data: {"choices":[{"finish_reason":"stop"}]}\n')
      })

      const chunks: StreamChunk[] = []
      await adapter.chat(baseOpts, (chunk) => chunks.push(chunk))

      expect(chunks.some(c => c.reasoningDelta === '思考中')).toBe(true)
      expect(chunks.some(c => c.delta === '回答')).toBe(true)
    })

    it('AbortSignal 中止时应抛出 AbortError', async () => {
      const controller = new AbortController()
      ;(proxyFetchStream as any).mockImplementation(async (opts: any) => {
        controller.abort()
        throw new DOMException('The operation was aborted.', 'AbortError')
      })

      const opts = { ...baseOpts, signal: controller.signal }
      await expect(adapter.chat(opts, vi.fn())).rejects.toThrow('The operation was aborted.')
    })

    it('应处理 [DONE] 结束标记', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any, onChunk: Function) => {
        onChunk('data: {"choices":[{"delta":{"content":"hi"}}]}\n')
        onChunk('data: [DONE]\n')
      })

      const chunks: StreamChunk[] = []
      await adapter.chat(baseOpts, (chunk) => chunks.push(chunk))

      expect(chunks.some(c => c.done === true)).toBe(true)
    })

    it('应跳过空数据行', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any, onChunk: Function) => {
        onChunk('data: \n')
        onChunk('\n')
        onChunk('data: {"choices":[{"delta":{"content":"ok"}}]}\n')
        onChunk('data: [DONE]\n')
      })

      const chunks: StreamChunk[] = []
      await adapter.chat(baseOpts, (chunk) => chunks.push(chunk))

      expect(chunks.some(c => c.delta === 'ok')).toBe(true)
    })
  })
})
