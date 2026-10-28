import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { appendAudit, brandState, requireMember, requireRole } from "./helpers";
import { verifyDeterministic } from "./lib/verifier";
import type { Finding } from "./lib/types";

/**
 * Visual review persistence. The deterministic engine runs in the browser on
 * the rasterised pages; this file is the gate. Anything without a rule, a page
 * in range, a box inside the page and a measured value is dropped here, so a
 * client bug cannot put a boxless claim in front of a reviewer.
 */

export const attachPages = mutation({
  args: {
    submissionId: v.id("submissions"),
    pages: v.array(
      v.object({
        page: v.number(),
        storageId: v.id("_storage"),
        width: v.number(),
        height: v.number(),
        sha256: v.string(),
        text: v.string(),
      }),
    ),
    kind: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["creator", "admin"]);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== session.workspace._id) {
      throw new Error("Submission not found in this workspace.");
    }
    if (!args.pages.length) throw new Error("No pages were supplied.");
    if (args.pages.length > 30) throw new Error("A deck can have at most 30 pages.");
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    const version = versions.find((row) => row.version === submission.currentVersion);
    if (!version) throw new Error("The current version is missing.");

    const existing = await ctx.db
      .query("visualAssets")
      .withIndex("by_version", (q) => q.eq("versionId", version._id))
      .collect();
    for (const row of existing) await ctx.db.delete(row._id);

    const ordered = [...args.pages].sort((a, b) => a.page - b.page);
    for (const page of ordered) {
      await ctx.db.insert("visualAssets", {
        submissionId: submission._id,
        versionId: version._id,
        workspaceId: submission.workspaceId,
        page: page.page,
        width: page.width,
        height: page.height,
        storageId: page.storageId,
        kind: args.kind,
        sha256: page.sha256,
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch(version._id, {
      pageCount: ordered.length,
      pageTexts: JSON.stringify(ordered.map((p) => ({ page: p.page, text: p.text }))),
    });
    await ctx.db.patch(submission._id, {
      kind: args.kind,
      updatedAt: Date.now(),
    });
    await appendAudit(ctx, {
      workspaceId: submission.workspaceId,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "visual.pages_attached",
      entityType: "submission",
      entityId: submission._id,
      payload: {
        pages: ordered.length,
        version: version.version,
        hashes: ordered.map((p) => p.sha256.slice(0, 12)),
      },
    });
    return { pages: ordered.length };
  },
});

export const submitFindings = mutation({
  args: {
    submissionId: v.id("submissions"),
    findingsJson: v.string(),
    thresholdsJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["creator", "admin"]);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== session.workspace._id) {
      throw new Error("Submission not found in this workspace.");
    }
    const brand = await brandState(ctx, submission.workspaceId);
    const versions = await ctx.db
      .query("versions")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    const version = versions.find((row) => row.version === submission.currentVersion);
    if (!version) throw new Error("The current version is missing.");
    const pageCount = version.pageCount ?? 1;

    let parsed: Finding[];
    try {
      parsed = JSON.parse(args.findingsJson) as Finding[];
    } catch {
      throw new Error("The visual findings were not valid JSON.");
    }
    if (!Array.isArray(parsed)) throw new Error("Visual findings must be a list.");
    if (parsed.length > 80) parsed = parsed.slice(0, 80);

    const run = submission.lastRunId
      ? await ctx.db.get(submission.lastRunId)
      : await ctx.db
          .query("runs")
          .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
          .order("desc")
          .first();
    if (!run) throw new Error("Run the text review before attaching visual findings.");

    const runText = version.text;
    const kept: Finding[] = [];
    const dropped: { ruleId: string; page?: number; reason: string }[] = [];
    for (const finding of parsed) {
      if (finding.reviewer !== "visual") {
        dropped.push({ ruleId: finding.ruleId, page: finding.page, reason: "not a visual finding" });
        continue;
      }
      if (!finding.page || !finding.bbox || !finding.measured?.trim()) {
        dropped.push({
          ruleId: finding.ruleId,
          page: finding.page,
          reason: "missing page, box or measured value",
        });
        continue;
      }
      const ok = verifyDeterministic(
        { ...finding, status: "pending", source: "deterministic", bucket: "verified" },
        {
          runText,
          rules: brand.rules,
          claims: brand.claims.map((claim) => ({
            claimId: claim.claimId,
            text: claim.text,
            status: claim.status,
            approvedWording: claim.approvedWording,
            evidence: claim.evidence,
            owner: claim.owner,
            expiresAt: claim.expiresAt ?? null,
          })),
          pageCount,
        },
      );
      if (!ok) {
        dropped.push({
          ruleId: finding.ruleId,
          page: finding.page,
          reason: "rule, excerpt or page evidence did not verify",
        });
        continue;
      }
      kept.push(finding);
    }

    const existing = await ctx.db
      .query("findings")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    for (const row of existing.filter((r) => r.reviewer === "visual")) {
      await ctx.db.delete(row._id);
    }
    const ids = new Set(existing.map((row) => row.findingId));
    let order = existing.length;
    for (const finding of kept) {
      if (ids.has(finding.id)) continue;
      await ctx.db.insert("findings", {
        runId: run._id,
        submissionId: submission._id,
        workspaceId: submission.workspaceId,
        findingId: finding.id,
        reviewer: "visual",
        severity: finding.severity,
        confidence: finding.confidence,
        spanText: finding.spanText,
        spanStart: 0,
        spanEnd: 0,
        ruleId: finding.ruleId,
        guidelineExcerpt: finding.guidelineExcerpt,
        whyItMatters: finding.whyItMatters,
        suggestedFix: finding.suggestedFix,
        status: "pending",
        source: "deterministic",
        bucket: finding.bucket,
        evidenceType: "computed",
        measuredValue: finding.measured,
        measured: finding.measured,
        threshold: finding.threshold,
        page: finding.page,
        bbox: finding.bbox,
        order: order++,
        createdAt: Date.now(),
      });
    }

    const counts = await ctx.db
      .query("findings")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    await ctx.db.patch(run._id, {
      counts: JSON.stringify(
        counts.reduce<Record<string, number>>((acc, row) => {
          acc[row.severity] = (acc[row.severity] ?? 0) + 1;
          return acc;
        }, {}),
      ),
    });
    await appendAudit(ctx, {
      workspaceId: submission.workspaceId,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "visual.findings_verified",
      entityType: "run",
      entityId: run._id,
      payload: {
        pages: pageCount,
        submitted: parsed.length,
        kept: kept.length,
        dropped: dropped.length,
        droppedDetail: dropped.slice(0, 10),
        thresholds: args.thresholdsJson ?? null,
      },
    });
    return { kept: kept.length, dropped: dropped.length, droppedDetail: dropped.slice(0, 10) };
  },
});

export const forSubmission = query({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, args) => {
    const session = await requireMember(ctx);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission || submission.workspaceId !== session.workspace._id) return null;
    const pages = await ctx.db
      .query("visualAssets")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    const withUrls = [];
    for (const page of pages.sort((a, b) => a.page - b.page)) {
      const url = page.storageId ? await ctx.storage.getUrl(page.storageId) : null;
      withUrls.push({
        page: page.page,
        width: page.width,
        height: page.height,
        kind: page.kind,
        sha256: page.sha256,
        url,
      });
    }
    return {
      pages: withUrls,
      pageCount: withUrls.length,
      hasVisual: withUrls.length > 0,
    };
  },
});

/** Sample deck PDFs are served from public assets; the UI links are static. */
export const sampleDecks = query({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    return [
      {
        id: "violations",
        label: "Lumora launch deck (known issues)",
        pdf: "/demo-assets/decks/lumora-deck-violations.pdf",
        note: "10 pages with logo, clear-space, palette, type and density defects.",
      },
      {
        id: "clean",
        label: "Lumora launch deck (clean)",
        pdf: "/demo-assets/decks/lumora-deck-clean.pdf",
        note: "10 pages. Expected to produce no visual findings.",
      },
    ];
  },
});
