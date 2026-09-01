"use client";

import React, { useState, useEffect } from "react";
import { doc, setDoc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { TournamentGuidelines } from "@/types";
import { Button } from "@/components/ui/button";
import { Settings, Save, Clock, AlertTriangle, CheckCircle2 } from "lucide-react";

interface GuidelinesConfigPanelProps {
  matchId?: string;
}

// フェイルセーフ: 初期要項データ
const DEFAULT_CONFIG: TournamentGuidelines = {
  matchId: "match_2026_mentaiko",
  title: "第5回めんたいこ杯争奪弓道大会 要項",
  dateText: "2027年3月29日(日) 10:00 (受付9:30)",
  venueText: "福岡市総合体育館内弓道場（福岡県福岡市東区香椎照葉６丁目１−１）",
  organizerText: "めんたいこ杯争奪弓道大会実行委員会",
  competitionRulesText: "一次審査の要領にて一手二立、競技における行射の要領にて立射四矢一立。個人戦（全3立・計8射的中制）。優勝決定のみ射詰め、その他（2位〜10位）は遠近法により決定。",
  eligibilityText: "一般弓道愛好家（大学生含む）着物着用。男女混合個人競技。先着100名程度。",
  entryFeeText: "1,500円（PayPay事前送金のみ / 送金先ID: hayapaaaay）",
  notesText: "ペーパーレス運営のためスマホ持参必須。昼食提供なし。スポーツ安全保険等は各自加入。撮影写真・映像は参加者限定共有（保有1年）。",
  entryStartDate: "2027-01-01T00:00",
  entryEndDate: "2027-03-20T23:59",
  isEntryEnabled: true,
  totalStands: 3,
  totalArrows: 8,
  tieBreakerFormat: "射詰",
  status: "IN_PROGRESS",
  currentStandGroup: 1,
  maxStandGroup: 4,
};

export function GuidelinesConfigPanel({ matchId = "match_2026_mentaiko" }: GuidelinesConfigPanelProps) {
  const [config, setConfig] = useState<TournamentGuidelines>(DEFAULT_CONFIG);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const docRef = doc(db, "matches", matchId);
    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<TournamentGuidelines>;
          setConfig((prev: TournamentGuidelines) => ({
            ...prev,
            ...data,
          }));
        }
      },
      (error) => {
        console.error("【エラーログ】要項設定ドキュメント購読失敗:", error);
      }
    );

    return () => unsubscribe();
  }, [matchId]);

  const handleChange = (field: keyof TournamentGuidelines, value: unknown) => {
    setConfig((prev: TournamentGuidelines) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setStatusMessage(null);

    if (!config.entryStartDate || !config.entryEndDate) {
      setStatusMessage({ type: "error", text: "エントリー開始日時と終了日時の両方を設定してください。" });
      return;
    }

    const startTimestamp = new Date(config.entryStartDate).getTime();
    const endTimestamp = new Date(config.entryEndDate).getTime();

    if (isNaN(startTimestamp) || isNaN(endTimestamp)) {
      setStatusMessage({ type: "error", text: "日時の入力形式が不正です。" });
      return;
    }

    if (startTimestamp >= endTimestamp) {
      setStatusMessage({ type: "error", text: "【入力エラー】開始日時は終了日時より前の日時を設定してください。" });
      return;
    }

    setIsSaving(true);

    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const docRef = doc(db, "matches", matchId);
        await setDoc(
          docRef,
          {
            ...config,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      setStatusMessage({ type: "success", text: "大会要項およびエントリー受付期間の設定を正常に保存しました。" });
    } catch (err: unknown) {
      console.error("【エラーログ】要項設定保存失敗:", err);
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
            <Settings className="w-5 h-5 text-slate-700" />
            大会要項 ＆ エントリー受付期間設定
          </h3>
          <p className="text-xs text-slate-600">
            要項ページ（/guidelines）の内容および申込受付期間（開始・終了日時）を管理します
          </p>
        </div>
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs h-8 shadow"
        >
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {isSaving ? "保存中..." : "設定を保存・適用"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        {/* エントリー受付期間制御エリア（フォント色・コントラスト改善） */}
        <div className="md:col-span-2 p-4 bg-amber-50/80 border border-amber-300 rounded-lg space-y-3">
          <h4 className="font-black text-amber-950 flex items-center gap-1.5 text-sm">
            <Clock className="w-4 h-4 text-amber-800" />
            エントリー受付期間制御
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-bold text-slate-900 mb-1">開始日時 (ISO形式)</label>
              <input
                type="datetime-local"
                value={config.entryStartDate}
                onChange={(e) => handleChange("entryStartDate", e.target.value)}
                className="w-full p-2 border border-slate-300 rounded bg-white text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-900 mb-1">終了日時 (ISO形式)</label>
              <input
                type="datetime-local"
                value={config.entryEndDate}
                onChange={(e) => handleChange("entryEndDate", e.target.value)}
                className="w-full p-2 border border-slate-300 rounded bg-white text-xs font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 focus:outline-none"
              />
            </div>
            <div className="flex flex-col justify-end">
              <label className="flex items-center gap-2 p-2 border border-slate-300 rounded bg-white font-bold text-slate-900 cursor-pointer h-9 select-none">
                <input
                  type="checkbox"
                  checked={config.isEntryEnabled}
                  onChange={(e) => handleChange("isEntryEnabled", e.target.checked)}
                  className="rounded text-slate-900 focus:ring-slate-900"
                />
                エントリー受付許可
              </label>
            </div>
          </div>
        </div>

        {/* 要項タイトル */}
        <div className="md:col-span-2">
          <label className="block font-bold text-slate-900 mb-1">要項タイトル</label>
          <input
            type="text"
            value={config.title}
            onChange={(e) => handleChange("title", e.target.value)}
            className="w-full p-2 border border-slate-300 rounded font-bold text-slate-900 text-sm focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
        </div>

        {/* 開催日時テキスト */}
        <div>
          <label className="block font-bold text-slate-900 mb-1">開催日時テキスト</label>
          <input
            type="text"
            value={config.dateText}
            onChange={(e) => handleChange("dateText", e.target.value)}
            className="w-full p-2 border border-slate-300 rounded font-medium text-slate-900 focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
        </div>

        {/* 会場テキスト */}
        <div>
          <label className="block font-bold text-slate-900 mb-1">会場テキスト</label>
          <input
            type="text"
            value={config.venueText}
            onChange={(e) => handleChange("venueText", e.target.value)}
            className="w-full p-2 border border-slate-300 rounded font-medium text-slate-900 focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
        </div>

        {/* 参加費テキスト */}
        <div>
          <label className="block font-bold text-slate-900 mb-1">参加費テキスト</label>
          <input
            type="text"
            value={config.entryFeeText}
            onChange={(e) => handleChange("entryFeeText", e.target.value)}
            className="w-full p-2 border border-slate-300 rounded font-bold text-slate-900 focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
        </div>

        {/* 主催・主管テキスト */}
        <div>
          <label className="block font-bold text-slate-900 mb-1">主催・主管テキスト</label>
          <input
            type="text"
            value={config.organizerText}
            onChange={(e) => handleChange("organizerText", e.target.value)}
            className="w-full p-2 border border-slate-300 rounded font-medium text-slate-900 focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
        </div>

        {/* 競技規定 */}
        <div className="md:col-span-2">
          <label className="block font-bold text-slate-900 mb-1">競技形式・行射規定</label>
          <textarea
            rows={3}
            value={config.competitionRulesText}
            onChange={(e) => handleChange("competitionRulesText", e.target.value)}
            className="w-full p-2 border border-slate-300 rounded font-mono text-slate-900 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
        </div>

        {/* 参加資格・所作 */}
        <div className="md:col-span-2">
          <label className="block font-bold text-slate-900 mb-1">参加資格および所作規定</label>
          <textarea
            rows={2}
            value={config.eligibilityText}
            onChange={(e) => handleChange("eligibilityText", e.target.value)}
            className="w-full p-2 border border-slate-300 rounded font-mono text-slate-900 text-xs focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
        </div>

        {/* 注意事項 */}
        <div className="md:col-span-2">
          <label className="block font-bold text-rose-700 mb-1">安全管理および注意事項</label>
          <textarea
            rows={2}
            value={config.notesText}
            onChange={(e) => handleChange("notesText", e.target.value)}
            className="w-full p-2 border border-rose-200 bg-rose-50/40 rounded font-mono text-xs text-rose-950 focus:ring-2 focus:ring-slate-900 focus:outline-none"
          />
        </div>
      </div>

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