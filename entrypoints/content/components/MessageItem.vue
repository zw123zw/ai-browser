<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ChatMessage, Attachment } from '@/src/types';
import { renderMarkdown } from '@/src/utils/markdown';
import { getFileTypeIcon, formatFileSize } from '@/src/utils/file-type';
import { Logger } from '@/src/utils/logger';
import FilePreviewModal from './FilePreviewModal.vue';

const log = new Logger('MessageItem');

const props = defineProps<{ message: ChatMessage }>();
const emit = defineEmits<{
  (e: 'context-menu', payload: { message: ChatMessage; x: number; y: number }): void;
}>();

const isUser = computed(() => props.message.role === 'user');

const renderedContent = computed(() => renderMarkdown(props.message.content));
const renderedReasoning = computed(() =>
  props.message.reasoning ? renderMarkdown(props.message.reasoning) : ''
);

/** 消息中的图片（从 attachments 获取） */
const allImages = computed(() => {
  if (!props.message.attachments?.length) return [];
  return props.message.attachments
    .filter(a => a.type === 'image' && a.dataUrl)
    .map(a => a.dataUrl!);
});

/** 非图片附件 */
const fileAttachments = computed(() => {
  if (!props.message.attachments?.length) return [];
  return props.message.attachments.filter(a => a.type !== 'image');
});

/** 当前预览的附件 */
const previewAttachment = ref<Attachment | null>(null);

function openPreview(att: Attachment) {
  log.info('打开预览', { name: att.name, type: att.type, hasDataUrl: !!att.dataUrl, hasContent: !!att.content });
  previewAttachment.value = att;
}

function closePreview() {
  previewAttachment.value = null;
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  emit('context-menu', { message: props.message, x: e.clientX, y: e.clientY });
}

/** 下载表格为 Excel */
async function onTableDownload(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('.aib-table-download-btn');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  const wrapper = btn.closest('.aib-table-wrapper');
  const table = wrapper?.querySelector('table');
  if (!table) return;

  // 从 DOM 提取表格数据
  const rows: string[][] = [];
  for (const tr of table.querySelectorAll('tr')) {
    const cells: string[] = [];
    for (const cell of tr.querySelectorAll('th, td')) {
      cells.push(cell.textContent?.trim() ?? '');
    }
    rows.push(cells);
  }

  if (!rows.length) return;

  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'table.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

/** 复制代码块内容 */
function onCodeCopy(e: MouseEvent) {
  const btn = (e.target as HTMLElement).closest('.aib-code-copy-btn');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  const wrapper = btn.closest('.aib-code-wrapper');
  const code = wrapper?.querySelector('code');
  if (!code) return;

  const text = code.textContent ?? '';
  navigator.clipboard.writeText(text).then(() => {
    // 切换为勾图标，1.5s 后恢复
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
    btn.classList.add('aib-code-copy-btn--copied');
    setTimeout(() => {
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      btn.classList.remove('aib-code-copy-btn--copied');
    }, 1500);
  });
}
</script>

<template>
  <div :class="['aib-msg-row', isUser ? 'aib-row-user' : 'aib-row-ai']" @click="(e) => { onTableDownload(e); onCodeCopy(e) }">
    <div
      :class="['aib-msg', isUser ? 'aib-bubble-user' : 'aib-bubble-ai']"
      @contextmenu="onContextMenu"
    >
      <!-- 思考块（仅在用户开启深度思考时展示） -->
      <div v-if="message.reasoningEnabled && message.reasoning" class="aib-reasoning">
        <div class="aib-reasoning-title">💭 深度思考</div>
        <div class="aib-msg-text" v-html="renderedReasoning" />
      </div>

      <!-- 多模态：图片 -->
      <div v-if="allImages.length" class="aib-msg-images">
        <img
          v-for="(src, i) in allImages"
          :key="i"
          :src="src"
          class="aib-msg-image"
          @click="openPreview({ id: `img-${i}`, type: 'image', name: `图片 ${i + 1}`, size: 0, mimeType: 'image/png', dataUrl: src })"
        />
      </div>

      <!-- 文件附件 -->
      <div v-if="fileAttachments.length" class="aib-msg-files">
        <div
          v-for="att in fileAttachments"
          :key="att.id"
          class="aib-msg-file-chip"
          @click="openPreview(att)"
        >
          <span class="aib-msg-file-icon">{{ getFileTypeIcon(att.type) }}</span>
          <span class="aib-msg-file-name">{{ att.name }}</span>
          <span v-if="att.truncated" class="aib-msg-file-truncated" title="内容已截断">⚠️</span>
          <span class="aib-msg-file-size">{{ formatFileSize(att.size) }}</span>
        </div>
      </div>

      <!-- 文本内容 -->
      <div
        v-if="message.content || !message.reasoning"
        class="aib-msg-text"
        v-html="renderedContent"
      />

      <!-- 状态 -->
      <div v-if="message.status === 'streaming'" class="aib-typing">
        <span /><span /><span />
      </div>
      <div v-else-if="message.status === 'error'" class="aib-msg-banner aib-banner-error">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{{ message.errorMessage || '请求失败' }}</span>
      </div>
      <div v-else-if="message.status === 'aborted'" class="aib-msg-banner aib-banner-warning">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
        <span>已停止生成</span>
      </div>
    </div>

    <!-- 文件预览 Modal -->
    <FilePreviewModal
      v-if="previewAttachment"
      :attachment="previewAttachment"
      @close="closePreview"
    />
  </div>
</template>
