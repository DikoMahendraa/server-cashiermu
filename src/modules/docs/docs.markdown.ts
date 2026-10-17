import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import ini from 'highlight.js/lib/languages/ini';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import { DOCS_BASE_PATH, resolveDocLink } from './docs.pages';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerAliases(['ts'], { languageName: 'typescript' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['md'], { languageName: 'markdown' });
hljs.registerAliases(['env', 'dotenv'], { languageName: 'ini' });

export interface TocItem {
  level: 2 | 3;
  id: string;
  text: string;
}

export interface RenderedMarkdown {
  title: string;
  html: string;
  toc: TocItem[];
  /** Every heading id on the page (any level) — used to verify `#anchor` links. */
  ids: string[];
}

interface RenderEnv {
  file: string;
  toc: TocItem[];
  ids: string[];
  title: string;
  seen: Map<string, number>;
  currentId: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** GitHub-style heading slug, so links written for GitHub keep working. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-'); // one hyphen per space, like GitHub ("a  b" → "a--b");
}

const md = new MarkdownIt({
  html: false, // raw HTML in markdown is escaped, never rendered
  linkify: true,
  highlight(code, lang) {
    const language = lang && hljs.getLanguage(lang) ? lang : undefined;
    const body = language ? hljs.highlight(code, { language, ignoreIllegals: true }).value : escapeHtml(code);
    const label = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
    return `<pre class="code"${label}><code class="hljs">${body}</code></pre>`;
  },
});

// Headings: stable ids, a "#" permalink, and a table of contents collected while rendering.
const defaultHeadingOpen = md.renderer.rules.heading_open;
md.renderer.rules.heading_open = (tokens, idx, options, env: RenderEnv, self) => {
  const token = tokens[idx];
  const inline = tokens[idx + 1];
  const text = (inline?.children ?? [])
    .filter(child => child.type === 'text' || child.type === 'code_inline')
    .map(child => child.content)
    .join('');

  const base = slugify(text) || 'section';
  const count = env.seen.get(base) ?? 0;
  env.seen.set(base, count + 1);
  const id = count === 0 ? base : `${base}-${count}`;

  token.attrSet('id', id);
  env.currentId = id;
  env.ids.push(id);

  const level = Number(token.tag.slice(1));
  if (level === 1 && !env.title) env.title = text;
  if (level === 2 || level === 3) env.toc.push({ level, id, text });

  return defaultHeadingOpen
    ? defaultHeadingOpen(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options);
};
md.renderer.rules.heading_close = (tokens, idx, _options, env: RenderEnv) =>
  `<a class="anchor" href="#${escapeHtml(env.currentId)}" aria-label="Link to this section">#</a></${tokens[idx].tag}>\n`;

// Links: relative .md links become docs-site links; external links open safely in a new tab.
const defaultLinkOpen = md.renderer.rules.link_open;
md.renderer.rules.link_open = (tokens, idx, options, env: RenderEnv, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') ?? '';

  if (/^https?:\/\//i.test(href)) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  } else if (!href.startsWith('#') && !/^mailto:/i.test(href)) {
    const [pathPart, fragment] = href.split('#');
    const page = pathPart ? resolveDocLink(env.file, pathPart) : undefined;
    if (page) {
      token.attrSet('href', `${DOCS_BASE_PATH}/${page.slug}${fragment ? `#${fragment}` : ''}`);
    } else {
      token.attrSet('href', '#');
      token.attrJoin('class', 'broken-link');
      token.attrSet('title', 'This file is not part of the docs site');
    }
  }

  return defaultLinkOpen ? defaultLinkOpen(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
};

// Tables scroll sideways on small screens instead of breaking the layout.
md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

export function renderMarkdown(source: string, file: string): RenderedMarkdown {
  const env: RenderEnv = { file, toc: [], ids: [], title: '', seen: new Map(), currentId: '' };
  const html = md.render(source, env);
  return { title: env.title || file, html, toc: env.toc, ids: env.ids };
}
