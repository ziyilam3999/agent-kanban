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

**Token.** `kanban:upload` reads the Vercel Blob write token from the **macOS Keychain**
(it never lives in a file). Store it once:

```sh
security add-generic-password -a "$USER" -s BLOB_READ_WRITE_TOKEN -w
```

On CI / non-Mac, export `BLOB_READ_WRITE_TOKEN` in the environment instead. After the
first upload, set the printed `BOARD_BLOB_URL=<url>` in the Vercel project env. See
`.env.example`.

### Live sync — opt-in PostToolUse hook

`scripts/on-task-change.sh` is an **opt-in** local hook (not auto-installed). Wire it as
a Claude Code **PostToolUse** hook so the board re-syncs on every task change: it
re-exports `data/board.json` and, only when a Blob token is resolvable, uploads it
(otherwise it just re-exports locally and exits 0 silently). Register it by adding a
PostToolUse entry to `~/.claude/settings.json` whose command is the absolute path to
`scripts/on-task-change.sh` (matcher scoped to the task-writing tool you use); it is
idempotent and fast, so re-running it per change is cheap.
