import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARENIX",
  description: "A multiplayer pixel-art fantasy game of missions, alliances and betrayal.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f1630" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
