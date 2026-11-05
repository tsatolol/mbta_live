import type { ReactNode } from "react";
import localFont from "next/font/local";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { Providers } from "@/components/layout/providers";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// 書体: Overpass の可変フォント（005 research.md の「書体」）。npm のパッケージの latin のファイルを自前で配信する
// （ビルドでも閲覧でも外部に通信しない。FR-013）。next/font が preload と、代わりの書体の寸法の調整をする
const overpass = localFont({
  src: "../../node_modules/@fontsource-variable/overpass/files/overpass-latin-wght-normal.woff2",
  weight: "100 900",
  style: "normal",
  display: "swap",
  variable: "--font-overpass",
  adjustFontFallback: "Arial",
});

export const metadata = {
  title: "MBTA Live",
  description: "Real-time monitoring and analytics for MBTA rapid transit",
};

// 環境バッジ（APP_ENV）を実行時の環境変数から読むため、ビルド時に静的化しない（憲章: イメージは 1 つ）
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  const appEnv = process.env.APP_ENV ?? "local";
  return (
    // data-theme は THEME_INIT_SCRIPT が描画の前に付けるので、サーバーの HTML と属性が違ってよい
    <html lang="en" className={overpass.variable} suppressHydrationWarning>
      <head>
        {/* 表示の明るさの選択を、最初の描画の前に当てる（違う表示が一瞬出るのを防ぐ。FR-014） */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <Providers>
          <Header appEnv={appEnv} />
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
