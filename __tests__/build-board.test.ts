import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  redact,
  basenameOf,
  toColumn,
  buildTicket,
  buildSessionSummary,
  buildBoard,
  extractDecisionVerdict,
  VERDICT_MAX_LEN,
  type RawTask,
  type RawLedgerLine,
} from "@/lib/build-board";
import { COLUMNS } from "@/lib/board-schema";

describe("toColumn", () => {
  it("maps completed → done", () => {
    expect(toColumn("completed", false)).toBe("done");
    expect(toColumn("completed", true)).toBe("done");
  });

  it("maps pending → todo", () => {
    expect(toColumn("pending", false)).toBe("todo");
    expect(toColumn("pending", true)).toBe("todo");
  });

  it("maps in_progress with no execution-review → in_progress (executor-only stays in_progress)", () => {
    expect(toColumn("in_progress", false)).toBe("in_progress");
  });

  it("maps in_progress with execution-review present → in_review", () => {
    expect(toColumn("in_progress", true)).toBe("in_review");
  });
});

describe("redact", () => {
  it("strips a synthetic /Users/<name>/ home path so no /Users/<name>/ substring remains", () => {
    const out = redact("/Users/alice/secret/plan.md");
    expect(out).not.toContain("/Users/alice/");
    expect(out).not.toContain("/Users/");
  });

  it("strips a synthetic /home/<name>/ home path", () => {
    const out = redact("error reading /home/bob/.config/creds.json now");
    expect(out).not.toContain("/home/bob/");
    expect(out).not.toContain("/home/");
  });

  it("strips a synthetic Windows C:\\Users\\<name>\\ home path (any case)", () => {
    const out = redact("see c:\\users\\carol\\AppData\\thing.txt");
    expect(out.toLowerCase()).not.toContain("users\\carol");
    expect(out.toLowerCase()).not.toContain(":\\users\\");
  });

  it("strips a Windows forward-slash home path", () => {
    const out = redact("C:/Users/dave/work/file.md");
    expect(out).not.toContain("/Users/dave/");
    expect(out).not.toContain("Users/dave");
  });

  it("leaves non-home text untouched", () => {
    expect(redact("just a plain description")).toBe("just a plain description");
  });

  it("collapses a leading homedir prefix passed in", () => {
    const out = redact("/synthetic/homeroot/dev/repo/file.md", "/synthetic/homeroot");
    expect(out).not.toContain("/synthetic/homeroot");
    expect(out).toContain("repo/file.md");
  });

  it("basenameOf reduces a unix and a windows path to its basename", () => {
    expect(basenameOf("/Users/alice/secret/plan.md")).toBe("plan.md");
    expect(basenameOf("C:\\Users\\carol\\reviews\\r.md")).toBe("r.md");
    expect(basenameOf("plain.md")).toBe("plain.md");
  });
});

const baseTask = (over: Partial<RawTask> = {}): RawTask => ({
  id: "100",
  subject: "Do the thing",
  description: "a description",
  activeForm: "Doing the thing",
  status: "in_progress",
  blocks: [],
  blockedBy: [],
  ...over,
});

