"use client";

import React, { useState, useCallback } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { HitResult, PlayerScore, MatchMode, QualificationStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { UserX, AlertTriangle, CheckCircle } from "lucide-react";

interface ScoreBoardProps {
  matchId: string;
  standNumber: number;
  player: PlayerScore;
  maxArrows: number; // 規定射数（一手なら2、四矢なら4）
  mode: MatchMode;   // 本戦 / 射詰競射 / 遠近競射
  isEditable?: boolean;
}

export function ScoreButton({
  matchId,
  standNumber,
  player,
  maxArrows = 4,
  mode = "本戦",
  isEditable = true,
}: ScoreBoardProps) {
  const [currentArrows, setCurrentArrows] = useState<HitResult[]>(player.arrows || []);
  const [tieBreakerArrows, setTieBreakerArrows] = useState<HitResult[]>(player.tieBreakerArrows || []);
  const [enkinRank, setEnkinRank] = useState<number | null>(player.enkinRank ?? null);
  const [qualification, setQualification] = useState<QualificationStatus>(player.qualificationStatus || "ACTIVE");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Firestoreへの非同期保存関数（フェイルセーフ: 通信障害時のロールバックと構造化エラーログ）
  const syncScoreToFirestore = useCallback(
    async (
      updatedArrows: HitResult[],
      previousArrows: HitResult[],
      updatedTieBreaker: HitResult[],
      updatedRank: number | null,
      updatedQual: QualificationStatus
    ) => {
      // 欠席（ABSENT）時は的中数を0に固定（フールプルーフ）
      const calculatedHits: number = updatedQual === "ABSENT"
        ? 0
        : updatedArrows.reduce<number>((acc: number, cur: HitResult) => acc + cur, 0);

      const isCompleted: boolean = updatedQual === "ABSENT" || updatedArrows.length >= maxArrows;
      const isPerfect: boolean = calculatedHits === maxArrows && maxArrows > 0 && updatedQual === "ACTIVE";

      if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
        return;
      }

      setIsSyncing(true);
      setErrorMessage("");

      try {
        const matchDocRef = doc(db, "scores", `${matchId}_stand_${standNumber}`);
        const entryDocRef = doc(db, "entries", player.playerId);

        const scorePayload = {
          playerId: player.playerId,
          playerName: player.playerName,
          position: player.position,
          entryType: player.entryType,
          teamId: player.teamId || null,
          teamName: player.teamName || "",
          qualificationStatus: updatedQual,
          arrows: updatedQual === "ABSENT" ? [] : updatedArrows,
          totalHits: calculatedHits,
          isCompleted: isCompleted,
          isPerfect: isPerfect,
          tieBreakerArrows: updatedTieBreaker,
          enkinRank: updatedRank,
          updatedAt: Date.now(),
        };

        // scoresコレクションとentriesコレクションの両方を安全に更新
        await Promise.all([
          setDoc(
            matchDocRef,
            {
              matchId: matchId,
              standNumber: standNumber,
              playerScores: {
                [player.playerId]: scorePayload,
              },
              lastUpdated: serverTimestamp(),
            },
            { merge: true }
          ),
          setDoc(
            entryDocRef,
            {
              totalHits: calculatedHits,
              totalShots: updatedQual === "ABSENT" ? 0 : updatedArrows.length,
              isPerfect: isPerfect,
              qualificationStatus: updatedQual,
              enkinRank: updatedRank,
              updatedAt: Date.now(),
            },
            { merge: true }
          ),
        ]);
      } catch (error: unknown) {
        const errorDetail =
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error);

        console.error("【エラーログ】Firestoreへのスコア同期に失敗しました:", {
          matchId,
          playerId: player.playerId,
          error: errorDetail,
        });
        setCurrentArrows(previousArrows);
        setErrorMessage("サーバーへのスコア保存に失敗しました。再試行してください。");
      } finally {
        setIsSyncing(false);
      }
    },
    [matchId, standNumber, player.playerId, player.playerName, player.position, player.entryType, player.teamId, player.teamName, maxArrows]
  );

  // 本戦スコア入力ハンドラ
  const handleAddArrow = (result: HitResult) => {
    // フールプルーフ: 欠席・失格選手や上限到達時の入力を物理的に遮断
    if (
      !isEditable ||
      qualification === "ABSENT" ||
      qualification === "DISQUALIFIED" ||
      currentArrows.length >= maxArrows ||
      isSyncing ||
      mode !== "本戦"
    ) {
      return;
    }

    const previous = [...currentArrows];
    const updated = [...currentArrows, result];

    setCurrentArrows(updated);
    syncScoreToFirestore(updated, previous, tieBreakerArrows, enkinRank, qualification);
  };

  // 射詰競射入力ハンドラ
  const handleAddTieBreakerArrow = (result: HitResult) => {
    if (!isEditable || qualification === "ABSENT" || qualification === "DISQUALIFIED" || isSyncing || mode !== "射詰競射") {
      return;
    }

    const previous = [...tieBreakerArrows];
    const updated = [...tieBreakerArrows, result];

    setTieBreakerArrows(updated);
    syncScoreToFirestore(currentArrows, currentArrows, updated, enkinRank, qualification);
  };

  // 遠近競射の順位直接選択ハンドラ
  const handleEnkinRankChange = (rank: number | null) => {
    if (!isEditable || qualification === "ABSENT" || isSyncing || mode !== "遠近競射") return;

    setEnkinRank(rank);
    syncScoreToFirestore(currentArrows, currentArrows, tieBreakerArrows, rank, qualification);
  };

  // 出欠・資格ステータス切り替えハンドラ（フールプルーフ: 欠席時はスコアを即時クリア）
  const handleQualificationChange = (newQual: QualificationStatus) => {
    if (!isEditable || isSyncing) return;

    setQualification(newQual);
    const updatedArrows = newQual === "ABSENT" ? [] : currentArrows;
    if (newQual === "ABSENT") {
      setCurrentArrows([]);
    }
    syncScoreToFirestore(updatedArrows, currentArrows, tieBreakerArrows, enkinRank, newQual);
  };

  // 直前の入力を取り消すUndo処理
  const handleUndo = () => {
    if (!isEditable || isSyncing || qualification === "ABSENT") return;

    if (mode === "本戦" && currentArrows.length > 0) {
      const previous = [...currentArrows];
      const updated = currentArrows.slice(0, -1);
      setCurrentArrows(updated);
      syncScoreToFirestore(updated, previous, tieBreakerArrows, enkinRank, qualification);
    } else if (mode === "射詰競射" && tieBreakerArrows.length > 0) {
      const previous = [...tieBreakerArrows];
      const updated = tieBreakerArrows.slice(0, -1);
      setTieBreakerArrows(updated);
      syncScoreToFirestore(currentArrows, currentArrows, updated, enkinRank, qualification);
    } else if (mode === "遠近競射" && enkinRank !== null) {
      setEnkinRank(null);
      syncScoreToFirestore(currentArrows, currentArrows, tieBreakerArrows, null, qualification);
    }
  };

  const isAbsent = qualification === "ABSENT";
  const isWithdrawn = qualification === "WITHDRAWN";
  const isDisqualified = qualification === "DISQUALIFIED";

  const totalHits: number = isAbsent
    ? 0
    : currentArrows.reduce<number>((sum: number, val: HitResult) => sum + val, 0);
  const isPerfect: boolean = totalHits === maxArrows && maxArrows > 0 && qualification === "ACTIVE";

  return (
    <div className={`p-4 border rounded-lg bg-white shadow-sm flex flex-col gap-3 transition-colors ${
      isAbsent ? "border-slate-300 bg-slate-100 opacity-75" : "border-slate-200"
    }`}>
      {/* 選手ヘッダー情報（個人/団体バッジ・出欠セレクト） */}
      <div className="flex justify-between items-start gap-2">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
              {player.position}
            </span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              player.entryType === "INDIVIDUAL" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"
            }`}>
              {player.entryType === "INDIVIDUAL" ? "個人枠" : "団体枠"}
            </span>
            <span className="font-bold text-slate-900">{player.playerName}</span>
            {isPerfect && (
              <span className="text-[10px] bg-red-600 text-white font-bold px-1.5 py-0.5 rounded animate-pulse">
                皆中
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {player.entryType === "TEAM" ? player.teamName || "所属チーム" : "個人参加"}
          </p>
        </div>

        {/* 出欠・資格ステータス切り替え（フールプルーフUI） */}
        <select
          value={qualification}
          onChange={(e) => handleQualificationChange(e.target.value as QualificationStatus)}
          disabled={!isEditable || isSyncing}
          className="text-xs p-1 border border-slate-300 rounded bg-white text-slate-700 font-semibold focus:ring-1 focus:ring-slate-900"
        >
          <option value="ACTIVE">正常参加</option>
          <option value="ABSENT">欠席 (不戦)</option>
          <option value="WITHDRAWN">途中棄権</option>
          <option value="DISQUALIFIED">失格</option>
        </select>
      </div>

      {/* 欠席・棄権・失格時の警告バナー */}
      {isAbsent && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 font-medium flex items-center gap-1.5">
          <UserX className="w-4 h-4 text-amber-600 shrink-0" />
          欠席のため入力無効（団体戦は欠員立ちとして集計）
        </div>
      )}
      {isWithdrawn && (
        <div className="p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-800 font-medium flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0" />
          途中棄権（既に入力された的中は集計に有効）
        </div>
      )}

      {/* 的中表示インジケーター */}
      {mode === "本戦" && !isAbsent && (
        <div className="grid grid-cols-4 gap-2 py-2 bg-slate-50 border border-slate-100 rounded px-2">
          {Array.from({ length: maxArrows }).map((_, index) => {
            const arrowState = currentArrows[index];
            return (
              <div
                key={index}
                className="h-12 flex flex-col items-center justify-center border border-slate-300 rounded font-bold bg-white"
              >
                <span className="text-[10px] text-slate-400 leading-none mb-1">{index + 1}射目</span>
                {arrowState === 1 ? (
                  <span className="text-red-600 text-xl leading-none">〇</span>
                ) : arrowState === 0 ? (
                  <span className="text-slate-400 text-xl leading-none">✕</span>
                ) : (
                  <span className="text-slate-200 text-lg leading-none">-</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 射詰競射モードインジケーター */}
      {mode === "射詰競射" && !isAbsent && (
        <div className="flex gap-1.5 overflow-x-auto py-2 bg-amber-50 border border-amber-200 rounded px-2 items-center">
          <span className="text-xs font-bold text-amber-900 whitespace-nowrap mr-1">射詰:</span>
          {tieBreakerArrows.map((arrowState, idx) => (
            <div
              key={idx}
              className="w-8 h-10 shrink-0 flex flex-col items-center justify-center border border-amber-300 rounded font-bold bg-white"
            >
              <span className="text-[9px] text-amber-700 leading-none">{idx + 1}本目</span>
              <span className={arrowState === 1 ? "text-red-600 text-base" : "text-slate-400 text-base"}>
                {arrowState === 1 ? "〇" : "✕"}
              </span>
            </div>
          ))}
          {tieBreakerArrows.length === 0 && (
            <span className="text-xs text-amber-600 italic">競射スコア未入力</span>
          )}
        </div>
      )}

      {/* 遠近競射モードUI */}
      {mode === "遠近競射" && !isAbsent && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-blue-900">遠近判定順位:</span>
            <span className="text-xs font-bold text-blue-700">
              {enkinRank !== null ? `第 ${enkinRank} 位` : "未確定"}
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1">
            {[1, 2, 3, 4, 5, 6].map((rankNum) => (
              <Button
                key={rankNum}
                type="button"
                size="sm"
                variant={enkinRank === rankNum ? "default" : "outline"}
                onClick={() => handleEnkinRankChange(enkinRank === rankNum ? null : rankNum)}
                disabled={!isEditable || isSyncing}
                className={`h-8 text-xs font-bold ${
                  enkinRank === rankNum ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-white text-slate-700"
                }`}
              >
                {rankNum}位
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* スコア入力ボタングループ（欠席時はDisabled化: フールプルーフ） */}
      {mode !== "遠近競射" && (
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            onClick={() => (mode === "本戦" ? handleAddArrow(1) : handleAddTieBreakerArrow(1))}
            disabled={!isEditable || isAbsent || isDisqualified || (mode === "本戦" && currentArrows.length >= maxArrows) || isSyncing}
            className="bg-red-600 hover:bg-red-700 text-white font-bold h-12 text-lg shadow-sm active:scale-95 transition-transform disabled:opacity-40"
          >
            〇 (的中)
          </Button>
          <Button
            type="button"
            onClick={() => (mode === "本戦" ? handleAddArrow(0) : handleAddTieBreakerArrow(0))}
            disabled={!isEditable || isAbsent || isDisqualified || (mode === "本戦" && currentArrows.length >= maxArrows) || isSyncing}
            variant="secondary"
            className="font-bold h-12 text-lg text-slate-800 bg-slate-200 hover:bg-slate-300 active:scale-95 transition-transform disabled:opacity-40"
          >
            ✕ (不中)
          </Button>
          <Button
            type="button"
            onClick={handleUndo}
            disabled={
              !isEditable ||
              isAbsent ||
              (mode === "本戦" ? currentArrows.length === 0 : tieBreakerArrows.length === 0) ||
              isSyncing
            }
            variant="outline"
            className="h-12 text-xs font-semibold text-slate-600 active:scale-95 transition-transform"
          >
            取消 (Undo)
          </Button>
        </div>
      )}

      {/* 遠近競射時の取消ボタン */}
      {mode === "遠近競射" && !isAbsent && (
        <Button
          type="button"
          onClick={handleUndo}
          disabled={!isEditable || enkinRank === null || isSyncing}
          variant="outline"
          className="h-9 text-xs font-semibold text-slate-600 w-full"
        >
          順位をリセット (Undo)
        </Button>
      )}

      {/* 同期ステータス・エラーログ */}
      {isSyncing && (
        <p className="text-[11px] text-center text-slate-400 animate-pulse">Firestoreと同期中...</p>
      )}
      {errorMessage && (
        <p className="text-[11px] text-center text-red-600 font-medium">{errorMessage}</p>
      )}
    </div>
  );
}