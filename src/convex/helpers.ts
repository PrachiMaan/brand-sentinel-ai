import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { canonicalJson, sha256Hex } from "./lib/sha256";
import { RULES, CLAIMS, GLOSSARY, PALETTE, VOICE } from "./lib/lumora";

export type Ctx = QueryCtx | MutationCtx;

export async function signedInUserId(ctx: Ctx): Promise<Id<"users"> | null> {
  return (await getAuthUserId(ctx)) as Id<"users"> | null;
}

export async function requireUser(ctx: Ctx): Promise<Id<"users">> {
  const userId = await signedInUserId(ctx);
  if (!userId) throw new Error("Sign in to continue.");
  return userId;
}

export async function currentMembership(ctx: Ctx) {
  const userId = await signedInUserId(ctx);
  if (!userId) return null;
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!membership) return null;
  const workspace = await ctx.db.get(membership.workspaceId);
  if (!workspace) return null;
  return { userId, membership, workspace };
}

export async function requireMember(ctx: Ctx) {
  const session = await currentMembership(ctx);
  if (!session) throw new Error("No workspace membership. Enter the demo first.");
  return session;
}

export async function requireRole(
  ctx: Ctx,
  allowed: ("creator" | "reviewer" | "approver" | "admin")[],
) {
  const session = await requireMember(ctx);
  if (!allowed.includes(session.membership.role)) {
    throw new Error(
      `This action needs the ${allowed.join(" or ")} role. You are currently ${session.membership.role}.`,
    );
  }
  return session;
}

export async function brandState(ctx: Ctx, workspaceId: Id<"workspaces">) {
  const pack = await ctx.db
    .query("brandPacks")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
  const rules = await ctx.db
    .query("rules")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const claims = await ctx.db
    .query("claims")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const glossary = await ctx.db
    .query("glossary")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  return {
    pack,
    rules: rules.filter((r) => r.published).sort((a, b) => a.order - b.order),
    allRules: rules.sort((a, b) => a.order - b.order),
    claims: claims.sort((a, b) => a.claimId.localeCompare(b.claimId)),
    glossary,
  };
}

/**
 * Append-only, hash-chained audit entry. Each row commits to the previous row's
 * hash, so editing or deleting history breaks verification.
 */
export async function appendAudit(
  ctx: MutationCtx,
  args: {
    workspaceId: Id<"workspaces">;
    actorId: string;
    actorRole: string;
    actorName: string;
    action: string;
    entityType: string;
    entityId: string;
    payload?: unknown;
    createdAt?: number;
  },
) {
  const previous = await ctx.db
    .query("auditEvents")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
    .order("desc")
    .first();
  const seq = (previous?.seq ?? 0) + 1;
  const prevHash = previous?.hash ?? "GENESIS";
  const createdAt = args.createdAt ?? Date.now();
  const payload = canonicalJson(args.payload ?? {});
  const hash = sha256Hex(
    canonicalJson({
      seq,
      prevHash,
      actorId: args.actorId,
      actorRole: args.actorRole,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      payload,
      createdAt,
    }),
  );
  await ctx.db.insert("auditEvents", {
    workspaceId: args.workspaceId,
    seq,
    actorId: args.actorId,
    actorRole: args.actorRole,
    actorName: args.actorName,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    payload,
    prevHash,
    hash,
    createdAt,
  });
  return { seq, hash };
}

export function hashAuditRow(row: {
  seq: number;
  prevHash: string;
  actorId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: string;
  createdAt: number;
}) {
  return sha256Hex(
    canonicalJson({
      seq: row.seq,
      prevHash: row.prevHash,
      actorId: row.actorId,
      actorRole: row.actorRole,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      payload: row.payload,
      createdAt: row.createdAt,
    }),
  );
}

export const SEED_MARKER_SLUG = "lumora-studio";

/** Idempotent seed. Returns the workspace id and creates the Lumora pack once. */
export async function ensureWorkspace(ctx: MutationCtx) {
  const existing = await ctx.db
    .query("workspaces")
    .withIndex("by_slug", (q) => q.eq("slug", SEED_MARKER_SLUG))
    .first();
  if (existing) return existing._id;

  const now = Date.now();
  const workspaceId = await ctx.db.insert("workspaces", {
    name: "Lumora Studio",
    slug: SEED_MARKER_SLUG,
    seeded: true,
    createdAt: now,
  });

  await ctx.db.insert("brandPacks", {
    workspaceId,
    name: "Lumora",
    version: "Edition 4 · March 2026",
    status: "published",
    palette: PALETTE,
    voice: VOICE,
    updatedAt: now,
  });

  for (const [index, rule] of RULES.entries()) {
    await ctx.db.insert("rules", {
      workspaceId,
      ruleId: rule.ruleId,
      category: rule.category,
      type: rule.type,
      title: rule.title,
      description: rule.description,
      severity: rule.severity,
      sourceExcerpt: rule.sourceExcerpt,
      published: true,
      order: index,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const claim of CLAIMS) {
    await ctx.db.insert("claims", {
      workspaceId,
      claimId: claim.claimId,
      text: claim.text,
      status: claim.status,
      approvedWording: claim.approvedWording,
      evidence: claim.evidence,
      owner: claim.owner,
      expiresAt: claim.expiresAt ?? undefined,
      createdAt: now,
    });
  }

  for (const term of GLOSSARY) {
    await ctx.db.insert("glossary", {
      workspaceId,
      term: term.term,
      status: term.status,
      replacement: term.replacement || undefined,
      note: term.note,
    });
  }

  // A small, clearly-labelled demo history so the override table is not empty
  // on first visit. Every row is marked seeded and the UI says so.
  const seededHistory: [string, ("accept" | "edit" | "reject")[]][] = [
    ["R-TONE-01", ["accept", "accept", "accept", "edit", "accept", "reject"]],
    ["R-TERM-01", ["accept", "accept", "edit", "accept"]],
    ["R-TERM-02", ["accept", "accept", "accept", "accept", "edit"]],
    ["R-TERM-03", ["accept", "reject", "accept", "accept"]],
    ["R-CLAIM-01", ["accept", "accept", "edit", "accept", "accept"]],
    ["R-CLAIM-03", ["accept", "accept", "accept"]],
    ["R-A11Y-01", ["accept", "edit", "accept", "accept"]],
    ["R-A11Y-02", ["accept", "accept", "reject"]],
    ["R-VIS-01", ["reject", "accept", "accept", "accept"]],
    ["R-CHAN-01", ["accept", "reject"]],
  ];
  let i = 0;
  for (const [ruleId, decisions] of seededHistory) {
    for (const decision of decisions) {
      const createdAt = now - (seededHistory.length * 10 - i) * 36e5;
      await ctx.db.insert("ruleOverrides", {
        workspaceId,
        ruleId,
        decision,
        actorRole: i % 3 === 0 ? "reviewer" : "approver",
        submissionId: "seeded-history",
        findingId: `seed-${ruleId}-${i}`,
        seeded: true,
        createdAt,
      });
      i++;
    }
  }

  await appendAudit(ctx, {
    workspaceId,
    actorId: "system",
    actorRole: "system",
    actorName: "BrandSentinel",
    action: "brandpack.published",
    entityType: "brandPack",
    entityId: "Lumora Edition 4",
    payload: { rules: RULES.length, claims: CLAIMS.length, source: "seed" },
    createdAt: now,
  });

  return workspaceId;
}

export type BrandRule = Doc<"rules">;
