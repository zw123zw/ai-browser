/**
 * 语音指令解析器
 *
 * 将用户的自然语言指令解析为：
 * 1. 自动化指令（打开网站、搜索、点击等）
 * 2. 普通对话（发送给 AI 模型）
 */

export type AutomationAction =
  | 'open_site'
  | 'search'
  | 'site_search'
  | 'open_item'
  | 'page_next'
  | 'page_prev'
  | 'video_play'
  | 'video_pause';

export interface AutomationCommand {
  type: 'automation';
  action: AutomationAction;
  params: {
    url?: string;
    keyword?: string;
    index?: number;
  };
}

export interface ChatCommand {
  type: 'chat';
  text: string;
}

export type ParsedCommand = AutomationCommand | ChatCommand;

/** 网站域名映射 */
const SITE_MAP: Record<string, string> = {
  'b站': 'https://www.bilibili.com',
  'bilibili': 'https://www.bilibili.com',
  '哔哩哔哩': 'https://www.bilibili.com',
  '淘宝': 'https://www.taobao.com',
  '京东': 'https://www.jd.com',
  '知乎': 'https://www.zhihu.com',
  '百度': 'https://www.baidu.com',
  '谷歌': 'https://www.google.com',
  'github': 'https://github.com',
  '抖音': 'https://www.douyin.com',
  '微博': 'https://www.weibo.com',
  '豆瓣': 'https://www.douban.com',
  '小红书': 'https://www.xiaohongshu.com',
  'youtube': 'https://www.youtube.com',
  '油管': 'https://www.youtube.com',
  '必应': 'https://www.bing.com',
  'bing': 'https://www.bing.com',
};

/** 中文数字映射 */
const CN_NUM_MAP: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '第1': 1, '第2': 2, '第3': 3, '第4': 4, '第5': 5,
  '第6': 6, '第7': 7, '第8': 8, '第9': 9, '第10': 10,
};

/**
 * 解析语音指令
 *
 * 优先匹配自动化指令，不匹配时返回普通对话
 */
export function parseVoiceCommand(text: string): ParsedCommand {
  const normalized = text.trim().toLowerCase();

  // 1. 打开网站
  const openMatch = normalized.match(/打开(.+)/);
  if (openMatch) {
    const target = openMatch[1].trim();

    // 检查是否是已知网站
    for (const [key, url] of Object.entries(SITE_MAP)) {
      if (target.includes(key)) {
        return {
          type: 'automation',
          action: 'open_site',
          params: { url },
        };
      }
    }

    // 检查是否是 URL
    if (target.match(/^(https?:\/\/|www\.)/)) {
      const url = target.startsWith('http') ? target : `https://${target}`;
      return {
        type: 'automation',
        action: 'open_site',
        params: { url },
      };
    }
  }

  // 2. 全网搜索
  const searchMatch = normalized.match(/(?:搜索|搜一下|查一下|百度搜索|谷歌搜索|搜索一下)(.*)/);
  if (searchMatch) {
    const keyword = searchMatch[1].trim();
    if (keyword) {
      return {
        type: 'automation',
        action: 'search',
        params: { keyword },
      };
    }
  }

  // 3. 站内搜索
  const siteSearchMatch = normalized.match(/(?:站内搜索|在站内搜索|在本站搜索|搜索站内)(.*)/);
  if (siteSearchMatch) {
    const keyword = siteSearchMatch[1].trim();
    if (keyword) {
      return {
        type: 'automation',
        action: 'site_search',
        params: { keyword },
      };
    }
  }

  // 4. 点击第N个
  const clickMatch = normalized.match(/(?:打开第|点击第|点第|选第)([一二三四五六七八九十\d]+)(?:个|条|项)?/);
  if (clickMatch) {
    const numStr = clickMatch[1];
    const index = CN_NUM_MAP[numStr] || parseInt(numStr, 10);
    if (index > 0) {
      return {
        type: 'automation',
        action: 'open_item',
        params: { index },
      };
    }
  }

  // 5. 翻页
  if (normalized.includes('下一页') || normalized.includes('翻到下一页')) {
    return { type: 'automation', action: 'page_next', params: {} };
  }
  if (normalized.includes('上一页') || normalized.includes('翻到上一页')) {
    return { type: 'automation', action: 'page_prev', params: {} };
  }

  // 6. 视频控制
  if (normalized === '播放' || normalized === '继续播放' || normalized === '开始播放') {
    return { type: 'automation', action: 'video_play', params: {} };
  }
  if (normalized === '暂停' || normalized === '停止播放') {
    return { type: 'automation', action: 'video_pause', params: {} };
  }

  // 7. 默认：普通对话
  return { type: 'chat', text: text.trim() };
}
