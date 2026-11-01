# Research: リアルタイム画面

## 画面の更新方式: 自前 API のポーリング

- **Decision**: ブラウザは自前の API を TanStack Query の `refetchInterval` でポーリングする（地図 15 秒、駅 30 秒）。API は DB の最新の状態を返す
- **Rationale**: 収集が 1 分間隔なので、サーバーからのプッシュ（SSE）にしても鮮度はほとんど変わらない。閲覧者が増えても MBTA API へのリクエスト数は変わらない
- **Alternatives**: SSE でサーバーから配信（Cloud Run で長時間接続を管理する必要があり、効果が小さい）

## 地図: MapLibre GL JS + OpenFreeMap

- **Decision**: MapLibre GL JS と OpenFreeMap の `positron` スタイル（淡色）
- **Rationale**: 無料で API キーが不要。路線形状の描画と車両アイコンの回転を扱いやすい。淡色の地図で路線色が目立つ
- **Alternatives**: Leaflet + OSM（ベクタータイルや滑らかな描画が苦手）、Google Maps JS API（API キーと従量課金が必要）

## UI

- **Decision**: Tailwind CSS + shadcn/ui。画面は英語、時刻はボストン時間
- **Rationale**: 少ない手間で一貫した見た目にできる

## 認証

- **Decision**: IAP で許可したユーザーだけに制限する（設定は `specs/004-infra-cicd/`）。アプリ側にログイン機能は作らない
- **Rationale**: 利用者が少数で固定。アプリにユーザー管理を持たずに済む

## 出典表記

- **Decision**: フッターに `Data provided by MBTA` と `© OpenFreeMap © OpenStreetMap contributors` を出す
- **Rationale**: MBTA の開発者向け利用規約と OSM のライセンス表記のため
