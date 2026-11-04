// 地図のポップアップの表示用の文言（純粋関数）

const STATUS_LABELS: Record<string, string> = {
  IN_TRANSIT_TO: "In transit to",
  INCOMING_AT: "Approaching",
  STOPPED_AT: "Stopped at",
};

/** 車両の状態（current_status）を表示用の文言にする。未知の値はそのまま */
export function statusLabel(currentStatus: string): string {
  return STATUS_LABELS[currentStatus] ?? currentStatus;
}

/** 何秒前の情報か（"35s ago"、"4m 10s ago"） */
export function ageLabel(updatedAt: Date, now: Date): string {
  const sec = Math.max(0, Math.round((now.getTime() - updatedAt.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s ago`;
}
