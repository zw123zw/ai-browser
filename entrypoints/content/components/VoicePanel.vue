<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useI18n } from '@/src/i18n'
import { useVoiceStore } from '@/src/stores/voice'
import { useConversationsStore } from '@/src/stores/conversations'
import { useSettingsStore } from '@/src/stores/settings'
import { usePipeline } from '@/src/composables/usePipeline'
import { VoiceManager } from '@/src/voice/voice-manager'
import { Logger } from '@/src/utils/logger'
import type { SessionState } from '@/src/stores/voice'
import type { VoiceManagerState } from '@/src/voice/voice-manager'

const { t } = useI18n()
const emit = defineEmits<{ (e: 'switch-chat'): void }>()
const log = new Logger('VoicePanel')
const voiceStore = useVoiceStore()
const convStore = useConversationsStore()
const settingsStore = useSettingsStore()
const pipeline = usePipeline()

const messagesRef = ref<HTMLElement | null>(null)
let manager: VoiceManager | null = null

/** 自动滚动到底部 */
function scrollToBottom() {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
}

/** 初始化语音管理器 */
function initManager() {
  const s = voiceStore.settings

  manager = new VoiceManager({
    engineType: s.engineType,
    iflytekConfig: s.engineType === 'iflytek' ? {
      appId: s.iflytekAppId,
      apiKey: s.iflytekApiKey,
    } : undefined,
    lang: s.recognitionLang,
    wakeWord: s.wakeWord,
    enableWakeWord: s.enableWakeWord,
    enableTts: s.enableTts,
    ttsRate: s.ttsRate,
    ttsVolume: s.ttsVolume,
    autoStart: false, // VoicePanel 自己控制启动
    onStateChange: (state: VoiceManagerState) => {
      const stateMap: Record<VoiceManagerState, SessionState> = {
        idle: 'idle',
        wake: 'wake',
        command: 'command',
        processing: 'processing',
        speaking: 'speaking',
      }
      voiceStore.setSessionState(stateMap[state])
    },
    onInterimText: (text) => {
      voiceStore.updateText(text, false)
    },
    onUserMessage: (text) => {
      voiceStore.updateText(text, true)
    },
    onError: (error) => {
      log.error('语音错误', error)
    },
  })

  // 接入统一管线
  manager.onProcessText = async (text: string) => {
    try {
      await pipeline.processInput(text)
    } catch (error) {
      log.error('管线处理失败', error)
    }
  }
}

/** 启动监听 */
function startListening() {
  if (!convStore.conversation) {
    log.warn('无活跃会话')
    return
  }
  manager?.start()
}

/** 停止监听 */
function stopListening() {
  manager?.stop()
}

/** 清理 markdown 格式，提取纯文本用于 TTS */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_~>|]/g, '')
    .replace(/\n{2,}/g, '。')
    .trim()
}

// TTS：watch 新 assistant 消息
watch(
  () => convStore.conversation?.messages.length,
  (newLen, oldLen) => {
    if (!manager?.isActive || !newLen || newLen <= (oldLen || 0)) return
    const lastMsg = convStore.conversation!.messages[newLen - 1]
    if (lastMsg.role === 'assistant' && lastMsg.status === 'done') {
      const speakText = stripMarkdown(lastMsg.content)
      if (speakText) {
        manager.speak(speakText)
      }
    }
  },
)

// 设置变更 → 实时更新管理器
watch(
  () => [voiceStore.settings.wakeWord, voiceStore.settings.enableWakeWord, voiceStore.settings.enableTts, voiceStore.settings.ttsRate, voiceStore.settings.ttsVolume],
  () => {
    if (manager) {
      manager.updateConfig({
        wakeWord: voiceStore.settings.wakeWord,
        enableWakeWord: voiceStore.settings.enableWakeWord,
        enableTts: voiceStore.settings.enableTts,
        ttsRate: voiceStore.settings.ttsRate,
        ttsVolume: voiceStore.settings.ttsVolume,
      })
    }
  },
  { deep: true },
)

