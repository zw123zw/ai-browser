<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import type { Attachment } from '@/src/types';
import { getFileTypeIcon, formatFileSize, getExtension } from '@/src/utils/file-type';
import { renderMarkdown } from '@/src/utils/markdown';
import { getOriginalFile } from '@/src/utils/file-parsers';
import hljs from 'highlight.js';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { jsPDF } from 'jspdf';

const props = defineProps<{ attachment: Attachment }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const isTextPreview = computed(() =>
  ['text', 'code', 'pdf', 'word', 'excel'].includes(props.attachment.type) &&
  props.attachment.content
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
  if (!content || !content.startsWith('[') || !content.endsWith(']')) return null;
  // 只匹配文件解析器的错误标记，不匹配日志内容如 [2026-06-18 xxx]
  const inner = content.slice(1, -1);
  if (/解析失败|无可提取|无数据|不支持预览/.test(inner)) {
    return inner;
  }
  return null;
});

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

/** 文本白名单：content 即原始内容，保持原扩展名（getExtension 返回不带点号） */
const TEXT_EXTENSIONS = new Set([
  'json', 'csv', 'tsv', 'md', 'txt', 'html', 'htm', 'xml', 'yaml', 'yml',
  'ini', 'env', 'log', 'cfg', 'conf', 'toml',
  'py', 'js', 'ts', 'jsx', 'tsx', 'java', 'go', 'rs', 'rb', 'php',
  'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'scala',
  'sh', 'bash', 'zsh', 'bat', 'ps1',
  'css', 'scss', 'less', 'sql', 'graphql'
]);

/** dataUrl base64 转 Blob */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] ?? 'application/octet-stream';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** 用 xlsx 库从 content 生成 .xlsx */
function downloadAsXlsx(content: string, name: string) {
  let ws: XLSX.WorkSheet;
  if (content.includes('\t')) {
    ws = XLSX.utils.aoa_to_sheet(content.split('\n').map(row => row.split('\t')));
  } else if (content.includes('|')) {
    const rows = content.split('\n')
      .filter(row => row.trim() && !/^[\s|:-]+$/.test(row))
      .map(row => row.split('|').map(cell => cell.trim()).filter(Boolean));
    ws = XLSX.utils.aoa_to_sheet(rows);
  } else {
    ws = XLSX.utils.aoa_to_sheet(content.split('\n').map(row => [row]));
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const xlsxData = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([xlsxData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(URL.createObjectURL(blob), name);
}

/** 用 docx 库从 content 生成 .docx */
async function downloadAsDocx(content: string, name: string) {
  const paragraphs = content.split('\n').map(line =>
    new Paragraph({ children: [new TextRun(line)] })
  );
  const doc = new Document({ sections: [{ children: paragraphs }] });
  const blob = await Packer.toBlob(doc);
  triggerDownload(URL.createObjectURL(blob), name);
}

/** 用 jspdf 库从 content 生成 .pdf */
function downloadAsPdf(content: string, name: string) {
  const doc = new jsPDF();
  const lines = doc.splitTextToSize(content, 180);
  doc.text(lines, 10, 10);
  const blob = doc.output('blob');
  triggerDownload(URL.createObjectURL(blob), name);
}

/** 下载文件：优先级从高到低 */
function downloadFile() {
  const { attachment } = props;

  // 1. 原始 File（当前会话）
  const file = getOriginalFile(attachment);
  if (file) {
    triggerDownload(URL.createObjectURL(file), file.name);
    return;
  }

  // 2. 图片 dataUrl（刷新后仍在）
  if (attachment.type === 'image' && attachment.dataUrl) {
    const blob = dataUrlToBlob(attachment.dataUrl);
    triggerDownload(URL.createObjectURL(blob), attachment.name);
    return;
  }

  const content = attachment.content;
  if (!content || content.startsWith('[')) return;

  const ext = getExtension(attachment.name);

  // 3. 文本白名单
  if (TEXT_EXTENSIONS.has(ext)) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    triggerDownload(URL.createObjectURL(blob), attachment.name);
    return;
  }

  // 4. xlsx
  if (ext === 'xlsx' || ext === 'xls') {
    downloadAsXlsx(content, attachment.name);
    return;
  }

  // 5. docx
  if (ext === 'docx' || ext === 'doc') {
    downloadAsDocx(content, attachment.name);
    return;
  }

  // 6. pdf
  if (ext === 'pdf') {
    downloadAsPdf(content, attachment.name);
    return;
  }

  // 7. 兜底 .txt
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const name = attachment.name.replace(/\.[^.]+$/, '') + '.txt';
  triggerDownload(URL.createObjectURL(blob), name);
}

function triggerDownload(url: string, name: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="aib-file-modal-mask" @mousedown.self="emit('close')">
    <div class="aib-file-modal">
      <div class="aib-file-modal-header">
        <div class="aib-file-modal-info">
          <span class="aib-file-modal-icon">{{ getFileTypeIcon(attachment.type) }}</span>
          <div class="aib-file-modal-text-wrap">
            <span class="aib-file-modal-name">{{ attachment.name }}</span>
            <span class="aib-file-modal-meta">{{ formatFileSize(attachment.size) }}</span>
          </div>
        </div>
        <button class="aib-file-modal-download" @click="downloadFile" title="下载原始文件">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        <button class="aib-file-modal-close" @click="emit('close')" title="关闭 (Esc)">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="aib-file-modal-body">
        <div v-if="isImagePreview" class="aib-file-modal-image">
          <img :src="attachment.dataUrl" :alt="attachment.name" />
        </div>
        <div v-else-if="errorMessage" class="aib-file-modal-error">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p>{{ errorMessage }}</p>
        </div>
        <div v-else-if="isTextPreview" class="aib-file-modal-text" v-html="highlightedContent" />
        <div v-else class="aib-file-modal-error">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <p>此文件类型无法预览内容</p>
        </div>
      </div>

      <div v-if="isTextPreview && attachment.truncated" class="aib-file-modal-truncated">
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
