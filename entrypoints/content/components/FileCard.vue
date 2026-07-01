<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { Attachment } from '@/src/types';
import type { ParsedFile, FileCategory } from '@/src/utils/file-tag-parser';
import { getFileTypeIcon, formatFileSize, getCodeLang } from '@/src/utils/file-type';
import { getFileIcon } from '@/src/utils/file-tag-parser';
import { formatBytes } from '@/src/utils/file-generators';
import { renderChartToElement } from '@/src/utils/echart-renderer';
import { renderMarkdownPlain } from '@/src/utils/markdown';
import { Logger } from '@/src/utils/logger';

const log = new Logger('FileCard');

const props = defineProps<{
  /** 用户上传的文件 */
  attachment?: Attachment;
  /** AI 生成的文件 */
  parsedFile?: ParsedFile;
  /** 是否处于生成中 loading 状态 */
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'preview'): void;
  (e: 'download'): void;
  (e: 'download-png'): void;
  (e: 'download-config'): void;
}>();

// ============ 基础信息 ============

/** 文件名 */
const fileName = computed(() =>
  props.attachment?.name ?? props.parsedFile?.filename ?? ''
);

/** 文件扩展名（不含点号） */
const fileExt = computed(() => {
  const name = fileName.value;
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : '';
});

/** 文件大小 */
const fileSize = computed(() => {
  if (props.attachment) return formatFileSize(props.attachment.size);
  if (props.parsedFile) return formatBytes(props.parsedFile.size);
  return '';
});

/** 文件图标 */
const fileIcon = computed(() => {
  if (props.attachment) return getFileTypeIcon(props.attachment.type);
  if (props.parsedFile) return getFileIcon(props.parsedFile);
  return '📄';
});

/** 文件类型分类（统一映射到色条类别） */
type ColorCategory = 'doc' | 'code' | 'data' | 'chart' | 'other';

const colorCategory = computed<ColorCategory>(() => {
  // AI 生成文件
  if (props.parsedFile) {
    const cat = props.parsedFile.category;
    if (cat === 'chart') return 'chart';
    if (cat === 'excel' || cat === 'data') return 'data';
    if (cat === 'pdf') return 'doc';
    // text 类：区分代码和文档
    const ext = props.parsedFile.extension;
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'vue', 'html', 'css', 'sh', 'sql'].includes(ext)) return 'code';
    return 'doc';
  }
  // 用户上传文件
  if (props.attachment) {
    const type = props.attachment.type;
    if (type === 'code') return 'code';
    if (type === 'excel') return 'data';
    if (type === 'image') return 'other';
    return 'doc';
  }
  return 'other';
});

/** 文件类型描述文字 */
const fileTypeLabel = computed(() => {
  const ext = fileExt.value;
  const labels: Record<string, string> = {
    // 文档
    md: 'Markdown 文档', txt: '文本文件', docx: 'Word 文档', doc: 'Word 文档',
    pdf: 'PDF 文档',
    // 表格
    xlsx: 'Excel 表格', xls: 'Excel 表格', csv: 'CSV 数据', tsv: 'TSV 数据',
    // 代码/标记
    js: 'JavaScript', ts: 'TypeScript', jsx: 'React JSX', tsx: 'React TSX',
    py: 'Python 脚本', java: 'Java 代码', go: 'Go 代码', rs: 'Rust 代码',
    vue: 'Vue 组件', html: 'HTML 页面', css: 'CSS 样式', sh: 'Shell 脚本',
    sql: 'SQL 脚本', json: 'JSON 数据', yaml: 'YAML 配置', yml: 'YAML 配置',
    // 图表
    chart: 'ECharts 图表',
  };
  if (props.parsedFile?.category === 'chart') return 'ECharts 图表';
  return labels[ext] ?? '文件';
});

/** 是否为图表类型 */
const isChart = computed(() => props.parsedFile?.category === 'chart');

