import { DOC_PAGES, DOCS_BASE_PATH, GROUP_LABELS, type DocGroup, type DocPage } from './docs.pages';
import { escapeHtml, type TocItem } from './docs.markdown';

export interface PageModel {
  title: string;
  bodyHtml: string;
  toc: TocItem[];
  currentSlug?: string;
  version: string;
  prev?: DocPage;
  next?: DocPage;
}

const GROUPS: DocGroup[] = ['guide', 'reference'];

function renderNav(currentSlug?: string): string {
  return GROUPS.map(group => {
    const links = DOC_PAGES.filter(page => page.group === group)
      .map(page => {
        const href = page.slug === 'overview' ? DOCS_BASE_PATH : `${DOCS_BASE_PATH}/${page.slug}`;
        const current = page.slug === currentSlug ? ' aria-current="page"' : '';
        return `<li><a href="${href}"${current}>${escapeHtml(page.navTitle)}</a></li>`;
      })
      .join('');
    return `<div class="nav-group"><p class="nav-label">${GROUP_LABELS[group]}</p><ul>${links}</ul></div>`;
  }).join('');
}

function renderToc(toc: TocItem[]): string {
  if (toc.length < 2) return '';
  const items = toc
    .map(item => `<li class="l${item.level}"><a href="#${escapeHtml(item.id)}">${escapeHtml(item.text)}</a></li>`)
    .join('');
  return `<aside class="toc" aria-label="On this page"><p class="nav-label">On this page</p><ul>${items}</ul></aside>`;
}

function renderPager(prev?: DocPage, next?: DocPage): string {
  if (!prev && !next) return '';
  const href = (page: DocPage) => (page.slug === 'overview' ? DOCS_BASE_PATH : `${DOCS_BASE_PATH}/${page.slug}`);
  const side = (page: DocPage | undefined, label: string, cls: string) =>
    page
      ? `<a class="${cls}" href="${href(page)}"><span>${label}</span>${escapeHtml(page.navTitle)}</a>`
      : '<span></span>';
  return `<nav class="pager" aria-label="Pagination">${side(prev, 'Previous', 'prev')}${side(next, 'Next', 'next')}</nav>`;
}

export function renderPage(model: PageModel): string {
  const nav = renderNav(model.currentSlug);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(model.title)} · CashierMu API docs</title>
<style>${STYLES}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="${DOCS_BASE_PATH}"><span class="logo">CM</span> CashierMu API <span class="muted">docs</span></a>
  <span class="version">v${escapeHtml(model.version)}</span>
</header>
<details class="mobile-nav"><summary>Menu</summary><nav aria-label="Documentation">${nav}</nav></details>
<div class="layout">
  <nav class="side" aria-label="Documentation">${nav}</nav>
  <main class="content">
    <article class="doc">${model.bodyHtml}</article>
    ${renderPager(model.prev, model.next)}
  </main>
  ${renderToc(model.toc)}
