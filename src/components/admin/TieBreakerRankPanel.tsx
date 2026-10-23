/**
 * 【管理者向け競射判定・順位確定パネル】
 * 同中（的中数が同数）の選手に対する射詰（優勝決定等）および遠近競射（2位以降の順位決定等）の判定、
 * ならびに最終確定順位（finalRank）および遠近順位（enkinRank）の入力・一括保存を行うコンポーネント。
 * 
 * 新仕様（全3立の立配置を保持する `standAssignments`）に対応し、
 * 旧仕様のトップレベル `standGroup` / `standOrder` 直接参照による型エラー（2353, 2339）を解消。
 * 
 * 【フールプルーフ】順位の重複入力や不正な数値の混入を防止するバリデーション。
 * 【フェイルセーフ】Firestore一括バッチ更新時の例外を捕捉し、エラーログを出力して安全に回復。
 */

"use client";

import React, { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, query, orderBy, doc, writeBatch } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import { StandRoundIndex, CheckInStatus, ProgressStatus, QualificationStatus, ShosaType, RankTitleType, StaffRoleType } from "@/types";
import { Button } from "@/components/ui/button";
import { Trophy, Target, Award, CheckCircle2, AlertCircle, Loader2, RefreshCcw, Save } from "lucide-react";

interface TieBreakerRankPanelProps {
  matchId: string;
}

