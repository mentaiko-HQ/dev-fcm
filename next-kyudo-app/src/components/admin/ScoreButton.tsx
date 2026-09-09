/**
 * 【スコア入力および迅速入力・Undo管理コンポーネント】
 * 
 * 役割:
 * - 各射（第1射〜第4射）ごとの「〇（1）」「✕（0）」個別入力ボタン（ScoreButton）の提供。
 * - タブレット・スマートフォンでの迅速な記録を可能にする連続入力パネルおよびUndo（直前の1射取消）UIの提供。
 * - 的中数合計の安全な算出ロジックの提供。
 * 
 * フールプルーフ設計（操作ミス・不正入力の入口遮断）:
 * - 既に選択されているボタンを再度押下した際のクリア（未選択状態への復帰）トグル機能。
 * - 規定射数（一手: 2射、四矢: 4射）到達時における追加操作ボタンの自動非活性化。
 * - 履歴が空（0射）の場合の Undo ボタン非活性化による境界値エラーの抑止。
 * - 入力値に対するランタイム型ガード（isHitResult）による不正値の完全遮断。
 * 
 * フェイルセーフ設計（障害発生時の安全縮退）:
 * - 親から渡された onChange コールバック実行時における try-catch 例外捕捉。コールバック側で例外が発生してもコンポーネント全体のクラッシュを防止。
 * - 配列データが null, undefined, または非配列型で渡された場合でも、空配列として安全にフォールバック処理。
 */

"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { HitResult, isHitResult } from "@/types";
import { RotateCcw, Check, X } from "lucide-react";

// ==========================================
// 1. 単一射入力ボタン (ScoreButton)
// ==========================================

export interface ScoreButtonProps {
  arrowIndex: number;
  currentValue: HitResult | undefined;
  onChange: (val: HitResult | undefined) => void;
  disabled?: boolean;
}

export function ScoreButton({
  arrowIndex,
  currentValue,
  onChange,
  disabled = false,
}: ScoreButtonProps) {
  /**
   * 【フールプルーフ ＆ フェイルセーフ】
   * 値の切り替え処理。同一の値を再度押した場合は未選択（undefined）に戻すトグル動作を行い、
   * 例外発生時も親コンポーネントの描画を停止させない。
   */
  const handleSelect = (targetVal: HitResult) => {
    if (disabled) return;

    // フールプルーフ: 不正な値の流入を型ガードで防御
    if (!isHitResult(targetVal)) {
      console.error("【スコア入力エラー】不正な的中値が検出されました:", targetVal);
      return;
    }

    try {
      // 既に選択されているボタンを押した場合はクリア、異なる場合は上書き
      const nextVal = currentValue === targetVal ? undefined : targetVal;
      onChange(nextVal);
    } catch (err: unknown) {
      // フェイルセーフ: コールバック先のエラーを捕捉しクラッシュを回避
      console.error("【スコア入力例外】onChangeハンドラー実行中にエラーが発生しました:", err);
    }
  };

  return (
    <div className="flex items-center gap-1.5 select-none">
      <span className="text-[10px] font-bold text-slate-500 w-9 text-right font-mono">
        第{arrowIndex}射
      </span>

      <div className="flex gap-1 items-center">
        {/* 的中ボタン (〇: 1) */}
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => handleSelect(1)}
          aria-label={`第${arrowIndex}射 的中`}
          className={`h-8 w-8 p-0 font-black text-xs transition-all duration-150 active:scale-95 ${
            currentValue === 1
              ? "bg-red-600 text-white shadow-xs ring-2 ring-red-400 hover:bg-red-700"
              : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:text-slate-900"
          } disabled:opacity-40 disabled:pointer-events-none`}
        >
          〇
        </Button>

        {/* 外れボタン (✕: 0) */}
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => handleSelect(0)}
          aria-label={`第${arrowIndex}射 外れ`}
          className={`h-8 w-8 p-0 font-black text-xs transition-all duration-150 active:scale-95 ${
            currentValue === 0
              ? "bg-slate-900 text-white shadow-xs ring-2 ring-slate-400 hover:bg-slate-800"
              : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:text-slate-900"
          } disabled:opacity-40 disabled:pointer-events-none`}
        >
          ✕
        </Button>
      </div>
    </div>
  );
}


// ==========================================
// 2. 迅速連射入力 ＆ Undoパネル (RapidScoreInput)
// ==========================================

export interface RapidScoreInputProps {
  maxArrows?: number; // 2: 一手, 4: 四矢
  currentArrows: HitResult[];
  onArrowsChange: (updatedArrows: HitResult[]) => void;
  disabled?: boolean;
}

