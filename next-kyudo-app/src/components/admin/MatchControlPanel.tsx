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
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    const matchDocRef = doc(firestoreInstance, "matches", matchId);

    const unsubscribe = onSnapshot(
      matchDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data() as MatchState;
          setMatchState(data);
        } else {
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

  // Firestore初期コレクション（的中数0で初期化）の一括投入処理
  const handleSeedFirestore = async () => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setStatusMessage("Firebase環境変数が設定されていません。");
      return;
    }

    const firestoreInstance = db;
    setIsSeeding(true);
    setStatusMessage("初期データ（的中数0）をFirestoreへ書き込み中...");

    try {
      // 1. teams コレクション
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

      // 2. matches コレクション
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

      // 3. entries コレクション（的中数は全て0でシード）
      const sampleEntries = [
        { id: "p1", standNumber: 1, position: "大前", entryType: "TEAM", progressStatus: "WAITING", qualificationStatus: "ACTIVE", teamId: "team_01", teamName: "第一立（福岡弓道倶楽部A）", playerName: "佐藤 健一", division: "一般男子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
        { id: "p2", standNumber: 1, position: "中", entryType: "TEAM", progressStatus: "WAITING", qualificationStatus: "ACTIVE", teamId: "team_01", teamName: "第一立（福岡弓道倶楽部A）", playerName: "鈴木 隆", division: "一般男子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
        { id: "p3", standNumber: 1, position: "落", entryType: "TEAM", progressStatus: "WAITING", qualificationStatus: "ACTIVE", teamId: "team_01", teamName: "第一立（福岡弓道倶楽部A）", playerName: "高橋 誠", division: "一般男子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },

        { id: "p4", standNumber: 2, position: "大前", entryType: "TEAM", progressStatus: "WAITING", qualificationStatus: "ACTIVE", teamId: "team_02", teamName: "第二立（博多紅葉会）", playerName: "田中 美咲", division: "一般女子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
        { id: "p5", standNumber: 2, position: "中", entryType: "TEAM", progressStatus: "WAITING", qualificationStatus: "ABSENT", teamId: "team_02", teamName: "第二立（博多紅葉会）", playerName: "渡辺 彩花 (欠席)", division: "一般女子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
        { id: "p6", standNumber: 2, position: "落前", entryType: "TEAM", progressStatus: "WAITING", qualificationStatus: "ACTIVE", teamId: "team_02", teamName: "第二立（博多紅葉会）", playerName: "松田 栞", division: "一般女子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
        { id: "p_indiv_01", standNumber: 2, position: "落", entryType: "INDIVIDUAL", progressStatus: "WAITING", qualificationStatus: "ACTIVE", teamId: null, teamName: "個人参加枠", playerName: "小林 葵 (個人)", division: "一般女子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },

        { id: "p7", standNumber: 3, position: "大前", entryType: "TEAM", progressStatus: "WAITING", qualificationStatus: "ACTIVE", teamId: "team_03", teamName: "第三立（春日白鷺会）", playerName: "伊藤 剛", division: "シニア男子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
        { id: "p8", standNumber: 3, position: "落", entryType: "TEAM", progressStatus: "WAITING", qualificationStatus: "ACTIVE", teamId: "team_03", teamName: "第三立（春日白鷺会）", playerName: "山本 翔太", division: "シニア男子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
      ];

      for (const entry of sampleEntries) {
        await setDoc(doc(firestoreInstance, "entries", entry.id), entry, { merge: true });
      }

      setStatusMessage("【成功】初期シードデータをFirestoreへ投入しました（全的中数0）。");
    } catch (error: unknown) {
      console.error("【エラーログ】初期データ作成エラー:", error);
      setStatusMessage("初期データの書き込みに失敗しました。");
    } finally {
      setIsSeeding(false);
    }
  };

  const handleAdvanceStand = async () => {
    if (matchState.currentStandNumber >= matchState.maxStandNumber) {
      setStatusMessage("最終立に達しているため進められません。");
      return;
    }

    setIsProcessing(true);
    setStatusMessage("");

    const nextStandNumber = matchState.currentStandNumber + 1;
    const targetCallStand = nextStandNumber + 2;

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
        setMatchState((prev) => ({ ...prev, currentStandNumber: nextStandNumber }));
      }

      setStatusMessage(
        `第${nextStandNumber}立を開始しました。（第${targetCallStand}立へ呼出通知が送信されます）`
      );
    } catch (error: unknown) {
      console.error("【エラーログ】立の進行更新失敗:", error);
      setStatusMessage("進行の更新に失敗しました。");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRevertStand = async () => {
    if (matchState.currentStandNumber <= 0) return;

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
      console.error("【エラーログ】立の差し戻し失敗:", error);
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
            立進行ドキュメントの更新に連動してCloud FunctionsがFCM通知（団体/個人）を自動発報します
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
            {isSeeding ? "投入中..." : "3層ステータス初期データ生成"}
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
            <CheckCircle2 className="w-3.5 h-3.5" /> 行射中・リアルタイムスコア入力中
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
            <AlertTriangle className="w-3.5 h-3.5" /> 自動FCMプッシュ発報対象（団体/個人）
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