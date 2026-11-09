/**
 * 【参加者・観客向け リアルタイム成績速報＆立順閲覧ページ（選手カード枠線色連動 ＋ 招集解除時表記完全消去版）】
 * /results パスに対応するページコンポーネント。
 *
 * 役割:
 * 1. スマートフォン縦画面での閲覧に特化し、ステージ別表示・総合成績表示ともに横スクロール不要のカードレイアウトを採用。
 * 2. 本部進行管理（MatchControlPanel）とリアルタイム連動し、各選手のカード内にバッジを表示し、カード全体の枠線色も連動して強調:
 *    - 「招集中」     (第 N 組 / CALLED)      : アンバー色バッジ ＆ アンバー色枠線（パルス）
 *    - 「控え待機中」 (第 N-1, N-2 組 / IN_STAND): ブルー色バッジ ＆ ブルー色枠線
 *    - 「行射中」     (第 N-3 組 / SHOOTING)   : エメラルド色バッジ ＆ エメラルド色枠線
 * 3. 本部で招集ボタンが解除された際（activeCallGroup === null）は、上記の進行状況バッジと色枠線を即座に消去し「行射前」の初期表示へ戻す。
 * 4. StandScoreContainer.tsx と同一の組・立構造ロジックを採用:
 *    - STANDS_PER_GROUP = 2, PLAYERS_PER_STAND = 5 (1組 = 2立 = 10名)
 *
 * フールプルーフ設計（事故前・対人間）:
 * - ステージ別タブでは、現在本部が招集操作を行っているステージと表示中タブが一致する場合に組連動ステータスを適用し、別ステージ閲覧時の誤認を防止。
 * - 既にそのステージのスコアが確定入力済みの選手、または棄権選手には進行バッジと連動枠線を適用しない制御。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - matches ドキュメントの購読と entries コレクションの双方を安全に参照し、Firebase未初期化や通信切断時にクラッシュせず、エラーログ出力と再読み込みボタンを提供。
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  orderBy,
  FirestoreError,
} from 'firebase/firestore';
import {
  db,
  isFirebaseConfigured,
  isFirestoreAvailable,
  ensureAnonymousAuth,
} from '@/lib/firebase';
import {
  Participant,
  CheckInStatus,
  QualificationStatus,
  StandRoundIndex,
  StandOrderIndex,
  ArrowHit,
  sanitizeStandGroup,
  sanitizeStandOrder,
  sanitizeShosaType,
  sanitizeRankTitleType,
  sanitizeProgressStatus,
} from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Target,
  Sun,
  Moon,
  Trophy,
  Search,
  AlertCircle,
  Loader2,
  Sparkles,
  Layers,
  Award,
  Ban,
  Clock,
  RefreshCw,
  BellRing,
  ShieldAlert,
} from 'lucide-react';

// ==========================================
// 1. 定数・型定義 (StandScoreContainer / MatchControlPanel と完全同期)
// ==========================================

const DEFAULT_MATCH_ID = 'match_2026_mentaiko';
const PLAYERS_PER_STAND = 5;
const STANDS_PER_GROUP = 2;
const PLAYERS_PER_GROUP = PLAYERS_PER_STAND * STANDS_PER_GROUP;

type ResultTabKey = 1 | 2 | 3 | 'OVERALL';

type ActiveLiveStatus = 'CALLED' | 'IN_STAND' | 'SHOOTING' | null;

interface MatchCallState {
  currentRound: StandRoundIndex;
  activeCallRound: StandRoundIndex | null;
  activeCallGroup: number | null;
}

// ==========================================
// 2. ドメインヘルパー関数
// ==========================================

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

function isStageConfirmed(arrows: (ArrowHit | null | undefined)[]): boolean {
  if (!Array.isArray(arrows) || arrows.length === 0) return false;
  return arrows.some((hit) => hit === true || hit === false);
}

/**
 * 招集中の組番号 (activeCallGroup = N) と対象組番号 (groupNumber) から
 * 「招集中 (N)」「控え待機中 (N-1, N-2)」「行射中 (N-3)」を判定する。
 * 招集解除時（activeCallGroup === null）は必ず null を返す。
 */
function evaluateGroupLiveStatus(
  groupNumber: number,
  activeCallGroup: number | null,
): ActiveLiveStatus {
  if (activeCallGroup === null || activeCallGroup <= 0) return null;
  const diff = activeCallGroup - groupNumber;
  if (diff === 0) return 'CALLED';
  if (diff === 1 || diff === 2) return 'IN_STAND';
  if (diff === 3) return 'SHOOTING';
  return null;
}

