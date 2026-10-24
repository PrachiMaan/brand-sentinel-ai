import { cn } from "@/lib/utils";
import { STATUS_LABEL, type SubmissionStatus } from "@/convex/lib/types";

const statusStyles: Record<SubmissionStatus, string> = {
  draft: "border-border text-muted-foreground",
  ai_review: "border-[#B99A5E]/60 text-[#8A6B34] bg-[#B99A5E]/8",
  findings_ready: "border-[#A9552F]/45 text-[#8F4526] bg-[#A9552F]/8",
  human_review: "border-foreground/35 text-foreground bg-foreground/[0.04]",
  needs_revision: "border-[#A9552F]/50 text-[#8F4526] bg-[#A9552F]/6",
  approved: "border-[#6F7D66]/60 text-[#4F5C47] bg-[#6F7D66]/10",
  rejected: "border-[#9B3B2C]/45 text-[#86342A] bg-[#9B3B2C]/6",
  receipt_exported: "border-[#6F7D66]/60 text-[#4F5C47] bg-[#6F7D66]/14",
};

export function StatusChip({
  status,
  className,
}: {
  status: SubmissionStatus | string;
  className?: string;
}) {
  const label = STATUS_LABEL[status as SubmissionStatus] ?? status;
  const style = statusStyles[status as SubmissionStatus] ?? "border-border";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-[3px] text-[10px] font-medium uppercase tracking-[0.14em]",
        style,
        className,
      )}
    >
      <span className="size-1 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

export function SeverityChip({
  severity,
  muted = false,
}: {
  severity: string;
  muted?: boolean;
}) {
  const tone: Record<string, string> = {
    critical: "text-[#8F2F24] border-[#8F2F24]/40 bg-[#8F2F24]/6",
    high: "text-[#8F4526] border-[#A9552F]/40 bg-[#A9552F]/6",
    medium: "text-[#7A6334] border-[#B99A5E]/50 bg-[#B99A5E]/8",
    low: "text-muted-foreground border-border bg-transparent",
  };
  return (
    <span
      className={cn(
        "inline-flex border px-1.5 py-[2px] text-[9px] font-medium uppercase tracking-[0.16em]",
        muted ? "border-border text-muted-foreground" : tone[severity],
      )}
    >
      {severity}
    </span>
  );
}

export function ClaimChip({ status }: { status: string }) {
  const tone: Record<string, string> = {
    Supported: "border-[#6F7D66]/60 text-[#4F5C47]",
    Unsupported: "border-[#A9552F]/45 text-[#8F4526]",
    Expired: "border-[#8F2F24]/45 text-[#8F2F24]",
    Contradicts: "border-[#8F2F24]/60 text-[#8F2F24] bg-[#8F2F24]/5",
  };
  return (
    <span
      className={cn(
        "inline-flex border px-1.5 py-[2px] text-[9px] font-medium uppercase tracking-[0.14em]",
        tone[status] ?? "border-border",
      )}
    >
      {status}
    </span>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="inline-flex size-[18px] items-center justify-center border border-foreground/70 font-serif text-[11px] leading-none text-foreground">
        B
      </span>
      <span className="font-serif text-[19px] tracking-tight text-foreground">
        BrandSentinel
      </span>
      {!compact && (
        <span className="ml-1 hidden border border-border px-1 py-[1px] font-mono text-[8px] uppercase tracking-[0.18em] text-muted-foreground sm:inline">
          R2
        </span>
      )}
    </span>
  );
}

