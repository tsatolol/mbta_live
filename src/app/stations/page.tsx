"use client";
// 駅の一覧（Stations、US2）: 駅名で検索し、路線ごとにまとめて表示する（FR-003）
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { stopsResponseSchema } from "@/lib/api-schemas/stops";
import { fetchJson } from "@/lib/fetch-json";
import { matchesStationQuery } from "@/components/arrivals/format";
import { Input } from "@/components/ui/input";

export default function StationsPage() {
  const stops = useQuery({
    queryKey: ["static", "stops"],
    queryFn: () => fetchJson("/api/static/stops", (b) => stopsResponseSchema.parse(b)),
    staleTime: 60 * 60_000,
  });
  const [query, setQuery] = useState("");

  const groups = (stops.data?.routes ?? [])
    .map((r) => ({ ...r, stations: r.stations.filter((s) => matchesStationQuery(s.name, query)) }))
    .filter((r) => r.stations.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-extrabold">Stations</h1>
      <Input
        type="search"
        placeholder="Search stations"
        aria-label="Search stations"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-md"
        data-testid="station-search"
      />

      {stops.isPending && <p className="text-sm text-muted-foreground">Loading stations…</p>}
      {stops.isError && (
        <p className="text-sm text-destructive" role="alert">
          Unable to load stations. Retrying…
        </p>
      )}
      {stops.isSuccess && groups.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="no-stations">
          No stations match “{query.trim()}”.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((r) => (
          <section
            key={r.routeId}
            className="rounded-lg border"
            data-testid={`station-group-${r.routeId}`}
            aria-labelledby={`route-heading-${r.routeId}`}
          >
            <h2
              id={`route-heading-${r.routeId}`}
              className="flex items-center gap-2 border-b px-3 py-2 text-sm font-semibold"
            >
              <span
                aria-hidden
                className="inline-block size-3 rounded-full"
                style={{ backgroundColor: `#${r.routeColor}` }}
              />
              {r.routeName}
            </h2>
            <ul className="divide-y text-sm">
              {r.stations.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/stations/${encodeURIComponent(s.id)}`}
                    className="block px-3 py-1.5 hover:bg-muted"
                    data-testid={`station-link-${s.id}`}
                  >
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
