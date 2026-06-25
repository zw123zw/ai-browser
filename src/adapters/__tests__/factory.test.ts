import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createAdapter } from '../index'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

describe('createAdapter 工厂', () => {
  it('应创建 openai 适配器', () => {
    const adapter = createAdapter('openai')
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('openai')
  })

  it('应创建 gemini 适配器', () => {
    const adapter = createAdapter('gemini')
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('gemini')
  })

  it('应创建 qwen 适配器', () => {
    const adapter = createAdapter('qwen')
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('qwen')
  })

  it('应创建 wenxin 适配器', () => {
    const adapter = createAdapter('wenxin')
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('wenxin')
  })

  it('应创建 doubao 适配器', () => {
    const adapter = createAdapter('doubao')
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('doubao')
  })

  it('zhipu 应使用 OpenAI 协议', () => {
    const adapter = createAdapter('zhipu')
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('openai')
  })

  it('deepseek 应使用 OpenAI 协议', () => {
    const adapter = createAdapter('deepseek')
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('openai')
  })

  it('moonshot 应使用 OpenAI 协议', () => {
    const adapter = createAdapter('moonshot')
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('openai')
  })

  it('anthropic 应使用 OpenAI 协议', () => {
    const adapter = createAdapter('anthropic')
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('openai')
  })

  it('grok 应使用 OpenAI 协议', () => {
    const adapter = createAdapter('grok')
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('openai')
  })

  it('custom 应使用 OpenAI 协议', () => {
    const adapter = createAdapter('custom')
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('openai')
  })

  it('未知 provider 应降级到 OpenAI', () => {
    const adapter = createAdapter('unknown' as any)
    expect(adapter).toBeDefined()
    expect(adapter.name).toBe('openai')
  })
})
