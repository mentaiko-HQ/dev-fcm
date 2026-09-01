"use client";

import React, { useMemo } from "react";
import { Participant } from "@/types/participant";
import { HitResult } from "@/types";
import { Trophy, Medal, Award, Flame, Target } from "lucide-react";

interface AwardSummaryCardProps {
  participants: Participant[];
}

export function AwardSummaryCard({ participants }: AwardSummaryCardProps) {
  // フールプルーフ & フェイルセーフ: 欠席者を除外し、確定順位(finalRank)または的中数降順でソート
  const rankedIndividuals = useMemo(() => {
    return [...participants]
      .filter((p) => p.qualificationStatus !== "ABSENT")
      .sort((a, b) => {
        if (a.finalRank && b.finalRank) return a.finalRank - b.finalRank;
        if (a.enkinRank && b.enkinRank) return a.enkinRank - b.enkinRank;
        return (b.totalHits || 0) - (a.totalHits || 0);
      });
  }, [participants]);

  const firstPlace = rankedIndividuals[0];
  const secondPlace = rankedIndividuals[1];
  const thirdPlace = rankedIndividuals[2];

  // 一手束中賞（第1立または第2立で2射2中）の達成者（TS2769 / TS2367 解消）
  const ishuSokuchuShooters = useMemo(() => {
    return participants.filter((p) => {
      if (p.qualificationStatus === "ABSENT") return false;
      const s1Hits: number = (p.stand1_arrows || []).reduce<number>((acc, v: HitResult) => acc + v, 0);
      const s2Hits: number = (p.stand2_arrows || []).reduce<number>((acc, v: HitResult) => acc + v, 0);
      return s1Hits === 2 || s2Hits === 2;
    });
  }, [participants]);

  // 四矢皆中賞（第3立で4射4中）の達成者（TS2769 / TS2367 解消）
  const yotsuyaKaichuShooters = useMemo(() => {
    return participants.filter((p) => {
      if (p.qualificationStatus === "ABSENT") return false;
      const s3Hits: number = (p.stand3_arrows || []).reduce<number>((acc, v: HitResult) => acc + v, 0);
      return s3Hits === 4;
    });
  }, [participants]);

  // 8射全皆中者リスト
  const perfectShooters = useMemo(() => {
    return participants.filter(
      (p) => p.qualificationStatus === "ACTIVE" && (p.isPerfect || p.totalHits === 8)
    );
  }, [participants]);

  return (
    <div className="w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-lg p-5 text-white shadow-md space-y-4">
      <div className="flex justify-between items-center border-b border-slate-700 pb-3">
        <h3 className="font-bold text-base flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          第5回めんたいこ杯争奪弓道大会 表彰サマリー (個人10名表彰)
        </h3>
        <span className="text-xs bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded-full border border-amber-500/30 font-semibold">
          全8射的中制（優勝:射詰 / 2位以降:遠近）
        </span>
      </div>

      {/* 上位3名ポディウム */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 優勝 (第1位 - 射詰め決定) */}
        <div className="bg-slate-800/80 border border-amber-500/40 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
              <Trophy className="w-4 h-4 text-amber-400" /> 優勝 (第1位・射詰決定)
            </span>
            {firstPlace?.enkinRank && (
              <span className="text-[10px] bg-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded">
                判定 {firstPlace.enkinRank}位
              </span>
            )}
          </div>
          {firstPlace ? (
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs font-bold text-slate-400">No.{firstPlace.bibNumber}</span>
                <p className="text-lg font-black text-white">{firstPlace.name}</p>
                <span className="text-xs text-slate-400">({firstPlace.nameKana})</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{firstPlace.organization || "無所属"}</p>
              <p className="text-sm font-bold text-amber-400 mt-2">{firstPlace.totalHits || 0} / 8 中</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">未確定</p>
          )}
        </div>

        {/* 準優勝 (第2位 - 遠近法決定) */}
        <div className="bg-slate-800/80 border border-slate-600 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-bold text-slate-300 flex items-center gap-1">
              <Medal className="w-4 h-4 text-slate-300" /> 準優勝 (第2位・遠近決定)
            </span>
            {secondPlace?.enkinRank && (
              <span className="text-[10px] bg-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded">
                遠近 {secondPlace.enkinRank}位
              </span>
            )}
          </div>
          {secondPlace ? (
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs font-bold text-slate-400">No.{secondPlace.bibNumber}</span>
                <p className="text-lg font-black text-white">{secondPlace.name}</p>
                <span className="text-xs text-slate-400">({secondPlace.nameKana})</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{secondPlace.organization || "無所属"}</p>
              <p className="text-sm font-bold text-slate-300 mt-2">{secondPlace.totalHits || 0} / 8 中</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">未確定</p>
          )}
        </div>

        {/* 第3位 */}
        <div className="bg-slate-800/80 border border-amber-700/40 rounded-lg p-3.5 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-bold text-amber-600 flex items-center gap-1">
              <Award className="w-4 h-4 text-amber-600" /> 第3位 (遠近決定)
            </span>
            {thirdPlace?.enkinRank && (
              <span className="text-[10px] bg-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded">
                遠近 {thirdPlace.enkinRank}位
              </span>
            )}
          </div>
          {thirdPlace ? (
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-xs font-bold text-slate-400">No.{thirdPlace.bibNumber}</span>
                <p className="text-lg font-black text-white">{thirdPlace.name}</p>
                <span className="text-xs text-slate-400">({thirdPlace.nameKana})</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{thirdPlace.organization || "無所属"}</p>
              <p className="text-sm font-bold text-amber-500 mt-2">{thirdPlace.totalHits || 0} / 8 中</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">未確定</p>
          )}
        </div>
      </div>

      {/* 一手束中賞 ＆ 四矢皆中賞 ＆ 8射皆中サマリー */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        {/* 一手束中賞 */}
        <div className="bg-slate-800/50 border border-blue-500/30 rounded-lg p-3 space-y-1.5">
          <span className="font-bold text-blue-300 flex items-center gap-1">
            <Target className="w-3.5 h-3.5 text-blue-400" /> 一手束中賞（午前の部 2射2中）
          </span>
          <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
            {ishuSokuchuShooters.length > 0 ? (
              ishuSokuchuShooters.map((p) => (
                <span key={p.id} className="bg-blue-500/20 text-blue-200 px-1.5 py-0.5 rounded font-mono text-[11px]">
                  No.{p.bibNumber} {p.name}
                </span>
              ))
            ) : (
              <span className="text-slate-500 italic">該当者なし</span>
            )}
          </div>
        </div>

        {/* 四矢皆中賞 */}
        <div className="bg-slate-800/50 border border-emerald-500/30 rounded-lg p-3 space-y-1.5">
          <span className="font-bold text-emerald-300 flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 text-emerald-400" /> 四矢皆中賞（午後の部 4射4中）
          </span>
          <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
            {yotsuyaKaichuShooters.length > 0 ? (
              yotsuyaKaichuShooters.map((p) => (
                <span key={p.id} className="bg-emerald-500/20 text-emerald-200 px-1.5 py-0.5 rounded font-mono text-[11px]">
                  No.{p.bibNumber} {p.name}
                </span>
              ))
            ) : (
              <span className="text-slate-500 italic">該当者なし</span>
            )}
          </div>
        </div>

        {/* 8射全皆中 */}
        <div className="bg-slate-800/50 border border-red-500/30 rounded-lg p-3 space-y-1.5">
          <span className="font-bold text-red-300 flex items-center gap-1">
            <Trophy className="w-3.5 h-3.5 text-red-400" /> 8射皆中特別賞（8中）
          </span>
          <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
            {perfectShooters.length > 0 ? (
              perfectShooters.map((p) => (
                <span key={p.id} className="bg-red-500/20 text-red-200 px-1.5 py-0.5 rounded font-mono text-[11px]">
                  No.{p.bibNumber} {p.name}
                </span>
              ))
            ) : (
              <span className="text-slate-500 italic">該当者なし</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}