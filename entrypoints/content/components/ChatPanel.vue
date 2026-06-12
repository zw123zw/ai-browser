<script setup lang="ts">
import { computed, ref } from 'vue';
import { useConversationsStore } from '@/src/stores/conversations';
import { useSettingsStore } from '@/src/stores/settings';
import { useToast } from '@/src/composables/useToast';
import MessageList from './MessageList.vue';
import InputBar from './InputBar.vue';
import ConfirmDialog from './ConfirmDialog.vue';

const convStore = useConversationsStore();
const settingsStore = useSettingsStore();
const toast = useToast();

const search = ref('');
const filtered = computed(() => {
  const s = search.value.trim().toLowerCase();
  const list = [...convStore.conversations].sort(
    (a, b) => b.updatedAt - a.updatedAt
  );
  if (!s) return list;
  return list.filter((c) => c.title.toLowerCase().includes(s));
});

function pickConversation(id: string) {
  convStore.selectConversation(id);
}

async function onSend(payload: { text: string; images: string[]; reasoning: boolean }) {
  const conv = convStore.active;
  if (!conv) return;
  const text = payload.reasoning
    ? `[请按深度思考的方式作答，先给出完整推理过程，再给出最终答案]\n\n${payload.text}`
    : payload.text;
  try {
    await convStore.send(conv.id, text, payload.images, payload.reasoning);
  } catch (e: any) {
    toast.error(e?.message || '发送失败');
  }
}

function onAbort() {
  if (!convStore.active) return;
  convStore.abort(convStore.active.id);
}

// === 删除会话二次确认 ===
const pendingDeleteId = ref<string | null>(null);
const pendingDeleteTitle = computed(
  () =>
    convStore.conversations.find((c) => c.id === pendingDeleteId.value)?.title ||
    '新对话'
);
function askDelete(id: string, e: Event) {
  e.stopPropagation();
  pendingDeleteId.value = id;
}
function confirmDelete() {
  if (!pendingDeleteId.value) return;
  convStore.deleteConversation(pendingDeleteId.value);
  pendingDeleteId.value = null;
}

function fmtTime(t: number) {
  const d = new Date(t);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
</script>

<template>
  <div class="zwf-panel">
    <!-- 左侧 -->
    <aside class="zwf-side">
      <div class="zwf-side-search">
        <div class="zwf-search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="zwf-search-icon">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input v-model="search" class="zwf-search-input" placeholder="搜索会话" />
        </div>
      </div>
      <div class="zwf-rooms">
        <div
          v-for="c in filtered"
          :key="c.id"
          :class="['zwf-room', { 'zwf-room-active': c.id === convStore.activeId }]"
          @click="pickConversation(c.id)"
        >
          <div class="zwf-room-content">
            <div class="zwf-room-title">{{ c.title || '新对话' }}</div>
            <div class="zwf-room-meta">
              <span>{{ c.messages.length }} 条消息</span>
              <span class="zwf-room-time">{{ fmtTime(c.updatedAt) }}</span>
            </div>
          </div>
          <button class="zwf-room-del" title="删除" @click="askDelete(c.id, $event)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
          </button>
        </div>
        <div v-if="!filtered.length" class="zwf-rooms-empty">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <div class="zwf-rooms-empty-text">还没有会话</div>
          <button class="zwf-btn zwf-btn-primary zwf-btn-sm" @click="convStore.createConversation()">
            开始新对话
          </button>
        </div>
      </div>
    </aside>

    <!-- 右侧 -->
    <section class="zwf-main">
      <template v-if="convStore.active">
        <div class="zwf-main-body">
          <MessageList :conversation="convStore.active" />
        </div>
        <footer class="zwf-main-footer">
          <InputBar
            :conversation="convStore.active"
            :models="settingsStore.settings.models"
            @send="onSend"
            @abort="onAbort"
          />
        </footer>
      </template>
      <div v-else class="zwf-main-empty">
        <div class="zwf-empty-illust">
          <svg width="120" height="120" viewBox="0 0 200 200" fill="currentColor"
            class="zwf-empty-svg">
            <circle cx="100" cy="100" r="86" opacity="0.12" />
            <path d="M58 78c0-7 6-13 13-13h58c7 0 13 6 13 13v40c0 7-6 13-13 13H92l-18 16v-16h-3c-7 0-13-6-13-13V78z" />
            <circle cx="84" cy="98" r="5" fill="#fff" />
            <circle cx="100" cy="98" r="5" fill="#fff" />
            <circle cx="116" cy="98" r="5" fill="#fff" />
          </svg>
        </div>
        <div class="zwf-empty-title">开启你的第一段对话</div>
        <div class="zwf-empty-desc">提问、写代码、分析图片，随时通过快捷键唤起</div>
        <button class="zwf-btn zwf-btn-primary" @click="convStore.createConversation()">
          + 新建会话
        </button>
      </div>
    </section>

    <!-- 删除会话确认 -->
    <ConfirmDialog
      :visible="!!pendingDeleteId"
      title="删除会话"
      :desc="`确定删除会话「${pendingDeleteTitle}」吗？删除后无法恢复。`"
      confirm-text="确认删除"
      variant="danger"
      @confirm="confirmDelete"
      @cancel="pendingDeleteId = null"
    >
      <template #icon>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      </template>
    </ConfirmDialog>
  </div>
</template>
