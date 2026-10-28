import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  appendAudit,
  brandState,
  currentMembership,
  requireMember,
  requireRole,
} from "./helpers";
import { canonicalJson, sha256Hex } from "./lib/sha256";
import { MAX_TEXT_CHARS, REVIEWER_META, STATUS_LABEL } from "./lib/types";
import { GUIDELINE_DOCUMENT } from "./lib/lumora";

const CHANNELS = ["instagram", "email", "linkedin", "landing", "print"] as const;
export const TEAMS = ["Social", "Email", "Web", "Paid"] as const;

function cleanTitle(title: string) {
  const t = title.trim();
  return t.length ? t.slice(0, 120) : "Untitled submission";
}

function contentHash(args: {
  text: string;
  channel: string;
  audience: string;
  altText: string;
}) {
  return sha256Hex(
    canonicalJson({
      text: args.text,
      channel: args.channel,
      audience: args.audience,
      altText: args.altText,
    }),
  );
}

export const create = mutation({
  args: {
    title: v.string(),
    channel: v.string(),
    audience: v.string(),
    text: v.string(),
    altText: v.string(),
    team: v.optional(v.string()),
    sampleId: v.optional(v.string()),
    kind: v.optional(v.string()),
    docName: v.optional(v.string()),
    designTextColor: v.optional(v.string()),
    designBgColor: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    imageName: v.optional(v.string()),
    imagePalette: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["creator", "admin"]);
    const text = args.text.trim();
    if (!text) throw new Error("Add some content before submitting.");
    if (text.length > MAX_TEXT_CHARS) {
      throw new Error(
        `Content is ${text.length.toLocaleString()} characters. The limit is ${MAX_TEXT_CHARS.toLocaleString()}; split it into a document.`,
      );
    }
    if (!CHANNELS.includes(args.channel as (typeof CHANNELS)[number])) {
      throw new Error("Choose a valid channel.");
    }
    if (args.team && !TEAMS.includes(args.team as (typeof TEAMS)[number])) {
      throw new Error("Choose a valid team.");
    }
    const now = Date.now();
    const hash = contentHash({ ...args, text });

    // Double-click guard: an identical submission from the same person in the
    // last minute returns the row that already exists instead of creating one.
    const dupe = await ctx.db
      .query("versions")
      .withIndex("by_submission")
      .collect()
      .then((rows) =>
        rows
          .filter(
            (r) =>
              r.contentHash === hash &&
              r.createdBy === session.userId &&
              now - r.createdAt < 60_000,
          )
          .sort((a, b) => b.createdAt - a.createdAt)[0],
      );
    if (dupe) return dupe.submissionId;

    const submissionId = await ctx.db.insert("submissions", {
      workspaceId: session.workspace._id,
      creatorId: session.userId,
      creatorName: session.membership.displayName,
      title: cleanTitle(args.title),
      channel: args.channel,
      audience: args.audience.trim() || "General audience",
      currentVersion: 1,
      status: "draft",
      team: args.team ?? "Social",
      sampleId: args.sampleId,
      kind: args.kind ?? (args.imageStorageId ? "image" : "text"),
      docName: args.docName,
      imageStorageId: args.imageStorageId,
      imageName: args.imageName,
      altText: args.altText.trim(),
      designTextColor: args.designTextColor,
      designBgColor: args.designBgColor,
      imagePalette: args.imagePalette,
      legalFlag: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("versions", {
      submissionId,
      workspaceId: session.workspace._id,
      version: 1,
      text,
      channel: args.channel,
      audience: args.audience.trim() || "General audience",
      altText: args.altText.trim(),
      contentHash: hash,
      createdAt: now,
      createdBy: session.userId,
    });
    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "submission.created",
      entityType: "submission",
      entityId: submissionId,
      payload: {
        title: cleanTitle(args.title),
        channel: args.channel,
        team: args.team ?? "Social",
        sampleId: args.sampleId ?? null,
        version: 1,
        contentHash: hash,
      },
    });

    if (args.sampleId) {
      const progress = await ctx.db
        .query("demoProgress")
        .withIndex("by_user", (q) =>
          q.eq("workspaceId", session.workspace._id).eq("userId", session.userId),
        )
        .first();
      if (progress) {
        await ctx.db.patch(progress._id, {
          sampleLoadedAt: progress.sampleLoadedAt ?? now,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("demoProgress", {
          workspaceId: session.workspace._id,
          userId: session.userId,
          sampleLoadedAt: now,
          updatedAt: now,
        });
      }
    }
    return submissionId;
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["creator", "admin"]);
    return await ctx.storage.generateUploadUrl();
  },
});

