// グラフの設定の中の CSS 変数の参照（"var(--chart-1)"）を、いまの表示の値に置き換える（005 T010）。
// ECharts は canvas に描くので CSS 変数を読めない。描く直前にこの関数で値にする
const VAR_REF = /^var\((--[a-z0-9-]+)\)$/i;

/** 値（配列・オブジェクトの中も）の "var(--name)" を lookup(name) に置き換えた写しを返す。元は変えない */
export function resolveCssVars<T>(value: T, lookup: (name: string) => string): T {
  if (typeof value === "string") {
    const m = VAR_REF.exec(value);
    return (m ? lookup(m[1]!) || value : value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => resolveCssVars(v, lookup)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveCssVars(v, lookup)]),
    ) as T;
  }
  return value;
}
