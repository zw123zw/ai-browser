<script setup lang="ts">
import { computed } from 'vue';

defineEmits<{ (e: 'pick', text: string): void }>();

const SUGGESTIONS = [
  { icon: '⚡', title: '网页操作', desc: '滚动到页面底部' },
  { icon: '🎙️', title: '语音助手', desc: '帮我打开百度，搜索 AI 新闻' },
  { icon: '📄', title: '报告生成', desc: '给我输出一份 Vue3 的 Word 报告' },
  { icon: '📊', title: '内容分析', desc: '分析总结这个页面' },
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
  <div class="aib-chat-empty">
    <div class="aib-chat-empty-title">{{ greeting }}，今天聊点什么？</div>
    <div class="aib-chat-empty-tags">
      语音对话 · 网页自动化 · 智能翻译 · 智能笔记 · OCR 识别 · 报告生成
    </div>
    <div class="aib-suggestions">
      <button
        v-for="s in SUGGESTIONS"
        :key="s.title"
        class="aib-suggestion"
        @click="$emit('pick', s.desc)"
      >
        <span class="aib-suggestion-icon">{{ s.icon }}</span>
        <span class="aib-suggestion-text">
          <span class="aib-suggestion-title">{{ s.title }}</span>
          <span class="aib-suggestion-desc">{{ s.desc }}</span>
        </span>
      </button>
    </div>
  </div>
</template>
