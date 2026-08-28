"use client";

import React, { useMemo } from "react";
import { Participant } from "@/types/participant";
import { Trophy, Medal, Award, Flame } from "lucide-react";

interface AwardSummaryCardProps {
  participants: Participant[];
}

export function AwardSummaryCard({ participants }: AwardSummaryCardProps) {
  // 順位順にソート（finalRankが存在する場合は最優先）
  const rankedList = useMemo(() => {
    return [...participants].sort((a, b) => {
      if (a.finalRank && b.finalRank) return a.finalRank - b.finalRank;
      if (a.enkinRank && b.enkinRank) return a.enkinRank - b.enkinRank;
      return b.totalHits - a.totalHits;
    });
  }, [participants]);

  const firstPlace = rankedList[0];
  const secondPlace = rankedList[1];
  const thirdPlace = rankedList[2];

  // 皆中者リスト
  const perfectShooters = useMemo(() => {
    return participants.filter((p) => p.isPerfect || (p.totalHits === 4 && p.totalShots === 4));
  }, [participants]);

  return (
    <div className="w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-lg p-5 text-white shadow-md space-y-4">
      <div className="flex justify-between items-center border-b border-slate-700 pb-3">
        <h3 className="font-bold text-base flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          大会表彰・成績サマリー
        </h3>
        <span className="text-xs bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded-full border border-amber-500/30 font-semibold">
          公式記録
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 優勝 */}
        <div className="bg-slate-800/80 border border-amber-500/40 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
              <Trophy className="w-4 h-4 text-amber-400" /> 優勝 (第1位)
            </span>
            {firstPlace?.enkinRank && (
              <span className="text-[10px] bg-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded">
                遠近判定
              </span>
            )}
          </div>
          {firstPlace ? (
            <div>
              <p className="text-lg font-black text-white">{firstPlace.playerName}</p>
              <p className="text-xs text-slate-400">{firstPlace.teamName}</p>
              <p className="text-sm font-bold text-amber-400 mt-2">{firstPlace.totalHits} 中</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">未確定</p>
          )}
        </div>

        {/* 準優勝 */}
        <div className="bg-slate-800/80 border border-slate-600 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1">
              <Medal className="w-4 h-4 text-slate-300" /> 準優勝 (第2位)
            </span>
          </div>
          {secondPlace ? (
            <div>
              <p className="text-lg font-black text-white">{secondPlace.playerName}</p>
              <p className="text-xs text-slate-400">{secondPlace.teamName}</p>
              <p className="text-sm font-bold text-slate-300 mt-2">{secondPlace.totalHits} 中</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">未確定</p>
          )}
        </div>

        {/* 第3位 */}
        <div className="bg-slate-800/80 border border-amber-700/40 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-bold text-amber-600 flex items-center gap-1">
              <Award className="w-4 h-4 text-amber-600" /> 第3位
            </span>
          </div>
          {thirdPlace ? (
            <div>
              <p className="text-lg font-black text-white">{thirdPlace.playerName}</p>
              <p className="text-xs text-slate-400">{thirdPlace.teamName}</p>
              <p className="text-sm font-bold text-amber-500 mt-2">{thirdPlace.totalHits} 中</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">未確定</p>
          )}
        </div>
      </div>

      {/* 皆中賞一覧 */}
      {perfectShooters.length > 0 && (
        <div className="bg-slate-800/50 border border-red-500/30 rounded-lg p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Flame className="w-4 h-4 text-red-500" />
            <span className="text-xs font-bold text-red-400">皆中賞達成者</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {perfectShooters.map((p) => (
              <span
                key={p.id}
                className="text-xs font-semibold bg-red-500/20 text-red-200 border border-red-500/30 px-2.5 py-1 rounded"
              >
                {p.playerName} ({p.teamName})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}