# 3278 — board-live details (#2) under the size cap, with headroom

cairn: "board-live" -> working-memory card workflow/session-state-20261009-3085-legs-launchd:42 (receipt tmp/cairn-3278.log) — the #3072 dashboard line: the board page reads the pinned issues through declared loaders, the push feed owns their bodies, and the lanes/execModel passthrough was verified in harness renders. Queries run: "board-live" (hit, that card; two older unrelated board-liveness cards also surfaced).
cairn-wiki: wiki tier off
data-class: public
size: M

Task: agent-kanban #3278 — size S, Cost focus. Planner role of the 4-role chain. Intent-level plan (WHAT + WHY + binary AC). Do NOT prescribe HOW beyond the named levers.

## ELI5

The live board is four pinned GitHub issues. One script ("the feed") builds all four bodies and — since #3272 — checks EVERY parcel's size before shipping ANY: one over-cap parcel and the whole delivery is refused. Parcel #2 (ticket details: each active ticket's description plus its step timeline) has grown to 70,416 characters, over the 60,000 postbox limit. So the mailman refuses everything: the merged #3272 summary fix never reaches the board, and issue #1 still shows the stale fixture focuses.

#3272 fixed this same disease in the summary parcel: it moved the ever-growing focus lists to their own parcel (#4) and added a size smoke with a built-in red control. This ticket does the equivalent for parcel #2, without a fifth parcel: make the details body small again WITH headroom — at most 50,000 characters on today's board — and keep it small as tickets pile up, by capping how much each ticket contributes (shorter description, fewer timeline steps) and how many tickets get a detail sheet at all (the live lanes plus the most-recently-touched active tickets; anything older falls back to the sheet's existing "no details" rendering, which the page already draws gracefully).

The dashboard actually reads only two fields per ticket from #2 — the description and the timeline (with seven step facts inside it) — plus the ticket-id keys. The body's one other field, top-level `generatedAt`, is read by nobody (proof below), so it can go. A size smoke proves the fix the same way #3272's did: on a fixture the size of today's board the OLD code must still refuse (red), the NEW code must fit (green), and a DOUBLED board must still fit — and no test ever touches the real board.

## Intent (WHAT / WHY — never HOW)

### The gap

- `scripts/board-live-push.mjs` builds `detailBody = { generatedAt, details }` for pinned issue #2: one entry per active work ticket (in-progress, in-review, blocked-todo) and per recent lane — `d` (description, scrubbed, today capped at 420 chars) and `tl` (a JSON-encoded string of up to 10 ledger rows per ticket). On today's data that body is 70,416 chars.
- #3272 F3 made the feed all-or-nothing: every body is size-checked (60,000) before the first upsert. So the over-cap #2 aborts the WHOLE push — nothing reaches the live board and #1 stays stale. This is the intended guard working as designed; the body must shrink, not the guard.

### What "under the cap WITH headroom" means here

- Target: **≤ 50,000 characters on today's shape** (today 70,416; hard cap 60,000) — at least 10,000 of headroom.
- It must stay under as tickets grow, by construction, not by a one-off trim. Two levers, both in the feed's details construction (the executor calibrates exact constants to the target):
  1. **Per-entry trim**: tighten the per-ticket description cap below today's 420 and the timeline row cap below today's 10 (keep the MOST RECENT rows — the sheet is a "what's happening now" surface).
  2. **Per-section row cap**: the body covers every recent lane plus at most a fixed number N of the most-recently-updated active tickets. Worst-case body size is then (laneCap + N) × the per-entry bound — a constant, independent of how many tickets exist. Tickets outside the cap are still listed in #1; their sheet falls back to the page's existing no-entry rendering (no description line, "No role steps recorded yet." — verified present in the page code), so nothing renders broken.
- The all-or-nothing pre-push size check, the #4-before-#1 push order, and the 60,000 guard stay exactly as #3272 left them.

### Fields the dashboard actually reads from #2 (listed from the loader code — ai-brain `tools/board/page/index.html`)

- `dash.loader('details')` (:466): requires the top-level `details` object; per entry reads `d` → `desc` and `tl` → `timeline`; declared columns `id`, `desc`, `timeline`.
- `openSheet` (:534–570): renders `d` as the description paragraph; parses `tl` and renders, per step: `r` (role), `v` (verdict), `t` (timestamp — ago + clock), `c` (closed → the running marker), `m` (model), `e` (effort), `a` (artifact basename). A missing entry degrades gracefully (no description line; "No role steps recorded yet.").
- **Unread, therefore droppable**: the top-level `generatedAt` on #2. Shown unread: the `details` loader requires only `v.details` and never touches `generatedAt`; the page's stale-body check (:887–892) compares #1's `generatedAt` against #4's, never #2's; and the render harness's fixture body for #2 (`tools/board/render-harness.mjs:61`) already omits it and renders fine. Every field the page DOES read stays in the body and keeps rendering.

