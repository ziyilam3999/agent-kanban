# 1435 — Execution review (role 4/4, execution-reviewer)

3ROLE_TASK:1435 ROLE:execution-review
Plan: `.ai-workspace/plans/2026-07-03-1435-board-freshness-watchdog.md`
Branch: `1435-board-freshness-watchdog` @ `8c4061df5602f35f6d8a09f022085c262fff890f`
Reviewer: adversarial, reproduce-from-source, both-ends, fail-closed bias. Every claim verified independently, not taken on faith.

## VERDICT: PASS

READY TO SHIP. All 11 binary AC reproduce from outside the diff. The both-ends proof is genuinely non-vacuous (independently broken → exactly the alerting-verdict tests go red). Fail-closed truth table matches the plan. Privacy gate clean. Typecheck + full suite green. R1 is correctly handled as the plan's OBS-D non-blocking carry-forward (watchdog works standalone; follow-up concretely specified).

---

## 1. Both-ends non-vacuity proof — REPRODUCED (not a tautology)

- Baseline: `npx jest __tests__/board-freshness-watchdog.test.ts` → **14 passed, 14 total**.
- Adversarial break: I no-op'd the fire path in `lib/board-freshness.ts:136` (`deps.notify(ALERT_TITLE, message);` → commented out) — an independent break of the alerting side effect, not a change to the test.
- Result: **EXACTLY 3 tests went RED**, all alerting-verdict cases:
  1. `RED-on-frozen: board older than N AND work within W ⇒ STALE-ACTIVE + notify fires`
  2. `fail-closed: board file missing/unreadable ⇒ UNKNOWN + notify fires (regardless of activity)`
  3. `fail-closed: board stale AND activity signal unreadable ⇒ UNKNOWN + notify fires`
- The non-alerting cases stayed GREEN throughout: PASS-on-fresh, both IDLE cases, fresh-short-circuits-unreadable-activity, kill-switch, `isAlertingVerdict`, purity/boundary. (11 passed / 3 failed.)
- Restored `lib/board-freshness.ts` via `git checkout --`; re-ran → **14 passed** again; `git status` clean.

This is the memory's demanded guarantee: the test goes RED on the frozen-board-while-active state and stays quiet on healthy/idle. A regressed-to-silent guard fails exactly these three cases and no others.

## 2. Fail-closed truth table (D5) — VERIFIED against `lib/board-freshness.ts`

`decideFreshness` order of checks matches the plan's table:
- kill-switch → `DISABLED` (quiet), wins over everything.
- `boardMtimeMs === null` (missing/unreadable) → `UNKNOWN` (alert), regardless of activity — a gone board.json is not rescued by fresh activity.
- board age ≤ N → `FRESH` (quiet), short-circuits before the activity read (so a fresh board + unreadable activity is quiet — nothing stale to alert about; matches table).
- board stale + `activityMtimeMs === null` (genuine read error) → `UNKNOWN` (alert, fail-closed).
- board stale + activity ≤ W → `STALE-ACTIVE` (alert) — the bug.
- board stale + activity > W (incl. `NEGATIVE_INFINITY` = no markers) → `IDLE` (quiet).
`isAlertingVerdict` = exactly `STALE-ACTIVE` ∪ `UNKNOWN`. Only genuinely-fresh and genuinely-idle stay silent; every can't-tell path alerts. Correct.

## 3. D1/D2/D3, kill-switch, Rule-16 — VERIFIED from source

