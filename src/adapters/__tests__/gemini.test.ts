import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GeminiAdapter } from '../gemini'
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

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter

  beforeEach(() => {
    adapter = new GeminiAdapter()
    vi.clearAllMocks()
  })

  it('name 应为 gemini', () => {
    expect(adapter.name).toBe('gemini')
  })

  describe('chat()', () => {
    const baseOpts: ChatRequestOptions = {
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'test-key',
      modelName: 'gemini-pro',
      messages: [{ id: '1', role: 'user', content: '你好', timestamp: Date.now() }],
    }

    it('应发送 x-goog-api-key 认证头', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any) => {
        expect(opts.headers['x-goog-api-key']).toBe('test-key')
      })

      await adapter.chat(baseOpts, vi.fn())
      expect(proxyFetchStream).toHaveBeenCalled()
    })

    it('应使用 systemInstruction 字段', async () => {
      const optsWithSystem: ChatRequestOptions = {
        ...baseOpts,
        messages: [
          { id: '0', role: 'system', content: '你是一个助手', timestamp: Date.now() },
          { id: '1', role: 'user', content: '你好', timestamp: Date.now() },
        ],
      }

      ;(proxyFetchStream as any).mockImplementation(async (opts: any) => {
        const body = JSON.parse(opts.body)
        expect(body.systemInstruction).toBeDefined()
        expect(body.systemInstruction.parts[0].text).toBe('你是一个助手')
      })

      await adapter.chat(optsWithSystem, vi.fn())
    })

    it('应解析 candidates[0].content.parts 响应', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any, onChunk: Function) => {
        onChunk('data: {"candidates":[{"content":{"parts":[{"text":"你好"}]}}]}\n')
        onChunk('data: {"candidates":[{"content":{"parts":[{"text":"世界"}]},"finishReason":"STOP"}]}\n')
      })

      const chunks: StreamChunk[] = []
      await adapter.chat(baseOpts, (chunk) => chunks.push(chunk))

      expect(chunks.some(c => c.delta === '你好')).toBe(true)
      expect(chunks.some(c => c.delta === '世界')).toBe(true)
      expect(chunks.some(c => c.done === true)).toBe(true)
    })

    it('应处理 thinking model（part.thought）', async () => {
      ;(proxyFetchStream as any).mockImplementation(async (opts: any, onChunk: Function) => {
        onChunk('data: {"candidates":[{"content":{"parts":[{"text":"思考中","thought":true}]}}]}\n')
        onChunk('data: {"candidates":[{"content":{"parts":[{"text":"回答"}]}}]}\n')
      })

      const chunks: StreamChunk[] = []
      await adapter.chat(baseOpts, (chunk) => chunks.push(chunk))

      expect(chunks.some(c => c.reasoningDelta === '思考中')).toBe(true)
      expect(chunks.some(c => c.delta === '回答')).toBe(true)
    })

    it('应处理 AbortSignal', async () => {
      const controller = new AbortController()
      ;(proxyFetchStream as any).mockImplementation(async () => {
        controller.abort()
        throw new DOMException('The operation was aborted.', 'AbortError')
      })

      await expect(adapter.chat({ ...baseOpts, signal: controller.signal }, vi.fn()))
        .rejects.toThrow('The operation was aborted.')
    })
  })
})
