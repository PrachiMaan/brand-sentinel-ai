import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// Default user roles required by the template.
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

export const workspaceRole = v.union(
  v.literal("creator"),
  v.literal("reviewer"),
  v.literal("approver"),
  v.literal("admin"),
);

export const submissionStatus = v.union(
  v.literal("draft"),
  v.literal("ai_review"),
  v.literal("findings_ready"),
  v.literal("human_review"),
  v.literal("needs_revision"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("receipt_exported"),
);

const paletteEntry = v.object({
  name: v.string(),
  hex: v.string(),
  use: v.optional(v.string()),
});

const schema = defineSchema(
  {
    ...authTables, // do not remove or modify

    users: defineTable({
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      role: v.optional(roleValidator),
    }).index("email", ["email"]),

    workspaces: defineTable({
      name: v.string(),
      slug: v.string(),
      seeded: v.optional(v.boolean()),
      createdAt: v.number(),
    }).index("by_slug", ["slug"]),

    memberships: defineTable({
      userId: v.id("users"),
      workspaceId: v.id("workspaces"),
      role: workspaceRole,
      displayName: v.string(),
      isDemo: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_workspace", ["workspaceId"]),

    brandPacks: defineTable({
      workspaceId: v.id("workspaces"),
      name: v.string(),
      version: v.string(),
      status: v.union(v.literal("draft"), v.literal("published")),
      palette: v.array(paletteEntry),
      voice: v.object({
        descriptors: v.array(v.string()),
        sounds: v.array(v.string()),
        avoids: v.array(v.string()),
        sample: v.string(),
      }),
      updatedAt: v.number(),
    }).index("by_workspace", ["workspaceId"]),

    rules: defineTable({
      workspaceId: v.id("workspaces"),
      ruleId: v.string(),
      category: v.union(
        v.literal("tone"),
        v.literal("terminology"),
        v.literal("claims"),
        v.literal("visual"),
        v.literal("accessibility"),
        v.literal("naming"),
        v.literal("channel"),
      ),
      type: v.union(
        v.literal("deterministic"),
        v.literal("measurable"),
        v.literal("judgment"),
      ),
      title: v.string(),
      description: v.string(),
      severity: v.union(
        v.literal("critical"),
        v.literal("high"),
        v.literal("medium"),
        v.literal("low"),
      ),
      sourceExcerpt: v.string(),
      published: v.boolean(),
      order: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_workspace", ["workspaceId"])
      .index("by_workspace_ruleId", ["workspaceId", "ruleId"]),

    glossary: defineTable({
      workspaceId: v.id("workspaces"),
      term: v.string(),
      status: v.union(
        v.literal("preferred"),
        v.literal("banned"),
        v.literal("deprecated"),
      ),
      replacement: v.optional(v.string()),
      note: v.optional(v.string()),
    }).index("by_workspace", ["workspaceId"]),

    claims: defineTable({
      workspaceId: v.id("workspaces"),
      claimId: v.string(),
      text: v.string(),
      status: v.union(
        v.literal("approved"),
        v.literal("expiring"),
        v.literal("expired"),
      ),
      approvedWording: v.string(),
      evidence: v.string(),
      owner: v.string(),
      expiresAt: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_workspace", ["workspaceId"]),

    submissions: defineTable({
      workspaceId: v.id("workspaces"),
      creatorId: v.id("users"),
      creatorName: v.string(),
      title: v.string(),
      channel: v.string(),
      audience: v.string(),
      currentVersion: v.number(),
      status: submissionStatus,
      imageStorageId: v.optional(v.id("_storage")),
      imageName: v.optional(v.string()),
      altText: v.string(),
      designTextColor: v.optional(v.string()),
      designBgColor: v.optional(v.string()),
      imagePalette: v.optional(v.string()),
      brandFit: v.optional(v.number()),
      lastRunId: v.optional(v.id("runs")),
      legalFlag: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_workspace", ["workspaceId"])
      .index("by_status", ["workspaceId", "status"]),

    versions: defineTable({
      submissionId: v.id("submissions"),
      workspaceId: v.id("workspaces"),
      version: v.number(),
      text: v.string(),
      channel: v.string(),
      audience: v.string(),
      altText: v.string(),
      contentHash: v.string(),
      createdAt: v.number(),
      createdBy: v.id("users"),
    }).index("by_submission", ["submissionId"]),

    runs: defineTable({
      submissionId: v.id("submissions"),
      workspaceId: v.id("workspaces"),
      versionId: v.id("versions"),
      version: v.number(),
      status: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("complete"),
        v.literal("degraded"),
        v.literal("failed"),
      ),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
      fastMs: v.number(),
      deepMs: v.optional(v.number()),
      progress: v.array(
        v.object({
          reviewer: v.string(),
          status: v.string(),
          ms: v.optional(v.number()),
        }),
      ),
      verifier: v.optional(v.string()),
      brandFit: v.optional(v.number()),
      counts: v.optional(v.string()),
      summary: v.optional(v.string()),
      droppedLog: v.optional(v.string()),
      error: v.optional(v.string()),
      model: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_submission", ["submissionId"])
      .index("by_status", ["status"]),

    findings: defineTable({
      runId: v.id("runs"),
      submissionId: v.id("submissions"),
      workspaceId: v.id("workspaces"),
      findingId: v.string(),
      reviewer: v.string(),
      severity: v.string(),
      confidence: v.number(),
      spanText: v.string(),
      spanStart: v.number(),
      spanEnd: v.number(),
      ruleId: v.string(),
      guidelineExcerpt: v.string(),
      whyItMatters: v.string(),
      suggestedFix: v.string(),
      status: v.string(),
      source: v.string(),
      bucket: v.string(),
      evidenceType: v.string(),
      measuredValue: v.optional(v.string()),
      claimStatus: v.optional(v.string()),
      claimId: v.optional(v.string()),
      intentScore: v.optional(v.number()),
      fixRisk: v.optional(v.string()),
      order: v.number(),
      createdAt: v.number(),
    })
      .index("by_run", ["runId"])
      .index("by_submission", ["submissionId"])
      .index("by_workspace", ["workspaceId"])
      .index("by_findingId", ["submissionId", "findingId"]),

    decisions: defineTable({
      findingDocId: v.id("findings"),
      findingId: v.string(),
      submissionId: v.id("submissions"),
      workspaceId: v.id("workspaces"),
      decision: v.union(
        v.literal("accept"),
        v.literal("edit"),
        v.literal("reject"),
      ),
      reason: v.optional(v.string()),
      editedFix: v.optional(v.string()),
      actorId: v.id("users"),
      actorRole: v.string(),
      actorName: v.string(),
      createdAt: v.number(),
    })
      .index("by_submission", ["submissionId"])
      .index("by_finding", ["findingDocId"]),

    comments: defineTable({
      submissionId: v.id("submissions"),
      workspaceId: v.id("workspaces"),
      findingId: v.optional(v.string()),
      authorId: v.id("users"),
      authorRole: v.string(),
      authorName: v.string(),
      body: v.string(),
      createdAt: v.number(),
    }).index("by_submission", ["submissionId"]),

    auditEvents: defineTable({
      workspaceId: v.id("workspaces"),
      seq: v.number(),
      actorId: v.string(),
      actorRole: v.string(),
      actorName: v.string(),
      action: v.string(),
      entityType: v.string(),
      entityId: v.string(),
      payload: v.string(),
      prevHash: v.string(),
      hash: v.string(),
      createdAt: v.number(),
    }).index("by_workspace", ["workspaceId", "seq"]),

    llmCalls: defineTable({
      workspaceId: v.optional(v.id("workspaces")),
      submissionId: v.optional(v.id("submissions")),
      runId: v.optional(v.id("runs")),
      purpose: v.string(),
      provider: v.string(),
      model: v.string(),
      promptHash: v.string(),
      latencyMs: v.number(),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      ok: v.boolean(),
      error: v.optional(v.string()),
      redactions: v.number(),
      createdAt: v.number(),
    })
      .index("by_run", ["runId"])
      .index("by_created", ["createdAt"]),

    ruleOverrides: defineTable({
      workspaceId: v.id("workspaces"),
      ruleId: v.string(),
      decision: v.union(
        v.literal("accept"),
        v.literal("edit"),
        v.literal("reject"),
        v.literal("escalate"),
      ),
      actorRole: v.string(),
      submissionId: v.string(),
      findingId: v.string(),
      seeded: v.optional(v.boolean()),
      createdAt: v.number(),
    }).index("by_workspace", ["workspaceId"]),

    compileJobs: defineTable({
      workspaceId: v.id("workspaces"),
      filename: v.string(),
      status: v.union(
        v.literal("extracting"),
        v.literal("proposed"),
        v.literal("published"),
        v.literal("failed"),
      ),
      chars: v.number(),
      proposal: v.optional(v.string()),
      error: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_workspace", ["workspaceId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
