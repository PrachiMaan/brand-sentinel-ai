import { query } from "./_generated/server";
import { hashAuditRow, requireMember } from "./helpers";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const events = await ctx.db
      .query("auditEvents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .order("desc")
      .take(250);
    return events.map((e) => ({
      id: e._id,
      seq: e.seq,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      actorName: e.actorName,
      actorRole: e.actorRole,
      payload: e.payload,
      prevHash: e.prevHash,
      hash: e.hash,
      createdAt: e.createdAt,
    }));
  },
});

export const verifyChain = query({
  args: {},
  handler: async (ctx) => {
    const session = await requireMember(ctx);
    const events = await ctx.db
      .query("auditEvents")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .order("asc")
      .take(2000);
    let previousHash = "GENESIS";
    let expectedSeq = 1;
    for (const event of events) {
      if (event.seq !== expectedSeq) {
        return {
          ok: false,
          count: events.length,
          checkedAt: Date.now(),
          reason: `Sequence gap at entry ${event.seq}; expected ${expectedSeq}.`,
          brokenAt: event.seq,
          head: previousHash,
        };
      }
      if (event.prevHash !== previousHash) {
        return {
          ok: false,
          count: events.length,
          checkedAt: Date.now(),
          reason: `Entry ${event.seq} does not reference the previous hash.`,
          brokenAt: event.seq,
          head: previousHash,
        };
      }
      const recomputed = hashAuditRow({
        seq: event.seq,
        prevHash: event.prevHash,
        actorId: event.actorId,
        actorRole: event.actorRole,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        payload: event.payload,
        createdAt: event.createdAt,
      });
      if (recomputed !== event.hash) {
        return {
          ok: false,
          count: events.length,
          checkedAt: Date.now(),
          reason: `Entry ${event.seq} (${event.action}) fails recomputation. The row was modified after it was written.`,
          brokenAt: event.seq,
          head: previousHash,
        };
      }
      previousHash = event.hash;
      expectedSeq++;
    }
    return {
      ok: true,
      count: events.length,
      checkedAt: Date.now(),
      reason:
        events.length === 0
          ? "No entries yet."
          : `${events.length} entries recomputed and linked correctly.`,
      brokenAt: null,
      head: previousHash,
    };
  },
});
