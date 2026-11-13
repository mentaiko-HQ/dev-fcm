import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    absolute: 'リアルタイム成績速報・立順 | ５め杯',
  },
  description:
    '第5回めんたいこ杯争奪弓道大会 ステージ別立ち順およびリアルタイム成績速報',
};

export default function ResultsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
