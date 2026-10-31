/**
 * 【要項ページ専用レイアウト】
 * 役割:
 * - /guidelines パス配下のページに対して、固有のメタデータ（タブのタイトル等）を設定する。
 */
import { Metadata } from 'next';
import React from 'react';

// ブラウザタブに表示されるタイトルを上書き
export const metadata: Metadata = {
  title: {
    absolute: '大会要項・参加同意事項 | ５め杯',
  },
};

export default function GuidelinesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
