import { AppShell } from "@/components/AppShell";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

type Results = {
  generatedAt: string;
  itemCount: number;
  overall: {
    precision: number;
    recall: number;
    f1: number;
    expected: number;
    predicted: number;
    matched: number;
  };
  byFailureMode: {
    mode: string;
    expected: number;
    predicted: number;
    matched: number;
    precision: number;
    recall: number;
  }[];
  evidence: {
    modelFindings: number;
    validEvidence: number;
    validityPct: number;
    suppressed: number;
    needsHuman: number;
  };
  timing: { fastMedianMs: number; fullMedianMs: number };
  injection: { items: number; handled: number };
  errors: number;
  notes?: string[];
};

const MODE_LABEL: Record<string, string> = {
  tone: "Tone drift",
  naming: "Terminology & naming",
  unsupported_claim: "Unsupported claim",
  expired_claim: "Expired claim",
  visual: "Visual inconsistency",
  accessibility: "Accessibility",
  clean: "Clean control",
  injection: "Prompt injection",
};

export default function Reliability() {
  const calls = useQuery(api.brand.modelLog);
  const [results, setResults] = useState<Results | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/eval/results.json")
      .then((response) => {
        if (!response.ok) throw new Error("missing");
        return response.json();
      })
      .then((data) => {
        if (active) setResults(data as Results);
      })
      .catch(() => {
        if (active) setMissing(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AppShell>
      <div className="space-y-6">
        <section className="grid gap-px border border-border bg-border sm:grid-cols-4">
          {[
            [
              "Eval items",
              results ? String(results.itemCount) : "—",
              results
                ? `${results.overall.expected} expected findings`
                : "run npm run eval",
            ],
            [
              "Precision",
              results ? `${Math.round(results.overall.precision * 100)}%` : "—",
              "matched / predicted",
            ],
            [
              "Recall",
              results ? `${Math.round(results.overall.recall * 100)}%` : "—",
              "matched / expected",
            ],
            [
              "Suppressed",
              results ? String(results.evidence.suppressed) : "—",
              "removed by the verifier",
            ],
          ].map(([label, value, note]) => (
            <div key={label} className="bg-card px-5 py-5">
              <p className="font-serif text-[32px] leading-none">{value}</p>
              <p className="mt-1.5 font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">{note}</p>
            </div>
          ))}
        </section>

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <section className="min-w-0 border border-border bg-card">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 px-5 py-4">
              <div>
                <p className="label-caps">Red-team evaluation</p>
                <h2 className="mt-1.5 font-serif text-[26px] leading-none">
                  Precision and recall, by failure mode
                </h2>
              </div>
              {results && (
                <p className="font-mono text-[9px] text-muted-foreground">
                  {new Date(results.generatedAt).toLocaleString("en-GB")}
                </p>
              )}
            </div>

            {missing ? (
              <div className="px-5 py-10">
                <p className="font-serif text-[20px]">No results file on this deployment.</p>
                <p className="mt-2 max-w-[62ch] text-[11.5px] leading-5 text-muted-foreground">
                  Run <code className="font-mono text-foreground">npm run eval</code>{" "}
                  from the repository. The script posts the Lumora red-team set through
                  the real pipeline and writes <code className="font-mono text-foreground">eval/results.json</code>,
                  which is copied to the public folder for this page.
                </p>
              </div>
            ) : !results ? (
              <div className="flex items-center gap-2 px-5 py-12 text-[12px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading results…
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse">
                  <thead>
                    <tr className="border-b border-border/70 bg-background/60">
                      {["Failure mode", "Expected", "Predicted", "Matched", "Precision", "Recall"].map(
                        (label) => (
                          <th
                            key={label}
                            className="px-4 py-2 text-left font-mono text-[8.5px] font-normal uppercase tracking-[0.12em] text-muted-foreground"
                          >
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {results.byFailureMode.map((row) => (
                      <tr key={row.mode} className="border-b border-border/60">
                        <td className="px-4 py-2.5 text-[11.5px]">
                          {MODE_LABEL[row.mode] ?? row.mode}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[10px]">{row.expected}</td>
                        <td className="px-4 py-2.5 font-mono text-[10px]">{row.predicted}</td>
                        <td className="px-4 py-2.5 font-mono text-[10px]">{row.matched}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={cn(
                              "font-mono text-[10px]",
                              row.precision >= 0.8
                                ? "text-[#4F5C47]"
                                : row.precision >= 0.5
                                  ? "text-[#7A6334]"
                                  : "text-[#8F2F24]",
                            )}
                          >
                            {(row.precision * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={cn(
                              "font-mono text-[10px]",
                              row.recall >= 0.8
                                ? "text-[#4F5C47]"
                                : row.recall >= 0.5
                                  ? "text-[#7A6334]"
                                  : "text-[#8F2F24]",
                            )}
                          >
                            {(row.recall * 100).toFixed(0)}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-border/70 px-5 py-3">
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Matching is by failure-mode tag and rule family per item, not exact
                    wording. These numbers are produced by{" "}
                    <code className="font-mono">npm run eval</code> over the seeded set.
                    Misses are reported, not hidden.
                  </p>
                </div>
                {results.notes && results.notes.length > 0 && (
                  <div className="border-t border-border/70 px-5 py-3">
                    <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted-foreground">
                      Honest reading
                    </p>
                    <ul className="mt-1.5 space-y-1">
                      {results.notes.map((note) => (
                        <li key={note} className="text-[10.5px] leading-5 text-muted-foreground">
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside className="space-y-5">
            <section className="border border-border bg-card p-5">
              <p className="label-caps">Timing</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="font-serif text-[24px] leading-none">
                    {results ? `${results.timing.fastMedianMs.toFixed(0)}ms` : "—"}
                  </p>
                  <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                    median fast lane
                  </p>
                </div>
                <div>
                  <p className="font-serif text-[24px] leading-none">
                    {results ? `${(results.timing.fullMedianMs / 1000).toFixed(1)}s` : "—"}
                  </p>
                  <p className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                    median full report
                  </p>
                </div>
              </div>
              <p className="mt-3 border-t border-border/70 pt-3 text-[10px] leading-4 text-muted-foreground">
                Fast lane is measured in-process. Full report includes five parallel
                model calls plus verification and synthesis.
              </p>
            </section>

            <section className="border border-border bg-card p-5">
              <p className="label-caps">Guardrails exercised</p>
              <ul className="mt-3 space-y-2 text-[10.5px] leading-5 text-muted-foreground">
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-[#4F5C47]" />
                  Content is delimited and labelled as data in every prompt.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-[#4F5C47]" />
                  Malformed JSON gets one repair attempt, then the run is marked degraded.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-[#4F5C47]" />
                  A repeated submit reuses the active run instead of starting a second.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-[#4F5C47]" />
                  PII is redacted before model calls and restored before evidence checks.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-[#4F5C47]" />
                  Model failure keeps deterministic findings and shows a banner.
                </li>
              </ul>
            </section>

            <section className="border border-border bg-card p-5">
              <p className="label-caps">Injection probe</p>
              <p className="mt-2 font-serif text-[24px] leading-none">
                {results ? `${results.injection.handled}/${results.injection.items}` : "—"}
              </p>
              <p className="mt-1 text-[10.5px] leading-5 text-muted-foreground">
                items where instruction-like content was treated as plain content and the
                expected findings still fired.
              </p>
            </section>
          </aside>
        </div>

        <section className="border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 px-5 py-3">
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
              Model call log · last {calls?.length ?? 0}
            </p>
            <p className="font-mono text-[9px] text-muted-foreground">
              prompt hash · latency · tokens · redactions
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="border-b border-border/70 bg-background/60">
                  {["Purpose", "Model", "Prompt", "Latency", "Tokens in/out", "Redactions", "Status", "When"].map(
                    (label) => (
                      <th
                        key={label}
                        className="px-4 py-2 text-left font-mono text-[8px] font-normal uppercase tracking-[0.1em] text-muted-foreground"
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {(calls ?? []).map((call) => (
                  <tr key={call.id} className="border-b border-border/50">
                    <td className="px-4 py-2 font-mono text-[9.5px]">{call.purpose}</td>
                    <td className="px-4 py-2 font-mono text-[9.5px] text-muted-foreground">
                      {call.model}
                    </td>
                    <td className="px-4 py-2 font-mono text-[9px] text-muted-foreground">
                      {call.promptHash}
                    </td>
                    <td className="px-4 py-2 font-mono text-[9.5px]">
                      {call.latencyMs}ms
                    </td>
                    <td className="px-4 py-2 font-mono text-[9px] text-muted-foreground">
                      {call.inputTokens ?? "—"}/{call.outputTokens ?? "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-[9px]">{call.redactions}</td>
                    <td className="px-4 py-2">
                      {call.ok ? (
                        <span className="flex items-center gap-1 font-mono text-[9px] text-[#4F5C47]">
                          <CheckCircle2 className="size-3" /> ok
                        </span>
                      ) : (
                        <span
                          title={call.error ?? ""}
                          className="flex items-center gap-1 font-mono text-[9px] text-[#8F2F24]"
                        >
                          <XCircle className="size-3" /> error
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[9px] text-muted-foreground">
                      {new Date(call.createdAt).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
                {(calls ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-[11px] text-muted-foreground"
                    >
                      No model calls yet. Run a review to populate this log.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
