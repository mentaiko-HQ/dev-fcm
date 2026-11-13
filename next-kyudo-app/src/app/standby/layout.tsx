import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    absolute: '招集通知・待機確認 | ５め杯',
  },
  description:
    '第5回めんたいこ杯争奪弓道大会 選手用Webプッシュ招集通知設定・リアルタイム待機状況確認ページ',
};

export default function StandbyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
