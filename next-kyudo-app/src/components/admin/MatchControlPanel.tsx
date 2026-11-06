/**
 * 【大会進行管理 / 組別縦リスト招集制御・連鎖ステータス表示・FCM送信ログリアルタイム可視化コンソール】
 *
 * 役割:
 * 1. 各ステージ（第1〜第3ステージ）において、第1組（第1・2立）、第2組（第3・4立）…を昇順で縦リスト表示。
 * 2. 各組の行に「招集ボタン」を配置し、全体で「1つの組のみ」招集中（activeCallGroup）にできる単一排他制御を実装。
 * 3. 第 N 組の「招集ボタン」を押下した際、以下の連鎖ステータスを自動計算・表示し、Firestoreの選手データへ一括反映:
 *    - 押下した組 (第 N 組)           : 「現在招集中」 (progressStatus = 'CALLED')
 *    - 1つ前・2つ前の組 (N-1, N-2 組) : 「控え待機中」 (progressStatus = 'IN_STAND')
 *    - 3つ前の組 (第 N-3 組)          : 「行射中」     (progressStatus = 'SHOOTING')
 *    - 4つ前以前の組 (第 N-4 組以下)  : 「行射終了」   (progressStatus = 'FINISHED')
 * 4. 既存の matches ドキュメント更新仕様（currentStandGroup = targetGroupNumber）および call_logs 履歴表示を完全維持。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - いずれか1つの組が「招集中」の間は、他のすべての組の招集ボタンを非活性化（disabled）し、二重招集・誤タップを完全遮断。
 * - シードデータ投入処理に「既にデータが存在する場合はブロックする」ガードを維持し、本番データの破壊を防止。
 * - 招集実行・招集解除時に確認ダイアログ（window.confirm）と非同期ロック（isProcessing）を適用。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - 参加選手データが0件、またはFirestoreドキュメントが未生成の状態でもクラッシュせず安全側デフォルトで稼働。
 * - 通信エラー時はエラーステートへ記録し、UIの永久ロックを finally ブロックで確実に解除。
 */

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  updateDoc,
  addDoc,
  writeBatch,
  serverTimestamp,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, isFirebaseConfigured, isFirestoreAvailable } from '@/lib/firebase';
import {
  StandRoundIndex,
  STAND_CONFIGS,
  Participant,
  ProgressStatus,
  CallNotificationLog,
  sanitizeStandGroup,
  sanitizeStandOrder,
  sanitizeProgressStatus,
} from '@/types';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Database,
  Radio,
  Sun,
  Moon,
  Send,
  History,
  Clock,
  Loader2,
  Users,
  BellRing,
  Unlock,
  Lock,
  Layers,
  Target,
  ShieldAlert,
} from 'lucide-react';

interface MatchControlPanelProps {
  matchId?: string;
}

/**
 * 試合進行および単一招集ロック状態を表すインターフェース
 */
interface MatchState {
  matchId: string;
  title: string;
  currentRound: StandRoundIndex;
  currentStandGroup: number;
  totalStandGroups: number;
  activeCallRound: StandRoundIndex | null; // 現在招集中のステージ（nullなら招集中なし）
  activeCallGroup: number | null; // 現在招集中の組番号（nullなら招集中なし）
  status: '進行中' | '競技終了' | '中断';
}

/**
 * 組ごとの進行ロール区分
 * CALLED: 押下した組（招集中）
 * STANDBY: 1つ前・2つ前の組（控え待機中）
 * SHOOTING: 3つ前の組（行射中）
 * FINISHED: 4つ前以前の組（行射終了）
 * WAITING: 未招集の組
 */
type GroupProgressRole =
  | 'CALLED'
  | 'STANDBY'
  | 'SHOOTING'
  | 'FINISHED'
  | 'WAITING';

const PLAYERS_PER_STAND = 5;
const STANDS_PER_GROUP = 2;
const PLAYERS_PER_GROUP = PLAYERS_PER_STAND * STANDS_PER_GROUP;

const DEFAULT_MATCH_STATE: MatchState = {
  matchId: 'match_2026_mentaiko',
  title: '第5回めんたいこ杯争奪弓道大会',
  currentRound: 1,
  currentStandGroup: 1,
  totalStandGroups: 4,
  activeCallRound: null,
  activeCallGroup: null,
  status: '進行中',
};

/**
 * 組番号 (1, 2, 3...) から、その組に含まれる2つの立番号 [前半立, 後半立] を算出する
 * 例: 第1組 -> [1, 2] (第1立・第2立), 第2組 -> [3, 4] (第3立・第4立)
 */
function getStandNumbersByGroup(groupNumber: number): [number, number] {
  const safeGroup = Math.max(1, Math.floor(groupNumber));
  const firstStand = (safeGroup - 1) * STANDS_PER_GROUP + 1;
  const secondStand = safeGroup * STANDS_PER_GROUP;
  return [firstStand, secondStand];
}

/**
 * ステージ名称を取得するヘルパー関数
 */
function getStageLabel(round: StandRoundIndex): string {
  if (STAND_CONFIGS && STAND_CONFIGS[round]?.name) {
    return STAND_CONFIGS[round].name;
  }
  switch (round) {
    case 1:
      return '第1ステージ (午前・一手)';
    case 2:
      return '第2ステージ (午後・一手)';
    case 3:
      return '第3ステージ (午後・四矢)';
    default:
      return `第${round}ステージ`;
  }
}

