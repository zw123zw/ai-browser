<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { fileToDataURL } from '@/src/utils/file';
import { parseFile, ocrAttachment, removeFromFileCache } from '@/src/utils/file-parsers';
import { getFileTypeIcon, formatFileSize } from '@/src/utils/file-type';
import { useToast } from '@/src/composables/useToast';
import { useI18n } from '@/src/i18n';
import { Logger } from '@/src/utils/logger';
import { inputHistoryStorage } from '@/src/storage';
import { CAPABILITY_DOMAIN_LIST } from '@/src/input/prompts/common';
import type { Conversation, ModelConfig, Attachment } from '@/src/types';

/** 图片 OCR 进度追踪（key = attachment id） */
const ocrProgressMap = ref<Record<string, number>>({});

const log = new Logger('InputBar');
const { t } = useI18n();

const props = defineProps<{
  conversation: Conversation | null | undefined;
  models: ModelConfig[];
  isProcessing?: boolean;
  waitingInputPrompt?: string | null;
  automationEnabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'send', payload: { text: string; attachments: Attachment[]; reasoning: boolean }): void;
  (e: 'abort'): void;
  (e: 'switch-voice'): void;
  (e: 'preview', attachment: Attachment): void;
}>();

const toast = useToast();

const fileInput = ref<HTMLInputElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);
/** 本地附件列表（不依赖 conversation 对象的响应性） */
const localAttachments = ref<Attachment[]>([]);
const modelMenuOpen = ref(false);
const modelMenuRef = ref<HTMLDivElement | null>(null);

// ---- / 指令选择器 ----
const commandMenuOpen = ref(false);
const commandMenuIndex = ref(0);
const commandFilter = ref('');
const commandMenuRef = ref<HTMLDivElement | null>(null);

/** 过滤后的指令列表 */
const filteredCommands = computed(() => {
  const q = commandFilter.value.toLowerCase();
  if (!q) return CAPABILITY_DOMAIN_LIST;
  return CAPABILITY_DOMAIN_LIST.filter(c =>
    c.id.includes(q) || c.title.includes(q) || c.desc.includes(q)
  );
});

// ---- 输入历史导航 ----
/** 历史记录缓存（从 storage 加载） */
let historyCache: string[] | null = null;
/** 当前历史索引，-1 表示未进入历史模式 */
const historyIndex = ref(-1);
/** 进入历史模式前保存的草稿 */
let savedDraft = '';

/** 确保历史缓存已加载 */
async function ensureHistoryLoaded() {
  if (historyCache === null) {
    historyCache = await inputHistoryStorage.getValue();
  }
}

/** 退出历史模式，重置状态 */
function exitHistoryMode() {
  historyIndex.value = -1;
  savedDraft = '';
}

/** 预览：emit 给父级渲染，避免 fixed 定位在滚动容器内失效 */
function openFilePreview(att: Attachment) {
  log.info('打开文件预览', { name: att.name, type: att.type });
  emit('preview', att);
}

/** 从 conversation 读写草稿 */
const text = computed({
  get: () => props.conversation?.draftText || '',
  set: (v) => {
    if (props.conversation) {
      props.conversation.draftText = v;
    }
  },
});
const attachments = computed(() => localAttachments.value);
/** 图片附件（用于预览） */
const imageAttachments = computed(() => attachments.value.filter(a => a.type === 'image'));
/** 非图片附件（用于预览） */
const nonImageAttachments = computed(() => attachments.value.filter(a => a.type !== 'image'));
const reasoning = computed(() => props.conversation?.reasoningEnabled || false);
const currentModel = computed(
  () =>
    props.models.find((m) => m.id === props.conversation?.modelId) ||
    props.models[0]
);

/** 当前会话是否处于流式响应或指令执行中 */
const isStreaming = computed(() => {
  if (props.isProcessing && !props.waitingInputPrompt) return true;
  const msgs = props.conversation?.messages;
  const last = msgs?.[msgs.length - 1];
  const result = last?.status === 'streaming';
  // 调试日志
  log.debug('isStreaming check', {
    isProcessing: props.isProcessing,
    msgCount: msgs?.length,
    lastMsgId: last?.id?.slice(-8),
    lastMsgStatus: last?.status,
    result,
  });
  return result;
});

