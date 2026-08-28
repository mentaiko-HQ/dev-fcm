"use client";

import React, { useState, useEffect } from "react";
import { doc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { ArrowRight, AlertTriangle, CheckCircle2, Database } from "lucide-react";

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
  currentStandNumber: 0,
  maxStandNumber: 10,
  status: "進行中",
};

// 初期シード用チームデータ定義（フールプルーフ: 型定義に基づき厳密なnumber型として定義）
const INITIAL_TEAMS_DATA = [
  { id: "team_01", name: "第一立（福岡弓道倶楽部A）", standNumber: 1, division: "一般男子" },
  { id: "team_02", name: "第二立（博多紅葉会）", standNumber: 2, division: "一般女子" },
  { id: "team_03", name: "第三立（春日白鷺会）", standNumber: 3, division: "シニア男子" },
  { id: "team_04", name: "第四立（筑紫野葵会）", standNumber: 4, division: "シニア女子" },
];

export function MatchControlPanel({ matchId = "match_2026_001" }: MatchControlPanelProps) {
  const [matchState, setMatchState] = useState<MatchState>(DEFAULT_MATCH_STATE);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSeeding, setIsSeeding] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  useEffect(() => {
    // フールプルーフ: 型ガードでFirestoreの利用可否を判定
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      return;
    }

    const firestoreInstance = db;
    const matchDocRef = doc(firestoreInstance, "matches", matchId);

    const unsubscribe = onSnapshot(
      matchDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as MatchState;
          setMatchState(data);
        } else {
          // 初期ドキュメントが存在しない場合は自動作成（フェイルセーフ）
          setDoc(
            matchDocRef,
            {
              ...DEFAULT_MATCH_STATE,
              matchId: matchId,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      },
      (error: unknown) => {
        console.error("【エラーログ】試合進行状態の購読に失敗しました:", error);
      }
    );

    return () => unsubscribe();
  }, [matchId]);

  // Firestore初期コレクション（teams, matches, entries）の一括投入処理
  const handleSeedFirestore = async () => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setStatusMessage("Firebase環境変数が設定されていません。");
      return;
    }

    const firestoreInstance = db;
    setIsSeeding(true);
    setStatusMessage("Firestore初期データ（teams, matches, entries）を書き込み中...");

    try {
      // 1. teams コレクションの初期化
      for (const team of INITIAL_TEAMS_DATA) {
        const teamDocRef = doc(firestoreInstance, "teams", team.id);
        await setDoc(
          teamDocRef,
          {
            name: team.name,
            standNumber: Number(team.standNumber),
            division: team.division,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
      }

      // 2. matches コレクションの初期化
      const matchDocRef = doc(firestoreInstance, "matches", matchId);
      await setDoc(
        matchDocRef,
        {
          matchId: matchId,
          currentStandNumber: 0,
          maxStandNumber: 10,
          status: "進行中",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // 3. entries コレクションのサンプル初期化
      const sampleEntries = [
        { id: "p1", standNumber: 1, position: "大前", teamId: "team_01", teamName: "第一立（福岡弓道倶楽部A）", playerName: "佐藤 健一", division: "一般男子", status: "行射中", totalHits: 4, totalShots: 4, isPerfect: true, enkinRank: null },
        { id: "p2", standNumber: 1, position: "中", teamId: "team_01", teamName: "第一立（福岡弓道倶楽部A）", playerName: "鈴木 隆", division: "一般男子", status: "行射中", totalHits: 3, totalShots: 4, isPerfect: false, enkinRank: null },
        { id: "p3", standNumber: 1, position: "落", teamId: "team_01", teamName: "第一立（福岡弓道倶楽部A）", playerName: "高橋 誠", division: "一般男子", status: "行射中", totalHits: 2, totalShots: 4, isPerfect: false, enkinRank: null },
        { id: "p4", standNumber: 2, position: "大前", teamId: "team_02", teamName: "第二立（博多紅葉会）", playerName: "田中 美咲", division: "一般女子", status: "招集中", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
        { id: "p5", standNumber: 2, position: "中", teamId: "team_02", teamName: "第二立（博多紅葉会）", playerName: "渡辺 彩花", division: "一般女子", status: "招集中", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
        { id: "p6", standNumber: 2, position: "落", teamId: "team_02", teamName: "第二立（博多紅葉会）", playerName: "小林 葵", division: "一般女子", status: "招集中", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
        { id: "p7", standNumber: 3, position: "大前", teamId: "team_03", teamName: "第三立（春日白鷺会）", playerName: "伊藤 剛", division: "シニア男子", status: "待機中", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
        { id: "p8", standNumber: 3, position: "落", teamId: "team_03", teamName: "第三立（春日白鷺会）", playerName: "山本 翔太", division: "シニア男子", status: "待機中", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
      ];

      for (const entry of sampleEntries) {
        await setDoc(doc(firestoreInstance, "entries", entry.id), entry, { merge: true });
      }

      setStatusMessage("【成功】Firestoreに teams, matches, entries コレクションが正常に作成されました。");
    } catch (error: unknown) {
      console.error("【エラーログ】Firestore初期データ作成中にエラーが発生しました:", error);
      setStatusMessage("初期データの書き込みに失敗しました。Firestoreルールを確認してください。");
    } finally {
      setIsSeeding(false);
    }
  };

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
        const firestoreInstance = db;
        const matchDocRef = doc(firestoreInstance, "matches", matchId);
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
    // フールプルーフ: 第0立未満への巻き戻しをブロック
    if (matchState.currentStandNumber <= 0) {
      return;
    }

    setIsProcessing(true);
    setStatusMessage("");

    const prevStandNumber = matchState.currentStandNumber - 1;

    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const firestoreInstance = db;
        const matchDocRef = doc(firestoreInstance, "matches", matchId);
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
          <p className="text-xs text-slate-500">
            試合進行ドキュメントの更新に連動してCloud FunctionsがFCM通知を自動発報します
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSeedFirestore}
            disabled={isSeeding}
            variant="outline"
            size="sm"
            className="text-xs font-semibold h-8"
          >
            <Database className="w-3.5 h-3.5 mr-1" />
            {isSeeding ? "作成中..." : "初期データ(teams)生成"}
          </Button>
          <span className="text-xs bg-slate-100 text-slate-800 px-2.5 py-1 rounded font-semibold border border-slate-200">
            試合ID: {matchId}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 現在進行中の立 */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-md flex flex-col justify-between">
          <span className="text-xs font-semibold text-slate-500">現在競技中（射場）</span>
          <div className="flex items-baseline gap-2 my-2">
            <span className="text-3xl font-black text-slate-900">
              {matchState.currentStandNumber === 0 ? "開始前" : `第 ${matchState.currentStandNumber} 立`}
            </span>
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
          {isProcessing
            ? "処理中..."
            : `次の立へ進行（第 ${matchState.currentStandNumber + 1} 立開始）`}
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
        <Button
          onClick={handleRevertStand}
          disabled={isProcessing || matchState.currentStandNumber <= 0}
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