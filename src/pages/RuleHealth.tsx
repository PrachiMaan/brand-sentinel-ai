import { AppShell } from "@/components/AppShell";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { Info, Loader2 } from "lucide-react";

export default function RuleHealth() {
  const data = useQuery(api.rules.overrideStats);

  return (
    <AppShell>
      <div className="grid gap-6 xl:grid-cols-[1.6fr_0.8fr]">
        <section className="min-w-0 border border-border bg-card">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 px-5 py-5">
            <div>
              <p className="label-caps">Rule health · Tier 2</p>
              <h2 className="mt-1.5 font-serif text-[28px] leading-none">
                Where humans disagree
              </h2>
              <p className="mt-2 max-w-[62ch] text-[11.5px] leading-5 text-muted-foreground">
                Override rate counts edits, rejections and legal escalations against all
                decisions for a rule. Accept means the reviewer agreed with the machine.
              </p>
            </div>
            <div className="text-right">
              <p className="font-serif text-[28px] leading-none">
                {data?.realTotal ?? 0}
              </p>
              <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted-foreground">
                live decisions
              </p>
            </div>
          </div>

          {data === undefined ? (
            <div className="flex items-center gap-2 px-5 py-12 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Aggregating decisions…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border/70 bg-background/60">
                    {[
                      "Rule",
                      "Accept",
                      "Edit",
                      "Reject",
                      "Escalate",
                      "Override",
                      "Volume",
                    ].map((label) => (
                      <th
                        key={label}
                        className="px-4 py-2 font-mono text-[8.5px] font-normal uppercase tracking-[0.12em] text-muted-foreground"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.ruleId} className="border-b border-border/60">
                      <td className="px-4 py-3">
                        <p className="font-mono text-[9px] text-muted-foreground">
                          {row.ruleId}
                        </p>
                        <p className="mt-0.5 max-w-[34ch] text-[11.5px] leading-4">
                          {row.title}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-[10.5px]">{row.accept}</td>
                      <td className="px-4 py-3 font-mono text-[10.5px]">{row.edit}</td>
                      <td className="px-4 py-3 font-mono text-[10.5px]">{row.reject}</td>
                      <td className="px-4 py-3 font-mono text-[10.5px]">{row.escalate}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-10 font-mono text-[10.5px]">
                            {row.overrideRate}%
                          </span>
                          <div className="h-1.5 w-20 bg-secondary">
                            <div
                              className="h-1.5 bg-[#A9552F]"
                              style={{ width: `${Math.min(100, row.overrideRate)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-[9px] text-muted-foreground">
                          {row.total}
                        </span>
                        {row.seeded > 0 && (
                          <span className="ml-1.5 border border-border px-1 py-[1px] font-mono text-[7.5px] uppercase tracking-[0.1em] text-muted-foreground">
                            {row.seeded} seeded
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-[12px] text-muted-foreground"
                      >
                        No decisions yet. Review a submission to populate this table.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-start gap-2 border-t border-border/70 bg-background/60 px-5 py-3">
            <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[10px] leading-4 text-muted-foreground">
              This table includes {data?.seededTotal ?? 0} seeded demo decisions,
              labelled “seeded”, so the view is populated on first visit. Everything
              without that label comes from a real action in this workspace. The full
              Rule Health dashboard, with drift by team and channel, is Round 3 work.
            </p>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="border border-border bg-card p-5">
            <p className="label-caps">How to read it</p>
            <div className="mt-3 space-y-3 text-[11px] leading-5 text-muted-foreground">
              <p>
                A high override rate does not automatically mean a bad rule. It means
                people frequently disagree with how the machine applied it. That is a
                candidate for rewording, narrowing or retiring.
              </p>
              <p>
                A rule with volume and zero overrides is doing its job quietly. A rule
                with low volume should be left alone until there is evidence.
              </p>
            </div>
          </section>
          <section className="border border-border bg-card p-5">
            <p className="label-caps">Decision mix</p>
            <div className="mt-3 space-y-2">
              {data?.rows.slice(0, 6).map((row) => {
                const total = Math.max(1, row.total);
                return (
                  <div key={row.ruleId}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[9px] text-muted-foreground">
                        {row.ruleId}
                      </span>
                      <span className="font-mono text-[9px] text-muted-foreground">
                        {row.total}
                      </span>
                    </div>
                    <div className="mt-1 flex h-1.5 w-full overflow-hidden bg-secondary">
                      <div
                        className="bg-[#6F7D66]"
                        style={{ width: `${(row.accept / total) * 100}%` }}
                      />
                      <div
                        className="bg-[#B99A5E]"
                        style={{ width: `${(row.edit / total) * 100}%` }}
                      />
                      <div
                        className="bg-[#A9552F]"
                        style={{ width: `${(row.reject / total) * 100}%` }}
                      />
                      <div
                        className="bg-[#8F2F24]"
                        style={{ width: `${(row.escalate / total) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 border-t border-border/70 pt-3 font-mono text-[8px] uppercase tracking-[0.08em] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="size-2 bg-[#6F7D66]" /> accept
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 bg-[#B99A5E]" /> edit
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 bg-[#A9552F]" /> reject
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2 bg-[#8F2F24]" /> legal
              </span>
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
