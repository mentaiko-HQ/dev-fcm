"use client";

import React, { useState, useEffect } from "react";
import { doc, setDoc, getDoc, collection, getDocs } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { requestFcmToken } from "@/lib/fcm";
import { Button } from "@/components/ui/button";

interface OptionItem {
  id: string;
  name: string;
  standNumber?: number;
}

export function TeamSelectForm() {
  const [options, setOptions] = useState<OptionItem[]>([]);
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
    } catch {
      setLocalUserId("device_fallback_" + Math.random().toString(36).substring(2, 15));
    }
  }, []);

  // entriesコレクションから個人選手枠をロード
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    let isMounted = true;

    const fetchOptions = async () => {
      try {
        const entriesSnap = await getDocs(collection(firestoreInstance, "entries"));
        const loaded: OptionItem[] = [];

        entriesSnap.forEach((docSnap) => {
          const d = docSnap.data();
          loaded.push({
            id: docSnap.id,
            name: `${d.playerName} (第${d.standNumber}立 ${d.position} / ${d.division})`,
            standNumber: typeof d.standNumber === "number" ? d.standNumber : undefined,
          });
        });

        loaded.sort((a, b) => (a.standNumber || 0) - (b.standNumber || 0));
        if (isMounted && loaded.length > 0) {
          setOptions(loaded);
        }
      } catch (error) {
        console.warn("【警告】選手選択肢のロード失敗:", error);
      }
    };

    fetchOptions();

    return () => {
      isMounted = false;
    };
  }, []);

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
          if (data.selectedEntryId) {
            setSelectedId(data.selectedEntryId);
            const found = options.find((o) => o.id === data.selectedEntryId);
            setCurrentRegisteredName(found?.name || data.selectedEntryId);
          }
          if (data.fcmToken) {
            setCurrentRegisteredToken(data.fcmToken);
          }
        }
      } catch (error) {
        console.error("【エラーログ】ユーザー設定復元失敗:", error);
      }
    };

    fetchExisting();

    return () => {
      isMounted = false;
    };
  }, [localUserId, options]);

  const handleRegister = async () => {
    if (!selectedId) {
      setStatusMessage("個人選手を選択してください。");
      return;
    }

    const selectedOption = options.find((o) => o.id === selectedId);

    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setCurrentRegisteredName(selectedOption?.name || selectedId);
      setStatusMessage("【ローカル】通知対象選手を選択しました。");
      return;
    }

    const firestoreInstance = db;
    setIsProcessing(true);
    setStatusMessage("FCM通知登録処理中...");

    try {
      const token = await requestFcmToken();
      const userDocRef = doc(firestoreInstance, "users", localUserId);

      await setDoc(
        userDocRef,
        {
          userId: localUserId,
          selectedEntryId: selectedId,
          fcmToken: token || null,
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      const entryDocRef = doc(firestoreInstance, "entries", selectedId);
      await setDoc(entryDocRef, { userId: localUserId }, { merge: true });

      setCurrentRegisteredName(selectedOption?.name || selectedId);
      setCurrentRegisteredToken(token);
      setStatusMessage(
        token
          ? "【登録完了】出番の2立前にお手元の端末へ招集通知（音・振動）が届きます。"
          : "選手登録を完了しました（プッシュ通知は未許可です）。"
      );
    } catch (error: unknown) {
      console.error("【エラーログ】選手登録エラー:", error);
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
        <h2 className="text-lg font-bold text-slate-800 mb-1">選手選択 / 招集通知設定</h2>
        <p className="text-sm text-slate-600">
          ご自身の選手枠を選択して登録すると、出番2立前の呼出プッシュ通知（音・振動）が届きます。
        </p>
      </div>

      {currentRegisteredName && (
        <div className="p-3 bg-slate-50 border border-slate-200 rounded text-sm text-slate-700 space-y-1">
          <div>
            登録選手: <span className="font-semibold text-slate-900">{currentRegisteredName}</span>
          </div>
          <div className="text-[11px] text-slate-500">
            通知状態:{" "}
            {currentRegisteredToken ? (
              <span className="text-green-600 font-bold">有効（プッシュ受信可能）</span>
            ) : (
              <span className="text-amber-600 font-bold">未取得（通知許可が必要）</span>
            )}
          </div>
        </div>
      )}

      <div>
        <label htmlFor="entry-select" className="block text-sm font-medium text-slate-700 mb-1">
          出場選手一覧
        </label>
        <select
          id="entry-select"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={isProcessing}
          className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-slate-900 focus:outline-none text-sm bg-white"
        >
          <option value="">-- 選手を選択してください --</option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={handleRegister}
          disabled={isProcessing || !selectedId}
          className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs"
        >
          {isProcessing ? "処理中..." : "この選手で端末登録 / 更新"}
        </Button>
        {currentRegisteredName && (
          <Button
            onClick={handleReset}
            variant="outline"
            disabled={isProcessing}
            className="text-xs"
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