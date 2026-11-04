"use client";
// 駅の到着表示（Arrival Board、US2）: 方向ごとに次の 3 本を「n min」で表示する。30 秒ごとに取得し、
// 毎秒カウントダウンする（FR-004）。運休の便は Cancelled、その駅と路線に有効なアラートも表示する
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { predictionsResponseSchema } from "@/lib/api-schemas/predictions";
import { ApiError, fetchJson } from "@/lib/fetch-json";
import { useNow } from "@/hooks/use-now";
import { DirectionCard } from "@/components/arrivals/direction-card";
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
      <Link href="/stations" className="text-sm text-muted-foreground hover:text-foreground">
        ← All stations
      </Link>

      {notFound ? (
        <p className="text-sm" data-testid="station-not-found" role="status">
          Station not found.
        </p>
      ) : (
        <>
          <h1 className="text-xl font-semibold" data-testid="station-name">
            {board.data?.stop.name ?? "Loading…"}
          </h1>
          {board.isError && (
            <p className="text-sm text-destructive" role="alert">
              Unable to load arrivals. Retrying…
            </p>
          )}
          {board.data && (
            <>
              <StationAlerts alerts={board.data.alerts} />
              {board.data.directions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No trains depart from this station.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {board.data.directions.map((d) => (
                    <DirectionCard key={`${d.routeId}-${d.directionId}`} group={d} now={now} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
