/**
 * 【エントリー参加者データテーブル（進行状況ステータス統一表示対応版）】
 *
 * 役割:
 * - 登録された参加選手の一覧表示、検索、フィルタリング。
 * - 【選手数無制限対応】表示上限を完全撤廃し、全登録選手を無制限に展開・表示。
 * - MatchControlPanel と完全に統一された進行ステータス（「招集中」「控え待機中」「行射中」「行射終了」「未招集」）の表示と絞り込み。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 検索入力時にゼッケン番号、氏名、ふりがな、所属団体を部分一致でリアルタイム抽出。
 * - 棄権（ABSENT）となった選手は視覚的にグレーアウトし、出走選手との誤認を防止。
 * - 午前・午後の立順表示において「第N組（第M立）K番」を併記し、立番号と組番号の混同を防止。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - 参加選手データが0件、空配列、または不正値（undefined/null）の場合でも画面クラッシュを回避。
 */

'use client';

import React, { useState, useMemo } from 'react';
import { Participant, ProgressStatus, calculateGroupFromStand } from '@/types';
import {
  Search,
  CheckCircle2,
  XCircle,
  BellRing,
  ShieldAlert,
  Target,
  Clock,
} from 'lucide-react';

interface ParticipantDataTableProps {
  participants: Participant[];
  onSelectParticipant?: (participant: Participant) => void;
}

/**
 * ProgressStatus を管理画面共通の日本語ラベル・バッジスタイルに変換する
 */
function renderProgressStatusBadge(
  status: ProgressStatus | undefined,
  isAbsent: boolean,
) {
  if (isAbsent) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-800 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
        棄権
      </span>
    );
  }

  switch (status) {
    case 'CALLED':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-black text-slate-950 bg-amber-400 px-2.5 py-0.5 rounded-full shadow-2xs">
          <BellRing className="w-3 h-3" />
          招集中
        </span>
      );
    case 'IN_STAND':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-black text-white bg-blue-600 px-2.5 py-0.5 rounded-full shadow-2xs">
          <ShieldAlert className="w-3 h-3" />
          控え待機中
        </span>
      );
    case 'SHOOTING':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-black text-white bg-emerald-600 px-2.5 py-0.5 rounded-full shadow-2xs">
          <Target className="w-3 h-3" />
          行射中
        </span>
      );
    case 'FINISHED':
    case 'COMPLETED':
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-700 bg-slate-200 px-2 py-0.5 rounded-full">
          <CheckCircle2 className="w-3 h-3 text-slate-600" />
          行射終了
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
          <Clock className="w-3 h-3 text-slate-400" />
          未招集
        </span>
      );
  }
}