/** 是否截断 */
const isTruncated = computed(() => props.attachment?.truncated ?? false);

// ============ 预览内容 ============

/** 是否有文本预览（代码/文档） */
const hasTextPreview = computed(() => {
  if (props.loading) return false;
  if (props.parsedFile) {
    return ['text', 'json'].includes(props.parsedFile.category) && props.parsedFile.category !== 'chart';
  }
  if (props.attachment) {
    return ['text', 'code'].includes(props.attachment.type) && !!props.attachment.content;
  }
  return false;
});

/** 预览文本（截取前若干行） */
const previewText = computed(() => {
  if (!hasTextPreview.value) return '';
  const content = props.parsedFile?.content ?? props.attachment?.content ?? '';
  return content.slice(0, 800);
});

/** 是否为代码类型预览 */
const isCodePreview = computed(() => {
  if (props.parsedFile) {
    return ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'vue', 'html', 'css', 'sh', 'sql'].includes(props.parsedFile.extension);
  }
  return props.attachment?.type === 'code';
});

/** 代码语言 */
const codeLang = computed(() => {
  if (props.parsedFile) return getCodeLang(props.parsedFile.filename);
  if (props.attachment) return props.attachment.lang;
  return undefined;
});

// ============ 图表渲染 ============

const chartContainer = ref<HTMLElement | null>(null);
let chartInstance: any = null;
let chartDisposer: (() => void) | null = null;
let resizeObserver: ResizeObserver | null = null;

async function renderChart() {
  if (!isChart.value || !props.parsedFile?.chartConfig || !chartContainer.value) return;
  await nextTick();
  try {
    const result = await renderChartToElement(chartContainer.value, props.parsedFile.chartConfig);
    if (result.success && result.dispose) {
      chartInstance = result.chart;
      chartDisposer = result.dispose;
    } else {
      log.error('图表渲染失败', { error: result.error });
      chartContainer.value.innerHTML = `<div class="aib-inlinecard-chart-error">图表渲染失败: ${result.error}</div>`;
    }
  } catch (error) {
    log.error('图表渲染异常', { error });
    chartContainer.value.innerHTML = '<div class="aib-inlinecard-chart-error">图表渲染失败</div>';
  }
}

function disposeChart() {
  if (chartDisposer) {
    chartDisposer();
    chartDisposer = null;
    chartInstance = null;
  }
}

function setupResizeObserver() {
  if (!chartContainer.value) return;
  resizeObserver = new ResizeObserver(() => {
    if (chartInstance) chartInstance.resize();
  });
  resizeObserver.observe(chartContainer.value);
}

watch(
  () => props.parsedFile?.chartConfig,
  () => { disposeChart(); renderChart(); },
  { immediate: true }
);

onMounted(() => {
  renderChart();
  setupResizeObserver();
});

