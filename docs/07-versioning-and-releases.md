# 7. Versioning & releases

## Why this matters more for you than for a website

A website updates for everyone at once. **A mobile app does not.** Cashiers will keep running an old app build for
weeks. Every deploy of this API must keep working for the app versions already installed. That single idea drives
everything on this page.

## Three different version numbers

| What                | Where it lives                              | Changes when                                  |
| ------------------- | ------------------------------------------- | --------------------------------------------- |
| **Backend release** | `package.json` `version` + git tag `vX.Y.Z` + `CHANGELOG.md` | every release (SemVer, below) |
| **API version**     | URL prefix `/api/v1`                        | only on a **breaking** change you cannot avoid (→ `/api/v2`, keep v1 running during the transition) |
| **Mobile app**      | app repo `app.json` / its own `CHANGELOG.md`| every app release; the two repos version independently |

Record compatibility in the changelog: *"Requires app ≥ 1.1.0"* or *"Works with all app versions"*.

## Semantic Versioning: `MAJOR.MINOR.PATCH` (e.g. 1.3.2)

| Bump      | When                                                                 | Examples                                                      |
| --------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| **PATCH** `1.3.1` | Bug fix. No contract change.                                  | real: refresh tokens made unique so same-second logins work    |
| **MINOR** `1.4.0` | Backwards-compatible feature: new endpoint, new **optional** request field, new response field, new optional header | real: `Idempotency-Key` header; `/discounts` endpoints |
| **MAJOR** `2.0.0` | Anything that can break an installed app: remove/rename a field or endpoint, change a field's type or meaning, make an optional input required, change an error `code` | hypothetical: removing `cashPaid`; renaming `grandTotal` |

Mapping from commits: `fix` → patch, `feat` → minor, `feat!`/`BREAKING CHANGE:` → major, others → no release by
themselves. When in doubt, ask: *"Will an app build from last month still work?"* If no → it is MAJOR.

### Backwards-compatibility rules (follow these and you almost never need a MAJOR)

1. **Add, don't change.** New optional fields/endpoints are safe. Renaming is "add the new name, keep the old one".
2. **Never remove or rename a response field** that an app might read. Deprecate first.
3. **New required input = breaking.** Give it a default instead, or make it optional.
4. **Error `code`s are API.** Add new ones freely; don't rename existing ones.
5. **Deprecate in two steps:** mark it in the changelog under *Deprecated* (release N) → remove it in a later MAJOR release (N+2 or later) once old apps are gone. Recommended: have the app send an `X-App-Version` header so you can see which versions are still in use before removing anything.
6. **Tightening validation can break old apps** (e.g. rejecting a price the app computes differently). Ship it together with an app update, say so in the changelog, and keep the response clear (`PRICE_CHANGED` with details) so the app can recover.

## Database migrations

Migrations are the version history of the database. Treat them like published code.

- **Create:** edit `schema.prisma` → `npm run db:migrate -- --name <verb_noun>` (e.g. `add_suppliers`, `scope_invoice_number_per_store`).
- **Read the generated SQL** before committing. Commit schema + migration together.
- **Never edit or delete a migration that has been applied** anywhere (your laptop counts if you share the DB; production definitely). Mistake? Write a **new** migration that fixes it.
- **Never change the database by hand** (pgAdmin/psql DDL) — the next `migrate deploy` will not know about it.
- **Production applies with `npx prisma migrate deploy`** (never `migrate dev` or `migrate reset` — those can wipe data).
- **Back up before every production migration.**
- Old API code and new API code run side by side for a moment during a deploy, so a migration must work for **both**.

### Dangerous changes: expand → migrate → contract

Dropping or renaming a column in one step breaks the running code. Do it across releases:

| Release | Step                                                                                  |
| ------- | ------------------------------------------------------------------------------------- |
| N       | **Expand:** add the new column/table (nullable or with a default). Code writes both old and new |
| N       | **Backfill:** fill the new column for existing rows (separate migration/script)       |
| N+1     | Code reads only the new column                                                        |
| N+2     | **Contract:** drop the old column in its own migration                                |

Adding a `NOT NULL` column to a table with data needs a default or a backfill first. Adding a unique index can fail
on existing duplicates — check the data first. (Example in this repo: invoice numbers went from globally unique to
unique per store in `20261018121000_scope_invoice_number_per_store`.)

