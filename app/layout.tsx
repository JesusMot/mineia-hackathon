import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MineAI - Smart Idle Mining",
  description: "Mine manually or let AI Managers run your empire.",
  other: {
    "talentapp:project_verification":
      "e4173ac7380c608a5b49304daa8d80dcbea287c1abc77f885ae901db8a4f6e40ba2177b94d4e4bb128eda917f2d131ac8eb5c9145e4252211174b2d89d7fe062"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#090d12"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
