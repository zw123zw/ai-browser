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
    name: 'AI 语音浏览器助手',
    description: '支持语音控制 + 网页自动化 + 多模型切换的 AI 浏览器助手',
    version: '1.0.0',
    permissions: ['storage', 'activeTab', 'scripting', 'tabs'],
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
      default_title: 'AI 语音浏览器助手',
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
