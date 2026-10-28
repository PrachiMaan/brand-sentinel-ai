import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, Database, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

function TrendChart({
  points,
}: {
  points: { day: string; rate: number; decisions: number }[];
}) {
  if (points.length < 2) {
    return (
      <p className="px-5 py-10 text-[11.5px] text-muted-foreground">
        Not enough days yet. Load the 90-day history or run more reviews.
      </p>
    );
  }
  const width = 720;
  const height = 150;
  const max = Math.max(20, ...points.map((p) => p.rate));
  const step = width / (points.length - 1);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${index * step} ${height - (point.rate / max) * height}`)
    .join(" ");
  return (
    <div className="px-5 py-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[150px] w-full" role="img" aria-label="Override rate over time">
        <line x1="0" y1={height} x2={width} y2={height} stroke="currentColor" strokeOpacity="0.2" />
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeOpacity="0.1" strokeDasharray="3 4" />
        <path d={path} fill="none" stroke="#B4643C" strokeWidth="1.6" />
        {points.map((point, index) => (
          <circle key={point.day} cx={index * step} cy={height - (point.rate / max) * height} r="1.8" fill="#B4643C">
            <title>{`${point.day}: ${pct(point.rate)} over ${point.decisions} decisions`}</title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[8.5px] text-muted-foreground">
        <span>{points[0].day}</span>
        <span>peak {pct(max)}</span>
        <span>{points[points.length - 1].day}</span>
      </div>
    </div>
  );
}

function TracePanel({ suggestionId }: { suggestionId: Id<"ruleSuggestions"> }) {
  const rows = useQuery(api.analytics.traceSuggestion, { suggestionId });
  if (rows === undefined) {
    return (
      <p className="px-3 py-3 text-[10.5px] text-muted-foreground">
        <Loader2 className="mr-1 inline size-3 animate-spin" /> Loading decisions…
      </p>
    );
  }
  if (!rows.length) {
    return (
      <p className="px-3 py-3 text-[10.5px] text-muted-foreground">
        No decision rows are attached to this suggestion.
      </p>
    );
  }
  return (
    <div className="divide-y divide-border/60 border-t border-border/60">
      {rows.map((row) => (
        <div key={`${row.findingId}-${row.createdAt}`} className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted-foreground">
            <span>{row.decision}</span>
            <span>{row.severity ?? "—"}</span>
            <span>{row.actorName} · {row.actorRole}</span>
            <span>{new Date(row.createdAt).toISOString().slice(0, 10)}</span>
            {row.synthetic && <span className="text-[#7A6334]">synthetic</span>}
          </div>
          <p className="mt-1 text-[11px] leading-4">
            &ldquo;{row.spanText ?? "span unavailable"}&rdquo;
          </p>
          <p className="mt-0.5 text-[10.5px] leading-4 text-muted-foreground">
            {row.submissionTitle} · reason: {row.reason ?? "none recorded"}
          </p>
        </div>
      ))}
    </div>
  );
}

export default function RuleHealth() {
  const [ruleId, setRuleId] = useState<string | undefined>(undefined);
  const data = useQuery(api.analytics.overview, ruleId ? { ruleId } : {});
  const seed = useMutation(api.analytics.seedHistory);
  const remove = useMutation(api.analytics.removeSynthetic);
  const recompute = useMutation(api.analytics.recompute);
  const suggest = useMutation(api.analytics.generateSuggestions);
  const decide = useMutation(api.analytics.decideSuggestion);
  const publish = useMutation(api.analytics.publishDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [openTrace, setOpenTrace] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState("");

  const isAdmin = data?.role === "admin";
  const synthetic = (data?.syntheticSubmissions ?? 0) > 0;

  const run = async (label: string, task: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(label);
    try {
      await task();
      toast(`${label} finished`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const loadHistory = () =>
    run("Loading synthetic history", async () => {
      for (let batch = 0; batch < 3; batch++) {
        await seed({ batch });
      }
      for (let batch = 0; batch < 3; batch++) {
        await recompute({ batch });
      }
      await suggest({});
    });

  const recomputeAll = () =>
    run("Recomputing", async () => {
      for (let batch = 0; batch < 3; batch++) {
        await recompute({ batch });
      }
    });

  const cards = data?.cards;

  return (
    <AppShell>
      <div className="space-y-6">
        <section className="grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              "Override rate",
              cards ? pct(cards.overrideRate) : "—",
              cards
                ? `95% CI ${cards.ciLow.toFixed(1)}–${cards.ciHigh.toFixed(1)} · ${cards.decisions} decisions`
                : "no decisions yet",
            ],
            [
              "Top drifting channel",
              cards?.topDriftChannel ? cards.topDriftChannel.channel : "—",
              cards?.topDriftChannel
                ? `${cards.topDriftChannel.team} · ${pct(cards.topDriftChannel.baseline)} to ${pct(
                    cards.topDriftChannel.recent,
                  )} (${cards.topDriftChannel.delta > 0 ? "+" : ""}${cards.topDriftChannel.delta} pts)`
                : "needs 10+ decisions in both 30-day windows",
            ],
            [
              "Median time to approval",
              cards?.medianApprovalHours != null ? `${cards.medianApprovalHours}h` : "—",
              cards?.p90ApprovalHours != null
                ? `p90 ${cards.p90ApprovalHours}h · created to approved`
                : "no approved submissions yet",
            ],
            [
              "Rules needing attention",
              cards ? String(cards.rulesNeedingAttention) : "—",
              "override rate ≥ 25% with 20+ decisions",
            ],
          ].map(([label, value, note]) => (
            <div key={label} className="bg-card px-5 py-5">
              <p className="font-serif text-[30px] leading-none">{value}</p>
              <p className="mt-1.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">{note}</p>
            </div>
          ))}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              {synthetic ? "Synthetic Lumora data" : "Live decisions only"}
            </span>
            {data?.computedAt && (
              <span className="font-mono text-[9px] text-muted-foreground">
                · aggregates computed {new Date(data.computedAt).toISOString().slice(0, 16).replace("T", " ")} UTC
              </span>
            )}
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="h-8 rounded-none text-[11px]"
                disabled={Boolean(busy) || synthetic}
                onClick={loadHistory}
              >
                {busy === "Loading synthetic history" ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Database className="mr-1.5 size-3.5" />
                )}
                Load 90-day synthetic history
              </Button>
              <Button
                variant="outline"
                className="h-8 rounded-none text-[11px]"
                disabled={Boolean(busy) || !synthetic}
                onClick={() => run("Removing synthetic history", () => remove({}))}
              >
                <Trash2 className="mr-1.5 size-3.5" /> Remove synthetic history
              </Button>
              <Button
                variant="outline"
                className="h-8 rounded-none text-[11px]"
                disabled={Boolean(busy)}
                onClick={recomputeAll}
              >
                <RefreshCw className={cn("mr-1.5 size-3.5", busy === "Recomputing" && "animate-spin")} />
                Recompute now
              </Button>
              <Button
                className="h-8 rounded-none text-[11px]"
                disabled={Boolean(busy)}
                onClick={() => run("Generating suggestions", () => suggest({}))}
              >
                <Sparkles className="mr-1.5 size-3.5" /> Suggest rewordings
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
          <section className="min-w-0 border border-border bg-card">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 px-5 py-4">
              <div>
                <p className="label-caps">Per rule</p>
                <h2 className="mt-1.5 font-serif text-[26px] leading-none">
                  Where humans disagree
                </h2>
                <p className="mt-2 max-w-[62ch] text-[11px] leading-5 text-muted-foreground">
                  Override rate counts edits, rejections and legal escalations against all
                  decisions. The interval is Wilson 95%; a rule under 20 decisions is not
                  judged.
                </p>
              </div>
            </div>
            {data === undefined ? (
              <div className="flex items-center gap-2 px-5 py-12 text-[12px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Aggregating decisions…
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border/70 bg-background/60">
                      {["Rule", "Findings", "Decisions", "Accept", "Override", "Rate", "95% CI"].map(
                        (label) => (
                          <th
                            key={label}
                            className="px-3 py-2 font-mono text-[8.5px] font-normal uppercase tracking-[0.12em] text-muted-foreground"
                          >
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.summaries.map((row) => (
                      <tr key={row.ruleId} className="border-b border-border/60">
                        <td className="px-3 py-2.5">
                          <p className="font-mono text-[9px] text-muted-foreground">{row.ruleId}</p>
                          <p className="mt-0.5 max-w-[34ch] text-[11px] leading-4">{row.title}</p>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[10px]">{row.findings}</td>
                        <td className="px-3 py-2.5 font-mono text-[10px]">{row.decisions}</td>
                        <td className="px-3 py-2.5 font-mono text-[10px]">{row.accepted}</td>
                        <td className="px-3 py-2.5 font-mono text-[10px]">{row.overridden}</td>
                        <td className="px-3 py-2.5 font-mono text-[10px]">
                          {row.decisions ? pct(row.overrideRate) : "—"}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-[9.5px] text-muted-foreground">
                          {row.enoughData
                            ? `${row.ciLow.toFixed(0)}–${row.ciHigh.toFixed(0)}%`
                            : "not enough data"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="space-y-5">
            <section className="border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 px-5 py-3">
                <p className="label-caps">Trend · override rate</p>
                <Select
                  value={ruleId ?? "all"}
                  onValueChange={(value) => setRuleId(value === "all" ? undefined : value)}
                >
                  <SelectTrigger className="h-7 w-[190px] rounded-none border-border bg-card text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All rules</SelectItem>
                    {(data?.summaries ?? []).map((row) => (
                      <SelectItem key={row.ruleId} value={row.ruleId}>
                        {row.ruleId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <TrendChart points={data?.trend ?? []} />
            </section>

            <section className="border border-border bg-card">
              <div className="border-b border-border/80 px-5 py-3">
                <p className="label-caps">By team and channel</p>
              </div>
              <div className="divide-y divide-border/60">
                {(data?.heatmap ?? []).slice(0, 8).map((row) => {
                  const rate = row.decisions ? (row.overridden / row.decisions) * 100 : 0;
                  return (
                    <div key={`${row.team}-${row.channel}`} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="w-[86px] font-mono text-[9.5px] text-muted-foreground">
                        {row.team} · {row.channel}
                      </span>
                      <div className="h-1.5 flex-1 bg-border/60">
                        <div
                          className="h-full bg-[#B4643C]"
                          style={{ width: `${Math.min(100, rate)}%` }}
                        />
                      </div>
                      <span className="w-[64px] text-right font-mono text-[9.5px]">
                        {pct(rate)}
                      </span>
                      <span className="w-[58px] text-right font-mono text-[9px] text-muted-foreground">
                        n={row.decisions}
                      </span>
                    </div>
                  );
                })}
                {(data?.heatmap ?? []).length === 0 && (
                  <p className="px-5 py-6 text-[11px] text-muted-foreground">
                    No decisions with a team and channel yet.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>

        <section className="border border-border bg-card">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 px-5 py-4">
            <div>
              <p className="label-caps">Suggested rewordings</p>
              <h2 className="mt-1.5 font-serif text-[24px] leading-none">
                Generated from the decisions, not from taste
              </h2>
              <p className="mt-2 max-w-[80ch] text-[11px] leading-5 text-muted-foreground">
                A rule is proposed for rewriting when at least 12 decisions exist and more
                than 25% disagree with it. Each proposal quotes the published rule and the
                recorded reasons. Accepting creates a draft; nothing changes the rulebook
                until an admin publishes it.
              </p>
            </div>
            <span className="font-mono text-[9px] text-muted-foreground">
              {data?.suggestions.length ?? 0} proposals
            </span>
          </div>

          {(data?.suggestions ?? []).length === 0 ? (
            <p className="px-5 py-8 text-[11.5px] text-muted-foreground">
              No rule has enough disagreement to propose a rewrite. Load the 90-day history
              on an admin seat, or record more decisions.
            </p>
          ) : (
            <div className="divide-y divide-border/60">
              {(data?.suggestions ?? []).map((suggestion) => (
                <div key={suggestion.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {suggestion.ruleId}
                    </span>
                    <span className="text-[12px]">{suggestion.ruleTitle}</span>
                    <span className="border border-border px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                      {suggestion.method}
                    </span>
                    <span className="border border-border px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                      {suggestion.status}
                    </span>
                    <button
                      onClick={() =>
                        setOpenTrace(openTrace === suggestion.id ? null : suggestion.id)
                      }
                      className="ml-auto flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
                    >
                      Traceable evidence ({suggestion.evidenceCount})
                      <ChevronDown
                        className={cn(
                          "size-3 transition-transform",
                          openTrace === suggestion.id && "rotate-180",
                        )}
                      />
                    </button>
                  </div>
                  <p className="mt-2 max-w-[100ch] border-l-2 border-border pl-3 text-[11.5px] leading-5">
                    {suggestion.proposedWording}
                  </p>
                  <p className="mt-1.5 max-w-[100ch] text-[10.5px] leading-4 text-muted-foreground">
                    {suggestion.rationale}
                  </p>

                  {openTrace === suggestion.id && (
                    <div className="mt-2 border border-border/70 bg-background">
                      <TracePanel suggestionId={suggestion.id} />
                    </div>
                  )}

                  {isAdmin && suggestion.status === "proposed" && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7 rounded-none text-[10.5px]"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          run("Accepting suggestion", async () => {
                            await decide({
                              suggestionId: suggestion.id,
                              decision: "accept",
                            });
                          })
                        }
                      >
                        Accept as draft
                      </Button>
                      {dismissing === suggestion.id ? (
                        <>
                          <input
                            value={dismissReason}
                            onChange={(event) => setDismissReason(event.target.value)}
                            placeholder="Reason"
                            className="h-7 w-[220px] border border-border bg-background px-2 text-[11px]"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 rounded-none text-[10.5px]"
                            disabled={dismissReason.trim().length < 3}
                            onClick={() =>
                              run("Dismissing suggestion", async () => {
                                await decide({
                                  suggestionId: suggestion.id,
                                  decision: "dismiss",
                                  reason: dismissReason,
                                });
                                setDismissing(null);
                                setDismissReason("");
                              })
                            }
                          >
                            Confirm dismiss
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 rounded-none text-[10.5px]"
                          onClick={() => setDismissing(suggestion.id)}
                        >
                          Dismiss
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {(data?.drafts ?? []).length > 0 && (
            <div className="border-t border-border/70 bg-background px-5 py-4">
              <p className="label-caps">Draft rulebook changes</p>
              {(data?.drafts ?? []).map((draft) => (
                <div key={draft.id} className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[9px] text-muted-foreground">{draft.ruleId}</span>
                  <p className="max-w-[70ch] text-[11px] leading-4">{draft.proposedWording}</p>
                  {isAdmin && (
                    <Button
                      size="sm"
                      className="ml-auto h-7 rounded-none text-[10.5px]"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        run("Publishing rule", () => publish({ draftId: draft.id }))
                      }
                    >
                      Publish new rulebook version
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
