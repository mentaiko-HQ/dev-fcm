"use client";

import React, { useMemo } from "react";
import { Participant } from "@/types/participant";
import { Trophy, Medal, Award, Flame, Shield, User } from "lucide-react";

interface AwardSummaryCardProps {
  participants: Participant[];
}

export function AwardSummaryCard({ participants }: AwardSummaryCardProps) {
  // 個人戦ランキング（欠席者を除外し、finalRankまたは的中数でソート）
  const rankedIndividuals = useMemo(() => {
    return [...participants]
      .filter((p) => p.qualificationStatus !== "ABSENT")
      .sort((a, b) => {
        if (a.finalRank && b.finalRank) return a.finalRank - b.finalRank;
        if (a.enkinRank && b.enkinRank) return a.enkinRank - b.enkinRank;
        return b.totalHits - a.totalHits;
      });
  }, [participants]);

  // 団体戦ランキング（entryType === 'TEAM' かつ 欠席者を除いた有効チーム的中数の合算集計）
  const rankedTeams = useMemo(() => {
    const teamMap: Record<string, { teamId: string; teamName: string; totalHits: number }> = {};

    participants.forEach((p) => {
      if (p.entryType === "TEAM" && p.teamId && p.qualificationStatus !== "ABSENT") {
        if (!teamMap[p.teamId]) {
          teamMap[p.teamId] = {
            teamId: p.teamId,
            teamName: p.teamName,
            totalHits: 0,
          };
        }
        teamMap[p.teamId].totalHits += p.totalHits;
      }
    });

    return Object.values(teamMap).sort((a, b) => b.totalHits - a.totalHits);
  }, [participants]);

  const topIndividual = rankedIndividuals[0];
  const topTeam = rankedTeams[0];

  const perfectShooters = useMemo(() => {
    return participants.filter(
      (p) => p.qualificationStatus === "ACTIVE" && (p.isPerfect || (p.totalHits === 4 && p.totalShots === 4))
    );
  }, [participants]);

  return (
    <div className="w-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-lg p-5 text-white shadow-md space-y-4">
      <div className="flex justify-between items-center border-b border-slate-700 pb-3">
        <h3 className="font-bold text-base flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-400" />
          大会表彰・成績サマリー（団体・個人 2冠管理）
        </h3>
        <span className="text-xs bg-amber-500/20 text-amber-300 px-2.5 py-0.5 rounded-full border border-amber-500/30 font-semibold">
          公式記録
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 団体戦 優勝 */}
        <div className="bg-slate-800/80 border border-blue-500/40 rounded-lg p-4 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-bold text-blue-400 flex items-center gap-1">
              <Shield className="w-4 h-4 text-blue-400" /> 団体戦 優勝 (第1位)
            </span>
          </div>
          {topTeam ? (
            <div>
              <p className="text-xl font-black text-white">{topTeam.teamName}</p>
              <p className="text-sm font-bold text-blue-400 mt-2">チーム総的中: {topTeam.totalHits} 中</p>
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic">未確定</p>
          )}
        </div>

        {/* 個人戦 優勝 */}
        <div className="bg-slate-800/80 border border-amber-500/40 rounded-lg p-4 flex flex-col justify-between">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-bold text-amber-400 flex items-center gap-1">
              <Trophy className="w-4 h-4 text-amber-400" /> 個人総合 優勝 (第1位)
            </span>
            {topIndividual?.enkinRank && (
              <span className="text-[10px] bg-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded">
                遠近判定 {topIndividual.enkinRank}位
              </span>
            )}
          </div>
          {topIndividual ? (
            <div>
              <p className="text-xl font-black text-white">{topIndividual.playerName}</p>
              <p className="text-xs text-slate-400">{topIndividual.teamName} ({topIndividual.division})</p>
              <p className="text-sm font-bold text-amber-400 mt-2">{topIndividual.totalHits} 中</p>
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