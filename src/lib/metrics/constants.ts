// 指標の定数。しきい値やバケットはここに集めて調整する（憲章の原則 IV）。

/** 予測を保存するリード時間のバケット（分） */
export const LEAD_BUCKETS_MIN = [1, 3, 5, 10, 15] as const;

/** updated_at がこれより古い車両は「更新が止まっている」とみなす（秒） */
export const STALE_VEHICLE_SEC = 180;

/** 最後に収集に成功してからこれ以上経つと、画面に stale の警告を出す（秒。002 FR-006） */
export const STALE_LIVE_DATA_SEC = 180;

// ---- 003 分析（specs/003-analytics/data-model.md の「指標の定義」）----

/**
 * 指標の定義の版。定義を変えたら上げ、生データが残っている期間を再集計する。
 * 0 = 指標がそろう前（003 のフェーズ 2〜4）、1 = 運行間隔・予測精度・アラートの 3 つ
 */
export const AGGREGATE_DEFINITION_VERSION = 1;

/** この版以上で集計が成功した運行日だけ、001 の生データを消してよい（指標がそろう前の集計では消さない） */
export const MIN_DROPPABLE_DEFINITION_VERSION = 1;

/** これより長い運行間隔は運休時間帯とみなして除く（秒） */
export const MAX_HEADWAY_SEC = 60 * 60;

/** 団子運転: 運行間隔がこれ未満（秒） */
export const BUNCHING_THRESHOLD_SEC = 2 * 60;

/** 間隔の開き: 運行間隔が基準の中央値のこの倍より大きい */
export const GAP_MULTIPLIER = 2;

/** 間隔の開きの基準の中央値を求める日数（対象の運行日より前） */
export const GAP_BASELINE_DAYS = 28;

/** 予測が「当たった」とみなす誤差の幅（秒。この値ちょうどを含む） */
export const PREDICTION_WITHIN_SEC = 60;

/** 遅延系のアラートの effect。これ以外はすべてお知らせ系 */
export const DISRUPTION_EFFECTS = ["DELAY", "SUSPENSION", "SHUTTLE", "STATION_CLOSURE"] as const;

/** 分析 API で一度に指定できる期間の最大の日数 */
export const ANALYTICS_MAX_RANGE_DAYS = 92;

/** 分析 API の期間の既定の日数（今日を含む） */
export const ANALYTICS_DEFAULT_RANGE_DAYS = 7;
