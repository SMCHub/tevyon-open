import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tevyon Studio",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" data-theme="light">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Funnel+Display:wght@500..700&family=Inter+Tight:wght@400..600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
