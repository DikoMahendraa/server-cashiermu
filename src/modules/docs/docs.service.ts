import fs from 'node:fs/promises';
import path from 'node:path';
import { DOC_PAGES, REPO_ROOT, findPageBySlug, type DocPage } from './docs.pages';
import { renderMarkdown, type RenderedMarkdown } from './docs.markdown';

export interface RenderedDoc extends RenderedMarkdown {
  page: DocPage;
}

export interface DocsService {
  /** Renders a whitelisted page, or returns null when the slug is unknown. */
  render(slug: string): Promise<RenderedDoc | null>;
  /** App version shown in the page header. */
  version(): Promise<string>;
}

interface DocsServiceOptions {
  /** Cache rendered pages in memory. Off in development so edits show on refresh. */
  cache: boolean;
  root?: string;
}

export function createDocsService({ cache, root = REPO_ROOT }: DocsServiceOptions): DocsService {
  const pages = new Map<string, RenderedDoc>();
  let cachedVersion: string | undefined;

  return {
    async render(slug) {
      const page = findPageBySlug(slug);
      if (!page) return null;

      const hit = cache ? pages.get(slug) : undefined;
      if (hit) return hit;

      const source = await fs.readFile(path.join(root, page.file), 'utf8');
      const rendered: RenderedDoc = { page, ...renderMarkdown(source, page.file) };
      if (cache) pages.set(slug, rendered);
      return rendered;
    },

    async version() {
      if (cache && cachedVersion) return cachedVersion;
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as { version?: string };
        cachedVersion = pkg.version ?? 'unknown';
      } catch {
        cachedVersion = 'unknown';
      }
      return cachedVersion;
    },
  };
}

/** Previous/next pages in sidebar order, for the footer navigation. */
export function neighbours(slug: string): { prev?: DocPage; next?: DocPage } {
  const index = DOC_PAGES.findIndex(page => page.slug === slug);
  if (index === -1) return {};
  return { prev: DOC_PAGES[index - 1], next: DOC_PAGES[index + 1] };
}
