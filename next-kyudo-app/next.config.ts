/**
 * 【Next.js アプリケーション構成設定ファイル】
 *
 * 役割:
 * - Next.js 15 (App Router) のビルド・実行動作の制御。
 * - セキュリティヘッダーの付与によるクリックジャッキング・MIMEスニッフィング防御。
 * - React Strict Mode による非推奨API・副作用の検知。
 *
 * フールプルーフ設計（操作ミス・環境差異の入口遮断）:
 * - Next.js 15 のスキーマに存在しないルート直下の `turbopack` キーを排除し、ビルド警告を未然に防止。
 * - TypeScript の型定義（NextConfig）に準拠した厳格なプロパティ構成。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - `X-Frame-Options` を `SAMEORIGIN` に設定し、外部からの不正フレーム埋め込みを防ぎつつ、
 *   同一ドメイン内での印刷プレビュー・帳票表示の描画ブロックを回避。
 * - `X-Content-Type-Options: nosniff` によりブラウザによるMIMEタイプの誤認実行を防止。
 * - `Referrer-Policy: strict-origin-when-cross-origin` により外部送信時の機密URL漏洩を抑止。
 */

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
            value: 'SAMEORIGIN',
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
