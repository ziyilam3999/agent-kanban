# Execution-review — agent-kanban-portrait-overflow-fold-front-screen-misclassified-as-phone (PR #79)

Decision: PASS

**Role:** execution-review (stateless, independent — did NOT author the plan or the code).
**PR:** #79 `ziyilam3999/agent-kanban`, head `ec2d6736538859515a3718b163036feb0df599e7`, base `master`, merge-base `0b275b0` (== the plan's stated base). OPEN / MERGEABLE.
**Plan:** `.ai-workspace/plans/2026-09-05-agent-kanban-fold-portrait-overflow.md` (plan-review Decision: PASS).
**Method:** every load-bearing claim re-derived from the diff and by running the guard MYSELF both-ends, not from the executor's prose.

## Named-risk disposition (receiving-end duty, #2434)

`node hooks/named-risk-notes.mjs list --task <id>` printed exactly one carried note:

DISPOSITION nr-akfold-portrait-interaction-assert-unit addressed — The AC-2 spec's REAL assertion (read at `e2e/fold-front-screen-overflow.e2e.spec.ts:249-251` and `:266-268`) is `expect(vv.offsetLeft).toBe(0)` + `expect(vv.pageLeft).toBe(0)` after a REAL horizontal CDP touch drag (`touchDragHorizontalAt`, engine-level `Input.dispatchTouchEvent`) AND a real `page.mouse.wheel()` over `.ak-lanes` — NOT a `scrollLeft` delta (the dead control). I confirmed the unit fires by running the guard against the pre-fix CSS myself: AC-2 went RED (`offsetLeft` 212@390 / 190@412) and GREEN (0) at PR head. The fixture uses production token shape (`PRODUCTION_ID_71`/`_80`/`_TOKEN_105`), self-asserted to exact lengths 71/80/105 with no whitespace (`board-fixture.ts` `slugOfLength`; I recomputed the three lengths independently = 71/80/105). A scratch revert of ONLY `app/globals.css` makes the guard RED (16/34) — reproduced by me. Minor honest deviation, non-blocking: the note asked to reproduce 198@390 / 176@412; the spec's heavier 2-lane / 60%-width-drag fixture reproduces 212 / 190 → 0 — same mechanism, same class, same order of magnitude, documented honestly in the red-evidence file. Sub-note "touch.ts is vertical-only on master" was imprecise: `touchDragHorizontalAt` already existed on master (paging round) and is correctly reused; the horizontal drive is genuinely real-CDP.

## Independent both-ends run (I ran it, CI-green is not my proof)

- **RED** — `app/globals.css` reverted to `git show 0b275b0`, everything else held: **16 failed / 18 passed**, matching the plan's named RED corpus EXACTLY: AC-1@390/412; AC-2@390/412 (touch+wheel = 4); AC-3@390; AC-4@390/412/672/750x832/750x1000/832/900/1024/1200. Every named GREEN control (AC-1@640-1200, AC-2/3@750x1000, AC-4@640x1000, AC-5) stayed green.
- **GREEN** — `app/globals.css` restored to PR head, same spec/fixture/touch: **34/34 passed**.
- Only variable between the two runs = `app/globals.css`. This is the gold-standard teeth check the last three guard rounds lacked.
- `npx tsc --noEmit` exits 0 at PR head.

## UI 3-leg gate — all three genuinely satisfied

1. **Design brief (leg 1):** `docs/fold8-4x3-design-brief.md` cited; the fix coheres with its container/inline-size POV — the CSS diff also corrects the stale `globals.css` comment that wrongly listed `.ak-lanes` as outside `.ak-main` (it is a real `.ak-main` descendant, container-queryable).
2. **ui-evolve verdict (leg 2):** `.ai-workspace/design/...-ui-evolve-verdict.md` — `verdict: ACCEPT`, `overall: 7.5/10`, per-dimension scoring, real renders at 390/412/750(x2)/1440 + a pre-fix BEFORE capture, no regression vs the paging round's 7.5/10.
3. **Real-interaction test (leg 3):** the guard is a REAL CDP touch-drag + wheel test on the visual-viewport pan unit — proven RED pre-fix and GREEN after by my own run above. Not computed-style / static shots.

## Mechanism + containment checks

- **Root-level containment actually added** (not just body): `html { overflow-x: hidden }` added at `app/globals.css:97` — the document-root half. AC-3 (a test-injected 600px non-shrinkable future-overflow stub still cannot pan) is RED pre-fix @390 and GREEN after — root clamp, not id-specific.
- **Lane-id truncates:** `.ak-lane-id` gains `overflow:hidden; text-overflow:ellipsis; min-width:0` alongside its existing `white-space:nowrap`, mirroring the sibling `.ak-lane-subject`.
- **640-1023 tiers not regressed:** the shell clamp (untouched) already contained those cells; AC-4 GREEN at every cell post-fix and AC-5 tier selection (750 2-up paging, 1200 4-up grid) GREEN in my run. The numeric-id hold-out (short ids render unchanged) holds — `min-width:0` only bites when content is wide.

## Monotonicity checklist (#1590)

- **Root clamp vs body clamp:** the html `overflow-x:hidden` is the STRONGER claim (contains the visual viewport, not just the layout viewport); the weaker body-only clamp coexists and cannot erase it. No erasure.
- **overflow-x:hidden forcing overflow-y:** per CSS, an axis set to `hidden` computes the still-`visible` axis to `auto`, so vertical page scroll is PRESERVED — the stronger "cannot pan horizontally" does not erase the weaker "scrolls vertically." Guarded by AC-3's vertical-reachability arm, which I ran GREEN.
- **Lane-id truncation:** additive on one element; the weaker "short numeric ids render unchanged" is preserved (hold-out green). No mutual-exclusion.
- **Fixture `productionShaped` opt-in:** strictly additive; existing callers omit the flag and stay byte-identical numeric `90${i}`. No last-writer erasure.

## Privacy (PUBLIC repo)

Per `docs/privacy-scan-invocation-contract.md`: `bash scripts/privacy-scan.sh --working <file>` (ai-brain canonical scanner, `command grep` wrapper-immune) run per-file on all 10 changed text files. 9/10 CLEAN. The one DIRTY = `.github/workflows/ci.yml` (home-path matches=1): the match is a synthetic comment example (a Users-home placeholder using the fictional name "alice") inside the privacy job's own exclusion note — PRE-EXISTING on master (line 81 on 0b275b0), NOT in this PR's added lines (diff-added-line grep empty), not a real home path. Positive control: a seeded synthetic home-path needle (fictional name "testuser") scanned DIRTY (home-path matches=1) — instrument has power. The repo's own CI `privacy` job is GREEN (7s), confirming the synthetic example is within its documented exclusions. Binary screenshots are app renders of synthetic fixture data (no real paths). No blob-host / brand / email / credential matches anywhere. Not a blocking finding.

## CI (read what the jobs run, not just green)

All 5 checks pass: `fold-front-screen-overflow-guard` (2m19s) runs the REAL spec headless chromium on the production-shaped board (`PW_WEB_SERVER=1 ... --project=chromium`); build 53s; privacy 7s; Vercel + Vercel preview. AC-10 (the guard actually runs on every PR) satisfied — this repo previously had no Playwright job at all.

## Findings summary

No blocking findings. All AC-0..AC-10 verified; the named risk is addressed and independently reproduced; the UI 3-leg gate is genuinely satisfied; monotonicity holds; privacy clean for this PR's content.

Decision: PASS
