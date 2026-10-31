/**
 * 【運営本部・管理者ログインページ】
 * /admin/login パスに対応するページコンポーネント。
 *
 * 役割:
 * - メールアドレスおよびパスワードによる運営端末認証。
 * - ログイン完了後の `/admin` ダッシュボードへの自動遷移。
 *
 * フールプルーフ設計（操作ミス・不正入力の入口遮断）:
 * - 単なる認証済みではなく、確実に「管理者権限 (isAdmin)」を持つ場合のみ /admin へ自動遷移させ、無限ループを防止。
 * - 【修正】ブラウザのパスワードマネージャー警告解消のため autoComplete 属性を明示。
 * - 必須項目（メールアドレス、パスワード）の未入力時における送信ブロック。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - 通信切断や認証例外の捕捉と、操作者への分かりやすい日本語エラー通知。
 */

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loginWithEmailPassword, subscribeAdminSession } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  ShieldCheck,
  Lock,
  Mail,
  AlertCircle,
  Loader2,
  ArrowRight,
  Target,
} from 'lucide-react';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);

  // 既に管理者としてログイン済みの場合は /admin へ自動遷移
  useEffect(() => {
    const unsubscribe = subscribeAdminSession((status) => {
      if (!status.isLoading) {
        if (status.isAuthenticated && status.isAdmin) {
          router.replace('/admin');
        } else {
          setIsCheckingSession(false);
          // 管理者権限がないのにログインしている状態（一般参加者セッションなど）の場合のエラー表示
          if (status.isAuthenticated && !status.isAdmin) {
            setErrorMessage('このアカウントには管理者権限がありません。');
          }
        }
      }
    });

    return () => unsubscribe();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      setErrorMessage('メールアドレスとパスワードを入力してください。');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      await loginWithEmailPassword(email, password);
      // loginWithEmailPassword 成功後、subscribeAdminSession が isAdmin を再評価し、
      // 権限があれば自動的に /admin へ遷移します。ここでは明示的な router.replace はしません。
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'ログインに失敗しました。';
      setErrorMessage(message);
      setIsSubmitting(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-slate-400">
        <Loader2 className="w-8 h-8 animate-spin text-amber-500 mb-2" />
        <span className="text-xs font-mono">セッション確認中...</span>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 md:p-8">
      {/* 上部ヘッダー */}
      <header className="max-w-md w-full mx-auto flex items-center justify-between py-4 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-slate-900 border border-slate-800 text-white rounded-xl">
            <Target className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-500 block uppercase tracking-wider">
              Kyudo Administration
            </span>
            <h1 className="text-sm font-black text-white">
              第5回めんたいこ杯争奪弓道大会
            </h1>
          </div>
        </div>
      </header>

      {/* ログインフォームカード */}
      <div className="max-w-md w-full mx-auto my-8">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 md:p-8 shadow-2xl space-y-6">
          <div className="space-y-1.5 text-center">
            <div className="inline-flex p-3 rounded-full bg-slate-950 border border-slate-800 text-amber-400 mb-2">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-black text-white tracking-tight">
              運営本部 認証ログイン
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              大会管理コンソールへアクセスするには運営用アカウントでログインしてください。
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* メールアドレス入力 */}
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-300">
                運営用ID (メールアドレス)
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  disabled={isSubmitting}
                  autoComplete="username"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setErrorMessage('');
                  }}
                  placeholder="admin@mentaikotrophy-hq.com"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-medium outline-none focus:border-amber-500 transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            {/* パスワード入力 */}
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-300">
                パスワード
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  disabled={isSubmitting}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrorMessage('');
                  }}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-medium outline-none focus:border-amber-500 transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            {/* エラー表示 */}
            {errorMessage && (
              <div className="p-3 bg-red-950/50 border border-red-800/80 rounded-xl text-xs text-red-300 font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* ログインボタン */}
            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-11 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs shadow-md active:scale-98 transition-transform disabled:opacity-40"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  認証処理中...
                </>
              ) : (
                <>
                  <span>ログインしてコンソールへ</span>
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </>
              )}
            </Button>
          </form>
        </div>
      </div>

      {/* フッター */}
      <footer className="max-w-md w-full mx-auto text-center py-4 border-t border-slate-800/80 text-[11px] text-slate-500">
        © 2026 めんたいこ杯弓道大会 運営委員会 All Rights Reserved.
      </footer>
    </main>
  );
}
