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
import { voiceSettingsStorage, DEFAULT_VOICE_SETTINGS } from '@/src/storage'
import type { VoiceSettings } from '@/src/storage'

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

const DEFAULT_SETTINGS = DEFAULT_VOICE_SETTINGS

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
        log.info('initSettings 从 storage 加载', {
          engineType: settings.value.engineType,
          ttsRate: settings.value.ttsRate,
        })
      } else {
        settings.value = { ...DEFAULT_SETTINGS }
        sync.markSelfWrite()
        await voiceSettingsStorage.setValue(plain(settings.value) as VoiceSettings)
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
    sync.flush()
  }

  /** 批量更新设置 */
  async function updateSettings(partial: Partial<VoiceSettings>) {
    Object.assign(settings.value, partial)
    settingsVersion.value++
    await sync.flush()
    // 验证写入结果
    const verify = await voiceSettingsStorage.getValue()
    log.info('语音设置已更新并验证', {
      version: settingsVersion.value,
      engineType: settings.value.engineType,
      storedEngineType: verify?.engineType,
    })
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
