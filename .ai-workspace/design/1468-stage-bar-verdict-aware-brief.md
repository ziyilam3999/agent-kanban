# Design Brief — #1468 Verdict-Aware Stage Bar

**Repo:** agent-kanban (PUBLIC) · **Phase:** frontend-design (leg 1 of the UI-task gate) · **Grounded by:** the `frontend-design` skill + a verified read of `components/Drawer.tsx` (`PipelineProgress`, ~L402–432), `lib/lanes.ts` (`currentStageIndex`), `components/LiveSwimlanes.tsx`, `lib/ui-meta.ts`, `lib/board-schema.ts`, `app/globals.css`.

This brief is the **design POV** the executor builds to and that `ui-evolve` (leg 2) later scores against §RUBRIC. It specifies WHAT the stage bar shows and WHY — not the final React.

---

## 0. One-paragraph POV

The 4-pill stage bar is not a progress bar — it is a **truth gauge of the chain's control flow**. The planner → plan-review → executor → execution-review pipeline is a graph with **backward edges**: a fail-class review is a *loop back* to the prior work role (plan-review FAIL → planner rewrites; exec-review FAIL → executor redoes). Today's bar reads only ONE axis — "has this role ever commented" (`rolesSeen`) — so a FAILed review is scored identically to a PASS, the bar marches forward, and it glows the *next* role as "up next" even though the chain actually bounced backward. That is the board-prettier-than-reality lie (#1403 / #1410 / #1449 class). The fix encodes **two facts per pill** — *reached?* and, for review roles, *verdict* — and makes the single "active now" glow follow the chain's **real control pointer**: after a fail, the pointer is back on the prior WORK role (re-working), and every role downstream of the failure is shown **not-yet-reached**, not done and not next. Red is the board's existing fail signal (`--err`); we reuse it. The bounce trigger reuses `isFailClassVerdict`; the per-pill verdict tint reuses `verdictHue`. No new vocabulary — just the two facts the board already knows how to say, finally said on this bar.

---

## 1. The bug, precisely — control-flow blindness

`PipelineProgress` (in `components/Drawer.tsx`) derives three values from role *presence* only:

```
rolesSeen  = new Set(comments.map(c => c.role))     // ANY comment marks a role "seen"
nextPending = PIPELINE_ROLES.find(r => !rolesSeen.has(r))   // first unseen = "current"
doneCount   = PIPELINE_ROLES.filter(r => rolesSeen.has(r)).length
state       = done ? "done" : (role === nextPending ? "current" : "pending")
```

A plan-review comment carrying `verdict:"FAIL"` still lands in `rolesSeen`, so `plan-review` counts DONE and `nextPending` = `executor` → the executor pill glows "up next". But a FAIL means the chain **bounced back to planner** to rewrite. The bar is verdict-blind. The identical blindness lives in `lib/lanes.ts` `currentStageIndex` (highest-index role seen) which drives `components/LiveSwimlanes.tsx`'s single lit stage — so a card's swimlane track can light `executor` for the same reason. **Both surfaces are in scope** (§7): the drawer bar and the swimlane track must agree, or we replace one lie with two.

---

## 2. The encoding model — three dimensions, reusing the board's own helpers

Every pill carries up to three coordinated cues. We build ALL of them on existing `lib/ui-meta.ts` exports — no duplicated logic:

| Dimension | Question | Source (existing helper) |
|---|---|---|
| **Reached** | Has this role acted (≥1 comment)? | `rolesSeen` (unchanged) |
| **Verdict** (review roles only) | What did this review decide? | per-review-role latest verdict → `verdictHue(v)` for the tint, `isFailClassVerdict(v)` for the bounce test |
| **Pointer** | Which single role is the chain working on *right now*? | derived state machine in §3, gated by `isFailClassVerdict` |

**Two small reuse enablers the executor wires (not new design):**
- `latestReviewVerdict(ticket)` today returns ONE verdict (exec-review preferred over plan-review). The bar needs each review role's **own** latest verdict. Generalize it to a per-role lookup (e.g. `latestVerdictForRole(ticket, "plan-review")`) or inline a last-match scan; classify with the SAME `isFailClassVerdict` / tint with the SAME `verdictHue`. Do not fork the fail-class regex.
- `WORK_PIPELINE_ROLES` (`{planner, executor}`) is currently module-private in `lib/ui-meta.ts`. Export it (1 line) so the bar names the correct work role to bounce the pointer onto — reusing the exact set the phase line and model badge already use, so the bar stays consistent with them about "who is a work role."

**Token vocabulary (all already defined in `app/globals.css`):**
- `--err` #e2564d — the board's single fail color (verdict pills, `verdictHue` fail branch). **This IS the FAIL encoding.**
- Role hues for done-pass fills: `--prog` #34c6e2 (planner), `--review` #f2b03e (plan-review), `--live` #3ef2b0 (executor per `ROLE_COLOR`), `--done` #4f9e7a (exec-review). Review-role *done* fills tint by `verdictHue` (green clean-pass / amber caveated-pass), not by the flat role hue.
- Current/active look = today's drawer "current": `mix(--step 45%, --line)` bar + soft glow + **`--fg`** (#d7e0e6) bright label. (Kept — idiom-consistent *within* the drawer.)
- Not-reached = `--line` #1f2a33 bar (decorative) + **`--fg-meta`** #93a0ac label. **Not `--fg-faint`** for a label — it fails AA, and every label here carries meaning.

---

## 3. The control-pointer state machine (design contract)

Compute per-review-role latest verdict, then resolve **exactly one** pointer (or none, when terminal). Evaluate in this precedence — the first match wins:

```
planFail = plan-review reached AND isFailClassVerdict(its latest verdict)
execFail = exec-review  reached AND isFailClassVerdict(its latest verdict)
execPass = exec-review  reached AND latest verdict present AND NOT isFailClassVerdict(it)

1. execPass                    → TERMINAL DONE. No pointer/glow. All 4 done-pass. [State 4]
2. execFail                    → pointer = EXECUTOR (re-working). exec-review pill = FAILED(red).
                                  loopback affordance between executor↔exec-review.       [State 2, exec side]
3. planFail                    → pointer = PLANNER (re-working). plan-review pill = FAILED(red).
                                  executor + exec-review FORCED not-reached (grey) even if a
                                  stray later comment exists. loopback planner↔plan-review. [State 2, KEY]
4. otherwise (forward flow)    → pointer = first role in order NOT reached (== today's nextPending);
                                  if all reached but exec-review verdict still pending, pointer =
                                  execution-review ("reviewing now").                       [State 3]
```

Using **latest** verdict per review role makes the rework-then-pass cycle self-correct: planner rewrites → plan-review re-runs and now PASSes → `planFail` flips false → pointer advances forward automatically. The bounce reflects the newest verdict live, not a sticky scar. **Only `isFailClassVerdict` triggers a bounce** — an `APPROVE-WITH-NOTES` / `SHIP-WITH-FIXES` verdict is *non-fail-class*, so the chain proceeds forward (pill tints amber via `verdictHue`, pointer does NOT return) — matching `phaseLine` / `shippingAfterPass` / `chainInFlight`.

---

## 4. State table — the four required states → exact visual encoding

Legible target: **390px phone width** (drawer is full-width; `.ak-pipeline` is a 4-col grid, ~80px per pill).

| # | Chain state | Pill(s) | Bar fill (token) | Label color | Glyph / affordance |
|---|---|---|---|---|---|
| **1** | **Done + PASS** (forward progress) — a work role whose downstream review passed, OR a review role with a non-fail verdict | that pill | **work role:** solid role hue `--step`. **review role:** solid `verdictHue(v)` — green `--done` clean-pass / amber `--review` caveated-pass | same hue as its bar (role hue or `verdictHue`) | review pills get a trailing **`✓`** (PASS tick) so a passed review is not confused with a merely-reached work role. Work roles: no glyph. |
| **2** | **Review FAILED → looped back** (the KEY new state) — plan-review (or exec-review) latest verdict is fail-class | **failed review pill** | solid **`--err`** red | **`--err`** red | trailing **`✕`** on the label + a **`◄` back-arrow connector** rendered in the 6px gap toward the work role it returned to |
|  |  | **re-working work pill** (planner / executor) = the pointer | `mix(--step 45%, --line)` + glow (current look) | **`--fg`** bright | leading **`↩`** on the label → `↩ PLANNER` / `↩ EXECUTOR` (distinguishes a re-work from a first pass) |
|  |  | **downstream pills** (executor + exec-review after a plan-review fail) | `--line` grey | **`--fg-meta`** | none — forced **not-reached** (not "done", not "next") |
| **3** | **Genuinely current / active** — first not-reached role in forward flow (or exec-review "reviewing now") | that pill | `mix(--step 45%, --line)` + glow | **`--fg`** bright | no `↩` (a first pass, not a rework). Exactly one pill carries the glow. |
| **4** | **Terminal all-PASS → DONE** — exec-review reached with a non-fail verdict | all four pills | all solid done-pass (role hue / `verdictHue`); review pills green | role hue / `verdictHue` | **no glow anywhere** (chain is complete — nothing is "active"), plus a right-aligned **`✓ DONE`** cap on the bar row. This is what stops "complete" from looking like "executor running." |

**Not-reached / pending (baseline, unchanged):** `--line` bar + `--fg-meta` label, no glyph. This is the default and the forced state for anything downstream of a fail.

**Per-pill "look" classes (illustrative — executor owns final names):** `--pass` (review passed, tint by verdict), `--failed` (red + ✕), `--current` (glow + bright, existing), `--reworking` (`--current` + `↩` prefix), `--pending` (grey), and a container modifier `.ak-pipeline--done` (terminal: kill glow, show ✓ DONE cap). The loopback connector is one element, `.ak-pipeline__loopback`, absolutely positioned in the single gap between the two adjacent pills (planner↔plan-review and executor↔exec-review are adjacent in pipeline order, so the arrow spans exactly one 6px gap — no long arc to break responsively).

---

## 5. The loopback affordance — legible at 390px

Three coordinated cues make "bounced back, re-working" unmistakable **without** a fragile drawn arc:

1. **Red failed pill** — `--err` bar + `✕`. Red = stop/fail everywhere on this board, so the eye does not read it as done (role-hue) or pass (green).
2. **`◄` back-arrow** in the gap, pointing left toward the work role — "flow returned this way." Rendered in `--err` (or amber `--review`) at ~9px; because the two pills are adjacent it is a single-gap glyph, not a multi-column arc.
3. **`↩ PLANNER` re-working pill** — the current-glow moved back onto the work role, prefixed with the return glyph.

Label-width check @390px (8.5px mono, ~80px column): `↩ PLANNER` (9 chars) and `↩ EXECUTOR` (10 chars) both fit; `PLAN-REVIEW` already ellipsizes via the existing `.ak-pipeline__label` (`overflow:hidden; text-overflow:ellipsis`) and keeps doing so — the `✕`/`✓` verdict glyph rides as a separate non-shrinking span so it is not the thing that clips. **Optional enhancement** (executor may add only if it survives the 390px rubric): a thin CSS/SVG curved arc under the two bars replacing the flat `◄`. Lead with the glyph; the arc is a nicety, not a requirement.

**Aria / honesty (screen-reader parity):** the container `aria-label` must describe the *control state*, not a fraction. Replace `"pipeline progress: N of 4 complete, next: EXECUTOR"` with e.g. `"stage: PLANNER re-working after PLAN-REVIEW failed; EXECUTOR and EXECUTION-REVIEW not yet reached"` (fail case), `"stage: EXECUTOR active; PLANNER and PLAN-REVIEW passed"` (forward), `"stage: complete, all roles passed"` (terminal). The a11y string must not announce a downstream role as done/next when a review failed.

---

## 6. Responsive / overflow @ 390px

- The 4-col grid is unchanged; pills stay equal-width. Verdict glyphs (`✓`/`✕`) and the `↩` prefix are non-shrinking spans; only the role label text ellipsizes (existing behavior), so nothing overflows the pill or the drawer.
- The `◄` loopback connector lives inside the existing 6px inter-pill gap (absolute, `pointer-events:none`) — it adds **zero** layout width and cannot push the row past the viewport (the telemetry-console "no horizontal overflow" rule).
- Terminal `✓ DONE` cap is a short right-aligned span on the bar row; on the narrowest width it may sit above the labels but must not wrap the pills.
- **Swimlane track parity** (`components/LiveSwimlanes.tsx` + `lib/lanes.ts`): apply the same pointer logic — a fail-class review makes the lit `--live` stage return to the prior work role, the failed review stage tints `--err`, and downstream stages stay `--pending`. The lane's `currentStageIndex` must become verdict-aware (or carry a `reworking`/`failedStage` companion) so the lane and the drawer do not contradict each other.

---

## 7. ASCII mocks (390px phone width)

Bars shown as fill chars; `█` solid, `▓` current-glow, `·` grey not-reached. Labels beneath.

### 7a. State 1 + 3 — forward flow, plan-review PASSED, executor active

```
 ████████   ████████✓  ▓▓▓▓▓▓▓▓   ········
 PLANNER    PLAN-REV   EXECUTOR   EXEC-REV
 cyan(done) green ✓    glow/bright  grey(not reached)
                       └ the single active glow (first pass, no ↩)
```

### 7b. State 2 — plan-review FAILED → planner re-working  (THE KEY STATE)

```
 ▓▓▓▓▓▓▓▓ ◄ ████████✕  ········   ········
 ↩PLANNER   PLAN-REV   EXECUTOR   EXEC-REV
 glow+rework RED ✕(fail) grey       grey
     ▲          │        (NOT lit)  (NOT reached)
     └── back-arrow ◄ : control returned here to rewrite
```
Executor is **grey, not glowing** — the bug's exact failure mode is inverted.

### 7c. State 2 (exec side) — exec-review FAILED → executor redoing

```
 ████████   ████████✓  ▓▓▓▓▓▓▓▓ ◄ ████████✕
 PLANNER    PLAN-REV   ↩EXECUTOR  EXEC-REV
 cyan(done) green ✓    glow+rework RED ✕(fail)
```

### 7d. State 4 — terminal, all PASS → DONE

```
 ████████   ████████✓  ████████   ████████✓        ✓ DONE
 PLANNER    PLAN-REV   EXECUTOR   EXEC-REV
 cyan       green ✓    mint       green ✓     no glow — chain complete
```
No pill glows — distinguishes "done" from "executor running."

---

## 8. §RUBRIC — `ui-evolve` scores REAL 390px phone + desktop screenshots

Five axes, each **0–4**. **ACCEPT: total ≥ 16 / 20 AND no single axis < 3.** Score from captured pixels against fixtures, not from code.

| # | Axis | 0 | 2 | 4 |
|---|---|---|---|---|
| **R1** | **Honesty — a later role is not shown done/next when a review failed** *(load-bearing)* | on a plan-review-FAIL fixture the executor pill is lit/current or plan-review reads "done" | fail is tinted but a downstream pill still looks reachable/next, or the glow is ambiguous | on the FAIL fixture: plan-review is unmistakably FAILED (red + ✕), executor + exec-review are grey not-reached, and the ONLY active glow is on PLANNER (`↩`) |
| **R2** | **Loop-back legibility @ 390px** | no bounce cue; bar looks monotonic | one cue present (e.g. red pill) but the "returned to planner, re-working" reading is unclear at phone width | all three cues read at 390px — red failed pill, `◄` back-arrow, `↩`-prefixed re-working pill — and the a11y label states the bounce |
| **R3** | **Verdict clarity — PASS vs FAIL vs terminal distinguishable** | PASS and FAIL look the same, or terminal-done looks like executor-running | mostly distinct but one confusable pair (e.g. clean-pass vs caveated-pass, or done vs terminal) | clean-PASS (green ✓), caveated-pass (amber), FAIL (red ✕), and terminal all-PASS (no glow + ✓ DONE) are each unambiguous |
| **R4** | **Idiom consistency with the existing board** | new font/shape/hue foreign to the board; fail color ≠ `--err` | close but off (wrong hue family, glow on a non-`--live` element, or radius/label size drifted) | reuses `--err` for fail, `verdictHue`/role hues for done, the existing current-glow idiom, 8.5px mono labels; drawer bar and swimlane track agree; nothing re-invented |
| **R5** | **Contrast & non-regression of the happy path** | any meaningful label uses `--fg-faint` / fails AA; or the forward-happy bar changed from today | one label borderline AA, or minor happy-path drift | every label ≥ `--fg-meta` and clears WCAG AA on `--panel`; a no-fail forward board renders visually equivalent to today (pure addition) |

**Regression guard (pass/fail, NOT scored — must all pass):**
1. **A plan-review FAIL fixture must NOT light (glow/current) the executor pill.** Executor renders grey/not-reached; the active glow sits on PLANNER. *(This is the exact operator-caught bug — it is the primary gate.)*
2. A terminal all-PASS fixture shows no current-glow on any pill (not "executor running").
3. A no-failure forward fixture renders visually equivalent to the pre-change bar (additive only).
4. The container `aria-label` on the FAIL fixture does not contain "next: EXECUTOR" (or any downstream role announced as done/next).

---

## 9. Summary for the executor

Turn the stage bar from a role-presence progress bar into a **verdict-aware control-flow gauge**. Encode two facts per pill — *reached* and, for review roles, *verdict* — reusing `isFailClassVerdict` (bounce test) and `verdictHue` (tint), plus a generalized per-review-role latest-verdict lookup and an exported `WORK_PIPELINE_ROLES`. Resolve **exactly one** active glow via the §3 state machine: a fail-class review returns the glow to the prior WORK role (`↩ PLANNER` / `↩ EXECUTOR`), paints the failed review pill red `--err` + `✕`, drops a `◄` back-arrow in the gap, and forces every downstream role to grey not-reached — the executor pill must go dark. Clean PASS tints green + `✓`, caveated pass tints amber, terminal all-PASS kills the glow and shows a `✓ DONE` cap. Apply the identical logic to the swimlane track (`lib/lanes.ts` `currentStageIndex` / `components/LiveSwimlanes.tsx`) so the two stay consistent. All meaningful labels ≥ `--fg-meta` (not `--fg-faint`), legible at 390px, and a no-fail board looks as it does today.
