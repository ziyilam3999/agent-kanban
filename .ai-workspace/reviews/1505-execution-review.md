# Execution Review — #1505 `cardModel` non-in_progress badge attribution (PR #85)

Decision: PASS

- **Role:** execution-review (STATELESS, last line of defense before ship). I did NOT author this code or plan.
- **PR:** #85 — head `1505-cardmodel-role-filter` @ `44c483f`, base `master`, NOT merged.
- **Plan:** `.ai-workspace/plans/2026-09-17-1505-cardmodel-unfiltered-attribution.md` (plan-review PASS at its `## Review`).
- **cairn:** `node skills/cairn/bin/cairn-find.mjs "attribution"` → matched the live-board attribution class (T1 `2026-09-11 6bae4820…jsonl` "blended fallback verdict"; banked `feedback_live_board_attribute_realtime_authoritative_not_backfill_default`) — the same class the plan invokes. No T3 stone contradicts the fix.

## Named-risk note disposition (receiving-end duty, #2434)

`node hooks/named-risk-notes.mjs list --task 1505` printed exactly one carried note:

DISPOSITION 1505-nonprog-filter-must-be-whitelist-not-research-blacklist observed-in-diff

Decidable ONLY by reading the diff, and I read it. The non-`in_progress` guard in `lib/ui-meta.ts`
(PR head) is:

```
const PIPELINE_ROLE_SET = new Set<string>(PIPELINE_ROLES);   // L150
...
if (PIPELINE_ROLE_SET.has(c.role) && c.modelVersion) {       // L333 (non-in_progress loop)
  return { version: c.modelVersion, effort: c.effort };
}
```

`PIPELINE_ROLES` (L25–30) is EXACTLY the four chain roles
`["planner","plan-review","executor","execution-review"]`; `research`, `ship-tail`, and
`orchestrator` are deliberately NOT members (L41–48 comments confirm). This is a genuine
`PIPELINE_ROLES` MEMBERSHIP WHITELIST — accepts a comment's model ONLY when the role is one of the
four chain roles. It is NOT a `role === "research"` blacklist; a ship-tail / orchestrator / any
future non-chain seat's model cannot leak. The named risk is addressed at the source. Mechanical
check `node hooks/named-risk-disposition-check.mjs --task 1505` is expected to pass against this
artifact.

## AC re-verification (measured myself, not trusted from the handback)

- **AC1 (RED→GREEN, research row on finished card):** GREEN on fix branch (test passes). RED-on-prefix
  PROVEN BY EXECUTION — I reverted `lib/ui-meta.ts` to `origin/master` (kept the new test) and ran the
  `#1505` tests: AC1 FAILED with `- "claude-opus-4-8"` / `+ "claude-haiku-4"` (master returns the
  research model). Discriminates.
- **AC2 (anti-vacuity control):** PASSED on BOTH master and fix branch during the RED run (1 passed,
  2 failed) — confirms the `research` row itself is the RED/GREEN discriminator, not an incidental
  fixture difference.
- **AC5 (honest-unknown boundary, lone research row):** GREEN on fix branch (`undefined`); RED on
  master (returned `{version:"claude-haiku-4"}`). Proves the filter is MEMBERSHIP, not "skip one
  research row."
- **AC3 (no unfiltered fall-through):** `command grep -nE 'if \(c\.modelVersion\)' lib/ui-meta.ts` on
  the fix branch → NO match; the only guarded return is `PIPELINE_ROLE_SET.has(c.role) && c.modelVersion`.
- **AC4 (`in_progress` unregressed):** pre-existing #1481 T2a/T2b in_progress tests pass on fix branch.
- **AC6 (full suite + typecheck):** `npx jest __tests__/ui-meta-model.test.ts` → 14/14. Full `npx jest`
  → 51/51 suites, 515/515 tests. `npx tsc --noEmit` → exit 0. PR #85 CI: build, privacy,
  fold-front-screen-overflow-guard, Vercel all pass.
- **AC7 (privacy, PUBLIC repo, count = 0):** wrapper-immune `command grep -icE` over
  diff + branch name + PR body + plan file (53,981 bytes) → **0**. Positive control (seeded
  `<home-dir-path-pattern>` + `<email-user>@<email-domain>` needle) → 2, proving the grep has power
  against the personal-identifier match class. `scripts/privacy-scan.sh` does not exist in this repo (lives in
  ai-brain, per plan-review's non-blocking note); satisfied via the self-contained inline form the AC
  itself specifies. Documented-scan fragments placeholdered as `<home-dir-path-pattern>` /
  `<email-user>` / `<email-domain>` per the invocation contract.

## Monotonicity (#1590)

The change is a pure NARROWING of the non-`in_progress` selector: `any-role model-bearing` →
`chain-role-membership model-bearing`. Case analysis over the newest→oldest scan:
- newest model-bearing comment is a chain role → old and new return the identical value (unchanged);
- newest is non-chain, an older chain-role model exists → old returned the WRONG non-chain model, new
  returns the correct newest chain model (wrong attribution removed);
- only non-chain model comments exist → old returned the WRONG non-chain model, new returns `undefined`
  (honest-unknown).
The stronger claim (chain membership required) NEVER erases a correct chain-model attribution — a
chain-role comment still qualifies unchanged. No clear-list / last-writer-wins / mutual-exclusion arm
is weakened. Monotone tightening confirmed.

## UI-task gate — data-only N/A upheld

The PR diff touches exactly three paths: the plan doc, `__tests__/ui-meta-model.test.ts`, and
`lib/ui-meta.ts`. `cardModel` is a pure function returning a model string; no `Card.tsx` / `Drawer.tsx`
/ CSS / markup / interaction surface is touched. The `metadata.interaction_test_na` (data-only) judgment
is sound — the correct oracle is the unit suite, not a rendered screenshot.

## Verdict

Every Binary AC (AC1–AC7) verified against the actual diff/PR by re-running the tests and scans myself,
not by trusting the executor's handback. The carried named-risk (whitelist-not-blacklist) is confirmed
addressed at source. The change is a correct, monotone narrowing with zero collateral breakage.

Decision: PASS