describe("buildTicket", () => {
  it("orders comments oldest-first by ts", () => {
    const lines: RawLedgerLine[] = [
      { role: "executor", ts: "2026-06-14T05:15:36.461Z" },
      { role: "planner", ts: "2026-06-14T04:58:26.116Z" },
      { role: "execution-review", ts: "2026-06-14T05:27:46.211Z" },
    ];
    const t = buildTicket(baseTask(), lines, 1700000000000);
    expect(t.comments.map((c) => c.role)).toEqual([
      "planner",
      "executor",
      "execution-review",
    ]);
  });

  it("absent ledger → comments = []", () => {
    const t = buildTicket(baseTask(), [], 123);
    expect(t.comments).toEqual([]);
  });

  it("passes blockedBy through unchanged", () => {
    const t = buildTicket(baseTask({ blockedBy: ["88", "99"] }), [], 1);
    expect(t.blockedBy).toEqual(["88", "99"]);
  });

  it("derives in_review when an execution-review line exists and status is in_progress", () => {
    const t = buildTicket(
      baseTask({ status: "in_progress" }),
      [{ role: "execution-review", ts: "2026-06-14T05:27:46.211Z" }],
      1
    );
    expect(t.column).toBe("in_review");
  });

  it("stays in_progress with only an executor line", () => {
    const t = buildTicket(
      baseTask({ status: "in_progress" }),
      [{ role: "executor", ts: "2026-06-14T05:15:36.461Z" }],
      1
    );
    expect(t.column).toBe("in_progress");
  });

  it("reduces a comment artifact_path to a redacted basename", () => {
    const t = buildTicket(
      baseTask(),
      [
        {
          role: "planner",
          ts: "2026-06-14T04:58:26.116Z",
          agentId: "abc123",
          artifact_path: "/Users/alice/.ai-workspace/plans/2026-the-plan.md",
        },
      ],
      1
    );
    expect(t.comments[0].artifact).toBe("2026-the-plan.md");
    expect(t.comments[0].agentId).toBe("abc123");
    expect(JSON.stringify(t.comments)).not.toContain("/Users/");
  });

  it("carries skip_reason → skipReason", () => {
    const t = buildTicket(
      baseTask(),
      [{ role: "plan-review", ts: "2026-06-14T04:58:26.117Z", skip_reason: "trivial" }],
      1
    );
    expect(t.comments[0].skipReason).toBe("trivial");
  });

  it("redacts the description and sets updatedAt to the mtime", () => {
    const t = buildTicket(
      baseTask({ description: "see /Users/alice/notes.md for detail" }),
      [],
      999
    );
    expect(t.description).not.toContain("/Users/");
    expect(t.updatedAt).toBe(999);
  });

  it("stamps the 8-char sessionId when one is provided", () => {
    const t = buildTicket(baseTask(), [], 1, "a1b2c3d4");
    expect(t.sessionId).toBe("a1b2c3d4");
  });

  it("omits sessionId entirely when none is provided (back-compat)", () => {
    const t = buildTicket(baseTask(), [], 1);
    expect(t.sessionId).toBeUndefined();
    expect("sessionId" in t).toBe(false);
  });
});

describe("buildTicket — verdict pass-through (seam B read side)", () => {
  it("passes a review verdict through onto the comment", () => {
    const t = buildTicket(
      baseTask(),
      [
        {
          role: "plan-review",
          ts: "2026-06-14T04:58:26.116Z",
          verdict: "APPROVE-WITH-NOTES",
        },
      ],
      1
    );
    expect(t.comments[0].verdict).toBe("APPROVE-WITH-NOTES");
  });

  it("leaves verdict undefined when the ledger line carries none", () => {
    const t = buildTicket(
      baseTask(),
      [{ role: "executor", ts: "2026-06-14T04:58:26.116Z" }],
      1
    );
    expect(t.comments[0].verdict).toBeUndefined();
  });

  it("trims surrounding whitespace and drops a whitespace-only verdict", () => {
    const t = buildTicket(
      baseTask(),
      [
        { role: "plan-review", ts: "2026-06-14T04:58:26.116Z", verdict: "  PASS  " },
        { role: "execution-review", ts: "2026-06-14T05:58:26.116Z", verdict: "   " },
      ],
      1
    );
    expect(t.comments[0].verdict).toBe("PASS");
    expect(t.comments[1].verdict).toBeUndefined();
  });

  it("length-caps an over-long verdict to VERDICT_MAX_LEN chars", () => {
    const long = "SHIP-WITH-FIXES-AND-A-VERY-LONG-TRAILING-EXPLANATION";
    const t = buildTicket(
      baseTask(),
      [{ role: "execution-review", ts: "2026-06-14T04:58:26.116Z", verdict: long }],
      1
    );
    expect(t.comments[0].verdict).toHaveLength(VERDICT_MAX_LEN);
    expect(long.startsWith(t.comments[0].verdict as string)).toBe(true);
  });
});

describe("extractDecisionVerdict (pure)", () => {
  it("extracts the first Decision token", () => {
    expect(
      extractDecisionVerdict("preamble\nDecision: REVISE\nmore notes")
    ).toBe("REVISE");
  });

  it("is case-insensitive on the Decision keyword and matches PASS", () => {
    expect(extractDecisionVerdict("...\ndecision: PASS\n...")).toBe("PASS");
  });

  it("returns undefined when no Decision line is present", () => {
    expect(extractDecisionVerdict("no decision here")).toBeUndefined();
  });
});

