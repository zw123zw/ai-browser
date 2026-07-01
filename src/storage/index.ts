import { storage } from 'wxt/storage';
import type { AppSettings, Conversation, ModelConfig, NotesData, Provider, EngineConf } from '@/src/types';
import rawModels from '@/src/local-config.json';
import voiceConfig from '@/src/voice-config.json';

/** 从引擎配置数组中按类型查找配置项 */
function findEngineConf(type: string): Record<string, string> {
  if (!Array.isArray(voiceConfig)) return {}
  return voiceConfig.find((c: any) => c.engineType === type) || {}
}

export { findEngineConf }

/** 从 local-config.json 映射到 ModelConfig */
function parseLocalModels(list: any[]): ModelConfig[] {
  return list.map((m) => {
    // baseUrl 末尾去掉 /chat/completions（adapter 会自动拼）
    let baseUrl = m.baseUrl || '';
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, '');
    const id = m.id || m.modelName || m.model || `model-${Date.now()}`;
    const modelName = m.modelName || m.model || id;
    const label = m.label || modelName;
    const provider = (m.provider || 'openai') as Provider;
    return {
      id,
      label,
      provider,
      modelName,
      baseUrl,
      apiKey: m.apiKey || '',
      website: m.website || '',
    };
  });
}

const localModels = parseLocalModels(rawModels);

/** 从 voice-config.json 解析引擎默认配置 */
function parseEngineConfs(): EngineConf[] {
  if (!Array.isArray(voiceConfig)) return []
  return voiceConfig.map((c: any) => ({
    engineType: c.engineType || '',
    appId: c.appId || '',
    apiKey: c.apiKey || '',
    apiSecret: c.apiSecret || '',
  }))
}

/** 默认设置（从 local-config.json + voice-config.json 读取） */
export const DEFAULT_SETTINGS: AppSettings = {
  provider: 'openai',
  baseUrl: localModels[0]?.baseUrl || 'https://api.openai.com/v1',
  apiKey: localModels[0]?.apiKey || '',
  authField: localModels[0]?.authField || 'bearer',
  defaultModelId: localModels[0]?.id || '',
  drawerWidth: 480,
  primaryColor: '#4f46e5',
  theme: 'classic',
  shortcut: 'Ctrl+`',
  maxConversations: 100,
  maxContext: 100,
  autoSendSelection: 'auto',
  translateTargetLang: '中文',
  translateMode: 'off',
  noteMode: 'off',
  automationEnabled: true,
  locale: 'zh-CN',
  models: localModels,

  // 语音默认值
  voiceEngineType: 'web-speech',
  voiceAppId: '',
  voiceApiKey: '',
  voiceApiSecret: '',
  voiceEngineConfs: parseEngineConfs(),
  voiceRecognitionLang: 'zh-CN',
  voiceWakeWord: '你好，小灵',
  voiceAlwaysOn: false,
  voiceEnableTts: true,
  voiceTtsRate: 1.8,
  voiceTtsVolume: 0.8,
  voiceBufferTimeout: 2000,
  voiceIdleTimeout: 4000,
  voiceMode: 'chat',

  // 用户数据默认值
  inputHistory: [],
};

/** 存储键 */
const KEY_SETTINGS = 'local:ai-browser-settings';
const KEY_CONVERSATION = 'local:ai-browser-conversation';
const KEY_FAB_POS = 'local:ai-browser-fab-pos';

export const settingsStorage = storage.defineItem<AppSettings>(KEY_SETTINGS, {
  fallback: DEFAULT_SETTINGS,
});

/** 单会话存储（独立 key：体积大、含附件，与 settings 隔离） */
export const conversationStorage = storage.defineItem<Conversation | null>(
  KEY_CONVERSATION,
  { fallback: null }
);

/** 笔记数据存储（独立 key） */
export const notesStorage = storage.defineItem<NotesData>(
  'local:ai-browser-notes',
  { fallback: { titles: [] } }
);

/** 悬浮按钮位置 (距离视口右下角) */
export interface FabPos {
  right: number;
  bottom: number;
}
export const fabPosStorage = storage.defineItem<FabPos>(KEY_FAB_POS, {
  fallback: { right: 24, bottom: 24 },
});

/** 抽屉展开状态（跨页面持久化） */
export const drawerOpenStorage = storage.defineItem<boolean>('local:ai-browser-drawer-open', {
  fallback: false,
});

/** 跨标签页排队任务（navigate/click 导航后，新页自动恢复执行） */
export interface QueuedTask {
  originalRequest: string
  completedSteps: Array<{ action: string; elementId?: string; description?: string }>
  recentMessages?: Array<{ role: string; content: string }>
  timestamp: number
}
export const queuedTaskStorage = storage.defineItem<QueuedTask | null>(
  'local:aib-queued-task',
  { fallback: null }
)
