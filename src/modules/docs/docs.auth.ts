import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Constant-time string comparison (hashing first makes both buffers the same length). */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

/** HTTP Basic auth gate for the docs site. Browsers show their own login dialog. */
export function docsBasicAuth(user: string, password: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      if (separator !== -1) {
        const givenUser = decoded.slice(0, separator);
        const givenPassword = decoded.slice(separator + 1);
        // Evaluate both so timing does not reveal which half was wrong.
        const userOk = safeEqual(givenUser, user);
        const passwordOk = safeEqual(givenPassword, password);
        if (userOk && passwordOk) {
          next();
          return;
        }
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="CashierMu docs", charset="UTF-8"');
    res.status(401).type('text/plain').send('Authentication required');
  };
}
