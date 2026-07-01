import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AppSettings } from '@/src/types';
import { DEFAULT_SETTINGS, settingsStorage } from '@/src/storage';
import { defineStorageSync, plain } from '@/src/utils/storage-sync';
import { Logger } from '@/src/utils/logger';

const log = new Logger('Store:Settings');

/** 旧 storage key（迁移用） */
const OLD_KEYS = {
  voice: 'local:voice-settings',
  inputHistory: 'local:ai-browser-input-history',
} as const;

export const useSettingsStore = defineStore('aib-settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS });
  const ready = ref(false);

  /** 安全合并：保证 models 一定是数组、defaultModelId 始终有效 */
  function mergeSettings(v: Partial<AppSettings>): AppSettings {
    const merged = { ...DEFAULT_SETTINGS, ...v };
    if (!Array.isArray(merged.models) || merged.models.length === 0) {
      merged.models = DEFAULT_SETTINGS.models;
    }
    // 修复无 id 的模型
    merged.models = merged.models.map((m, i) => ({
      ...m,
      id: m.id || m.modelName || `model-${i}`,
      label: m.label || m.modelName || `模型 ${i + 1}`,
    }));
    if (
      !merged.defaultModelId ||
      !merged.models.find((m) => m.id === merged.defaultModelId)
    ) {
      merged.defaultModelId = merged.models[0].id;
    }
    // 确保 voiceEngineConfs 有值
    if (!Array.isArray(merged.voiceEngineConfs) || merged.voiceEngineConfs.length === 0) {
      merged.voiceEngineConfs = DEFAULT_SETTINGS.voiceEngineConfs || [];
    }
    return merged;
  }

  const sync = defineStorageSync<AppSettings>({
    source: settings,
    storage: settingsStorage,
    ready,
    applyRemote: (nv) => {
      if (nv && typeof nv === 'object' && !Array.isArray(nv)) {
        settings.value = mergeSettings(nv);
      }
    },
  });

  /** 迁移旧 storage key 到 AppSettings */
  async function migrateOldKeys() {
    try {
      const result = await chrome.storage.local.get([
        OLD_KEYS.voice,
        OLD_KEYS.inputHistory,
      ]);

      let migrated = false;

      // 迁移语音设置
      const oldVoice = result[OLD_KEYS.voice] as any;
      if (oldVoice && typeof oldVoice === 'object') {
        log.info('迁移旧语音设置', { engineType: oldVoice.engineType });
        if (oldVoice.engineType) settings.value.voiceEngineType = oldVoice.engineType;
        if (oldVoice.appId) settings.value.voiceAppId = oldVoice.appId;
        if (oldVoice.apiKey) settings.value.voiceApiKey = oldVoice.apiKey;
        if (oldVoice.apiSecret) settings.value.voiceApiSecret = oldVoice.apiSecret;
        if (oldVoice.engineConfs?.length) settings.value.voiceEngineConfs = oldVoice.engineConfs;
        if (oldVoice.recognitionLang) settings.value.voiceRecognitionLang = oldVoice.recognitionLang;
        if (oldVoice.wakeWord) settings.value.voiceWakeWord = oldVoice.wakeWord;
        if (oldVoice.alwaysOnVoice !== undefined) settings.value.voiceAlwaysOn = oldVoice.alwaysOnVoice;
        if (oldVoice.enableTts !== undefined) settings.value.voiceEnableTts = oldVoice.enableTts;
        if (oldVoice.ttsRate !== undefined) settings.value.voiceTtsRate = oldVoice.ttsRate;
        if (oldVoice.ttsVolume !== undefined) settings.value.voiceTtsVolume = oldVoice.ttsVolume;
        if (oldVoice.bufferTimeout !== undefined) settings.value.voiceBufferTimeout = oldVoice.bufferTimeout;
        if (oldVoice.idleTimeout !== undefined) settings.value.voiceIdleTimeout = oldVoice.idleTimeout;
        migrated = true;
      }

      // 迁移输入历史
      const oldHistory = result[OLD_KEYS.inputHistory];
      if (Array.isArray(oldHistory) && oldHistory.length > 0 && (!settings.value.inputHistory || settings.value.inputHistory.length === 0)) {
        log.info('迁移旧输入历史', { count: oldHistory.length });
        settings.value.inputHistory = oldHistory as string[];
        migrated = true;
      }

      if (migrated) {
        // 写入迁移后的数据
        sync.markSelfWrite();
        await settingsStorage.setValue(plain(settings.value));
        // 删除旧 key
        await chrome.storage.local.remove(Object.values(OLD_KEYS));
        log.info('旧数据迁移完成，已删除旧 key');
      }
    } catch (error) {
      log.error('迁移旧数据失败', error);
    }
  }

  /** 初始化：读取本地存储，无数据则使用 DEFAULT_SETTINGS（含 local-config.json） */
  async function init() {
    log.info('初始化设置');
    const v = await settingsStorage.getValue();
    const hasValidData =
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Array.isArray((v as any).models) &&
      (v as any).models.length > 0;

    if (hasValidData) {
      settings.value = mergeSettings(v as any);
      log.info('从 storage 加载设置', { modelCount: settings.value.models.length });
    } else {
      settings.value = mergeSettings(DEFAULT_SETTINGS);
      sync.markSelfWrite();
      await settingsStorage.setValue(plain(settings.value));
      log.info('首次加载默认设置（含 local-config.json 模型）', {
        modelCount: settings.value.models.length,
      });
    }

    // 迁移旧 storage key
    await migrateOldKeys();

    // 从 engineConfs 回填空的 API 密钥
    const conf = settings.value.voiceEngineConfs?.find(c => c.engineType === settings.value.voiceEngineType);
    if (conf) {
      if (!settings.value.voiceAppId) settings.value.voiceAppId = conf.appId;
      if (!settings.value.voiceApiKey) settings.value.voiceApiKey = conf.apiKey;
      if (!settings.value.voiceApiSecret) settings.value.voiceApiSecret = conf.apiSecret;
    }

    ready.value = true;
    log.info('设置加载完成', {
      provider: settings.value.provider,
      modelCount: settings.value.models.length,
      defaultModel: settings.value.defaultModelId,
    });
  }

  /** 显式更新：立即 await 持久化 */
  async function update(partial: Partial<AppSettings>) {
    settings.value = mergeSettings({ ...settings.value, ...partial });
    await sync.flush();
  }

  return { settings, ready, init, update };
});
