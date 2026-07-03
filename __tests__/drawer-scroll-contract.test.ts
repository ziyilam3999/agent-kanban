/**
 * Source-contract guard for the ticket-detail Drawer touch-scroll fix (#1447, CYCLE 3).
 *
 * HONESTY — read this before trusting a green run:
 *  - This is a SOURCE-CONTRACT test, not a layout/runtime test. jsdom cannot
 *    measure real flex layout or drive a finger, so it can NEVER prove that
 *    scrolling actually works at runtime.
 *  - The runtime MECHANISM proof (a trusted CDP touch swipe scrolls the body in
 *    chromium) lives in `e2e/drawer-scroll.e2e.spec.ts`.
 *  - The ONLY proof the iOS fix WORKS is the MANUAL operator real-device step
 *    (plan AC14 / CG5). A chromium/jest-green run is necessary-but-NOT-sufficient:
 *    chromium scrolled fine in BOTH prior cycles while the real iPhone failed.
 *
 * CYCLE-3 root cause (confirmed by elimination): a Framer-Motion `drag` on the
 * scroll body's ANCESTOR (`<motion.aside className="ak-drawer">`) swallows the
 * vertical touch-pan on iOS Safari before the inner `overflow-y:auto` engages.
 * The fix REMOVES the drag machinery entirely (keep the spring entrance/exit;
 * re-drive swipe-to-dismiss from a grip-only native pointer handler). So this
 * guard now asserts the drag machinery is ABSENT (it was PRESENT — false-green —
 * in cycles 1 & 2) and the grip dismiss handler is PRESENT, plus the intact CSS
 * scroll recipe. Reintroducing an ancestor drag turns this RED.
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

describe("drawer-scroll-contract (#1447 cycle-3 — drag removed from the scroll ancestor)", () => {
  const body = ruleBlock(".ak-drawer__body");

  it("finds the .ak-drawer__body rule block", () => {
    expect(body.length).toBeGreaterThan(0);
  });

  // ---- CSS scroll recipe stays intact (necessary for desktop wheel + bounded box) ----
  it("recipe: .ak-drawer__body declares overflow-y: auto", () => {
    expect(body).toMatch(/overflow-y\s*:\s*auto/);
  });

  it("recipe: .ak-drawer__body declares min-height: 0 (allow shrink so overflow engages)", () => {
    expect(body).toMatch(/min-height\s*:\s*0/);
  });

  it("recipe: .ak-drawer__body declares a GROWING flex (flex-grow >= 1; `flex: 0 0 auto` rejected)", () => {
    const shorthand = body.match(/flex\s*:\s*(\d+)/);
    const longhand = body.match(/flex-grow\s*:\s*(\d+)/);
    const grow = shorthand
      ? Number(shorthand[1])
      : longhand
      ? Number(longhand[1])
      : NaN;
    expect(grow).toBeGreaterThanOrEqual(1);
  });

  it("recipe: .ak-drawer__body declares overscroll-behavior: contain", () => {
    expect(body).toMatch(/overscroll-behavior\s*:\s*contain/);
  });

  it("recipe: .ak-drawer__body declares -webkit-overflow-scrolling: touch", () => {
    expect(body).toMatch(/-webkit-overflow-scrolling\s*:\s*touch/);
  });

  it("hardening: .ak-drawer__body does NOT re-add translateZ/translate3d (cycle-2 device-ruled-out)", () => {
    expect(body).not.toMatch(/translateZ|translate3d/);
  });

  // ---- Drawer.tsx: the drag gesture recognizer is GONE from the ancestor ----
  // This is the cycle-3 tripwire — it MUST go RED against cycle-1/2 drag-present code.
  const DRAG_FORBIDDEN: Array<[string, RegExp]> = [
    ["a `drag=` prop", /\bdrag\s*=/],
    ["dragControls", /dragControls/],
    ["dragListener", /dragListener/],
    ["dragConstraints", /dragConstraints/],
    ["dragElastic", /dragElastic/],
    ["onDragEnd", /onDragEnd/],
    ["useDragControls", /useDragControls/],
    ["PanInfo", /PanInfo/],
  ];
  it.each(DRAG_FORBIDDEN)(
    "drag-absence: Drawer.tsx contains NO %s (gesture recognizer off the scroll ancestor)",
    (_label, re) => {
      expect(drawerSource).not.toMatch(re);
    }
  );

  // ---- The spring entrance/exit animation is preserved (the drawer still slides) ----
  it("animation preserved: AnimatePresence + initial/animate/exit/transition remain", () => {
    expect(drawerSource).toMatch(/AnimatePresence/);
    expect(drawerSource).toMatch(/initial=/);
    expect(drawerSource).toMatch(/animate=/);
    expect(drawerSource).toMatch(/exit=/);
    expect(drawerSource).toMatch(/transition=/);
  });

  // ---- Grip-only native dismiss handler is present (swipe-to-dismiss survives) ----
  // Cycle 3 wires the swipe via NATIVE pointer listeners on the grip element
  // (React's root-delegated onPointerUp can miss the release after
  // setPointerCapture), so assert BOTH a pointerup dismiss handler and that it
  // is bound to the grip element (gripRef) — a refactor that drops either turns
  // this RED. The AC allows "onPointerUp OR an onClose-calling pointer handler".
  it("grip dismiss present: a grip-bound pointerup handler is wired (swipe-to-dismiss not lost)", () => {
    expect(drawerSource).toMatch(
      /addEventListener\(\s*["']pointerup["']|onPointerUp/
    );
    expect(drawerSource).toMatch(/gripRef/);
  });

  // ---- The scroll body carries NO pointer/touch handler (grip-only dismiss) ----
  // Guards the AC3 invariant: the dismiss gesture never attaches to the scroll
  // subtree. The only `addEventListener("pointer…")` in the file targets `grip`.
  it("body-subtree clean: no pointer/touch listener is bound to a non-grip element", () => {
    const pointerBinds = [
      ...drawerSource.matchAll(
        /(\w+)\.addEventListener\(\s*["'](?:pointer|touch)\w*["']/g
      ),
    ].map((m) => m[1]);
    // Every pointer/touch listener target must be the grip.
    for (const target of pointerBinds) {
      expect(target).toBe("grip");
    }
    // And there is at least one (the grip dismiss) — otherwise dismiss was lost.
    expect(pointerBinds.length).toBeGreaterThan(0);
  });
});
