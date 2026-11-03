// データ品質の指標（004 FR-013 の監視で使う）。純粋関数。

/**
 * 応答の解析に失敗した行の割合。rejected / (accepted + rejected)。行がなければ 0。
 * 監視は、この値が 1% を超えたら通知する。
 */
export function rejectedRowRatio(acceptedRows: number, rejectedRows: number): number {
  const total = acceptedRows + rejectedRows;
  if (total <= 0) return 0;
  return rejectedRows / total;
}
