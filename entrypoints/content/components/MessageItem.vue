<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import type { ChatMessage, Attachment } from '@/src/types';
import { renderMarkdown } from '@/src/utils/markdown';
import { Logger } from '@/src/utils/logger';
import {
  parseFileTags,
  downloadParsedFile,
  getFilesSummary,
  type ParsedFile,
} from '@/src/utils/file-tag-parser';
import { renderChartToElement, type ChartConfig } from '@/src/utils/echart-renderer';
import FileCard from './FileCard.vue';
import FilePreviewModal from './FilePreviewModal.vue';

const log = new Logger('MessageItem');

const props = defineProps<{ message: ChatMessage }>();
const emit = defineEmits<{
  (e: 'context-menu', payload: { message: ChatMessage; x: number; y: number }): void;
}>();

const isUser = computed(() => props.message.role === 'user');

// ============ 文件标签解析 ============

/** 解析 AI 回复中的文件标签 */
const parsedFiles = computed<ParsedFile[]>(() => {
  if (props.message.role !== 'assistant') return [];
  return parseFileTags(props.message.content);
});

/** 是否包含文件标签 */
const hasFiles = computed(() => parsedFiles.value.length > 0);

/** 文件摘要信息 */
const filesSummary = computed(() => getFilesSummary(parsedFiles.value));

// ============ 内容渲染 ============

/** 是否正在流式输出 */
const isStreaming = computed(() => props.message.status === 'streaming');

/** 去掉文件标签后的纯文本内容 */
const textWithoutFiles = computed(() => {
  if (!hasFiles.value) return props.message.content;
  // 移除所有 [FILE:xxx]...[/FILE] 标签（支持无闭合标签）
  return props.message.content.replace(/\[FILE:\s*[^\]]+\]\r?\n?[\s\S]*?(?:\[\/FILE\]|$)/gi, '').trim();
});

/** 渲染后的消息内容 */
const renderedContent = computed(() => {
  // 流式时显示原始内容（包括文件标签），完成后只显示纯文本
  const content = isStreaming.value ? props.message.content : textWithoutFiles.value;
  return renderMarkdown(content);
});

/** 渲染后的推理内容 */
const renderedReasoning = computed(() =>
  props.message.reasoning ? renderMarkdown(props.message.reasoning) : ''
);

// ============ 图片处理 ============

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

// ============ 文件预览 ============

/** 当前预览的附件 */
const previewAttachment = ref<Attachment | null>(null);

/** 打开用户上传文件的预览 */
function openPreview(att: Attachment) {
  log.info('打开预览', { name: att.name, type: att.type });
  previewAttachment.value = att;
}

/** 打开 AI 生成文件的预览 */
function openAiFilePreview(file: ParsedFile) {
  // 根据扩展名判断类型
  let type = 'text';
  if (file.extension === 'pdf') {
    type = 'pdf';
  } else if (file.extension === 'xlsx' || file.extension === 'xls') {
    type = 'excel';
  } else if (file.extension === 'docx' || file.extension === 'doc') {
    type = 'word';
  }

  const att: Attachment = {
    id: `ai-file-${file.index}`,
    name: file.filename,
    size: file.size,
    type: type as any,
    content: file.content,
    mimeType: getMimeType(file.extension),
  };
  log.info('打开 AI 文件预览', { name: file.filename, category: file.category, type });
  previewAttachment.value = att;
}

function closePreview() {
  previewAttachment.value = null;
}

/** 获取 MIME 类型 */
function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    md: 'text/markdown', txt: 'text/plain', html: 'text/html',
    json: 'application/json', csv: 'text/csv', pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return mimeTypes[ext] ?? 'text/plain';
}

/** 下载用户上传的文件 */
function downloadAttachment(att: Attachment) {
  log.info('下载用户文件', { name: att.name });
  // 如果有 dataUrl（图片），直接下载
  if (att.dataUrl) {
    const a = document.createElement('a');
    a.href = att.dataUrl;
    a.download = att.name;
    a.click();
    return;
  }
  // 如果有 content（文本），创建 Blob 下载
  if (att.content) {
    const blob = new Blob([att.content], { type: att.mimeType || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  log.warn('无法下载文件', { name: att.name, hasDataUrl: !!att.dataUrl, hasContent: !!att.content });
}

/** 下载 AI 生成的文件 */
function handleAiFileDownload(file: ParsedFile) {
  log.info('下载 AI 文件', { name: file.filename });
  downloadParsedFile(file);
}

// ============ 右键菜单 ============

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  emit('context-menu', { message: props.message, x: e.clientX, y: e.clientY });
}

// ============ 图表渲染 ============

/** 图表清理函数 Map */
const chartDisposers = ref<Map<number, () => void>>(new Map());

/** 渲染所有图表 */
async function renderCharts() {
  if (!hasFiles.value) return;

  await nextTick();

  for (const file of parsedFiles.value) {
    if (file.category === 'chart' && file.chartConfig) {
      const container = document.querySelector(
        `[data-chart-index="${file.index}"]`
      ) as HTMLElement;

      if (container) {
        try {
          const result = await renderChartToElement(container, file.chartConfig);
          if (result.success && result.dispose) {
            chartDisposers.value.set(file.index, result.dispose);
          } else {
            log.error('图表渲染失败', { file: file.filename, error: result.error });
            container.innerHTML = `<div class="aib-chart-error">图表渲染失败: ${result.error}</div>`;
          }
        } catch (error) {
          log.error('图表渲染异常', { file: file.filename, error });
          container.innerHTML = '<div class="aib-chart-error">图表渲染失败</div>';
        }
      }
    }
  }
}

/** 清理所有图表 */
function disposeCharts() {
  chartDisposers.value.forEach(dispose => dispose());
  chartDisposers.value.clear();
}

// 监听内容变化，重新渲染图表
watch(
  () => props.message.content,
  () => {
    disposeCharts();
    if (hasFiles.value) {
      renderCharts();
    }
  },
  { immediate: true }
);

// 组件卸载前清理图表
onBeforeUnmount(() => {
  disposeCharts();
});

// ============ 旧版表格下载（保留兼容） ============

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
  <div
    :class="['aib-msg-row', isUser ? 'aib-row-user' : 'aib-row-ai']"
    @click="(e) => { onTableDownload(e); onCodeCopy(e); }"
  >
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

      <!-- 文件附件（上传的文件） -->
      <div v-if="fileAttachments.length" class="aib-msg-files">
        <FileCard
          v-for="att in fileAttachments"
          :key="att.id"
          :attachment="att"
          @preview="() => openPreview(att)"
          @download="() => downloadAttachment(att)"
        />
      </div>

      <!-- 文本内容 -->
      <div
        v-if="message.content || !message.reasoning"
        class="aib-msg-text"
        v-html="renderedContent"
      />

      <!-- AI 生成的文件卡片 -->
      <div v-if="hasFiles" class="aib-msg-files">
        <FileCard
          v-for="file in parsedFiles"
          :key="file.index"
          :parsed-file="file"
          @preview="() => openAiFilePreview(file)"
          @download="() => handleAiFileDownload(file)"
        />
      </div>

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

<style scoped>
/* 图表错误提示 */
.aib-chart-error {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100px;
  padding: 16px;
  color: var(--aib-text-secondary, #6c757d);
  font-size: 13px;
  text-align: center;
}
</style>
