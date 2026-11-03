// ジョブ（collector / sync-static / aggregate）を、依存を含めた 1 ファイルずつにまとめる（pnpm build:jobs）。
// 実行イメージには node_modules を入れずに dist/jobs/*.mjs だけを置き、`node --conditions=react-server` なしで動かせる形にする。
// - conditions に react-server を指定し、server-only を空のモジュールとして取り込む
// - pg などが CommonJS の require を使うので、ESM の出力に require を用意する
import { build } from "esbuild";

await build({
  entryPoints: ["src/jobs/collect.ts", "src/jobs/sync-static.ts", "src/jobs/aggregate.ts"],
  outdir: "dist/jobs",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  conditions: ["react-server"],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "warning",
  logOverride: { "bundle-size": "silent" },
});
