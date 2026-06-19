import type { Metadata, Viewport } from "next";
import { Martian_Mono, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

// Martian Mono — IDs, labels, timestamps, counts (the telemetry voice).
const mono = Martian_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

// Hanken Grotesk — ticket subjects + descriptions (the one place we drop mono).
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "agent-kanban",
  description:
    "Black-box telemetry console for live agent / 3-role pipeline work — glanceable from a phone.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximumScale/userScalable lock — users must be able to pinch-zoom (a11y).
  themeColor: "#0a0e12",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${mono.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