describe("buildTicket — verdict-from-artifact fallback (seam B, no --verdict)", () => {
  const dir = mkdtempSync(join(tmpdir(), "akb-verdict-"));

  const writeArtifact = (name: string, body: string): string => {
    const p = join(dir, name);
    writeFileSync(p, body, "utf8");
    return p;
  };

  it("CASE 1 — primary ledger verdict still wins (unchanged path)", () => {
    const t = buildTicket(
      baseTask(),
      [
        {
          role: "plan-review",
          ts: "2026-06-21T04:58:26.116Z",
          verdict: "PASS",
        },
      ],
      1
    );
    expect(t.comments[0].verdict).toBe("PASS");
  });

  it("CASE 2 — review line with NO verdict derives PASS from the artifact Decision line", () => {
    const artifact = writeArtifact(
      "review-pass.md",
      "# Execution review\n\nLooks good.\n\nDecision: PASS\n"
    );
    const t = buildTicket(
      baseTask(),
      [
        {
          role: "execution-review",
          ts: "2026-06-21T05:27:46.211Z",
          artifact_path: artifact,
        },
      ],
      1
    );
    expect(t.comments[0].verdict).toBe("PASS");
  });

  it("CASE 4 — a NON-review role does NOT derive a verdict from its artifact", () => {
    const artifact = writeArtifact(
      "executor-note.md",
      "Implemented the thing.\nDecision: PASS\n"
    );
    const t = buildTicket(
      baseTask(),
      [
        {
          role: "executor",
          ts: "2026-06-21T05:15:36.461Z",
          artifact_path: artifact,
        },
      ],
      1
    );
    expect(t.comments[0].verdict).toBeUndefined();
  });

  it("CASE 5 — an unreadable / missing artifact path yields no verdict and never throws", () => {
    const missing = join(dir, "does-not-exist-xyz.md");
    expect(() =>
      buildTicket(
        baseTask(),
        [
          {
            role: "execution-review",
            ts: "2026-06-21T05:27:46.211Z",
            artifact_path: missing,
          },
        ],
        1
      )
    ).not.toThrow();
    const t = buildTicket(
      baseTask(),
      [
        {
          role: "execution-review",
          ts: "2026-06-21T05:27:46.211Z",
          artifact_path: missing,
        },
      ],
      1
    );
    expect(t.comments[0].verdict).toBeUndefined();
  });

  it("review line with neither verdict nor artifact_path stays verdict-less", () => {
    const t = buildTicket(
      baseTask(),
      [{ role: "plan-review", ts: "2026-06-21T04:58:26.116Z" }],
      1
    );
    expect(t.comments[0].verdict).toBeUndefined();
  });
});

describe("buildSessionSummary", () => {
  const now = 1_700_000_000_000;

  it("is live at the 4-minute boundary (within 5-min window)", () => {
    const s = buildSessionSummary("abcdef1234567890", now - 4 * 60 * 1000, 14, now);
    expect(s.live).toBe(true);
    expect(s.label).toBe("active 4m ago · 14 tickets");
    expect(s.id).toBe("abcdef12");
    expect(s.ticketCount).toBe(14);
  });

  it("is not live at 6 minutes (outside 5-min window)", () => {
    const s = buildSessionSummary("abcdef1234567890", now - 6 * 60 * 1000, 3, now);
    expect(s.live).toBe(false);
    expect(s.label).toBe("active 6m ago · 3 tickets");
  });

  it('says "just now" under a minute', () => {
    const s = buildSessionSummary("xy", now - 5000, 1, now);
    expect(s.label).toBe("active just now · 1 tickets");
    expect(s.live).toBe(true);
  });
});

describe("buildBoard", () => {
  it("assembles a schema-1 board with a deterministic generatedAt passed in", () => {
    const now = 1_700_000_000_000;
    const sessions = [buildSessionSummary("sess1234abcd", now, 1, now)];
    const ticket = buildTicket(baseTask(), [], now);
    const board = buildBoard({
      generatedAt: now,
      sessionId: "sess1234",
      sessions,
      tickets: [ticket],
    });
    expect(board.schema).toBe(1);
    expect(board.generatedAt).toBe(now);
    expect(board.sessionId).toBe("sess1234");
    expect(board.sessions).toBe(sessions);
    expect(board.tickets).toHaveLength(1);
    expect(COLUMNS).toContain(board.tickets[0].column);
  });
});
