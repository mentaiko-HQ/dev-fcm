import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '弓道大会運営システム',
  description: 'リアルタイムスコア記録・進行管理・招集通知アプリケーション',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
