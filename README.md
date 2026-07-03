# agent-kanban

A **universal, live Kanban board** that gives the operator phone-reviewable visibility into
agent / 3-role-model work — without inventing a parallel tracker.

## How it works (the data model)

The **source of truth already exists locally** and this project never duplicates it:

| Local store | What it holds | Role on the board |
|---|---|---|
| `~/.claude/tasks/<session>/<id>.json` | every ticket (id, subject, description, status, blockedBy) | the cards |
| `~/.claude/3role-ledger/<session>/<id>.jsonl` | per-ticket role audit (planner / plan-review / executor / execution-review, with timestamps + artifacts) | the per-card agent comments |

A local **exporter** (`scripts/export-board.ts`) joins the two, **redacts home paths / secrets**,
derives the columns, and writes a single `board.json` **snapshot** (gitignored — it contains internal
task content). The web view renders that snapshot. The snapshot is carried to the web **out of band**
(blob upload), never through git — so this public repo holds **code only**.

### Columns (derived, no new bookkeeping)

| Column | Rule |
|---|---|
| To Do | `status: pending` |
| In Progress | `status: in_progress`, no execution-review in the ledger yet |
| In Review | `status: in_progress`, execution-review role present in the ledger |
| Done | `status: completed` |

### Sessions

Each session is one board. The board defaults to the **most-recently-active** session (newest task-file
mtime) and offers a dropdown of recent sessions labelled by last-active time + ticket count.

## Privacy

This repo is **public**; the board data is **private**. The snapshot is gitignored, injected out of band,
and the deployed view is **login-gated** (Vercel Authentication). A CI privacy gate fails the build if a
home path or a board snapshot is ever committed.

## Scripts

| Command | Purpose |
|---|---|
| `npm run export:board` | regenerate `board.json` from local `~/.claude` state |
| `npm run kanban:upload` | upload `data/board.json` to Vercel Blob (token from Keychain) |
| `npm run kanban:sync` | export **and** upload (the full courier) |
| `npm run dev` / `build` / `start` | the Next.js board view |
| `npm run typecheck` / `test` | CI gates |

## The courier (out-of-band sync)

The web view reads its snapshot from one of three sources, in order (server-side, in
`lib/load-board.ts`): the **public Blob URL** in `BOARD_BLOB_URL` if set → else the
local `data/board.json` → else `data/board.sample.json`. The Blob URL is fetched
**server-side only** and never reaches the browser, so the private task content stays
behind the login wall even though the blob itself is public-by-default.

