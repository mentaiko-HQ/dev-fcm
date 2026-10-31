/**
 * 【エントリーページ専用レイアウト】
 * 役割:
 * - /entry パス配下のページに対して、固有のメタデータ（ブラウザのタブタイトル）を設定する。
 */
import { Metadata } from 'next';
import React from 'react';

// ブラウザタブに表示されるタイトルを指定
// ※ルートの template と合わさり「参加エントリーフォーム | ５め杯」と表示されます。
export const metadata: Metadata = {
  title: '参加エントリーフォーム',
};

export default function EntryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
