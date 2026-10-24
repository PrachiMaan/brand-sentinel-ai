import { cn } from "@/lib/utils";

export type Mark = {
  start: number;
  end: number;
  severity?: string;
  needsHuman?: boolean;
  deterministic?: boolean;
};

type Segment = { text: string; mark?: Mark };

export function buildSegments(text: string, marks: Mark[]): Segment[] {
  const valid = marks
    .filter((m) => m.end > m.start && m.start >= 0 && m.start < text.length)
    .map((m) => ({ ...m, end: Math.min(m.end, text.length) }))
    .sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const mark of valid) {
    if (mark.start < cursor) continue;
    if (mark.start > cursor) {
      segments.push({ text: text.slice(cursor, mark.start) });
    }
    segments.push({ text: text.slice(mark.start, mark.end), mark });
    cursor = mark.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

export function HighlightedText({
  text,
  marks,
  activeId,
  className,
}: {
  text: string;
  marks: (Mark & { id: string })[];
  activeId?: string | null;
  className?: string;
}) {
  const segments = buildSegments(text, marks);
  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      {segments.map((segment, index) => {
        if (!segment.mark) return <span key={index}>{segment.text}</span>;
        const mark = segment.mark as Mark & { id: string };
        return (
          <mark
            key={index}
            className={cn(
              "bg-transparent text-inherit",
              mark.needsHuman
                ? "finding-mark-needs-human"
                : mark.severity === "critical"
                  ? "finding-mark-critical"
                  : "finding-mark",
              activeId === mark.id && "outline outline-1 outline-foreground/50",
            )}
          >
            {segment.text}
          </mark>
        );
      })}
    </div>
  );
}