// ==========================================
// 3. サブコンポーネント: 進行状況バッジ（行射中 / 控え待機中 / 招集中）
// ==========================================

interface LiveProgressBadgeProps {
  status: ActiveLiveStatus;
}

const LiveProgressBadge: React.FC<LiveProgressBadgeProps> = ({ status }) => {
  if (!status) return null;

  if (status === 'SHOOTING') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-black text-white bg-emerald-600 border border-emerald-700 px-2.5 py-0.5 rounded-full shadow-2xs">
        <Target className="w-3 h-3 text-white" />
        行射中
      </span>
    );
  }

  if (status === 'IN_STAND') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-black text-white bg-blue-600 border border-blue-700 px-2.5 py-0.5 rounded-full shadow-2xs">
        <ShieldAlert className="w-3 h-3 text-white" />
        控え待機中
      </span>
    );
  }

  if (status === 'CALLED') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-black text-slate-950 bg-amber-400 border border-amber-500 px-2.5 py-0.5 rounded-full animate-pulse shadow-2xs">
        <BellRing className="w-3 h-3 text-slate-950" />
        招集中
      </span>
    );
  }

  return null;
};

// ==========================================
// 4. サブコンポーネント: ステージ別スコア表示バッジ
// ==========================================

interface StageScoreDisplayProps {
  round: StandRoundIndex;
  arrows: (ArrowHit | null)[];
  isAbsent: boolean;
  liveStatus: ActiveLiveStatus;
}

