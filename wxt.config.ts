import { defineConfig } from 'wxt';

// 参考: https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  srcDir: '.',
  // 强制 esbuild 输出 ASCII，规避 Chrome "isn't UTF-8 encoded" 错误
  vite: () => ({
    esbuild: { charset: 'ascii' },
    build: { cssMinify: 'esbuild' },
  }),
  manifest: {
    name: '小灵 - AI 语音浏览器助手',
    description: '小灵 LingBot - AI 语音浏览器助手 | AI Voice Browser Assistant',
    version: '1.3.1',
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'scripting', 'tabs'],
    host_permissions: [
      '<all_urls>',
      'https://*.dashscope.aliyuncs.com/*',
      'https://*.aip.baidubce.com/*',
      'https://*.xfyun.cn/*',
      'http://127.0.0.1:11434/*',
    ],
    icons: {
      '16': 'icon.png',
      '32': 'icon.png',
      '48': 'icon.png',
      '96': 'icon.png',
      '128': 'icon.png',
    },
    action: {
      default_title: '小灵 - AI 语音浏览器助手',
      default_icon: {
        '16': 'icon.png',
        '32': 'icon.png',
        '48': 'icon.png',
      },
    },
    web_accessible_resources: [
      {
        resources: ['icon.png', 'guide.md'],
        matches: ['<all_urls>'],
      },
      {
        resources: ['tesseract/*.gz'],
        matches: ['<all_urls>'],
      },
    ],
    commands: {
      'toggle-chat': {
        suggested_key: {
          default: 'Ctrl+Shift+M',
          mac: 'Command+Shift+M',
        },
        description: '打开/关闭 AI 对话面板',
      },
    },
  },
});
