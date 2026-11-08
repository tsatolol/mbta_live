import { describe, expect, it } from "vitest";
import {
  headwaySummary,
  predictionSummary,
  alertSummary,
  patternSummary,
  type SummaryPart,
} from "@/lib/display/summaries";
const sentence = (parts: SummaryPart[]) => parts.map((p) => p.text).join("");
const values = (parts: SummaryPart[]) =>
  Object.fromEntries(parts.filter((p) => p.testId).map((p) => [p.testId, p.text]));
describe("analytics summaries", () => {
  it("運行間隔は件数で重み付けした近似中央値を使い、件数と単数形を保つ", () => {
    const parts = headwaySummary({
      route: "Red",
      totals: { n: 4, bunchingCount: 1, gapCount: 1 },
      daily: [
        { n: 1, p50Sec: 60 },
        { n: 3, p50Sec: 300 },
      ],
    });
    expect(sentence(parts)).toContain("Red Line");
    expect(sentence(parts)).toContain("approximately 4 min");
    expect(sentence(parts)).toContain("1 bunching event and 1 gap.");
    expect(values(parts)["stat-headways-value"]).toBe("4");
  });
  it("0 件は数値を捏造せず表示する", () => {
    const parts = headwaySummary({
      route: "Red",
      totals: { n: 0, bunchingCount: 0, gapCount: 0 },
      daily: [],
    });
    expect(sentence(parts)).toContain("No headway data");
    expect(values(parts)["stat-headways-value"]).toBe("0");
    expect(sentence(parts)).not.toMatch(/NaN|Infinity/);
  });
  it("複数の bunching events / gaps と Green の合算を表す", () => {
    const parts = headwaySummary({
      route: "Green",
      totals: { n: 1000, bunchingCount: 26, gapCount: 16 },
      daily: [{ n: 1000, p50Sec: 366 }],
    });
    expect(sentence(parts)).toContain("Green Line");
    expect(sentence(parts)).toContain("26 bunching events and 16 gaps");
    expect(values(parts)["stat-headways-value"]).toBe("1,000");
  });
  it.each([
    [12, "+12 s (late)"],
    [-5, "-5 s (early)"],
    [0, "0 s"],
  ])("予測の誤差 %s 秒の符号と割合を保つ", (bias, label) => {
    const parts = predictionSummary({
      totals: { n: 1, meanAbsErrorSec: 20.6, within60sRatio: 0.625, meanErrorSec: bias },
    });
    expect(sentence(parts)).toContain("1 prediction");
    expect(values(parts)).toMatchObject({
      "stat-predictions-value": "1",
      "stat-mae-value": "21 s",
      "stat-within-value": "62.5%",
      "stat-bias-value": label,
    });
  });
  it("予測精度がないときは 0% と誤表示しない", () => {
    expect(sentence(predictionSummary({ totals: null }))).toContain("No prediction data");
    expect(sentence(predictionSummary({ totals: null }))).not.toContain("0%");
  });
  it("アラート件数は alert-days、時間は hours とし、単数・複数を区別する", () => {
    const parts = alertSummary({
      totals: {
        disruption: { alertCount: 1, activeMinutes: 90 },
        notice: { alertCount: 2, activeMinutes: 120 },
      },
    });
    expect(sentence(parts)).toContain("1 disruption alert-day");
    expect(sentence(parts)).toContain("2 notice alert-days");
    expect(values(parts)["stat-disruption-hours-value"]).toBe("1.5");
  });
  it("アラートがないときも 0 件と時間の単位を保つ", () => {
    const parts = alertSummary({
      totals: {
        disruption: { alertCount: 0, activeMinutes: 0 },
        notice: { alertCount: 0, activeMinutes: 0 },
      },
    });
    expect(values(parts)).toEqual({
      "stat-disruption-alerts-value": "0",
      "stat-disruption-hours-value": "0",
      "stat-notice-alerts-value": "0",
      "stat-notice-hours-value": "0",
    });
    expect(sentence(parts)).toContain("0 disruption alert-days (0 hours)");
  });
  it.each(["headway_p90", "prediction_abs_error", "alert_minutes"] as const)(
    "パターン %s の最大セルを運行日の曜日と時刻で示す",
    (metric) => {
      const parts = patternSummary({
        metric,
        route: "Red",
        cells: [
          { dayOfWeek: 2, hour: 8, value: 120, n: 2 },
          { dayOfWeek: 1, hour: 7, value: 60, n: 1 },
        ],
      });
      expect(sentence(parts)).toContain("Tuesday service days at 8:00 Boston time");
      expect(sentence(parts)).toContain(
        metric === "headway_p90" ? "2 min" : metric === "alert_minutes" ? "120 min/day" : "120 s",
      );
    },
  );
  it("パターンの null と有効な 0 を区別する", () => {
    const source = {
      metric: "alert_minutes" as const,
      route: null,
      cells: [{ dayOfWeek: 1, hour: 3, value: null, n: 0 }],
    };
    expect(sentence(patternSummary(source))).toContain("No pattern data");
    expect(
      sentence(patternSummary({ ...source, cells: [{ dayOfWeek: 1, hour: 3, value: 0, n: 1 }] })),
    ).toContain("0 min/day");
  });
});
