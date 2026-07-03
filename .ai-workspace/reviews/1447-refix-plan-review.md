# Plan 1447 (CYCLE 2 — REFIX) — PLAN REVIEW (v2, re-review after Option-B revision)

`3ROLE_TASK:1447 ROLE:plan-review` · repo `agent-kanban` · session `ee426cae-9054-4680-91ab-5397aa6f573a`
Reviewer: adversarial plan-reviewer. Plan: `.ai-workspace/plans/2026-07-03-1447-drawer-scroll-refix.md`
(re-filed in place). Supersedes v1 (NEEDS-WORK). v1 raised 3 MAJOR + several minors; this v2 checks
whether the Option-B revision resolved them and whether the new single-variable framing is honest.

---

## Decision: PASS

All three v1 MAJOR findings are resolved, the operator settled D1/D2 as **Option B (keep the gesture,
ship `transform: translateZ(0)` ALONE)** — the single-variable path v1 asked the plan to surface — and
the revised honesty apparatus is now *exemplary* rather than merely adequate. Two MINOR items remain
(a stale AC cross-reference and one missing line in the operator's checklist); both are mechanical
fix-on-execution polish that do not require another review round. This ships.

---

## v1 MAJOR findings — resolution check

- **v1-1 (root cause over-attributed to `drag`) → RESOLVED.** §Root cause now opens: *"No single cause
  is CONFIRMED — there are two co-equal suspects… We do NOT assert 'the drag gesture is the primary
  cause' — that was an over-attribution in the earlier draft and is retracted"* (L29). It leads with
  the **compositing-layer-starvation** hypothesis — the exact mechanism v1 flagged: the KEPT entrance/
  exit spring runs `transform` on `.ak-drawer`, so the scroll ancestor owns a compositing context and
  can starve the inner body of its own iOS scroll layer; `translateZ(0)` on the body addresses this
  *independently of any gesture* (L31). Drag is held constant as a co-equal UNPROVEN suspect (L33).
  Confidence ordering is no longer inverted — it is retracted entirely. ✓
- **v1-2 (missed "translateZ-alone" option) → RESOLVED by operator decision.** The operator picked
  exactly that (OPERATOR FINAL DECISION banner, L5). This is now a clean single-variable experiment:
  if the one CSS line fixes iOS, the cause was compositing starvation and the drag config is
  exonerated; if not, cycle 3 removes drag with the hypothesis cleanly isolated (Appendix A). ✓
- **v1-3 (cairn amendment would codify an unproven mechanism) → RESOLVED.** §Post-close learning
  (L150-154) + Deferred-follow-up (L137) now make the amendment CONDITIONAL on AC14/CG5 with two
  explicit branches: PASS → amend with the confirmed cause + note drag EXONERATED; FAIL → do NOT amend
  with a false conclusion, record `translateZ` insufficient, keep the drag-suspect open, file cycle 3.
  The only unconditional lesson is the meta-lesson (chromium/jsdom is blind to this iOS failure). ✓
- **v1 minor (screenshot dangles at quarantine) → RESOLVED.** §D (L82) now writes to gitignored
  `test-results/…`, copies to the committed `.ai-workspace/reviews/1447-drawer-scrolled-bottom.png`,
  and adds `test-results/` to `.gitignore`; executor step 5 does the copy. ✓
- **v1 honesty caveat (RED evidence must carry the caveat adjacent) → RESOLVED.** Executor step 4
  (L161) + AC9 + CG2 require the "chromium cannot RED on translateZ absence" caveat pasted next to the
  RED demo. ✓

---

## Coordinator's four questions

### (a) Is the RED-demo reframe honest and correct — no false claim that chromium proves the iOS fix?
**Yes — and it is now the strongest part of the plan.** The old v1 RED demo ("add `drag` without
`dragListener=false` → e2e goes RED on the `touch-action:pan-x` stamp") is correctly recognized as
IMPOSSIBLE under Option B (drag is PRESENT in the shipped state — you cannot demo RED by "adding" what
is already there). The reframe is honest on both guards:
- **e2e RED** = strip `min-height:0` + `overflow-y:auto` → the body no longer overflows/scrolls → the
  scroll-advance / overflow assertions fail. This proves the e2e can DETECT a broken scroll recipe —
  and the plan does NOT claim it proves anything about `translateZ(0)`.
- **jest RED** = delete the `translateZ(0)` line → the recipe-present assertion fails. Honestly
  labeled a **structural** (source-present), not behavioral, guarantee.
- The **CRUCIAL HONEST CAVEAT** (L95) states plainly: *"there is NO chromium behavioral both-ends for
  the actual fix — the e2e … CANNOT distinguish 'translateZ present' from 'translateZ absent', because
  the failure it targets is iOS-only and chromium does not reproduce it … The ONLY oracle that can
  prove the fix actually WORKS is the operator's real iPhone."* This is sharper and more honest than
  v1: it confronts head-on that under a CSS-only single-variable change chromium is *structurally
  incapable* of a behavioral RED on the variable. No overclaim anywhere. ✓

### (b) Is the root-cause narrative no longer over-attributing to drag?
**Yes** — see v1-1 above. It explicitly retracts the over-attribution and leads with the
compositing-starvation hypothesis while holding drag constant as an unproven co-equal. ✓

### (c) Is the cairn-amendment conditioning correct?
**Yes** — see v1-3 above. Both result branches avoid baking an unconfirmed mechanism; the write is
gated on the real-device verdict. ✓

### (d) Any remaining hole given the fix is one CSS line verified only on the real device?
Two MINOR items (below). The core single-variable logic is sound: `translateZ(0)` is revertible in one
line, containing-block-safe (re-verified — the only positioned descendants of `.ak-drawer__body` are
`.ak-node` [relative] and `.ak-node__dot` / `.ak-node::before` [absolute, anchored to `.ak-node`
inside the body]; ZERO `position:fixed`/`sticky`, so the new containing block changes nothing), and the
failure path is well-managed (clean cycle-3 handoff via Appendix A). AC1 (`git diff Drawer.tsx` empty)
correctly guards the single-variable invariant; the jest test correctly stays SILENT on drag props
(asserting drag-absent would contradict Option B, drag-present would re-enshrine the false-green).

---

## Remaining findings (both MINOR — fix on execution, no re-review needed)

1. **[MINOR] Stale AC cross-reference in the CRUCIAL HONEST CAVEAT.** L95 cites *"the operator's real
   iPhone (AC13 / CG5)"* — but **AC13 is the privacy-grep gate**; the operator real-device oracle is
   **AC14**. Every other reference (Risk 1, CG5, Deferred, Post-close) correctly says AC14; this one is
   a stale post-renumber typo, and it sits in the single most load-bearing sentence of the plan.
   **Fix:** change "AC13 / CG5" → "AC14 / CG5" on L95.

2. **[MINOR] AC14 does not ask the operator to check `translateZ(0)`'s one known cosmetic side-effect.**
   `transform: translateZ(0)` promotes the body to its own GPU layer — a documented hack that can
   subtly BLUR text / soften rendering on a promoted layer at fractional/retina DPRs (exactly the
   operator's real iPhone). The plan claims the change is "zero visual change" (L116) and AC14 (L112)
   only asks the operator to confirm *scroll* + *dismiss*. Since the real device is the ONLY place this
   cosmetic risk can surface, and this fix is the thing that introduces it, the operator's check should
   include it. **Fix:** add to AC14 "…and confirm the ticket text/timeline still renders crisply (no
   blurriness) — `translateZ` can soften text on a promoted layer at some DPRs." (And soften the "zero
   visual change" wording in §UI-task-gate to "no *intended* visual change; verify no promoted-layer
   text softening on device.")

### Non-blocking nits (no action required)
- The hypothesis that the spring "holds a transform/compositing context for the life of the sheet"
  (L31) is itself unverified — Motion may set `transform:none` at rest. Fine: it is *labeled* a
  hypothesis under test, and `translateZ(0)` is the standard fix whether the ancestor owns the layer at
  rest or only during animation. No change needed.
- Appendix A (cycle-3) doesn't state whether to KEEP or DROP the `translateZ(0)` line when it later
  removes drag. Premature to resolve now — cycle 3 re-plans and re-reviews if AC14 fails.

---

## Explicit statement on the honesty framing

**The "chromium-green ≠ iOS-works" framing is now not merely adequate but exemplary, and it does NOT
paper over an unverifiable fix.** It (i) states outright there is NO chromium behavioral both-ends for
the actual fix; (ii) labels the jest guard structural-only; (iii) makes AC14/CG5 (operator real-device)
the non-skippable close gate — the gate cycle 1 skipped; (iv) requires the caveat be pasted adjacent to
the RED evidence so no future reader misreads "RED→GREEN" as fix-validation; and (v) conditions the
cairn learning on the real-device result so no unproven mechanism gets baked. Shipping a fix you cannot
reproduce locally is a *property of the environment* (no iOS engine here), and the plan routes around it
the correct way: the human is the oracle, and green automation is explicitly refused as "done." The
two MINOR items above are mechanical polish, not honesty gaps.

**Bottom line:** the single CSS line is safe (revertible, containing-block-verified), the diagnosis is
now honestly hedged, and the single-variable design turns even a FAILED real-device test into clean
diagnostic signal for cycle 3. Worth shipping to the operator's device.