/** 输入框 placeholder */
const placeholder = computed(() => {
  if (props.waitingInputPrompt) return `💬 ${props.waitingInputPrompt}`;
  return t('inputBar.placeholder');
});

function onSendOrAbort() {
  // 等待用户输入状态 → 发送到 provideInput（ChatPanel 路由）
  if (props.waitingInputPrompt) {
    send();
    return;
  }
  if (isStreaming.value) {
    emit('abort');
  } else {
    send();
  }
}

function setDraftAttachments(arr: Attachment[]) {
  localAttachments.value = arr;
  if (props.conversation) props.conversation.draftAttachments = arr;
}

// 初始化：从 conversation 加载已有附件
watch(() => props.conversation?.draftAttachments, (val) => {
  if (val) localAttachments.value = [...val];
}, { immediate: true });

function toggleReasoning() {
  if (props.conversation) props.conversation.reasoningEnabled = !reasoning.value;
}

/** 启动异步 OCR（不阻塞 UI） */
function startOcr(attachment: Attachment) {
  log.info('startOcr', { name: attachment.name, type: attachment.type, hasDataUrl: !!attachment.dataUrl });
  ocrProgressMap.value[attachment.id] = 0;
  ocrAttachment(attachment, (progress) => {
    ocrProgressMap.value[attachment.id] = progress;
  }).then(() => {
    delete ocrProgressMap.value[attachment.id];
    setDraftAttachments([...attachments.value]);
  });
}

/** 统一文件处理：解析 → 添加附件 → 异步 OCR */
async function addFiles(files: File[]) {
  const newAttachments = [...attachments.value];
  const ocrTargets: Attachment[] = [];
  let truncationCount = 0;

  for (const f of files) {
    try {
      const attachment = await parseFile(f);
      log.info('addFiles parsed', { name: f.name, detectedType: attachment.type, hasDataUrl: !!attachment.dataUrl, contentLen: attachment.content?.length });
      if (attachment.truncated) truncationCount++;
      newAttachments.push(attachment);
      if (attachment.type === 'image') ocrTargets.push(attachment);
    } catch (err: any) {
      toast.error(err?.message || `文件 ${f.name} 解析失败`);
    }
  }

  if (truncationCount > 0) {
    toast.warning(`${truncationCount} 个文件内容过长，已自动截断至 500KB`);
  }

  setDraftAttachments(newAttachments);
  log.info('OCR targets', { count: ocrTargets.length, names: ocrTargets.map(a => a.name) });
  for (const att of ocrTargets) startOcr(att);
}

/** 选择文件（图片 + 通用文件） */
async function pickFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;
  log.info('pickFiles', { count: input.files.length, files: Array.from(input.files).map(f => ({ name: f.name, type: f.type, size: f.size })) });
  await addFiles(Array.from(input.files));
  input.value = '';
}

async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;

  // 同步检测：是否有文件（截图等）
  const files: File[] = [];
  for (const it of Array.from(items)) {
    if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) {
        log.info('onPaste file item', { name: f.name, type: f.type, size: f.size });
        files.push(f);
      }
    }
  }

  // 有文件 → 走统一的 addFiles 流程
  if (files.length) {
    log.info('onPaste → addFiles', { count: files.length });
    e.preventDefault();
    await addFiles(files);
    return;
  }

  // 没有文件 → 检查是否为可获取的链接（网络链接或本地文件路径）
  const pastedText = e.clipboardData?.getData('text/plain')?.trim();
  const fetchUrl = toFetchableUrl(pastedText);
  if (fetchUrl) {
    e.preventDefault();
    try {
      let blob: Blob;
      if (fetchUrl.startsWith('file:///')) {
        // 本地文件 → 通过 Background 代理读取
        blob = await fetchLocalFile(fetchUrl);
      } else {
        // 网络链接 → 直接 fetch
        const res = await fetch(fetchUrl, { mode: 'cors' });
        blob = await res.blob();
      }
      log.info('onPaste URL fetched', { url: fetchUrl, blobType: blob.type, blobSize: blob.size });
      // 只有返回的是图片 → 拦截，不粘贴链接文本
      if (blob.type.startsWith('image/')) {
        const ext = blob.type.split('/')[1] || 'png';
        const fileName = pastedText!.split(/[\\/]/).pop()?.split('?')[0] || `image.${ext}`;
        const file = new File([blob], fileName, { type: blob.type });
        log.info('onPaste URL → image file', { fileName, type: file.type });
        await addFiles([file]);
      } else {
        // 非图片 → 上传内容 + 粘贴链接文本（同时做两件事）
        insertTextAtCursor(pastedText!);
        const ext = blob.type.split('/')[1] || 'txt';
        const fileName = pastedText!.split(/[\\/]/).pop()?.split('?')[0] || `file.${ext}`;
        const file = new File([blob], fileName, { type: blob.type });
        log.info('onPaste URL → non-image file', { fileName, type: file.type });
        await addFiles([file]);
      }
    } catch (err) {
      // fetch 失败 → 粘贴链接文本
      log.warn('fetch 链接内容失败，仅粘贴文本', { fetchUrl, error: (err as Error)?.message });
      insertTextAtCursor(pastedText!);
    }
    return;
  }

  // 普通文本 → 不拦截，让浏览器正常粘贴
}

