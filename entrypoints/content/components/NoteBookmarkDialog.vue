<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useNotesStore } from '@/src/stores/notes';
import { useToast } from '@/src/composables/useToast';
import type { NoteEntry } from '@/src/types';

const props = defineProps<{
  data: {
    content: string;
    url: string;
    scrollY: number;
    selectedText?: string;
    source: NoteEntry['source'];
  };
}>();

const emit = defineEmits<{ (e: 'close'): void }>();

const notesStore = useNotesStore();
const toast = useToast();

const titleInput = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const showSuggestions = ref(false);

/** 已有标题列表（过滤匹配） */
const suggestions = computed(() => {
  const query = titleInput.value.trim().toLowerCase();
  if (!query) return notesStore.titles.map((t) => t.title);
  return notesStore.titles
    .map((t) => t.title)
    .filter((name) => name.toLowerCase().includes(query));
});

/** 选择建议 */
function selectSuggestion(name: string) {
  titleInput.value = name;
  showSuggestions.value = false;
}

/** 确认收藏 */
async function handleConfirm() {
  const title = titleInput.value.trim();
  if (!title) {
    toast.warning('请输入笔记标题');
    return;
  }

  await notesStore.addEntry(title, {
    content: props.data.content,
    url: props.data.url,
    scrollY: props.data.scrollY,
    selectedText: props.data.selectedText,
    source: props.data.source,
  });

  toast.success(`已收藏到「${title}」`);
  emit('close');
}

/** 输入框聚焦时显示建议 */
function onFocus() {
  showSuggestions.value = true;
}

/** 延迟隐藏建议列表 */
function setTimeoutVal() {
  setTimeout(() => { showSuggestions.value = false }, 200);
}

/** 点击外部关闭 */
function onBackdrop(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('aib-bookmark-backdrop')) {
    emit('close');
  }
}

onMounted(() => {
  nextTick(() => inputRef.value?.focus());
});
</script>

<template>
  <div class="aib-bookmark-backdrop" @click="onBackdrop">
    <div class="aib-bookmark-dialog" @click.stop>
      <div class="aib-bookmark-header">
        <span>⭐ 收藏笔记</span>
        <button class="aib-bookmark-close" @click="emit('close')">✕</button>
      </div>

      <div class="aib-bookmark-body">
        <label class="aib-bookmark-label">笔记标题</label>
        <div class="aib-bookmark-input-wrap">
          <input
            ref="inputRef"
            v-model="titleInput"
            class="aib-bookmark-input"
            placeholder="输入新标题或选择已有标题..."
            @focus="onFocus"
            @blur="setTimeoutVal()"
            @keydown.enter="handleConfirm"
          />
          <div v-if="showSuggestions && suggestions.length > 0" class="aib-bookmark-suggestions">
            <div
              v-for="name in suggestions"
              :key="name"
              class="aib-bookmark-suggestion"
              @mousedown.prevent="selectSuggestion(name)"
            >
              {{ name }}
            </div>
          </div>
        </div>
      </div>

      <div class="aib-bookmark-footer">
        <button class="aib-bookmark-btn" @click="emit('close')">取消</button>
        <button class="aib-bookmark-btn aib-bookmark-btn-primary" @click="handleConfirm">确认收藏</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.aib-bookmark-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: var(--aib-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.aib-bookmark-dialog {
  width: 420px;
  max-width: 90vw;
  background: var(--aib-bg-card);
  border: 1px solid var(--aib-border);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.4);
  overflow: hidden;
}
.aib-bookmark-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--aib-border, rgba(255,255,255,0.08));
  font-size: 15px;
  font-weight: 600;
  color: var(--aib-text);
}
.aib-bookmark-close {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--aib-text-soft);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.aib-bookmark-close:hover {
  background: var(--aib-bg-hover);
  color: var(--aib-text);
}
.aib-bookmark-body {
  padding: 16px 18px;
}
.aib-bookmark-label {
  display: block;
  font-size: 13px;
  color: var(--aib-text-soft);
  margin-bottom: 6px;
}
.aib-bookmark-input-wrap {
  position: relative;
}
.aib-bookmark-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--aib-border);
  border-radius: 8px;
  background: var(--aib-bg-hover);
  color: var(--aib-text);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
  box-sizing: border-box;
}
.aib-bookmark-input:focus {
  border-color: var(--aib-primary);
}
.aib-bookmark-input::placeholder {
  color: var(--aib-text-soft);
}
.aib-bookmark-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  background: var(--aib-bg-card);
  border: 1px solid var(--aib-border);
  border-radius: 8px;
  max-height: 150px;
  overflow-y: auto;
  z-index: 10;
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
.aib-bookmark-suggestion {
  padding: 8px 12px;
  font-size: 13px;
  color: var(--aib-text);
  cursor: pointer;
  transition: background 0.1s ease;
}
.aib-bookmark-suggestion:hover {
  background: var(--aib-bg-hover);
}
.aib-bookmark-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--aib-border, rgba(255,255,255,0.08));
}
.aib-bookmark-btn {
  padding: 6px 16px;
  border: 1px solid var(--aib-border);
  border-radius: 8px;
  background: transparent;
  color: var(--aib-text-soft);
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.15s ease;
}
.aib-bookmark-btn:hover {
  background: var(--aib-bg-hover);
  color: var(--aib-text);
}
.aib-bookmark-btn-primary {
  background: var(--aib-primary);
  border-color: var(--aib-primary);
  color: var(--aib-text-on-primary);
}
.aib-bookmark-btn-primary:hover {
  opacity: 0.9;
  background: var(--aib-primary);
  color: var(--aib-text-on-primary);
}
</style>
