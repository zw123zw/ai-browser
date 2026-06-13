export default defineBackground(() => {
  console.log('[Background] ========== 服务启动 ==========');
  console.log('[Background] 扩展 ID:', chrome.runtime.id);

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

          // 返回成功，开始流式传输
          sendResponse({ success: true, streaming: true });

          // 读取流并转发到 content script
          const reader = res.body?.getReader();
          if (!reader || !sender.tab?.id) return;

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // 发送数据块到 content script
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'stream-chunk',
              chunk: buffer,
            }).catch(() => {});

            buffer = '';
          }

          // 发送流结束
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'stream-end',
          }).catch(() => {});
        })
        .catch((err) => {
          sendResponse({ success: false, error: String(err) });
        });

      return true;
    }
  });

  console.log('[Background] 服务就绪');
});