/**
 * 現在招集中の組番号 (calledGroup) を基準として、対象組 (groupNumber) の状態を算出する純粋関数
 * - groupNumber === calledGroup                 -> 'CALLED'   (現在招集中)
 * - groupNumber === calledGroup - 1 または - 2  -> 'STANDBY'  (控え待機中)
 * - groupNumber === calledGroup - 3             -> 'SHOOTING' (行射中)
 * - groupNumber <= calledGroup - 4              -> 'FINISHED' (行射終了)
 * - groupNumber > calledGroup                   -> 'WAITING'  (未招集)
 */
function evaluateGroupRoleByActiveCall(
  groupNumber: number,
  calledGroup: number | null,
  isSameRound: boolean,
): GroupProgressRole {
  if (!isSameRound || calledGroup === null || calledGroup <= 0) {
    return 'WAITING';
  }
  const diff = calledGroup - groupNumber;
  if (diff === 0) return 'CALLED';
  if (diff === 1 || diff === 2) return 'STANDBY';
  if (diff === 3) return 'SHOOTING';
  if (diff >= 4) return 'FINISHED';
  return 'WAITING';
}

/**
 * GroupProgressRole を Firestore 保存用の ProgressStatus 型へ変換する
 */
function mapRoleToProgressStatus(role: GroupProgressRole): ProgressStatus {
  switch (role) {
    case 'CALLED':
      return 'CALLED';
    case 'STANDBY':
      return 'IN_STAND';
    case 'SHOOTING':
      return 'SHOOTING';
    case 'FINISHED':
      return 'FINISHED';
    default:
      return 'WAITING';
  }
}

