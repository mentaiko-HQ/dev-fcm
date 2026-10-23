"use client";

import React, { useState } from "react";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { TournamentConfig, MatchType, ArrowCountFormat, TieBreakerFormat } from "@/types";
import { Button } from "@/components/ui/button";
import { Settings, Shield, User, Users, CheckCircle2, ArrowRight, ArrowLeft } from "lucide-react";

interface MatchConfigWizardProps {
  currentConfig: TournamentConfig;
  onConfigUpdated: (newConfig: TournamentConfig) => void;
}

export function MatchConfigWizard({ currentConfig, onConfigUpdated }: MatchConfigWizardProps) {
  const [step, setStep] = useState<number>(1);
  const [title, setTitle] = useState<string>(currentConfig.title || "第4回 福岡弓道選手権大会");
  const [targetCount, setTargetCount] = useState<number>(currentConfig.targetCount || 6);
  const [matchType, setMatchType] = useState<MatchType>(currentConfig.matchType || "HYBRID");
  const [playersPerTeam, setPlayersPerTeam] = useState<number>(currentConfig.playersPerTeam || 3);
  const [preliminaryArrowCount, setPreliminaryArrowCount] = useState<ArrowCountFormat>(
    currentConfig.preliminaryArrowCount || "四矢"
  );
  const [preliminaryStands, setPreliminaryStands] = useState<number>(currentConfig.preliminaryStands || 4);
  const [finalArrowCount, setFinalArrowCount] = useState<ArrowCountFormat>(
    currentConfig.finalArrowCount || "四矢"
  );
  const [finalStands, setFinalStands] = useState<number>(currentConfig.finalStands || 2);
  const [tieBreakerFormat, setTieBreakerFormat] = useState<TieBreakerFormat>(
    currentConfig.tieBreakerFormat || "射詰"
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");

  // フールプルーフ: 射場の的数を超えないチーム人数のバリデーション
  const isTeamSizeValid = playersPerTeam <= targetCount;

  const handleSaveConfig = async () => {
    // フールプルーフ: 必須項目の空欄チェック
    if (!title.trim()) {
      setStatusMessage("大会名を入力してください。");
      return;
    }
    if (!isTeamSizeValid) {
      setStatusMessage("1チームの人数は射場の的数以下である必要があります。");
      return;
    }

    const maxStands = preliminaryStands + finalStands;
    const newConfig: TournamentConfig = {
      matchId: currentConfig.matchId,
      title: title.trim(),
      targetCount,
      matchType,
      playersPerTeam,
      preliminaryArrowCount,
      preliminaryStands,
      finalArrowCount,
      finalStands,
      tieBreakerFormat,
      status: "IN_PROGRESS",
      currentStandNumber: currentConfig.currentStandNumber || 1,
      maxStandNumber: maxStands,
    };

    setIsSaving(true);
    setStatusMessage("大会設定を保存中...");

    try {
      if (isFirebaseConfigured && isFirestoreAvailable(db)) {
        const matchRef = doc(db, "matches", currentConfig.matchId);
        await setDoc(
          matchRef,
          {
            ...newConfig,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
      onConfigUpdated(newConfig);
      setStatusMessage("【設定完了】大会形式・行射ルールが正常に保存・適用されました。");
    } catch (error) {
      console.error("【エラーログ】大会設定保存失敗:", error);
      setStatusMessage("設定の保存に失敗しました。通信環境を確認してください。");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full bg-white border border-slate-200 rounded-lg p-5 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-3 gap-2">
        <div>
          <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
            <Settings className="w-5 h-5 text-slate-700" />
            試合形式・大会初期設定ウィザード
          </h3>
          <p className="text-xs text-slate-500">
            競技種別、予選・決勝ラウンドの射数・立数ルールを設定します
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded">
          ステップ {step} / 4
        </div>
      </div>

      {/* ステップ 1: 基本情報 */}
      {step === 1 && (
        <div className="space-y-4 animate-in fade-in">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">大会名称</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例: 第4回 福岡県弓道選手権大会"
              className="w-full p-2.5 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-slate-900 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">射場規模 (的数)</label>
            <select
              value={targetCount}
              onChange={(e) => setTargetCount(Number(e.target.value))}
              className="w-full p-2.5 text-sm border border-slate-300 rounded-md bg-white focus:ring-2 focus:ring-slate-900"
            >
              <option value={4}>4 的 (小道場)</option>
              <option value={6}>6 的 (標準武道館)</option>
              <option value={8}>8 的 (中規模)</option>
              <option value={12}>12 的 (大規模総合体育館)</option>
            </select>
          </div>
        </div>
      )}

      {/* ステップ 2: 競技種別 */}
      {step === 2 && (
        <div className="space-y-4 animate-in fade-in">
          <label className="block text-xs font-bold text-slate-700">競技形態</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div
              onClick={() => setMatchType("INDIVIDUAL")}
              className={`p-4 border rounded-lg cursor-pointer transition-all ${
                matchType === "INDIVIDUAL"
                  ? "border-slate-900 bg-slate-900 text-white shadow-md"
                  : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800"
              }`}
            >
              <User className="w-5 h-5 mb-2" />
              <p className="font-bold text-sm">個人戦のみ</p>
              <p className="text-xs opacity-80 mt-1">個人ごとの総的中で順位を競う形式</p>
            </div>

            <div
              onClick={() => setMatchType("TEAM")}
              className={`p-4 border rounded-lg cursor-pointer transition-all ${
                matchType === "TEAM"
                  ? "border-slate-900 bg-slate-900 text-white shadow-md"
                  : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800"
              }`}
            >
              <Shield className="w-5 h-5 mb-2" />
              <p className="font-bold text-sm">団体戦のみ</p>
              <p className="text-xs opacity-80 mt-1">チーム合計的中のみで競う形式</p>
            </div>

            <div
              onClick={() => setMatchType("HYBRID")}
              className={`p-4 border rounded-lg cursor-pointer transition-all ${
                matchType === "HYBRID"
                  ? "border-slate-900 bg-slate-900 text-white shadow-md"
                  : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800"
              }`}
            >
              <Users className="w-5 h-5 mb-2" />
              <p className="font-bold text-sm">個人・団体 複合</p>
              <p className="text-xs opacity-80 mt-1">団体の的中を個人のスコアにも同時集計</p>
            </div>
          </div>

          {matchType !== "INDIVIDUAL" && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">1チームあたりの人数</label>
              <select
                value={playersPerTeam}
                onChange={(e) => setPlayersPerTeam(Number(e.target.value))}
                className="w-full p-2.5 text-sm border border-slate-300 rounded-md bg-white"
              >
                <option value={3}>3 人立 (大前・中・落)</option>
                <option value={5}>5 人立 (大前・二番・中・落前・落)</option>
              </select>
              {!isTeamSizeValid && (
                <p className="text-xs text-red-600 font-bold mt-1">
                  ※ 的数（{targetCount}的）を超えるチーム人数は設定できません。
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ステップ 3: 予選・決勝行射ルール */}
      {step === 3 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in">
          {/* 予選設定 */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h4 className="font-bold text-sm text-slate-900 border-b border-slate-200 pb-1">
              予選ラウンド設定
            </h4>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">1立あたりの射数</label>
              <select
                value={preliminaryArrowCount}
                onChange={(e) => setPreliminaryArrowCount(e.target.value as ArrowCountFormat)}
                className="w-full p-2 text-sm border border-slate-300 rounded bg-white"
              >
                <option value="一手">一手 (2 射)</option>
                <option value="四矢">四矢 (4 射)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">予選の総立数</label>
              <input
                type="number"
                min={1}
                max={20}
                value={preliminaryStands}
                onChange={(e) => setPreliminaryStands(Number(e.target.value))}
                className="w-full p-2 text-sm border border-slate-300 rounded bg-white font-bold"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              予選規定射数: 1人あたり {preliminaryArrowCount === "一手" ? 2 : 4} 射 × {preliminaryStands} 立 ={" "}
              <span className="font-bold text-slate-900">
                {(preliminaryArrowCount === "一手" ? 2 : 4) * preliminaryStands} 射
              </span>
            </p>
          </div>

          {/* 決勝設定 */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h4 className="font-bold text-sm text-slate-900 border-b border-slate-200 pb-1">
              決勝ラウンド設定
            </h4>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">1立あたりの射数</label>
              <select
                value={finalArrowCount}
                onChange={(e) => setFinalArrowCount(e.target.value as ArrowCountFormat)}
                className="w-full p-2 text-sm border border-slate-300 rounded bg-white"
              >
                <option value="一手">一手 (2 射)</option>
                <option value="四矢">四矢 (4 射)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">決勝の総立数</label>
              <input
                type="number"
                min={0}
                max={10}
                value={finalStands}
                onChange={(e) => setFinalStands(Number(e.target.value))}
                className="w-full p-2 text-sm border border-slate-300 rounded bg-white font-bold"
              />
            </div>
            <p className="text-[11px] text-slate-500">
              決勝規定射数: 1人あたり {finalArrowCount === "一手" ? 2 : 4} 射 × {finalStands} 立 ={" "}
              <span className="font-bold text-slate-900">
                {(finalArrowCount === "一手" ? 2 : 4) * finalStands} 射
              </span>
            </p>
          </div>
        </div>
      )}

      {/* ステップ 4: 競射ルール・最終確認 */}
      {step === 4 && (
        <div className="space-y-4 animate-in fade-in">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">同中発生時の順位決定方式</label>
            <select
              value={tieBreakerFormat}
              onChange={(e) => setTieBreakerFormat(e.target.value as TieBreakerFormat)}
              className="w-full p-2.5 text-sm border border-slate-300 rounded-md bg-white font-semibold"
            >
              <option value="射詰">射詰 (サドンデス方式・1本ずつ行射)</option>
              <option value="遠近">遠近 (審判の目視判定による順位直接入力)</option>
              <option value="なし">競射なし (同中同位)</option>
            </select>
          </div>

          <div className="p-4 bg-slate-900 text-white rounded-lg space-y-2 text-xs">
            <p className="font-bold text-sm text-amber-400 border-b border-slate-700 pb-1">
              設定サマリー確認
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>大会名: <span className="font-bold">{title}</span></div>
              <div>射場規模: <span className="font-bold">{targetCount} 的</span></div>
              <div>競技形態: <span className="font-bold">{matchType === "HYBRID" ? "複合" : matchType}</span></div>
              <div>チーム人数: <span className="font-bold">{playersPerTeam} 名立</span></div>
              <div>予選: <span className="font-bold">{preliminaryArrowCount} ({preliminaryStands}立)</span></div>
              <div>決勝: <span className="font-bold">{finalArrowCount} ({finalStands}立)</span></div>
              <div>競射方式: <span className="font-bold">{tieBreakerFormat}</span></div>
              <div>全立数合計: <span className="font-bold text-amber-300">{preliminaryStands + finalStands} 立</span></div>
            </div>
          </div>
        </div>
      )}

      {/* ナビゲーション操作ボタン */}
      <div className="flex justify-between items-center pt-2 border-t border-slate-100">
        <Button
          type="button"
          variant="outline"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || isSaving}
          className="text-xs font-semibold"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          戻る
        </Button>

        {step < 4 ? (
          <Button
            type="button"
            onClick={() => setStep((s) => Math.min(4, s + 1))}
            disabled={step === 2 && !isTeamSizeValid}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs"
          >
            次へ
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSaveConfig}
            disabled={isSaving || !isTeamSizeValid}
            className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md"
          >
            <CheckCircle2 className="w-4 h-4 mr-1.5" />
            {isSaving ? "保存中..." : "この設定で大会を開始・更新"}
          </Button>
        )}
      </div>

      {statusMessage && (
        <p className="text-xs text-center font-medium p-2 rounded bg-slate-100 text-slate-700 border border-slate-200">
          {statusMessage}
        </p>
      )}
    </div>
  );
}