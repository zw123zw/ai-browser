import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AppSettings } from '@/src/types';
import { DEFAULT_SETTINGS, settingsStorage } from '@/src/storage';
import { defineStorageSync, plain } from '@/src/utils/storage-sync';

export const useSettingsStore = defineStore('zwf-settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS });
  const ready = ref(false);

  /** 安全合并：保证 models 一定是数组、defaultModelId 始终有效 */
  function mergeSettings(v: Partial<AppSettings>): AppSettings {
    const merged = { ...DEFAULT_SETTINGS, ...v };
    if (!Array.isArray(merged.models) || merged.models.length === 0) {
      merged.models = DEFAULT_SETTINGS.models;
    }
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

  /** 初始化：读取本地 */
  async function init() {
    const v = await settingsStorage.getValue();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      settings.value = mergeSettings(v as any);
    } else {
      settings.value = { ...DEFAULT_SETTINGS };
      sync.markSelfWrite();
      await settingsStorage.setValue(plain(settings.value));
    }
    ready.value = true;
  }

  /** 显式更新：立即 await 持久化，避免在用户关闭弹窗后丢失 */
  async function update(partial: Partial<AppSettings>) {
    settings.value = mergeSettings({ ...settings.value, ...partial });
    await sync.flush();
  }

  return { settings, ready, init, update };
});
