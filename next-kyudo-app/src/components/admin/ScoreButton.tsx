"use client";

import React, { useState, useCallback } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { HitResult, PlayerScore } from "@/types";
import { Button } from "@/components/ui/button";

interface ScoreBoardProps {
  matchId: string;
  standNumber: number;
  player: PlayerScore;
  maxArrows: number; // 競技形式に基づく規定射数（一手なら2、四矢なら4）
  isEditable?: boolean;
}

export function ScoreButton({
  matchId,
  standNumber,
  player,
  maxArrows = 4,
  isEditable = true,
}: ScoreBoardProps) {
  const [currentArrows, setCurrentArrows] = useState<HitResult[]>(player.arrows || []);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Firestoreへの非同期保存関数（フェイルセーフ: 通信障害時のロールバックと構造化エラーログ）
  const syncScoreToFirestore = useCallback(
    async (updatedArrows: HitResult[], previousArrows: HitResult[]) => {
      // フールプルーフ: 型安全な的中数集計
      const calculatedHits: number = updatedArrows.reduce<number>(
        (acc: number, cur: HitResult) => acc + cur,
        0
      );
      const isCompleted: boolean = updatedArrows.length >= maxArrows;

      // フールプルーフ: 型ガードでFirestoreの存在を確認
      if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
        // Firebase未設定時はローカル更新のみで安全に動作（フェイルセーフ）
        return;
      }

      setIsSyncing(true);
      setErrorMessage("");

      try {
        const matchDocRef = doc(db, "scores", `${matchId}_stand_${standNumber}`);

        // フェイルセーフ: updateDocではなくsetDoc(merge: true)を使用し、ドキュメント初回未作成時でも自動生成
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
                updatedAt: Date.now(),
              },
            },
            lastUpdated: serverTimestamp(),
          },
          { merge: true } // 既存の他選手のスコアを破壊しないマージ書き込み
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
          attemptedArrows: updatedArrows,
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

  // 的中（〇）または不中（✕）の入力処理
  const handleAddArrow = (result: HitResult) => {
    // フールプルーフ: 規定射数に達している場合や編集不可時は入力を早期ブロック
    if (!isEditable || currentArrows.length >= maxArrows || isSyncing) {
      console.warn("【入力制約】規定射数超過または処理中のため入力を無視しました。");
      return;
    }

    const previous = [...currentArrows];
    const updated = [...currentArrows, result];

    setCurrentArrows(updated);
    syncScoreToFirestore(updated, previous);
  };

  // 直前の入力を取り消すUndo処理
  const handleUndo = () => {
    // フールプルーフ: 未入力状態でのUndoをブロック
    if (!isEditable || currentArrows.length === 0 || isSyncing) {
      return;
    }

    const previous = [...currentArrows];
    const updated = currentArrows.slice(0, -1);

    setCurrentArrows(updated);
    syncScoreToFirestore(updated, previous);
  };

  // フールプルーフ: 表示用の的中数集計
  const totalHits: number = currentArrows.reduce<number>(
    (sum: number, val: HitResult) => sum + val,
    0
  );

  return (
    <div className="p-4 border border-slate-200 rounded-lg bg-white shadow-sm flex flex-col gap-3">
      {/* 選手ヘッダー情報 */}
      <div className="flex justify-between items-center">
        <div>
          <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 mr-2">
            {player.position}
          </span>
          <span className="font-bold text-slate-900">{player.playerName}</span>
        </div>
        <div className="text-right">
          <span className="text-sm font-bold text-red-600">{totalHits}</span>
          <span className="text-xs text-slate-500"> / {maxArrows} 的中</span>
        </div>
      </div>

      {/* 的中表示インジケーター */}
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

      {/* 入力ボタングループ（操作性重視 / 上限到達時無効化） */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          type="button"
          onClick={() => handleAddArrow(1)}
          disabled={!isEditable || currentArrows.length >= maxArrows || isSyncing}
          className="bg-red-600 hover:bg-red-700 text-white font-bold h-12 text-lg shadow-sm active:scale-95 transition-transform"
        >
          〇 (的中)
        </Button>
        <Button
          type="button"
          onClick={() => handleAddArrow(0)}
          disabled={!isEditable || currentArrows.length >= maxArrows || isSyncing}
          variant="secondary"
          className="font-bold h-12 text-lg text-slate-800 bg-slate-200 hover:bg-slate-300 active:scale-95 transition-transform"
        >
          ✕ (不中)
        </Button>
        <Button
          type="button"
          onClick={handleUndo}
          disabled={!isEditable || currentArrows.length === 0 || isSyncing}
          variant="outline"
          className="h-12 text-xs font-semibold text-slate-600 active:scale-95 transition-transform"
        >
          取消 (Undo)
        </Button>
      </div>

      {/* エラーメッセージおよび同期中状態のフィードバック */}
      {isSyncing && (
        <p className="text-[11px] text-center text-slate-400 animate-pulse">Firestoreと同期中...</p>
      )}
      {errorMessage && (
        <p className="text-[11px] text-center text-red-600 font-medium">{errorMessage}</p>
      )}
    </div>
  );
}