import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useVoiceStore } from '../voice'

describe('useVoiceStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('初始状态应为 idle', () => {
    const store = useVoiceStore()
    expect(store.status).toBe('idle')
    expect(store.sessionState).toBe('idle')
    expect(store.interimText).toBe('')
    expect(store.finalText).toBe('')
  })

  describe('setStatus', () => {
    it('应设置语音状态', () => {
      const store = useVoiceStore()
      store.setStatus('listening')
      expect(store.status).toBe('listening')
    })

    it('应设置 error 状态', () => {
      const store = useVoiceStore()
      store.setStatus('error')
      expect(store.status).toBe('error')
    })
  })

  describe('setSessionState', () => {
    it('应设置会话状态', () => {
      const store = useVoiceStore()
      store.setSessionState('processing')
      expect(store.sessionState).toBe('processing')
    })

    it('应设置 speaking 状态', () => {
      const store = useVoiceStore()
      store.setSessionState('speaking')
      expect(store.sessionState).toBe('speaking')
    })
  })

  describe('updateText', () => {
    it('应更新 interim 文本', () => {
      const store = useVoiceStore()
      store.updateText('你好', false)
      expect(store.interimText).toBe('你好')
      expect(store.finalText).toBe('')
    })

    it('应更新 final 文本', () => {
      const store = useVoiceStore()
      store.updateText('你好世界', true)
      expect(store.finalText).toBe('你好世界')
      expect(store.interimText).toBe('')
    })
  })

  describe('reset', () => {
    it('应重置所有状态', () => {
      const store = useVoiceStore()
      store.setStatus('listening')
      store.setSessionState('processing')
      store.updateText('测试文本', false)

      store.reset()

      expect(store.status).toBe('idle')
      expect(store.sessionState).toBe('idle')
      expect(store.interimText).toBe('')
      expect(store.finalText).toBe('')
    })
  })
})
