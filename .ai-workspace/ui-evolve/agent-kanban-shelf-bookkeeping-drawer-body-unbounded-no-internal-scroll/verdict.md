# ui-evolve verdict — agent-kanban-shelf-bookkeeping-drawer-body-unbounded-no-internal-scroll

verdict: ACCEPT

- **Total: 18 / 20** (threshold: ≥16/20 AND no axis <3 — cleared)
- Scored against the 5-axis rubric from the plan (`.ai-workspace/plans/2026-09-11-shelf-drawer-bounded-scroll.md`,
  line 53) against the design POV (`.ai-workspace/design/2026-09-11-shelf-drawer-bounded-scroll-pov.md`),
  from REAL Playwright screenshots (headless Chromium, `next dev`) of the app running locally against a
  synthetic **production-volume shelf board**: 105 bookkeeping + 22 parked tickets (≥120 total across
  ≥2 kinds, ≥100 bookkeeping, ≥20 parked per the plan's fixture requirement), including one ticket with
  an 80-char kebab id and a 105-char spaceless subject token (production id/token shape), fed via
  `page.route` interception of `/api/board` — never the live Vercel Blob.

## Per-axis scores (0–4 each)

| # | Axis | Score | Evidence |
|---|---|---|---|
| 1 | Bounded panel with anchors visible | **4** | `desktop-open-at-rest.png`/`mobile-open-at-rest.png`: the header stat tiles, "N ACTIVE · M ON SHELF" pill, and the 4-column board strip (TODO/PROG/REVIEW/DONE) stay fully visible ABOVE the opened shelf body at both viewports — the panel never takes over the screen. `e2e/shelf-scroll.e2e.spec.ts` AC-1 measures the body's own box at both cells: `bodyBox.height <= 0.7 * innerHeight` (real DOM measurement, not eyeballed) — panel genuinely claims a bounded fraction of the viewport, matching the POV's "roughly half to two-thirds" intent. |
| 2 | Scroll affordance discoverable — rail and/or fade | **3** | The deliberately-visible thin scrollbar (the plan's REQUIRED cue, `scrollbar-width:thin` + `::-webkit-scrollbar*` rules tinted `--fg-faint`/transparent) is present and renders on both cells. The summary bar's `Bookkeeping 105 · Parked 22 · Deferred 0` count also reinforces "there is more than fits" (POV §2). The mask-image dark-ground edge fade (POV's stated PRIMARY cue) was **not implemented** — the plan explicitly permits this (line 69: "if a pure-CSS fade cannot avoid masking the scrollbar rail or needs JS scroll listeners, ship the rail alone → file a design follow-up, not a blocker"); attempting a mask-image fade risked clipping/fading the scrollbar rail itself (the exact failure mode the plan warns about) under this session's remaining time budget, so it was deliberately deferred rather than risk shipping a second visual defect on top of the one caught below. Docked one point for the missing secondary cue; **follow-up filed** (see Known follow-ups). |
| 3 | Pinned label legible and opaque, no ghosting | **4** | **A real defect was caught and fixed here via Rule-19 eyeballing** (not by the automated AC-5 bounding-box assertion, which only checks the label's position, not its opacity): the first captured mid-scroll screenshot showed a sliver of the previous card ghosting through ABOVE the pinned "BOOKKEEPING" label — root cause: `position:sticky; top:0`'s stuck position anchors to the scroll container's *padding* edge, leaving the container's own 12px `padding-top` (before the first group) / 14px flex `gap` (before later groups) as a permanent uncovered gap inside the visible clip area, which a scrolling card ghosted through. Fixed by setting `top: -14px` on `.ak-shelf__group-label` (re-anchors the stuck position to the container's true visible edge) — confirmed via `elementFromPoint` at the container's top edge landing on the label, not a card, and re-confirmed visually in the final `mobile-mid-scroll.png`/`desktop-mid-scroll.png` screenshots: the label now renders flush and fully opaque with zero ghosting at both viewports. Full root-cause writeup in the CSS comment above `.ak-shelf__group-label` in `app/globals.css`. |
| 4 | Card fidelity unchanged vs the columns | **4** | `mobile-open-at-rest.png`/`desktop-open-at-rest.png`: shelf cards use the identical `Card` component / `.ak-cardbtn` treatment as the column board — same id/status/subject/kind-chip/timestamp layout, same border and spacing rhythm. No visual degradation, no truncation beyond the existing column-card wrapping behavior. |
| 5 | Closed state / board unchanged | **4** | `desktop-closed.png`/`mobile-closed.png`: the shelf collapses to the existing single-line `▾ Bookkeeping 105 · Parked 22 · Deferred 0` summary row — byte-for-byte the same closed-state treatment as the prior S1 round's verdict (`.ai-workspace/ui-evolve/board-noise-s1-display/verdict.md`, axis D2), no regression. The 4-column board above is completely unaffected by the body-scroll fix (CSS change is scoped to `.ak-shelf[open] > .ak-shelf__body` and `.ak-shelf__group-label` only). |

## Regression guard (pass/fail, not scored) — **PASS**

- `npx tsc --noEmit`: clean.
- `npm test` (jest): 51/51 suites, 512/512 tests green.
- `e2e/shelf-scroll.e2e.spec.ts` (new, 12 tests) + `e2e/shelf.e2e.spec.ts` (existing, 2 tests, AC-1.4/AC-1.5): all 14 green at PR head, same run.
- Full Playwright suite (`--project=chromium`, all specs): 142/146 green; the 4 failures are pre-existing/machine-load-sensitive, confirmed unrelated by re-running against the plain pre-fix `752a531` baseline (same failures reproduce there) — see `.ai-workspace/reviews/agent-kanban-shelf-bookkeeping-drawer-body-unbounded-no-internal-scroll-red-evidence.md` §4.
- No horizontal overflow introduced at either viewport (AC-4, both a real gesture over normal content and over an injected wide child).

## Screenshots (this run)

All under `.ai-workspace/ui-evolve/agent-kanban-shelf-bookkeeping-drawer-body-unbounded-no-internal-scroll/shots/`:
- `desktop-closed.png` / `mobile-closed.png` — 1440×900 / 390×844, shelf collapsed (default-load state).
- `desktop-open-at-rest.png` / `mobile-open-at-rest.png` — same viewports, shelf opened, scrolled into view, settled (production-volume board, 127 shelf tickets total).
- `desktop-mid-scroll.png` / `mobile-mid-scroll.png` — same viewports, after a real gesture (wheel on desktop, CDP touch drag on mobile) inside the body — Bookkeeping label pinned, thin scrollbar rail visible, no ghosting.

## Known follow-ups (not blockers, per plan L69)

- **Edge fade (POV §2 primary cue, plan L25/L35/L69):** not implemented this round — the plan explicitly
  allows shipping the rail alone when a pure-CSS mask-image fade risks masking the scrollbar rail or needs
  JS scroll listeners. A future task could explore a mask limited to the content column (excluding the
  scrollbar's own track width) so both cues can coexist.

## No-publish note

`data/board.json` was never written by this session's screenshot capture — the fixture board was served
entirely via Playwright's `page.route` interception of `/api/board`, never touching the on-disk file or
the live Blob.

## Method note

Same discipline as prior verdicts in this repo (`.ai-workspace/ui-evolve/board-noise-s1-display/verdict.md`,
`.ai-workspace/ui-evolve/agent-kanban-fold8-4x3-bugfix/verdict.md`): real screenshots, a fixed rubric
derived from the plan/POV, an explicit ACCEPT/REVERT gate, a mechanical regression guard, and — per
Rule 19 — an actual eyeball pass on the rendered pixels before scoring, which is what caught axis 3's
defect in the first place.
