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

export function renderMarkdown(text: string): string {
  if (!text) return '';
  return md.render(text);
}
