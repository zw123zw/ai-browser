<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useVoiceStore } from '@/src/stores/voice'
import { useSettingsStore } from '@/src/stores/settings'
import { useToast } from '@/src/composables/useToast'
import { VoiceSession } from '@/src/voice/session'
import { Logger } from '@/src/utils/logger'
import type { SessionState } from '@/src/stores/voice'

const emit = defineEmits<{ (e: 'switch-chat'): void }>()
const log = new Logger('VoicePanel')
const voiceStore = useVoiceStore()
const settingsStore = useSettingsStore()
const toast = useToast()

const messagesRef = ref<HTMLElement | null>(null)
let session: VoiceSession | null = null

/** 自动滚动到底部 */
function scrollToBottom() {
  nextTick(() => {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight
    }
  })
}

/** 获取当前页面上下文（URL + 清洗后 HTML） */
async function getPageContext(): Promise<{ url: string; html: string }> {
  try {
    const url = window.location.href

    // 跳过特殊页面
    if (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('edge://')
    ) {
      log.warn('特殊页面，跳过 HTML 获取', { url })
      return { url, html: '' }
    }

    // 清洗当前页面 HTML
    const clone = document.documentElement.cloneNode(true) as HTMLElement
    clone
      .querySelectorAll('script, style, noscript, link[rel="stylesheet"], meta')
      .forEach((el) => el.remove())
    clone.querySelectorAll('[hidden]').forEach((el) => el.remove())
    clone.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'))

    log.debug('获取页面上下文', { url, htmlLength: clone.innerHTML.length })
    return { url, html: clone.innerHTML }
  } catch (error) {
    log.error('获取页面上下文失败', error)
    return { url: window.location.href, html: '' }
  }
}

/** 初始化语音会话 */
function initSession() {
  log.info('初始化语音会话')
  session = new VoiceSession({
    getSettings: () => settingsStore.settings,
    getRecentMessages: () => voiceStore.messages,
    onStateChange: (state: SessionState) => {
      voiceStore.setSessionState(state)
      voiceStore.setProcessing(state === 'processing')
      voiceStore.setSpeaking(state === 'speaking')
    },
    onTextUpdate: (text, isFinal) => {
      voiceStore.updateText(text, isFinal)
    },
    onUserMessage: (text) => {
      voiceStore.addUserMessage(text)
      scrollToBottom()
    },
    onAssistantMessage: (content, actionResult) => {
      voiceStore.addAssistantMessage(content, actionResult)
      scrollToBottom()
    },
    onSystemMessage: (content) => {
      voiceStore.addSystemMessage(content)
      scrollToBottom()
    },
    executeAutomation: async (action, params) => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab?.id) {
          return { success: false, message: '无法获取当前标签页' }
        }
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-scripts/content.js'],
        })
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'automation',
          action,
          params,
        })
        return {
          success: response?.success ?? true,
          message: response?.message || '操作已执行',
        }
      } catch (error) {
        log.error('自动化执行异常', error)
        return { success: false, message: String(error) }
      }
    },
    getPageContext,
  })
}

/** 切换语音识别 */
async function toggleRecognition() {
  if (!session) {
    initSession()
  }

  if (voiceStore.sessionState === 'idle') {
    await session?.start()
  } else {
    session?.stop()
  }
}

/** 清空对话 */
function clearVoiceChat() {
  voiceStore.clearMessages()
  log.info('清空语音对话')
}

/** 获取状态文字 */
function getStatusText(state: SessionState): string {
  switch (state) {
    case 'listening':
      return '正在聆听...'
    case 'processing':
      return '处理中...'
    case 'speaking':
      return '播报中...'
    default:
      return '点击麦克风开始'
  }
}

// 自动滚动
watch(() => voiceStore.messages.length, () => scrollToBottom())

onMounted(() => {
  log.info('VoicePanel 已挂载')
})

onUnmounted(() => {
  log.info('VoicePanel 已卸载')
  session?.destroy()
  session = null
})
</script>

