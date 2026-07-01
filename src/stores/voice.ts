/**
 * 语音状态管理
 *
 * 仅管理运行时状态（识别状态、会话状态、中间文本）。
 * 语音配置统一由 settingsStore 管理。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useSettingsStore } from './settings'

/** 语音识别状态 */
export type VoiceStatus = 'idle' | 'listening' | 'processing' | 'error'

/** 语音会话状态 */
export type SessionState =
  | 'idle'        // 空闲
  | 'wake'        // 监听唤醒词
  | 'command'     // 监听命令
  | 'processing'  // AI 处理中
  | 'speaking'    // TTS 播报中

export const useVoiceStore = defineStore('aib-voice', () => {
  // ========== 运行时状态 ==========
  const status = ref<VoiceStatus>('idle')
  const sessionState = ref<SessionState>('idle')
  const interimText = ref('')
  const finalText = ref('')
  /** 保存时 +1，App.vue 监听此值变化来重建 manager */
  const settingsVersion = ref(0)

  // ========== 便捷 getter：从 settingsStore 读语音配置 ==========
  function getVoiceSettings() {
    const s = useSettingsStore().settings
    return {
      engineType: s.voiceEngineType || 'web-speech',
      appId: s.voiceAppId || '',
      apiKey: s.voiceApiKey || '',
      apiSecret: s.voiceApiSecret || '',
      engineConfs: s.voiceEngineConfs || [],
      recognitionLang: s.voiceRecognitionLang || 'zh-CN',
      wakeWord: s.voiceWakeWord || '你好，小灵',
      alwaysOnVoice: s.voiceAlwaysOn ?? false,
      enableTts: s.voiceEnableTts ?? true,
      ttsRate: s.voiceTtsRate ?? 1.8,
      ttsVolume: s.voiceTtsVolume ?? 0.8,
      bufferTimeout: s.voiceBufferTimeout ?? 2000,
      idleTimeout: s.voiceIdleTimeout ?? 4000,
    }
  }

  // ========== 状态更新 ==========
  function setStatus(newStatus: VoiceStatus) {
    status.value = newStatus
  }

  function setSessionState(state: SessionState) {
    sessionState.value = state
  }

  function updateText(text: string, isFinal: boolean) {
    if (isFinal) {
      finalText.value = text
      interimText.value = ''
    } else {
      interimText.value = text
    }
  }

  function reset() {
    status.value = 'idle'
    sessionState.value = 'idle'
    interimText.value = ''
    finalText.value = ''
  }

  /** 触发 VoiceManager 重建 */
  function bumpSettingsVersion() {
    settingsVersion.value++
  }

  return {
    // 运行时状态
    status,
    sessionState,
    interimText,
    finalText,
    settingsVersion,
    setStatus,
    setSessionState,
    updateText,
    reset,
    getVoiceSettings,
    bumpSettingsVersion,
  }
})
