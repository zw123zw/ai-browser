import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import globalCss from '@/src/styles/global.css?inline';
import { initAllSkeletonIds } from '@/src/browser/skeleton-id';
import { settingsStorage, conversationStorage, queuedTaskStorage } from '@/src/storage';
import { TranslateService } from '@/src/browser/translate-service';
import { showTranslateLoading, updateTranslateResult, updateTranslateStreaming, updateNoteResult, updateNoteStreaming, updateTranslateError, hideTranslatePopup } from '@/src/browser/translate-popup';
import { initClickTranslate } from '@/src/browser/translate-click';
import { optimizeAsNoteStream, optimizeAsNote } from '@/src/browser/note-service';
import { createAdapter } from '@/src/adapters';
import { buildSelectionTranslateMessage, TRANSLATE_SYSTEM_PROMPT } from '@/src/input/prompts/translate';
import { parseSingleTranslation } from '@/src/browser/translate-parser';
import type { StreamChunk } from '@/src/types';
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
        log.info('[笔记跳转] 解析参数', { scrollY, highlightText: highlightText.slice(0, 30) })

        // 用 sessionStorage 标记已处理，防止刷新重复触发（不用 replaceState，避免触发滚动重置）
        const jumpKey = `aib-jump-${location.href}`
        if (sessionStorage.getItem(jumpKey)) {
          // 已处理过，清除 hash（此时页面已稳定，replaceState 不会再影响滚动）
          history.replaceState(null, '', location.pathname + location.search)
          return
        }
        sessionStorage.setItem(jumpKey, '1')

        // 禁用浏览器自动滚动恢复
        history.scrollRestoration = 'manual'

        // 查找滚动容器（从高亮文本位置向上找，与保存时一致）
        function findContainer(): HTMLElement | null {
          if (document.documentElement.scrollHeight > document.documentElement.clientHeight) {
            return null // null = 用 window.scrollTo
          }
          // 从高亮文本找
          if (highlightText) {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
            let node: Text | null
            while ((node = walker.nextNode() as Text | null)) {
              if (node.textContent?.includes(highlightText.slice(0, 30))) {
                let el: HTMLElement | null = node.parentElement
                while (el && el !== document.body) {
                  const style = window.getComputedStyle(el)
                  if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
                    return el
                  }
                  el = el.parentElement
                }
                break
              }
            }
          }
          // 兜底：找最大容器
          const allDivs = document.querySelectorAll('div')
          let best: HTMLElement | null = null
          let bestScore = 0
          for (const div of allDivs) {
            if (div.scrollHeight > div.clientHeight + 50) {
              const style = window.getComputedStyle(div)
              if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                const score = div.scrollHeight - div.clientHeight
                if (score > bestScore) { bestScore = score; best = div }
              }
            }
          }
          return best
        }

        // 滚动 + 验证 + 重试（只在未到位时重试）
        let scrollDone = false
        let retries = 0
        function doScroll() {
          if (scrollDone || retries >= 5) return
          retries++
          const container = findContainer()
          if (container) {
            container.scrollTop = scrollY
            scrollDone = Math.abs(container.scrollTop - scrollY) < 50
          } else {
            window.scrollTo(0, scrollY)
            scrollDone = Math.abs(window.scrollY - scrollY) < 50
          }
          log.info('[笔记跳转] doScroll', { retry: retries, scrollDone, scrollY, actual: container ? container.scrollTop : window.scrollY })
        }

        // 延迟滚动（等页面加载），只在未到位时重试
        function tryWithDelay(delay: number) {
          setTimeout(() => {
            if (!scrollDone) doScroll()
          }, delay)
        }
        tryWithDelay(300)
        tryWithDelay(1000)
        tryWithDelay(2000)

        // 高亮闪烁：等滚动到位后再执行
        if (highlightText) {
          function tryHighlight() {
            if (scrollDone) {
              // 滚动到位了，清除 hash 并高亮
              history.replaceState(null, '', location.pathname + location.search)
              history.scrollRestoration = 'auto'
              highlightTextOnPage(highlightText)
            } else if (retries < 5) {
              // 还没到位，等一下再试
              setTimeout(tryHighlight, 500)
            } else {
              // 放弃，清除 hash
              history.replaceState(null, '', location.pathname + location.search)
              history.scrollRestoration = 'auto'
              highlightTextOnPage(highlightText)
            }
          }
          setTimeout(tryHighlight, 2500)
        } else {
          // 没有高亮文本，滚动后清除 hash
          setTimeout(() => {
            history.replaceState(null, '', location.pathname + location.search)
            history.scrollRestoration = 'auto'
          }, 2500)
        }
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

      // 查找选区所在滚动容器的 scrollTop
      function getSelectionScrollY(): number {
        // 优先：页面本身滚动
        if (document.documentElement.scrollHeight > document.documentElement.clientHeight) {
          return window.scrollY
        }
        // 查找子容器（从选区元素向上找）
        const anchor = selection?.anchorNode?.parentElement || target
        let el: HTMLElement | null = anchor
        while (el && el !== document.body) {
          const style = window.getComputedStyle(el)
          if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
            return el.scrollTop
          }
          el = el.parentElement
        }
        // 兜底：找最大容器
        const allDivs = document.querySelectorAll('div')
        let best: HTMLElement | null = null
        let bestScore = 0
        for (const div of allDivs) {
          if (div.scrollHeight > div.clientHeight + 50) {
            const style = window.getComputedStyle(div)
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
              const score = div.scrollHeight - div.clientHeight
              if (score > bestScore) { bestScore = score; best = div }
            }
          }
        }
        return best ? best.scrollTop : window.scrollY
      }

      // 收藏笔记回调
      function onBookmark(noteContent: string) {
        const savedScrollY = getSelectionScrollY()
        log.info('[收藏笔记] 保存 scrollY', { scrollY: savedScrollY, url: location.href, windowScrollY: window.scrollY })
        window.dispatchEvent(new CustomEvent('aib-bookmark-note', {
          detail: { content: noteContent, url: location.href, scrollY: savedScrollY, selectedText: text, source: 'selection' },
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
              const models = settings!.models || []
              const model = modelId
                ? models.find((m) => m.id === modelId) || models[0]
                : models.find((m) => m.id === settings!.defaultModelId) || models[0]
              if (!model) { updateTranslateError('没有可用模型'); return }

              const adapter = createAdapter(model.provider)
              const messages = [
                { id: 'sys', role: 'system' as const, content: TRANSLATE_SYSTEM_PROMPT, timestamp: Date.now() },
                { id: 'user', role: 'user' as const, content: buildSelectionTranslateMessage(text, targetLang), timestamp: Date.now() },
              ]
              let raw = ''
              await adapter.chat(
                { baseUrl: model.baseUrl || settings!.baseUrl || '', apiKey: model.apiKey || settings!.apiKey || '', modelName: model.modelName, provider: model.provider, messages },
                (chunk: StreamChunk) => {
                  if (chunk.delta) {
                    raw += chunk.delta
                    updateTranslateStreaming(chunk.delta, raw)
                  }
                },
              )
              const translated = parseSingleTranslation(raw)
              if (translated) {
                log.info('[划词翻译] 完成', { translated: translated.slice(0, 50) })
                updateTranslateResult(translated)
              } else {
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
              const noteContent = await optimizeAsNoteStream(text, settings!, (delta, full) => {
                updateNoteStreaming(delta, full)
              }, modelId)
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
      if ((document as any).__aibAutoTranslateInited) return
      ;(document as any).__aibAutoTranslateInited = true
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
    let autoNoteRunning = false
    let autoNoteAbort: AbortController | null = null
    let lastNotedUrl = ''  // 记录已生成笔记的 URL，防止同一页面重复触发
    let autoNoteTimer: ReturnType<typeof setTimeout> | null = null  // 防抖计时器

    async function runAutoNote() {
      if (autoNoteRunning) return
      // 同一 URL 已生成过笔记，跳过（URL 变化时会清除）
      if (lastNotedUrl === location.href) {
        log.debug('[自动笔记] 该页面已生成过笔记，跳过')
        return
      }
      autoNoteRunning = true
      autoNoteAbort = new AbortController()
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

        // 一条消息：占位 → 流式替换 → 最终更新
        const msgId = 'auto-note-' + Date.now()

        // 插入占位消息
        window.dispatchEvent(new CustomEvent('aib-auto-note-start', {
          detail: { id: msgId, content: '📝 正在为你分析页面内容，生成笔记...' },
        }))

        // 流式调用 AI 分析笔记
        const modelId = await getCurrentModelId()
        log.info('[自动笔记] 触发', { url: location.href.slice(0, 80), hasSignal: !!autoNoteAbort?.signal })
        const result = await optimizeAsNoteStream(pageText, settings, (delta, full) => {
          // 每个 chunk 更新同一条消息
          window.dispatchEvent(new CustomEvent('aib-auto-note-delta', {
            detail: { id: msgId, content: full },
          }))
        }, modelId, autoNoteAbort?.signal)

        // 如果已被取消（URL 变了），丢弃结果
        if (autoNoteAbort?.signal.aborted) return

        if (!result) {
          log.warn('[自动笔记] AI 返回空结果')
          window.dispatchEvent(new CustomEvent('aib-auto-note-result', {
            detail: { id: msgId, content: '⚠️ 笔记生成失败，AI 返回空结果' },
          }))
          return
        }

        log.info('[自动笔记] 完成', { length: result.length, preview: result.slice(0, 80) })

        // 最终更新：附上来源 URL
        const noteWithUrl = result + `\n\n> 📎 来源: [${document.title}](${location.href})`
        lastNotedUrl = location.href  // 标记该 URL 已生成笔记
        window.dispatchEvent(new CustomEvent('aib-auto-note-result', {
          detail: { id: msgId, content: noteWithUrl },
        }))
      } catch (err) {
        log.error('[自动笔记] 失败', err)
      } finally {
        autoNoteRunning = false
      }
    }

    // --- 自动笔记：页面加载/跳转后触发 ---
    // 用 document 级别标志防重复（content script 可能被注入多次）
    // 使用防抖计时器，避免 initAutoNote 和 contentObserver 同时触发
    function scheduleAutoNote(delay: number) {
      if (autoNoteTimer) clearTimeout(autoNoteTimer)
      autoNoteTimer = setTimeout(() => runAutoNote(), delay)
    }

    async function initAutoNote() {
      if ((document as any).__aibAutoNoteInited) return
      ;(document as any).__aibAutoNoteInited = true
      log.info('[自动笔记] 页面加载，检查是否开启')
      scheduleAutoNote(1000) // 等页面稳定后触发
    }

    if (document.readyState === 'complete') {
      initAutoNote()
    } else {
      window.addEventListener('load', () => initAutoNote(), { once: true })
    }

    // 监听停止自动笔记事件（用户点击停止按钮时触发）
    window.addEventListener('aib-stop-auto-note', () => {
      if (autoNoteAbort) {
        log.info('[自动笔记] 用户停止')
        autoNoteAbort.abort()
        autoNoteAbort = null
      }
    })

    // --- 自动翻译：URL 变化时重新翻译 ---
    let currentUrl = location.href
    let urlChangeTimer: ReturnType<typeof setTimeout> | null = null

    function onUrlChange(source: string) {
      const newUrl = location.href
      if (newUrl === currentUrl) return
      currentUrl = newUrl
      log.info(`[自动翻译/笔记] URL 变化 (${source})`, { url: newUrl })

      // 取消正在执行的自动笔记
      if (autoNoteAbort) {
        autoNoteAbort.abort()
        autoNoteAbort = null
      }
      autoNoteRunning = false
      lastNotedUrl = ''  // URL 变化，清除已笔记标记

      if (urlChangeTimer) clearTimeout(urlChangeTimer)
      urlChangeTimer = setTimeout(async () => {
        translateService.reset()
        await runAutoTranslate()
        scheduleAutoNote(0) // URL 变化后立即触发（无延迟）
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

    // --- 自动笔记：MutationObserver 检测页面内容变化 ---
    // 不依赖 URL 变化，适用于 Livewire/Turbo 等非标准 SPA 框架
    // 使用 scheduleAutoNote 防抖，避免与 initAutoNote 同时触发
    let lastContentLength = document.body.innerText.length

    const contentObserver = new MutationObserver(() => {
      const newLength = document.body.innerText.length
      const delta = Math.abs(newLength - lastContentLength)

      // 内容变化超过阈值 → 触发自动笔记
      if (delta > 200) {
        lastContentLength = newLength
        // 取消正在执行的自动笔记
        if (autoNoteAbort) {
          autoNoteAbort.abort()
          autoNoteAbort = null
        }
        autoNoteRunning = false
        scheduleAutoNote(2000) // 使用统一的防抖函数
      }
    })

    contentObserver.observe(document.body, {
      childList: true,
      subtree: true,
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
