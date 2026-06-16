<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { fileToDataURL } from '@/src/utils/file';
import { parseFile, ocrAttachment } from '@/src/utils/file-parsers';
import { getFileTypeIcon, formatFileSize } from '@/src/utils/file-type';
import { useToast } from '@/src/composables/useToast';
import { Logger } from '@/src/utils/logger';
import type { Conversation, ModelConfig, Attachment } from '@/src/types';

/** 图片 OCR 进度追踪（key = attachment id） */
const ocrProgressMap = ref<Record<string, number>>({});

const log = new Logger('InputBar');

const props = defineProps<{
  conversation: Conversation | null | undefined;
  models: ModelConfig[];
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
const modelMenuOpen = ref(false);
const modelMenuRef = ref<HTMLDivElement | null>(null);

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
const attachments = computed(() => props.conversation?.draftAttachments || []);
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

/** 当前会话是否处于流式响应中 */
const isStreaming = computed(() => {
  const last = props.conversation?.messages[props.conversation.messages.length - 1];
  return last?.status === 'streaming';
});

function onSendOrAbort() {
  if (isStreaming.value) {
    emit('abort');
  } else {
    send();
  }
}

function setDraftAttachments(arr: Attachment[]) {
  if (props.conversation) props.conversation.draftAttachments = arr;
}

function toggleReasoning() {
  if (props.conversation) props.conversation.reasoningEnabled = !reasoning.value;
}

/** 启动异步 OCR（不阻塞 UI） */
function startOcr(attachment: Attachment) {
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
      if (attachment.truncated) truncationCount++;
      newAttachments.push(attachment);
      if (attachment.type === 'image') ocrTargets.push(attachment);
    } catch (err: any) {
      toast.error(err?.message || `文件 ${f.name} 解析失败`);
    }
  }

  if (truncationCount > 0) {
    toast.warning(`${truncationCount} 个文件内容过长，已自动截断至 100KB`);
  }

  setDraftAttachments(newAttachments);
  for (const att of ocrTargets) startOcr(att);
}

/** 选择文件（图片 + 通用文件） */
async function pickFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;
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
      if (f) files.push(f);
    }
  }

  // 有文件 → 走统一的 addFiles 流程
  if (files.length) {
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
      // 只有返回的是图片 → 拦截，不粘贴链接文本
      if (blob.type.startsWith('image/')) {
        const ext = blob.type.split('/')[1] || 'png';
        const fileName = pastedText!.split(/[\\/]/).pop()?.split('?')[0] || `image.${ext}`;
        const file = new File([blob], fileName, { type: blob.type });
        await addFiles([file]);
      } else {
        // 非图片 → 上传内容 + 粘贴链接文本（同时做两件事）
        insertTextAtCursor(pastedText!);
        const ext = blob.type.split('/')[1] || 'txt';
        const fileName = pastedText!.split(/[\\/]/).pop()?.split('?')[0] || `file.${ext}`;
        const file = new File([blob], fileName, { type: blob.type });
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
  const next = [...attachments.value];
  next.splice(i, 1);
  setDraftAttachments(next);
}

function autoResize() {
  const el = textarea.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

watch(() => text.value, () => nextTick(autoResize));
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
  if (props.conversation) {
    props.conversation.draftText = '';
    props.conversation.draftAttachments = [];
  }
  nextTick(autoResize);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
}

function pickModel(id: string) {
  if (props.conversation) props.conversation.modelId = id;
  modelMenuOpen.value = false;
}

function onDocClick(e: MouseEvent) {
  if (!modelMenuOpen.value) return;
  if (modelMenuRef.value && !modelMenuRef.value.contains(e.target as Node)) {
    modelMenuOpen.value = false;
  }
}

onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));
</script>

<template>
  <div class="zwf-input-card">
    <!-- 图片预览（带 OCR 进度） -->
    <div v-if="imageAttachments.length" class="zwf-image-preview">
      <div v-for="att in imageAttachments" :key="att.id" class="zwf-image-thumb" @click="openFilePreview(att)">
        <img :src="att.dataUrl" />
        <!-- OCR 进度覆盖层 -->
        <div v-if="att.id in ocrProgressMap" class="zwf-ocr-overlay">
          <div class="zwf-ocr-overlay-bar" :style="{ width: (ocrProgressMap[att.id] * 100) + '%' }"></div>
          <span class="zwf-ocr-overlay-text">OCR</span>
        </div>
        <button class="zwf-image-del" @click.stop="removeAttachment(attachments.indexOf(att))">×</button>
      </div>
    </div>

    <!-- 非图片附件预览 -->
    <div v-if="nonImageAttachments.length" class="zwf-attachment-preview">
      <div v-for="(att, i) in nonImageAttachments" :key="att.id" class="zwf-attachment-chip" @click="openFilePreview(att)">
        <span class="zwf-attachment-icon">{{ getFileTypeIcon(att.type) }}</span>
        <span class="zwf-attachment-name" :title="att.name">{{ att.name }}</span>
        <span class="zwf-attachment-size">{{ formatFileSize(att.size) }}</span>
        <button class="zwf-attachment-del" @click.stop="removeAttachment(attachments.indexOf(att))">×</button>
      </div>
    </div>

    <textarea
      ref="textarea"
      v-model="text"
      class="zwf-input-area"
      placeholder="输入消息... (Enter 发送，Shift+Enter 换行)"
      rows="1"
      @input="autoResize"
      @keydown="onKeydown"
      @paste="onPaste"
    />

    <div class="zwf-input-toolbar">
      <div class="zwf-toolbar-left">
        <button class="zwf-tool-btn" title="上传文件" @click="fileInput?.click()">
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

        <div ref="modelMenuRef" class="zwf-model-pill-wrap">
          <button class="zwf-tool-pill" @click="modelMenuOpen = !modelMenuOpen">
            {{ currentModel?.label || '选择模型' }}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div v-if="modelMenuOpen" class="zwf-model-menu">
            <div
              v-for="m in models"
              :key="m.id"
              class="zwf-model-item"
              :class="{ 'zwf-model-active': m.id === conversation?.modelId }"
              @click="pickModel(m.id)"
            >
              {{ m.label }}
            </div>
          </div>
        </div>
      </div>

      <div class="zwf-toolbar-right">
        <button class="zwf-tool-btn" title="语音模式" @click="emit('switch-voice')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
        <button
          class="zwf-send-btn"
          :class="{ 'zwf-send-btn-stop': isStreaming }"
          :disabled="!isStreaming && !text.trim() && !attachments.length"
          :title="isStreaming ? '停止生成' : '发送'"
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
