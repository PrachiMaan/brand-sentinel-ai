import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { appendAudit, brandState, requireMember, requireRole } from "./helpers";
import {
  buildHealthRows,
  buildSuggestion,
  channelDrift,
  dayKey,
  median,
  percentile,
  ruleSummaries,
  wilsonInterval,
} from "./lib/analytics";
import type { DecisionKind, HealthRow, RawDecision } from "./lib/analytics";
import { BATCH_DAYS, HISTORY_BATCHES, planHistory } from "./lib/history";
import { canonicalJson, sha256Hex } from "./lib/sha256";

const DAY = 86_400_000;

type Ctx = QueryCtx | MutationCtx;

type WorkspaceRange = {
  submissions: {
    id: string;
    team: string;
    channel: string;
    createdAt: number;
    status: string;
    updatedAt: number;
    synthetic: boolean;
  }[];
  findings: {
    findingId: string;
    submissionId: string;
    ruleId: string;
    ruleTitle: string;
    severity: string;
    createdAt: number;
    status: string;
    spanText: string;
  }[];
  decisions: (RawDecision & { reason?: string; spanText?: string })[];
};

async function collectRange(
  ctx: Ctx,
  workspaceId: string,
  fromMs: number,
  toMs: number,
): Promise<WorkspaceRange> {
  const ws = workspaceId as never;
  const allSubmissions = await ctx.db
    .query("submissions")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
    .collect();
  const submissions = allSubmissions.filter(
    (s) => s.createdAt >= fromMs && s.createdAt <= toMs,
  );

  const submissionsOut = submissions.map((s) => ({
    id: s._id as string,
    team: s.team ?? "Unknown",
    channel: s.channel,
    createdAt: s.createdAt,
    status: s.status,
    updatedAt: s.updatedAt,
    synthetic: Boolean(s.synthetic),
  }));

  const brand = await brandState(ctx, ws);
  const titleByRule = new Map(brand.allRules.map((r) => [r.ruleId, r.title]));

  const findingsOut: WorkspaceRange["findings"] = [];
  const decisionsOut: WorkspaceRange["decisions"] = [];

  for (const submission of submissions) {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    const byFinding = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      byFinding.set(row.findingId, row);
      findingsOut.push({
        findingId: row.findingId,
        submissionId: submission._id as string,
        ruleId: row.ruleId,
        ruleTitle: titleByRule.get(row.ruleId) ?? row.ruleId,
        severity: row.severity,
        createdAt: row.createdAt,
        status: row.status,
        spanText: row.spanText,
      });
    }
    const decisions = await ctx.db
      .query("decisions")
      .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
      .collect();
    for (const decision of decisions) {
      const finding = byFinding.get(decision.findingId);
      decisionsOut.push({
        ruleId: finding?.ruleId ?? "",
        decision: decision.decision as DecisionKind,
        submissionId: submission._id as string,
        findingId: decision.findingId,
        createdAt: decision.createdAt,
        actorRole: decision.actorRole,
        synthetic: Boolean(submission.synthetic),
        reason: decision.reason,
        spanText: finding?.spanText,
      });
    }
  }

  return {
    submissions: submissionsOut,
    findings: findingsOut,
    decisions: decisionsOut.filter((d) => d.ruleId),
  };
}

function aggregate(
  rows: HealthRow[],
): { day: string; findings: number; decisions: number; overridden: number; rate: number }[] {
  const map = new Map<
    string,
    { day: string; findings: number; decisions: number; overridden: number }
  >();
  for (const row of rows) {
    const entry =
      map.get(row.day) ?? { day: row.day, findings: 0, decisions: 0, overridden: 0 };
    entry.findings += row.findings;
    entry.decisions += row.accepted + row.edited + row.rejected + row.overridden;
    entry.overridden += row.edited + row.rejected + row.overridden;
    map.set(row.day, entry);
  }
  return Array.from(map.values())
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((entry) => ({
      ...entry,
      rate: entry.decisions
        ? Math.round((entry.overridden / entry.decisions) * 1000) / 10
        : 0,
    }));
}

