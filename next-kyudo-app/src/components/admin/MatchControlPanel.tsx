"use client";

import React, { useState, useEffect } from "react";
import { doc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";

interface MatchControlPanelProps {
  matchId: string;
}

interface MatchState {
  matchId: string;
  currentStandNumber: number;
  maxStandNumber: number;
  status: "進行中" | "競技終了" | "中断";
  updatedAt?: unknown;
}

const DEFAULT_MATCH_STATE: MatchState = {
  matchId: "match_2026_001",
  currentStandNumber: 1,
  maxStandNumber: 10,
  status: "進行中",
};

export function MatchControlPanel({ matchId = "match_2026_001" }: MatchControlPanelProps) {
  const [matchState, setMatchState] = useState<MatchState>(DEFAULT_MATCH_STATE);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  useEffect(() => {
    // フールプルーフ: 型ガードでFirestoreの利用可否を判定
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      return;
    }

    const matchDocRef = doc(db, "matches", matchId);

    const unsubscribe = onSnapshot(
      matchDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as MatchState;
          setMatchState(data);
        } else {
          // 初期ドキュメントが存在しない場合は作成
          setDoc(matchDocRef, {
            ...DEFAULT_MATCH_STATE,
            matchId: matchId,
            updatedAt: serverTimestamp(),
          }, { merge: true });
        }
      },
      (error) => {
        console.error("【エラーログ】試合進行状態の購読に失敗しました:", error);
      }
    );

    return () => unsubscribe();
  }, [matchId]);

  // 立を進める処理（Cloud Functions の FCM 招集通知トリガー）
  const handleAdvanceStand = async () => {
    // フールプルーフ: 最大立数超過の進行をブロック
    if (matchState.currentStandNumber >= matchState.maxStandNumber) {
      setStatusMessage("最終立に達しているため、これ以上進めることはできません。");
      return;
    }

    setIsProcessing(true);
    setStatusMessage("");

    const nextStandNumber = matchState.currentStandNumber + 1;
    const targetCallStand = nextStandNumber + 2; // 2立前呼出ルール

    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const matchDocRef = doc(db, "matches", matchId);
        await setDoc(
          matchDocRef,
          {
            currentStandNumber: nextStandNumber,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        // ローカルモック動作
        setMatchState((prev) => ({ ...prev, currentStandNumber: nextStandNumber }));
      }

      setStatusMessage(
        `第${nextStandNumber}立を開始しました。（第${targetCallStand}立へ呼出通知が自動送信されます）`
      );
    } catch (error: unknown) {
      console.error("【エラーログ】立の進行更新に失敗しました:", error);
      setStatusMessage("進行の更新に失敗しました。通信環境を確認してください。");
    } finally {
      setIsProcessing(false);
    }
  };

  // 立を1つ戻す処理（緊急対応用）
  const handleRevertStand = async () => {
    // フールプルーフ: 第1立未満への巻き戻しをブロック
    if (matchState.currentStandNumber <= 1) {
      return;
    }

    setIsProcessing(true);
    setStatusMessage("");

    const prevStandNumber = matchState.currentStandNumber - 1;

    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const matchDocRef = doc(db, "matches", matchId);
        await setDoc(
          matchDocRef,
          {
            currentStandNumber: prevStandNumber,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } else {
        setMatchState((prev) => ({ ...prev, currentStandNumber: prevStandNumber }));
      }

      setStatusMessage(`第${prevStandNumber}立へ戻しました。`);
    } catch (error: unknown) {
      console.error("【エラーログ】立の差し戻しに失敗しました:", error);
      setStatusMessage("更新に失敗しました。");
    } finally {
      setIsProcessing(false);
    }
  };

  const targetCallStandNumber = matchState.currentStandNumber + 2;

  return (
    <div className="w-full bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-3 gap-2">
        <div>
          <h3 className="font-bold text-slate-900 text-base">大会進行管理 / 招集制御コンソール</h3>
          <p className="text-xs text-slate-500">試合進行ドキュメントの更新に連動してCloud FunctionsがFCM通知を自動発報します</p>
        </div>
        <span className="text-xs bg-slate-100 text-slate-800 px-2.5 py-1 rounded font-semibold border border-slate-200">
          試合ID: {matchId}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 現在進行中の立 */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-md flex flex-col justify-between">
          <span className="text-xs font-semibold text-slate-500">現在競技中（射場）</span>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-black text-slate-900">第 {matchState.currentStandNumber} 立</span>
            <span className="text-xs text-slate-400">/ 全 {matchState.maxStandNumber} 立</span>
          </div>
          <span className="text-[11px] text-green-700 font-medium flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> 行射中・スコア記録中
          </span>
        </div>

        {/* 招集対象の立 */}
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-md flex flex-col justify-between">
          <span className="text-xs font-semibold text-amber-800">呼出対象（控席へ招集中）</span>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-black text-amber-900">第 {targetCallStandNumber} 立</span>
            <span className="text-xs text-amber-700">（2立前呼出）</span>
          </div>
          <span className="text-[11px] text-amber-800 font-medium flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> 自動プッシュ通知発報対象
          </span>
        </div>
      </div>

      {/* 進行操作ボタングループ */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Button
          onClick={handleAdvanceStand}
          disabled={isProcessing || matchState.currentStandNumber >= matchState.maxStandNumber}
          className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold h-12 text-sm shadow active:scale-95 transition-transform"
        >
          {isProcessing ? "処理中..." : `次の立へ進行（第 ${matchState.currentStandNumber + 1} 立開始）`}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
        <Button
          onClick={handleRevertStand}
          disabled={isProcessing || matchState.currentStandNumber <= 1}
          variant="outline"
          className="h-12 text-xs font-semibold text-slate-600 active:scale-95 transition-transform"
        >
          1立戻す
        </Button>
      </div>

      {statusMessage && (
        <p className="text-xs text-center text-slate-700 font-medium bg-slate-100 p-2 rounded border border-slate-200">
          {statusMessage}
        </p>
      )}
    </div>
  );
}