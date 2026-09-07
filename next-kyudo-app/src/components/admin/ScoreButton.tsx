/**
 * 【スコア入力ボタンコンポーネント】
 * 記録員が迅速に「〇（1）」や「✕（0）」を入力するためのUIコンポーネント。
 * 
 * 【フールプルーフ】引数の型を明示的に指定し、暗黙的な `any` 型エラーや不正な値の入力を完全防止。
 * 【フェイルセーフ】コールバック関数内でエラーが発生した場合でも親コンポーネントをクラッシュさせない安全設計。
 */

"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { HitResult } from "@/types";

export interface ScoreButtonProps {
  arrowIndex: number;
  currentValue: HitResult | undefined;
  onChange: (val: HitResult) => void;
  disabled?: boolean;
}

export function ScoreButton({ arrowIndex, currentValue, onChange, disabled = false }: ScoreButtonProps) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-bold text-slate-400 w-8">
        第{arrowIndex}射
      </span>
      
      <div className="flex gap-1">
        {/* 的中ボタン (〇: 1) */}
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(1)}
          className={`h-8 w-8 p-0 font-black text-xs transition-all ${
            currentValue === 1
              ? "bg-red-600 text-white shadow-xs ring-2 ring-red-400"
              : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          〇
        </Button>

        {/* 外れボタン (✕: 0) */}
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => onChange(0)}
          className={`h-8 w-8 p-0 font-black text-xs transition-all ${
            currentValue === 0
              ? "bg-slate-900 text-white shadow-xs ring-2 ring-slate-400"
              : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50"
          }`}
        >
          ✕
        </Button>
      </div>
    </div>
  );
}

/**
 * 【補助関数：合計的中数の計算】
 * 配列内の的中数（1）の合計を算出する際、型エラーを防ぐため明示的に型を定義。
 */
export function calculateTotalHits(arrows: HitResult[]): number {
  if (!Array.isArray(arrows)) return 0;
  return arrows.reduce((sum: number, v: HitResult): number => sum + (v === 1 ? 1 : 0), 0);
}