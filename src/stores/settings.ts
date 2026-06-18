import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AppSettings } from '@/src/types';
import { DEFAULT_SETTINGS, settingsStorage } from '@/src/storage';
import { defineStorageSync, plain } from '@/src/utils/storage-sync';
import { Logger } from '@/src/utils/logger';

const log = new Logger('Store:Settings');

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