/** 在光标位置插入文本 */
function insertTextAtCursor(insertText: string) {
  const el = textarea.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const before = text.value.slice(0, start);
  const after = text.value.slice(end);
  text.value = before + insertText + after;
  nextTick(() => {
    const pos = start + insertText.length;
    el.selectionStart = el.selectionEnd = pos;
    el.focus();
  });
}

/** 通过 Background 代理读取本地文件（Content Script 无法直接 fetch file://） */
function fetchLocalFile(fileUrl: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'read-local-file', url: fileUrl }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.success) {
        reject(new Error(response?.error || '读取本地文件失败'));
        return;
      }
      // base64 → Blob
      const binary = atob(response.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      log.info('fetchLocalFile', { url: fileUrl, mimeType: response.mimeType, size: bytes.length });
      resolve(new Blob([bytes], { type: response.mimeType }));
    });
  });
}

/**
 * 将粘贴文本转为可 fetch 的 URL
 * - data: URL → 直接返回
 * - blob: URL → 直接返回
 * - http/https → 直接返回
 * - // 开头 → 补全 https: 返回
 * - file:/// → 直接返回
 * - Windows 本地路径（E:\xxx 或 E:/xxx）→ 转为 file:/// 返回
 * - 其余（普通文本）→ 返回 null
 */
function toFetchableUrl(text: string | undefined | null): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  // data: / blob: 直接可用
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return trimmed;

  // 协议相对URL → 补全 https:
  if (trimmed.startsWith('//')) return 'https:' + trimmed;

  // file:/// 直接可用
  if (trimmed.startsWith('file:///')) return trimmed;

  // Windows 本地路径（E:\xxx 或 E:/xxx）→ 转为 file:///
  if (/^[A-Za-z]:[\\\/]/.test(trimmed)) {
    return 'file:///' + trimmed.replace(/\\/g, '/');
  }

  // http/https 网络链接
  try {
    const u = new URL(trimmed);
    if (u.protocol === 'http:' || u.protocol === 'https:') return trimmed;
  } catch { /* 不是合法 URL */ }

  return null;
}

function removeAttachment(i: number) {
  const att = attachments.value[i];
  if (att) removeFromFileCache(att.id);
  const next = [...attachments.value];
  next.splice(i, 1);
  setDraftAttachments(next);
}

function autoResize() {
  const el = textarea.value;
  if (!el) return;
  // 先缩小到 0 再设实际高度，确保 scrollHeight 准确
  // 使用 0 而非 'auto'，避免 'auto' → 固定值之间的布局抖动丢失焦点
  el.style.height = '0px';
  const newH = Math.min(el.scrollHeight, 200);
  el.style.height = newH + 'px';
  // 同步修正滚动位置，避免因高度塌缩导致父容器滚动
  el.scrollTop = 0;
}

