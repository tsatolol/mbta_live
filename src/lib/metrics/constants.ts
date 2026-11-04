// 指標の定数。しきい値やバケットはここに集めて調整する（憲章の原則 IV）。

/** 予測を保存するリード時間のバケット（分） */
export const LEAD_BUCKETS_MIN = [1, 3, 5, 10, 15] as const;

/** updated_at がこれより古い車両は「更新が止まっている」とみなす（秒） */
export const STALE_VEHICLE_SEC = 180;

/** 最後に収集に成功してからこれ以上経つと、画面に stale の警告を出す（秒。002 FR-006） */
export const STALE_LIVE_DATA_SEC = 180;
