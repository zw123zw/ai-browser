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
    // 触发响应式更新（content 被就地修改）
    setDraftAttachments([...attachments.value]);
  });
}

/** 选择文件（图片 + 通用文件） */
async function pickFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;

  log.info('pickFiles 开始', { fileCount: input.files.length });

  const newAttachments = [...attachments.value];
  const ocrTargets: Attachment[] = [];
  let truncationCount = 0;

  for (const f of Array.from(input.files)) {
    try {
      log.info('解析文件', { name: f.name, size: f.size, type: f.type });
      const attachment = await parseFile(f);
      log.info('解析完成', { name: f.name, attType: attachment.type });

      if (attachment.truncated) truncationCount++;
      newAttachments.push(attachment);

      // 图片需要 OCR
      if (attachment.type === 'image') {
        ocrTargets.push(attachment);
      }
    } catch (err: any) {
      log.error('文件解析失败', { name: f.name, error: err?.message });
      toast.error(err?.message || `文件 ${f.name} 解析失败`);
    }
  }

  if (truncationCount > 0) {
    toast.warning(`${truncationCount} 个文件内容过长，已自动截断至 100KB`);
  }

  // 先更新 UI（图片立即显示），再异步 OCR
  log.info('pickFiles 完成', { attachmentCount: newAttachments.length, ocrCount: ocrTargets.length });
  setDraftAttachments(newAttachments);
  for (const att of ocrTargets) {
    startOcr(att);
  }
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

  // 有文件 → 立即拦截，走文件解析
  if (files.length) {
    e.preventDefault();
    const newAttachments = [...attachments.value];
    const ocrTargets: Attachment[] = [];
    for (const f of files) {
      try {
        const attachment = await parseFile(f);
        newAttachments.push(attachment);
        if (attachment.type === 'image') ocrTargets.push(attachment);
      } catch (err: any) {
        toast.error(err?.message || `文件 ${f.name} 解析失败`);
      }
    }
    setDraftAttachments(newAttachments);
    for (const att of ocrTargets) startOcr(att);
    return;
  }

  // 没有文件 → 检查是否为图片链接（同步用 getData）
  const pastedText = e.clipboardData?.getData('text/plain')?.trim();
  if (pastedText && isImageUrl(pastedText)) {
    e.preventDefault(); // 是图片链接才拦截
    try {
      const dataUrl = await fetchImageAsDataUrl(pastedText);
      // 作为图片附件添加（无 OCR，URL 图片直接附带 dataUrl）
      const imgAttachment: Attachment = {
        id: `_url_${Date.now()}`,
        type: 'image',
        name: pastedText.split('/').pop() || 'image.png',
        size: 0,
        mimeType: 'image/png',
        dataUrl,
      };
      setDraftAttachments([...attachments.value, imgAttachment]);
    } catch {
      // 获取失败 → 写入输入框
      insertTextAtCursor(pastedText);
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

/** 判断是否为可获取的 URL */
function isImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 获取图片并转为 base64 dataURL（多策略降级） */
async function fetchImageAsDataUrl(url: string): Promise<string> {
  // 策略 1：直接 fetch（同源或服务器允许 CORS 的图片）
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      if (blob.type.startsWith('image/')) return blobToDataUrl(blob);
    }
  } catch { /* CORS blocked，继续降级 */ }

  // 策略 2：no-cors 模式加载到 <img>，用 canvas 转 base64
  try {
    return await imgToDataUrl(url);
  } catch { /* tainted canvas，继续降级 */ }

  // 策略 3：通过代理获取（多个代理轮试）
  const proxies = [
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  ];
  for (const buildProxy of proxies) {
    try {
      const res = await fetch(buildProxy(url));
      if (res.ok) {
        const blob = await res.blob();
        if (blob.type.startsWith('image/')) return blobToDataUrl(blob);
      }
    } catch { /* 代理也失败，试下一个 */ }
  }

  throw new Error('所有获取方式均失败（可能服务器拒绝跨域访问）');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('转换 base64 失败'));
    reader.readAsDataURL(blob);
  });
}

/** 通过 <img> + canvas 获取跨域图片的 base64 */
function imgToDataUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('canvas 不可用'));
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
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