export const resubmit = mutation({
  args: {
    submissionId: v.id("submissions"),
    text: v.string(),
    altText: v.string(),
    designTextColor: v.optional(v.string()),
    designBgColor: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["creator", "admin"]);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== session.workspace._id) {
      throw new Error("Submission not found in this workspace.");
    }
    if (!["draft", "needs_revision"].includes(submission.status)) {
      throw new Error(
        `A new version can only be created from Draft or Needs revision (currently ${STATUS_LABEL[submission.status]}).`,
      );
    }
    const text = args.text.trim();
    if (!text) throw new Error("A new version needs content.");
    const now = Date.now();
    const version = submission.currentVersion + 1;
    const hash = contentHash({
      text,
      channel: submission.channel,
      audience: submission.audience,
      altText: args.altText,
    });
    await ctx.db.insert("versions", {
      submissionId: submission._id,
      workspaceId: submission.workspaceId,
      version,
      text,
      channel: submission.channel,
      audience: submission.audience,
      altText: args.altText.trim(),
      contentHash: hash,
      createdAt: now,
      createdBy: session.userId,
    });
    await ctx.db.patch(submission._id, {
      currentVersion: version,
      status: "draft",
      altText: args.altText.trim(),
      designTextColor: args.designTextColor ?? submission.designTextColor,
      designBgColor: args.designBgColor ?? submission.designBgColor,
      legalFlag: false,
      updatedAt: now,
    });
    await appendAudit(ctx, {
      workspaceId: submission.workspaceId,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "version.created",
      entityType: "submission",
      entityId: submission._id,
      payload: { version, contentHash: hash, note: args.note ?? "" },
    });
    return { version, hash };
  },
});

export const addComment = mutation({
  args: {
    submissionId: v.id("submissions"),
    findingId: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await requireMember(ctx);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== session.workspace._id) {
      throw new Error("Submission not found.");
    }
    const body = args.body.trim();
    if (!body) throw new Error("Write a comment first.");
    await ctx.db.insert("comments", {
      submissionId: submission._id,
      workspaceId: submission.workspaceId,
      findingId: args.findingId,
      authorId: session.userId,
      authorRole: session.membership.role,
      authorName: session.membership.displayName,
      body: body.slice(0, 2000),
      createdAt: Date.now(),
    });
    await appendAudit(ctx, {
      workspaceId: submission.workspaceId,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "comment.added",
      entityType: "submission",
      entityId: submission._id,
      payload: { findingId: args.findingId ?? null, body: body.slice(0, 180) },
    });
  },
});

