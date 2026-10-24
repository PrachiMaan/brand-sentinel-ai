import { Wordmark } from "@/components/brand/chips";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { motion } from "framer-motion";
import { ArrowRight, Check, Minus } from "lucide-react";
import { Link } from "react-router";

const fade = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

const IDEAS = [
  {
    n: "01",
    title: "Brand Pack Compiler",
    body: "Guideline documents become typed rules with source excerpts. An admin reviews, edits and publishes. Nothing enters the rulebook by itself.",
  },
  {
    n: "02",
    title: "Two-lane review",
    body: "Deterministic checks run in under a second. Five specialist reviewers read for judgment. Model calls only happen where reading is required.",
  },
  {
    n: "03",
    title: "Evidence or silence",
    body: "A finding survives only if its quoted span is verbatim, its rule exists, and its guideline excerpt is from the rulebook. Low confidence goes to Needs human.",
  },
  {
    n: "04",
    title: "Claim Ledger",
    body: "Approved claims carry an owner, evidence and expiry. Copy is labelled Supported, Unsupported, Expired or Contradicts, and the nearest approved wording is proposed.",
  },
  {
    n: "05",
    title: "Human decisions",
    body: "Accept, edit or reject per finding, with comments and a reason on rejection. Fixes are tracked diffs with an intent-preservation score. Nothing auto-applies.",
  },
  {
    n: "06",
    title: "Receipt and audit",
    body: "Every decision is hash-chained. An approver signs off and exports a receipt with the version hash, findings, models used and the AI disclosure statement.",
  },
];

const CHECKS = [
  "The quoted span exists verbatim in the submitted content",
  "The rule_id is published in the current rulebook",
  "The guideline excerpt is a real quote from the rulebook",
  "Claim findings reference an id that exists in the Claim Ledger",
];

