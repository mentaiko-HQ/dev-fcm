/**
 * 【競技記録員用 スコア入力コンソール 専用レイアウト（ブラウザタブタイトル固定）】
 * /admin/input パスに対応するサーバーコンポーネントレイアウト。
 *
 * 役割:
 * - ブラウザのタブ表示（title）を「競技記録員用 スコア入力コンソール | ５め杯」に厳密に固定する。
 *
 * フールプルーフ設計:
 * - Next.js Metadata API の `title.absolute` を使用し、親レイアウトのテンプレート干渉を防いで指定文字列を確実に表示。
 */

import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    absolute: '競技記録員用 スコア入力コンソール | ５め杯',
  },
  description:
    '第5回めんたいこ杯争奪弓道大会 競技記録員専用のステージ別成績入力コンソール（午前一手・午後一手・午後四矢）',
};

export default function AdminScoreInputLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
