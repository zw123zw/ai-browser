import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import globalCss from '@/src/styles/global.css?inline';

console.log('[ContentScript] 脚本已加载，准备初始化...');

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    console.log('[ContentScript] main() 开始执行');

    const ui = await createShadowRootUi(ctx, {
      name: 'browser-ai-chat',
      position: 'inline',
      anchor: 'body',
      onMount(container, _shadow, shadowHost) {
        console.log('[ContentScript] onMount 回调触发', {
          container,
          shadowRoot: !!_shadow,
          host: !!shadowHost,
        });

        // 把全局样式塞进 shadow root
        const style = document.createElement('style');
        style.textContent = globalCss;
        _shadow.appendChild(style);
        console.log('[ContentScript] 全局样式已注入');

        // host 自身做绝对定位容器
        shadowHost.style.position = 'fixed';
        shadowHost.style.zIndex = '2147483647';
        shadowHost.style.top = '0';
        shadowHost.style.left = '0';
        shadowHost.style.width = '0';
        shadowHost.style.height = '0';
        console.log('[ContentScript] ShadowHost 样式已设置');

        const app = createApp(App);
        app.use(createPinia());
        app.mount(container);
        console.log('[ContentScript] Vue 应用已挂载');
        return app;
      },
      onRemove(app) {
        console.log('[ContentScript] onRemove 回调触发，卸载应用');
        app?.unmount();
      },
    });

    console.log('[ContentScript] ShadowRoot UI 已创建，准备挂载...');
    ui.mount();
    console.log('[ContentScript] UI 已挂载到页面');
  },
});