export const overview = query({
  args: { ruleId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const session = await requireMember(ctx);
    const workspaceId = session.workspace._id;
    const brand = await brandState(ctx, workspaceId);

    const health = await ctx.db
      .query("ruleHealth")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const rules = brand.allRules.map((r) => ({ ruleId: r.ruleId, title: r.title }));
    const summaries = ruleSummaries({ health, rules });

    const decided = health.reduce(
      (sum, row) => sum + row.accepted + row.edited + row.rejected + row.overridden,
      0,
    );
    const overridden = health.reduce(
      (sum, row) => sum + row.edited + row.rejected + row.overridden,
      0,
    );
    const overallCi = wilsonInterval(overridden, decided);
    const drift = channelDrift(health, Date.now());
    const drifting = drift.find((d) => d.enoughData && d.delta > 0) ?? null;

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const approvalTimes = submissions
      .filter((s) => ["approved", "receipt_exported"].includes(s.status))
      .map((s) => s.updatedAt - s.createdAt)
      .filter((ms) => ms > 0);

    const suggestions = await ctx.db
      .query("ruleSuggestions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    const titleByRule = new Map(rules.map((r) => [r.ruleId, r.title]));
    const drafts = await ctx.db
      .query("ruleDrafts")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();

    const syntheticSubmissions = submissions.filter((s) => s.synthetic).length;
    const computedAt = health.length
      ? Math.max(...health.map((row) => row.computedAt))
      : null;

    const trend = aggregate(
      args.ruleId ? health.filter((row) => row.ruleId === args.ruleId) : health,
    );

    const heatmap = new Map<string, { team: string; channel: string; findings: number; decisions: number; overridden: number }>();
    for (const row of health) {
      const key = `${row.team}|${row.channel}`;
      const entry = heatmap.get(key) ?? {
        team: row.team,
        channel: row.channel,
        findings: 0,
        decisions: 0,
        overridden: 0,
      };
      entry.findings += row.findings;
      entry.decisions += row.accepted + row.edited + row.rejected + row.overridden;
      entry.overridden += row.edited + row.rejected + row.overridden;
      heatmap.set(key, entry);
    }

    return {
      role: session.membership.role,
      displayName: session.membership.displayName,
      syntheticSubmissions,
      computedAt,
      hasHealth: health.length > 0,
      cards: {
        decisions: decided,
        overrideRate: decided ? Math.round((overridden / decided) * 1000) / 10 : 0,
        ciLow: Math.round(overallCi.low * 1000) / 10,
        ciHigh: Math.round(overallCi.high * 1000) / 10,
        topDriftChannel: drifting
          ? {
              channel: drifting.channel,
              team: drifting.team,
              delta: drifting.delta,
              recent: drifting.recentOverrideRate,
              baseline: drifting.baselineOverrideRate,
              decisions: drifting.recentDecisions,
            }
          : null,
        medianApprovalHours: approvalTimes.length
          ? Math.round((median(approvalTimes) / 3_600_000) * 10) / 10
          : null,
        p90ApprovalHours: approvalTimes.length
          ? Math.round((percentile(approvalTimes, 0.9) / 3_600_000) * 10) / 10
          : null,
        rulesNeedingAttention: summaries.filter(
          (row) => row.enoughData && row.overrideRate >= 25,
        ).length,
      },
      summaries,
      drift,
      trend,
      heatmap: Array.from(heatmap.values()).sort((a, b) => b.overridden - a.overridden),
      suggestions: suggestions
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((s) => ({
          id: s._id,
          ruleId: s.ruleId,
          ruleTitle: titleByRule.get(s.ruleId) ?? s.ruleId,
          proposedWording: s.proposedWording,
          rationale: s.rationale,
          evidenceCount: s.evidenceDecisionIds.length,
          method: s.method,
          status: s.status,
          createdAt: s.createdAt,
        })),
      drafts: drafts
        .filter((d) => d.status === "draft")
        .map((d) => ({
          id: d._id,
          ruleId: d.ruleId,
          title: d.title,
          proposedWording: d.proposedWording,
          createdBy: d.createdBy,
          createdAt: d.createdAt,
        })),
    };
  },
});

async function writeHealthForRange(
  ctx: MutationCtx,
  workspaceId: string,
  fromMs: number,
  toMs: number,
) {
  const ws = workspaceId as never;
  const brand = await brandState(ctx, ws);
  const range = await collectRange(ctx, ws, fromMs, toMs);
  const rows = buildHealthRows({
    submissions: range.submissions,
    findings: range.findings,
    decisions: range.decisions,
    ruleIds: brand.allRules.map((r) => r.ruleId),
    fromMs,
    toMs,
  });

  const existing = await ctx.db
    .query("ruleHealth")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
    .collect();
  const fromDay = dayKey(fromMs);
  const toDay = dayKey(toMs);
  for (const row of existing) {
    if (row.day >= fromDay && row.day <= toDay) await ctx.db.delete(row._id);
  }

  const now = Date.now();
  for (const row of rows) {
    await ctx.db.insert("ruleHealth", {
      workspaceId: ws,
      ...row,
      computedAt: now,
    });
  }
  return { rows: rows.length, fromDay, toDay };
}

export const recompute = mutation({
  args: { batch: v.number() },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["admin"]);
    if (args.batch < 0 || args.batch >= HISTORY_BATCHES) {
      throw new Error("Unknown history batch.");
    }
    const now = Date.now();
    const toMs = now - args.batch * BATCH_DAYS * DAY;
    const fromMs = toMs - BATCH_DAYS * DAY;
    const result = await writeHealthForRange(
      ctx,
      session.workspace._id,
      fromMs,
      toMs,
    );
    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "analytics.recomputed",
      entityType: "ruleHealth",
      entityId: `${result.fromDay}..${result.toDay}`,
      payload: { rows: result.rows, batch: args.batch },
    });
    return result;
  },
});

