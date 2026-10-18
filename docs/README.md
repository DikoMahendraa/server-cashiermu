# CashierMu API — Developer Guide

Start here. These docs are written for someone who knows frontend well and is learning backend.
Read them in order the first time; after that, use them as a reference.

| #   | Doc                                                  | Read it when…                                          |
| --- | ---------------------------------------------------- | ------------------------------------------------------ |
| 1   | [Getting started](01-getting-started.md)             | You want to run the API on your machine                |
| 2   | [Tech stack](02-tech-stack.md)                       | You want to know what each tool is and why we use it   |
| 3   | [Architecture](03-architecture.md)                   | You want to understand how a request flows through code |
| 4   | [Adding a feature](04-adding-a-feature.md)           | You are about to build a new endpoint/module           |
| 5   | [Code standards](05-code-standards.md)               | You are writing or reviewing backend code              |
| 6   | [Git workflow](06-git-workflow.md)                   | You are about to branch, commit, push or open a PR     |
| 7   | [Versioning & releases](07-versioning-and-releases.md) | You are shipping a version or changing the database    |
| 8   | [Business sectors](08-sectors.md)                    | You are adding or changing sector-specific product fields |
| 9   | [Import & export](09-import-export.md)               | You are changing the product spreadsheet template/import |
| 10  | [Service jobs & receipt](10-service-jobs.md)         | You are touching job status or the public receipt page |
| 11  | [Expenses & reports](11-expenses-and-reports.md)     | You are touching expenses, net profit or report exports |
| 12  | [Offline sales](12-offline-sales.md)                 | You are touching checkout, sync or the offline rules |
| 13  | [Monitoring (Grafana)](13-monitoring.md)             | You want dashboards, alerts or to find out why something broke |
| 14  | [Production checklist](14-production-checklist.md)   | You are about to put real stores on the API |
| 15  | [Deploying to a VPS](15-deployment.md)               | You are setting up or updating the production server |
| 16  | [Server learning guide](16-server-learning-guide.md) | You want to understand the server setup and terms |
| 17  | [Off-site backup (R2)](17-r2-offsite-backup.md)      | You are setting up or restoring from the off-server backup |
| 18  | [Production monitoring](18-grafana-cloud.md)         | You are setting up uptime checks, Grafana Cloud or alerts |

Other files in the repo root: [`README.md`](../README.md) (long from-zero setup in Indonesian, including
installing PostgreSQL), [`DEPLOYMENT_GUIDE.md`](../DEPLOYMENT_GUIDE.md), [`CHANGELOG.md`](../CHANGELOG.md),
[`notes.md`](../notes.md) (lessons learned).

## Read this guide in the browser

Run the server and open **http://localhost:3000/docs** for a menu, search-free navigation and a table of contents on
every page. It is off in production unless you enable it with a password — see
[Getting started](01-getting-started.md#reading-these-docs-in-the-browser).

## The 30-second version

```bash
npm install                 # also installs the git hooks
cp .env.example .env        # then edit DATABASE_URL and the two JWT secrets
npx prisma migrate deploy   # create tables
npm run dev                 # http://localhost:3000/health
npm run check               # lint + format + types + tests (run before pushing)
```

Golden rules (details in the docs above):

1. **Every query is scoped by `storeId`.** One shop must never see another shop's data.
2. **Never trust the client.** Validate input with zod; recompute money on the server.
3. **Change the database only through Prisma migrations**, never by hand, and never edit a migration that has been applied.
4. **Commits follow Conventional Commits** (`feat(products): add barcode search`). A git hook enforces it.
5. **Old mobile apps stay installed on phones.** Only make backwards-compatible API changes unless you bump the API version.
