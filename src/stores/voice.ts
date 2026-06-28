/**
 * 语音状态管理
 *
 * 管理语音识别状态、设置项。
 * 对话历史统一使用 conversationsStore。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Logger } from '@/src/utils/logger'
import { defineStorageSync, plain } from '@/src/utils/storage-sync'
import voiceConfig from '@/src/voice-config.json'

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
  iflytekAppId: string
  iflytekApiKey: string
  iflytekApiSecret: string
  recognitionLang: string

  // 🔔 唤醒词
  wakeWord: string
  alwaysOnVoice: boolean

  // 🔊 TTS
  enableTts: boolean
  ttsRate: number
  ttsVolume: number

  // ⚡ 行为
  bufferTimeout: number   // 语音缓冲时间（ms）
  idleTimeout: number     // 语音自动退出时间（ms）
}

const DEFAULT_SETTINGS: VoiceSettings = {
  engineType: (voiceConfig.engineType as EngineType) || 'web-speech',
  iflytekAppId: voiceConfig.iflytekAppId || '',
  iflytekApiKey: voiceConfig.iflytekApiKey || '',
  iflytekApiSecret: voiceConfig.iflytekApiSecret || '',
  recognitionLang: 'zh-CN',
  wakeWord: '你好，小灵',
  alwaysOnVoice: false,
  enableTts: true,
  ttsRate: 1.8,
  ttsVolume: 0.8,
  bufferTimeout: 1500,
  idleTimeout: 3000,
}

/** wxt storage item 封装 */
const voiceSettingsStorage = {
  async getValue(): Promise<VoiceSettings | null> {
    const stored = await chrome.storage.local.get('voice-settings')
    return stored['voice-settings'] || null
  },
  async setValue(v: VoiceSettings | null): Promise<void> {
    if (v) {
      await chrome.storage.local.set({ 'voice-settings': v })
    } else {
      await chrome.storage.local.remove('voice-settings')
    }
  },
  watch(cb: (nv: VoiceSettings | null) => void): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes['voice-settings']) {
        cb(changes['voice-settings'].newValue ?? null)
      }
    })
  },
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
  /** 保存时 +1，App.vue 监听此值变化来重建 manager */
  const settingsVersion = ref(0)

  // 双向同步：settings ↔ chrome.storage
  const sync = defineStorageSync<VoiceSettings>({
    source: settings,
    storage: voiceSettingsStorage,
    ready,
    applyRemote: (nv) => {
      settings.value = { ...DEFAULT_SETTINGS, ...nv }
      log.info('语音设置从 storage 同步', { engineType: settings.value.engineType })
    },
  })

  /** 初始化设置 */
  async function initSettings() {
    try {
      const stored = await voiceSettingsStorage.getValue()
      if (stored) {
        settings.value = { ...DEFAULT_SETTINGS, ...stored }
        sync.markSelfWrite()
        log.info('initSettings 从 storage 加载', {
          engineType: settings.value.engineType,
          ttsRate: settings.value.ttsRate,
        })
      } else {
        settings.value = { ...DEFAULT_SETTINGS }
        sync.markSelfWrite()
        await voiceSettingsStorage.setValue(plain(settings.value))
        log.info('initSettings 无存储，写入默认值')
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
  }

  /** 批量更新设置 */
  function updateSettings(partial: Partial<VoiceSettings>) {
    Object.assign(settings.value, partial)
    settingsVersion.value++
    log.info('语音设置已更新', { version: settingsVersion.value, engineType: settings.value.engineType })
  }

  /** 重置为默认设置 */
  function resetSettings() {
    Object.assign(settings.value, DEFAULT_SETTINGS)
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
    settingsVersion,
    ready,
    initSettings,
    updateSetting,
    updateSettings,
    resetSettings,
  }
})
