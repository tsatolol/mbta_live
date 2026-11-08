"use client";
// 分析の画面の絞り込みの部品: 期間（運行日）・路線・方向。画面ごとの項目は children で足す
import type { ReactNode } from "react";
import type { RouteInfo } from "@/lib/api-schemas/routes";
import { Input } from "@/components/ui/input";
import type { Filters } from "./use-analytics-filters";

export const selectClass =
  "h-9 max-w-full rounded-md border border-input bg-panel px-2 text-sm text-ink";

export function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

export function FilterBar({
  filters,
  setFilters,
  resolved,
  routes,
  includeGreen = false,
  allowAllRoutes = true,
  defaultRoute,
  showDirection = true,
  children,
}: {
  filters: Filters;
  setFilters: (patch: Filters) => void;
  /** API が実際に使った期間（未指定のときの既定値を表示するため） */
  resolved?: { from: string; to: string };
  routes: readonly RouteInfo[];
  /** 路線に Green（全支線の合算）を出すか */
  includeGreen?: boolean;
  /** 「すべての路線」を選べるか */
  allowAllRoutes?: boolean;
  /** 路線を選んでいないときに使う路線（allowAllRoutes が false のとき） */
  defaultRoute?: string;
  showDirection?: boolean;
  children?: ReactNode;
}) {
  const route = filters.route ?? (allowAllRoutes ? "" : (defaultRoute ?? ""));
  // 方向の名前は選んだ路線から（Green の合算は支線の B と同じ。4 支線で方向 ID の意味は同じ）
  const routeInfo = routes.find((r) => r.id === (route === "Green" ? "Green-B" : route));
  const directionLabel = (d: 0 | 1) => {
    const name = routeInfo?.directionNames[d];
    const destination = route === "Green" ? null : routeInfo?.directionDestinations[d];
    if (!name) return `Direction ${d}`;
    return destination ? `${name} → ${destination}` : name;
  };
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => e.preventDefault()}
      data-testid="analytics-filters"
    >
      <FilterField label="From">
        <Input
          type="date"
          className="w-40"
          value={filters.from ?? resolved?.from ?? ""}
          onChange={(e) => setFilters({ from: e.target.value })}
          data-testid="filter-from"
        />
      </FilterField>
      <FilterField label="To">
        <Input
          type="date"
          className="w-40"
          value={filters.to ?? resolved?.to ?? ""}
          onChange={(e) => setFilters({ to: e.target.value })}
          data-testid="filter-to"
        />
      </FilterField>
      <FilterField label="Route">
        <select
          className={selectClass}
          value={route}
          // 路線を変えたら、その路線にない駅の選択を外す
          onChange={(e) => setFilters({ route: e.target.value, stop: "" })}
          data-testid="filter-route"
        >
          {allowAllRoutes && <option value="">All routes</option>}
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.longName}
            </option>
          ))}
          {includeGreen && <option value="Green">Green Line (all branches)</option>}
        </select>
      </FilterField>
      {showDirection && (
        <FilterField label="Direction">
          <select
            className={selectClass}
            value={filters.direction ?? ""}
            onChange={(e) => setFilters({ direction: e.target.value })}
            data-testid="filter-direction"
          >
            <option value="">Both directions</option>
            <option value="0">{directionLabel(0)}</option>
            <option value="1">{directionLabel(1)}</option>
          </select>
        </FilterField>
      )}
      {children}
    </form>
  );
}
