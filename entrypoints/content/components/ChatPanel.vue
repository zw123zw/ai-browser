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

async function onSend(payload: { text: string; images: string[]; reasoning: boolean }) {
  // 如果没有活跃会话，先创建一个
  if (!convStore.active) {
    convStore.createConversation();
  }
  const conv = convStore.active;
  if (!conv) return;
  const text = payload.reasoning
    ? `[请按深度思考的方式作答，先给出完整推理过程，再给出最终答案]\n\n${payload.text}`
    : payload.text;
  try {
    await convStore.send(conv.id, text, payload.images, payload.reasoning);
  } catch (e: any) {
    toast.error(e?.message || '发送失败');
  }
}

function onAbort() {
  if (!convStore.active) return;
  convStore.abort(convStore.active.id);
}

function onPick(text: string) {
  // 创建新会话并发送
  convStore.createConversation();
  setTimeout(() => {
    const conv = convStore.active;
    if (!conv) return;
    convStore.send(conv.id, text, [], false);
  }, 50);
}
</script>

<template>
  <div class="zwf-centered-panel">
    <div v-if="convStore.active" class="zwf-centered-body">
      <MessageList :conversation="convStore.active" />
    </div>
    <div v-else class="zwf-centered-welcome">
      <EmptyChat @pick="onPick" />
    </div>
    <footer class="zwf-centered-footer">
      <InputBar
        :conversation="convStore.active"
        :models="settingsStore.settings.models"
        @send="onSend"
        @abort="onAbort"
        @switch-voice="emit('switch-voice')"
      />
    </footer>
  </div>
</template>