// 自动滚动
watch(
  () => convStore.conversation?.messages.length,
  () => scrollToBottom(),
)

// 消息列表
const messages = () => convStore.conversation?.messages ?? []

// 获取状态文字
function getStatusText(state: SessionState): string {
  switch (state) {
    case 'wake':
      return '等待唤醒词...'
    case 'command':
      return '请说出命令'
    case 'processing':
      return t('voice.processing')
    case 'speaking':
      return '播报中...'
    default:
      return t('voice.listening')
  }
}

// 打开面板 → 初始化并启动
onMounted(async () => {
  log.info('VoicePanel 已挂载')
  await voiceStore.initSettings()
  initManager()
  startListening()
})

// 关闭面板 → 停止
onUnmounted(() => {
  log.info('VoicePanel 已卸载')
  stopListening()
  manager?.destroy()
  manager = null
})
</script>

<template>
  <div class="aib-voice-panel">
    <!-- 状态指示器 -->
    <div class="aib-voice-status">
      <div :class="['aib-status-dot', voiceStore.sessionState]" />
      <span class="aib-status-text">{{ getStatusText(voiceStore.sessionState) }}</span>
      <span v-if="voiceStore.interimText" class="aib-interim-text">
        {{ voiceStore.interimText }}
      </span>
    </div>

    <!-- 消息记录区 -->
    <div ref="messagesRef" class="aib-voice-messages">
      <!-- 空状态 -->
      <div v-if="messages().length === 0" class="aib-voice-empty">
        <div class="aib-empty-icon">🎤</div>
        <p>{{ t('voice.title') }}</p>
        <p class="aib-empty-hint">
          {{ voiceStore.settings.enableWakeWord
            ? `说「${voiceStore.settings.wakeWord}」唤醒我`
            : '直接说出命令' }}
        </p>
      </div>

      <!-- 消息列表 -->
      <div
        v-for="msg in messages()"
        :key="msg.id"
        :class="['aib-voice-msg', `aib-${msg.role}`]"
      >
        <div class="aib-msg-role">
          {{ msg.role === 'user' ? '🗣️ 你' : msg.role === 'assistant' ? '🤖 AI' : 'ℹ️ 系统' }}
        </div>
        <div class="aib-msg-content">{{ msg.content }}</div>
      </div>

      <!-- 处理中指示器 -->
      <div v-if="pipeline.isProcessing.value" class="aib-voice-msg aib-assistant">
        <div class="aib-msg-role">🤖 AI</div>
        <div class="aib-msg-content aib-typing">
          <span class="aib-dot" />
          <span class="aib-dot" />
          <span class="aib-dot" />
        </div>
      </div>
    </div>

    <!-- 底部状态指示 -->
    <div class="aib-voice-controls">
      <div class="aib-mic-wrapper">
        <div v-if="voiceStore.sessionState === 'wake' || voiceStore.sessionState === 'command'" class="aib-ripple-container">
          <div class="aib-ripple aib-ripple-1" />
          <div class="aib-ripple aib-ripple-2" />
          <div class="aib-ripple aib-ripple-3" />
        </div>
        <div :class="['aib-mic-indicator', { active: voiceStore.sessionState !== 'idle' }]">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aib-voice-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--aib-bg);
}

/* ========== 状态栏 ========== */
.aib-voice-status {
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--aib-border);
  min-height: 44px;
  background: var(--aib-bg-soft);
}

.aib-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--aib-text-faint);
  flex-shrink: 0;
}

.aib-status-dot.wake {
  background: #34d399;
  box-shadow: 0 0 8px rgba(52,211,153,0.5);
  animation: pulse 2s infinite;
}

.aib-status-dot.command {
  background: #34d399;
  box-shadow: 0 0 8px rgba(52,211,153,0.5);
  animation: pulse 1.5s infinite;
}

.aib-status-dot.processing {
  background: var(--aib-primary);
  box-shadow: 0 0 8px var(--aib-primary-glow);
  animation: pulse 1s infinite;
}

