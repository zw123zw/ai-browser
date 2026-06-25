import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VoiceBroadcast } from '../broadcast'

vi.mock('@/src/utils/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn(); debug = vi.fn(); warn = vi.fn(); error = vi.fn()
    constructor(name: string) {}
  },
}))

describe('VoiceBroadcast', () => {
  let broadcast: VoiceBroadcast

  beforeEach(() => {
    vi.clearAllMocks()
    broadcast = new VoiceBroadcast()
  })

  it('应检查浏览器支持', () => {
    expect(VoiceBroadcast.isSupported()).toBe(true)
  })

  it('构造函数应设置默认选项', () => {
    expect(broadcast.speaking).toBe(false)
  })

  it('speak() 应返回 Promise', () => {
    const result = broadcast.speak('你好')
    expect(result).toBeInstanceOf(Promise)
  })

  it('speak() 应调用 speechSynthesis.speak', () => {
    // 直接调用 speak，不等待 Promise（SpeechSynthesisUtterance mock 不会触发 onend）
    const promise = broadcast.speak('你好')
    expect(window.speechSynthesis.speak).toHaveBeenCalled()
    expect(promise).toBeInstanceOf(Promise)
  })

  it('cancel() 应取消播报', () => {
    // 先模拟正在播报
    ;(broadcast as any).isSpeaking = true
    broadcast.cancel()

    expect(broadcast.speaking).toBe(false)
  })

  it('destroy() 应取消并清理回调', () => {
    broadcast.onEnd = vi.fn()
    broadcast.onStart = vi.fn()

    broadcast.destroy()

    expect(broadcast.onEnd).toBeNull()
    expect(broadcast.onStart).toBeNull()
  })

  it('自定义选项应生效', () => {
    const custom = new VoiceBroadcast({ lang: 'en-US', rate: 1.5, volume: 0.8 })
    expect(custom.speaking).toBe(false)
  })

  it('onStart 回调应被设置', () => {
    const onStart = vi.fn()
    broadcast.onStart = onStart
    expect(broadcast.onStart).toBe(onStart)
  })

  it('onEnd 回调应被设置', () => {
    const onEnd = vi.fn()
    broadcast.onEnd = onEnd
    expect(broadcast.onEnd).toBe(onEnd)
  })
})
