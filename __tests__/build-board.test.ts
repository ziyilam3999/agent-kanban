import {
  redact,
  basenameOf,
  toColumn,
  buildTicket,
  buildSessionSummary,
  buildBoard,
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
