import { describe, it, expect, vi, beforeEach } from 'vitest'
import { clearCache, checkAndAutoClear } from '../cache'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

describe('clearCache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('应清除会话、日志、输入历史', async () => {
    ;(chrome.storage.local.remove as any).mockResolvedValue(undefined)

    await clearCache()

    expect(chrome.storage.local.remove).toHaveBeenCalledWith([
      'ai-browser-conversation',
      'logs:frontend',
      'logs:api',
      'ai-browser-input-history',
    ])
  })
})

describe('checkAndAutoClear', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('缓存未超限时不应清除', async () => {
    ;(chrome.storage.local.getBytesInUse as any).mockResolvedValue(10 * 1024 * 1024) // 10MB

    await checkAndAutoClear()

    expect(chrome.storage.local.remove).not.toHaveBeenCalled()
  })

  it('缓存超过 30MB 时应自动清除', async () => {
    ;(chrome.storage.local.getBytesInUse as any).mockResolvedValue(35 * 1024 * 1024) // 35MB
    ;(chrome.storage.local.remove as any).mockResolvedValue(undefined)

    await checkAndAutoClear()

    expect(chrome.storage.local.remove).toHaveBeenCalled()
  })

  it('getBytesInUse 失败时应静默忽略', async () => {
    ;(chrome.storage.local.getBytesInUse as any).mockRejectedValue(new Error('not available'))

    await expect(checkAndAutoClear()).resolves.toBeUndefined()
  })
})
