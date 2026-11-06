/**
 * 【受付コンソール専用レイアウト・メタデータ管理】
 * /admin/reception 配下に適用されるレイアウトファイル。
 *
 * 役割:
 * - ブラウザのタブ（ページタイトル）に「受付バーコード / QRリーダーコンソール | ５め杯」を明示的に設定する。
 * - UIのレイアウト構造は変更せず、子コンポーネント（page.tsx）をそのままレンダリングする。
 *
 * フールプルーフ設計:
 * - metadata.title.absolute を使用することで、ルートレイアウトのタイトルテンプレート（%s | 5め杯 等）の
 *   意図しない二重適用を防ぎ、指定した文字列を確実に出力させる。
 */

import { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: {
    absolute: '受付バーコード / QRリーダーコンソール | ５め杯',
  },
  description: '第5回めんたいこ杯争奪弓道大会 当日入場受付コンソール',
};

export default function ReceptionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
