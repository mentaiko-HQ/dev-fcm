"use client";

import React, { useState, useEffect } from "react";
import { doc, setDoc, getDoc, collection, getDocs } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { requestFcmToken } from "@/lib/fcm";
import { Button } from "@/components/ui/button";
import { Users, User } from "lucide-react";

interface OptionItem {
  id: string;
  name: string;
  type: "TEAM" | "INDIVIDUAL";
  standNumber?: number;
}

// 静的フォールバックデータ
const FALLBACK_OPTIONS: OptionItem[] = [
  { id: "team_01", name: "第一立（福岡弓道倶楽部A）", type: "TEAM", standNumber: 1 },
  { id: "team_02", name: "第二立（博多紅葉会）", type: "TEAM", standNumber: 2 },
  { id: "team_03", name: "第三立（春日白鷺会）", type: "TEAM", standNumber: 3 },
  { id: "p_indiv_01", name: "個人参加枠: 小林 葵 (第2立 落)", type: "INDIVIDUAL", standNumber: 2 },
];

export function TeamSelectForm() {
  const [options, setOptions] = useState<OptionItem[]>(FALLBACK_OPTIONS);
  const [selectedId, setSelectedId] = useState<string>("");
  const [currentRegisteredName, setCurrentRegisteredName] = useState<string | null>(null);
  const [currentRegisteredToken, setCurrentRegisteredToken] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [localUserId, setLocalUserId] = useState<string>("");

  useEffect(() => {
    try {
      let uid = localStorage.getItem("kyudo_device_uid");
      if (!uid) {
        uid = "device_" + Math.random().toString(36).substring(2, 15);
        localStorage.setItem("kyudo_device_uid", uid);
      }
      setLocalUserId(uid);
    } catch (storageError) {
      console.error("【エラーログ】localStorageアクセス失敗:", storageError);
      setLocalUserId("device_fallback_" + Math.random().toString(36).substring(2, 15));
    }
  }, []);

  // teamsコレクションとentries(個人枠)から選択肢を動的ロード
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    let isMounted = true;

    const fetchOptions = async () => {
      try {
        const [teamsSnap, entriesSnap] = await Promise.all([
          getDocs(collection(firestoreInstance, "teams")),
          getDocs(collection(firestoreInstance, "entries")),
        ]);

        const loaded: OptionItem[] = [];

        teamsSnap.forEach((docSnap) => {
          const d = docSnap.data();
          loaded.push({
            id: docSnap.id,
            name: typeof d.name === "string" ? d.name : docSnap.id,
            type: "TEAM",
            standNumber: typeof d.standNumber === "number" ? d.standNumber : undefined,
          });
        });

        entriesSnap.forEach((docSnap) => {
          const d = docSnap.data();
          if (d.entryType === "INDIVIDUAL") {
            loaded.push({
              id: docSnap.id,
              name: `個人参加: ${d.playerName} (第${d.standNumber}立 ${d.position})`,
              type: "INDIVIDUAL",
              standNumber: typeof d.standNumber === "number" ? d.standNumber : undefined,
            });
          }
        });

        loaded.sort((a, b) => (a.standNumber || 0) - (b.standNumber || 0));
        if (isMounted && loaded.length > 0) {
          setOptions(loaded);
        }
      } catch (error) {
        console.warn("【警告】選択肢データの取得に失敗しました:", error);
      }
    };

    fetchOptions();

    return () => {
      isMounted = false;
    };
  }, []);

  // 既存のユーザー登録情報を復元
  useEffect(() => {
    if (!localUserId || !isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    let isMounted = true;

    const fetchExisting = async () => {
      try {
        const userDocRef = doc(firestoreInstance, "users", localUserId);
        const snapshot = await getDoc(userDocRef);

        if (snapshot.exists() && isMounted) {
          const data = snapshot.data();
          const targetId = data.selectedTeamId || data.selectedEntryId;
          if (targetId) {
            setSelectedId(targetId);
            const found = options.find((o) => o.id === targetId);
            setCurrentRegisteredName(found?.name || targetId);
          }
          if (data.fcmToken) {
            setCurrentRegisteredToken(data.fcmToken);
          }
        }
      } catch (error) {
        console.error("【エラーログ】ユーザー設定の復元失敗:", error);
      }
    };

    fetchExisting();

    return () => {
      isMounted = false;
    };
  }, [localUserId, options]);

  const handleRegister = async () => {
    if (!selectedId) {
      setStatusMessage("チームまたは個人枠を選択してください。");
      return;
    }

    const selectedOption = options.find((o) => o.id === selectedId);
    const isTeam = selectedOption?.type === "TEAM";

    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setCurrentRegisteredName(selectedOption?.name || selectedId);
      setStatusMessage("【ローカルモード】通知枠を選択しました。");
      return;
    }

    const firestoreInstance = db;
    setIsProcessing(true);
    setStatusMessage("通知権限の確認およびFCM登録処理中...");

    try {
      const token = await requestFcmToken();
      const userDocRef = doc(firestoreInstance, "users", localUserId);

      await setDoc(
        userDocRef,
        {
          userId: localUserId,
          selectedTeamId: isTeam ? selectedId : null,
          selectedEntryId: !isTeam ? selectedId : null,
          entryType: isTeam ? "TEAM" : "INDIVIDUAL",
          fcmToken: token || null,
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      // 個人参加の場合はentriesドキュメント側にもuserIdを紐付け（個別通知フェイルセーフ）
      if (!isTeam) {
        const entryDocRef = doc(firestoreInstance, "entries", selectedId);
        await setDoc(entryDocRef, { userId: localUserId }, { merge: true });
      }

      setCurrentRegisteredName(selectedOption?.name || selectedId);
      setCurrentRegisteredToken(token);
      setStatusMessage(
        token
          ? "【登録完了】FCMトークンが登録されました。出番の2立前に招集通知（音・振動）が届きます。"
          : "登録しました（※ブラウザの通知許可がオフのためプッシュ通知は届きません）。"
      );
    } catch (error: unknown) {
      console.error("【エラーログ】登録処理エラー:", error);
      setStatusMessage("登録に失敗しました。");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReset = async () => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setCurrentRegisteredName(null);
      setCurrentRegisteredToken(null);
      setSelectedId("");
      setStatusMessage("紐付けを解除しました。");
      return;
    }

    const firestoreInstance = db;
    setIsProcessing(true);

    try {
      const userDocRef = doc(firestoreInstance, "users", localUserId);
      await setDoc(
        userDocRef,
        {
          selectedTeamId: null,
          selectedEntryId: null,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      setCurrentRegisteredName(null);
      setCurrentRegisteredToken(null);
      setSelectedId("");
      setStatusMessage("通知の紐付けを解除しました。");
    } catch (error) {
      console.error("【エラーログ】解除エラー:", error);
      setStatusMessage("解除に失敗しました。");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full max-w-md p-6 bg-white border border-slate-200 rounded-lg shadow-sm space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-1">参加枠選択 / 招集通知設定</h2>
        <p className="text-sm text-slate-600">
          団体チームまたは個人枠を選択して登録すると、この端末に出番2立前の呼出プッシュ通知（音・振動）が届きます。
        </p>
      </div>

      {currentRegisteredName && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded text-sm text-slate-700 space-y-1">
          <div>
            現在登録中: <span className="font-semibold text-slate-900">{currentRegisteredName}</span>
          </div>
          <div className="text-[11px] text-slate-500">
            端末状態:{" "}
            {currentRegisteredToken ? (
              <span className="text-green-600 font-bold">有効（プッシュ通知受信可能）</span>
            ) : (
              <span className="text-amber-600 font-bold">未取得（通知許可が必要）</span>
            )}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="entry-select" className="block text-sm font-medium text-slate-700 mb-1">
          所属団体・個人枠選択
        </label>
        <select
          id="entry-select"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={isProcessing}
          className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-slate-900 focus:outline-none text-sm bg-white"
        >
          <option value="">-- 選択してください --</option>
          <optgroup label="団体戦チーム">
            {options.filter((o) => o.type === "TEAM").map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="個人参加枠">
            {options.filter((o) => o.type === "INDIVIDUAL").map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={handleRegister}
          disabled={isProcessing || !selectedId}
          className="flex-1"
        >
          {isProcessing ? "処理中..." : "この端末を登録 / 更新"}
        </Button>
        {currentRegisteredName && (
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