const StageScoreDisplay: React.FC<StageScoreDisplayProps> = ({
  round,
  arrows,
  isAbsent,
  liveStatus,
}) => {
  if (isAbsent) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
        <Ban className="w-3 h-3 text-rose-600" /> 棄権
      </span>
    );
  }

  const maxArrows = round === 3 ? 4 : 2;
  const confirmed = isStageConfirmed(arrows);
  const hits = countHits(arrows);

  const normalizedSlots: (boolean | null)[] = Array.from(
    { length: maxArrows },
    (_, i) => {
      const val = arrows?.[i];
      return val === true ? true : val === false ? false : null;
    },
  );

  const unconfirmedBoxStyle =
    liveStatus === 'SHOOTING'
      ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
      : liveStatus === 'IN_STAND'
        ? 'bg-blue-50 border-blue-300 text-blue-900'
        : liveStatus === 'CALLED'
          ? 'bg-amber-50 border-amber-400 text-amber-950'
          : 'bg-slate-50 border-slate-200 text-slate-400';

  const unconfirmedLabel =
    liveStatus === 'SHOOTING'
      ? '行射中'
      : liveStatus === 'IN_STAND'
        ? '控え待機中'
        : liveStatus === 'CALLED'
          ? '招集中'
          : '行射前';

  return (
    <div className="flex items-center justify-end gap-2.5">
      {/* 矢ごとの〇✕表示 */}
      <div className="inline-flex items-center gap-1.5">
        {normalizedSlots.map((slot, idx) => {
          const arrowLabel =
            round !== 3 ? (idx === 0 ? '甲矢' : '乙矢') : `${idx + 1}射目`;

          if (slot === true) {
            return (
              <div key={idx} className="flex flex-col items-center">
                {round !== 3 && (
                  <span className="text-[9px] font-bold text-slate-400 mb-0.5">
                    {arrowLabel}
                  </span>
                )}
                <span
                  title={`${arrowLabel}: 的中 (〇)`}
                  className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-700 font-black text-base inline-flex items-center justify-center shadow-2xs"
                >
                  〇
                </span>
              </div>
            );
          }

          if (slot === false) {
            return (
              <div key={idx} className="flex flex-col items-center">
                {round !== 3 && (
                  <span className="text-[9px] font-bold text-slate-400 mb-0.5">
                    {arrowLabel}
                  </span>
                )}
                <span
                  title={`${arrowLabel}: はずれ (✕)`}
                  className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-300 text-slate-600 font-bold text-sm inline-flex items-center justify-center"
                >
                  ✕
                </span>
              </div>
            );
          }

          return (
            <div key={idx} className="flex flex-col items-center">
              {round !== 3 && (
                <span className="text-[9px] font-bold text-slate-300 mb-0.5">
                  {arrowLabel}
                </span>
              )}
              <span
                title={`${arrowLabel}: 未確定`}
                className="w-8 h-8 rounded-xl bg-slate-50 border border-dashed border-slate-200 text-slate-300 font-mono text-xs inline-flex items-center justify-center"
              >
                -
              </span>
            </div>
          );
        })}
      </div>

      {/* ステージ計 / 進行状況ボックス */}
      <div
        className={`min-w-20 px-3 py-2 rounded-xl border flex flex-col items-center justify-center shrink-0 ${
          confirmed
            ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
            : unconfirmedBoxStyle
        }`}
      >
        <span className="text-[9px] font-bold">
          {confirmed ? '確定成績' : '進行状況'}
        </span>
        {confirmed ? (
          <span className="text-sm font-black font-mono text-slate-900">
            {hits}{' '}
            <span className="text-[10px] font-normal text-slate-500">
              / {maxArrows}中
            </span>
          </span>
        ) : (
          <span className="text-xs font-black mt-0.5">{unconfirmedLabel}</span>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 5. メインページコンポーネント (/results)
// ==========================================

export default function ResultsPage() {
  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  // タブ状態: 1(第1ステージ), 2(第2ステージ), 3(第3ステージ), 'OVERALL'(総合成績)
  const [selectedTab, setSelectedTab] = useState<ResultTabKey>(1);
  const [searchTerm, setSearchTerm] = useState<string>('');

  // 本部進行・招集状態ステート
  const [matchCallState, setMatchCallState] = useState<MatchCallState>({
    currentRound: 1,
    activeCallRound: null,
    activeCallGroup: null,
  });

  // Firestore購読ステート
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(() => isDbReady);
  const [errorMessage, setErrorMessage] = useState<string>(() =>
    !isDbReady ? 'Firebaseデータベースに接続されていません。' : '',
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // 初期匿名認証（フェイルセーフ）
  useEffect(() => {
    if (!isDbReady) return;
    ensureAnonymousAuth().catch((err) => {
      console.warn('【ResultsPage】初期認証確認警告:', err);
    });
  }, [isDbReady]);

  // 1. Firestore `matches` ドキュメントのリアルタイム監視
  useEffect(() => {
    if (!isDbReady) return;

    const matchRef = doc(db, 'matches', DEFAULT_MATCH_ID);
    const unsubscribe = onSnapshot(
      matchRef,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();

        const rawRound = Number(data.currentRound);
        const safeCurrentRound: StandRoundIndex =
          rawRound === 1 || rawRound === 2 || rawRound === 3 ? rawRound : 1;

        const rawActiveGroup = data.activeCallGroup;
        const safeActiveGroup =
          typeof rawActiveGroup === 'number' && rawActiveGroup > 0
            ? rawActiveGroup
            : null;

        const rawActiveRound = Number(data.activeCallRound);
        const safeActiveRound: StandRoundIndex | null =
          safeActiveGroup !== null &&
          (rawActiveRound === 1 || rawActiveRound === 2 || rawActiveRound === 3)
            ? (rawActiveRound as StandRoundIndex)
            : safeActiveGroup !== null
              ? safeCurrentRound
              : null;

        setMatchCallState({
          currentRound: safeCurrentRound,
          activeCallRound: safeActiveRound,
          activeCallGroup: safeActiveGroup,
        });
      },
      (err: FirestoreError) => {
        console.error('【成績速報 matches 購読エラー】:', err);
      },
    );

    return () => unsubscribe();
  }, [isDbReady]);

  // 2. Firestore `entries` コレクションのリアルタイム監視
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
            shosa: sanitizeShosaType(raw.shosa),
            rankTitle: sanitizeRankTitleType(raw.rankTitle),
            staffRole: raw.staffRole || '無し',
            staffDutyShift: raw.staffDutyShift || '無し',
            checkInStatus: (raw.checkInStatus as CheckInStatus) || 'UNCHECKED',
            checkInAt: typeof raw.checkInAt === 'number' ? raw.checkInAt : null,
            checkInMethod: raw.checkInMethod || null,
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
              2: { standGroup: afternoonGroup, standOrder: afternoonOrder },
              3: { standGroup: afternoonGroup, standOrder: afternoonOrder },
            },
            progressStatus: sanitizeProgressStatus(raw.progressStatus),
            qualificationStatus:
              (raw.qualificationStatus as QualificationStatus) || 'ACTIVE',
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
        setLastSyncedAt(new Date());
        setErrorMessage('');
        setIsLoading(false);
      },
      (error: FirestoreError) => {
        console.error('【成績速報Firestore購読エラー】:', error);
        setErrorMessage(
          '参加者・成績データの取得に失敗しました。通信環境を確認してください。',
        );
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [isDbReady]);

  const activeParticipants = useMemo(() => {
    return participants.filter((p) => {
      const hasStand =
        p.standAssignments[1]?.standGroup !== null ||
        p.standAssignments[2]?.standGroup !== null;
      return (
        hasStand ||
        p.checkInStatus === 'CHECKED_IN' ||
        p.checkInStatus === 'ABSENT' ||
        p.qrSentStatus === 'SENT'
      );
    });
  }, [participants]);

  const groupOptions = useMemo(() => {
    let maxAssignedStand = 1;
    activeParticipants.forEach((p) => {
      ([1, 2, 3] as StandRoundIndex[]).forEach((r) => {
        const s = p.standAssignments[r]?.standGroup;
        if (s && s > maxAssignedStand) maxAssignedStand = s;
      });
    });

    const groupsFromMaxStand = Math.ceil(maxAssignedStand / STANDS_PER_GROUP);
    const groupsFromPlayerCount = Math.ceil(
      activeParticipants.length / PLAYERS_PER_GROUP,
    );
    const totalGroups = Math.max(1, groupsFromMaxStand, groupsFromPlayerCount);

    return Array.from({ length: totalGroups }, (_, i) => i + 1);
  }, [activeParticipants]);

  const searchedParticipants = useMemo(() => {
    if (searchTerm.trim() === '') return activeParticipants;
    const term = searchTerm.trim().toLowerCase();
    return activeParticipants.filter((p) => {
      const matchesName = p.name.toLowerCase().includes(term);
      const matchesKana = p.nameKana.toLowerCase().includes(term);
      const matchesOrg = p.organization.toLowerCase().includes(term);
      const matchesBib = p.bibNumber.toString().includes(term);
      return matchesName || matchesKana || matchesOrg || matchesBib;
    });
  }, [activeParticipants, searchTerm]);

  const currentRound: StandRoundIndex =
    selectedTab === 'OVERALL' ? 1 : selectedTab;

  /**
   * 【招集解除時の進行表記完全消去ロジック】
   * 招集ボタンが解除された際（activeCallGroup === null）は、
   * entries 側の古い progressStatus を参照せず即座に null を返し、
   * 「行射中」「控え待機中」「招集中」のバッジと枠線色をすべて消去する。
   */
  const resolvePlayerLiveStatus = (
    participant: Participant,
    round: StandRoundIndex,
    groupNumber?: number,
  ): ActiveLiveStatus => {
    const isAbsent =
      participant.checkInStatus === 'ABSENT' ||
      participant.qualificationStatus === 'WITHDRAWN';
    if (isAbsent) return null;

    if (
      matchCallState.activeCallGroup === null ||
      matchCallState.activeCallGroup <= 0 ||
      matchCallState.activeCallRound !== round
    ) {
      return null;
    }

    const assignedStand = participant.standAssignments[round]?.standGroup;
    const effectiveGroup =
      groupNumber ??
      (assignedStand ? Math.ceil(assignedStand / STANDS_PER_GROUP) : null);

    if (!effectiveGroup) return null;

    return evaluateGroupLiveStatus(
      effectiveGroup,
      matchCallState.activeCallGroup,
    );
  };

  const overallRankedParticipants = useMemo(() => {
    const list = searchedParticipants.map((p) => {
      const s1Hits = countHits(p.stand1_arrows);
      const s2Hits = countHits(p.stand2_arrows);
      const s3Hits = countHits(p.stand3_arrows);
      const s1Done = isStageConfirmed(p.stand1_arrows);
      const s2Done = isStageConfirmed(p.stand2_arrows);
      const s3Done = isStageConfirmed(p.stand3_arrows);
      const calculatedTotal = s1Hits + s2Hits + s3Hits;
      const effectiveTotal = Math.max(p.totalHits || 0, calculatedTotal);
      const hasAnyRecord = s1Done || s2Done || s3Done;

      return {
        participant: p,
        s1Hits,
        s2Hits,
        s3Hits,
        s1Done,
        s2Done,
        s3Done,
        effectiveTotal,
        hasAnyRecord,
      };
    });

    return list.sort((a, b) => {
      const isAbsentA =
        a.participant.checkInStatus === 'ABSENT' ||
        a.participant.qualificationStatus === 'WITHDRAWN';
      const isAbsentB =
        b.participant.checkInStatus === 'ABSENT' ||
        b.participant.qualificationStatus === 'WITHDRAWN';
      if (isAbsentA !== isAbsentB) return isAbsentA ? 1 : -1;

      if (
        a.participant.finalRank !== null &&
        b.participant.finalRank !== null &&
        a.participant.finalRank !== b.participant.finalRank
      ) {
        return a.participant.finalRank - b.participant.finalRank;
      }

      if (b.effectiveTotal !== a.effectiveTotal) {
        return b.effectiveTotal - a.effectiveTotal;
      }

      if (
        a.participant.enkinRank !== null &&
        b.participant.enkinRank !== null &&
        a.participant.enkinRank !== b.participant.enkinRank
      ) {
        return a.participant.enkinRank - b.participant.enkinRank;
      }

      return a.participant.bibNumber - b.participant.bibNumber;
    });
  }, [searchedParticipants]);

  // ステージ別：1選手分のカード描画関数
  const renderParticipantRow = (
    participant: Participant,
    groupNumber: number,
    standNumber: number,
  ) => {
    const isAbsent =
      participant.checkInStatus === 'ABSENT' ||
      participant.qualificationStatus === 'WITHDRAWN';

    const arrows =
      currentRound === 1
        ? participant.stand1_arrows
        : currentRound === 2
          ? participant.stand2_arrows
          : participant.stand3_arrows;

    const standOrder = participant.standAssignments[currentRound]?.standOrder;
    const confirmed = isStageConfirmed(arrows);

    const liveStatus = !confirmed
      ? resolvePlayerLiveStatus(participant, currentRound, groupNumber)
      : null;

    // 【フールプルーフ】進行状況に応じたカード枠線の色連動ハイライト
    const cardBorderClass = isAbsent
      ? 'bg-rose-50/30 border-rose-200 opacity-65'
      : confirmed
        ? 'bg-white border-emerald-200/90 shadow-2xs'
        : liveStatus === 'CALLED'
          ? 'bg-amber-50/40 border-2 border-amber-400 shadow-sm animate-[pulse_3s_ease-in-out_infinite]'
          : liveStatus === 'IN_STAND'
            ? 'bg-blue-50/30 border-2 border-blue-400 shadow-xs'
            : liveStatus === 'SHOOTING'
              ? 'bg-emerald-50/30 border-2 border-emerald-500 shadow-xs'
              : 'bg-white border-slate-200/90 shadow-2xs hover:border-slate-300';

    return (
      <div
        key={participant.id}
        className={`p-3.5 rounded-2xl border transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${cardBorderClass}`}
      >
        <div className="flex items-start sm:items-center gap-3">
          <div className="min-w-[88px] px-2.5 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-900 flex flex-col items-center justify-center shrink-0">
            <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-slate-600">
              <span>第{groupNumber}組</span>
              <span>・</span>
              <span className="text-slate-900 font-black">
                第{standNumber}立
              </span>
            </div>
            <span className="text-xs font-black leading-tight font-mono text-amber-800 mt-0.5">
              {getStandOrderLabel(standOrder)}
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-black text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                No.{participant.bibNumber}
              </span>
              <h4 className="text-base font-black text-slate-900">
                {participant.name}
              </h4>

              <LiveProgressBadge status={liveStatus} />

              {isAbsent && (
                <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
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

            <div className="text-xs text-slate-600 font-bold mt-1 flex flex-wrap items-center gap-2">
              <span>所属チーム: {participant.organization || '無所属'}</span>
              <span className="text-slate-300">|</span>
              <span className="font-mono text-[11px] text-slate-500">
                立ちG: 第{groupNumber}組 / 第{standNumber}立 (
                {getStandOrderLabel(standOrder)})
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end self-end lg:self-auto pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100 w-full lg:w-auto">
          <StageScoreDisplay
            round={currentRound}
            arrows={arrows}
            isAbsent={isAbsent}
            liveStatus={liveStatus}
          />
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-8 text-slate-500 w-full">
        <Loader2 className="w-8 h-8 animate-spin mb-2 text-slate-900" />
        <span className="text-xs font-mono font-bold">
          リアルタイム成績速報コンソールを初期化中...
        </span>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 p-4 sm:p-6 lg:p-8 space-y-6 w-full">
      {errorMessage && (
        <div className="w-full p-4 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-bold flex items-center justify-between gap-2 shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => window.location.reload()}
            className="h-8 px-3 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1" />
            再読み込み
          </Button>
        </div>
      )}

      <Card className="w-full shadow-sm border border-slate-200/80 rounded-2xl bg-white overflow-hidden">
        <CardHeader className="bg-white border-b border-slate-100 p-5 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center flex-wrap gap-2 mb-1">
                <span className="text-[10px] font-bold tracking-wider bg-slate-900 text-white px-2.5 py-0.5 rounded-full shadow-2xs">
                  参加者・観客用
                </span>
                <span className="text-[11px] font-mono font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                  リアルタイム自動更新
                </span>
                {lastSyncedAt && (
                  <span className="text-[11px] text-slate-400 font-mono">
                    最終同期:{' '}
                    {lastSyncedAt.toLocaleTimeString('ja-JP', {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                )}
              </div>
              <CardTitle className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Target className="w-5 h-5 text-amber-500" />
                ステージ別 立ち順・リアルタイム成績一覧
              </CardTitle>
            </div>

            <div className="relative w-full md:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="選手名・所属チーム・ゼッケンで検索..."
                className="w-full pl-9 pr-12 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:bg-white focus:border-slate-900 font-medium transition-colors"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400 hover:text-slate-700"
                >
                  クリア
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => setSelectedTab(1)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                selectedTab === 1
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Sun className="w-3.5 h-3.5 text-amber-400" />
              第1ステージ (午前・一手 2射)
            </button>

            <button
              type="button"
              onClick={() => setSelectedTab(2)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                selectedTab === 2
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Moon className="w-3.5 h-3.5 text-slate-300" />
              第2ステージ (午後・一手 2射)
            </button>

            <button
              type="button"
              onClick={() => setSelectedTab(3)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                selectedTab === 3
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Moon className="w-3.5 h-3.5 text-slate-300" />
              第3ステージ (午後・四矢 4射)
            </button>

            <button
              type="button"
              onClick={() => setSelectedTab('OVERALL')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                selectedTab === 'OVERALL'
                  ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Trophy className="w-3.5 h-3.5 text-amber-700" />
              総合成績
            </button>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-5 space-y-6">
          {selectedTab !== 'OVERALL' ? (
            <>
              {groupOptions.map((groupNumber) => {
                const [firstStandNumber, secondStandNumber] =
                  getStandNumbersByGroup(groupNumber);

                const firstStandPlayers = searchedParticipants
                  .filter(
                    (p) =>
                      p.standAssignments[currentRound]?.standGroup ===
                      firstStandNumber,
                  )
                  .sort(
                    (a, b) =>
                      (a.standAssignments[currentRound]?.standOrder ?? 99) -
                      (b.standAssignments[currentRound]?.standOrder ?? 99),
                  );

                const secondStandPlayers = searchedParticipants
                  .filter(
                    (p) =>
                      p.standAssignments[currentRound]?.standGroup ===
                      secondStandNumber,
                  )
                  .sort(
                    (a, b) =>
                      (a.standAssignments[currentRound]?.standOrder ?? 99) -
                      (b.standAssignments[currentRound]?.standOrder ?? 99),
                  );

                const groupTotalPlayers =
                  firstStandPlayers.length + secondStandPlayers.length;

                if (searchTerm.trim() !== '' && groupTotalPlayers === 0) {
                  return null;
                }

                const groupLiveStatus =
                  matchCallState.activeCallGroup !== null &&
                  matchCallState.activeCallRound === currentRound
                    ? evaluateGroupLiveStatus(
                        groupNumber,
                        matchCallState.activeCallGroup,
                      )
                    : null;

                return (
                  <div
                    key={groupNumber}
                    className="space-y-4 border border-slate-200/90 rounded-2xl p-4 bg-white shadow-2xs"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-medium gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 font-sans flex items-center gap-1">
                          <Layers className="w-3.5 h-3.5 text-slate-700" />【
                          {getStageName(currentRound)}】
                        </span>
                        <span className="text-slate-950 font-mono font-black bg-amber-100 border border-amber-300 px-2.5 py-0.5 rounded">
                          立ちG: 第 {groupNumber} 組
                        </span>
                        <LiveProgressBadge status={groupLiveStatus} />
                      </div>
                      <span className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md self-start sm:self-auto">
                        {currentRound === 1
                          ? '午前・一手2射（1本目〇で甲矢的中賞 / 2中で一手束中賞）'
                          : currentRound === 2
                            ? '午後・一手2射（2中で一手束中賞）'
                            : '午後・四矢4射（4中で四矢皆中賞）'}
                      </span>
                    </div>

                    <div className="space-y-2.5 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/90">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span className="px-2.5 py-0.5 rounded-md bg-slate-900 text-white font-mono text-xs font-black">
                          第 {firstStandNumber} 立
                        </span>
                      </div>

                      {firstStandPlayers.length === 0 ? (
                        <div className="py-6 text-center text-slate-400 text-xs font-medium bg-white rounded-xl border border-dashed border-slate-200">
                          第 {firstStandNumber} 立に該当する選手はいません。
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {firstStandPlayers.map((p) =>
                            renderParticipantRow(
                              p,
                              groupNumber,
                              firstStandNumber,
                            ),
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2.5 bg-slate-50/70 p-4 rounded-2xl border border-slate-200/90">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span className="px-2.5 py-0.5 rounded-md bg-slate-800 text-amber-400 font-mono text-xs font-black">
                          第 {secondStandNumber} 立
                        </span>
                      </div>

                      {secondStandPlayers.length === 0 ? (
                        <div className="py-6 text-center text-slate-400 text-xs font-medium bg-white rounded-xl border border-dashed border-slate-200">
                          第 {secondStandNumber} 立に該当する選手はいません。
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {secondStandPlayers.map((p) =>
                            renderParticipantRow(
                              p,
                              groupNumber,
                              secondStandNumber,
                            ),
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <div className="space-y-3">
              <div className="bg-slate-900 text-white px-4 py-3 rounded-2xl flex flex-wrap items-center justify-between gap-2 shadow-2xs">
                <div className="flex items-center gap-2">
                  <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="font-black text-xs sm:text-sm">
                    総合成績ランキング（全8射）
                  </span>
                </div>
                <span className="text-xs font-mono text-slate-300">
                  対象 {overallRankedParticipants.length} 名
                </span>
              </div>

              {overallRankedParticipants.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs font-medium bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  該当する選手データはありません。
                </div>
              ) : (
                <div className="space-y-2.5">
                  {overallRankedParticipants.map((item, idx) => {
                    const { participant: p } = item;
                    const isAbsent =
                      p.checkInStatus === 'ABSENT' ||
                      p.qualificationStatus === 'WITHDRAWN';

                    const rank =
                      p.finalRank ??
                      (idx > 0 &&
                      overallRankedParticipants[idx - 1].effectiveTotal ===
                        item.effectiveTotal
                        ? overallRankedParticipants.findIndex(
                            (r) => r.effectiveTotal === item.effectiveTotal,
                          ) + 1
                        : idx + 1);

                    // 総合成績タブでも招集解除中（activeCallGroup === null）は進行表記を一切出さない
                    const overallLiveStatus: ActiveLiveStatus =
                      matchCallState.activeCallGroup !== null &&
                      matchCallState.activeCallRound !== null
                        ? resolvePlayerLiveStatus(
                            p,
                            matchCallState.activeCallRound,
                          )
                        : null;

                    const overallBorderClass = isAbsent
                      ? 'bg-rose-50/30 border-rose-200 opacity-65'
                      : overallLiveStatus === 'CALLED'
                        ? 'bg-amber-50/40 border-2 border-amber-400 shadow-sm animate-[pulse_3s_ease-in-out_infinite]'
                        : overallLiveStatus === 'IN_STAND'
                          ? 'bg-blue-50/30 border-2 border-blue-400 shadow-xs'
                          : overallLiveStatus === 'SHOOTING'
                            ? 'bg-emerald-50/30 border-2 border-emerald-500 shadow-xs'
                            : item.hasAnyRecord && rank <= 3
                              ? 'bg-amber-50/30 border-amber-300/80 shadow-2xs'
                              : 'bg-white border-slate-200/90 shadow-2xs hover:border-slate-300';

                    return (
                      <div
                        key={p.id}
                        className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${overallBorderClass}`}
                      >
                        <div className="flex items-start sm:items-center gap-3 min-w-0">
                          <div
                            className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 font-mono ${
                              isAbsent
                                ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                : !item.hasAnyRecord
                                  ? 'bg-slate-100 text-slate-400 border border-slate-200'
                                  : rank === 1
                                    ? 'bg-amber-400 text-slate-950 shadow-2xs'
                                    : rank === 2
                                      ? 'bg-slate-300 text-slate-900'
                                      : rank === 3
                                        ? 'bg-amber-700 text-white'
                                        : 'bg-slate-100 text-slate-800 border border-slate-200'
                            }`}
                          >
                            <span className="text-[9px] font-bold leading-none opacity-75">
                              RANK
                            </span>
                            <span className="text-base font-black leading-tight mt-0.5">
                              {isAbsent
                                ? '棄権'
                                : item.hasAnyRecord
                                  ? `${rank}位`
                                  : '-'}
                            </span>
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-xs font-black text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                                No.{p.bibNumber}
                              </span>
                              <h4 className="text-base font-black text-slate-900 truncate">
                                {p.name}
                              </h4>

                              <LiveProgressBadge status={overallLiveStatus} />

                              {isAbsent && (
                                <span className="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                                  棄権
                                </span>
                              )}
                              {p.isHayaHit && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-black text-emerald-800 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-full">
                                  <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
                                  甲矢的中賞
                                </span>
                              )}
                              {p.isSokuchu && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-black text-blue-800 bg-blue-50 border border-blue-300 px-2 py-0.5 rounded-full">
                                  <Target className="w-2.5 h-2.5 text-blue-600" />
                                  一手束中賞
                                </span>
                              )}
                              {p.isPerfect && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-black text-amber-900 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full">
                                  <Award className="w-2.5 h-2.5 text-amber-700" />
                                  四矢皆中賞
                                </span>
                              )}
                            </div>

                            <div className="text-xs text-slate-600 font-bold mt-1 truncate">
                              所属チーム: {p.organization || '無所属'}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5 sm:flex sm:items-center sm:gap-2 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-slate-100 w-full sm:w-auto">
                          <div className="px-2 py-1.5 sm:min-w-[68px] rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col items-center justify-center">
                            <span className="text-[9px] font-bold text-slate-400">
                              第1(2射)
                            </span>
                            <span className="text-xs sm:text-sm font-black font-mono text-slate-800 mt-0.5">
                              {item.s1Done ? (
                                <>
                                  {item.s1Hits}
                                  <span className="text-[10px] font-normal text-slate-400">
                                    /2
                                  </span>
                                </>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </span>
                          </div>

                          <div className="px-2 py-1.5 sm:min-w-[68px] rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col items-center justify-center">
                            <span className="text-[9px] font-bold text-slate-400">
                              第2(2射)
                            </span>
                            <span className="text-xs sm:text-sm font-black font-mono text-slate-800 mt-0.5">
                              {item.s2Done ? (
                                <>
                                  {item.s2Hits}
                                  <span className="text-[10px] font-normal text-slate-400">
                                    /2
                                  </span>
                                </>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </span>
                          </div>

                          <div className="px-2 py-1.5 sm:min-w-[68px] rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col items-center justify-center">
                            <span className="text-[9px] font-bold text-slate-400">
                              第3(4射)
                            </span>
                            <span className="text-xs sm:text-sm font-black font-mono text-slate-800 mt-0.5">
                              {item.s3Done ? (
                                <>
                                  {item.s3Hits}
                                  <span className="text-[10px] font-normal text-slate-400">
                                    /4
                                  </span>
                                </>
                              ) : (
                                <span className="text-slate-300">-</span>
                              )}
                            </span>
                          </div>

                          <div
                            className={`px-2.5 py-1.5 sm:min-w-[82px] rounded-xl border flex flex-col items-center justify-center ${
                              item.hasAnyRecord
                                ? 'bg-slate-900 border-slate-900 text-white'
                                : 'bg-slate-100 border-slate-200 text-slate-400'
                            }`}
                          >
                            <span
                              className={`text-[9px] font-bold ${
                                item.hasAnyRecord
                                  ? 'text-amber-400'
                                  : 'text-slate-400'
                              }`}
                            >
                              通算的中
                            </span>
                            {item.hasAnyRecord ? (
                              <span className="text-sm sm:text-base font-black font-mono leading-tight mt-0.5">
                                {item.effectiveTotal}
                                <span className="text-[10px] font-normal text-slate-300 ml-0.5">
                                  /8中
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-400 mt-0.5">
                                <Clock className="w-2.5 h-2.5" /> 行射前
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