- **D1** (`scripts/board-freshness-watchdog.ts:69-86, 232-240`): `readBoardMtimeMs` uses `fs.statSync(...).mtimeMs` (null on any error → fail-closed). `resolveInputs` MAX-folds the newest `sync.log` ts (`BOARD_WATCHDOG_FOLD_SYNCLOG`, default on) — **never** rescues a null board (a missing board stays fail-closed). Keeps it complementary to the #1405 counter, not double-alerting.
- **D2** (`:97-151`): newest mtime across BOTH `~/.claude/lane-heartbeats/*.beat` (#1317) AND nested `~/.claude/3role-ledger/<session>/*.jsonl` (#1305). ENOENT (missing dir) = "no activity yet" → `NEGATIVE_INFINITY` (idle); a real read error → `null` (fail-closed active). Courier-independent signals, exactly as designed.
- **D3** (`:212`, `lib/notify.ts`): live mode fires `runFreshnessCheck(input, { notify: defaultNotify })`. `defaultNotify` was cleanly extracted to the dependency-free `lib/notify.ts`; `scripts/upload-board.ts:35-36` imports AND re-exports it (courier still fires the same channel; no duplicate notifier). Message carries only result/reason tokens + a rounded age — no board content, path, or secret.
- **Kill-switch** (`:154-165`): watchdog-OWN switch — `BOARD_WATCHDOG_OFF` env OR `~/.claude/.kanban-watchdog-off` dotfile (override `BOARD_WATCHDOG_OFF_FILE`). Independent of the courier's disable path.
- **Rule 16**: every knob env-resolved with a default; the pure decision takes N/W as inputs (no threshold literal in the decision logic). Grep of `lib/board-freshness.ts` + `scripts/board-freshness-watchdog.ts` for `/Users/`, `/home/` → **no hardcoded home path**. The only numerics in the pure module are a `/1000` ms→s conversion for the display message (not a threshold) — decision comparisons use `input.staleMs` / `input.activeWindowMs`.

## 4. Privacy — CLEAN (exact CI grep, home-path redacted)

Reproduced the repo's exact `privacy` job (`.github/workflows/ci.yml:53-89`):
- `git grep -nIE '(/Users/|/home/|[A-Za-z]:[\\/]Users[\\/])[A-Za-z0-9._-]+/'` over tracked files (excluding `*.example`, `ci.yml`, `__tests__/*`) → **exit 1, 0 matches** (the pipe-to-`sed` exit trap avoided: measured git grep's own exit + counted lines).
- No tracked board snapshot; `data/board.sample.json` = 9 tickets (≤12 synthetic-sized guard passes).
- `scripts/board-watchdog.plist.template` carries only `__PLACEHOLDER__` tokens (installer substitutes real paths at install time) — no home path committed. Test fixtures use synthetic sandboxes (`fs.mkdtempSync`) + synthetic session `sess-synthetic`. PRIVACY_OK.

## 5. Typecheck + full suite — GREEN

- `npm run typecheck` (`tsc --noEmit`) → **exit 0**.
- `npm test` → **exit 0**, **265 passed, 265 total** (25 suites). The CLI/installer live cases are `darwinIt` (skip on CI's ubuntu/windows), so the 10 pure-decision cases carry the both-ends proof everywhere and the suite stays CI-green.

## 6. R1 (who-watches-the-watchdog) — ACCEPTABLE, does NOT gate PASS

The plan's OBS-D made healthmon Label registration a NON-BLOCKING carry-forward (no dedicated AC). Verified:
- **(a) Standalone works.** The watchdog imports nothing from healthmon; live prove-primary `npm run kanban:watchdog -- --check` in the worktree → printed `UNKNOWN`, exit 0 (correct: no `data/board.json` present → fail-closed). CLI + installer dry-run smokes + all tests pass with zero healthmon involvement. No hard dependency.
- **(b) Follow-up concretely specified.** Executor's R1 finding is accurate: `ai-brain/tools/launchd-health-check.sh:30-39` is an explicit STATIC `SPEC` heredoc (`read -r -d '' SPEC <<'EOF' … EOF`), NOT auto-discovery — so the watchdog is not covered for free and registration lives in a different repo. The printed follow-up row `com.user.kanban-board-watchdog|event|-|-|periodic board-freshness watchdog (#1435)` matches the SPEC's `Label|type|recency|max_age_h|desc` format and mirrors the existing `com.user.cc-mailbox-doorbell|event|-|-|…` precedent. Surfaced in the installer `--dry-run` note (`scripts/install-board-watchdog.sh:91-93`) AND the README (`README.md:137-149`) with the exact row + exact file. Minor (non-gating): `type=event` gives healthmon only a loaded?-check, not a fire-recency check for this StartInterval job — but that mirrors the existing cc-mailbox-doorbell classification, so it is a consistent best-effort choice, correct for an accepted carry-forward.

## 7. Installer safety (Rule 14) — VERIFIED

- `--dry-run`: renders the plist to a `mktemp` temp, `plutil -lint`s it, prints it, `rm`s only its own temp — **no `~/Library/LaunchAgents/` write, no `launchctl`**. Live smoke: plist count 0/0 and launchctl entries 0/0 before/after. Mutates nothing.
- `--uninstall` (`:57-68`): `launchctl bootout` then **`mv "$PLIST_PATH" "${PLIST_PATH}.removed-<ts>"`** — mv-aside, never `rm`. Rule 14 honored. (The only `rm` is on the installer's own `mktemp` scratch — permitted transient-scratch.)

## 8. Ledger hygiene (item 7) — noted, not a defect

`~/.claude/3role-ledger/ee426cae-…/1435.jsonl` currently shows a **single, well-composed executor line** (spawn-time `agentId` overlay-merged with the self-appended `artifact_path` + `commit` per #855) — no un-reconciled double executor line remains for the close-out `check` to fold. planner + plan-review lines carry `self_authored: true`. Nothing to fix.

## Scope

Diff = 10 files vs `origin/master` (matches the executor's claim exactly): NEW `lib/board-freshness.ts`, `lib/notify.ts`, `scripts/board-freshness-watchdog.ts`, `scripts/install-board-watchdog.sh`, `scripts/board-watchdog.plist.template`, `__tests__/board-freshness-watchdog.test.ts`; MOD `scripts/upload-board.ts` (re-export defaultNotify), `package.json` (`kanban:watchdog`), `README.md`; plus the committed plan. No surprise files.

## Defects

None gating. One non-gating observation (§6: healthmon `type=event` = loaded-only check for a StartInterval job) — consistent with the existing precedent and inside the plan's accepted OBS-D carry-forward.

cairn: exec-review non-vacuity proof — no-op'ing `runFreshnessCheck`'s injected notify turned EXACTLY the 3 alerting-verdict tests (STALE-ACTIVE + 2 fail-closed UNKNOWN) red while FRESH/IDLE/kill-switch/purity stayed green; a freshness watchdog's both-ends test is only trustworthy when breaking the fire path reddens precisely the alerting rows and nothing else.
