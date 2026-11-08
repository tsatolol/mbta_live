import type { ReactNode } from "react";

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
    <section className="min-w-0 pt-6">
      <h2 className="mb-3 text-md font-extrabold">{title}</h2>
      {description && <p className="mb-2 text-xs text-muted-foreground">{description}</p>}
      {children}
    </section>
  );
}
