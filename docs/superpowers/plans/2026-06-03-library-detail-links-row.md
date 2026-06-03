# Library detail Links row visibility fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Links section in the library document detail panel visible in every view mode (preview / edit / split / focus / info-edit), not just info-edit.

**Architecture:** One-line CSS change — `.library-detail` gains an explicit third grid row (`auto`) for the Links section. Renderer and JS are unchanged. Visual verification against real Postgres only; no automated layout tests.

**Tech Stack:** Plain CSS; existing Node test runner for the regression sanity check.

**Spec:** [`docs/superpowers/specs/2026-06-03-library-detail-links-row-design.md`](../specs/2026-06-03-library-detail-links-row-design.md)

**Target release:** v0.12.1 (patch).

---

## File map

**Modify:**
- `public/styles.css` — `.library-detail { grid-template-rows: auto minmax(0, 1fr) auto; }`

No other files change.

---

## Task 1 — Add the third grid row to `.library-detail`

**Files:**
- Modify: `public/styles.css`

- [ ] **Step 1: Read the current `.library-detail` rule**

Run: `grep -n -A 7 '^\.library-detail {' public/styles.css`

Expected output: shows the rule at approximately lines 1572–1579 with
`grid-template-rows: auto minmax(0, 1fr);`.

- [ ] **Step 2: Update the `grid-template-rows` value**

Edit `public/styles.css`. Change ONLY the `grid-template-rows` line inside the
`.library-detail { ... }` rule:

```css
.library-detail {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  height: 100%;
  max-height: none;
  overflow: hidden;
  border-left: 0;
}
```

The trailing ` auto` is the only new content. The other six lines of the rule
remain identical.

- [ ] **Step 3: Confirm the change**

Run: `grep -n 'grid-template-rows' public/styles.css | grep -i library`

Or, more precisely:

Run: `grep -n -A 7 '^\.library-detail {' public/styles.css`

Expected: the second line of the rule reads
`grid-template-rows: auto minmax(0, 1fr) auto;`.

- [ ] **Step 4: Run the test suite**