watch(() => text.value, (newVal, oldVal) => {
  autoResize();
  // 用户手动编辑时退出历史模式（非历史导航引起的变更）
  if (historyIndex.value >= 0 && newVal !== historyCache?.[historyIndex.value]) {
    exitHistoryMode();
  }
  // / 指令选择器：检测输入 / 触发菜单（仅自动化开启时）
  if (props.automationEnabled && (newVal === '/' || (newVal.startsWith('/') && !newVal.includes(' ') && newVal.length <= 20))) {
    commandFilter.value = newVal.slice(1); // 去掉 /
    commandMenuOpen.value = true;
    commandMenuIndex.value = 0;
  } else {
    commandMenuOpen.value = false;
  }
});
watch(() => props.conversation?.id, () => nextTick(autoResize));

function send() {
  const t = text.value.trim();
  if (!t && !attachments.value.length) return;

  emit('send', {
    text: t,
    attachments: [...attachments.value],
    reasoning: reasoning.value,
  });

  // 发送后清空 draft
  localAttachments.value = [];
  if (props.conversation) {
    props.conversation.draftText = '';
    props.conversation.draftAttachments = [];
  }
  // 重置历史导航状态，下次按 Up 时重新加载
  exitHistoryMode();
  historyCache = null;
  nextTick(autoResize);
}

function onKeydown(e: KeyboardEvent) {
  // / 指令选择器键盘导航
  if (commandMenuOpen.value) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      commandMenuIndex.value = (commandMenuIndex.value + 1) % filteredCommands.value.length;
      scrollToActiveCommand();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      commandMenuIndex.value = (commandMenuIndex.value - 1 + filteredCommands.value.length) % filteredCommands.value.length;
      scrollToActiveCommand();
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.isComposing)) {
      e.preventDefault();
      selectCommand(filteredCommands.value[commandMenuIndex.value]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      commandMenuOpen.value = false;
      return;
    }
  }

  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
    return;
  }

  // 历史导航：空输入框 或 已在历史模式中 时触发
  if (e.key === 'ArrowUp' && (!text.value || historyIndex.value >= 0)) {
    log.info('[History] ArrowUp 触发历史导航', { textValue: JSON.stringify(text.value), historyIndex: historyIndex.value });
    e.preventDefault();
    navigateHistory(-1);
    return;
  }
  if (e.key === 'ArrowDown' && historyIndex.value >= 0) {
    log.info('[History] ArrowDown 触发历史导航', { historyIndex: historyIndex.value });
    e.preventDefault();
    navigateHistory(1);
    return;
  }
}

/** 选择指令 */
function selectCommand(cmd: { id: string; title: string }) {
  text.value = `/${cmd.id} `;
  commandMenuOpen.value = false;
  nextTick(() => textarea.value?.focus());
}

/** 滚动当前选中指令到可视区域 */
function scrollToActiveCommand() {
  nextTick(() => {
    const active = commandMenuRef.value?.querySelector('.aib-command-active');
    if (active) {
      active.scrollIntoView({ block: 'nearest' });
    }
  });
}

/**
 * 历史导航
 * @param direction -1=上一条, 1=下一条
 */
async function navigateHistory(direction: number) {
  await ensureHistoryLoaded();
  log.info('[History] navigateHistory', { direction, cacheLen: historyCache?.length ?? 0, historyIndex: historyIndex.value });
  if (!historyCache || historyCache.length === 0) return;

  if (direction === -1) {
    // Up：回退
    if (historyIndex.value === -1) {
      // 首次进入历史模式，保存当前草稿
      savedDraft = text.value;
      historyIndex.value = historyCache.length - 1;
    } else if (historyIndex.value > 0) {
      historyIndex.value--;
    } else {
      // 已到最顶部，不再移动
      return;
    }
  } else {
    // Down：前进
    if (historyIndex.value < 0) return;
    if (historyIndex.value < historyCache.length - 1) {
      historyIndex.value++;
    } else {
      // 到达末尾，恢复原始草稿并退出历史模式
      text.value = savedDraft;
      exitHistoryMode();
      return;
    }
  }

  text.value = historyCache[historyIndex.value];
  log.info('[History] 回填文本', { index: historyIndex.value, text: text.value.slice(0, 50) });
}