**Credentials (#1050, #1405).** `kanban:upload` authenticates with **short-lived
OIDC credentials only** — the long-lived RW token was revoked 2026-07-02 and its
code paths were removed. Seed the OIDC token file once from the linked repo root:

```sh
vercel env pull .env.vercel-oidc.local --yes
```

The courier re-pulls it automatically near expiry (`OIDC_TOKEN_FILE` /
`OIDC_REFRESH_SKEW_S` override the path/window). After the first upload, set the
printed `BOARD_BLOB_URL=<url>` in the Vercel project env. See `.env.example`.

### Live sync — opt-in PostToolUse hook

`scripts/on-task-change.sh` is an **opt-in** local hook (not auto-installed). Wire it as
a Claude Code **PostToolUse** hook so the board re-syncs on every task change: it
re-exports `data/board.json` and, only when a Blob token is resolvable, uploads it
(otherwise it just re-exports locally and exits 0 silently). Register it by adding a
PostToolUse entry to `~/.claude/settings.json` whose command is the absolute path to
`scripts/on-task-change.sh` (matcher scoped to the task-writing tool you use); it is
idempotent and fast, so re-running it per change is cheap.

**Sync logbook + background-sync note (#1158, #1405).** Every courier run appends one
JSONL line to `data/sync.log` (gitignored) recording its outcome — `uploaded` /
`skipped-no-token` / `failed` (override the path with the `SYNC_LOG` env var). So a sync
is never silent: if a background run skips, the reason is on the record. Background syncs
authenticate through the OIDC token file (`.env.vercel-oidc.local` by default) — a plain
file, readable from detached/background shells — which the courier self-refreshes near
expiry. This adds **no** secret to any committed file. With no reachable credential, the
hook re-exports locally and logs `skipped-no-token`, still exiting 0; three consecutive
non-success records fire an out-of-band notification.

### Board-freshness watchdog — external, out-of-band, fail-closed (#1435)

The sync-failure alert above only fires when the courier **ran and failed** (3 trailing
non-success `sync.log` records). It is structurally blind to the courier **never running
at all** — the hook unwired from `~/.claude/settings.json`, a kill-switch present, or a
long silent executor leg that writes no `TaskCreate`/`TaskUpdate` — because all three
write **zero** `sync.log` records, so the counter never advances and the board freezes
silently while real work is happening.

`scripts/board-freshness-watchdog.ts` is an **independent, opt-in** launchd job that
closes that gap. It runs on its own `StartInterval` schedule (a few minutes), separate
from the courier, and asks two questions from the **outside**:

1. **Is `data/board.json` old?** — `now − mtime` vs a threshold `N`.
2. **Is anyone working right now?** — the newest mtime across the courier-independent
   `~/.claude/3role-ledger/<session>/*.jsonl` and `~/.claude/lane-heartbeats/<session>.beat`
   markers, vs an active-window `W`.

Board **old** AND work **active** → it fires the **same** macOS notification the courier
uses. Board **fresh** → quiet. Nobody working → quiet (no cry-wolf). Can't tell (board
missing, signal unreadable) → it **alerts anyway** (fail-closed). It imports no Blob SDK,
no credential, and makes no network call.

Preview the exact launchd job, then install it (macOS):

```sh
scripts/install-board-watchdog.sh --dry-run   # print + plutil-lint the plist, change nothing
scripts/install-board-watchdog.sh             # write ~/Library/LaunchAgents + load it
scripts/install-board-watchdog.sh --uninstall # unload + move the plist aside
```

Check the current verdict by hand at any time (prints one token, fires nothing):

```sh
npm run kanban:watchdog -- --check            # FRESH | STALE-ACTIVE | IDLE | UNKNOWN | DISABLED
```

**Kill-switch** (its own, independent of the courier's): set `BOARD_WATCHDOG_OFF=1`, or
create the dotfile `~/.claude/.kanban-watchdog-off` (override with `BOARD_WATCHDOG_OFF_FILE`).

**Config** (all env, sane defaults — nothing hardcoded): `BOARD_STALE_THRESHOLD_MS`
(default 10 min), `BOARD_WATCHDOG_ACTIVE_WINDOW_MS` (default 8 min), `OUT` (board path),
`LEDGER_DIR` / `HEARTBEAT_DIR` (reused from the exporter), `SYNC_LOG`,
`BOARD_WATCHDOG_FOLD_SYNCLOG` (default on — folds the newest `sync.log` ts into freshness
so an actively-running-but-failing courier stays the #1405 counter's job, not this one),
`BOARD_WATCHDOG_INTERVAL_S` (installer, default 120), `BOARD_WATCHDOG_LABEL`.

**Who watches the watchdog (R1).** A launchd job can itself be unloaded or never
installed, silently re-opening the exact blind spot this closes. The daily
`com.user.launchd-healthmon` job is the natural backstop — it reports any launchd Label
that is expected-but-not-loaded. That job's watched-set is an **explicit static list** in
`ai-brain`'s `tools/launchd-health-check.sh` (a different repo), so to make the backstop
real, register this watchdog's Label there:

```
com.user.kanban-board-watchdog|event|-|-|periodic board-freshness watchdog (#1435)
```

This watchdog takes **no hard dependency** on healthmon — it ships and works standalone;
the registration is best-effort hardening the operator applies in `ai-brain`.
