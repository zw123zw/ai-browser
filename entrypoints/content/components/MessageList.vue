<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { ChatMessage, Conversation } from '@/src/types';
import { useConversationsStore } from '@/src/stores/conversations';
import { useToast } from '@/src/composables/useToast';
import MessageItem from './MessageItem.vue';
import EmptyChat from './EmptyChat.vue';
import MessageContextMenu from './MessageContextMenu.vue';

const props = defineProps<{ conversation: Conversation }>();
const store = useConversationsStore();
const toast = useToast();

const scroller = ref<HTMLDivElement | null>(null);
const anchor = ref<HTMLDivElement | null>(null);
/** 用户没主动上滚就一直贴底 */
const stickToBottom = ref(true);

interface CtxMenu {
  x: number;
  y: number;
  message: ChatMessage;
}
const ctxMenu = ref<CtxMenu | null>(null);
const MENU_WIDTH = 160;
const MENU_HEIGHT = 92;

function onContextMenu(payload: { message: ChatMessage; x: number; y: number }) {
  // .zwf-drawer 上有 transform，会让内部 position:fixed 以 drawer 为参考系。
  // 把鼠标的视口坐标换算成 drawer 本地坐标
  const drawer = scroller.value?.closest('.zwf-drawer') as HTMLElement | null;
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
  store.deleteMessage(props.conversation.id, ctxMenu.value.message.id);
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
  if (anchor.value) {
    anchor.value.scrollIntoView({ block: 'end' });
  } else if (scroller.value) {
    scroller.value.scrollTop = scroller.value.scrollHeight;
  }
}

/** 切换会话时恢复滚动位置 */
async function restoreScroll() {
  await nextTick();
  if (!scroller.value) return;
  const top = props.conversation.scrollTop;
  if (top != null) {
    scroller.value.scrollTop = top;
    const el = scroller.value;
    stickToBottom.value = el.scrollHeight - top - el.clientHeight < 60;
  } else {
    scrollToBottom();
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
    const last = props.conversation.messages[props.conversation.messages.length - 1];
    if (last?.status === 'streaming' || stickToBottom.value) {
      scrollToBottom();
      // 二次保险：等浏览器 layout（代码块 / 表格 / KaTeX 等异步布局）
      requestAnimationFrame(() => scrollToBottom());
    }
  }
);

function onScroll() {
  if (!scroller.value) return;
  const el = scroller.value;
  store.updateScroll(props.conversation.id, el.scrollTop);
  // 离底超过 80px 视为主动上滚
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

async function quickSend(text: string) {
  try {
    await store.send(props.conversation.id, text, []);
  } catch (e: any) {
    toast.error(e?.message || '发送失败');
  }
}

onMounted(() => {
  restoreScroll();
  document.addEventListener('mousedown', onDocClick);
  document.addEventListener('keydown', onEsc);
});
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocClick);
  document.removeEventListener('keydown', onEsc);
});
</script>

<template>
  <div class="zwf-msg-list-wrap">
    <div ref="scroller" class="zwf-msg-list" @scroll="onScroll">
      <template v-if="conversation.messages.length">
        <MessageItem
          v-for="m in conversation.messages"
          :key="m.id"
          :message="m"
          @context-menu="onContextMenu"
        />
        <div ref="anchor" class="zwf-msg-anchor" aria-hidden="true" />
      </template>
      <EmptyChat v-else @pick="quickSend" />
    </div>

    <!-- 一键滚动到底部 -->
    <transition name="zwf-fade">
      <button
        v-if="!stickToBottom && conversation.messages.length"
        class="zwf-scroll-bottom-btn"
        title="滚动到底部"
        @click="jumpToBottom"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <polyline points="19 12 12 19 5 12" />
        </svg>
      </button>
    </transition>
  </div>

  <MessageContextMenu
    v-if="ctxMenu"
    :x="ctxMenu.x"
    :y="ctxMenu.y"
    @copy="copyMessage"
    @delete="deleteMessage"
  />
</template>
