import React from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '本部運営管理コンソール',
  description:
    '第5回めんたいこ杯争奪弓道大会 本部運営管理・進行制御・名簿管理コンソール',
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
