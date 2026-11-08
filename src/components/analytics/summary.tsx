import type { SummaryPart } from "@/lib/display/summaries";
// 数値のテスト ID を保ちながら、タイルではなく一続きの文として読む。
export function AnalyticsSummary({
  parts,
  empty = false,
}: {
  parts: readonly SummaryPart[];
  empty?: boolean;
}) {
  return (
    <p
      data-testid="analytics-summary"
      className="max-w-[68ch] text-md leading-relaxed text-ink [overflow-wrap:anywhere]"
    >
      <span data-testid={empty ? "analytics-empty" : undefined}>
        {parts.map((part, i) =>
          part.testId ? (
            <span key={i} data-testid={part.testId} className="font-semibold tabular-nums">
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </span>
    </p>
  );
}
