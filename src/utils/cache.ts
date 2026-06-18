/**
 * 缓存管理模块
 *
 * 提供手动清除 chrome.storage.local 中会话、日志、输入历史的功能。
 * 不会清除模型配置等设置数据。
 */

import { Logger } from '@/src/utils/logger';

const log = new Logger('Cache');

/** 需要清除的键列表 */
const CACHE_KEYS = [
  'zwf-conversation',
  'logs:frontend',
  'logs:api',
  'zwf-input-history',
];

/** 清除缓存（会话消息 + 日志 + 输入历史） */
export async function clearCache(): Promise<void> {
  log.info('开始清除缓存', { keys: CACHE_KEYS });
  await chrome.storage.local.remove(CACHE_KEYS);
  log.info('缓存清除完成');
}
