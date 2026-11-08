import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// scripts/plan-hash.sh（004 FR-007）: ci と cd-prod の prod の plan を比べるハッシュ
const dir = mkdtempSync(join(tmpdir(), "plan-hash-"));
let count = 0;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function hash(plan: unknown): string {
  const file = join(dir, `plan-${count++}.json`);
  writeFileSync(file, JSON.stringify(plan));
  return execFileSync("bash", ["scripts/plan-hash.sh", file], { encoding: "utf8" }).trim();
}

type Change = { actions: string[]; before: unknown; after: unknown; after_unknown: unknown };

function plan(...changes: Array<{ address: string; change: Change }>) {
  return { format_version: "1.2", resource_changes: changes };
}

/** collector の Job に MBTA_API_KEY を足す変更（PR #45）。execution は refresh のたびに変わる値 */
function collectorUpdate(execution: string, envNames = ["DB_PASSWORD", "MBTA_API_KEY"]) {
  const job = (names: string[]) => ({
    name: "collector",
    etag: `etag-${execution}`,
    execution_count: Number(execution),
    latest_created_execution: [{ name: `collector-${execution}`, create_time: execution }],
    template: [{ template: [{ containers: [{ env: names.map((name) => ({ name })) }] }] }],
  });
  return {
    address: 'module.app.google_cloud_run_v2_job.job["collector"]',
    change: {
      actions: ["update"],
      before: job(["DB_PASSWORD"]),
      after: job(envNames),
      after_unknown: {
        etag: true,
        template: [{ template: [{ containers: [{ env: [{}, {}] }] }] }],
      },
    },
  };
}

describe("plan-hash.sh", () => {
  it("変更と関係のない属性が refresh で変わっても、同じハッシュになる", () => {
    expect(hash(plan(collectorUpdate("100")))).toBe(hash(plan(collectorUpdate("101"))));
  });

  it("変更の内容が違えば、ハッシュも変わる", () => {
    expect(hash(plan(collectorUpdate("100")))).not.toBe(
      hash(plan(collectorUpdate("100", ["DB_PASSWORD", "OTHER"]))),
    );
  });

  it("変更のあるリソースが増えれば、ハッシュも変わる", () => {
    const extra = {
      address: "google_storage_bucket.b",
      change: {
        actions: ["create"],
        before: null,
        after: { name: "b" },
        after_unknown: { id: true },
      },
    };
    expect(hash(plan(collectorUpdate("100")))).not.toBe(hash(plan(collectorUpdate("100"), extra)));
  });

  it("no-op のリソースはハッシュに影響しない", () => {
    const noop = {
      address: "google_storage_bucket.b",
      change: { actions: ["no-op"], before: { v: 1 }, after: { v: 1 }, after_unknown: {} },
    };
    expect(hash(plan(collectorUpdate("100"), noop))).toBe(hash(plan(collectorUpdate("100"))));
  });

  it("削除は、消すリソースの state の値が変わっても同じハッシュになる", () => {
    const remove = (v: number) =>
      plan({
        address: "google_storage_bucket.b",
        change: { actions: ["delete"], before: { v }, after: null, after_unknown: {} },
      });
    expect(hash(remove(1))).toBe(hash(remove(2)));
  });

  it("追加は、値と apply 後に決まる属性の違いでハッシュが変わる", () => {
    const create = (after: unknown, afterUnknown: unknown) =>
      plan({
        address: "google_storage_bucket.b",
        change: { actions: ["create"], before: null, after, after_unknown: afterUnknown },
      });
    const base = hash(create({ name: "b" }, { id: true }));
    expect(hash(create({ name: "c" }, { id: true }))).not.toBe(base);
    expect(hash(create({ name: "b" }, { id: true, url: true }))).not.toBe(base);
  });
});
