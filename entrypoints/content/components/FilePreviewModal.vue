<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import type { Attachment } from '@/src/types';
import { getFileTypeIcon, formatFileSize } from '@/src/utils/file-type';
import { renderMarkdown } from '@/src/utils/markdown';
import hljs from 'highlight.js';

const props = defineProps<{ attachment: Attachment }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const isTextPreview = computed(() =>
  ['text', 'code', 'pdf', 'word', 'excel'].includes(props.attachment.type) &&
  props.attachment.content &&
  !props.attachment.content.startsWith('[')
);

const highlightedContent = computed(() => {
  const content = props.attachment.content;
  if (!content) return '';

  if (props.attachment.type === 'text' && !props.attachment.lang) {
    return renderMarkdown('```\n' + content + '\n```');
  }

  if (props.attachment.lang) {
    try {
      const result = hljs.highlight(content, { language: props.attachment.lang });
      return `<pre class="hljs"><code>${result.value}</code></pre>`;
    } catch {
      try {
        const result = hljs.highlightAuto(content);
        return `<pre class="hljs"><code>${result.value}</code></pre>`;
      } catch {
        return `<pre><code>${escapeHtml(content)}</code></pre>`;
      }
    }
  }

  return renderMarkdown('```\n' + content + '\n```');
});

const isImagePreview = computed(() =>
  props.attachment.type === 'image' && props.attachment.dataUrl
);

const errorMessage = computed(() => {
  const content = props.attachment.content;
  if (content && content.startsWith('[') && content.endsWith(']')) {
    return content.slice(1, -1);
  }
  return null;
});

function onMaskClick(e: MouseEvent) {
  // 点击遮罩层关闭（只有点击 mask 本身才触发）
  if (e.target === e.currentTarget) {
    emit('close');
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    emit('close');
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown, true));
onUnmounted(() => document.removeEventListener('keydown', onKeydown, true));

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
</script>

<template>
  <div class="zwf-file-modal-mask" @mousedown.self="emit('close')">
    <div class="zwf-file-modal">
      <div class="zwf-file-modal-header">
        <div class="zwf-file-modal-info">
          <span class="zwf-file-modal-icon">{{ getFileTypeIcon(attachment.type) }}</span>
          <div class="zwf-file-modal-text-wrap">
            <span class="zwf-file-modal-name">{{ attachment.name }}</span>
            <span class="zwf-file-modal-meta">{{ formatFileSize(attachment.size) }}</span>
          </div>
        </div>
        <button class="zwf-file-modal-close" @click="emit('close')" title="关闭 (Esc)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="zwf-file-modal-body">
        <div v-if="isImagePreview" class="zwf-file-modal-image">
          <img :src="attachment.dataUrl" :alt="attachment.name" />
        </div>
        <div v-else-if="errorMessage" class="zwf-file-modal-error">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p>{{ errorMessage }}</p>
        </div>
        <div v-else-if="isTextPreview" class="zwf-file-modal-text" v-html="highlightedContent" />
        <div v-else class="zwf-file-modal-error">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <p>此文件类型无法预览内容</p>
        </div>
      </div>

      <div v-if="isTextPreview && attachment.truncated" class="zwf-file-modal-truncated">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span>内容过长，已截断至 100KB。完整内容已发送给 AI。</span>
      </div>
    </div>
  </div>
</template>
