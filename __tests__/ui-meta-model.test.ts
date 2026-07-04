import { abbreviateModel, cardModel, formatCardModel } from "@/lib/ui-meta";
import type { Column, LedgerComment, Ticket } from "@/lib/board-schema";

const ticket = (column: Column, comments: LedgerComment[] = []): Ticket => ({
  id: "100",
  subject: "Do the thing",
  description: "",
  column,
  status:
    column === "done" ? "completed" : column === "todo" ? "pending" : "in_progress",
  blockedBy: [],
  comments,
  updatedAt: 1,
});

describe("abbreviateModel (#1465 AC5)", () => {
  it('strips the "claude-" vendor prefix', () => {
    expect(abbreviateModel("claude-sonnet-5")).toBe("sonnet-5");
  });

  it("leaves a non-claude-prefixed string untouched", () => {
    expect(abbreviateModel("sonnet-5")).toBe("sonnet-5");
  });
});

describe("formatCardModel (#1465 AC5)", () => {
  it("model + effort -> version·effort (middot present)", () => {
    expect(formatCardModel({ version: "claude-sonnet-5", effort: "xhigh" })).toBe(
      "sonnet-5·xhigh"
    );
  });

  it("model present, effort absent -> just the version, NO trailing separator", () => {
    const out = formatCardModel({ version: "claude-sonnet-5" });
    expect(out).toBe("sonnet-5");
    expect(out.endsWith("·")).toBe(false);
  });
});

describe("cardModel (#1465 AC5 + AC4 selection rules)", () => {
  it("model absent, effort present on a comment -> undefined (effort alone is meaningless)", () => {
    const t = ticket("done", [
      { role: "executor", ts: "2026-07-04T01:00:00.000Z", effort: "xhigh" },
    ]);
    expect(cardModel(t)).toBeUndefined();
  });

  it("no comment carries modelVersion -> undefined (renders nothing)", () => {
    const t = ticket("in_review", [
      { role: "executor", ts: "2026-07-04T01:00:00.000Z" },
    ]);
    expect(cardModel(t)).toBeUndefined();
  });

  it("in_progress -> the newest WORK-role (planner/executor) comment carrying a model wins over a newer review comment", () => {
    const t = ticket("in_progress", [
      {
        role: "executor",
        ts: "2026-07-04T01:00:00.000Z",
        modelVersion: "claude-sonnet-5",
        modelTier: "sonnet",
      },
      {
        role: "plan-review",
        ts: "2026-07-04T02:00:00.000Z",
        modelVersion: "claude-opus-4-8",
        modelTier: "opus",
      },
    ]);
    expect(cardModel(t)).toEqual({ version: "claude-sonnet-5", effort: undefined });
  });

  it("in_progress with NO work-role model -> undefined (does not fall back to a review role's model)", () => {
    const t = ticket("in_progress", [
      {
        role: "plan-review",
        ts: "2026-07-04T02:00:00.000Z",
        modelVersion: "claude-opus-4-8",
        modelTier: "opus",
      },
    ]);
    expect(cardModel(t)).toBeUndefined();
  });

  it("done/in_review -> the newest model-bearing comment of ANY role", () => {
    const t = ticket("done", [
      {
        role: "executor",
        ts: "2026-07-04T01:00:00.000Z",
        modelVersion: "claude-sonnet-5",
        modelTier: "sonnet",
      },
      {
        role: "execution-review",
        ts: "2026-07-04T02:00:00.000Z",
        modelVersion: "claude-opus-4-8",
        modelTier: "opus",
        effort: "high",
      },
    ]);
    expect(cardModel(t)).toEqual({ version: "claude-opus-4-8", effort: "high" });
  });

  // #1481 T2(a) — the CURRENT actor (newest work-role comment) is the executor and
  // it carries NO modelVersion; an EARLIER planner comment carries a DIFFERENT,
  // model. cardModel must return undefined (honest-unknown) — it must NEVER walk
  // past the current actor to an earlier work role's model. RED today: the
  // pre-fix in_progress loop keeps scanning past the model-less executor comment
  // and returns the older planner's claude-opus-4-8 instead of undefined.
  it("(#1481 T2a) in_progress, current actor (executor) has no model, earlier planner does -> undefined, never the planner's model", () => {
    const t = ticket("in_progress", [
      {
        role: "planner",
        ts: "2026-07-04T01:00:00.000Z",
        modelVersion: "claude-opus-4-8",
        modelTier: "opus",
      },
      {
        role: "executor",
        ts: "2026-07-04T02:00:00.000Z",
      },
    ]);
    expect(cardModel(t)).toBeUndefined();
  });

  // #1481 T2(b) — red-first two-ticket wrong-actor lock. TWO separate in_progress
  // tickets, EACH with a model-less current-actor executor comment over an
  // earlier planner comment carrying a DIFFERENT model per ticket (opus vs
  // sonnet). Pre-fix, EACH ticket mis-attributes to its OWN planner (two
  // different non-undefined badges) — that is the exact wrong-actor failure
  // shape across tickets, so this is red-first (not already-passing on today's
  // code, unlike a same-model two-ticket check would be).
  it("(#1481 T2b) two tickets, each with a model-less current actor over a DIFFERENT-model planner -> BOTH undefined", () => {
    const ticket1 = ticket("in_progress", [
      {
        role: "planner",
        ts: "2026-07-04T01:00:00.000Z",
        modelVersion: "claude-opus-4-8",
        modelTier: "opus",
      },
      {
        role: "executor",
        ts: "2026-07-04T02:00:00.000Z",
      },
    ]);
    const ticket2 = ticket("in_progress", [
      {
        role: "planner",
        ts: "2026-07-04T01:00:00.000Z",
        modelVersion: "claude-sonnet-5",
        modelTier: "sonnet",
      },
      {
        role: "executor",
        ts: "2026-07-04T02:00:00.000Z",
      },
    ]);
    expect(cardModel(ticket1)).toBeUndefined();
    expect(cardModel(ticket2)).toBeUndefined();
  });
});
