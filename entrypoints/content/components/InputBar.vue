<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { fileToDataURL } from '@/src/utils/file';
import { parseFile } from '@/src/utils/file-parsers';
import { getFileTypeIcon, formatFileSize } from '@/src/utils/file-type';
import type { Conversation, ModelConfig, Attachment } from '@/src/types';

const props = defineProps<{
  conversation: Conversation | null | undefined;
  models: ModelConfig[];
}>();

const emit = defineEmits<{
  (e: 'send', payload: { text: string; images: string[]; attachments: Attachment[]; reasoning: boolean }): void;
  (e: 'abort'): void;
  (e: 'switch-voice'): void;
  (e: 'preview-file', attachment: Attachment): void;
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);
const modelMenuOpen = ref(false);
const modelMenuRef = ref<HTMLDivElement | null>(null);

/** 从 conversation 读写草稿 */
const text = computed({
  get: () => props.conversation?.draftText || '',
  set: (v) => {
    if (props.conversation) {
      props.conversation.draftText = v;
    }
  },
});
const images = computed(() => props.conversation?.draftImages || []);
const attachments = computed(() => props.conversation?.draftAttachments || []);
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

function setDraftImages(arr: string[]) {
  if (props.conversation) props.conversation.draftImages = arr;
}

function setDraftAttachments(arr: Attachment[]) {
  if (props.conversation) props.conversation.draftAttachments = arr;
}

function toggleReasoning() {
  if (props.conversation) props.conversation.reasoningEnabled = !reasoning.value;
}

/** 选择文件（图片 + 通用文件） */
async function pickFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;

  const newImages = [...images.value];
  const newAttachments = [...attachments.value];

  for (const f of Array.from(input.files)) {
    try {
      const attachment = await parseFile(f);
      if (attachment.type === 'image' && attachment.dataUrl) {
        // 图片走旧的 images 字段（保持兼容）
        newImages.push(attachment.dataUrl);
      } else {
        newAttachments.push(attachment);
      }
    } catch (err) {
      console.error('[InputBar] 文件解析失败:', f.name, err);
    }
  }

  setDraftImages(newImages);
  setDraftAttachments(newAttachments);
  input.value = '';
}

async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;

  const files: File[] = [];
  for (const it of Array.from(items)) {
    if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (!files.length) return;
  e.preventDefault();

  const newImages = [...images.value];
  const newAttachments = [...attachments.value];

  for (const f of files) {
    try {
      const attachment = await parseFile(f);
      if (attachment.type === 'image' && attachment.dataUrl) {
        newImages.push(attachment.dataUrl);
      } else {
        newAttachments.push(attachment);
      }
    } catch (err) {
      console.error('[InputBar] 粘贴文件解析失败:', f.name, err);
    }
  }

  setDraftImages(newImages);
  setDraftAttachments(newAttachments);
}

function removeImg(i: number) {
  const next = [...images.value];
  next.splice(i, 1);
  setDraftImages(next);
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
  if (!t && !images.value.length && !attachments.value.length) return;

  emit('send', {
    text: t,
    images: [...images.value],
    attachments: [...attachments.value],
    reasoning: reasoning.value,
  });

  // 发送后清空 draft
  if (props.conversation) {
    props.conversation.draftText = '';
    props.conversation.draftImages = [];
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
    <!-- 图片预览（保留旧格式） -->
    <div v-if="images.length" class="zwf-image-preview">
      <div v-for="(src, i) in images" :key="i" class="zwf-image-thumb">
        <img :src="src" />
        <button class="zwf-image-del" @click="removeImg(i)">×</button>
      </div>
    </div>

    <!-- 文件附件预览 -->
    <div v-if="attachments.length" class="zwf-attachment-preview">
      <div v-for="(att, i) in attachments" :key="att.id" class="zwf-attachment-chip">
        <span class="zwf-attachment-icon">{{ getFileTypeIcon(att.type) }}</span>
        <span class="zwf-attachment-name" :title="att.name">{{ att.name }}</span>
        <span class="zwf-attachment-size">{{ formatFileSize(att.size) }}</span>
        <button class="zwf-attachment-del" @click="removeAttachment(i)">×</button>
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
          :disabled="!isStreaming && !text.trim() && !images.length && !attachments.length"
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
