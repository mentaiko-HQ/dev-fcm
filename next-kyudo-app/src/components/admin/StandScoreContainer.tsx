"use client";

import React, { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, getDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { StandMatchScore, PlayerScore, HitResult, MatchFormat, MatchMode } from "@/types";
import { ScoreButton } from "./ScoreButton";
import { Button } from "@/components/ui/button";
import { Trophy, Target, ShieldCheck, ArrowRight, ArrowLeft, AlertCircle, CheckCircle2 } from "lucide-react";

// フェイルセーフ: 試合形式のデフォルトフォールバック設定
const DEFAULT_MATCH_FORMAT: MatchFormat = {
  id: "fmt_4arrows",
  name: "四矢団体戦",
  arrowCount: "四矢",
  totalArrowsPerPerson: 4,
  isTeamMatch: true,
  playersPerTeam: 3,
  tieBreaker: "射詰",
};

const DEFAULT_MATCH_SCORE: StandMatchScore = {
  matchId: "match_2026_001",
  standNumber: 1,
  teamId: "team_01",
  teamName: "第一立（福岡弓道倶楽部A）",
  format: DEFAULT_MATCH_FORMAT,
  mode: "本戦",
  playerScores: {
    p1: { playerId: "p1", playerName: "佐藤 健一", position: "大前", arrows: [], totalHits: 0, isCompleted: false, isPerfect: false, enkinRank: null, updatedAt: 0 },
    p2: { playerId: "p2", playerName: "鈴木 隆", position: "中", arrows: [], totalHits: 0, isCompleted: false, isPerfect: false, enkinRank: null, updatedAt: 0 },
    p3: { playerId: "p3", playerName: "高橋 誠", position: "落", arrows: [], totalHits: 0, isCompleted: false, isPerfect: false, enkinRank: null, updatedAt: 0 },
  },
  totalTeamHits: 0,
  updatedAt: Date.now(),
};

export function StandScoreContainer() {
  const [currentStandNumber, setCurrentStandNumber] = useState<number>(1);
  const [maxStandNumber, setMaxStandNumber] = useState<number>(10);
  const [matchScore, setMatchScore] = useState<StandMatchScore>(DEFAULT_MATCH_SCORE);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [currentMode, setCurrentMode] = useState<MatchMode>("本戦");
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [showIncompleteWarningModal, setShowIncompleteWarningModal] = useState<boolean>(false);
  const [pendingTargetStand, setPendingTargetStand] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");

  const matchId = matchScore.matchId;

  // 1. matches ドキュメントより最大立数を取得
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    const matchDocRef = doc(firestoreInstance, "matches", matchId);

    const unsubscribe = onSnapshot(matchDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (typeof data.maxStandNumber === "number") {
          setMaxStandNumber(data.maxStandNumber);
        }
      }
    });

    return () => unsubscribe();
  }, [matchId]);

  // 2. 指定された立番号 (currentStandNumber) のスコア・チーム情報を購読
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
            format: rawData.format || prev.format || DEFAULT_MATCH_FORMAT,
            mode: rawData.mode || prev.mode || "本戦",
            playerScores: {
              ...prev.playerScores,
              ...(rawData.playerScores || {}),
            },
          }));
          if (rawData.mode) {
            setCurrentMode(rawData.mode);
          }
        } else {
          // ドキュメントが存在しない場合は、teamsコレクションおよびentriesから安全に初期化（フェイルセーフ）
          try {
            const teamsSnapshot = await getDocs(collection(firestoreInstance, "teams"));
            let resolvedTeamName = `第${currentStandNumber}立`;
            let resolvedTeamId = `team_${String(currentStandNumber).padStart(2, "0")}`;

            teamsSnapshot.forEach((tDoc) => {
              const tData = tDoc.data();
              if (tData.standNumber === currentStandNumber) {
                resolvedTeamId = tDoc.id;
                resolvedTeamName = typeof tData.name === "string" ? tData.name : resolvedTeamName;
              }
            });

            const initialData: StandMatchScore = {
              matchId: matchId,
              standNumber: currentStandNumber,
              teamId: resolvedTeamId,
              teamName: resolvedTeamName,
              format: DEFAULT_MATCH_FORMAT,
              mode: "本戦",
              playerScores: {
                [`p_${currentStandNumber}_1`]: { playerId: `p_${currentStandNumber}_1`, playerName: "選手 1", position: "大前", arrows: [], totalHits: 0, isCompleted: false, isPerfect: false, enkinRank: null, updatedAt: 0 },
                [`p_${currentStandNumber}_2`]: { playerId: `p_${currentStandNumber}_2`, playerName: "選手 2", position: "中", arrows: [], totalHits: 0, isCompleted: false, isPerfect: false, enkinRank: null, updatedAt: 0 },
                [`p_${currentStandNumber}_3`]: { playerId: `p_${currentStandNumber}_3`, playerName: "選手 3", position: "落", arrows: [], totalHits: 0, isCompleted: false, isPerfect: false, enkinRank: null, updatedAt: 0 },
              },
              totalTeamHits: 0,
              updatedAt: Date.now(),
            };

            await setDoc(scoreDocRef, { ...initialData, lastUpdated: serverTimestamp() }, { merge: true });
            setMatchScore(initialData);
          } catch (initErr) {
            console.error("【エラーログ】立初期化に失敗しました:", initErr);
          }
        }
      },
      (error: unknown) => {
        console.error("【エラーログ】Firestoreスコア購読中にエラーが発生しました:", error);
        setIsConnected(false);
      }
    );

    return () => unsubscribe();
  }, [matchId, currentStandNumber]);

  // モード切り替えハンドラ（本戦 ↔ 射詰競射 ↔ 遠近競射）
  const handleModeChange = async (newMode: MatchMode) => {
    setCurrentMode(newMode);
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    try {
      const scoreDocRef = doc(db, "scores", `${matchId}_stand_${currentStandNumber}`);
      await setDoc(
        scoreDocRef,
        {
          mode: newMode,
          lastUpdated: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error("【エラーログ】競技モード更新に失敗しました:", error);
    }
  };

  const currentFormat = matchScore.format || DEFAULT_MATCH_FORMAT;
  const totalArrowsPerPerson = currentFormat.totalArrowsPerPerson || 4;
  const playersPerTeam = currentFormat.playersPerTeam || 3;

  // フールプルーフ判定: 現在のチーム全選手の行射が規定射数に達しているか検証
  const isStandFullyCompleted = Object.values(matchScore.playerScores || {}).every(
    (player) => (player.arrows?.length || 0) >= totalArrowsPerPerson
  );

  // 次のチーム（立）または前の立への遷移要求ハンドラ
  const handleRequestStandNavigation = (targetStand: number) => {
    // フールプルーフ: 範囲外への遷移を早期ブロック
    if (targetStand < 1 || targetStand > maxStandNumber) {
      return;
    }

    // 次の立に進む際、未入力の矢が存在する場合は誤操作防止のため警告モーダルを表示（フールプルーフ）
    if (targetStand > currentStandNumber && !isStandFullyCompleted) {
      setPendingTargetStand(targetStand);
      setShowIncompleteWarningModal(true);
      return;
    }

    // 規定射数完了時、または戻る操作時は即時遷移を実行
    executeStandTransition(targetStand);
  };

  // 実際の立遷移実行（フェイルセーフ: Firestore更新と状態同期）
  const executeStandTransition = async (targetStand: number) => {
    setIsTransitioning(true);
    setStatusMessage("");
    setShowIncompleteWarningModal(false);

    try {
      // 進行状況（matches ドキュメント）を同期更新
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const matchDocRef = doc(db, "matches", matchId);
        await setDoc(
          matchDocRef,
          {
            currentStandNumber: targetStand,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      setCurrentStandNumber(targetStand);
      setStatusMessage(`第${targetStand}立の成績入力画面へ切り替えました。`);
    } catch (error: unknown) {
      console.error("【エラーログ】立の切り替えに失敗しました:", error);
      setStatusMessage("立の切り替え処理に失敗しました。通信環境を確認してください。");
    } finally {
      setIsTransitioning(false);
      setPendingTargetStand(null);
    }
  };

  // フールプルーフ: チーム総的中数を安全に算出
  const totalTeamHits: number = Object.values(matchScore.playerScores || {}).reduce<number>(
    (acc: number, p: PlayerScore) =>
      acc + (p.arrows?.reduce<number>((sum: number, v: HitResult) => sum + v, 0) || 0),
    0
  );

  return (
    <div className="w-full bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
      {/* 立情報ヘッダーおよびモード切り替えバー */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-3 rounded-md border border-slate-200 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900 text-base">第 {matchScore.standNumber} 立</span>
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
            形式: {currentFormat.name} ({totalArrowsPerPerson}射 / 規定競射: {currentFormat.tieBreaker})
          </p>
        </div>

        {/* 競技モード切り替えタブ（フールプルーフUI） */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-md border border-slate-200">
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

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-xs text-slate-500 block leading-none">チーム総的中</span>
            <span className="text-xl font-black text-red-600">{totalTeamHits}</span>
            <span className="text-xs text-slate-400"> / {totalArrowsPerPerson * playersPerTeam}</span>
          </div>
          <div
            className={`w-2.5 h-2.5 rounded-full ${isConnected ? "bg-green-500" : "bg-amber-400"}`}
            title={isConnected ? "Firestore同期中" : "ローカル動作中"}
          />
        </div>
      </div>

      {/* 各選手のスコア入力カード一覧 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Object.values(matchScore.playerScores || {}).map((player) => (
          <ScoreButton
            key={player.playerId}
            matchId={matchScore.matchId}
            standNumber={matchScore.standNumber}
            player={player}
            maxArrows={totalArrowsPerPerson}
            mode={currentMode}
          />
        ))}
      </div>

      {/* チーム・立 進行ナビゲーション操作バー（次のチーム成績入力へ進むボタン） */}
      <div className="pt-2 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => handleRequestStandNavigation(currentStandNumber - 1)}
          disabled={currentStandNumber <= 1 || isTransitioning}
          className="w-full sm:w-auto h-11 text-xs font-semibold text-slate-700 active:scale-95 transition-transform"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" />
          前の立へ戻る (第{currentStandNumber - 1}立)
        </Button>

        <div className="text-xs font-medium text-slate-500 text-center">
          立順: <span className="font-bold text-slate-900">{currentStandNumber}</span> / {maxStandNumber} 立
        </div>

        <Button
          type="button"
          onClick={() => handleRequestStandNavigation(currentStandNumber + 1)}
          disabled={currentStandNumber >= maxStandNumber || isTransitioning}
          className={`w-full sm:w-auto h-11 px-6 text-sm font-bold shadow-md active:scale-95 transition-transform ${
            isStandFullyCompleted
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-slate-900 hover:bg-slate-800 text-white"
          }`}
        >
          {isTransitioning ? (
            "立を切り替え中..."
          ) : (
            <>
              次のチームの成績入力に進む (第{currentStandNumber + 1}立)
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

      {/* フールプルーフ: 規定射数未達時の確認モーダル */}
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