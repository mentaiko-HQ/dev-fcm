/**
 * 【競技スコア個別矢入力ボタングループコンポーネント】
 *
 * 役割:
 * - 第1ステージ・第2ステージ（一手2射）において「1本目(甲矢)」「2本目(乙矢)」をそれぞれ「〇」「✕」ボタンで個別入力。
 * - 第3ステージ（四矢4射）において「1本目」〜「4本目」をそれぞれ「〇」「✕」ボタンで個別入力。
 * - 【甲矢的中賞の視覚化】: 第1ステージの1本目のみを特別にハイライトし、賞の対象であることを記録員に明示。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 第1ステージの1本目のみハイライト表示（背景色変更）を行い、第2ステージの1本目（賞の対象外）と視覚的に明確に区別。
 * - 既に選択されている「〇」または「✕」を再度タップした場合、未入力（null）へ戻すトグル解除を発火し、誤入力を防止。
 * - 処理中（disabled）状態では全ボタンをロックし、連打による多重送信を遮断。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - arrows配列が未初期化や要素不足の場合でも、安全に「未入力（null）」としてフォールバック描画。
 */

'use client';

import React from 'react';
import { ArrowHit, StandRoundIndex } from '@/types';

interface ScoreButtonProps {
  round: StandRoundIndex;
  arrows: (ArrowHit | null | undefined)[];
  disabled?: boolean;
  onSelectArrow: (arrowIndex: number, result: boolean | null) => void;
}

export function ScoreButton({
  round,
  arrows,
  disabled = false,
  onSelectArrow,
}: ScoreButtonProps) {
  // ステージに応じた矢の本数を決定（第1・第2ステージ: 2本、第3ステージ: 4本）
  const arrowCount = round === 3 ? 4 : 2;
  const arrowIndices = Array.from({ length: arrowCount }, (_, i) => i);

  /**
   * 矢の番号ラベルを取得するヘルパー関数
   */
  const getArrowLabel = (index: number): string => {
    if (round === 1 || round === 2) {
      return index === 0 ? '1本目(甲矢)' : '2本目(乙矢)';
    }
    return `${index + 1}本目`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {arrowIndices.map((idx) => {
        const currentVal = Array.isArray(arrows) ? arrows[idx] : null;
        const isHit = currentVal === true;
        const isMiss = currentVal === false;

        // フールプルーフ: 甲矢的中賞の対象は「第1ステージ」の「1本目」のみ
        const isFirstStageHayaPrizeTarget = round === 1 && idx === 0;

        return (
          <div
            key={idx}
            className={`flex flex-col items-center p-1.5 rounded-xl border transition-colors ${
              isFirstStageHayaPrizeTarget && isHit
                ? 'bg-emerald-50/70 border-emerald-300' // 賞対象の的中時はエメラルド色でハイライト
                : 'bg-slate-100/90 border-slate-200'
            }`}
          >
            {/* ラベル表示 */}
            <span
              className={`text-[10px] font-bold mb-1 px-1 tracking-tight ${
                isFirstStageHayaPrizeTarget
                  ? 'text-emerald-800 font-black'
                  : 'text-slate-600'
              }`}
            >
              {getArrowLabel(idx)}
            </span>

            {/* 〇 / ✕ ボタングループ */}
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  const nextVal = isHit ? null : true;
                  onSelectArrow(idx, nextVal);
                }}
                className={`w-10 h-9 rounded-lg font-mono text-sm font-black transition-all flex items-center justify-center shadow-2xs ${
                  isHit
                    ? 'bg-red-600 text-white ring-2 ring-red-600 scale-105'
                    : 'bg-white text-slate-700 hover:bg-red-50 hover:text-red-600 border border-slate-200 active:scale-95'
                } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100`}
                title={`${getArrowLabel(idx)}を「〇（的中）」にする${isFirstStageHayaPrizeTarget ? '（甲矢的中賞 対象）' : ''}`}
              >
                〇
              </button>

              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  const nextVal = isMiss ? null : false;
                  onSelectArrow(idx, nextVal);
                }}
                className={`w-10 h-9 rounded-lg font-mono text-sm font-black transition-all flex items-center justify-center shadow-2xs ${
                  isMiss
                    ? 'bg-slate-800 text-white ring-2 ring-slate-800 scale-105'
                    : 'bg-white text-slate-700 hover:bg-slate-200 hover:text-slate-900 border border-slate-200 active:scale-95'
                } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100`}
                title={`${getArrowLabel(idx)}を「✕（はずれ）」にする`}
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
