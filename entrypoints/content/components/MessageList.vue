<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ChatMessage, Conversation } from '@/src/types';
import { useConversationsStore } from '@/src/stores/conversations';
import { useToast } from '@/src/composables/useToast';
import MessageItem from './MessageItem.vue';
import EmptyChat from './EmptyChat.vue';
import MessageContextMenu from './MessageContextMenu.vue';

const props = defineProps<{ conversation: Conversation }>();
const emit = defineEmits<{ (e: 'scroll-to-bottom'): void }>();
const store = useConversationsStore();
const toast = useToast();

const scroller = ref<HTMLDivElement | null>(null);
const anchor = ref<HTMLDivElement | null>(null);
/** 用户没主动上滚就一直贴底 */
const stickToBottom = ref(true);
/** 实际滚动容器（.aib-centered-body） */
const scrollContainer = ref<HTMLDivElement | null>(null);
/** 距离底部的阈值 */
const BOTTOM_THRESHOLD = 30;

interface CtxMenu {
  x: number;
  y: number;
  message: ChatMessage;
}
const ctxMenu = ref<CtxMenu | null>(null);
const MENU_WIDTH = 160;
const MENU_HEIGHT = 130;

function onContextMenu(payload: { message: ChatMessage; x: number; y: number }) {
  // .aib-drawer 上有 transform，会让内部 position:fixed 以 drawer 为参考系。
  // 把鼠标的视口坐标换算成 drawer 本地坐标
  const drawer = scroller.value?.closest('.aib-drawer') as HTMLElement | null;
  const rect = drawer?.getBoundingClientRect();
  const ox = rect?.left ?? 0;
  const oy = rect?.top ?? 0;
  const w = rect?.width ?? window.innerWidth;
  const h = rect?.height ?? window.innerHeight;
  ctxMenu.value = {
    x: Math.min(payload.x - ox, w - MENU_WIDTH - 8),
    y: Math.min(payload.y - oy, h - MENU_HEIGHT - 8),
    message: payload.message,
  };
}

function closeMenu() {
  ctxMenu.value = null;
}

async function copyMessage() {
  if (!ctxMenu.value) return;
  const text = ctxMenu.value.message.content || '';
  try {
    await navigator.clipboard.writeText(text);
    toast.success('已复制');
  } catch {
    // 降级：execCommand 在 Shadow DOM 内不一定可用，但兜底总比没有强
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast.success('已复制');
    } catch {
      toast.error('复制失败');
    }
    document.body.removeChild(ta);
  }
  closeMenu();
}

function deleteMessage() {
  if (!ctxMenu.value) return;
  store.deleteMessage(ctxMenu.value.message.id);
  closeMenu();
}

async function bookmarkMessage() {
  if (!ctxMenu.value) return;
  const msg = ctxMenu.value.message;
  // 打开笔记收藏弹框
  window.dispatchEvent(new CustomEvent('aib-bookmark-note', {
    detail: {
      content: msg.content,
      url: '',
      scrollY: 0,
      source: 'chat' as const,
    },
  }));
  closeMenu();
}

function onDocClick() {
  if (ctxMenu.value) closeMenu();
}
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && ctxMenu.value) closeMenu();
}

function jumpToBottom() {
  stickToBottom.value = true;
  scrollToBottom();
}

function scrollToBottom() {
  const container = scrollContainer.value;
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}

/** 切换会话时恢复滚动位置 */
async function restoreScroll() {
  await nextTick();
  const container = scrollContainer.value;
  if (!container) return;
  const top = props.conversation.scrollTop;
  if (top != null) {
    container.scrollTop = top;
    stickToBottom.value = container.scrollHeight - top - container.clientHeight < 50;
  } else {
    scrollToBottom();
    stickToBottom.value = true;
  }
}

watch(
  () => props.conversation.id,
  () => {
    stickToBottom.value = true;
    restoreScroll();
  }
);

/** 流式 / 内容更新时按需贴底 */
watch(
  () =>
    props.conversation.messages
      .map((m) => m.content + (m.reasoning || ''))
      .join('|'),
  async () => {
    await nextTick();
    if (!scroller.value) return;
    // 只有当 stickToBottom 为 true 时才自动滚动，不再强制流式输出时滚动
    if (stickToBottom.value) {
      scrollToBottom();
      // 二次保险：等浏览器 layout（代码块 / 表格 / KaTeX 等异步布局）
      requestAnimationFrame(() => scrollToBottom());
    }
  }
);

function onScroll() {
  const container = scrollContainer.value;
  if (!container) return;
  store.updateScroll(container.scrollTop);
  // 离底超过阈值视为主动上滚
  const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  stickToBottom.value = distanceFromBottom < BOTTOM_THRESHOLD;
}

async function quickSend(text: string) {
  try {
    await store.send(text, []);
  } catch (e: any) {
    toast.error(e?.message || '发送失败');
  }
}

onMounted(() => {
  // 获取实际的滚动容器（.aib-centered-body）
  scrollContainer.value = scroller.value?.closest('.aib-centered-body') as HTMLDivElement | null;
  if (scrollContainer.value) {
    scrollContainer.value.addEventListener('scroll', onScroll);
  }
  restoreScroll();
  document.addEventListener('mousedown', onDocClick);
  document.addEventListener('keydown', onEsc);
});
onUnmounted(() => {
  if (scrollContainer.value) {
    scrollContainer.value.removeEventListener('scroll', onScroll);
  }
  document.removeEventListener('mousedown', onDocClick);
  document.removeEventListener('keydown', onEsc);
});

/** 是否显示回到底部按钮 */
const showScrollBottom = computed(() => !stickToBottom.value && props.conversation.messages.length > 0);

/** 暴露给父组件的方法 */
defineExpose({
  jumpToBottom,
  stickToBottom,
  showScrollBottom,
});
</script>

<template>
  <div class="aib-msg-list-wrap">
    <div ref="scroller" class="aib-msg-list">
      <template v-if="conversation.messages.length">
        <MessageItem
          v-for="m in conversation.messages"
          :key="m.id"
          :message="m"
          @context-menu="onContextMenu"
        />
        <div ref="anchor" class="aib-msg-anchor" aria-hidden="true" />
      </template>
      <EmptyChat v-else @pick="quickSend" />
    </div>
  </div>

  <MessageContextMenu
    v-if="ctxMenu"
    :x="ctxMenu.x"
    :y="ctxMenu.y"
    @copy="copyMessage"
    @bookmark="bookmarkMessage"
    @delete="deleteMessage"
  />
</template>
