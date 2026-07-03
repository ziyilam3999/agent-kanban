/**
 * Source-contract tripwire for the ticket-detail Drawer scroll fix (#1447, cycle 2).
 *
 * HONESTY CONTRACT — read before trusting a green run:
 *  - This is a SOURCE-contract, NOT a layout/runtime test. jsdom cannot measure
 *    real flex layout or touch-scroll, so it can NEVER prove that scrolling
 *    actually works at runtime.
 *  - It asserts the exact `.ak-drawer__body` CSS scroll recipe is PRESENT —
 *    including this cycle's added `transform: translateZ(0)` iOS scroll-layer
 *    hint. If any recipe declaration is removed, this tripwire goes RED.
 *  - The runtime MECHANISM proof is `e2e/drawer-scroll.e2e.spec.ts` (trusted
 *    CDP touch swipe in chromium). BUT a chromium-green e2e does NOT prove the
 *    iOS fix — chromium scrolls fine with OR without `translateZ(0)`. The ONLY
 *    oracle that can prove the fix WORKS on iOS Safari is the operator's real
 *    iPhone (plan AC14 / close-gate CG5). Chromium-green != iOS-works.
 *  - This test deliberately makes NO assertion about the drag / swipe-to-dismiss
 *    config (#1447 cycle 2 holds that constant — single-variable experiment).
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

describe("drawer-scroll-contract (#1447 cycle 2 — recipe-present tripwire)", () => {
  const body = ruleBlock(".ak-drawer__body");

  it("finds the .ak-drawer__body rule block", () => {
    expect(body.length).toBeGreaterThan(0);
  });

  it("declares overflow-y: auto", () => {
    expect(body).toMatch(/overflow-y\s*:\s*auto/);
  });

  it("declares min-height: 0 (allow shrink below content so overflow engages)", () => {
    expect(body).toMatch(/min-height\s*:\s*0/);
  });

  it("declares a GROWING flex (flex-grow >= 1; `flex: 0 0 auto` is rejected)", () => {
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

  it("declares overscroll-behavior: contain", () => {
    expect(body).toMatch(/overscroll-behavior\s*:\s*contain/);
  });

  it("declares -webkit-overflow-scrolling: touch (iOS momentum scroll)", () => {
    expect(body).toMatch(/-webkit-overflow-scrolling\s*:\s*touch/);
  });

  it("declares transform: translateZ(0) (THIS cycle's iOS scroll-layer fix — tripwire)", () => {
    // The single-variable fix: promotes the overflow region onto its own iOS
    // touch-scroll/compositing layer. RED if anyone strips this cycle's fix.
    expect(body).toMatch(/transform\s*:\s*translateZ\(\s*0\s*\)/);
  });
});
