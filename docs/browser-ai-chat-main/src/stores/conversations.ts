import { defineStore } from 'pinia';
import { computed, reactive, ref, watch } from 'vue';
import { v4 as uuid } from 'uuid';
import type { ChatMessage, Conversation } from '@/src/types';
import {
  activeIdStorage,
  conversationsStorage,
  fabPosStorage,
  settingsStorage,
} from '@/src/storage';
import { useSettingsStore } from './settings';
import { createAdapter } from '@/src/adapters';
import { defineStorageSync } from '@/src/utils/storage-sync';

export const useConversationsStore = defineStore('zwf-conversations', () => {
  const conversations = ref<Conversation[]>([]);
  const activeId = ref<string>('');
  const ready = ref(false);
  /** 每个会话的 AbortController，便于停止 */
  const aborters = new Map<string, AbortController>();

  const active = computed<Conversation | undefined>(() =>
    conversations.value.find((c) => c.id === activeId.value)
  );

  // 跨页面 + 防抖持久化
  defineStorageSync<Conversation[]>({
    source: conversations,
    storage: conversationsStorage,
    ready,
    applyRemote: (nv) => {
      if (Array.isArray(nv)) conversations.value = nv;
    },
  });

  // activeId 单独同步（轻量，不走 deep watch）
  let activeIdSelfWrite = 0;
  activeIdStorage.watch((nv) => {
    if (typeof nv !== 'string') return;
    if (Date.now() - activeIdSelfWrite < 500) return;
    activeId.value = nv;
  });
  watch(activeId, (v) => {
    if (!ready.value) return;
    activeIdSelfWrite = Date.now();
    activeIdStorage.setValue(v);
  });

  /** 初始化：读取并清洗本地数据 */
  async function init() {
    const list = await conversationsStorage.getValue();
    if (Array.isArray(list)) {
      conversations.value = list.filter(
        (c) => c && typeof c === 'object' && Array.isArray((c as any).messages)
      );
    } else {
      conversations.value = [];
      await conversationsStorage.setValue([]);
    }
    const aid = await activeIdStorage.getValue();
    if (typeof aid === 'string' && conversations.value.find((c) => c.id === aid)) {
      activeId.value = aid;
    } else if (conversations.value.length) {
      activeId.value = conversations.value[0].id;
    }
    ready.value = true;
  }

  // ============ 会话 CRUD ============

  function createConversation(): Conversation {
    const settings = useSettingsStore().settings;
    const conv: Conversation = {
      id: uuid(),
      title: '新对话',
      messages: [],
      modelId: settings.defaultModelId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    conversations.value.unshift(conv);
    activeId.value = conv.id;
    enforceMaxConversations();
    return conv;
  }

  function selectConversation(id: string) {
    activeId.value = id;
  }

  function deleteConversation(id: string) {
    const idx = conversations.value.findIndex((c) => c.id === id);
    if (idx === -1) return;
    conversations.value.splice(idx, 1);
    if (activeId.value === id) {
      activeId.value = conversations.value[0]?.id || '';
    }
  }

  function deleteMessage(convId: string, msgId: string) {
    const conv = conversations.value.find((c) => c.id === convId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    conv.messages.splice(idx, 1);
    conv.updatedAt = Date.now();
  }

  function updateScroll(id: string, top: number) {
    const c = conversations.value.find((x) => x.id === id);
    if (c) c.scrollTop = top;
  }

  /** 删除最早的，超过设置的最大会话数时执行 */
  function enforceMaxConversations() {
    const max = useSettingsStore().settings.maxConversations;
    if (conversations.value.length <= max) return;
    const sorted = [...conversations.value].sort(
      (a, b) => a.createdAt - b.createdAt
    );
    const toRemove = new Set(
      sorted.slice(0, conversations.value.length - max).map((c) => c.id)
    );
    conversations.value = conversations.value.filter(
      (c) => !toRemove.has(c.id)
    );
  }

  /** 截断每个会话的消息数到 maxContext */
  function enforceMaxContext(conv: Conversation) {
    const max = useSettingsStore().settings.maxContext;
    if (conv.messages.length <= max) return;
    conv.messages.splice(0, conv.messages.length - max);
  }

  /** 取最近 N 条作为请求上下文 */
  function buildRequestMessages(conv: Conversation): ChatMessage[] {
    const max = useSettingsStore().settings.maxContext;
    return conv.messages.slice(-max);
  }

  /** 一键清除所有本地数据并重置默认 */
  async function clearAll() {
    // 中断进行中的请求
    aborters.forEach((ac) => ac.abort());
    aborters.clear();
    await Promise.all([
      conversationsStorage.removeValue(),
      activeIdStorage.removeValue(),
      settingsStorage.removeValue(),
      fabPosStorage.removeValue(),
    ]);
    conversations.value = [];
    activeId.value = '';
    // settings 由 settings store 自己 init 重置
  }

  // ============ 流式发送 ============

  async function send(
    convId: string,
    text: string,
    images: string[] = [],
    reasoningEnabled = false
  ) {
    const conv = conversations.value.find((c) => c.id === convId);
    if (!conv) return;

    const settings = useSettingsStore().settings;
    if (!settings.apiKey) {
      throw new Error('请先在设置中配置 API Key');
    }
    const model = settings.models.find((m) => m.id === conv.modelId);
    if (!model) throw new Error('未找到当前会话使用的模型');

    // 用户消息
    conv.messages.push({
      id: uuid(),
      role: 'user',
      content: text,
      images: images.length ? images : undefined,
      timestamp: Date.now(),
      status: 'done',
      reasoningEnabled,
    });
    if (conv.title === '新对话' && text) {
      conv.title = text.slice(0, 20);
    }

    // 占位 AI 消息（用 reactive 显式包装，确保流式更新触发渲染）
    const aiMsg = reactive<ChatMessage>({
      id: uuid(),
      role: 'assistant',
      content: '',
      reasoning: '',
      timestamp: Date.now(),
      status: 'streaming',
      reasoningEnabled,
    });
    conv.messages.push(aiMsg);
    conv.updatedAt = Date.now();
    enforceMaxContext(conv);

    const adapter = createAdapter(model.provider);
    const ac = new AbortController();
    aborters.set(convId, ac);

    try {
      await adapter.chat(
        {
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          modelName: model.modelName,
          messages: buildRequestMessages(conv).filter((m) => m.id !== aiMsg.id),
          signal: ac.signal,
        },
        (chunk) => {
          if (chunk.delta) aiMsg.content += chunk.delta;
          if (chunk.reasoningDelta) {
            aiMsg.reasoning = (aiMsg.reasoning || '') + chunk.reasoningDelta;
          }
          if (chunk.done) aiMsg.status = 'done';
          conv.updatedAt = Date.now();
        }
      );
      aiMsg.status = 'done';
    } catch (e: any) {
      if (e?.name === 'AbortError' || ac.signal.aborted) {
        aiMsg.status = 'aborted';
      } else {
        console.warn('[ZWF] chat error:', e);
        aiMsg.status = 'error';
        aiMsg.errorMessage = e?.message || '请求失败';
      }
    } finally {
      aborters.delete(convId);
    }
  }

  function abort(convId: string) {
    aborters.get(convId)?.abort();
    aborters.delete(convId);
  }

  return {
    conversations,
    activeId,
    active,
    ready,
    init,
    createConversation,
    selectConversation,
    deleteConversation,
    deleteMessage,
    updateScroll,
    send,
    abort,
    clearAll,
  };
});
