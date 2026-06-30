<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from '@/src/i18n'
import { useVoiceStore } from '@/src/stores/voice'
import { useConversationsStore } from '@/src/stores/conversations'
import type { SessionState } from '@/src/stores/voice'
import MessageList from './MessageList.vue'

const { t } = useI18n()
const emit = defineEmits<{ (e: 'switch-chat'): void }>()
const voiceStore = useVoiceStore()
const convStore = useConversationsStore()
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)

// 新消息自动滚动到底部
watch(
  () => convStore.conversation?.messages.length,
  () => {
    setTimeout(() => {
      messageListRef.value?.jumpToBottom()
    }, 200)
  },
  { flush: 'post' },
)

function getStatusText(state: SessionState): string {
  switch (state) {
    case 'wake': return '等待唤醒词...'
    case 'command': return '请说出命令'
    case 'processing': return t('voice.processing')
    case 'speaking': return '播报中...'
    default: return t('voice.listening')
  }
}
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

    <!-- 消息列表（复用主面板组件） -->
    <div class="aib-voice-messages aib-centered-body">
      <div v-if="!convStore.conversation || convStore.conversation.messages.length === 0" class="aib-voice-empty">
        <div class="aib-empty-icon">🎤</div>
        <p>{{ t('voice.title') }}</p>
        <p class="aib-empty-hint">
          {{ voiceStore.settings.enableWakeWord
            ? `说「${voiceStore.settings.wakeWord}」唤醒我`
            : '直接说出命令' }}
        </p>
      </div>
      <MessageList
        v-else
        ref="messageListRef"
        :conversation="convStore.conversation"
      />
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
  background: var(--aib-success);
  box-shadow: 0 0 8px var(--aib-success-border);
  animation: pulse 2s infinite;
}

.aib-status-dot.command {
  background: var(--aib-success);
  box-shadow: 0 0 8px var(--aib-success-border);
  animation: pulse 1.5s infinite;
}

.aib-status-dot.processing {
  background: var(--aib-primary);
  box-shadow: 0 0 8px var(--aib-primary-glow);
  animation: pulse 1s infinite;
}

.aib-status-dot.speaking {
  background: var(--aib-primary);
  box-shadow: 0 0 8px var(--aib-primary-glow);
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
  display: flex;
  flex-direction: column;
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
  color: var(--aib-text-on-primary);
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
  .aib-voice-controls { padding: 16px 14px; }
  .aib-mic-wrapper { width: 72px; height: 72px; }
  .aib-mic-indicator { width: 58px; height: 58px; }
  .aib-mic-indicator svg { width: 22px; height: 22px; }
}

@media (max-height: 680px) {
  .aib-voice-status { padding: 6px 14px; min-height: 34px; }
  .aib-voice-controls { padding: 12px 14px; }
  .aib-mic-wrapper { width: 64px; height: 64px; }
  .aib-mic-indicator { width: 52px; height: 52px; }
  .aib-mic-indicator svg { width: 20px; height: 20px; }
  .aib-ripple-container { width: 52px; height: 52px; }
}
</style>