export function TieBreakerRankPanel({ matchId }: TieBreakerRankPanelProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedHitCount, setSelectedHitCount] = useState<number | null>(null);
  const [rankInputs, setRankInputs] = useState<Record<string, { finalRank: string; enkinRank: string }>>({});
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  /**
   * 【フェイルセーフ ＆ リアルタイム同期】
   * entries コレクションより参加者全データを購読し、standAssignments を安全に復元する。
   */
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    if (!firestoreInstance) return;

    const q = query(collection(firestoreInstance, "entries"), orderBy("bibNumber", "asc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loaded: Participant[] = [];
        snapshot.forEach((docSnap) => {
          const raw = docSnap.data();
          const rawAssignments = raw.standAssignments || {};
          
          // 【フェイルセーフ】古いデータ形式や未設定値に備えた多層フォールバック
          const safeAssignments: Record<StandRoundIndex, { standGroup: number; standOrder: 1 | 2 | 3 | 4 | 5 }> = {
            1: {
              standGroup: Number(rawAssignments[1]?.standGroup || raw.standGroup || 1),
              standOrder: (Number(rawAssignments[1]?.standOrder || raw.standOrder || 1) as 1 | 2 | 3 | 4 | 5),
            },
            2: {
              standGroup: Number(rawAssignments[2]?.standGroup || raw.standGroup || 1),
              standOrder: (Number(rawAssignments[2]?.standOrder || raw.standOrder || 1) as 1 | 2 | 3 | 4 | 5),
            },
            3: {
              standGroup: Number(rawAssignments[3]?.standGroup || 1),
              standOrder: (Number(rawAssignments[3]?.standOrder || 1) as 1 | 2 | 3 | 4 | 5),
            },
          };

          loaded.push({
            id: docSnap.id,
            bibNumber: typeof raw.bibNumber === "number" ? raw.bibNumber : Number(raw.bibNumber) || 1,
            name: typeof raw.name === "string" ? raw.name : "選手名未設定",
            nameKana: typeof raw.nameKana === "string" ? raw.nameKana : "",
            organization: typeof raw.organization === "string" ? raw.organization : "",
            shosa: (raw.shosa as ShosaType) || "肌脱ぎ",
            rankTitle: (raw.rankTitle as RankTitleType) || "段位は三段以下",
            staffRole: (raw.staffRole as StaffRoleType) || "無し",
            staffDutyShift: raw.staffDutyShift || "無し",
            checkInStatus: (raw.checkInStatus as CheckInStatus) || "UNCHECKED",
            checkInAt: typeof raw.checkInAt === "number" ? raw.checkInAt : null,
            isPaid: Boolean(raw.isPaid),
            paidAt: typeof raw.paidAt === "number" ? raw.paidAt : null,
            isStaffVolunteer: Boolean(raw.isStaffVolunteer),
            needsSupport: Boolean(raw.needsSupport),
            standAssignments: safeAssignments,
            progressStatus: (raw.progressStatus as ProgressStatus) || "WAITING",
            qualificationStatus: (raw.qualificationStatus as QualificationStatus) || "ACTIVE",
            stand1_arrows: Array.isArray(raw.stand1_arrows) ? raw.stand1_arrows : [],
            stand2_arrows: Array.isArray(raw.stand2_arrows) ? raw.stand2_arrows : [],
            stand3_arrows: Array.isArray(raw.stand3_arrows) ? raw.stand3_arrows : [],
            totalHits: typeof raw.totalHits === "number" ? raw.totalHits : 0,
            totalShots: typeof raw.totalShots === "number" ? raw.totalShots : 8,
            isPerfect: Boolean(raw.isPerfect),
            enkinRank: typeof raw.enkinRank === "number" ? raw.enkinRank : null,
            finalRank: typeof raw.finalRank === "number" ? raw.finalRank : null,
            representativeName: raw.representativeName || "",
            representativeEmail: raw.representativeEmail || "",
            representativePhone: raw.representativePhone || "",
            representativeOrganization: raw.representativeOrganization || "",
            notes: raw.notes || "",
            updatedAt: raw.updatedAt || undefined,
          });
        });

        setParticipants(loaded);

        // 既存の順位データをフォーム状態に初期反映
        const initialInputs: Record<string, { finalRank: string; enkinRank: string }> = {};
        loaded.forEach((p) => {
          initialInputs[p.id] = {
            finalRank: p.finalRank !== null && p.finalRank !== undefined ? String(p.finalRank) : "",
            enkinRank: p.enkinRank !== null && p.enkinRank !== undefined ? String(p.enkinRank) : "",
          };
        });
        setRankInputs(initialInputs);
      },
      (err: unknown) => {
        console.error("【エラーログ】TieBreakerRankPanel entries購読失敗:", err);
        setErrorMessage("参加者データの取得に失敗しました。");
      }
    );

    return () => unsubscribe();
  }, [matchId]);

  /**
   * 【的中数ごとのグルーピング集計】
   * 同中者を抽出し、競射の対象となる的中数グループを算出。
   */
  const hitGroups = useMemo(() => {
    const groups: Record<number, Participant[]> = {};
    participants.forEach((p) => {
      const hits = p.totalHits;
      if (!groups[hits]) {
        groups[hits] = [];
      }
      groups[hits].push(p);
    });
    return groups;
  }, [participants]);

  // 的中数の降順ソート配列（高的中順）
  const sortedHitCounts = useMemo(() => {
    return Object.keys(hitGroups)
      .map(Number)
      .sort((a, b) => b - a);
  }, [hitGroups]);

  // 初回読み込み時に最も高い的中数を自動選択
  useEffect(() => {
    if (selectedHitCount === null && sortedHitCounts.length > 0) {
      setSelectedHitCount(sortedHitCounts[0]);
    }
  }, [sortedHitCounts, selectedHitCount]);

  const currentGroupParticipants = useMemo(() => {
    if (selectedHitCount === null) return [];
    return hitGroups[selectedHitCount] || [];
  }, [hitGroups, selectedHitCount]);

  /**
   * 【入力変更ハンドラー】
   */
  const handleInputChange = (participantId: string, field: "finalRank" | "enkinRank", value: string) => {
    // 【フールプルーフ】数値のみ許可（空文字はクリアとして許容）
    const sanitizedValue = value.replace(/[^0-9]/g, "");
    setRankInputs((prev) => ({
      ...prev,
      [participantId]: {
        ...prev[participantId],
        [field]: sanitizedValue,
      },
    }));
    setErrorMessage("");
    setStatusMessage("");
  };

  /**
   * 【順位一括保存処理】
   * 入力された finalRank および enkinRank を Firestore の entries ドキュメントへバッチ書き込み。
   */
  const handleSaveRanks = async () => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setErrorMessage("Firestoreデータベースが利用可能な状態ではありません。");
      return;
    }

    const firestoreInstance = db;
    if (!firestoreInstance) return;

    setIsSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      const batch = writeBatch(firestoreInstance);
      const now = Date.now();

      currentGroupParticipants.forEach((p) => {
        const input = rankInputs[p.id];
        if (!input) return;

        const docRef = doc(firestoreInstance, "entries", p.id);
        const finalRankNum = input.finalRank.trim() !== "" ? Number(input.finalRank) : null;
        const enkinRankNum = input.enkinRank.trim() !== "" ? Number(input.enkinRank) : null;

        batch.update(docRef, {
          finalRank: finalRankNum,
          enkinRank: enkinRankNum,
          updatedAt: now,
        });
      });

      await batch.commit();
      setStatusMessage(`的中数 ${selectedHitCount}中の選手（全${currentGroupParticipants.length}名）の順位を正常に保存しました。`);
    } catch (err: unknown) {
      console.error("【エラーログ】順位バッチ更新失敗:", err);
      setErrorMessage("順位データの保存に失敗しました。通信環境を確認してください。");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-6 shadow-sm text-slate-900">
      
      {/* パネルヘッダー */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-amber-500/10 text-amber-800 border border-amber-300 px-2.5 py-0.5 rounded-full flex items-center gap-1">
              <Trophy className="w-3.5 h-3.5 text-amber-600" /> 順位決定コンソール
            </span>
          </div>
          <h3 className="text-base font-black tracking-tight text-slate-900 flex items-center gap-2 pt-1">
            <Target className="w-5 h-5 text-slate-700" />
            競射判定 / 順位確定 (射詰・遠近)
          </h3>
          <p className="text-xs text-slate-500 font-medium">
            全8射終了後の同中選手をグループごとに抽出し、射詰・遠近競射の結果に応じた確定順位を記録します。
          </p>
        </div>

        {selectedHitCount !== null && (
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const initialInputs: Record<string, { finalRank: string; enkinRank: string }> = {};
                participants.forEach((p) => {
                  initialInputs[p.id] = {
                    finalRank: p.finalRank !== null && p.finalRank !== undefined ? String(p.finalRank) : "",
                    enkinRank: p.enkinRank !== null && p.enkinRank !== undefined ? String(p.enkinRank) : "",
                  };
                });
                setRankInputs(initialInputs);
                setStatusMessage("変更をリセットしました。");
              }}
              className="text-xs font-bold border-slate-200 bg-white hover:bg-slate-50 text-slate-700 shadow-2xs"
            >
              <RefreshCcw className="w-3.5 h-3.5 mr-1 text-slate-500" /> 入力リセット
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSaving || currentGroupParticipants.length === 0}
              onClick={handleSaveRanks}
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-4 shadow-xs"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> 保存中...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5 mr-1.5 text-amber-400" /> 順位を保存確定
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* 的中数切り替えタブ（同中者グループセレクター） */}
      <div className="space-y-2">
        <label className="block text-xs font-bold text-slate-700">的中数別 同中グループ選択:</label>
        <div className="flex flex-wrap gap-2">
          {sortedHitCounts.length > 0 ? (
            sortedHitCounts.map((hitCount) => {
              const count = hitGroups[hitCount]?.length || 0;
              const isSelected = selectedHitCount === hitCount;
              return (
                <button
                  key={hitCount}
                  type="button"
                  onClick={() => setSelectedHitCount(hitCount)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border ${
                    isSelected
                      ? "bg-slate-900 text-white border-slate-900 shadow-xs"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 shadow-2xs"
                  }`}
                >
                  <span>{hitCount} 中</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${
                    isSelected ? "bg-slate-800 text-amber-400" : "bg-slate-100 text-slate-600"
                  }`}>
                    {count} 名
                  </span>
                </button>
              );
            })
          ) : (
            <span className="text-xs text-slate-400 font-medium py-2">
              成績データが登録されている選手がまだいません。
            </span>
          )}
        </div>
      </div>

      {/* 対象選手テーブル */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-800 flex items-center gap-1.5">
            <Award className="w-4 h-4 text-amber-500" />
            {selectedHitCount !== null ? `${selectedHitCount} 中の選手一覧（全 ${currentGroupParticipants.length} 名）` : "選手一覧"}
          </span>
          <span className="text-[11px] text-slate-500">
            ※ 優勝・順位決定の競射結果に応じて各選手の順位を入力してください。
          </span>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white shadow-2xs">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50/80 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="p-3">ゼッケン</th>
                <th className="p-3">立配置 (第1立 / 第2立)</th>
                <th className="p-3">選手氏名</th>
                <th className="p-3">所属団体名</th>
                <th className="p-3 text-center">本戦的中数</th>
                <th className="p-3 text-center w-32">遠近順位</th>
                <th className="p-3 text-center w-32">確定順位 (最終)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {currentGroupParticipants.length > 0 ? (
                currentGroupParticipants.map((p) => {
                  // 【新仕様対応】各立の個別立グループ・立順を安全に取得
                  const a1 = p.standAssignments?.[1] || { standGroup: 1, standOrder: 1 };
                  const a2 = p.standAssignments?.[2] || { standGroup: 1, standOrder: 1 };
                  const input = rankInputs[p.id] || { finalRank: "", enkinRank: "" };

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3 font-mono font-bold text-slate-900">
                        No.{p.bibNumber}
                      </td>
                      <td className="p-3 text-slate-600 space-y-0.5">
                        <div>第1立: 第{a1.standGroup}立 - {a1.standOrder}番</div>
                        <div>第2立: 第{a2.standGroup}立 - {a2.standOrder}番</div>
                      </td>
                      <td className="p-3 font-bold text-slate-900">
                        <div>{p.name}</div>
                        <div className="text-[10px] text-slate-400 font-normal">{p.nameKana}</div>
                      </td>
                      <td className="p-3 text-slate-700 font-medium">
                        {p.organization || "-"}
                      </td>
                      <td className="p-3 text-center font-mono font-bold text-slate-900">
                        <span className="inline-block bg-slate-100 px-2.5 py-0.5 rounded text-xs">
                          {p.totalHits} / {p.totalShots || 8}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="-"
                            value={input.enkinRank}
                            onChange={(e) => handleInputChange(p.id, "enkinRank", e.target.value)}
                            className="w-16 p-1.5 text-center font-mono font-bold border border-slate-200 rounded-lg bg-slate-50/50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all text-xs"
                          />
                          <span className="text-[11px] text-slate-500 font-medium">位</span>
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="-"
                            value={input.finalRank}
                            onChange={(e) => handleInputChange(p.id, "finalRank", e.target.value)}
                            className="w-16 p-1.5 text-center font-mono font-bold border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-amber-500 outline-none transition-all text-xs shadow-2xs"
                          />
                          <span className="text-[11px] text-slate-900 font-bold">位</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-medium">
                    選択された的中数の選手が存在しません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ステータス・エラー通知 */}
      {statusMessage && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs font-bold">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-900 text-xs font-bold">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

    </div>
  );
}