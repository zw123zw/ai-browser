<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { fileToDataURL } from '@/src/utils/file';
import type { Conversation, ModelConfig } from '@/src/types';

const props = defineProps<{
  conversation: Conversation;
  models: ModelConfig[];
}>();

const emit = defineEmits<{
  (e: 'send', payload: { text: string; images: string[]; reasoning: boolean }): void;
  (e: 'abort'): void;
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const textarea = ref<HTMLTextAreaElement | null>(null);
const modelMenuOpen = ref(false);
const modelMenuRef = ref<HTMLDivElement | null>(null);

/** 所有 state 都从 conversation 读写，保证会话间相互独立 */
const text = computed({
  get: () => props.conversation.draftText || '',
  set: (v) => {
    props.conversation.draftText = v;
  },
});
const images = computed(() => props.conversation.draftImages || []);
const reasoning = computed(() => props.conversation.reasoningEnabled || false);
const currentModel = computed(
  () =>
    props.models.find((m) => m.id === props.conversation.modelId) ||
    props.models[0]
);

/** 当前会话是否处于流式响应中 */
const isStreaming = computed(() => {
  const last =
    props.conversation.messages[props.conversation.messages.length - 1];
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
  props.conversation.draftImages = arr;
}

function toggleReasoning() {
  props.conversation.reasoningEnabled = !reasoning.value;
}

async function pickImages(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;
  const next = [...images.value];
  for (const f of Array.from(input.files)) {
    if (!f.type.startsWith('image/')) continue;
    next.push(await fileToDataURL(f));
  }
  setDraftImages(next);
  input.value = '';
}

async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  const imageFiles: File[] = [];
  for (const it of Array.from(items)) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) imageFiles.push(f);
    }
  }
  if (!imageFiles.length) return;
  e.preventDefault();
  const next = [...images.value];
  for (const f of imageFiles) {
    next.push(await fileToDataURL(f));
  }
  setDraftImages(next);
}

function removeImg(i: number) {
  const next = [...images.value];
  next.splice(i, 1);
  setDraftImages(next);
}

function autoResize() {
  const el = textarea.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

watch(() => text.value, () => nextTick(autoResize));
watch(() => props.conversation.id, () => nextTick(autoResize));

function send() {
  const t = text.value.trim();
  if (!t && !images.value.length) return;
  emit('send', {
    text: t,
    images: [...images.value],
    reasoning: reasoning.value,
  });
  // 发送后清空 draft，但保留 reasoning toggle 状态
  props.conversation.draftText = '';
  props.conversation.draftImages = [];
  nextTick(autoResize);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
}

function pickModel(id: string) {
  props.conversation.modelId = id;
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
    <div v-if="images.length" class="zwf-image-preview">
      <div v-for="(src, i) in images" :key="i" class="zwf-image-thumb">
        <img :src="src" />
        <button class="zwf-image-del" @click="removeImg(i)">×</button>
      </div>
    </div>

    <textarea
      ref="textarea"
      v-model="text"
      class="zwf-input-area"
      placeholder="请输入消息，Enter 发送，Shift + Enter 换行，Ctrl + V 粘贴图片"
      rows="1"
      @input="autoResize"
      @keydown="onKeydown"
      @paste="onPaste"
    />

    <div class="zwf-input-toolbar">
      <div class="zwf-toolbar-left">
        <button class="zwf-tool-btn" title="上传图片" @click="fileInput?.click()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          multiple
          style="display: none"
          @change="pickImages"
        />

        <button
          class="zwf-tool-pill"
          :class="{ 'zwf-pill-active': reasoning }"
          title="开启后追加深度思考提示"
          @click="toggleReasoning"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z"/>
            <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z"/>
          </svg>
          深度思考
        </button>

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
              :class="{ 'zwf-model-active': m.id === conversation.modelId }"
              @click="pickModel(m.id)"
            >
              {{ m.label }}
            </div>
          </div>
        </div>
      </div>

      <div class="zwf-toolbar-right">
        <button
          class="zwf-send-btn"
          :class="{ 'zwf-send-btn-stop': isStreaming }"
          :disabled="!isStreaming && !text.trim() && !images.length"
          :title="isStreaming ? '停止生成' : '发送'"
          @click="onSendOrAbort"
        >
          <svg v-if="isStreaming" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
            stroke="none">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>
