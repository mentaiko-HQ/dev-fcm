/**
 * 【管理画面共通 認証ガード・フルブリードレイアウト】
 * /admin 配下の全ルートに適用。
 *
 * 役割:
 * - デスクトップPC・ノートPC・タブレット操作に特化し、画面横幅100%（フルブリード）でコンテンツを展開。
 * - /admin/login 以外のすべての管理ページに対して、認証済みセッションを検証。
 * - 未ログイン端末を検知した場合、即座に /admin/login へ安全にリダイレクト。
 *
 * フールプルーフ設計（未認証実行の入口遮断）:
 * - 認証検証中（session.isLoading）は全画面スピナーを表示し、非認証状態での画面チラつき・不正アクセスを防止。
 * - 未認証状態ではレンダリングを遮断（return null）。
 * - /admin/login 自身は除外（isLoginPage判定）し、リダイレクト無限ループを防止。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - 認証監視例外発生時も安全側に倒してログイン画面へ誘導。
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { subscribeAdminSession, SessionStatus } from '@/lib/auth';
import { AdminAuthStatusBadge } from '@/components/admin/AdminAuthStatusBadge';
import { Loader2 } from 'lucide-react';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [session, setSession] = useState<SessionStatus>({
    isAuthenticated: false,
    uid: null,
    email: null,
    isLoading: true,
    errorMessage: null,
  });

  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    const unsubscribe = subscribeAdminSession((status) => {
      setSession(status);

      // フールプルーフ: ログインページ以外で未認証が確定した時点で即時リダイレクト
      if (!status.isLoading && !status.isAuthenticated && !isLoginPage) {
        router.replace('/admin/login');
      }
    });

    return () => unsubscribe();
  }, [router, isLoginPage]);

  // ログインページ自身は認証ガードをバイパス
  if (isLoginPage) {
    return <>{children}</>;
  }

  // 認証検証中の待機画面
  if (session.isLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4 text-slate-500 w-full">
        <Loader2 className="w-8 h-8 animate-spin text-slate-900 mb-3" />
        <p className="text-xs font-mono font-bold text-slate-700">
          運営認証セッションを確認しています...
        </p>
      </div>
    );
  }

  // 未認証状態（リダイレクト完了までの安全側遮断）
  if (!session.isAuthenticated) {
    return null;
  }

  // 認証済み運営画面表示（全画面幅100%展開）
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col w-full">
      {/* 運営端末グローバルステータスバー（全幅展開） */}
      <div className="w-full bg-white/95 backdrop-blur border-b border-slate-200/80 px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between text-xs sticky top-0 z-40 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="font-bold text-slate-800 text-xs tracking-tight">
            第5回めんたいこ杯 本部運営管理コンソール
          </span>
        </div>
        <AdminAuthStatusBadge />
      </div>

      {/* 管理画面メインコンテンツ領域（全幅展開） */}
      <div className="flex-1 w-full">{children}</div>
    </div>
  );
}
