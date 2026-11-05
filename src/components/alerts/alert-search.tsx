"use client";
// 過去のアラートの検索: 期間（運行日）・路線・影響の種類で、フィードから消えたものも含めて探す（FR-005）
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { alertsResponseSchema } from "@/lib/api-schemas/alerts";
import type { RouteInfo } from "@/lib/api-schemas/routes";
import { fetchJson } from "@/lib/fetch-json";
import { addServiceDays, serviceDateOf } from "@/lib/time";
import { Input } from "@/components/ui/input";
import { AlertCard } from "./alert-card";
import { effectLabel, SEARCHABLE_EFFECTS } from "./format";

interface SearchParams {
  from: string;
  to: string;
  route: string;
  effect: string;
}

function toQuery(p: SearchParams): string {
  const q = new URLSearchParams({ status: "all" });
  if (p.from) q.set("from", p.from);
  if (p.to) q.set("to", p.to);
  if (p.route) q.set("routes", p.route);
  if (p.effect) q.set("effects", p.effect);
  return q.toString();
}

const selectClass = "h-9 rounded-md border border-input bg-panel px-2 text-sm text-ink";

export function AlertSearch({ routes }: { routes: readonly RouteInfo[] }) {
  const [form, setForm] = useState<SearchParams>(() => {
    const today = serviceDateOf(new Date());
    return { from: addServiceDays(today, -7), to: today, route: "", effect: "" };
  });
  // 送信した条件（送信するまで検索しない）
  const [submitted, setSubmitted] = useState<SearchParams | null>(null);
  const results = useQuery({
    queryKey: ["live", "alerts", "search", submitted],
    queryFn: () =>
      fetchJson(`/api/live/alerts?${toQuery(submitted!)}`, (b) => alertsResponseSchema.parse(b)),
    enabled: submitted !== null,
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted({ ...form });
  };
  const set = (key: keyof SearchParams) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap items-end gap-3"
        data-testid="alert-search-form"
      >
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input
            type="date"
            value={form.from}
            onChange={(e) => set("from")(e.target.value)}
            className="w-40"
            data-testid="search-from"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input
            type="date"
            value={form.to}
            onChange={(e) => set("to")(e.target.value)}
            className="w-40"
            data-testid="search-to"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Route
          <select
            value={form.route}
            onChange={(e) => set("route")(e.target.value)}
            className={selectClass}
            data-testid="search-route"
          >
            <option value="">All routes</option>
            {routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.longName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Effect
          <select
            value={form.effect}
            onChange={(e) => set("effect")(e.target.value)}
            className={selectClass}
            data-testid="search-effect"
          >
            <option value="">All effects</option>
            {SEARCHABLE_EFFECTS.map((effect) => (
              <option key={effect} value={effect}>
                {effectLabel(effect)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          data-testid="search-submit"
        >
          Search
        </button>
      </form>

      {results.isFetching && <p className="text-sm text-muted-foreground">Searching…</p>}
      {results.isError && (
        <p className="text-sm text-destructive" role="alert">
          Unable to search alerts. Check the dates and try again.
        </p>
      )}
      {results.data && !results.isFetching && (
        <div className="flex flex-col gap-2" data-testid="search-results">
          <p className="text-xs text-muted-foreground" data-testid="search-count">
            {results.data.alerts.length} {results.data.alerts.length === 1 ? "alert" : "alerts"}
            {results.data.truncated && " (showing the most severe; narrow the search to see more)"}
          </p>
          {results.data.alerts.map((a) => (
            <AlertCard key={a.id} alert={a} showStatus />
          ))}
        </div>
      )}
    </div>
  );
}
