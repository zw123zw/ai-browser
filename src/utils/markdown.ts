import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
// @ts-ignore - markdown-it-katex 没有 TS 声明
import mk from 'markdown-it-katex';

const COPY_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(str: string, lang: string): string {
    let highlighted: string;
    if (lang && hljs.getLanguage(lang)) {
      try {
        highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      } catch {
        highlighted = md.utils.escapeHtml(str);
      }
    } else {
      highlighted = md.utils.escapeHtml(str);
    }
    const langLabel = lang ? `<span class="aib-code-lang">${lang}</span>` : '';
    return `<div class="aib-code-wrapper">${langLabel}<button class="aib-code-copy-btn" title="复制代码">${COPY_SVG}</button><pre class="aib-code"><code class="hljs${lang ? ` language-${lang}` : ''}">${highlighted}</code></pre></div>`;
  },
});

md.use(mk, { throwOnError: false, errorColor: '#cc0000' });

// 自定义表格渲染：包裹一层容器 + 下载按钮
const DOWNLOAD_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
md.renderer.rules.table_open = () => '<div class="aib-table-wrapper"><table>';
md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
  `</table><button class="aib-table-download-btn" title="下载 Excel">${DOWNLOAD_SVG}</button></div>`;

export function renderMarkdown(text: string): string {
  if (!text) return '';
  return md.render(text);
}

/** 纯净版 markdown 渲染（无复制按钮、无下载按钮） */
const mdPlain: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(str: string, lang: string): string {
    let highlighted: string;
    if (lang && hljs.getLanguage(lang)) {
      try {
        highlighted = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
      } catch {
        highlighted = mdPlain.utils.escapeHtml(str);
      }
    } else {
      highlighted = mdPlain.utils.escapeHtml(str);
    }
    return `<pre class="aib-code"><code class="hljs${lang ? ` language-${lang}` : ''}">${highlighted}</code></pre>`;
  },
});

export function renderMarkdownPlain(text: string): string {
  if (!text) return '';
  return mdPlain.render(text);
}
