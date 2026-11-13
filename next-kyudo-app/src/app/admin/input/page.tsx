/**
 * 【競技記録員用 スコア入力コンソール 独立ページ】
 * /admin/input パスに対応するページコンポーネント。
 *
 * 役割:
 * - 従来 /admin 内の「5. 競技記録員用 スコア入力コンソール (ステージ別成績入力)」にあった StandScoreContainer を
 *   記録スタッフ専用ページ (/admin/input) として独立表示。
 * - Firestore の `matches/match_2026_mentaiko` ドキュメントをリアルタイム購読し、
 *   最新の組数設定（totalStandGroups 等）を StandScoreContainer へ安全に注入。
 * - ヘッダータイトルは不要な大会名プレフィックスを省き「競技記録員用 スコア入力コンソール」のみを端的に表示。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 競技記録員がスコア入力中に誤って「大会設定変更」「招集ボタン」「データリセット」等を操作してしまう事故を物理的に遮断。
 * - クライアントマウント時にも `document.title` を設定し、「競技記録員用 スコア入力コンソール | ５め杯」のタブ表示を二重保証。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - Firestore 未接続や通信遅延時でも DEFAULT_TOURNAMENT_CONFIG へフォールバックし、画面クラッシュを防止。
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  db,
  isFirebaseConfigured,
  isFirestoreAvailable,
  ensureAnonymousAuth,
} from '@/lib/firebase';
import { TournamentConfig } from '@/types';
import { StandScoreContainer } from '@/components/admin/StandScoreContainer';
import { AdminAuthStatusBadge } from '@/components/admin/AdminAuthStatusBadge';
import { Button } from '@/components/ui/button';
import {
  Target,
  ArrowLeft,
  ArrowRight,
  Trophy,
  AlertCircle,
} from 'lucide-react';

const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  matchId: 'match_2026_mentaiko',
  title: '第5回めんたいこ杯争奪弓道大会',
  date: '2027-01-24',
  venue: '福岡市総合体育館内 弓道場',
  totalStandGroups: 4,
};

export default function AdminScoreInputPage() {
  const router = useRouter();
  const [tournamentConfig, setTournamentConfig] = useState<TournamentConfig>(
    DEFAULT_TOURNAMENT_CONFIG,
  );
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // タブタイトルのクライアントサイド二重保証（フールプルーフ）
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.title = '競技記録員用 スコア入力コンソール | ５め杯';
    }
  }, []);

  // 初期匿名認証の確保（フェイルセーフ）
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;
    ensureAnonymousAuth().catch((err) => {
      console.warn('【AdminScoreInputPage】初期認証確認警告:', err);
    });
  }, []);

  // matches ドキュメントのリアルタイム購読（組数 totalStandGroups 等の同期用）
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const matchDocRef = doc(db, 'matches', tournamentConfig.matchId);
    const unsubscribe = onSnapshot(
      matchDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setTournamentConfig((prev: TournamentConfig) => ({
            ...prev,
            title: typeof data.title === 'string' ? data.title : prev.title,
            totalStandGroups:
              typeof data.totalStandGroups === 'number'
                ? data.totalStandGroups
                : prev.totalStandGroups,
          }));
        }
        setConnectionError(null);
      },
      (error) => {
        console.error(
          '【エラーログ】/admin/input matchesドキュメント購読失敗:',
          error,
        );
        setConnectionError(
          '大会設定データの同期中に通信エラーが発生しました。デフォルト設定で動作を継続します。',
        );
      },
    );

    return () => unsubscribe();
  }, [tournamentConfig.matchId]);

  return (
    <div className="w-full min-h-screen bg-[#F8FAFC] text-slate-900 p-4 sm:p-6 lg:p-8 space-y-6">
      {/* 記録員用コンソール 専用ヘッダー（大会名プレフィックスを排除しシンプルに表示） */}
      <header className="w-full bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold bg-slate-900 text-white px-3 py-1 rounded-full flex items-center gap-1.5 shadow-2xs">
              <Target className="w-3.5 h-3.5 text-amber-400" />
              競技記録員専用コンソール
            </span>
            <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-md">
              ステージ別成績入力
            </span>
            <AdminAuthStatusBadge />
          </div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 pt-1">
            競技記録員用 スコア入力コンソール
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            第1ステージ(午前・一手2射) / 第2ステージ(午後・一手2射) /
            第3ステージ(午後・四矢4射) の的中結果をリアルタイム記録します。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/admin')}
            className="text-xs h-9 bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-bold rounded-xl"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            本部運営管理へ戻る
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/results')}
            className="text-xs h-9 bg-white border-slate-200 text-slate-800 hover:bg-slate-50 font-bold rounded-xl"
          >
            <Trophy className="w-3.5 h-3.5 mr-1 text-amber-500" />
            成績速報
            <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </header>

      {/* 通信エラーバナー（フェイルセーフ） */}
      {connectionError && (
        <div className="w-full p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-950 text-xs font-bold flex items-center gap-2 shadow-2xs">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{connectionError}</span>
        </div>
      )}

      {/* メイン：ステージ別成績入力コンテナ */}
      <section className="w-full">
        <StandScoreContainer tournamentConfig={tournamentConfig} />
      </section>
    </div>
  );
}
