/**
 * 【競技記録員用 スコア入力コンソールコンポーネント】
 *
 * 役割:
 * - 競技形式（第1立: 午前一手2射 / 第2立: 午後一手2射 / 第3立: 午後四矢4射）の切り替え。
 * - 立グループ（組）の選択と、該当射手の並列表示。
 * - ScoreButton による数字選択押下（2射: 0〜2 / 4射: 0〜4）による的中数記録。
 * - 【第1立限定】甲矢（1本目）的中トグルチェックボタンの設置と独立データ収集用フラグ（isHayaHit）のFirestore同期。
 * - 全射手中から第1立甲矢的中者のみを即時集計・件数バッジ表示する機能。
 *
 * フールプルーフ設計（操作ミス・不正入力の入口遮断）:
 * - 甲矢チェックボタンは「第1立（selectedRound === 1）」選択時のみレンダリング。第2立・第3立では表示自体を遮断。
 * - スコア連動の自動補正:
 *   1. 「2中（皆中）」選択時: 甲矢・乙矢ともに的中しているため、甲矢的中（isHayaHit）を自動で `true` に同期。
 *   2. 「0中」選択時: 甲矢が中っていることはあり得ないため、甲矢的中（isHayaHit）を自動で `false` に同期。
 *   3. 甲矢的中をONにしたがスコアが「0中」または未入力の場合: 矛盾を防ぐためスコアを自動で最低「1中」へ引き上げて保存。
 *   4. 甲矢的中をOFFにし、スコアが「2中」だった場合: 2中は甲矢的中が前提であるため、スコアを「1中（乙矢のみ的中）」へ自動補正。
 * - 更新処理中（updatingPlayerId === participant.id）は数字ボタンおよび甲矢チェックボタンの両方を非活性化し、二重送信を防止。
 *
 * フェイルセーフ設計（障害時の安全縮退）:
 * - ドキュメント内に `isHayaHit` フィールドが存在しない過去データでも `Boolean(raw.isHayaHit)` により安全に `false` にフォールバック。
 * - 通信切断時は例外をキャッチして画面をクラッシュさせず、インラインエラー通知を表示。
 */

'use client';

import React, { useState, useEffect } from 'react';
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
  HitResult,
  STAND_CONFIGS,
  TOTAL_TOURNAMENT_SHOTS,
  Participant,
  isHitResult,
} from '@/types';
import { ScoreButton } from '@/components/admin/ScoreButton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Target,
  Users,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronRight,
  Sun,
  Moon,
  Award,
  CheckSquare,
  Square,
} from 'lucide-react';

const SAFE_TOTAL_SHOTS =
  typeof TOTAL_TOURNAMENT_SHOTS === 'number' ? TOTAL_TOURNAMENT_SHOTS : 8;

interface StandScoreContainerProps {
  tournamentConfig: TournamentConfig;
}

