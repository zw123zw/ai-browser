<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import type { Attachment } from '@/src/types';
import type { ParsedFile } from '@/src/utils/file-tag-parser';
import { getFileTypeIcon, formatFileSize } from '@/src/utils/file-type';
import { getFileIcon } from '@/src/utils/file-tag-parser';
import { formatBytes } from '@/src/utils/file-generators';
import { renderChartToElement } from '@/src/utils/echart-renderer';
import { Logger } from '@/src/utils/logger';

const log = new Logger('FileCard');

const props = defineProps<{
  /** 用户上传的文件 */
  attachment?: Attachment;
  /** AI 生成的文件 */
  parsedFile?: ParsedFile;
}>();

const emit = defineEmits<{
  (e: 'preview'): void;
  (e: 'download'): void;
  (e: 'download-png'): void;
  (e: 'download-config'): void;
}>();

/** 文件名 */
const fileName = computed(() =>
  props.attachment?.name ?? props.parsedFile?.filename ?? ''
);

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

/** 是否截断 */
const isTruncated = computed(() => props.attachment?.truncated ?? false);

/** 是否为图表类型 */
const isChart = computed(() => props.parsedFile?.category === 'chart');

/** 图表索引（用于渲染） */
const chartIndex = computed(() => props.parsedFile?.index ?? -1);

/** 图表容器引用 */
const chartContainer = ref<HTMLElement | null>(null);

/** 图表实例 */
let chartInstance: any = null;

/** 图表清理函数 */
let chartDisposer: (() => void) | null = null;

/** ResizeObserver 实例 */
let resizeObserver: ResizeObserver | null = null;

/** 渲染图表 */
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
      chartContainer.value.innerHTML = `<div class="aib-chart-error">图表渲染失败: ${result.error}</div>`;
    }
  } catch (error) {
    log.error('图表渲染异常', { error });
    chartContainer.value.innerHTML = '<div class="aib-chart-error">图表渲染失败</div>';
  }
}

/** 清理图表 */
function disposeChart() {
  if (chartDisposer) {
    chartDisposer();
    chartDisposer = null;
    chartInstance = null;
  }
}

/** 监听容器宽度变化 */
function setupResizeObserver() {
  if (!chartContainer.value) return;

  resizeObserver = new ResizeObserver(() => {
    // 容器尺寸变化时，调用 chart.resize() 让图表自适应
    if (chartInstance) {
      chartInstance.resize();
    }
  });
  resizeObserver.observe(chartContainer.value);
}

// 监听图表配置变化
watch(
  () => props.parsedFile?.chartConfig,
  () => {
    disposeChart();
    renderChart();
  },
  { immediate: true }
);

// 组件挂载后渲染图表
onMounted(() => {
  renderChart();
  setupResizeObserver();
});

// 组件卸载前清理
onBeforeUnmount(() => {
  disposeChart();
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});

/** 预览按钮点击 */
function handlePreview(e: MouseEvent) {
  e.stopPropagation();
  emit('preview');
}

/** 下载按钮点击 */
function handleDownload(e: MouseEvent) {
  e.stopPropagation();
  emit('download');
}

/** 下载 PNG */
function handleDownloadPng(e: MouseEvent) {
  e.stopPropagation();
  if (!chartInstance) return;

  try {
    // 使用已渲染的图表实例导出图片
    const dataUrl = chartInstance.getDataURL({
      type: 'png',
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    });

    // 创建下载链接
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = props.parsedFile?.filename?.replace(/\.chart$/i, '.png') || 'chart.png';
    link.click();
  } catch (error) {
    log.error('下载图表 PNG 失败', { error });
  }
}

/** 下载配置 */
function handleDownloadConfig(e: MouseEvent) {
  e.stopPropagation();
  emit('download-config');
}
</script>

