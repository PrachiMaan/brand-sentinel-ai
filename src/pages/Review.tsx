import { AppShell } from "@/components/AppShell";
import { HighlightedText } from "@/components/brand/HighlightedText";
import { PageViewer } from "@/components/brand/PageViewer";
import {
  ClaimChip,
  SeverityChip,
  StatusChip,
  Wordmark,
} from "@/components/brand/chips";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { wordDiff } from "@/convex/lib/text";
import { REVIEWER_META } from "@/convex/lib/types";
import { buildReceipt } from "@/lib/receipt";
import { dateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Download,
  FileText,
  GitCompareArrows,
  History,
  Loader2,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Stamp,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

type Filter = "all" | "pending" | "needs_human" | "decided";

const REVIEWER_ORDER = ["tone", "terminology", "claims", "visual", "accessibility"];

export default function Review() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const isNew = searchParams.get("new") === "1";
  const submissionId = params.id as Id<"submissions"> | undefined;
  const data = useQuery(
    api.submissions.get,
    submissionId ? { submissionId } : "skip",
  );
  const visual = useQuery(
    api.visual.forSubmission,
    submissionId ? { submissionId } : "skip",
  );
  const decide = useMutation(api.submissions.decideFinding);
  const escalate = useMutation(api.submissions.escalateLegal);
  const revision = useMutation(api.submissions.requestRevision);
  const approve = useMutation(api.submissions.approve);
  const reject = useMutation(api.submissions.reject);
  const resubmit = useMutation(api.submissions.resubmit);
  const comment = useMutation(api.submissions.addComment);
  const markReceipt = useMutation(api.submissions.markReceiptExported);
  const runReview = useAction(api.review.runReview);

  const [filter, setFilter] = useState<Filter>("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [rejectingFinding, setRejectingFinding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [escalating, setEscalating] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [showVerifier, setShowVerifier] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentTarget, setCommentTarget] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [submissionReason, setSubmissionReason] = useState("");
  const [revisionNote, setRevisionNote] = useState("");
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionText, setRevisionText] = useState("");
  const [revisionAlt, setRevisionAlt] = useState("");
  const [receiptBusy, setReceiptBusy] = useState(false);
  const autoStarted = useRef(false);

  const startReview = async (options?: { silent?: boolean }) => {
    if (!submissionId) return;
    setStarting(true);
    try {
      const result = await runReview({ submissionId });
      if (!options?.silent) {
        toast(result.degraded ? "Review finished with warnings" : "Review complete", {
          description: result.degraded
            ? "Fast-lane findings are available; some reviewers failed."
            : `${result.findings ?? 0} verified findings.`,
        });
      }
    } catch (error) {
      if (!options?.silent) {
        toast.error(error instanceof Error ? error.message : "Review failed.");
      }
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    if (!data || autoStarted.current) return;
    if (isNew && data.submission.status === "draft" && !data.run) {
      autoStarted.current = true;
      // Deferred one tick so the first paint is not interrupted by the run's
      // own state updates.
      const timer = setTimeout(() => void startReview({ silent: false }), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [data, isNew]);

  const findings = data?.findings ?? [];
  const decisions = data?.decisions ?? [];
  const decisionFor = (findingId: string) =>
    decisions.find((d) => d.findingId === findingId);

  const counts = useMemo(() => {
    const base = { critical: 0, high: 0, medium: 0, low: 0, needsHuman: 0, pending: 0 };
    for (const finding of findings) {
      base[finding.severity as "critical" | "high" | "medium" | "low"]++;
      if (finding.bucket === "needs_human") base.needsHuman++;
      if (finding.status === "pending") base.pending++;
    }
    return base;
  }, [findings]);

  const filtered = findings.filter((finding) => {
    if (filter === "pending") return finding.status === "pending";
    if (filter === "needs_human") return finding.bucket === "needs_human";
    if (filter === "decided") return finding.status !== "pending";
    return true;
  });

  const blocking = findings.filter(
    (f) =>
      f.status === "pending" &&
      f.bucket === "verified" &&
      (f.severity === "critical" || f.severity === "high"),
  ).length;

  if (data === undefined) {
    return (
      <AppShell title="Review">
        <div className="flex items-center gap-2 py-20 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Opening the review…
        </div>
      </AppShell>
    );
  }

  if (data === null) {
    return (
      <AppShell title="Review">
        <div className="border border-border p-8">
          <p className="font-serif text-2xl">This review is not available.</p>
          <p className="prose-note mt-2">
            It may belong to another workspace, or the link is incomplete.
          </p>
          <Button asChild className="mt-4 rounded-none">
            <Link to="/app">Back to the queue</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const { submission, run, currentVersion, versions, comments, calls } = data;
  const role = data.role;
  const canDecide = ["reviewer", "approver", "admin"].includes(role);
  const canApprove = ["approver", "admin"].includes(role);
  const canEscalate = canApprove;
  const canCreate = ["creator", "admin"].includes(role);
  const isRunning = submission.status === "ai_review" || run?.status === "running";
  const approved = ["approved", "receipt_exported"].includes(submission.status);
  const inReview = ["findings_ready", "human_review"].includes(submission.status);
  const verifier = run?.verifier;
  const openFindings = findings.filter((f) => f.status === "pending").length;

  const act = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      setEditing(null);
      setRejectingFinding(null);
      setEscl(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That action failed.");
    } finally {
      setBusy(null);
    }
  };

  // Small alias keeps the escalation reset readable without another state setter.
  const setEscl = setEscalating;

  const submitDecision = (
    findingDocId: Id<"findings">,
    findingId: string,
    decision: "accept" | "edit" | "reject",
    extra?: { reason?: string; editedFix?: string },
  ) =>
    act(
      `${decision}-${findingId}`,
      () =>
        decide({
          findingDocId,
          decision,
          reason: extra?.reason,
          editedFix: extra?.editedFix,
        }),
      decision === "accept"
        ? "Finding accepted. The decision is in the audit trail."
        : decision === "edit"
          ? "Edited fix saved as the accepted wording."
          : "Finding rejected with a reason.",
    );

  const downloadReceipt = async () => {
    if (!submissionId || !currentVersion) return;
    setReceiptBusy(true);
    try {
      const result = await buildReceipt({
        submission: {
          title: submission.title,
          channel: submission.channel,
          audience: submission.audience,
          creatorName: submission.creatorName,
          currentVersion: submission.currentVersion,
          status: submission.status,
          brandFit: submission.brandFit ?? null,
          createdAt: submission.createdAt,
        },
        version: { contentHash: currentVersion.contentHash },
        findings,
        decisions,
        run: run
          ? {
              verifier: run.verifier,
              brandFit: run.brandFit,
              model: run.model,
              finishedAt: run.finishedAt,
              source: run.source,
            }
          : null,
        calls,
        brand: data.brandPack
          ? { name: data.brandPack.name, version: data.brandPack.version }
          : null,
        auditHead: data.auditHead,
        workspaceName: data.workspaceName ?? "Lumora Studio",
        generatedBy: data.displayName,
      });
      const blob = new Blob([new Uint8Array(result.bytes)], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      if (submission.status === "approved") {
        await markReceipt({ submissionId, receiptHash: result.receiptHash });
      }
      toast.success("Receipt downloaded", {
        description: "The export is recorded in the audit chain.",
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not build the receipt.",
      );
    } finally {
      setReceiptBusy(false);
    }
  };

  return (
    <AppShell title={submission.title} note={`${submission.channel} · ${submission.audience}`}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/app"
            className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Queue
          </Link>
          <span className="h-3 w-px bg-border" />
          <StatusChip status={submission.status} />
          {submission.legalFlag && (
            <span className="border border-[#8F2F24]/50 bg-[#8F2F24]/5 px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.14em] text-[#8F2F24]">
              Legal escalation open
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="font-serif text-[24px] leading-none">
              {submission.brandFit ?? run?.brandFit ?? "—"}
              <span className="font-sans text-[10px] text-muted-foreground"> /100</span>
            </p>
            <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
              brand fit
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[13px]">
              v{submission.currentVersion}
            </p>
            <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
              version
            </p>
          </div>
          <div className="text-right">
            <p className="font-mono text-[13px]">
              {run?.deepMs ? `${(run.deepMs / 1000).toFixed(1)}s` : "—"}
            </p>
            <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground">
              deep lane
            </p>
          </div>
        </div>
      </div>

      {isRunning && (
        <div className="mb-5 border border-[#B99A5E]/50 bg-[#B99A5E]/[0.07] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-[#8A6B34]" />
              <p className="font-serif text-[17px]">Five reviewers are reading</p>
            </div>
            <p className="font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground">
              started {timeAgo(run?.startedAt ?? submission.updatedAt)}
            </p>
          </div>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-5">
            {REVIEWER_ORDER.map((reviewer) => {
              const progress = run?.progress.find((p) => p.reviewer === reviewer);
              const status = progress?.status ?? "pending";
              return (
                <div
                  key={reviewer}
                  className="border border-border/70 bg-card px-2 py-2"
                >
                  <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                    {REVIEWER_META[reviewer as keyof typeof REVIEWER_META].short}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-[10px] capitalize">
                    {status === "running" && (
                      <Loader2 className="size-2.5 animate-spin text-[#8A6B34]" />
                    )}
                    {status === "done" && <Check className="size-2.5 text-[#4F5C47]" />}
                    {status === "error" && <X className="size-2.5 text-[#8F2F24]" />}
                    {status}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {run?.source === "saved_run" && (
        <div className="mb-5 border border-border bg-card px-5 py-4">
          <div className="flex gap-2">
            <History className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-[13px] font-medium">{run.model ?? "Saved model result"}</p>
              <p className="mt-1 max-w-[80ch] text-[11.5px] leading-5 text-muted-foreground">
                This sample has a saved deep-lane result, so the model was not called again.
                The saved findings were re-checked against the current rulebook before being
                shown here. Submitted content of your own always runs live when the model is
                available, and falls back to the fast lane when it is not.
              </p>
            </div>
          </div>
        </div>
      )}

      {(run?.status === "degraded" || run?.status === "failed") && (
        <div className="mb-5 border border-[#A9552F]/40 bg-[#A9552F]/[0.05] px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#8F4526]" />
              <div>
                <p className="text-[13px] font-medium">
                  {run.status === "failed"
                    ? "The AI review could not finish."
                    : "The AI review finished with warnings."}
                </p>
                <p className="mt-1 max-w-[80ch] text-[11.5px] leading-5 text-muted-foreground">
                  {run.error ??
                    "Some reviewers did not return a valid response."}{" "}
                  Fast-lane findings below are complete and were computed in code.
                </p>
              </div>
            </div>
            {canCreate && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-none border-[#A9552F]/40 text-[11px]"
                onClick={() => startReview()}
                disabled={starting}
              >
                {starting ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 size-3.5" />
                )}
                Retry deep review
              </Button>
            )}
          </div>
        </div>
      )}

      {submission.status === "needs_revision" && canCreate && (
        <div className="mb-5 border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-3">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                Revision requested
              </p>
              <p className="mt-1 font-serif text-[20px]">
                Create version {submission.currentVersion + 1}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="rounded-none text-[11px]"
              onClick={() => {
                setRevisionOpen((value) => !value);
                setRevisionText(currentVersion?.text ?? "");
                setRevisionAlt(submission.altText ?? "");
              }}
            >
              {revisionOpen ? "Close editor" : "Open editor"}
            </Button>
          </div>
          {revisionOpen && (
            <div className="space-y-3 px-5 py-4">
              <Textarea
                value={revisionText}
                onChange={(e) => setRevisionText(e.target.value)}
                rows={8}
                className="rounded-none border-border bg-background text-[13px] leading-6"
              />
              <Textarea
                value={revisionAlt}
                onChange={(e) => setRevisionAlt(e.target.value)}
                rows={2}
                placeholder="Alt text"
                className="rounded-none border-border bg-background text-[12px]"
              />
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">
                  A new immutable version is stored. Findings stay with the old
                  version.
                </p>
                <Button
                  size="sm"
                  className="rounded-none text-[11px]"
                  disabled={Boolean(busy) || !revisionText.trim()}
                  onClick={() =>
                    act(
                      "resubmit",
                      async () => {
                        const result = await resubmit({
                          submissionId: submission._id,
                          text: revisionText,
                          altText: revisionAlt,
                          note: revisionNote,
                        });
                        setRevisionOpen(false);
                        setRevisionText("");
                        await startReview({ silent: true });
                        toast(`Version ${result.version} created`, {
                          description: `New hash ${result.hash.slice(0, 12)}…`,
                        });
                      },
                      "Version submitted for review.",
                    )
                  }
                >
                  Submit new version
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {submission.status === "draft" && !isRunning && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border border-border bg-card px-5 py-4">
          <div>
            <p className="font-serif text-[18px]">This version has not been reviewed.</p>
            <p className="mt-1 text-[11.5px] text-muted-foreground">
              The fast lane is available in the submit screen. Start the deep lane to
              produce a report.
            </p>
          </div>
          {canCreate && (
            <Button
              size="sm"
              className="rounded-none text-[11px]"
              onClick={() => startReview()}
              disabled={starting}
            >
              {starting ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 size-3.5" />
              )}
              Start AI review
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
        <div className="min-w-0 space-y-5">
          <section className="border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border/80 px-5 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                Content · v{submission.currentVersion}
              </p>
              <p className="font-mono text-[9px] text-muted-foreground">
                {(currentVersion?.text.length ?? 0).toLocaleString()} chars ·{" "}
                {findings.length} findings
              </p>
            </div>
            {visual && visual.pages.length > 0 && (
              <div className="border-b border-border/70 p-4">
                <PageViewer
                  pages={visual.pages}
                  boxes={findings
                    .filter((f) => f.page && f.bbox)
                    .map((f) => ({
                      id: f.id,
                      page: f.page,
                      bbox: f.bbox,
                      severity: f.severity,
                      ruleId: f.ruleId,
                    }))}
                  activeId={activeId}
                  onSelect={(id) => {
                    setActiveId(id);
                    document
                      .getElementById(`finding-${id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                />
              </div>
            )}
            {submission.imageUrl && (
              <div className="border-b border-border/70">
                <img
                  src={submission.imageUrl}
                  alt={submission.altText || "Submitted creative without alt text"}
                  className="max-h-[290px] w-full object-cover"
                />
                <div className="flex items-start justify-between gap-4 border-t border-border/60 px-5 py-2.5">
                  <p className="text-[10.5px] leading-4 text-muted-foreground">
                    <span className="font-mono uppercase tracking-[0.12em]">Alt</span>{" "}
                    {submission.altText || "— missing. R-A11Y-02 applies."}
                  </p>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {submission.imageName ?? "image"}
                  </span>
                </div>
              </div>
            )}
            <div className="px-5 py-6">
              <HighlightedText
                text={currentVersion?.text ?? ""}
                marks={findings
                  .filter((f) => f.spanText)
                  .map((f) => ({
                    id: f.id,
                    start: f.spanStart,
                    end: f.spanEnd,
                    severity: f.severity,
                    needsHuman: f.bucket === "needs_human",
                  }))}
                activeId={activeId}
                className="font-serif text-[19px] leading-[1.6]"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-5 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.11em] text-muted-foreground">
                Submitted by {submission.creatorName} · {timeAgo(submission.createdAt)}
              </p>
              <span className="font-mono text-[9px] text-muted-foreground">
                hash {currentVersion?.contentHash.slice(0, 16)}…
              </span>
            </div>
          </section>

          <section className="border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border/80 px-5 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                Version history
              </p>
              <p className="font-mono text-[9px] text-muted-foreground">
                {versions.length} version{versions.length === 1 ? "" : "s"}
              </p>
            </div>
            <div>
              {versions.map((version) => (
                <div
                  key={version.id}
                  className={cn(
                    "flex items-center justify-between gap-3 border-b border-border/60 px-5 py-2.5 last:border-b-0",
                    version.version === submission.currentVersion && "bg-background",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px]">v{version.version}</span>
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {version.contentHash.slice(0, 18)}…
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-muted-foreground">
                      {dateTime(version.createdAt)}
                    </span>
                    {version.version === submission.currentVersion && (
                      <span className="border border-border px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.1em]">
                        current
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border/80 px-5 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                Comments
              </p>
              <span className="font-mono text-[9px] text-muted-foreground">
                {comments.length}
              </span>
            </div>
            <div className="space-y-3 px-5 py-4">
              {comments.length === 0 && (
                <p className="text-[11.5px] text-muted-foreground">
                  No comments yet. Use this thread for context that should not live in a
                  finding.
                </p>
              )}
              {comments.map((entry) => (
                <div
                  key={entry.id}
                  className="border-l border-border pl-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12px] font-medium">{entry.authorName}</p>
                    <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted-foreground">
                      {entry.authorRole}
                    </span>
                    <span className="font-mono text-[8.5px] text-muted-foreground">
                      {timeAgo(entry.createdAt)}
                    </span>
                    {entry.findingId && (
                      <span className="border border-border px-1.5 py-[1px] font-mono text-[8px] text-muted-foreground">
                        on {entry.findingId}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                    {entry.body}
                  </p>
                </div>
              ))}
              {commentTarget && (
                <div className="flex items-center justify-between border border-border bg-background px-2 py-1">
                  <span className="font-mono text-[9px] text-muted-foreground">
                    Commenting on {commentTarget}
                  </span>
                  <button
                    onClick={() => setCommentTarget(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              )}
              <Textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                rows={2}
                placeholder="Add a comment for the team…"
                className="rounded-none border-border bg-background text-[12px]"
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-none text-[11px]"
                  disabled={!commentBody.trim() || Boolean(busy)}
                  onClick={() =>
                    act(
                      "comment",
                      async () => {
                        await comment({
                          submissionId: submission._id,
                          findingId: commentTarget ?? undefined,
                          body: commentBody,
                        });
                        setCommentBody("");
                        setCommentTarget(null);
                      },
                      "Comment added.",
                    )
                  }
                >
                  <MessageSquare className="mr-1.5 size-3.5" /> Post comment
                </Button>
              </div>
            </div>
          </section>
        </div>

        <div className="min-w-0 space-y-5">
          <section className="border border-border bg-card">
            <div className="grid grid-cols-4 gap-px border-b border-border/80 bg-border">
              {[
                ["Critical", counts.critical],
                ["High", counts.high],
                ["Medium", counts.medium],
                ["Low", counts.low],
              ].map(([label, value]) => (
                <div key={String(label)} className="bg-card px-3 py-3">
                  <p className="font-serif text-[22px] leading-none">{String(value)}</p>
                  <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                    {label}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-3.5 text-[#4F5C47]" />
                <p className="text-[11.5px]">
                  <span className="font-medium">
                    {verifier?.dropped ?? 0} unverified finding
                    {(verifier?.dropped ?? 0) === 1 ? "" : "s"} suppressed
                  </span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {verifier?.evidenceRate ?? 0}% evidence validity
                  </span>
                </p>
              </div>
              <button
                onClick={() => setShowVerifier((value) => !value)}
                className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
              >
                Details <ChevronDown className={cn("size-3", showVerifier && "rotate-180")} />
              </button>
            </div>

            {showVerifier && run && (
              <div className="border-t border-border/70 px-5 py-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[9.5px] text-muted-foreground">
                  <span>Proposed by models</span>
                  <span className="text-right">{verifier?.total ?? 0}</span>
                  <span>Kept after verification</span>
                  <span className="text-right">{verifier?.kept ?? 0}</span>
                  <span>Span not verbatim</span>
                  <span className="text-right">{verifier?.droppedSpan ?? 0}</span>
                  <span>Unknown rule</span>
                  <span className="text-right">{verifier?.droppedRule ?? 0}</span>
                  <span>Excerpt not in rulebook</span>
                  <span className="text-right">{verifier?.droppedExcerpt ?? 0}</span>
                  <span>Unknown claim id</span>
                  <span className="text-right">{verifier?.droppedClaim ?? 0}</span>
                  <span>Needs human</span>
                  <span className="text-right">{verifier?.needsHuman ?? 0}</span>
                </div>
                {run.droppedLog.length > 0 && (
                  <div className="mt-3 border-t border-border/60 pt-3">
                    <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted-foreground">
                      Dropped, with reason
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {run.droppedLog
                        .slice(0, 8)
                        .map(
                          (
                            drop: {
                              ruleId: string;
                              reason: string;
                              spanText: string;
                            },
                            index: number,
                          ) => (
                        <p
                          key={`${drop.ruleId}-${index}`}
                          className="text-[10px] leading-4 text-muted-foreground"
                        >
                          <span className="font-mono text-[9px]">{drop.ruleId}</span> ·{" "}
                          {drop.reason.replace(/_/g, " ")} ·{" "}
                          {drop.spanText.slice(0, 70)}
                        </p>
                          ),
                        )}
                    </div>
                  </div>
                )}
                <p className="mt-3 border-t border-border/60 pt-2 font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted-foreground">
                  fast lane {run.fastMs.toFixed(1)}ms · deep lane{" "}
                  {run.deepMs ? `${(run.deepMs / 1000).toFixed(1)}s` : "—"} ·{" "}
                  {run.model ?? "no model"}
                </p>
              </div>
            )}

            <div className="flex items-center gap-1 border-y border-border/70 px-3 py-2">
              {(
                [
                  ["all", `All ${findings.length}`],
                  ["pending", `Open ${counts.pending}`],
                  ["needs_human", `Needs human ${counts.needsHuman}`],
                  ["decided", "Decided"],
                ] as [Filter, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    "px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.09em]",
                    filter === value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {counts.needsHuman > 0 && filter === "needs_human" && (
              <div className="border-b border-border/70 bg-[#B99A5E]/[0.07] px-5 py-3">
                <p className="text-[11px] leading-5 text-[#6A5730]">
                  These findings passed the evidence checks but scored below 0.60
                  confidence. They are kept for a person to judge, not presented as
                  fact.
                </p>
              </div>
            )}

            <div>
              {filtered.length === 0 && (
                <div className="px-5 py-8">
                  <p className="font-serif text-[19px]">
                    {findings.length === 0
                      ? "No verified findings."
                      : "Nothing in this filter."}
                  </p>
                  <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                    {findings.length === 0
                      ? "Everything the models proposed was either supported by verbatim evidence or removed by the verifier."
                      : "Switch filters to see the rest of the report."}
                  </p>
                </div>
              )}
              {filtered.map((finding, index) => {
                const decision = decisionFor(finding.id);
                const isEditing = editing === finding.id;
                const isRejecting = rejectingFinding === finding.id;
                const isActive = activeId === finding.id;
                return (
                  <div
                    key={finding.docId}
                    id={`finding-${finding.id}`}
                    onMouseEnter={() => setActiveId(finding.id)}
                    onMouseLeave={() => setActiveId(null)}
                    className={cn(
                      "border-b border-border/70 px-4 py-4 last:border-b-0",
                      isActive && "bg-background",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityChip severity={finding.severity} />
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                        {REVIEWER_META[finding.reviewer]?.short ?? finding.reviewer} ·{" "}
                        {finding.ruleId}
                      </span>
                      {finding.bucket === "needs_human" && (
                        <span className="border border-[#B99A5E]/60 px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.1em] text-[#7A6334]">
                          Needs human
                        </span>
                      )}
                      {finding.page !== null && (
                        <button
                          onClick={() => setActiveId(finding.id)}
                          className="border border-border px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                        >
                          Page {finding.page}
                        </button>
                      )}
                      {finding.claimStatus && <ClaimChip status={finding.claimStatus} />}
                      <span className="ml-auto font-mono text-[8.5px] text-muted-foreground">
                        {(finding.confidence * 100).toFixed(0)}% conf
                      </span>
                    </div>

                    <div className="mt-2.5 border-l-2 border-border pl-3">
                      <p className="font-serif text-[16px] leading-[1.45]">
                        {finding.spanText || (
                          <span className="italic text-muted-foreground">
                            Computed evidence · {finding.measuredValue ?? "measured"}
                          </span>
                        )}
                      </p>
                    </div>
                    {finding.measured && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border border-border/70 bg-background px-2.5 py-2 font-mono text-[9.5px] text-muted-foreground">
                        <span>
                          <span className="uppercase tracking-[0.1em]">measured</span>{" "}
                          {finding.measured}
                        </span>
                        {finding.threshold && (
                          <span>
                            <span className="uppercase tracking-[0.1em]">threshold</span>{" "}
                            {finding.threshold}
                          </span>
                        )}
                        {finding.bbox && (
                          <span>
                            box {finding.bbox.x.toFixed(2)}, {finding.bbox.y.toFixed(2)},{" "}
                            {finding.bbox.w.toFixed(2)} × {finding.bbox.h.toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                    <p className="mt-2 text-[11.5px] leading-5">{finding.whyItMatters}</p>

                    {finding.guidelineExcerpt && (
                      <div className="mt-2 border border-border/70 bg-background px-2.5 py-2">
                        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                          Rulebook · {finding.ruleId}
                        </p>
                        <p className="mt-1 text-[10.5px] italic leading-4 text-muted-foreground">
                          &ldquo;{finding.guidelineExcerpt}&rdquo;
                        </p>
                      </div>
                    )}

                    {finding.suggestedFix && (
                      <div className="mt-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                            Tracked diff · not applied
                          </span>
                          <span className="font-mono text-[8px] text-muted-foreground">
                            intent {((finding.intentScore ?? 0) * 100).toFixed(0)}% ·{" "}
                            {finding.fixRisk ?? "unknown"} risk
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 font-mono text-[10.5px] leading-5">
                          {wordDiff(finding.spanText, finding.suggestedFix).map(
                            (part, partIndex) =>
                              part.type === "same" ? (
                                <span key={partIndex}>{part.text}</span>
                              ) : part.type === "add" ? (
                                <ins
                                  key={partIndex}
                                  className="bg-[#6F7D66]/15 text-[#41503A] no-underline"
                                >
                                  {part.text}
                                </ins>
                              ) : (
                                <del
                                  key={partIndex}
                                  className="bg-[#A9552F]/10 text-[#8F4526]"
                                >
                                  {part.text}
                                </del>
                              ),
                          )}
                        </div>
                      </div>
                    )}

                    {decision ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
                        <span
                          className={cn(
                            "border px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.12em]",
                            decision.decision === "reject"
                              ? "border-[#8F2F24]/40 text-[#8F2F24]"
                              : "border-[#6F7D66]/50 text-[#4F5C47]",
                          )}
                        >
                          {decision.decision}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {decision.actorName} ({decision.actorRole}) ·{" "}
                          {timeAgo(decision.createdAt)}
                        </span>
                        {decision.reason && (
                          <span className="text-[10px] italic text-muted-foreground">
                            “{decision.reason}”
                          </span>
                        )}
                        {finding.status === "escalated_legal" && (
                          <span className="border border-[#8F2F24]/40 px-1.5 py-[1px] font-mono text-[8px] uppercase text-[#8F2F24]">
                            Legal
                          </span>
                        )}
                      </div>
                    ) : canDecide ? (
                      <div className="mt-3 border-t border-border/60 pt-2.5">
                        {isEditing ? (
                          <div className="space-y-2">
                            <Textarea
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              rows={2}
                              className="rounded-none border-border bg-background text-[12px]"
                            />
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="rounded-none text-[10px]"
                                onClick={() => setEditing(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="rounded-none text-[10px]"
                                disabled={Boolean(busy) || !editValue.trim()}
                                onClick={() =>
                                  submitDecision(
                                    finding.docId as Id<"findings">,
                                    finding.id,
                                    "edit",
                                    { editedFix: editValue },
                                  )
                                }
                              >
                                Save edited fix
                              </Button>
                            </div>
                          </div>
                        ) : isRejecting ? (
                          <div className="space-y-2">
                            <Textarea
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              rows={2}
                              placeholder="Why is this finding wrong or not applicable?"
                              className="rounded-none border-border bg-background text-[12px]"
                            />
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="rounded-none text-[10px]"
                                onClick={() => setRejectingFinding(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="rounded-none text-[10px]"
                                disabled={Boolean(busy) || reason.trim().length < 3}
                                onClick={() =>
                                  submitDecision(
                                    finding.docId as Id<"findings">,
                                    finding.id,
                                    "reject",
                                    { reason },
                                  )
                                }
                              >
                                Reject finding
                              </Button>
                            </div>
                          </div>
                        ) : escalating === finding.id ? (
                          <div className="space-y-2">
                            <Textarea
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              rows={2}
                              placeholder="Note for Legal (optional)"
                              className="rounded-none border-border bg-background text-[12px]"
                            />
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="rounded-none text-[10px]"
                                onClick={() => setEscalating(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                className="rounded-none bg-[#8F2F24] text-[10px] text-white hover:bg-[#7A281F]"
                                disabled={Boolean(busy)}
                                onClick={() =>
                                  act(
                                    `escalate-${finding.id}`,
                                    async () => {
                                      await escalate({
                                        findingDocId: finding.docId as Id<"findings">,
                                        note: reason || undefined,
                                      });
                                      setReason("");
                                    },
                                    "Escalated to Legal.",
                                  )
                                }
                              >
                                Confirm escalation
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Button
                              size="sm"
                              className="h-7 rounded-none bg-[#4F5C47] px-2.5 text-[10px] text-white hover:bg-[#40503A]"
                              onClick={() =>
                                submitDecision(
                                  finding.docId as Id<"findings">,
                                  finding.id,
                                  "accept",
                                )
                              }
                              disabled={Boolean(busy)}
                            >
                              <Check className="mr-1 size-3" /> Accept
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 rounded-none px-2.5 text-[10px]"
                              onClick={() => {
                                setEditing(finding.id);
                                setEditValue(finding.suggestedFix);
                              }}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 rounded-none px-2.5 text-[10px]"
                              onClick={() => {
                                setRejectingFinding(finding.id);
                                setReason("");
                              }}
                            >
                              Reject
                            </Button>
                            {canEscalate && finding.reviewer === "claims" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 rounded-none px-2 text-[10px] text-[#8F2F24]"
                                onClick={() => {
                                  setEscalating(finding.id);
                                  setReason("");
                                }}
                              >
                                Escalate to Legal
                              </Button>
                            )}
                            <button
                              onClick={() => setCommentTarget(finding.id)}
                              className="ml-auto flex items-center gap-1 font-mono text-[9px] text-muted-foreground hover:text-foreground"
                            >
                              <MessageSquare className="size-3" /> Comment
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 border-t border-border/60 pt-2">
                        <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                          Pending human decision · switch to Reviewer or Approver
                        </p>
                      </div>
                    )}
                    <span className="mt-2 block font-mono text-[8px] text-muted-foreground/60">
                      {finding.evidenceType === "computed"
                        ? "computed evidence"
                        : "verbatim span"}{" "}
                      · {index + 1} of {filtered.length}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="border border-border bg-card">
            <div className="border-b border-border/80 px-5 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                Decision
              </p>
            </div>
            <div className="px-5 py-4">
              {approved ? (
                <div>
                  <div className="flex items-center gap-2">
                    <Stamp className="size-4 text-[#4F5C47]" />
                    <p className="font-serif text-[20px]">Approved by a human</p>
                  </div>
                  <p className="mt-2 text-[11.5px] leading-5 text-muted-foreground">
                    Version {submission.currentVersion} is cleared for publication. No
                    content was published by this tool.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      className="rounded-none text-[11px]"
                      onClick={downloadReceipt}
                      disabled={receiptBusy}
                    >
                      {receiptBusy ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <Download className="mr-1.5 size-3.5" />
                      )}
                      {submission.status === "receipt_exported"
                        ? "Download receipt again"
                        : "Export review receipt"}
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="rounded-none text-[11px]"
                    >
                      <Link to="/app/audit">
                        <History className="mr-1.5 size-3.5" /> Audit trail
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : inReview ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-serif text-[19px]">
                        {blocking > 0
                          ? `${blocking} blocking finding${blocking === 1 ? "" : "s"} open`
                          : "Ready for a decision"}
                      </p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        {blocking > 0
                          ? "Approve stays locked until every verified critical and high finding has a decision."
                          : "All verified critical and high findings have a human decision. Low-confidence items can remain open."}
                      </p>
                    </div>
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {openFindings} open
                    </span>
                  </div>

                  {canApprove ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="rounded-none text-[11px]"
                          disabled={Boolean(busy) || blocking > 0}
                          onClick={() =>
                            act(
                              "approve",
                              () => approve({ submissionId: submission._id }),
                              "Submission approved. The decision is in the audit trail.",
                            )
                          }
                        >
                          <Check className="mr-1.5 size-3.5" /> Approve version
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-none text-[11px]"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            act(
                              "revision",
                              () => revision({ submissionId: submission._id }),
                              "Revision requested. The creator can submit a new version.",
                            )
                          }
                        >
                          Request revision
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-none text-[11px] text-[#8F2F24]"
                          onClick={() => setRejectOpen((value) => !value)}
                        >
                          Reject
                        </Button>
                      </div>
                      {rejectOpen && (
                        <div className="space-y-2 border-t border-border/70 pt-3">
                          <Textarea
                            value={submissionReason}
                            onChange={(e) => setSubmissionReason(e.target.value)}
                            rows={2}
                            placeholder="Reason for rejecting this submission"
                            className="rounded-none border-border bg-background text-[12px]"
                          />
                          <Button
                            size="sm"
                            className="rounded-none bg-[#8F2F24] text-[10px] text-white hover:bg-[#7A281F]"
                            disabled={Boolean(busy) || submissionReason.trim().length < 3}
                            onClick={() =>
                              act(
                                "rejectSubmission",
                                () =>
                                  reject({
                                    submissionId: submission._id,
                                    reason: submissionReason,
                                  }),
                                "Submission rejected, with a reason on the record.",
                              )
                            }
                          >
                            Confirm rejection
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="border border-border bg-background px-3 py-2.5">
                      <p className="text-[11px] leading-5 text-muted-foreground">
                        You are acting as <span className="capitalize">{role}</span>.
                        Approval and rejection belong to the Approver. Use the role
                        switcher above to sign off.
                      </p>
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-none px-0 text-[10px] text-muted-foreground hover:bg-transparent"
                    onClick={() => setRevisionNote("")}
                    type="button"
                  >
                    <GitCompareArrows className="mr-1.5 size-3" />
                    {currentVersion
                      ? `${currentVersion.text.length.toLocaleString()} characters under review`
                      : ""}
                  </Button>
                  {revisionNote && <p className="text-[10px]">{revisionNote}</p>}
                </div>
              ) : submission.status === "needs_revision" ? (
                <div>
                  <p className="font-serif text-[19px]">Returned for revision</p>
                  <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">
                    The creator can submit a new version above. This version stays
                    frozen with its findings and hash.
                  </p>
                </div>
              ) : submission.status === "rejected" ? (
                <div>
                  <p className="font-serif text-[19px] text-[#8F2F24]">
                    Rejected by the approver
                  </p>
                  <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">
                    The reason is in the audit trail. A new submission starts a fresh
                    review.
                  </p>
                </div>
              ) : (
                <p className="text-[11.5px] text-muted-foreground">
                  No decision is available in the current state.
                </p>
              )}
            </div>
          </section>

          <section className="border border-border bg-[#1F1D1A] p-5 text-[#F4EFE6]">
            <div className="flex items-center justify-between">
              <Wordmark compact />
              <FileText className="size-4 text-[#F4EFE6]/60" />
            </div>
            <p className="mt-3 border-t border-[#F4EFE6]/15 pt-3 font-serif text-[18px] leading-[1.4]">
              Nothing here is auto-applied.
            </p>
            <p className="mt-2 text-[10.5px] leading-5 text-[#F4EFE6]/60">
              Accepting a finding records agreement with the proposed fix. It does not
              edit the source text, publish anything, or approve the submission. That
              stays a separate human decision.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
