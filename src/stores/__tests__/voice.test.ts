import { describe, it, expect, vi, beforeEach } from 'vitest'
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
    expect(store.isProcessing).toBe(false)
    expect(store.isSpeaking).toBe(false)
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

  describe('消息管理', () => {
    it('addUserMessage 应添加用户消息', () => {
      const store = useVoiceStore()
      const msg = store.addUserMessage('你好')
      expect(msg.role).toBe('user')
      expect(msg.content).toBe('你好')
      expect(store.messages).toHaveLength(1)
    })

    it('addAssistantMessage 应添加助手消息', () => {
      const store = useVoiceStore()
      const msg = store.addAssistantMessage('你好')
      expect(msg.role).toBe('assistant')
      expect(msg.content).toBe('你好')
    })

    it('addSystemMessage 应添加系统消息', () => {
      const store = useVoiceStore()
      const msg = store.addSystemMessage('系统提示')
      expect(msg.role).toBe('system')
    })

    it('clearMessages 应清空消息', () => {
      const store = useVoiceStore()
      store.addUserMessage('msg1')
      store.addUserMessage('msg2')
      store.clearMessages()

      expect(store.messages).toHaveLength(0)
    })
  })

  describe('状态管理', () => {
    it('setProcessing 应设置处理状态', () => {
      const store = useVoiceStore()
      store.setProcessing(true)
      expect(store.isProcessing).toBe(true)

      store.setProcessing(false)
      expect(store.isProcessing).toBe(false)
    })

    it('setSpeaking 应设置播报状态', () => {
      const store = useVoiceStore()
      store.setSpeaking(true)
      expect(store.isSpeaking).toBe(true)

      store.setSpeaking(false)
      expect(store.isSpeaking).toBe(false)
    })
  })

  describe('messageCount', () => {
    it('应返回消息数量', () => {
      const store = useVoiceStore()
      expect(store.messageCount).toBe(0)

      store.addUserMessage('msg1')
      expect(store.messageCount).toBe(1)

      store.addAssistantMessage('msg2')
      expect(store.messageCount).toBe(2)
    })
  })
})
