import { Wordmark } from "@/components/brand/chips";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useAuthActions } from "@convex-dev/auth/react";
import { motion } from "framer-motion";
import { useMutation } from "convex/react";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

const PERSONAS = [
  {
    role: "creator" as const,
    name: "Maya Rao",
    title: "Creator",
    line: "Write the caption. Run the gate.",
    detail:
      "Submits the Lumora launch caption, sees the fast lane as she types, and waits for the report.",
  },
  {
    role: "reviewer" as const,
    name: "Dev Kapoor",
    title: "Reviewer",
    line: "Work the findings.",
    detail:
      "Accepts, edits or rejects each finding with a reason. Can send the version back for revision.",
  },
  {
    role: "approver" as const,
    name: "Ines Alvarez",
    title: "Approver",
    line: "Sign it off, or stop it.",
    detail:
      "Approves or rejects. Claims findings can be escalated to Legal. Exports the review receipt.",
  },
  {
    role: "admin" as const,
    name: "Ravi Shah",
    title: "Admin",
    line: "Own the rulebook.",
    detail:
      "Compiles a guideline document into typed rules, edits the proposal and publishes it.",
  },
];

function safeReturn(value: string | null) {
  if (value?.startsWith("/") && !value.startsWith("//")) return value;
  return "/app";
}

export default function Demo() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { signIn } = useAuthActions();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const enterDemo = useMutation(api.session.enterDemo);
  const returnTo = safeReturn(searchParams.get("returnTo"));

  const start = async (role: (typeof PERSONAS)[number]["role"]) => {
    setBusy(role);
    try {
      if (!isAuthenticated) {
        await signIn("anonymous");
      }
      let lastError: unknown = null;
      let done = false;
      for (let attempt = 0; attempt < 6 && !done; attempt++) {
        try {
          await enterDemo({ role });
          done = true;
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (!done) throw lastError;
      toast(`Entered as ${PERSONAS.find((p) => p.role === role)?.name}`, {
        description: "You can switch roles at any time from the header.",
      });
      navigate(returnTo);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start the demo session.",
      );
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/80">
        <div className="mx-auto flex h-16 w-full max-w-[1100px] items-center justify-between px-5 sm:px-8">
          <Link to="/">
            <Wordmark />
          </Link>
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            Demo access · no signup
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] px-5 py-10 sm:px-8 sm:py-14">
        <div className="grid gap-12 lg:grid-cols-[0.78fr_1.22fr]">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <p className="label-caps">Lumora Studio · synthetic brand</p>
            <h1 className="serif-display mt-5 text-[clamp(2.6rem,5vw,3.6rem)]">
              Choose a seat
              <br />
              at the gate.
            </h1>
            <p className="mt-5 max-w-[38ch] text-[13.5px] leading-6 text-muted-foreground">
              One click signs you into the seeded Lumora workspace under a demo
              persona. Use the role switcher in the header to move between seats
              without signing up again.
            </p>

            <div className="mt-8 border border-border bg-card/60 p-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-[#4F5C47]" strokeWidth={1.5} />
                <p className="font-mono text-[9px] uppercase tracking-[0.14em]">
                  What is real here
                </p>
              </div>
              <ul className="mt-3 space-y-2 text-[11.5px] leading-5 text-muted-foreground">
                <li>The rulebook, claims ledger and guideline document are seeded.</li>
                <li>Model calls are live. Findings are stored, not mocked.</li>
                <li>Every role switch and decision is written to the audit chain.</li>
                <li>Nothing is published anywhere. Approval only produces a receipt.</li>
              </ul>
            </div>

            <p className="mt-5 text-[10.5px] leading-5 text-muted-foreground">
              Returning judge? You are already signed in
              {user?.isAnonymous ? " as a demo guest" : ""}. Picking a role simply
              moves your membership to that seat.
            </p>
          </motion.div>

          <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
            {PERSONAS.map((persona, index) => (
              <motion.button
                key={persona.role}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.06 }}
                onClick={() => start(persona.role)}
                disabled={Boolean(busy) || isLoading}
                className={cn(
                  "group flex min-h-[210px] flex-col items-start bg-card p-5 text-left transition-colors",
                  "hover:bg-background disabled:cursor-wait disabled:opacity-70",
                )}
              >
                <div className="flex w-full items-start justify-between">
                  <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                    0{index + 1} · {persona.title}
                  </span>
                  {busy === persona.role ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                  )}
                </div>
                <h2 className="mt-6 font-serif text-[27px] leading-none">{persona.name}</h2>
                <p className="mt-1.5 font-serif text-[15px] italic text-muted-foreground">
                  {persona.line}
                </p>
                <p className="mt-3 text-[11.5px] leading-5 text-muted-foreground">
                  {persona.detail}
                </p>
                <span className="mt-auto pt-4 font-mono text-[9px] uppercase tracking-[0.14em] text-foreground/70">
                  Enter as {persona.title.toLowerCase()}
                </span>
              </motion.button>
            ))}
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border/80 pt-5">
          <p className="max-w-[60ch] text-[10.5px] leading-5 text-muted-foreground">
            The demo uses anonymous authentication. No email is collected. Data lives
            in the shared Lumora workspace and may be visible to other visitors, so do
            not paste confidential material.
          </p>
          <Button asChild variant="outline" className="rounded-none text-[12px]">
            <Link to="/auth?returnTo=/app">Use email sign-in instead</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
