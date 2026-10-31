/**
 * 【競技スコア入力 UI コンポーネント】
 *
 * 役割:
 * - 第1・第2ステージ（一手2射）: 各矢（甲矢・乙矢）ごとに「〇」「✕」ボタンで個別入力。
 * - 第3ステージ（四矢4射）: 「0」〜「4」の数字ボタンによる一括入力（総的中数入力）方式。
 *
 * フールプルーフ設計:
 * - 【修正】round パラメータが万が一文字列 ('3') で渡ってきた場合でも確実に判定できるよう、Number() でキャスト。
 */

'use client';

import React from 'react';
import { ArrowHit, StandRoundIndex } from '@/types';

interface ScoreButtonProps {
  round: StandRoundIndex;
  arrows: (ArrowHit | null | undefined)[];
  disabled?: boolean;
  onSelectArrow: (arrowIndex: number, result: boolean | null) => void;
  onUpdateBulkArrows?: (results: (ArrowHit | null)[]) => void;
}

export function ScoreButton({
  round,
  arrows,
  disabled = false,
  onSelectArrow,
  onUpdateBulkArrows,
}: ScoreButtonProps) {
  // フールプルーフ: 文字列で渡ってきた場合でも確実に判定
  const safeRound = Number(round);

  // ----------------------------------------------------------------------
  // 第3ステージ（四矢4射）: 「0〜4」数字選択による一括入力方式
  // ----------------------------------------------------------------------
  if (safeRound === 3) {
    const isAllUnset = arrows
      .slice(0, 4)
      .every((v) => v === null || v === undefined);
    const currentHitsCount = isAllUnset
      ? null
      : arrows.slice(0, 4).filter((v) => v === true).length;
    const options = [0, 1, 2, 3, 4];

    return (
      <div className="flex flex-wrap items-center gap-1.5 p-2 bg-slate-100/90 border border-slate-200 rounded-xl">
        <span className="text-[10px] font-bold text-slate-600 w-full mb-0.5 tracking-tight px-1">
          第3ステージ (的中数選択)
        </span>
        <div className="flex w-full gap-1.5">
          {options.map((num) => {
            const isSelected = currentHitsCount === num;
            return (
              <button
                key={num}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (onUpdateBulkArrows) {
                    if (isSelected) {
                      onUpdateBulkArrows([null, null, null, null]);
                    } else {
                      const newArrows = Array.from({ length: 4 }, (_, i) =>
                        i < num ? true : false,
                      );
                      onUpdateBulkArrows(newArrows);
                    }
                  } else {
                    if (isSelected) {
                      for (let i = 0; i < 4; i++) onSelectArrow(i, null);
                    } else {
                      for (let i = 0; i < 4; i++)
                        onSelectArrow(i, i < num ? true : false);
                    }
                  }
                }}
                className={`flex-1 h-10 rounded-lg font-mono text-base font-black transition-all flex items-center justify-center shadow-2xs ${
                  isSelected
                    ? 'bg-red-600 text-white ring-2 ring-red-600 scale-105'
                    : 'bg-white text-slate-700 hover:bg-red-50 hover:text-red-600 border border-slate-200 active:scale-95'
                } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100`}
                title={`${num}中的とする`}
              >
                {num}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------------
  // 第1・第2ステージ（一手2射）: 個別矢（〇/✕）入力方式
  // ----------------------------------------------------------------------
  const arrowIndices = [0, 1]; // 常に2本
  const getArrowLabel = (index: number): string =>
    index === 0 ? '1本目(甲矢)' : '2本目(乙矢)';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {arrowIndices.map((idx) => {
        const currentVal = Array.isArray(arrows) ? arrows[idx] : null;
        const isHit = currentVal === true;
        const isMiss = currentVal === false;

        const isFirstStageHayaPrizeTarget = safeRound === 1 && idx === 0;

        return (
          <div
            key={idx}
            className={`flex flex-col items-center p-1.5 rounded-xl border transition-colors ${
              isFirstStageHayaPrizeTarget && isHit
                ? 'bg-emerald-50/70 border-emerald-300'
                : 'bg-slate-100/90 border-slate-200'
            }`}
          >
            <span
              className={`text-[10px] font-bold mb-1 px-1 tracking-tight ${
                isFirstStageHayaPrizeTarget
                  ? 'text-emerald-800 font-black'
                  : 'text-slate-600'
              }`}
            >
              {getArrowLabel(idx)}
            </span>
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
