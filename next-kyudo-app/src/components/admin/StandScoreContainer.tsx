/**
 * 【競技記録員用 スコア入力コンソール（組単位10名表示・各矢〇✕個別入力・自動判定版）】
 *
 * 役割:
 * - 1組＝2立（計10名）を一画面に表示し、ステージ別の個別矢入力（〇/✕）を行うコンソール。
 * - 【受付済み選手限定表示】当日受付（/admin/reception）にて「受付済」となった選手のみを対象として表示。
 * - 【自動判定の連動】
 *   - 甲矢的中賞: 第1ステージ1本目（インデックス0）が〇の場合のみ `isHayaHit = true` に更新。
 *   - 一手束中賞: 第1ステージまたは第2ステージにおいて、合計2中した場合に `isSokuchu = true` に更新。
 *   - 四矢皆中賞: 第3ステージにおいて、合計4中した場合に `isPerfect = true` に更新。
 *
 * フールプルーフ設計（事故前・対人間）:
 * 1. 未受付や棄権の選手をスコア入力対象から完全除外することで、当日不在の選手の誤入力を防止。
 * 2. 甲矢的中賞のフラグ判定を `selectedRound === 1` に限定。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * 1. 楽観的UI更新を行い、Firestore書き込み失敗時は直前の状態へ自動ロールバック。
 */

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  serverTimestamp,
  orderBy,
} from 'firebase/firestore';
import {
  db,
  isFirebaseConfigured,
  isFirestoreAvailable,
  ensureAnonymousAuth,
} from '@/lib/firebase';
import {
  TournamentConfig,
  StandRoundIndex,
  Participant,
  StandOrderIndex,
  ArrowHit,
  sanitizeStandGroup,
  sanitizeStandOrder,
} from '@/types';
import { ScoreButton } from '@/components/admin/ScoreButton';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Target,
  Sun,
  Moon,
  Users,
  Undo2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Layers,
  Award,
} from 'lucide-react';

interface StandScoreContainerProps {
  tournamentConfig: TournamentConfig;
}

interface UndoHistoryEntry {
  participantId: string;
  bibNumber: number;
  playerName: string;
  round: StandRoundIndex;
  previousArrows: (ArrowHit | null)[];
  previousHayaHit: boolean;
  previousSokuchu: boolean;
  previousPerfect: boolean;
  previousTotalHits: number;
}

const PLAYERS_PER_STAND = 5;
const STANDS_PER_GROUP = 2;
const PLAYERS_PER_GROUP = PLAYERS_PER_STAND * STANDS_PER_GROUP;

function getStandNumbersByGroup(groupNumber: number): [number, number] {
  const safeGroup = Math.max(1, Math.floor(groupNumber));
  const firstStand = (safeGroup - 1) * STANDS_PER_GROUP + 1;
  const secondStand = safeGroup * STANDS_PER_GROUP;
  return [firstStand, secondStand];
}

function getStageName(round: StandRoundIndex): string {
  switch (round) {
    case 1:
      return '第1ステージ (午前・一手 2射)';
    case 2:
      return '第2ステージ (午後・一手 2射)';
    case 3:
      return '第3ステージ (午後・四矢 4射)';
    default:
      return `第${round}ステージ`;
  }
}

function getStandOrderLabel(order: StandOrderIndex | null | undefined): string {
  if (!order) return '未定';
  const labels: Record<number, string> = {
    1: '大前 (1番)',
    2: '二的 (2番)',
    3: '中 (3番)',
    4: '落前 (4番)',
    5: '落 (5番)',
  };
  return labels[order] || `${order}番`;
}

function countHits(arrows: (ArrowHit | null | undefined)[]): number {
  if (!Array.isArray(arrows)) return 0;
  return arrows.filter((hit) => hit === true).length;
}

