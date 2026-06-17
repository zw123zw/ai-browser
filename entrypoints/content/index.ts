import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import globalCss from '@/src/styles/global.css?inline';
import { initAllSkeletonIds } from '@/src/browser/skeleton-id';
import { settingsStorage, conversationStorage } from '@/src/storage';
import { TranslateService } from '@/src/browser/translate-service';
import { showTranslateLoading, updateTranslateResult, updateTranslateError, hideTranslatePopup } from '@/src/browser/translate-popup';
import { initClickTranslate } from '@/src/browser/translate-click';
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

    /** 检测元素是否在扩展 Shadow DOM 内（穿透 shadow 边界） */
    function isInExtensionUI(el: Node | null): boolean {
      if (!el) return false
      const node = el instanceof HTMLElement ? el : el.parentElement
      if (!node) return false
      if (node.closest('.zwf-translate-popup')) return true
      // getRootNode() 穿透 shadow 边界
      const root = node.getRootNode()
      if (root instanceof ShadowRoot) {
        const host = root.host as HTMLElement
        // 扩展 UI 的 host 是 body 的直接子元素 + 固定定位 + 零尺寸
        if (host.parentElement === document.body && host.style.position === 'fixed' && host.style.width === '0') return true
        if (host.getAttribute('data-shadow-root') !== null) return true
      }
      return false
    }

    /** 从 storage 读取最新设置 */
    async function getTranslateSettings() {
      try {
        const settings = await settingsStorage.getValue()
        return settings
      } catch {
        return null
      }
    }

    /** 读取当前会话的模型 ID（跟随用户在聊天区域的选择） */
    async function getCurrentModelId(): Promise<string | undefined> {
      try {
        const conv = await conversationStorage.getValue()
        return conv?.modelId
      } catch {
        return undefined
      }
    }

    // --- 点击翻译：click 监听 ---
    initClickTranslate(translateService, getTranslateSettings, getCurrentModelId)

    // --- 划词翻译：mouseup 监听 ---
    document.addEventListener('mouseup', async (e) => {
      // 忽略在扩展 UI 内的点击
      const target = e.target as HTMLElement
      if (isInExtensionUI(target)) return

      const settings = await getTranslateSettings()
      if (settings?.translateMode !== 'selection') return

      // 同步捕获选中文本（在 App.vue 清除选区之前已通过 capture 阶段保护）
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      // 排除扩展抽屉内的选区
      if (isInExtensionUI(selection.anchorNode)) return
      const text = selection.toString().trim()
      if (!text || text.length < 2) return

      const mouseX = e.clientX
      const mouseY = e.clientY

      const targetLang = settings.translateTargetLang || '中文'

      async function doTranslate() {
        try {
          log.info('[划词翻译] 触发', { text: text.slice(0, 50), targetLang })
          const modelId = await getCurrentModelId()
          const translated = await translateService.translateSelection(text, targetLang, settings, modelId)

          if (translated) {
            log.info('[划词翻译] 完成', { translated: translated.slice(0, 50) })
            updateTranslateResult(translated)
          } else {
            log.warn('[划词翻译] AI 返回空结果')
            updateTranslateError('翻译失败：AI 返回空结果', doTranslate)
          }
        } catch (err) {
          log.error('[划词翻译] 失败', err)
          const msg = err instanceof Error ? err.message : '翻译失败，请重试'
          updateTranslateError(msg, doTranslate)
        }
      }

      showTranslateLoading(mouseX, mouseY, text)
      doTranslate()
    })

    // --- 自动翻译：执行翻译 ---
    async function runAutoTranslate() {
      const settings = await getTranslateSettings()
      if (settings?.translateMode !== 'auto') {
        log.debug('[自动翻译] 未开启，跳过')
        return
      }

      try {
        const targetLang = settings.translateTargetLang || '中文'
        const modelId = await getCurrentModelId()
        log.info('[自动翻译] 开始提取可视区域文本', { targetLang, modelId })
        const count = await translateService.translateVisible(targetLang, settings, modelId)
        log.info('[自动翻译] 首次翻译完成', { translatedCount: count })
      } catch (err) {
        log.error('[自动翻译] 翻译失败', err)
      }
    }

    // --- 自动翻译：页面加载后首次触发 ---
    async function initAutoTranslate() {
      log.info('[自动翻译] 页面加载，检查是否开启')
      // 等待 DOM 稳定
      await new Promise(resolve => setTimeout(resolve, 500))
      await runAutoTranslate()
    }

    if (document.readyState === 'complete') {
      initAutoTranslate()
    } else {
      window.addEventListener('load', () => initAutoTranslate(), { once: true })
    }

    // --- 自动翻译：监听设置变化，切换到 auto 立即触发，切走时还原 ---
    settingsStorage.watch((newValue, oldValue) => {
      if (!newValue || !oldValue) return
      const oldMode = (oldValue as any).translateMode
      const newMode = (newValue as any).translateMode
      if (oldMode === newMode) return
      log.info('[翻译] 模式变化', { from: oldMode, to: newMode })

      // 切换到 auto → 立即触发翻译
      if (newMode === 'auto') {
        log.info('[自动翻译] 用户开启，立即触发')
        runAutoTranslate()
      }

      // 从 auto 切走 → 还原所有翻译
      if (oldMode === 'auto' && newMode !== 'auto') {
        log.info('[自动翻译] 用户关闭，还原文字')
        translateService.restoreAll()
      }
    })

    // --- 自动翻译：URL 变化时重新翻译 ---
    let currentUrl = location.href
    let urlChangeTimer: ReturnType<typeof setTimeout> | null = null

    function onUrlChange(source: string) {
      const newUrl = location.href
      if (newUrl === currentUrl) return
      currentUrl = newUrl
      log.info(`[自动翻译] URL 变化 (${source})`, { url: newUrl })

      if (urlChangeTimer) clearTimeout(urlChangeTimer)
      urlChangeTimer = setTimeout(async () => {
        translateService.reset()
        await runAutoTranslate()
      }, 800)
    }

    // 监听 pushState / replaceState（SPA 路由跳转）
    const origPushState = history.pushState
    const origReplaceState = history.replaceState

    history.pushState = function (...args) {
      origPushState.apply(this, args)
      onUrlChange('pushState')
    }

    history.replaceState = function (...args) {
      origReplaceState.apply(this, args)
      onUrlChange('replaceState')
    }

    window.addEventListener('popstate', () => onUrlChange('popstate'))
    window.addEventListener('hashchange', () => onUrlChange('hashchange'))

    // MutationObserver 监听 DOM 变化：新增节点 / 文本修改 → 自动翻译
    // 覆盖 hash 路由、Tab 切换、弹窗、接口返回新文本等所有动态场景
    let domTranslateTimer: ReturnType<typeof setTimeout> | null = null

    const domObserver = new MutationObserver((mutations) => {
      // 过滤：仅关注子节点新增或文本内容变化，忽略纯属性修改
      const hasTextChange = mutations.some(m =>
        m.addedNodes.length > 0 || m.type === 'characterData'
      )
      if (!hasTextChange) return

      if (domTranslateTimer) clearTimeout(domTranslateTimer)
      domTranslateTimer = setTimeout(async () => {
        const settings = await getTranslateSettings()
        if (settings?.translateMode !== 'auto') return
        log.info('[自动翻译] DOM 变化，扫描新文本')
        await runAutoTranslate()
      }, 200)
    })

    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
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