## The changelog

[`CHANGELOG.md`](../CHANGELOG.md) follows [Keep a Changelog](https://keepachangelog.com). Newest on top. While you
work, add lines under `## [Unreleased]`; at release time that heading becomes the version.

Illustrative example (app version numbers are made up):

```md
## [Unreleased]

## [1.3.0] — 2026-10-20

### Added
- `POST /transactions` accepts an `Idempotency-Key` header; retrying with the same key returns the original sale.
  - Migration: `20261018120000_add_transaction_idempotency_key`
  - App compatibility: works with all app versions; app ≥ 1.2.0 sends the key.

### Changed
- Checkout recomputes prices on the server and returns `409 PRICE_CHANGED` for stale prices.

### Deprecated
- `cashPaid` in the checkout body (derived from cash payments now). Removal planned for 2.0.0.

### Fixed
- Refresh tokens are unique per login (same-second logins returned 409).

### Security
- …
```

Sections: **Added, Changed, Deprecated, Removed, Fixed, Security**. Write for a person, mention endpoints, migrations and
app compatibility. Don't paste commit messages.

## Releasing

Do this from an up-to-date, green `main`.

```bash
git switch main && git pull
npm run check                                   # must pass
git status                                      # must be clean
```

1. Decide the version from what is under `[Unreleased]` (any breaking → major; any feat → minor; only fixes → patch).
2. Edit `CHANGELOG.md`: rename `[Unreleased]` to `[X.Y.Z] — YYYY-MM-DD` and add a fresh empty `[Unreleased]` above it. Commit:
   `git commit -am "docs(release): changelog for X.Y.Z"`
3. Bump, commit and tag in one command (the `-m` keeps commitlint happy):

   ```bash
   npm version minor -m "chore(release): %s"     # or: patch | major
   ```

   This edits `package.json`, creates the commit and the tag `vX.Y.Z`.
4. Push the commit **and** the tag: `git push --follow-tags`
5. Deploy (see [`DEPLOYMENT_GUIDE.md`](../DEPLOYMENT_GUIDE.md)): backup DB → `npx prisma migrate deploy` → `npm run build` → restart `npm start`. The server reads `docs/` and a few root `.md` files at runtime, so deploy the whole repo, not only `dist/`. Want the guide online? Set `DOCS_ENABLED`, `DOCS_USER`, `DOCS_PASSWORD` (see [Getting started](01-getting-started.md#reading-these-docs-in-the-browser)).
6. Verify: `curl https://<api>/health`, do one real checkout from the app.
7. Create a GitHub Release from the tag and paste the changelog section.

**Rollback:** redeploy the previous tag (`git switch --detach vX.Y.(Z-1)`, build, start). The database is *not*
rolled back — that is why migrations must stay compatible with the previous release.

### Hotfix (production is broken)

```bash
git switch -c hotfix/short-name vLAST_TAG       # branch from what is running in production
# fix + test, commit as fix(scope): ...
# release as a PATCH (steps 2–7), then merge the branch into main
```

## One-time baseline (do this once)

Right now `package.json` says `1.0.0`, the changelog says `1.2.0`, and no git tags exist. Align them:

```bash
git tag -a v1.2.0 eb3748e -m "v1.2.0"            # eb3748e = "update to version 1.2.0" commit
npm version 1.2.0 --no-git-tag-version           # make package.json match
git commit -am "chore(release): align package version with 1.2.0"
git push --tags
```

The checkout hardening + new tooling work is released afterwards as **1.3.0** (new feature, migrations, backwards
compatible with the shipped app).

## Cheat sheet

| I want to…                         | Do this                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| Fix a bug                          | `fix(scope):` commit → patch release                            |
| Add an optional field/endpoint     | `feat(scope):` commit → minor release                           |
| Rename/remove something            | Don't. Add new + deprecate old. If truly needed → major + `/api/v2` |
| Change the DB                      | `npm run db:migrate -- --name …` → read SQL → commit with schema |
| Drop a column                      | Expand → backfill → switch reads → drop (4 steps, 3 releases)   |
| Ship                               | Changelog → `npm version … -m "chore(release): %s"` → `git push --follow-tags` → deploy |
| Undo a bad release                 | Redeploy previous tag; ship a fix as the next patch             |
