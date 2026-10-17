import path from 'node:path';

/** URL prefix the docs site is mounted on. Rendered links are built from it. */
export const DOCS_BASE_PATH = '/docs';

/** Repo root, resolved from this file so it works from both `src/` (ts-node) and `dist/` (built). */
export const REPO_ROOT = path.resolve(__dirname, '../../..');

export type DocGroup = 'guide' | 'reference';

export interface DocPage {
  slug: string;
  /** Path relative to the repo root, always with forward slashes. */
  file: string;
  group: DocGroup;
  navTitle: string;
}

/**
 * The ONLY files the docs site can ever serve. Requests are looked up by slug in this list —
 * a request path is never turned into a file path — so nothing else on disk can be read.
 * Order here is the order of the sidebar and of the previous/next links.
 */
export const DOC_PAGES: readonly DocPage[] = [
  { slug: 'overview', file: 'docs/README.md', group: 'guide', navTitle: 'Overview' },
  { slug: 'getting-started', file: 'docs/01-getting-started.md', group: 'guide', navTitle: '1. Getting started' },
  { slug: 'tech-stack', file: 'docs/02-tech-stack.md', group: 'guide', navTitle: '2. Tech stack' },
  { slug: 'architecture', file: 'docs/03-architecture.md', group: 'guide', navTitle: '3. Architecture' },
  { slug: 'adding-a-feature', file: 'docs/04-adding-a-feature.md', group: 'guide', navTitle: '4. Adding a feature' },
  { slug: 'code-standards', file: 'docs/05-code-standards.md', group: 'guide', navTitle: '5. Code standards' },
  { slug: 'git-workflow', file: 'docs/06-git-workflow.md', group: 'guide', navTitle: '6. Git workflow' },
  {
    slug: 'versioning',
    file: 'docs/07-versioning-and-releases.md',
    group: 'guide',
    navTitle: '7. Versioning & releases',
  },
  { slug: 'sectors', file: 'docs/08-sectors.md', group: 'guide', navTitle: '8. Business sectors' },
  { slug: 'changelog', file: 'CHANGELOG.md', group: 'reference', navTitle: 'Changelog' },
  { slug: 'setup-id', file: 'README.md', group: 'reference', navTitle: 'Setup from scratch (Indonesian)' },
  { slug: 'deployment', file: 'DEPLOYMENT_GUIDE.md', group: 'reference', navTitle: 'Deployment guide' },
  { slug: 'notes', file: 'notes.md', group: 'reference', navTitle: 'Lessons learned' },
];

export const GROUP_LABELS: Record<DocGroup, string> = {
  guide: 'Developer guide',
  reference: 'Project reference',
};

export function findPageBySlug(slug: string): DocPage | undefined {
  return DOC_PAGES.find(page => page.slug === slug);
}

export function findPageByFile(file: string): DocPage | undefined {
  return DOC_PAGES.find(page => page.file === file);
}

/**
 * Resolves a relative markdown link (`../CHANGELOG.md`) found in `fromFile` to a docs page.
 * Returns undefined for anything that is not a whitelisted page.
 */
export function resolveDocLink(fromFile: string, href: string): DocPage | undefined {
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), href));
  return findPageByFile(target);
}
