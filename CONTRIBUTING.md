# Contributing to rest-magpie

Workflow conventions for this project. Read this once, then `git` becomes mechanical.

## TL;DR

- **Branching:** GitHub Flow. `main` is always deployable; everything else lives in short-lived branches.
- **Versioning:** SemVer. Pre-1.0 (`0.x.y`) — minor bumps may break API. Post-1.0 — strict SemVer.
- **First release:** `v0.1.0` after the MVP plan completes.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, etc.).
- **PRs:** Every change ships through a PR. Squash-merge to `main`. CI must be green.

## Branching strategy — GitHub Flow

```
main ──●──●──●──●──●──●──●──●──●─── (always green)
        \_/    \_/     \_/   \_/
       feat/x  fix/y   feat/z
```

Rules:
1. `main` is the only long-lived branch. Always deployable. Tests always green.
2. All work happens on feature branches branched off `main`.
3. Feature branches are short-lived (hours to days, not weeks).
4. PR → CI green → squash-merge → delete branch.

### Branch naming

`<type>/<short-kebab-case>` where `<type>` is one of:

| Prefix | Use |
|---|---|
| `feat/` | new feature |
| `fix/` | bugfix |
| `docs/` | docs-only change |
| `chore/` | tooling, deps, no code logic |
| `refactor/` | restructure without behavior change |
| `test/` | tests-only change |
| `ci/` | pipelines, workflow files |
| `perf/` | performance improvements |

Examples:

```
feat/cookie-jar
fix/redirect-loop-counter
docs/jq-cheatsheet
chore/bump-undici
ci/cache-npm-deps
```

## Versioning — SemVer

Format: `MAJOR.MINOR.PATCH` (e.g. `1.4.2`).

| Segment | Bump when |
|---|---|
| MAJOR | breaking change in public API |
| MINOR | new feature, backwards-compatible |
| PATCH | bugfix, no API change |

### Pre-1.0 special rule

While the package is `0.x.y`:

- **Any `0.x → 0.(x+1)` may break the API.** This is the SemVer escape hatch for unstable code.
- **`0.x.y → 0.x.(y+1)`** stays bugfix-only.
- Tag `1.0.0` only when you're ready to commit to backwards compatibility.

For `rest-magpie`, expect to spend several months in `0.x` while feedback shapes the tool surface. Move to `1.0.0` once the API has held still through ≥2 minor releases without need for breaking changes.

### Pre-release tags

For experimental work that needs npm distribution before stable release:

```
1.0.0-alpha.1   # very early, expect bugs
1.0.0-beta.1    # feature-complete, polishing
1.0.0-rc.1      # release candidate
```

Install via `npm install rest-magpie@beta` etc.

## Conventional Commits

Format:

```
<type>[optional scope]: <description>

[optional body — explain why, not what]

[optional footer — BREAKING CHANGE, Closes #123, etc.]
```

### Types

| Type | Effect on next version |
|---|---|
| `feat` | MINOR bump |
| `fix` | PATCH bump |
| `feat!` or footer `BREAKING CHANGE:` | MAJOR bump |
| `docs`, `chore`, `refactor`, `test`, `ci`, `perf`, `style`, `revert` | no bump |

### Examples

```
feat(http): add multipart/form-data body support

fix(jq): handle multi-output expressions when output_mode=first

Empty array used to be returned as undefined.

docs: add jq cheatsheet to README

chore(deps): bump undici to 7.1.0

feat!: rename http_fetch to http_request

BREAKING CHANGE: tool name changed; clients must update their config.
```

### Scope (optional)

Use to indicate which part of the codebase changed. Useful in larger projects, optional here. Suggested scopes:

`http`, `jq`, `cache`, `schema`, `tools`, `cli`, `docker`, `ci`.

## Pull request flow

```bash
# 1. Update local main
git checkout main
git pull --rebase

# 2. Branch off
git checkout -b feat/cookie-jar

# 3. Work, commit per logical step (TDD: test → code → commit)
git commit -m "test: failing test for cookie persistence"
git commit -m "feat: implement in-memory cookie jar"
git commit -m "docs: cookie jar usage in README"

# 4. Push and open PR
git push -u origin feat/cookie-jar
gh pr create \
  --title "feat: cookie jar for HTTP requests" \
  --body "Adds an opt-in cookie jar that persists Set-Cookie across calls in the same session."

# 5. CI runs. Wait for green.
gh pr checks --watch

# 6. Merge (squash) and clean up
gh pr merge --squash --delete-branch
git checkout main && git pull --rebase
```

