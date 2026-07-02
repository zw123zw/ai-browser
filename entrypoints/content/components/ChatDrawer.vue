<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { useConversationsStore } from '@/src/stores/conversations';
import { useSettingsStore } from '@/src/stores/settings';
import { useLicenseStore } from '@/src/stores/license';
import { useToast } from '@/src/composables/useToast';
import { abortPipeline } from '@/src/composables/usePipeline';
import { useI18n } from '@/src/i18n';
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
const licenseStore = useLicenseStore();
const toast = useToast();
const { t, locale } = useI18n();
const showConfirm = ref(false);

/** 笔记模式是否开启 */
const noteModeEnabled = computed(() => {
  const mode = settingsStore.settings.noteMode;
  return mode && mode !== 'off';
});

/** 打开笔记查看弹框 */
function openNoteViewer() {
  window.dispatchEvent(new Event('aib-toggle-note-viewer'));
}

/** 当前模式：chat 或 voice（通过 settingsStore 管理，自动持久化 + 跨标签页同步） */
const activeMode = computed({
  get: () => settingsStore.settings.voiceMode || 'chat',
  set: (mode: 'chat' | 'voice') => {
    settingsStore.update({ voiceMode: mode })
    window.dispatchEvent(new CustomEvent('aib-mode-changed', { detail: { mode } }))
  },
});

/* ---- 左侧拖拽调整宽度 ---- */
const savedWidth = settingsStore.settings.drawerWidth;
const drawerWidth = ref(savedWidth && savedWidth >= 60 ? savedWidth : 480);
const MIN_WIDTH = 60;
const MAX_WIDTH = typeof window !== 'undefined' ? Math.floor(window.innerWidth * 0.95) : 1920;
let dragging = false;

function onDragStart(e: MouseEvent) {
  e.preventDefault();
  dragging = true;
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onDragMove(e: MouseEvent) {
  if (!dragging) return;
  const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - e.clientX));
  drawerWidth.value = newWidth;
}

function onDragEnd() {
  if (!dragging) return;
  dragging = false;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  settingsStore.update({ drawerWidth: drawerWidth.value });
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
});

/* 跨标签页同步宽度 */
watch(
  () => settingsStore.settings.drawerWidth,
  (newWidth) => {
    if (!dragging && newWidth && newWidth >= MIN_WIDTH) {
      drawerWidth.value = newWidth;
    }
  }
);

/** 切换到语音模式 */
function switchToVoice() {
  activeMode.value = 'voice';
}

/** 切换到文字模式 */
function switchToChat() {
  activeMode.value = 'chat';
}

function askClear() {
  showConfirm.value = true;
}

async function doClear() {
  await abortPipeline();
  store.abort();
  await store.clearCurrent();
  showConfirm.value = false;
  toast.success(t('drawer.cleared'));
}

const drawerClass = computed(() => ({ 'aib-open': props.open }));
</script>

<template>
  <div class="aib-drawer-mask" />
  <div :class="['aib-drawer', drawerClass]" :style="{ width: drawerWidth + 'px' }" @click.stop>
    <!-- 左侧拖拽条 -->
    <div class="aib-drag-handle" @mousedown="onDragStart" />
    <div class="aib-drawer-header">
      <div class="aib-header-left">
        <!-- 语音模式：返回按钮 + 标题 -->
        <template v-if="activeMode === 'voice'">
          <button class="aib-back-btn" :title="t('drawer.backToChat')" @click="switchToChat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <span class="aib-drawer-title">{{ t('drawer.voiceTitle') }}</span>
        </template>
        <!-- 文字模式：始终显示品牌 logo -->
        <template v-else>
          <div class="aib-header-brand">
            <div class="aib-brand-row">
              <span class="aib-brand">
                <span class="aib-brand-ai">{{ locale === 'zh-CN' ? t('app.name') : t('app.fullName') }}</span>
                <span class="aib-brand-shine" />
              </span>
              <span v-if="licenseStore.isTrial" class="aib-license-tag aib-license-tag--trial">试用 {{ licenseStore.daysLeft }}天</span>
              <span v-else-if="licenseStore.isActivated" class="aib-license-tag aib-license-tag--active">{{ licenseStore.daysLeft }}天</span>
              <span v-else-if="licenseStore.status === 'expired'" class="aib-license-tag aib-license-tag--expired">已过期</span>
            </div>
            <span class="aib-brand-sub">{{ t('app.subtitle') }}</span>
          </div>
        </template>
      </div>
      <div class="aib-header-actions">
        <template v-if="activeMode === 'chat'">
          <button
            class="aib-icon-btn"
            title="我的笔记"
            @click="openNoteViewer"
          >
            <!-- notebook -->
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          </button>
          <button class="aib-icon-btn" :title="t('drawer.clear')" @click="askClear">
            <!-- eraser -->
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
              <path d="M22 21H7" />
              <path d="m5 11 9 9" />
            </svg>
          </button>
        </template>
        <button class="aib-icon-btn" :title="t('drawer.settings')" @click="emit('open-settings')">
          <!-- settings (gear) -->
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <span class="aib-header-divider" />
        <button class="aib-icon-btn" :title="t('drawer.close')" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
    <div class="aib-drawer-body">
      <ChatPanel v-if="open && activeMode === 'chat'" @switch-voice="switchToVoice" />
      <VoicePanel v-if="open && activeMode === 'voice'" @switch-chat="switchToChat" />
    </div>

    <!-- 清除对话确认 -->
    <ConfirmDialog
      :visible="showConfirm"
      :title="t('drawer.clearConfirm.title')"
      :desc="t('drawer.clearConfirm.desc')"
      :confirm-text="t('drawer.clearConfirm.confirm')"
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
.aib-back-btn {
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
  margin-right: 4px;
}

.aib-back-btn:hover {
  background: var(--aib-bg-hover);
  color: var(--aib-primary);
}

.aib-drag-handle {
  position: absolute;
  top: 0;
  left: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
  z-index: 1;
}

.aib-drag-handle:hover,
.aib-drag-handle:active {
  background: var(--aib-primary);
  opacity: 0.3;
}

@media (max-width: 640px) {
  .aib-drag-handle {
    display: none;
  }
}

/* 授权状态标签 */
.aib-license-tag {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  margin-left: 8px;
  white-space: nowrap;
  line-height: 1;
  letter-spacing: 0.3px;
  vertical-align: middle;
}

.aib-license-tag--trial {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.12) 0%, rgba(139, 92, 246, 0.06) 100%);
  color: #7c3aed;
  border: 1px solid rgba(139, 92, 246, 0.2);
}

.aib-license-tag--active {
  background: linear-gradient(135deg, rgba(34, 197, 94, 0.12) 0%, rgba(34, 197, 94, 0.06) 100%);
  color: #16a34a;
  border: 1px solid rgba(34, 197, 94, 0.2);
}

.aib-license-tag--expired {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(239, 68, 68, 0.06) 100%);
  color: #dc2626;
  border: 1px solid rgba(239, 68, 68, 0.2);
}
</style>
