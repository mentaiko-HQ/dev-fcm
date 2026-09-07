/**
 * 【競技記録員用スコア入力コンソール】
 * 立ちグループおよび立（第1立・第2立・第3立）を選択し、各選手の的中状況（〇✕）をリアルタイムで入力・保存するコンポーネント。
 * 
 * 【フールプルーフ】型制約（PlayerScore, StandMatchScore, StandRoundIndex）を明示し、unknown 型の暗黙的エラーを防止。
 * 【フェイルセーフ】Firestoreインスタンスの接続検証（isFirestoreAvailable）を行い、型エラー（型 'Firestore | null'）を完全に解消。
 */

"use client";

import React, { useState, useEffect } from "react";
import { collection, doc, onSnapshot, setDoc, query } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { TournamentConfig, PlayerScore, StandMatchScore, StandRoundIndex, HitResult, STAND_CONFIGS } from "@/types";
import { Participant } from "@/types/participant";
import { ScoreButton, calculateTotalHits } from "@/components/admin/ScoreButton";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, Save, ShieldCheck } from "lucide-react";

interface StandScoreContainerProps {
  tournamentConfig: TournamentConfig;
}

export function StandScoreContainer({ tournamentConfig }: StandScoreContainerProps) {
  const [selectedRound, setSelectedRound] = useState<StandRoundIndex>(1);
  const [selectedGroup, setSelectedGroup] = useState<number>(1);
  const [participantsInGroup, setParticipantsInGroup] = useState<Participant[]>([]);
  const [playerScoresMap, setPlayerScoresMap] = useState<Record<string, PlayerScore>>({});
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const currentStandConfig = STAND_CONFIGS[selectedRound];

  /**
   * 【フェイルセーフ ＆ リアルタイム同期】
   * 選択された立（Round）と立ちグループ（Group）に該当する参加者データを Firestore の entries から取得。
   */
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    // 【フェイルセーフ】dbが非nullであることを明示してオーバーロードエラーを解消
    const firestoreInstance = db;
    if (!firestoreInstance) return;

    const q = query(collection(firestoreInstance, "entries"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded: Participant[] = [];
      snapshot.forEach((docSnap) => {
        const raw = docSnap.data();
        const rawAssignments = raw.standAssignments || {};
        const safeAssignments: Record<StandRoundIndex, { standGroup: number; standOrder: 1 | 2 | 3 | 4 | 5 }> = {
          1: {
            standGroup: Number(rawAssignments[1]?.standGroup || raw.standGroup || 1),
            standOrder: Number(rawAssignments[1]?.standOrder || raw.standOrder || 1) as 1 | 2 | 3 | 4 | 5,
          },
          2: {
            standGroup: Number(rawAssignments[2]?.standGroup || raw.standGroup || 1),
            standOrder: Number(rawAssignments[2]?.standOrder || raw.standOrder || 1) as 1 | 2 | 3 | 4 | 5,
          },
          3: {
            standGroup: Number(rawAssignments[3]?.standGroup || 1),
            standOrder: Number(rawAssignments[3]?.standOrder || 1) as 1 | 2 | 3 | 4 | 5,
          },
        };

        loaded.push({
          id: docSnap.id,
          bibNumber: typeof raw.bibNumber === "number" ? raw.bibNumber : Number(raw.bibNumber) || 1,
          name: typeof raw.name === "string" ? raw.name : "選手名未設定",
          nameKana: typeof raw.nameKana === "string" ? raw.nameKana : "",
          organization: typeof raw.organization === "string" ? raw.organization : "",
          shosa: raw.shosa || "肌脱ぎ",
          rankTitle: raw.rankTitle || "段位は三段以下",
          staffRole: raw.staffRole || "無し",
          checkInStatus: raw.checkInStatus || "UNCHECKED",
          isPaid: Boolean(raw.isPaid),
          standAssignments: safeAssignments,
          progressStatus: raw.progressStatus || "WAITING",
          qualificationStatus: raw.qualificationStatus || "ACTIVE",
          stand1_arrows: Array.isArray(raw.stand1_arrows) ? raw.stand1_arrows : [],
          stand2_arrows: Array.isArray(raw.stand2_arrows) ? raw.stand2_arrows : [],
          stand3_arrows: Array.isArray(raw.stand3_arrows) ? raw.stand3_arrows : [],
          totalHits: typeof raw.totalHits === "number" ? raw.totalHits : 0,
          totalShots: typeof raw.totalShots === "number" ? raw.totalShots : 8,
          isPerfect: Boolean(raw.isPerfect),
        });
      });

      // 選択された立グループに所属する選手のみを抽出し、立順（standOrder）の昇順にソート
      const filtered = loaded.filter((p: Participant) => {
        const assignment = p.standAssignments[selectedRound];
        return assignment && assignment.standGroup === selectedGroup;
      }).sort((a: Participant, b: Participant) => {
        const orderA = a.standAssignments[selectedRound]?.standOrder || 1;
        const orderB = b.standAssignments[selectedRound]?.standOrder || 1;
        return orderA - orderB;
      });

      setParticipantsInGroup(filtered);
    }, (err: unknown) => {
      console.error("【選手データ取得エラー】", err);
    });

    return () => unsubscribe();
  }, [selectedRound, selectedGroup]);

  /**
   * 【スコアデータのリアルタイム同期】
   * 該当する立・グループのスコアドキュメントを scores コレクションから購読。
   */
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    if (!firestoreInstance) return;

    const scoreDocId = `${tournamentConfig.matchId}_round_${selectedRound}_group_${selectedGroup}`;
    const scoreDocRef = doc(firestoreInstance, "scores", scoreDocId);

    const unsubscribe = onSnapshot(scoreDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as StandMatchScore;
        setPlayerScoresMap(data.playerScores || {});
      } else {
        setPlayerScoresMap({});
      }
    }, (err: unknown) => {
      console.error("【スコアデータ取得エラー】", err);
    });

    return () => unsubscribe();
  }, [tournamentConfig.matchId, selectedRound, selectedGroup]);

  /**
   * 【スコア変更ハンドラー】
   * 特定の選手の特定のアロー（射）の的中結果を更新する。
   */
  const handleArrowChange = (playerId: string, arrowIndex: number, value: HitResult) => {
    const participant = participantsInGroup.find((p) => p.id === playerId);
    if (!participant) return;

    setPlayerScoresMap((prev: Record<string, PlayerScore>) => {
      const existing: PlayerScore = prev[playerId] || {
        playerId,
        playerName: participant.name,
        bibNumber: participant.bibNumber,
        name: participant.name,
        nameKana: participant.nameKana,
        organization: participant.organization,
        shosa: participant.shosa,
        staffRole: participant.staffRole,
        qualificationStatus: participant.qualificationStatus,
        standAssignments: participant.standAssignments,
        stand1_arrows: [...participant.stand1_arrows],
        stand2_arrows: [...participant.stand2_arrows],
        stand3_arrows: [...participant.stand3_arrows],
        totalHits: 0,
        isCompleted: false,
        isPerfect: false,
      };

      const targetKey = selectedRound === 1 ? "stand1_arrows" : selectedRound === 2 ? "stand2_arrows" : "stand3_arrows";
      const currentArrows = [...(existing[targetKey] || [])];
      
      while (currentArrows.length < arrowIndex) {
        currentArrows.push(0);
      }
      currentArrows[arrowIndex - 1] = value;

      const updatedPlayer: PlayerScore = {
        ...existing,
        [targetKey]: currentArrows,
        totalHits: calculateTotalHits(currentArrows),
      };

      return {
        ...prev,
        [playerId]: updatedPlayer,
      };
    });
  };

  /**
   * 【スコア保存処理】
   * 入力されたスコアを Firestore の `scores` コレクションに反映させる。
   */
  const handleSaveScores = async () => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      alert("Firestoreデータベースが利用可能な状態ではありません。");
      return;
    }

    setIsSaving(true);
    setStatusMessage("");
    setErrorMessage("");
    const now = Date.now();

    try {
      const firestoreInstance = db;
      if (!firestoreInstance) return;

      const scoreDocId = `${tournamentConfig.matchId}_round_${selectedRound}_group_${selectedGroup}`;
      const scoreDocRef = doc(firestoreInstance, "scores", scoreDocId);

      const scorePayload: StandMatchScore = {
        matchId: tournamentConfig.matchId,
        standGroup: selectedGroup,
        roundIndex: selectedRound,
        playerScores: playerScoresMap,
        isLocked: false,
        updatedAt: now,
      };

      await setDoc(scoreDocRef, scorePayload, { merge: true });
      setStatusMessage("スコアが正常に保存されました。");
    } catch (err: unknown) {
      console.error("【スコア保存失敗】", err);
      setErrorMessage("スコアの保存に失敗しました。通信環境を確認してください。");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-6 shadow-xs text-slate-900">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-100 pb-4 gap-4">
        <div>
          <h3 className="font-black text-slate-900 text-sm flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-slate-700" /> 競技記録員用 スコア入力コンソール
          </h3>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            立（Round）と立ちグループを選択し、選手ごとの的中（〇✕）を迅速に入力・保存します。
          </p>
        </div>

        {/* 立（Round）切り替えボタン群 */}
        <div className="flex gap-1.5 bg-slate-100 p-1 rounded-lg">
          {([1, 2, 3] as StandRoundIndex[]).map((rIdx) => (
            <button
              key={rIdx}
              type="button"
              onClick={() => setSelectedRound(rIdx)}
              className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                selectedRound === rIdx
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {STAND_CONFIGS[rIdx].name}
            </button>
          ))}
        </div>
      </div>

      {/* 立ちグループ選択バー */}
      <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
        <span className="font-bold text-slate-700">立ちグループ選択:</span>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((gNum) => (
            <button
              key={gNum}
              type="button"
              onClick={() => setSelectedGroup(gNum)}
              className={`px-3 py-1.5 rounded font-mono font-bold transition-all ${
                selectedGroup === gNum
                  ? "bg-amber-500 text-slate-950 shadow-2xs"
                  : "bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
              }`}
            >
              第{gNum}立
            </button>
          ))}
        </div>
      </div>

      {/* 選手別スコア入力テーブル */}
      <div className="space-y-4">
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="p-3">ゼッケン / 立順</th>
                <th className="p-3">選手氏名 / 所属</th>
                <th className="p-3">的中入力 ({currentStandConfig.arrowCount}射)</th>
                <th className="p-3 text-center">的中数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {participantsInGroup.length > 0 ? (
                participantsInGroup.map((p) => {
                  const assignment = p.standAssignments[selectedRound] || { standGroup: selectedGroup, standOrder: 1 };
                  const pScore = playerScoresMap[p.id];
                  
                  const targetArrows = selectedRound === 1 
                    ? (pScore?.stand1_arrows || p.stand1_arrows || [])
                    : selectedRound === 2 
                    ? (pScore?.stand2_arrows || p.stand2_arrows || [])
                    : (pScore?.stand3_arrows || p.stand3_arrows || []);

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-3 font-mono">
                        <div className="font-bold text-slate-900">No.{p.bibNumber}</div>
                        <div className="text-[10px] text-slate-500">{assignment.standOrder}番立</div>
                      </td>
                      <td className="p-3 font-bold text-slate-900">
                        <div>{p.name}</div>
                        <div className="text-[10px] text-slate-400 font-normal">{p.organization || "-"}</div>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-3">
                          {Array.from({ length: currentStandConfig.arrowCount }).map((_, aIdx) => {
                            const arrowNum = aIdx + 1;
                            const val = targetArrows[aIdx] as HitResult | undefined;
                            return (
                              <ScoreButton
                                key={arrowNum}
                                arrowIndex={arrowNum}
                                currentValue={val}
                                onChange={(newVal: HitResult) => handleArrowChange(p.id, arrowNum, newVal)}
                              />
                            );
                          })}
                        </div>
                      </td>
                      <td className="p-3 text-center font-mono font-black text-sm text-slate-900">
                        {calculateTotalHits(targetArrows)} / {currentStandConfig.arrowCount}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} className="py-12 text-center text-slate-400 font-medium">
                    第{selectedGroup}立に登録されている選手がいません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {statusMessage && (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-900 text-xs font-bold">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button
            type="button"
            onClick={handleSaveScores}
            disabled={isSaving || participantsInGroup.length === 0}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-6 py-2.5 rounded-xl shadow-xs"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> 保存中...
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5 mr-1.5 text-amber-400" /> 入力したスコアを保存する
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}