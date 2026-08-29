"use client";

import React, { useEffect, useState } from "react";
import { collection, onSnapshot, query, doc } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import { TournamentConfig } from "@/types";
import { TeamSelectForm } from "@/components/shared/TeamSelectForm";
import { ParticipantDataTable } from "@/components/admin/ParticipantDataTable";
import { StandScoreContainer } from "@/components/admin/StandScoreContainer";
import { MatchConfigWizard } from "@/components/admin/MatchConfigWizard";
import { MatchControlPanel } from "@/components/admin/MatchControlPanel";
import { TieBreakerRankPanel } from "@/components/admin/TieBreakerRankPanel";
import { AwardSummaryCard } from "@/components/admin/AwardSummaryCard";
import { setupForegroundMessageListener, playNotificationSound, triggerDeviceVibration } from "@/lib/fcm";
import { Bell, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  matchId: "match_2026_001",
  title: "第4回 福岡県弓道選手権大会",
  targetCount: 6,
  matchType: "HYBRID",
  playersPerTeam: 3,
  preliminaryArrowCount: "四矢",
  preliminaryStands: 4,
  finalArrowCount: "四矢",
  finalStands: 2,
  tieBreakerFormat: "射詰",
  status: "IN_PROGRESS",
  currentStandNumber: 1,
  maxStandNumber: 6,
};

export default function HomePage() {
  const [tournamentConfig, setTournamentConfig] = useState<TournamentConfig>(DEFAULT_TOURNAMENT_CONFIG);
  const [bannerNotification, setBannerNotification] = useState<{ title: string; body: string } | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);

  // 1. matches ドキュメントより大会設定を購読（フェイルセーフ）
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    const matchDocRef = doc(firestoreInstance, "matches", tournamentConfig.matchId);

    const unsubscribe = onSnapshot(matchDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Partial<TournamentConfig>;
        setTournamentConfig((prev) => ({
          ...prev,
          ...data,
          title: data.title || prev.title,
          targetCount: data.targetCount || prev.targetCount,
          preliminaryStands: data.preliminaryStands || prev.preliminaryStands,
          finalStands: data.finalStands || prev.finalStands,
        }));
      }
    });

    return () => unsubscribe();
  }, [tournamentConfig.matchId]);

  // 2. entries コレクションより選手データを購読
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    const entriesQuery = query(collection(firestoreInstance, "entries"));

    const unsubscribe = onSnapshot(entriesQuery, (snapshot) => {
      if (!snapshot.empty) {
        const loaded: Participant[] = [];
        snapshot.forEach((docSnap) => {
          const raw = docSnap.data();
          loaded.push({
            id: docSnap.id,
            standNumber: Number(raw.standNumber) || 1,
            position: raw.position || "大前",
            entryType: raw.entryType || "TEAM",
            progressStatus: raw.progressStatus || "WAITING",
            qualificationStatus: raw.qualificationStatus || "ACTIVE",
            teamId: raw.teamId || null,
            teamName: raw.teamName || (raw.entryType === "INDIVIDUAL" ? "個人枠" : "所属未設定"),
            playerName: raw.playerName || "選手名未設定",
            division: raw.division || "一般男子",
            totalHits: Number(raw.totalHits) || 0,
            totalShots: Number(raw.totalShots) || 0,
            isPerfect: Boolean(raw.isPerfect),
            enkinRank: typeof raw.enkinRank === "number" ? raw.enkinRank : null,
            finalRank: typeof raw.finalRank === "number" ? raw.finalRank : null,
          });
        });
        setParticipants(loaded);
      }
    });

    return () => unsubscribe();
  }, []);

  // 3. フォアグラウンドFCM通知リスナー（音・振動連動）
  useEffect(() => {
    const unsubscribe = setupForegroundMessageListener((payload) => {
      if (payload.notification) {
        setBannerNotification({
          title: payload.notification.title || "【招集通知】",
          body: payload.notification.body || "出番が近づいています。控席へ入場してください。",
        });
      }
    });

    return () => unsubscribe();
  }, []);

  const handleTestSoundAndVibe = () => {
    playNotificationSound();
    triggerDeviceVibration([300, 100, 300, 100, 300]);
  };

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8 flex flex-col items-center gap-6">
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
          <h1 className="text-xl font-bold text-slate-900">{tournamentConfig.title}</h1>
          <p className="text-xs text-slate-500">弓道大会リアルタイム運営・スコア入力・FCM招集管理</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleTestSoundAndVibe}
            className="text-xs font-semibold h-8 border-slate-300"
          >
            <Volume2 className="w-3.5 h-3.5 mr-1" />
            通知音・振動テスト
          </Button>
          <span className="text-xs bg-slate-200 text-slate-700 px-2.5 py-1 rounded font-medium">2026年公式ルール準拠</span>
        </div>
      </header>

      {/* 試合形式・大会初期設定ウィザード */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">大会形式設定</h2>
        <MatchConfigWizard
          currentConfig={tournamentConfig}
          onConfigUpdated={(cfg) => setTournamentConfig(cfg)}
        />
      </section>

      {/* 表彰・成績サマリーカード */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <AwardSummaryCard participants={participants} />
      </section>

      {/* 進行制御パネル */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">本部進行管理 / 呼出通知トリガー</h2>
        <MatchControlPanel matchId={tournamentConfig.matchId} />
      </section>

      {/* 競技記録員用 スコア入力コンソール（予選 / 決勝タブ分離） */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">競技記録員用 スコア入力コンソール</h2>
        <StandScoreContainer tournamentConfig={tournamentConfig} />
      </section>

      {/* 遠近判定・順位確定コントロールパネル */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">競射判定 / 順位確定</h2>
        <TieBreakerRankPanel matchId={tournamentConfig.matchId} />
      </section>

      {/* 参加者一覧・立順・進行状況テーブル */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">参加者一覧 / 進行状況</h2>
        <ParticipantDataTable />
      </section>

      {/* 選手・付添者用 招集通知設定 */}
      <section className="w-full max-w-5xl flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">選手・付添者用 招集通知設定</h2>
        <TeamSelectForm />
      </section>
    </main>
  );
}