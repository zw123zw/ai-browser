import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import globalCss from '@/src/styles/global.css?inline';
import { initAllSkeletonIds } from '@/src/browser/skeleton-id';
import { settingsStorage, conversationStorage, queuedTaskStorage } from '@/src/storage';
import { TranslateService } from '@/src/browser/translate-service';
import { showTranslateLoading, updateTranslateResult, updateNoteResult, updateTranslateError, hideTranslatePopup } from '@/src/browser/translate-popup';
import { initClickTranslate } from '@/src/browser/translate-click';
import { optimizeAsNote } from '@/src/browser/note-service';
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
    // 笔记跳转：URL hash 滚动 + 高亮闪烁
    // ═══════════════════════════════════════════════════════════════
    function handleNoteJump() {
      const hash = location.hash
      if (!hash || !hash.includes('aib-scroll')) return

      try {
        const params = new URLSearchParams(hash.slice(1))
        const scrollY = parseInt(params.get('aib-scroll') || '0', 10)
        const highlightText = params.get('aib-highlight') || ''

        // 清除 hash（避免刷新重复触发）
        history.replaceState(null, '', location.pathname + location.search)

        // 等页面稳定后执行
        setTimeout(() => {
          // 滚动到指定位置
          if (scrollY > 0) {
            window.scrollTo(0, scrollY)
          }

          // 高亮闪烁
          if (highlightText) {
            highlightTextOnPage(highlightText)
          }
        }, 1000)
      } catch {}
    }

    /** 在页面中查找文本并高亮闪烁 2 次 */
    function highlightTextOnPage(text: string) {
      // 用 TreeWalker 遍历文本节点
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null,
      )

      let node: Text | null
      while ((node = walker.nextNode() as Text | null)) {
        const idx = node.textContent?.indexOf(text) ?? -1
        if (idx === -1) continue

        // 找到了，用 Range 包裹并高亮
        const range = document.createRange()
        range.setStart(node, idx)
        range.setEnd(node, idx + text.length)

        const mark = document.createElement('mark')
        mark.setAttribute('translate', 'no')
        Object.assign(mark.style, {
          background: 'rgba(139, 92, 246, 0.4)',
          borderRadius: '2px',
          padding: '1px 0',
          transition: 'background 0.3s ease',
        })

        try {
          range.surroundContents(mark)
          // 滚动到高亮位置
          mark.scrollIntoView({ behavior: 'smooth', block: 'center' })

          // 闪烁 2 次
          let count = 0
          const flash = setInterval(() => {
            mark.style.background = count % 2 === 0
              ? 'rgba(139, 92, 246, 0.1)'
              : 'rgba(139, 92, 246, 0.4)'
            count++
            if (count >= 4) {
              clearInterval(flash)
              // 闪烁结束，保持浅色 3 秒后移除
              setTimeout(() => {
                mark.style.background = 'transparent'
                setTimeout(() => {
                  // 还原为普通文本
                  if (mark.parentNode) {
                    mark.parentNode.replaceChild(document.createTextNode(mark.textContent || ''), mark)
                  }
                }, 2000)
              }, 2000)
            }
          }, 300)
        } catch {
          // Range.surroundContents 可能跨元素失败，跳过
        }
        break // 只高亮第一处
      }
    }

    handleNoteJump()

    // ═══════════════════════════════════════════════════════════════
    // 翻译功能初始化
    // ═══════════════════════════════════════════════════════════════

    const translateService = new TranslateService()

    /**
     * 检测元素是否在扩展 UI 内
     *
     * Chrome 中跨 Shadow 边界的事件，e.target 被重定向为 shadow host。
     * 此时 getRootNode() 返回 document（不是 ShadowRoot），
     * 所以必须用 el.shadowRoot 检测 host。
     */
    function isInExtensionUI(el: Node | null): boolean {
      if (!el) return false
      const node = el instanceof HTMLElement ? el : el.parentElement
      if (!node) return false
      // 翻译/笔记浮层（注入到页面 DOM）
      if (node.closest('.aib-translate-popup')) return true
      // 点击翻译/笔记结果框（注入到页面 DOM）
      if (node.closest('.aib-click-result')) return true
      // 方式1：元素本身在 Shadow DOM 内 → getRootNode() 返回 ShadowRoot
      const root = node.getRootNode()
      if (root instanceof ShadowRoot) return true
      // 方式2：元素本身就是 shadow host（事件 target 被重定向的情况）
      if (node.shadowRoot instanceof ShadowRoot) return true
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

    // --- 划词翻译/笔记：mouseup 监听 ---
    document.addEventListener('mouseup', async (e) => {
      // 忽略在扩展 UI 内的点击
      const target = e.target as HTMLElement
      if (isInExtensionUI(target)) return

      const settings = await getTranslateSettings()
      const isTranslate = settings?.translateMode === 'selection'
      const isNote = settings?.noteMode === 'selection'
      if (!isTranslate && !isNote) return

      // 同步捕获选中文本（在 App.vue 清除选区之前已通过 capture 阶段保护）
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      // 排除扩展抽屉内的选区（anchorNode 在 Shadow DOM 内）
      if (isInExtensionUI(selection.anchorNode) || isInExtensionUI(selection.focusNode)) return
      const text = selection.toString().trim()
      if (!text || text.length < 2) return

      const mouseX = e.clientX
      const mouseY = e.clientY
      const targetLang = settings?.translateTargetLang || '中文'

      // 收藏笔记回调
      function onBookmark(noteContent: string) {
        window.dispatchEvent(new CustomEvent('aib-bookmark-note', {
          detail: { content: noteContent, url: location.href, scrollY: window.scrollY, selectedText: text, source: 'selection' },
        }))
      }

      // 显示浮层
      showTranslateLoading(mouseX, mouseY, text)

      // 并行调用翻译和笔记 AI
      const tasks: Promise<void>[] = []

      if (isTranslate) {
        tasks.push(
          (async () => {
            try {
              log.info('[划词翻译] 触发', { text: text.slice(0, 50), targetLang })
              const modelId = await getCurrentModelId()
              const translated = await translateService.translateSelection(text, targetLang, settings!, modelId)
              if (translated) {
                log.info('[划词翻译] 完成', { translated: translated.slice(0, 50) })
                updateTranslateResult(translated)
              } else {
                log.warn('[划词翻译] AI 返回空结果')
                updateTranslateError('翻译失败：AI 返回空结果')
              }
            } catch (err) {
              log.error('[划词翻译] 失败', err)
              const msg = err instanceof Error ? err.message : '翻译失败，请重试'
              updateTranslateError(msg)
            }
          })(),
        )
      }

      if (isNote) {
        tasks.push(
          (async () => {
            try {
              log.info('[划词笔记] 触发', { text: text.slice(0, 50) })
              const modelId = await getCurrentModelId()
              const noteContent = await optimizeAsNote(text, settings!, modelId)
              if (noteContent) {
                log.info('[划词笔记] 完成', { noteContent: noteContent.slice(0, 50) })
                updateNoteResult(noteContent, onBookmark)
              } else {
                log.warn('[划词笔记] AI 返回空结果')
              }
            } catch (err) {
              log.error('[划词笔记] 失败', err)
            }
          })(),
        )
      }

      // 等待所有任务完成
      await Promise.allSettled(tasks)
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

    // --- 自动笔记：页面加载时 AI 提炼笔记 ---
    async function runAutoNote() {
      const settings = await getTranslateSettings()
      if (settings?.noteMode !== 'auto') {
        log.debug('[自动笔记] 未开启，跳过')
        return
      }

      try {
        // 提取页面文本（精简格式，带来源信息）
        const pageText = [
          `来源: ${document.title} | ${location.href}`,
          '',
          document.body.innerText,
        ].join('\n').slice(0, 15000)

        if (pageText.length < 100) {
          log.debug('[自动笔记] 页面内容过少，跳过')
          return
        }

        // 生成占位消息 ID
        const placeholderId = 'auto-note-' + Date.now()

        // 先在聊天区显示占位消息
        window.dispatchEvent(new CustomEvent('aib-auto-note-start', {
          detail: { id: placeholderId, content: '📝 正在为你分析页面内容，生成笔记...' },
        }))

        // 复用 optimizeAsNote（与划词/点击笔记同一套提示词）
        const modelId = await getCurrentModelId()
        log.info('[自动笔记] 触发', { url: location.href.slice(0, 80) })
        const result = await optimizeAsNote(pageText, settings, modelId)

        if (!result) {
          log.warn('[自动笔记] AI 返回空结果')
          // 更新占位消息为失败提示
          window.dispatchEvent(new CustomEvent('aib-auto-note-result', {
            detail: { id: placeholderId, content: '⚠️ 笔记生成失败，AI 返回空结果' },
          }))
          return
        }

        log.info('[自动笔记] 完成', { length: result.length, preview: result.slice(0, 80) })

        // 更新占位消息为实际笔记内容
        window.dispatchEvent(new CustomEvent('aib-auto-note-result', {
          detail: { id: placeholderId, content: result },
        }))
      } catch (err) {
        log.error('[自动笔记] 失败', err)
      }
    }

    // --- 自动笔记：页面加载后触发 ---
    async function initAutoNote() {
      log.info('[自动笔记] 页面加载，检查是否开启')
      await new Promise(resolve => setTimeout(resolve, 1000)) // 等页面稳定
      await runAutoNote()
    }

    if (document.readyState === 'complete') {
      initAutoNote()
    } else {
      window.addEventListener('load', () => initAutoNote(), { once: true })
    }

    // --- 自动翻译：URL 变化时重新翻译 ---
    let currentUrl = location.href
    let urlChangeTimer: ReturnType<typeof setTimeout> | null = null

    function onUrlChange(source: string) {
      const newUrl = location.href
      if (newUrl === currentUrl) return
      currentUrl = newUrl
      log.info(`[自动翻译/笔记] URL 变化 (${source})`, { url: newUrl })

      if (urlChangeTimer) clearTimeout(urlChangeTimer)
      urlChangeTimer = setTimeout(async () => {
        translateService.reset()
        await runAutoTranslate()
        await runAutoNote()
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

    // ═══════════════════════════════════════════════
    // 跨标签页续接：检查是否有排队任务需要恢复
    // ═══════════════════════════════════════════════
    try {
      const queuedTask = await queuedTaskStorage.getValue()
      if (queuedTask) {
        // 过期保护：30 秒前的旧任务直接丢弃（新标签页可能已关闭或加载失败）
        if (Date.now() - queuedTask.timestamp > 30_000) {
          log.warn('[跨标签页续接] 任务已过期，丢弃', { age: Date.now() - queuedTask.timestamp })
          await queuedTaskStorage.setValue(null)
        } else {
          log.info('[跨标签页续接] 检测到排队任务', { originalRequest: queuedTask.originalRequest, completedSteps: queuedTask.completedSteps.length })
          await queuedTaskStorage.setValue(null)

          // Vue 已 mount，直接恢复（pipeline 自带 sleep 等页面稳定）
          try {
            const { usePipeline } = await import('@/src/composables/usePipeline')
            const { resumeQueuedTask } = usePipeline()
            await resumeQueuedTask(queuedTask)
          } catch (err) {
            log.error('[跨标签页续接] 恢复失败', err)
          }
        }
      }
    } catch (err) {
      log.error('[跨标签页续接] 检查排队任务失败', err)
    }
  },
});