export function StandScoreContainer({
  tournamentConfig,
}: StandScoreContainerProps) {
  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  const [selectedRound, setSelectedRound] = useState<StandRoundIndex>(1);
  const [selectedGroupNumber, setSelectedGroupNumber] = useState<number>(1);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(() => isDbReady);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [undoStack, setUndoStack] = useState<UndoHistoryEntry[]>([]);

  useEffect(() => {
    if (!isDbReady) return;
    ensureAnonymousAuth().catch((err) => {
      console.warn('【StandScoreContainer】初期認証確認警告:', err);
    });
  }, [isDbReady]);

  useEffect(() => {
    if (!isDbReady) return;

    const q = query(collection(db, 'entries'), orderBy('bibNumber', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const loaded: Participant[] = [];
        snapshot.forEach((docSnap) => {
          const raw = docSnap.data();
          const rawAssignments = raw.standAssignments || {};

          const afternoonGroup = sanitizeStandGroup(
            rawAssignments[2]?.standGroup ??
              rawAssignments[3]?.standGroup ??
              null,
          );
          const afternoonOrder = sanitizeStandOrder(
            rawAssignments[2]?.standOrder ??
              rawAssignments[3]?.standOrder ??
              null,
          );

          loaded.push({
            id: docSnap.id,
            bibNumber:
              typeof raw.bibNumber === 'number'
                ? raw.bibNumber
                : Number(raw.bibNumber) || 1,
            name: typeof raw.name === 'string' ? raw.name : '選手名未設定',
            nameKana: typeof raw.nameKana === 'string' ? raw.nameKana : '',
            organization:
              typeof raw.organization === 'string'
                ? raw.organization
                : '無所属',
            shosa: raw.shosa || '肌脱ぎ',
            rankTitle: raw.rankTitle || '段位は三段以下',
            staffRole: raw.staffRole || '無し',
            staffDutyShift: raw.staffDutyShift || '無し',
            checkInStatus: raw.checkInStatus || 'UNCHECKED',
            checkInAt: typeof raw.checkInAt === 'number' ? raw.checkInAt : null,
            isStaffVolunteer: Boolean(raw.isStaffVolunteer),
            needsSupport: Boolean(raw.needsSupport),
            standAssignments: {
              1: {
                standGroup: sanitizeStandGroup(
                  rawAssignments[1]?.standGroup ?? null,
                ),
                standOrder: sanitizeStandOrder(
                  rawAssignments[1]?.standOrder ?? null,
                ),
              },
              2: {
                standGroup: afternoonGroup,
                standOrder: afternoonOrder,
              },
              3: {
                standGroup: afternoonGroup,
                standOrder: afternoonOrder,
              },
            },
            progressStatus: raw.progressStatus || 'WAITING',
            qualificationStatus: raw.qualificationStatus || 'ACTIVE',
            stand1_arrows: Array.isArray(raw.stand1_arrows)
              ? raw.stand1_arrows
              : [],
            stand2_arrows: Array.isArray(raw.stand2_arrows)
              ? raw.stand2_arrows
              : [],
            stand3_arrows: Array.isArray(raw.stand3_arrows)
              ? raw.stand3_arrows
              : [],
            isHayaHit: Boolean(raw.isHayaHit),
            isSokuchu: Boolean(raw.isSokuchu),
            totalHits:
              typeof raw.totalHits === 'number'
                ? raw.totalHits
                : Number(raw.totalHits) || 0,
            totalShots:
              typeof raw.totalShots === 'number'
                ? raw.totalShots
                : Number(raw.totalShots) || 8,
            isPerfect: Boolean(raw.isPerfect),
            enkinRank: typeof raw.enkinRank === 'number' ? raw.enkinRank : null,
            finalRank: typeof raw.finalRank === 'number' ? raw.finalRank : null,
            representativeName:
              typeof raw.representativeName === 'string'
                ? raw.representativeName
                : '',
            representativeEmail:
              typeof raw.representativeEmail === 'string'
                ? raw.representativeEmail
                : '',
            representativePhone:
              typeof raw.representativePhone === 'string'
                ? raw.representativePhone
                : '',
            representativeOrganization:
              typeof raw.representativeOrganization === 'string'
                ? raw.representativeOrganization
                : '',
            isPaid: Boolean(raw.isPaid),
            paidAt: typeof raw.paidAt === 'number' ? raw.paidAt : null,
            notes: typeof raw.notes === 'string' ? raw.notes : '',
            qrSentStatus: raw.qrSentStatus || 'UNSENT',
            qrSentAt: typeof raw.qrSentAt === 'number' ? raw.qrSentAt : null,
            qrSentError: raw.qrSentError || null,
          });
        });

        setParticipants(loaded);
        setIsLoading(false);
      },
      (error) => {
        console.error('【スコア入力Firestore購読エラー】:', error);
        setErrorMessage('参加者データの取得に失敗しました。');
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [isDbReady]);

  // ★ 受付済み（CHECKED_IN）の選手のみにフィルタリング
  const checkedInParticipants = useMemo(() => {
    return participants.filter((p) => p.checkInStatus === 'CHECKED_IN');
  }, [participants]);

  // グループオプションの動的生成（受付済み選手ベース）
  const groupOptions = useMemo(() => {
    let maxAssignedStand = 1;
    checkedInParticipants.forEach((p) => {
      ([1, 2, 3] as StandRoundIndex[]).forEach((r) => {
        const s = p.standAssignments[r]?.standGroup;
        if (s && s > maxAssignedStand) {
          maxAssignedStand = s;
        }
      });
    });

    const groupsFromMaxStand = Math.ceil(maxAssignedStand / STANDS_PER_GROUP);
    const groupsFromPlayerCount = Math.ceil(
      checkedInParticipants.length / PLAYERS_PER_GROUP,
    );
    const groupsFromConfig = Math.ceil(
      (tournamentConfig.totalStandGroups || 1) / STANDS_PER_GROUP,
    );

    const totalGroups = Math.max(
      1,
      groupsFromMaxStand,
      groupsFromPlayerCount,
      groupsFromConfig,
    );

    return Array.from({ length: totalGroups }, (_, i) => i + 1);
  }, [checkedInParticipants, tournamentConfig.totalStandGroups]);

  const [firstStandNumber, secondStandNumber] = useMemo(() => {
    return getStandNumbersByGroup(selectedGroupNumber);
  }, [selectedGroupNumber]);

  const firstStandParticipants = useMemo(() => {
    return checkedInParticipants
      .filter((p) => {
        const assign = p.standAssignments[selectedRound];
        return assign && assign.standGroup === firstStandNumber;
      })
      .sort((a, b) => {
        const orderA = a.standAssignments[selectedRound]?.standOrder ?? 99;
        const orderB = b.standAssignments[selectedRound]?.standOrder ?? 99;
        return orderA - orderB;
      });
  }, [checkedInParticipants, selectedRound, firstStandNumber]);

  const secondStandParticipants = useMemo(() => {
    return checkedInParticipants
      .filter((p) => {
        const assign = p.standAssignments[selectedRound];
        return assign && assign.standGroup === secondStandNumber;
      })
      .sort((a, b) => {
        const orderA = a.standAssignments[selectedRound]?.standOrder ?? 99;
        const orderB = b.standAssignments[selectedRound]?.standOrder ?? 99;
        return orderA - orderB;
      });
  }, [checkedInParticipants, selectedRound, secondStandNumber]);

  const currentGroupTotalPlayers =
    firstStandParticipants.length + secondStandParticipants.length;

  /**
   * 【各矢の〇・✕個別入力ハンドラー】
   */
  const handleSelectArrow = useCallback(
    async (
      participant: Participant,
      arrowIndex: number,
      result: boolean | null,
    ) => {
      if (!isDbReady) return;

      if (
        participant.checkInStatus === 'ABSENT' ||
        participant.qualificationStatus === 'WITHDRAWN'
      ) {
        setErrorMessage(
          `No.${participant.bibNumber} ${participant.name} 選手は棄権のためスコアを入力できません。`,
        );
        return;
      }

      setSavingId(participant.id);
      setErrorMessage('');

      const previousState = { ...participant };
      const previousArrows =
        selectedRound === 1
          ? [...participant.stand1_arrows]
          : selectedRound === 2
            ? [...participant.stand2_arrows]
            : [...participant.stand3_arrows];
      const previousHayaHit = participant.isHayaHit;
      const previousSokuchu = participant.isSokuchu;
      const previousPerfect = participant.isPerfect;
      const previousTotalHits = participant.totalHits;

      const maxArrows = selectedRound === 3 ? 4 : 2;
      const updatedArrows = Array.from({ length: maxArrows }, (_, idx) => {
        if (idx === arrowIndex) {
          return result;
        }
        return previousArrows[idx] !== undefined ? previousArrows[idx] : null;
      }) as ArrowHit[];

      const nextHayaHit =
        selectedRound === 1 ? updatedArrows[0] === true : participant.isHayaHit;

      const s1Hits =
        selectedRound === 1
          ? countHits(updatedArrows)
          : countHits(participant.stand1_arrows);
      const s2Hits =
        selectedRound === 2
          ? countHits(updatedArrows)
          : countHits(participant.stand2_arrows);
      const s3Hits =
        selectedRound === 3
          ? countHits(updatedArrows)
          : countHits(participant.stand3_arrows);

      const nextSokuchu = s1Hits === 2 || s2Hits === 2;
      const nextPerfect = s3Hits === 4;

      const nextTotalHits = s1Hits + s2Hits + s3Hits;

      // 楽観的UI更新
      setParticipants((prev) =>
        prev.map((p) => {
          if (p.id !== participant.id) return p;
          return {
            ...p,
            stand1_arrows:
              selectedRound === 1 ? updatedArrows : p.stand1_arrows,
            stand2_arrows:
              selectedRound === 2 ? updatedArrows : p.stand2_arrows,
            stand3_arrows:
              selectedRound === 3 ? updatedArrows : p.stand3_arrows,
            isHayaHit: nextHayaHit,
            isSokuchu: nextSokuchu,
            isPerfect: nextPerfect,
            totalHits: nextTotalHits,
          };
        }),
      );

      try {
        await ensureAnonymousAuth();

        const docRef = doc(db, 'entries', participant.id);
        const updatePayload: Record<string, unknown> = {
          totalHits: nextTotalHits,
          isPerfect: nextPerfect,
          isSokuchu: nextSokuchu,
          updatedAt: serverTimestamp(),
        };

        if (selectedRound === 1) {
          updatePayload.stand1_arrows = updatedArrows;
          updatePayload.isHayaHit = nextHayaHit;
        } else if (selectedRound === 2) {
          updatePayload.stand2_arrows = updatedArrows;
        } else {
          updatePayload.stand3_arrows = updatedArrows;
        }

        await updateDoc(docRef, updatePayload);

        setUndoStack((prev) => [
          {
            participantId: participant.id,
            bibNumber: participant.bibNumber,
            playerName: participant.name,
            round: selectedRound,
            previousArrows,
            previousHayaHit,
            previousSokuchu,
            previousPerfect,
            previousTotalHits,
          },
          ...prev.slice(0, 9),
        ]);

        const markLabel =
          result === true
            ? '〇（的中）'
            : result === false
              ? '✕（はずれ）'
              : '未入力';

        let notice = '';
        if (selectedRound === 1 && arrowIndex === 0) {
          notice = result === true ? ' [甲矢的中賞対象]' : ' [甲矢的中解除]';
        }

        setStatusMessage(
          `No.${participant.bibNumber} ${participant.name} 選手: ${getStageName(selectedRound)} ${arrowIndex + 1}本目を「${markLabel}」に更新しました。${notice}`,
        );
        setTimeout(() => setStatusMessage(''), 3000);
      } catch (err: unknown) {
        console.error('【スコア更新例外】:', err);
        setParticipants((prev) =>
          prev.map((p) => (p.id === participant.id ? previousState : p)),
        );
        const errCode =
          err && typeof err === 'object' && 'code' in err
            ? String((err as { code: unknown }).code)
            : '';
        if (errCode === 'permission-denied') {
          setErrorMessage(
            '権限エラー: Firestoreのルールが反映されていないか、ログイン認証が切れています。',
          );
        } else {
          setErrorMessage(
            'スコアの保存に失敗しました。通信状態を確認してください。',
          );
        }
      } finally {
        setSavingId(null);
      }
    },
    [isDbReady, selectedRound],
  );

  const handleUndo = useCallback(async () => {
    if (!isDbReady || undoStack.length === 0) return;

    const [latest, ...restStack] = undoStack;
    setSavingId(latest.participantId);
    setErrorMessage('');

    try {
      await ensureAnonymousAuth();

      const docRef = doc(db, 'entries', latest.participantId);
      const updatePayload: Record<string, unknown> = {
        totalHits: latest.previousTotalHits,
        isPerfect: latest.previousPerfect,
        isSokuchu: latest.previousSokuchu,
        updatedAt: serverTimestamp(),
      };

      if (latest.round === 1) {
        updatePayload.stand1_arrows = latest.previousArrows;
        updatePayload.isHayaHit = latest.previousHayaHit;
      } else if (latest.round === 2) {
        updatePayload.stand2_arrows = latest.previousArrows;
      } else {
        updatePayload.stand3_arrows = latest.previousArrows;
      }

      await updateDoc(docRef, updatePayload);

      setUndoStack(restStack);
      setStatusMessage(
        `No.${latest.bibNumber} ${latest.playerName} 選手の操作を取り消し、直前のスコアに戻しました。`,
      );
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      console.error('【Undo例外】:', err);
      setErrorMessage('取り消し処理に失敗しました。');
    } finally {
      setSavingId(null);
    }
  }, [isDbReady, undoStack]);

  const renderParticipantScoreRow = (participant: Participant) => {
    const isAbsent =
      participant.checkInStatus === 'ABSENT' ||
      participant.qualificationStatus === 'WITHDRAWN';
    const isSavingThis = savingId === participant.id;

    const arrows =
      selectedRound === 1
        ? participant.stand1_arrows
        : selectedRound === 2
          ? participant.stand2_arrows
          : participant.stand3_arrows;

    const stageHits = countHits(arrows);
    const maxScore = selectedRound === 3 ? 4 : 2;
    const standOrder = participant.standAssignments[selectedRound]?.standOrder;

    return (
      <div
        key={participant.id}
        className={`p-3.5 rounded-2xl border transition-all flex flex-col xl:flex-row xl:items-center justify-between gap-3 ${
          isAbsent
            ? 'bg-rose-50/30 border-rose-200 opacity-60'
            : 'bg-white border-slate-200/90 shadow-2xs hover:border-slate-300'
        }`}
      >
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 text-slate-900 flex flex-col items-center justify-center shrink-0">
            <span className="text-[9px] font-mono text-slate-500">射位</span>
            <span className="text-base font-black leading-none font-mono">
              {standOrder ?? '-'}
            </span>
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-black text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded">
                No.{participant.bibNumber}
              </span>
              <h4 className="text-base font-black text-slate-900 flex items-center gap-1.5">
                {participant.name}
              </h4>
              {isAbsent && (
                <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded">
                  棄権
                </span>
              )}
              {participant.isHayaHit && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-800 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-full shadow-2xs">
                  <Sparkles className="w-3 h-3 text-emerald-600" />
                  甲矢的中賞
                </span>
              )}
              {participant.isSokuchu && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black text-blue-800 bg-blue-50 border border-blue-300 px-2 py-0.5 rounded-full shadow-2xs">
                  <Target className="w-3 h-3 text-blue-600" />
                  一手束中賞
                </span>
              )}
              {participant.isPerfect && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black text-amber-900 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full shadow-2xs">
                  <Award className="w-3 h-3 text-amber-700" />
                  四矢皆中賞
                </span>
              )}
            </div>

            <div className="text-[11px] text-slate-500 font-medium mt-0.5 flex flex-wrap items-center gap-2">
              <span>{participant.organization || '無所属'}</span>
              <span>・</span>
              <span className="text-slate-600 font-mono">
                {getStandOrderLabel(standOrder)}
              </span>
              <span>・</span>
              <span className="font-bold text-slate-700 font-mono">
                通算: {participant.totalHits} / 8中
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 self-end xl:self-auto">
          <ScoreButton
            round={selectedRound}
            arrows={arrows}
            disabled={isAbsent || isSavingThis}
            onSelectArrow={(arrowIndex, result) =>
              handleSelectArrow(participant, arrowIndex, result)
            }
          />

          <div className="min-w-20 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl flex flex-col items-center justify-center shrink-0">
            <span className="text-[9px] font-bold text-slate-400">
              ステージ計
            </span>
            <span className="text-sm font-black font-mono text-slate-900">
              {stageHits}{' '}
              <span className="text-[10px] font-normal text-slate-400">
                / {maxScore}中
              </span>
            </span>
          </div>
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-slate-500 flex flex-col items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin mb-2 text-slate-900" />
        <span className="text-xs font-mono font-bold">
          スコアコンソール初期化中...
        </span>
      </div>
    );
  }

  return (
    <Card className="w-full shadow-sm border border-slate-200/80 rounded-2xl bg-white overflow-hidden">
      <CardHeader className="bg-white border-b border-slate-100 p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold tracking-wider bg-slate-900 text-white px-2.5 py-0.5 rounded-full shadow-2xs">
                記録員専用
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Shot-by-Shot Score Console
              </span>
            </div>
            <CardTitle className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Target className="w-5 h-5 text-amber-500" />
              競技記録員用 スコア入力コンソール（受付済み選手限定）
            </CardTitle>
            <CardDescription className="text-slate-500 text-xs mt-0.5 font-medium">
              当日受付（/admin/reception）にて「受付済」となった選手のみ表示されます。第1・第2ステージは1・2本目、第3ステージは1〜4本目を「〇」「✕」で入力します。
            </CardDescription>
          </div>

          {undoStack.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleUndo}
              disabled={savingId !== null}
              className="text-xs font-bold border-amber-300 text-amber-900 bg-amber-50 hover:bg-amber-100 h-9 px-3 rounded-xl shadow-2xs flex items-center gap-1.5 self-start sm:self-auto"
            >
              <Undo2 className="w-4 h-4 text-amber-700" />
              直前の入力を取り消す (Undo)
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <button
            type="button"
            onClick={() => setSelectedRound(1)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              selectedRound === 1
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Sun className="w-3.5 h-3.5 text-amber-400" />
            第1ステージ (午前・一手 2射)
          </button>

          <button
            type="button"
            onClick={() => setSelectedRound(2)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              selectedRound === 2
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Moon className="w-3.5 h-3.5 text-slate-300" />
            第2ステージ (午後・一手 2射)
          </button>

          <button
            type="button"
            onClick={() => setSelectedRound(3)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              selectedRound === 3
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <Moon className="w-3.5 h-3.5 text-slate-300" />
            第3ステージ (午後・四矢 4射)
          </button>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pt-1 pb-0.5">
          <span className="text-xs font-bold text-slate-600 shrink-0 flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-slate-400" /> 組選択
            (2立・10名/組):
          </span>
          {groupOptions.map((groupNum) => {
            const [s1, s2] = getStandNumbersByGroup(groupNum);
            return (
              <button
                key={groupNum}
                type="button"
                onClick={() => setSelectedGroupNumber(groupNum)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all font-mono shrink-0 ${
                  selectedGroupNumber === groupNum
                    ? 'bg-amber-500 text-slate-950 font-black shadow-2xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
                title={`第${groupNum}組（第${s1}立・第${s2}立の計10名を表示）`}
              >
                第 {groupNum} 組 (第{s1}・{s2}立)
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="p-5 space-y-5">
        {statusMessage && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs font-bold flex items-center gap-2 shadow-2xs animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-bold flex items-center gap-2 shadow-2xs animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-medium gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-900 font-sans flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-slate-700" />【
              {getStageName(selectedRound)}】
            </span>
            <span className="text-slate-900 font-mono font-black bg-amber-100 border border-amber-300 px-2 py-0.5 rounded">
              第 {selectedGroupNumber} 組
            </span>
            <span className="text-slate-600 text-[11px] font-mono">
              （受付済選手・第 {firstStandNumber} 立・第 {secondStandNumber} 立
              / 該当: {currentGroupTotalPlayers} 名）
            </span>
          </div>
          <span className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md self-start sm:self-auto">
            {selectedRound === 1
              ? '1本目(甲矢)・2本目(乙矢) 〇✕入力（1本目〇で甲矢的中賞）'
              : selectedRound === 2
                ? '1本目(甲矢)・2本目(乙矢) 〇✕入力'
                : '1本目〜4本目(四矢) 〇✕入力（4中で皆中賞）'}
          </span>
        </div>

        <div className="space-y-6">
          <div className="space-y-2.5 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/90">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-slate-900 text-white font-mono text-xs font-black">
                  第 {firstStandNumber} 立
                </span>
                <span className="text-xs text-slate-500 font-bold">
                  （第 {selectedGroupNumber} 組 前半立・受付済最大5名）
                </span>
              </div>
              <span className="text-xs font-mono font-bold text-slate-600">
                受付済登録: {firstStandParticipants.length} 名
              </span>
            </div>

            {firstStandParticipants.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs font-medium bg-white rounded-xl border border-dashed border-slate-200">
                第 {firstStandNumber}{' '}
                立に受付済みの選手はいません（受付を完了させてください）。
              </div>
            ) : (
              <div className="space-y-2.5">
                {firstStandParticipants.map((participant) =>
                  renderParticipantScoreRow(participant),
                )}
              </div>
            )}
          </div>

          <div className="space-y-2.5 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/90">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md bg-slate-800 text-amber-400 font-mono text-xs font-black">
                  第 {secondStandNumber} 立
                </span>
                <span className="text-xs text-slate-500 font-bold">
                  （第 {selectedGroupNumber} 組 後半立・受付済最大5名）
                </span>
              </div>
              <span className="text-xs font-mono font-bold text-slate-600">
                受付済登録: {secondStandParticipants.length} 名
              </span>
            </div>

            {secondStandParticipants.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs font-medium bg-white rounded-xl border border-dashed border-slate-200">
                第 {secondStandNumber} 立に受付済みの選手はいません。
              </div>
            ) : (
              <div className="space-y-2.5">
                {secondStandParticipants.map((participant) =>
                  renderParticipantScoreRow(participant),
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
