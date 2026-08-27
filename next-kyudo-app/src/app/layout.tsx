import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "弓道大会運営システム",
  description: "弓道大会のリアルタイムスコア入力・進行管理・招集通知システム",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-slate-50 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}