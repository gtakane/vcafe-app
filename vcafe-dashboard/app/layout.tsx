import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vあっと Analytics",
  description: "メイド実績とユーザー分析の統合ダッシュボード",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