.aib-status-dot.speaking {
  background: #8b5cf6;
  box-shadow: 0 0 8px rgba(139,92,246,0.5);
  animation: pulse 1.2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.aib-status-text {
  font-size: 12px;
  color: var(--aib-text-soft);
}

.aib-interim-text {
  font-size: 12px;
  color: var(--aib-text-faint);
  margin-left: auto;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ========== 消息区 ========== */
.aib-voice-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.aib-voice-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--aib-text-faint);
  text-align: center;
}

.aib-empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.aib-empty-hint {
  font-size: 12px;
  margin-top: 8px;
  color: var(--aib-text-faint);
}

.aib-voice-msg {
  max-width: 88%;
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.aib-msg-role {
  font-size: 11px;
  color: var(--aib-text-faint);
  margin-bottom: 4px;
}

.aib-user {
  align-self: flex-end;
  background: var(--aib-primary-soft);
  color: var(--aib-text);
  border: 1px solid var(--aib-border-strong);
  border-bottom-right-radius: 6px;
}

.aib-user .aib-msg-role {
  color: var(--aib-primary);
  text-align: right;
}

.aib-assistant {
  align-self: flex-start;
  background: var(--aib-bg-card);
  color: var(--aib-text);
  border: 1px solid var(--aib-border);
  border-bottom-left-radius: 6px;
}

.aib-system {
  align-self: center;
  background: transparent;
  color: var(--aib-text-faint);
  font-size: 12px;
  padding: 4px 8px;
}

.aib-typing {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
}

.aib-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--aib-text-faint);
  animation: typing 1.4s infinite;
}

.aib-dot:nth-child(2) { animation-delay: 0.2s; }
.aib-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-4px); }
}

/* ========== 底部指示器 ========== */
.aib-voice-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 20px;
  border-top: 1px solid var(--aib-border);
}

.aib-mic-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88px;
  height: 88px;
}

.aib-mic-indicator {
  position: relative;
  z-index: 2;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 2px solid var(--aib-border);
  background: var(--aib-bg-card);
  color: var(--aib-text-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.aib-mic-indicator.active {
  background: var(--aib-primary);
  border-color: var(--aib-primary);
  color: #000;
  box-shadow: 0 0 24px var(--aib-primary-glow);
}

/* ========== 波纹动画 ========== */
.aib-ripple-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 64px;
  height: 64px;
  z-index: 1;
}

.aib-ripple {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--aib-primary);
  opacity: 0;
  animation: voice-ripple 2s infinite;
}

.aib-ripple-1 { animation-delay: 0s; }
.aib-ripple-2 { animation-delay: 0.6s; }
.aib-ripple-3 { animation-delay: 1.2s; }

@keyframes voice-ripple {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(2.5); opacity: 0; }
}

/* ========== 响应式 ========== */
@media (max-width: 640px) {
  .aib-voice-status { padding: 8px 14px; min-height: 38px; }
  .aib-voice-messages { padding: 14px; gap: 12px; }
  .aib-empty-icon { font-size: 36px; margin-bottom: 10px; }
  .aib-voice-msg { max-width: 94%; padding: 10px 12px; font-size: 13px; border-radius: 12px; }
  .aib-voice-controls { padding: 16px 14px; }
  .aib-mic-wrapper { width: 72px; height: 72px; }
  .aib-mic-indicator { width: 58px; height: 58px; }
  .aib-mic-indicator svg { width: 22px; height: 22px; }
}

@media (max-height: 680px) {
  .aib-voice-status { padding: 6px 14px; min-height: 34px; }
  .aib-voice-messages { padding: 10px 14px; gap: 10px; }
  .aib-empty-icon { font-size: 32px; margin-bottom: 8px; }
  .aib-empty-hint { margin-top: 4px; }
  .aib-voice-msg { padding: 8px 12px; font-size: 13px; }
  .aib-voice-controls { padding: 12px 14px; }
  .aib-mic-wrapper { width: 64px; height: 64px; }
  .aib-mic-indicator { width: 52px; height: 52px; }
  .aib-mic-indicator svg { width: 20px; height: 20px; }
  .aib-ripple-container { width: 52px; height: 52px; }
}
</style>
