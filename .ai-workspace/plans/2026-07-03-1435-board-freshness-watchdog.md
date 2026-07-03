# 1435 — Board-freshness watchdog (external, out-of-band, fail-closed)

cairn: T1 hit `~/.claude/cairn/t1-run-scratch/2026-07-02/ee426cae-…jsonl:259` — "A live-status board's staleness alarm must be an independent out-of-band age-watchdog…"; carried by memory `feedback_live_board_freshness_guard_must_be_external_watchdog_not_inprocess_failure_counter`. Queries run: "staleness" (hit), "watchdog" (hit — line 259 + travel-watchdog, unrelated), "board" (no on-point hit), "sync" (no on-point hit). project-index present (`.ai-workspace/PROJECT-INDEX.md`, 2026-06-27) — cites the sync/courier cluster (`scripts/upload-board.ts`, `lib/sync-log.ts`, `lib/active.ts`).

Task: agent-kanban #1435 — a root-cause BAKE. Planner role of a 4-role chain. Intent-level plan (WHAT + WHY + binary AC). Do NOT prescribe HOW.

## Execution model

**subagent (delegate).** Rationale: this is delegate-sized, above the trivial-skip threshold — it creates ~4 new files (a pure `lib/` decision module, a `scripts/` CLI wrapper, a `scripts/` launchd installer, a `__tests__/` both-ends test) plus edits to `README.md` and `package.json`, and it makes an architectural decision (which freshness + activity signals, the fail-closed truth table). It is a single coherent write surface with a stable brief and a real test oracle (the both-ends jest test), so it hands cleanly to ONE fresh executor subagent (knob-A = `delegate`, knob-B = `both`: the test oracle plus a stateless execution-reviewer, because part of the value — the launchd/osascript integration + the fail-closed judgment — is not fully test-checkable and wants an independent live prove-primary). Not `inline` (fully briefable, none of the four not-briefable criteria hold), not `parallel` (one disjoint surface, no benefit from splitting).

---

## ELI5

We have a live board on a website. A little robot ("the courier") copies the board to the website every time a card changes. We already have a smoke alarm — but it only rings when **the courier tries and fails**. It is deaf to the courier **never showing up at all**: if someone unplugs the courier (the hook is removed from settings), flips its OFF switch, or the team works a long stretch without touching a card, the courier never runs, so it never records a failure, so the alarm never counts to three, so it stays quiet — and the website quietly shows an old board while real work is happening.

The fix is a **second, independent alarm that lives OUTSIDE the courier**. It is a tiny timer (a macOS launchd job) that wakes up every few minutes and asks two simple questions:

1. **Is the board file old?** — look at how long ago `data/board.json` was last written.
2. **Is anyone actually working right now?** — look at how recently the 3-role ledger files and the per-tool heartbeat files were touched.