export function RapidScoreInput({
  maxArrows = 2,
  currentArrows = [],
  onArrowsChange,
  disabled = false,
}: RapidScoreInputProps) {
  // フェイルセーフ: 不正な配列が渡された場合の安全初期化
  const safeArrows = Array.isArray(currentArrows) ? currentArrows : [];
  const isCompleted = safeArrows.length >= maxArrows;

  /**
   * 迅速的中入力（〇または✕）
   */
  const handlePushShot = (result: HitResult) => {
    if (disabled || isCompleted) return;

    // フールプルーフ: 上限射数超過のブロック
    if (safeArrows.length >= maxArrows) {
      console.warn("【スコア入力警告】上限射数を超えて入力することはできません:", maxArrows);
      return;
    }

    try {
      const nextList = [...safeArrows, result];
      onArrowsChange(nextList);
    } catch (err: unknown) {
      console.error("【スコア連続入力例外】onArrowsChange実行中にエラーが発生しました:", err);
    }
  };

  /**
   * Undo処理: 直前の1射を取り消す
   */
  const handleUndo = () => {
    if (disabled || safeArrows.length === 0) return;

    try {
      const nextList = safeArrows.slice(0, -1);
      onArrowsChange(nextList);
    } catch (err: unknown) {
      console.error("【Undo例外】取り消し処理中にエラーが発生しました:", err);
    }
  };

  const totalHits = calculateTotalHits(safeArrows);

  return (
    <div className="flex flex-col gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl max-w-xs w-full shadow-2xs">
      {/* 上部表示：インジケーターと的中数 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {Array.from({ length: maxArrows }).map((_, idx) => {
            const val = safeArrows[idx];
            const isRecorded = val !== undefined;
            return (
              <div
                key={idx}
                className={`w-7 h-7 rounded-md flex items-center justify-center font-black text-xs border transition-all ${
                  isRecorded
                    ? val === 1
                      ? "bg-red-600 text-white border-red-600 shadow-2xs"
                      : "bg-slate-900 text-white border-slate-900 shadow-2xs"
                    : "bg-white text-slate-300 border-slate-200 border-dashed"
                }`}
              >
                {isRecorded ? (val === 1 ? "〇" : "✕") : idx + 1}
              </div>
            );
          })}
        </div>

        <div className="text-right">
          <span className="text-[10px] text-slate-500 font-bold block">計</span>
          <span className="text-sm font-black font-mono text-slate-900">
            {totalHits} <span className="text-[10px] text-slate-400 font-normal">/ {maxArrows}</span>
          </span>
        </div>
      </div>

      {/* 迅速入力ボタングループ */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled || isCompleted}
          onClick={() => handlePushShot(1)}
          className="h-12 flex items-center justify-center gap-1.5 rounded-lg font-black text-base bg-red-600 text-white hover:bg-red-700 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all shadow-xs"
        >
          <Check className="w-4 h-4 stroke-[3]" />
          <span>的中 (〇)</span>
        </button>

        <button
          type="button"
          disabled={disabled || isCompleted}
          onClick={() => handlePushShot(0)}
          className="h-12 flex items-center justify-center gap-1.5 rounded-lg font-black text-base bg-slate-900 text-white hover:bg-slate-800 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all shadow-xs"
        >
          <X className="w-4 h-4 stroke-[3]" />
          <span>外れ (✕)</span>
        </button>
      </div>

      {/* アンドゥ操作ボタン */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || safeArrows.length === 0}
        onClick={handleUndo}
        className="w-full text-[11px] font-bold text-slate-600 border-slate-300 hover:bg-slate-100 disabled:opacity-30 h-8"
      >
        <RotateCcw className="w-3.5 h-3.5 mr-1 text-slate-500" />
        直前の1射を取り消す (Undo)
      </Button>
    </div>
  );
}


// ==========================================
// 3. 補助関数：合計的中数計算ロジック
// ==========================================

/**
 * 【補助関数：合計的中数の安全計算】
 * 配列内の的中（1）の合計を算出。
 * 
 * フールプルーフ: 型ガードによる厳格な 1 の判定。
 * フェイルセーフ: 配列以外の入力（null, undefined, オブジェクト等）を受け取った場合も 0 を返却しクラッシュを防止。
 */
export function calculateTotalHits(arrows: unknown): number {
  if (!Array.isArray(arrows)) {
    return 0;
  }

  return arrows.reduce((sum: number, val: unknown): number => {
    return sum + (val === 1 ? 1 : 0);
  }, 0);
}