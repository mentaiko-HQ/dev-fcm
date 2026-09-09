/**
 * 【主要機能要件1: チーム選択およびWebプッシュ通知（FCM）トークン管理コンポーネント】
 * 
 * 役割:
 * - Firestore `teams` コレクションを購読してチーム一覧を表示。
 * - 参加者がチームを選択した際、FCMトークンとチームIDを `users/{userId}` に保存。
 * - リロード等を行っても localStorage と Firestore から紐付けを自動復元。
 * - 自動更新時は既存のチーム選択情報を破壊せず、最新のトークン文字列のみを上書き。
 * - 「所属チームを変更する」ボタン押下時のみ明示的に紐付けを解除・リセット。
 * 
 * フールプルーフ設計（操作ミスの入口遮断）:
 * - FCMTokenResult から安全に `.token`（string | null）を抽出して代入し、型不整合（TS2322）を根絶。
 * - チーム未選択時は登録ボタンを非活性化。
 * - 登録処理中の多重クリック・二重送信防止（isSubmitting）。
 * - 認証セッション（auth.currentUser）の事前確認と自動取得。
 * 
 * フェイルセーフ設計（障害時の安全縮退）:
 * - Firestore接続不能時やデータ空時はフォールバックデータ（FALLBACK_TEAMS）で表示を維持。
 * - 通知拒否やトークン取得失敗時でもチーム選択登録自体は完遂させ、ユーザーへの案内メッセージを表示。
 * - 登録解除（deleteDoc）失敗時でも、端末ローカル（localStorage）は確実にクリアしてUIの膠着を防止。
 */

"use client";