onBeforeUnmount(() => {
  disposeChart();
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

// ============ 操作按钮 ============

function handlePreview(e: MouseEvent) {
  e.stopPropagation();
  emit('preview');
}

function handleDownload(e: MouseEvent) {
  e.stopPropagation();
  emit('download');
}

function handleDownloadPng(e: MouseEvent) {
  e.stopPropagation();
  if (!chartInstance) return;
  try {
    const dataUrl = chartInstance.getDataURL({
      type: 'png', pixelRatio: 2, backgroundColor: '#ffffff',
    });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = props.parsedFile?.filename?.replace(/\.chart$/i, '.png') || 'chart.png';
    link.click();
  } catch (error) {
    log.error('下载图表 PNG 失败', { error });
  }
}

function handleDownloadConfig(e: MouseEvent) {
  e.stopPropagation();
  emit('download-config');
}
</script>

<template>
  <!-- Loading 状态：生成中占位条 -->
  <div v-if="loading" class="aib-inlinecard aib-inlinecard--loading">
    <div class="aib-inlinecard-loading-bar">
      <div class="aib-inlinecard-loading-spinner" />
      <span class="aib-inlinecard-loading-text">正在生成文件...</span>
      <div class="aib-inlinecard-loading-dots">
        <span /><span /><span />
      </div>
    </div>
  </div>

  <!-- 完成状态：完整卡片 -->
  <div
    v-else
    :class="[
      'aib-inlinecard',
      `aib-inlinecard--${colorCategory}`,
      { 'aib-inlinecard--chart': isChart }
    ]"
  >
    <!-- 左侧色条 -->
    <div class="aib-inlinecard-colorbar" />

    <div class="aib-inlinecard-content">
      <!-- 第一层：头部标题栏 -->
      <div class="aib-inlinecard-header">
        <span class="aib-inlinecard-icon">{{ fileIcon }}</span>
        <span class="aib-inlinecard-name" :title="fileName">{{ fileName }}</span>
        <span v-if="fileExt" class="aib-inlinecard-ext">.{{ fileExt }}</span>
      </div>

      <!-- 第二层：元数据 -->
      <div class="aib-inlinecard-meta">
        <span class="aib-inlinecard-meta-item">{{ fileTypeLabel }}</span>
        <span v-if="fileSize" class="aib-inlinecard-meta-sep">・</span>
        <span v-if="fileSize" class="aib-inlinecard-meta-item">{{ fileSize }}</span>
        <span class="aib-inlinecard-meta-sep">・</span>
        <span class="aib-inlinecard-meta-item aib-inlinecard-meta-status">
          <span class="aib-inlinecard-status-dot" />
          已生成
        </span>
        <span v-if="isTruncated" class="aib-inlinecard-meta-item" title="内容已截断">⚠️ 截断</span>
      </div>

      <!-- 第三层：预览区 -->
      <!-- 图表预览 -->
      <div v-if="isChart" class="aib-inlinecard-preview aib-inlinecard-preview--chart">
        <div ref="chartContainer" class="aib-inlinecard-chart-container" />
      </div>

      <!-- 代码预览 -->
      <div v-else-if="isCodePreview && previewText" class="aib-inlinecard-preview aib-inlinecard-preview--code">
        <pre class="aib-inlinecard-code"><code>{{ previewText }}</code></pre>
        <div class="aib-inlinecard-preview-fade" />
      </div>

      <!-- 文档预览 -->
      <div v-else-if="hasTextPreview && previewText" class="aib-inlinecard-preview aib-inlinecard-preview--doc">
        <div class="aib-inlinecard-doc-content" v-html="renderMarkdownPlain(previewText)" />
        <div class="aib-inlinecard-preview-fade" />
      </div>

      <!-- 第四层：操作按钮 -->
      <!-- 图表按钮 -->
      <div v-if="isChart" class="aib-inlinecard-actions">
        <button
          class="aib-inlinecard-btn aib-inlinecard-btn--primary"
          @click="handleDownloadPng"
          title="下载 PNG 图片"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>下载 PNG</span>
        </button>
        <button
          class="aib-inlinecard-btn aib-inlinecard-btn--secondary"
          @click="handleDownloadConfig"
          title="下载 JSON 配置"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>下载 JSON</span>
        </button>
      </div>

      <!-- 普通文件按钮 -->
      <div v-else class="aib-inlinecard-actions">
        <button
          class="aib-inlinecard-btn aib-inlinecard-btn--primary"
          @click="handleDownload"
          title="下载文件"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>下载</span>
        </button>
        <button
          class="aib-inlinecard-btn aib-inlinecard-btn--secondary"
          @click="handlePreview"
          title="预览文件"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
          <span>预览</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ============ 卡片外壳 ============ */
.aib-inlinecard {
  position: relative;
  display: flex;
  width: 100%;
  background: var(--aib-bg-card);
  border: 1px solid var(--aib-border);
  border-radius: 12px;
  overflow: hidden;
  transition: transform 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  margin: 8px 0;
}

.aib-inlinecard:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.1);
  border-color: var(--aib-primary);
}

