"use client";

import React, { useState, useCallback } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { HitResult, PlayerScore, MatchMode, QualificationStatus, StandRoundIndex } from "@/types";
import { Button } from "@/components/ui/button";
import { UserX } from "lucide-react";

interface ScoreBoardProps {
  matchId: string;
  standGroup: number;
  currentStandRound: StandRoundIndex; // 1: 一手(2), 2: 一手(2), 3: 四ツ矢(4)
  player: PlayerScore;
  mode: MatchMode;
  isEditable?: boolean;
}

export function ScoreButton({
  matchId,
  standGroup,
  currentStandRound,
  player,
  mode = "本戦",
  isEditable = true,
}: ScoreBoardProps) {
  // フールプルーフ: 回次に応じた規定射数の動的算出（第1・2立: 2射、第3立: 4射）
  const maxArrowsForCurrentRound = currentStandRound === 3 ? 4 : 2;

  // 現在選択中の回次に応じた矢配列の抽出
  const getActiveArrows = (): HitResult[] => {
    if (currentStandRound === 1) return player.stand1_arrows || [];
    if (currentStandRound === 2) return player.stand2_arrows || [];
    return player.stand3_arrows || [];
  };

  const [currentArrows, setCurrentArrows] = useState<HitResult[]>(getActiveArrows());
  const [tieBreakerArrows, setTieBreakerArrows] = useState<HitResult[]>(player.tieBreakerArrows || []);
  const [enkinRank, setEnkinRank] = useState<number | null>(player.enkinRank ?? null);
  const [qualification, setQualification] = useState<QualificationStatus>(player.qualificationStatus || "ACTIVE");
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Firestoreへのスコア非同期保存（フェイルセーフ: 通信障害時のロールバック機構）
  const syncScoreToFirestore = useCallback(
    async (
      updatedArrows: HitResult[],
      previousArrows: HitResult[],
      updatedTieBreaker: HitResult[],
      updatedRank: number | null,
      updatedQual: QualificationStatus
    ) => {
      if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

      setIsSyncing(true);
      setErrorMessage("");

      const s1 = currentStandRound === 1 ? updatedArrows : player.stand1_arrows || [];
      const s2 = currentStandRound === 2 ? updatedArrows : player.stand2_arrows || [];
      const s3 = currentStandRound === 3 ? updatedArrows : player.stand3_arrows || [];

      // TS2769 解消: reduce<number> により型を明示し安全に合算
      const hits1: number = s1.reduce<number>((sum, v) => sum + v, 0);
      const hits2: number = s2.reduce<number>((sum, v) => sum + v, 0);
      const hits3: number = s3.reduce<number>((sum, v) => sum + v, 0);

      const totalHits = updatedQual === "ABSENT" ? 0 : hits1 + hits2 + hits3;
      const totalShots = updatedQual === "ABSENT" ? 0 : s1.length + s2.length + s3.length;
      const isCompleted = updatedQual === "ABSENT" || (s1.length === 2 && s2.length === 2 && s3.length === 4);
      const isPerfect = totalHits === 8 && updatedQual === "ACTIVE";

      try {
        const matchDocRef = doc(db, "scores", `${matchId}_group_${standGroup}`);
        const entryDocRef = doc(db, "entries", player.playerId);

        const scorePayload = {
          playerId: player.playerId,
          bibNumber: player.bibNumber,
          name: player.name,
          nameKana: player.nameKana,
          organization: player.organization,
          shosa: player.shosa,
          staffRole: player.staffRole,
          standGroup: player.standGroup,
          standOrder: player.standOrder,
          qualificationStatus: updatedQual,
          stand1_arrows: updatedQual === "ABSENT" ? [] : s1,
          stand2_arrows: updatedQual === "ABSENT" ? [] : s2,
          stand3_arrows: updatedQual === "ABSENT" ? [] : s3,
          totalHits,
          isCompleted,
          isPerfect,
          tieBreakerArrows: updatedTieBreaker,
          enkinRank: updatedRank,
          updatedAt: Date.now(),
        };

        // scoresコレクションとentriesコレクションの両方をアトミックに更新
        await Promise.all([
          setDoc(
            matchDocRef,
            {
              matchId,
              standGroup,
              currentStandRound,
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
              stand1_arrows: updatedQual === "ABSENT" ? [] : s1,
              stand2_arrows: updatedQual === "ABSENT" ? [] : s2,
              stand3_arrows: updatedQual === "ABSENT" ? [] : s3,
              totalHits,
              totalShots,
              isPerfect,
              qualificationStatus: updatedQual,
              enkinRank: updatedRank,
              updatedAt: Date.now(),
            },
            { merge: true }
          ),
        ]);
      } catch (error) {
        // フェイルセーフ: 書き込み失敗時のローカル状態ロールバック
        console.error("【エラーログ】スコア同期失敗:", error);
        setCurrentArrows(previousArrows);
        setErrorMessage("保存に失敗しました。再試行してください。");
      } finally {
        setIsSyncing(false);
      }
    },
    [
      matchId,
      standGroup,
      currentStandRound,
      player.playerId,
      player.bibNumber,
      player.name,
      player.nameKana,
      player.organization,
      player.shosa,
      player.staffRole,
      player.standGroup,
      player.standOrder,
      player.stand1_arrows,
      player.stand2_arrows,
      player.stand3_arrows,
    ]
  );

  // 的中（〇）または不中（✕）の入力処理（フールプルーフ: 規定射数超過および欠席時の入力遮断）
  const handleAddArrow = (result: HitResult) => {
    if (
      !isEditable ||
      qualification === "ABSENT" ||
      qualification === "DISQUALIFIED" ||
      currentArrows.length >= maxArrowsForCurrentRound ||
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

  // 射詰競射スコア入力ハンドラ
  const handleAddTieBreakerArrow = (result: HitResult) => {
    if (!isEditable || qualification === "ABSENT" || isSyncing || mode !== "射詰競射") return;

    const previous = [...tieBreakerArrows];
    const updated = [...tieBreakerArrows, result];

    setTieBreakerArrows(updated);
    syncScoreToFirestore(currentArrows, currentArrows, updated, enkinRank, qualification);
  };

  // 遠近競射順位選択ハンドラ
  const handleEnkinRankChange = (rank: number | null) => {
    if (!isEditable || qualification === "ABSENT" || isSyncing || mode !== "遠近競射") return;

    setEnkinRank(rank);
    syncScoreToFirestore(currentArrows, currentArrows, tieBreakerArrows, rank, qualification);
  };

  // 出欠資格切り替えハンドラ（フールプルーフ: 欠席時はスコアを即時ゼロクリア）
  const handleQualificationChange = (newQual: QualificationStatus) => {
    if (!isEditable || isSyncing) return;

    setQualification(newQual);
    const updatedArrows = newQual === "ABSENT" ? [] : currentArrows;
    if (newQual === "ABSENT") setCurrentArrows([]);
    syncScoreToFirestore(updatedArrows, currentArrows, tieBreakerArrows, enkinRank, newQual);
  };

  // 直前のスコア入力取り消し処理（Undo）
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
  // TS2769 解消: reduce<number> により型を明示
  const standHits = isAbsent ? 0 : currentArrows.reduce<number>((sum, val) => sum + val, 0);

  return (
    <div
      className={`p-4 border rounded-lg bg-white shadow-sm flex flex-col gap-3 transition-colors ${
        isAbsent ? "border-slate-300 bg-slate-100 opacity-75" : "border-slate-200"
      }`}
    >
      {/* 選手ヘッダー情報（立順1〜5、ゼッケン、名前、所作、役員） */}
      <div className="flex justify-between items-start gap-2">
        <div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-900 text-white">
              {player.standOrder}番
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
              No.{player.bibNumber}
            </span>
            <span className="font-bold text-slate-900 text-base">{player.name}</span>
            <span className="text-xs text-slate-500">({player.nameKana})</span>
            {player.isPerfect && (
              <span className="text-[10px] bg-red-600 text-white font-bold px-1.5 py-0.5 rounded animate-pulse">
                8射皆中
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
            <span>{player.organization || "所属未設定"}</span>
            <span>•</span>
            <span className="font-semibold text-slate-700">所作: {player.shosa}</span>
            {player.staffRole !== "無し" && (
              <>
                <span>•</span>
                <span className="bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded">
                  役員: {player.staffRole}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 出欠状態切り替えドロップダウン */}
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

      {/* 欠席時の注意表示 */}
      {isAbsent && (
        <div className="p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 font-medium flex items-center gap-1.5">
          <UserX className="w-4 h-4 text-amber-600 shrink-0" />
          欠席（スコア入力対象外）
        </div>
      )}

      {/* 本戦モード: 的中表示インジケーター（立の規定射数分表示） */}
      {mode === "本戦" && !isAbsent && (
        <div
          className={`grid gap-2 py-2 bg-slate-50 border border-slate-100 rounded px-2 ${
            maxArrowsForCurrentRound === 2 ? "grid-cols-2" : "grid-cols-4"
          }`}
        >
          {Array.from({ length: maxArrowsForCurrentRound }).map((_, index) => {
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

      {/* 操作ボタングループ */}
      {mode !== "遠近競射" && (
        <div className="grid grid-cols-3 gap-2">
          <Button
            type="button"
            onClick={() => (mode === "本戦" ? handleAddArrow(1) : handleAddTieBreakerArrow(1))}
            disabled={
              !isEditable ||
              isAbsent ||
              (mode === "本戦" && currentArrows.length >= maxArrowsForCurrentRound) ||
              isSyncing
            }
            className="bg-red-600 hover:bg-red-700 text-white font-bold h-12 text-lg shadow-sm active:scale-95 transition-transform disabled:opacity-40"
          >
            〇 (的中)
          </Button>
          <Button
            type="button"
            onClick={() => (mode === "本戦" ? handleAddArrow(0) : handleAddTieBreakerArrow(0))}
            disabled={
              !isEditable ||
              isAbsent ||
              (mode === "本戦" && currentArrows.length >= maxArrowsForCurrentRound) ||
              isSyncing
            }
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

      {/* 現在立の的中数と総合的中数 */}
      <div className="flex justify-between items-center text-xs text-slate-600 px-1">
        <span>
          当立: <strong className="text-red-600">{standHits}</strong> / {maxArrowsForCurrentRound} 中
        </span>
        <span>
          累計: <strong className="text-slate-900">{player.totalHits || 0}</strong> / 8 中
        </span>
      </div>

      {isSyncing && (
        <p className="text-[11px] text-center text-slate-400 animate-pulse">Firestore同期中...</p>
      )}
      {errorMessage && (
        <p className="text-[11px] text-center text-red-600 font-medium">{errorMessage}</p>
      )}
    </div>
  );
}