<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import FloatingButton from './components/FloatingButton.vue';
import ChatDrawer from './components/ChatDrawer.vue';
import SettingsModal from './components/SettingsModal.vue';
import NoteBookmarkDialog from './components/NoteBookmarkDialog.vue';
import NoteViewerDialog from './components/NoteViewerDialog.vue';
import ToastContainer from './components/ToastContainer.vue';
import { useSettingsStore } from '@/src/stores/settings';
import { useConversationsStore } from '@/src/stores/conversations';
import { useVoiceStore } from '@/src/stores/voice';
import { usePipeline } from '@/src/composables/usePipeline';
import { VoiceManager } from '@/src/voice/voice-manager';
import { useNotesStore } from '@/src/stores/notes';
import { matchShortcut } from '@/src/utils/shortcut';
import { getThemeById } from '@/src/themes';
import { drawerOpenStorage } from '@/src/storage';
import { executeAutomationAction } from '@/src/automation/actions';
import { initI18n, useI18n } from '@/src/i18n';
import { Logger } from '@/src/utils/logger';
import { v4 as uuid } from 'uuid';
import type { NoteEntry } from '@/src/types';

const log = new Logger('App');

const open = ref(false);
const showSettings = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const settingsStore = useSettingsStore();
const convStore = useConversationsStore();
const notesStore = useNotesStore();
const voiceStore = useVoiceStore();
const pipeline = usePipeline();
const { setLocale } = useI18n();

// ========== 统一语音管理（App.vue 持有，VoicePanel 只显示） ==========
let bgManager: VoiceManager | null = null
const spokenMsgIds = new Set<string>()

function stripMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1').replace(/[#*_~>|]/g, '').trim()
}

function getSpeakText(msg: { role: string; content: string }): string | null {
  if (msg.role !== 'assistant') return null
  const c = msg.content
  if (c.startsWith('已执行：')) return '好的'
  if (c.includes('[FILE:') || c.includes('[FILE：')) return '文件已下载'
  if (c === '正在执行操作...') return null
  if (c.startsWith('❌')) return stripMarkdown(c)
  if (c.startsWith('💬')) return stripMarkdown(c)
  if (c.startsWith('🔧') || c.startsWith('🔄') || c.startsWith('📝') || c.startsWith('⏹') || c.startsWith('✅')) return null
  return stripMarkdown(c)
}

function startBgVoice() {
  if (bgManager) return
  const s = voiceStore.settings
  log.info('常驻语音启动')
  bgManager = new VoiceManager({
    engineType: s.engineType,
    iflytekConfig: s.engineType === 'iflytek' ? { appId: s.iflytekAppId, apiKey: s.iflytekApiKey } : undefined,
    lang: s.recognitionLang,
    wakeWord: s.wakeWord,
    enableTts: s.enableTts,
    ttsRate: s.ttsRate,
    ttsVolume: s.ttsVolume,
    bufferTimeout: s.bufferTimeout,
    idleTimeout: s.idleTimeout,
    onStateChange: (state) => voiceStore.setSessionState(
      state === 'idle' ? 'idle' : state === 'wake' ? 'wake' : state === 'command' ? 'command' : state === 'processing' ? 'processing' : 'speaking'
    ),
    onInterimText: (text) => voiceStore.updateText(text, false),
    onUserMessage: (text) => {
      voiceStore.updateText(text, true)
      if (convStore.conversation) {
        convStore.conversation.messages.push({
          id: Date.now().toString(), role: 'user', content: text, timestamp: Date.now(), status: 'done',
        })
      }
    },
    onError: (error) => log.error('常驻语音错误', error),
  })
  bgManager.onProcessText = async (text: string) => {
    try { await pipeline.processInput(text) } catch (e) { log.error('管线处理失败', e) }
  }
  bgManager.start()
}

function stopBgVoice() {
  if (!bgManager) return
  log.info('常驻语音停止')
  bgManager.destroy()
  bgManager = null
}

// TTS：watch assistant 消息（常驻模式）
watch(
  () => {
    const msgs = convStore.conversation?.messages
    if (!msgs?.length) return ''
    const last = msgs[msgs.length - 1]
    return `${last.role}:${last.status}:${last.content}`
  },
  (val) => {
    if (!bgManager?.isActive || !val) return
    const msgs = convStore.conversation?.messages
    if (!msgs?.length) return
    const lastMsg = msgs[msgs.length - 1]
    if (lastMsg.role === 'assistant' && lastMsg.status === 'done') {
      if (spokenMsgIds.has(lastMsg.id)) return
      spokenMsgIds.add(lastMsg.id)
      if (spokenMsgIds.size > 100) {
        const arr = [...spokenMsgIds]; arr.slice(0, 50).forEach(id => spokenMsgIds.delete(id))
      }
      const speakText = getSpeakText(lastMsg)
      if (speakText) bgManager.speak(speakText)
    }
  },
)

