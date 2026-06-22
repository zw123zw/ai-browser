<script setup lang="ts">
import { computed, ref, nextTick } from 'vue';
import { useConversationsStore } from '@/src/stores/conversations';
import { useSettingsStore } from '@/src/stores/settings';
import { useToast } from '@/src/composables/useToast';
import { usePipeline } from '@/src/composables/usePipeline';
import { pushInputHistory } from '@/src/storage/input-history';
import { Logger } from '@/src/utils/logger';
import type { Attachment } from '@/src/types';
import MessageList from './MessageList.vue';
import InputBar from './InputBar.vue';
import EmptyChat from './EmptyChat.vue';
import FilePreviewModal from './FilePreviewModal.vue';

const log = new Logger('ChatPanel');
const emit = defineEmits<{ (e: 'switch-voice'): void }>();

const convStore = useConversationsStore();
const settingsStore = useSettingsStore();
const toast = useToast();
const pipeline = usePipeline();
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

  // 先滚动到底部
  messageListRef.value?.jumpToBottom();

  // AI 正在等待用户输入 → 提供输入继续执行
  if (pipeline.waitingInputPrompt.value && !payload.attachments.length && !payload.reasoning) {
    log.info('提供 AI 请求的输入', { text: payload.text.slice(0, 50) });
    pipeline.provideInput(payload.text);
    return;
  }

  // 纯文本（无附件、无深度思考）→ 走流水线（指令检测）
  if (!payload.attachments.length && !payload.reasoning) {
    log.info('走流水线处理', { text: payload.text.slice(0, 50) });
    // 添加用户消息到会话
    convStore.conversation.messages.push({
      id: Date.now().toString(),
      role: 'user',
      content: payload.text,
      timestamp: Date.now(),
      status: 'done',
    });
    convStore.conversation.updatedAt = Date.now();
    if (convStore.conversation.title === '新对话') {
      convStore.conversation.title = payload.text.slice(0, 20);
    }
    // 记录输入历史（跳过纯文件消息）
    if (payload.text.trim()) {
      pushInputHistory(payload.text.trim());
    }

    try {
      await pipeline.processInput(payload.text);
    } catch (e: any) {
      toast.error(e?.message || '处理失败');
    }
    return;
  }

  // 有附件或深度思考 → 走普通 LLM 聊天
  const text = payload.reasoning
    ? `[请按深度思考的方式作答，先给出完整推理过程，再给出最终答案]\n\n${payload.text}`
    : payload.text;
  try {
    await convStore.send(text, payload.attachments, payload.reasoning);
  } catch (e: any) {
    toast.error(e?.message || '发送失败');
  }
}

async function onAbort() {
  convStore.abort();
  await pipeline.abort();
}

async function onPick(text: string) {
  // 直接发送建议文本到当前会话（走流水线）
  if (!convStore.conversation) return;
  // 添加用户消息到会话
  convStore.conversation.messages.push({
    id: Date.now().toString(),
    role: 'user',
    content: text,
    timestamp: Date.now(),
    status: 'done',
  });
  convStore.conversation.updatedAt = Date.now();
  if (text.trim()) {
    pushInputHistory(text.trim());
  }
  try {
    await pipeline.processInput(text);
  } catch (e: any) {
    toast.error(e?.message || '处理失败');
  }
}

function scrollToBottom() {
  messageListRef.value?.jumpToBottom();
}
</script>

<template>
  <div class="aib-centered-panel">
    <div v-if="hasMessages" class="aib-centered-body">
      <MessageList ref="messageListRef" :conversation="convStore.conversation!" />
      <!-- 回到底部按钮 -->
      <transition name="aib-fade">
        <button
          v-if="showScrollBottom"
          class="aib-scroll-bottom-btn"
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
    <div v-else class="aib-centered-welcome">
      <EmptyChat @pick="onPick" />
    </div>
    <footer class="aib-centered-footer">
      <InputBar
        :conversation="convStore.conversation"
        :models="settingsStore.settings.models"
        :is-processing="pipeline.isProcessing.value"
        :waiting-input-prompt="pipeline.waitingInputPrompt.value"
        :automation-enabled="settingsStore.settings.automationEnabled !== false"
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