</div>
</body>
</html>`;
}

export function renderNotFound(version: string): string {
  return renderPage({
    title: 'Page not found',
    version,
    bodyHtml: '<h1>Page not found</h1><p>That page does not exist. Pick one from the menu.</p>',
    toc: [],
  });
}

const STYLES = `
:root{--bg:#fff;--fg:#0f172a;--muted:#64748b;--line:#e2e8f0;--side:#f8fafc;--brand:#1b9e6a;--brand-soft:#e6f5ee;--code-bg:#f1f5f9;--link:#0d7a4e;
--c-key:#c026d3;--c-str:#15803d;--c-num:#b45309;--c-com:#94a3b8;--c-title:#2563eb;--c-attr:#0e7490}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--fg:#e2e8f0;--muted:#94a3b8;--line:#1e293b;--side:#0f172a;--brand:#34d399;--brand-soft:#0f2a22;--code-bg:#111c2f;--link:#34d399;
--c-key:#e879f9;--c-str:#86efac;--c-num:#fbbf24;--c-com:#64748b;--c-title:#7dd3fc;--c-attr:#67e8f9}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:72px}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--link)}code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--bg);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;color:var(--fg);text-decoration:none}
.logo{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--brand);color:#fff;font-size:12px}
.muted,.version{color:var(--muted);font-weight:500}.version{font-size:13px}
.layout{display:grid;grid-template-columns:260px minmax(0,1fr);max-width:1400px;margin:0 auto}
.side{position:sticky;top:53px;align-self:start;height:calc(100vh - 53px);overflow:auto;padding:20px 16px;border-right:1px solid var(--line);background:var(--side)}
.nav-label{margin:16px 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.nav-group:first-child .nav-label{margin-top:0}
nav ul,.toc ul{list-style:none;margin:0;padding:0}
.side a{display:block;padding:6px 10px;border-radius:8px;color:var(--fg);text-decoration:none;font-size:15px}
.side a:hover{background:var(--line)}.side a[aria-current=page]{background:var(--brand-soft);color:var(--link);font-weight:600}
.mobile-nav{display:none;border-bottom:1px solid var(--line);background:var(--side)}
.mobile-nav summary{padding:12px 20px;font-weight:600;cursor:pointer}.mobile-nav nav{padding:0 12px 12px}
.mobile-nav a{display:block;padding:8px;color:var(--fg);text-decoration:none}.mobile-nav a[aria-current=page]{color:var(--link);font-weight:700}
.content{min-width:0;padding:32px clamp(20px,4vw,56px) 80px}.doc{max-width:820px}
.toc{display:none}
@media (min-width:1280px){.layout{grid-template-columns:260px minmax(0,1fr) 220px}.toc{display:block;position:sticky;top:53px;align-self:start;max-height:calc(100vh - 53px);overflow:auto;padding:32px 16px}
.toc a{display:block;padding:3px 0;color:var(--muted);text-decoration:none;font-size:14px}.toc a:hover{color:var(--link)}.toc .l3 a{padding-left:14px}}
@media (max-width:900px){.layout{grid-template-columns:minmax(0,1fr)}.side{display:none}.mobile-nav{display:block}}
h1,h2,h3,h4{line-height:1.25;margin:2em 0 .6em}h1{margin-top:0;font-size:2rem}h2{font-size:1.5rem;padding-bottom:.3em;border-bottom:1px solid var(--line)}h3{font-size:1.2rem}
.anchor{margin-left:.4em;color:var(--muted);text-decoration:none;opacity:0}h1:hover .anchor,h2:hover .anchor,h3:hover .anchor,h4:hover .anchor{opacity:1}
p,ul,ol{margin:0 0 1em}li{margin:.25em 0}hr{border:0;border-top:1px solid var(--line);margin:2em 0}
blockquote{margin:1em 0;padding:.6em 1em;border-left:4px solid var(--brand);background:var(--brand-soft);border-radius:0 8px 8px 0}blockquote>:last-child{margin-bottom:0}
:not(pre)>code{padding:.15em .4em;border-radius:6px;background:var(--code-bg);font-size:.88em}
pre.code{position:relative;margin:1em 0;padding:16px;overflow:auto;border-radius:10px;background:var(--code-bg);border:1px solid var(--line);font-size:14px;line-height:1.55}
pre.code[data-lang]::before{content:attr(data-lang);position:absolute;top:6px;right:10px;font:600 11px system-ui,sans-serif;text-transform:uppercase;color:var(--muted)}
pre code{padding:0;background:none}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-built_in{color:var(--c-key)}.hljs-string,.hljs-regexp{color:var(--c-str)}
.hljs-number,.hljs-symbol{color:var(--c-num)}.hljs-comment,.hljs-quote{color:var(--c-com);font-style:italic}
.hljs-title,.hljs-function,.hljs-section{color:var(--c-title)}.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-type,.hljs-property{color:var(--c-attr)}
.table-wrap{margin:1em 0;overflow-x:auto;border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:15px}th,td{padding:8px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
th{background:var(--side);font-weight:600;white-space:nowrap}tr:last-child td{border-bottom:0}
.broken-link{color:var(--muted);text-decoration:line-through;cursor:help}
.pager{display:flex;justify-content:space-between;gap:12px;max-width:820px;margin-top:56px}
.pager a{display:block;flex:1;padding:12px 16px;border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--fg);font-weight:600}
.pager a:hover{border-color:var(--brand)}.pager span{display:block;font-size:12px;font-weight:500;color:var(--muted)}.pager .next{text-align:right}
@media print{.top,.side,.mobile-nav,.toc,.pager{display:none}.layout{display:block}}
`;
