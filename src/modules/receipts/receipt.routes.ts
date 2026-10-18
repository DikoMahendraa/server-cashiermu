import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../../config/database';
import { renderReceiptNotFound, renderReceiptPage } from './receipt.html';
import { findReceiptByToken } from './receipt.service';

const router = Router();

// Public, no login: the unguessable token is the access control. Limit per IP so tokens cannot be brute-forced.
router.use(rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));

router.use((_req: Request, res: Response, next: NextFunction) => {
  // No scripts at all on this page; never indexed, never cached, never leaks the token through Referer
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const view = await findReceiptByToken(prisma, String(req.params['token']));
    res
      .status(view ? 200 : 404)
      .type('html')
      .send(view ? renderReceiptPage(view) : renderReceiptNotFound());
  } catch (err) {
    next(err);
  }
});

export default router;
