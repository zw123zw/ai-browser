# Automation Module

## 模块概述

自动化模块提供语音驱动的网页自动化能力，通过 content script 注入到目标页面执行 DOM 操作。包含动作执行器和选择器集合两部分，支持 7 种自动化动作，使用优先级有序的 CSS 选择器列表实现跨网站兼容。

**源文件**:
- `src/automation/actions.ts` - 动作执行器
- `src/automation/selectors.ts` - DOM 选择器集合

## 架构设计

```
┌──────────────────────────────────────────────────────┐
│                Automation Module                       │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │            Action Executor                     │  │
│  │                                                │  │
│  │  executeAutomationAction(action, params)        │  │
│  │                                                │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │  │
│  │  │openSite  │ │search    │ │siteSearch    │   │  │
│  │  │window.   │ │baidu.com │ │findElement() │   │  │
│  │  │open()    │ │/s?wd=    │ │fill+Enter    │   │  │
│  │  └──────────┘ └──────────┘ └──────────────┘   │  │
│  │                                                │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐   │  │
│  │  │openItem  │ │pageNext  │ │videoControl  │   │  │
│  │  │findElems │ │findElement│ │querySelector │   │  │
│  │  │[i].click │ │.click()  │ │.play/.pause  │   │  │
│  │  └──────────┘ └──────────┘ └──────────────┘   │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │            Selector Collections                │  │
│  │                                                │  │
│  │  SEARCH_INPUT_SELECTORS   (12 selectors)       │  │
│  │  SEARCH_RESULT_SELECTORS  (13 selectors)       │  │
│  │  NEXT_PAGE_SELECTORS      (8 selectors)        │  │
│  │  PREV_PAGE_SELECTORS      (7 selectors)        │  │
│  │                                                │  │
│  │  findElement(selectors)  -> first match         │  │
│  │  findElements(selectors) -> first group match   │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## 核心类型定义

```typescript
// 动作执行结果
interface ActionResult {
  success: boolean;
  message: string;
}

// 动作参数
interface ActionParams {
  url?: string;      // open_site
  keyword?: string;  // search, site_search
  index?: number;    // open_item
}

// 动作类型（复用 CommandType）
type AutomationAction =
  | 'open_site'
  | 'search'
  | 'site_search'
  | 'open_item'
  | 'page_next'
  | 'page_prev'
  | 'video_play'
  | 'video_pause';
```

## 实现细节

### 动作执行器 (actions.ts)

`executeAutomationAction(action, params)` 作为统一入口，switch 分发到具体动作函数：

#### openSite(url)

- 确保 URL 有 `https://` 前缀
- `window.open(fullUrl, '_blank')` 在新标签页打开
- 返回成功消息

#### search(keyword)

- 构建百度搜索 URL: `https://www.baidu.com/s?wd={encodedKeyword}`
- `window.open()` 新标签页打开
- 硬编码使用百度搜索引擎

#### siteSearch(keyword)

- `findElement(SEARCH_INPUT_SELECTORS)` 查找搜索框
- 设置 `input.value = keyword`
- 派发 `input` 和 `change` 事件（触发框架响应式更新）
- 100ms 延迟后：
  - 派发 `keydown` Enter 事件
  - 查找最近的 `<form>` 并派发 `submit` 事件
- 双重提交机制确保兼容不同网站

#### openItem(index)

- `findElements(SEARCH_RESULT_SELECTORS)` 获取所有搜索结果
- 取第 `index - 1` 个元素（1-based 索引）
- 300ms 延迟后 `.click()`（等待 DOM 加载）

#### pageNext() / pagePrev()

- `findElement(NEXT_PAGE_SELECTORS)` / `findElement(PREV_PAGE_SELECTORS)`
- 找到则 `.click()`
- **兜底策略**:
  - pageNext: `window.scrollTo({ top: scrollHeight, behavior: 'smooth' })`
  - pagePrev: `window.history.back()`

#### videoControl(isPlay)

- `document.querySelector('video')` 查找视频元素
- `isPlay=true` -> `video.play()`
- `isPlay=false` -> `video.pause()`
- `.catch(() => {})` 静默处理 play() 的 autoplay 策略错误

### 选择器集合 (selectors.ts)

所有选择器按**优先级排序**，`findElement()` 返回第一个匹配的元素。

#### SEARCH_INPUT_SELECTORS (12 个)