/** Cron entry point: refresh the last two days for every workspace. */
export const recomputeRecent = internalMutation({
  args: {},
  handler: async (ctx) => {
    const workspaces = await ctx.db.query("workspaces").collect();
    const now = Date.now();
    let rows = 0;
    for (const workspace of workspaces) {
      const result = await writeHealthForRange(
        ctx,
        workspace._id,
        now - 2 * DAY,
        now,
      );
      rows += result.rows;
    }
    return { workspaces: workspaces.length, rows };
  },
});

export const seedHistory = mutation({
  args: { batch: v.number() },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["admin"]);
    if (args.batch < 0 || args.batch >= HISTORY_BATCHES) {
      throw new Error("Unknown history batch.");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("submissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", session.workspace._id))
      .collect();
    const synthetic = existing.filter((s) => s.synthetic);
    if (synthetic.length > 0) {
      return { created: 0, alreadyPresent: synthetic.length };
    }

    const plans = planHistory({
      fromDay: args.batch * BATCH_DAYS,
      toDay: (args.batch + 1) * BATCH_DAYS,
      nowMs: now,
    });
    let findings = 0;
    let decisions = 0;

    for (const plan of plans) {
      const submissionId = await ctx.db.insert("submissions", {
        workspaceId: session.workspace._id,
        creatorId: session.userId,
        creatorName: plan.creatorName,
        title: plan.title,
        channel: plan.channel,
        audience: plan.audience,
        team: plan.team,
        currentVersion: 1,
        status: plan.status as never,
        altText: "Synthetic history row.",
        legalFlag: false,
        synthetic: true,
        kind: "text",
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      });
      const versionId = await ctx.db.insert("versions", {
        submissionId,
        workspaceId: session.workspace._id,
        version: 1,
        text: plan.text,
        channel: plan.channel,
        audience: plan.audience,
        altText: "Synthetic history row.",
        contentHash: sha256Hex(canonicalJson({ text: plan.text })),
        pageCount: 1,
        createdAt: plan.createdAt,
        createdBy: session.userId,
      });
      const runId = await ctx.db.insert("runs", {
        submissionId,
        workspaceId: session.workspace._id,
        versionId,
        version: 1,
        status: "complete",
        startedAt: plan.createdAt,
        finishedAt: plan.updatedAt,
        fastMs: 0,
        deepMs: 0,
        progress: [],
        model: "synthetic history",
        source: "synthetic",
        createdAt: plan.createdAt,
      });
      await ctx.db.patch(submissionId, { lastRunId: runId });

      for (const [index, finding] of plan.findings.entries()) {
        const spanStart = plan.text.indexOf(finding.spanText);
        const findingDocId = await ctx.db.insert("findings", {
          runId,
          submissionId,
          workspaceId: session.workspace._id,
          findingId: `hist-${submissionId}-${index}`,
          reviewer: "terminology",
          severity: finding.severity,
          confidence: 0.82,
          spanText: finding.spanText,
          spanStart: spanStart >= 0 ? spanStart : 0,
          spanEnd: spanStart >= 0 ? spanStart + finding.spanText.length : finding.spanText.length,
          ruleId: finding.ruleId,
          guidelineExcerpt: "Synthetic history row.",
          whyItMatters: "Synthetic history row used for drift analytics.",
          suggestedFix: "",
          status: finding.status,
          source: "deterministic",
          bucket: "verified",
          evidenceType: "verbatim_span",
          order: index,
          synthetic: true,
          createdAt: finding.atMs,
        });
        findings += 1;
        if (finding.decision) {
          await ctx.db.insert("decisions", {
            findingDocId,
            findingId: `hist-${submissionId}-${index}`,
            submissionId,
            workspaceId: session.workspace._id,
            decision: finding.decision.kind,
            reason: finding.decision.reason,
            editedFix: finding.decision.editedFix,
            actorId: session.userId,
            actorRole: finding.decision.actorRole,
            actorName:
              finding.decision.actorRole === "approver" ? "Ines Alvarez" : "Dev Kapoor",
            createdAt: finding.decision.atMs,
            synthetic: true,
          });
          await ctx.db.insert("ruleOverrides", {
            workspaceId: session.workspace._id,
            ruleId: finding.ruleId,
            decision: finding.decision.kind,
            actorRole: finding.decision.actorRole,
            submissionId,
            findingId: `hist-${submissionId}-${index}`,
            seeded: true,
            synthetic: true,
            createdAt: finding.decision.atMs,
          });
          decisions += 1;
        }
      }
    }

    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "analytics.synthetic_history_loaded",
      entityType: "workspace",
      entityId: session.workspace._id,
      payload: { batch: args.batch, submissions: plans.length, findings, decisions },
      createdAt: now,
    });

    return { created: plans.length, findings, decisions, alreadyPresent: 0 };
  },
});