export function StandScoreContainer({
  tournamentConfig,
}: StandScoreContainerProps) {
  const [selectedRound, setSelectedRound] = useState<StandRoundIndex>(1);
  const [selectedGroup, setSelectedGroup] = useState<number>(1);

  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(() => isDbReady);
  const [updatingPlayerId, setUpdatingPlayerId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>(() =>
    !isDbReady ? 'データベース接続が利用できません。' : '',
  );
  const [successMessage, setSuccessMessage] = useState<string>('');

  const currentConfig = STAND_CONFIGS[selectedRound];
  const maxArrows = currentConfig.arrowCount;

  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
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

          const safeAssignments = {
            1: {
              standGroup: Number(
                rawAssignments[1]?.standGroup || raw.standGroup || 1,
              ),
              standOrder: Number(
                rawAssignments[1]?.standOrder || raw.standOrder || 1,
              ) as 1 | 2 | 3 | 4 | 5,
            },
            2: {
              standGroup: Number(
                rawAssignments[2]?.standGroup || raw.standGroup || 1,
              ),
              standOrder: Number(
                rawAssignments[2]?.standOrder || raw.standOrder || 1,
              ) as 1 | 2 | 3 | 4 | 5,
            },
            3: {
              standGroup: Number(rawAssignments[3]?.standGroup || 1),
              standOrder: Number(rawAssignments[3]?.standOrder || 1) as
                | 1
                | 2
                | 3
                | 4
                | 5,
            },
          };

          const sanitizeArrows = (arr: unknown, limit: number): HitResult[] => {
            if (!Array.isArray(arr)) return [];
            return arr.filter(isHitResult).slice(0, limit);
          };

          const s1 = sanitizeArrows(raw.stand1_arrows, 2);
          const s2 = sanitizeArrows(raw.stand2_arrows, 2);
          const s3 = sanitizeArrows(raw.stand3_arrows, 4);
          const calculatedHits =
            s1.filter((x) => x === 1).length +
            s2.filter((x) => x === 1).length +
            s3.filter((x) => x === 1).length;

          loaded.push({
            id: docSnap.id,
            bibNumber: Number(raw.bibNumber) || 1,
            name: typeof raw.name === 'string' ? raw.name : '選手名未設定',
            nameKana: typeof raw.nameKana === 'string' ? raw.nameKana : '',
            organization:
              typeof raw.organization === 'string' ? raw.organization : '',
            shosa: raw.shosa || '肌脱ぎ',
            rankTitle: raw.rankTitle || '段位は三段以下',
            staffRole: raw.staffRole || '無し',
            staffDutyShift: raw.staffDutyShift || '無し',
            checkInStatus: raw.checkInStatus || 'UNCHECKED',
            checkInAt: raw.checkInAt || null,
            isStaffVolunteer: Boolean(raw.isStaffVolunteer),
            needsSupport: Boolean(raw.needsSupport),
            standAssignments: safeAssignments,
            progressStatus: raw.progressStatus || 'WAITING',
            qualificationStatus: raw.qualificationStatus || 'ACTIVE',
            stand1_arrows: s1,
            stand2_arrows: s2,
            stand3_arrows: s3,
            isHayaHit: Boolean(raw.isHayaHit),
            totalHits: calculatedHits,
            totalShots: SAFE_TOTAL_SHOTS,
            isPerfect: calculatedHits === SAFE_TOTAL_SHOTS,
            enkinRank: raw.enkinRank || null,
            finalRank: raw.finalRank || null,
            representativeName: raw.representativeName || '',
            representativeEmail: raw.representativeEmail || '',
            representativePhone: raw.representativePhone || '',
            representativeOrganization: raw.representativeOrganization || '',
            isPaid: Boolean(raw.isPaid),
            paidAt: raw.paidAt || null,
            notes: raw.notes || '',
          });
        });

        setParticipants(loaded);
        setIsLoading(false);
      },
      (error) => {
        console.error(
          '【Firestore購読エラー】スコア入力用entries取得失敗:',
          error,
        );
        setErrorMessage('選手データの読み込みに失敗しました。');
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, []);

  const maxGroups = Math.max(
    tournamentConfig.totalStandGroups || 4,
    ...participants.map(
      (p) => p.standAssignments[selectedRound]?.standGroup || 1,
    ),
    4,
  );

  const currentShooters = participants
    .filter(
      (p) => p.standAssignments[selectedRound]?.standGroup === selectedGroup,
    )
    .sort((a, b) => {
      const orderA = a.standAssignments[selectedRound]?.standOrder || 1;
      const orderB = b.standAssignments[selectedRound]?.standOrder || 1;
      return orderA - orderB;
    });

  // 全体での甲矢的中者総数（データ収集・賞授与確認用）
  const totalHayaHitCount = participants.filter((p) => p.isHayaHit).length;

  /**
   * 【的中数選択ハンドラー】
   * 数字ボタン（0〜maxArrows）押下時に呼び出される。
   * フールプルーフ:
   * - 第1立で2中（皆中）を選択した場合は isHayaHit を true に自動同期。
   * - 第1立で0中を選択した場合は isHayaHit を false に自動同期。
   */
  const handleSelectHits = async (participant: Participant, hits: number) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setErrorMessage('データベース接続が有効ではありません。');
      return;
    }

    if (hits < 0 || hits > maxArrows) {
      console.warn('【不正入力検知】許容範囲外の的中数です:', hits);
      return;
    }

    const newRoundArrows: HitResult[] = [
      ...Array(hits).fill(1),
      ...Array(maxArrows - hits).fill(0),
    ];

    const targetField =
      selectedRound === 1
        ? 'stand1_arrows'
        : selectedRound === 2
          ? 'stand2_arrows'
          : 'stand3_arrows';

    setUpdatingPlayerId(participant.id);
    setErrorMessage('');

    try {
      const s1 =
        selectedRound === 1 ? newRoundArrows : participant.stand1_arrows;
      const s2 =
        selectedRound === 2 ? newRoundArrows : participant.stand2_arrows;
      const s3 =
        selectedRound === 3 ? newRoundArrows : participant.stand3_arrows;
      const newTotalHits =
        s1.filter((x) => x === 1).length +
        s2.filter((x) => x === 1).length +
        s3.filter((x) => x === 1).length;

      // フールプルーフ連動: 第1立での的中数に基づく甲矢フラグの自動調整
      let updatedHayaHit = participant.isHayaHit;
      if (selectedRound === 1) {
        if (hits === 2) {
          updatedHayaHit = true; // 2中は甲矢・乙矢ともに的中
        } else if (hits === 0) {
          updatedHayaHit = false; // 0中は甲矢も外れ
        }
      }

      const playerRef = doc(db, 'entries', participant.id);
      await updateDoc(playerRef, {
        [targetField]: newRoundArrows,
        isHayaHit: updatedHayaHit,
        totalHits: newTotalHits,
        totalShots: SAFE_TOTAL_SHOTS,
        isPerfect: newTotalHits === SAFE_TOTAL_SHOTS,
        updatedAt: serverTimestamp(),
      });

      setSuccessMessage(
        `ゼッケンNo.${participant.bibNumber} ${participant.name} 選手: ${hits}中（${maxArrows}射中）を記録しました。`,
      );
      setTimeout(() => setSuccessMessage(''), 2000);
    } catch (err: unknown) {
      console.error('【スコア更新エラー】:', err);
      setErrorMessage('スコアの保存に失敗しました。通信環境をご確認ください。');
    } finally {
      setUpdatingPlayerId(null);
    }
  };

  /**
   * 【甲矢（はや）的中トグルハンドラー】
   * 第1立のみで操作可能。タップでON/OFFを切り替える。
   * フールプルーフ連動:
   * - 甲矢をONにした際、現在の第1立的中数が0中または未入力であれば、自動で1中（[1, 0]）に設定。
   * - 甲矢をOFFにした際、現在の第1立的中数が2中であれば、皆中と矛盾するため1中（[0, 1] 乙矢のみ中）に自動補正。
   */
  const handleToggleHayaHit = async (participant: Participant) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;
    if (selectedRound !== 1) return; // 第1立以外では処理を拒否

    setUpdatingPlayerId(participant.id);
    setErrorMessage('');

    const newHayaStatus = !participant.isHayaHit;
    let newStand1Arrows = [...participant.stand1_arrows];

    // フールプルーフ: 的中配列との整合性を自動調整
    if (newHayaStatus) {
      // 甲矢的中をONにする場合: 0中または未入力なら最低1中([1, 0])にする
      const currentHits = newStand1Arrows.filter((x) => x === 1).length;
      if (currentHits === 0) {
        newStand1Arrows = [1, 0];
      }
    } else {
      // 甲矢的中をOFFにする場合: もし2中(皆中)だった場合は乙矢のみの1中([0, 1])に補正
      const currentHits = newStand1Arrows.filter((x) => x === 1).length;
      if (currentHits === 2) {
        newStand1Arrows = [0, 1];
      }
    }

    try {
      const s1 = newStand1Arrows;
      const s2 = participant.stand2_arrows;
      const s3 = participant.stand3_arrows;
      const newTotalHits =
        s1.filter((x) => x === 1).length +
        s2.filter((x) => x === 1).length +
        s3.filter((x) => x === 1).length;

      const playerRef = doc(db, 'entries', participant.id);
      await updateDoc(playerRef, {
        isHayaHit: newHayaStatus,
        stand1_arrows: newStand1Arrows,
        totalHits: newTotalHits,
        totalShots: SAFE_TOTAL_SHOTS,
        isPerfect: newTotalHits === SAFE_TOTAL_SHOTS,
        updatedAt: serverTimestamp(),
      });

      setSuccessMessage(
        `ゼッケンNo.${participant.bibNumber} ${participant.name} 選手: 甲矢的中を「${newHayaStatus ? '的中〇' : '外れ✕'}」に更新しました。`,
      );
      setTimeout(() => setSuccessMessage(''), 2000);
    } catch (err: unknown) {
      console.error('【甲矢フラグ更新エラー】:', err);
      setErrorMessage('甲矢的中の保存に失敗しました。');
    } finally {
      setUpdatingPlayerId(null);
    }
  };

  /**
   * 【スコア入力解除（クリア）ハンドラー】
   */
  const handleClearScore = async (participant: Participant) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const targetField =
      selectedRound === 1
        ? 'stand1_arrows'
        : selectedRound === 2
          ? 'stand2_arrows'
          : 'stand3_arrows';

    setUpdatingPlayerId(participant.id);
    setErrorMessage('');

    try {
      const s1 = selectedRound === 1 ? [] : participant.stand1_arrows;
      const s2 = selectedRound === 2 ? [] : participant.stand2_arrows;
      const s3 = selectedRound === 3 ? [] : participant.stand3_arrows;
      const newTotalHits =
        s1.filter((x) => x === 1).length +
        s2.filter((x) => x === 1).length +
        s3.filter((x) => x === 1).length;

      // 第1立をクリアした場合は甲矢フラグもfalseに初期化
      const updatedHayaHit =
        selectedRound === 1 ? false : participant.isHayaHit;

      const playerRef = doc(db, 'entries', participant.id);
      await updateDoc(playerRef, {
        [targetField]: [],
        isHayaHit: updatedHayaHit,
        totalHits: newTotalHits,
        totalShots: SAFE_TOTAL_SHOTS,
        isPerfect: newTotalHits === SAFE_TOTAL_SHOTS,
        updatedAt: serverTimestamp(),
      });

      setSuccessMessage(
        `ゼッケンNo.${participant.bibNumber} の立スコアを未入力に戻しました。`,
      );
      setTimeout(() => setSuccessMessage(''), 2000);
    } catch (err: unknown) {
      console.error('【スコアクリアエラー】:', err);
      setErrorMessage('スコアのクリア処理に失敗しました。');
    } finally {
      setUpdatingPlayerId(null);
    }
  };

  const getStandOrderLabel = (order: number) => {
    switch (order) {
      case 1:
        return '大前 (1番)';
      case 2:
        return '二的 (2番)';
      case 3:
        return '中 (3番)';
      case 4:
        return '落前 (4番)';
      case 5:
        return '落 (5番)';
      default:
        return `${order}番`;
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-white border border-slate-200 rounded-2xl text-slate-500 shadow-sm">
        <Loader2 className="w-8 h-8 animate-spin mb-2 text-slate-900" />
        <span className="text-xs font-bold">スコアコンソール初期化中...</span>
      </div>
    );
  }

  return (
    <Card className="w-full bg-white border-slate-200/80 shadow-sm text-slate-900 rounded-2xl">
      <CardHeader className="pb-3 border-b border-slate-100">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold bg-slate-900 text-white px-2.5 py-0.5 rounded-full">
                全8射的中制（午前一手2射 / 午後一手2射 / 午後四矢4射）
              </span>
              {selectedRound === 1 && (
                <span className="text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Award className="w-3 h-3 text-red-600" />
                  第1立限定: 甲矢賞対象（現在的中: {totalHayaHitCount}名）
                </span>
              )}
            </div>
            <CardTitle className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2">
              <Target className="w-5 h-5 text-slate-700" />
              競技記録員 スコア入力コンソール
            </CardTitle>
            <CardDescription className="text-xs text-slate-500 mt-0.5 font-medium">
              立と組を選択し、射手ごとの的中数を記録します。第1立では甲矢（1本目）的中チェックも同時に管理可能です。
            </CardDescription>
          </div>

          {/* 立切り替えタブ */}
          <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 w-full sm:w-auto">
            {([1, 2, 3] as StandRoundIndex[]).map((roundIdx) => {
              const cfg = STAND_CONFIGS[roundIdx];
              const isSelected = selectedRound === roundIdx;

              return (
                <button
                  key={roundIdx}
                  type="button"
                  onClick={() => setSelectedRound(roundIdx)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex flex-col items-center gap-0.5 ${
                    isSelected
                      ? 'bg-white text-slate-900 shadow-2xs border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  <span className="flex items-center gap-1 text-[11px]">
                    {cfg.periodName === '午前の部' ? (
                      <Sun className="w-3 h-3 text-amber-500" />
                    ) : (
                      <Moon className="w-3 h-3 text-slate-500" />
                    )}
                    {roundIdx === 1
                      ? '第1立'
                      : roundIdx === 2
                        ? '第2立'
                        : '第3立'}
                  </span>
                  <span className="text-[10px] opacity-80 font-mono">
                    {cfg.arrowCount}射（{roundIdx === 3 ? '四矢' : '一手'}）
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 立グループ（組）選択ボタンバー */}
        <div className="pt-3 flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="text-xs font-bold text-slate-600 shrink-0 mr-1 flex items-center gap-1">
            <Users className="w-3.5 h-3.5" /> 立ち組:
          </span>
          {Array.from({ length: maxGroups }).map((_, i) => {
            const gNum = i + 1;
            const isSel = selectedGroup === gNum;
            const groupShootersCount = participants.filter(
              (p) => p.standAssignments[selectedRound]?.standGroup === gNum,
            ).length;

            return (
              <button
                key={gNum}
                type="button"
                onClick={() => setSelectedGroup(gNum)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                  isSel
                    ? 'bg-slate-900 text-white font-black shadow-2xs'
                    : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                第{gNum}組
                <span className="ml-1 text-[10px] opacity-70 font-mono">
                  ({groupShootersCount}名)
                </span>
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* 現在選択中の立概要バナー */}
        <div className="flex flex-wrap items-center justify-between p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900">
              {currentConfig.name}
            </span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-600">
              {currentConfig.formatDescription}
            </span>
          </div>
          <div className="text-slate-600 font-mono text-[11px]">
            対象組:{' '}
            <strong className="text-slate-900 font-bold">
              第{selectedGroup}組
            </strong>{' '}
            / 入力選択肢:{' '}
            <strong className="text-slate-900 font-bold">
              {maxArrows === 2 ? '0, 1, 2 (的中数)' : '0, 1, 2, 3, 4 (的中数)'}
            </strong>
          </div>
        </div>

        {/* ステータスメッセージ */}
        {successMessage && (
          <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs font-bold">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* 該当組の射手スコア入力グリッド */}
        {currentShooters.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-slate-400 text-xs">
            第{selectedGroup}組 に割り当てられた選手が登録されていません。
          </div>
        ) : (
          <div className="space-y-2.5">
            {currentShooters.map((participant) => {
              const currentAssignment =
                participant.standAssignments[selectedRound];
              const roundArrows =
                selectedRound === 1
                  ? participant.stand1_arrows
                  : selectedRound === 2
                    ? participant.stand2_arrows
                    : participant.stand3_arrows;

              const isUpdating = updatingPlayerId === participant.id;
              const isEntered =
                Array.isArray(roundArrows) && roundArrows.length > 0;
              const roundHits = isEntered
                ? roundArrows.filter((x) => x === 1).length
                : null;

              return (
                <div
                  key={participant.id}
                  className="flex flex-col xl:flex-row xl:items-center justify-between p-4 bg-white border border-slate-200 rounded-xl gap-3 shadow-2xs hover:border-slate-300 transition-colors"
                >
                  {/* 射手属性情報 */}
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center justify-center w-10 h-10 bg-slate-100 border border-slate-200 rounded-lg font-mono font-black text-slate-900 text-sm shrink-0">
                      <span className="text-[9px] text-slate-500 leading-none">
                        立順
                      </span>
                      <span>{currentAssignment?.standOrder || 1}</span>
                    </div>

                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">
                          {participant.name}
                        </span>
                        <span className="text-[11px] font-mono font-bold bg-slate-100 text-slate-800 px-1.5 py-0.2 rounded border border-slate-200">
                          No.{participant.bibNumber}
                        </span>
                        <span className="text-[10px] text-slate-500 bg-slate-50 px-1.5 py-0.2 rounded border border-slate-200">
                          {participant.organization || '無所属'}
                        </span>

                        {/* 第1立のみ: 甲矢的中バッジ（視認性向上） */}
                        {selectedRound === 1 && participant.isHayaHit && (
                          <span className="text-[10px] font-black bg-red-600 text-white px-2 py-0.5 rounded-full flex items-center gap-0.5 shadow-2xs animate-hit-pop">
                            <Award className="w-3 h-3" />
                            甲矢賞対象
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 font-medium">
                        <span>
                          {getStandOrderLabel(
                            currentAssignment?.standOrder || 1,
                          )}
                        </span>
                        <span>・</span>
                        <span>{participant.shosa}</span>
                        <span>・</span>
                        <span>{participant.rankTitle}</span>
                      </div>
                    </div>
                  </div>

                  {/* スコア入力部 ＆ 甲矢的中チェック ＆ 成績集計 */}
                  <div className="flex flex-wrap items-center justify-between xl:justify-end gap-3 pt-2 xl:pt-0 border-t xl:border-t-0 border-slate-100">
                    {/* 【第1立限定】甲矢（はや）的中チェックボタン */}
                    {selectedRound === 1 && (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => handleToggleHayaHit(participant)}
                        className={`h-9 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 active:scale-95 border ${
                          participant.isHayaHit
                            ? 'bg-red-600 hover:bg-red-700 text-white border-red-600 shadow-xs'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-300'
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                        title="第1立の第1射（甲矢）が的中したかをチェック"
                      >
                        {participant.isHayaHit ? (
                          <CheckSquare className="w-4 h-4 text-white stroke-[2.5]" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400 stroke-[2]" />
                        )}
                        <span>甲矢的中</span>
                      </button>
                    )}

                    {/* 的中数（0〜maxArrows）数字選択ボタン */}
                    <ScoreButton
                      currentHits={roundHits}
                      maxArrows={maxArrows}
                      disabled={isUpdating}
                      isEntered={isEntered}
                      onSelectHits={(hits) =>
                        handleSelectHits(participant, hits)
                      }
                      onClear={() => handleClearScore(participant)}
                    />

                    {/* 立的中 & 通算的中表示 */}
                    <div className="flex items-center gap-2 bg-slate-50 p-2 px-3 rounded-lg border border-slate-200 font-mono text-xs shrink-0 min-w-32 justify-end">
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block leading-tight">
                          立的中
                        </span>
                        <span
                          className={`font-bold ${isEntered ? 'text-slate-900' : 'text-slate-400'}`}
                        >
                          {isEntered
                            ? `${roundHits} / ${maxArrows}`
                            : '- / ' + maxArrows}
                        </span>
                      </div>
                      <ChevronRight className="w-3 h-3 text-slate-400" />
                      <div className="text-right">
                        <span className="text-[10px] text-slate-600 block leading-tight font-sans">
                          通算
                        </span>
                        <span className="font-black text-slate-900">
                          {participant.totalHits} / {SAFE_TOTAL_SHOTS}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