export const decideFinding = mutation({
  args: {
    findingDocId: v.id("findings"),
    decision: v.union(v.literal("accept"), v.literal("edit"), v.literal("reject")),
    reason: v.optional(v.string()),
    editedFix: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["reviewer", "approver", "admin"]);
    const finding = await ctx.db.get(args.findingDocId);
    if (!finding || finding.workspaceId !== session.workspace._id) {
      throw new Error("Finding not found in this workspace.");
    }
    if (finding.status !== "pending") {
      throw new Error("This finding has already been decided.");
    }
    if (args.decision === "edit" && !args.editedFix?.trim()) {
      throw new Error("Editing a fix needs the new wording.");
    }
    if (args.decision === "reject" && !args.reason?.trim()) {
      throw new Error("Give a short reason when rejecting a finding.");
    }
    const status =
      args.decision === "accept"
        ? "accepted"
        : args.decision === "edit"
          ? "edited"
          : "rejected";
    const now = Date.now();
    await ctx.db.patch(finding._id, { status });
    await ctx.db.insert("decisions", {
      findingDocId: finding._id,
      findingId: finding.findingId,
      submissionId: finding.submissionId,
      workspaceId: finding.workspaceId,
      decision: args.decision,
      reason: args.reason?.trim(),
      editedFix:
        args.decision === "edit"
          ? (args.editedFix ?? "").trim()
          : args.decision === "accept"
            ? finding.suggestedFix
            : undefined,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      createdAt: now,
    });
    await ctx.db.insert("ruleOverrides", {
      workspaceId: finding.workspaceId,
      ruleId: finding.ruleId,
      decision: args.decision,
      actorRole: session.membership.role,
      submissionId: finding.submissionId,
      findingId: finding.findingId,
      seeded: false,
      synthetic: false,
      createdAt: now,
    });
    const progress = await ctx.db
      .query("demoProgress")
      .withIndex("by_user", (q) =>
        q.eq("workspaceId", finding.workspaceId).eq("userId", session.userId),
      )
      .first();
    if (progress) {
      await ctx.db.patch(progress._id, {
        findingDecidedAt: progress.findingDecidedAt ?? now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("demoProgress", {
        workspaceId: finding.workspaceId,
        userId: session.userId,
        findingDecidedAt: now,
        updatedAt: now,
      });
    }
    const submission = await ctx.db.get(finding.submissionId);
    if (submission && submission.status === "findings_ready") {
      await ctx.db.patch(submission._id, {
        status: "human_review",
        updatedAt: now,
      });
    }
    await appendAudit(ctx, {
      workspaceId: finding.workspaceId,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: `finding.${status}`,
      entityType: "finding",
      entityId: finding.findingId,
      payload: {
        ruleId: finding.ruleId,
        reviewer: finding.reviewer,
        severity: finding.severity,
        reason: args.reason ?? "",
        editedFix: args.editedFix ?? "",
        evidence: finding.spanText,
      },
    });
    return { status };
  },
});

export const escalateLegal = mutation({
  args: { findingDocId: v.id("findings"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["approver", "admin"]);
    const finding = await ctx.db.get(args.findingDocId);
    if (!finding || finding.workspaceId !== session.workspace._id) {
      throw new Error("Finding not found.");
    }
    if (finding.reviewer !== "claims") {
      throw new Error("Only claims findings can be escalated to Legal.");
    }
    if (finding.status !== "pending") {
      throw new Error("This finding has already been decided.");
    }
    const now = Date.now();
    await ctx.db.patch(finding._id, { status: "escalated_legal" });
    await ctx.db.patch(finding.submissionId, { legalFlag: true, updatedAt: now });
    await ctx.db.insert("ruleOverrides", {
      workspaceId: finding.workspaceId,
      ruleId: finding.ruleId,
      decision: "escalate",
      actorRole: session.membership.role,
      submissionId: finding.submissionId,
      findingId: finding.findingId,
      seeded: false,
      synthetic: false,
      createdAt: now,
    });
    await ctx.db.insert("legalCases", {
      workspaceId: finding.workspaceId,
      submissionId: finding.submissionId,
      findingDocId: finding._id,
      findingId: finding.findingId,
      ruleId: finding.ruleId,
      claimId: finding.claimId,
      excerpt: finding.spanText.slice(0, 400),
      reason: args.note?.trim() || "Escalated to Legal by approver",
      status: "open",
      openedBy: session.membership.displayName,
      openedAt: now,
    });
    await appendAudit(ctx, {
      workspaceId: finding.workspaceId,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "finding.escalated_legal",
      entityType: "finding",
      entityId: finding.findingId,
      payload: {
        ruleId: finding.ruleId,
        claimId: finding.claimId ?? null,
        note: args.note ?? "Escalated to Legal by approver",
      },
    });
    return { status: "escalated_legal" };
  },
});

export const requestRevision = mutation({
  args: { submissionId: v.id("submissions"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["reviewer", "approver", "admin"]);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== session.workspace._id) {
      throw new Error("Submission not found.");
    }
    if (!["findings_ready", "human_review"].includes(submission.status)) {
      throw new Error("Revision can only be requested during human review.");
    }
    await ctx.db.patch(submission._id, {
      status: "needs_revision",
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      workspaceId: submission.workspaceId,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "submission.needs_revision",
      entityType: "submission",
      entityId: submission._id,
      payload: { note: args.note ?? "", version: submission.currentVersion },
    });
  },
});

