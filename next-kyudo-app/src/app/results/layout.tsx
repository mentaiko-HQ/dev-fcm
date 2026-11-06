/**
 * 【成績速報専用レイアウト・メタデータ管理】
 * /results 配下に適用されるレイアウトファイル。
 *
 * 役割:
 * - ブラウザのタブ（ページタイトル）に「ステージ別 立ち順・リアルタイム成績一覧 | ５め杯」を明示的に設定する。
 * - UIのレイアウト構造は変更せず、子コンポーネント（page.tsx）をそのままレンダリングする。
 *
 * フールプルーフ設計:
 * - metadata.title.absolute を使用することで、ルートレイアウトのタイトルテンプレートの
 *   意図しない二重適用を防ぎ、指定した文字列を確実に出力させる。
 */

import { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: {
    absolute: 'ステージ別 立ち順・リアルタイム成績一覧 | ５め杯',
  },
  description:
    '第5回めんたいこ杯争奪弓道大会 ステージ別成績および総合成績のリアルタイム速報',
};

export default function ResultsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
