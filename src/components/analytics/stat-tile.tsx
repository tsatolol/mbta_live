import type { ReactNode } from "react";

// 分析の画面の数値のタイル（見出しの数字 1 つ + 説明）
export function StatTile({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  testId: string;
}) {
  return (
    <div className="rounded-lg border px-3 py-2" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums" data-testid={`${testId}-value`}>
        {value}
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ChartSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border p-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mb-2 text-xs text-muted-foreground">{description}</p>}
      {children}
    </section>
  );
}
