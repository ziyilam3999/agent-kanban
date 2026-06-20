import { parseSubjectTag, subjectTagLabel } from "@/lib/subject-tag";

describe("parseSubjectTag", () => {
  it("lifts a parent ticket ref and labels it as lineage (the #1082/#1063 confusion)", () => {
    const t = parseSubjectTag("[#1063] FIX demo incoherence: beats 5→6");
    expect(t.tag).toBe("#1063");
    expect(t.isParentRef).toBe(true);
    expect(t.title).toBe("FIX demo incoherence: beats 5→6");
    expect(subjectTagLabel(t)).toBe("↳ #1063");
  });

  it("lifts an [EPIC] tag without the lineage arrow", () => {
    const t = parseSubjectTag("[EPIC] Universal live Kanban board");
    expect(t.tag).toBe("EPIC");
    expect(t.isParentRef).toBe(false);
    expect(t.title).toBe("Universal live Kanban board");
    expect(subjectTagLabel(t)).toBe("EPIC");
  });

  it("leaves a subject with no prefix untouched", () => {
    const t = parseSubjectTag("Slow down the lift&land movement");
    expect(t.tag).toBeNull();
    expect(t.title).toBe("Slow down the lift&land movement");
    expect(subjectTagLabel(t)).toBe("");
  });

  it("only lifts the FIRST bracket; later brackets stay in the title", () => {
    const t = parseSubjectTag("[#1064] monday-bot: backfill US-11 [spec]");
    expect(t.tag).toBe("#1064");
    expect(t.title).toBe("monday-bot: backfill US-11 [spec]");
  });

  it("does not lift a degenerate prefix-only subject", () => {
    const t = parseSubjectTag("[#1063]");
    expect(t.tag).toBeNull();
    expect(t.title).toBe("[#1063]");
  });
});
