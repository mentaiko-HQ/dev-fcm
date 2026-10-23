/**
 * 【表彰・成績サマリーおよび各種賞リアルタイム集計コンポーネント】
 *
 * 役割:
 * - 各種アワード（甲矢的中賞、一手束中賞、四矢皆中賞）の人数および該当選手リストをリアルタイムに抽出・一覧表示。
 * - 現在の最高的中数および上位成績者（優勝・入賞候補）の集計表示。
 * - 四矢皆中賞と最高的中者のリストを完全に分離し、独立したレイアウトで可視化。
 * - 【一手束中賞の独立集計】: 第1ステージと第2ステージの両方で2中を達成した場合、それぞれのステージ実績として名前を2つ（2件）表示。
 * - 表彰担当スタッフ向けに「受賞リスト」をワンクリックでクリップボードへコピーする機能を提供。
 *
 * フールプルーフ設計（事故前・対人間）:
 * 1. 棄権（ABSENT / WITHDRAWN）となった選手は、的中記録が残っていても自動的に表彰対象から除外。
 * 2. 対象者が0名の場合はコピーボタンを非活性化（disabled）し、空データの誤コピーを遮断。
 * 3. 束中賞などで同一選手が複数回リストアップされる場合、Reactのレンダリングエラーを防ぐため一意の複合キーを生成。
 * 4. 各賞と最高的中者を独立したカードに分割し、運営スタッフのアナウンスや集計時の混同を防止。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * 1. DBのフラグだけでなく、矢配列の実績データもOR条件で評価し、データ不整合時でも受賞者を確実に漏れなく抽出。
 * 2. クリップボードAPI（navigator.clipboard）が権限エラー等で失敗した場合はエラーログを出力し、UI上に警告を表示。
 * 3. 渡された participants 配列が不正値（null/undefined）でもクラッシュしない安全側デフォルト配列を適用。
 */

'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { Participant, TOTAL_TOURNAMENT_SHOTS } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Award,
  Sparkles,
  Trophy,
  Users,
  Copy,
  CheckCircle2,
  AlertCircle,
  Target,
} from 'lucide-react';

interface AwardSummaryCardProps {
  participants: Participant[];
}

// 画面表示・コピー用の共通型
type AwardWinner = {
  participant: Participant;
  tag?: string; // 重複表示用のタグ (例: '第1S', '第2S')
};

function isActiveParticipant(p: Participant): boolean {
  return (
    p.checkInStatus !== 'ABSENT' &&
    p.qualificationStatus !== 'WITHDRAWN' &&
    p.qualificationStatus !== 'DISQUALIFIED'
  );
}

function getSafeTotalHits(p: Participant): number {
  const s1 = Array.isArray(p.stand1_arrows)
    ? p.stand1_arrows.filter((hit) => hit === true).length
    : 0;
  const s2 = Array.isArray(p.stand2_arrows)
    ? p.stand2_arrows.filter((hit) => hit === true).length
    : 0;
  const s3 = Array.isArray(p.stand3_arrows)
    ? p.stand3_arrows.filter((hit) => hit === true).length
    : 0;

  const calculated = s1 + s2 + s3;
  const stored = typeof p.totalHits === 'number' ? p.totalHits : 0;

  return Math.max(calculated, stored);
}

