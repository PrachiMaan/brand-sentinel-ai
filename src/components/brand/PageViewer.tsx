import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";

export type ViewerPage = { page: number; url: string | null; width: number; height: number };
export type ViewerBox = {
  id: string;
  page: number | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  severity: string;
  ruleId: string;
};

const BOX_COLOUR: Record<string, string> = {
  critical: "border-[#8F2F24] bg-[#8F2F24]/12",
  high: "border-[#A8622A] bg-[#A8622A]/12",
  medium: "border-[#B99A5E] bg-[#B99A5E]/12",
  low: "border-[#6F7D66] bg-[#6F7D66]/10",
};

export function PageViewer({
  pages,
  boxes,
  activeId,
  onSelect,
}: {
  pages: ViewerPage[];
  boxes: ViewerBox[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const firstPageWithActive =
    boxes.find((box) => box.id === activeId)?.page ?? pages[0]?.page ?? 1;
  const [current, setCurrent] = useState(firstPageWithActive);
  const [lastActive, setLastActive] = useState(activeId);

  // When a finding is selected elsewhere, follow it to its page.
  if (activeId && activeId !== lastActive) {
    const target = boxes.find((box) => box.id === activeId);
    setLastActive(activeId);
    if (target?.page && target.page !== current) setCurrent(target.page);
  }

  const page = pages.find((entry) => entry.page === current) ?? pages[0];
  if (!page) return null;
  const pageBoxes = boxes.filter((box) => box.page === page.page && box.bbox);
  const index = pages.findIndex((entry) => entry.page === page.page);

  const go = (delta: number) => {
    const next = pages[Math.max(0, Math.min(pages.length - 1, index + delta))];
    if (next) setCurrent(next.page);
  };

  return (
    <section className="border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 px-5 py-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
          Page {index + 1} of {pages.length} · measured overlays
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="Previous page"
            className="border border-border p-1 text-muted-foreground disabled:opacity-40 hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <button
            onClick={() => go(1)}
            disabled={index === pages.length - 1}
            aria-label="Next page"
            className="border border-border p-1 text-muted-foreground disabled:opacity-40 hover:text-foreground"
          >
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="relative bg-[#EDE7DC]">
        {page.url ? (
          <div className="relative mx-auto max-w-[760px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={page.url}
              alt={`Page ${page.page} of the submitted deck`}
              className="block h-auto w-full"
            />
            {pageBoxes.map((box) => (
              <button
                key={box.id}
                onClick={() => onSelect(box.id)}
                aria-label={`${box.ruleId} on page ${box.page}. Select this finding.`}
                aria-pressed={box.id === activeId}
                title={`${box.ruleId} · ${box.severity}`}
                className={cn(
                  "absolute border-2 transition-all",
                  BOX_COLOUR[box.severity] ?? BOX_COLOUR.low,
                  box.id === activeId
                    ? "z-10 border-foreground shadow-[0_0_0_2px_rgba(31,29,26,0.25)]"
                    : "hover:border-foreground/70",
                )}
                style={{
                  left: `${(box.bbox?.x ?? 0) * 100}%`,
                  top: `${(box.bbox?.y ?? 0) * 100}%`,
                  width: `${(box.bbox?.w ?? 0) * 100}%`,
                  height: `${(box.bbox?.h ?? 0) * 100}%`,
                }}
              />
            ))}
          </div>
        ) : (
          <div className="px-5 py-12 text-center text-[11.5px] text-muted-foreground">
            This page image is not available. The finding measurements are still listed.
          </div>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto border-t border-border/80 px-3 py-3">
        {pages.map((entry) => {
          const count = boxes.filter((box) => box.page === entry.page).length;
          return (
            <button
              key={entry.page}
              onClick={() => setCurrent(entry.page)}
              aria-label={`Page ${entry.page}${count ? `, ${count} findings` : ""}`}
              aria-current={entry.page === page.page}
              className={cn(
                "relative h-[54px] w-[80px] shrink-0 border bg-background",
                entry.page === page.page
                  ? "border-foreground"
                  : "border-border hover:border-foreground/50",
              )}
            >
              {entry.url ? (
                <img
                  src={entry.url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : null}
              <span className="absolute left-0 top-0 bg-background/90 px-1 font-mono text-[8px] text-muted-foreground">
                {entry.page}
              </span>
              {count > 0 && (
                <span className="absolute bottom-0 right-0 bg-foreground px-1 font-mono text-[8px] text-background">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
