import { AppShell } from "@/components/AppShell";
import { HighlightedText } from "@/components/brand/HighlightedText";
import { SeverityChip } from "@/components/brand/chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { dominantColors } from "@/convex/lib/color";
import { runFastLane, paletteFindings } from "@/convex/lib/fastlane";
import { SAMPLE_CAPTIONS } from "@/convex/lib/lumora";
import type { Finding } from "@/convex/lib/types";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Sparkles, Upload, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

const SAMPLE_IMAGE = "/demo-assets/lumora-launch-offpalette.png";

export default function Submit() {
  const navigate = useNavigate();
  const rulebook = useQuery(api.brand.rulebook);
  const me = useQuery(api.session.me);
  const create = useMutation(api.submissions.create);
  const uploadUrl = useMutation(api.submissions.generateUploadUrl);

  const [title, setTitle] = useState("Lumora launch caption");
  const [channel, setChannel] = useState("instagram");
  const [audience, setAudience] = useState("Skincare-curious adults, 25–44");
  const [text, setText] = useState(SAMPLE_CAPTIONS[0]?.text ?? "");
  const [altText, setAltText] = useState("");
  const [textHex, setTextHex] = useState("#FF2E93");
  const [bgHex, setBgHex] = useState("#F4EFE6");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(SAMPLE_IMAGE);
  const [palette, setPalette] = useState<{ hex: string; share: number }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rules = (rulebook?.rules ?? []) as Parameters<typeof runFastLane>[0]["rules"];
  const claims = (rulebook?.claims ?? []) as Parameters<typeof runFastLane>[0]["claims"];
  const glossary = (rulebook?.glossary ?? []) as Parameters<
    typeof runFastLane
  >[0]["glossary"];

  const analysis = useMemo(() => {
    if (!rules.length) return null;
    return runFastLane({
      text,
      channel,
      altText,
      hasImage: Boolean(imagePreview),
      design: textHex && bgHex ? { textHex, bgHex } : undefined,
      rules,
      claims,
      glossary,
    });
  }, [text, channel, altText, imagePreview, textHex, bgHex, rules, claims, glossary]);

  const paletteIssues: Finding[] = useMemo(() => {
    if (!rulebook?.pack || !imagePreview || !palette.length) return [];
    return paletteFindings({
      dominant: palette,
      palette: rulebook.pack.palette,
      rules,
      text,
    });
  }, [rulebook?.pack, imagePreview, palette, rules, text]);

  const findings = useMemo(
    () => [...(analysis?.findings ?? []), ...paletteIssues],
    [analysis, paletteIssues],
  );

  const canSubmit = me?.role === "creator" || me?.role === "admin";

  const analyse = (src: string) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 180 / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      setPalette(dominantColors(data, 4));
    };
    image.src = src;
  };

  const onImage = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("That file is not an image.");
      return;
    }
    setImageFile(file);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    analyse(url);
  };

  const loadSample = (index: number) => {
    const sample = SAMPLE_CAPTIONS[index];
    if (!sample) return;
    setTitle(sample.label);
    setChannel(sample.channel);
    setAudience(sample.audience);
    setText(sample.text);
    setAltText(sample.altText);
    setImageFile(null);
    setImagePreview(sample.id === "email" || sample.id === "clean-control" ? null : SAMPLE_IMAGE);
    setTextHex(sample.id === "launch-caption" ? "#FF2E93" : "#1F1D1A");
    setBgHex("#F4EFE6");
    setPalette([]);
    if (sample.id === "launch-caption") analyse(SAMPLE_IMAGE);
    toast("Sample content loaded", { description: sample.label });
  };

  const submit = async () => {
    if (submitting) return;
    if (!text.trim()) {
      toast.error("Add some content before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      let storageId: Id<"_storage"> | undefined;
      let imageName: string | undefined;
      if (imagePreview) {
        let file = imageFile;
        if (!file) {
          const response = await fetch(SAMPLE_IMAGE);
          const blob = await response.blob();
          file = new File([blob], "lumora-launch-offpalette.png", {
            type: blob.type || "image/png",
          });
        }
        const url = await uploadUrl({});
        const uploaded = await fetch(url, {
          method: "POST",
          headers: { "content-type": file.type || "image/png" },
          body: file,
        });
        const body = (await uploaded.json()) as { storageId: Id<"_storage"> };
        storageId = body.storageId;
        imageName = file.name;
      }

      const submissionId = await create({
        title,
        channel,
        audience,
        text,
        altText,
        designTextColor: textHex || undefined,
        designBgColor: bgHex || undefined,
        imageStorageId: storageId,
        imageName,
        imagePalette: palette.length ? JSON.stringify(palette) : undefined,
      });
      toast("Submitted. Running the deep review now.", {
        description: "The report opens while the five reviewers work.",
      });
      navigate(`/app/review/${submissionId}?new=1`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not submit this version.",
      );
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          {!canSubmit && (
            <div className="border border-[#B99A5E]/60 bg-[#B99A5E]/10 px-4 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#7A6334]">
                Read-only for {me?.role ?? "this role"}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[#6A5730]">
                Submissions are created by the Creator or Admin. Use the role switcher
                in the header to become Maya Rao.
              </p>
            </div>
          )}

          <section className="border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border/80 px-5 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
                Submission details
              </p>
              <span className="font-mono text-[9px] text-muted-foreground">
                v1 · draft
              </span>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="label-caps text-[9px]">Working title</Label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="h-9 rounded-none border-border bg-background text-[13px]"
                    placeholder="Launch caption"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="label-caps text-[9px]">Channel</Label>
                  <Select value={channel} onValueChange={setChannel}>
                    <SelectTrigger className="h-9 w-full rounded-none border-border bg-background text-[13px] capitalize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["instagram", "email", "linkedin", "landing", "print"].map(
                        (value) => (
                          <SelectItem key={value} value={value} className="capitalize">
                            {value}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="label-caps text-[9px]">Audience</Label>
                <Input
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  className="h-9 rounded-none border-border bg-background text-[13px]"
                  placeholder="Who is this for?"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="label-caps text-[9px]">Content</Label>
                  <span className="font-mono text-[9px] text-muted-foreground">
                    {text.length.toLocaleString()} / 40,000
                  </span>
                </div>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={11}
                  className="min-h-[230px] resize-y rounded-none border-border bg-background font-sans text-[13.5px] leading-6"
                  placeholder="Paste the caption, email or landing copy…"
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {SAMPLE_CAPTIONS.map((sample, index) => (
                    <button
                      key={sample.id}
                      onClick={() => loadSample(index)}
                      className="border border-border bg-background px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                    >
                      {sample.id === "launch-caption"
                        ? "Load Lumora sample"
                        : sample.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="label-caps text-[9px]">Text colour (optional)</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={textHex}
                      onChange={(e) => setTextHex(e.target.value)}
                      className="h-9 w-10 rounded-none border border-border bg-background p-1"
                    />
                    <Input
                      value={textHex}
                      onChange={(e) => setTextHex(e.target.value)}
                      className="h-9 rounded-none border-border bg-background font-mono text-[12px]"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="label-caps text-[9px]">Background colour</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={bgHex}
                      onChange={(e) => setBgHex(e.target.value)}
                      className="h-9 w-10 rounded-none border border-border bg-background p-1"
                    />
                    <Input
                      value={bgHex}
                      onChange={(e) => setBgHex(e.target.value)}
                      className="h-9 rounded-none border-border bg-background font-mono text-[12px]"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2 border-t border-border/70 pt-4">
                <div className="flex items-center justify-between">
                  <Label className="label-caps text-[9px]">Image (optional)</Label>
                  {imagePreview && (
                    <button
                      onClick={() => {
                        setImagePreview(null);
                        setImageFile(null);
                        setPalette([]);
                      }}
                      className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" /> Remove
                    </button>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onImage(e.target.files?.[0] ?? null)}
                />
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 rounded-none text-[11px]"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="mr-1.5 size-3.5" /> Choose image
                  </Button>
                  <span className="text-[10.5px] text-muted-foreground">
                    {imagePreview ? "Sample creative attached" : "No image attached"}
                  </span>
                </div>
                <div className="space-y-1.5">
                  <Label className="label-caps text-[9px]">Alt text</Label>
                  <Textarea
                    value={altText}
                    onChange={(e) => setAltText(e.target.value)}
                    rows={2}
                    placeholder="Describe the image for someone who cannot see it."
                    className="rounded-none border-border bg-background text-[12.5px]"
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/80 px-5 py-4">
              <p className="max-w-[38ch] text-[10px] leading-4 text-muted-foreground">
                Submitting starts the deep review. Fast-lane results already shown
                here are stored with the run.
              </p>
              <Button
                onClick={submit}
                disabled={!canSubmit || submitting || !text.trim()}
                className="h-10 rounded-none px-5 text-[12px]"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" /> Submitting
                  </>
                ) : (
                  <>
                    Submit for review <Sparkles className="ml-2 size-3.5" />
                  </>
                )}
              </Button>
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border/80 px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="size-1.5 rounded-full bg-[#6F7D66]" />
                <p className="font-mono text-[9px] uppercase tracking-[0.15em]">
                  Fast lane · live
                </p>
              </div>
              <span className="font-mono text-[9px] text-muted-foreground">
                {analysis ? `${analysis.elapsedMs.toFixed(1)} ms` : "waiting"} ·{" "}
                {findings.length} issue{findings.length === 1 ? "" : "s"}
              </span>
            </div>

            {imagePreview && (
              <div className="relative border-b border-border/70">
                <img
                  src={imagePreview}
                  alt={altText || "Attached creative without alt text"}
                  className="max-h-[190px] w-full object-cover"
                />
                {palette.length > 0 && (
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-background/90 px-2 py-1">
                    <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                      dominant
                    </span>
                    {palette.map((colour) => (
                      <span
                        key={colour.hex}
                        title={colour.hex}
                        className="size-3 border border-black/20"
                        style={{ backgroundColor: colour.hex }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="px-5 py-5">
              {text.trim() ? (
                <HighlightedText
                  text={text}
                  marks={findings
                    .filter((f) => f.spanText)
                    .map((f) => ({
                      id: f.id,
                      start: f.spanStart,
                      end: f.spanEnd,
                      severity: f.severity,
                    }))}
                  className="font-serif text-[20px] leading-[1.5]"
                />
              ) : (
                <p className="font-serif text-[20px] italic text-muted-foreground">
                  Content will appear here as you type.
                </p>
              )}
            </div>

            <div className="border-t border-border/80">
              {findings.length === 0 ? (
                <p className="px-5 py-4 text-[11.5px] text-muted-foreground">
                  No deterministic issues on this pass. The deep lane still reads for
                  tone, claims and messaging.
                </p>
              ) : (
                findings.map((finding) => (
                  <div
                    key={finding.id}
                    className="border-b border-border/60 px-5 py-3 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityChip severity={finding.severity} />
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                        {finding.ruleId}
                      </span>
                      {finding.measuredValue && (
                        <span className="font-mono text-[9px] text-muted-foreground">
                          {finding.measuredValue}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-[12px] leading-5">{finding.whyItMatters}</p>
                    <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
                      FIX · {finding.suggestedFix}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="border border-border bg-card/60 px-5 py-4">
            <p className="label-caps">What the fast lane checks</p>
            <div className="mt-3 grid gap-2 text-[11.5px] text-muted-foreground sm:grid-cols-2">
              <p>Banned and deprecated terms</p>
              <p>Product naming and all-caps</p>
              <p>WCAG contrast ratio</p>
              <p>Missing alt text</p>
              <p>Palette distance (CIELAB)</p>
              <p>Expired claim wording</p>
            </div>
            <p className="mt-3 border-t border-border/70 pt-3 text-[10px] leading-4 text-muted-foreground">
              Fast-lane results are computed in the browser from the published
              rulebook and recomputed on the server when you submit.
            </p>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
