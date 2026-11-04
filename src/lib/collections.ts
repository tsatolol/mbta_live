// 小さな共通の関数（集計で大量の行を扱うので、配列をコピーせずに足す）

/** Map の値の配列に足す（なければ作る）。`[...(m.get(k) ?? []), v]` は行数の 2 乗の時間がかかるので使わない */
export function appendTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
