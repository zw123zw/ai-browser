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
  if (pipeline.waitingInputPrompt.value) {
    let inputText = payload.text;

    // 如果有附件，提取内容拼接到输入中
    if (payload.attachments.length > 0) {
      const fileContents = payload.attachments
        .filter(a => a.content)
        .map(a => `[文件: ${a.name}]\n${a.content}`)
        .join('\n\n');

      if (fileContents) {
        inputText = inputText
          ? `${inputText}\n\n${fileContents}`
          : fileContents;
      }
    }

    log.info('提供 AI 请求的输入', { text: inputText.slice(0, 100) });
    pipeline.provideInput(inputText);
    return;
  }

  // 构建用户消息（包括附件内容）
  let userMessage = payload.text;

  // 如果有附件，提取内容拼接到用户消息中
  if (payload.attachments.length > 0) {
    const fileContents = payload.attachments
      .filter(a => a.content)
      .map(a => `[文件: ${a.name}]\n${a.content}`)
      .join('\n\n');

    if (fileContents) {
      userMessage = userMessage
        ? `${userMessage}\n\n${fileContents}`
        : fileContents;
    }
  }

  // 深度思考 → 添加前缀
  if (payload.reasoning) {
    userMessage = `[请按深度思考的方式作答，先给出完整推理过程，再给出最终答案]\n\n${userMessage}`;
  }

  log.info('走流水线处理', { text: userMessage.slice(0, 100) });

  // 添加用户消息到会话
  // content 只存用户原文，不存附件内容（历史消息不带附件，避免占用过多 token）
  // attachments 存结构化元数据，供 UI 渲染文件卡片
  // userMessage（合并后的完整文本）只传给 processInput，当前轮次 AI 能看到
  convStore.conversation.messages.push({
    id: Date.now().toString(),
    role: 'user',
    content: payload.text,
    attachments: payload.attachments.length ? payload.attachments : undefined,
    timestamp: Date.now(),
    status: 'done',
    reasoningEnabled: payload.reasoning,
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
    await pipeline.processInput(userMessage, payload.reasoning);
  } catch (e: any) {
    toast.error(e?.message || '处理失败');
  }
}

async function onAbort() {
  convStore.abort();
  await pipeline.abort();
  // 停止自动笔记
  window.dispatchEvent(new CustomEvent('aib-stop-auto-note'));
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