### Size smoke (extends `__tests__/board-live-size-smoke-test.sh` with a details arm, or a sibling smoke following its pattern)

- A **today-shaped, fully synthesized fixture**: active rows carrying descriptions at today's cap and multi-row ledger timelines, sized so the pre-fix details body exceeds the cap. Nothing copied from real tickets, ledger rows or receipts (standing rule from the existing smoke's header).
- **RED control pinned to the pre-fix blob** `0555ad2:scripts/board-live-push.mjs` — never the moving master (#3272 F2 rule): on that fixture the old feed must abort the whole push on the pre-push size guard naming the details body, with the guard's own message carrying a byte count > 60,000. This reproduces today's live incident by code and simultaneously proves the all-or-nothing abort still fires for #2 (gh deliberately absent from PATH in that arm, so nothing can reach the network even if the guard were bypassed).
- **GREEN**: the fixed feed measures its #2 body through a no-network print (the same print-and-exit pattern #4 already has via `--focus-body`: no network, no state write) — ≤ 50,000 characters on the same fixture.
- **Growth arm**: the same fixture with the active rows doubled still measures ≤ 50,000 — proving the bound, not a lucky trim.
- **Refuse when target unset** (standing rule from #3272): with its target env (`BOARD_AI_BRAIN`) unset the smoke refuses with a clear message and a non-zero exit BEFORE any feed invocation — no network call. Any new env target the arm grows follows the same rule.
- **Never pushes during tests**: every feed invocation in the smoke is a no-network print or `--dry-run`; the one arm that crosses the size guard runs with gh absent from PATH and asserts the abort IS the size guard.

### Binary AC

1. **Under target with headroom**: the fixed feed's no-network print of the #2 body on the today-shaped fixture measures ≤ 50,000 bytes (`wc -c` on the printed body).
2. **RED on today's shape**: the pinned pre-fix blob `0555ad2` run on the same fixture (gh absent from PATH) exits non-zero with the pre-push size guard naming the details body and reporting a size > 60,000 — the smoke exits non-zero if this control fails.
3. **Growth bound**: on the doubled fixture the fixed feed's #2 body still measures ≤ 50,000 bytes.
4. **Fields kept**: on the GREEN body, every carried entry has `d` as a string and `tl` parsing as a JSON array whose steps keep `r`/`t`/`c`/`v`/`m`/`e`/`a` whenever the source row carries them; the body's top-level keys are exactly the loader's read set (`details` — the dropped `generatedAt` is shown unread in this plan).
5. **Smoke green, no regressions**: the extended size smoke exits 0 on the worktree, with every pre-existing #3272 arm unchanged and passing.
6. **Refuses when unset**: with `BOARD_AI_BRAIN` unset the smoke exits non-zero with a refusal message before any feed run (no network).
7. **Never pushes**: no smoke arm performs an upsert — all feed invocations are prints/`--dry-run`, and the guard-crossing arm aborts on the size check with gh absent from PATH.

## Critical files

- `scripts/board-live-push.mjs` — the details construction, its size levers, the #2 no-network print; the BODIES guard order untouched.
- `__tests__/board-live-size-smoke-test.sh` — the details arm (fixture synthesis, RED control, GREEN, growth, refuse-unset).
- Read-only truth: ai-brain `tools/board/page/index.html` (the `details` loader + `openSheet` field list), ai-brain `tools/board/render-harness.mjs` (fixture #2 shape; FEED-unset refusal pattern).

## Non-goals (in-scope exclusions)

- No fifth pinned issue and no change to the #1/#3/#4 bodies or their existing smoke arms' semantics.
- No live push, no launchd/watchdog changes, no edits to the live-writing checker (`tools/board/check-push.mjs`) — it is never run by tests.
- No dashboard-page changes required: the page already renders a missing entry gracefully; the ai-brain half of this surface is untouched.
- Shelf details (#3) stays as-is (under cap; different body).

## Deferred follow-ups

- A post-push #2 parity check in the live checker (deep-equal the live #2 body against the feed's print, as is done for #1/#4) — live-writing tooling, its own ticket.
- If detail coverage ever needs to widen, raise N deliberately and recalibrate the growth arm in the same change.

## Planner runs

DISPATCH-NONCE:OR-NONCE-863cc5e2786314a5