<template>
  <div class="zwf-voice-panel">
    <!-- 状态指示器 -->
    <div class="zwf-voice-status">
      <div :class="['zwf-status-dot', voiceStore.sessionState]" />
      <span class="zwf-status-text">{{ getStatusText(voiceStore.sessionState) }}</span>
      <span v-if="voiceStore.interimText" class="zwf-interim-text">
        {{ voiceStore.interimText }}
      </span>
    </div>

    <!-- 消息记录区 -->
    <div ref="messagesRef" class="zwf-voice-messages">
      <!-- 空状态 -->
      <div v-if="voiceStore.messages.length === 0" class="zwf-voice-empty">
        <div class="zwf-empty-icon">🎤</div>
        <p>说出你的指令</p>
        <p class="zwf-empty-hint">
          例如：「打开B站」「搜索美食教程」「今天天气怎么样」
        </p>
      </div>

      <!-- 消息列表 -->
      <div
        v-for="msg in voiceStore.messages"
        :key="msg.id"
        :class="['zwf-voice-msg', `zwf-${msg.role}`]"
      >
        <div class="zwf-msg-role">
          {{ msg.role === 'user' ? '🗣️ 你' : msg.role === 'assistant' ? '🤖 AI' : 'ℹ️ 系统' }}
        </div>
        <div class="zwf-msg-content">{{ msg.content }}</div>
        <div v-if="msg.actionResult" class="zwf-action-result">
          <span :class="msg.actionResult.success ? 'zwf-success' : 'zwf-error'">
            {{ msg.actionResult.success ? '✅' : '❌' }} {{ msg.actionResult.message }}
          </span>
        </div>
      </div>

      <!-- 处理中指示器 -->
      <div v-if="voiceStore.isProcessing" class="zwf-voice-msg zwf-assistant">
        <div class="zwf-msg-role">🤖 AI</div>
        <div class="zwf-msg-content zwf-typing">
          <span class="zwf-dot" />
          <span class="zwf-dot" />
          <span class="zwf-dot" />
        </div>
      </div>
    </div>

    <!-- 底部麦克风控制 -->
    <div class="zwf-voice-controls">
      <div class="zwf-mic-wrapper">
        <!-- 波纹动画层 -->
        <div v-if="voiceStore.sessionState === 'listening'" class="zwf-ripple-container">
          <div class="zwf-ripple zwf-ripple-1" />
          <div class="zwf-ripple zwf-ripple-2" />
          <div class="zwf-ripple zwf-ripple-3" />
        </div>
        <button
          :class="['zwf-mic-btn', { active: voiceStore.sessionState !== 'idle' }]"
          title="点击开始/停止语音"
          @click="toggleRecognition"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.zwf-voice-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--zwf-bg);
}

/* ========== 顶部栏 ========== */
.zwf-voice-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--zwf-border);
  background: var(--zwf-bg-soft);
}

.zwf-voice-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--zwf-primary);
}

.zwf-voice-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ========== 状态栏 ========== */
.zwf-voice-status {
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--zwf-border);
  min-height: 44px;
  background: var(--zwf-bg-soft);
}

.zwf-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--zwf-text-faint);
  flex-shrink: 0;
}

.zwf-status-dot.listening {
  background: #34d399;
  box-shadow: 0 0 8px rgba(52,211,153,0.5);
  animation: pulse 1.5s infinite;
}

.zwf-status-dot.processing {
  background: var(--zwf-primary);
  box-shadow: 0 0 8px var(--zwf-primary-glow);
  animation: pulse 1s infinite;
}

.zwf-status-dot.speaking {
  background: #8b5cf6;
  box-shadow: 0 0 8px rgba(139,92,246,0.5);
  animation: pulse 1.2s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.zwf-status-text {
  font-size: 12px;
  color: var(--zwf-text-soft);
}

.zwf-interim-text {
  font-size: 12px;
  color: var(--zwf-text-faint);
  margin-left: auto;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ========== 消息区 ========== */
.zwf-voice-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.zwf-voice-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--zwf-text-faint);
  text-align: center;
}

.zwf-empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.zwf-empty-hint {
  font-size: 12px;
  margin-top: 8px;
  color: var(--zwf-text-faint);
}

.zwf-voice-msg {
  max-width: 88%;
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

.zwf-msg-role {
  font-size: 11px;
  color: var(--zwf-text-faint);
  margin-bottom: 4px;
}

.zwf-user {
  align-self: flex-end;
  background: var(--zwf-primary-soft);
  color: var(--zwf-text);
  border: 1px solid var(--zwf-border-strong);
  border-bottom-right-radius: 6px;
}

.zwf-user .zwf-msg-role {
  color: var(--zwf-primary);
  text-align: right;
}

.zwf-assistant {
  align-self: flex-start;
  background: var(--zwf-bg-card);
  color: var(--zwf-text);
  border: 1px solid var(--zwf-border);
  border-bottom-left-radius: 6px;
}

.zwf-system {
  align-self: center;
  background: transparent;
  color: var(--zwf-text-faint);
  font-size: 12px;
  padding: 4px 8px;
}

.zwf-action-result {
  margin-top: 4px;
  font-size: 12px;
  padding-top: 4px;
  border-top: 1px solid var(--zwf-border);
}

.zwf-success {
  color: #34d399;
}

.zwf-error {
  color: #f87171;
}

.zwf-typing {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
}

.zwf-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--zwf-text-faint);
  animation: typing 1.4s infinite;
}

