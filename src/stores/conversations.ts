import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { v4 as uuid } from 'uuid';
import type { ChatMessage, Conversation } from '@/src/types';
import {
  conversationStorage,
  conversationsStorageOld,
} from '@/src/storage';
import { useSettingsStore } from './settings';
import { createAdapter } from '@/src/adapters';
import { defineStorageSync } from '@/src/utils/storage-sync';
import { Logger } from '@/src/utils/logger';

const log = new Logger('Store:Conversations');

export const useConversationsStore = defineStore('zwf-conversations', () => {
  /** 单一会话（不再支持多会话） */
  const conversation = ref<Conversation | null>(null);
  const ready = ref(false);
  /** 标记会话上下文是否已被清除（清除后下次发送不携带历史上下文） */
  const contextCleared = ref(false);
  /** AbortController，便于停止流式请求 */
  let currentAborter: AbortController | null = null;

  /** 兼容旧接口：active 指向唯一的会话 */
  const active = computed<Conversation | undefined>(() => conversation.value ?? undefined);

  // 跨页面 + 防抖持久化（单会话）
  defineStorageSync<Conversation | null>({
    source: conversation,
    storage: conversationStorage,
    ready,
    applyRemote: (nv) => {
      if (nv && typeof nv === 'object' && Array.isArray((nv as any).messages)) {
        conversation.value = nv as Conversation;
      }
    },
  });

  /** 初始化：读取本地数据，兼容旧的多会话格式 */
  async function init() {
    log.info('初始化会话数据');

    // 先尝试读取新格式（单会话）
    const stored = await conversationStorage.getValue();
    if (stored && typeof stored === 'object' && Array.isArray((stored as any).messages)) {
      conversation.value = stored as Conversation;
      log.info('从新格式存储加载会话', { id: conversation.value.id });
    } else {
      // 兼容旧格式：从多会话数组迁移
      const oldStored = await conversationsStorageOld.getValue();
      if (Array.isArray(oldStored) && oldStored.length > 0) {
        const first = oldStored[0];
        if (first && typeof first === 'object' && Array.isArray((first as any).messages)) {
          conversation.value = first;
          log.info('从旧格式迁移会话', { id: conversation.value.id });
          // 保存到新格式并清理旧数据
          await saveConversation();
          await conversationsStorageOld.setValue([]);
        }
      }
    }

    // 如果没有会话，创建一个
    if (!conversation.value) {
      conversation.value = createDefaultConversation();
      await saveConversation();
    }

    ready.value = true;
    log.info('会话数据加载完成', { id: conversation.value.id, messageCount: conversation.value.messages.length });
  }

  /** 创建默认会话（仅初始化时使用） */
  function createDefaultConversation(): Conversation {
    const settings = useSettingsStore().settings;
    return {
      id: uuid(),
      title: '新对话',
      messages: [],
      modelId: settings.defaultModelId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /** 保存会话到存储（显式写入，用于迁移等场景） */
  async function saveConversation() {
    if (conversation.value) {
      conversation.value.updatedAt = Date.now();
      await conversationStorage.setValue(conversation.value);
    }
  }

  /** 清除当前会话的历史记录和上下文 */
  async function clearCurrent() {
    if (!conversation.value) return;
    // 中断进行中的请求
    if (currentAborter) {
      currentAborter.abort();
      currentAborter = null;
    }
    conversation.value.messages = [];
    conversation.value.title = '新对话';
    conversation.value.draftText = '';
    conversation.value.draftImages = [];
    conversation.value.updatedAt = Date.now();
    contextCleared.value = true;
    log.info('已清除当前会话历史和上下文');
  }

  /** 删除单条消息 */
  function deleteMessage(msgId: string) {
    if (!conversation.value) return;
    const idx = conversation.value.messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    conversation.value.messages.splice(idx, 1);
    conversation.value.updatedAt = Date.now();
  }

  function updateScroll(top: number) {
    if (conversation.value) conversation.value.scrollTop = top;
  }

  /** 截断会话的消息数到 maxContext */
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

  // ============ 流式发送 ============

  async function send(
    text: string,
    images: string[] = [],
    reasoningEnabled = false
  ) {
    if (!conversation.value) return;
    const conv = conversation.value;

    const settings = useSettingsStore().settings;
    log.info('send() 开始', { textLen: text.length, modelId: conv.modelId, contextCleared: contextCleared.value });

    const model = settings.models.find((m) => m.id === conv.modelId);
    if (!model) {
      log.error('未找到模型', { modelId: conv.modelId, availableModels: settings.models.map(m => m.id) });
      throw new Error('未找到当前会话使用的模型');
    }
    log.info('模型找到', { id: model.id, label: model.label, provider: model.provider, modelName: model.modelName });

    const effectiveBaseUrl = model.baseUrl || settings.baseUrl;
    const effectiveApiKey = model.apiKey || settings.apiKey;
    if (!effectiveApiKey) {
      log.error('无 API Key', { modelApiKey: !!model.apiKey, globalApiKey: !!settings.apiKey });
      throw new Error('请先在设置中配置 API Key');
    }
    log.info('API 配置', { baseUrl: effectiveBaseUrl.slice(0, 40) + '...', hasApiKey: !!effectiveApiKey });

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

    // 如果上下文被清除过，只发送当前用户消息（不携带历史）
    let requestMessages: ChatMessage[];
    if (contextCleared.value) {
      // 只取最后一条用户消息
      requestMessages = conv.messages.filter((m) => m.role === 'user' && m.id !== aiMsg.id).slice(-1);
      contextCleared.value = false; // 重置标记，后续消息恢复正常上下文
    } else {
      enforceMaxContext(conv);
      requestMessages = buildRequestMessages(conv).filter((m) => m.id !== aiMsg.id);
    }

    const adapter = createAdapter(model.provider);
    const ac = new AbortController();
    currentAborter = ac;

    try {
      await adapter.chat(
        {
          baseUrl: model.baseUrl || settings.baseUrl,
          apiKey: model.apiKey || settings.apiKey,
          modelName: model.modelName,
          apiFormat: model.apiFormat,
          messages: requestMessages,
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
      log.info('消息发送完成', { contentLength: aiMsg.content.length });
    } catch (e: any) {
      if (e?.name === 'AbortError' || ac.signal.aborted) {
        aiMsg.status = 'aborted';
        log.info('消息已中止');
      } else {
        log.error('消息发送失败', { error: e?.message });
        aiMsg.status = 'error';
        aiMsg.errorMessage = e?.message || '请求失败';
      }
    } finally {
      if (currentAborter === ac) currentAborter = null;
    }
  }

  function abort() {
    log.debug('中止请求');
    currentAborter?.abort();
    currentAborter = null;
  }

  return {
    conversation,
    active,
    ready,
    contextCleared,
    init,
    clearCurrent,
    deleteMessage,
    updateScroll,
    send,
    abort,
  };
});
