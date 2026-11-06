"use client";
// 駅の到着表示（005 US3）: 方向ごとの発車標。30 秒ごとに取得し、
// 毎秒カウントダウンする（FR-004）。運休の便は Cancelled、その駅と路線に有効なアラートも表示する
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { predictionsResponseSchema } from "@/lib/api-schemas/predictions";
import { ApiError, fetchJson } from "@/lib/fetch-json";
import { useNow } from "@/hooks/use-now";
import { DepartureBoard } from "@/components/arrivals/departure-board";
import { arrivalRouteLabel } from "@/components/arrivals/format";
import { lineColorToken } from "@/lib/display/line-counts";
import { WarningIcon } from "@/components/icons";
import { StationAlerts } from "@/components/arrivals/station-alerts";

/** 予測の取得間隔（FR-004） */
const PREDICTIONS_REFETCH_MS = 30_000;

export default function ArrivalBoardPage() {
  const { stopId } = useParams<{ stopId: string }>();
  const now = useNow(1_000);
  const board = useQuery({
    queryKey: ["live", "predictions", stopId],
    queryFn: () =>
      fetchJson(`/api/live/predictions?stop=${encodeURIComponent(stopId)}`, (b) =>
        predictionsResponseSchema.parse(b),
      ),
    refetchInterval: PREDICTIONS_REFETCH_MS,
    // 存在しない駅は取り直さない
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 3,
  });

  const notFound = board.error instanceof ApiError && board.error.status < 500;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
        <ol className="flex flex-wrap items-baseline gap-2">
          <li>
            <Link href="/stations" className="underline underline-offset-4 hover:text-ink">
              Stations
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="min-w-0 [overflow-wrap:anywhere]">
            {notFound ? "Station not found" : (board.data?.stop.name ?? "Loading…")}
          </li>
        </ol>
      </nav>

      {notFound ? (
        <p className="text-sm" data-testid="station-not-found" role="status">
          Station not found.{" "}
          <Link href="/stations" className="underline underline-offset-4">
            Find a station in the station list.
          </Link>
        </p>
      ) : (
        <>
          <h1
            className="text-xl font-extrabold [overflow-wrap:anywhere]"
            data-testid="station-name"
          >
            {board.data?.stop.name ?? "Loading…"}
          </h1>
          {board.isError && (
            <p className="text-sm text-destructive" role="alert">
              <WarningIcon className="mr-2 inline-block" />
              Unable to load arrivals. Retrying automatically.
            </p>
          )}
          {board.data && (
            <>
              <ul
                aria-label="Lines serving this station"
                className="flex flex-wrap gap-x-6 gap-y-2"
              >
                {[...new Set(board.data.directions.map((d) => d.routeId))].map((routeId) => (
                  <li key={routeId} className="inline-flex items-center gap-2 text-sm">
                    <span
                      aria-hidden="true"
                      className="h-6 w-1.5"
                      style={{ backgroundColor: `var(${lineColorToken(routeId)})` }}
                    />
                    {arrivalRouteLabel(routeId)}
                  </li>
                ))}
              </ul>
              <StationAlerts alerts={board.data.alerts} />
              {board.data.directions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No trains depart from this station.</p>
              ) : (
                <DepartureBoard
                  directions={board.data.directions}
                  now={now}
                  snapshotAt={new Date(board.data.generatedAt)}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