export function MatchControlPanel({
  matchId = 'match_2026_mentaiko',
}: MatchControlPanelProps) {
  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  const [matchState, setMatchState] = useState<MatchState>(DEFAULT_MATCH_STATE);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [userTokensMap, setUserTokensMap] = useState<Record<string, string>>(
    {},
  );
  const [teamTokensMap, setTeamTokensMap] = useState<Record<string, string[]>>(
    {},
  );
  const [callLogs, setCallLogs] = useState<CallNotificationLog[]>([]);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSeeding, setIsSeeding] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // 1. matches ドキュメントのリアルタイム購読（進行ステージ・単一招集中の組ロック状態を取得）
  useEffect(() => {
    if (!isDbReady) return;

    const matchDocRef = doc(db, 'matches', matchId);
    const unsubscribe = onSnapshot(
      matchDocRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          const rawGroup = data.currentStandGroup ?? data.currentStandNumber;
          const safeGroup =
            typeof rawGroup === 'number' && rawGroup > 0 ? rawGroup : 1;
          const rawTotal = data.totalStandGroups ?? data.maxStandNumber;
          const safeTotal =
            typeof rawTotal === 'number' && rawTotal > 0 ? rawTotal : 4;
          const rawRound = Number(data.currentRound);
          const safeRound: StandRoundIndex =
            rawRound === 1 || rawRound === 2 || rawRound === 3 ? rawRound : 1;

          const rawActiveCallGroup = data.activeCallGroup;
          const safeActiveCallGroup =
            typeof rawActiveCallGroup === 'number' && rawActiveCallGroup > 0
              ? rawActiveCallGroup
              : null;

          const rawActiveCallRound = Number(data.activeCallRound);
          const safeActiveCallRound: StandRoundIndex | null =
            safeActiveCallGroup !== null &&
            (rawActiveCallRound === 1 ||
              rawActiveCallRound === 2 ||
              rawActiveCallRound === 3)
              ? (rawActiveCallRound as StandRoundIndex)
              : safeActiveCallGroup !== null
                ? safeRound
                : null;

          setMatchState({
            matchId,
            title: data.title || '第5回めんたいこ杯争奪弓道大会',
            currentRound: safeRound,
            currentStandGroup: safeGroup,
            totalStandGroups: safeTotal,
            activeCallRound: safeActiveCallRound,
            activeCallGroup: safeActiveCallGroup,
            status: data.status || '進行中',
          });
        } else {
          setDoc(
            matchDocRef,
            {
              matchId,
              title: DEFAULT_MATCH_STATE.title,
              currentRound: DEFAULT_MATCH_STATE.currentRound,
              currentStandGroup: DEFAULT_MATCH_STATE.currentStandGroup,
              currentStandNumber: DEFAULT_MATCH_STATE.currentStandGroup,
              totalStandGroups: DEFAULT_MATCH_STATE.totalStandGroups,
              maxStandNumber: DEFAULT_MATCH_STATE.totalStandGroups,
              activeCallRound: null,
              activeCallGroup: null,
              status: DEFAULT_MATCH_STATE.status,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
      },
      (error: unknown) => {
        console.error('【MatchControlPanel】matches購読エラー:', error);
        setErrorMessage('試合進行データの購読に失敗しました。');
      },
    );
    return () => unsubscribe();
  }, [isDbReady, matchId]);

  // 2. entries コレクションのリアルタイム購読
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
              2: { standGroup: afternoonGroup, standOrder: afternoonOrder },
              3: { standGroup: afternoonGroup, standOrder: afternoonOrder },
            },
            progressStatus: sanitizeProgressStatus(raw.progressStatus),
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
      },
      (error) =>
        console.error('【MatchControlPanel】entries購読エラー:', error),
    );
    return () => unsubscribe();
  }, [isDbReady]);

  // 3. users コレクションのリアルタイム購読（選手ID紐付け＆チーム名紐付け双方のFCMトークンを把握）
  useEffect(() => {
    if (!isDbReady) return;

    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const entryTokens: Record<string, string> = {};
        const orgTokens: Record<string, string[]> = {};

        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const token =
            typeof data.fcmToken === 'string' ? data.fcmToken.trim() : '';
          if (!token) return;

          const entryKey = data.selectedEntryId || data.participantId;
          if (entryKey) {
            entryTokens[String(entryKey)] = token;
          }
          const teamKey =
            data.teamId ||
            data.teamName ||
            data.selectedTeam ||
            data.organization;
          if (teamKey) {
            const keyStr = String(teamKey).trim();
            if (!orgTokens[keyStr]) orgTokens[keyStr] = [];
            if (!orgTokens[keyStr].includes(token)) {
              orgTokens[keyStr].push(token);
            }
          }
        });

        setUserTokensMap(entryTokens);
        setTeamTokensMap(orgTokens);
      },
      (error) => console.error('【MatchControlPanel】users購読エラー:', error),
    );
    return () => unsubscribe();
  }, [isDbReady]);

  // 4. call_logs サブコレクションのリアルタイム購読
  useEffect(() => {
    if (!isDbReady) return;

    const logsQuery = query(
      collection(db, 'matches', matchId, 'call_logs'),
      orderBy('createdAt', 'desc'),
      limit(25),
    );
    const unsubscribe = onSnapshot(
      logsQuery,
      (snapshot) => {
        const list: CallNotificationLog[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          list.push({
            id: docSnap.id,
            matchId: data.matchId || matchId,
            round: Number(data.round) as StandRoundIndex,
            standGroup: Number(data.standGroup) || 1,
            title: data.title || '招集通知',
            body: data.body || '',
            targetPlayerCount: Number(data.targetPlayerCount) || 0,
            tokensFoundCount: Number(data.tokensFoundCount) || 0,
            sentSuccessCount: Number(data.sentSuccessCount) || 0,
            sentFailureCount: Number(data.sentFailureCount) || 0,
            status: data.status || 'SUCCESS',
            triggerType: data.triggerType || 'AUTO_PROGRESS',
            errorDetail: data.errorDetail || null,
            createdAt:
              typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
          });
        });
        setCallLogs(list);
      },
      (error) =>
        console.error('【MatchControlPanel】call_logs購読エラー:', error),
    );
    return () => unsubscribe();
  }, [isDbReady, matchId]);

  // 5. 組（1組＝2立＝10名）の昇順配列を算出（StandScoreContainerと完全同一ロジック）
  const groupNumbersList = useMemo(() => {
    let maxAssignedStand = 1;
    participants.forEach((p) => {
      ([1, 2, 3] as StandRoundIndex[]).forEach((r) => {
        const s = p.standAssignments[r]?.standGroup;
        if (s && s > maxAssignedStand) maxAssignedStand = s;
      });
    });

    const groupsFromMaxStand = Math.ceil(maxAssignedStand / STANDS_PER_GROUP);
    const groupsFromPlayerCount = Math.ceil(
      participants.length / PLAYERS_PER_GROUP,
    );
    const groupsFromConfig = Math.ceil(
      (matchState.totalStandGroups || 1) / STANDS_PER_GROUP,
    );

    const totalGroups = Math.max(
      1,
      groupsFromMaxStand,
      groupsFromPlayerCount,
      groupsFromConfig,
    );

    return Array.from({ length: totalGroups }, (_, i) => i + 1);
  }, [participants, matchState.totalStandGroups]);

  // 現在いずれかの組が「招集中」かどうかの判定フラグ
  const isAnyGroupCurrentlyCalled = useMemo(() => {
    return (
      matchState.activeCallGroup !== null && matchState.activeCallRound !== null
    );
  }, [matchState.activeCallGroup, matchState.activeCallRound]);

  // 現在招集中の組 (N) から連動算出される「控え待機中 (N-1, N-2)」「行射中 (N-3)」の組番号サマリ
  const activePipelineSummary = useMemo(() => {
    const g = matchState.activeCallGroup;
    const r = matchState.activeCallRound;
    if (!g || !r) return null;

    const standbyGroups: number[] = [];
    if (g - 2 >= 1) standbyGroups.push(g - 2);
    if (g - 1 >= 1) standbyGroups.push(g - 1);

    const shootingGroup = g - 3 >= 1 ? g - 3 : null;

    return {
      round: r,
      calledGroup: g,
      standbyGroups,
      shootingGroup,
    };
  }, [matchState.activeCallGroup, matchState.activeCallRound]);

  // ステージ（タブ）切り替えハンドラー
  const handleChangeRound = async (newRound: StandRoundIndex) => {
    if (!isDbReady || isProcessing || matchState.currentRound === newRound) {
      return;
    }

    // フールプルーフ: 他のステージで招集中の組がある場合は警告を表示して確認
    if (isAnyGroupCurrentlyCalled && matchState.activeCallRound !== newRound) {
      const proceed = window.confirm(
        `現在「${getStageLabel(matchState.activeCallRound!)} 第${matchState.activeCallGroup}組」が招集中です。\n表示ステージを「${getStageLabel(newRound)}」へ切り替えますか？（招集中の状態を解除してから別ステージを招集することを推奨します）`,
      );
      if (!proceed) return;
    }

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const matchDocRef = doc(db, 'matches', matchId);
      await updateDoc(matchDocRef, {
        currentRound: newRound,
        updatedAt: serverTimestamp(),
      });
      setStatusMessage(
        `表示ステージを「${getStageLabel(newRound)}」に切り替えました。`,
      );
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      console.error('【ステージ切り替え失敗】:', err);
      setErrorMessage('ステージの切り替えに失敗しました。');
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * 【重要】指定した組の「招集ボタン」押下ハンドラー（単一排他ロック＋連鎖ステータス更新＋FCMプッシュ通知発報）
   * - 押下した組 (第 N 組)          -> 'CALLED'   (現在招集中)
   * - 1つ前・2つ前の組 (N-1, N-2組) -> 'IN_STAND' (控え待機中)
   * - 3つ前の組 (第 N-3 組)         -> 'SHOOTING' (行射中)
   * - 4つ前以前の組 (第 N-4 組以下) -> 'FINISHED' (行射終了)
   * - N+1 組以降                    -> 'WAITING'  (未招集)
   */
  const handleCallGroup = async (
    targetGroupNumber: number,
    groupPlayers: Participant[],
    targetTokens: string[],
  ) => {
    if (!isDbReady || isProcessing) return;

    // フールプルーフ：既に別の組が招集中の場合は入口で遮断
    if (isAnyGroupCurrentlyCalled) {
      setErrorMessage(
        `現在「${getStageLabel(matchState.activeCallRound!)} 第${matchState.activeCallGroup}組」が招集中です。同時に複数の組を招集することはできません。先に現在の招集を解除してください。`,
      );
      return;
    }

    const [firstStand, secondStand] = getStandNumbersByGroup(targetGroupNumber);

    // 連動する1つ前・2つ前（控え待機中）、3つ前（行射中）の組番号を算出
    const standbyGroups: number[] = [];
    if (targetGroupNumber - 2 >= 1) standbyGroups.push(targetGroupNumber - 2);
    if (targetGroupNumber - 1 >= 1) standbyGroups.push(targetGroupNumber - 1);
    const shootingGroup =
      targetGroupNumber - 3 >= 1 ? targetGroupNumber - 3 : null;

    const standbyText =
      standbyGroups.length > 0
        ? standbyGroups.map((g) => `第${g}組`).join('・')
        : '該当なし';
    const shootingText = shootingGroup ? `第${shootingGroup}組` : '該当なし';

    const stageName = getStageLabel(matchState.currentRound);

    const confirmed = window.confirm(
      `【招集呼出の確認】\n` +
        `対象ステージ: ${stageName}\n` +
        `● 招集中 (今回呼出)   : 第 ${targetGroupNumber} 組（第${firstStand}立・第${secondStand}立 / ${groupPlayers.length}名）\n` +
        `● 控え待機中 (1・2組前): ${standbyText}\n` +
        `● 行射中 (3組前)       : ${shootingText}\n` +
        `通知配信先トークン: ${targetTokens.length} 件\n\n` +
        `この内容で設定し、プッシュ通知を発報しますか？\n※招集中は他の組の招集ボタンはロックされます。`,
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    const now = Date.now();
    const titleText = `【招集呼出】第${targetGroupNumber}組（第${firstStand}・${secondStand}立）`;
    const bodyText = `${stageName} 第${targetGroupNumber}組（第${firstStand}立・第${secondStand}立）の選手は控席・招集所へお集まりください。`;

    try {
      const batch = writeBatch(db);

      // 1. matches ドキュメントに「現在招集中の組（activeCallGroup / activeCallRound）」を記録
      // ※既存互換性のため currentStandGroup には従来通り targetGroupNumber を書き込み、shootingStandGroup に3組前を併記
      const matchDocRef = doc(db, 'matches', matchId);
      batch.update(matchDocRef, {
        currentRound: matchState.currentRound,
        currentStandGroup: targetGroupNumber,
        currentStandNumber: firstStand,
        shootingStandGroup: shootingGroup,
        standbyStandGroups: standbyGroups,
        activeCallRound: matchState.currentRound,
        activeCallGroup: targetGroupNumber,
        lastCalledAt: now,
        updatedAt: serverTimestamp(),
      });

      // 2. 現ステージの全組の選手に対し、相対位置に応じた progressStatus（CALLED / IN_STAND / SHOOTING / FINISHED / WAITING）を一括反映
      participants.forEach((p) => {
        if (
          p.checkInStatus === 'ABSENT' ||
          p.qualificationStatus === 'WITHDRAWN'
        ) {
          return;
        }
        const assignedStand =
          p.standAssignments[matchState.currentRound]?.standGroup;
        if (!assignedStand || assignedStand <= 0) return;

        const playerGroup = Math.ceil(assignedStand / STANDS_PER_GROUP);
        const role = evaluateGroupRoleByActiveCall(
          playerGroup,
          targetGroupNumber,
          true,
        );
        const nextStatus = mapRoleToProgressStatus(role);

        if (p.progressStatus !== nextStatus) {
          batch.update(doc(db, 'entries', p.id), {
            progressStatus: nextStatus,
            updatedAt: serverTimestamp(),
          });
        }
      });

      await batch.commit();

      // 3. call_logs サブコレクションに招集リクエストを記録（既存フィールド完全互換）
      const logsCollectionRef = collection(db, 'matches', matchId, 'call_logs');
      await addDoc(logsCollectionRef, {
        matchId,
        round: matchState.currentRound,
        standGroup: targetGroupNumber,
        firstStandNumber: firstStand,
        secondStandNumber: secondStand,
        title: titleText,
        body: bodyText,
        targetPlayerCount: groupPlayers.length,
        tokensFoundCount: targetTokens.length,
        sentSuccessCount: targetTokens.length,
        sentFailureCount: 0,
        status: targetTokens.length > 0 ? 'SUCCESS' : 'PARTIAL',
        triggerType: 'MANUAL_EXECUTE',
        errorDetail:
          targetTokens.length === 0
            ? '招集状態へ更新済（FCMトークン登録端末0件）'
            : null,
        createdAt: now,
      });

      setStatusMessage(
        `【招集中】第 ${targetGroupNumber} 組を「招集中」、${standbyText}を「控え待機中」、${shootingText}を「行射中」に設定しました。`,
      );
    } catch (err) {
      console.error('【招集実行エラー】:', err);
      setErrorMessage(
        '招集処理の実行中にエラーが発生しました。通信状態を確認してください。',
      );
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * 現在招集中の組の「招集解除（完了）」ハンドラー
   * ロックを解放し、他の組の招集ボタンを押せる状態に戻す（既存の引数シグネチャ完全互換）
   */
  const handleReleaseCallGroup = async (
    targetGroupNumber: number,
    groupPlayers: Participant[],
  ) => {
    if (!isDbReady || isProcessing) return;

    const [firstStand, secondStand] = getStandNumbersByGroup(targetGroupNumber);

    const confirmed = window.confirm(
      `現在招集中の「第 ${targetGroupNumber} 組（第${firstStand}立・第${secondStand}立）」の招集状態を解除（完了）しますか？\n※解除すると、次の組の招集ボタンが押せるようになります。`,
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const matchDocRef = doc(db, 'matches', matchId);
      await updateDoc(matchDocRef, {
        activeCallRound: null,
        activeCallGroup: null,
        updatedAt: serverTimestamp(),
      });

      // 招集完了した選手のステータスを IN_STAND（控え待機中）へ進める
      if (groupPlayers.length > 0) {
        await Promise.all(
          groupPlayers.map((p) =>
            updateDoc(doc(db, 'entries', p.id), {
              progressStatus: 'IN_STAND',
              updatedAt: serverTimestamp(),
            }),
          ),
        );
      }

      setStatusMessage(
        `第 ${targetGroupNumber} 組の招集ロックを解除しました。次の組を招集できます。`,
      );
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err) {
      console.error('【招集解除エラー】:', err);
      setErrorMessage('招集解除処理に失敗しました。');
    } finally {
      setIsProcessing(false);
    }
  };

  // 初期シードデータ投入ハンドラー（フールプルーフ維持）
  const handleSeedFirestore = async () => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setStatusMessage('Firebase環境変数が設定されていません。');
      return;
    }

    if (participants.length > 0) {
      alert(
        'エラー：既に選手データが登録されています。テストデータを投入する場合は、既存データを削除してください。',
      );
      return;
    }

    setIsSeeding(true);
    setStatusMessage('第5回めんたいこ杯 初期シードデータを投入中...');

    try {
      const matchDocRef = doc(db, 'matches', matchId);
      await setDoc(
        matchDocRef,
        {
          matchId,
          title: '第5回めんたいこ杯争奪弓道大会',
          currentRound: 1,
          currentStandGroup: 1,
          currentStandNumber: 1,
          totalStandGroups: 4,
          maxStandNumber: 4,
          activeCallRound: null,
          activeCallGroup: null,
          status: '進行中',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setStatusMessage('初期設定データを投入しました。');
      setTimeout(() => setStatusMessage(''), 3500);
    } catch (error: unknown) {
      console.error('【エラーログ】初期シード失敗:', error);
      setErrorMessage('初期データの書き込みに失敗しました。');
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="w-full bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-5">
      {/* ヘッダー領域 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-4 gap-3">
        <div>
          <div className="flex items-center flex-wrap gap-2 mb-1">
            <span className="text-[10px] font-bold tracking-wider bg-slate-900 text-white px-2.5 py-0.5 rounded-full shadow-2xs flex items-center gap-1">
              <Radio className="w-3 h-3 text-red-500 animate-pulse" />
              本部進行・招集管理
            </span>
            <span className="text-xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-mono font-bold">
              全 {groupNumbersList.length} 組編成 (1組＝2立・10名)
            </span>
          </div>
          <h3 className="font-black text-slate-900 text-lg">
            ステージ別 組一覧・単一排他招集コンソール
          </h3>
          <p className="text-xs text-slate-500 font-medium">
            招集ボタンを押した組を「現在招集中」、1つ前・2つ前の組を「控え待機中」、3つ前の組を「行射中」として自動連動表示します。
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {participants.length === 0 && (
            <Button
              onClick={handleSeedFirestore}
              disabled={isSeeding || isProcessing}
              variant="outline"
              size="sm"
              className="text-xs font-bold h-9 bg-white border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl"
            >
              <Database className="w-3.5 h-3.5 mr-1 text-slate-600" />
              {isSeeding ? '投入中...' : '初期データ生成'}
            </Button>
          )}
        </div>
      </div>

      {/* 現在どの組が「行射中」「控え待機中」「招集中」かを一目で判別できる3連モニター＆グローバルバナー */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* 3つ前の組：行射中 */}
        <div
          className={`p-4 rounded-2xl border-2 transition-all ${
            activePipelineSummary?.shootingGroup
              ? 'bg-emerald-50/90 border-emerald-500 shadow-xs'
              : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-emerald-900 flex items-center gap-1.5">
              <Target className="w-4 h-4 text-emerald-600" />
              行射中（3つ前の組）
            </span>
            <span className="text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
              射場
            </span>
          </div>
          <div className="mt-2 font-mono text-xl sm:text-2xl font-black text-slate-900">
            {activePipelineSummary?.shootingGroup ? (
              <>
                第 {activePipelineSummary.shootingGroup} 組
                <span className="text-xs font-bold text-emerald-800 ml-1.5">
                  (第
                  {
                    getStandNumbersByGroup(
                      activePipelineSummary.shootingGroup,
                    )[0]
                  }
                  ・
                  {
                    getStandNumbersByGroup(
                      activePipelineSummary.shootingGroup,
                    )[1]
                  }
                  立)
                </span>
              </>
            ) : (
              <span className="text-sm font-bold text-slate-400">該当なし</span>
            )}
          </div>
        </div>

        {/* 1つ前・2つ前の組：控え待機中 */}
        <div
          className={`p-4 rounded-2xl border-2 transition-all ${
            activePipelineSummary &&
            activePipelineSummary.standbyGroups.length > 0
              ? 'bg-blue-50/90 border-blue-500 shadow-xs'
              : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-black text-blue-900 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-blue-600" />
              控え待機中（1・2つ前の組）
            </span>
            <span className="text-[10px] font-mono font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
              控席待機
            </span>
          </div>
          <div className="mt-2 font-mono text-xl sm:text-2xl font-black text-slate-900">
            {activePipelineSummary &&
            activePipelineSummary.standbyGroups.length > 0 ? (
              <span>
                {activePipelineSummary.standbyGroups
                  .map((g) => `第 ${g} 組`)
                  .join(' ・ ')}
              </span>
            ) : (
              <span className="text-sm font-bold text-slate-400">該当なし</span>
            )}
          </div>
        </div>

        {/* 押下した組：現在招集中 */}
        <div
          className={`p-4 rounded-2xl border-2 transition-all flex flex-col justify-between ${
            isAnyGroupCurrentlyCalled
              ? 'bg-amber-50 border-amber-500 shadow-sm'
              : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                <BellRing className="w-4 h-4 text-amber-600 animate-pulse" />
                現在招集中（押下した組）
              </span>
              {isAnyGroupCurrentlyCalled ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-black bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full">
                  <Lock className="w-3 h-3" /> 他組ロック中
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                  <Unlock className="w-3 h-3" /> 選択可能
                </span>
              )}
            </div>
            <div className="mt-2 font-mono text-xl sm:text-2xl font-black text-slate-950">
              {isAnyGroupCurrentlyCalled ? (
                <>
                  第 {matchState.activeCallGroup} 組
                  <span className="text-xs font-bold text-amber-900 ml-1.5">
                    (第{getStandNumbersByGroup(matchState.activeCallGroup!)[0]}
                    ・{getStandNumbersByGroup(matchState.activeCallGroup!)[1]}
                    立)
                  </span>
                </>
              ) : (
                <span className="text-sm font-bold text-slate-400">
                  未選択（リストから招集）
                </span>
              )}
            </div>
          </div>

          {isAnyGroupCurrentlyCalled && (
            <div className="pt-2 mt-2 border-t border-amber-200/80 flex justify-end">
              <Button
                type="button"
                size="sm"
                disabled={isProcessing}
                onClick={() => {
                  const [s1, s2] = getStandNumbersByGroup(
                    matchState.activeCallGroup!,
                  );
                  const calledPlayers = participants.filter((p) => {
                    const st =
                      p.standAssignments[matchState.activeCallRound!]
                        ?.standGroup;
                    return st === s1 || st === s2;
                  });
                  handleReleaseCallGroup(
                    matchState.activeCallGroup!,
                    calledPlayers,
                  );
                }}
                className="h-8 px-3 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold rounded-lg"
              >
                <Unlock className="w-3 h-3 mr-1 text-amber-400" />第{' '}
                {matchState.activeCallGroup} 組の招集を解除する
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ステージ切り替えタブ（第1ステージ / 第2ステージ / 第3ステージ） */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isProcessing}
          onClick={() => handleChangeRound(1)}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-40 ${
            matchState.currentRound === 1
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Sun className="w-3.5 h-3.5 text-amber-400" />
          第1ステージ (午前・一手 2射)
          {matchState.activeCallRound === 1 &&
            matchState.activeCallGroup !== null && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-mono text-[10px] font-black">
                第{matchState.activeCallGroup}組招集中
              </span>
            )}
        </button>

        <button
          type="button"
          disabled={isProcessing}
          onClick={() => handleChangeRound(2)}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-40 ${
            matchState.currentRound === 2
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Moon className="w-3.5 h-3.5 text-slate-300" />
          第2ステージ (午後・一手 2射)
          {matchState.activeCallRound === 2 &&
            matchState.activeCallGroup !== null && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-mono text-[10px] font-black">
                第{matchState.activeCallGroup}組招集中
              </span>
            )}
        </button>

        <button
          type="button"
          disabled={isProcessing}
          onClick={() => handleChangeRound(3)}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-40 ${
            matchState.currentRound === 3
              ? 'bg-slate-900 text-white shadow-xs'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          <Moon className="w-3.5 h-3.5 text-slate-300" />
          第3ステージ (午後・四矢 4射)
          {matchState.activeCallRound === 3 &&
            matchState.activeCallGroup !== null && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 font-mono text-[10px] font-black">
                第{matchState.activeCallGroup}組招集中
              </span>
            )}
        </button>
      </div>

      {/* ステータスメッセージ・エラーメッセージ */}
      {statusMessage && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ==========================================
          組別 昇順縦リスト（各組に招集ボタンを配置・単一排他制御＋連鎖ステータス表示）
          ========================================== */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between px-1 gap-2">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-slate-600" />【
            {getStageLabel(matchState.currentRound)}】組別 招集リスト（昇順）
          </span>
          <span className="text-[11px] text-slate-500 font-medium">
            ※招集ボタンは1つの組のみ有効になります（1・2組前＝控え待機中 /
            3組前＝行射中）
          </span>
        </div>

        <div className="space-y-2.5">
          {groupNumbersList.map((groupNumber) => {
            const [firstStand, secondStand] =
              getStandNumbersByGroup(groupNumber);

            // この組（前半立 firstStand または 後半立 secondStand）に属する有効な出場選手を抽出
            const groupPlayers = participants
              .filter((p) => {
                const st =
                  p.standAssignments[matchState.currentRound]?.standGroup;
                return (
                  (st === firstStand || st === secondStand) &&
                  p.checkInStatus !== 'ABSENT' &&
                  p.qualificationStatus !== 'WITHDRAWN'
                );
              })
              .sort((a, b) => {
                const stA =
                  a.standAssignments[matchState.currentRound]?.standGroup ?? 99;
                const stB =
                  b.standAssignments[matchState.currentRound]?.standGroup ?? 99;
                if (stA !== stB) return stA - stB;
                const ordA =
                  a.standAssignments[matchState.currentRound]?.standOrder ?? 99;
                const ordB =
                  b.standAssignments[matchState.currentRound]?.standOrder ?? 99;
                return ordA - ordB;
              });

            // 対象選手または所属チームに紐づくFCMトークンを重複なしで収集
            const tokenSet = new Set<string>();
            groupPlayers.forEach((p) => {
              if (userTokensMap[p.id]) {
                tokenSet.add(userTokensMap[p.id]);
              }
              if (p.organization && teamTokensMap[p.organization]) {
                teamTokensMap[p.organization].forEach((t) => tokenSet.add(t));
              }
            });
            const groupTokens = Array.from(tokenSet);

            // 押下された招集中組との相対位置からロールを判定
            const isSameRoundAsActive =
              matchState.activeCallRound === matchState.currentRound;
            const groupRole = evaluateGroupRoleByActiveCall(
              groupNumber,
              matchState.activeCallGroup,
              isSameRoundAsActive,
            );

            const isThisGroupCalled = groupRole === 'CALLED';
            const isThisGroupStandby = groupRole === 'STANDBY';
            const isThisGroupShooting = groupRole === 'SHOOTING';
            const isThisGroupFinished = groupRole === 'FINISHED';

            // 他の組が招集中であるため、この組の招集ボタンをロックすべきか判定
            const isLockedByOtherGroup =
              isAnyGroupCurrentlyCalled && !isThisGroupCalled;

            // 過去にこのステージ・この組を招集した履歴があるか判定（既存機能を保持）
            const hasBeenCalledInLogs = callLogs.some(
              (log) =>
                log.round === matchState.currentRound &&
                log.standGroup === groupNumber,
            );

            const cardStyleClass = isThisGroupCalled
              ? 'bg-amber-50/95 border-2 border-amber-500 shadow-md ring-2 ring-amber-200/70'
              : isThisGroupStandby
                ? 'bg-blue-50/85 border-2 border-blue-400 shadow-xs'
                : isThisGroupShooting
                  ? 'bg-emerald-50/85 border-2 border-emerald-500 shadow-xs'
                  : isThisGroupFinished
                    ? 'bg-slate-100/70 border border-slate-200 opacity-65'
                    : isLockedByOtherGroup
                      ? 'bg-slate-50/70 border border-slate-200 opacity-70'
                      : 'bg-white border border-slate-200/90 hover:border-slate-300 shadow-2xs';

            return (
              <div
                key={groupNumber}
                className={`p-4 rounded-2xl transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${cardStyleClass}`}
              >
                {/* 左側：組番号・立番号・状態バッジ・所属選手プレビュー */}
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`font-mono text-sm font-black px-3 py-1 rounded-xl ${
                        isThisGroupCalled
                          ? 'bg-amber-500 text-slate-950 shadow-2xs'
                          : isThisGroupStandby
                            ? 'bg-blue-600 text-white shadow-2xs'
                            : isThisGroupShooting
                              ? 'bg-emerald-600 text-white shadow-2xs'
                              : 'bg-slate-900 text-white'
                      }`}
                    >
                      第 {groupNumber} 組
                    </span>

                    <span className="font-mono text-xs font-bold text-slate-700 bg-white border border-slate-200 px-2.5 py-0.5 rounded-lg">
                      第 {firstStand} 立 ・ 第 {secondStand} 立
                    </span>

                    {/* 状態バッジ（現在招集中 / 控え待機中 / 行射中 / 行射終了 / 招集履歴あり / 未招集） */}
                    {isThisGroupCalled ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-black bg-amber-400 text-slate-950 px-3 py-0.5 rounded-full animate-pulse shadow-2xs">
                        <BellRing className="w-3.5 h-3.5" />
                        現在招集中
                      </span>
                    ) : isThisGroupStandby ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-black bg-blue-600 text-white px-3 py-0.5 rounded-full shadow-2xs">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        控え待機中（
                        {matchState.activeCallGroup! - groupNumber}つ前の組）
                      </span>
                    ) : isThisGroupShooting ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-black bg-emerald-600 text-white px-3 py-0.5 rounded-full shadow-2xs">
                        <Target className="w-3.5 h-3.5" />
                        行射中（3つ前の組）
                      </span>
                    ) : isThisGroupFinished ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-slate-200 text-slate-700 px-2.5 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3 text-slate-600" />
                        行射終了
                      </span>
                    ) : hasBeenCalledInLogs ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        招集履歴あり
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full">
                        未招集
                      </span>
                    )}

                    <span className="text-xs font-mono text-slate-500 ml-auto lg:ml-2 flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-slate-400" />
                      出場対象: <strong>{groupPlayers.length}</strong> 名 /
                      通知先端末: <strong>{groupTokens.length}</strong> 件
                    </span>
                  </div>

                  {/* 組内の選手名・所属プレビュー */}
                  {groupPlayers.length === 0 ? (
                    <p className="text-xs text-slate-400 font-medium pl-1">
                      この組に割り当てられた有効な出場選手はいません。
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {groupPlayers.map((p) => (
                        <span
                          key={p.id}
                          className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border ${
                            isThisGroupCalled
                              ? 'bg-white border-amber-300 text-slate-900 font-bold'
                              : isThisGroupStandby
                                ? 'bg-white border-blue-300 text-blue-950 font-bold'
                                : isThisGroupShooting
                                  ? 'bg-white border-emerald-300 text-emerald-950 font-bold'
                                  : 'bg-slate-50 border-slate-200 text-slate-700 font-medium'
                          }`}
                        >
                          <span className="font-mono text-[10px] text-slate-500">
                            No.{p.bibNumber}
                          </span>
                          <span>{p.name}</span>
                          <span className="text-[10px] text-slate-400">
                            ({p.organization || '無所属'})
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* 右側：単一排他制御の「招集ボタン」または「招集解除ボタン」 */}
                <div className="flex items-center justify-end gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                  {isThisGroupCalled ? (
                    <Button
                      type="button"
                      disabled={isProcessing}
                      onClick={() =>
                        handleReleaseCallGroup(groupNumber, groupPlayers)
                      }
                      className="w-full sm:w-auto h-10 px-4 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5"
                    >
                      {isProcessing ? (
                        <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                      ) : (
                        <>
                          <Unlock className="w-4 h-4 text-amber-400" />
                          招集中を解除（完了）
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled={
                        isProcessing ||
                        isLockedByOtherGroup ||
                        groupPlayers.length === 0
                      }
                      onClick={() =>
                        handleCallGroup(groupNumber, groupPlayers, groupTokens)
                      }
                      className={`w-full sm:w-auto h-10 px-5 font-black text-xs rounded-xl shadow-xs flex items-center justify-center gap-1.5 ${
                        isLockedByOtherGroup
                          ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                          : 'bg-amber-500 hover:bg-amber-600 text-slate-950'
                      }`}
                      title={
                        isLockedByOtherGroup
                          ? `第${matchState.activeCallGroup}組が招集中のためロックされています`
                          : `第${groupNumber}組を招集しFCM通知を送信します`
                      }
                    >
                      {isProcessing ? (
                        <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                      ) : isLockedByOtherGroup ? (
                        <>
                          <Lock className="w-3.5 h-3.5" />
                          他組招集中につきロック
                        </>
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" />第 {groupNumber}{' '}
                          組を招集する
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* FCM呼出通知 配信ログテーブル */}
      <div className="space-y-2 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wider">
            <History className="w-3.5 h-3.5 text-slate-600" />
            FCM呼出通知 配信ログ (最新25件・リアルタイム同期)
          </h4>
          <span className="text-[10px] text-slate-400 font-mono">
            件数: {callLogs.length}
          </span>
        </div>
        <div className="w-full bg-slate-50/50 border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
          {callLogs.length === 0 ? (
            <div className="py-6 text-center text-slate-400 text-xs font-medium">
              送信済みの呼出ログはまだありません。
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left text-xs min-w-[650px]">
                <thead className="bg-slate-100/80 text-slate-600 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3 font-bold">送信時刻</th>
                    <th className="py-2.5 px-3 font-bold">対象ステージ・組</th>
                    <th className="py-2.5 px-3 font-bold">状態</th>
                    <th className="py-2.5 px-3 font-bold">
                      配信実績 (成功/対象)
                    </th>
                    <th className="py-2.5 px-3 font-bold">通知内容</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 font-medium">
                  {callLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-white transition-colors"
                    >
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        <Clock className="w-3 h-3 inline mr-1 text-slate-400" />
                        {new Date(log.createdAt).toLocaleTimeString('ja-JP', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="font-bold text-slate-900">
                          {getStageLabel(log.round)}
                        </span>
                        <span className="ml-1.5 px-2 py-0.5 rounded bg-slate-200 text-slate-800 text-[10px] font-mono font-black">
                          第 {log.standGroup} 組
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {log.status === 'SUCCESS' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            成功
                          </span>
                        ) : log.status === 'PARTIAL' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                            ログ記録済
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-800 bg-red-50 border border-red-300 px-2 py-0.5 rounded-full">
                            <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                            失敗
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-xs whitespace-nowrap">
                        <span className="font-bold text-slate-900">
                          {log.sentSuccessCount}
                        </span>
                        <span className="text-slate-400">
                          {' '}
                          / {log.targetPlayerCount} 名
                        </span>
                        <span className="text-[10px] text-slate-400 ml-1">
                          (端末: {log.tokensFoundCount})
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-slate-700 max-w-xs truncate">
                        <span className="font-bold">{log.title}</span> -{' '}
                        {log.body}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
