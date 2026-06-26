/**
 * 网页自动化动作执行器
 *
 * 通过 content script 注入到目标页面执行
 */

import {
  SEARCH_INPUT_SELECTORS,
  SEARCH_RESULT_SELECTORS,
  NEXT_PAGE_SELECTORS,
  PREV_PAGE_SELECTORS,
  findElement,
  findElements,
} from './selectors';
import { Logger } from '@/src/utils/logger';

const log = new Logger('Automation');

/** 自动化动作类型 */
type AutomationAction =
  | 'open_site'
  | 'search'
  | 'site_search'
  | 'open_item'
  | 'page_next'
  | 'page_prev'
  | 'video_play'
  | 'video_pause'

/** 动作执行结果 */
export interface ActionResult {
  success: boolean;
  message: string;
}

/**
 * 执行自动化动作
 *
 * 注意：此函数需要在 content script 上下文中运行
 */
export function executeAutomationAction(
  action: AutomationAction,
  params: { url?: string; keyword?: string; index?: number }
): ActionResult {
  log.info('执行动作', { action, params });
  let result: ActionResult;

  switch (action) {
    case 'open_site':
      result = openSite(params.url!);
      break;
    case 'search':
      result = search(params.keyword!);
      break;
    case 'site_search':
      result = siteSearch(params.keyword!);
      break;
    case 'open_item':
      result = openItem(params.index!);
      break;
    case 'page_next':
      result = pageNext();
      break;
    case 'page_prev':
      result = pagePrev();
      break;
    case 'video_play':
      result = videoControl(true);
      break;
    case 'video_pause':
      result = videoControl(false);
      break;
    default:
      result = { success: false, message: `未知动作: ${action}` };
  }

  log.info('动作结果', { action, success: result.success, message: result.message });
  return result;
}

/** 打开网站 */
function openSite(url: string): ActionResult {
  if (!url) {
    return { success: false, message: '未指定网址' };
  }

  // 确保 URL 有协议前缀
  const fullUrl = url.startsWith('http') ? url : `https://${url}`;
  window.open(fullUrl, '_blank');
  return { success: true, message: `已打开: ${fullUrl}` };
}

/** 全网搜索 */
function search(keyword: string): ActionResult {
  if (!keyword) {
    return { success: false, message: '未指定搜索关键词' };
  }

  const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(keyword)}`;
  window.open(searchUrl, '_blank');
  return { success: true, message: `正在搜索: ${keyword}` };
}

/** 站内搜索 */
function siteSearch(keyword: string): ActionResult {
  if (!keyword) {
    return { success: false, message: '未指定搜索关键词' };
  }

  const searchInput = findElement(SEARCH_INPUT_SELECTORS) as HTMLInputElement | null;
  if (!searchInput) {
    return { success: false, message: '未找到搜索框' };
  }

  // 填入关键词
  searchInput.value = keyword;
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.dispatchEvent(new Event('change', { bubbles: true }));

  // 模拟回车提交
  setTimeout(() => {
    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      bubbles: true,
    });
    searchInput.dispatchEvent(enterEvent);

    // 也尝试触发表单提交
    const form = searchInput.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true }));
    }
  }, 100);

  return { success: true, message: `站内搜索: ${keyword}` };
}

/** 点击第N个结果 */
function openItem(index: number): ActionResult {
  if (index < 1) {
    return { success: false, message: '无效的序号' };
  }

  const items = findElements(SEARCH_RESULT_SELECTORS);
  if (items.length === 0) {
    return { success: false, message: '未找到可点击的结果' };
  }

  const target = items[index - 1];
  if (!target) {
    return { success: false, message: `没有第 ${index} 个结果（共 ${items.length} 个）` };
  }

  // 延时点击，等待 DOM 加载
  setTimeout(() => {
    (target as HTMLElement).click();
  }, 300);

  return { success: true, message: `已点击第 ${index} 个结果` };
}

/** 下一页 */
function pageNext(): ActionResult {
  const nextBtn = findElement(NEXT_PAGE_SELECTORS);
  if (nextBtn) {
    (nextBtn as HTMLElement).click();
    return { success: true, message: '已翻到下一页' };
  }

  // 兜底：滚动到底部
  window.scrollTo({
    top: document.body.scrollHeight,
    behavior: 'smooth',
  });
  return { success: true, message: '已滚动到底部' };
}

/** 上一页 */
function pagePrev(): ActionResult {
  const prevBtn = findElement(PREV_PAGE_SELECTORS);
  if (prevBtn) {
    (prevBtn as HTMLElement).click();
    return { success: true, message: '已翻到上一页' };
  }

  // 兜底：浏览器后退
  window.history.back();
  return { success: true, message: '已返回上一页' };
}

/** 视频播放/暂停 */
function videoControl(isPlay: boolean): ActionResult {
  const video = document.querySelector('video');
  if (!video) {
    return { success: false, message: '未找到视频元素' };
  }

  if (isPlay) {
    video.play().catch(() => {});
    return { success: true, message: '视频已播放' };
  } else {
    video.pause();
    return { success: true, message: '视频已暂停' };
  }
}
