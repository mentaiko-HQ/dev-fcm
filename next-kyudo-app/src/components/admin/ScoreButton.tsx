'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { HitResult } from '@/types';

interface ScoreButtonProps {
  playerName: string;
  totalArrows: number; // 規定矢数（例: 一手なら2、四矢なら4）
  onScoreChange?: (scores: HitResult[]) => void;
}

export function ScoreButton({
  playerName,
  totalArrows = 4,
  onScoreChange,
}: ScoreButtonProps) {
  const [scores, setScores] = useState<HitResult[]>([]);

  // 的中（〇）または不中（✕）の入力を追加（フールプルーフ: 規定矢数超過を防止）
  const handleAddScore = (result: HitResult) => {
    if (scores.length >= totalArrows) {
      console.warn(
        '【入力制約】規定矢数に達しているため、これ以上追加できません。',
      );
      return;
    }
    const updated = [...scores, result];
    setScores(updated);
    if (onScoreChange) {
      onScoreChange(updated);
    }
  };

  // 直前の入力を取り消す（Undo機能）
  const handleUndo = () => {
    if (scores.length === 0) return;
    const updated = scores.slice(0, -1);
    setScores(updated);
    if (onScoreChange) {
      onScoreChange(updated);
    }
  };

  return (
    <div className="p-4 border border-slate-200 rounded-lg bg-white shadow-sm flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <span className="font-semibold text-slate-800">{playerName}</span>
        <span className="text-xs text-slate-500">
          {scores.length} / {totalArrows} 射終了
        </span>
      </div>

      {/* スコア表示エリア */}
      <div className="flex gap-2 justify-center py-2 bg-slate-50 border border-slate-100 rounded">
        {Array.from({ length: totalArrows }).map((_, index) => {
          const score = scores[index];
          return (
            <div
              key={index}
              className="w-10 h-10 flex items-center justify-center border border-slate-300 rounded font-bold text-lg bg-white"
            >
              {score === 1 ? (
                <span className="text-red-600">〇</span>
              ) : score === 0 ? (
                <span className="text-slate-400">✕</span>
              ) : (
                <span className="text-slate-200">-</span>
              )}
            </div>
          );
        })}
      </div>

      {/* 入力ボタングループ（操作性・タップ領域重視） */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          type="button"
          onClick={() => handleAddScore(1)}
          disabled={scores.length >= totalArrows}
          className="bg-red-600 hover:bg-red-700 text-white font-bold h-12 text-lg"
        >
          〇 (的中)
        </Button>
        <Button
          type="button"
          onClick={() => handleAddScore(0)}
          disabled={scores.length >= totalArrows}
          variant="secondary"
          className="font-bold h-12 text-lg text-slate-700"
        >
          ✕ (不中)
        </Button>
        <Button
          type="button"
          onClick={handleUndo}
          disabled={scores.length === 0}
          variant="outline"
          className="h-12 text-sm"
        >
          取消 (Undo)
        </Button>
      </div>
    </div>
  );
}