import React, { useState, useEffect } from "react";
import { collection, doc, onSnapshot, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { signInAnonymously } from "firebase/auth";
import { db, auth, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { requestFCMToken, FCMTokenResult } from "@/lib/fcm";
import { Team } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, AlertCircle, Bell, RotateCcw, Loader2, ShieldCheck, Users } from "lucide-react";

// 通信切断時・データ未投入時の安全側フォールバックデータ
const FALLBACK_TEAMS: Team[] = [
  { id: "team_001", name: "博多弓道会 Aチーム", organization: "福岡支部", standGroup: 1 },
  { id: "team_002", name: "博多弓道会 Bチーム", organization: "福岡支部", standGroup: 2 },
  { id: "team_003", name: "春日弓友会", organization: "筑紫支部", standGroup: 3 },
  { id: "team_004", name: "福岡武道館クラブ", organization: "福岡支部", standGroup: 4 },
];

const LOCAL_STORAGE_KEY_TEAM_ID = "kyudo_selected_team_id";
const LOCAL_STORAGE_KEY_TEAM_NAME = "kyudo_selected_team_name";
const LOCAL_STORAGE_KEY_STAND_GROUP = "kyudo_selected_stand_group";

export function TeamSelectForm() {
  const [teams, setTeams] = useState<Team[]>(FALLBACK_TEAMS);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [assignedTeam, setAssignedTeam] = useState<{ id: string; name: string; standGroup: number } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  // 1. teams コレクションのリアルタイム購読
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setIsLoading(false);
      return;
    }

    const firestoreInstance = db;
    if (!firestoreInstance) return;

    const teamsRef = collection(firestoreInstance, "teams");
    const unsubscribe = onSnapshot(
      teamsRef,
      (snapshot) => {
        if (!snapshot.empty) {
          const loaded: Team[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            loaded.push({
              id: docSnap.id,
              name: typeof data.name === "string" ? data.name : "名称未設定チーム",
              organization: typeof data.organization === "string" ? data.organization : "一般",
              standGroup: typeof data.standGroup === "number" ? data.standGroup : 1,
            });
          });
          loaded.sort((a, b) => a.standGroup - b.standGroup);
          setTeams(loaded);
        }
      },
      (error) => {
        console.error("【エラーログ】teamsコレクション購読失敗:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  // 2. localStorage からの永続化復元およびトークン自動最新化
  useEffect(() => {
    const restoreSavedTeam = async () => {
      try {
        const savedId = localStorage.getItem(LOCAL_STORAGE_KEY_TEAM_ID);
        const savedName = localStorage.getItem(LOCAL_STORAGE_KEY_TEAM_NAME);
        const savedGroup = localStorage.getItem(LOCAL_STORAGE_KEY_STAND_GROUP);

        if (savedId && savedName) {
          const groupNum = savedGroup ? Number(savedGroup) : 1;
          setAssignedTeam({ id: savedId, name: savedName, standGroup: groupNum });

          // バックグラウンドで最新FCMトークンを取得し、トークン文字列のみ上書き更新
          if (isFirebaseConfigured && isFirestoreAvailable(db) && auth) {
            let uid = auth.currentUser?.uid;
            if (!uid) {
              const cred = await signInAnonymously(auth);
              uid = cred.user.uid;
            }

            // フールプルーフ: FCMTokenResult から安全に token 文字列を取り出す
            const tokenResult: FCMTokenResult = await requestFCMToken();
            if (tokenResult.token && uid) {
              const userRef = doc(db, "users", uid);
              await setDoc(
                userRef,
                {
                  userId: uid,
                  teamId: savedId,
                  teamName: savedName,
                  standGroup: groupNum,
                  fcmToken: tokenResult.token,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            }
          }
        }
      } catch (err) {
        console.error("【エラーログ】永続化復元例外:", err);
      } finally {
        setIsLoading(false);
      }
    };

    restoreSavedTeam();
  }, []);

  // 3. チーム登録・FCMトークン保存処理
  const handleRegisterTeam = async () => {
    if (!selectedTeamId) {
      setErrorMessage("所属するチームを選択してください。");
      return;
    }

    const team = teams.find((t) => t.id === selectedTeamId);
    if (!team) {
      setErrorMessage("無効なチームが選択されました。一覧を再確認してください。");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setStatusMessage("");

    try {
      let fcmToken: string | null = null;

      // フールプルーフ: FCMTokenResult 型から token 文字列のみを抽出
      const tokenResult: FCMTokenResult = await requestFCMToken();
      if (tokenResult.token) {
        fcmToken = tokenResult.token;
      } else if (tokenResult.status === "denied") {
        setErrorMessage("通知の権限が拒否されています。呼出通知を受信するにはブラウザ設定から通知を許可してください。");
      }

      // Firestore への保存実行
      if (isFirebaseConfigured && isFirestoreAvailable(db) && auth) {
        let uid = auth.currentUser?.uid;
        if (!uid) {
          const cred = await signInAnonymously(auth);
          uid = cred.user.uid;
        }

        const userRef = doc(db, "users", uid);
        await setDoc(
          userRef,
          {
            userId: uid,
            teamId: team.id,
            teamName: team.name,
            standGroup: team.standGroup,
            fcmToken: fcmToken,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      // 端末ローカル（localStorage）への永続化
      localStorage.setItem(LOCAL_STORAGE_KEY_TEAM_ID, team.id);
      localStorage.setItem(LOCAL_STORAGE_KEY_TEAM_NAME, team.name);
      localStorage.setItem(LOCAL_STORAGE_KEY_STAND_GROUP, String(team.standGroup));

      setAssignedTeam({ id: team.id, name: team.name, standGroup: team.standGroup });
      setStatusMessage(`「${team.name}」の招集通知対象として登録を完了しました。`);
    } catch (err) {
      console.error("【エラーログ】チーム登録例外:", err);
      setErrorMessage("登録処理中に通信エラーが発生しました。ネットワーク環境をご確認ください。");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 4. チーム再選択（明示的リセット）
  const handleResetTeam = async () => {
    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db) && auth?.currentUser) {
        const userRef = doc(db, "users", auth.currentUser.uid);
        await deleteDoc(userRef);
      }
    } catch (err) {
      console.warn("【警告ログ】Firestore削除スキップ:", err);
    }

    // フェイルセーフ: 通信成否に関わらず端末側の保持情報は確実に破棄
    localStorage.removeItem(LOCAL_STORAGE_KEY_TEAM_ID);
    localStorage.removeItem(LOCAL_STORAGE_KEY_TEAM_NAME);
    localStorage.removeItem(LOCAL_STORAGE_KEY_STAND_GROUP);

    setAssignedTeam(null);
    setSelectedTeamId("");
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

  // チーム選択済み・待機中画面
  if (assignedTeam) {
    return (
      <Card className="w-full max-w-md mx-auto border-slate-200 shadow-sm bg-white">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs">
            <ShieldCheck className="w-4 h-4" />
            <span>招集呼出 受信待機中</span>
          </div>
          <CardTitle className="text-lg font-bold text-slate-900 flex items-center justify-between pt-1">
            <span>{assignedTeam.name}</span>
            <span className="text-xs font-mono bg-slate-100 text-slate-900 px-2.5 py-1 rounded-md border border-slate-200 font-bold">
              第{assignedTeam.standGroup}立
            </span>
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            競技進行状況（2立前の入場時）に合わせてプッシュ通知が自動送信されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 flex items-start gap-2.5">
            <Bell className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">端末の画面を閉じても通知を受信可能</p>
              <p className="text-slate-500 text-[11px] mt-0.5">
                通知が届かない場合は、ブラウザの設定から本サイトの通知許可をご確認ください。
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
            onClick={handleResetTeam}
            className="text-xs font-bold text-slate-700 border-slate-300 hover:bg-slate-50 shadow-2xs"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1 text-slate-500" />
            所属チームを変更する
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // チーム未選択画面
  return (
    <Card className="w-full max-w-md mx-auto border-slate-200 shadow-sm bg-white">
      <CardHeader>
        <div className="flex items-center gap-2 text-slate-700 font-bold text-xs mb-1">
          <Users className="w-4 h-4" />
          <span>所属選択</span>
        </div>
        <CardTitle className="text-lg font-bold text-slate-900">
          出場チーム選択
        </CardTitle>
        <CardDescription className="text-xs text-slate-500">
          所属チームを選択すると、2立前に呼出プッシュ通知を受信できます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700">所属チーム名</label>
          <Select
            value={selectedTeamId}
            onValueChange={(val: string) => {
              setSelectedTeamId(val);
              setErrorMessage("");
            }}
          >
            <SelectTrigger className="w-full text-xs bg-white border-slate-300">
              <SelectValue placeholder="チーム一覧から選択..." />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id} className="text-xs">
                  {t.name}（{t.organization}）- 第{t.standGroup}立
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {errorMessage && (
          <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 p-2.5 rounded border border-red-200 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}
      </CardContent>
      <CardFooter className="pt-2 border-t border-slate-100 flex justify-end">
        <Button
          type="button"
          disabled={isSubmitting || !selectedTeamId}
          onClick={handleRegisterTeam}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs px-5 shadow-xs disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              登録中...
            </>
          ) : (
            "チームを登録して通知を受信"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}