export function AwardSummaryCard({ participants = [] }: AwardSummaryCardProps) {
  const [copyFeedback, setCopyFeedback] = useState<string>('');
  const [copyError, setCopyError] = useState<string>('');

  const safeParticipants = useMemo(() => {
    return Array.isArray(participants) ? participants : [];
  }, [participants]);

  const activeParticipants = useMemo(() => {
    return safeParticipants.filter(isActiveParticipant);
  }, [safeParticipants]);

  // 1. 【甲矢的中賞】第1ステージ1本目が〇であること
  const hayaHitWinners: AwardWinner[] = useMemo(() => {
    return activeParticipants
      .filter((p) => {
        const isFirstArrowHit =
          Array.isArray(p.stand1_arrows) && p.stand1_arrows[0] === true;
        return Boolean(p.isHayaHit) || isFirstArrowHit;
      })
      .map((p) => ({ participant: p }))
      .sort((a, b) => a.participant.bibNumber - b.participant.bibNumber);
  }, [activeParticipants]);

  // 2. 【一手束中賞】第1ステージ および 第2ステージで2中を独立して評価（両方達成なら2件登録）
  const sokuchuWinners: AwardWinner[] = useMemo(() => {
    const winners: AwardWinner[] = [];
    activeParticipants.forEach((p) => {
      const s1Hits = Array.isArray(p.stand1_arrows)
        ? p.stand1_arrows.filter((h) => h === true).length
        : 0;
      const s2Hits = Array.isArray(p.stand2_arrows)
        ? p.stand2_arrows.filter((h) => h === true).length
        : 0;

      let added = false;
      if (s1Hits === 2) {
        winners.push({ participant: p, tag: '第1S' });
        added = true;
      }
      if (s2Hits === 2) {
        winners.push({ participant: p, tag: '第2S' });
        added = true;
      }
      // フェイルセーフ: 実績スコアがなくともフラグが立っている場合の救済
      if (!added && p.isSokuchu) {
        winners.push({ participant: p, tag: '不明' });
      }
    });
    return winners.sort(
      (a, b) => a.participant.bibNumber - b.participant.bibNumber,
    );
  }, [activeParticipants]);

  // 3. 【四矢皆中賞】第3ステージで4中を達成していること
  const perfectWinners: AwardWinner[] = useMemo(() => {
    return activeParticipants
      .filter((p) => {
        const s3Hits = Array.isArray(p.stand3_arrows)
          ? p.stand3_arrows.filter((h) => h === true).length
          : 0;
        return Boolean(p.isPerfect) || s3Hits === 4;
      })
      .map((p) => ({ participant: p }))
      .sort((a, b) => a.participant.bibNumber - b.participant.bibNumber);
  }, [activeParticipants]);

  // 4. 【現在の上位的中者・トップスコア】
  const { maxHits, topScorers } = useMemo(() => {
    let currentMax = 0;
    activeParticipants.forEach((p) => {
      const hits = getSafeTotalHits(p);
      if (hits > currentMax) {
        currentMax = hits;
      }
    });

    if (currentMax === 0) {
      return { maxHits: 0, topScorers: [] as AwardWinner[] };
    }

    const scorers = activeParticipants
      .filter((p) => getSafeTotalHits(p) === currentMax)
      .map((p) => ({ participant: p }))
      .sort((a, b) => {
        if (
          a.participant.finalRank !== null &&
          b.participant.finalRank !== null
        ) {
          return a.participant.finalRank - b.participant.finalRank;
        }
        return a.participant.bibNumber - b.participant.bibNumber;
      });

    return { maxHits: currentMax, topScorers: scorers };
  }, [activeParticipants]);

  const handleCopyList = useCallback(
    async (title: string, targetList: AwardWinner[]) => {
      setCopyFeedback('');
      setCopyError('');

      if (targetList.length === 0) {
        return;
      }

      try {
        const lines = targetList.map((item) => {
          const p = item.participant;
          const tagStr = item.tag ? ` [${item.tag}]` : '';
          const standNum = p.standAssignments?.[1]?.standGroup ?? '-';
          const orderNum = p.standAssignments?.[1]?.standOrder ?? '-';
          return `No.${p.bibNumber}\t${p.name} (${p.organization || '無所属'})${tagStr}\t[第1S: 第${standNum}立 ${orderNum}番]`;
        });

        const textToCopy = `【${title}（計 ${targetList.length} 件）】\n${lines.join('\n')}`;
        await navigator.clipboard.writeText(textToCopy);

        setCopyFeedback(
          `「${title}」（${targetList.length}件）をクリップボードにコピーしました。`,
        );
        setTimeout(() => setCopyFeedback(''), 3000);
      } catch (error: unknown) {
        console.error('【表彰リストコピーエラー】:', error);
        setCopyError(
          'クリップボードへのコピーに失敗しました。ブラウザの権限設定を確認してください。',
        );
      }
    },
    [],
  );

  return (
    <div className="w-full space-y-4">
      {copyFeedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs font-bold flex items-center gap-2 shadow-2xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{copyFeedback}</span>
        </div>
      )}

      {copyError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-bold flex items-center gap-2 shadow-2xs">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{copyError}</span>
        </div>
      )}

      {/* 上段: 5つのサマリー統計KPIカード */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl flex flex-col justify-between">
          <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
            <Users className="w-4 h-4 text-slate-500" />
            出場選手数 (棄権除)
          </span>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="text-2xl font-black font-mono text-slate-900">
              {activeParticipants.length}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              / 全 {safeParticipants.length} 名
            </span>
          </div>
        </div>

        <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex flex-col justify-between">
          <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-emerald-600" />
            甲矢的中賞 (第1S 1本目〇)
          </span>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <span className="text-2xl font-black font-mono text-emerald-900">
                {hayaHitWinners.length}
              </span>
              <span className="text-xs text-emerald-700 font-bold ml-1">
                名
              </span>
            </div>
          </div>
        </div>

        <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-2xl flex flex-col justify-between">
          <span className="text-xs font-bold text-blue-900 flex items-center gap-1.5">
            <Target className="w-4 h-4 text-blue-600" />
            一手束中賞 (1S・2Sで2中)
          </span>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <span className="text-2xl font-black font-mono text-blue-900">
                {sokuchuWinners.length}
              </span>
              <span className="text-xs text-blue-700 font-bold ml-1">件</span>
            </div>
          </div>
        </div>

        <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl flex flex-col justify-between">
          <span className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
            <Award className="w-4 h-4 text-amber-600" />
            四矢皆中賞 (第3Sで4中)
          </span>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <span className="text-2xl font-black font-mono text-amber-950">
                {perfectWinners.length}
              </span>
              <span className="text-xs text-amber-800 font-bold ml-1">名</span>
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-900 text-white rounded-2xl flex flex-col justify-between shadow-xs">
          <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Trophy className="w-4 h-4 text-amber-400" />
            現在の最高的中数
          </span>
          <div className="mt-2 flex items-baseline justify-between">
            <div>
              <span className="text-2xl font-black font-mono text-amber-400">
                {maxHits}
              </span>
              <span className="text-xs text-slate-300 font-mono ml-1">
                / {TOTAL_TOURNAMENT_SHOTS}中
              </span>
            </div>
            <span className="text-[10px] font-mono font-bold text-slate-200 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-md">
              該当: {topScorers.length}名
            </span>
          </div>
        </div>
      </div>

      {/* 下段: 賞カテゴリごとのリスト表示エリア */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 左カラム: 甲矢的中賞 & 一手束中賞 */}
        <div className="space-y-4">
          {/* 甲矢的中賞 リスト */}
          <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-2xs flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800">
                  <Sparkles className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    甲矢的中賞 対象選手一覧
                    <span className="text-xs font-mono font-black bg-emerald-600 text-white px-2 py-0.2 rounded-full">
                      {hayaHitWinners.length}名
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium">
                    第1ステージの1本目を「〇」とした選手
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={hayaHitWinners.length === 0}
                onClick={() => handleCopyList('甲矢的中賞', hayaHitWinners)}
                className="h-8 text-xs font-bold border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl shrink-0 disabled:opacity-40"
              >
                <Copy className="w-3.5 h-3.5 mr-1 text-slate-500" />
                名簿コピー
              </Button>
            </div>

            {hayaHitWinners.length === 0 ? (
              <div className="py-6 text-center text-slate-400 text-xs font-medium bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
                該当選手はいません。
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {hayaHitWinners.map((item) => (
                  <div
                    key={item.participant.id}
                    className="p-2.5 bg-emerald-50/40 border border-emerald-200/80 rounded-xl flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span className="font-mono font-black text-[11px] text-emerald-900 bg-emerald-100 border border-emerald-300 px-1.5 py-0.2 rounded shrink-0">
                        No.{item.participant.bibNumber}
                      </span>
                      <span className="font-black text-slate-900 truncate">
                        {item.participant.name}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 一手束中賞 リスト */}
          <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-2xs flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-blue-100 text-blue-800">
                  <Target className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    一手束中賞 対象選手一覧
                    <span className="text-xs font-mono font-black bg-blue-600 text-white px-2 py-0.2 rounded-full">
                      {sokuchuWinners.length}件
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium">
                    第1および第2ステージで2中を達成した選手（両ステージ達成で2件表示）
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sokuchuWinners.length === 0}
                onClick={() => handleCopyList('一手束中賞', sokuchuWinners)}
                className="h-8 text-xs font-bold border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl shrink-0 disabled:opacity-40"
              >
                <Copy className="w-3.5 h-3.5 mr-1 text-slate-500" />
                名簿コピー
              </Button>
            </div>

            {sokuchuWinners.length === 0 ? (
              <div className="py-6 text-center text-slate-400 text-xs font-medium bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
                該当選手はいません。
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {sokuchuWinners.map((item, idx) => (
                  <div
                    key={`${item.participant.id}-${idx}`}
                    className="p-2.5 bg-blue-50/40 border border-blue-200/80 rounded-xl flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span className="font-mono font-black text-[11px] text-blue-900 bg-blue-100 border border-blue-300 px-1.5 py-0.2 rounded shrink-0">
                        No.{item.participant.bibNumber}
                      </span>
                      <span className="font-black text-slate-900 truncate">
                        {item.participant.name}
                      </span>
                      {item.tag && (
                        <span className="text-[9px] font-bold text-blue-800 bg-white border border-blue-200 px-1 rounded-sm ml-1 shrink-0">
                          {item.tag}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右カラム: 四矢皆中賞 & 最高的中者リスト */}
        <div className="space-y-4">
          {/* 四矢皆中賞 リスト */}
          <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-2xs flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-amber-100 text-amber-800">
                  <Award className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    四矢皆中賞 対象選手一覧
                    <span className="text-xs font-mono font-black bg-amber-600 text-white px-2 py-0.2 rounded-full">
                      {perfectWinners.length}名
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium">
                    第3ステージ(四矢)で4中を達成した選手
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={perfectWinners.length === 0}
                onClick={() => handleCopyList('四矢皆中賞', perfectWinners)}
                className="h-8 text-xs font-bold border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl shrink-0 disabled:opacity-40"
              >
                <Copy className="w-3.5 h-3.5 mr-1 text-slate-500" />
                名簿コピー
              </Button>
            </div>

            {perfectWinners.length === 0 ? (
              <div className="py-6 text-center text-slate-400 text-xs font-medium bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
                該当選手はいません。
              </div>
            ) : (
              <div className="max-h-40 overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {perfectWinners.map((item) => (
                  <div
                    key={item.participant.id}
                    className="p-2.5 bg-amber-50/40 border border-amber-200/80 rounded-xl flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span className="font-mono font-black text-[11px] text-amber-900 bg-amber-100 border border-amber-300 px-1.5 py-0.2 rounded shrink-0">
                        No.{item.participant.bibNumber}
                      </span>
                      <span className="font-black text-slate-900 truncate">
                        {item.participant.name}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 最高的中者 リスト */}
          <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-2xs flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-slate-900 text-amber-400">
                  <Trophy className="w-4 h-4" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    最高的中者 ({maxHits}中)
                    <span className="text-xs font-mono font-black bg-slate-900 text-white px-2 py-0.2 rounded-full">
                      {topScorers.length}名
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium">
                    全ステージ通算でのトップスコア達成選手一覧
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={topScorers.length === 0}
                onClick={() =>
                  handleCopyList(`最高的中者(${maxHits}中)`, topScorers)
                }
                className="h-8 text-xs font-bold border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl shrink-0 disabled:opacity-40"
              >
                <Copy className="w-3.5 h-3.5 mr-1 text-slate-500" />
                名簿コピー
              </Button>
            </div>

            {topScorers.length === 0 ? (
              <div className="py-6 text-center text-slate-400 text-xs font-medium bg-slate-50/60 rounded-xl border border-dashed border-slate-200">
                まだ的中記録が入力されていません。
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto pr-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {topScorers.map((item) => {
                  const p = item.participant;
                  const hits = getSafeTotalHits(p);
                  const isPerfectPlayer = perfectWinners.some(
                    (w) => w.participant.id === p.id,
                  );

                  return (
                    <div
                      key={p.id}
                      className="p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs bg-slate-50 border-slate-200/80"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-black text-[11px] text-slate-700 bg-white border border-slate-300 px-1.5 py-0.2 rounded shrink-0">
                            No.{p.bibNumber}
                          </span>
                          <span className="font-black text-slate-900 truncate">
                            {p.name}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 font-medium mt-0.5 truncate">
                          {p.organization || '無所属'}
                        </div>
                      </div>

                      <div className="flex items-center shrink-0 gap-1.5">
                        {isPerfectPlayer && (
                          <span className="text-[9px] font-black bg-amber-500 text-slate-950 px-1.5 py-0.5 rounded">
                            四矢皆中
                          </span>
                        )}
                        <span className="text-xs font-mono font-black text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded-lg flex items-center gap-1">
                          <Target className="w-3 h-3 text-red-600" />
                          {hits}中
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
