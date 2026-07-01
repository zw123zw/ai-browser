/**
 * 缓存管理模块
 *
 * 提供手动清除会话消息和日志的功能。
 * 配置、笔记、输入历史不受影响。
 * 当缓存超过 30MB 时自动清除。
 */

import { Logger } from '@/src/utils/logger';

const log = new Logger('Cache');

/** 缓存上限 30MB */
const CACHE_LIMIT = 30 * 1024 * 1024;

/** 需要清除的日志键 */
const LOG_KEYS = [
  'logs:frontend',
  'logs:api',
];

/** 清除缓存（会话消息 + 日志）。配置、笔记、输入历史保留。 */
export async function clearCache(): Promise<void> {
  log.info('开始清除缓存');
  // 动态导入避免循环依赖
  const { useConversationsStore } = await import('@/src/stores/conversations');
  const convStore = useConversationsStore();
  await convStore.resetConversation();
  await chrome.storage.local.remove(LOG_KEYS);
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
