/**
 * 【大会表彰・成績サマリー表示コンポーネント】
 *
 * 役割:
 * - 全8射的中制における上位入賞候補（最高的中者）、皆中達成者、第1立甲矢賞対象者の自動集計および可視化。
 * - 競技全体の総射数・総的中数・全体的中率のリアルタイムサマリー。
 *
 * フールプルーフ設計（操作ミス・型不一致の入口遮断）:
 * - 型インポートを `@/types` に統一し、standAssignments の null 許容型（StandAssignment）と完全適合。
 * - 選手一覧が空配列、またはスコアが未入力の場合でもゼロ除算（NaN%）を防止し安全な数値を算出。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - 立順が未設定（standGroup / standOrder が null）の選手が含まれていても、
 *   各立の矢数配列および的中フラグ（isHayaHit）の集計処理がクラッシュせず安全にフォールバック表示。
 */

'use client';

import React, { useMemo } from 'react';
import { Participant, TOTAL_TOURNAMENT_SHOTS } from '@/types';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Trophy, Award, Target, Users, Flame, Star } from 'lucide-react';

export interface AwardSummaryCardProps {
  participants: Participant[];
}

export function AwardSummaryCard({ participants }: AwardSummaryCardProps) {
  // 表彰対象および統計のリアルタイム集計
  const summary = useMemo(() => {
    const totalCount = participants.length;
    if (totalCount === 0) {
      return {
        topHitCount: 0,
        topShooters: [],
        perfectShooters: [],
        hayaShooters: [],
        totalShots: 0,
        totalHits: 0,
        hitRate: 0,
      };
    }

    // 1. 最高的中数（全8射中）の算出
    const maxHits = Math.max(...participants.map((p) => p.totalHits || 0), 0);
    const topShooters =
      maxHits > 0 ? participants.filter((p) => p.totalHits === maxHits) : [];

    // 2. 皆中達成者（全8射中8的中）
    const perfectShooters = participants.filter(
      (p) => p.totalHits === TOTAL_TOURNAMENT_SHOTS || p.isPerfect,
    );

    // 3. 第1立 甲矢賞対象者（isHayaHit === true）
    const hayaShooters = participants.filter((p) => p.isHayaHit);

    // 4. 大会全体スタッツ
    let cumulativeShots = 0;
    let cumulativeHits = 0;

    participants.forEach((p) => {
      const s1Shots = Array.isArray(p.stand1_arrows)
        ? p.stand1_arrows.length
        : 0;
      const s2Shots = Array.isArray(p.stand2_arrows)
        ? p.stand2_arrows.length
        : 0;
      const s3Shots = Array.isArray(p.stand3_arrows)
        ? p.stand3_arrows.length
        : 0;
      cumulativeShots += s1Shots + s2Shots + s3Shots;
      cumulativeHits += p.totalHits || 0;
    });

    const hitRate =
      cumulativeShots > 0
        ? Math.round((cumulativeHits / cumulativeShots) * 1000) / 10
        : 0;

    return {
      topHitCount: maxHits,
      topShooters,
      perfectShooters,
      hayaShooters,
      totalShots: cumulativeShots,
      totalHits: cumulativeHits,
      hitRate,
    };
  }, [participants]);

  return (
    <Card className="w-full bg-white border-slate-200/80 shadow-sm text-slate-900 rounded-2xl">
      <CardHeader className="pb-3 border-b border-slate-100">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold bg-slate-900 text-white px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <Trophy className="w-3 h-3 text-amber-400" /> 成績サマリー
              </span>
              <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                全8射的中制
              </span>
            </div>
            <CardTitle className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
              表彰・的中集計ステータス
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 font-medium">
              最高的中者、皆中賞、第1立甲矢賞の対象選手および大会全体の的中率を表示します。
            </CardDescription>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
            <span className="text-slate-500">全体的中率:</span>
            <span className="font-black text-slate-900 text-sm">
              {summary.hitRate}%
            </span>
            <span className="text-slate-400">
              ({summary.totalHits}/{summary.totalShots}射)
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* 1. 最高的中（暫定首位・優勝候補） */}
          <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 space-y-2">
            <div className="flex items-center justify-between border-b border-amber-200/60 pb-1.5">
              <span className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-amber-600" />
                最高的中（暫定首位）
              </span>
              <span className="text-xs font-mono font-black text-amber-900 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200">
                {summary.topHitCount} / {TOTAL_TOURNAMENT_SHOTS} 中
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-[11px] text-amber-900 font-bold block">
                該当選手: {summary.topShooters.length} 名
              </span>
              <div className="max-h-24 overflow-y-auto space-y-1 pr-1">
                {summary.topShooters.length > 0 ? (
                  summary.topShooters.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between text-xs bg-white/90 p-1.5 px-2 rounded-lg border border-amber-200/70"
                    >
                      <span className="font-bold text-slate-900 truncate max-w-[140px]">
                        {p.name}
                      </span>
                      <span className="text-[10px] font-mono font-bold text-slate-600">
                        No.{p.bibNumber} ({p.organization || '無所属'})
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-[11px] text-slate-400 block py-1">
                    的中記録がまだありません
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 2. 皆中賞（全8射皆中） */}
          <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-2">
            <div className="flex items-center justify-between border-b border-emerald-200/60 pb-1.5">
              <span className="text-xs font-black text-emerald-950 flex items-center gap-1.5">
                <Star className="w-4 h-4 text-emerald-600" />
                皆中賞（全8射皆中）
              </span>
              <span className="text-xs font-mono font-black text-emerald-900 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-200">
                {summary.perfectShooters.length} 名達成
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-[11px] text-emerald-900 font-bold block">
                達成者一覧
              </span>
              <div className="max-h-24 overflow-y-auto space-y-1 pr-1">
                {summary.perfectShooters.length > 0 ? (
                  summary.perfectShooters.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between text-xs bg-white/90 p-1.5 px-2 rounded-lg border border-emerald-200/70"
                    >
                      <span className="font-bold text-slate-900 truncate max-w-[140px]">
                        {p.name}
                      </span>
                      <span className="text-[10px] font-mono font-bold text-emerald-700">
                        No.{p.bibNumber} (8中)
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-[11px] text-slate-400 block py-1">
                    現在皆中達成者はいません
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* 3. 第1立 甲矢賞（特別賞） */}
          <div className="p-4 rounded-xl border border-red-200 bg-red-50/40 space-y-2">
            <div className="flex items-center justify-between border-b border-red-200/60 pb-1.5">
              <span className="text-xs font-black text-red-950 flex items-center gap-1.5">
                <Award className="w-4 h-4 text-red-600" />
                第1立 甲矢賞（特別賞）
              </span>
              <span className="text-xs font-mono font-black text-red-900 bg-red-100 px-2 py-0.5 rounded-md border border-red-200">
                {summary.hayaShooters.length} 名的中
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-[11px] text-red-900 font-bold block">
                甲矢的中者一覧
              </span>
              <div className="max-h-24 overflow-y-auto space-y-1 pr-1">
                {summary.hayaShooters.length > 0 ? (
                  summary.hayaShooters.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between text-xs bg-white/90 p-1.5 px-2 rounded-lg border border-red-200/70"
                    >
                      <span className="font-bold text-slate-900 truncate max-w-[140px]">
                        {p.name}
                      </span>
                      <span className="text-[10px] font-mono font-bold text-red-700">
                        No.{p.bibNumber}
                      </span>
                    </div>
                  ))
                ) : (
                  <span className="text-[11px] text-slate-400 block py-1">
                    甲矢的中記録はありません
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
