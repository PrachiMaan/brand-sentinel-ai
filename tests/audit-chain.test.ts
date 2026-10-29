import { describe, expect, it } from "bun:test";
import { hashAuditRow } from "../src/convex/helpers";

type Row = Parameters<typeof hashAuditRow>[0] & { hash: string; prevHash: string };

/** The same verification loop the app runs (src/convex/audit.ts), over synthetic rows. */
function buildChain(count: number): Row[] {
  const rows: Row[] = [];
  let prevHash = "GENESIS";
  for (let seq = 1; seq <= count; seq++) {
    const base = {
      seq,
      prevHash,
      actorId: `user-${seq % 3}`,
      actorRole: seq % 2 ? "creator" : "approver",
      action: seq % 2 ? "finding.accepted" : "submission.approved",
      entityType: "submission",
      entityId: `sub-${seq}`,
      payload: JSON.stringify({ note: `entry ${seq}` }),
      createdAt: 1_760_000_000_000 + seq * 1000,
    };
    const hash = hashAuditRow(base);
    rows.push({ ...base, hash });
    prevHash = hash;
  }
  return rows;
}

function verify(rows: Row[]) {
  let previousHash = "GENESIS";
  let expectedSeq = 1;
  for (const event of rows) {
    if (event.seq !== expectedSeq) return { ok: false, brokenAt: event.seq };
    if (event.prevHash !== previousHash) return { ok: false, brokenAt: event.seq };
    const recomputed = hashAuditRow(event);
    if (recomputed !== event.hash) return { ok: false, brokenAt: event.seq };
    previousHash = event.hash;
    expectedSeq++;
  }
  return { ok: true, brokenAt: null };
}

describe("hash-chained audit trail", () => {
  it("verifies an intact chain", () => {
    const rows = buildChain(25);
    expect(verify(rows)).toEqual({ ok: true, brokenAt: null });
  });

  it("detects an edited row", () => {
    const rows = buildChain(10);
    rows[6] = { ...rows[6], payload: JSON.stringify({ note: "tampered" }) };
    expect(verify(rows).ok).toBe(false);
    expect(verify(rows).brokenAt).toBe(7);
  });

  it("detects a removed row", () => {
    const rows = buildChain(10);
    rows.splice(4, 1);
    expect(verify(rows).ok).toBe(false);
  });

  it("detects a reordered row", () => {
    const rows = buildChain(10);
    const moved = rows.pop()!;
    rows.unshift(moved);
    expect(verify(rows).ok).toBe(false);
  });

  it("is stable: the same inputs hash to the same value", () => {
    const a = buildChain(5);
    const b = buildChain(5);
    expect(a.map((r) => r.hash)).toEqual(b.map((r) => r.hash));
  });
});
