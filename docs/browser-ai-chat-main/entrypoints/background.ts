export default defineBackground(() => {
  // 工具栏图标点击：广播切换
  chrome.action.onClicked.addListener(async (tab) => {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { type: 'zwf-toggle' }).catch(() => {});
  });

  // 快捷键 ctrl+shift+b
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-chat') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'zwf-toggle' }).catch(() => {});
    }
  });
});