If the board is **old** AND **work is happening** → ring the alarm (the same macOS pop-up the courier already uses). If the board is **fresh** → stay quiet. If **nobody is working** → stay quiet (don't cry wolf during a real coffee break). And if it **can't tell** (board file missing, can't read a signal) → ring anyway, because "I can't tell" is not "everything's fine" (fail-closed).

Why this is the right shape: the old alarm watches the courier's *output*, so it can only see failures the courier bothered to write. A smoke alarm wired to the stove can't smell a fire that starts in the garage. This new alarm watches the *board's age against the clock, from the outside* — so it catches the whole "producer never ran" family the old counter is structurally blind to.

---

## Why (motivation + the exact gap)

`scripts/upload-board.ts` already carries an **in-process** staleness alarm — `consecutiveTrailingFailures()` + `shouldNotify()` + `defaultNotify()` (osascript), added as #1405 after the #1051 ~25-min silent outage. It fires when 3 trailing `data/sync.log` records are NOT-synced.

That alarm only covers **ran-and-FAILED**. It is structurally blind to **courier NEVER RAN** — verified against the real source:

- `scripts/on-task-change.sh` is a **PostToolUse** hook, matcher `TaskCreate|TaskUpdate` (README §"Live sync — opt-in PostToolUse hook"). It fires **only on task-change events**, re-exports `data/board.json`, then runs the courier which appends one `data/sync.log` record.
- Therefore all three "never ran" freezes write **ZERO** sync.log records → `consecutiveTrailingFailures()` never advances → no alert:
  1. **Hook unwired** from `~/.claude/settings.json` (its wiring is opt-in; a fresh clone / edited settings leaves it inert — confirmed in the script header comment).
  2. **Kill-switch present** (an autosync-off toggle — currently no such switch is wired in-repo; the point stands for any future disable path and for the watchdog's OWN kill-switch discipline).
  3. **Long silent executor leg** — a 3-role chain appends to `~/.claude/3role-ledger/<session>/<task>.jsonl` and bumps `~/.claude/lane-heartbeats/<session>.beat` on every tool call, but touches **no task file**, so `TaskCreate|TaskUpdate` never fires → no re-export → `data/board.json` mtime freezes while work is active. This is the freeze-while-active state the Vercel viewer actually sees.

Memory to bake: `feedback_live_board_freshness_guard_must_be_external_watchdog_not_inprocess_failure_counter` — *"an alarm that only advances when the thing it watches RUNS cannot detect that thing NOT running — freshness needs an age check against the clock from OUTSIDE the producer."* This plan is the ticketed prevention (#1435) that memory names.

---

## Design decisions (each justified)

### D1 — Freshness source: local `data/board.json` mtime (PRIMARY)

**Decision.** Read the local `data/board.json` file mtime and compare `now − mtime` against a configurable threshold N. No network, no Blob, no credential.

**Why.** `board.json` is the **head of the export→upload→Blob chain**: the courier can only upload what export produced, so if `board.json` is stale, everything downstream (the upload, the Blob, what the operator sees) is at best that stale. The **ran-and-failed** half (board fresh, upload failed) is ALREADY covered by the in-process counter — so this watchdog's specific job is the **never-exported** half, and `board.json` mtime is the *exact* signal for it (all three freezes stop the re-export, freezing this mtime).

**Alternatives weighed + rejected.**
- **Blob HEAD / remote Last-Modified** — truest "what the viewer sees," but it is a **network call + a metered Blob read + a credential dependency**, i.e. exactly the metered-platform cost trap #1138 warns against (`feedback_metered_platform_live_ui_needs_cost_budget_not_freshness_only`). An always-on timer hitting the Blob every few minutes is a standing cost. Rejected — the local mtime is a faithful, free proxy for the never-ran class.
- **Last `data/sync.log` record `ts`** — a fine *secondary*: it advances even when export fails (the hook writes an `export-failed` line without bumping `board.json`). Acceptable to MAX-FOLD it in as a defensive second freshness input, but `board.json` mtime is the artifact-truth primary. (Executor's choice whether to fold; the intent is "local, cheap, artifact-truth.")

### D2 — Active-work signal: 3-role-ledger + lane-heartbeat mtimes (reuse the board's own liveness inputs)

**Decision.** "Work is happening now" ⇔ the **max mtime** across BOTH `~/.claude/3role-ledger/<session>/*.jsonl` (the #1305 ledger-mtime liveness the board already uses) AND `~/.claude/lane-heartbeats/<session>.beat` (the #1317 generic per-tool heartbeat, touched on ANY tool activity in ANY repo) is within a configurable active-window W.

**Why.** This is the "don't cry wolf during genuine idle" guard the memory demands. Crucially, the **heartbeat marker is the discriminator for gap-3**: during a long silent executor leg the heartbeat IS being bumped (tools are running) even though `board.json` is NOT being re-exported — so `board stale + heartbeat fresh` is the precise fingerprint of the freeze-while-active state. Reusing the board's own inputs (same dirs, `LEDGER_DIR` / `HEARTBEAT_DIR` env from `scripts/export-board.ts`; the window concept from `lib/active.ts` `ACTIVE_WINDOW_MS = 8 min`) keeps the watchdog's notion of "live" consistent with what the board renders, and avoids inventing a parallel signal.

**Note.** The watchdog's active-window W is its OWN configurable knob (default aligned to, or a little above, the board's 8-min window) — not a hard reuse of the constant — so the two can be tuned independently.

### D3 — Alert channel: reuse the exported `defaultNotify` osascript path

**Decision.** Fire the alert through the SAME out-of-band channel the courier already uses — `defaultNotify(title, message)` (macOS `osascript display notification`), already exported from `scripts/upload-board.ts`. Injectable in the pure decision for tests.

**Why.** The hook wrapper discards the courier's stdio (`… >/dev/null 2>&1`), and a launchd job's stdio goes to a log file no human watches — so a console line / log record is structurally silent. The osascript notification is the one channel proven (in #1051/#1405) to reach the operator regardless. Reuse, don't reinvent (message carries only result/reason tokens — never board content, a path, or a secret).

### D4 — Scheduler + cadence: launchd LaunchAgent, periodic `StartInterval`, OPT-IN install

**Decision.** A macOS **launchd** LaunchAgent runs the watchdog on a **periodic `StartInterval`** (seconds) of a few minutes (`<<` N). It is **independent of the courier** (separate process, its own schedule). Installation is an **installer script + a README opt-in story**, mirroring `on-task-change.sh`'s "not auto-installed" wiring — NOT silently made live.

schedule-source: verified from plist — periodic `StartInterval` (integer seconds) is an **ESTABLISHED house pattern**, NOT a novel divergence: `~/Library/LaunchAgents/com.user.cc-mailbox-doorbell.plist` uses `StartInterval=60` (a periodic `com.user` job — the direct precedent for this watchdog's every-few-minutes cadence). The daily house jobs use the *other* launchd key, `StartCalendarInterval` (`com.user.housekeep.plist` Hour=5 Minute=0; `com.user.working-memory-content-sync.plist` Hour=4 Minute=30; `com.user.cairn-h4.plist` Hour=1 Minute=0; `com.user.launchd-healthmon.plist` Hour=6 Minute=30), and `com.user.travel-watchdog.plist` is a long-running daemon (`KeepAlive`+`RunAtLoad`). So the watchdog reuses the exact **cc-mailbox-doorbell** precedent — same LaunchAgent mechanism, ProgramArguments/EnvironmentVariables/StandardOutPath shape, and `~/Library/LaunchAgents/com.user.<name>.plist` naming — just a larger interval (a few minutes `<<` N vs its 60 s).

**Why.** launchd LaunchAgents with `StartInterval` for periodic sub-hourly jobs are the established house mechanism (cc-mailbox-doorbell, verified above). `StartInterval` `<<` N so a freeze is caught within one N-window. The opt-in story matches the repo's existing sync-wiring convention and respects `feedback_ai_brain_hook_ship_is_not_live_until_setup_sh` — the plan states that "installed & loaded" is an explicit operator/installer step, verified by a smoke, NOT assumed live by merging the diff.

**Debounce.** Alert **once per staleness episode**, not every scheduler tick — a small last-alert state marker (mirrors `shouldNotify`'s "loud enough / debounced enough" intent) so a multi-tick outage isn't spammed. Re-arm when the board goes fresh again.

### D5 — Fail-closed decision (can't-tell ⇒ alert)

**Decision — the decision truth table:**

| board.json age | activity age | verdict | notify? |
|---|---|---|---|
| ≤ N (fresh) | any | `FRESH` | no |
| > N (stale) | ≤ W (active) | `STALE-ACTIVE` | **yes** |
| > N (stale) | > W (idle) | `IDLE` | no |
| unreadable/missing | any | `UNKNOWN` | **yes (fail-closed)** |
| readable | activity unreadable | treat as active → `STALE-ACTIVE`/`UNKNOWN` | **yes (fail-closed)** |
| kill-switch on | any | `DISABLED` | no |

**Why.** The memory is explicit: *"It must be FAIL-CLOSED (can't-tell ⇒ alert, not silent)."* Only two states stay silent: genuinely fresh, or genuinely idle. Every "I can't determine freshness/activity" path errs toward alerting.

### D6 — Configurability (Rule 16 — nothing hardcoded)

Every knob is env/config, no hardcoded home path or magic number:
- **Staleness threshold N** — env override (e.g. `BOARD_STALE_THRESHOLD_MS`), sane default (~10 min — comfortably above the observed active-work upload cadence of ~15–75 s/record in `data/sync.log`, so only a genuine freeze fires).
- **Active-window W** — env override, default aligned to the board's 8-min window.
- **Scheduler interval** — a value the installer templates into the plist (default a few min).
- **Freshness file path** — reuse the board `OUT` path convention.
- **Ledger + heartbeat dirs** — reuse `LEDGER_DIR` / `HEARTBEAT_DIR` env from `export-board.ts`.
- **Kill-switch** — a watchdog-OWN switch: a file (e.g. `~/.claude/.kanban-watchdog-off`) AND/OR env (`BOARD_WATCHDOG_OFF=1`). (Do NOT reuse the courier's disable path — an independent alarm needs its own independent OFF.)
- **Notify toggle / channel** — injectable (default `defaultNotify`), overridable for dry-run/CI.

### D7 — Independence proof: zero network / credential / Blob in the watchdog path

**Decision.** The watchdog path imports NO Blob SDK, NO `blob-auth`, makes NO `fetch`/`put`/network call. It only stats local files + fires osascript. This is what makes it a genuinely **independent** watchdog (not another courier code path that shares the same failure modes) AND metered-cost-free (#1138).

---

## Shape (intent, not prescription)

- A **pure, injectable decision function** (in `lib/`, sibling to `active.ts` / `sync-log.ts`) that takes injected `now`, the board mtime (or a reader), the activity mtimes (or a reader), the thresholds, and an injected `notify`, and returns a verdict token from D5's table (and fires `notify` on the alerting verdicts). Purity is what makes the both-ends test hermetic — no real clock, no real launchd, no real notification — mirroring the existing injectable `uploadBoard` / `sync-failure-alert` pattern.
- A thin **CLI wrapper** (`scripts/`, tsx, `kanban:watchdog` package script) that wires real file reads + real `defaultNotify` into the pure function; supports a **`--check`/dry-run** mode that prints the verdict token to stdout and exits 0 WITHOUT firing a real notification (this is the outside-the-diff observability handle).
- An **installer script** (`scripts/`, mirrors the launchd install pattern) that generates + loads the LaunchAgent plist; supports **`--dry-run`** to print a `plutil`-valid plist + its Label without mutating `~/Library/LaunchAgents/` or launchd.
- A **README opt-in section** mirroring the on-task-change.sh wiring story (install command, kill-switch, config env vars, "not auto-live" caveat).

Executor picks exact filenames, the mtime-fold details, and the debounce-marker mechanics.

---

### Binary AC

All checkable from OUTSIDE the diff (exit codes, file presence, stdout tokens, a test that goes red on the frozen state). No AC requires reading the implementation.

1. **Typecheck clean.** `npm run typecheck` exits 0.
2. **Full suite green.** `npm test` exits 0.
3. **Both-ends test exists and passes (the core AC).** A NEW jest test file exists and `npx jest <that-file>` exits 0. It contains, as distinct named cases, BOTH:
   - **RED-on-frozen:** given board.json mtime **older than N** AND a ledger/heartbeat mtime **within W**, the decision returns the alerting verdict (`STALE-ACTIVE`) AND the injected notify spy is called. (If the impl regressed to silent on this fixture, this case fails — that is the "goes RED on the frozen-board state" guarantee.)
   - **PASS-on-fresh:** given board.json mtime **within N**, the decision returns `FRESH` AND the injected notify spy is NOT called.
   Verifiable by grepping the test file for both case names + running it green.
4. **Idle does not cry wolf.** The same test asserts: board stale + NO activity within W ⇒ verdict `IDLE` ⇒ notify NOT called.
5. **Fail-closed proven.** The test asserts: board.json missing/unreadable ⇒ alerting verdict + notify called; activity signal unreadable ⇒ alerting verdict + notify called.
6. **Kill-switch honored.** The test asserts: with the kill-switch set, verdict `DISABLED` + notify NOT called, regardless of board/activity state. And the CLI `--check` with the kill-switch env set prints a disabled token and exits 0.
7. **CLI dry-run is observable.** The watchdog CLI exists + is executable; `<cli> --check` pointed (via env) at a synthetic **fresh** board prints `FRESH` and exits 0 without firing a notification; pointed at a synthetic **frozen** state (old board mtime + fresh activity mtime) prints `STALE-ACTIVE` and exits 0 without firing a notification.
8. **Installer dry-run emits a valid plist without mutating launchd.** `<installer> --dry-run` prints a plist that `plutil -lint` accepts (exit 0), whose `Label` and `ProgramArguments` reference the watchdog; `~/Library/LaunchAgents/` and `launchctl list` are unchanged after the dry-run (grep-absent before/after).
9. **Independence proof (no network/credential/Blob).** Grep of the watchdog source (pure module + CLI) finds NO `@vercel/blob`, NO `blob-auth`, NO `fetch(`, NO `put(` — the watchdog touches only local fs + osascript.
10. **Configurability (Rule 16).** Grep of the watchdog source shows each knob resolved from env/config (threshold N, active-window W, board path, ledger dir, heartbeat dir, kill-switch) — no hardcoded home path (`/Users/…`) and no hardcoded magic threshold literal in the decision path.
11. **package.json + README wired.** `package.json` gains a `kanban:watchdog` script (grep); `README.md` gains a "board freshness watchdog" opt-in section documenting the install command, kill-switch, and config env vars (grep the header).

---

## Critical files

**Read before implementing (premises verified against these):**
- `scripts/upload-board.ts` — the in-process counter (`consecutiveTrailingFailures` / `shouldNotify` / `defaultNotify`, lines 61–124); `defaultNotify` is the reusable exported osascript channel (D3).
- `scripts/on-task-change.sh` — proves the courier fires ONLY on `TaskCreate|TaskUpdate` (the never-ran gap).
- `lib/sync-log.ts` — sync-log shape + `SYNC_LOG` env (the optional secondary freshness input, D1).
- `lib/active.ts` — `ACTIVE_WINDOW_MS = 8 min`, ledger-mtime liveness (D2 window + signal to reuse).
- `scripts/export-board.ts` (header + `ledgerMtimeByTaskId`, lines 26–140) — `LEDGER_DIR` / `HEARTBEAT_DIR` env + the #1305/#1317 mtime signals the watchdog reuses (D2/D6).
- `__tests__/sync-failure-alert.test.ts`, `__tests__/upload-board.test.ts` — the injectable-`notify` + hermetic-mtime test pattern to mirror (AC-3).
- `~/Library/LaunchAgents/com.user.working-memory-content-sync.plist` (or `com.user.housekeep.plist`) — a LaunchAgent plist shape to mirror (D4); note the watchdog uses `StartInterval`, not the daily `StartCalendarInterval` those use.

**New (created by executor — names are the executor's call):**
- `lib/<freshness-decision>.ts` — the pure decision function.
- `scripts/<board-freshness-watchdog>.ts` — the CLI wrapper (`kanban:watchdog`, `--check`).
- `scripts/<install-watchdog>.sh` — the launchd installer (`--dry-run`).
- `__tests__/<freshness-watchdog>.test.ts` — the both-ends + fail-closed + kill-switch test.
- `README.md` (edit) + `package.json` (edit) — opt-in section + script.

---

## Out of scope (named so the reviewer doesn't expand it)

- **Auto-installing / loading the LaunchAgent as part of merge.** Install is opt-in (D4); the diff ships the installer + docs, not a live launchd job.
- **The deeper "re-export on ledger/heartbeat writes too" fix for gap-3.** That would make the board itself refresh during silent legs; it is a *different* ticket. #1435 is the watchdog that ALERTS on the freeze, not the re-export that prevents it.
- **Cross-platform (Linux cron) install.** The alert channel + scheduler here are macOS (osascript + launchd), matching the operator machine.
- **Removing or changing the in-process #1405 counter.** It stays — it covers ran-and-failed; the watchdog covers never-ran. Complementary, not a replacement.

---

## Named residuals (accepted, NOT closed by #1435 — so coverage isn't overstated)

**R1 — Who watches the watchdog (the recursion).** The watchdog is itself a launchd job. If it is never installed, unloaded, or crashes, it silently RE-OPENS the exact "producer never ran" blind spot #1435 closes — a dead watchdog cannot report its own death. Named mitigation that ALREADY exists (verified from plist): `com.user.launchd-healthmon` (`~/Library/LaunchAgents/com.user.launchd-healthmon.plist`, `StartCalendarInterval` Hour=6 Minute=30, runs `ai-brain/tools/launchd-healthmon-report.sh`) — the daily launchd health report is the natural second-order guard that surfaces a LaunchAgent that is expected-but-not-loaded. **#1435 does NOT take a hard dependency on healthmon** — the watchdog ships and works standalone; it NOTES healthmon as the already-present daily backstop. To make that backstop real, the installer should ensure the watchdog's `Label` is visible to healthmon's watched-set (or the plan flags "register the watchdog Label with launchd-healthmon" as a wiring step — the executor verifies healthmon's watched-set mechanism). The recursion is bounded because healthmon fires on a *daily calendar* schedule (a different failure mode than a per-minute interval job), so "both die silently at the same time" is the accepted tail, not a same-cause single point.

**R2 — Pure-inline never-ran coverage is CONTINGENT on the #1317 heartbeat hook being live.** The motivating **gap-3 live 3-role-chain case is ROBUST**: a chain's ledger self-append (`3role-ledger.mjs append`) is independent of any hook, so `~/.claude/3role-ledger/<session>/*.jsonl` mtimes advance during a silent executor leg regardless of hook wiring — the watchdog reliably sees `board-stale + ledger-fresh` and alerts. BUT for **pure-inline (non-3-role) work**, the only active-work signal is the #1317 `lane-heartbeat` marker, which is bumped by a *separate global PostToolUse hook*. If that heartbeat hook is itself unwired/down, pure-inline work produces no ledger append AND no heartbeat bump → the watchdog reads `board-stale + no-activity` → verdict `IDLE` → silent. **This is a silent miss, accepted as a NAMED residual and NOT closed by #1435** — closing it would require the watchdog to independently prove "a Claude session is live" without leaning on the same heartbeat hook, which is out of scope. Coverage claim, stated precisely: #1435 fully covers the never-ran freeze for **3-role chains** (the motivating case) and for inline work **while the #1317 heartbeat hook is live**; it does NOT cover pure-inline work with the heartbeat hook down.

## Deferred-follow-ups:

- **Auto-install/load the LaunchAgent at merge** — DEFERRED by design (opt-in wiring per D4, mirrors on-task-change.sh). → file-when-triggered: if the operator wants it auto-live, file a follow-up to add it to the repo's setup wiring.
- **Re-export on ledger/heartbeat writes (the deeper gap-3 prevention)** — DEFERRED; a different ticket than the watchdog. → file a task if gap-3 alerts fire often enough to warrant preventing the freeze rather than alerting on it.
- **Cross-platform install (Linux cron + notify-send)** — DEFERRED; macOS-only for the operator machine. → file-when-triggered: only if the board is ever run on a non-macOS host.
- **Removing/changing the in-process #1405 counter** — intentionally NOT deferred work; it stays as-is (complementary). No task needed.
- **R1 (who-watches-the-watchdog) and R2 (heartbeat-contingent inline coverage)** — accepted NAMED residuals (see `## Named residuals`), NOT deferred implementation work. R1's healthmon registration ships inside this diff (installer step); R2 is an accepted-not-closed gap. → none to file now; if R2 ever bites (a real pure-inline freeze slips through), file a task to give the watchdog a hook-independent "session is live" signal.

---

## Revisions

- **r2 (2026-07-03, post plan-review NEEDS-WORK → three surgical edits, no redesign).** The external out-of-band age-watchdog shape was confirmed correct against real source; only these three loci changed:
  - **DEF-1** — D4 `schedule-source:` corrected: the prior "None currently use `StartInterval`" claim was verified FALSE. Re-read `~/Library/LaunchAgents/com.user.cc-mailbox-doorbell.plist` → `StartInterval=60`. `StartInterval` is now framed as an ESTABLISHED house pattern the watchdog REUSES (the daily jobs use the other key, `StartCalendarInterval`), which strengthens D4.
  - **DEF-2** — added residual **R1 (who watches the watchdog)**: a dead/unloaded watchdog silently re-opens the exact blind spot #1435 closes; cites the existing `com.user.launchd-healthmon` (daily Hour=6 Min=30, verified from plist) as the already-present backstop. #1435 NOTES it and has the installer register the watchdog Label with healthmon's watched-set — it does NOT hard-depend on it.
  - **DEF-3** — added residual **R2 (pure-inline coverage is contingent on the #1317 heartbeat hook)**: the motivating gap-3 live-3-role-chain case is robust (ledger self-append is hook-independent); pure-inline work with the heartbeat hook down is a NAMED silent miss, accepted, not closed — so coverage isn't overstated.

## Review

**plan-reviewer verdict (round 2, 2026-07-03): PASS** — see `.ai-workspace/reviews/1435-plan-review.md`.

Launchd claims below verified from plist (Read directly):
schedule-source: ~/Library/LaunchAgents/com.user.cc-mailbox-doorbell.plist (StartInterval=60 — periodic)
schedule-source: ~/Library/LaunchAgents/com.user.launchd-healthmon.plist (StartCalendarInterval Hour=6 Minute=30 — daily)

Round 2 re-review: the planner applied all three round-1 fixes in place, no redesign, no regression. Core (D1–D3/D5–D7, both-ends AC-3, fail-closed truth table, all 11 AC) is byte-identical.
- **DEF-1 FIXED** — D4 now frames periodic `StartInterval` as an ESTABLISHED house pattern citing `com.user.cc-mailbox-doorbell.plist` `StartInterval=60` (daily jobs use `StartCalendarInterval`); the verified-false "None currently use StartInterval" survives only as an attributed corrected-quote, not a live assertion.
- **DEF-2 FIXED** — new residual R1 names the dead/unloaded-watchdog recursion, cites existing `com.user.launchd-healthmon` (daily Hour=6 Min=30) as backstop, takes NO hard dependency, and bounds the recursion.
- **DEF-3 FIXED** — new residual R2 names pure-inline coverage as contingent on the #1317 heartbeat hook; gap-3 live-chain stays robust via hook-independent ledger self-append; pure-inline-with-heartbeat-down is an accepted, NOT-closed named silent miss. Coverage no longer overstated.

Non-blocking carry-forward (executor/exec-review, not gating): OBS-D — R1's healthmon `Label` registration ships in-diff but has no dedicated AC (AC-8 covers only the dry-run plist); acceptable since #1435 doesn't hard-depend on healthmon and the executor verifies the watched-set mechanism first.

cairn: plan-review round-2 PASS — external out-of-band age-watchdog, fail-closed, courier-independent activity signal, all three never-ran modes closed, coverage stated precisely; ship to executor.

**Round-1 verdict was NEEDS-WORK (DEF-1/DEF-2 BLOCKING, DEF-3 NAME-IT) — all resolved above.**

---

**execution-review verdict (role 4/4, 2026-07-03): PASS** — see `.ai-workspace/reviews/1435-exec-review.md`.

Reproduced from source, adversarial: both-ends non-vacuity PROVEN (no-op'ing the injected notify in `runFreshnessCheck` turned EXACTLY the 3 alerting-verdict tests red — STALE-ACTIVE + 2 fail-closed UNKNOWN — while FRESH/IDLE/kill-switch/purity stayed green; restored → 14 pass). Typecheck exit 0, `npm test` 265 pass exit 0. Privacy gate clean (exact CI grep, git-grep exit 1 / 0 matches). D1 (board.json mtime + sync.log MAX-fold, never rescues a null board), D2 (courier-independent ledger+heartbeat mtimes, ENOENT=idle / read-error=fail-closed), D3 (defaultNotify reused via lib/notify.ts, courier re-exports it), kill-switch (own env+dotfile), and Rule-16 env config all verified. Installer `--dry-run` mutates nothing (0/0 launchd before/after); `--uninstall` uses mv-not-rm (Rule 14). R1 handled per OBS-D: watchdog works standalone (live `--check` → UNKNOWN exit 0, no healthmon dep); the residual is concretely specified — healthmon's SPEC is a static heredoc in `ai-brain/tools/launchd-health-check.sh`, exact row `com.user.kanban-board-watchdog|event|-|-|periodic board-freshness watchdog (#1435)` surfaced in installer note + README. Ledger shows a single well-composed executor line (spawn agentId overlay-merged with self-append). No gating defects. READY TO SHIP.
