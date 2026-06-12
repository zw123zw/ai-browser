<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { fabPosStorage, type FabPos } from '@/src/storage';
import { useSettingsStore } from '@/src/stores/settings';

const emit = defineEmits<{ (e: 'click'): void }>();
const settingsStore = useSettingsStore();

const iconUrl = computed(() => {
  try {
    return chrome.runtime.getURL('icon.png');
  } catch {
    return '';
  }
});
const imgError = ref(false);

const FAB_SIZE = 48;
const PADDING = 8;

const pos = reactive<FabPos>({ right: 24, bottom: 24 });
const dragging = ref(false);
/** 拖动期间临时屏蔽 click（mouseup 时如果移动超过阈值就标记） */
let moved = false;
let startX = 0;
let startY = 0;
let startRight = 0;
let startBottom = 0;

async function loadPos() {
  const saved = await fabPosStorage.getValue();
  if (saved) Object.assign(pos, clampPos(saved));
}

function clampPos(p: FabPos): FabPos {
  const maxRight = window.innerWidth - FAB_SIZE - PADDING;
  const maxBottom = window.innerHeight - FAB_SIZE - PADDING;
  return {
    right: Math.min(Math.max(PADDING, p.right), maxRight),
    bottom: Math.min(Math.max(PADDING, p.bottom), maxBottom),
  };
}

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  dragging.value = true;
  moved = false;
  startX = e.clientX;
  startY = e.clientY;
  startRight = pos.right;
  startBottom = pos.bottom;
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  e.preventDefault();
}

function onMouseMove(e: MouseEvent) {
  if (!dragging.value) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
  // right/bottom 与鼠标位移方向相反
  const next = clampPos({
    right: startRight - dx,
    bottom: startBottom - dy,
  });
  pos.right = next.right;
  pos.bottom = next.bottom;
}

async function onMouseUp() {
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
  dragging.value = false;
  if (moved) {
    await fabPosStorage.setValue({ ...pos });
  } else {
    emit('click');
  }
}

function onResize() {
  Object.assign(pos, clampPos(pos));
}

onMounted(() => {
  loadPos();
  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', onResize);
  window.removeEventListener('mousemove', onMouseMove);
  window.removeEventListener('mouseup', onMouseUp);
});
</script>

<template>
  <div
    class="zwf-fab"
    :class="{ 'zwf-fab-dragging': dragging }"
    :style="{ right: pos.right + 'px', bottom: pos.bottom + 'px' }"
    @mousedown="onMouseDown"
  >
    <span class="zwf-fab-tip">ZWF AI Chat ({{ settingsStore.settings.shortcut || 'Ctrl+Shift+M' }})</span>
    <img
      v-if="iconUrl && !imgError"
      :src="iconUrl"
      alt="ZWF"
      class="zwf-fab-img"
      draggable="false"
      @error="imgError = true"
    />
    <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V11a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
    </svg>
  </div>
</template>
