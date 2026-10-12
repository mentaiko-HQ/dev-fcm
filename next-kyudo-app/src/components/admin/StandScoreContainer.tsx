/**
 * 【競技記録員用 スコア入力コンソール】
 *
 * 役割:
 * - 大会回次（ラウンド）表記を「ステージ」へ完全統一:
 *   - 第1ステージ（午前・一手2射）: [0, 1, 2] 的中ボタン入力
 *   - 第2ステージ（午後・一手2射）: [0, 1, 2] 的中ボタン入力
 *   - 第3ステージ（午後・四矢4射）: [0, 1, 2, 3, 4] 的中ボタン入力
 * - 立（Stand）と組（Group）の構造定義:
 *   - 選手5名を合わせて「立」（第1立、第2立、第3立、第4立...）
 *   - 2つの立を合わせて「組」（第1立・第2立 → 第1組、第3立・第4立 → 第2組...）
 * - 【選手数無制限対応】エントリー全選手および割当立番号から立選択ボタン（第1立〜第N立）を動的自動生成。
 * - 第1ステージにおける「甲矢的中」ボタン押下時、即座に「1のボタンを押した（1中・甲矢〇・乙矢✕）」と同じ挙動を実行。
 * - 既に「1中・甲矢〇」の状態で再度甲矢的中ボタンを押した場合はトグル解除として「0中」にリセット。
 * - 直前の入力ミスを安全に復元する Undo（取り消し）機能。
 * - ステージおよび立の切り替えと、該当選手の射位順（1大前〜5落）表示。
 *
 * フールプルーフ設計（事故前・対人間）:
 * 1. useEffect内での同期的なsetStateを排除しカスケードレンダリングを防止。
 * 2. 甲矢的中ボタンを押す際、事前的中数の選択を不要化し、ワンタップで「1中（甲矢〇）」を確定。
 * 3. 第1ステージで「2中」選択時は甲矢的中を自動ON、「0中」選択時は自動OFFに同期。
 * 4. 棄権（ABSENT / WITHDRAWN）の選手はスコア入力を全面無効化し、誤入力を防止。
 * 5. 通信中の多重タップを処理中フラグ（savingId）で排他ロック。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * 1. 楽観的UI更新（Optimistic Update）を行い、Firestore書き込み失敗時は直前の状態へ自動ロールバック。
 * 2. 入力履歴スタックを保持し、操作直後にワンタップで元に戻せるUndoバナーを表示。
 * 3. ネットワーク切断やFirestore例外発生時はエラーログをコンソール出力し、画面上に明示。
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
import { db, isFirebaseConfigured, isFirestoreAvailable } from '@/lib/firebase';
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
  Check,
  X,
  Layers,
} from 'lucide-react';

interface StandScoreContainerProps {
  tournamentConfig: TournamentConfig;
}

// Undo履歴管理用インターフェース
interface UndoHistoryEntry {
  participantId: string;
  bibNumber: number;
  playerName: string;
  round: StandRoundIndex;
  previousArrows: ArrowHit[];
  previousHayaHit: boolean;
  previousTotalHits: number;
}

/**
 * ステージ名称取得ヘルパー関数
 */
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

/**
 * 射位ラベル取得ヘルパー関数
 */
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

/**
 * 的中数から矢の真偽値配列を生成するヘルパー関数
 */
function createArrowArray(
  round: StandRoundIndex,
  hits: number,
  isHayaHit: boolean,
): ArrowHit[] {
  if (round === 1) {
    if (hits === 2) return [true, true];
    if (hits === 1) return isHayaHit ? [true, false] : [false, true];
    return [false, false];
  }

  if (round === 2) {
    if (hits === 2) return [true, true];
    if (hits === 1) return [true, false];
    return [false, false];
  }

  // round === 3 (四矢4射)
  return Array.from({ length: 4 }, (_, i) => i < hits);
}

