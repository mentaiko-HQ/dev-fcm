"use client";

import React, { useState, useCallback } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { HitResult, PlayerScore, MatchMode, QualificationStatus, RoundTabType } from "@/types";
import { Button } from "@/components/ui/button";
import { UserX, AlertTriangle } from "lucide-react";

interface ScoreBoardProps {
  matchId: string;
  standNumber: number;
  currentRound: RoundTabType; // PRELIMINARY (予選) | FINAL (決勝)
  player: PlayerScore;
  maxArrows: number;          // 該当ラウンドの規定射数 (一手: 2, 四矢: 4)
  mode: MatchMode;            // 本戦 / 射詰競射 / 遠近競射
  isEditable?: boolean;
}

export function ScoreButton({
  matchId,
  standNumber,
  currentRound,
  player,
  maxArrows = 4,
  mode = "本戦",
  isEditable = true,
}: ScoreBoardProps) {
  // 現在のラウンド（予選または決勝）に応じた矢配列を選択
  const activeArrows = currentRound === "PRELIMINARY"
    ? player.preliminaryArrows || []
    : player.finalArrows || [];

  const [currentArrows, setCurrentArrows] = useState<HitResult[]>(activeArrows);
  const [tieBreakerArrows, setTieBreakerArrows] = useState<HitResult[]>(player.tieBreakerArrows || []);
  const [enkinRank, setEnkinRank] = useState<number | null>(player.enkinRank ?? null);
  const [qualification, setQualification] = useState<QualificationStatus>(player.qualificationStatus || "ACTIVE");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const syncScoreToFirestore = useCallback(
    async (
      updatedArrows: HitResult[],
      previousArrows: HitResult[],
      updatedTieBreaker: HitResult[],
      updatedRank: number | null,
      updatedQual: QualificationStatus
    ) => {
      const calculatedHits = updatedQual === "ABSENT"
        ? 0
        : updatedArrows.reduce<number>((acc: number, cur: HitResult) => acc + cur, 0);

      const isCompleted = updatedQual === "ABSENT" || updatedArrows.length >= maxArrows;
      const isPerfect = calculatedHits === maxArrows && maxArrows > 0 && updatedQual === "ACTIVE";

      if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

      setIsSyncing(true);
      setErrorMessage("");

      try {
        const matchDocRef = doc(db, "scores", `${matchId}_stand_${standNumber}`);
        const entryDocRef = doc(db, "entries", player.playerId);

        const arrowField = currentRound === "PRELIMINARY" ? "preliminaryArrows" : "finalArrows";

        const scorePayload = {
          playerId: player.playerId,
          playerName: player.playerName,
          position: player.position,
          entryType: player.entryType,
          teamId: player.teamId || null,
          teamName: player.teamName || "",
          qualificationStatus: updatedQual,
          [arrowField]: updatedQual === "ABSENT" ? [] : updatedArrows,
          totalHits: calculatedHits,
          isCompleted: isCompleted,
          isPerfect: isPerfect,
          tieBreakerArrows: updatedTieBreaker,
          enkinRank: updatedRank,
          updatedAt: Date.now(),
        };

        await Promise.all([
          setDoc(
            matchDocRef,
            {
              matchId,
              standNumber,
              currentRound,
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
              [arrowField]: updatedQual === "ABSENT" ? [] : updatedArrows,
              totalHits: calculatedHits,
              totalShots: updatedQual === "ABSENT" ? 0 : updatedArrows.length,
              isPerfect,
              qualificationStatus: updatedQual,
              enkinRank: updatedRank,
              updatedAt: Date.now(),
            },
            { merge: true }
          ),
        ]);
      } catch (error) {
        console.error("【エラーログ】スコア同期失敗:", error);
        setCurrentArrows(previousArrows);
        setErrorMessage("保存に失敗しました。");
      } finally {
        setIsSyncing(false);
      }
    },
    [matchId, standNumber, currentRound, player.playerId, player.playerName, player.position, player.entryType, player.teamId, player.teamName, maxArrows]
  );

  const handleAddArrow = (result: HitResult) => {
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

  const handleAddTieBreakerArrow = (result: HitResult) => {
    if (!isEditable || qualification === "ABSENT" || isSyncing || mode !== "射詰競射") return;

    const previous = [...tieBreakerArrows];
    const updated = [...tieBreakerArrows, result];

    setTieBreakerArrows(updated);
    syncScoreToFirestore(currentArrows, currentArrows, updated, enkinRank, qualification);
  };

  const handleEnkinRankChange = (rank: number | null) => {
    if (!isEditable || qualification === "ABSENT" || isSyncing || mode !== "遠近競射") return;

    setEnkinRank(rank);
    syncScoreToFirestore(currentArrows, currentArrows, tieBreakerArrows, rank, qualification);
  };

  const handleQualificationChange = (newQual: QualificationStatus) => {
    if (!isEditable || isSyncing) return;

    setQualification(newQual);
    const updatedArrows = newQual === "ABSENT" ? [] : currentArrows;
    if (newQual === "ABSENT") setCurrentArrows([]);
    syncScoreToFirestore(updatedArrows, currentArrows, tieBreakerArrows, enkinRank, newQual);
  };

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
  const totalHits = isAbsent ? 0 : currentArrows.reduce<number>((sum, val) => sum + val, 0);
  const isPerfect = totalHits === maxArrows && maxArrows > 0 && qualification === "ACTIVE";

  return (
    <div className={`p-4 border rounded-lg bg-white shadow-sm flex flex-col gap-3 transition-colors ${
      isAbsent ? "border-slate-300 bg-slate-100 opacity-75" : "border-slate-200"
    }`}>
      <div className="flex justify-between items-start gap-2">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
              {player.position}
            </span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              player.entryType === "INDIVIDUAL" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"
            }`}>
              {player.entryType === "INDIVIDUAL" ? "個人" : "団体"}
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

        <select
          value={qualification}
          onChange={(e) => handleQualificationChange(e.target.value as QualificationStatus)}
          disabled={!isEditable || isSyncing}
          className="text-xs p-1 border border-slate-300 rounded bg-white text-slate-700 font-semibold"
        >
          <option value="ACTIVE">正常参加</option>
          <option value="ABSENT">欠席</option>
          <option value="WITHDRAWN">途中棄権</option>
          <option value="DISQUALIFIED">失格</option>
        </select>
      </div>

      {isAbsent && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 font-medium flex items-center gap-1.5">
          <UserX className="w-4 h-4 text-amber-600 shrink-0" />
          欠席（スコア入力対象外）
        </div>
      )}

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

      {mode !== "遠近競射" && (
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            onClick={() => (mode === "本戦" ? handleAddArrow(1) : handleAddTieBreakerArrow(1))}
            disabled={!isEditable || isAbsent || (mode === "本戦" && currentArrows.length >= maxArrows) || isSyncing}
            className="bg-red-600 hover:bg-red-700 text-white font-bold h-12 text-lg shadow-sm active:scale-95 transition-transform disabled:opacity-40"
          >
            〇 (的中)
          </Button>
          <Button
            type="button"
            onClick={() => (mode === "本戦" ? handleAddArrow(0) : handleAddTieBreakerArrow(0))}
            disabled={!isEditable || isAbsent || (mode === "本戦" && currentArrows.length >= maxArrows) || isSyncing}
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

      {isSyncing && (
        <p className="text-[11px] text-center text-slate-400 animate-pulse">Firestore同期中...</p>
      )}
      {errorMessage && (
        <p className="text-[11px] text-center text-red-600 font-medium">{errorMessage}</p>
      )}
    </div>
  );
}