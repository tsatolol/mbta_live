import type { ReactNode } from "react";

export const metadata = {
  title: "MBTA Live",
  description: "Real-time monitoring and analytics for MBTA rapid transit",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer>Data provided by MBTA</footer>
      </body>
    </html>
  );
}
