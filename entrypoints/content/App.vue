<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import FloatingButton from './components/FloatingButton.vue';
import ChatDrawer from './components/ChatDrawer.vue';
import SettingsModal from './components/SettingsModal.vue';
import ToastContainer from './components/ToastContainer.vue';
import { useSettingsStore } from '@/src/stores/settings';
import { useConversationsStore } from '@/src/stores/conversations';
import { matchShortcut } from '@/src/utils/shortcut';
import { getThemeById } from '@/src/themes';

console.log('[App] Vue 组件初始化');

const open = ref(false);
const showSettings = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const settingsStore = useSettingsStore();
const convStore = useConversationsStore();

function toggle() {
  console.log('[App] toggle() 被调用，当前状态:', open.value);
  open.value = !open.value;
}

function onMessage(msg: any) {
  if (msg?.type === 'zwf-toggle') toggle();
}

function onKeydown(e: KeyboardEvent) {
  const sc = settingsStore.settings.shortcut;
  if (matchShortcut(e, sc)) {
    console.log('[App] 快捷键触发:', sc);
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }
}

/** 鼠标松开时检测选中文字，自动发送给 AI 分析 */
function onMouseup(_e: MouseEvent) {
  // 抽屉未打开，不处理
  if (!open.value) return;
  // 功能开关关闭，不处理
  if (settingsStore.settings.autoSendSelection === false) return;

  const selection = document.getSelection();
  const text = selection?.toString().trim();
  if (!text) return;

  console.log('[App] 检测到选中文字，自动发送', { length: text.length });

  // 清除选区，避免重复触发
  selection?.removeAllRanges();

  // 发送给 AI
  convStore.send(text);
}

/** 应用主题 CSS 变量到 shadow host */
function applyTheme() {
  const el = rootEl.value;
  if (!el) return;
  const root = el.getRootNode();
  const host = root instanceof ShadowRoot ? (root.host as HTMLElement) : el;
  const theme = getThemeById(settingsStore.settings.theme);
  for (const [key, value] of Object.entries(theme.vars)) {
    host.style.setProperty(key, value);
  }
  // 兼容旧版 primaryColor
  host.style.setProperty('--zwf-primary', theme.vars['--zwf-primary'] || settingsStore.settings.primaryColor);
  host.style.setProperty('--zwf-drawer-width', '480px');
  console.log('[App] 主题已应用:', theme.name);
}

watch(
  () => settingsStore.settings.theme,
  () => applyTheme()
);

onMounted(async () => {
  console.log('[App] onMounted 开始');
  try {
    await Promise.all([settingsStore.init(), convStore.init()]);
    console.log('[App] Store 初始化完成');
  } catch (error) {
    console.error('[App] Store 初始化失败:', error);
  }
  applyTheme();
  chrome.runtime?.onMessage?.addListener(onMessage);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mouseup', onMouseup, true);
  console.log('[App] onMounted 完成，事件监听器已注册');
});

onUnmounted(() => {
  console.log('[App] onUnmounted，清理事件监听器');
  chrome.runtime?.onMessage?.removeListener?.(onMessage);
  document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('mouseup', onMouseup, true);
});
</script>

<template>
  <div ref="rootEl">
    <FloatingButton @click="toggle" />
    <ChatDrawer
      :open="open"
      @close="open = false"
      @open-settings="showSettings = true"
    />
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
    <ToastContainer />
  </div>
</template>
