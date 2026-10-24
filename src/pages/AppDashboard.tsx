import { AppShell } from "@/components/AppShell";
import { StatusChip, Wordmark } from "@/components/brand/chips";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { timeAgo } from "@/lib/format";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  BookOpen,
  FilePlus2,
  Loader2,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

const STEPS = [
  ["01", "Submit", "Load the Lumora caption. Fast lane flags issues immediately."],
  ["02", "Review", "Five reviewers report. The verifier suppresses anything unsupported."],
  ["03", "Decide", "Accept, edit or reject. Approve with the Approver role."],
  ["04", "Receipt", "Export the PDF. Check the audit chain from the sidebar."],
];

export default function AppDashboard() {
  const overview = useQuery(api.brand.overview);
  const submissions = useQuery(api.submissions.list);
  const [filter, setFilter] = useState<"all" | "open">("all");

  const rows = (submissions ?? []).filter((s) =>
    filter === "all"
      ? true
      : ["findings_ready", "human_review", "ai_review", "draft"].includes(s.status),
  );

  return (
    <AppShell>
      <div className="grid gap-6 xl:grid-cols-[1.55fr_0.85fr]">
        <div className="min-w-0">
          <section className="border border-border bg-card">
            <div className="flex flex-col gap-4 border-b border-border/80 px-5 py-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="label-caps">Lumora Studio · live queue</p>
                <h2 className="mt-2 font-serif text-[30px] leading-none">
                  The gate, this morning
                </h2>
                <p className="mt-2 max-w-[52ch] text-[12px] leading-5 text-muted-foreground">
                  Open a submission to work its findings. The whole loop runs on seeded
                  Lumora data, with live model review.
                </p>
              </div>
              <Button asChild className="h-9 rounded-none px-4 text-[12px]">
                <Link to="/app/submit">
                  <FilePlus2 className="mr-2 size-3.5" /> New submission
                </Link>
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
              {[
                ["Awaiting review", overview?.counts.awaitingReview ?? 0],
                ["Findings", overview?.counts.findings ?? 0],
                ["Decided", overview?.counts.decided ?? 0],
                ["Approved", overview?.counts.approved ?? 0],
              ].map(([label, value]) => (
                <div key={String(label)} className="bg-card px-4 py-4">
                  <p className="font-serif text-[28px] leading-none">{String(value)}</p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground">
                    {label}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between border-y border-border/80 px-5 py-2.5">
              <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                Submissions
              </p>
              <div className="flex gap-1">
                {(["all", "open"] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => setFilter(value)}
                    className={
                      filter === value
                        ? "bg-foreground px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-background"
                        : "px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
                    }
                  >
                    {value === "all" ? "All" : "Open"}
                  </button>
                ))}
              </div>
            </div>

            {submissions === undefined ? (
              <div className="flex items-center gap-2 px-5 py-12 text-[12px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading submissions…
              </div>
            ) : rows.length === 0 ? (
              <div className="px-5 py-12">
                <p className="font-serif text-[23px]">Nothing in the queue yet.</p>
                <p className="mt-2 max-w-[46ch] text-[12px] leading-5 text-muted-foreground">
                  Submit the seeded Lumora launch caption. The fast lane will flag
                  naming, prohibited words, an expired claim and contrast before the
                  deep review finishes.
                </p>
                <Button asChild className="mt-4 h-9 rounded-none text-[12px]">
                  <Link to="/app/submit">Load sample content</Link>
                </Button>
              </div>
            ) : (
              <div>
                {rows.map((row) => (
                  <Link
                    key={row.id}
                    to={`/app/review/${row.id}`}
                    className="group grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border/60 px-5 py-4 transition-colors last:border-b-0 hover:bg-background"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-serif text-[18px] leading-tight">
                          {row.title}
                        </p>
                        {row.legalFlag && (
                          <span className="border border-[#8F2F24]/50 px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.14em] text-[#8F2F24]">
                            Legal
                          </span>
                        )}
                      </div>
                      <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted-foreground">
                        {row.channel} · v{row.version} · {row.creatorName} ·{" "}
                        {timeAgo(row.updatedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="hidden text-right sm:block">
                        <p className="font-serif text-[18px] leading-none">
                          {row.findingCount}
                        </p>
                        <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                          findings
                        </p>
                      </div>
                      <StatusChip status={row.status} />
                      <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="mt-6 border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border/80 px-5 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                The two-minute path
              </p>
              <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                Creator → Reviewer → Approver
              </span>
            </div>
            <div className="grid gap-px bg-border sm:grid-cols-4">
              {STEPS.map(([n, title, body]) => (
                <div key={n} className="bg-card px-4 py-4">
                  <p className="font-mono text-[9px] text-muted-foreground">{n}</p>
                  <p className="mt-2 font-serif text-[17px]">{title}</p>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{body}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-6">
          <section className="border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <p className="label-caps">Active brand pack</p>
              <span className="border border-[#6F7D66]/50 px-1.5 py-[2px] font-mono text-[8px] uppercase tracking-[0.14em] text-[#4F5C47]">
                Published
              </span>
            </div>
            <p className="mt-3 font-serif text-[26px] leading-none">
              {overview?.brandPack?.name ?? "Lumora"}
            </p>
            <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
              {overview?.brandPack?.version ?? "Loading edition"}
            </p>
            <div className="mt-4 flex gap-1.5">
              {(overview?.accent ?? []).map((swatch) => (
                <div
                  key={swatch.hex}
                  title={`${swatch.name} ${swatch.hex}`}
                  className="h-7 flex-1 border border-black/10"
                  style={{ backgroundColor: swatch.hex }}
                />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-px bg-border">
              {[
                ["Rules", overview?.counts.rules ?? 0],
                ["Claims", overview?.counts.claims ?? 0],
                ["Expiring / expired", overview?.counts.expiringClaims ?? 0],
                ["Model calls", overview?.counts.modelCalls ?? 0],
              ].map(([label, value]) => (
                <div key={String(label)} className="bg-card px-3 py-2.5">
                  <p className="font-serif text-[19px] leading-none">{String(value)}</p>
                  <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                    {label}
                  </p>
                </div>
              ))}
            </div>
            <Link
              to="/app/rulebook"
              className="mt-4 inline-flex items-center gap-1.5 border-b border-foreground/25 pb-0.5 font-mono text-[9px] uppercase tracking-[0.13em]"
            >
              Open the rulebook <ArrowRight className="size-3" />
            </Link>
          </section>

          <section className="border border-border bg-card p-5">
            <p className="label-caps">Shortcuts</p>
            <div className="mt-3 divide-y divide-border/70">
              {([
                ["/app/audit", "Audit trail", "Verify the hash chain", ScrollText],
                ["/app/rules", "Rule health", "Override rates by rule", BookOpen],
                ["/app/reliability", "Reliability", "Calls, verifier, eval", ShieldCheck],
              ] as [string, string, string, typeof ScrollText][]).map(
                ([to, label, note, Component]) => {
                return (
                  <Link
                    key={String(to)}
                    to={String(to)}
                    className="group flex items-center gap-3 py-3"
                  >
                    <Component
                      className="size-4 text-muted-foreground"
                      strokeWidth={1.5}
                    />
                    <div className="flex-1">
                      <p className="text-[12px] leading-4">{label}</p>
                      <p className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted-foreground">
                        {note}
                      </p>
                    </div>
                    <ArrowRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                );
                },
              )}
            </div>
          </section>

          <section className="border border-border bg-[#1F1D1A] p-5 text-[#F4EFE6]">
            <Wordmark compact />
            <p className="mt-4 border-t border-[#F4EFE6]/20 pt-4 font-serif text-[19px] leading-[1.35]">
              &ldquo;A finding that cannot show its evidence never reaches a
              human.&rdquo;
            </p>
            <p className="mt-3 text-[10.5px] leading-5 text-[#F4EFE6]/60">
              Suppressed findings stay counted. The report tells you what the verifier
              removed and why.
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
