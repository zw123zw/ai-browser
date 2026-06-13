<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConversationsStore } from '@/src/stores/conversations';
import { useSettingsStore } from '@/src/stores/settings';
import { useToast } from '@/src/composables/useToast';
import ChatPanel from './ChatPanel.vue';
import VoicePanel from './VoicePanel.vue';
import ConfirmDialog from './ConfirmDialog.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-settings'): void;
}>();

const store = useConversationsStore();
const settingsStore = useSettingsStore();
const toast = useToast();
const showConfirm = ref(false);

/** 当前模式：chat 或 voice */
const activeMode = ref<'chat' | 'voice'>('chat');

/** 切换到语音模式 */
function switchToVoice() {
  activeMode.value = 'voice';
}

/** 切换到文字模式 */
function switchToChat() {
  activeMode.value = 'chat';
}

/** 标题：动态展示当前会话标题 */
const title = computed(() => {
  if (activeMode.value === 'voice') return '语音助手';
  return store.active?.title?.trim() || '';
});

function askClear() {
  showConfirm.value = true;
}

async function doClear() {
  await store.clearAll();
  await settingsStore.init();
  showConfirm.value = false;
  toast.success('缓存已清除');
}

const drawerClass = computed(() => ({ 'zwf-open': props.open }));
</script>

<template>
  <div :class="['zwf-drawer-mask', drawerClass]" @click="emit('close')" />
  <div :class="['zwf-drawer', drawerClass]" @click.stop>
    <div class="zwf-drawer-header">
      <div class="zwf-header-left">
        <!-- 语音模式：返回按钮 + 标题 -->
        <template v-if="activeMode === 'voice'">
          <button class="zwf-back-btn" title="返回文字模式" @click="switchToChat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span class="zwf-drawer-title">🎤 语音助手</span>
        </template>
        <!-- 文字模式：标题 -->
        <template v-else-if="title">
          <span class="zwf-drawer-title">{{ title }}</span>
        </template>
        <template v-else>
          <span class="zwf-brand">
            <span class="zwf-brand-ai">ai</span><span class="zwf-brand-sep">-</span><span class="zwf-brand-browser">browser</span>
            <span class="zwf-brand-shine" />
          </span>
        </template>
      </div>
      <div class="zwf-header-actions">
        <template v-if="activeMode === 'chat'">
          <button class="zwf-icon-btn" title="清除缓存" @click="askClear">
            <!-- eraser -->
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
              <path d="M22 21H7" />
              <path d="m5 11 9 9" />
            </svg>
          </button>
        </template>
        <button class="zwf-icon-btn" title="设置" @click="emit('open-settings')">
          <!-- settings (gear) -->
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <span class="zwf-header-divider" />
        <button class="zwf-icon-btn" title="关闭" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
    <div class="zwf-drawer-body">
      <ChatPanel v-if="open && activeMode === 'chat'" @switch-voice="switchToVoice" />
      <VoicePanel v-if="open && activeMode === 'voice'" @switch-chat="switchToChat" />
    </div>

    <!-- 清除缓存确认 -->
    <ConfirmDialog
      :visible="showConfirm"
      title="清除缓存"
      desc="此操作会清除所有会话、设置、悬浮按钮位置等本地数据，删除后无法恢复。"
      confirm-text="确认清除"
      variant="danger"
      @confirm="doClear"
      @cancel="showConfirm = false"
    >
      <template #icon>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      </template>
    </ConfirmDialog>
  </div>
</template>

<style scoped>
.zwf-back-btn {
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
  margin-right: 4px;
}

.zwf-back-btn:hover {
  background: var(--zwf-bg-hover);
  color: var(--zwf-primary);
}
</style>
