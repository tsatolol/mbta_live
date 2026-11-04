// MapLibre GL JS の Web Worker のファイルを public/vendor/ にコピーする（pnpm build / pnpm dev の前に実行する）。
// MapLibre は自分のファイルの場所（import.meta.url）から Worker を探すが、Next.js（Turbopack）でまとめると
// その場所が変わって読み込めない（「Worker failed to load」）。そこで Worker を固定の URL で配り、
// 地図のコンポーネントで setWorkerUrl() を呼ぶ（specs/002-live-dashboard/research.md）
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("maplibre-gl/package.json", { paths: [root] }));
const outDir = path.join(root, "public/vendor");
mkdirSync(outDir, { recursive: true });
copyFileSync(
  path.join(pkgDir, "dist/maplibre-gl-worker.mjs"),
  path.join(outDir, "maplibre-gl-worker.mjs"),
);
