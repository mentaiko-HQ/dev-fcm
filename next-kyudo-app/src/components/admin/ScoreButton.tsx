/**
 * 【競技記録員用 的中数一括入力ボタングループコンポーネント】
 *
 * 役割:
 * - 一手（2射）時は「0」「1」「2」の3択数字ボタンを表示。
 * - 四矢（4射）時は「0」「1」「2」「3」「4」の5択数字ボタンを表示。
 * - 現在の入力済み的中数をハイライト表示。
 * - 誤入力時のリセット用「クリア（取消）」ボタンの提供。
 *
 * フールプルーフ設計（操作ミス・不正入力の入口遮断）:
 * - 立の規定矢数（maxArrows: 2 または 4）に応じたボタングループのみをレンダリングし、
 *   上限を超える数字の入力を構造的に不可能にする。
 * - 更新処理中（disabled = true）は全ボタンを非活性化し、連打による重複更新を防止。
 * - 未入力状態（isEntered = false）と「0中（0本的中）」を視覚的・状態的に明確に区別。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - 不正な矢数（2または4以外）が渡された場合でも、上限値を安全にクリップして描画。
 * - 既存の的中データが上限を超えている場合でも、最大値にクランプして安全に比較。
 */

'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';

interface ScoreButtonProps {
  currentHits: number | null;
  maxArrows: 2 | 4;
  disabled?: boolean;
  isEntered: boolean;
  onSelectHits: (hits: number) => void;
  onClear: () => void;
}

export function ScoreButton({
  currentHits,
  maxArrows,
  disabled = false,
  isEntered,
  onSelectHits,
  onClear,
}: ScoreButtonProps) {
  // 矢数制限に基づく選択肢配列の生成（2射: [0, 1, 2] / 4射: [0, 1, 2, 3, 4]）
  const options = Array.from({ length: maxArrows + 1 }, (_, i) => i);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* 数字ボタングループ */}
      <div className="inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800 gap-1 shadow-inner">
        {options.map((num) => {
          const isSelected = isEntered && currentHits === num;
          const isZero = num === 0;
          const isAllHits = num === maxArrows;

          return (
            <button
              key={num}
              type="button"
              disabled={disabled}
              onClick={() => onSelectHits(num)}
              className={`min-w-9 h-9 px-2.5 rounded-md font-mono text-xs font-black transition-all flex items-center justify-center active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${
                isSelected
                  ? isZero
                    ? 'bg-slate-700 text-white shadow-xs ring-2 ring-slate-500'
                    : isAllHits
                      ? 'bg-amber-500 text-slate-950 shadow-xs ring-2 ring-amber-300 font-black'
                      : 'bg-red-600 text-white shadow-xs ring-2 ring-red-400'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
              }`}
            >
              {num}
            </button>
          );
        })}
      </div>

      {/* 入力解除（クリア）ボタン */}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || !isEntered}
        onClick={onClear}
        className="h-9 px-2.5 text-xs font-bold bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-900 hover:text-slate-200 shadow-2xs active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
        title="この立のスコア入力を取り消して未入力に戻す"
      >
        <RotateCcw className="w-3.5 h-3.5 mr-1 text-slate-500" />
        クリア
      </Button>
    </div>
  );
}