/* hover 顶部光条 */
.aib-inlinecard::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, var(--aib-primary), transparent);
  opacity: 0;
  transition: opacity 0.25s ease;
  z-index: 2;
}
.aib-inlinecard:hover::before {
  opacity: 0.6;
}

/* ============ 左侧色条 ============ */
.aib-inlinecard-colorbar {
  width: 4px;
  flex-shrink: 0;
  background: var(--aib-file-color, #6b7280);
  border-radius: 4px 0 0 4px;
}

/* 色条颜色 */
.aib-inlinecard--doc .aib-inlinecard-colorbar { --aib-file-color: #3b82f6; }
.aib-inlinecard--code .aib-inlinecard-colorbar { --aib-file-color: #10b981; }
.aib-inlinecard--data .aib-inlinecard-colorbar { --aib-file-color: #f97316; }
.aib-inlinecard--chart .aib-inlinecard-colorbar { --aib-file-color: #8b5cf6; }
.aib-inlinecard--other .aib-inlinecard-colorbar { --aib-file-color: #6b7280; }

/* 图表卡片占满宽度（已由基础类 width:100% 覆盖） */

/* ============ 内容区 ============ */
.aib-inlinecard-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* ============ 头部标题栏 ============ */
.aib-inlinecard-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px 8px;
}

.aib-inlinecard-icon {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.aib-inlinecard-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--aib-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.aib-inlinecard-ext {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 6px;
  border-radius: 6px;
  line-height: 1.3;
}

/* 扩展名标签颜色 */
.aib-inlinecard--doc .aib-inlinecard-ext {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
}
.aib-inlinecard--code .aib-inlinecard-ext {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}
.aib-inlinecard--data .aib-inlinecard-ext {
  background: rgba(249, 115, 22, 0.12);
  color: #f97316;
}
.aib-inlinecard--chart .aib-inlinecard-ext {
  background: rgba(139, 92, 246, 0.12);
  color: #8b5cf6;
}
.aib-inlinecard--other .aib-inlinecard-ext {
  background: rgba(107, 114, 128, 0.12);
  color: #6b7280;
}

/* ============ 元数据 ============ */
.aib-inlinecard-meta {
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 14px 10px;
  flex-wrap: wrap;
}

.aib-inlinecard-meta-item {
  font-size: 12px;
  color: var(--aib-text-soft);
  line-height: 1.3;
  white-space: nowrap;
}

.aib-inlinecard-meta-sep {
  font-size: 12px;
  color: var(--aib-border);
  margin: 0 6px;
}

.aib-inlinecard-meta-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.aib-inlinecard-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--aib-success);
  flex-shrink: 0;
}

/* 分隔线 */
.aib-inlinecard-header + .aib-inlinecard-meta {
  border-top: 1px solid var(--aib-border);
  padding-top: 8px;
}

/* ============ 预览区 ============ */
.aib-inlinecard-preview {
  position: relative;
  margin: 0 14px;
  border-radius: 8px;
  overflow: hidden;
}

/* 图表预览 */
.aib-inlinecard-preview--chart {
  margin-bottom: 10px;
}

.aib-inlinecard-chart-container {
  width: 100%;
  height: 360px;
  background: var(--aib-bg-card);
}

.aib-inlinecard-chart-error {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  padding: 16px;
  color: var(--aib-text-soft);
  font-size: 13px;
  text-align: center;
}

/* 代码预览 */
.aib-inlinecard-preview--code {
  max-height: 140px;
  background: var(--aib-md-code-bg);
  margin-bottom: 10px;
}

.aib-inlinecard-code {
  padding: 10px 12px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--aib-text);
  overflow: hidden;
  white-space: pre;
  word-break: normal;
}

.aib-inlinecard-code code {
  font-family: inherit;
}

/* 文档预览 */
.aib-inlinecard-preview--doc {
  max-height: 160px;
  background: var(--aib-bg-soft);
  margin-bottom: 10px;
}

.aib-inlinecard-doc-content {
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--aib-text);
  overflow: hidden;
}

/* 文档预览内标题简化 */
.aib-inlinecard-doc-content :deep(h1) {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 4px;
}
.aib-inlinecard-doc-content :deep(h2) {
  font-size: 13px;
  font-weight: 600;
  color: var(--aib-text-soft);
  margin-bottom: 2px;
}
.aib-inlinecard-doc-content :deep(p) {
  margin-bottom: 4px;
}
.aib-inlinecard-doc-content :deep(code) {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
  background: var(--aib-md-code-bg);
  padding: 1px 4px;
  border-radius: 3px;
}
.aib-inlinecard-doc-content :deep(pre) {
  background: var(--aib-md-code-bg);
  padding: 6px 8px;
  border-radius: 4px;
  margin: 4px 0;
  overflow: hidden;
}
.aib-inlinecard-doc-content :deep(pre code) {
  background: none;
  padding: 0;
}
/* 覆盖 highlight.js github-dark 主题的深色背景 */
.aib-inlinecard-doc-content :deep(.hljs) {
  background: var(--aib-md-code-bg) !important;
  color: var(--aib-md-code-color) !important;
}

/* 底部渐变遮罩 */
.aib-inlinecard-preview-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40px;
  background: linear-gradient(transparent, var(--aib-bg-soft));
  pointer-events: none;
}

.aib-inlinecard-preview--code .aib-inlinecard-preview-fade {
  background: linear-gradient(transparent, var(--aib-md-code-bg));
}

/* ============ 操作按钮 ============ */
.aib-inlinecard-actions {
  display: flex;
  gap: 10px;
  padding: 10px 14px 14px;
}

.aib-inlinecard-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1;
  height: 36px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  line-height: 1;
}

