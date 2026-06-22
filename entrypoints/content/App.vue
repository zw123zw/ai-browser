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
import { executeAutomationAction } from '@/src/automation/actions';
import { initI18n, useI18n } from '@/src/i18n';
import { Logger } from '@/src/utils/logger';

const log = new Logger('App');

const open = ref(false);
const showSettings = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const settingsStore = useSettingsStore();
const convStore = useConversationsStore();
const { setLocale } = useI18n();

function toggle() {
  open.value = !open.value;
}

function onMessage(msg: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
  if (msg?.type === 'aib-toggle') toggle();

  // 接收其他标签页的抽屉状态同步
  if (msg?.type === 'aib-drawer-sync') {
    if (msg.open !== open.value) {
      syncingFromRemote = true;
      open.value = msg.open;
      nextTick(() => (syncingFromRemote = false));
    }
  }

  // 自动化指令执行（来自 VoicePanel）
  if (msg?.type === 'automation') {
    log.info('收到自动化指令', { action: msg.action, params: msg.params });
    try {
      const result = executeAutomationAction(msg.action, msg.params || {});
      log.info('自动化指令执行结果', { action: msg.action, success: result.success, message: result.message });
      sendResponse(result);
    } catch (error) {
      log.error('自动化指令执行异常', error);
      sendResponse({ success: false, message: String(error) });
    }
    return true; // 异步响应
  }
}

function onKeydown(e: KeyboardEvent) {
  const sc = settingsStore.settings.shortcut;
  if (matchShortcut(e, sc)) {
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

  // 过滤：事件来自扩展自身 Shadow DOM 内的不处理（避免聊天面板内操作被干扰）
  const rootNode = rootEl.value?.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    const hostEl = rootNode.host as HTMLElement;
    // composedPath 包含 shadow host → 事件源自扩展内部
    if (e.composedPath().includes(hostEl)) return;
    // 额外检查：eventTarget 在 shadow DOM 内也不处理
    if (hostEl.contains(e.target as Node)) return;
  }

  const selection = document.getSelection();
  const text = selection?.toString().trim();
  if (!text) return;

  if (mode === 'manual') {
    // 手动模式：填入输入框，不自动发送
    if (convStore.conversation) {
      convStore.conversation.draftText = text;
    }
  } else {
    // 自动模式：直接发送给 AI
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
  host.style.setProperty('--aib-primary', theme.vars['--aib-primary'] || settingsStore.settings.primaryColor);
  host.style.setProperty('--aib-drawer-width', '480px');
}

watch(
  () => settingsStore.settings.theme,
  () => applyTheme()
);

watch(
  () => settingsStore.settings.locale,
  (val) => { if (val) setLocale(val as 'zh-CN' | 'en-US'); }
);

// 同步抽屉展开状态到持久化存储（跨页面/标签页保持）
let syncingFromRemote = false;
watch(open, async (val) => {
  if (syncingFromRemote) return;
  await drawerOpenStorage.setValue(val);
  chrome.runtime?.sendMessage?.({ type: 'aib-drawer-changed', open: val }).catch?.(() => {});
});

onMounted(async () => {
  try {
    await Promise.all([settingsStore.init(), convStore.init()]);
  } catch (error) {
    log.error('Store 初始化失败:', error);
  }
  initI18n(settingsStore.settings.locale || 'zh-CN');
  applyTheme();

  // 从持久化存储恢复抽屉展开状态（异步读取，确保从磁盘加载）
  try {
    const savedOpen = await drawerOpenStorage.getValue();
    if (savedOpen) open.value = true;
  } catch (error) {
    log.error('读取抽屉状态失败:', error);
  }

  chrome.runtime?.onMessage?.addListener(onMessage);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mouseup', onMouseup, true);
});

onUnmounted(() => {
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
