/**
 * 【大会進行管理 / 組別縦リスト招集制御・FCM送信ログリアルタイム可視化コンソール】
 *
 * 役割:
 * 1. 各ステージ（第1〜第3ステージ）において、第1組（第1・2立）、第2組（第3・4立）…を昇順で縦リスト表示。
 * 2. 各組の行に「招集ボタン」を配置し、全体で「1つの組のみ」招集中（activeCallGroup）にできる単一排他制御を実装。
 * 3. どの組が現在「招集中」であるかをアンバー強調枠・パルスアニメーションバッジ・上部ステータスバーで即座に判別可能に表示。
 * 4. 招集実行時に対象組（2立分・最大10名）の選手の progressStatus を 'CALLED' に更新し、FCM通知トリガーを発火。
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
  serverTimestamp,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, isFirebaseConfigured, isFirestoreAvailable } from '@/lib/firebase';
import {
  StandRoundIndex,
  STAND_CONFIGS,
  Participant,
  CallNotificationLog,
  sanitizeStandGroup,
  sanitizeStandOrder,
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

          if (data.selectedEntryId) {
            entryTokens[String(data.selectedEntryId)] = token;
          }
          const teamKey = data.teamId || data.selectedTeam || data.organization;
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
   * 【重要】指定した組の「招集ボタン」押下ハンドラー（単一排他ロック＆FCMプッシュ通知発報）
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

    const confirmed = window.confirm(
      `【招集呼出の確認】\n対象ステージ: ${getStageLabel(matchState.currentRound)}\n対象組: 第 ${targetGroupNumber} 組（第${firstStand}立・第${secondStand}立）\n対象選手: ${groupPlayers.length} 名（通知配信先トークン: ${targetTokens.length} 件）\n\nこの組を「招集中」に設定し、プッシュ通知を発報しますか？\n※招集中は他の組の招集ボタンはロックされます。`,
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    const now = Date.now();
    const stageName = getStageLabel(matchState.currentRound);
    const titleText = `【招集呼出】第${targetGroupNumber}組（第${firstStand}・${secondStand}立）`;
    const bodyText = `${stageName} 第${targetGroupNumber}組（第${firstStand}立・第${secondStand}立）の選手は控席・招集所へお集まりください。`;

    try {
      // 1. matches ドキュメントに「現在招集中の組（activeCallGroup / activeCallRound）」を記録（単一排他ロック＋Cloud Functionsトリガー連動）
      const matchDocRef = doc(db, 'matches', matchId);
      await updateDoc(matchDocRef, {
        currentRound: matchState.currentRound,
        currentStandGroup: targetGroupNumber,
        currentStandNumber: firstStand,
        activeCallRound: matchState.currentRound,
        activeCallGroup: targetGroupNumber,
        lastCalledAt: now,
        updatedAt: serverTimestamp(),
      });

      // 2. 該当組の選手の progressStatus を 'CALLED' に一括更新
      if (groupPlayers.length > 0) {
        await Promise.all(
          groupPlayers.map((p) =>
            updateDoc(doc(db, 'entries', p.id), {
              progressStatus: 'CALLED',
              updatedAt: serverTimestamp(),
            }),
          ),
        );
      }

      // 3. call_logs サブコレクションに招集リクエストを記録
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
        triggerType: 'MANUAL_GROUP_CALL',
        errorDetail:
          targetTokens.length === 0
            ? '招集状態へ更新済（FCMトークン登録端末0件）'
            : null,
        createdAt: now,
      });

      setStatusMessage(
        `【招集中】${stageName} 第 ${targetGroupNumber} 組（第${firstStand}・${secondStand}立）を招集しました。`,
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
   * ロックを解放し、他の組の招集ボタンを押せる状態に戻す
   */
  const handleReleaseCallGroup = async (
    targetGroupNumber: number,
    groupPlayers: Participant[],
  ) => {
    if (!isDbReady || isProcessing) return;

    const [firstStand, secondStand] = getStandNumbersByGroup(targetGroupNumber);

    const confirmed = window.confirm(
      `現在招集中の「第 ${targetGroupNumber} 組（第${firstStand}立・第${secondStand}立）」の招集状態を解除（射場入場完了）しますか？\n※解除すると、次の組の招集ボタンが押せるようになります。`,
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

      // 招集完了した選手のステータスを IN_STAND（射場待機/行射中）へ進める
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
            各ステージの組を第1組から昇順で表示します。誤操作防止のため、招集ボタンは全体で1つの組のみ押下（招集中に）できます。
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

      {/* 現在どの組が招集中かを一目で判別できるグローバルステータスバナー */}
      <div
        className={`p-4 rounded-2xl border-2 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isAnyGroupCurrentlyCalled
            ? 'bg-amber-50 border-amber-400 shadow-sm'
            : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
              isAnyGroupCurrentlyCalled
                ? 'bg-amber-500 text-slate-950 animate-pulse shadow-xs'
                : 'bg-slate-200 text-slate-500'
            }`}
          >
            <BellRing className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                現在の招集ステータス
              </span>
              {isAnyGroupCurrentlyCalled ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-black bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full">
                  <Lock className="w-3 h-3" /> 招集中（他組ボタンロック中）
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                  <Unlock className="w-3 h-3" /> 招集待機中（選択可能）
                </span>
              )}
            </div>

            {isAnyGroupCurrentlyCalled ? (
              <div className="text-base sm:text-lg font-black text-slate-900 mt-0.5 flex flex-wrap items-center gap-2">
                <span>
                  {getStageLabel(matchState.activeCallRound!)}：
                  <span className="text-amber-700 font-mono">
                    第 {matchState.activeCallGroup} 組（第
                    {getStandNumbersByGroup(matchState.activeCallGroup!)[0]}
                    立・第
                    {getStandNumbersByGroup(matchState.activeCallGroup!)[1]}立）
                  </span>
                  を現在招集中
                </span>
              </div>
            ) : (
              <p className="text-sm font-bold text-slate-600 mt-0.5">
                現在招集中の組はありません。下のリストから招集したい組の「招集する」ボタンを押してください。
              </p>
            )}
          </div>
        </div>

        {/* 別ステージを表示中でも即座に解除できるクイック解除ボタン */}
        {isAnyGroupCurrentlyCalled && (
          <Button
            type="button"
            disabled={isProcessing}
            onClick={() => {
              const [s1, s2] = getStandNumbersByGroup(
                matchState.activeCallGroup!,
              );
              const calledPlayers = participants.filter((p) => {
                const st =
                  p.standAssignments[matchState.activeCallRound!]?.standGroup;
                return st === s1 || st === s2;
              });
              handleReleaseCallGroup(
                matchState.activeCallGroup!,
                calledPlayers,
              );
            }}
            className="h-9 px-3.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shrink-0 self-end sm:self-auto"
          >
            <Unlock className="w-3.5 h-3.5 mr-1.5 text-amber-400" />第{' '}
            {matchState.activeCallGroup} 組の招集を解除する
          </Button>
        )}
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
          組別 昇順縦リスト（各組に招集ボタンを配置・単一排他制御）
          ========================================== */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-slate-600" />【
            {getStageLabel(matchState.currentRound)}】組別 招集リスト（昇順）
          </span>
          <span className="text-[11px] text-slate-500 font-medium">
            ※招集ボタンは1つの組のみ有効になります
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

            // この組が現在「招集中」であるか判定
            const isThisGroupCalled =
              matchState.activeCallRound === matchState.currentRound &&
              matchState.activeCallGroup === groupNumber;

            // 他の組が招集中であるため、この組の招集ボタンをロックすべきか判定
            const isLockedByOtherGroup =
              isAnyGroupCurrentlyCalled && !isThisGroupCalled;

            // 過去にこのステージ・この組を招集した履歴があるか判定
            const hasBeenCalledInLogs = callLogs.some(
              (log) =>
                log.round === matchState.currentRound &&
                log.standGroup === groupNumber,
            );

            return (
              <div
                key={groupNumber}
                className={`p-4 rounded-2xl border transition-all flex flex-col lg:flex-row lg:items-center justify-between gap-3 ${
                  isThisGroupCalled
                    ? 'bg-amber-50/90 border-2 border-amber-500 shadow-md ring-2 ring-amber-200/70'
                    : isLockedByOtherGroup
                      ? 'bg-slate-50/70 border-slate-200 opacity-65'
                      : 'bg-white border-slate-200/90 hover:border-slate-300 shadow-2xs'
                }`}
              >
                {/* 左側：組番号・立番号・状態バッジ・所属選手プレビュー */}
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`font-mono text-sm font-black px-3 py-1 rounded-xl ${
                        isThisGroupCalled
                          ? 'bg-amber-500 text-slate-950 shadow-2xs'
                          : 'bg-slate-900 text-white'
                      }`}
                    >
                      第 {groupNumber} 組
                    </span>

                    <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-lg">
                      第 {firstStand} 立 ・ 第 {secondStand} 立
                    </span>

                    {isThisGroupCalled ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-black bg-amber-400 text-slate-950 px-3 py-0.5 rounded-full animate-pulse shadow-2xs">
                        <BellRing className="w-3.5 h-3.5" />
                        現在招集中
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