function pickModel(id: string) {
  if (props.conversation) props.conversation.modelId = id;
  modelMenuOpen.value = false;
}

function onDocClick(e: MouseEvent) {
  if (!modelMenuOpen.value) return;
  // 用 composedPath 判断点击是否在菜单外部（兼容 Shadow DOM）
  const path = e.composedPath();
  if (modelMenuRef.value && !path.includes(modelMenuRef.value)) {
    modelMenuOpen.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocClick, true));
onUnmounted(() => document.removeEventListener('click', onDocClick, true));
</script>

<template>
  <div class="aib-input-card">
    <!-- 图片预览（带 OCR 进度） -->
    <div v-if="imageAttachments.length" class="aib-image-preview">
      <div v-for="att in imageAttachments" :key="att.id" class="aib-image-thumb" @click="openFilePreview(att)">
        <img :src="att.dataUrl" />
        <!-- OCR 进度覆盖层 -->
        <div v-if="att.id in ocrProgressMap" class="aib-ocr-overlay">
          <div class="aib-ocr-overlay-bar" :style="{ width: (ocrProgressMap[att.id] * 100) + '%' }"></div>
          <span class="aib-ocr-overlay-text">OCR</span>
        </div>
        <button class="aib-image-del" @click.stop="removeAttachment(attachments.indexOf(att))">×</button>
      </div>
    </div>

    <!-- 非图片附件预览 -->
    <div v-if="nonImageAttachments.length" class="aib-attachment-preview">
      <div v-for="(att, i) in nonImageAttachments" :key="att.id" class="aib-attachment-chip" @click="openFilePreview(att)">
        <span class="aib-attachment-icon">{{ getFileTypeIcon(att.type) }}</span>
        <span class="aib-attachment-name" :title="att.name">{{ att.name }}</span>
        <span class="aib-attachment-size">{{ formatFileSize(att.size) }}</span>
        <button class="aib-attachment-del" @click.stop="removeAttachment(attachments.indexOf(att))">×</button>
      </div>
    </div>

    <textarea
      ref="textarea"
      v-model="text"
      class="aib-input-area"
      :placeholder="placeholder"
      rows="1"
      @keydown="onKeydown"
      @paste="onPaste"
    />

    <!-- / 指令选择器 -->
    <div v-if="commandMenuOpen && filteredCommands.length" ref="commandMenuRef" class="aib-command-menu">
      <div
        v-for="(cmd, i) in filteredCommands"
        :key="cmd.id"
        :class="['aib-command-item', { 'aib-command-active': i === commandMenuIndex }]"
        @click="selectCommand(cmd)"
        @mouseenter="commandMenuIndex = i"
      >
        <span class="aib-command-id">/{{ cmd.id }}</span>
        <span class="aib-command-title">{{ cmd.title }}</span>
      </div>
    </div>

    <div class="aib-input-toolbar">
      <div class="aib-toolbar-left">
        <button class="aib-tool-btn" :title="t('inputBar.attach')" @click="fileInput?.click()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          ref="fileInput"
          type="file"
          multiple
          style="display: none"
          @change="pickFiles"
        />

        <div ref="modelMenuRef" class="aib-model-pill-wrap">
          <button class="aib-tool-pill" @click="modelMenuOpen = !modelMenuOpen">
            {{ currentModel?.label || t('settings.ai.defaultModel') }}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div v-if="modelMenuOpen" class="aib-model-menu">
            <div
              v-for="m in models"
              :key="m.id"
              class="aib-model-item"
              :class="{ 'aib-model-active': m.id === conversation?.modelId }"
              @click="pickModel(m.id)"
            >
              {{ m.label }}
            </div>
          </div>
        </div>
      </div>

      <div class="aib-toolbar-right">
        <button class="aib-tool-btn" :title="t('inputBar.voice')" @click="emit('switch-voice')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
        <button
          class="aib-send-btn"
          :class="{ 'aib-send-btn-stop': isStreaming }"
          :disabled="!isStreaming && !text.trim() && !attachments.length"
          :title="isStreaming ? t('inputBar.stop') : t('inputBar.send')"
          @click="onSendOrAbort"
        >
          <svg v-if="isStreaming" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
            stroke="none">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
