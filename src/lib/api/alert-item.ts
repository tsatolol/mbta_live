// アラートの行（alerts + alert_routes）を応答の形（alertSchema）にする。駅の到着表示とアラートの一覧で使う
import "server-only";
import { z } from "zod";
import type { AlertRow } from "@/lib/db/live";
import type { AlertItem } from "@/lib/api-schemas/alerts";
import { alertStatus, type ActivePeriod } from "@/lib/metrics/live";
import type { InformedEntity } from "@/lib/metrics/arrival-board";

const activePeriodSchema = z.array(
  z.object({
    start: z.iso.datetime({ offset: true }),
    end: z.iso.datetime({ offset: true }).nullable(),
  }),
);
const informedEntitySchema = z.array(
  z.looseObject({ route: z.string().optional(), stop: z.string().optional() }),
);

/** DB に保存した active_period（ISO 8601 の文字列）を読む */
export function parseActivePeriod(value: unknown): ActivePeriod[] {
  return activePeriodSchema.parse(value).map((p) => ({
    start: new Date(p.start),
    end: p.end === null ? null : new Date(p.end),
  }));
}

/** DB に保存した informed_entity を読む（路線と駅だけを使う） */
export function parseInformedEntity(value: unknown): InformedEntity[] {
  return informedEntitySchema.parse(value).map((e) => ({
    ...(e.route !== undefined ? { route: e.route } : {}),
    ...(e.stop !== undefined ? { stop: e.stop } : {}),
  }));
}

export function toAlertItem(row: AlertRow, now: Date): AlertItem {
  const periods = parseActivePeriod(row.activePeriod);
  return {
    id: row.id,
    effect: row.effect,
    cause: row.cause,
    severity: row.severity,
    header: row.header,
    shortHeader: row.shortHeader,
    description: row.description,
    serviceEffect: row.serviceEffect,
    timeframe: row.timeframe,
    lifecycle: row.lifecycle,
    status: alertStatus(periods, now),
    activePeriod: periods.map((p) => ({
      start: p.start.toISOString(),
      end: p.end?.toISOString() ?? null,
    })),
    routeIds: row.routeIds,
    inFeed: row.inFeed,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}