export const approve = mutation({
  args: { submissionId: v.id("submissions"), note: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["approver", "admin"]);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== session.workspace._id) {
      throw new Error("Submission not found.");
    }
    if (!["findings_ready", "human_review"].includes(submission.status)) {
      throw new Error("This submission is not waiting for approval.");
    }
    const findings = await ctx.db
      .query("findings")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    const blocking = findings.filter(
      (f) =>
        f.status === "pending" &&
        f.bucket === "verified" &&
        (f.severity === "critical" || f.severity === "high"),
    );
    if (blocking.length) {
      throw new Error(
        `Resolve ${blocking.length} pending critical/high finding${blocking.length === 1 ? "" : "s"} before approving.`,
      );
    }
    const now = Date.now();
    await ctx.db.patch(submission._id, {
      status: "approved",
      updatedAt: now,
    });
    const progress = await ctx.db
      .query("demoProgress")
      .withIndex("by_user", (q) =>
        q.eq("workspaceId", submission.workspaceId).eq("userId", session.userId),
      )
      .first();
    if (progress) {
      await ctx.db.patch(progress._id, {
        approvedAt: progress.approvedAt ?? now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("demoProgress", {
        workspaceId: submission.workspaceId,
        userId: session.userId,
        approvedAt: now,
        updatedAt: now,
      });
    }
    await appendAudit(ctx, {
      workspaceId: submission.workspaceId,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "submission.approved",
      entityType: "submission",
      entityId: submission._id,
      payload: {
        version: submission.currentVersion,
        note: args.note ?? "",
        legalEscalations: findings.filter((f) => f.status === "escalated_legal").length,
        unresolved: findings.filter((f) => f.status === "pending").length,
      },
    });
    return { status: "approved" };
  },
});

export const reject = mutation({
  args: { submissionId: v.id("submissions"), reason: v.string() },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["approver", "admin"]);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== session.workspace._id) {
      throw new Error("Submission not found.");
    }
    if (!["findings_ready", "human_review"].includes(submission.status)) {
      throw new Error("This submission is not waiting for a decision.");
    }
    if (args.reason.trim().length < 3) {
      throw new Error("Give a short reason for rejection.");
    }
    await ctx.db.patch(submission._id, {
      status: "rejected",
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      workspaceId: submission.workspaceId,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "submission.rejected",
      entityType: "submission",
      entityId: submission._id,
      payload: { version: submission.currentVersion, reason: args.reason.slice(0, 300) },
    });
  },
});

export const markReceiptExported = mutation({
  args: { submissionId: v.id("submissions"), receiptHash: v.string() },
  handler: async (ctx, args) => {
    const session = await requireMember(ctx);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== session.workspace._id) {
      throw new Error("Submission not found.");
    }
    if (submission.status !== "approved") {
      throw new Error("A receipt is only available for an approved submission.");
    }
    const stamp = Date.now();
    await ctx.db.patch(submission._id, {
      status: "receipt_exported",
      updatedAt: stamp,
    });
    const progress = await ctx.db
      .query("demoProgress")
      .withIndex("by_user", (q) =>
        q.eq("workspaceId", submission.workspaceId).eq("userId", session.userId),
      )
      .first();
    if (progress) {
      await ctx.db.patch(progress._id, { receiptAt: progress.receiptAt ?? stamp, updatedAt: stamp });
    } else {
      await ctx.db.insert("demoProgress", {
        workspaceId: submission.workspaceId,
        userId: session.userId,
        receiptAt: stamp,
        updatedAt: stamp,
      });
    }
    await appendAudit(ctx, {
      workspaceId: submission.workspaceId,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "receipt.exported",
      entityType: "submission",
      entityId: submission._id,
      payload: {
        version: submission.currentVersion,
        receiptHash: args.receiptHash,
      },
    });
    return { status: "receipt_exported" };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const session = await currentMembership(ctx);
    if (!session) return [];
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .order("desc")
      .take(60);
    const findings = await ctx.db
      .query("findings")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .collect();
    return submissions.map((s) => {
      const own = findings.filter((f) => f.submissionId === s._id);
      return {
        id: s._id,
        title: s.title,
        status: s.status,
        channel: s.channel,
        audience: s.audience,
        creatorName: s.creatorName,
        version: s.currentVersion,
        brandFit: s.brandFit,
        legalFlag: s.legalFlag,
        updatedAt: s.updatedAt,
        findingCount: own.length,
        pendingCount: own.filter((f) => f.status === "pending").length,
        hasImage: Boolean(s.imageStorageId),
      };
    });
  },
});

