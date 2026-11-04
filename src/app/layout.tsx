import type { ReactNode } from "react";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { Providers } from "@/components/layout/providers";
import "./globals.css";

export const metadata = {
  title: "MBTA Live",
  description: "Real-time monitoring and analytics for MBTA rapid transit",
};

// 環境バッジ（APP_ENV）を実行時の環境変数から読むため、ビルド時に静的化しない（憲章: イメージは 1 つ）
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  const appEnv = process.env.APP_ENV ?? "local";
  return (
    <html lang="en">
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
