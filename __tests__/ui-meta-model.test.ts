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
});
