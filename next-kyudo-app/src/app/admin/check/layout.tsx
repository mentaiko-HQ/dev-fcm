/**
 * 【入金・立順・QR管理ページ専用レイアウト】
 * 役割:
 * - /admin/check パス配下のページに対して、固有のメタデータ（ブラウザのタブタイトル）を設定する。
 *
 * フールプルーフ設計:
 * - 確実な反映のため absolute 指定を用いて親の template を上書きする。
 */
import { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: {
    absolute: '入金確認・立順編成・QR発行 | ５め杯',
  },
};

export default function AdminCheckLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
