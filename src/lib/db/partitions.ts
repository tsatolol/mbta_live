// 履歴テーブルのパーティション（運行日ごとの子テーブル）の管理。
// 子テーブルはスキーマ "partitions" に置き、Prisma の管理対象（public）に入れない
// （specs/001-data-collection/data-model.md）。
import { isServiceDate, serviceDayRange, type ServiceDate } from "@/lib/time";
import type { Db } from "./client";

export const PARTITION_SCHEMA = "partitions";

/** パーティション化した親テーブルと、範囲の種類 */
export const PARTITIONED_TABLES = {
  vehicle_positions: "timestamptz",
  prediction_samples: "date",
  arrival_events: "date",
} as const;

export type PartitionedTable = keyof typeof PARTITIONED_TABLES;

export function partitionName(table: PartitionedTable, serviceDate: ServiceDate): string {
  if (!isServiceDate(serviceDate))
    throw new Error(`運行日の形式が正しくありません: ${serviceDate}`);
  return `${table}_p${serviceDate.replaceAll("-", "")}`;
}

function nextDate(serviceDate: ServiceDate): string {
  const d = new Date(`${serviceDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 子テーブルを作る SQL。値は検証済みの運行日から作るので、文字列の連結で安全 */
export function createPartitionSql(table: PartitionedTable, serviceDate: ServiceDate): string {
  const name = partitionName(table, serviceDate);
  let from: string;
  let to: string;
  if (PARTITIONED_TABLES[table] === "timestamptz") {
    const range = serviceDayRange(serviceDate);
    from = range.start.toISOString();
    to = range.end.toISOString();
  } else {
    from = serviceDate;
    to = nextDate(serviceDate);
  }
  return (
    `CREATE TABLE IF NOT EXISTS "${PARTITION_SCHEMA}"."${name}" ` +
    `PARTITION OF "public"."${table}" FOR VALUES FROM ('${from}') TO ('${to}')`
  );
}

function isDuplicateTableError(error: unknown): boolean {
  // 別のジョブが同時に同じ子テーブルを作った場合（42P07 duplicate_table）は無視する
  const text =
    error instanceof Error
      ? `${error.message} ${String((error as { code?: unknown }).code ?? "")}`
      : String(error);
  return text.includes("42P07") || text.includes("already exists");
}

/** 指定した運行日の子テーブルを、3 つの履歴テーブルすべてについて作る。作成済みなら何もしない */
export async function ensurePartitions(
  db: Db,
  serviceDates: readonly ServiceDate[],
): Promise<void> {
  for (const serviceDate of serviceDates) {
    for (const table of Object.keys(PARTITIONED_TABLES) as PartitionedTable[]) {
      try {
        await db.$executeRawUnsafe(createPartitionSql(table, serviceDate));
      } catch (error) {
        if (!isDuplicateTableError(error)) throw error;
      }
    }
  }
}

export interface PartitionInfo {
  table: PartitionedTable;
  name: string;
  serviceDate: ServiceDate;
}

const PARTITION_NAME_RE =
  /^(vehicle_positions|prediction_samples|arrival_events)_p(\d{4})(\d{2})(\d{2})$/;

/** 作成済みの子テーブルの一覧 */
export async function listPartitions(db: Db): Promise<PartitionInfo[]> {
  const rows = await db.$queryRaw<{ name: string }[]>`
    SELECT c.relname AS name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = ${PARTITION_SCHEMA}
    ORDER BY c.relname`;
  return rows.flatMap(({ name }) => {
    const m = PARTITION_NAME_RE.exec(name);
    if (!m) return [];
    return [{ table: m[1] as PartitionedTable, name, serviceDate: `${m[2]}-${m[3]}-${m[4]}` }];
  });
}
