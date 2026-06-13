<script setup lang="ts">
import { computed } from 'vue';
import { useConversationsStore } from '@/src/stores/conversations';
import { useSettingsStore } from '@/src/stores/settings';
import { useToast } from '@/src/composables/useToast';
import MessageList from './MessageList.vue';
import InputBar from './InputBar.vue';
import EmptyChat from './EmptyChat.vue';

const emit = defineEmits<{ (e: 'switch-voice'): void }>();

const convStore = useConversationsStore();
const settingsStore = useSettingsStore();
const toast = useToast();

/** 会话是否存在且有消息 */
const hasMessages = computed(() => {
  return convStore.conversation && convStore.conversation.messages.length > 0;
});

async function onSend(payload: { text: string; images: string[]; reasoning: boolean }) {
  console.log('[ChatPanel] onSend 收到', { text: payload.text.slice(0, 50), hasImages: payload.images.length > 0, reasoning: payload.reasoning });
  if (!convStore.conversation) {
    console.error('[ChatPanel] 无会话');
    return;
  }
  const text = payload.reasoning
    ? `[请按深度思考的方式作答，先给出完整推理过程，再给出最终答案]\n\n${payload.text}`
    : payload.text;
  try {
    await convStore.send(text, payload.images, payload.reasoning);
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
</script>

<template>
  <div class="zwf-centered-panel">
    <div v-if="hasMessages" class="zwf-centered-body">
      <MessageList :conversation="convStore.conversation!" />
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
      />
    </footer>
  </div>
</template>
