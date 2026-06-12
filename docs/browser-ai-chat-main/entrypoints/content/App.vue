<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import FloatingButton from './components/FloatingButton.vue';
import ChatDrawer from './components/ChatDrawer.vue';
import SettingsModal from './components/SettingsModal.vue';
import ToastContainer from './components/ToastContainer.vue';
import { useSettingsStore } from '@/src/stores/settings';
import { useConversationsStore } from '@/src/stores/conversations';
import { matchShortcut } from '@/src/utils/shortcut';

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
}

function onKeydown(e: KeyboardEvent) {
  const sc = settingsStore.settings.shortcut;
  if (matchShortcut(e, sc)) {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }
}

/** 把主题色 / 抽屉宽度等写到 shadow host，确保 :host 选择器内引用的 css var 也能动态变 */
function applyTheme() {
  const el = rootEl.value;
  if (!el) return;
  const root = el.getRootNode();
  const host = root instanceof ShadowRoot ? (root.host as HTMLElement) : el;
  const { primaryColor, drawerWidth } = settingsStore.settings;
  host.style.setProperty('--zwf-primary', primaryColor);
  host.style.setProperty(
    '--zwf-primary-soft',
    `color-mix(in srgb, ${primaryColor} 12%, white)`
  );
  host.style.setProperty('--zwf-drawer-width', `${drawerWidth}vw`);
}

watch(
  [
    () => settingsStore.settings.primaryColor,
    () => settingsStore.settings.drawerWidth,
  ],
  () => applyTheme()
);

onMounted(async () => {
  await Promise.all([settingsStore.init(), convStore.init()]);
  applyTheme();
  chrome.runtime?.onMessage?.addListener(onMessage);
  document.addEventListener('keydown', onKeydown, true);
});

onUnmounted(() => {
  chrome.runtime?.onMessage?.removeListener?.(onMessage);
  document.removeEventListener('keydown', onKeydown, true);
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
