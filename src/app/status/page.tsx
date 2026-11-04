"use client";
// 稼働状況の画面（System Status、US4）: ジョブごとの直近の実行結果、MBTA API のレート制限の残量、
// テーブルごとのデータ量（FR-007）。30 秒ごとに取り直す
import { useQuery } from "@tanstack/react-query";
import { statusResponseSchema, type StatusResponse } from "@/lib/api-schemas/status";
import { fetchJson } from "@/lib/fetch-json";
import { formatInBoston } from "@/lib/time";
import { useNow } from "@/hooks/use-now";
import { Badge } from "@/components/ui/badge";
import {
  agoLabel,
  countsLabel,
  durationLabel,
  JOB_COUNT_KEYS,
  rowCountLabel,
} from "@/components/status/format";

const STATUS_REFETCH_MS = 30_000;

const JOB_TITLES: Record<string, string> = {
  collect: "Collector (vehicles, predictions, alerts)",
  "sync-static": "Static data sync (routes, stops)",
  aggregate: "Daily aggregation",
};

function statusVariant(status: string) {
  if (status === "success") return "secondary" as const;
  if (status === "failed") return "destructive" as const;
  return "warning" as const;
}

type Job = StatusResponse["jobs"][number];

function JobCard({ job, now }: { job: Job; now: Date }) {
  const keys = JOB_COUNT_KEYS[job.job] ?? [];
  return (
    <section className="rounded-lg border" data-testid={`job-${job.job}`}>
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">{JOB_TITLES[job.job] ?? job.job}</h2>
        {job.lastRun ? (
          <Badge variant={statusVariant(job.lastRun.status)} data-testid="job-last-status">
            {job.lastRun.status}
          </Badge>
        ) : (
          <Badge variant="outline" data-testid="job-last-status">
            never run
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground" data-testid="job-24h">
          Last 24 h: {job.runsLast24h} {job.runsLast24h === 1 ? "run" : "runs"}, {job.failedLast24h}{" "}
          failed
        </span>
      </header>
      <p className="px-3 py-2 text-sm" data-testid="job-last-success">
        Last success:{" "}
        {job.lastSuccessAt
          ? `${formatInBoston(new Date(job.lastSuccessAt), "MMM d, h:mm:ss a")} ET (${agoLabel(new Date(job.lastSuccessAt), now)})`
          : "never"}
      </p>
      {job.recentRuns.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-t">
                <th className="px-3 py-1.5 font-medium">Started (ET)</th>
                <th className="px-3 py-1.5 font-medium">Status</th>
                <th className="px-3 py-1.5 font-medium">Duration</th>
                <th className="px-3 py-1.5 font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {job.recentRuns.map((r) => (
                <tr
                  key={r.startedAt + r.status}
                  className="border-t align-top"
                  data-testid="job-run"
                  data-status={r.status}
                >
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                    {formatInBoston(new Date(r.startedAt), "MMM d, h:mm:ss a")}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {durationLabel(
                      new Date(r.startedAt),
                      r.finishedAt ? new Date(r.finishedAt) : null,
                    ) ?? "–"}
                  </td>
                  <td className="px-3 py-1.5 break-all">
                    {r.error ? (
                      <span className="text-destructive" data-testid="job-run-error">
                        {r.error}
                      </span>
                    ) : (
                      countsLabel(r.counts, keys)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function StatusPage() {
  const now = useNow(5_000);
  const status = useQuery({
    queryKey: ["status"],
    queryFn: () => fetchJson("/api/status", (b) => statusResponseSchema.parse(b)),
    refetchInterval: STATUS_REFETCH_MS,
  });
  const data = status.data;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">System status</h1>
      {status.isPending && <p className="text-sm text-muted-foreground">Loading status…</p>}
      {status.isError && (
        <p className="text-sm text-destructive" role="alert">
          Unable to load status. Retrying…
        </p>
      )}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-lg border px-3 py-2" data-testid="rate-limit">
              <h2 className="text-xs text-muted-foreground">MBTA API rate limit remaining</h2>
              <p className="text-2xl font-semibold tabular-nums" data-testid="rate-limit-value">
                {data.rateLimitRemaining ?? "–"}
              </p>
              <p className="text-xs text-muted-foreground">As reported on the last collector run</p>
            </section>
            <section className="rounded-lg border px-3 py-2" data-testid="last-collected">
              <h2 className="text-xs text-muted-foreground">Last successful collection</h2>
              <p className="text-2xl font-semibold tabular-nums">
                {data.lastCollectedAt ? agoLabel(new Date(data.lastCollectedAt), now) : "never"}
              </p>
              <p className="text-xs text-muted-foreground">
                {data.lastCollectedAt
                  ? `${formatInBoston(new Date(data.lastCollectedAt), "MMM d, h:mm:ss a")} ET`
                  : "No successful collection yet"}
              </p>
            </section>
          </div>

          {data.jobs.map((job) => (
            <JobCard key={job.job} job={job} now={now} />
          ))}

          <section className="rounded-lg border" data-testid="tables">
            <h2 className="border-b px-3 py-2 text-sm font-semibold">Database</h2>
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 font-medium">Table</th>
                  <th className="px-3 py-1.5 text-right font-medium">Rows</th>
                </tr>
              </thead>
              <tbody>
                {data.tables.map((t) => (
                  <tr key={t.name} className="border-t" data-testid={`table-${t.name}`}>
                    <td className="px-3 py-1.5 font-mono text-xs">{t.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums" data-testid="table-rows">
                      {rowCountLabel(t.rows, t.estimated)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
              ~ marks an estimate from table statistics (partitioned history tables).
            </p>
          </section>
        </>
      )}
    </div>
  );
}
