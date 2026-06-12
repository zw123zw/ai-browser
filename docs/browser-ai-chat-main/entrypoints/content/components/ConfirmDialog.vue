<script setup lang="ts">
withDefaults(
  defineProps<{
    visible: boolean;
    title: string;
    desc?: string;
    confirmText?: string;
    cancelText?: string;
    variant?: 'danger' | 'primary';
  }>(),
  {
    desc: '',
    confirmText: '确认',
    cancelText: '取消',
    variant: 'primary',
  }
);

const emit = defineEmits<{
  (e: 'confirm'): void;
  (e: 'cancel'): void;
}>();
</script>

<template>
  <div v-if="visible" class="zwf-modal-mask">
    <div class="zwf-modal zwf-modal-confirm">
      <button class="zwf-modal-close" title="关闭" @click="emit('cancel')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div :class="['zwf-modal-icon', variant === 'danger' ? 'zwf-modal-icon-danger' : 'zwf-modal-icon-primary']">
        <slot name="icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </slot>
      </div>
      <div class="zwf-modal-title">{{ title }}</div>
      <div v-if="desc" class="zwf-modal-desc">{{ desc }}</div>
      <div class="zwf-modal-actions">
        <button class="zwf-btn" @click="emit('cancel')">{{ cancelText }}</button>
        <button
          :class="['zwf-btn', variant === 'danger' ? 'zwf-btn-danger' : 'zwf-btn-primary']"
          @click="emit('confirm')"
        >
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