export function ParticipantDataTable({
  participants = [],
  onSelectParticipant,
}: ParticipantDataTableProps) {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [filterCheckIn, setFilterCheckIn] = useState<string>('ALL');
  const [filterProgress, setFilterProgress] = useState<string>('ALL');

  const safeParticipants = useMemo(() => {
    return Array.isArray(participants) ? participants : [];
  }, [participants]);

  // フィルタリング処理
  const filteredParticipants = useMemo(() => {
    const trimmedSearch = searchTerm.trim().toLowerCase();

    return safeParticipants.filter((p) => {
      const name = p.name ? p.name.toLowerCase() : '';
      const nameKana = p.nameKana ? p.nameKana.toLowerCase() : '';
      const organization = p.organization ? p.organization.toLowerCase() : '';
      const bibNumber =
        typeof p.bibNumber === 'number' ? p.bibNumber.toString() : '';

      const matchesSearch =
        !trimmedSearch ||
        name.includes(trimmedSearch) ||
        nameKana.includes(trimmedSearch) ||
        organization.includes(trimmedSearch) ||
        bibNumber.includes(trimmedSearch);

      const matchesCheckIn =
        filterCheckIn === 'ALL' || p.checkInStatus === filterCheckIn;

      const matchesProgress =
        filterProgress === 'ALL' ||
        (p.progressStatus || 'WAITING') === filterProgress;

      return matchesSearch && matchesCheckIn && matchesProgress;
    });
  }, [safeParticipants, searchTerm, filterCheckIn, filterProgress]);

  return (
    <div className="w-full bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-4">
      {/* 検索・絞り込みツールバー */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="relative flex-1 w-full lg:max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="ゼッケン・氏名・ふりがな・所属で検索..."
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:bg-white focus:border-slate-900 font-medium transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 self-end lg:self-auto">
          {/* 進行状況フィルタ */}
          <select
            aria-label="進行状況で絞り込み"
            value={filterProgress}
            onChange={(e) => setFilterProgress(e.target.value)}
            className="p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none cursor-pointer"
          >
            <option value="ALL">進行状況: 全員</option>
            <option value="SHOOTING">行射中</option>
            <option value="IN_STAND">控え待機中</option>
            <option value="CALLED">招集中</option>
            <option value="WAITING">未招集</option>
            <option value="FINISHED">行射終了</option>
          </select>

          {/* 受付状態フィルタ */}
          <select
            aria-label="受付状態で絞り込み"
            value={filterCheckIn}
            onChange={(e) => setFilterCheckIn(e.target.value)}
            className="p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none cursor-pointer"
          >
            <option value="ALL">受付状態: 全員</option>
            <option value="CHECKED_IN">受付済</option>
            <option value="UNCHECKED">未受付</option>
            <option value="ABSENT">棄権 (欠席)</option>
          </select>

          <span className="text-xs font-mono font-bold text-slate-500 whitespace-nowrap">
            該当:{' '}
            <strong className="text-slate-900">
              {filteredParticipants.length}
            </strong>{' '}
            / {safeParticipants.length} 名
          </span>
        </div>
      </div>

      {/* テーブル本体 */}
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left text-xs min-w-[820px]">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px]">
            <tr>
              <th className="py-2.5 px-3 font-bold">ゼッケン</th>
              <th className="py-2.5 px-3 font-bold">選手氏名</th>
              <th className="py-2.5 px-3 font-bold">所属団体</th>
              <th className="py-2.5 px-3 font-bold">称号・段位</th>
              <th className="py-2.5 px-3 font-bold">所作</th>
              <th className="py-2.5 px-3 font-bold">午前立順</th>
              <th className="py-2.5 px-3 font-bold">午後立順</th>
              <th className="py-2.5 px-3 font-bold">進行状況</th>
              <th className="py-2.5 px-3 font-bold">受付状況</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-medium">
            {filteredParticipants.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="py-12 text-center text-slate-400 text-xs font-medium"
                >
                  該当する参加選手はいません。
                </td>
              </tr>
            ) : (
              filteredParticipants.map((p) => {
                const isAbsent = p.checkInStatus === 'ABSENT';
                const morning = p.standAssignments
                  ? p.standAssignments[1]
                  : null;
                const afternoon = p.standAssignments
                  ? p.standAssignments[2]
                  : null;

                const amGroup = morning?.standGroup
                  ? calculateGroupFromStand(morning.standGroup)
                  : null;
                const pmGroup = afternoon?.standGroup
                  ? calculateGroupFromStand(afternoon.standGroup)
                  : null;

                return (
                  <tr
                    key={p.id}
                    onClick={() =>
                      onSelectParticipant && onSelectParticipant(p)
                    }
                    className={`hover:bg-slate-50/80 transition-colors ${
                      isAbsent ? 'opacity-50 bg-rose-50/20' : ''
                    } ${onSelectParticipant ? 'cursor-pointer' : ''}`}
                  >
                    <td className="py-3 px-3 font-mono font-black text-slate-900">
                      No.{p.bibNumber}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900 text-sm">
                        {p.name || '選手名未設定'}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {p.nameKana || ''}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-700 font-bold">
                      {p.organization || '無所属'}
                    </td>
                    <td className="py-3 px-3 text-slate-600">
                      {p.rankTitle || '段位は三段以下'}
                    </td>
                    <td className="py-3 px-3 font-bold">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] ${
                          p.shosa === '肌脱ぎ'
                            ? 'bg-slate-100 text-slate-800'
                            : 'bg-amber-50 text-amber-900 border border-amber-200'
                        }`}
                      >
                        {p.shosa || '肌脱ぎ'}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700">
                      {morning && morning.standGroup && morning.standOrder
                        ? `第${amGroup}組(第${morning.standGroup}立) ${morning.standOrder}番`
                        : '未定'}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate-700">
                      {afternoon && afternoon.standGroup && afternoon.standOrder
                        ? `第${pmGroup}組(第${afternoon.standGroup}立) ${afternoon.standOrder}番`
                        : '未定'}
                    </td>
                    <td className="py-3 px-3">
                      {renderProgressStatusBadge(p.progressStatus, isAbsent)}
                    </td>
                    <td className="py-3 px-3">
                      {p.checkInStatus === 'CHECKED_IN' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />{' '}
                          受付済
                        </span>
                      ) : p.checkInStatus === 'ABSENT' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-800 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                          <XCircle className="w-3.5 h-3.5 text-rose-600" /> 棄権
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                          未受付
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
