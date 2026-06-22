<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '@/src/i18n';

defineEmits<{ (e: 'pick', text: string): void }>();

const { t, locale } = useI18n();

const SUGGESTIONS = computed(() => [
  { icon: '⚡', title: t('emptyChat.suggestions.automation.title'), desc: t('emptyChat.suggestions.automation.desc') },
  { icon: '🎙️', title: t('emptyChat.suggestions.voice.title'), desc: t('emptyChat.suggestions.voice.desc') },
  { icon: '📄', title: t('emptyChat.suggestions.report.title'), desc: t('emptyChat.suggestions.report.desc') },
  { icon: '📊', title: t('emptyChat.suggestions.analysis.title'), desc: t('emptyChat.suggestions.analysis.desc') },
]);

const greeting = computed(() => {
  const h = new Date().getHours();
  let key: string;
  if (h < 6) key = 'night';
  else if (h < 12) key = 'morning';
  else if (h < 14) key = 'noon';
  else if (h < 18) key = 'afternoon';
  else key = 'evening';
  return t(`emptyChat.greeting.${key}`);
});
</script>

<template>
  <div class="aib-chat-empty">
    <div class="aib-chat-empty-brand">
      <div class="aib-chat-empty-name">{{ t('app.name') }}</div>
      <div class="aib-chat-empty-subtitle">{{ t('app.subtitle') }}</div>
    </div>
    <div class="aib-chat-empty-title">{{ greeting }}，{{ t('emptyChat.prompt') }}</div>
    <div class="aib-chat-empty-tags">
      {{ t('emptyChat.tags') }}
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