export const get = query({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const session = await requireMember(ctx);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== session.workspace._id) {
      return null;
    }
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    const run = submission.lastRunId
      ? await ctx.db.get(submission.lastRunId)
      : await ctx.db
          .query("runs")
          .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
          .order("desc")
          .first();
    const findings = run
      ? await ctx.db
          .query("findings")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .collect()
      : [];
    const findingIds = new Set(findings.map((f) => f.findingId));
    const decisions = (
      await ctx.db
        .query("decisions")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .collect()
    ).filter((d) => findingIds.has(d.findingId));
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    const brand = await brandState(ctx, session.workspace._id);
    const imageUrl = submission.imageStorageId
      ? await ctx.storage.getUrl(submission.imageStorageId)
      : null;
    const calls = run
      ? await ctx.db
          .query("llmCalls")
          .withIndex("by_run", (q) => q.eq("runId", run._id))
          .collect()
      : [];
    const auditHead = await ctx.db
      .query("auditEvents")
      .withIndex("by_workspace", (q) =>
        q.eq("workspaceId", session.workspace._id),
      )
      .order("desc")
      .first();
    const currentVersion =
      versions.find((ver) => ver.version === submission.currentVersion) ?? null;
    return {
      role: session.membership.role,
      displayName: session.membership.displayName,
      workspaceName: session.workspace.name,
      submission: {
        ...submission,
        imageUrl,
      },
      currentVersion,
      versions: versions
        .sort((a, b) => b.version - a.version)
        .map((ver) => ({
          id: ver._id,
          version: ver.version,
          contentHash: ver.contentHash,
          createdAt: ver.createdAt,
          chars: ver.text.length,
        })),
      run: run
        ? {
            id: run._id,
            status: run.status,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt ?? null,
            fastMs: run.fastMs,
            deepMs: run.deepMs ?? null,
            progress: run.progress,
            verifier: run.verifier ? JSON.parse(run.verifier) : null,
            brandFit: run.brandFit ?? null,
            counts: run.counts ? JSON.parse(run.counts) : null,
            summary: run.summary ?? null,
            droppedLog: run.droppedLog ? JSON.parse(run.droppedLog) : [],
            error: run.error ?? null,
            model: run.model ?? null,
            source: run.source ?? "live",
            degradedCause: run.degradedCause ?? null,
            version: run.version,
          }
        : null,
      findings: findings
        .sort((a, b) => a.order - b.order)
        .map((f) => ({
          docId: f._id,
          id: f.findingId,
          reviewer: f.reviewer as keyof typeof REVIEWER_META,
          severity: f.severity,
          confidence: f.confidence,
          spanText: f.spanText,
          spanStart: f.spanStart,
          spanEnd: f.spanEnd,
          ruleId: f.ruleId,
          guidelineExcerpt: f.guidelineExcerpt,
          whyItMatters: f.whyItMatters,
          suggestedFix: f.suggestedFix,
          status: f.status,
          source: f.source,
          bucket: f.bucket,
          evidenceType: f.evidenceType,
          measuredValue: f.measuredValue ?? null,
          claimStatus: f.claimStatus ?? null,
          claimId: f.claimId ?? null,
          intentScore: f.intentScore ?? null,
          fixRisk: f.fixRisk ?? null,
          page: f.page ?? null,
          bbox: f.bbox ?? null,
          measured: f.measured ?? null,
          threshold: f.threshold ?? null,
        })),
      decisions: decisions.map((d) => ({
        findingId: d.findingId,
        decision: d.decision,
        reason: d.reason ?? null,
        editedFix: d.editedFix ?? null,
        actorName: d.actorName,
        actorRole: d.actorRole,
        createdAt: d.createdAt,
      })),
      comments: comments.map((c) => ({
        id: c._id,
        findingId: c.findingId ?? null,
        authorName: c.authorName,
        authorRole: c.authorRole,
        body: c.body,
        createdAt: c.createdAt,
      })),
      rules: brand.rules,
      claims: brand.claims,
      glossary: brand.glossary,
      brandPack: brand.pack
        ? {
            name: brand.pack.name,
            version: brand.pack.version,
            palette: brand.pack.palette,
            voice: brand.pack.voice,
          }
        : null,
      guidelineChars: GUIDELINE_DOCUMENT.length,
      auditHead: auditHead
        ? { seq: auditHead.seq, hash: auditHead.hash }
        : { seq: 0, hash: "GENESIS" },
      calls: calls.map((c) => ({
        purpose: c.purpose,
        model: c.model,
        latencyMs: c.latencyMs,
        inputTokens: c.inputTokens ?? null,
        outputTokens: c.outputTokens ?? null,
        ok: c.ok,
        redactions: c.redactions,
      })),
    };
  },
});
