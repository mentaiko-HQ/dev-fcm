"use client";

import React, { useState, useCallback } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { HitResult, PlayerScore, MatchMode } from "@/types";
import { Button } from "@/components/ui/button";

interface ScoreBoardProps {
  matchId: string;
  standNumber: number;
  player: PlayerScore;
  maxArrows: number; // 競技形式に基づく規定射数（一手なら2、四矢なら4）
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
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Firestoreへの非同期保存関数（フェイルセーフ: 通信障害時のロールバックと構造化エラーログ）
  const syncScoreToFirestore = useCallback(
    async (
      updatedArrows: HitResult[],
      previousArrows: HitResult[],
      updatedTieBreaker: HitResult[],
      updatedRank: number | null
    ) => {
      // フールプルーフ: 型安全な的中数集計
      const calculatedHits: number = updatedArrows.reduce<number>(
        (acc: number, cur: HitResult) => acc + cur,
        0
      );
      const isCompleted: boolean = updatedArrows.length >= maxArrows;
      const isPerfect: boolean = calculatedHits === maxArrows && maxArrows > 0;

      if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
        return;
      }

      setIsSyncing(true);
      setErrorMessage("");

      try {
        const matchDocRef = doc(db, "scores", `${matchId}_stand_${standNumber}`);

        // フェイルセーフ: setDoc(merge: true)を使用し、他選手のスコアを破壊せずマージ書き込み
        await setDoc(
          matchDocRef,
          {
            matchId: matchId,
            standNumber: standNumber,
            playerScores: {
              [player.playerId]: {
                playerId: player.playerId,
                playerName: player.playerName,
                position: player.position,
                arrows: updatedArrows,
                totalHits: calculatedHits,
                isCompleted: isCompleted,
                isPerfect: isPerfect,
                tieBreakerArrows: updatedTieBreaker,
                enkinRank: updatedRank,
                updatedAt: Date.now(),
              },
            },
            lastUpdated: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (error: unknown) {
        // フェイルセーフ: Firestore書き込み失敗時に直前のローカル状態へロールバック
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
    [matchId, standNumber, player.playerId, player.playerName, player.position, maxArrows]
  );

  // 本戦スコア入力ハンドラ
  const handleAddArrow = (result: HitResult) => {
    if (!isEditable || currentArrows.length >= maxArrows || isSyncing || mode !== "本戦") {
      return;
    }

    const previous = [...currentArrows];
    const updated = [...currentArrows, result];

    setCurrentArrows(updated);
    syncScoreToFirestore(updated, previous, tieBreakerArrows, enkinRank);
  };

  // 射詰競射入力ハンドラ（サドンデス方式: 1本ずつ無制限に入力可能）
  const handleAddTieBreakerArrow = (result: HitResult) => {
    if (!isEditable || isSyncing || mode !== "射詰競射") {
      return;
    }

    const previous = [...tieBreakerArrows];
    const updated = [...tieBreakerArrows, result];

    setTieBreakerArrows(updated);
    syncScoreToFirestore(currentArrows, currentArrows, updated, enkinRank);
  };

  // 遠近競射の決定順位直接選択ハンドラ（フールプルーフ: 順位選択）
  const handleEnkinRankChange = (rank: number | null) => {
    if (!isEditable || isSyncing || mode !== "遠近競射") return;

    setEnkinRank(rank);
    syncScoreToFirestore(currentArrows, currentArrows, tieBreakerArrows, rank);
  };

  // 直前の入力を取り消すUndo処理
  const handleUndo = () => {
    if (!isEditable || isSyncing) return;

    if (mode === "本戦" && currentArrows.length > 0) {
      const previous = [...currentArrows];
      const updated = currentArrows.slice(0, -1);
      setCurrentArrows(updated);
      syncScoreToFirestore(updated, previous, tieBreakerArrows, enkinRank);
    } else if (mode === "射詰競射" && tieBreakerArrows.length > 0) {
      const previous = [...tieBreakerArrows];
      const updated = tieBreakerArrows.slice(0, -1);
      setTieBreakerArrows(updated);
      syncScoreToFirestore(currentArrows, currentArrows, updated, enkinRank);
    } else if (mode === "遠近競射" && enkinRank !== null) {
      setEnkinRank(null);
      syncScoreToFirestore(currentArrows, currentArrows, tieBreakerArrows, null);
    }
  };

  const totalHits: number = currentArrows.reduce<number>(
    (sum: number, val: HitResult) => sum + val,
    0
  );
  const isPerfect: boolean = totalHits === maxArrows && maxArrows > 0;

  return (
    <div className="p-4 border border-slate-200 rounded-lg bg-white shadow-sm flex flex-col gap-3">
      {/* 選手ヘッダー情報 */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
            {player.position}
          </span>
          <span className="font-bold text-slate-900">{player.playerName}</span>
          {isPerfect && (
            <span className="text-[10px] bg-red-600 text-white font-bold px-1.5 py-0.5 rounded animate-pulse">
              皆中
            </span>
          )}
        </div>
        <div className="text-right">
          <span className="text-sm font-bold text-red-600">{totalHits}</span>
          <span className="text-xs text-slate-500"> / {maxArrows} 的中</span>
        </div>
      </div>

      {/* 本戦モード時のインジケーター */}
      {mode === "本戦" && (
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

      {/* 射詰競射モード時のサドンデスインジケーター */}
      {mode === "射詰競射" && (
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

      {/* 遠近競射モード時の順位直接入力UI */}
      {mode === "遠近競射" && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded flex flex-col gap-2">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold text-blue-900">遠近判定順位（直接指定）:</span>
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

      {/* スコア入力ボタングループ（本戦・射詰時） */}
      {mode !== "遠近競射" && (
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            onClick={() => (mode === "本戦" ? handleAddArrow(1) : handleAddTieBreakerArrow(1))}
            disabled={!isEditable || (mode === "本戦" && currentArrows.length >= maxArrows) || isSyncing}
            className="bg-red-600 hover:bg-red-700 text-white font-bold h-12 text-lg shadow-sm active:scale-95 transition-transform"
          >
            〇 (的中)
          </Button>
          <Button
            type="button"
            onClick={() => (mode === "本戦" ? handleAddArrow(0) : handleAddTieBreakerArrow(0))}
            disabled={!isEditable || (mode === "本戦" && currentArrows.length >= maxArrows) || isSyncing}
            variant="secondary"
            className="font-bold h-12 text-lg text-slate-800 bg-slate-200 hover:bg-slate-300 active:scale-95 transition-transform"
          >
            ✕ (不中)
          </Button>
          <Button
            type="button"
            onClick={handleUndo}
            disabled={
              !isEditable ||
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
      {mode === "遠近競射" && (
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