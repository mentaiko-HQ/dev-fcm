/**
 * 【運営端末 認証ステータス・ログアウトバッジ】
 *
 * 役割:
 * - 白基調レイアウトに調和する視認性の高いステータスバッジ（エメラルド背景 / 淡色ボーダー）。
 * - ログイン中の管理者メールアドレスの表示およびワンクリックログアウト機能。
 *
 * フールプルーフ設計:
 * - ログアウト処理中の多重クリック防止（isLoggingOut によるボタン非活性化）。
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { subscribeAdminSession, logoutAdmin, SessionStatus } from '@/lib/auth';
import { ShieldCheck, ShieldAlert, LogOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function AdminAuthStatusBadge() {
  const router = useRouter();
  const [session, setSession] = useState<SessionStatus>({
    isAuthenticated: false,
    uid: null,
    email: null,
    isAdmin: false, // 型定義に合わせて isAdmin を追加
    isLoading: true,
    errorMessage: null,
  });
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = subscribeAdminSession((status) => {
      setSession(status);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logoutAdmin();
      router.replace('/admin/login');
    } catch (err) {
      console.error('【ログアウトエラー】:', err);
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (session.isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 border border-slate-200 text-[11px] font-mono text-slate-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-700" />
        <span>確認中...</span>
      </div>
    );
  }

  if (session.isAuthenticated) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] font-mono text-emerald-800">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span className="font-bold">運営認証済</span>
          <span className="text-[10px] text-emerald-700/80 hidden sm:inline">
            ({session.email})
          </span>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isLoggingOut}
          onClick={handleLogout}
          className="h-7 px-2 text-[10px] bg-white border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
          title="ログアウト"
        >
          {isLoggingOut ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <>
              <LogOut className="w-3 h-3 mr-1 text-slate-500" />
              ログアウト
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-50 border border-red-200 text-[11px] font-mono text-red-800">
      <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
      <span className="font-bold">未ログイン</span>
    </div>
  );
}
