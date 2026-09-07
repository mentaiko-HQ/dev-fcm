/**
 * 【参加選手選択およびFCM通知トークン管理コンポーネント】
 * 
 * 役割:
 * - Firestore の `entries` コレクションから登録済みの参加選手一覧をリアルタイム取得。
 * - 選手本人が自身の名前（ゼッケン番号・所属団体・立配置付き）を選択。
 * - 選択された選手のID、立配置（第1立・第2立）、および FCM デバイストークンを Firestore `users/{uid}` に保存。
 * - localStorage により端末内に選手選択状態を永続化（ブラウザ再起動やリロード時も待機画面を自動復帰）。
 * - リロード時はトークン文字列のみを最新化し、既存の選手紐付け情報を破壊しない。
 * - 「選手を再選択する」ボタン押下時のみ明示的に紐付けを解除。
 * 
 * フールプルーフ設計:
 * - 選手未選択時の登録ボタン非活性化。
 * - 既に認証済みの場合は auth.currentUser を再利用し、signInAnonymously の無駄な多重実行を防止。
 * - 同姓同名の誤認を防止するため、「ゼッケン番号」「選手氏名」「所属団体」「立順」を一体化した表示形式を採用。
 * - 登録処理中の多重タップ防止（isSubmitting によるボタン非活性およびローディング表示）。
 * 
 * フェイルセーフ設計:
 * - auth/configuration-not-found（Firebaseコンソールの匿名認証未有効化）エラーを検知し、明確な対応指示を表示。
 * - Firestore切断時や購読エラー時でも画面クラッシュを防止する例外捕捉。
 * - 認証失敗時でもローカル状態（localStorage）を先行保持し、クライアント側の操作を維持。
 */

"use client";

import React, { useState, useEffect, useMemo } from "react";
import { collection, doc, onSnapshot, setDoc, serverTimestamp, deleteDoc, query, orderBy } from "firebase/firestore";
import { signInAnonymously, User } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { db, auth, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { requestFCMToken } from "@/lib/fcm";
import { Participant } from "@/types/participant";
import { StandRoundIndex } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, AlertCircle, Bell, RotateCcw, Loader2, ShieldCheck, UserCheck, Search } from "lucide-react";

const LOCAL_STORAGE_KEY_PARTICIPANT_ID = "kyudo_selected_participant_id";
const LOCAL_STORAGE_KEY_PARTICIPANT_NAME = "kyudo_selected_participant_name";
const LOCAL_STORAGE_KEY_BIB_NUMBER = "kyudo_selected_bib_number";

interface SelectedParticipantState {
  id: string;
  name: string;
  bibNumber: number;
  standAssignments: Record<StandRoundIndex, { standGroup: number; standOrder: 1 | 2 | 3 | 4 | 5 }>;
}

