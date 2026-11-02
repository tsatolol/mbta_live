# mbta_live

ボストン地下鉄（MBTA Rapid Transit）の運行状況をリアルタイムで監視し、運行データを蓄積して分析するダッシュボード。MBTA V3 API からデータを取得し、Google Cloud Run と Cloud SQL で動かす。車両の現在位置、到着予測、運行アラートを表示し、運行間隔・予測精度・アラートの傾向を分析する。

- 仕様と開発ガイド: [CLAUDE.md](./CLAUDE.md)
- システム構成: [docs/architecture.md](./docs/architecture.md)
- 機能ごとの仕様: [specs/](./specs/)
