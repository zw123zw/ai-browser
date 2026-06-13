<script setup lang="ts">
import { computed } from 'vue';

defineEmits<{ (e: 'pick', text: string): void }>();

const SUGGESTIONS = [
  { icon: '✨', title: '帮我写代码', desc: '用 React 写一个 Todo 组件' },
  { icon: '📚', title: '解释概念', desc: '用通俗的话解释一下闭包' },
  { icon: '🌍', title: '翻译润色', desc: '把这段话翻成英文' },
  { icon: '🧠', title: '深度分析', desc: '帮我分析这个问题' },
];

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});
</script>

<template>
  <div class="zwf-chat-empty">
    <div class="zwf-chat-empty-title">{{ greeting }}，今天聊点什么？</div>
    <div class="zwf-chat-empty-desc">
      提问、写代码、分析图片、深度思考——直接输入或试试下面的提示
    </div>
    <div class="zwf-suggestions">
      <button
        v-for="s in SUGGESTIONS"
        :key="s.title"
        class="zwf-suggestion"
        @click="$emit('pick', s.desc)"
      >
        <span class="zwf-suggestion-icon">{{ s.icon }}</span>
        <span class="zwf-suggestion-text">
          <span class="zwf-suggestion-title">{{ s.title }}</span>
          <span class="zwf-suggestion-desc">{{ s.desc }}</span>
        </span>
      </button>
    </div>
  </div>
</template>
