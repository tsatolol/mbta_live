"use client";
// 稼働状況の画面（System Status、US4）: ジョブごとの直近の実行結果、MBTA API のレート制限の残量、
// テーブルごとのデータ量（FR-007）。30 秒ごとに取り直す
import { useQuery } from "@tanstack/react-query";
import { statusResponseSchema, type StatusResponse } from "@/lib/api-schemas/status";
import { fetchJson } from "@/lib/fetch-json";
import { formatInBoston } from "@/lib/time";
import { useNow } from "@/hooks/use-now";
import { CheckIcon, InfoIcon, WarningIcon } from "@/components/icons";
import { statusSummary } from "@/lib/display/status-summary";
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

function RunStatus({ status, testId }: { status: string; testId?: string }) {
  const Icon = status === "success" ? CheckIcon : status === "failed" ? WarningIcon : InfoIcon;
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold" data-testid={testId}>
      <Icon size={16} />
      {status}
    </span>
  );
}

type Job = StatusResponse["jobs"][number];

function JobCard({ job, now }: { job: Job; now: Date }) {
  const keys = JOB_COUNT_KEYS[job.job] ?? [];
  return (
    <section className="border-t border-rule pt-4" data-testid={`job-${job.job}`}>
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">{JOB_TITLES[job.job] ?? job.job}</h2>
        {job.lastRun ? (
          <RunStatus status={job.lastRun.status} testId="job-last-status" />
        ) : (
          <RunStatus status="never run" testId="job-last-status" />
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
        <div
          className="overflow-x-auto border border-rule"
          tabIndex={0}
          role="region"
          aria-label={`${JOB_TITLES[job.job] ?? job.job} recent runs`}
        >
          <table className="w-full min-w-max text-left text-xs">
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
                    <RunStatus status={r.status} />
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {durationLabel(
                      new Date(r.startedAt),
                      r.finishedAt ? new Date(r.finishedAt) : null,
                    ) ?? "–"}
                  </td>
                  <td className="min-w-[24rem] px-3 py-1.5 [overflow-wrap:anywhere]">
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
  const summary = data ? statusSummary(data, now) : null;
  const SummaryIcon = summary?.state === "healthy" ? CheckIcon : WarningIcon;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-extrabold">System status</h1>
      {status.isPending && <p className="text-sm text-muted-foreground">Loading status…</p>}
      {status.isError && (
        <p className="text-sm text-destructive" role="alert">
          Unable to load status. Retrying…
        </p>
      )}
      {data && (
        <>
          {summary && (
            <p
              data-testid="status-summary"
              role="status"
              className="flex items-start gap-3 text-md"
            >
              {summary.state !== "healthy" && (
                <span aria-hidden="true" className="stale-stripes w-3 shrink-0 self-stretch" />
              )}
              <SummaryIcon className="mt-1 shrink-0" />
              <span>{summary.text}</span>
            </p>
          )}
          <div className="grid gap-4 border-b border-rule pb-4 sm:grid-cols-2">
            <section className="px-3 py-2" data-testid="rate-limit">
              <h2 className="text-xs text-muted-foreground">MBTA API rate limit remaining</h2>
              <p className="text-md font-semibold tabular-nums" data-testid="rate-limit-value">
                {data.rateLimitRemaining ?? "–"}
              </p>
              <p className="text-xs text-muted-foreground">As reported on the last collector run</p>
            </section>
            <section className="px-3 py-2" data-testid="last-collected">
              <h2 className="text-xs text-muted-foreground">Last successful collection</h2>
              <p className="text-md font-semibold tabular-nums">
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

          <section className="border-t border-rule pt-4" data-testid="tables">
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
                    <td className="px-3 py-1.5 font-mono text-xs break-all">{t.name}</td>
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
