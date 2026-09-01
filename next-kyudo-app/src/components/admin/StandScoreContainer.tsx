"use client";

import React, { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, getDocs, collection, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { StandMatchScore, PlayerScore, TournamentConfig, StandRoundIndex, MatchMode } from "@/types";
import { ScoreButton } from "./ScoreButton";
import { Button } from "@/components/ui/button";
import { Trophy, Target, ShieldCheck, ArrowRight, ArrowLeft, AlertCircle, CheckCircle2, CircleDot } from "lucide-react";

interface StandScoreContainerProps {
  tournamentConfig: TournamentConfig;
}

const DEFAULT_MATCH_SCORE: StandMatchScore = {
  matchId: "match_2026_mentaiko",
  standGroup: 1,
  currentStandRound: 1,
  mode: "本戦",
  playerScores: {},
  updatedAt: Date.now(),
};

export function StandScoreContainer({ tournamentConfig }: StandScoreContainerProps) {
  const [currentStandRound, setCurrentStandRound] = useState<StandRoundIndex>(1); // 1: 一手(2), 2: 一手(2), 3: 四ツ矢(4)
  const [currentStandGroup, setCurrentStandGroup] = useState<number>(1);
  const [matchScore, setMatchScore] = useState<StandMatchScore>(DEFAULT_MATCH_SCORE);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [currentMode, setCurrentMode] = useState<MatchMode>("本戦");
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [showIncompleteWarningModal, setShowIncompleteWarningModal] = useState<boolean>(false);
  const [pendingTargetGroup, setPendingTargetGroup] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const matchId = tournamentConfig.matchId;
  const maxArrowsForCurrentRound = currentStandRound === 3 ? 4 : 2;

  // 立ちグループ（currentStandGroup）のスコアデータをリアルタイム購読
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setIsConnected(false);
      return;
    }

    const firestoreInstance = db;
    const scoreDocRef = doc(firestoreInstance, "scores", `${matchId}_group_${currentStandGroup}`);

    const unsubscribe = onSnapshot(
      scoreDocRef,
      async (snapshot) => {
        setIsConnected(true);
        if (snapshot.exists()) {
          const rawData = snapshot.data() as Partial<StandMatchScore>;
          setMatchScore((prev) => ({
            ...prev,
            ...rawData,
            standGroup: currentStandGroup,
            currentStandRound,
            mode: rawData.mode || prev.mode || "本戦",
            playerScores: {
              ...prev.playerScores,
              ...(rawData.playerScores || {}),
            },
          }));
          if (rawData.mode) setCurrentMode(rawData.mode);
        } else {
          // 初期ドキュメント不在時のフォールバック自動構築
          try {
            const entriesSnapshot = await getDocs(collection(firestoreInstance, "entries"));
            const groupPlayers: Record<string, PlayerScore> = {};

            entriesSnapshot.forEach((docSnap) => {
              const d = docSnap.data();
              if (d.standGroup === currentStandGroup) {
                groupPlayers[docSnap.id] = {
                  playerId: docSnap.id,
                  bibNumber: d.bibNumber || 1,
                  name: d.name || "選手名未設定",
                  nameKana: d.nameKana || "",
                  organization: d.organization || "",
                  shosa: d.shosa || "肌脱ぎ",
                  staffRole: d.staffRole || "無し",
                  standGroup: d.standGroup || currentStandGroup,
                  standOrder: d.standOrder || 1,
                  progressStatus: d.progressStatus || "SHOOTING",
                  qualificationStatus: d.qualificationStatus || "ACTIVE",
                  stand1_arrows: d.stand1_arrows || [],
                  stand2_arrows: d.stand2_arrows || [],
                  stand3_arrows: d.stand3_arrows || [],
                  totalHits: d.totalHits || 0,
                  isCompleted: false,
                  isPerfect: false,
                  enkinRank: null,
                  updatedAt: Date.now(),
                };
              }
            });

            const initialData: StandMatchScore = {
              matchId,
              standGroup: currentStandGroup,
              currentStandRound,
              mode: "本戦",
              playerScores: groupPlayers,
              updatedAt: Date.now(),
            };

            await setDoc(scoreDocRef, { ...initialData, lastUpdated: serverTimestamp() }, { merge: true });
            setMatchScore(initialData);
          } catch (initErr) {
            console.error("【エラーログ】立ちグループ初期化失敗:", initErr);
          }
        }
      },
      (error) => {
        console.error("【エラーログ】Firestore購読失敗:", error);
        setIsConnected(false);
      }
    );

    return () => unsubscribe();
  }, [matchId, currentStandGroup, currentStandRound]);

  const handleModeChange = async (newMode: MatchMode) => {
    setCurrentMode(newMode);
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    try {
      const scoreDocRef = doc(db, "scores", `${matchId}_group_${currentStandGroup}`);
      await setDoc(scoreDocRef, { mode: newMode, lastUpdated: serverTimestamp() }, { merge: true });
    } catch (error) {
      console.error("【エラーログ】モード更新失敗:", error);
    }
  };

  // フールプルーフ: 現在の回次の規定射数入力完了検証
  const isStandFullyCompleted = Object.values(matchScore.playerScores || {}).every((player) => {
    if (player.qualificationStatus === "ABSENT") return true;
    const arrows = currentStandRound === 1
      ? player.stand1_arrows
      : currentStandRound === 2
      ? player.stand2_arrows
      : player.stand3_arrows;
    return (arrows?.length || 0) >= maxArrowsForCurrentRound;
  });

  const handleRequestGroupNavigation = (targetGroup: number) => {
    if (targetGroup < 1 || targetGroup > tournamentConfig.maxStandGroup) return;

    if (targetGroup > currentStandGroup && !isStandFullyCompleted) {
      setPendingTargetGroup(targetGroup);
      setShowIncompleteWarningModal(true);
      return;
    }

    executeGroupTransition(targetGroup);
  };

  const executeGroupTransition = async (targetGroup: number) => {
    setIsTransitioning(true);
    setStatusMessage("");
    setShowIncompleteWarningModal(false);

    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const matchDocRef = doc(db, "matches", matchId);
        await setDoc(matchDocRef, { currentStandGroup: targetGroup, updatedAt: serverTimestamp() }, { merge: true });
      }
      setCurrentStandGroup(targetGroup);
      setStatusMessage(`第${String(targetGroup).padStart(2, "0")}立グループの成績入力画面へ切り替えました。`);
    } catch (error) {
      console.error("【エラーログ】立ちグループ切り替え失敗:", error);
      setStatusMessage("切り替えに失敗しました。");
    } finally {
      setIsTransitioning(false);
      setPendingTargetGroup(null);
    }
  };

  return (
    <div className="w-full bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
      {/* 3立の回次タブ（第1立:一手2射 / 第2立:一手2射 / 第3立:四ツ矢4射） */}
      <div className="flex border-b border-slate-200 pb-2 justify-between items-center flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant={currentStandRound === 1 ? "default" : "outline"}
            onClick={() => setCurrentStandRound(1)}
            className={`font-bold text-xs h-9 ${
              currentStandRound === 1 ? "bg-slate-900 text-white" : "bg-white text-slate-700"
            }`}
          >
            <CircleDot className="w-3.5 h-3.5 mr-1" />
            1立目：一手 (2射)
          </Button>

          <Button
            type="button"
            variant={currentStandRound === 2 ? "default" : "outline"}
            onClick={() => setCurrentStandRound(2)}
            className={`font-bold text-xs h-9 ${
              currentStandRound === 2 ? "bg-slate-900 text-white" : "bg-white text-slate-700"
            }`}
          >
            <CircleDot className="w-3.5 h-3.5 mr-1" />
            2立目：一手 (2射)
          </Button>

          <Button
            type="button"
            variant={currentStandRound === 3 ? "default" : "outline"}
            onClick={() => setCurrentStandRound(3)}
            className={`font-bold text-xs h-9 ${
              currentStandRound === 3 ? "bg-red-600 hover:bg-red-700 text-white" : "bg-white text-slate-700"
            }`}
          >
            <CircleDot className="w-3.5 h-3.5 mr-1" />
            3立目：四ツ矢 (4射)
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
              第 {String(matchScore.standGroup).padStart(2, "0")} 立グループ （{currentStandRound === 3 ? "四ツ矢 4射" : "一手 2射"}）
            </span>
            {isStandFullyCompleted && (
              <span className="text-[11px] bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded flex items-center gap-1 border border-green-200">
                <CheckCircle2 className="w-3 h-3" /> 行射完了
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            第５回めんたいこ杯争奪弓道大会 個人戦（全3立・計8射）
          </p>
        </div>

        <div
          className={`w-2.5 h-2.5 rounded-full ${isConnected ? "bg-green-500" : "bg-amber-400"}`}
          title={isConnected ? "Firestore同期中" : "ローカル動作中"}
        />
      </div>

      {/* 選手別スコア入力カード一覧（立順1〜5昇順） */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Object.values(matchScore.playerScores || {})
          .sort((a, b) => a.standOrder - b.standOrder)
          .map((player) => (
            <ScoreButton
              key={player.playerId}
              matchId={matchScore.matchId}
              standGroup={matchScore.standGroup}
              currentStandRound={currentStandRound}
              player={player}
              mode={currentMode}
            />
          ))}
      </div>

      {/* 立ちグループ進行ナビゲーション */}
      <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => handleRequestGroupNavigation(currentStandGroup - 1)}
          disabled={currentStandGroup <= 1 || isTransitioning}
          className="w-full sm:w-auto h-11 text-xs font-semibold text-slate-700"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          前の立ちグループへ戻る (第{String(currentStandGroup - 1).padStart(2, "0")}立)
        </Button>

        <div className="text-xs font-medium text-slate-500 text-center">
          立ちグループ: <span className="font-bold text-slate-900">{String(currentStandGroup).padStart(2, "0")}</span> / {String(tournamentConfig.maxStandGroup).padStart(2, "0")}
        </div>

        <Button
          type="button"
          onClick={() => handleRequestGroupNavigation(currentStandGroup + 1)}
          disabled={currentStandGroup >= tournamentConfig.maxStandGroup || isTransitioning}
          className={`w-full sm:w-auto h-11 px-6 text-sm font-bold shadow-md ${
            isStandFullyCompleted
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-slate-900 hover:bg-slate-800 text-white"
          }`}
        >
          {isTransitioning ? (
            "切り替え中..."
          ) : (
            <>
              次の立ちグループへ進む (第{String(currentStandGroup + 1).padStart(2, "0")}立)
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
      {showIncompleteWarningModal && pendingTargetGroup && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h4 className="font-bold text-slate-900 text-base">未入力の選手が存在します</h4>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              第{String(currentStandGroup).padStart(2, "0")}立グループの一部の選手で行射（全{maxArrowsForCurrentRound}射）の入力が完了していません。
              このまま第{String(pendingTargetGroup).padStart(2, "0")}立グループの入力に進みますか？
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
                onClick={() => executeGroupTransition(pendingTargetGroup)}
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