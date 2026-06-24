import { Logger } from '@/src/utils/logger';

const log = new Logger('Background');

export default defineBackground(() => {
  // 存储进行中的流式请求，便于中止
  const activeStreams = new Map<string, { reader: ReadableStreamDefaultReader; tabId: number }>();

  // 工具栏图标点击
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'aib-toggle' }).catch(() => {});
    }
  });

  // 快捷键
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-chat') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'aib-toggle' }).catch(() => {});
    }
  });

  // 生成唯一请求 ID
  function generateRequestId(): string {
    return `stream_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  // 监听来自 content script 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // content script 获取自身 tab ID（跨标签页续接用）
    if (message.type === 'get-tab-id') {
      sendResponse({ tabId: sender.tab?.id })
      return false
    }

    // iframe 骨架提取：content script 无法直接调用 chrome.scripting，通过 background 中转
    if (message.type === 'extract-iframe-skeleton') {
      const { scope, vpWidth, vpHeight } = message
      const tabId = sender.tab?.id
      if (!tabId) { sendResponse({ error: 'no tabId' }); return false }
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: iframeExtractFunc,
        args: [scope, vpWidth, vpHeight],
      }).then(results => {
        sendResponse({ results: results.map(r => r.result).filter(Boolean) })
      }).catch(err => {
        sendResponse({ error: String(err) })
      })
      return true
    }

    // iframe 操作执行：click/type/select/focus/hover
    if (message.type === 'execute-iframe-action') {
      const { action, elementId, text, key } = message
      const tabId = sender.tab?.id
      if (!tabId) { sendResponse({ error: 'no tabId' }); return false }
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: iframeActionFunc,
        args: [action, elementId, text || '', key || ''],
      }).then(results => {
        const result = results.map(r => r.result).find(r => r?.success)
        sendResponse({ result })
      }).catch(err => {
        sendResponse({ error: String(err) })
      })
      return true
    }

    // 读取本地文件（Content Script 无法直接 fetch file://）
    if (message.type === 'read-local-file') {
      const { url } = message;
      log.info('read-local-file', { url });
      fetch(url)
        .then(async (res) => {
          if (!res.ok) {
            sendResponse({ success: false, error: `HTTP ${res.status}` });
            return;
          }
          const buffer = await res.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
          const mimeType = res.headers.get('content-type') || 'application/octet-stream';
          log.info('read-local-file result', { url, mimeType, size: buffer.byteLength });
          sendResponse({
            success: true,
            data: base64,
            mimeType,
          });
        })
        .catch((err) => {
          sendResponse({ success: false, error: String(err) });
        });
      return true; // 异步响应
    }

    // 代理 fetch 请求（避免 CORS）
    if (message.type === 'proxy-fetch') {
      const { url, method, headers, body } = message;

      fetch(url, {
        method: method || 'POST',
        headers: headers || {},
        body: body,
      })
        .then(async (res) => {
          const data = await res.json();
          sendResponse({ success: true, data, status: res.status });
        })
        .catch((err) => {
          sendResponse({ success: false, error: String(err) });
        });

      return true; // 异步响应
    }

    // 代理流式请求（SSE）
    if (message.type === 'proxy-fetch-stream') {
      const { url, method, headers, body } = message;
      const requestId = generateRequestId();
      const abortController = new AbortController();

      fetch(url, {
        method: method || 'POST',
        headers: headers || {},
        body: body,
        signal: abortController.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            const text = await res.text();
            sendResponse({ success: false, error: `HTTP ${res.status}: ${text}` });
            return;
          }

          // 读取流并转发到 content script
          const reader = res.body?.getReader();
          if (!reader || !sender.tab?.id) {
            sendResponse({ success: false, error: '无法获取响应流' });
            return;
          }

          // 先注册活跃流，再通知 content script（避免 abort-stream 到达时流尚未注册）
          activeStreams.set(requestId, { reader, tabId: sender.tab.id, abortController });

          // 返回成功，包含 requestId
          sendResponse({ success: true, streaming: true, requestId });

          const decoder = new TextDecoder();
          let buffer = '';

          try {
            while (true) {
              // 检查是否已被中止
              if (!activeStreams.has(requestId)) {
                break;
              }

              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });

              // 发送数据块到 content script
              chrome.tabs.sendMessage(sender.tab.id, {
                type: 'stream-chunk',
                requestId,
                chunk: buffer,
              }).catch(() => {});

              buffer = '';
            }
          } catch (streamErr) {
            // 如果是中止导致的错误，不发送错误消息
            if (!activeStreams.has(requestId)) {
              return;
            }
            log.error('流读取异常:', streamErr);
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'stream-error',
              requestId,
              error: String(streamErr),
            }).catch(() => {});
            return;
          } finally {
            // 清理活跃流记录
            activeStreams.delete(requestId);
          }

          // 发送流结束（无论正常结束还是被中止，都通知 content script）
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'stream-end',
            requestId,
          }).catch(() => {});
        })
        .catch((err) => {
          log.error('流式请求异常:', err);
          // sendResponse 可能已调用过，用 stream-error 通知 content script
          if (sender.tab?.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'stream-error',
              requestId,
              error: String(err),
            }).catch(() => {});
          }
          sendResponse({ success: false, error: String(err) });
        });

      return true;
    }

    // 跨标签页同步抽屉状态
    if (message.type === 'aib-drawer-changed') {
      const { open } = message;
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id && tab.id !== sender.tab?.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'aib-drawer-sync', open }).catch(() => {});
          }
        }
      });
      return false;
    }

    // 标签页操作（newTab / closeTab / switchTab）
    if (message.type === 'tab-action') {
      const { action, query } = message;

      if (action === 'newTab') {
        chrome.tabs.create({ url: message.url }).then((tab) => {
          // 聚焦新标签页（跨标签页续接需要新页立即激活）
          if (tab.id) chrome.tabs.update(tab.id, { active: true })
          if (tab.windowId) chrome.windows.update(tab.windowId, { focused: true })
          sendResponse({ success: true, tabId: tab.id, message: `新标签页: ${tab.id}` });
        }).catch((err) => {
          sendResponse({ success: false, error: String(err) });
        });
        return true;
      }

      if (action === 'closeTab') {
        const tabId = sender.tab?.id;
        if (tabId) {
          chrome.tabs.remove(tabId).then(() => {
            sendResponse({ success: true, message: '标签页已关闭' });
          }).catch((err) => {
            sendResponse({ success: false, error: String(err) });
          });
        } else {
          sendResponse({ success: false, error: '无法获取当前标签页 ID' });
        }
        return true;
      }

      if (action === 'switchTab') {
        // 支持 nextTab / prevTab 相对切换
        if (query === 'next' || query === 'prev') {
          chrome.tabs.query({ currentWindow: true }).then((tabs) => {
            const activeIndex = tabs.findIndex((t) => t.active);
            if (activeIndex < 0) {
              sendResponse({ success: false, error: '未找到当前标签页' });
              return;
            }
            let targetIndex: number;
            if (query === 'next') {
              targetIndex = (activeIndex + 1) % tabs.length;
            } else {
              targetIndex = (activeIndex - 1 + tabs.length) % tabs.length;
            }
            const target = tabs[targetIndex];
            if (target?.id) {
              chrome.tabs.update(target.id, { active: true }).then(() => {
                sendResponse({ success: true, message: `已切换到: ${target.title}` });
              }).catch((err) => {
                sendResponse({ success: false, error: String(err) });
              });
            }
          }).catch((err) => {
            sendResponse({ success: false, error: String(err) });
          });
          return true;
        }

        // 按关键词匹配标签
        if (!query) {
          sendResponse({ success: false, error: '未指定目标标签页关键词' });
          return true;
        }

        // 常见站点别名映射（用户说法 → 实际标题/URL 关键词）
        const SITE_ALIASES: Record<string, string[]> = {
          'b站': ['bilibili', '哔哩哔哩'],
          'bilibili': ['bilibili', '哔哩哔哩'],
          '哔哩哔哩': ['bilibili', '哔哩哔哩'],
          '淘宝': ['taobao', '淘宝'],
          '京东': ['jd.com', '京东'],
          '百度': ['baidu', '百度'],
          '谷歌': ['google', '谷歌'],
          'github': ['github'],
          '掘金': ['juejin', '掘金'],
          '知乎': ['zhihu', '知乎'],
          '微博': ['weibo', '微博'],
          '抖音': ['douyin', '抖音', 'tiktok'],
          'youtube': ['youtube', 'youtube'],
          '油管': ['youtube', 'youtube'],
          'twitter': ['twitter', 'x.com'],
          '推特': ['twitter', 'x.com'],
          '网易': ['163.com', '网易'],
          '腾讯': ['qq.com', '腾讯'],
          '必应': ['bing', '必应'],
        }

        // 获取扩展后的匹配关键词列表
        const queryLower = query.toLowerCase()
        const matchTerms = [queryLower, ...(SITE_ALIASES[queryLower] || [])]

        chrome.tabs.query({}).then((tabs) => {
          const target = tabs.find((tab) => {
            const title = (tab.title || '').toLowerCase();
            const url = (tab.url || '').toLowerCase();
            return matchTerms.some(term => title.includes(term) || url.includes(term));
          });
          if (target?.id) {
            chrome.tabs.update(target.id, { active: true }).then(() => {
              if (target.windowId) {
                chrome.windows.update(target.windowId, { focused: true });
              }
              sendResponse({ success: true, message: `已切换到: ${target.title}` });
            }).catch((err) => {
              sendResponse({ success: false, error: String(err) });
            });
          } else {
            sendResponse({ success: false, error: `未找到包含 "${query}" 的标签页` });
          }
        }).catch((err) => {
          sendResponse({ success: false, error: String(err) });
        });
        return true;
      }

      sendResponse({ success: false, error: `未知标签页操作: ${action}` });
      return false;
    }

    // 中止流式请求
    if (message.type === 'abort-stream') {
      const { requestId } = message;
      const stream = activeStreams.get(requestId);
      if (stream) {
        // 中止 fetch 请求 + 取消读取
        stream.abortController.abort();
        stream.reader.cancel().catch(() => {});
        // 从活跃流中移除
        activeStreams.delete(requestId);
        // 通知 content script 流已结束
        chrome.tabs.sendMessage(stream.tabId, {
          type: 'stream-end',
          requestId,
        }).catch(() => {});
      }
      return false;
    }
  });
});

// ═══════════════════════════════════════════════
// iframe 注入函数（通过 chrome.scripting.executeScript 注入到 frame）
// ═══════════════════════════════════════════════

/** iframe 骨架提取函数 */
function iframeExtractFunc(scope: string, vpWidth: number, vpHeight: number): { url: string; elements: unknown[] } {
  const SKIP = 'script,style,noscript,meta,link,br,hr'
  const TAGS = ['a', 'button', 'input', 'select', 'textarea', 'video', 'audio']
  let idCounter = 0

  function isClickable(el: HTMLElement): boolean {
    if (TAGS.includes(el.tagName.toLowerCase())) return true
    if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '') return true
    if (el.getAttribute('onclick')) return true
    const role = el.getAttribute('role')
    if (role && ['button', 'link', 'menuitem', 'tab', 'option', 'switch', 'checkbox', 'radio'].includes(role)) return true
    if (el.getAttribute('tabindex')) return true
    try { if (getComputedStyle(el).cursor === 'pointer') return true } catch { /* */ }
    return false
  }

  function isVisible(el: HTMLElement): boolean {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden') return false
    return el.offsetParent !== null || s.position === 'fixed'
  }

  function getText(el: HTMLElement): string {
    let t = ''
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) t += n.textContent?.trim() || ''
    }
    if (!t) {
      for (const c of el.children) {
        const ct = (c as HTMLElement).innerText?.trim() || ''
        if (ct) { t = ct; break }
      }
    }
    return t.trim().slice(0, 100)
  }

  function extract(el: HTMLElement, id: string): Record<string, unknown> | null {
    const tag = el.tagName.toLowerCase()
    const text = getText(el)
    const hasIcon = !!el.querySelector('svg, img, i, [class*="icon"]')
    const isForm = ['input', 'textarea', 'select'].includes(tag)
    const hasFormContent = isForm && (el.getAttribute('placeholder') || (el as HTMLInputElement).value)
    const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || null
    const altText = !ariaLabel ? el.querySelector('img')?.getAttribute('alt') : null
    const ariaLabelValue = ariaLabel || altText || null
    if (!text && !el.getAttribute('role') && !hasIcon && !hasFormContent && !ariaLabelValue) return null

    const base: Record<string, unknown> = { id, tag }
    const explicitRole = el.getAttribute('role')
    if (explicitRole) base.role = explicitRole
    else if (tag === 'input') {
      const t = (el as HTMLInputElement).type
      if (t === 'submit' || t === 'reset') base.role = 'button'
      else if (t !== 'checkbox' && t !== 'radio') base.role = 'textbox'
    } else if (tag === 'select') base.role = 'combobox'

    if (text) base.text = text
    else if (hasFormContent) {
      const v = (el as HTMLInputElement).value
      if (v) base.text = v.length > 20 ? v.slice(0, 20) + '...' : v
    } else if (hasIcon && ariaLabelValue) base.ariaLabel = ariaLabelValue
    else if (hasIcon) base.text = '(icon)'
    if (ariaLabelValue && base.text !== ariaLabelValue) base.ariaLabel = ariaLabelValue
    if (isForm && el.getAttribute('placeholder')) base.placeholder = el.getAttribute('placeholder')!.slice(0, 50)

    if (tag === 'a') {
      const href = el.getAttribute('href')
      if (href && href !== '#' && !href.startsWith('javascript:')) {
        try { base.href = new URL(href, el.baseURI).href.slice(0, 80) } catch { /* */ }
      }
    }
    if (tag === 'input') {
      const inp = el as HTMLInputElement
      const t = inp.type || 'text'
      if (t !== 'checkbox' && t !== 'radio') base.inputType = t
      if (t !== 'password' && inp.value) base.value = inp.value.slice(0, 20)
      if ((t === 'checkbox' || t === 'radio') && inp.checked) base.checked = true
      if (inp.required) base.required = true
    }
    if (tag === 'textarea') {
      const ta = el as HTMLTextAreaElement
      if (ta.value) base.value = ta.value.slice(0, 20)
      if (ta.required) base.required = true
    }
    if (isForm || tag === 'button') {
      const d = (el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true'
      if (d) base.disabled = true
    }
    return base
  }

  // 确保所有元素有 data-skeleton-id
  for (const el of document.body.querySelectorAll(`*:not(${SKIP})`)) {
    if (!(el as HTMLElement).dataset.skeletonId) {
      (el as HTMLElement).dataset.skeletonId = `fi${++idCounter}`
    }
  }

  const elements: Record<string, unknown>[] = []
  for (const el of document.body.querySelectorAll('*')) {
    const htmlEl = el as HTMLElement
    const id = htmlEl.dataset.skeletonId || ''
    if (!id || !isClickable(htmlEl)) continue
    if (!isVisible(htmlEl)) continue
    if (scope === 'viewport') {
      const r = htmlEl.getBoundingClientRect()
      if (r.top >= vpHeight || r.bottom <= 0 || r.left >= vpWidth || r.right <= 0) continue
      if (r.width < 1 || r.height < 1) continue
    }
    const ex = extract(htmlEl, id)
    if (ex) elements.push(ex)
  }

  return { url: location.href, elements }
}

/** iframe 操作执行函数 */
function iframeActionFunc(
  action: string,
  elementId: string,
  text: string,
  key: string,
): { success: boolean; message: string } | null {
  const el = document.querySelector(`[data-skeleton-id="${elementId}"]`) as HTMLElement | null
  if (!el) return null // 此 frame 无目标元素，跳过

  function triggerClick(target: HTMLElement): void {
    const rect = target.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    target.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
  }

  function triggerType(target: HTMLElement, value: string): void {
    target.focus()
    target.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    if (descriptor?.set) {
      descriptor.set.call(target, value)
    } else {
      (target as HTMLInputElement).value = value
    }
    target.dispatchEvent(new Event('input', { bubbles: true }))
    target.dispatchEvent(new Event('change', { bubbles: true }))
  }

  try {
    switch (action) {
      case 'click':
        triggerClick(el)
        return { success: true, message: '点击成功' }
      case 'type':
        triggerType(el, text)
        return { success: true, message: `输入成功: ${text}` }
      case 'clear':
        triggerType(el, '')
        return { success: true, message: '清空成功' }
      case 'select':
        (el as HTMLSelectElement).value = text
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return { success: true, message: `选择: ${text}` }
      case 'focus':
        el.focus()
        el.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
        return { success: true, message: '聚焦成功' }
      case 'hover': {
        const rect = el.getBoundingClientRect()
        const cx = rect.left + rect.width / 2
        const cy = rect.top + rect.height / 2
        el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: cx, clientY: cy }))
        el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, clientX: cx, clientY: cy }))
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: cx, clientY: cy }))
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, clientX: cx, clientY: cy }))
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy }))
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }))
        return { success: true, message: '悬停成功' }
      }
      default:
        return { success: false, message: `iframe 不支持的操作: ${action}` }
    }
  } catch (err) {
    return { success: false, message: `操作异常: ${err instanceof Error ? err.message : String(err)}` }
  }
}
