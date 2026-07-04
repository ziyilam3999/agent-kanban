// stage-bar-render.test.ts — #1468 render-level regression guard (AC4 + AC6,
// brief §8's 4 pass/fail guards). This is the PRIMARY gate: it renders the
// drawer's PipelineProgress (renderToStaticMarkup) on fixtures that reproduce
// the exact operator-caught bug — a fail-class plan-review verdict must NOT
// light the executor pill "up next", and the container aria-label must not
// announce a downstream role as done/next.
//
// RED-FIRST (#1468 AC6): this file was written and run against the PRE-FIX
// PipelineProgress (role-presence-only rolesSeen/nextPending — the only change
// made before this run was `export`-ing the function so this test could import
// it). It failed for the documented reason (see the PR body's red-first
// evidence section) before the resolveStageBar() rewrite landed.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PipelineProgress } from "@/components/Drawer";
import type { Column, LedgerComment, Ticket } from "@/lib/board-schema";

const ticket = (comments: LedgerComment[], column: Column = "in_progress"): Ticket => ({
  id: "1468",
  subject: "Stage bar regression fixture",
  description: "",
  column,
  status: column === "done" ? "completed" : column === "todo" ? "pending" : "in_progress",
  blockedBy: [],
  comments,
  updatedAt: 1,
});

const at = (n: number) => `2026-07-04T0${n}:00:00.000Z`;

const render = (t: Ticket) =>
  renderToStaticMarkup(createElement(PipelineProgress, { ticket: t }));

/** Split the rendered markup into one segment per pipeline role (in
 * PLANNER, PLAN-REVIEW, EXECUTOR, EXEC-REVIEW order), so assertions can
 * target a SPECIFIC pill's class list rather than a global count. Depends
 * only on every pill sharing the `ak-pipeline__step` base class, which both
 * the pre-fix and post-fix render share. */
function stepSegments(markup: string): string[] {
  const idxs: number[] = [];
  const re = /<div class="ak-pipeline__step/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup))) idxs.push(m.index);
  idxs.push(markup.length);
  const segs: string[] = [];
  for (let i = 0; i < idxs.length - 1; i++) segs.push(markup.slice(idxs[i], idxs[i + 1]));
  return segs;
}

describe("#1468 stage-bar render — the operator-caught bug, at the render surface", () => {
  it("GUARD 1 (primary gate): plan-review FAIL must NOT light the executor pill; glow sits on PLANNER", () => {
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "BLOCK" },
    ]);
    const markup = render(t);
    const [planner, planReview, executor, execReview] = stepSegments(markup);

    // The bug (pre-fix): rolesSeen counts plan-review "done" despite BLOCK, so
    // nextPending === "executor" and the EXECUTOR pill gets the glow class.
    expect(executor).not.toMatch(/ak-pipeline__step--glow/);
    expect(executor).toContain("EXECUTOR");

    // The fix: the glow returns to PLANNER (re-working), not forward.
    expect(planner).toMatch(/ak-pipeline__step--glow/);
    expect(planner).toContain("PLANNER");

    // plan-review itself must read FAILED, not done/pass.
    expect(planReview).not.toMatch(/ak-pipeline__step--(?:done|pass)\b/);
    expect(execReview).not.toMatch(/ak-pipeline__step--glow/);
  });

  it("GUARD 1 + R1 (stray executor comment): even with an executor comment ALREADY present, the executor pill stays grey/not-reached, not done/glow", () => {
    // The exact operator-caught shape: plan-review BLOCKs, but a race/stray
    // executor comment already landed before anyone noticed the fail. The old
    // rolesSeen-only logic would mark executor "done" (bar solid) since it
    // only checks presence, not the upstream verdict.
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "BLOCK" },
      { role: "executor", ts: at(3) },
    ]);
    const markup = render(t);
    const [planner, , executor] = stepSegments(markup);

    expect(executor).not.toMatch(/ak-pipeline__step--(?:done|current|glow)\b/);
    expect(planner).toMatch(/ak-pipeline__step--glow/);
  });

  it("GUARD 2: terminal all-PASS shows no active glow anywhere and a DONE cap", () => {
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "APPROVE" },
      { role: "executor", ts: at(3) },
      { role: "execution-review", ts: at(4), verdict: "PASS" },
    ]);
    const markup = render(t);
    expect(markup).not.toMatch(/ak-pipeline__step--glow/);
    expect(markup).toContain("DONE");
  });

  it("GUARD 3: a no-failure forward fixture still glows exactly the next unreached role (non-regression)", () => {
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "APPROVE" },
    ]);
    const markup = render(t);
    const [planner, planReview, executor, execReview] = stepSegments(markup);

    expect(executor).toMatch(/ak-pipeline__step--glow/);
    expect(planner).not.toMatch(/ak-pipeline__step--glow/);
    expect(planReview).not.toMatch(/ak-pipeline__step--glow/);
    expect(execReview).not.toMatch(/ak-pipeline__step--glow/);
    // Additive proof (not just non-regression): the passed review role now
    // carries an explicit pass tick — a token the pre-fix render never emits.
    expect(planReview).toContain("✓");
  });

  it("GUARD 4: the FAIL fixture's aria-label carries no 'next: EXECUTOR' and no downstream done/next announcement", () => {
    const t = ticket([
      { role: "planner", ts: at(1) },
      { role: "plan-review", ts: at(2), verdict: "BLOCK" },
    ]);
    const markup = render(t);
    const ariaMatch = markup.match(/aria-label="([^"]*)"/);
    const aria = ariaMatch ? ariaMatch[1] : "";

    expect(aria).not.toMatch(/next:\s*EXECUTOR/i);
    expect(aria).not.toMatch(/EXECUTOR (?:done|passed|active)/i);
    // Honest description of the bounce, per brief §5.
    expect(aria).toMatch(/re-working/i);
    expect(aria).toContain("PLAN-REVIEW");
  });
});
