import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useConvex, useQuery } from "convex/react";
import {
  CheckCircle2,
  ChevronDown,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

type VerifyResult = {
  ok: boolean;
  count: number;
  checkedAt: number;
  reason: string;
  brokenAt: number | null;
  head: string;
};

export default function Audit() {
  const events = useQuery(api.audit.list);
  const convex = useConvex();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const verify = async () => {
    setVerifying(true);
    try {
      const outcome = (await convex.query(
        api.audit.verifyChain,
        {},
      )) as VerifyResult;
      setResult(outcome);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <AppShell>
      <div className="grid gap-6 xl:grid-cols-[1.55fr_0.85fr]">
        <section className="min-w-0 border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 px-5 py-4">
            <div>
              <p className="label-caps">Append-only record</p>
              <h2 className="mt-1.5 font-serif text-[26px] leading-none">
                Every action, chained
              </h2>
            </div>
            <Button
              size="sm"
              className="rounded-none text-[11px]"
              onClick={verify}
              disabled={verifying}
            >
              {verifying ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="mr-1.5 size-3.5" />
              )}
              Verify chain
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border/70 px-5 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
              {events?.length ?? 0} entries loaded · newest first
            </p>
            <p className="font-mono text-[9px] text-muted-foreground">
              hash = SHA-256(seq + prev_hash + actor + action + payload + time)
            </p>
          </div>

          {events === undefined ? (
            <div className="flex items-center gap-2 px-5 py-12 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reading the chain…
            </div>
          ) : (
            <div>
              {events.map((event) => (
                <div
                  key={event.id}
                  className="border-b border-border/60 last:border-b-0"
                >
                  <button
                    onClick={() =>
                      setExpanded(expanded === event.id ? null : event.id)
                    }
                    className="grid w-full grid-cols-[52px_1fr_auto] items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-background"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">
                      #{String(event.seq).padStart(3, "0")}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-medium">{event.action}</p>
                      <p className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground">
                        {event.actorName} · {event.actorRole} · {event.entityType}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[8.5px] text-muted-foreground/80">
                        {event.hash.slice(0, 28)}… ←{" "}
                        {event.prevHash === "GENESIS"
                          ? "GENESIS"
                          : `${event.prevHash.slice(0, 12)}…`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="hidden text-[9px] text-muted-foreground sm:block">
                        {dateTime(event.createdAt)}
                      </span>
                      <ChevronDown
                        className={cn(
                          "size-3.5 text-muted-foreground transition-transform",
                          expanded === event.id && "rotate-180",
                        )}
                      />
                    </div>
                  </button>
                  {expanded === event.id && (
                    <div className="border-t border-border/50 bg-background px-5 py-3 pl-[72px]">
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[9.5px] leading-5 text-muted-foreground">
                        {event.payload}
                      </pre>
                      <p className="mt-2 font-mono text-[8.5px] text-muted-foreground">
                        ENTITY · {event.entityId}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section
            className={cn(
              "border p-5",
              result
                ? result.ok
                  ? "border-[#6F7D66]/50 bg-[#6F7D66]/8"
                  : "border-[#8F2F24]/50 bg-[#8F2F24]/6"
                : "border-border bg-card",
            )}
          >
            <div className="flex items-center gap-2">
              {result ? (
                result.ok ? (
                  <CheckCircle2 className="size-4 text-[#4F5C47]" />
                ) : (
                  <ShieldAlert className="size-4 text-[#8F2F24]" />
                )
              ) : (
                <ShieldCheck className="size-4 text-muted-foreground" />
              )}
              <p className="font-mono text-[9px] uppercase tracking-[0.14em]">
                Chain verification
              </p>
            </div>
            {result ? (
              <>
                <p className="mt-3 font-serif text-[25px] leading-none">
                  {result.ok ? "Chain intact" : "Chain broken"}
                </p>
                <p className="mt-2 text-[11.5px] leading-5 text-muted-foreground">
                  {result.reason}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 font-mono text-[9px] text-muted-foreground">
                  <span>Entries</span>
                  <span className="text-right">{result.count}</span>
                  <span>Broken at</span>
                  <span className="text-right">{result.brokenAt ?? "—"}</span>
                  <span>Head</span>
                  <span className="truncate text-right">{result.head.slice(0, 18)}…</span>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 font-serif text-[22px] leading-tight">
                  Recompute the whole chain.
                </p>
                <p className="mt-2 text-[11.5px] leading-5 text-muted-foreground">
                  Each entry is hashed from its own fields and the previous hash. The
                  verifier walks the chain in sequence and reports the first mismatch.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 rounded-none text-[11px]"
                  onClick={verify}
                  disabled={verifying}
                >
                  Run verification
                </Button>
              </>
            )}
          </section>

          <section className="border border-border bg-card p-5">
            <p className="label-caps">What is recorded</p>
            <ul className="mt-3 space-y-2 text-[11px] leading-5 text-muted-foreground">
              <li>Submission created, reviewed and versioned</li>
              <li>Every finding decision, with role and optional reason</li>
              <li>Legal escalations and submission-level decisions</li>
              <li>Receipt exports, with the receipt digest</li>
              <li>Demo role switches and rulebook publications</li>
            </ul>
            <p className="mt-3 border-t border-border/70 pt-3 text-[10px] leading-4 text-muted-foreground">
              Convex does not allow editing an audit row from the app. The chain makes
              a direct database edit detectable.
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