### Merge strategy: squash-merge

GitHub offers three options. Use **Squash and merge**:

- All commits in the PR collapse into one commit on `main`.
- The squash commit message is your PR title (which should match Conventional Commits format).
- `main` history stays linear and one-commit-per-feature.

`Rebase and merge` and `Create merge commit` are not used in this project.

### Pre-merge checklist

- [ ] CI green (lint, typecheck, tests, build).
- [ ] PR title is a valid Conventional Commit.
- [ ] CHANGELOG.md updated if user-facing (skip for `chore`/`ci`/`docs` of internal docs).
- [ ] No leftover `console.log`, commented-out code, or `TODO`s without an issue link.
- [ ] If breaking — title starts with `feat!:` or `fix!:` and footer says `BREAKING CHANGE: ...`.

## Releasing

Releases happen by pushing a tag. The `release.yml` workflow handles the rest.

```bash
# 1. From main with everything to release already merged
git checkout main && git pull --rebase

# 2. Bump version in package.json (without git tag — we'll tag manually)
npm version minor --no-git-tag-version
# patch / minor / major depending on what changed

# 3. Update CHANGELOG.md — new section at top with the new version
$EDITOR CHANGELOG.md

# 4. Commit release
git add package.json CHANGELOG.md
git commit -m "chore: release v0.2.0"

# 5. Tag
git tag v0.2.0

# 6. Push commit and tag
git push
git push --tags
```

Release workflow will:
1. Run tests and build on the tag commit.
2. `npm publish --provenance` (requires `NPM_TOKEN` secret in repo settings).
3. Build and push Docker image to `ghcr.io/<user>/rest-magpie:v0.2.0` and `:latest`.

After tag pushes successfully, go to GitHub → Releases → Draft new release → select the tag → paste CHANGELOG section as release notes → publish. This shows the release on the repo's home page and notifies subscribers.

### CHANGELOG format

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/) loosely:

```markdown
# Changelog

## 0.2.0 — 2026-06-15

### Added
- `node-jq` native engine via `MAGPIE_USE_NATIVE_JQ=1`.
- Proxy support via `HTTP_PROXY`/`HTTPS_PROXY` env vars.

### Fixed
- Redirect chain was off-by-one when initial URL itself returned 3xx.

## 0.1.0 — 2026-05-09

Initial release. ...
```

Newest version on top. Date in ISO format. Group by `Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`.

## Hotfixes

For a critical bug on a released version when `main` already has unrelated work:

```bash
# Branch from the release tag, not main
git checkout -b fix/cve-1234 v0.1.0
# fix + tests + commit
git push -u origin fix/cve-1234
gh pr create --base main --title "fix: address CVE-1234"
# After merge to main:
git checkout main && git pull
npm version patch --no-git-tag-version  # 0.1.0 → 0.1.1
git commit -am "chore: release v0.1.1"
git tag v0.1.1 && git push --tags
```

For `rest-magpie` we currently support **only the latest minor**. If a CVE lands on `0.5.x` and `main` is `0.6.x`, we don't backport — we just release `0.6.x+1`.

## Branch protection on `main`

Configure in GitHub → Settings → Branches → Add rule for `main`:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass before merging
  - Required checks: `test (20)`, `test (22)` (from `ci.yml`)
- ✅ Require branches to be up to date before merging
- ✅ Do not allow bypassing the above settings

This makes the conventions enforced by GitHub, not just by discipline. Recommended even for solo projects — protects you from your own muscle memory.

## What goes in `main` directly

Nothing, after branch protection is enabled. Even small typo fixes go through a PR (just a 1-line PR). The 30 seconds of overhead are worth the consistency.

The exception is the very first commit (initial repo + `LICENSE` + `.gitignore`) — that's pushed to `main` before branch protection is configured. After that, everything is PR-driven.

## How the MVP plan maps to PRs

The implementation plan in `docs/plans/2026-05-09-rest-magpie.md` is grouped into **9 logical batches**, each becoming one PR. See the plan for the batch boundaries — every batch ends with a "branch / push / open PR / merge" instruction block.

The first batch creates the project foundation (`package.json`, `tsconfig`, etc.) on a feature branch. The first commit on `main` (before any PR) is just an empty commit or `LICENSE + .gitignore + README.md` skeleton — done by the user during repo init.
