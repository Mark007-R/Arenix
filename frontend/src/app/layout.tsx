import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ARENIX",
  description: "A multiplayer social-deduction game: do your tasks, find the impostor, or be one.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ece6d6" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
