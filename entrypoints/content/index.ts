import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import globalCss from '@/src/styles/global.css?inline';
import { initAllSkeletonIds } from '@/src/browser/skeleton-id';
import { settingsStorage } from '@/src/storage';
import { TranslateService } from '@/src/browser/translate-service';
import { showTranslateLoading, updateTranslateResult, hideTranslatePopup } from '@/src/browser/translate-popup';
import { Logger } from '@/src/utils/logger';

const log = new Logger('ContentScript');

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',
  async main(ctx) {
    // 首次全量打标：骨架提取时已有 id 的元素直接跳过，减少 DOM 写入
    // 等页面完全加载 + 延迟 1s，让 SPA 动态内容有时间渲染
    const markAll = () => setTimeout(() => initAllSkeletonIds(), 1000)
    if (document.readyState === 'complete') {
      markAll()
    } else {
      window.addEventListener('load', markAll, { once: true })
    }

    // ═══════════════════════════════════════════════════════════════
    // 翻译功能初始化
    // ═══════════════════════════════════════════════════════════════

    const translateService = new TranslateService()

    /** 从 storage 读取最新设置 */
    async function getTranslateSettings() {
      try {
        const settings = await settingsStorage.getValue()
        return settings
      } catch {
        return null
      }
    }

    // --- 划词翻译：mouseup 监听 ---
    document.addEventListener('mouseup', async (e) => {
      // 忽略在扩展 UI 内的点击
      const target = e.target as HTMLElement
      if (target.closest('.zwf-translate-popup') || target.closest('[data-shadow-root]')) return

      const settings = await getTranslateSettings()
      if (!settings?.selectionTranslate) return

      // 延迟获取选区，确保 mouseup 后 Selection 已更新
      setTimeout(async () => {
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return
        const text = selection.toString().trim()
        if (!text || text.length < 2) return

        try {
          const targetLang = settings.translateTargetLang || '中文'
          log.info('[划词翻译] 触发', { text: text.slice(0, 50), targetLang })

          // 立即弹出浮层 + loading
          showTranslateLoading(e.clientX, e.clientY, text)

          const translated = await translateService.translateSelection(text, targetLang, settings)

          if (translated) {
            log.info('[划词翻译] 完成', { translated: translated.slice(0, 50) })
            updateTranslateResult(translated)
          } else {
            log.warn('[划词翻译] AI 返回空结果')
            hideTranslatePopup()
          }
        } catch (err) {
          log.error('[划词翻译] 失败', err)
          hideTranslatePopup()
        }
      }, 10)
    })

    // --- 自动翻译：执行翻译 ---
    async function runAutoTranslate() {
      const settings = await getTranslateSettings()
      if (!settings?.autoTranslate) {
        log.debug('[自动翻译] 未开启，跳过')
        return
      }

      try {
        const targetLang = settings.translateTargetLang || '中文'
        log.info('[自动翻译] 开始提取可视区域文本', { targetLang })
        const count = await translateService.translateVisible(targetLang, settings)
        log.info('[自动翻译] 首次翻译完成', { translatedCount: count })
      } catch (err) {
        log.error('[自动翻译] 翻译失败', err)
      }
    }

    // --- 自动翻译：页面加载后首次触发 ---
    async function initAutoTranslate() {
      log.info('[自动翻译] 页面加载，检查是否开启')
      // 等待页面加载完成 + 延迟，确保 DOM 稳定
      await new Promise(resolve => setTimeout(resolve, 2000))
      await runAutoTranslate()
    }

    if (document.readyState === 'complete') {
      initAutoTranslate()
    } else {
      window.addEventListener('load', () => initAutoTranslate(), { once: true })
    }

    // --- 自动翻译：监听设置变化，开启后立即触发，关闭后还原 ---
    settingsStorage.watch((newValue, oldValue) => {
      if (!newValue || !oldValue) return
      const wasAuto = (oldValue as any).autoTranslate
      const isAuto = (newValue as any).autoTranslate
      log.info('[自动翻译] 设置变化', { wasAuto, isAuto })

      // 从关 → 开：立即触发翻译
      if (!wasAuto && isAuto) {
        log.info('[自动翻译] 用户开启自动翻译，立即触发')
        runAutoTranslate()
      }

      // 从开 → 关：还原所有翻译
      if (wasAuto && !isAuto) {
        log.info('[自动翻译] 用户关闭自动翻译，还原文字')
        translateService.restoreAll()
      }
    })

    // ═══════════════════════════════════════════════════════════════
    // Vue 应用挂载
    // ═══════════════════════════════════════════════════════════════

    const ui = await createShadowRootUi(ctx, {
      name: 'browser-ai-chat',
      position: 'inline',
      anchor: 'body',
      onMount(container, _shadow, shadowHost) {
        // 把全局样式塞进 shadow root
        const style = document.createElement('style');
        style.textContent = globalCss;
        _shadow.appendChild(style);

        // host 自身做绝对定位容器
        shadowHost.style.position = 'fixed';
        shadowHost.style.zIndex = '2147483647';
        shadowHost.style.top = '0';
        shadowHost.style.left = '0';
        shadowHost.style.width = '0';
        shadowHost.style.height = '0';

        const app = createApp(App);
        app.use(createPinia());
        app.mount(container);
        return app;
      },
      onRemove(app) {
        app?.unmount();
        // 清理翻译状态
        translateService.reset()
        hideTranslatePopup()
      },
    });

    ui.mount();
  },
});
