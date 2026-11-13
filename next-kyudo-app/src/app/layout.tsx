/**
 * 【ルートレイアウト（Vercel Web Analytics 統合・TS2307型解決対応版）】
 *
 * 役割:
 * - 全画面共通のWebフォント、言語属性、メタデータを提供。
 * - 管理画面（/admin配下）のデスクトップ・タブレット向けフルブリード（全幅）表示を阻害しないよう、
 *   最外殻での幅固定（max-w-7xlなど）を廃止し、幅100%（w-full）のコンテナとして子ページへ委譲。
 * - `@vercel/analytics/react` の <Analytics /> を組み込み、/guidelines を含む全ページのアクセス状況を計測。
 *
 * フールプルーフ設計:
 * - グローバルなメタデータ（タブタイトル等）を一元管理し、子ページでタイトルが指定されていない場合のデフォルト値（５め杯【選手ポータル】）や、
 *   共通のサフィックス（「 | ５め杯」）のテンプレートを定義。
 * - tsconfig.json の moduleResolution 設定に左右されず確実に型解決される `@vercel/analytics/react` エントリポイントを使用。
 *
 * フェイルセーフ設計:
 * - 日本語フォント最適化読み込み（システムフォントへの安全なフォールバック）。
 * - フレックスボックス構成により、コンテンツ量に関わらず最低画面高（min-h-screen）を維持し、レイアウト崩壊を防止。
 */

import React from 'react';
import type { Metadata, Viewport } from 'next';
import { Noto_Sans_JP } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';
import './globals.css';

// 日本語フォント最適化読み込み（フェイルセーフ: システムフォントへの安全なフォールバック）
const notoSansJP = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-noto-sans-jp',
});

// ------------------------------------------------------------------
// グローバルメタデータ設定（テンプレート機能を使用）
// ------------------------------------------------------------------
export const metadata: Metadata = {
  title: {
    // 子ページ（/standbyなど）でタイトルが指定されなかった場合のデフォルトタイトル
    default: '５め杯【選手ポータル】',
    // 子ページで個別にタイトルが指定された場合のフォーマット
    // 例: title: '運営コンソール' の場合 → "運営コンソール | ５め杯" になる
    template: '%s | ５め杯',
  },
  description:
    '第5回めんたいこ杯争奪弓道大会のリアルタイム進行管理・的中記録・招集通知アプリケーション',
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

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ja" suppressHydrationWarning className={notoSansJP.variable}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased selection:bg-primary selection:text-primary-foreground">
        <div className="relative flex min-h-screen flex-col w-full">
          <main className="flex-1 w-full">{children}</main>
          <footer className="w-full border-t border-border py-3 text-center text-xs text-muted-foreground bg-white">
            <p>
              &copy; {new Date().getFullYear()} 第5回めんたいこ杯 運営委員会 All
              rights reserved.
            </p>
          </footer>
        </div>
        {/* Vercel Web Analytics: /guidelines 等を含む全ページのアクセス解析 */}
        <Analytics />
      </body>
    </html>
  );
}
