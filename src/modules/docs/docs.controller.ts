import type { NextFunction, Request, Response } from 'express';
import { DOCS_BASE_PATH } from './docs.pages';
import { neighbours, type DocsService } from './docs.service';
import { renderNotFound, renderPage } from './docs.template';

export function createDocsController(service: DocsService) {
  const showPage = async (slug: string, res: Response): Promise<void> => {
    const [doc, version] = await Promise.all([service.render(slug), service.version()]);

    if (!doc) {
      res.status(404).type('html').send(renderNotFound(version));
      return;
    }

    res.type('html').send(
      renderPage({
        title: doc.title,
        bodyHtml: doc.html,
        toc: doc.toc,
        currentSlug: doc.page.slug,
        version,
        ...neighbours(doc.page.slug),
      }),
    );
  };

  return {
    overview: async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        await showPage('overview', res);
      } catch (err) {
        next(err);
      }
    },

    page: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const slug = String(req.params['slug']);
        if (slug === 'overview') {
          res.redirect(301, DOCS_BASE_PATH);
          return;
        }
        await showPage(slug, res);
      } catch (err) {
        next(err);
      }
    },
  };
}