export default function Landing() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/92 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between px-5 sm:px-8">
          <Link to="/">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-7 text-[12px] text-muted-foreground md:flex">
            <a href="#ideas" className="transition-colors hover:text-foreground">
              The six ideas
            </a>
            <a href="#pipeline" className="transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#evidence" className="transition-colors hover:text-foreground">
              Evidence
            </a>
            <a href="#roles" className="transition-colors hover:text-foreground">
              Demo roles
            </a>
          </nav>
          <div className="flex items-center gap-3">
            {isAuthenticated && (
              <Link
                to="/app"
                className="hidden text-[12px] text-muted-foreground hover:text-foreground sm:inline"
              >
                Workspace
              </Link>
            )}
            <Button asChild size="sm" className="h-8 rounded-none px-4 text-[12px]">
              <Link to="/demo">
                Enter the demo <ArrowRight className="ml-1.5 size-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto w-full max-w-[1180px] px-5 pb-14 pt-12 sm:px-8 sm:pt-16 lg:pb-20">
          <div className="grid gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-14">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex items-center gap-3">
                <span className="h-[1px] w-8 bg-foreground/40" />
                <span className="label-caps">Round 2 prototype · Lumora demo workspace</span>
              </div>
              <h1 className="serif-display mt-7 text-[clamp(3.1rem,7.2vw,5.5rem)]">
                The brand gate
                <br />
                you can audit.
              </h1>
              <p className="mt-7 max-w-[46ch] text-[15px] leading-7 text-muted-foreground">
                BrandSentinel reviews content before it is published against a
                company&apos;s own guidelines. Findings arrive with evidence, a rule
                and a source excerpt. A human accepts, edits or rejects each one, and
                the decision trail is hash-chained.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild className="h-11 rounded-none px-6 text-[13px]">
                  <Link to="/demo">
                    Try the Lumora demo <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-11 rounded-none border-border px-6 text-[13px]"
                >
                  <a href="#pipeline">See the pipeline</a>
                </Button>
              </div>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                No signup · one-click roles · synthetic brand, seeded data
              </p>

              <div className="mt-10 grid grid-cols-3 gap-px border border-border bg-border">
                {[
                  ["14", "typed rules"],
                  ["6", "ledger claims"],
                  ["05", "specialist reviewers"],
                ].map(([value, label]) => (
                  <div key={label} className="bg-card px-3 py-4">
                    <p className="font-serif text-[28px] leading-none">{value}</p>
                    <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                      {label}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              <div className="absolute -left-3 top-4 hidden h-[calc(100%-2rem)] w-[1px] bg-border lg:block" />
              <div className="paper">
                <div className="flex items-center justify-between border-b border-border/80 px-5 py-3">
                  <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                    Specimen · Instagram caption · v3
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#8F4526]">
                    <span className="size-1.5 rounded-full bg-[#A9552F]" /> 7 findings
                  </span>
                </div>
                <div className="px-5 py-6">
                  <p className="font-serif text-[24px] leading-[1.35]">
                    <span className="finding-mark-critical">Glow Serum</span> is here — and
                    it&apos;s a{" "}
                    <span className="finding-mark-critical">MIRACLE</span> for tired
                    skin. Clinically proven to{" "}
                    <span className="finding-mark">remove wrinkles in 7 days</span>.
                    Get yours before it sells out!!
                  </p>
                  <p className="mt-4 font-mono text-[10px] leading-5 text-muted-foreground">
                    Caption colours: #FF2E93 on #F4EFE6 ·{" "}
                    <span className="finding-mark">1.9:1 contrast</span>
                  </p>
                </div>
                <div className="border-t border-border/80 bg-[#A9552F]/[0.035] px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="border border-[#8F2F24]/40 px-1.5 py-[2px] font-mono text-[8px] uppercase tracking-[0.16em] text-[#8F2F24]">
                      Critical
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                      Terminology &amp; messaging · R-TERM-01
                    </span>
                    <span className="ml-auto flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#4F5C47]">
                      <Check className="size-3" /> evidence verified
                    </span>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-6">
                    &ldquo;Glow Serum&rdquo; drops the brand name. The rule requires
                    the full product name on first mention.
                  </p>
                  <div className="mt-3 border-l border-border pl-3">
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                      Guideline · Edition 4
                    </p>
                    <p className="mt-1 text-[11.5px] italic leading-5 text-muted-foreground">
                      &ldquo;Always write the full product name &lsquo;Lumora Glow
                      Serum&rsquo; on first mention.&rdquo;
                    </p>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px]">
                    <span className="border border-border px-1.5 py-[2px] font-mono text-[9px] text-muted-foreground">
                      FIX
                    </span>
                    <span className="font-mono text-[11px]">
                      <span className="text-[#8F2F24] line-through">Glow Serum</span>{" "}
                      <span className="text-[#4F5C47]">Lumora Glow Serum</span>
                    </span>
                    <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                      intent 0.61
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-start justify-between gap-4 px-1">
                <p className="text-[10px] leading-4 text-muted-foreground">
                  Every finding on the right carries the same six pieces of evidence.
                </p>
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                  Fig. 01
                </span>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="border-y border-border/80 bg-card/40">
          <div className="mx-auto grid w-full max-w-[1180px] gap-px bg-border/70 px-5 py-0 sm:px-8 md:grid-cols-4">
            {[
              ["The gate", "Content cannot be approved while a critical finding is unresolved."],
              ["The evidence", "Verbatim spans, real rules, real quotes. Invented proof is dropped."],
              ["The human", "Creator submits. Reviewer decides. Approver signs. Legal can be raised."],
              ["The record", "Hash-chained audit and a PDF receipt for every approved version."],
            ].map(([title, body]) => (
              <div key={title} className="bg-background px-1 py-7 md:px-6">
                <p className="label-caps">{title}</p>
                <p className="mt-2 text-[12.5px] leading-6 text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
            <div>
              <p className="label-caps">The problem</p>
              <h2 className="mt-4 font-serif text-[34px] leading-[1.1] sm:text-[40px]">
                Content ships faster than the brand can check it.
              </h2>
            </div>
            <div className="space-y-5 text-[14.5px] leading-7 text-muted-foreground lg:pl-10">
              <p>
                A single unclaimed promise in a paid ad can cost a week of removal
                requests and verification. An old product name stays in the search
                index long after the campaign ends. Style guides do not enforce
                themselves at the moment of publishing, and the people writing the
                copy are not the people who own the rules.
              </p>
              <p>
                BrandSentinel sits between the draft and the publish button. It does
                not replace the brand team. It gives them a smaller queue, each item
                with evidence they can check in seconds, and a record of what they
                decided.
              </p>
              <div className="border-l-2 border-foreground/60 pl-5 font-serif text-[20px] leading-[1.45] text-foreground">
                &ldquo;A finding that cannot show its evidence never reaches a human.
                That is the whole product.&rdquo;
              </div>
            </div>
          </div>
        </section>

        <section id="ideas" className="border-t border-border/80">
          <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="label-caps">Six ideas</p>
                <h2 className="mt-3 font-serif text-[36px] leading-none sm:text-[44px]">
                  What makes this different
                </h2>
              </div>
              <p className="max-w-[38ch] text-[12.5px] leading-6 text-muted-foreground">
                Each one exists in the running product. If it were not built, it would
                not be on this list.
              </p>
            </div>
            <div className="mt-10 grid gap-px border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
              {IDEAS.map((idea) => (
                <motion.div
                  key={idea.n}
                  {...fade}
                  className="group bg-card p-6 transition-colors hover:bg-background"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground">
                      {idea.n}
                    </span>
                    <span className="h-[1px] w-6 bg-border transition-all group-hover:w-10 group-hover:bg-foreground/40" />
                  </div>
                  <h3 className="mt-6 font-serif text-[22px] leading-tight">{idea.title}</h3>
                  <p className="mt-3 text-[12.5px] leading-6 text-muted-foreground">
                    {idea.body}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section id="pipeline" className="border-t border-border/80 bg-card/50">
          <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-20">
            <p className="label-caps">The pipeline</p>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <h2 className="max-w-[18ch] font-serif text-[36px] leading-[1.05] sm:text-[44px]">
                Two lanes, one gate
              </h2>
              <p className="max-w-[44ch] text-[12.5px] leading-6 text-muted-foreground">
                The fast lane is deterministic and returns in milliseconds. The deep
                lane runs five reviewers in parallel, then a verifier that can only
                delete, never add.
              </p>
            </div>

            <div className="mt-10 grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1.05fr]">
              <div className="paper p-5">
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  Lane 01 · deterministic · &lt; 1s
                </p>
                <h3 className="mt-2 font-serif text-[24px]">Fast lane</h3>
                <ul className="mt-4 space-y-2.5 border-t border-border/70 pt-4">
                  {[
                    "Glossary and banned terms",
                    "Product naming and casing",
                    "WCAG contrast ratio",
                    "Missing alt text",
                    "Palette distance in CIELAB",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[12px] leading-5">
                      <Minus className="mt-[3px] size-3 shrink-0 text-muted-foreground" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="hidden items-center justify-center lg:flex">
                <ArrowRight className="size-4 text-muted-foreground" />
              </div>
              <div className="paper p-5">
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
                  Lane 02 · judgment · parallel
                </p>
                <h3 className="mt-2 font-serif text-[24px]">Deep lane</h3>
                <ul className="mt-4 space-y-2.5 border-t border-border/70 pt-4">
                  {[
                    "Tone & voice",
                    "Terminology & messaging",
                    "Claims against the ledger",
                    "Visual consistency",
                    "Accessibility reading",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[12px] leading-5">
                      <Minus className="mt-[3px] size-3 shrink-0 text-muted-foreground" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="hidden items-center justify-center lg:flex">
                <ArrowRight className="size-4 text-muted-foreground" />
              </div>
              <div className="border border-foreground/25 bg-foreground p-5 text-background">
                <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-background/60">
                  Evidence gate
                </p>
                <h3 className="mt-2 font-serif text-[24px] text-background">
                  Verifier → Synthesizer
                </h3>
                <p className="mt-4 border-t border-background/20 pt-4 text-[12px] leading-6 text-background/75">
                  Duplicates are merged, severity decides order, fixes get an intent
                  score. Dropped findings are counted and shown, not hidden.
                </p>
                <Link
                  to="/demo"
                  className="mt-5 inline-flex items-center gap-1.5 border-b border-background/40 pb-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-background"
                >
                  Run it on the sample <ArrowRight className="size-3" />
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section id="evidence" className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div>
              <p className="label-caps">Evidence or silence</p>
              <h2 className="mt-3 font-serif text-[36px] leading-[1.05] sm:text-[42px]">
                Four checks
                <br />
                before a finding
                <br />
                reaches you.
              </h2>
              <p className="mt-5 max-w-[38ch] text-[13px] leading-6 text-muted-foreground">
                Models are useful readers and unreliable witnesses. So we do not trust
                their output by default. A dropped finding is logged with its reason,
                and the report shows how many were suppressed.
              </p>
            </div>
            <div className="border border-border">
              {CHECKS.map((check, index) => (
                <div
                  key={check}
                  className="flex gap-4 border-b border-border/70 px-5 py-5 last:border-b-0"
                >
                  <span className="font-mono text-[10px] text-muted-foreground">
                    0{index + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-[13.5px] leading-6">{check}</p>
                  </div>
                  <Check className="mt-1 size-4 shrink-0 text-[#4F5C47]" strokeWidth={1.6} />
                </div>
              ))}
              <div className="bg-secondary/60 px-5 py-4">
                <p className="font-mono text-[10px] leading-5 text-muted-foreground">
                  FAILURE MODES TARGETED · tone drift · naming · unsupported claim ·
                  expired claim · visual inconsistency · accessibility
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="roles" className="border-t border-border/80 bg-card/60">
          <div className="mx-auto w-full max-w-[1180px] px-5 py-16 sm:px-8 sm:py-20">
            <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="label-caps">Judge access</p>
                <h2 className="mt-3 font-serif text-[36px] leading-[1.05] sm:text-[42px]">
                  Four roles.
                  <br />
                  No signup.
                </h2>
                <p className="mt-5 max-w-[40ch] text-[13.5px] leading-6 text-muted-foreground">
                  Enter as any Lumora persona with one click. The role switcher stays in
                  the header, so you can submit as Creator, decide as Reviewer and sign
                  off as Approver without changing accounts. Every switch is audited.
                </p>
                <Button asChild className="mt-6 h-11 rounded-none px-6 text-[13px]">
                  <Link to="/demo">
                    Open the demo screen <ArrowRight className="ml-2 size-4" />
                  </Link>
                </Button>
              </div>
              <div className="grid gap-px border border-border bg-border sm:grid-cols-2">
                {[
                  ["Creator", "Maya Rao", "Writes and submits the launch caption."],
                  ["Reviewer", "Dev Kapoor", "Accepts, edits or rejects each finding."],
                  ["Approver", "Ines Alvarez", "Approves, rejects, or escalates to Legal."],
                  ["Admin", "Ravi Shah", "Publishes the rulebook and compiles guidelines."],
                ].map(([role, name, blurb]) => (
                  <div key={role} className="bg-card p-5">
                    <p className="label-caps text-[9px]">{role}</p>
                    <p className="mt-2 font-serif text-[20px] leading-tight">{name}</p>
                    <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">
                      {blurb}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/80">
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-3">
            <Wordmark compact />
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              Round 2 · October 2026
            </span>
          </div>
          <p className="max-w-[62ch] text-[10.5px] leading-5 text-muted-foreground">
            Lumora is a synthetic brand created for this prototype. All content,
            claims and studies are fictional. Model output is treated as a proposal;
            a human makes every decision.
          </p>
        </div>
      </footer>
    </div>
  );
}
