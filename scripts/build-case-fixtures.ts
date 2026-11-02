// 記録済みのフィクスチャから、特殊ケースの行だけを抜き出して tests/fixtures/mbta/cases/ に保存する（pnpm fixtures:cases）。
// 各ファイルは JSON:API の文書で、meta に元のファイル・記録時刻・説明を入れる。
// スキーマに合わない行のケース（vehicles-malformed）だけは、実データの行を壊して作った合成データ。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { TZDate } from "@date-fns/tz";
import { z } from "zod";
import { BOSTON_TZ } from "../src/lib/time";
import { STALE_VEHICLE_SEC } from "../src/lib/metrics/constants";

const DIR = "tests/fixtures/mbta";
const OUT = path.join(DIR, "cases");

const docSchema = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  included: z.array(z.record(z.string(), z.unknown())).optional(),
});
type Doc = z.infer<typeof docSchema>;
type Row = Doc["data"][number];

const rowSchema = z.object({
  id: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  relationships: z.record(z.string(), z.object({ data: z.unknown() })).optional(),
});

async function load(file: string): Promise<Doc> {
  return docSchema.parse(JSON.parse(await readFile(path.join(DIR, file), "utf8")));
}

/** ファイル名の時刻（ET の YYYYMMDD-HHmm）を UTC の ISO 文字列にする */
function recordedAt(file: string): string {
  const m = /-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.json$/.exec(file);
  if (!m) throw new Error(`ファイル名に記録時刻がありません: ${file}`);
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return new Date(new TZDate(y, mo - 1, d, h, mi, 0, BOSTON_TZ).getTime()).toISOString();
}

function attr(row: Row, key: string): unknown {
  return rowSchema.parse(row).attributes[key];
}

function relId(row: Row, key: string): string | null {
  const data = rowSchema.parse(row).relationships?.[key]?.data;
  return z.object({ id: z.string() }).nullable().optional().parse(data)?.id ?? null;
}

async function save(
  name: string,
  source: string,
  note: string,
  data: Row[],
  included?: Row[],
): Promise<void> {
  if (data.length === 0 && !name.includes("off-hours"))
    throw new Error(`${name}: 該当する行がありません`);
  const doc = {
    data,
    ...(included ? { included } : {}),
    jsonapi: { version: "1.0" },
    meta: { source, recordedAt: recordedAt(source), note },
  };
  await writeFile(path.join(OUT, `${name}.json`), `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`${name}.json  rows=${data.length}`);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const OFF_V = "vehicles-20261101-0421.json";
  const OFF_P = "predictions-20261101-0422.json";
  const SUN_V = "vehicles-20261101-0548.json";
  const SUN_P = "predictions-20261101-0548.json";
  const ALERTS = "alerts-20261101-0422.json";
  const PATTERNS = "route-patterns-20261101-0423.json";

  await save("vehicles-off-hours", OFF_V, "運行時間外。data が空", (await load(OFF_V)).data);
  await save("predictions-off-hours", OFF_P, "運行時間外。data が空", (await load(OFF_P)).data);

  const sunV = await load(SUN_V);
  await save(
    "vehicles-stop-null",
    SUN_V,
    "stop が null の車両",
    sunV.data.filter((v) => relId(v, "stop") === null),
  );
  const staleBefore = Date.parse(recordedAt(SUN_V)) - STALE_VEHICLE_SEC * 1000;
  await save(
    "vehicles-stale",
    SUN_V,
    `updated_at が記録時刻より ${STALE_VEHICLE_SEC} 秒以上前の車両（終点で待機中）`,
    sunV.data.filter((v) => Date.parse(String(attr(v, "updated_at"))) < staleBefore),
  );
  await save(
    "vehicles-terminal-track",
    SUN_V,
    "stop が終点の番線 ID（Alewife-01 など。/stops の route_type 指定では返らない）",
    sunV.data.filter((v) =>
      /^(Alewife|Braintree|Forest Hills|Oak Grove|Union Square)-0\d$/.test(relId(v, "stop") ?? ""),
    ),
  );

  const malformedBase = sunV.data.slice(0, 2);
  const broken = structuredClone(sunV.data[2]);
  const missingId = structuredClone(sunV.data[3]);
  if (!broken || !missingId) throw new Error("vehicles の行が足りません");
  // rowSchema.parse() はコピーを返すので、元の行を直接書き換える
  (broken.attributes as Record<string, unknown>).latitude = "not-a-number";
  delete (missingId as Record<string, unknown>).id;
  await save(
    "vehicles-malformed",
    SUN_V,
    "合成データ: 正しい行 2 件 + latitude が文字列の行 + id のない行。解析で 2 件がスキップされ、ジョブは成功する",
    [...malformedBase, broken, missingId],
  );

  const alerts = await load(ALERTS);
  await save(
    "alerts-upcoming",
    ALERTS,
    "lifecycle が UPCOMING（まだ始まっていない予告）",
    alerts.data.filter((a) => attr(a, "lifecycle") === "UPCOMING"),
  );

  const sunP = await load(SUN_P);
  await save(
    "predictions-cancelled",
    SUN_P,
    "schedule_relationship が CANCELLED（arrival_time / departure_time がどちらも null）",
    sunP.data.filter((p) => attr(p, "schedule_relationship") === "CANCELLED"),
  );
  await save(
    "predictions-skipped",
    SUN_P,
    "schedule_relationship が SKIPPED",
    sunP.data.filter((p) => attr(p, "schedule_relationship") === "SKIPPED"),
  );
  await save(
    "predictions-origin",
    SUN_P,
    "始発駅の予測（arrival_time が null で departure_time だけがある）",
    sunP.data
      .filter((p) => attr(p, "arrival_time") === null && attr(p, "departure_time") !== null)
      .slice(0, 10),
  );

  const patterns = await load(PATTERNS);
  const shuttle = patterns.data.filter((p) => (relId(p, "route") ?? "").startsWith("Shuttle-"));
  const tripIds = new Set(shuttle.map((p) => relId(p, "representative_trip")));
  const trips = (patterns.included ?? []).filter(
    (i) => i.type === "trip" && tripIds.has(String(i.id)),
  );
  const shapeIds = new Set(trips.map((t) => relId(t, "shape")));
  const shapes = (patterns.included ?? []).filter(
    (i) => i.type === "shape" && shapeIds.has(String(i.id)),
  );
  await save(
    "route-patterns-shuttle",
    PATTERNS,
    "臨時の代行バス路線（Shuttle-*, typicality=4）のパターン",
    shuttle,
    [...trips, ...shapes],
  );
}

await main();
