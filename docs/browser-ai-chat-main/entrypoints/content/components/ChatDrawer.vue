<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConversationsStore } from '@/src/stores/conversations';
import { useSettingsStore } from '@/src/stores/settings';
import { useToast } from '@/src/composables/useToast';
import ChatPanel from './ChatPanel.vue';
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

/** 标题：动态展示当前会话标题，无会话时显示插件名 */
const title = computed(() => {
  const t = store.active?.title?.trim();
  return t || 'ZWF AI Chat';
});

function newConv() {
  store.createConversation();
}

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
      <span class="zwf-drawer-title">{{ title }}</span>
      <div class="zwf-header-actions">
        <button class="zwf-icon-btn" title="新建会话" @click="newConv">
          <!-- message-square-plus -->
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <line x1="9" y1="10" x2="15" y2="10" />
            <line x1="12" y1="7" x2="12" y2="13" />
          </svg>
        </button>
        <button class="zwf-icon-btn" title="清除缓存" @click="askClear">
          <!-- eraser -->
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
            <path d="M22 21H7" />
            <path d="m5 11 9 9" />
          </svg>
        </button>
        <a
          class="zwf-icon-btn"
          href="https://github.com/zwf1110/browser-ai-chat"
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub 仓库"
        >
          <!-- github -->
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .5C5.73.5.99 5.24.99 11.51c0 4.86 3.15 8.98 7.52 10.43.55.1.75-.24.75-.53 0-.26-.01-.95-.02-1.86-3.06.66-3.71-1.47-3.71-1.47-.5-1.27-1.22-1.61-1.22-1.61-.99-.68.08-.67.08-.67 1.1.08 1.68 1.13 1.68 1.13.98 1.68 2.57 1.2 3.2.92.1-.71.38-1.2.69-1.48-2.44-.28-5.01-1.22-5.01-5.43 0-1.2.43-2.18 1.13-2.95-.11-.28-.49-1.4.11-2.92 0 0 .92-.29 3.02 1.13.88-.24 1.82-.36 2.76-.37.94.01 1.88.13 2.76.37 2.1-1.42 3.02-1.13 3.02-1.13.6 1.52.22 2.64.11 2.92.7.77 1.13 1.75 1.13 2.95 0 4.22-2.58 5.15-5.03 5.42.39.34.74 1 .74 2.02 0 1.46-.01 2.64-.01 3 0 .29.2.64.76.53 4.36-1.46 7.5-5.57 7.5-10.43C23.01 5.24 18.27.5 12 .5z"/>
          </svg>
        </a>
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
      <ChatPanel v-if="open" />
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
