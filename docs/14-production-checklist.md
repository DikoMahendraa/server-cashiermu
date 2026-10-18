# Production checklist

Go through this before real stores depend on the API. "Done in code" items are already enforced; the rest are yours.

## Enforced in code (so you cannot forget them)

- The API **refuses to start** in production with example or short JWT secrets, identical access/refresh secrets, or example
  database credentials (`src/config/validate-env.ts`). Risky-but-legal settings are logged as warnings at startup.
- 500 responses never carry internal error text in production; they return `requestId` instead.
- `helmet` security headers, `X-Powered-By` removed, request ids on every response.
- Login lockout per client address **and** per account, kept bounded in memory; unknown accounts cost the same time as wrong
  PINs; `/auth/check-credential` has its own limit and returns only name, role and avatar.
- `/metrics` is disabled in production unless `METRICS_TOKEN` is set; `/docs` is off unless `DOCS_ENABLED=true` with a password.

## Environment

| Variable | Production value |
| -------- | ---------------- |
| `NODE_ENV` | `production` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | two different random strings, 32+ characters (`openssl rand -hex 32`) |
| `TRUST_PROXY` | the number of reverse proxies in front (usually `1`). **Without it every user shares the proxy's IP and a few failed logins lock everyone out.** Leave empty only if clients connect directly |
| `PUBLIC_BASE_URL` | `https://your-api-domain` (receipt links) |
| `FRONTEND_ORIGIN` | your real origin, not localhost |
| `METRICS_TOKEN`, `LOG_FILE` | for Grafana (see monitoring doc) |

## Infrastructure

- [ ] HTTPS everywhere (the app sends PINs and tokens)
- [ ] A process manager restarts the API after a crash (systemd, pm2, Docker restart policy)
- [ ] **Automatic daily PostgreSQL backups, and a restore you have actually tried**
- [ ] `npx prisma migrate deploy` runs on every release, after a backup
- [ ] Monitoring stack running, a contact point attached to the alerts, one test alert received
- [ ] Log rotation (the file transport rotates at 20 MB, 5 files; also rotate stdout if your platform stores it)
- [ ] Server clock synced (NTP): offline sales use device time and the API rejects times far from now

## Known limits (accepted for the first stores)

- Refresh tokens are stored as issued and not rotated; a stolen phone's session lasts until it expires (7 days) or the user logs out.
- Login lockouts live in the API process's memory: with more than one API process each counts separately (use Redis then).
- List endpoints are not paginated; very large stores will see slower lists (reports are aggregated in SQL).
- The offline queue and the saved catalog sit unencrypted in the app's storage (the access tokens are in the secure store).
- Native crashes (outside JavaScript) are not reported by the app telemetry.
