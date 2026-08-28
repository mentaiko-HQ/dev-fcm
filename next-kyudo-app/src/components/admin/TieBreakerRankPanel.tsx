"use client";

import React, { useState, useEffect } from "react";
import { collection, onSnapshot, query, doc, writeBatch } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import { Button } from "@/components/ui/button";
import { Trophy, Medal, CheckCircle2, RotateCcw } from "lucide-react";

interface TieBreakerRankPanelProps {
  matchId?: string;
}

export function TieBreakerRankPanel({ matchId = "match_2026_001" }: TieBreakerRankPanelProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  // Firestoreから選手スコア・遠近順位データをリアルタイム取得
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    const entriesQuery = query(collection(firestoreInstance, "entries"));

    const unsubscribe = onSnapshot(
      entriesQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const loaded: Participant[] = [];
          snapshot.forEach((docSnap) => {
            const raw = docSnap.data();
            loaded.push({
              id: docSnap.id,
              standNumber: Number(raw.standNumber) || 1,
              position: raw.position || "大前",
              teamId: raw.teamId || "",
              teamName: raw.teamName || "所属未設定",
              playerName: raw.playerName || "選手名未設定",
              division: raw.division || "一般男子",
              status: raw.status || "待機中",
              totalHits: Number(raw.totalHits) || 0,
              totalShots: Number(raw.totalShots) || 0,
              isPerfect: Boolean(raw.isPerfect),
              enkinRank: typeof raw.enkinRank === "number" ? raw.enkinRank : null,
              finalRank: typeof raw.finalRank === "number" ? raw.finalRank : null,
            });
          });
          setParticipants(loaded);
        }
      },
      (error) => {
        console.warn("【警告】順位パネルでのデータ購読に失敗しました:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  // 既に使用されている遠近順位番号のリスト（フールプルーフ: 重複割り当て防止）
  const assignedRanks = participants
    .map((p) => p.enkinRank)
    .filter((r): r is number => r !== null && r !== undefined);

  // 遠近順位のローカル更新
  const handleAssignRank = (participantId: string, rank: number | null) => {
    setParticipants((prev) =>
      prev.map((p) => (p.id === participantId ? { ...p, enkinRank: rank } : p))
    );
  };

  // 最終順位の一括計算とFirestore確定バッチコミット（フェイルセーフ）
  const handleFinalizeRanks = async () => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setStatusMessage("Firebaseが未接続のためローカルでのみ保持します。");
      return;
    }

    setIsSubmitting(true);
    setStatusMessage("最終順位を確定・保存中...");

    try {
      const firestoreInstance = db;
      const batch = writeBatch(firestoreInstance);

      // ソート基準: 遠近順位が指定されている場合は遠近順位優先、次いで的中数降順
      const sorted = [...participants].sort((a, b) => {
        if (a.enkinRank && b.enkinRank) return a.enkinRank - b.enkinRank;
        if (a.enkinRank && !b.enkinRank) return -1;
        if (!a.enkinRank && b.enkinRank) return 1;
        return b.totalHits - a.totalHits;
      });

      sorted.forEach((p, index) => {
        const finalRankValue = index + 1;
        const entryRef = doc(firestoreInstance, "entries", p.id);
        batch.update(entryRef, {
          enkinRank: p.enkinRank ?? null,
          finalRank: finalRankValue,
          status: "競技終了",
          updatedAt: Date.now(),
        });
      });

      // 試合状態を完了へ更新
      const matchRef = doc(firestoreInstance, "matches", matchId);
      batch.update(matchRef, {
        status: "競技終了",
        updatedAt: Date.now(),
      });

      await batch.commit();
      setStatusMessage("【成功】全選手の最終順位が確定し、大会ステータスを競技終了に更新しました。");
    } catch (error: unknown) {
      console.error("【エラーログ】順位確定処理中にエラーが発生しました:", error);
      setStatusMessage("順位の確定保存に失敗しました。通信環境をご確認ください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 遠近順位のリセット処理
  const handleResetEnkinRanks = () => {
    setParticipants((prev) => prev.map((p) => ({ ...p, enkinRank: null })));
    setStatusMessage("遠近順位の選択をリセットしました（未確定状態）。");
  };

  return (
    <div className="w-full bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-3 gap-2">
        <div>
          <h3 className="font-bold text-slate-900 text-base flex items-center gap-1.5">
            <Trophy className="w-5 h-5 text-amber-500" />
            遠近判定・順位確定コントロールパネル
          </h3>
          <p className="text-xs text-slate-500">
            同中発生時の目視遠近判定結果を直接入力し、大会の最終順位を確定します
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleResetEnkinRanks}
            disabled={isSubmitting}
            className="text-xs font-semibold h-8"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1" />
            順位リセット
          </Button>
          <Button
            size="sm"
            onClick={handleFinalizeRanks}
            disabled={isSubmitting || participants.length === 0}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs h-8 shadow"
          >
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
            {isSubmitting ? "確定処理中..." : "最終順位を一括確定"}
          </Button>
        </div>
      </div>

      {/* 選手別 遠近順位指定リスト */}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {participants.map((p) => (
          <div
            key={p.id}
            className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 rounded-md bg-slate-50 border border-slate-200 gap-2"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                  第{p.standNumber}立 {p.position}
                </span>
                <span className="font-bold text-slate-900 text-sm">{p.playerName}</span>
                <span className="text-xs text-slate-500">({p.teamName})</span>
              </div>
              <div className="text-xs text-slate-600 mt-1">
                的中数: <span className="font-bold text-red-600">{p.totalHits}</span> 中
                {p.isPerfect && <span className="ml-1 text-red-600 font-bold">【皆中】</span>}
              </div>
            </div>

            {/* 遠近順位選択ボタングループ（排他制御フールプルーフ） */}
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold text-slate-600 mr-1">判定順位:</span>
              {[1, 2, 3, 4, 5].map((rankNum) => {
                const isSelected = p.enkinRank === rankNum;
                // 他選手が既にその順位を選択している場合はDisabled化（重複防止フールプルーフ）
                const isTakenByOther = assignedRanks.includes(rankNum) && !isSelected;

                return (
                  <Button
                    key={rankNum}
                    type="button"
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    disabled={isTakenByOther || isSubmitting}
                    onClick={() => handleAssignRank(p.id, isSelected ? null : rankNum)}
                    className={`h-7 px-2 text-xs font-bold ${
                      isSelected
                        ? "bg-blue-600 hover:bg-blue-700 text-white"
                        : "bg-white text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {rankNum}位
                  </Button>
                );
              })}
            </div>
          </div>
        ))}

        {participants.length === 0 && (
          <p className="text-xs text-center text-slate-400 py-4">選手データがありません。</p>
        )}
      </div>

      {statusMessage && (
        <p className="text-xs text-center text-slate-700 font-medium bg-slate-100 p-2 rounded border border-slate-200">
          {statusMessage}
        </p>
      )}
    </div>
  );
}