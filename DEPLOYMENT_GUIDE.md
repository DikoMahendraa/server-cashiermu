# Deployment & Versioning Guide — CashierMu

Standard guide to branching, versioning, and the release workflow for the CashierMu project.
Applies to both the FE (`cashiermu`) and the BE (`server-cashiermu`).

---

## Table of Contents

1. [Branching Strategy](#1-branching-strategy)
2. [Naming Convention](#2-naming-convention)
3. [Merge Strategy](#3-merge-strategy)
4. [Semantic Versioning](#4-semantic-versioning)
5. [CHANGELOG Convention](#5-changelog-convention)
6. [Daily Workflow](#6-daily-workflow-featurefix)
7. [Release Workflow](#7-release-workflow)
8. [Hotfix Production](#8-hotfix-production)
9. [Cheat Sheet](#9-cheat-sheet)

---

## 1. Branching Strategy

This project uses **Gitflow**. Two main branches always exist:

```
main        ← production-ready. Always stable, never committed to directly.
develop     ← integration branch. All features & fixes land here first before a release.
```

Supporting branches (created when needed, deleted after merge):

```
feature/xxx     ← new feature
fix/xxx         ← bug fix
chore/xxx       ← non-functional change (docs, config, deps, refactor)
release/vX.Y.Z  ← release preparation: bump version + finalize changelog
hotfix/xxx      ← urgent fix straight from main (production incident)
```

**Flow diagram:**

```
main ─────────────────────────────────── M2 ──────────────── M3
                                        ↑                    ↑
release/v1.1.0 ──────────────── bump ───┘
                                                    hotfix/crash ──┘
develop ── A ── B ─────────── C ── D ───────────────────────── E
                ↑             ↑    ↑
           feature/x      fix/y  chore/z
```

---

## 2. Naming Convention

Format: **`<type>/<short-kebab-description>`**

### Rules
- All lowercase
- Use `-` (kebab-case), not underscores or spaces
- Short but descriptive, 3–5 words
- No person names, dates, or ticket numbers in the branch name (that belongs in the commit message / PR title)

### Examples by Type

| Type | Example Branch |
|------|--------------|
| `feature/` | `feature/printer-ble-integration` |
| `feature/` | `feature/reprint-button` |
| `feature/` | `feature/shift-management` |
| `fix/` | `fix/blank-receipt-codepage` |
| `fix/` | `fix/invoice-duplicate-p2002` |
| `fix/` | `fix/payment-double-submit` |
| `fix/` | `fix/printer-status-sync` |
| `chore/` | `chore/setup-expo-dev-client` |
| `chore/` | `chore/patch-expo-modules-jsi` |
| `chore/` | `chore/update-dependencies` |
| `release/` | `release/v1.1.0` |
| `hotfix/` | `hotfix/critical-payment-crash` |

---

## 3. Merge Strategy

Use a different merge strategy depending on the direction of the merge:

### Feature / Fix / Chore → `develop` : **Squash Merge**

```
develop:      A ─── B ─── [S]
                           ↑
branch:   x ── y ── wip ── z
```

Day-to-day working branches usually contain commits like `wip`, `fix typo`, `try this`, `revert`, etc. Squashing turns all of that into **one clean commit** on `develop`.

On GitHub: choose **"Squash and merge"**

### `release/*` → `main` : **Merge Commit**

```
main:     A ──────────────── [M]
                             /
release:  ── bump ── final ─
```

Do not squash a release into main. A merge commit is important for:
- Tracking the exact point where a version entered production
- Attaching `git tag vX.Y.Z`
- Triggering CI/CD deploys that can be traced to a specific commit

On GitHub: choose **"Create a merge commit"**

### `main` → `develop` (back-merge) : **Merge Commit**

Must be done after every release so that `develop` does not fall behind `main`.

### `hotfix/*` → `main` **and** `develop` : **Merge Commit**

A hotfix must go into both branches so the fix is not lost in the next release.

### Summary

| From | To | Strategy |
|------|----|----------|
| `feature/*` | `develop` | Squash merge |
| `fix/*` | `develop` | Squash merge |
| `chore/*` | `develop` | Squash merge |
| `release/*` | `main` | Merge commit |
| `main` | `develop` | Merge commit (back-merge) |
| `hotfix/*` | `main` | Merge commit |
| `hotfix/*` | `develop` | Merge commit |

---

## 4. Semantic Versioning

Format: **`MAJOR.MINOR.PATCH`**

| Situation | Bump | Example |
|---------|------|--------|
| Bug fix, small patch | PATCH | `1.0.0` → `1.0.1` |
| New feature, backward compatible | MINOR | `1.0.1` → `1.1.0` |
| Breaking change, major redesign | MAJOR | `1.1.0` → `2.0.0` |

### Guide: Which Bump to Use

**PATCH** — nothing changes from the user/API side:
- Small UI bug fix
- Error handling fix
- Label typo fix
- Internal performance improvement

**MINOR** — an addition that does not break anything existing:
- New screen / feature
- New API endpoint
- New configuration option
- New device integration (printer, scanner)

**MAJOR** — a change that can break existing behavior:
- Database structure change that is not backward compatible
- API response format change
- Removal of an existing feature or endpoint
- Authentication flow change

### Pre-release Labels (optional)

```
1.1.0-alpha.1   ← internal testing
1.1.0-beta.1    ← limited testing
1.1.0-rc.1      ← release candidate, production-ready
1.1.0            ← stable release
```

---

## 5. CHANGELOG Convention

Follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

### Structure

```markdown
## [Unreleased]
### Added
- Description of the new feature

## [1.1.0] - 2026-10-05
### Added
- BLE thermal printer integration via @ricka7x/expo-thermal-printer

### Fixed
- Receipt not printed because the ESC/POS codepage command is not supported by the printer
- Printer status not updating in SettingsScreen after connect

## [1.0.0] - 2026-09-01
### Added
- Initial release
```

### Standard Categories

| Category | When to Use |
|----------|----------------|
| `Added` | New features |
| `Changed` | Changes to existing features |
| `Fixed` | Bug fixes |
| `Removed` | Removed features or APIs |
| `Deprecated` | Features that will be removed in a future version |
| `Security` | Security-related fixes |

### CHANGELOG Update Rules

- `[Unreleased]` is always at the very top as the accumulation of changes since the last release
- On release: rename `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD`, then create a new empty `[Unreleased]` block above it
- Write from the perspective of the user/developer reading it, not from the implementation perspective
- One bullet per change, concise and clear

---

## 6. Daily Workflow (Feature/Fix)

### Steps

```bash
# 1. Make sure local develop is up to date
git checkout develop
git pull origin develop

# 2. Create a new branch from develop
git checkout -b fix/blank-receipt-codepage

# 3. Make the changes, commit with a clear message
git add src/services/printer.service.ts
git commit -m "fix: remove codepage() call causing blank receipt on cheap BLE printers"

# Multiple commits are fine while on your own branch
git add src/screens/Settings/PrinterSettingsScreen.tsx
git commit -m "fix: sync Zustand store after printer connect/disconnect"

# 4. Push the branch to the remote
git push origin fix/blank-receipt-codepage

# 5. Create a Pull Request on GitHub
#    - Base branch: develop
#    - PR title: same as the main commit message
#    - Description: explain the root cause and the solution
#    - Merge strategy: Squash and merge
```

### Commit Message Format

Follow **Conventional Commits**:

```
<type>(<scope>): <short description>

[optional body — additional explanation]

[optional footer — breaking change / issue reference]
```

| Type | When |
|------|-------|
| `feat` | New feature |
| `fix` | Bug fix |
| `chore` | Maintenance, deps, config |
| `refactor` | Refactor without behavior change |
| `docs` | Documentation update |
| `style` | Formatting, no logic change |
| `test` | Add or update tests |
| `perf` | Performance improvement |

**Examples:**
```bash
git commit -m "feat: implement reprint button with BLE printer integration"
git commit -m "fix: prevent double-submit on payment confirmation"
git commit -m "fix: use MAX-based invoice number generation to prevent P2002"
git commit -m "chore: patch expo-modules-jsi for Swift 6.2 compatibility"
git commit -m "docs: add deployment guide and session changelog"
```

---

## 7. Release Workflow

### When to Release?

A release is made when `develop` has enough changes ready for production. It can be based on:
- Sprint completed
- Feature milestone reached
- Accumulation of important fixes

### Steps

```bash
# 1. Make sure develop is up to date and all PRs are merged
git checkout develop
git pull origin develop

# 2. Create the release branch
git checkout -b release/v1.1.0

# 3. Bump the version in package.json
#    (choose one)
npm version minor --no-git-tag-version   # automatically bumps MINOR
# or edit package.json manually: "version": "1.1.0"

# 4. Finalize CHANGELOG.md
#    Replace [Unreleased] → [1.1.0] - 2026-10-05
#    Create a new empty [Unreleased] block above it

# 5. Commit the version change
git add package.json CHANGELOG.md
git commit -m "chore: release v1.1.0"

# 6. Push the release branch
git push origin release/v1.1.0

# 7. Create a PR: release/v1.1.0 → main
#    Merge strategy: Create a merge commit (NOT squash)
#    PR title: "Release v1.1.0"

# 8. After the PR is merged into main, create the git tag
git checkout main
git pull origin main
git tag -a v1.1.0 -m "Release v1.1.0"
git push origin v1.1.0

# 9. Back-merge main → develop
git checkout develop
git pull origin develop
git merge main --no-ff -m "chore: back-merge v1.1.0 into develop"
git push origin develop

# 10. Delete the release branch (optional, no longer needed)
git branch -d release/v1.1.0
git push origin --delete release/v1.1.0
```

### What IS allowed on a release branch

- Bump the version in `package.json`
- Update `CHANGELOG.md`
- Minor bug fixes found while testing the release (not new features)

### What is NOT allowed on a release branch

- Adding new features
- Large refactors
- Merging new features from develop

---

## 8. Hotfix Production

Used when there is a **critical bug in production** that cannot wait for the normal release cycle.

```bash
# 1. Branch from main (not develop!)
git checkout main
git pull origin main
git checkout -b hotfix/critical-payment-crash

# 2. Fix the bug, commit
git add src/components/pos/PaymentModal.tsx
git commit -m "fix: prevent double-submit crash on payment confirmation"

# 3. Push and create a PR to main
git push origin hotfix/critical-payment-crash
# PR → main, Merge commit

# 4. After merging into main: bump PATCH version + tag
git checkout main
git pull origin main
# Edit package.json: 1.1.0 → 1.1.1
git add package.json
git commit -m "chore: bump version to 1.1.1"
git tag -a v1.1.1 -m "Hotfix v1.1.1 — payment double-submit crash"
git push origin main
git push origin v1.1.1

# 5. Back-merge into develop (REQUIRED so the fix is not lost)
git checkout develop
git pull origin develop
git merge main --no-ff -m "chore: back-merge hotfix v1.1.1 into develop"
git push origin develop
```

---

## 9. Cheat Sheet

### Daily Flow

```
develop → branch → work → PR (squash) → develop
```

### Release Flow

```
develop → release/vX.Y.Z → bump + changelog → PR (merge commit) → main
                                                                     ↓
                                                               git tag vX.Y.Z
                                                                     ↓
                                                          back-merge → develop
```

### Hotfix Flow

```
main → hotfix/xxx → fix → PR (merge commit) → main → tag → back-merge → develop
```

### Merge Strategy Summary

```
feature/* → develop   : SQUASH
fix/*     → develop   : SQUASH
chore/*   → develop   : SQUASH
release/* → main      : MERGE COMMIT
hotfix/*  → main      : MERGE COMMIT
main      → develop   : MERGE COMMIT
```

### Versioning Summary

```
Small bug fix     → PATCH  (1.0.0 → 1.0.1)
New feature       → MINOR  (1.0.1 → 1.1.0)
Breaking change   → MAJOR  (1.1.0 → 2.0.0)
```

### Frequently Used Git Commands

```bash
# List all branches
git branch -a

# Delete local branches that are already merged
git branch -d branch-name

# Delete a remote branch
git push origin --delete branch-name

# List tags
git tag -l

# Show log with graph
git log --oneline --graph --decorate --all

# Show all merge commits
git log --merges --oneline
```
