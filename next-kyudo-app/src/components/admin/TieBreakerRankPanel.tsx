"use client";

import React, { useState, useEffect } from "react";
import { collection, onSnapshot, query, doc, writeBatch } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import { StandOrderType, ShosaType, StaffRoleType, ProgressStatus, QualificationStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { Trophy, CheckCircle2, RotateCcw } from "lucide-react";

interface TieBreakerRankPanelProps {
  matchId?: string;
}

/**
 * フールプルーフ & フェイルセーフ: 立順(1〜5)の型バリデーションおよび安全側フォールバック
 * 不正な数値や未定義値がFirestoreから渡された場合でも、確実に 1 | 2 | 3 | 4 | 5 の型に適合させる
 */
function sanitizeStandOrder(val: unknown): StandOrderType {
  const num = typeof val === "number" ? val : Number(val);
  if (num === 1 || num === 2 || num === 3 || num === 4 || num === 5) {
    return num;
  }
  // フェイルセーフ: 範囲外の場合はデフォルト 1番 を返却
  return 1;
}

/**
 * フールプルーフ & フェイルセーフ: 所作（肌脱ぎ / 襷掛け）のバリデーション
 */
function sanitizeShosa(val: unknown): ShosaType {
  if (val === "襷掛け") return "襷掛け";
  return "肌脱ぎ";
}

/**
 * フールプルーフ & フェイルセーフ: 役員役割のバリデーション
 */
function sanitizeStaffRole(val: unknown): StaffRoleType {
  const validRoles: StaffRoleType[] = ["進行", "記録", "的前", "招集", "運営", "無し"];
  if (typeof val === "string" && validRoles.includes(val as StaffRoleType)) {
    return val as StaffRoleType;
  }
  return "無し";
}

/**
 * フールプルーフ & フェイルセーフ: 進行状態のバリデーション
 */
function sanitizeProgressStatus(val: unknown): ProgressStatus {
  const validStatuses: ProgressStatus[] = ["WAITING", "CALLED", "SHOOTING", "COMPLETED"];
  if (typeof val === "string" && validStatuses.includes(val as ProgressStatus)) {
    return val as ProgressStatus;
  }
  return "WAITING";
}

/**
 * フールプルーフ & フェイルセーフ: 出欠資格のバリデーション
 */
function sanitizeQualificationStatus(val: unknown): QualificationStatus {
  const validQuals: QualificationStatus[] = ["ACTIVE", "ABSENT", "WITHDRAWN", "DISQUALIFIED"];
  if (typeof val === "string" && validQuals.includes(val as QualificationStatus)) {
    return val as QualificationStatus;
  }
  return "ACTIVE";
}

export function TieBreakerRankPanel({ matchId = "match_2026_mentaiko" }: TieBreakerRankPanelProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  // Firestoreから選手スコア・遠近順位データをリアルタイム購読
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
              bibNumber: typeof raw.bibNumber === "number" ? raw.bibNumber : Number(raw.bibNumber) || 1,
              name: typeof raw.name === "string" ? raw.name : "選手名未設定",
              nameKana: typeof raw.nameKana === "string" ? raw.nameKana : "",
              organization: typeof raw.organization === "string" ? raw.organization : "",
              shosa: sanitizeShosa(raw.shosa),
              staffRole: sanitizeStaffRole(raw.staffRole),
              standGroup: typeof raw.standGroup === "number" ? raw.standGroup : Number(raw.standGroup) || 1,
              // TS2322 エラー解消: sanitizeStandOrder により型安全に StandOrderType (1〜5) を代入
              standOrder: sanitizeStandOrder(raw.standOrder),
              progressStatus: sanitizeProgressStatus(raw.progressStatus),
              qualificationStatus: sanitizeQualificationStatus(raw.qualificationStatus),
              stand1_arrows: Array.isArray(raw.stand1_arrows) ? raw.stand1_arrows : [],
              stand2_arrows: Array.isArray(raw.stand2_arrows) ? raw.stand2_arrows : [],
              stand3_arrows: Array.isArray(raw.stand3_arrows) ? raw.stand3_arrows : [],
              totalHits: typeof raw.totalHits === "number" ? raw.totalHits : Number(raw.totalHits) || 0,
              totalShots: typeof raw.totalShots === "number" ? raw.totalShots : Number(raw.totalShots) || 0,
              isPerfect: Boolean(raw.isPerfect),
              enkinRank: typeof raw.enkinRank === "number" ? raw.enkinRank : null,
              finalRank: typeof raw.finalRank === "number" ? raw.finalRank : null,
              userId: typeof raw.userId === "string" ? raw.userId : undefined,
              updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
            });
          });
          setParticipants(loaded);
        }
      },
      (error) => {
        console.warn("【警告】順位パネル購読失敗:", error);
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
      setStatusMessage("Firebase未接続のためローカル保持のみとなります。");
      return;
    }

    setIsSubmitting(true);
    setStatusMessage("最終順位を確定・保存中...");

    try {
      const firestoreInstance = db;
      const batch = writeBatch(firestoreInstance);

      // ソート基準: 遠近順位優先、次いで的中数降順（欠席者は最後尾）
      const sorted = [...participants].sort((a, b) => {
        if (a.qualificationStatus === "ABSENT") return 1;
        if (b.qualificationStatus === "ABSENT") return -1;
        if (a.enkinRank && b.enkinRank) return a.enkinRank - b.enkinRank;
        if (a.enkinRank && !b.enkinRank) return -1;
        if (!a.enkinRank && b.enkinRank) return 1;
        return (b.totalHits || 0) - (a.totalHits || 0);
      });

      sorted.forEach((p, index) => {
        const finalRankValue = p.qualificationStatus === "ABSENT" ? null : index + 1;
        const entryRef = doc(firestoreInstance, "entries", p.id);
        batch.update(entryRef, {
          enkinRank: p.enkinRank ?? null,
          finalRank: finalRankValue,
          progressStatus: "COMPLETED",
          updatedAt: Date.now(),
        });
      });

      const matchRef = doc(firestoreInstance, "matches", matchId);
      batch.update(matchRef, {
        status: "競技終了",
        updatedAt: Date.now(),
      });

      await batch.commit();
      setStatusMessage("【成功】全選手の最終順位が確定し、競技ステータスをCOMPLETEDへ更新しました。");
    } catch (error: unknown) {
      console.error("【エラーログ】順位確定エラー:", error);
      setStatusMessage("順位の確定保存に失敗しました。");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 遠近順位のリセット処理
  const handleResetEnkinRanks = () => {
    setParticipants((prev) => prev.map((p) => ({ ...p, enkinRank: null })));
    setStatusMessage("遠近順位の選択をリセットしました。");
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
            同中発生時の目視遠近判定結果を入力し、個人戦の最終順位を確定します
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

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {participants.map((p) => {
          const isAbsent = p.qualificationStatus === "ABSENT";
          return (
            <div
              key={p.id}
              className={`flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 rounded-md border gap-2 ${
                isAbsent ? "bg-slate-100 border-slate-300 opacity-60" : "bg-slate-50 border-slate-200"
              }`}
            >
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded">
                    第{String(p.standGroup).padStart(2, "0")}立 {p.standOrder}番
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    No.{p.bibNumber}
                  </span>
                  <span className="font-bold text-slate-900 text-sm">{p.name}</span>
                  <span className="text-xs text-slate-500">({p.organization || "所属未設定"})</span>
                  {isAbsent && <span className="text-[10px] text-red-600 font-bold">【欠席】</span>}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  的中数: <span className="font-bold text-red-600">{p.totalHits}</span> / 8 中
                  {p.isPerfect && <span className="ml-1 text-red-600 font-bold">【8射皆中】</span>}
                </div>
              </div>

              {!isAbsent ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-slate-600 mr-1">判定順位:</span>
                  {[1, 2, 3, 4, 5, 6].map((rankNum) => {
                    const isSelected = p.enkinRank === rankNum;
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
              ) : (
                <span className="text-xs text-slate-400 italic">順位付与対象外</span>
              )}
            </div>
          );
        })}
      </div>

      {statusMessage && (
        <p className="text-xs text-center text-slate-700 font-medium bg-slate-100 p-2 rounded border border-slate-200">
          {statusMessage}
        </p>
      )}
    </div>
  );
}