.aib-inlinecard-btn:active {
  transform: scale(0.97);
}

.aib-inlinecard-btn svg {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
}

.aib-inlinecard-btn--primary {
  background: var(--aib-primary);
  color: var(--aib-text-on-primary);
}

.aib-inlinecard-btn--primary:hover {
  background: color-mix(in srgb, var(--aib-primary) 85%, #000);
}

.aib-inlinecard-btn--secondary {
  background: transparent;
  color: var(--aib-text);
  border: 1.5px solid var(--aib-border);
}

.aib-inlinecard-btn--secondary:hover {
  background: var(--aib-bg-hover);
  border-color: var(--aib-primary);
  color: var(--aib-primary);
}

/* ============ Loading 状态 ============ */
.aib-inlinecard--loading {
  background: var(--aib-bg-soft);
  border-style: dashed;
  border-color: var(--aib-border);
}

.aib-inlinecard--loading:hover {
  transform: none;
  box-shadow: none;
  border-color: var(--aib-border);
}

.aib-inlinecard--loading::before {
  display: none;
}

.aib-inlinecard-loading-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  width: 100%;
}

.aib-inlinecard-loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--aib-border);
  border-top-color: var(--aib-primary);
  border-radius: 50%;
  animation: aib-inlinecard-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes aib-inlinecard-spin {
  to { transform: rotate(360deg); }
}

.aib-inlinecard-loading-text {
  font-size: 13px;
  color: var(--aib-text-soft);
  flex: 1;
}

.aib-inlinecard-loading-dots {
  display: flex;
  gap: 4px;
}

.aib-inlinecard-loading-dots span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--aib-primary);
  opacity: 0.4;
  animation: aib-inlinecard-dot-pulse 1.2s infinite ease-in-out;
}

.aib-inlinecard-loading-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.aib-inlinecard-loading-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes aib-inlinecard-dot-pulse {
  0%, 100% { opacity: 0.2; transform: scale(0.8); }
  50% { opacity: 0.8; transform: scale(1.1); }
}
</style>