// 常驻语音开关
watch(
  () => voiceStore.settings.alwaysOnVoice,
  (on) => { if (on) startBgVoice(); else stopBgVoice() },
  { immediate: true },
)

// 常驻模式下设置变更 → 重建 bgManager
watch(
  () => voiceStore.settingsVersion,
  () => {
    if (voiceStore.settings.alwaysOnVoice && bgManager) {
      log.info('常驻语音设置变更，重建 bgManager')
      stopBgVoice()
      startBgVoice()
    }
  },
)

// 抽屉开关 → 非常驻模式管理引擎生命周期
watch(open, (isOpen) => {
  if (voiceStore.settings.alwaysOnVoice) return // 常驻模式不随抽屉变化
  if (isOpen) { startBgVoice() } else { stopBgVoice() }
})

// 笔记收藏弹框状态
const showBookmarkDialog = ref(false);
const bookmarkData = ref<{ content: string; url: string; scrollY: number; selectedText?: string; source: NoteEntry['source'] } | null>(null);

// 笔记查看弹框状态
const showNoteViewer = ref(false);

function toggleNoteViewer() {
  showNoteViewer.value = !showNoteViewer.value;
}

// 关闭聊天抽屉（供笔记跳转前调用）
function closeDrawer() {
  open.value = false;
}

function toggle() {
  open.value = !open.value;
}

function onMessage(msg: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) {
  if (msg?.type === 'aib-toggle') toggle();

  // 接收其他标签页的抽屉状态同步
  if (msg?.type === 'aib-drawer-sync') {
    if (msg.open !== open.value) {
      syncingFromRemote = true;
      open.value = msg.open;
      nextTick(() => (syncingFromRemote = false));
    }
  }

  // 自动化指令执行（来自 VoicePanel）
  if (msg?.type === 'automation') {
    log.info('收到自动化指令', { action: msg.action, params: msg.params });
    try {
      const result = executeAutomationAction(msg.action, msg.params || {});
      log.info('自动化指令执行结果', { action: msg.action, success: result.success, message: result.message });
      sendResponse(result);
    } catch (error) {
      log.error('自动化指令执行异常', error);
      sendResponse({ success: false, message: String(error) });
    }
    return true; // 异步响应
  }
}

function onKeydown(e: KeyboardEvent) {
  const sc = settingsStore.settings.shortcut;
  if (matchShortcut(e, sc)) {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  }
}

/** 鼠标松开时检测选中文字，根据设置处理 */
function onMouseup(e: MouseEvent) {
  // 抽屉未打开，不处理
  if (!open.value) return;
  // 功能关闭，不处理（兼容旧版布尔值 false）
  const mode = settingsStore.settings.autoSendSelection;
  if (mode === 'off' || (mode as unknown) === false) return;

  // 过滤：事件来自扩展自身 Shadow DOM 内的不处理（避免聊天面板内操作被干扰）
  const rootNode = rootEl.value?.getRootNode();
  if (rootNode instanceof ShadowRoot) {
    const hostEl = rootNode.host as HTMLElement;
    // composedPath 包含 shadow host → 事件源自扩展内部
    if (e.composedPath().includes(hostEl)) return;
    // 额外检查：eventTarget 在 shadow DOM 内也不处理
    if (hostEl.contains(e.target as Node)) return;
  }

  const selection = document.getSelection();
  const text = selection?.toString().trim();
  if (!text) return;

  if (mode === 'manual') {
    // 手动模式：填入输入框，不自动发送
    if (convStore.conversation) {
      convStore.conversation.draftText = text;
    }
  } else {
    // 自动模式：直接发送给 AI
    convStore.send(text);
  }
}

/** 应用主题 CSS 变量到 shadow host */
function applyTheme() {
  const el = rootEl.value;
  if (!el) return;
  const root = el.getRootNode();
  const host = root instanceof ShadowRoot ? (root.host as HTMLElement) : el;
  const theme = getThemeById(settingsStore.settings.theme);
  for (const [key, value] of Object.entries(theme.vars)) {
    host.style.setProperty(key, value);
  }
  // 兼容旧版 primaryColor
  host.style.setProperty('--aib-primary', theme.vars['--aib-primary'] || settingsStore.settings.primaryColor);
  host.style.setProperty('--aib-drawer-width', '480px');
}

watch(
  () => settingsStore.settings.theme,
  () => applyTheme()
);

