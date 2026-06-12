<script setup lang="ts">
defineProps<{ x: number; y: number }>();
defineEmits<{
  (e: 'copy'): void;
  (e: 'delete'): void;
}>();
</script>

<template>
  <div
    class="zwf-ctx-menu"
    :style="{ left: x + 'px', top: y + 'px' }"
    @click.stop
    @mousedown.stop
    @contextmenu.prevent
  >
    <button class="zwf-ctx-item" @click="$emit('copy')">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      复制内容
    </button>
    <button class="zwf-ctx-item zwf-ctx-danger" @click="$emit('delete')">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
      删除
    </button>
  </div>
</template>
