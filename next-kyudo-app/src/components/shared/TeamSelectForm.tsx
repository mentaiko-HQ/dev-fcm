"use client";

import React, { useState, useEffect } from "react";
import { doc, setDoc, getDoc, collection, getDocs } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { requestFcmToken } from "@/lib/fcm";
import { Button } from "@/components/ui/button";

interface TeamOption {
  id: string;
  name: string;
  standNumber?: number;
}

// フェイルセーフ: Firestore接続失敗時・データ不在時の静的フォールバックデータ
const FALLBACK_TEAMS: TeamOption[] = [
  { id: "team_01", name: "第一立（福岡弓道倶楽部A）", standNumber: 1 },
  { id: "team_02", name: "第二立（博多紅葉会）", standNumber: 2 },
  { id: "team_03", name: "第三立（春日白鷺会）", standNumber: 3 },
  { id: "team_04", name: "第四立（筑紫野葵会）", standNumber: 4 },
];

export function TeamSelectForm() {
  const [teams, setTeams] = useState<TeamOption[]>(FALLBACK_TEAMS);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [currentRegisteredTeam, setCurrentRegisteredTeam] = useState<string | null>(null);
  const [currentRegisteredToken, setCurrentRegisteredToken] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [localUserId, setLocalUserId] = useState<string>("");

  // フールプルーフ & フェイルセーフ: ハイドレーション不一致を防ぐためマウント後にlocalStorageからデバイスUIDを取得
  useEffect(() => {
    try {
      let uid = localStorage.getItem("kyudo_device_uid");
      if (!uid) {
        uid = "device_" + Math.random().toString(36).substring(2, 15);
        localStorage.setItem("kyudo_device_uid", uid);
      }
      setLocalUserId(uid);
    } catch (storageError) {
      console.error("【エラーログ】localStorageへのアクセスに失敗しました:", storageError);
      setLocalUserId("device_fallback_" + Math.random().toString(36).substring(2, 15));
    }
  }, []);

  // Firestoreからteamsコレクションを動的取得
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    let isMounted = true;

    const fetchTeams = async () => {
      try {
        const teamsColRef = collection(firestoreInstance, "teams");
        const snapshot = await getDocs(teamsColRef);

        if (!snapshot.empty && isMounted) {
          const loadedTeams: TeamOption[] = [];
          snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            loadedTeams.push({
              id: docSnap.id,
              name: typeof data.name === "string" ? data.name : docSnap.id,
              standNumber: typeof data.standNumber === "number" ? data.standNumber : undefined,
            });
          });

          loadedTeams.sort((a, b) => (a.standNumber || 0) - (b.standNumber || 0));
          setTeams(loadedTeams);
        }
      } catch (error) {
        console.warn("【警告】teamsコレクションの取得に失敗しました。フォールバックデータを使用します:", error);
      }
    };

    fetchTeams();

    return () => {
      isMounted = false;
    };
  }, []);

  // 既存のユーザー登録情報を復元
  useEffect(() => {
    if (!localUserId || !isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    let isMounted = true;

    const fetchExistingRegistration = async () => {
      try {
        const userDocRef = doc(firestoreInstance, "users", localUserId);
        const snapshot = await getDoc(userDocRef);

        if (snapshot.exists() && isMounted) {
          const data = snapshot.data();
          if (data && typeof data.selectedTeamId === "string" && data.selectedTeamId.length > 0) {
            setCurrentRegisteredTeam(data.selectedTeamId);
            setSelectedTeamId(data.selectedTeamId);
          }
          if (data && typeof data.fcmToken === "string" && data.fcmToken.length > 0) {
            setCurrentRegisteredToken(data.fcmToken);
          }
        }
      } catch (error) {
        console.error("【エラーログ】既存チーム情報の復元に失敗しました:", error);
      }
    };

    fetchExistingRegistration();

    return () => {
      isMounted = false;
    };
  }, [localUserId]);

  const handleRegister = async () => {
    // フールプルーフ: 未選択状態での送信を早期ブロック
    if (!selectedTeamId) {
      setStatusMessage("チームを選択してください。");
      return;
    }

    // フェイルセーフ: Firebase未接続環境ではローカル状態のみ更新して安全に動作継続
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setCurrentRegisteredTeam(selectedTeamId);
      setStatusMessage("【ローカルモード】チームを選択しました（Firebase未接続のためローカル保持）。");
      return;
    }

    const firestoreInstance = db;
    setIsProcessing(true);
    setStatusMessage("端末通知の許可確認および登録を処理中...");

    try {
      const token = await requestFcmToken();
      const userDocRef = doc(firestoreInstance, "users", localUserId);

      await setDoc(
        userDocRef,
        {
          userId: localUserId,
          selectedTeamId: selectedTeamId,
          fcmToken: token || null,
          updatedAt: Date.now(),
        },
        { merge: true } // 既存フィールドを破壊しないマージ書き込み
      );

      setCurrentRegisteredTeam(selectedTeamId);
      setCurrentRegisteredToken(token);
      setStatusMessage(
        token
          ? "【端末登録完了】FCMトークンが正常に登録されました。2立前に呼出通知が届きます。"
          : "チームを登録しました（※FCMトークンが未取得のため通知は無効です。ブラウザの通知許可をご確認ください）。"
      );
    } catch (error: unknown) {
      console.error("【エラーログ】チーム登録・通知設定中にエラーが発生しました:", error);
      setStatusMessage("登録処理に失敗しました。通信環境をご確認ください。");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = async () => {
    // フェイルセーフ: Firebase未接続時のローカル解除対応
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setCurrentRegisteredTeam(null);
      setCurrentRegisteredToken(null);
      setSelectedTeamId("");
      setStatusMessage("【ローカルモード】チームの紐付けを解除しました。");
      return;
    }

    const firestoreInstance = db;
    setIsProcessing(true);
    setStatusMessage("登録解除中...");

    try {
      const userDocRef = doc(firestoreInstance, "users", localUserId);
      await setDoc(
        userDocRef,
        {
          selectedTeamId: null,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      setCurrentRegisteredTeam(null);
      setCurrentRegisteredToken(null);
      setSelectedTeamId("");
      setStatusMessage("チームの紐付けを解除しました。");
    } catch (error: unknown) {
      console.error("【エラーログ】チーム紐付け解除中にエラーが発生しました:", error);
      setStatusMessage("解除処理に失敗しました。");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full max-w-md p-6 bg-white border border-slate-200 rounded-lg shadow-sm space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-1">参加チーム選択 / 招集通知設定</h2>
        <p className="text-sm text-slate-600">
          所属する立（チーム）を選択して登録すると、この端末に出番の2立前の呼出プッシュ通知が届きます。
        </p>
      </div>

      {currentRegisteredTeam && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded text-sm text-slate-700 space-y-1">
          <div>
            現在登録中:{" "}
            <span className="font-semibold text-slate-900">
              {teams.find((t) => t.id === currentRegisteredTeam)?.name || currentRegisteredTeam}
            </span>
          </div>
          <div className="text-[11px] text-slate-500">
            FCMトークン（端末状態）:{" "}
            {currentRegisteredToken ? (
              <span className="text-green-600 font-bold">有効（プッシュ通知受信可能）</span>
            ) : (
              <span className="text-amber-600 font-bold">未取得（通知不可 / ブラウザ許可が必要）</span>
            )}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="team-select" className="block text-sm font-medium text-slate-700 mb-1">
          立・チーム選択
        </label>
        <select
          id="team-select"
          value={selectedTeamId}
          onChange={(e) => setSelectedTeamId(e.target.value)}
          disabled={isProcessing}
          className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-slate-900 focus:outline-none text-sm bg-white"
        >
          <option value="">-- チームを選択してください --</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={handleRegister}
          disabled={isProcessing || !selectedTeamId}
          className="flex-1"
        >
          {isProcessing ? "処理中..." : "この端末をチームに登録 / 更新"}
        </Button>
        {currentRegisteredTeam && (
          <Button
            onClick={handleReset}
            variant="outline"
            disabled={isProcessing}
          >
            解除
          </Button>
        )}
      </div>

      {statusMessage && (
        <p className="text-xs text-center text-slate-600 font-medium bg-slate-50 p-2 rounded border border-slate-200">
          {statusMessage}
        </p>
      )}
    </div>
  );
}