export function StandScoreContainer({
  tournamentConfig,
}: StandScoreContainerProps) {
  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  // 選択ステート（回次は「ステージ」、行射枠は「立」）
  const [selectedRound, setSelectedRound] = useState<StandRoundIndex>(1);
  const [selectedStandNumber, setSelectedStandNumber] = useState<number>(1);

  // 参加者リスト
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(() => isDbReady);
  const [savingId, setSavingId] = useState<string | null>(null);

  // フィードバック用ステート
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Undo履歴スタック
  const [undoStack, setUndoStack] = useState<UndoHistoryEntry[]>([]);

  // 1. Firestore entries コレクションのリアルタイム同期
  useEffect(() => {
    if (!isDbReady) {
      return;
    }

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

  // 2. 選択されたステージ・立番号に合致する選手の抽出とソート（射位昇順: 1大前 〜 5落）
  const currentStandParticipants = useMemo(() => {
    return participants
      .filter((p) => {
        const assign = p.standAssignments[selectedRound];
        return assign && assign.standGroup === selectedStandNumber;
      })
      .sort((a, b) => {
        const orderA = a.standAssignments[selectedRound]?.standOrder ?? 99;
        const orderB = b.standAssignments[selectedRound]?.standOrder ?? 99;
        return orderA - orderB;
      });
  }, [participants, selectedRound, selectedStandNumber]);

  // 【選手数無制限対応】全選手の立番号から立選択ボタングループ（第1立〜第N立）を動的自動生成
  const standOptions = useMemo(() => {
    let maxAssignedStand = 1;
    participants.forEach((p) => {
      [1, 2, 3].forEach((r) => {
        const s = p.standAssignments[r as StandRoundIndex]?.standGroup;
        if (s && s > maxAssignedStand) maxAssignedStand = s;
      });
    });

    const calculatedByCount = Math.ceil(participants.length / 5);
    const total = Math.max(
      1,
      tournamentConfig.totalStandGroups || 1,
      maxAssignedStand,
      calculatedByCount,
    );

    return Array.from({ length: total }, (_, i) => i + 1);
  }, [participants, tournamentConfig.totalStandGroups]);

  // 現在選択中の立が属する「組」番号を算出（第1・2立 → 第1組、第3・4立 → 第2組...）
  const currentGroupNumber = useMemo(() => {
    return Math.ceil(selectedStandNumber / 2);
  }, [selectedStandNumber]);

  /**
   * 【スコア入力実行処理】
   */
  const handleScoreChange = useCallback(
    async (participant: Participant, newHitCount: number) => {
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
      const previousTotalHits = participant.totalHits;

      let nextHayaHit = participant.isHayaHit;
      if (selectedRound === 1) {
        if (newHitCount === 2) {
          nextHayaHit = true;
        } else if (newHitCount === 0) {
          nextHayaHit = false;
        }
      }

      const newArrows = createArrowArray(
        selectedRound,
        newHitCount,
        nextHayaHit,
      );

      const s1Hits =
        selectedRound === 1
          ? newHitCount
          : participant.stand1_arrows.filter(Boolean).length;
      const s2Hits =
        selectedRound === 2
          ? newHitCount
          : participant.stand2_arrows.filter(Boolean).length;
      const s3Hits =
        selectedRound === 3
          ? newHitCount
          : participant.stand3_arrows.filter(Boolean).length;
      const nextTotalHits = s1Hits + s2Hits + s3Hits;
      const isPerfect = nextTotalHits === 8;

      setParticipants((prev) =>
        prev.map((p) => {
          if (p.id !== participant.id) return p;
          return {
            ...p,
            stand1_arrows: selectedRound === 1 ? newArrows : p.stand1_arrows,
            stand2_arrows: selectedRound === 2 ? newArrows : p.stand2_arrows,
            stand3_arrows: selectedRound === 3 ? newArrows : p.stand3_arrows,
            isHayaHit: nextHayaHit,
            totalHits: nextTotalHits,
            isPerfect,
          };
        }),
      );

      try {
        const docRef = doc(db, 'entries', participant.id);
        const updatePayload: Record<string, unknown> = {
          totalHits: nextTotalHits,
          isPerfect,
          updatedAt: serverTimestamp(),
        };

        if (selectedRound === 1) {
          updatePayload.stand1_arrows = newArrows;
          updatePayload.isHayaHit = nextHayaHit;
        } else if (selectedRound === 2) {
          updatePayload.stand2_arrows = newArrows;
        } else {
          updatePayload.stand3_arrows = newArrows;
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
            previousTotalHits,
          },
          ...prev.slice(0, 9),
        ]);

        setStatusMessage(
          `No.${participant.bibNumber} ${participant.name} 選手: ${getStageName(selectedRound)} を「${newHitCount}中」に更新しました。`,
        );
        setTimeout(() => setStatusMessage(''), 3000);
      } catch (err) {
        console.error('【スコア更新例外】:', err);
        setParticipants((prev) =>
          prev.map((p) => (p.id === participant.id ? previousState : p)),
        );
        setErrorMessage(
          'スコアの保存に失敗しました。通信状態を確認してください。',
        );
      } finally {
        setSavingId(null);
      }
    },
    [isDbReady, selectedRound],
  );

  /**
   * 【第1ステージ 甲矢的中トグルハンドラー】
   */
  const handleToggleHayaHit = useCallback(
    async (participant: Participant) => {
      if (!isDbReady || selectedRound !== 1) return;

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
      const previousArrows = [...participant.stand1_arrows];
      const previousHayaHit = participant.isHayaHit;
      const previousTotalHits = participant.totalHits;

      const currentStand1Hits =
        participant.stand1_arrows.filter(Boolean).length;
      const isAlreadyHayaOneHit =
        currentStand1Hits === 1 && participant.isHayaHit;
      const targetHitCount = isAlreadyHayaOneHit ? 0 : 1;
      const targetHayaHit = !isAlreadyHayaOneHit;

      const newArrows: ArrowHit[] = targetHayaHit
        ? [true, false]
        : [false, false];

      const s1Hits = targetHitCount;
      const s2Hits = participant.stand2_arrows.filter(Boolean).length;
      const s3Hits = participant.stand3_arrows.filter(Boolean).length;
      const nextTotalHits = s1Hits + s2Hits + s3Hits;
      const isPerfect = nextTotalHits === 8;

      setParticipants((prev) =>
        prev.map((p) =>
          p.id === participant.id
            ? {
                ...p,
                stand1_arrows: newArrows,
                isHayaHit: targetHayaHit,
                totalHits: nextTotalHits,
                isPerfect,
              }
            : p,
        ),
      );

      try {
        const docRef = doc(db, 'entries', participant.id);
        await updateDoc(docRef, {
          stand1_arrows: newArrows,
          isHayaHit: targetHayaHit,
          totalHits: nextTotalHits,
          isPerfect,
          updatedAt: serverTimestamp(),
        });

        setUndoStack((prev) => [
          {
            participantId: participant.id,
            bibNumber: participant.bibNumber,
            playerName: participant.name,
            round: 1,
            previousArrows,
            previousHayaHit,
            previousTotalHits,
          },
          ...prev.slice(0, 9),
        ]);

        setStatusMessage(
          targetHayaHit
            ? `No.${participant.bibNumber} ${participant.name} 選手: 甲矢的中（1中）を登録しました。`
            : `No.${participant.bibNumber} ${participant.name} 選手: 甲矢的中を解除し（0中）に更新しました。`,
        );
        setTimeout(() => setStatusMessage(''), 3000);
      } catch (err) {
        console.error('【甲矢更新例外】:', err);
        setParticipants((prev) =>
          prev.map((p) => (p.id === participant.id ? previousState : p)),
        );
        setErrorMessage('甲矢的中の保存に失敗しました。');
      } finally {
        setSavingId(null);
      }
    },
    [isDbReady, selectedRound],
  );

  /**
   * 【Undo実行ハンドラー】
   */
  const handleUndo = useCallback(async () => {
    if (!isDbReady || undoStack.length === 0) return;

    const [latest, ...restStack] = undoStack;
    setSavingId(latest.participantId);
    setErrorMessage('');

    try {
      const docRef = doc(db, 'entries', latest.participantId);
      const updatePayload: Record<string, unknown> = {
        totalHits: latest.previousTotalHits,
        isPerfect: latest.previousTotalHits === 8,
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
                Stage Score Console
              </span>
            </div>
            <CardTitle className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Target className="w-5 h-5 text-amber-500" />
              競技記録員用 スコア入力コンソール
            </CardTitle>
            <CardDescription className="text-slate-500 text-xs mt-0.5 font-medium">
              第1・第2ステージは「0, 1, 2」、第3ステージは「0, 1, 2, 3,
              4」のボタンで入力できます。
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

        {/* ステージ切り替えタブ */}
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

        {/* 立番号選択ツールバー（5名＝1立、第1立〜第N立を動的自動展開） */}
        <div className="flex items-center gap-2 overflow-x-auto pt-1 pb-0.5">
          <span className="text-xs font-bold text-slate-600 shrink-0 flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-slate-400" /> 立選択 (5名/立):
          </span>
          {standOptions.map((standNum) => {
            const groupNum = Math.ceil(standNum / 2);
            return (
              <button
                key={standNum}
                type="button"
                onClick={() => setSelectedStandNumber(standNum)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all font-mono shrink-0 ${
                  selectedStandNumber === standNum
                    ? 'bg-amber-500 text-slate-950 font-black shadow-2xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
                title={`第${standNum}立 (第${groupNum}組)`}
              >
                第 {standNum} 立
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="p-5 space-y-4">
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

        {/* 現在のステージおよび立・組バナー */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-medium gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-slate-900 font-sans flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-slate-700" />【
              {getStageName(selectedRound)}】
            </span>
            <span className="text-slate-700 font-mono font-bold">
              第 {selectedStandNumber} 立
            </span>
            <span className="text-slate-500 text-[11px]">
              (第 {currentGroupNumber} 組所属 / 該当選手:{' '}
              {currentStandParticipants.length} 名)
            </span>
          </div>
          <span className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md self-start sm:self-auto">
            入力選択肢:{' '}
            {selectedRound === 3 ? '0 〜 4 (四矢)' : '0 〜 2 (一手)'}
          </span>
        </div>

        {/* 選手行一覧 */}
        <div className="space-y-3">
          {currentStandParticipants.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs font-medium bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
              第 {selectedStandNumber} 立に割り当てられた選手はいません。
            </div>
          ) : (
            currentStandParticipants.map((participant) => {
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
              const currentHits =
                arrows.length > 0 ? arrows.filter(Boolean).length : null;
              const maxScore = selectedRound === 3 ? 4 : 2;
              const standOrder =
                participant.standAssignments[selectedRound]?.standOrder;
              const isHayaHitActive =
                participant.isHayaHit && (currentHits ?? 0) >= 1;

              return (
                <div
                  key={participant.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                    isAbsent
                      ? 'bg-rose-50/30 border-rose-200 opacity-60'
                      : 'bg-white border-slate-200/90 shadow-2xs hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 text-slate-900 flex flex-col items-center justify-center shrink-0">
                      <span className="text-[9px] font-mono text-slate-500">
                        射位
                      </span>
                      <span className="text-base font-black leading-none font-mono">
                        {standOrder ?? '-'}
                      </span>
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-black text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded">
                          No.{participant.bibNumber}
                        </span>
                        <h4 className="text-base font-black text-slate-900 flex items-center gap-1.5">
                          {participant.name}
                          {isAbsent && (
                            <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.2 rounded">
                              棄権
                            </span>
                          )}
                        </h4>
                      </div>

                      <div className="text-[11px] text-slate-500 font-medium mt-0.5 flex items-center gap-2">
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

                  <div className="flex flex-wrap items-center gap-3 self-end md:self-auto">
                    {/* 第1ステージ専用: 甲矢的中ボタン */}
                    {selectedRound === 1 && !isAbsent && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isSavingThis}
                        onClick={() => handleToggleHayaHit(participant)}
                        className={`h-10 text-xs font-bold px-3 rounded-xl transition-all shadow-2xs ${
                          isHayaHitActive
                            ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-500 hover:text-white ring-2 ring-emerald-500'
                            : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                        } disabled:opacity-40`}
                        title={
                          isHayaHitActive
                            ? '甲矢的中が記録されています（クリックで解除・0中にリセット）'
                            : '甲矢的中（1のボタンと同じ1中・甲矢〇）を即時記録'
                        }
                      >
                        {isHayaHitActive ? (
                          <>
                            <Check className="w-3.5 h-3.5 mr-1 text-white" />
                            甲矢: 的中 〇 (1中)
                          </>
                        ) : (
                          <>
                            <X className="w-3.5 h-3.5 mr-1 text-slate-400" />
                            甲矢的中 (1中入力)
                          </>
                        )}
                      </Button>
                    )}

                    <ScoreButton
                      maxScore={maxScore}
                      currentScore={currentHits}
                      disabled={isAbsent || isSavingThis}
                      onSelectScore={(hits) =>
                        handleScoreChange(participant, hits)
                      }
                    />

                    <div className="min-w-20 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center gap-1">
                      {arrows.length === 0 ? (
                        <span className="text-[10px] text-slate-400 font-mono">
                          未記録
                        </span>
                      ) : (
                        arrows.map((hit, idx) => (
                          <span
                            key={idx}
                            className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-black font-mono shadow-2xs ${
                              hit
                                ? 'bg-red-600 text-white'
                                : 'bg-slate-200 text-slate-500'
                            }`}
                          >
                            {hit ? '〇' : '✕'}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}
