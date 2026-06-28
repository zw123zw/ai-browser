/**
 * 语音状态管理
 *
 * 管理语音识别状态、设置项。
 * 对话历史统一使用 conversationsStore。
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { Logger } from '@/src/utils/logger'

const log = new Logger('Store:Voice')

/** 语音识别状态 */
export type VoiceStatus = 'idle' | 'listening' | 'processing' | 'error'

/** 语音会话状态 */
export type SessionState =
  | 'idle'        // 空闲
  | 'wake'        // 监听唤醒词
  | 'command'     // 监听命令
  | 'processing'  // AI 处理中
  | 'speaking'    // TTS 播报中

/** 识别引擎类型 */
export type EngineType = 'web-speech' | 'iflytek'

/** 语音设置 */
export interface VoiceSettings {
  // 🎤 语音识别
  engineType: EngineType
  iflytekApiKey: string
  iflytekAppId: string
  recognitionLang: string

  // 🔔 唤醒词
  wakeWord: string

  // 🔊 TTS
  enableTts: boolean
  ttsRate: number
  ttsVolume: number

  // ⚡ 行为
  bufferTimeout: number   // 语音缓冲时间（ms）
  idleTimeout: number     // 语音自动退出时间（ms）
}

const DEFAULT_SETTINGS: VoiceSettings = {
  engineType: 'web-speech',
  iflytekApiKey: '',
  iflytekAppId: '',
  recognitionLang: 'zh-CN',
  wakeWord: '你好，小灵',
  enableTts: true,
  ttsRate: 2.0,
  ttsVolume: 0.8,
  bufferTimeout: 1500,
  idleTimeout: 3000,
}

export const useVoiceStore = defineStore('voice', () => {
  // ========== 状态 ==========
  const status = ref<VoiceStatus>('idle')
  const sessionState = ref<SessionState>('idle')
  const interimText = ref('')
  const finalText = ref('')

  // ========== 设置（持久化） ==========
  const settings = ref<VoiceSettings>({ ...DEFAULT_SETTINGS })
  const ready = ref(false)

  /** 初始化设置 */
  async function initSettings() {
    try {
      const stored = await chrome.storage.local.get('voice-settings')
      if (stored['voice-settings']) {
        settings.value = { ...DEFAULT_SETTINGS, ...stored['voice-settings'] }
      }
      ready.value = true
    } catch (error) {
      log.error('加载语音设置失败:', error)
      ready.value = true
    }
  }

  /** 更新单个设置项 */
  function updateSetting<K extends keyof VoiceSettings>(key: K, value: VoiceSettings[K]) {
    settings.value[key] = value
    // 自动保存（defineStorageSync 会处理防抖写入）
  }

  /** 批量更新设置 */
  function updateSettings(partial: Partial<VoiceSettings>) {
    Object.assign(settings.value, partial)
  }

  /** 重置为默认设置 */
  function resetSettings() {
    Object.assign(settings.value, DEFAULT_SETTINGS)
  }

  // 设置变更时自动保存到 storage
  watch(settings, (val) => {
    chrome.storage.local.set({ 'voice-settings': val })
  }, { deep: true })

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

  return {
    // 状态
    status,
    sessionState,
    interimText,
    finalText,
    setStatus,
    setSessionState,
    updateText,
    reset,

    // 设置
    settings,
    ready,
    initSettings,
    updateSetting,
    updateSettings,
    resetSettings,
  }
})
