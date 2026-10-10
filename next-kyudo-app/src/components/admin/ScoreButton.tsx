/**
 * 【競技スコア入力ボタングループコンポーネント】
 *
 * 役割:
 * - 第1立・第2立（一手2射）の「0, 1, 2」的中入力ボタンを提供。
 * - 第3立（四矢4射）の「0, 1, 2, 3, 4」的中入力ボタンを提供。
 * - 現在の的中数をアクティブ表示し、タップ時の即時コールバックを発火。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 立ごとの上限射数（一手: 2, 四矢: 4）を超える値の選択肢を生成せず、不正入力をUI構造で遮断。
 * - 棄権選手や処理中状態では全ボタンを disabled 化し、誤入力を防止。
 * - 現在選択されている的中数ボタンを黒背景・白文字・太枠で視覚的に強調。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - 不正な値（nullや範囲外数値）が渡された場合でも、未選択状態として安全に描画を維持。
 */

'use client';

import React from 'react';
import { Button } from '@/components/ui/button';

interface ScoreButtonProps {
  maxScore: 2 | 4; // 一手: 2, 四矢: 4
  currentScore: number | null; // 現在の的中数
  disabled?: boolean;
  onSelectScore: (score: number) => void;
}

export function ScoreButton({
  maxScore,
  currentScore,
  disabled = false,
  onSelectScore,
}: ScoreButtonProps) {
  // 選択肢の配列を動的生成（0〜maxScore）
  const options = Array.from({ length: maxScore + 1 }, (_, i) => i);

  return (
    <div className="inline-flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
      {options.map((score) => {
        const isSelected = currentScore === score;

        return (
          <Button
            key={score}
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => onSelectScore(score)}
            className={`min-w-10 sm:min-w-11 h-10 text-sm font-black rounded-lg transition-all shadow-2xs ${
              isSelected
                ? 'bg-slate-900 text-white hover:bg-slate-800 ring-2 ring-slate-900 scale-105'
                : 'bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 border border-slate-200'
            } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100`}
            title={`的中数: ${score}本`}
          >
            {score}
          </Button>
        );
      })}
    </div>
  );
}
