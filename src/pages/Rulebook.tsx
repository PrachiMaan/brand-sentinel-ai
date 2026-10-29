import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { GUIDELINE_DOCUMENT } from "@/convex/lib/lumora";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Check,
  FileUp,
  Loader2,
  Minus,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type Tab = "rules" | "claims" | "glossary" | "compiler";

type ProposedRule = {
  rule_id: string;
  category: string;
  type: string;
  title: string;
  description: string;
  severity: string;
  source_excerpt: string;
};

type Proposal = {
  brand_name?: string;
  rules: ProposedRule[];
  claims?: { text: string; status: string; evidence?: string }[];
  glossary?: { term: string; status: string; replacement?: string }[];
  model?: string;
  latencyMs?: number;
};

const CATEGORY_ORDER = [
  "naming",
  "tone",
  "terminology",
  "claims",
  "visual",
  "accessibility",
  "channel",
];

export default function Rulebook() {
  const data = useQuery(api.brand.rulebook);
  const me = useQuery(api.session.me);
  const jobs = useQuery(api.brand.compileJobs);
  const compile = useAction(api.compile.compile);
  const publish = useMutation(api.compileInternal.publish);
  const [tab, setTab] = useState<Tab>("rules");
  const [documentText, setDocumentText] = useState("");
  const [filename, setFilename] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [jobId, setJobId] = useState<Id<"compileJobs"> | null>(null);
  const [drafts, setDrafts] = useState<ProposedRule[]>([]);
  const [proposalMeta, setProposalMeta] = useState<Proposal | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [pastedOpen, setPastedOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const isAdmin = me?.role === "admin";
  const newestJob = jobs?.[0];
  const activeJob = jobs?.find((job) => job._id === jobId) ?? newestJob;

  useEffect(() => {
    if (!activeJob?.proposal) return undefined;
    const job = activeJob;
    const proposal = activeJob.proposal;
    // Deferred one tick: hydrating the editor from the stored job must not
    // trigger a cascading render inside the same commit.
    const timer = setTimeout(() => {
      try {
        const parsed = JSON.parse(proposal) as Proposal;
        setProposalMeta(parsed);
        setDrafts(parsed.rules ?? []);
        setCompileError(job.error ?? null);
        if (!jobId) setJobId(job._id);
      } catch {
        setCompileError("The stored proposal could not be parsed.");
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [activeJob?.proposal, activeJob?._id]);

  const extract = async (file: File) => {
    setExtracting(true);
    setCompileError(null);
    try {
      const name = file.name.toLowerCase();
      let text = "";
      if (name.endsWith(".pdf")) {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        const buffer = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buffer }).promise;
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
          const page = await doc.getPage(pageNumber);
          const content = await page.getTextContent();
          const strings = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .join(" ")
            .replace(/\s+/g, " ");
          pages.push(`Page ${pageNumber}\n${strings}`);
        }
        text = pages.join("\n\n");
        toast(`Extracted ${doc.numPages} page${doc.numPages === 1 ? "" : "s"}`, {
          description: `${text.length.toLocaleString()} characters of text.`,
        });
      } else if (name.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const buffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: buffer });
        text = result.value;
        toast("DOCX text extracted", {
          description: `${text.length.toLocaleString()} characters.`,
        });
      } else if (
        name.endsWith(".txt") ||
        name.endsWith(".md") ||
        name.endsWith(".csv")
      ) {
        text = await file.text();
        toast("Text extracted", {
          description: `${text.length.toLocaleString()} characters.`,
        });
      } else {
        throw new Error("Use a PDF, DOCX, TXT, MD or CSV file.");
      }
      if (text.trim().length < 80) {
        throw new Error(
          "Almost no text came out of that file. Scanned PDFs need OCR, which is not built.",
        );
      }
      setDocumentText(text);
      setFilename(file.name);
      setTab("compiler");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not extract text from that document.",
      );
    } finally {
      setExtracting(false);
    }
  };

  const runCompiler = async () => {
    if (!documentText.trim()) {
      toast.error("Upload a document or load the sample guidelines first.");
      return;
    }
    setCompiling(true);
    setCompileError(null);
    try {
      const result = await compile({
        filename: filename || "pasted-guidelines.txt",
        documentText,
      });
      setJobId(result.jobId);
      toast(`${result.rules} rules proposed`, {
        description: `${result.model} · ${(result.latencyMs / 1000).toFixed(1)}s. Review before publishing.`,
      });
    } catch (error) {
      setCompileError(
        error instanceof Error ? error.message : "Compilation failed.",
      );
      toast.error("The compiler could not finish.");
    } finally {
      setCompiling(false);
    }
  };

  const publishRules = async () => {
    if (!activeJob) return;
    if (!drafts.length) {
      toast.error("There are no rules to publish.");
      return;
    }
    setPublishing(true);
    try {
      const result = await publish({
        jobId: activeJob._id,
        rulesJson: JSON.stringify(drafts),
        glossaryJson: JSON.stringify(proposalMeta?.glossary ?? []),
      });
      toast("Rulebook published", {
        description: `${result.created} created, ${result.updated} updated, ${result.glossaryAdded} glossary terms added.`,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not publish the rules.",
      );
    } finally {
      setPublishing(false);
    }
  };

  return (
    <AppShell>
      <div className="grid gap-6 xl:grid-cols-[1.55fr_0.85fr]">
        <section className="min-w-0 border border-border bg-card">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 px-5 py-5">
            <div>
              <p className="label-caps">Published brand pack</p>
              <h2 className="mt-1.5 font-serif text-[28px] leading-none">
                {data?.pack?.name ?? "Lumora"}
              </h2>
              <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                {data?.pack?.version ?? "Edition 4"} ·{" "}
                {data?.rules.filter((r) => r.published).length ?? 0} rules published
              </p>
            </div>
            <div className="flex gap-1.5">
              {(data?.pack?.palette ?? []).map((swatch) => (
                <div
                  key={swatch.hex}
                  title={`${swatch.name} ${swatch.hex}`}
                  className="h-6 w-8 border border-black/10"
                  style={{ backgroundColor: swatch.hex }}
                />
              ))}
            </div>
          </div>

          <div className="flex gap-1 border-b border-border/80 px-3 py-2">
            {(
              [
                ["rules", "Rules"],
                ["claims", "Claim Ledger"],
                ["glossary", "Glossary"],
                ["compiler", "Compiler"],
              ] as [Tab, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={cn(
                  "px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em]",
                  tab === value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "rules" && (
            <div>
              {CATEGORY_ORDER.filter((category) =>
                (data?.rules ?? []).some((rule) => rule.category === category),
              ).map((category) => (
                <div key={category}>
                  <div className="flex items-center gap-2 border-b border-border/60 bg-background/60 px-5 py-2">
                    <p className="font-mono text-[8.5px] uppercase tracking-[0.16em] text-muted-foreground">
                      {category}
                    </p>
                    <span className="h-px flex-1 bg-border/60" />
                  </div>
                  {(data?.rules ?? [])
                    .filter((rule) => rule.category === category)
                    .map((rule) => (
                      <div
                        key={rule._id}
                        className="border-b border-border/60 px-5 py-3.5 last:border-b-0"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[9px] text-muted-foreground">
                            {rule.ruleId}
                          </span>
                          <p className="text-[12.5px] font-medium">{rule.title}</p>
                          <span className="border border-border px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                            {rule.type}
                          </span>
                          <span
                            className={cn(
                              "ml-auto px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.1em]",
                              rule.severity === "critical"
                                ? "border border-[#8F2F24]/40 text-[#8F2F24]"
                                : rule.severity === "high"
                                  ? "border border-[#A9552F]/40 text-[#8F4526]"
                                  : "border border-border text-muted-foreground",
                            )}
                          >
                            {rule.severity}
                          </span>
                        </div>
                        <p className="mt-1.5 max-w-[80ch] text-[11.5px] leading-5 text-muted-foreground">
                          {rule.description}
                        </p>
                        <p className="mt-1.5 border-l border-border pl-2.5 text-[10.5px] italic leading-4 text-muted-foreground">
                          “{rule.sourceExcerpt}”
                        </p>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}

          {tab === "claims" && (
            <div>
              <div className="border-b border-border/60 bg-background/60 px-5 py-2.5">
                <p className="text-[10.5px] leading-5 text-muted-foreground">
                  Status and expiry are authoritative. The Claims reviewer must return a
                  ledger id, and the verifier rejects ids that do not exist.
                </p>
              </div>
              {(data?.claims ?? []).map((claim) => (
                <div
                  key={claim._id}
                  className="border-b border-border/60 px-5 py-3.5 last:border-b-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {claim.claimId}
                    </span>
                    <span
                      className={cn(
                        "px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.1em]",
                        claim.status === "approved"
                          ? "border border-[#6F7D66]/50 text-[#4F5C47]"
                          : claim.status === "expiring"
                            ? "border border-[#B99A5E]/60 text-[#7A6334]"
                            : "border border-[#8F2F24]/50 text-[#8F2F24]",
                      )}
                    >
                      {claim.status}
                    </span>
                    <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                      {claim.expiresAt
                        ? `${claim.status === "expired" ? "expired" : "expires"} ${claim.expiresAt}`
                        : "no expiry"}
                    </span>
                  </div>
                  <p className="mt-1.5 font-serif text-[15px] leading-6">{claim.text}</p>
                  <p className="mt-1 text-[10.5px] text-muted-foreground">
                    Evidence: {claim.evidence} · Owner: {claim.owner}
                  </p>
                  {claim.approvedWording && (
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      APPROVED · {claim.approvedWording}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "glossary" && (
            <div>
              {(data?.glossary ?? []).map((term) => (
                <div
                  key={term._id}
                  className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-2.5 last:border-b-0"
                >
                  <span className="font-serif text-[15px]">{term.term}</span>
                  <span
                    className={cn(
                      "border px-1.5 py-[1px] font-mono text-[8px] uppercase tracking-[0.1em]",
                      term.status === "banned"
                        ? "border-[#8F2F24]/40 text-[#8F2F24]"
                        : term.status === "deprecated"
                          ? "border-[#B99A5E]/60 text-[#7A6334]"
                          : "border-[#6F7D66]/50 text-[#4F5C47]",
                    )}
                  >
                    {term.status}
                  </span>
                  {term.replacement && (
                    <span className="font-mono text-[9.5px] text-muted-foreground">
                      → {term.replacement}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {term.note}
                  </span>
                </div>
              ))}
            </div>
          )}

          {tab === "compiler" && (
            <div className="px-5 py-5">
              <div className="border border-border bg-background p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-muted-foreground" />
                  <p className="font-serif text-[19px]">Compile a guideline document</p>
                </div>
                <p className="mt-1.5 max-w-[70ch] text-[11.5px] leading-5 text-muted-foreground">
                  Extract text from a PDF, DOCX, TXT, MD or CSV file. The model proposes
                  typed rules with source excerpts. You edit and publish; the model
                  cannot change the rulebook itself.
                </p>
                {!isAdmin && (
                  <p className="mt-3 border border-[#B99A5E]/60 bg-[#B99A5E]/10 px-3 py-2 text-[11px] text-[#6A5730]">
                    Only the Admin seat can publish. Switch to Ravi Shah in the header to
                    run and publish a compile.
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void extract(file);
                    }}
                  />
                  <Button
                    variant="outline"
                    className="rounded-none text-[11px]"
                    onClick={() => fileRef.current?.click()}
                    disabled={extracting}
                  >
                    {extracting ? (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    ) : (
                      <UploadCloud className="mr-1.5 size-3.5" />
                    )}
                    Choose document
                  </Button>
                  <Button
                    variant="ghost"
                    className="rounded-none text-[11px]"
                    disabled={extracting}
                    onClick={async () => {
                      setExtracting(true);
                      try {
                        const response = await fetch(
                          "/demo-assets/lumora-brand-guidelines.pdf",
                        );
                        if (!response.ok) throw new Error("Sample PDF is missing.");
                        const blob = await response.blob();
                        await extract(
                          new File([blob], "lumora-brand-guidelines.pdf", {
                            type: "application/pdf",
                          }),
                        );
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Could not load sample.",
                        );
                      } finally {
                        setExtracting(false);
                      }
                    }}
                  >
                    Load sample PDF
                  </Button>
                  <Button
                    variant="ghost"
                    className="rounded-none text-[11px]"
                    onClick={() => {
                      setDocumentText(GUIDELINE_DOCUMENT);
                      setFilename("lumora-brand-guidelines.txt");
                      setTab("compiler");
                    }}
                  >
                    Use sample text
                  </Button>
                </div>

                {documentText && (
                  <div className="mt-3 border-t border-border/70 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                        {filename} · {documentText.length.toLocaleString()} chars
                      </p>
                      <button
                        onClick={() => setPastedOpen((value) => !value)}
                        className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
                      >
                        {pastedOpen ? "Hide text" : "Inspect text"}
                      </button>
                    </div>
                    {pastedOpen && (
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap border border-border bg-card p-3 font-sans text-[10.5px] leading-5 text-muted-foreground">
                        {documentText.slice(0, 4000)}
                      </pre>
                    )}
                    <Button
                      className="mt-3 rounded-none text-[11px]"
                      onClick={runCompiler}
                      disabled={compiling || !isAdmin}
                    >
                      {compiling ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <FileUp className="mr-1.5 size-3.5" />
                      )}
                      Compile {documentText.length.toLocaleString()} characters
                    </Button>
                  </div>
                )}

                {compileError && (
                  <div className="mt-3 border border-[#A9552F]/40 bg-[#A9552F]/5 px-3 py-2">
                    <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-[#8F4526]">
                      Compiler error
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      {compileError}
                    </p>
                  </div>
                )}
              </div>

              {drafts.length > 0 && (
                <div className="mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                        Proposed rules · {drafts.length}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {proposalMeta?.model
                          ? `Proposed by ${proposalMeta.model}`
                          : "Model proposal"}{" "}
                        · edit before publishing
                      </p>
                    </div>
                    <Button
                      size="sm"
                      className="rounded-none text-[11px]"
                      onClick={publishRules}
                      disabled={publishing || !isAdmin}
                    >
                      {publishing ? (
                        <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                      ) : (
                        <Check className="mr-1.5 size-3.5" />
                      )}
                      Publish {drafts.length} rules
                    </Button>
                  </div>
                  <div className="space-y-3 pt-3">
                    {drafts.map((rule, index) => (
                      <div key={rule.rule_id + index} className="border border-border p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[9px] text-muted-foreground">
                            {rule.rule_id}
                          </span>
                          <span className="border border-border px-1.5 py-[1px] font-mono text-[8px] uppercase text-muted-foreground">
                            {rule.type}
                          </span>
                          <button
                            onClick={() =>
                              setDrafts((current) =>
                                current.filter((_, i) => i !== index),
                              )
                            }
                            className="ml-auto text-muted-foreground hover:text-[#8F2F24]"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px_130px]">
                          <Input
                            value={rule.title}
                            onChange={(e) =>
                              setDrafts((current) =>
                                current.map((item, i) =>
                                  i === index ? { ...item, title: e.target.value } : item,
                                ),
                              )
                            }
                            className="h-8 rounded-none border-border bg-background text-[12px]"
                          />
                          <Select
                            value={rule.severity}
                            onValueChange={(value) =>
                              setDrafts((current) =>
                                current.map((item, i) =>
                                  i === index ? { ...item, severity: value } : item,
                                ),
                              )
                            }
                          >
                            <SelectTrigger className="h-8 rounded-none border-border bg-background text-[11px] capitalize">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["critical", "high", "medium", "low"].map((value) => (
                                <SelectItem key={value} value={value}>
                                  {value}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={rule.type}
                            onValueChange={(value) =>
                              setDrafts((current) =>
                                current.map((item, i) =>
                                  i === index ? { ...item, type: value } : item,
                                ),
                              )
                            }
                          >
                            <SelectTrigger className="h-8 rounded-none border-border bg-background text-[11px] capitalize">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["deterministic", "measurable", "judgment"].map((value) => (
                                <SelectItem key={value} value={value}>
                                  {value}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Textarea
                          value={rule.description}
                          onChange={(e) =>
                            setDrafts((current) =>
                              current.map((item, i) =>
                                i === index ? { ...item, description: e.target.value } : item,
                              ),
                            )
                          }
                          rows={2}
                          className="mt-2 rounded-none border-border bg-background text-[11px]"
                        />
                        <p className="mt-2 border-l border-border pl-2 font-mono text-[9.5px] leading-4 text-muted-foreground">
                          SOURCE · {rule.source_excerpt}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeJob && (
                <div className="mt-4 border-t border-border/70 pt-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    Last job · {activeJob.filename} · {activeJob.status} ·{" "}
                    {activeJob.chars.toLocaleString()} chars
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        <aside className="space-y-5">
          <section className="border border-border bg-card p-5">
            <p className="label-caps">Voice</p>
            <p className="mt-3 font-serif text-[22px] leading-tight">
              {(data?.pack?.voice.descriptors ?? []).join(" · ")}
            </p>
            <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
              {(data?.pack?.voice.sounds ?? []).map((line) => (
                <p key={line} className="flex items-start gap-2 text-[11px] leading-5">
                  <Minus className="mt-1 size-3 shrink-0 text-muted-foreground" />
                  {line}
                </p>
              ))}
            </div>
            <div className="mt-3 border-t border-border/70 pt-3">
              <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted-foreground">
                Avoids
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(data?.pack?.voice.avoids ?? []).map((line) => (
                  <span
                    key={line}
                    className="border border-border px-1.5 py-[2px] text-[9.5px] text-muted-foreground"
                  >
                    {line}
                  </span>
                ))}
              </div>
            </div>
            <p className="mt-3 border-t border-border/70 pt-3 font-serif text-[13px] italic leading-5 text-muted-foreground">
              “{data?.pack?.voice.sample}”
            </p>
          </section>

          <section className="border border-border bg-card p-5">
            <p className="label-caps">Rule types</p>
            <div className="mt-3 space-y-2.5 text-[11px] leading-5 text-muted-foreground">
              <p>
                <span className="font-mono text-[9.5px] text-foreground">deterministic</span>{" "}
                runs in code: regex, glossary, casing, alt text.
              </p>
              <p>
                <span className="font-mono text-[9.5px] text-foreground">measurable</span>{" "}
                computes a value: contrast ratio, CIELAB distance, character counts.
              </p>
              <p>
                <span className="font-mono text-[9.5px] text-foreground">judgment</span>{" "}
                goes to a reviewer model with the source quote attached.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
