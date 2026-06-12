/**
 * DOM 选择器集合
 *
 * 针对不同网站类型的通用选择器
 */

/** 搜索输入框选择器（按优先级排序） */
export const SEARCH_INPUT_SELECTORS = [
  // 通用搜索框
  'input[type="search"]',
  'input[name="wd"]',           // 百度
  'input[name="q"]',            // Google/Bing
  'input[id="kw"]',             // 百度
  'input[id="search-input"]',
  // 语义化选择器
  'input[placeholder*="搜索"]',
  'input[placeholder*="search"]',
  'input[aria-label*="搜索"]',
  'input[aria-label*="search"]',
  // 常见 class
  '.search-input',
  '.search-box input',
  '.search-bar input',
  '#search',
];

/** 搜索结果链接选择器 */
export const SEARCH_RESULT_SELECTORS = [
  // 百度
  '.result h3 a',
  '.c-container h3 a',
  // Google
  '.g a h3',
  '.yuRUbf a',
  // Bing
  '.b_algo h2 a',
  // 通用
  'h3 a',
  '.item a',
  '.card a',
  '.result a',
  '.title a',
  '.list-item a',
  '.video-item a',
  '.feed-item a',
];

/** 下一页按钮选择器 */
export const NEXT_PAGE_SELECTORS = [
  // 百度
  'a.n',
  '#page a:last-child',
  // Google
  '#pnnext',
  // Bing
  '.b_pag a.sb_pagN',
  // 通用
  '.next',
  '.page-next',
  'a[rel="next"]',
  '.pagination-next',
  '.pagination .next',
];

/** 上一页按钮选择器 */
export const PREV_PAGE_SELECTORS = [
  // 百度
  'a.prec',
  // Google
  '#pnprev',
  // 通用
  '.prev',
  '.page-prev',
  'a[rel="prev"]',
  '.pagination-prev',
  '.pagination .prev',
];

/**
 * 根据选择器列表查找元素
 * 返回第一个匹配的元素，或 null
 */
export function findElement(selectors: string[]): Element | null {
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch {
      // 无效选择器，跳过
    }
  }
  return null;
}

/**
 * 根据选择器列表查找所有匹配元素
 */
export function findElements(selectors: string[]): Element[] {
  for (const selector of selectors) {
    try {
      const els = document.querySelectorAll(selector);
      if (els.length > 0) return Array.from(els);
    } catch {
      // 无效选择器，跳过
    }
  }
  return [];
}
