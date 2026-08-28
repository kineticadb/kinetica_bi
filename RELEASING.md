# Releasing

Kinetica BI ships as two container images built from one tag. This file is the
contract between the tag you push and what reaches GHCR.

## Versioning

Semantic versioning, **three parts, always**: `vMAJOR.MINOR.PATCH`.

- **MINOR** — a completed feature milestone (the GSD `/gsd:complete-milestone`
  cadence). v1.20 Filter Panel → `v1.20.0`.
- **PATCH** — a fix on top of a released minor, no new milestone. `v1.20.1`.
- **MAJOR** — a breaking change to the deployment contract (env vars, DB schema
  requiring manual migration, API shape consumers depend on).

`package.json` in the root and both workspaces carries the version of the
**last released** tag. Bump all three together; they are the only in-tree record
of the version, since `.planning/` is gitignored.

> **Two-part tags do not release.** `.github/workflows/build-images.yml` triggers
> on `v*.*.*`, which requires two literal dots, and `docker/metadata-action`'s
> `type=semver` cannot parse a two-part version either. Tags `v1.10` through
> `v1.20` were two-part, so **no images were published for eleven milestones**.
> If a release seems not to have shipped, check the tag shape first.

## Cutting a release

```bash
# 1. Gates green locally (CI enforces the same set on the tag).
cd packages/web    && npx tsc --noEmit && npx vitest run
cd ../server       && npx tsc --noEmit && node scripts/test-gate.mjs

# 2. Bump the three package.json versions to the version you are about to tag.
#    Commit that bump on master.
git commit -am "chore: v1.21.0"

# 3. Tag with release notes. The annotation body becomes the human record.
git tag -a v1.21.0 -m "v1.21.0 <Milestone Name>

Delivered: <one sentence>

Key accomplishments:
- ...
"

# 4. Push the commit first, then the tag — the tag must point at a commit origin has.
git fetch origin && git push origin master && git push origin v1.21.0
```

Pushing the tag runs `ci.yml` (web tsc + vitest + theme-guard, server tsc +
set-based gate) and, only if it passes, builds and pushes:

- `ghcr.io/kineticadb/kinetica-bi-web:1.21.0` and `:1.21`
- `ghcr.io/kineticadb/kinetica-bi-server:1.21.0` and `:1.21`

## The server test gate

The server suite has a documented permanently-failing set, so "0 failures" is
the wrong assertion and a fixed pass-count goes stale on every new spec.
`packages/server/scripts/test-gate.mjs` asserts a **set relationship** instead:

1. Run the full suite.
2. Failures listed in `KNOWN_FAILING` (each with a `TD-` reference) are allowed.
3. Any other failing file is **re-run alone**. Passing alone means cross-mode
   contamination (`TD-V16-TEST-ISOLATION`) and is allowed; still failing alone
   is a real regression and fails the gate.

Adding to `KNOWN_FAILING` is deliberate: include the `TD-` reference in the same
commit, or fix the test.

The gate forces `DEFAULT_VIEW_TTL_MINUTES=""` because the dev
`packages/server/.env` sets it to `3` and `src/env.ts` calls `dotenv.config()` at
import time, which otherwise reddens TTL specs locally. CI has no `.env`.

## Branching

`master` is the trunk. Work on a short-lived branch and open a PR:

```bash
git checkout -b phase/111-<short-name>
# ... commits ...
git push -u origin phase/111-<short-name>
```

Squash-merge into master, delete the branch. CI runs on every PR and on master.
Branch protection should require the `web` and `server` checks; requiring a
review is counterproductive while one person does most of the work.