<template>
  <div :class="['aib-file-card', { 'aib-file-card--chart': isChart }]">
    <!-- 图表预览区域 -->
    <div
      v-if="isChart"
      ref="chartContainer"
      class="aib-chart-preview"
    />

    <div class="aib-file-card-body">
      <div class="aib-file-card-info">
        <span class="aib-file-card-icon">{{ fileIcon }}</span>
        <div class="aib-file-card-text">
          <div class="aib-file-card-name">{{ fileName }}</div>
          <div class="aib-file-card-meta">
            <span v-if="fileSize" class="aib-file-card-size">{{ fileSize }}</span>
            <span v-if="isTruncated" class="aib-file-card-truncated" title="内容已截断">⚠️</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 图表类型：下载 PNG + 下载 JSON -->
    <div v-if="isChart" class="aib-file-card-actions">
      <button
        class="aib-file-card-btn aib-file-card-btn--primary"
        @click="handleDownloadPng"
        title="下载 PNG 图片"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>下载 PNG</span>
      </button>
      <button
        class="aib-file-card-btn aib-file-card-btn--secondary"
        @click="handleDownloadConfig"
        title="下载 JSON 配置"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>下载 JSON</span>
      </button>
    </div>

    <!-- 普通文件：预览 + 下载 -->
    <div v-else class="aib-file-card-actions">
      <button
        class="aib-file-card-btn aib-file-card-btn--secondary"
        @click="handlePreview"
        title="预览文件"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <span>预览</span>
      </button>
      <button
        class="aib-file-card-btn aib-file-card-btn--primary"
        @click="handleDownload"
        title="下载文件"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>下载</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.aib-file-card {
  display: flex;
  flex-direction: column;
  width: 350px;
  max-width: 100%;
  background: var(--aib-bg-card, #ffffff);
  border: 1px solid var(--aib-border, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.2s ease;
}

/* 图表卡片占满宽度 */
.aib-file-card--chart {
  max-width: 100%;
  width: 100%;
  border-color: var(--aib-primary, #4A90D9);
  border-width: 1.5px;
}

.aib-file-card:hover {
  border-color: var(--aib-primary, #4A90D9);
  box-shadow: 0 2px 12px rgba(74, 144, 217, 0.1);
}

/* 图表预览区域 */
.aib-chart-preview {
  width: 100%;
  min-height: 200px;
  max-height: 400px;
  background: var(--aib-bg-card, #ffffff);
  border-bottom: 1px solid var(--aib-border, rgba(0, 0, 0, 0.06));
  overflow: hidden;
}

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

.aib-file-card-body {
  padding: 14px 16px;
}

.aib-file-card-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.aib-file-card-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  background: var(--aib-primary-soft, rgba(74, 144, 217, 0.1));
  border-radius: 10px;
  flex-shrink: 0;
}

.aib-file-card-text {
  flex: 1;
  min-width: 0;
}

.aib-file-card-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--aib-text-primary, #1a1a2e);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.5;
}

.aib-file-card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.aib-file-card-size {
  font-size: 12px;
  color: var(--aib-text-secondary, #8e8ea0);
}

.aib-file-card-truncated {
  font-size: 12px;
  color: #f59e0b;
}

.aib-file-card-actions {
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  background: var(--aib-bg-card-hover, #f8f9fb);
  border-top: 1px solid var(--aib-border, rgba(0, 0, 0, 0.06));
}

.aib-file-card-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  line-height: 1;
}

.aib-file-card-btn svg {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}

.aib-file-card-btn--secondary {
  background: var(--aib-bg-card, #ffffff);
  color: var(--aib-text-primary, #1a1a2e);
  border: 1.5px solid var(--aib-border, rgba(0, 0, 0, 0.12));
}

.aib-file-card-btn--secondary:hover {
  background: var(--aib-bg-card-hover, #f0f2f5);
  border-color: var(--aib-primary, #4A90D9);
  color: var(--aib-primary, #4A90D9);
}

.aib-file-card-btn--primary {
  background: var(--aib-primary, #4A90D9);
  color: #fff;
}

.aib-file-card-btn--primary:hover {
  background: var(--aib-primary-hover, #357ABD);
}
</style>
