# Plan — #1505 `cardModel` non-in_progress branch: unfiltered badge attribution

- **Task:** agent-kanban ticket #1505 (BUG, Opus-tier — attribution-logic, not deep architecture)
- **Branch:** `1505-cardmodel-role-filter` (off `origin/master`, worktree `.claude/worktrees/1505-cardmodel-role-filter`)
- **Type:** data-attribution logic fix (which model-string a badge renders) — NOT a visual/layout change
- **Class:** recurrence of the #1481 wrong-actor attribution class (live-card badge showed a non-chain actor's model)
- `cairn:` matched T1 `2026-09-11 6bae4820…jsonl:100` — "A UI badge/pill that reads a 'blended' fallback verdict (e.g. `examVerdict ?? plan…`)" surfaces a verdict/attribute that does not belong to the row currently gating the column. Same class as the banked lesson `feedback_live_board_attribute_realtime_authoritative_not_backfill_default` ("the live-board badge must use the REAL-TIME authoritative attribute, not a backfill/absent default"). (No T3 stone matched "badge attribution" directly; nearest live-board attribution lessons are the T1/T2 hits above.)

---

## Execution model

**Subagent (executor seat, 3-role chain: planner → plan-review → executor → execution-review).**
Rationale: this is a delivered code change (production `lib/ui-meta.ts` + new tests in
`__tests__/ui-meta-model.test.ts`) with a RED-first oracle and a public-repo privacy gate — it must
flow through the standard delegated executor + execution-review pipeline, not be self-applied by the
planner. The change is small in LOC but crosses ≥2 files (production + test), carries a RED-on-prefix
proof obligation, and recurs a prior attribution-class defect (#1481) — squarely in DELEGATE
territory on the task-sizing ladder. A single executor bundle (N=1) suffices; no parallel dispatch.

---

## ELI5

Every card on the board shows a little badge saying which AI model did the work — like a name tag that says "this was built by Sonnet" or "reviewed by Opus." For a card that is **finished** (or waiting/queued), the code picks that name tag by grabbing the **most recent** comment on the card that mentions a model, **no matter who wrote it**.

Right now that is fine, because only the four "real chain" workers (planner, plan-review, executor, exec-review) ever leave a model-tagged comment. But a sister ticket (#1495) is about to let a **research helper** leave comments too. The moment that happens, a research helper (or a one-off Opus/Fable design spawn) could be the *most recent* commenter — and the card would proudly wear the **research helper's** name tag as if the helper had done the chain work. That is wrong and misleading: the badge is supposed to tell the operator which model did the *pipeline* work, not which model happened to touch the card last.

The `in_progress` (live) side of this same function was already taught this lesson in #1481 — it only ever trusts a real work-role. The finished side never got the same lesson. This fix teaches the finished side to **only trust the four chain roles** for its badge, and to honestly show **nothing** if the only model-tagged comment came from a non-chain helper.

---

## Intent (WHAT / WHY — never HOW)

**WHAT.** For a card that is **not** `in_progress` (i.e. `todo` / `in_review` / `done`), the model badge must attribute to a **pipeline/chain role's** model only. The four chain roles are exactly the existing `PIPELINE_ROLES` set: `planner`, `plan-review`, `executor`, `execution-review`. A model-tagged comment left by any **non-chain operational seat** — `research` (#1495/#1516), `ship-tail`, `orchestrator`, or any other free-form role — must **never** be selected as the card's badge model. When the only model-tagged comment(s) on such a card come from non-chain seats, the badge must render **nothing** (honest-unknown), never borrow the non-chain seat's model.

**WHY.**
- This is a recurrence of the **#1481** wrong-actor attribution class: a badge showing a model that a *different* actor than the one it claims to represent produced. #1481 fixed the `in_progress` branch; the non-`in_progress` branch of the same `cardModel` function still selects "newest model-bearing comment of **ANY** role" — unfiltered.
- **WHY NOW:** #1495 makes `research` a **recordable** role, so research-seat ledger rows will start to exist on real boards. Today the defect is latent only because no non-chain role emits a `modelVersion`. The moment #1495 lands, the unfiltered path can render a research seat's (or an up-tiered Opus/Fable design spawn's) model on a finished/queued card as if it were the card's chain-role model. The code defect exists **today** — it is not blocked by #1495; #1495 only removes the accident that currently hides it.
- The badge's entire purpose is to tell the operator **which model tier did the pipeline work**. Attributing a helper seat's tier to the chain silently corrupts that signal — the same failure mode as the banked live-board-attribution lesson: surface the *real, role-authoritative* attribute, never a "whoever touched it last" default.

**Scope guardrails (bug is narrow — keep the blast radius narrow):**
- The `in_progress` branch of `cardModel` is **already correct** (it filters on `WORK_PIPELINE_ROLES` and stops at the current actor — #1481). This fix must **not** change `in_progress` behavior. AC4 guards that.
- Only `cardModel`'s non-`in_progress` selection is in scope. `latestReviewVerdict`, `shippingAfterPass`, phase-line logic, and drawer per-role rendering are **out of scope**.
- The existing unit test titled *"done/in_review -> the newest model-bearing comment of ANY role"* uses `execution-review` (a chain role) as its newest commenter, so it stays green under this fix; its **title/intent wording** becomes stale ("ANY role" → "any chain role") — updating that wording is the executor's call and is not required by any AC, but the test must remain green.

---

### Binary AC

Every criterion below is checkable from **outside the diff** — a command's exit code, a file's presence, or a text search — never "read the implementation to judge intent." "Fix branch" = `1505-cardmodel-role-filter`; "master" = `origin/master`.

**AC1 — RED-first, then GREEN (research row on a finished card).**
A named unit test exists in `__tests__/ui-meta-model.test.ts` for a **non-`in_progress`** ticket (e.g. `done`) whose comments carry all four chain roles PLUS a `research`-role comment that is the **newest** model-bearing comment and carries a **distinct** model string (e.g. chain-role model `claude-opus-4-8`, research model a different value such as `claude-sonnet-5` or `claude-haiku-…`). The test asserts `cardModel(...)` returns the **chain-role** model and **not** the research model.
- **GREEN (fix branch):** `npx jest __tests__/ui-meta-model.test.ts` exits `0`.
- **RED-on-prefix:** the identical test, evaluated against **master's** `lib/ui-meta.ts` (production fix reverted, test present), **fails** (exit non-zero) because master returns the research model. The executor records the RED run's verbatim failing-assertion output in the PR body; plan-review / exec-review reproduce it by running the new test against master's `lib/ui-meta.ts`.

**AC2 — Anti-vacuity control (same fixture, research row removed).**
A sibling test uses the **same** finished-card fixture but with the `research` comment removed (four chain roles only) and asserts the badge equals the expected chain-role model. This test **passes on BOTH master and the fix branch** (exit `0` in each) — proving the discriminator between RED and GREEN is the **research row itself**, not an incidental fixture difference.

**AC3 — No unfiltered fall-through remains (structural text search).**
A wrapper-immune search over `lib/ui-meta.ts` proves the non-`in_progress` branch guards selection on chain-role membership. Concretely, running from the repo root:
`command grep -nE 'PIPELINE_ROLES' lib/ui-meta.ts` returns at least one match **inside the `cardModel` non-`in_progress` loop** (the role-membership guard), and there is **no** `if (c.modelVersion)`-style return in that branch that is reached without first testing role membership. Checkable as a text search on the file — no implementation reasoning required.

**AC4 — Both ends fixtured; `in_progress` unregressed.**
The test suite contains a fixture/test for **both** an `in_progress` card **and** a non-`in_progress` card exercising `cardModel`. The pre-existing `in_progress` selection tests (the #1481 tests already in `ui-meta-model.test.ts`) **pass on the fix branch** (exit `0`) — proving the fix is scoped to the non-`in_progress` branch and does not regress the already-correct live path.

**AC5 — Honest-unknown boundary (only a non-chain model-bearing comment).**
A test for a non-`in_progress` card whose **only** model-bearing comment is a non-chain role (e.g. a lone `research` comment, no chain-role model) asserts `cardModel(...)` is `undefined` (badge renders nothing) — proving the filter is **membership** ("is this a chain role?"), not merely "skip exactly one research row." Passes on the fix branch (exit `0`); this same test fails on master (master returns the research model), which further corroborates the RED-on-prefix in AC1.

**AC6 — Full suite + typecheck green (no collateral breakage).**
On the fix branch, the project's CI gate passes: `npm test` exits `0` (every pre-existing `ui-meta` / `card` test still green — including the *"…ANY role"* test whose newest commenter is a chain role) and the type/build gate the CI runs (`npx tsc --noEmit`, or `npm run build`) exits `0`. Verified via CI status on the PR.

**AC7 — Privacy (agent-kanban is PUBLIC; count must be 0).**
A wrapper-immune privacy scan over the diff, the PR body text, and the branch name finds **zero** home-directory paths, personal-email fragments, or employer tokens. Concretely: `git diff origin/master...HEAD | command grep -icE '<home-dir-path-pattern>|<email-user>|<email-domain>|<employer-token>'` returns `0`, the branch name `1505-cardmodel-role-filter` contains none of those fragments, and the PR body is scanned the same way. The plan file itself is scanned per `docs/privacy-scan-invocation-contract.md` (`bash scripts/privacy-scan.sh --working <plan-path>`, verdict line + positive control reported).

---

## UI-task gate applicability — **DOES NOT APPLY (data-only)**

This is a **data-attribution logic** change to a **pure function** (`cardModel` in `lib/ui-meta.ts`) that returns a model **string**. It changes *which* string the function selects in one edge case (a non-chain, e.g. `research`, comment being the newest model-bearing comment on a non-`in_progress` card). It introduces **no** new visual surface, **no** layout/CSS/markup change, and **no** change to how `Card.tsx` / `Drawer.tsx` render the badge — those call sites are untouched; only the returned value differs, and only in the presence of a non-chain model row (which does not exist on production boards until #1495 lands). Therefore the UI-task gate's visual legs (screenshot diff, responsive-overflow, axe/Lighthouse, vision-judge) **do not apply** — there is nothing visual to regress. The correct oracle is the unit-test suite (AC1–AC6), not a rendered screenshot. If the executor's scoping discovers an actual visual/markup change is required (it should not be), that is a scope surprise to raise with plan-review before proceeding, and the UI-gate legs would then attach.

---

## Critical files

| Path | Role in this fix |
|------|------------------|
| `lib/ui-meta.ts` | Contains `cardModel(ticket)` (≈L292). The non-`in_progress` branch (≈L305–311) is the unfiltered selector to fix. `PIPELINE_ROLES` (L25) is the existing canonical 4-chain-role set that defines "chain role"; `WORK_PIPELINE_ROLES` (L139) is the `in_progress` set (already correct — reference only). |
| `__tests__/ui-meta-model.test.ts` | Home of the RED-first + control + honest-unknown + both-ends tests (AC1, AC2, AC4, AC5). Already holds the `#1481` in_progress tests and the *"…ANY role"* test to keep green. |
| `lib/board-schema.ts` | `LedgerComment` (L32) — `role: string` (L34), `modelVersion?: string` (L55). Fixture/type reference; not modified. |
| `__tests__/card.test.ts` | Other `cardModel` consumer test — must stay green (AC6). |

---

## Deferred-follow-ups:

- **Stale test-title wording** — the pre-existing test *"done/in_review -> the newest model-bearing comment of ANY role"* keeps passing (its newest commenter is a chain role) but its wording no longer matches the tightened semantic. Renaming it to "…any CHAIN role" is a cosmetic wording touch the executor MAY fold into this PR; **not required by any AC**, so if not done here → **none** (no separate task; it is harmless and self-evident from the neighboring new tests).
- **#1495 (research becomes recordable)** — is the *trigger context*, not a dependency of this fix. This plan does not touch #1495 and files nothing against it; #1495 proceeds on its own board card. → tracked independently as #1495.
- **No other work is deferred** — the fix is complete and independently verifiable today via injected fixtures (AC1–AC6). Nothing load-bearing is being punted.

---

## Non-goals (in-scope exclusions — all accounted for above)

- **No** change to the `in_progress` branch of `cardModel` (already correct per #1481).
- **No** change to `latestReviewVerdict`, `shippingAfterPass`, `newestExecutionReviewVerdict`, phase-line, or drawer per-role model rendering.
- **No** dependency on #1495 landing — this fix is independently correct and testable today (fixtures inject a `research` row directly).
- **No** visual/UI change; **no** new role added to `PIPELINE_ROLES` (research deliberately stays out of the 4-role pipeline — see ui-meta.ts L46–48).
