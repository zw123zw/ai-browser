<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useVoiceStore } from '@/src/stores/voice'
import { useSettingsStore } from '@/src/stores/settings'
import { useToast } from '@/src/composables/useToast'
import { VoiceSession } from '@/src/voice/session'
import { ActionExecutor } from '@/src/browser/action-executor'
import { Logger } from '@/src/utils/logger'
import type { SessionState } from '@/src/stores/voice'

const emit = defineEmits<{ (e: 'switch-chat'): void }>()
const log = new Logger('VoicePanel')
const voiceStore = useVoiceStore()
const settingsStore = useSettingsStore()
const toast = useToast()

const messagesRef = ref<HTMLElement | null>(null)
let session: VoiceSession | null = null
const actionExecutor = new ActionExecutor()

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
      // 优先使用本地 ActionExecutor（content script 上下文）
      try {
        const result = await actionExecutor.execute({
          action,
          url: params.url as string,
          text: params.keyword as string,
          direction: params.direction as string,
          key: params.key as string,
          ms: params.ms as number,
          description: params.description as string,
        })
        return result
      } catch (error) {
        log.error('本地执行失败，回退到跨标签页执行', error)
        // 回退：通过 chrome.tabs.sendMessage 执行
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
        } catch (fallbackError) {
          log.error('回退执行也失败', fallbackError)
          return { success: false, message: String(fallbackError) }
        }
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
      <div v-if="voiceStore.messages.length === 0" class="aib-voice-empty">
        <div class="aib-empty-icon">🎤</div>
        <p>说出你的指令</p>
        <p class="aib-empty-hint">
          例如：「打开B站」「搜索美食教程」「今天天气怎么样」
        </p>
      </div>

      <!-- 消息列表 -->
      <div
        v-for="msg in voiceStore.messages"
        :key="msg.id"
        :class="['aib-voice-msg', `aib-${msg.role}`]"
      >
        <div class="aib-msg-role">
          {{ msg.role === 'user' ? '🗣️ 你' : msg.role === 'assistant' ? '🤖 AI' : 'ℹ️ 系统' }}
        </div>
        <div class="aib-msg-content">{{ msg.content }}</div>
        <div v-if="msg.actionResult" class="aib-action-result">
          <span :class="msg.actionResult.success ? 'aib-success' : 'aib-error'">
            {{ msg.actionResult.success ? '✅' : '❌' }} {{ msg.actionResult.message }}
          </span>
        </div>
      </div>

      <!-- 处理中指示器 -->
      <div v-if="voiceStore.isProcessing" class="aib-voice-msg aib-assistant">
        <div class="aib-msg-role">🤖 AI</div>
        <div class="aib-msg-content aib-typing">
          <span class="aib-dot" />
          <span class="aib-dot" />
          <span class="aib-dot" />
        </div>
      </div>
    </div>

    <!-- 底部麦克风控制 -->
    <div class="aib-voice-controls">
      <div class="aib-mic-wrapper">
        <!-- 波纹动画层 -->
        <div v-if="voiceStore.sessionState === 'listening'" class="aib-ripple-container">
          <div class="aib-ripple aib-ripple-1" />
          <div class="aib-ripple aib-ripple-2" />
          <div class="aib-ripple aib-ripple-3" />
        </div>
        <button
          :class="['aib-mic-btn', { active: voiceStore.sessionState !== 'idle' }]"
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
.aib-voice-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--aib-bg);
}

/* ========== 顶部栏 ========== */
.aib-voice-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--aib-border);
  background: var(--aib-bg-soft);
}

.aib-voice-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--aib-primary);
}

.aib-voice-actions {
  display: flex;
  align-items: center;
  gap: 10px;
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

.aib-status-dot.listening {
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
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
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

.aib-action-result {
  margin-top: 4px;
  font-size: 12px;
  padding-top: 4px;
  border-top: 1px solid var(--aib-border);
}

.aib-success {
  color: #34d399;
}

.aib-error {
  color: #f87171;
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

.aib-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.aib-dot:nth-child(3) {
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
.aib-voice-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 20px;
  border-top: 1px solid var(--aib-border, #e8e8e8);
}

.aib-mic-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 88px;
  height: 88px;
}

.aib-mic-btn {
  position: relative;
  z-index: 2;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  border: 2px solid var(--aib-border);
  background: var(--aib-bg-card);
  color: var(--aib-text-soft);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.aib-mic-btn:hover {
  border-color: var(--aib-primary);
  color: var(--aib-primary);
  transform: scale(1.05);
  box-shadow: 0 0 16px var(--aib-primary-glow);
}

.aib-mic-btn.active {
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

.aib-ripple-1 {
  animation-delay: 0s;
}

.aib-ripple-2 {
  animation-delay: 0.6s;
}

.aib-ripple-3 {
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
.aib-clear-btn {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--aib-text-soft);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.aib-clear-btn:hover {
  background: rgba(248,113,113,0.1);
  color: #f87171;
}

.aib-switch-text-btn {
  border: none;
  background: transparent;
  color: var(--aib-text-faint);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.aib-switch-text-btn:hover {
  color: var(--aib-primary);
  background: var(--aib-primary-soft);
}

/* ========== 小屏宽度适配 ========== */
@media (max-width: 640px) {
  .aib-voice-status {
    padding: 8px 14px;
    min-height: 38px;
  }
  .aib-voice-messages {
    padding: 14px;
    gap: 12px;
  }
  .aib-empty-icon {
    font-size: 36px;
    margin-bottom: 10px;
  }
  .aib-voice-msg {
    max-width: 94%;
    padding: 10px 12px;
    font-size: 13px;
    border-radius: 12px;
  }
  .aib-voice-controls {
    padding: 16px 14px;
  }
  .aib-mic-wrapper {
    width: 72px;
    height: 72px;
  }
  .aib-mic-btn {
    width: 58px;
    height: 58px;
  }
  .aib-mic-btn svg {
    width: 22px;
    height: 22px;
  }
}

/* ========== 短视口高度适配 ========== */
@media (max-height: 680px) {
  .aib-voice-status {
    padding: 6px 14px;
    min-height: 34px;
  }
  .aib-voice-messages {
    padding: 10px 14px;
    gap: 10px;
  }
  .aib-empty-icon {
    font-size: 32px;
    margin-bottom: 8px;
  }
  .aib-empty-hint {
    margin-top: 4px;
  }
  .aib-voice-msg {
    padding: 8px 12px;
    font-size: 13px;
  }
  .aib-voice-controls {
    padding: 12px 14px;
  }
  .aib-mic-wrapper {
    width: 64px;
    height: 64px;
  }
  .aib-mic-btn {
    width: 52px;
    height: 52px;
  }
  .aib-mic-btn svg {
    width: 20px;
    height: 20px;
  }
  .aib-ripple-container {
    width: 52px;
    height: 52px;
  }
}
</style>
