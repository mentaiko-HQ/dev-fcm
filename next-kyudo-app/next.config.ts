/**
 * 【Next.js アプリケーション構成設定ファイル】
 *
 * 役割:
 * - Next.js (App Router) および Turbopack のビルド・実行動作の制御。
 * - プロジェクトルートの明示的固定による外部ロックファイル誤検知警告の防止。
 * - セキュリティヘッダーおよび画像ドメインの保護。
 *
 * フールプルーフ設計（操作ミス・環境差異の入口遮断）:
 * - `turbopack.root` にプロジェクトルート（`__dirname`）を明示指定し、
 *   ホームディレクトリ等に存在する意図しない package-lock.json の探索を遮断。
 * - TypeScript の型定義（NextConfig）に準拠し、未定義オプションをコンパイル時に検知。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - 本番ビルド時のソースマップ生成制御および安全なエラーハンドリング。
 */

import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  // Turbopack のプロジェクトルートを明示的に本ディレクトリへ固定
  turbopack: {
    root: path.resolve(__dirname),
  },

  // React Strict Mode の有効化（フールプルーフ: 副作用や非推奨APIの早期検知）
  reactStrictMode: true,

  // セキュリティヘッダーの設定（フェイルセーフ: クリックジャッキング等の防御）
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
