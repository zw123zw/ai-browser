import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QwenAdapter } from '../qwen'
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

describe('QwenAdapter', () => {
  let adapter: QwenAdapter

  beforeEach(() => {
    adapter = new QwenAdapter()
    vi.clearAllMocks()
  })

  it('name 应为 qwen', () => {
    expect(adapter.name).toBe('qwen')
  })

  describe('chat()', () => {
    const baseOpts: ChatRequestOptions = {
      baseUrl: 'https://dashscope.aliyuncs.com',
      apiKey: 'test-key',
      modelName: 'qwen-turbo',
      messages: [{ id: '1', role: 'user', content: '你好', timestamp: Date.now() }],
    }

    it('应使用 DashScope API 路径', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any) => {
        expect(opts.url).toContain('/services/aigc/text-generation/generation')
      })

      await adapter.chat(baseOpts, vi.fn())
    })

    it('system 消息应作为独立字段', async () => {
      const optsWithSystem: ChatRequestOptions = {
        ...baseOpts,
        messages: [
          { id: '0', role: 'system', content: '你是一个助手', timestamp: Date.now() },
          { id: '1', role: 'user', content: '你好', timestamp: Date.now() },
        ],
      }

      ;(proxyFetchStream as any).mockImplementation(async (opts: any) => {
        const body = JSON.parse(opts.body)
        expect(body.input.system).toBe('你是一个助手')
      })

      await adapter.chat(optsWithSystem, vi.fn())
    })

    it('应解析 output.choices 响应格式', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any, onChunk: Function) => {
        onChunk('data: {"output":{"choices":[{"message":{"content":"你好"}}]}}\n')
        onChunk('data: {"output":{"choices":[{"message":{"content":"世界"},"finish_reason":"stop"}]}}\n')
      })

      const chunks: StreamChunk[] = []
      await adapter.chat(baseOpts, (chunk) => chunks.push(chunk))

      expect(chunks.some(c => c.delta === '你好')).toBe(true)
      expect(chunks.some(c => c.delta === '世界')).toBe(true)
      expect(chunks.some(c => c.done === true)).toBe(true)
    })
  })
})