export function TeamSelectForm() {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>("");
  const [assignedParticipant, setAssignedParticipant] = useState<SelectedParticipantState | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  /**
   * 【フェイルセーフ ＆ フールプルーフ】
   * 認証ユーザーを取得する内部ヘルパー。
   * 既存のセッション（auth.currentUser）がある場合は再利用し、ない場合のみ signInAnonymously を実行する。
   */
  const getOrCreateAuthenticatedUser = async (): Promise<User | null> => {
    if (!auth) {
      throw new Error("Firebase Auth インスタンスが初期化されていません。");
    }

    // 既に認証済みのユーザーが存在する場合は再認証をスキップ（フールプルーフ）
    if (auth.currentUser) {
      return auth.currentUser;
    }

    try {
      const userCredential = await signInAnonymously(auth);
      return userCredential.user;
    } catch (err: unknown) {
      if (err instanceof FirebaseError) {
        if (err.code === "auth/configuration-not-found" || err.code === "auth/admin-restricted-operation") {
          console.error(
            "【Firebase認証設定エラー】Firebaseコンソールで「匿名認証（Anonymous）」が有効化されていません。" +
            "Firebase Console -> Authentication -> Sign-in method で「匿名」を有効にしてください。",
            err
          );
          throw new Error(
            "システム管理設定エラー: Firebaseコンソールで「匿名認証」が無効になっています。運営者へ連絡するか、管理画面の設定を確認してください。"
          );
        }
      }
      throw err;
    }
  };

  /**
   * 【Firestore entries コレクションのリアルタイム購読】
   * 登録済みの全参加選手データを取得し、ゼッケン番号順に整列。
   */
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setIsLoading(false);
      return;
    }

    const firestoreInstance = db;
    if (!firestoreInstance) return;

    const entriesQuery = query(collection(firestoreInstance, "entries"), orderBy("bibNumber", "asc"));
    const unsubscribe = onSnapshot(
      entriesQuery,
      (snapshot) => {
        const loaded: Participant[] = [];
        snapshot.forEach((docSnap) => {
          const raw = docSnap.data();
          const rawAssignments = raw.standAssignments || {};
          
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
            shosa: raw.shosa || "肌脱ぎ",
            rankTitle: raw.rankTitle || "段位は三段以下",
            staffRole: raw.staffRole || "無し",
            staffDutyShift: raw.staffDutyShift || "無し",
            checkInStatus: raw.checkInStatus || "UNCHECKED",
            checkInAt: raw.checkInAt || null,
            isStaffVolunteer: Boolean(raw.isStaffVolunteer),
            needsSupport: Boolean(raw.needsSupport),
            standAssignments: safeAssignments,
            progressStatus: raw.progressStatus || "WAITING",
            qualificationStatus: raw.qualificationStatus || "ACTIVE",
            stand1_arrows: raw.stand1_arrows || [],
            stand2_arrows: raw.stand2_arrows || [],
            stand3_arrows: raw.stand3_arrows || [],
            totalHits: raw.totalHits || 0,
            totalShots: raw.totalShots || 8,
            isPerfect: Boolean(raw.isPerfect),
            enkinRank: raw.enkinRank || null,
            finalRank: raw.finalRank || null,
            representativeName: raw.representativeName || "",
            representativeEmail: raw.representativeEmail || "",
            representativePhone: raw.representativePhone || "",
            representativeOrganization: raw.representativeOrganization || "",
            isPaid: Boolean(raw.isPaid),
            paidAt: raw.paidAt || null,
            notes: raw.notes || "",
            updatedAt: raw.updatedAt || undefined,
          });
        });

        setParticipants(loaded);
      },
      (error) => {
        console.error("【Firestore購読エラー】entries取得に失敗しました:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  /**
   * 【localStorage からの永続化状態復元およびトークン最新化】
   */
  useEffect(() => {
    const restoreSavedParticipant = async () => {
      try {
        const savedId = localStorage.getItem(LOCAL_STORAGE_KEY_PARTICIPANT_ID);
        const savedName = localStorage.getItem(LOCAL_STORAGE_KEY_PARTICIPANT_NAME);
        const savedBib = localStorage.getItem(LOCAL_STORAGE_KEY_BIB_NUMBER);

        if (savedId && savedName) {
          const target = participants.find((p) => p.id === savedId);
          const assignments = target?.standAssignments || {
            1: { standGroup: 1, standOrder: 1 },
            2: { standGroup: 1, standOrder: 1 },
            3: { standGroup: 1, standOrder: 1 },
          };

          setAssignedParticipant({
            id: savedId,
            name: savedName,
            bibNumber: savedBib ? Number(savedBib) : target?.bibNumber || 1,
            standAssignments: assignments,
          });

          // バックグラウンドで最新の FCM トークンを取得し、Firestore を更新
          if (isFirebaseConfigured && isFirestoreAvailable(db)) {
            try {
              const currentUser = await getOrCreateAuthenticatedUser();
              if (currentUser) {
                const uid = currentUser.uid;
                const tokenResult = await requestFCMToken();

                if (tokenResult.token) {
                  const userRef = doc(db, "users", uid);
                  await setDoc(
                    userRef,
                    {
                      userId: uid,
                      participantId: savedId,
                      playerName: savedName,
                      bibNumber: savedBib ? Number(savedBib) : target?.bibNumber || 1,
                      standAssignments: assignments,
                      fcmToken: tokenResult.token,
                      updatedAt: serverTimestamp(),
                    },
                    { merge: true }
                  );
                }
              }
            } catch (authErr) {
              console.warn("【バックグラウンド同期警告】認証同期をスキップしました:", authErr);
            }
          }
        }
      } catch (err: unknown) {
        console.error("【永続化復元エラー】詳細:", err);
      } finally {
        setIsLoading(false);
      }
    };

    if (participants.length > 0 || !isFirebaseConfigured) {
      restoreSavedParticipant();
    }
  }, [participants]);

  /**
   * 【絞り込み済み選手リスト】
   */
  const filteredParticipants = useMemo(() => {
    if (!searchQuery.trim()) return participants;
    const queryLower = searchQuery.toLowerCase().trim();
    return participants.filter(
      (p) =>
        p.name.toLowerCase().includes(queryLower) ||
        p.nameKana.toLowerCase().includes(queryLower) ||
        p.organization.toLowerCase().includes(queryLower) ||
        String(p.bibNumber).includes(queryLower)
    );
  }, [participants, searchQuery]);

  /**
   * 【選手選択 ＆ FCMトークン登録処理】
   */
  const handleRegisterParticipant = async () => {
    if (!selectedParticipantId) {
      setErrorMessage("ご自身の選手名を選択してください。");
      return;
    }

    const participant = participants.find((p) => p.id === selectedParticipantId);
    if (!participant) {
      setErrorMessage("選択された選手データが見つかりません。一覧を再確認してください。");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      let fcmToken: string | null = null;

      // 1. FCMトークン要求
      const tokenResult = await requestFCMToken();
      if (tokenResult.token) {
        fcmToken = tokenResult.token;
      } else if (tokenResult.status === "denied") {
        setErrorMessage("通知の権限が拒否されています。呼出通知を受信するにはブラウザ設定から通知を許可してください。");
      }

      // 2. 匿名認証セッションの取得（フェイルセーフ対応）
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const currentUser = await getOrCreateAuthenticatedUser();
        if (!currentUser) {
          throw new Error("ユーザー認証に失敗しました。");
        }

        const uid = currentUser.uid;
        const userRef = doc(db, "users", uid);

        await setDoc(
          userRef,
          {
            userId: uid,
            participantId: participant.id,
            playerName: participant.name,
            bibNumber: participant.bibNumber,
            organization: participant.organization,
            standAssignments: participant.standAssignments,
            fcmToken: fcmToken || null,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      // 3. localStorage への永続化
      localStorage.setItem(LOCAL_STORAGE_KEY_PARTICIPANT_ID, participant.id);
      localStorage.setItem(LOCAL_STORAGE_KEY_PARTICIPANT_NAME, participant.name);
      localStorage.setItem(LOCAL_STORAGE_KEY_BIB_NUMBER, String(participant.bibNumber));

      setAssignedParticipant({
        id: participant.id,
        name: participant.name,
        bibNumber: participant.bibNumber,
        standAssignments: participant.standAssignments,
      });

      setStatusMessage(`「No.${participant.bibNumber} ${participant.name}」選手として呼出通知の登録を完了しました。`);
    } catch (err: unknown) {
      console.error("【選手登録処理エラー】詳細ログ:", err);
      const displayMsg = err instanceof Error ? err.message : "登録処理中に通信エラーが発生しました。通信環境をご確認ください。";
      setErrorMessage(displayMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * 【選手再選択（登録解除・リセット）】
   */
  const handleResetParticipant = async () => {
    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db) && auth?.currentUser) {
        const userRef = doc(db, "users", auth.currentUser.uid);
        await deleteDoc(userRef);
      }
    } catch (err: unknown) {
      console.error("【登録解除警告】Firestore更新に失敗しましたが、端末ローカルをリセットします:", err);
    }

    localStorage.removeItem(LOCAL_STORAGE_KEY_PARTICIPANT_ID);
    localStorage.removeItem(LOCAL_STORAGE_KEY_PARTICIPANT_NAME);
    localStorage.removeItem(LOCAL_STORAGE_KEY_BIB_NUMBER);

    setAssignedParticipant(null);
    setSelectedParticipantId("");
    setStatusMessage("");
    setErrorMessage("");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  // 選手設定済み（呼出待機中）画面
  if (assignedParticipant) {
    const a1 = assignedParticipant.standAssignments?.[1] || { standGroup: 1, standOrder: 1 };
    const a2 = assignedParticipant.standAssignments?.[2] || { standGroup: 1, standOrder: 1 };

    return (
      <Card className="w-full border-slate-200 shadow-sm bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs">
            <ShieldCheck className="w-4 h-4" />
            <span>招集呼出 受信待機中</span>
          </div>
          <CardTitle className="text-lg font-bold text-slate-900 flex items-center justify-between pt-1">
            <span>{assignedParticipant.name} 選手</span>
            <span className="text-xs font-mono bg-slate-100 text-slate-900 px-2.5 py-1 rounded-md border border-slate-200 font-bold">
              ゼッケン No.{assignedParticipant.bibNumber}
            </span>
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            競技進行状況（2立前の入場時）に合わせてプッシュ通知が自動送信されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5 text-xs">
            <p className="font-bold text-slate-700">登録された立配置情報:</p>
            <div className="grid grid-cols-2 gap-2 font-semibold text-slate-800 pt-0.5">
              <div className="bg-white p-2 rounded border border-slate-200">
                <span className="text-[10px] text-slate-500 block">第1立 (午前一手)</span>
                第{a1.standGroup}立 - <strong className="text-slate-900">{a1.standOrder}番</strong>
              </div>
              <div className="bg-white p-2 rounded border border-slate-200">
                <span className="text-[10px] text-slate-500 block">第2立 (午後一手)</span>
                第{a2.standGroup}立 - <strong className="text-slate-900">{a2.standOrder}番</strong>
              </div>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 flex items-start gap-2.5">
            <Bell className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">端末の画面を閉じても通知を受信可能</p>
              <p className="text-slate-500 text-[11px] mt-0.5">
                通知が届かない場合は、ブラウザ設定から本サイトの通知許可をご確認ください。
              </p>
            </div>
          </div>

          {statusMessage && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 p-2.5 rounded border border-emerald-200 font-medium">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}
        </CardContent>
        <CardFooter className="pt-2 border-t border-slate-100 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResetParticipant}
            className="text-xs font-bold text-slate-700 border-slate-300 hover:bg-slate-50 shadow-2xs"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1 text-slate-500" />
            選手を再選択する
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // 選手未設定（選択フォーム）画面
  return (
    <Card className="w-full border-slate-200 shadow-sm bg-white">
      <CardHeader>
        <div className="flex items-center gap-2 text-slate-700 font-bold text-xs mb-1">
          <UserCheck className="w-4 h-4 text-slate-600" />
          <span>選手情報連携</span>
        </div>
        <CardTitle className="text-lg font-bold text-slate-900">
          出場選手選択
        </CardTitle>
        <CardDescription className="text-xs text-slate-500">
          ご自身の氏名を選択すると、各立の2立前に呼出プッシュ通知を受信できます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        
        {/* 選手検索フィルター入力欄（フールプルーフ） */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
            <span>選手検索・絞り込み</span>
            <span className="text-[10px] text-slate-400 font-normal">氏名・かな・所属で検索</span>
          </label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="例: 佐藤、さとう、福岡..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-slate-900 focus:outline-none text-slate-900"
            />
          </div>
        </div>

        {/* 選手選択プルダウン */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
            <span>参加選手氏名 <span className="text-red-600">*</span></span>
            <span className="text-[10px] text-slate-500 font-mono">該当 {filteredParticipants.length} 名</span>
          </label>
          <Select
            value={selectedParticipantId}
            onValueChange={(val: string) => {
              setSelectedParticipantId(val);
              setErrorMessage("");
            }}
          >
            <SelectTrigger className="w-full text-xs bg-white border-slate-300 h-10">
              <SelectValue placeholder="登録選手一覧から選択..." />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {filteredParticipants.length > 0 ? (
                filteredParticipants.map((p) => {
                  const a1 = p.standAssignments?.[1] || { standGroup: 1, standOrder: 1 };
                  const a2 = p.standAssignments?.[2] || { standGroup: 1, standOrder: 1 };
                  return (
                    <SelectItem key={p.id} value={p.id} className="text-xs py-2">
                      <div className="flex flex-col text-left">
                        <div className="font-bold text-slate-900">
                          No.{p.bibNumber} {p.name} <span className="text-[10px] text-slate-400 font-normal">({p.organization || "無所属"})</span>
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono">
                          第1立: 第{a1.standGroup}立-{a1.standOrder}番 / 第2立: 第{a2.standGroup}立-{a2.standOrder}番
                        </div>
                      </div>
                    </SelectItem>
                  );
                })
              ) : (
                <div className="p-4 text-center text-xs text-slate-400">
                  該当する選手が見つかりません。
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 p-2.5 rounded border border-red-200 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{errorMessage}</span>
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-2 border-t border-slate-100 flex justify-end">
        <Button
          type="button"
          disabled={isSubmitting || !selectedParticipantId}
          onClick={handleRegisterParticipant}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-5 shadow-xs disabled:opacity-50 h-10 w-full"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              登録中...
            </>
          ) : (
            "選手を登録して呼出通知を受信"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}