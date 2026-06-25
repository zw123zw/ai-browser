import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VoiceRecognition } from '../recognition'

describe('VoiceRecognition', () => {
  let recognition: VoiceRecognition

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    recognition?.destroy()
  })

  it('应检查浏览器支持', () => {
    expect(VoiceRecognition.isSupported()).toBe(true)
  })

  it('构造函数应设置默认选项', () => {
    recognition = new VoiceRecognition({
      onResult: vi.fn(),
    })

    expect(recognition.isActive).toBe(false)
    expect(recognition.currentStatus).toBe('idle')
  })

  it('start() 应启动识别', () => {
    const onResult = vi.fn()
    recognition = new VoiceRecognition({ onResult })

    recognition.start()

    expect(recognition.isActive).toBe(true)
    expect(recognition.currentStatus).toBe('listening')
  })

  it('stop() 应停止识别', () => {
    const onResult = vi.fn()
    recognition = new VoiceRecognition({ onResult })

    recognition.start()
    recognition.stop()

    expect(recognition.isActive).toBe(false)
    expect(recognition.currentStatus).toBe('idle')
  })

  it('toggle() 应切换启停', () => {
    const onResult = vi.fn()
    recognition = new VoiceRecognition({ onResult })

    recognition.toggle()
    expect(recognition.isActive).toBe(true)

    recognition.toggle()
    expect(recognition.isActive).toBe(false)
  })

  it('连续模式应自动重启', () => {
    const onResult = vi.fn()
    recognition = new VoiceRecognition({ onResult, continuous: true })

    recognition.start()
    expect(recognition.isActive).toBe(true)
  })

  it('destroy() 应销毁实例', () => {
    const onResult = vi.fn()
    recognition = new VoiceRecognition({ onResult })

    recognition.start()
    recognition.destroy()

    expect(recognition.isActive).toBe(false)
  })

  it('start() 重复调用应忽略', () => {
    const onResult = vi.fn()
    recognition = new VoiceRecognition({ onResult })

    recognition.start()
    recognition.start() // 第二次调用

    expect(recognition.isActive).toBe(true)
  })

  it('stop() 未启动时应安全调用', () => {
    const onResult = vi.fn()
    recognition = new VoiceRecognition({ onResult })

    expect(() => recognition.stop()).not.toThrow()
  })

  it('onStatusChange 回调应被调用', () => {
    const onResult = vi.fn()
    const onStatusChange = vi.fn()
    recognition = new VoiceRecognition({ onResult, onStatusChange })

    recognition.start()

    expect(onStatusChange).toHaveBeenCalledWith('listening')
  })
})