watch(
  () => settingsStore.settings.locale,
  (val) => { if (val) setLocale(val as 'zh-CN' | 'en-US'); }
);

// 同步抽屉展开状态到持久化存储（跨页面/标签页保持）
let syncingFromRemote = false;
watch(open, async (val) => {
  if (syncingFromRemote) return;
  await drawerOpenStorage.setValue(val);
  chrome.runtime?.sendMessage?.({ type: 'aib-drawer-changed', open: val }).catch?.(() => {});
});

// 处理自动笔记占位消息：插入一条 assistant 消息
function onAutoNoteStart(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (!detail?.id || !convStore.conversation) return;

  convStore.conversation.messages.push({
    id: detail.id,
    role: 'assistant',
    content: detail.content || '📝 正在生成笔记...',
    timestamp: Date.now(),
    status: 'streaming',
  });
  convStore.conversation.updatedAt = Date.now();
}

// 处理自动笔记流式增量：更新消息内容
function onAutoNoteDelta(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (!detail?.content || !convStore.conversation) return;

  const existing = convStore.conversation.messages.find((m) => m.id === detail.id);
  if (existing) {
    existing.content = detail.content;
  }
}

// 处理自动笔记结果：更新消息为最终内容
function onAutoNoteResult(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (!detail?.content || !convStore.conversation) return;

  // 查找占位消息并更新
  const existing = convStore.conversation.messages.find((m) => m.id === detail.id);
  if (existing) {
    existing.content = detail.content;
    existing.status = 'done';
  } else {
    // 兜底：找不到占位消息，直接插入新消息
    convStore.conversation.messages.push({
      id: detail.id || uuid(),
      role: 'assistant',
      content: detail.content,
      timestamp: Date.now(),
      status: 'done',
    });
  }
  convStore.conversation.updatedAt = Date.now();
  log.info('[自动笔记] 已更新聊天消息', { length: detail.content.length });
}

// 处理笔记收藏请求：打开收藏弹框
function onBookmarkNote(e: Event) {
  const detail = (e as CustomEvent).detail;
  if (!detail?.content) return;
  bookmarkData.value = {
    content: detail.content,
    url: detail.url || '',
    scrollY: detail.scrollY || 0,
    selectedText: detail.selectedText,
    source: detail.source || 'selection',
  };
  showBookmarkDialog.value = true;
}

onMounted(async () => {
  try {
    await Promise.all([settingsStore.init(), convStore.init(), notesStore.init()]);
  } catch (error) {
    log.error('Store 初始化失败:', error);
  }
  initI18n(settingsStore.settings.locale || 'zh-CN');
  applyTheme();

  // 从持久化存储恢复抽屉展开状态（异步读取，确保从磁盘加载）
  try {
    const savedOpen = await drawerOpenStorage.getValue();
    if (savedOpen) open.value = true;
  } catch (error) {
    log.error('读取抽屉状态失败:', error);
  }

  chrome.runtime?.onMessage?.addListener(onMessage);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mouseup', onMouseup, true);
  window.addEventListener('aib-auto-note-start', onAutoNoteStart);
  window.addEventListener('aib-auto-note-delta', onAutoNoteDelta);
  window.addEventListener('aib-auto-note-result', onAutoNoteResult);
  window.addEventListener('aib-bookmark-note', onBookmarkNote);
  window.addEventListener('aib-toggle-note-viewer', toggleNoteViewer);
  window.addEventListener('aib-close-drawer', closeDrawer);
});

onUnmounted(() => {
  chrome.runtime?.onMessage?.removeListener?.(onMessage);
  document.removeEventListener('keydown', onKeydown, true);
  document.removeEventListener('mouseup', onMouseup, true);
  window.removeEventListener('aib-auto-note-start', onAutoNoteStart);
  window.removeEventListener('aib-auto-note-delta', onAutoNoteDelta);
  window.removeEventListener('aib-auto-note-result', onAutoNoteResult);
  window.removeEventListener('aib-bookmark-note', onBookmarkNote);
  window.removeEventListener('aib-toggle-note-viewer', toggleNoteViewer);
  window.removeEventListener('aib-close-drawer', closeDrawer);
});
</script>

<template>
  <div ref="rootEl">
    <FloatingButton @click="toggle" />
    <ChatDrawer
      :open="open"
      @close="open = false"
      @open-settings="showSettings = true"
    />
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
    <NoteBookmarkDialog
      v-if="showBookmarkDialog && bookmarkData"
      :data="bookmarkData"
      @close="showBookmarkDialog = false; bookmarkData = null"
    />
    <NoteViewerDialog
      v-if="showNoteViewer"
      @close="showNoteViewer = false"
    />
    <ToastContainer />
  </div>
</template>