export const removeSynthetic = mutation({
  args: {},
  handler: async (ctx) => {
    const session = await requireRole(ctx, ["admin"]);
    const ws = session.workspace._id;
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
      .collect();
    const synthetic = submissions.filter((s) => s.synthetic);
    let removed = 0;
    for (const submission of synthetic) {
      const findings = await ctx.db
        .query("findings")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .collect();
      for (const finding of findings) await ctx.db.delete(finding._id);
      const decisions = await ctx.db
        .query("decisions")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .collect();
      for (const decision of decisions) await ctx.db.delete(decision._id);
      const versions = await ctx.db
        .query("versions")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .collect();
      for (const version of versions) await ctx.db.delete(version._id);
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .collect();
      for (const run of runs) await ctx.db.delete(run._id);
      await ctx.db.delete(submission._id);
      removed += 1;
    }
    const overrides = await ctx.db
      .query("ruleOverrides")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
      .collect();
    for (const row of overrides.filter((r) => r.synthetic)) await ctx.db.delete(row._id);
    const health = await ctx.db
      .query("ruleHealth")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
      .collect();
    for (const row of health.filter((r) => r.synthetic)) await ctx.db.delete(row._id);

    await appendAudit(ctx, {
      workspaceId: ws,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "analytics.synthetic_history_removed",
      entityType: "workspace",
      entityId: ws,
      payload: { submissions: removed },
    });
    return { removed };
  },
});

