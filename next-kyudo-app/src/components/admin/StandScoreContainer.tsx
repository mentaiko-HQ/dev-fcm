"use client";

import React, { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { StandMatchScore, PlayerScore, HitResult } from "@/types";
import { ScoreButton } from "./ScoreButton";

// サンプル初期データ（Firestore未接続時のフォールバック用）
const DEFAULT_MATCH_SCORE: StandMatchScore = {
  matchId: "match_2026_001",
  standNumber: 1,
  teamId: "team_01",
  teamName: "福岡弓道倶楽部A",
  format: {
    id: "fmt_4arrows",
    name: "四矢団体戦",
    arrowCount: "四矢",
    totalArrowsPerPerson: 4,
    isTeamMatch: true,
    playersPerTeam: 3,
    tieBreaker: "射詰",
  },
  playerScores: {
    p1: { playerId: "p1", playerName: "佐藤 健一", position: "大前", arrows: [], totalHits: 0, isCompleted: false, updatedAt: 0 },
    p2: { playerId: "p2", playerName: "鈴木 隆", position: "中", arrows: [], totalHits: 0, isCompleted: false, updatedAt: 0 },
    p3: { playerId: "p3", playerName: "高橋 誠", position: "落", arrows: [], totalHits: 0, isCompleted: false, updatedAt: 0 },
  },
  totalTeamHits: 0,
  updatedAt: Date.now(),
};

export function StandScoreContainer() {
  const [matchScore, setMatchScore] = useState<StandMatchScore>(DEFAULT_MATCH_SCORE);
  const [isConnected, setIsConnected] = useState<boolean>(false);

  useEffect(() => {
    const scoreDocRef = doc(db, "scores", `${matchScore.matchId}_stand_${matchScore.standNumber}`);

    // Firestoreのリアルタイムリスナーを購読
    const unsubscribe = onSnapshot(
      scoreDocRef,
      (snapshot) => {
        setIsConnected(true);
        if (snapshot.exists()) {
          const data = snapshot.data() as StandMatchScore;
          setMatchScore(data);
        }
      },
      (error) => {
        // フェイルセーフ: 接続断時もエラーログを出力しローカル状態を維持
        console.error("【エラーログ】Firestoreスコア購読中にエラーが発生しました:", error);
        setIsConnected(false);
      }
    );

    return () => unsubscribe();
  }, [matchScore.matchId, matchScore.standNumber]);

  // フールプルーフ: チーム全体の総的中数を型安全に算出
  const totalTeamHits: number = Object.values(matchScore.playerScores).reduce<number>(
    (acc: number, p: PlayerScore) =>
      acc + (p.arrows?.reduce<number>((sum: number, v: HitResult) => sum + v, 0) || 0),
    0
  );

  return (
    <div className="w-full bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
      {/* 立情報ヘッダー */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-3 rounded-md border border-slate-200 gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900 text-base">第 {matchScore.standNumber} 立</span>
            <span className="text-xs bg-slate-900 text-white px-2 py-0.5 rounded font-medium">
              {matchScore.teamName}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            形式: {matchScore.format.name} ({matchScore.format.totalArrowsPerPerson}射 / 競射: {matchScore.format.tieBreaker})
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-xs text-slate-500 block leading-none">チーム総的中</span>
            <span className="text-xl font-black text-red-600">{totalTeamHits}</span>
            <span className="text-xs text-slate-400"> / {matchScore.format.totalArrowsPerPerson * matchScore.format.playersPerTeam}</span>
          </div>
          <div className={`w-2.5 h-2.5 rounded-full ${isConnected ? "bg-green-500" : "bg-amber-400"}`} title={isConnected ? "同期中" : "ローカル動作中"} />
        </div>
      </div>

      {/* 各選手のスコア入力カード一覧 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Object.values(matchScore.playerScores).map((player) => (
          <ScoreButton
            key={player.playerId}
            matchId={matchScore.matchId}
            standNumber={matchScore.standNumber}
            player={player}
            maxArrows={matchScore.format.totalArrowsPerPerson}
          />
        ))}
      </div>
    </div>
  );
}