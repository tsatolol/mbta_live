#!/usr/bin/env bash
# コンテナの起動確認（004 T024、TR-006）。ビルドしたイメージをテスト用の PostgreSQL に向けて起動し、
#   1. migrate の起動コマンド（prisma migrate deploy）が成功する
#   2. sync-static と collector の起動コマンドが、フィクスチャ（MBTA_FIXTURE_MODE=1）で成功する
#   3. web を起動すると /api/health が 200 を返す
# ことを確かめる。MBTA API は呼ばない。
#
# 使い方: scripts/check-container.sh <イメージ> <DATABASE_URL>
#   DATABASE_URL は、コンテナから見た接続先（--network host で起動するので localhost でよい）。中身は作り直される
set -euo pipefail

image="${1:?イメージを指定してください}"
database_url="${2:?DATABASE_URL を指定してください}"
root="$(cd "$(dirname "$0")/.." && pwd)"
port="${CHECK_CONTAINER_PORT:-18080}"
web_name="mbta-live-check-web-$$"

run() {
  docker run --rm --network host -e DATABASE_URL="$database_url" "$@"
}

cleanup() {
  docker rm -f "$web_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== migrate"
run "$image" node migrate/node_modules/prisma/build/index.js migrate deploy --config migrate/prisma.config.ts

# フィクスチャはイメージに入れていないので、読み取り専用でマウントする
fixtures=(-e MBTA_FIXTURE_MODE=1 -v "$root/tests/fixtures/mbta:/app/tests/fixtures/mbta:ro")

echo "== sync-static（フィクスチャ）"
run "${fixtures[@]}" "$image" node jobs/sync-static.mjs

echo "== collector（フィクスチャ）"
run "${fixtures[@]}" "$image" node jobs/collect.mjs

echo "== web"
docker run -d --name "$web_name" --network host \
  -e DATABASE_URL="$database_url" -e PORT="$port" "$image" >/dev/null

status=""
for _ in $(seq 1 30); do
  status="$(curl -s -o /tmp/check-container-health.json -w '%{http_code}' "http://localhost:$port/api/health" || true)"
  [ "$status" = "200" ] && break
  sleep 1
done
if [ "$status" != "200" ]; then
  echo "/api/health が 200 を返しませんでした（最後の応答: ${status:-なし}）" >&2
  docker logs "$web_name" >&2 || true
  exit 1
fi
cat /tmp/check-container-health.json
echo
echo "コンテナの起動確認に成功しました"
