# 6. Git workflow

## The model: short-lived branches into `main`

```
main  ●────●────●────────●────────●──── (always deployable, tagged v1.3.0, v1.4.0 ...)
       \        /  \      /
        feat/suppliers  fix/stock-race
```

- `main` is **always working**. Never commit directly to it; never push broken code to it.
- Do one thing per branch, keep it small (a day or two of work), merge it back, delete it.
- Releases are **tags** on `main` (`v1.3.0`), **not branches**. (There is an old `v1.1.0` branch — don't create more branches named after versions.)

## Step by step

```bash
git switch main && git pull                 # 1. start from the latest main
git switch -c feat/suppliers                # 2. new branch
# ... write code ...
npm run check                               # 3. lint + format + types + tests
git add -p                                  # 4. stage deliberately (review what you add)
git commit -m "feat(suppliers): add CRUD endpoints"   # 5. hooks run here
git push -u origin feat/suppliers           # 6. hooks run again (types + tests)
# 7. open a Pull Request into main, fill the checklist, merge when green
git switch main && git pull && git branch -d feat/suppliers   # 8. clean up
```

Even when you work alone, use a PR: it is your final review and leaves a readable history.

## Branch names

`<type>/<short-kebab-description>`

| Prefix      | For                                    | Example                       |
| ----------- | -------------------------------------- | ----------------------------- |
| `feat/`     | New capability                         | `feat/customers`              |
| `fix/`      | Bug fix                                | `fix/refresh-token-collision` |
| `refactor/` | Restructure, same behaviour            | `refactor/products-service`   |
| `chore/`    | Tooling, deps, config                  | `chore/dev-standards`         |
| `docs/`     | Documentation only                     | `docs/versioning`             |
| `hotfix/`   | Urgent production fix, branched from the last tag | `hotfix/checkout-500`  |

## Commit messages

Format: **Conventional Commits**.

```
<type>(<scope>): <short summary in imperative mood>

<optional body: WHY this change, anything surprising>

<optional footer: BREAKING CHANGE: ..., Closes #12>
```

| Type       | Use for                                           | Version impact        |
| ---------- | ------------------------------------------------- | --------------------- |
| `feat`     | New feature                                       | **minor** (1.2 → 1.3) |
| `fix`      | Bug fix                                           | **patch** (1.2.0 → 1.2.1) |
| `perf`     | Faster, same behaviour                            | patch                 |
| `refactor` | Code restructure, no behaviour change             | none                  |
| `docs`     | Docs only                                         | none                  |
| `test`     | Add/fix tests                                     | none                  |
| `style`    | Formatting only                                   | none                  |
| `build`    | Build system, dependencies                        | none                  |
| `ci`       | CI config                                         | none                  |
| `chore`    | Anything else that isn't src behaviour            | none                  |
| `revert`   | Undo a commit                                     | depends               |

A `!` after the type or a `BREAKING CHANGE:` footer means **major** (see [Versioning](07-versioning-and-releases.md)).

**Scope** = the module or area: `auth`, `store`, `users`, `branches`, `categories`, `products`, `shifts`,
`transactions`, `pending-bills`, `reports`, `discounts`, `db` (schema/migrations), `deps`, `docs`, `release`.

Good vs bad:

```text
✅ feat(transactions): accept Idempotency-Key to make checkout retry-safe
✅ fix(auth): make refresh tokens unique so same-second logins don't collide
✅ feat(db)!: scope invoice numbers per store
❌ update stuff
❌ fix bug
❌ WIP
❌ feat: lots of things (checkout, reports, and lint config)   ← split into separate commits
```

Rules of thumb: one logical change per commit; summary ≤ 100 characters, no trailing period; commit should
build and pass tests on its own. Don't mix formatting-only changes with logic (use a separate `style:` commit).

## What the git hooks do

Installed automatically by `npm install` (Husky). They run on your machine; **never bypass them with `--no-verify`**
(the same checks will be needed in CI/PR anyway, and a bypassed bug is still a bug).

| Hook          | Runs                                                            | Fails when…                                      | Time    |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------ | ------- |
| `pre-commit`  | `lint-staged`: ESLint `--fix` + Prettier on **staged files only** | ESLint finds an error it cannot auto-fix         | seconds |
| `commit-msg`  | `commitlint`                                                    | the message is not a valid Conventional Commit   | instant |
| `pre-push`    | `npm run typecheck` and `npm test`                              | a type error or a failing unit test              | ~10s    |

If a hook fails:

1. Read the message — it names the file and rule.
2. Fix it (many are auto-fixed already; re-`git add` and commit again).
3. `npm run lint:fix` / `npm run format` fix most things across the whole project.
4. Hooks missing after a fresh clone? Run `npm install` (or `npx husky`).

## Pull request checklist

The PR template (`.github/pull_request_template.md`) contains this list:

- [ ] `npm run check` passes locally
- [ ] Every query scoped by `storeId`; new tables have `storeId` + index
- [ ] Routes have `authenticate` / `requireRole`; inputs validated with zod
- [ ] Migration included, read, and **not** editing an old one
- [ ] Backwards compatible with already-installed app versions (or version bump planned)
- [ ] `CHANGELOG.md` updated under Unreleased
- [ ] No secrets, no `console.log`

Keep PRs under ~400 changed lines when you can. Squash-merge keeps `main` readable — make the squash title a valid
Conventional Commit, because it becomes the commit on `main`.

## Pushing safely

- `git push` normal pushes are fine. **Never** `git push --force` to `main`. On your own branch use `--force-with-lease` if you must.
- Check what you are about to push: `git status`, `git diff --stat origin/main`.
- Never commit: `.env`, `node_modules`, `dist`, logs, database dumps, tokens. If a secret is committed, **rotate the secret first**, then clean history.
- Undo the last commit (not pushed): `git reset --soft HEAD~1`. Already pushed? Use `git revert <hash>` — it adds a new commit instead of rewriting history.
- Merge conflicts: `git switch feat/x && git merge main`, fix the marked files, `git add`, `git commit`. Run `npm run check` afterwards.

## One-time project hygiene

Formatting was applied to the whole codebase in a single commit when Prettier was introduced. To keep `git blame`
useful, add that commit's hash to `.git-blame-ignore-revs` and run once:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```
