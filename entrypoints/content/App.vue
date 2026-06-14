<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import FloatingButton from './components/FloatingButton.vue';
import ChatDrawer from './components/ChatDrawer.vue';
import SettingsModal from './components/SettingsModal.vue';
import ToastContainer from './components/ToastContainer.vue';
import { useSettingsStore } from '@/src/stores/settings';
import { useConversationsStore } from '@/src/stores/conversations';
import { matchShortcut } from '@/src/utils/shortcut';
import { getThemeById } from '@/src/themes';
import { drawerOpenStorage } from '@/src/storage';

console.log('[App] Vue 组件初始化');

const open = ref(false);
const showSettings = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const settingsStore = useSettingsStore();
const convStore = useConversationsStore();

function toggle() {
  open.value = !open.value;
}

function onMessage(msg: any) {
  if (msg?.type === 'zwf-toggle') toggle();
  // 接收其他标签页的抽屉状态同步
  if (msg?.type === 'zwf-drawer-sync') {
    if (msg.open !== open.value) {
      syncingFromRemote = true;
      open.value = msg.open;
      nextTick(() => (syncingFromRemote = false));
    }
  }
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

/** 鼠标松开时检测选中文字，根据设置处理 */
function onMouseup(e: MouseEvent) {
  // 抽屉未打开，不处理
  if (!open.value) return;
  // 功能关闭，不处理（兼容旧版布尔值 false）
  const mode = settingsStore.settings.autoSendSelection;
  if (mode === 'off' || (mode as unknown) === false) return;

  // 过滤：选区在扩展自身 Shadow DOM 内的不处理（避免聊天面板内选择文字被发送）
  const host = rootEl.value?.getRootNode();
  if (host instanceof ShadowRoot && e.composedPath().includes(host.host)) return;

  const selection = document.getSelection();
  const text = selection?.toString().trim();
  if (!text) return;

  // 清除选区，避免重复触发
  selection?.removeAllRanges();

  if (mode === 'manual') {
    // 手动模式：填入输入框，不自动发送
    console.log('[App] 检测到选中文字，填入输入框', { length: text.length });
    if (convStore.conversation) {
      convStore.conversation.draftText = text;
    }
  } else {
    // 自动模式：直接发送给 AI
    console.log('[App] 检测到选中文字，自动发送', { length: text.length });
    convStore.send(text);
  }
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

// 同步抽屉展开状态到持久化存储（跨页面/标签页保持）
let syncingFromRemote = false;
watch(open, async (val) => {
  if (syncingFromRemote) return;
  await drawerOpenStorage.setValue(val);
  chrome.runtime?.sendMessage?.({ type: 'zwf-drawer-changed', open: val }).catch?.(() => {});
});

onMounted(async () => {
  console.log('[App] onMounted 开始');
  try {
    await Promise.all([settingsStore.init(), convStore.init()]);
    console.log('[App] Store 初始化完成');
  } catch (error) {
    console.error('[App] Store 初始化失败:', error);
  }
  applyTheme();

  // 从持久化存储恢复抽屉展开状态（异步读取，确保从磁盘加载）
  try {
    const savedOpen = await drawerOpenStorage.getValue();
    if (savedOpen) open.value = true;
  } catch (error) {
    console.error('[App] 读取抽屉状态失败:', error);
  }

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
