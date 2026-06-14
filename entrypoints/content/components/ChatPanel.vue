<script setup lang="ts">
import { computed, ref, nextTick } from 'vue';
import { useConversationsStore } from '@/src/stores/conversations';
import { useSettingsStore } from '@/src/stores/settings';
import { useToast } from '@/src/composables/useToast';
import type { Attachment } from '@/src/types';
import MessageList from './MessageList.vue';
import InputBar from './InputBar.vue';
import EmptyChat from './EmptyChat.vue';
import FilePreviewModal from './FilePreviewModal.vue';

const emit = defineEmits<{ (e: 'switch-voice'): void }>();

const convStore = useConversationsStore();
const settingsStore = useSettingsStore();
const toast = useToast();
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null);

/** InputBar 文件预览（渲染在滚动容器外部，fixed 定位正常） */
const previewAttachment = ref<Attachment | null>(null);

function onPreview(att: Attachment) {
  previewAttachment.value = att;
}

function closePreview() {
  previewAttachment.value = null;
}

/** 会话是否存在且有消息 */
const hasMessages = computed(() => {
  return convStore.conversation && convStore.conversation.messages.length > 0;
});

/** 是否显示回到底部按钮 */
const showScrollBottom = computed(() => {
  return messageListRef.value?.showScrollBottom ?? false;
});

async function onSend(payload: { text: string; attachments: import('@/src/types').Attachment[]; reasoning: boolean }) {
  if (!convStore.conversation) return;
  const text = payload.reasoning
    ? `[请按深度思考的方式作答，先给出完整推理过程，再给出最终答案]\n\n${payload.text}`
    : payload.text;
  try {
    // 先滚动到底部，再发送消息
    messageListRef.value?.jumpToBottom();
    await convStore.send(text, payload.attachments, payload.reasoning);
  } catch (e: any) {
    toast.error(e?.message || '发送失败');
  }
}

function onAbort() {
  convStore.abort();
}

function onPick(text: string) {
  // 直接发送建议文本到当前会话
  if (!convStore.conversation) return;
  convStore.send(text, [], false);
}

function scrollToBottom() {
  messageListRef.value?.jumpToBottom();
}
</script>

<template>
  <div class="zwf-centered-panel">
    <div v-if="hasMessages" class="zwf-centered-body">
      <MessageList ref="messageListRef" :conversation="convStore.conversation!" />
      <!-- 回到底部按钮 -->
      <transition name="zwf-fade">
        <button
          v-if="showScrollBottom"
          class="zwf-scroll-bottom-btn"
          title="滚动到底部"
          @click="scrollToBottom"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <polyline points="19 12 12 19 5 12" />
          </svg>
        </button>
      </transition>
    </div>
    <div v-else class="zwf-centered-welcome">
      <EmptyChat @pick="onPick" />
    </div>
    <footer class="zwf-centered-footer">
      <InputBar
        :conversation="convStore.conversation"
        :models="settingsStore.settings.models"
        @send="onSend"
        @abort="onAbort"
        @switch-voice="emit('switch-voice')"
        @preview="onPreview"
      />
    </footer>

    <!-- InputBar 文件预览（渲染在 ChatPanel 级别，fixed 定位正常） -->
    <FilePreviewModal
      v-if="previewAttachment"
      :attachment="previewAttachment"
      @close="closePreview"
    />
  </div>
</template>
