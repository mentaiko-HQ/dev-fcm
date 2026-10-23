import type { Metadata, Viewport } from 'next';
import { Noto_Sans_JP } from 'next/font/google';
import './globals.css';

// 日本語フォント最適化読み込み（フェイルセーフ: システムフォントへの安全なフォールバック）
const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-noto-sans-jp',
});

export const metadata: Metadata = {
  title: '弓道大会運営システム',
  description: 'リアルタイム進行管理・的中記録・招集通知Webアプリケーション',
  applicationName: 'Kyudo Tournament Manager',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#090d16' },
  ],
};

interface RootLayoutProps {
  children: React.ReactNode;
}

/**
 * 【ルートレイアウト】
 *
 * 役割:
 * - 全画面共通のWebフォント、言語属性、メタデータを提供。
 * - 管理画面（/admin配下）のデスクトップ・タブレット向けフルブリード（全幅）表示を阻害しないよう、
 *   最外殻での幅固定（max-w-7xlなど）を廃止し、幅100%（w-full）のコンテナとして子ページへ委譲。
 *
 * フェイルセーフ設計:
 * - フレックスボックス構成により、コンテンツ量に関わらず最低画面高（min-h-screen）を維持し、レイアウト崩壊を防止。
 */
export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ja" suppressHydrationWarning className={notoSansJP.variable}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased selection:bg-primary selection:text-primary-foreground">
        <div className="relative flex min-h-screen flex-col w-full">
          <main className="flex-1 w-full">{children}</main>
          <footer className="w-full border-t border-border py-3 text-center text-xs text-muted-foreground bg-white">
            <p>
              &copy; {new Date().getFullYear()} 弓道大会運営システム All rights
              reserved.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