export const generateSuggestions = mutation({
  args: {},
  handler: async (ctx) => {
    const session = await requireRole(ctx, ["admin"]);
    const ws = session.workspace._id;
    const brand = await brandState(ctx, ws);
    const now = Date.now();

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
      .order("desc")
      .take(400);
    const allDecisions: (RawDecision & { reason?: string; spanText?: string })[] = [];
    for (const submission of submissions) {
      const findings = await ctx.db
        .query("findings")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .collect();
      const byFinding = new Map(findings.map((f) => [f.findingId, f]));
      const decisions = await ctx.db
        .query("decisions")
        .withIndex("by_submission", (q) => q.eq("submissionId", submission._id))
        .collect();
      for (const decision of decisions) {
        const finding = byFinding.get(decision.findingId);
        if (!finding) continue;
        allDecisions.push({
          ruleId: finding.ruleId,
          decision: decision.decision as DecisionKind,
          submissionId: submission._id as string,
          findingId: decision.findingId,
          createdAt: decision.createdAt,
          actorRole: decision.actorRole,
          synthetic: Boolean(submission.synthetic),
          reason: decision.reason,
          spanText: finding.spanText,
        });
      }
    }

    const existing = await ctx.db
      .query("ruleSuggestions")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", ws))
      .collect();
    for (const row of existing.filter((s) => s.status === "proposed")) {
      await ctx.db.delete(row._id);
    }

    let created = 0;
    for (const rule of brand.allRules) {
      const decisions = allDecisions.filter((d) => d.ruleId === rule.ruleId);
      const suggestion = buildSuggestion({
        ruleId: rule.ruleId,
        title: rule.title,
        description: rule.description,
        sourceExcerpt: rule.sourceExcerpt,
        decisions,
      });
      if (!suggestion) continue;
      await ctx.db.insert("ruleSuggestions", {
        workspaceId: ws,
        ruleId: suggestion.ruleId,
        proposedWording: suggestion.proposedWording,
        rationale: suggestion.rationale,
        evidenceDecisionIds: suggestion.evidenceDecisionIds,
        method: suggestion.method,
        status: "proposed",
        createdAt: now + created,
      });
      created += 1;
      if (created >= 8) break;
    }

    await appendAudit(ctx, {
      workspaceId: ws,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "analytics.suggestions_generated",
      entityType: "ruleSuggestions",
      entityId: ws,
      payload: { created, decisionsConsidered: allDecisions.length },
    });
    return { created, decisionsConsidered: allDecisions.length };
  },
});

export const traceSuggestion = query({
  args: { suggestionId: v.id("ruleSuggestions") },
  handler: async (ctx, args) => {
    const session = await requireMember(ctx);
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion || suggestion.workspaceId !== session.workspace._id) {
      throw new Error("Suggestion not found.");
    }
    const rows = [];
    for (const findingId of suggestion.evidenceDecisionIds) {
      const decision = await ctx.db
        .query("decisions")
        .withIndex("by_finding_id", (q) => q.eq("findingId", findingId))
        .first();
      if (!decision) continue;
      const finding = await ctx.db.get(decision.findingDocId);
      const submission = finding ? await ctx.db.get(finding.submissionId) : null;
      rows.push({
        findingId,
        decision: decision.decision,
        reason: decision.reason ?? null,
        actorName: decision.actorName,
        actorRole: decision.actorRole,
        createdAt: decision.createdAt,
        spanText: finding?.spanText ?? null,
        severity: finding?.severity ?? null,
        submissionId: decision.submissionId,
        submissionTitle: submission?.title ?? "Removed submission",
        synthetic: Boolean(submission?.synthetic),
      });
    }
    return rows;
  },
});

