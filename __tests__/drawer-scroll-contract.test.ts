/**
 * Source-contract guard for the ticket-detail Drawer scroll fix (#1447).
 *
 * This is NOT a layout test. jsdom cannot measure real flex layout, so it can
 * never prove that scrolling actually works at runtime. Instead this guard
 * asserts the exact CSS declarations + component props whose ABSENCE was the
 * root cause of the "long ticket clipped, can't scroll" bug — so a future edit
 * that removes any of them regresses the fix and fails here.
 *
 * The real proof that scrolling works is the manual/rendered scroll evidence
 * (mobile-touch + desktop-wheel to the bottom of a long ticket) — see
 * .ai-workspace/reviews/1447-execution-evidence.md.
 *
 * Reads repo source via join(__dirname, "..") — NO absolute/home-path literals,
 * so the test is portable across clones/worktrees/CI.
 */
import { readFileSync } from "fs";
import { join } from "path";

const cssSource = readFileSync(
  join(__dirname, "..", "app", "globals.css"),
  "utf8"
);
const drawerSource = readFileSync(
  join(__dirname, "..", "components", "Drawer.tsx"),
  "utf8"
);

/**
 * Isolate the `.ak-drawer__body { ... }` rule block so every CSS assertion is
 * scoped to that block only (not an incidental match elsewhere in the sheet).
 * `.ak-drawer__body` appears exactly once, so a non-greedy `[^}]*` is safe.
 */
function ruleBlock(selector: string): string {
  // Escape the leading dot so `.ak-drawer__body` is a literal class selector.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = cssSource.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : "";
}

describe("drawer-scroll-contract (#1447)", () => {
  const body = ruleBlock(".ak-drawer__body");

  it("finds the .ak-drawer__body rule block", () => {
    expect(body.length).toBeGreaterThan(0);
  });

  it("A1: .ak-drawer__body declares overflow-y: auto", () => {
    expect(body).toMatch(/overflow-y\s*:\s*auto/);
  });

  it("A1: .ak-drawer__body declares min-height: 0 (THE fix — allow shrink so overflow engages)", () => {
    expect(body).toMatch(/min-height\s*:\s*0/);
  });

  it("A1: .ak-drawer__body declares a GROWING flex (flex-grow >= 1; `flex: 0 0 auto` is rejected)", () => {
    // Capture the flex-grow: either `flex: <grow> ...` shorthand or `flex-grow: <n>`.
    const shorthand = body.match(/flex\s*:\s*(\d+)/);
    const longhand = body.match(/flex-grow\s*:\s*(\d+)/);
    const grow = shorthand
      ? Number(shorthand[1])
      : longhand
      ? Number(longhand[1])
      : NaN;
    // grow must be a real number >= 1. `flex: 0 0 auto` -> grow 0 -> FAILS (correct).
    expect(grow).toBeGreaterThanOrEqual(1);
  });

  it("A2: .ak-drawer__body declares overscroll-behavior: contain", () => {
    expect(body).toMatch(/overscroll-behavior\s*:\s*contain/);
  });

  it("A5: Drawer.tsx imports/uses useDragControls", () => {
    expect(drawerSource).toMatch(/useDragControls/);
  });

  it("A5: Drawer.tsx sets dragListener={false} (grip-only drag — restores native touch-scroll)", () => {
    expect(drawerSource).toMatch(/dragListener=\{false\}/);
  });
});
