<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import type { Attachment } from '@/src/types';
import { getFileTypeIcon, formatFileSize } from '@/src/utils/file-type';
import { renderMarkdown } from '@/src/utils/markdown';
import hljs from 'highlight.js';

const props = defineProps<{ attachment: Attachment }>();
const emit = defineEmits<{ (e: 'close'): void }>();

/** 是否为文本/代码类可预览类型 */
const isTextPreview = computed(() =>
  ['text', 'code', 'pdf', 'word', 'excel'].includes(props.attachment.type) &&
  props.attachment.content &&
  !props.attachment.content.startsWith('[')
);

/** 高亮后的 HTML */
const highlightedContent = computed(() => {
  const content = props.attachment.content;
  if (!content) return '';

  if (props.attachment.type === 'text' && !props.attachment.lang) {
    // 纯文本：markdown 渲染
    return renderMarkdown('```\n' + content + '\n```');
  }

  if (props.attachment.lang) {
    // 代码：语法高亮
    try {
      const result = hljs.highlight(content, { language: props.attachment.lang });
      return `<pre class="hljs"><code>${result.value}</code></pre>`;
    } catch {
      // 语言不支持，自动检测
      try {
        const result = hljs.highlightAuto(content);
        return `<pre class="hljs"><code>${result.value}</code></pre>`;
      } catch {
        return `<pre><code>${escapeHtml(content)}</code></pre>`;
      }
    }
  }

  // PDF/Word/Excel 提取的文本
  return renderMarkdown('```\n' + content + '\n```');
});

/** 是否为图片预览 */
const isImagePreview = computed(() =>
  props.attachment.type === 'image' && props.attachment.dataUrl
);

/** 错误消息 */
const errorMessage = computed(() => {
  const content = props.attachment.content;
  if (content && content.startsWith('[') && content.endsWith(']')) {
    return content.slice(1, -1);
  }
  return null;
});

function onMaskClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('zwf-file-modal-mask')) {
    emit('close');
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

onMounted(() => document.addEventListener('keydown', onKeydown));
onUnmounted(() => document.removeEventListener('keydown', onKeydown));

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
</script>

<template>
  <div class="zwf-file-modal-mask" @click="onMaskClick">
    <div class="zwf-file-modal">
      <!-- 头部 -->
      <div class="zwf-file-modal-header">
        <div class="zwf-file-modal-info">
          <span class="zwf-file-modal-icon">{{ getFileTypeIcon(attachment.type) }}</span>
          <span class="zwf-file-modal-name">{{ attachment.name }}</span>
          <span class="zwf-file-modal-meta">{{ formatFileSize(attachment.size) }} · {{ attachment.mimeType }}</span>
        </div>
        <button class="zwf-file-modal-close" @click="emit('close')">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <!-- 内容区 -->
      <div class="zwf-file-modal-body">
        <!-- 图片预览 -->
        <div v-if="isImagePreview" class="zwf-file-modal-image">
          <img :src="attachment.dataUrl" />
        </div>

        <!-- 错误提示 -->
        <div v-else-if="errorMessage" class="zwf-file-modal-error">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p>{{ errorMessage }}</p>
        </div>

        <!-- 文本/代码预览 -->
        <div v-else-if="isTextPreview" class="zwf-file-modal-text" v-html="highlightedContent" />

        <!-- 截断提示 -->
        <div v-if="isTextPreview && attachment.truncated" class="zwf-file-modal-truncated">
          ⚠️ 内容过长，已截断至 100KB。完整内容已发送给 AI 分析。
        </div>

        <!-- 无内容 -->
        <div v-else class="zwf-file-modal-error">
          <p>此文件类型无法预览内容</p>
        </div>
      </div>
    </div>
  </div>
</template>
