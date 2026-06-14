<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { fabPosStorage, type FabPos } from '@/src/storage';
import { useSettingsStore } from '@/src/stores/settings';

console.log('[FloatingButton] 组件初始化');

const emit = defineEmits<{ (e: 'click'): void }>();
const settingsStore = useSettingsStore();

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
  console.log('[FloatingButton] 加载按钮位置...');
  const saved = await fabPosStorage.getValue();
  console.log('[FloatingButton] 保存的位置:', saved);
  if (saved) Object.assign(pos, clampPos(saved));
  console.log('[FloatingButton] 当前位置:', { right: pos.right, bottom: pos.bottom });
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
  console.log('[FloatingButton] onMounted 开始');
  loadPos();
  window.addEventListener('resize', onResize);
  console.log('[FloatingButton] onMounted 完成，组件已挂载');
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
    <span class="zwf-fab-tip">AI 语音助手 ({{ settingsStore.settings.shortcut || 'Ctrl+`' }})</span>
    <!-- Logo - 科技芯片 -->
    <svg class="zwf-fab-svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <!-- 外层八角科技框 -->
      <path d="M8 2H16L22 8V16L16 22H8L2 16V8L8 2Z"
        stroke="currentColor" stroke-width="1" stroke-linejoin="round" opacity="0.35" />
      <!-- 内层菱形 -->
      <path d="M12 5L19 12L12 19L5 12L12 5Z"
        stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" opacity="0.6" />
      <!-- 中心电路节点 -->
      <rect x="9.5" y="9.5" width="5" height="5" rx="1"
        stroke="currentColor" stroke-width="1.5" />
      <!-- 中心亮核 -->
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <!-- 四向连接线 -->
      <line x1="12" y1="5" x2="12" y2="9.5" stroke="currentColor" stroke-width="1.2" opacity="0.5" />
      <line x1="12" y1="14.5" x2="12" y2="19" stroke="currentColor" stroke-width="1.2" opacity="0.5" />
      <line x1="5" y1="12" x2="9.5" y2="12" stroke="currentColor" stroke-width="1.2" opacity="0.5" />
      <line x1="14.5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="1.2" opacity="0.5" />
      <!-- 四角节点 -->
      <circle cx="12" cy="5" r="1.2" fill="currentColor" opacity="0.6" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" opacity="0.6" />
      <circle cx="12" cy="19" r="1.2" fill="currentColor" opacity="0.6" />
      <circle cx="5" cy="12" r="1.2" fill="currentColor" opacity="0.6" />
    </svg>
  </div>
</template>
