// ticket-kind.ts — the SHARED `metadata.kind` resolver (board-noise triage,
// S1 DISPLAY). This is agent-kanban's implementation of the universal resolver
// defined in ai-brain's `docs/task-kind-contract.md` §3.2 steps 1-3, byte-for-byte
// identical in behavior to `tests/fixtures/task-kind-store/validate.mjs`'s
// `resolveKind()` (the shared fixture's own cross-check) — both are tested
// against the SAME fixture store at `__tests__/fixtures/task-kind-store/`
// (`__tests__/ticket-kind.test.ts`).
//
// Deliberately does NOT implement resolver step 4 (the board-only deferred
// auto-unshelve post-rule) — that lives in `lib/build-board.ts`'s `buildBoard`,
// the only place holding the cross-ticket `statusById` map step 4 needs. See
// the contract doc §3.2 note 4 for why the split is intentional.

/** `metadata.kind` enum (task-kind-contract.md §3.1). Absent/unrecognised ⇒ "work". */
export const KIND_ENUM = new Set(["work", "bookkeeping", "parked", "deferred"] as const);

export type TicketKind = "work" | "bookkeeping" | "parked" | "deferred";

/** Minimal shape the resolver needs — a subset of RawTask (lib/build-board.ts). */
export interface KindableTask {
  subject?: string;
  metadata?: {
    kind?: string;
    [key: string]: unknown;
  };
}

/**
 * Subject-prefix fallback table (task-kind-contract.md §3.2 step 2). Order does
 * not matter — the five prefixes are mutually exclusive by construction (no
 * fixture subject matches two of them). Kept in lockstep with the contract doc
 * and with `tests/fixtures/task-kind-store/validate.mjs`'s FALLBACK_PREFIXES.
 */
const FALLBACK_PREFIXES: ReadonlyArray<{ re: RegExp; kind: TicketKind }> = [
  { re: /^RESTORE:/, kind: "bookkeeping" },
  { re: /^\[reversible-op RESTORE\]/, kind: "bookkeeping" },
  { re: /^\[hygiene\]/, kind: "bookkeeping" },
  { re: /^\[SHELVED/, kind: "parked" },
  { re: /^\[PARKED/, kind: "parked" },
];

/**
 * Resolver steps 1-3 (task-kind-contract.md §3.2). PURE — no IO, no board-only
 * step 4 (deferred auto-unshelve is applied separately in buildBoard, which
 * alone holds the statusById map that step needs).
 *
 *   1. `metadata.kind` present AND in the enum ⇒ that value.
 *   2. Else subject-prefix fallback (case-sensitive, anchored at the start).
 *   3. Else ⇒ "work".
 */
export function resolveTicketKind(task: KindableTask | undefined | null): TicketKind {
  const kind = task?.metadata?.kind;
  if (typeof kind === "string" && (KIND_ENUM as ReadonlySet<string>).has(kind)) {
    return kind as TicketKind;
  }
  const subject = typeof task?.subject === "string" ? task.subject : "";
  for (const { re, kind: k } of FALLBACK_PREFIXES) {
    if (re.test(subject)) return k;
  }
  return "work";
}

/**
 * The view-default read of an ALREADY-resolved `Ticket.kind` (post board-only
 * step 4 for a deferred ticket, when the caller is reading a built Ticket —
 * see build-board.ts's buildBoard). `kind` is OPTIONAL on Ticket for back-
 * compat with pre-board-noise snapshots; absent ⇒ "work" (task-kind-contract
 * §4's stated view default), so every consumer of this helper treats an old
 * snapshot exactly as it rendered before this field existed.
 */
export function isDisplayWork(kind: TicketKind | undefined): boolean {
  return (kind ?? "work") === "work";
}
