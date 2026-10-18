# 1. Getting started

How to run the API locally. For installing PostgreSQL from zero (Homebrew, pgAdmin), see the
Indonesian [`README.md`](../README.md) sections 1–3.

## Prerequisites

| Tool       | Version                      | Check              |
| ---------- | ---------------------------- | ------------------ |
| Node.js    | 20.12+ (22 recommended)      | `node --version`   |
| npm        | 9+                           | `npm --version`    |
| PostgreSQL | 14+ running on `localhost`   | `psql --version`   |
| Git        | any recent                   | `git --version`    |

## First-time setup

```bash
git clone <repo-url> server-cashiermu
cd server-cashiermu
npm install          # installs dependencies AND activates git hooks (the "prepare" script runs husky)
cp .env.example .env
```

Edit `.env`:

| Variable                          | What it is                                                | Notes                                         |
| --------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| `DATABASE_URL`                    | PostgreSQL connection string                              | `postgresql://USER:PASSWORD@localhost:5432/cashiermu` |
| `JWT_ACCESS_SECRET`               | Secret that signs access tokens                           | 32+ random characters                         |
| `JWT_REFRESH_SECRET`              | Secret that signs refresh tokens                          | A **different** 32+ random string             |
| `JWT_ACCESS_EXPIRES_IN`           | Access token lifetime                                     | default `15m`                                 |
| `JWT_REFRESH_EXPIRES_IN`          | Refresh token lifetime                                    | default `7d`                                  |
| `PORT`                            | HTTP port                                                 | default `3000`                                |
| `FRONTEND_ORIGIN`                 | Allowed CORS origin                                       | default `http://localhost:8081`               |
| `PUBLIC_BASE_URL`                 | Public address used in receipt links (`/r/<token>`)       | dev default `http://localhost:3000`; empty in production = no links |
| `MAX_LOGIN_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES` | Login lockout settings                        | defaults `5`, `5`                             |
| `E2E_*`                           | Throwaway account for `npm run test:e2e`                  | local only                                    |
| `DOCS_ENABLED`                    | Serve this guide at `/docs`                               | default: **on** in development, **off** in production |
| `DOCS_USER`, `DOCS_PASSWORD`      | Login for `/docs` (HTTP Basic auth)                       | password is **required** if enabled in production |

> `REDIS_URL` and `AWS_*` appear in `.env.example` but **no code reads them yet**. Ignore them for now.

Generate a secret quickly:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`.env` is git-ignored. **Never commit it.** Anything new you add to `.env` must also be added (with a fake value) to
`.env.example`, and read through `src/config/env.ts`.

Create the database and tables:

```bash
createdb cashiermu                 # once
npx prisma migrate deploy          # applies every migration in prisma/migrations
npm run db:generate                # generates the typed Prisma client (also runs on install of @prisma/client)
```

Run the server:

```bash
npm run dev       # nodemon + ts-node, restarts on file changes
```

Check it works:

```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

Point the mobile app at it with `EXPO_PUBLIC_API_URL` (see the app repo's `.env.example`):
iOS simulator `http://localhost:3000/api/v1`, Android emulator `http://10.0.2.2:3000/api/v1`,
real phone `http://<your-mac-ip>:3000/api/v1`.

## Reading these docs in the browser

With the server running, open **http://localhost:3000/docs**. You get a menu with every guide page, a table of
contents for the current page, and previous/next links. Edits to the `.md` files show up when you refresh.

In production the site is **off by default**, because the guide describes internals (including known weaknesses).
To turn it on for your team, set both variables on the server and redeploy:

```bash
DOCS_ENABLED=true
DOCS_USER=docs
DOCS_PASSWORD=<a long random password>
```

If you set `DOCS_ENABLED=true` in production without `DOCS_PASSWORD`, the server refuses to mount `/docs` and logs a
warning. Share the password with teammates only; browsers will ask for it once per session.

**Adding a page:** create the `.md` file in `docs/`, then add one line to `DOC_PAGES` in
`src/modules/docs/docs.pages.ts`. Only pages listed there can ever be served. `npm test` checks that every link and
`#anchor` in the guide still points somewhere.

## Everyday commands

| Command                                  | What it does                                                       |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                            | Start the API with auto-restart                                    |
| `npm run build` / `npm start`            | Compile TypeScript to `dist/` / run the compiled build (production) |
| `npm run lint` / `npm run lint:fix`      | Find / auto-fix code problems (ESLint)                             |
| `npm run format` / `npm run format:check`| Format code / only check formatting (Prettier)                     |
| `npm run typecheck`                      | TypeScript type check without building                             |
| `npm test`                               | Unit tests (fast, no database needed)                              |
| `npm run test:e2e`                       | End-to-end checkout test against the **running local** API         |
| `npm run check`                          | lint + format check + typecheck + unit tests. Run before you push. |
| `npm run db:migrate -- --name <name>`    | Create **and** apply a new migration after editing `schema.prisma` |
| `npx prisma migrate deploy`              | Apply existing migrations (production and fresh setups)            |
| `npm run db:studio`                      | Browse the database in a web UI                                    |
| `npm run db:seed`                        | Insert sample data for a dev store                                 |

## Troubleshooting

| Symptom                                           | Likely cause / fix                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `Can't reach database server`                     | PostgreSQL is not running (`brew services start postgresql@14`) or wrong `DATABASE_URL` |
| `Environment variable not found: DATABASE_URL`    | You forgot `.env`                                                                  |
| `Property 'xyz' does not exist on type 'PrismaClient'` | You changed `schema.prisma` but did not run `npm run db:generate`             |
| `EADDRINUSE :::3000`                              | Another process uses the port: `lsof -iTCP:3000 -sTCP:LISTEN`, then stop it         |
| Hook rejects my commit                            | Read the message — see [Git workflow](06-git-workflow.md#what-the-git-hooks-do)     |
| E2E test says "must run against a local API"      | `E2E_API_URL` must point to `localhost`; this is a safety guard on purpose          |
| E2E fails with `429 Too many login attempts`      | The login limiter allows 10 logins/min per IP and each e2e run logs in 3 times. Wait a minute between runs |
