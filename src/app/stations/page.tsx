"use client";
// 005 US4: 駅を消さずに検索で強調し、Green の幹線は一回だけ描く。
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { stopsResponseSchema } from "@/lib/api-schemas/stops";
import { fetchJson } from "@/lib/fetch-json";
import { buildStripMaps } from "@/lib/display/strip-map";
import { matchesStationQuery } from "@/components/arrivals/format";
import { LineDiagram } from "@/components/stations/line-diagram";
import { WarningIcon } from "@/components/icons";
import { Input } from "@/components/ui/input";

export default function StationsPage() {
  const stops = useQuery({
    queryKey: ["static", "stops"],
    queryFn: () => fetchJson("/api/static/stops", (b) => stopsResponseSchema.parse(b)),
    staleTime: 60 * 60_000,
  });
  const [query, setQuery] = useState("");
  const lines = useMemo(() => (stops.data ? buildStripMaps(stops.data) : []), [stops.data]);
  const matches = new Set(
    lines.flatMap((line) =>
      line.stations.filter((s) => matchesStationQuery(s.name, query)).map((s) => s.id),
    ),
  ).size;

  return (
    <div className="flex flex-col gap-4" data-testid="stations-page">
      <h1 className="text-lg font-extrabold">Stations</h1>
      <Input
        type="search"
        placeholder="Search stations"
        aria-label="Search stations"
        aria-describedby="station-search-help"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-md"
        data-testid="station-search"
      />
      <p id="station-search-help" className="text-xs text-ink-muted">
        Follow a line to find your station. Search to highlight a station on the diagram.
      </p>
      {stops.isPending && (
        <p className="text-sm text-ink-muted" role="status">
          Loading stations…
        </p>
      )}
      {stops.isError && (
        <p className="text-sm text-destructive" role="alert">
          <WarningIcon className="mr-2 inline-block" />
          Unable to load stations. Retrying automatically.
        </p>
      )}
      {stops.isSuccess && (
        <p
          className="text-xs text-ink-muted"
          role="status"
          aria-live="polite"
          data-testid={matches === 0 ? "no-stations" : "station-search-results"}
        >
          {matches === 0
            ? query.trim()
              ? `No stations match “${query.trim()}”.`
              : "No stations are available yet."
            : query.trim()
              ? `${matches} station${matches === 1 ? "" : "s"} highlighted.`
              : "Select a station for live arrivals."}
        </p>
      )}
      <div className="station-diagrams" data-testid="station-diagrams">
        <div className="flex min-w-0 flex-col gap-6">
          {lines
            .filter((line) => line.routeId === "Red")
            .map((line) => (
              <LineDiagram key={line.routeId} line={line} query={query} />
            ))}
          <div className="station-secondary grid min-w-0 grid-cols-2 gap-4">
            {lines
              .filter((line) => ["Mattapan", "Blue"].includes(line.routeId))
              .map((line) => (
                <LineDiagram key={line.routeId} line={line} query={query} />
              ))}
          </div>
        </div>
        {lines
          .filter((line) => line.routeId === "Orange" || line.routeId === "Green")
          .map((line) => (
            <LineDiagram key={line.routeId} line={line} query={query} />
          ))}
      </div>
    </div>
  );
}
