/**
 * 【エントリーページ専用レイアウト】
 * 役割:
 * - /entry パス配下のページに対して、固有のメタデータ（ブラウザのタブタイトル）を設定する。
 *
 * フールプルーフ設計:
 * - 【修正】親レイアウトの template 継承への依存を断ち切り、absolute (絶対指定) を用いて
 *   キャッシュやビルド状態に関わらず確実に指定した文字列をタブに表示させる。
 */
import { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: {
    // absolute を指定することで、親の template ('%s | ５め杯') を無視してこの文字列を完全適用します
    absolute: '参加エントリーフォーム | ５め杯',
  },
};

export default function EntryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
