# 2. Tech stack

What each tool is, **why it is here**, and a frontend analogy where one helps.

## Runtime and language

| Tool                 | Version | Role                                                                             |
| -------------------- | ------- | -------------------------------------------------------------------------------- |
| **Node.js**          | 20+     | Runs JavaScript on the server                                                    |
| **TypeScript**       | 5.x     | Same language you know from the app. `strict` mode is on — do not weaken it      |
| **Express**          | 4.x     | The HTTP framework. A request goes through a chain of functions (middleware) — think axios interceptors, but on the receiving side |

## Data

| Tool           | Role                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------- |
| **PostgreSQL** | The database. Relational: tables with rows, linked by ids. Good for money because of transactions  |
| **Prisma 5**   | Talks to PostgreSQL from TypeScript with full types. The schema lives in `prisma/schema.prisma`; `npx prisma generate` turns it into a typed client (`prisma.product.findMany(...)`) |
| **Prisma Migrate** | Version control for the database structure. Each change is a SQL file in `prisma/migrations/` |

Money columns use `Decimal(15,2)` (Rupiah can have cents in the database). Prisma returns them as `Decimal` objects,
so convert with `Number(...)` before doing math or sending JSON — see
[Code standards → money](05-code-standards.md#money).

## Validation and security

| Tool                  | Role                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| **zod**               | Describes the shape of request bodies and rejects bad input (same library you may use for forms) |
| **jsonwebtoken**      | Creates/verifies JWTs. Access token = short-lived (15 min); refresh token = long-lived (7 days), stored in the `RefreshToken` table |
| **bcrypt**            | Hashes PINs. A PIN is never stored or logged in plain text                                  |
| **express-rate-limit**| Slows brute force on `/auth/login`                                                          |
| **cors**              | Browser origin allow-list (`FRONTEND_ORIGIN`)                                               |

## Files, logs

| Tool        | Role                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| **winston** | Application logger: use `logger.info/warn/error` (`src/utils/logger.ts`), never `console.log` |
| **morgan**  | Logs each HTTP request line                                                    |
| **multer**  | Installed for file uploads; not wired to a route yet                           |
| **markdown-it** + **highlight.js** | Render these `docs/*.md` files as the `/docs` web page, with syntax-highlighted code (server-side; the page ships no JavaScript) |

## Quality tooling (new — see [Code standards](05-code-standards.md))

| Tool                         | Role                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| **ESLint 9** + typescript-eslint | Finds bugs and bad patterns (unused variables, `console.log`, `==`…)  |
| **Prettier**                 | One automatic code format, so nobody argues about spaces/quotes           |
| **Vitest**                   | Test runner (like Jest, faster, TypeScript works out of the box)          |
| **Husky**                    | Runs scripts on git events (before commit, before push)                   |
| **lint-staged**              | Runs ESLint/Prettier only on the files you are committing                 |
| **commitlint**               | Rejects commit messages that don't follow Conventional Commits            |

## Map: what lives where

```
prisma/
  schema.prisma        # the data model (tables)
  migrations/          # SQL history of the database — commit these
  seed.ts              # dev sample data
src/
  app.ts               # creates the Express app, registers routes, starts the server
  config/              # env.ts (typed env vars), database.ts (Prisma client)
  middleware/          # authenticate, requireRole, validate, errorHandler
  modules/<feature>/   # one folder per feature: routes + schema + controller (+ service)
  modules/docs/        # serves docs/*.md as a web page at /docs (see 01-getting-started)
  utils/               # logger, pagination, invoice number
test/                  # unit tests (*.test.ts) and e2e/ (needs a running API)
docs/                  # this guide
.husky/                # git hooks
```
