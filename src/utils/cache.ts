/**
 * 缓存管理模块
 *
 * 提供手动清除 chrome.storage.local 中会话、日志、输入历史的功能。
 * 不会清除模型配置等设置数据。
 * 当缓存超过 30MB 时自动清除。
 */

import { Logger } from '@/src/utils/logger';

const log = new Logger('Cache');

/** 缓存上限 30MB */
const CACHE_LIMIT = 30 * 1024 * 1024;

/** 需要清除的键列表 */
const CACHE_KEYS = [
  'ai-browser-conversation',
  'logs:frontend',
  'logs:api',
  'ai-browser-input-history',
];

/** 清除缓存（会话消息 + 日志 + 输入历史） */
export async function clearCache(): Promise<void> {
  log.info('开始清除缓存', { keys: CACHE_KEYS });
  await chrome.storage.local.remove(CACHE_KEYS);
  log.info('缓存清除完成');
}

/**
 * 检查缓存大小，超过 30MB 时自动清除
 * 建议在保存会话后调用
 */
export async function checkAndAutoClear(): Promise<void> {
  try {
    const used = await chrome.storage.local.getBytesInUse();
    if (used > CACHE_LIMIT) {
      const usedMB = (used / (1024 * 1024)).toFixed(1);
      log.warn(`缓存超限 (${usedMB}MB > 30MB)，自动清除`);
      await clearCache();
    }
  } catch {
    // getBytesInUse 失败时静默忽略
  }
}
