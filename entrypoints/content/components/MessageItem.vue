<script setup lang="ts">
import { computed } from 'vue';
import type { ChatMessage } from '@/src/types';
import { renderMarkdown } from '@/src/utils/markdown';

const props = defineProps<{ message: ChatMessage }>();
const emit = defineEmits<{
  (e: 'context-menu', payload: { message: ChatMessage; x: number; y: number }): void;
}>();

const isUser = computed(() => props.message.role === 'user');

const renderedContent = computed(() => renderMarkdown(props.message.content));
const renderedReasoning = computed(() =>
  props.message.reasoning ? renderMarkdown(props.message.reasoning) : ''
);

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  emit('context-menu', { message: props.message, x: e.clientX, y: e.clientY });
}
</script>

<template>
  <div :class="['zwf-msg-row', isUser ? 'zwf-row-user' : 'zwf-row-ai']">
    <div
      :class="['zwf-msg', isUser ? 'zwf-bubble-user' : 'zwf-bubble-ai']"
      @contextmenu="onContextMenu"
    >
      <!-- 思考块（仅在用户开启深度思考时展示） -->
      <div v-if="message.reasoningEnabled && message.reasoning" class="zwf-reasoning">
        <div class="zwf-reasoning-title">💭 深度思考</div>
        <div class="zwf-msg-text" v-html="renderedReasoning" />
      </div>

      <!-- 多模态：图片 -->
      <div v-if="message.images?.length" class="zwf-msg-images">
        <img
          v-for="(src, i) in message.images"
          :key="i"
          :src="src"
          class="zwf-msg-image"
        />
      </div>

      <!-- 文本内容 -->
      <div
        v-if="message.content || !message.reasoning"
        class="zwf-msg-text"
        v-html="renderedContent"
      />

      <!-- 状态 -->
      <div v-if="message.status === 'streaming'" class="zwf-typing">
        <span /><span /><span />
      </div>
      <div v-else-if="message.status === 'error'" class="zwf-msg-banner zwf-banner-error">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{{ message.errorMessage || '请求失败' }}</span>
      </div>
      <div v-else-if="message.status === 'aborted'" class="zwf-msg-banner zwf-banner-warning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
        <span>已停止生成</span>
      </div>
    </div>
  </div>
</template>
