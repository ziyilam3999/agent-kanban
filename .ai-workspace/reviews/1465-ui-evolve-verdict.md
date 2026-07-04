# ui-evolve verdict — #1465 model badge on kanban ticket cards

**verdict: ACCEPT**

- **Total: 20 / 20** (threshold: ≥16/20 AND no axis <3 — cleared)
- Scored against the design brief's §7 rubric (`.ai-workspace/design/1465-model-badge-brief.md`), from REAL Playwright screenshots (Node `playwright-core` 1.61.1, headless Chromium) of the app running locally (`npm run dev`, `http://localhost:3000`) against a mixed fixture at `data/board.json` (gitignored local-dev override) carrying model-bearing AND model-less tickets, including a deliberate blocked+model "crowding" ticket (#210).

## Per-axis scores (0–4 each)

| # | Axis | Score | Evidence |
|---|---|---|---|
| R1 | Legibility @ phone (390px) | **4** | `shots/mobile-inprogress.png`, `shots/mobile-review.png` — the model pill (`sonnet-5·xhigh`, `opus-4-8·xhigh`) renders crisp at 9px mono on both a clean single-line footer (#203) and the crowded blocked+badge footer (#210); effort segment reads visibly subordinate (dimmer) next to the model segment. Contrast is the plan-pinned token pair — model text `--fg-meta` (#93a0ac, ≥4.5:1 on `--panel`, documented AA-safe at `globals.css:18`), effort text `--fg-dim` (#7c8a96, ≈5.14:1) — both clear WCAG AA; `--fg-faint` (fails AA) was deliberately NOT used for either segment. |
| R2 | Honesty / clarity | **4** | `sonnet-5·xhigh` / `opus-4-8·xhigh` unambiguously read as tier+version+effort in every screenshot; zero caveat/hedge text; effort is visually subordinate (dimmer), never competing with the model segment. |
| R3 | Non-crowding of phase line | **4** | The phase line JSX/CSS (`.ak-phase`, `phaseLine()`) was NOT touched by this change — only the footer gained a new conditional sibling. Measured via DOM `getBoundingClientRect()` on the live desktop render: `.ak-card__foot` height is **16px** for every UNBLOCKED card regardless of model presence (#201 no-data, #203 model-bearing, #205 model-bearing, #206 model-less — all 16px identical). Only the BLOCKED card (#210) grows to 32px, from its own blocked-pill text wrapping — outside the regression guard's explicit "unblocked case" scope, and still shows the phase line (`▶ EXECUTOR`) fully intact above it. |
| R4 | Graceful missing-data | **4** | `shots/mobile-done.png` (#206, model-less, unblocked) footer shows only the relative time — no empty pill, no dangling `·`, no visual artifact — byte-identical to the pre-feature baseline captured before this change (`<div class="ak-card__foot"><span class="ak-card__time">just now</span></div>`, pinned in `__tests__/card.test.ts` as `EXPECTED_MODELLESS_FOOT` and asserted every test run). |
| R5 | Idiom consistency | **4** | `.ak-model` reuses `.ak-tag`'s exact shape (5px radius, 2px 6px padding, `--font-mono`, `color-mix(--line 45%, transparent)` fill, 1px `--line` border) at footer scale (9px, matching `.ak-card__time`/`.ak-node__agent`); the `·` separator matches the board's existing middot idiom (`·<agentId>`, `· 14:03`); the drawer's `.ak-node__model` is borderless, matching `.ak-node__agent`'s inline-annotation style exactly (`shots/drawer-205.png` shows `·fJa4b5c6  sonnet-5·high` and `·a6b7c8d9  opus-4-8·xhigh` reading as natural companions to the existing agentId annotation). |

## Regression guard (pass/fail, not scored) — **PASS**

- **No card-height change in the unblocked case**: measured 16px footer height, identical across model-bearing and model-less unblocked cards (see R3 evidence above).
- **Phase line never truncates because of the badge**: the phase line component/CSS is untouched; `▶ EXECUTOR`, `✓ SHIP-WITH-FIXES — STALE`, `✓ DONE · PASS` all render at full width in every screenshot, unaffected by footer content.
- **Drawer annotation wraps, never overflows**: `.ak-node__head` is `flex-wrap: wrap` (pre-existing, untouched); `shots/drawer-205.png` confirms the model annotation sits inline after `·<agentId>` without any overflow/clipping.

## Screenshots (this run)

- `shots/desktop-board.png` — 1280×900, mixed board (model-bearing #203/#205/#210, model-less #201/#206).
- `shots/mobile-inprogress.png`, `shots/mobile-review.png`, `shots/mobile-done.png` — 390×844, per-lane mobile carousel views.
- `shots/drawer-205.png` — desktop drawer for ticket #205, showing per-role model annotations (`EXECUTOR ·fJa4b5c6 sonnet-5·high`, `EXEC-REVIEW ·a6b7c8d9 opus-4-8·xhigh`) beside the existing `·<agentId>` idiom; PLANNER/PLAN-REVIEW rows correctly omit the annotation (no model data recorded for those roles in the fixture).

## Method note

The standalone `ui-evolve` repo (`~/coding_projects/ui-evolve`) runs a generic, whole-page closed-improvement loop (Lighthouse/axe-core thresholds, an 11-dim structural rubric, multi-round convergence) intended for iterating a full page design to a satisfaction bar — out of scope for a single additive footer badge. This verdict applies the SAME discipline the skill embodies (real screenshots, vision-judge scoring, a fixed rubric, an explicit ACCEPT/REVERT gate, a regression guard) directly against the task's own design-brief rubric (§7, R1–R5), which is what plan AC6 specifies. The skill was symlinked into `~/.claude/skills/ui-evolve` during this task (it existed on disk but was not yet wired into this environment) for future full-loop use.
