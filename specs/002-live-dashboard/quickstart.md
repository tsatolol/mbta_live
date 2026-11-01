# Quickstart: リアルタイム画面をローカルで動かす

001 の quickstart でローカル DB を用意し、データを入れてから:

```bash
pnpm dev                       # http://localhost:3000
pnpm test:e2e                  # Playwright（シード済み DB + フィクスチャ）
```

## 確認すること

- `/`: 路線が路線色で描かれ、車両が矢印で表示される。15 秒ごとに更新される
- `/stations` → 駅を選ぶ: 方向別に次の 3 本が `n min` で表示され、カウントダウンする
- `/alerts`: 有効なアラートが路線別に表示される
- `/status`: 直近の収集結果が表示される
- 収集を止めて 3 分待つと、`Live data is stale` のバナーが出る
- フッターに出典表記が出ている
