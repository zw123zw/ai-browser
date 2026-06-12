import type { Ref } from 'vue';
import { toRaw, watch } from 'vue';

/** 解 proxy + 去响应式 */
export function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(toRaw(v)));
}

interface StorageItemLike<T> {
  setValue: (v: T) => Promise<void>;
  watch: (cb: (nv: T | null) => void) => void;
}

interface SyncOptions<T> {
  /** 响应式数据 ref */
  source: Ref<T>;
  /** wxt storage item */
  storage: StorageItemLike<T>;
  /** ready 标志，false 时不写入 */
  ready: Ref<boolean>;
  /** 来自远端的值 -> 应用到 source */
  applyRemote: (nv: T) => void;
  /** 防抖延时（ms） */
  debounce?: number;
  /** 自我写入回声忽略窗口（ms） */
  echoWindow?: number;
}

/**
 * 把 reactive ref 与 chrome.storage 双向同步：
 * - source 变化 → 防抖写入 storage（plain 化避免 proxy 序列化问题）
 * - storage 跨页面变化 → 应用到 source（忽略自己刚写入触发的回声）
 */
export function defineStorageSync<T>(opts: SyncOptions<T>) {
  const { source, storage, ready, applyRemote } = opts;
  const debounceMs = opts.debounce ?? 200;
  const echoMs = opts.echoWindow ?? 500;

  let lastSelfWrite = 0;
  let timer: number | null = null;
  let applyingRemote = false;

  // 跨页面同步：监听 storage 变化
  storage.watch((nv) => {
    if (nv == null) return;
    if (Date.now() - lastSelfWrite < echoMs) return;
    applyingRemote = true;
    applyRemote(nv);
    setTimeout(() => (applyingRemote = false), 0);
  });

  // 本地变化 → 防抖写入
  watch(
    source,
    () => {
      if (!ready.value || applyingRemote) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        lastSelfWrite = Date.now();
        storage.setValue(plain(source.value));
      }, debounceMs);
    },
    { deep: true }
  );

  /** 显式立即写入（绕过防抖） */
  async function flush() {
    if (timer) window.clearTimeout(timer);
    lastSelfWrite = Date.now();
    await storage.setValue(plain(source.value));
  }

  return {
    isApplyingRemote: () => applyingRemote,
    markSelfWrite: () => (lastSelfWrite = Date.now()),
    flush,
  };
}
