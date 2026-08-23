"use client";

import React, { useEffect, useState } from "react";
import { TeamSelectForm } from "@/components/shared/TeamSelectForm";
import { ParticipantDataTable } from "@/components/admin/ParticipantDataTable";
import { StandScoreContainer } from "@/components/admin/StandScoreContainer";
import { MatchControlPanel } from "@/components/admin/MatchControlPanel";
import { setupForegroundMessageListener } from "@/lib/fcm";
import { Bell } from "lucide-react";

export default function HomePage() {
  const [bannerNotification, setBannerNotification] = useState<{ title: string; body: string } | null>(null);

  // フォアグラウンドでのFCM通知受信を監視
  useEffect(() => {
    const unsubscribe = setupForegroundMessageListener((payload) => {
      if (payload.notification) {
        setBannerNotification({
          title: payload.notification.title || "【招集通知】",
          body: payload.notification.body || "出番が近づいています。",
        });
      }
    });

    return () => unsubscribe();
  }, []);

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8 flex flex-col items-center gap-6">
      {/* フォアグラウンド受信時のトーストバナー */}
      {bannerNotification && (
        <div className="w-full max-w-5xl p-4 bg-amber-500 text-white rounded-lg shadow-lg flex items-center justify-between animate-bounce">
          <div className="flex items-center gap-3">
            <Bell className="w-6 h-6" />
            <div>
              <p className="font-bold text-sm">{bannerNotification.title}</p>
              <p className="text-xs">{bannerNotification.body}</p>
            </div>
          </div>
          <button
            onClick={() => setBannerNotification(null)}
            className="text-xs bg-white text-amber-900 px-3 py-1 rounded font-bold hover:bg-amber-50"
          >
            閉じる
          </button>
        </div>
      )}

      <header className="w-full max-w-5xl pb-4 border-b border-slate-300 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-slate-900">弓道大会運営システム</h1>
          <p className="text-xs text-slate-500">リアルタイム進行・スコア管理コンソール</p>
        </div>
        <span className="text-xs bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-medium">2026年公式ルール準拠</span>
      </header>

      {/* 進行制御パネル（Cloud Functions FCMトリガー連携） */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">本部進行管理 / 呼出通知トリガー</h2>
        <MatchControlPanel matchId="match_2026_001" />
      </section>

      {/* 競技記録員用 リアルタイムスコア入力コンソール */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">競技記録員用 スコア入力コンソール</h2>
        <StandScoreContainer />
      </section>

      {/* 参加者一覧・立順・進行状況テーブル */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">参加者一覧 / 進行状況</h2>
        <ParticipantDataTable />
      </section>

      {/* 選手・観客向け チーム選択 & 通知設定 */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">選手・付添者用 招集通知設定</h2>
        <TeamSelectForm />
      </section>
    </main>
  );
}