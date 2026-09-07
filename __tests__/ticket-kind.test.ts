// ticket-kind.test.ts — AC-1.1's jest half: the resolver in lib/ticket-kind.ts
// reproduces `EXPECTED.json`'s `resolvedKind` for every fixture id in the shared
// S0 fixture store (byte-identical copy at __tests__/fixtures/task-kind-store/,
// see AC-1.1's diff -r half). Explicitly covers legacy `kind: bug` ⇒ work (9013)
// and an unknown/absent value ⇒ work fallback.

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveTicketKind, type KindableTask } from "@/lib/ticket-kind";

const STORE_ROOT = path.join(__dirname, "fixtures", "task-kind-store");
const SESSION_DIR = path.join(STORE_ROOT, "fixture-session-000");

interface ExpectedEntry {
  resolvedKind: string;
  sweepAction: string;
}

function loadExpected(): Record<string, ExpectedEntry> {
  const raw = fs.readFileSync(path.join(SESSION_DIR, "EXPECTED.json"), "utf8");
  return JSON.parse(raw);
}

function loadFixtureTickets(): KindableTask[] {
  const files = fs
    .readdirSync(SESSION_DIR)
    .filter((f) => f.endsWith(".json") && f !== "EXPECTED.json");
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(SESSION_DIR, f), "utf8")));
}

describe("resolveTicketKind against the shared S0 fixture", () => {
  const expected = loadExpected();
  const tickets = loadFixtureTickets();

  it("the fixture store is non-empty and matches EXPECTED.json 1:1", () => {
    expect(tickets.length).toBeGreaterThan(0);
    expect(tickets.length).toBe(Object.keys(expected).length);
  });

  it("resolves every fixture id to EXPECTED.json's resolvedKind", () => {
    for (const ticket of tickets) {
      const id = (ticket as { id?: string }).id;
      expect(id).toBeDefined();
      const entry = expected[id as string];
      expect(entry).toBeDefined();
      expect(resolveTicketKind(ticket)).toBe(entry.resolvedKind);
    }
  });

  it("legacy metadata.kind:'bug' (9013) resolves to work (not in the enum ⇒ fallback)", () => {
    const t = tickets.find((tk) => (tk as { id?: string }).id === "9013");
    expect(t).toBeDefined();
    expect((t as { metadata?: { kind?: string } }).metadata?.kind).toBe("bug");
    expect(resolveTicketKind(t)).toBe("work");
  });

  it("a plain unstamped ticket with no noise prefix (9001) resolves to work", () => {
    const t = tickets.find((tk) => (tk as { id?: string }).id === "9001");
    expect(t).toBeDefined();
    expect(resolveTicketKind(t)).toBe("work");
  });

  it("an entirely unknown metadata.kind value falls back to work (not just legacy 'bug')", () => {
    expect(resolveTicketKind({ subject: "plain", metadata: { kind: "totally-unknown" } })).toBe(
      "work"
    );
  });

  it("undefined/null task input resolves to work (defensive default)", () => {
    expect(resolveTicketKind(undefined)).toBe("work");
    expect(resolveTicketKind(null)).toBe("work");
  });
});
