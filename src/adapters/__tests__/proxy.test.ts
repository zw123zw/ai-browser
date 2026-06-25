import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { proxyFetch, proxyFetchStream } from '../proxy'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

describe('proxyFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应通过 chrome.runtime.sendMessage 发送请求', async () => {
    const mockResponse = { success: true, data: { result: 'ok' }, status: 200 }
    ;(chrome.runtime.sendMessage as any).mockResolvedValue(mockResponse)

    const result = await proxyFetch({ url: 'https://api.example.com', method: 'POST', body: '{}' })

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'proxy-fetch',
      url: 'https://api.example.com',
      method: 'POST',
      headers: undefined,
      body: '{}',
    })
    expect(result).toEqual(mockResponse)
  })

  it('代理失败时应抛出错误', async () => {
    ;(chrome.runtime.sendMessage as any).mockResolvedValue({ success: false, error: '网络错误' })

    await expect(proxyFetch({ url: 'https://api.example.com' }))
      .rejects.toThrow('网络错误')
  })

  it('sendMessage 返回空响应时应抛出默认错误', async () => {
    ;(chrome.runtime.sendMessage as any).mockResolvedValue(null)

    await expect(proxyFetch({ url: 'https://api.example.com' }))
      .rejects.toThrow('代理请求失败')
  })
})

describe('proxyFetchStream', () => {
  let originalAddListener: any
  let originalRemoveListener: any
  let messageListeners: Function[]

  beforeEach(() => {
    vi.clearAllMocks()
    messageListeners = []
    originalAddListener = chrome.runtime.onMessage.addListener
    originalRemoveListener = chrome.runtime.onMessage.removeListener
    chrome.runtime.onMessage.addListener = vi.fn((fn: Function) => messageListeners.push(fn))
    chrome.runtime.onMessage.removeListener = vi.fn((fn: Function) => {
      messageListeners = messageListeners.filter(l => l !== fn)
    })
  })

  afterEach(() => {
    chrome.runtime.onMessage.addListener = originalAddListener
    chrome.runtime.onMessage.removeListener = originalRemoveListener
  })

  it('应注册消息监听器并等待流结束', async () => {
    ;(chrome.runtime.sendMessage as any).mockResolvedValue({ success: true, requestId: 'req1' })

    const chunks: string[] = []
    const promise = proxyFetchStream(
      { url: 'https://api.example.com', method: 'POST', body: '{}' },
      (chunk) => chunks.push(chunk),
    )

    // 模拟收到 chunk
    await new Promise(r => setTimeout(r, 10))
    messageListeners.forEach(fn => fn({ type: 'stream-chunk', requestId: 'req1', chunk: 'data1' }))
    messageListeners.forEach(fn => fn({ type: 'stream-chunk', requestId: 'req1', chunk: 'data2' }))
    messageListeners.forEach(fn => fn({ type: 'stream-end', requestId: 'req1' }))

    await promise
    expect(chunks).toEqual(['data1', 'data2'])
  })

  it('流错误时应 reject', async () => {
    ;(chrome.runtime.sendMessage as any).mockResolvedValue({ success: true, requestId: 'req2' })

    const promise = proxyFetchStream(
      { url: 'https://api.example.com' },
      vi.fn(),
    )

    await new Promise(r => setTimeout(r, 10))
    messageListeners.forEach(fn => fn({ type: 'stream-error', requestId: 'req2', error: '连接中断' }))

    await expect(promise).rejects.toThrow('连接中断')
  })

  it('AbortSignal 中止时应 reject AbortError', async () => {
    ;(chrome.runtime.sendMessage as any).mockResolvedValue({ success: true, requestId: 'req3' })

    const controller = new AbortController()
    const promise = proxyFetchStream(
      { url: 'https://api.example.com', signal: controller.signal },
      vi.fn(),
    )

    await new Promise(r => setTimeout(r, 10))
    controller.abort()

    await expect(promise).rejects.toThrow('The operation was aborted.')
  })

  it('sendMessage 失败时应 reject', async () => {
    ;(chrome.runtime.sendMessage as any).mockResolvedValue({ success: false, error: '请求失败' })

    await expect(proxyFetchStream({ url: 'https://api.example.com' }, vi.fn()))
      .rejects.toThrow('请求失败')
  })
})
