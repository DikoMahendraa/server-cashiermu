import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { docsBasicAuth } from './docs.auth';
import { createDocsController } from './docs.controller';
import { createDocsService } from './docs.service';

export interface DocsRouterOptions {
  /** Basic-auth user. Only used when `password` is set. */
  user: string;
  /** When non-empty the whole docs site requires HTTP Basic auth. */
  password: string;
  /** Cache rendered pages (production). Disable in development to see edits on refresh. */
  cache: boolean;
}

export type DocsMountDecision = { mount: true } | { mount: false; reason?: string };

/**
 * Decides whether /docs should exist at all:
 * - disabled → not mounted (the default in production)
 * - enabled in production without a password → refuse to mount (fail closed, with a log line)
 */
export function decideDocsMount(config: {
  enabled: boolean;
  isProduction: boolean;
  password: string;
}): DocsMountDecision {
  if (!config.enabled) return { mount: false };
  if (config.isProduction && !config.password) {
    return {
      mount: false,
      reason: 'DOCS_ENABLED=true but DOCS_PASSWORD is empty — /docs is NOT mounted in production.',
    };
  }
  return { mount: true };
}

function securityHeaders(hasPassword: boolean) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    // The page has no JavaScript, so the policy can forbid scripts entirely.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', hasPassword ? 'private, no-store' : 'no-cache');
    next();
  };
}

export function createDocsRouter(options: DocsRouterOptions): Router {
  const router = Router();
  const controller = createDocsController(createDocsService({ cache: options.cache }));
  const hasPassword = options.password.length > 0;

  router.use(securityHeaders(hasPassword));

  if (hasPassword) {
    // Only failed attempts count, so normal reading is never throttled but password guessing is.
    router.use(
      rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 30,
        skipSuccessfulRequests: true,
        standardHeaders: true,
        legacyHeaders: false,
        message: 'Too many failed attempts. Try again later.',
      }),
    );
    router.use(docsBasicAuth(options.user, options.password));
  }

  router.get('/', controller.overview);
  router.get('/:slug', controller.page);

  return router;
}
