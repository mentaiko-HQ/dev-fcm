"use client";

import React, { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, getDocs, collection, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { StandMatchScore, PlayerScore, HitResult, TournamentConfig, RoundTabType, MatchMode } from "@/types";
import { ScoreButton } from "./ScoreButton";
import { Button } from "@/components/ui/button";
import { Trophy, Target, ShieldCheck, ArrowRight, ArrowLeft, AlertCircle, CheckCircle2, Users, Layers } from "lucide-react";

interface StandScoreContainerProps {
  tournamentConfig: TournamentConfig;
}

const DEFAULT_MATCH_SCORE: StandMatchScore = {
  matchId: "match_2026_001",
  standNumber: 1,
  currentRound: "PRELIMINARY",
  teamId: "team_01",
  teamName: "第一立（福岡弓道倶楽部A）",
  mode: "本戦",
  playerScores: {},
  totalTeamHits: 0,
  updatedAt: Date.now(),
};

export function StandScoreContainer({ tournamentConfig }: StandScoreContainerProps) {
  const [currentRoundTab, setCurrentRoundTab] = useState<RoundTabType>("PRELIMINARY");
  const [currentStandNumber, setCurrentStandNumber] = useState<number>(1);
  const [matchScore, setMatchScore] = useState<StandMatchScore>(DEFAULT_MATCH_SCORE);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [currentMode, setCurrentMode] = useState<MatchMode>("本戦");
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [showIncompleteWarningModal, setShowIncompleteWarningModal] = useState<boolean>(false);
  const [pendingTargetStand, setPendingTargetStand] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const matchId = tournamentConfig.matchId;

  // 現在のラウンド（予選 / 決勝）に基づく立数・射数パラメータ
  const maxStandsForCurrentRound = currentRoundTab === "PRELIMINARY"
    ? tournamentConfig.preliminaryStands
    : tournamentConfig.finalStands;

  const currentArrowCountFormat = currentRoundTab === "PRELIMINARY"
    ? tournamentConfig.preliminaryArrowCount
    : tournamentConfig.finalArrowCount;

  const totalArrowsPerPerson = currentArrowCountFormat === "一手" ? 2 : 4;

  // Firestoreからスコアデータのリアルタイム購読
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setIsConnected(false);
      return;
    }

    const firestoreInstance = db;
    const scoreDocRef = doc(firestoreInstance, "scores", `${matchId}_stand_${currentStandNumber}`);

    const unsubscribe = onSnapshot(
      scoreDocRef,
      async (snapshot) => {
        setIsConnected(true);
        if (snapshot.exists()) {
          const rawData = snapshot.data() as Partial<StandMatchScore>;
          setMatchScore((prev) => ({
            ...prev,
            ...rawData,
            standNumber: currentStandNumber,
            currentRound: currentRoundTab,
            mode: rawData.mode || prev.mode || "本戦",
            playerScores: {
              ...prev.playerScores,
              ...(rawData.playerScores || {}),
            },
          }));
          if (rawData.mode) setCurrentMode(rawData.mode);
        } else {
          // 初期ドキュメント不在時のフォールバック自動構築（フェイルセーフ）
          try {
            const entriesSnapshot = await getDocs(collection(firestoreInstance, "entries"));
            const standPlayers: Record<string, PlayerScore> = {};

            entriesSnapshot.forEach((docSnap) => {
              const d = docSnap.data();
              if (d.standNumber === currentStandNumber) {
                standPlayers[docSnap.id] = {
                  playerId: docSnap.id,
                  playerName: d.playerName || "選手名未設定",
                  position: d.position || "大前",
                  entryType: d.entryType || "TEAM",
                  progressStatus: d.progressStatus || "SHOOTING",
                  qualificationStatus: d.qualificationStatus || "ACTIVE",
                  teamId: d.teamId || null,
                  teamName: d.teamName || "",
                  preliminaryArrows: [],
                  finalArrows: [],
                  totalHits: 0,
                  isCompleted: false,
                  isPerfect: false,
                  enkinRank: null,
                  updatedAt: Date.now(),
                };
              }
            });

            const initialData: StandMatchScore = {
              matchId,
              standNumber: currentStandNumber,
              currentRound: currentRoundTab,
              teamId: `stand_${currentStandNumber}`,
              teamName: `第${currentStandNumber}立`,
              mode: "本戦",
              playerScores: standPlayers,
              totalTeamHits: 0,
              updatedAt: Date.now(),
            };

            await setDoc(scoreDocRef, { ...initialData, lastUpdated: serverTimestamp() }, { merge: true });
            setMatchScore(initialData);
          } catch (initErr) {
            console.error("【エラーログ】立初期化失敗:", initErr);
          }
        }
      },
      (error) => {
        console.error("【エラーログ】Firestore購読失敗:", error);
        setIsConnected(false);
      }
    );

    return () => unsubscribe();
  }, [matchId, currentStandNumber, currentRoundTab]);

  // モード切り替え
  const handleModeChange = async (newMode: MatchMode) => {
    setCurrentMode(newMode);
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    try {
      const scoreDocRef = doc(db, "scores", `${matchId}_stand_${currentStandNumber}`);
      await setDoc(scoreDocRef, { mode: newMode, lastUpdated: serverTimestamp() }, { merge: true });
    } catch (error) {
      console.error("【エラーログ】モード更新失敗:", error);
    }
  };

  // フールプルーフ: 該当ラウンドの規定射数入力完了検証
  const isStandFullyCompleted = Object.values(matchScore.playerScores || {}).every((player) => {
    if (player.qualificationStatus === "ABSENT") return true;
    const arrows = currentRoundTab === "PRELIMINARY" ? player.preliminaryArrows : player.finalArrows;
    return (arrows?.length || 0) >= totalArrowsPerPerson;
  });

  const teamOnlyHits = Object.values(matchScore.playerScores || {}).reduce<number>((acc, p) => {
    if (p.entryType === "TEAM" && p.qualificationStatus !== "ABSENT") {
      const arrows = currentRoundTab === "PRELIMINARY" ? p.preliminaryArrows : p.finalArrows;
      return acc + (arrows?.reduce<number>((sum, v) => sum + v, 0) || 0);
    }
    return acc;
  }, 0);

  const teamMemberCount = Object.values(matchScore.playerScores || {}).filter(
    (p) => p.entryType === "TEAM" && p.qualificationStatus !== "ABSENT"
  ).length;

  const handleRequestStandNavigation = (targetStand: number) => {
    if (targetStand < 1 || targetStand > maxStandsForCurrentRound) return;

    if (targetStand > currentStandNumber && !isStandFullyCompleted) {
      setPendingTargetStand(targetStand);
      setShowIncompleteWarningModal(true);
      return;
    }

    executeStandTransition(targetStand);
  };

  const executeStandTransition = async (targetStand: number) => {
    setIsTransitioning(true);
    setStatusMessage("");
    setShowIncompleteWarningModal(false);

    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const matchDocRef = doc(db, "matches", matchId);
        await setDoc(matchDocRef, { currentStandNumber: targetStand, updatedAt: serverTimestamp() }, { merge: true });
      }
      setCurrentStandNumber(targetStand);
      setStatusMessage(`第${targetStand}立の成績入力画面へ切り替えました。`);
    } catch (error) {
      console.error("【エラーログ】立切り替え失敗:", error);
      setStatusMessage("切り替えに失敗しました。");
    } finally {
      setIsTransitioning(false);
      setPendingTargetStand(null);
    }
  };

  return (
    <div className="w-full bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
      {/* 予選 / 決勝 ラウンド切り替えメインタブ（UI強化） */}
      <div className="flex border-b border-slate-200 pb-2 justify-between items-center flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={currentRoundTab === "PRELIMINARY" ? "default" : "outline"}
            onClick={() => {
              setCurrentRoundTab("PRELIMINARY");
              setCurrentStandNumber(1);
            }}
            className={`font-bold text-xs h-9 ${
              currentRoundTab === "PRELIMINARY" ? "bg-slate-900 text-white" : "bg-white text-slate-700"
            }`}
          >
            <Layers className="w-3.5 h-3.5 mr-1.5" />
            予選ラウンド (全{tournamentConfig.preliminaryStands}立)
          </Button>

          <Button
            type="button"
            variant={currentRoundTab === "FINAL" ? "default" : "outline"}
            onClick={() => {
              setCurrentRoundTab("FINAL");
              setCurrentStandNumber(1);
            }}
            className={`font-bold text-xs h-9 ${
              currentRoundTab === "FINAL" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-white text-slate-700"
            }`}
          >
            <Trophy className="w-3.5 h-3.5 mr-1.5" />
            決勝ラウンド・競射 (全{tournamentConfig.finalStands}立)
          </Button>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-200/70 p-1 rounded-md">
          <Button
            size="sm"
            variant={currentMode === "本戦" ? "default" : "ghost"}
            onClick={() => handleModeChange("本戦")}
            className="h-7 text-xs font-bold"
          >
            <ShieldCheck className="w-3.5 h-3.5 mr-1" />
            本戦
          </Button>
          <Button
            size="sm"
            variant={currentMode === "射詰競射" ? "default" : "ghost"}
            onClick={() => handleModeChange("射詰競射")}
            className="h-7 text-xs font-bold"
          >
            <Target className="w-3.5 h-3.5 mr-1" />
            射詰競射
          </Button>
          <Button
            size="sm"
            variant={currentMode === "遠近競射" ? "default" : "ghost"}
            onClick={() => handleModeChange("遠近競射")}
            className="h-7 text-xs font-bold"
          >
            <Trophy className="w-3.5 h-3.5 mr-1" />
            遠近競射
          </Button>
        </div>
      </div>

      {/* 立情報ヘッダー */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-3 rounded-md border border-slate-200 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900 text-base">
              {currentRoundTab === "PRELIMINARY" ? "【予選】" : "【決勝】"} 第 {matchScore.standNumber} 立
            </span>
            <span className="text-xs bg-slate-900 text-white px-2 py-0.5 rounded font-medium">
              {matchScore.teamName || "未設定"}
            </span>
            {isStandFullyCompleted && (
              <span className="text-[11px] bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded flex items-center gap-1 border border-green-200">
                <CheckCircle2 className="w-3 h-3" /> 行射完了
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            形式: {currentArrowCountFormat} ({totalArrowsPerPerson}射 / 規定競射: {tournamentConfig.tieBreakerFormat})
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-xs text-slate-500 block leading-none flex items-center gap-1 justify-end">
              <Users className="w-3 h-3" /> 団体的中
            </span>
            <span className="text-xl font-black text-red-600">{teamOnlyHits}</span>
            <span className="text-xs text-slate-400"> / {totalArrowsPerPerson * teamMemberCount}</span>
          </div>
          <div
            className={`w-2.5 h-2.5 rounded-full ${isConnected ? "bg-green-500" : "bg-amber-400"}`}
            title={isConnected ? "Firestore同期中" : "ローカル動作中"}
          />
        </div>
      </div>

      {/* 選手別スコア入力カード一覧 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Object.values(matchScore.playerScores || {}).map((player) => (
          <ScoreButton
            key={player.playerId}
            matchId={matchScore.matchId}
            standNumber={matchScore.standNumber}
            currentRound={currentRoundTab}
            player={player}
            maxArrows={totalArrowsPerPerson}
            mode={currentMode}
          />
        ))}
      </div>

      {/* 立進行ナビゲーション */}
      <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => handleRequestStandNavigation(currentStandNumber - 1)}
          disabled={currentStandNumber <= 1 || isTransitioning}
          className="w-full sm:w-auto h-11 text-xs font-semibold text-slate-700"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          前の立へ戻る (第{currentStandNumber - 1}立)
        </Button>

        <div className="text-xs font-medium text-slate-500 text-center">
          {currentRoundTab === "PRELIMINARY" ? "予選" : "決勝"} 立順:{" "}
          <span className="font-bold text-slate-900">{currentStandNumber}</span> / {maxStandsForCurrentRound} 立
        </div>

        <Button
          type="button"
          onClick={() => handleRequestStandNavigation(currentStandNumber + 1)}
          disabled={currentStandNumber >= maxStandsForCurrentRound || isTransitioning}
          className={`w-full sm:w-auto h-11 px-6 text-sm font-bold shadow-md ${
            isStandFullyCompleted
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-slate-900 hover:bg-slate-800 text-white"
          }`}
        >
          {isTransitioning ? (
            "立を切り替え中..."
          ) : (
            <>
              次の立の成績入力に進む (第{currentStandNumber + 1}立)
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
      </div>

      {statusMessage && (
        <p className="text-xs text-center text-slate-700 font-medium bg-white p-2 rounded border border-slate-200 shadow-sm">
          {statusMessage}
        </p>
      )}

      {/* フールプルーフ: 未入力警告モーダル */}
      {showIncompleteWarningModal && pendingTargetStand && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h4 className="font-bold text-slate-900 text-base">未入力の選手が存在します</h4>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              第{currentStandNumber}立の一部の選手で行射（全{totalArrowsPerPerson}射）の入力が完了していません。
              このまま第{pendingTargetStand}立の入力に進みますか？
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowIncompleteWarningModal(false)}
                className="text-xs font-semibold"
              >
                入力を続ける
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => executeStandTransition(pendingTargetStand)}
                className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs"
              >
                強制的に次へ進む
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}