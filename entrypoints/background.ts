export default defineBackground(() => {
  console.info('[Background] 服务已启动');

  // 工具栏图标点击：广播切换
  chrome.action.onClicked.addListener(async (tab) => {
    console.info('[Background] 工具栏图标点击', { tabId: tab.id });
    if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'zwf-toggle' }).catch(() => {});
  });

  // 快捷键 ctrl+shift+b
  chrome.commands.onCommand.addListener(async (command) => {
    console.info('[Background] 快捷键命令', { command });
    if (command !== 'toggle-chat') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'zwf-toggle' }).catch(() => {});
    }
  });
});