```
input[type="search"]           # 通用搜索框
input[name="wd"]               # 百度
input[name="q"]                # Google/Bing
input[id="kw"]                 # 百度
input[id="search-input"]       # 通用
input[placeholder*="搜索"]      # 中文 placeholder
input[placeholder*="search"]   # 英文 placeholder
input[aria-label*="搜索"]       # 中文 aria-label
input[aria-label*="search"]    # 英文 aria-label
.search-input                  # 常见 class
.search-box input              # 嵌套 class
.search-bar input              # 嵌套 class
#search                        # ID 选择器
```

#### SEARCH_RESULT_SELECTORS (13 个)

```
.result h3 a                   # 百度
.c-container h3 a              # 百度
.g a h3                        # Google
.yuRUbf a                      # Google
.b_algo h2 a                   # Bing
h3 a                           # 通用标题链接
.item a                        # 通用列表项
.card a                        # 卡片布局
.result a                      # 结果容器
.title a                       # 标题容器
.list-item a                   # 列表项
.video-item a                  # 视频项
.feed-item a                   # 信息流项
```

#### NEXT_PAGE_SELECTORS (8 个)

```
a.n                            # 百度
#page a:last-child             # 百度
#pnnext                        # Google
.b_pag a.sb_pagN               # Bing
.next                          # 通用
.page-next                     # 通用
a[rel="next"]                  # 语义化
.pagination-next               # 通用
```

#### PREV_PAGE_SELECTORS (7 个)

```
a.prec                         # 百度
#pnprev                        # Google
.prev                          # 通用
.page-prev                     # 通用
a[rel="prev"]                  # 语义化
.pagination-prev               # 通用
```

### findElement / findElements

```typescript
// 遍历选择器列表，返回第一个匹配
function findElement(selectors: string[]): Element | null {
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch { /* 无效选择器跳过 */ }
  }
  return null;
}

// 遍历选择器列表，返回第一个有结果的 querySelectorAll
function findElements(selectors: string[]): Element[] {
  for (const selector of selectors) {
    try {
      const els = document.querySelectorAll(selector);
      if (els.length > 0) return Array.from(els);
    } catch { /* 无效选择器跳过 */ }
  }
  return [];
}
```

策略：**first-match-wins**，遍历优先级列表，第一个命中即返回。

## 数据流

```
VoiceSession 指令执行
    │
    │ executeAutomation(action, params)
    │ chrome.runtime.sendMessage({ type: 'automation', action, params })
    ▼
App.vue onMessage handler
    │
    │ executeAutomationAction(action, params)
    ▼
actions.ts switch(action)
    │
    ├─ openSite   -> window.open(url)
    ├─ search     -> window.open(baidu + keyword)
    ├─ siteSearch -> findElement(INPUT) -> fill -> Enter
    ├─ openItem   -> findElements(RESULT)[i] -> click
    ├─ pageNext   -> findElement(NEXT) -> click / scrollTo
    ├─ pagePrev   -> findElement(PREV) -> click / history.back
    └─ videoCtrl  -> querySelector('video') -> play/pause
    │
    ▼
ActionResult { success, message }
    │
    ▼
VoiceSession 接收结果 -> 继续下一条指令 / 播报
```

## 配置与扩展

- **搜索引擎**: `search()` 硬编码百度，不支持切换
- **选择器扩展**: 直接在 `selectors.ts` 中添加新选择器到对应数组
- **新动作扩展**: 在 `actions.ts` 的 switch 中添加 case，在 `commandParser.ts` 的 `VALID_TYPES` 中注册
- **点击延迟**: `openItem` 使用 300ms 延迟，`siteSearch` 使用 100ms 延迟
- **无重试机制**: 动作执行失败直接返回错误，不做重试

## 已知限制

1. **选择器脆弱性**: CSS 选择器依赖网站 DOM 结构，网站改版可能导致选择器失效。优先级排序部分缓解但无法根治。
2. **搜索引擎硬编码**: `search()` 固定使用百度，不支持用户自定义搜索引擎。
3. **无元素等待机制**: `findElement()` 是同步立即查找，不等待动态加载的元素出现。`openItem` 的 300ms 延迟是经验值，不保证可靠。
4. **事件模拟不完整**: `siteSearch` 通过派发 `input/change/keydown/submit` 事件模拟用户输入，但某些框架（如 React 的合成事件）可能不响应原生事件。
5. **video.play() 自动播放策略**: 现代浏览器的 autoplay 策略可能阻止 `video.play()`，当前静默 catch 错误。
6. **无 iframe 支持**: 所有选择器只在主文档中查找，不穿透 iframe。
7. **pageNext 兜底不精确**: 当找不到下一页按钮时，`scrollTo` 滚动到底部可能不是用户期望的行为。
