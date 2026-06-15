export default defineBackground(() => {
  // 存储进行中的流式请求，便于中止
  const activeStreams = new Map<string, { reader: ReadableStreamDefaultReader; tabId: number }>();

  // 工具栏图标点击
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'zwf-toggle' }).catch(() => {});
    }
  });

  // 快捷键
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-chat') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'zwf-toggle' }).catch(() => {});
    }
  });

  // 生成唯一请求 ID
  function generateRequestId(): string {
    return `stream_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  // 监听来自 content script 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

      fetch(url, {
        method: method || 'POST',
        headers: headers || {},
        body: body,
      })
        .then(async (res) => {
          if (!res.ok) {
            const text = await res.text();
            sendResponse({ success: false, error: `HTTP ${res.status}: ${text}` });
            return;
          }

          // 返回成功，包含 requestId
          sendResponse({ success: true, streaming: true, requestId });

          // 读取流并转发到 content script
          const reader = res.body?.getReader();
          if (!reader || !sender.tab?.id) return;

          // 存储活跃流，便于中止
          activeStreams.set(requestId, { reader, tabId: sender.tab.id });

          const decoder = new TextDecoder();
          let buffer = '';

          try {
            while (true) {
              // 检查是否已被中止
              if (!activeStreams.has(requestId)) {
                console.log('[Background] 流已被中止，停止读取', { requestId });
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
              console.log('[Background] 流已中止', { requestId });
              return;
            }
            console.error('[Background] 流读取异常:', streamErr);
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
          console.error('[Background] 流式请求异常:', err);
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
    if (message.type === 'zwf-drawer-changed') {
      const { open } = message;
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id && tab.id !== sender.tab?.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'zwf-drawer-sync', open }).catch(() => {});
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
          sendResponse({ success: true, message: `新标签页: ${tab.id}` });
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
        chrome.tabs.query({}).then((tabs) => {
          const target = tabs.find((tab) => {
            const title = (tab.title || '').toLowerCase();
            const url = (tab.url || '').toLowerCase();
            return title.includes(query.toLowerCase()) || url.includes(query.toLowerCase());
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
        console.log('[Background] 中止流式请求', { requestId });
        // 取消读取
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