Run: `npm test`
Expected: 706/706 pass (the change is CSS-only; existing string-HTML tests
don't care about layout).

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Visual smoke against the running stack**

If the published v0.12.0 stack is currently running, rebuild it from local
source so the patch is in the served bundle:

```bash
docker compose up -d --build
sleep 6
```

(If no stack is running, start fresh:
`docker compose down -v && docker compose up -d --build && sleep 10`.)

Open `http://127.0.0.1:3100/` in a browser. Find a doc with at least one
link (the synthesized doc seeded earlier — `Postgres restore — quick
reference` — is a good target if the seed data is intact). For each of the
five detail modes:

1. **Preview** (default): confirm Links section appears below the body, in
   the lower portion of the right aside.
2. **Edit**: click `[e] edit` (or whichever bracket button toggles to edit).
   Confirm Links remains visible at the bottom of the aside.
3. **Split**: click `[s] split`. Confirm Links remains visible.
4. **Info-edit**: click `[i] info`. Confirm Links is still visible (this
   path worked before; should not regress).
5. **Focus**: click `[f] focus`. Confirm Links remains visible.

Also click a doc with no links (any plain source doc). Confirm the Links
section renders as "No links." with no broken layout above or below.

If any mode still hides Links: stop, do NOT commit; the fix is wrong and
needs re-diagnosis (could be a deeper CSS interaction at the `.document-workspace`
level).

- [ ] **Step 6: Commit**

```bash
git add public/styles.css
git commit -m "Fix library detail Links row visibility in all modes

.library-detail was a 2-row grid (header + workspace). The renderer
appends Links as a 3rd child, which CSS Grid placed in an implicit
auto row — but the aside's overflow: hidden clipped it because the
1fr workspace row claimed all available height.

Add an explicit third row of \`auto\` so Links always gets a slot at
the bottom of the aside. Workspace's internal scroll (CodeMirror,
preview overflow) absorbs the lost height. Empty Links collapses to
0 height with no visual artifact.

Single-line CSS fix; no JS or renderer changes."
```

---

## Task 2 — Release

This task is the standard patch release ritual. Not bite-sized; it's a
checklist for the controller / human to execute after Task 1 lands on main.

- [ ] **Step 1: Open the PR for Task 1's branch**

```bash
git push -u origin fix/library-detail-links-row
gh pr create --title "fix: library detail Links section visible in all modes" --body "$(cat <<'EOF'
## Summary

After v0.12.0 shipped, the Links section in the library document detail panel was only visible in info-edit mode. In preview / edit / split / focus, the section was clipped below the visible aside because \`.library-detail\` was a 2-row CSS grid (header + workspace) and Links was the 3rd child without an explicit grid row.

This PR adds a third \`auto\` row to \`grid-template-rows\` on \`.library-detail\`. The workspace's internal scroll absorbs the lost height; empty Links collapses to 0 with no visual artifact.

Pure CSS fix — one line. No renderer or JS changes.

Spec: \`docs/superpowers/specs/2026-06-03-library-detail-links-row-design.md\`.

## Test plan

- [x] \`npm test\` green (706 tests; no test changes needed)
- [x] \`npm run check\` green
- [x] Visual smoke against the rebuilt Docker stack: Links section visible at the bottom of the aside in preview, edit, split, info-edit, and focus modes. Empty Links collapses cleanly.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: After PR merge, cut the v0.12.1 release**

Sync main and cut the release branch:

```bash
git checkout main
git fetch origin
git reset --hard origin/main
git branch -d fix/library-detail-links-row    # safe local cleanup
git checkout -b release-v0.12.1
npm version 0.12.1 --no-git-tag-version
```

Update three files:

- `compose.image.yaml` — `image: ghcr.io/awaybreaktoday/moomora-console:v0.12.1`
- `README.md` — replace the existing `ghcr.io/awaybreaktoday/moomora-console:v0.12.0` reference with `v0.12.1`
- `CHANGELOG.md` — roll `[Unreleased]` to `[0.12.1] - <today>` with a `### Fixed` entry:

```markdown
## [0.12.1] - 2026-06-03

### Fixed

- Library detail Links section is now visible in every view mode (preview,
  edit, split, focus). Previously the section only rendered in info-edit
  mode because `.library-detail` was a 2-row CSS grid with `overflow:
  hidden`, clipping the implicit third-row Links section in other modes.
  One-line CSS fix: add an explicit `auto` third row to
  `grid-template-rows`. (#<PR>)
```

…and add the `v0.12.0...v0.12.1` compare link near the bottom of
`CHANGELOG.md`:

```markdown
[Unreleased]: https://github.com/awaybreaktoday/moomora-console/compare/v0.12.1...HEAD
[0.12.1]: https://github.com/awaybreaktoday/moomora-console/compare/v0.12.0...v0.12.1
```

(Adjust the `[Unreleased]` line to point at v0.12.1.)

Commit, push, open the release PR:

```bash
git add CHANGELOG.md README.md compose.image.yaml package.json package-lock.json
git commit -m "chore: prepare v0.12.1 release"
git push -u origin release-v0.12.1
gh pr create --title "chore: prepare v0.12.1 release" --body "$(cat <<'EOF'
## Summary

- Roll \`[Unreleased]\` to \`[0.12.1] - 2026-06-03\` in CHANGELOG.md.
  - **Fixed:** Library detail Links section now visible in every view mode. (#<fix-PR>)
- Bump \`package.json\` and \`package-lock.json\` to \`0.12.1\`.
- Update \`compose.image.yaml\` and the README image-tag callout to \`v0.12.1\`.
- Add the \`v0.12.0...v0.12.1\` compare link.

## Test plan

- [x] \`npm test\` green (706 tests)
- [x] \`npm run check\` green
- [ ] After merge: tag \`v0.12.1\`, push tag, release workflow publishes the multi-arch image and creates the GitHub Release.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: After release PR merge, tag and watch the workflow**

```bash
git checkout main
git fetch origin
git reset --hard origin/main
git branch -d release-v0.12.1
git tag -a v0.12.1 -m "v0.12.1"
git push origin v0.12.1
```

Find the release workflow run and watch it:

```bash
sleep 5
gh run list --workflow=release.yml --limit 1 --json databaseId,status,headBranch
# Take the databaseId, then:
gh run watch <id> --exit-status --interval 20
```

Expected: `success`.

Confirm the GitHub Release is published:

```bash
gh release view v0.12.1 --json isDraft,name,tagName,url
```

Expected: `isDraft: false`, `name: v0.12.1`, `tagName: v0.12.1`.
