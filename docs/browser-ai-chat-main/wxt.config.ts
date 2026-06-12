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
    name: 'ZWF AI Chat',
    description: '浏览器内 AI 对话助手',
    version: '0.0.1',
    permissions: ['storage', 'activeTab'],
    host_permissions: ['<all_urls>'],
    icons: {
      '16': 'icon.png',
      '32': 'icon.png',
      '48': 'icon.png',
      '96': 'icon.png',
      '128': 'icon.png',
    },
    action: {
      default_title: 'ZWF AI Chat',
      default_icon: {
        '16': 'icon.png',
        '32': 'icon.png',
        '48': 'icon.png',
      },
    },
    web_accessible_resources: [
      {
        resources: ['icon.png'],
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
