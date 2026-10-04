# TASK-036 Pin Node 22

## What
Add `"engines": { "node": "22.x" }` to `package.json` (and the matching root entry in `package-lock.json`).

## Why
Nothing in the repo said which Node version to build with, so each place picked its own:

| Where | Node it used |
|---|---|
| Vercel (staging and production projects) | 24.x |
| GitHub Actions (`inbox-ci.yml`, `packages-ci.yml`) | 20 |
| The inbox worker bundle (`worker:build`, `--target=node22`) | 22 |
| Local development and the full test suite run on 2026-10-04 | 22.16 |

A change could pass CI on one version and run on another. Vercel reads `engines.node` to choose its build and runtime version, so pinning
it makes staging and production run the version the code is tested on. It is also the first change to flow through the staging then production
release path (see `docs/runbooks/production-gate.md`), which checks the Vercel branch tracking and the skipped production build on a merge to `main`.

## Data model changes
None.

## Access control changes
None.

## UI surfaces
None.

## Test plan
- `npm ci --dry-run` accepts the lockfile.
- `npm run typecheck` and `npm run build` pass on Node 22.
- After the merge: the staging project builds on Node 22.x (the build log's first lines name the Node version).
- Release check: the production project does not build the merge to `main`; moving the `production` branch to the same commit creates the
  production deployment from branch `production`.

Follow-up, not in this change: move the two GitHub Actions workflows from Node 20 to 22 when CI is consolidated.

## Status
In progress: PR open. Update to Done once staging and production both report Node 22.x.
