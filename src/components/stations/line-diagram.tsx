// 路線図は HTML のリンクとリストで描く。線・点は装飾とし、色以外でも分岐と検索結果を伝える。
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Station } from "@/lib/api-schemas/stops";
import type { StripBlock, StripLine } from "@/lib/display/strip-map";
import { lineColorToken } from "@/lib/display/line-counts";
import { matchesStationQuery } from "@/components/arrivals/format";

function DiagramBlocks({
  blocks,
  stations,
  query,
}: {
  blocks: readonly StripBlock[];
  stations: ReadonlyMap<string, Station>;
  query: string;
}) {
  const searching = query.trim().length > 0;
  const branchLabel = (index: number, joins: boolean) => {
    const adjacent = blocks[index + (joins ? 1 : -1)];
    const id =
      adjacent?.kind === "segment"
        ? joins
          ? adjacent.stationIds[0]
          : adjacent.stationIds.at(-1)
        : undefined;
    const name = id ? stations.get(id)?.name : undefined;
    return name ? `Branches ${joins ? "joining at" : "from"} ${name}` : "Line branches";
  };
  return blocks.map((block, index) =>
    block.kind === "segment" ? (
      <ol key={block.id} className="strip-segment">
        {block.stationIds.map((id) => {
          const station = stations.get(id)!;
          const match = matchesStationQuery(station.name, query);
          return (
            <li key={id}>
              <Link
                href={`/stations/${encodeURIComponent(id)}`}
                className={`strip-station ${searching && !match ? "text-ink-muted" : "text-ink"} ${searching && match ? "font-extrabold" : "font-normal"}`}
                data-testid={`station-link-${id}`}
                data-search-match={searching ? String(match) : undefined}
              >
                <span aria-hidden="true" className="strip-point" />
                {station.name}
              </Link>
            </li>
          );
        })}
      </ol>
    ) : (
      <div
        key={block.id}
        className={`strip-branches ${block.joins ? "strip-join" : "strip-fork"}`}
        role="group"
        aria-label={branchLabel(index, block.joins)}
        data-testid="station-branches"
        data-joins={String(block.joins)}
      >
        {block.branches.map((branch, index) => (
          <div
            key={index}
            className="strip-branch"
            style={{
              flexGrow: branch.routeIds.length,
              flexBasis: `${branch.routeIds.length * 7.5}rem`,
            }}
          >
            <p className="strip-branch-label text-xs font-semibold text-ink-muted">
              {branch.label}
              <span className="sr-only"> branch</span>
            </p>
            <DiagramBlocks blocks={branch.blocks} stations={stations} query={query} />
          </div>
        ))}
      </div>
    ),
  );
}

export function LineDiagram({ line, query }: { line: StripLine; query: string }) {
  return (
    <section
      data-testid={`station-group-${line.routeId}`}
      aria-labelledby={`line-heading-${line.routeId}`}
      className="min-w-0"
      style={{ "--diagram-line": `var(${lineColorToken(line.routeId)})` } as CSSProperties}
    >
      <h2
        id={`line-heading-${line.routeId}`}
        className="mb-4 flex items-center gap-3 text-md font-extrabold"
      >
        <span aria-hidden="true" className="h-6 w-1.5 shrink-0 bg-[var(--diagram-line)]" />
        {line.routeName}
      </h2>
      <DiagramBlocks
        blocks={line.blocks}
        stations={new Map(line.stations.map((s) => [s.id, s]))}
        query={query}
      />
    </section>
  );
}
