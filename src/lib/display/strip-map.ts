// 005 US4: canonical な停車順を、有向グラフの共通区間・分岐・合流にまとめる。
// 地理座標や駅名の決め打ちを使わず、同じ路線図の駅は一回だけ出す。
import type { Station, StopsResponse } from "@/lib/api-schemas/stops";

export interface StripSegment {
  kind: "segment";
  id: string;
  stationIds: string[];
  patternIds: string[];
  routeIds: string[];
}
export interface StripBranch {
  label: string;
  routeIds: string[];
  blocks: StripBlock[];
}
export type StripBlock =
  | StripSegment
  | {
      kind: "branches";
      id: string;
      joins: boolean;
      branches: StripBranch[];
    };
export interface StripLine {
  routeId: string;
  routeName: string;
  stations: Station[];
  blocks: StripBlock[];
}

type Input = Pick<StopsResponse, "routes" | "patterns">;
const unique = <T>(values: readonly T[]) => [...new Set(values)];

export function buildStripMaps({ routes, patterns }: Input): StripLine[] {
  const groups = new Map<string, Input["routes"]>();
  for (const route of routes) {
    const id = route.routeId.startsWith("Green-") ? "Green" : route.routeId;
    groups.set(id, [...(groups.get(id) ?? []), route]);
  }
  return [...groups].map(([routeId, group]) => {
    const byId = new Map(group.flatMap((r) => r.stations.map((s) => [s.id, s] as const)));
    const routeIds = new Set(group.map((r) => r.routeId));
    const paths = patterns
      .filter((p) => routeIds.has(p.routeId))
      .toSorted(
        (a, b) =>
          a.routeId.localeCompare(b.routeId) || a.routePatternId.localeCompare(b.routePatternId),
      )
      .map((p) => ({ ...p, stationIds: unique(p.stationIds.filter((id) => byId.has(id))) }))
      .filter((p) => p.stationIds.length > 0);
    const nodes = new Map<
      string,
      { next: Set<string>; previous: Set<string>; patterns: Set<string> }
    >();
    for (const path of paths) {
      for (const id of path.stationIds) {
        if (!nodes.has(id))
          nodes.set(id, { next: new Set(), previous: new Set(), patterns: new Set() });
        nodes.get(id)!.patterns.add(path.routePatternId);
      }
      for (let i = 1; i < path.stationIds.length; i++) {
        const previous = path.stationIds[i - 1]!;
        const id = path.stationIds[i]!;
        nodes.get(previous)!.next.add(id);
        nodes.get(id)!.previous.add(previous);
      }
    }
    const indegree = new Map([...nodes].map(([id, node]) => [id, node.previous.size]));
    const queue = [...nodes.keys()].filter((id) => indegree.get(id) === 0);
    const order: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      order.push(id);
      for (const child of nodes.get(id)!.next) {
        const degree = indegree.get(child)! - 1;
        indegree.set(child, degree);
        if (degree === 0) queue.push(child);
      }
    }
    if (order.length !== nodes.size) throw new Error(`Conflicting station order: ${routeId}`);

    const segmentOf = new Map<string, string>();
    const segments = new Map<string, StripSegment>();
    for (const id of order) {
      if (segmentOf.has(id)) continue;
      const patternIds = [...nodes.get(id)!.patterns].sort();
      const segment: StripSegment = {
        kind: "segment",
        id,
        stationIds: [],
        patternIds,
        routeIds: unique(
          paths.filter((p) => patternIds.includes(p.routePatternId)).map((p) => p.routeId),
        ),
      };
      let at: string | undefined = id;
      while (at) {
        segmentOf.set(at, id);
        segment.stationIds.push(at);
        const next: string | undefined =
          nodes.get(at)!.next.size === 1 ? [...nodes.get(at)!.next][0] : undefined;
        at =
          next &&
          nodes.get(next)!.previous.size === 1 &&
          [...nodes.get(next)!.patterns].sort().join("\0") === patternIds.join("\0")
            ? next
            : undefined;
      }
      segments.set(id, segment);
    }
    const nextSegments = new Map(
      [...segments].map(([id, segment]) => [
        id,
        unique(
          [...nodes.get(segment.stationIds.at(-1)!)!.next].map((next) => segmentOf.get(next)!),
        ),
      ]),
    );
    const descendants = new Map<string, Set<string>>();
    function reachable(id: string): Set<string> {
      if (!descendants.has(id))
        descendants.set(
          id,
          new Set([id, ...nextSegments.get(id)!.flatMap((child) => [...reachable(child)])]),
        );
      return descendants.get(id)!;
    }
    function commonJoin(starts: string[]): string | undefined {
      return [...segments.keys()].find((id) => starts.every((start) => reachable(start).has(id)));
    }
    function branch(start: string, stop?: string): StripBranch {
      const segment = segments.get(start)!;
      const labels =
        routeId === "Green"
          ? segment.routeIds.map((id) => id.replace("Green-", ""))
          : unique(
              paths
                .filter((p) => segment.patternIds.includes(p.routePatternId))
                .map((p) => byId.get(p.stationIds.at(-1)!)!.name),
            );
      return { label: labels.join(" / "), routeIds: segment.routeIds, blocks: walk(start, stop) };
    }
    function fork(starts: string[], stop?: string): { block: StripBlock; join?: string } {
      const join = commonJoin(starts) ?? stop;
      return {
        block: {
          kind: "branches",
          id: starts.join("|"),
          joins: join !== undefined,
          branches: starts.map((start) => branch(start, join)),
        },
        join,
      };
    }
    function walk(start: string | undefined, stop?: string): StripBlock[] {
      const blocks: StripBlock[] = [];
      let at = start;
      while (at && at !== stop) {
        blocks.push(segments.get(at)!);
        const next = nextSegments.get(at)!;
        if (next.length > 1) {
          const { block, join } = fork(next, stop);
          blocks.push(block);
          at = join;
        } else at = next[0];
      }
      return blocks;
    }
    const roots = [...segments.keys()].filter((id) => nodes.get(id)!.previous.size === 0);
    const blocks: StripBlock[] = [];
    if (roots.length > 1) {
      const { block, join } = fork(roots);
      blocks.push(block, ...walk(join));
    } else blocks.push(...walk(roots[0]));
    return {
      routeId,
      routeName: routeId === "Green" ? "Green Line" : group[0]!.routeName,
      stations: [...byId.values()],
      blocks,
    };
  });
}
