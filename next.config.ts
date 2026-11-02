import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run でイメージを小さくするため、必要なファイルだけを .next/standalone に出す
  output: "standalone",
};

export default nextConfig;
