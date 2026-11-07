/**
 * 【選手用 招集通知登録・待機状況確認ページ レイアウト・メタデータ管理】
 * /standby 配下に適用されるレイアウトファイル。
 */

import { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: {
    absolute: '選手用 招集通知登録・進行確認 | ５め杯',
  },
  description:
    '第5回めんたいこ杯争奪弓道大会 参加選手向け招集プッシュ通知登録およびリアルタイム進行確認ページ',
};

export default function StandbyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
