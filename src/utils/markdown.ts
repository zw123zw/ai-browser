import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
// @ts-ignore - markdown-it-katex 没有 TS 声明
import mk from 'markdown-it-katex';

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const code = hljs.highlight(str, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="zwf-code"><code class="hljs language-${lang}">${code}</code></pre>`;
      } catch {}
    }
    return `<pre class="zwf-code"><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

md.use(mk, { throwOnError: false, errorColor: '#cc0000' });

// 自定义表格渲染：包裹一层容器 + 下载按钮
const DOWNLOAD_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
md.renderer.rules.table_open = () => '<div class="zwf-table-wrapper"><table>';
md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
  `</table><button class="zwf-table-download-btn" title="下载 Excel">${DOWNLOAD_SVG}</button></div>`;

export function renderMarkdown(text: string): string {
  if (!text) return '';
  return md.render(text);
}
