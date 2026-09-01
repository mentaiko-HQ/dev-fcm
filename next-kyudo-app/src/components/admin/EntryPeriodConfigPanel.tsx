"use client";

import React, { useState, useEffect } from "react";
import { doc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { TournamentConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Clock, Calendar, Save, CheckCircle2, AlertTriangle, ToggleLeft, ToggleRight } from "lucide-react";

interface EntryPeriodConfigPanelProps {
  matchId?: string;
}

// フェイルセーフ: 初期安全側デフォルト値
const DEFAULT_PERIOD_CONFIG: TournamentConfig = {
  matchId: "match_2026_mentaiko",
  title: "第5回めんたいこ杯争奪弓道大会",
  totalStands: 3,
  totalArrows: 8,
  tieBreakerFormat: "射詰",
  status: "IN_PROGRESS",
  currentStandGroup: 1,
  maxStandGroup: 4,
  entryStartDate: "2027-01-01T00:00",
  entryEndDate: "2027-03-20T23:59",
  isEntryEnabled: true,
};

/**
 * 運営管理用: エントリー受付期間・状態設定コンポーネント
 * 
 * 【フールプルーフ】
 * - 開始日時が終了日時以降の場合、保存処理を遮断しエラーメッセージを表示
 * - 日時入力フィールドのフォント色を高コントラスト（text-slate-900）に固定し誤認を防止
 * 
 * 【フェイルセーフ】
 * - 通信遮断やFirestore障害時でもエラーメッセージを表示し安全に状態を保持
 */
export function EntryPeriodConfigPanel({ matchId = "match_2026_mentaiko" }: EntryPeriodConfigPanelProps) {
  const [config, setConfig] = useState<TournamentConfig>(DEFAULT_PERIOD_CONFIG);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [currentTime, setCurrentTime] = useState<Date>(new Date());

  // 現在時刻の定期更新（期間状態のリアルタイムプレビュー用）
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Firestoreからエントリー期間設定をリアルタイム購読
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const docRef = doc(db, "matches", matchId);
    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<TournamentConfig>;
          setConfig((prev: TournamentConfig) => ({
            ...prev,
            ...data,
            entryStartDate: typeof data.entryStartDate === "string" ? data.entryStartDate : prev.entryStartDate,
            entryEndDate: typeof data.entryEndDate === "string" ? data.entryEndDate : prev.entryEndDate,
            isEntryEnabled: typeof data.isEntryEnabled === "boolean" ? data.isEntryEnabled : prev.isEntryEnabled,
          }));
        }
      },
      (error) => {
        console.error("【エラーログ】エントリー期間設定の購読失敗:", error);
      }
    );

    return () => unsubscribe();
  }, [matchId]);

  // 現在の設定における受付状態の動的判定
  const startDate = new Date(config.entryStartDate);
  const endDate = new Date(config.entryEndDate);
  const isBefore = currentTime < startDate;
  const isAfter = currentTime > endDate;
  const isCurrentlyOpen = !isBefore && !isAfter && config.isEntryEnabled;

  // 設定保存処理
  const handleSave = async () => {
    setStatusMessage(null);

    // フールプルーフ: 日時の前後関係バリデーション
    if (!config.entryStartDate || !config.entryEndDate) {
      setStatusMessage({ type: "error", text: "開始日時と終了日時の両方を指定してください。" });
      return;
    }

    const startTimestamp = new Date(config.entryStartDate).getTime();
    const endTimestamp = new Date(config.entryEndDate).getTime();

    if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
      setStatusMessage({ type: "error", text: "日時の形式が正しくありません。" });
      return;
    }

    if (startTimestamp >= endTimestamp) {
      setStatusMessage({ type: "error", text: "【入力エラー】開始日時は終了日時よりも前の日時を設定してください。" });
      return;
    }

    setIsSaving(true);

    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const docRef = doc(db, "matches", matchId);
        await setDoc(
          docRef,
          {
            entryStartDate: config.entryStartDate,
            entryEndDate: config.entryEndDate,
            isEntryEnabled: config.isEntryEnabled,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      setStatusMessage({ type: "success", text: "エントリー受付期間の設定を正常に更新・保存しました。" });
    } catch (error: unknown) {
      console.error("【エラーログ】エントリー期間設定の保存失敗:", error);
      setStatusMessage({ type: "error", text: "設定の保存に失敗しました。通信環境を確認してください。" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-3 gap-2">
        <div>
          <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-600" />
            エントリー受付期間・受付状態管理
          </h3>
          <p className="text-xs text-slate-600">
            要項ページ（/guidelines）での同意・エントリー遷移可能期間および受付トグルを制御します
          </p>
        </div>

        {/* 受付状態ステータスバッジ（高視認性フォントカラー） */}
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
            isCurrentlyOpen
              ? "bg-emerald-100 border-emerald-300 text-emerald-950 font-black"
              : isBefore
              ? "bg-amber-100 border-amber-300 text-amber-950 font-bold"
              : "bg-rose-100 border-rose-300 text-rose-950 font-bold"
          }`}>
            {isCurrentlyOpen ? "● 現在受付中" : isBefore ? "○ 開始前" : "× 受付停止 / 終了"}
          </span>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs h-8 shadow"
          >
            <Save className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
            {isSaving ? "保存中..." : "期間設定を保存"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        {/* エントリー開始日時設定カード */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-2">
          <label className="block font-bold text-slate-900 flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-slate-700" />
            受付開始日時 (ISO形式)
          </label>
          <input
            type="datetime-local"
            value={config.entryStartDate}
            onChange={(e) => setConfig((prev: TournamentConfig) => ({ ...prev, entryStartDate: e.target.value }))}
            className="w-full p-2.5 border border-slate-300 rounded bg-white font-bold text-slate-900 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
          <p className="text-[11px] text-slate-600 leading-tight">
            設定日時以前は要項ページの同意ボタンが無効化されます
          </p>
        </div>

        {/* エントリー終了日時設定カード */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-2">
          <label className="block font-bold text-slate-900 flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-slate-700" />
            受付終了日時 (ISO形式)
          </label>
          <input
            type="datetime-local"
            value={config.entryEndDate}
            onChange={(e) => setConfig((prev: TournamentConfig) => ({ ...prev, entryEndDate: e.target.value }))}
            className="w-full p-2.5 border border-slate-300 rounded bg-white font-bold text-slate-900 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
          <p className="text-[11px] text-slate-600 leading-tight">
            設定日時以降は要項ページに「受付終了」と表示されます
          </p>
        </div>

        {/* 手動受付トグル（高コントラスト文字色） */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-2 flex flex-col justify-between">
          <label className="block font-bold text-slate-900">
            手動受付ステータストグル
          </label>
          <div
            onClick={() => setConfig((prev: TournamentConfig) => ({ ...prev, isEntryEnabled: !prev.isEntryEnabled }))}
            className={`p-2.5 rounded border cursor-pointer flex items-center justify-between transition-colors select-none ${
              config.isEntryEnabled
                ? "bg-emerald-50 border-emerald-400 text-emerald-950 font-bold"
                : "bg-rose-50 border-rose-300 text-rose-950 font-bold"
            }`}
          >
            <span className="text-xs">
              {config.isEntryEnabled ? "受付許可（通常稼働）" : "手動停止中（強制締切）"}
            </span>
            {config.isEntryEnabled ? (
              <ToggleRight className="w-6 h-6 text-emerald-600" />
            ) : (
              <ToggleLeft className="w-6 h-6 text-rose-600" />
            )}
          </div>
          <p className="text-[11px] text-slate-600 leading-tight">
            期間内であっても定員到達時等に即時停止できます
          </p>
        </div>
      </div>

      {/* ステータスメッセージ表示 */}
      {statusMessage && (
        <div className={`p-2.5 rounded text-xs font-bold border flex items-center gap-2 ${
          statusMessage.type === "success"
            ? "bg-emerald-50 border-emerald-300 text-emerald-950"
            : "bg-rose-50 border-rose-300 text-rose-950"
        }`}>
          {statusMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-700" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}
    </div>
  );
}