export const decideSuggestion = mutation({
  args: {
    suggestionId: v.id("ruleSuggestions"),
    decision: v.union(v.literal("accept"), v.literal("dismiss")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["admin"]);
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion || suggestion.workspaceId !== session.workspace._id) {
      throw new Error("Suggestion not found.");
    }
    if (suggestion.status !== "proposed") {
      throw new Error("This suggestion has already been decided.");
    }
    if (args.decision === "dismiss" && (args.reason ?? "").trim().length < 3) {
      throw new Error("Give a short reason when dismissing a suggestion.");
    }
    const now = Date.now();
    const brand = await brandState(ctx, session.workspace._id);
    const rule = brand.allRules.find((r) => r.ruleId === suggestion.ruleId);

    await ctx.db.patch(suggestion._id, {
      status: args.decision === "accept" ? "accepted" : "dismissed",
      dismissReason: args.decision === "dismiss" ? args.reason?.trim() : undefined,
      decidedAt: now,
      decidedBy: session.membership.displayName,
    });

    let draftId = null;
    if (args.decision === "accept") {
      draftId = await ctx.db.insert("ruleDrafts", {
        workspaceId: session.workspace._id,
        ruleId: suggestion.ruleId,
        title: rule?.title ?? suggestion.ruleId,
        proposedWording: suggestion.proposedWording,
        suggestionId: suggestion._id,
        status: "draft",
        createdBy: session.membership.displayName,
        createdAt: now,
      });
    }

    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: `rule_suggestion.${args.decision}ed`,
      entityType: "ruleSuggestion",
      entityId: suggestion._id,
      payload: {
        ruleId: suggestion.ruleId,
        method: suggestion.method,
        reason: args.reason ?? "",
        draftCreated: Boolean(draftId),
      },
    });
    return { status: args.decision === "accept" ? "accepted" : "dismissed", draftId };
  },
});

export const publishDraft = mutation({
  args: { draftId: v.id("ruleDrafts") },
  handler: async (ctx, args) => {
    const session = await requireRole(ctx, ["admin"]);
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.workspaceId !== session.workspace._id) {
      throw new Error("Draft not found.");
    }
    if (draft.status !== "draft") throw new Error("This draft is already closed.");
    const brand = await brandState(ctx, session.workspace._id);
    const rule = brand.allRules.find((r) => r.ruleId === draft.ruleId);
    if (!rule) throw new Error("That rule is no longer published.");

    await ctx.db.patch(rule._id, {
      description: draft.proposedWording,
      updatedAt: Date.now(),
    });
    if (brand.pack) {
      const version = bumpVersion(brand.pack.version);
      await ctx.db.patch(brand.pack._id, { version, updatedAt: Date.now() });
    }
    await ctx.db.patch(draft._id, { status: "published", publishedAt: Date.now() });
    await appendAudit(ctx, {
      workspaceId: session.workspace._id,
      actorId: session.userId,
      actorRole: session.membership.role,
      actorName: session.membership.displayName,
      action: "brandpack.rule_published",
      entityType: "rule",
      entityId: rule.ruleId,
      payload: { draftId: draft._id, version: brand.pack ? bumpVersion(brand.pack.version) : null },
    });
    return { ruleId: rule.ruleId };
  },
});

function bumpVersion(version: string): string {
  const match = version.match(/Edition (\d+)/);
  if (!match) return `${version} · rev ${Date.now().toString().slice(-4)}`;
  return version.replace(/Edition \d+/, `Edition ${Number(match[1]) + 1}`);
}