.zwf-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.zwf-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%,
  60%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-4px);
  }
}

/* ========== 底部麦克风 ========== */
.zwf-voice-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 20px;
  border-top: 1px solid var(--zwf-border, #e8e8e8);
}

.zwf-mic-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88px;
  height: 88px;
}

.zwf-mic-btn {
  position: relative;
  z-index: 2;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 2px solid var(--zwf-border);
  background: var(--zwf-bg-card);
  color: var(--zwf-text-soft);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.zwf-mic-btn:hover {
  border-color: var(--zwf-primary);
  color: var(--zwf-primary);
  transform: scale(1.05);
  box-shadow: 0 0 16px var(--zwf-primary-glow);
}

.zwf-mic-btn.active {
  background: var(--zwf-primary);
  border-color: var(--zwf-primary);
  color: #000;
  box-shadow: 0 0 24px var(--zwf-primary-glow);
}

/* ========== 波纹动画 ========== */
.zwf-ripple-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 64px;
  height: 64px;
  z-index: 1;
}

.zwf-ripple {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 2px solid var(--zwf-primary);
  opacity: 0;
  animation: voice-ripple 2s infinite;
}

.zwf-ripple-1 {
  animation-delay: 0s;
}

.zwf-ripple-2 {
  animation-delay: 0.6s;
}

.zwf-ripple-3 {
  animation-delay: 1.2s;
}

@keyframes voice-ripple {
  0% {
    transform: scale(1);
    opacity: 0.6;
  }
  100% {
    transform: scale(2.5);
    opacity: 0;
  }
}

/* ========== 控件 ========== */
.zwf-clear-btn {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--zwf-text-soft);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.zwf-clear-btn:hover {
  background: rgba(248,113,113,0.1);
  color: #f87171;
}

.zwf-switch-text-btn {
  border: none;
  background: transparent;
  color: var(--zwf-text-faint);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.zwf-switch-text-btn:hover {
  color: var(--zwf-primary);
  background: var(--zwf-primary-soft);
}

/* ========== 小屏宽度适配 ========== */
@media (max-width: 640px) {
  .zwf-voice-status {
    padding: 8px 14px;
    min-height: 38px;
  }
  .zwf-voice-messages {
    padding: 14px;
    gap: 12px;
  }
  .zwf-empty-icon {
    font-size: 36px;
    margin-bottom: 10px;
  }
  .zwf-voice-msg {
    max-width: 94%;
    padding: 10px 12px;
    font-size: 13px;
    border-radius: 12px;
  }
  .zwf-voice-controls {
    padding: 16px 14px;
  }
  .zwf-mic-wrapper {
    width: 72px;
    height: 72px;
  }
  .zwf-mic-btn {
    width: 58px;
    height: 58px;
  }
  .zwf-mic-btn svg {
    width: 22px;
    height: 22px;
  }
}

/* ========== 短视口高度适配 ========== */
@media (max-height: 680px) {
  .zwf-voice-status {
    padding: 6px 14px;
    min-height: 34px;
  }
  .zwf-voice-messages {
    padding: 10px 14px;
    gap: 10px;
  }
  .zwf-empty-icon {
    font-size: 32px;
    margin-bottom: 8px;
  }
  .zwf-empty-hint {
    margin-top: 4px;
  }
  .zwf-voice-msg {
    padding: 8px 12px;
    font-size: 13px;
  }
  .zwf-voice-controls {
    padding: 12px 14px;
  }
  .zwf-mic-wrapper {
    width: 64px;
    height: 64px;
  }
  .zwf-mic-btn {
    width: 52px;
    height: 52px;
  }
  .zwf-mic-btn svg {
    width: 20px;
    height: 20px;
  }
  .zwf-ripple-container {
    width: 52px;
    height: 52px;
  }
}
</style>
