## What and why
<!-- One or two sentences: what changed and why. Link the issue if there is one. -->

## How to test
<!-- Steps or curl commands. -->

## Checklist
- [ ] `npm run check` passes locally (lint, format, types, tests)
- [ ] Every query is scoped by `storeId`; new tables have `storeId` + index
- [ ] Routes have `authenticate` / `requireRole`; inputs validated with zod
- [ ] Migration included and read; no edits to already-applied migrations
- [ ] Backwards compatible with installed app versions (or a version bump is planned)
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] No secrets, no `console.log`, no PINs/tokens in logs
- [ ] PR title is a valid Conventional Commit (it becomes the squash commit)
