import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { DOC_PAGES, DOCS_BASE_PATH, REPO_ROOT, resolveDocLink } from '../src/modules/docs/docs.pages';
import { renderMarkdown, slugify } from '../src/modules/docs/docs.markdown';
import { createDocsService } from '../src/modules/docs/docs.service';
import { createDocsRouter, decideDocsMount } from '../src/modules/docs/docs.routes';

describe('docs registry', () => {
  it('has unique slugs and files that exist', () => {
    expect(new Set(DOC_PAGES.map(p => p.slug)).size).toBe(DOC_PAGES.length);
    for (const page of DOC_PAGES) {
      expect(fs.existsSync(path.join(REPO_ROOT, page.file)), page.file).toBe(true);
    }
  });

  it('resolves relative links only to whitelisted pages', () => {
    expect(resolveDocLink('docs/01-getting-started.md', '../CHANGELOG.md')?.slug).toBe('changelog');
    expect(resolveDocLink('docs/README.md', '03-architecture.md')?.slug).toBe('architecture');
    expect(resolveDocLink('docs/README.md', '../.env')).toBeUndefined();
    expect(resolveDocLink('docs/README.md', '../../etc/passwd')).toBeUndefined();
  });
});

describe('markdown rendering', () => {
  const render = (source: string, file = 'docs/README.md') => renderMarkdown(source, file);

  it('escapes raw HTML instead of rendering it', () => {
    const { html } = render('# T\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not turn javascript: URLs into links', () => {
    const { html } = render('[click](javascript:alert(1))');
    expect(html).not.toContain('href="javascript:');
  });

  it('opens external links safely and rewrites relative doc links', () => {
    const { html } = render('[ext](https://example.com) [doc](03-architecture.md#roles) [cl](../CHANGELOG.md)');
    expect(html).toContain('href="https://example.com" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain(`href="${DOCS_BASE_PATH}/architecture#roles"`);
    expect(html).toContain(`href="${DOCS_BASE_PATH}/changelog"`);
  });

  it('marks links to files outside the docs site as broken instead of linking them', () => {
    const { html } = render('[secret](../.env)');
    expect(html).toContain('broken-link');
    expect(html).not.toContain('.env"');
  });

  it('builds GitHub-style ids, dedupes repeats, and collects a table of contents', () => {
    expect(slugify('Multi-tenancy: the most important rule')).toBe('multi-tenancy-the-most-important-rule');
    expect(slugify('Quality tooling (new — see Code)')).toBe('quality-tooling-new--see-code');
    const out = render('# Title\n\n## Same\n\n## Same\n\n### Deep');
    expect(out.title).toBe('Title');
    expect(out.ids).toEqual(['title', 'same', 'same-1', 'deep']);
    expect(out.toc.map(t => [t.level, t.id])).toEqual([
      [2, 'same'],
      [2, 'same-1'],
      [3, 'deep'],
    ]);
  });

  it('wraps tables for horizontal scrolling and highlights known languages', () => {
    const { html } = render('| a | b |\n| - | - |\n| 1 | 2 |\n\n```ts\nconst x: number = 1;\n```\n\n```nope\n<b>\n```');
    expect(html).toContain('<div class="table-wrap"><table>');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('&lt;b&gt;'); // unknown language is escaped, not executed
  });
});

describe('documentation content', () => {
  const service = createDocsService({ cache: false });

  it('renders every page with a title', async () => {
    for (const page of DOC_PAGES) {
      const doc = await service.render(page.slug);
      expect(doc, page.slug).not.toBeNull();
      expect(doc!.html, page.slug).toContain('<h1');
    }
  });

  it('has no broken internal links or #anchors in the developer guide', async () => {
    const idsBySlug = new Map<string, string[]>();
    for (const page of DOC_PAGES) idsBySlug.set(page.slug, (await service.render(page.slug))!.ids);

    const problems: string[] = [];
    for (const page of DOC_PAGES.filter(p => p.group === 'guide')) {
      const source = fs
        .readFileSync(path.join(REPO_ROOT, page.file), 'utf8')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`\n]*`/g, '');
      for (const match of source.matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = match[1];
        if (/^(https?:|mailto:)/i.test(href)) continue;
        const [filePart, fragment] = href.split('#');
        const target = filePart ? resolveDocLink(page.file, filePart) : page;
        if (!target) {
          problems.push(`${page.file}: ${href} → not a docs page`);
        } else if (fragment && !idsBySlug.get(target.slug)!.includes(fragment)) {
          problems.push(`${page.file}: ${href} → no heading "${fragment}" in ${target.file}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('decideDocsMount', () => {
  it('is on in development by default config, off when disabled', () => {
    expect(decideDocsMount({ enabled: true, isProduction: false, password: '' })).toEqual({ mount: true });
    expect(decideDocsMount({ enabled: false, isProduction: true, password: 'x' })).toEqual({ mount: false });
  });

  it('fails closed in production without a password', () => {
    const decision = decideDocsMount({ enabled: true, isProduction: true, password: '' });
    expect(decision.mount).toBe(false);
    expect(decision).toHaveProperty('reason');
    expect(decideDocsMount({ enabled: true, isProduction: true, password: 'secret' })).toEqual({ mount: true });
  });
});

describe('docs HTTP routes', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function start(options: { password: string }) {
    const app = express();
    app.use(DOCS_BASE_PATH, createDocsRouter({ user: 'docs', password: options.password, cache: false }));
    const server = await new Promise<import('node:http').Server>(resolve => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    close = () => new Promise<void>(resolve => server.close(() => resolve()));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}${DOCS_BASE_PATH}`;
  }

  const basic = (user: string, password: string) => ({
    Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`,
  });

  it('serves the overview with a menu to every page and locked-down headers', async () => {
    const base = await start({ password: '' });
    const res = await fetch(base);
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    for (const page of DOC_PAGES) {
      const href = page.slug === 'overview' ? DOCS_BASE_PATH : `${DOCS_BASE_PATH}/${page.slug}`;
      expect(html, page.slug).toContain(`href="${href}"`);
    }
    expect(html).not.toContain('<script');
  });

  it('serves each page, marks the current one, and redirects /overview', async () => {
    const base = await start({ password: '' });
    const res = await fetch(`${base}/architecture`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('href="/docs/architecture" aria-current="page"');

    const redirect = await fetch(`${base}/overview`, { redirect: 'manual' });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('location')).toBe(DOCS_BASE_PATH);
  });

  it('returns 404 for unknown pages and never reads files outside the whitelist', async () => {
    const base = await start({ password: '' });
    for (const slug of ['nope', '..%2f..%2fpackage.json', '..%2f.env', 'BACKEND_PROMPT']) {
      const res = await fetch(`${base}/${slug}`);
      const body = await res.text();
      expect(res.status, slug).toBe(404);
      expect(body, slug).not.toContain('JWT_ACCESS_SECRET');
      expect(body, slug).not.toContain('"dependencies"');
    }
  });

  it('requires the password when one is configured', async () => {
    const base = await start({ password: 's3cret-pass' });

    const anon = await fetch(base);
    expect(anon.status).toBe(401);
    expect(anon.headers.get('www-authenticate')).toContain('Basic');
    expect(anon.headers.get('cache-control')).toContain('no-store');

    expect((await fetch(base, { headers: basic('docs', 'wrong') })).status).toBe(401);
    expect((await fetch(base, { headers: basic('other', 's3cret-pass') })).status).toBe(401);
    expect((await fetch(`${base}/architecture`, { headers: { Authorization: 'Basic !!!' } })).status).toBe(401);
    expect((await fetch(base, { headers: basic('docs', 's3cret-pass') })).status).toBe(200);
    expect((await fetch(`${base}/architecture`, { headers: basic('docs', 's3cret-pass') })).status).toBe(200);
  });
});
