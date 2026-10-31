/**
 * 【エントリー参加選手データ修正コンソール用レイアウト】
 * 役割:
 * - /admin/participants パス配下のページに対して、固有のメタデータ（ブラウザのタブタイトル）を設定する。
 *
 * フールプルーフ設計:
 * - 確実な反映のため absolute 指定を用いて親の template を上書きする。
 */
import { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: {
    absolute: 'エントリー参加選手データ修正コンソール | ５め杯',
  },
};

export default function AdminParticipantsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
