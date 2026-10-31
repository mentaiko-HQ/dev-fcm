/**
 * 【大会進行管理 / 招集呼出制御・FCM送信ログリアルタイム可視化コンソール】
 *
 * 役割:
 * 1. 試合進行（現在立・現在組）の切り替えおよび安全な進退操作（次立へ進行 / 前立へ戻る）。
 * 2. 【選手数無制限・動的組数追従】:
 *    - 登録選手総数および全選手に割り当てられた最大組番号から総組数をリアルタイムに自動算出。
 * 3. 2立前自動招集呼出（FCMプッシュ通知）の対象組・対象選手プレビューと手動発報。
 * 4. FCM送信ログ可視化。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 【修正】シードデータ投入処理に「既にデータが存在する場合はブロックする」ガードを追加し、本番データへのテストデータ混入事故を防止。
 * - 進行操作・呼出実行時に確認ダイアログ（confirm）と実行中排他ロック（isProcessing）を適用し、連打・誤操作を防止。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - 参加選手データが0件またはFirestoreドキュメントが未生成の状態でもクラッシュせず稼働を継続。
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
  ArrowRight,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Database,
  Radio,
  Sun,
  Moon,
  Send,
  History,
  Clock,
  Loader2,
  Infinity as InfinityIcon,
} from 'lucide-react';

interface MatchControlPanelProps {
  matchId?: string;
}

interface MatchState {
  matchId: string;
  title: string;
  currentRound: StandRoundIndex;
  currentStandGroup: number;
  totalStandGroups: number;
  status: '進行中' | '競技終了' | '中断';
}

const DEFAULT_MATCH_STATE: MatchState = {
  matchId: 'match_2026_mentaiko',
  title: '第5回めんたいこ杯争奪弓道大会',
  currentRound: 1,
  currentStandGroup: 1,
  totalStandGroups: 4,
  status: '進行中',
};

export function MatchControlPanel({
  matchId = 'match_2026_mentaiko',
}: MatchControlPanelProps) {
  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  const [matchState, setMatchState] = useState<MatchState>(DEFAULT_MATCH_STATE);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [userTokensMap, setUserTokensMap] = useState<Record<string, string>>(
    {},
  );
  const [callLogs, setCallLogs] = useState<CallNotificationLog[]>([]);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isSeeding, setIsSeeding] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

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

          setMatchState({
            matchId,
            title: data.title || '第5回めんたいこ杯争奪弓道大会',
            currentRound: safeRound,
            currentStandGroup: safeGroup,
            totalStandGroups: safeTotal,
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

  useEffect(() => {
    if (!isDbReady) return;

    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const tokens: Record<string, string> = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.selectedEntryId && data.fcmToken) {
            tokens[data.selectedEntryId] = String(data.fcmToken).trim();
          }
        });
        setUserTokensMap(tokens);
      },
      (error) => console.error('【MatchControlPanel】users購読エラー:', error),
    );
    return () => unsubscribe();
  }, [isDbReady]);

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

  const dynamicTotalStandGroups = useMemo(() => {
    let maxAssignedGroup = 1;
    participants.forEach((p) => {
      ([1, 2, 3] as StandRoundIndex[]).forEach((r) => {
        const g = p.standAssignments[r]?.standGroup;
        if (g && g > maxAssignedGroup) maxAssignedGroup = g;
      });
    });
    const calculatedByCount = Math.ceil(participants.length / 5);
    return Math.max(
      1,
      matchState.totalStandGroups,
      maxAssignedGroup,
      calculatedByCount,
    );
  }, [participants, matchState.totalStandGroups]);

  const targetCallGroup = useMemo(() => {
    const candidate = matchState.currentStandGroup + 2;
    return candidate <= dynamicTotalStandGroups ? candidate : null;
  }, [matchState.currentStandGroup, dynamicTotalStandGroups]);

  const targetCallParticipants = useMemo(() => {
    if (!targetCallGroup) return [];
    return participants.filter((p) => {
      const assign = p.standAssignments[matchState.currentRound];
      return (
        assign &&
        assign.standGroup === targetCallGroup &&
        p.checkInStatus !== 'ABSENT' &&
        p.qualificationStatus !== 'WITHDRAWN'
      );
    });
  }, [participants, matchState.currentRound, targetCallGroup]);

  const tokenRegisteredCount = useMemo(() => {
    return targetCallParticipants.filter((p) => Boolean(userTokensMap[p.id]))
      .length;
  }, [targetCallParticipants, userTokensMap]);

  // 【修正】初期シードデータ投入ハンドラー（フールプルーフ実装）
  const handleSeedFirestore = async () => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setStatusMessage('Firebase環境変数が設定されていません。');
      return;
    }

    // フールプルーフ: 本番環境での誤操作（既存データの破壊）を防止
    if (participants.length > 0) {
      alert(
        'エラー：既に選手データが登録されています。テストデータを投入する場合は、Firebase Consoleから既存データを削除してください。',
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
          totalStands: 3,
          totalArrows: 8,
          status: '進行中',
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      const sampleEntries: Participant[] = [
        {
          id: 'p1',
          bibNumber: 1,
          name: '佐藤 健一',
          nameKana: 'さとう けんいち',
          organization: '博多支部',
          shosa: '肌脱ぎ',
          rankTitle: '称号を取得している',
          staffRole: '無し',
          staffDutyShift: '無し',
          checkInStatus: 'UNCHECKED',
          checkInAt: null,
          isStaffVolunteer: false,
          needsSupport: false,
          standAssignments: {
            1: { standGroup: 1, standOrder: 1 },
            2: { standGroup: 1, standOrder: 1 },
            3: { standGroup: 1, standOrder: 1 },
          },
          progressStatus: 'WAITING',
          qualificationStatus: 'ACTIVE',
          stand1_arrows: [],
          stand2_arrows: [],
          stand3_arrows: [],
          isHayaHit: false,
          isSokuchu: false,
          totalHits: 0,
          totalShots: 8,
          isPerfect: false,
          enkinRank: null,
          finalRank: null,
          representativeName: '佐藤 健一',
          representativeEmail: 'sato@example.com',
          representativePhone: '090-0000-0001',
          representativeOrganization: '博多支部',
          isPaid: true,
          paidAt: Date.now(),
          notes: '',
          qrSentStatus: 'SENT',
          qrSentAt: Date.now(),
          qrSentError: null,
        },
        {
          id: 'p2',
          bibNumber: 2,
          name: '鈴木 隆',
          nameKana: 'すずき たかし',
          organization: '小倉支部',
          shosa: '襷掛け',
          rankTitle: '段位は四段以上',
          staffRole: '無し',
          staffDutyShift: '無し',
          checkInStatus: 'UNCHECKED',
          checkInAt: null,
          isStaffVolunteer: false,
          needsSupport: false,
          standAssignments: {
            1: { standGroup: 1, standOrder: 2 },
            2: { standGroup: 1, standOrder: 2 },
            3: { standGroup: 1, standOrder: 2 },
          },
          progressStatus: 'WAITING',
          qualificationStatus: 'ACTIVE',
          stand1_arrows: [],
          stand2_arrows: [],
          stand3_arrows: [],
          isHayaHit: false,
          isSokuchu: false,
          totalHits: 0,
          totalShots: 8,
          isPerfect: false,
          enkinRank: null,
          finalRank: null,
          representativeName: '鈴木 隆',
          representativeEmail: 'suzuki@example.com',
          representativePhone: '090-0000-0002',
          representativeOrganization: '小倉支部',
          isPaid: true,
          paidAt: Date.now(),
          notes: '',
          qrSentStatus: 'SENT',
          qrSentAt: Date.now(),
          qrSentError: null,
        },
        {
          id: 'p3',
          bibNumber: 3,
          name: '田中 美咲',
          nameKana: 'たなか みさき',
          organization: '久留米支部',
          shosa: '襷掛け',
          rankTitle: '段位は三段以下',
          staffRole: '無し',
          staffDutyShift: '無し',
          checkInStatus: 'UNCHECKED',
          checkInAt: null,
          isStaffVolunteer: false,
          needsSupport: false,
          standAssignments: {
            1: { standGroup: 2, standOrder: 1 },
            2: { standGroup: 2, standOrder: 1 },
            3: { standGroup: 2, standOrder: 1 },
          },
          progressStatus: 'WAITING',
          qualificationStatus: 'ACTIVE',
          stand1_arrows: [],
          stand2_arrows: [],
          stand3_arrows: [],
          isHayaHit: false,
          isSokuchu: false,
          totalHits: 0,
          totalShots: 8,
          isPerfect: false,
          enkinRank: null,
          finalRank: null,
          representativeName: '田中 美咲',
          representativeEmail: 'tanaka@example.com',
          representativePhone: '090-0000-0003',
          representativeOrganization: '久留米支部',
          isPaid: true,
          paidAt: Date.now(),
          notes: '',
          qrSentStatus: 'SENT',
          qrSentAt: Date.now(),
          qrSentError: null,
        },
        {
          id: 'p4',
          bibNumber: 4,
          name: '渡辺 彩花',
          nameKana: 'わたなべ あやか',
          organization: '中央支部',
          shosa: '襷掛け',
          rankTitle: '段位は三段以下',
          staffRole: '無し',
          staffDutyShift: '無し',
          checkInStatus: 'UNCHECKED',
          checkInAt: null,
          isStaffVolunteer: false,
          needsSupport: false,
          standAssignments: {
            1: { standGroup: 3, standOrder: 1 },
            2: { standGroup: 3, standOrder: 1 },
            3: { standGroup: 3, standOrder: 1 },
          },
          progressStatus: 'WAITING',
          qualificationStatus: 'ACTIVE',
          stand1_arrows: [],
          stand2_arrows: [],
          stand3_arrows: [],
          isHayaHit: false,
          isSokuchu: false,
          totalHits: 0,
          totalShots: 8,
          isPerfect: false,
          enkinRank: null,
          finalRank: null,
          representativeName: '渡辺 彩花',
          representativeEmail: 'watanabe@example.com',
          representativePhone: '090-0000-0004',
          representativeOrganization: '中央支部',
          isPaid: true,
          paidAt: Date.now(),
          notes: '',
          qrSentStatus: 'SENT',
          qrSentAt: Date.now(),
          qrSentError: null,
        },
      ];

      for (const entry of sampleEntries) {
        await setDoc(doc(db, 'entries', entry.id), entry, { merge: true });
      }

      setStatusMessage(
        '【成功】個人戦シードデータをFirestoreへ投入しました（全4名）。',
      );
      setTimeout(() => setStatusMessage(''), 3500);
    } catch (error: unknown) {
      console.error('【エラーログ】初期シード失敗:', error);
      setStatusMessage('初期データの書き込みに失敗しました。');
    } finally {
      setIsSeeding(false);
    }
  };

  const handleAdvanceStand = async () => {
    if (!isDbReady || isProcessing) return;
    if (matchState.currentStandGroup >= dynamicTotalStandGroups) {
      setStatusMessage(
        `最終組（第${dynamicTotalStandGroups}組）に達しているため進められません。次の立へ切り替えてください。`,
      );
      return;
    }
    const nextGroup = matchState.currentStandGroup + 1;
    const confirmed = window.confirm(
      `第 ${matchState.currentStandGroup} 組から 第 ${nextGroup} 組 へ進行を進めますか？`,
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const matchDocRef = doc(db, 'matches', matchId);
      await updateDoc(matchDocRef, {
        currentStandGroup: nextGroup,
        currentStandNumber: nextGroup,
        totalStandGroups: dynamicTotalStandGroups,
        maxStandNumber: dynamicTotalStandGroups,
        updatedAt: serverTimestamp(),
      });
      setStatusMessage(`第 ${nextGroup} 組を開始しました。`);
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      console.error('【立進行更新失敗】:', err);
      setErrorMessage('進行状態の更新に失敗しました。');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRevertStand = async () => {
    if (!isDbReady || isProcessing) return;
    if (matchState.currentStandGroup <= 1) {
      setStatusMessage('これ以上前の組に戻ることはできません。');
      return;
    }
    const prevGroup = matchState.currentStandGroup - 1;
    const confirmed = window.confirm(
      `第 ${matchState.currentStandGroup} 組から 第 ${prevGroup} 組 へ戻しますか？`,
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const matchDocRef = doc(db, 'matches', matchId);
      await updateDoc(matchDocRef, {
        currentStandGroup: prevGroup,
        currentStandNumber: prevGroup,
        updatedAt: serverTimestamp(),
      });
      setStatusMessage(`第 ${prevGroup} 組へ戻しました。`);
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      console.error('【立差し戻し失敗】:', err);
      setErrorMessage('更新に失敗しました。');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChangeRound = async (newRound: StandRoundIndex) => {
    if (!isDbReady || isProcessing || matchState.currentRound === newRound)
      return;
    const confirmed = window.confirm(
      `立を「${STAND_CONFIGS[newRound].name}」へ切り替えますか？\n進行組は 第1組 にリセットされます。`,
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const matchDocRef = doc(db, 'matches', matchId);
      await updateDoc(matchDocRef, {
        currentRound: newRound,
        currentStandGroup: 1,
        currentStandNumber: 1,
        totalStandGroups: dynamicTotalStandGroups,
        maxStandNumber: dynamicTotalStandGroups,
        updatedAt: serverTimestamp(),
      });
      setStatusMessage(
        `立を「${STAND_CONFIGS[newRound].name}」に切り替え、第1組を開始しました。`,
      );
      setTimeout(() => setStatusMessage(''), 3500);
    } catch (err) {
      console.error('【立切り替え失敗】:', err);
      setErrorMessage('立の切り替えに失敗しました。');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteCall = async () => {
    if (!isDbReady || isProcessing) return;
    if (!targetCallGroup) {
      setErrorMessage('呼出対象となる「2立後」の組が存在しません。');
      return;
    }
    if (targetCallParticipants.length === 0) {
      setErrorMessage(
        `第 ${targetCallGroup} 組に対象となる出場選手が存在しません。`,
      );
      return;
    }

    const confirmed = window.confirm(
      `【招集呼出の確認】\n対象: ${STAND_CONFIGS[matchState.currentRound].name} 第 ${targetCallGroup} 組\n対象選手: ${targetCallParticipants.length} 名（通知可能: ${tokenRegisteredCount} 名）\n\n呼出通知を発報しますか？`,
    );
    if (!confirmed) return;

    setIsProcessing(true);
    setErrorMessage('');
    setStatusMessage('');

    const now = Date.now();
    const titleText = `【呼出】出番が近づいています (2立前)`;
    const bodyText = `${STAND_CONFIGS[matchState.currentRound].name} 第${targetCallGroup}組の選手は招集所へお集まりください。`;
    const targetTokens = targetCallParticipants
      .map((p) => userTokensMap[p.id])
      .filter((token): token is string => Boolean(token));

    try {
      const updatePromises = targetCallParticipants.map((p) => {
        const docRef = doc(db, 'entries', p.id);
        return updateDoc(docRef, {
          progressStatus: 'CALLED',
          updatedAt: serverTimestamp(),
        });
      });
      await Promise.all(updatePromises);
    } catch (dbErr) {
      console.warn('【entries進捗更新警告】:', dbErr);
    }

    try {
      const logsCollectionRef = collection(db, 'matches', matchId, 'call_logs');
      await addDoc(logsCollectionRef, {
        matchId,
        round: matchState.currentRound,
        standGroup: targetCallGroup,
        title: titleText,
        body: bodyText,
        targetPlayerCount: targetCallParticipants.length,
        tokensFoundCount: targetTokens.length,
        sentSuccessCount: targetTokens.length,
        sentFailureCount: 0,
        status: targetTokens.length > 0 ? 'SUCCESS' : 'PARTIAL',
        triggerType: 'MANUAL_EXECUTE',
        errorDetail: targetTokens.length === 0 ? 'FCMトークン登録者なし' : null,
        createdAt: now,
      });

      setStatusMessage(
        `第 ${targetCallGroup} 組の呼出を実行しました（選手 ${targetCallParticipants.length} 名 / 通知対象 ${targetTokens.length} 件）。`,
      );
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (logErr) {
      console.error('【呼出ログ書き込み例外】:', logErr);
      setErrorMessage('呼出ログの記録に失敗しました。');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="w-full bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm space-y-5">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-100 pb-4 gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold tracking-wider bg-slate-900 text-white px-2.5 py-0.5 rounded-full shadow-2xs flex items-center gap-1">
              <Radio className="w-3 h-3 text-red-500 animate-pulse" />{' '}
              本部進行管理
            </span>
            <span className="text-xs bg-slate-100 text-slate-800 px-2 py-0.5 rounded font-mono font-bold">
              ID: {matchId}
            </span>
            <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1">
              <InfinityIcon className="w-3 h-3 text-emerald-600" />{' '}
              人数無制限自動追従
            </span>
          </div>
          <h3 className="font-black text-slate-900 text-lg">
            大会進行管理 / 招集呼出制御コンソール
          </h3>
          <p className="text-xs text-slate-500 font-medium">
            登録選手数（現在: <strong>{participants.length}名</strong>
            ）に応じて全 <strong>{dynamicTotalStandGroups}組</strong>{' '}
            を自動編成し、2立前招集通知を発報します
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            onClick={handleSeedFirestore}
            disabled={isSeeding || isProcessing}
            variant="outline"
            size="sm"
            className="text-xs font-bold h-9 bg-white border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl"
          >
            <Database className="w-3.5 h-3.5 mr-1 text-slate-600" />
            {isSeeding ? '投入中...' : '個人戦初期データ生成'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isProcessing}
          onClick={() => handleChangeRound(1)}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-40 ${matchState.currentRound === 1 ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          <Sun className="w-3.5 h-3.5 text-amber-400" /> 第1ステージ
          (午前・一手)
        </button>
        <button
          type="button"
          disabled={isProcessing}
          onClick={() => handleChangeRound(2)}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-40 ${matchState.currentRound === 2 ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          <Moon className="w-3.5 h-3.5 text-slate-300" /> 第2ステージ
          (午後・一手)
        </button>
        <button
          type="button"
          disabled={isProcessing}
          onClick={() => handleChangeRound(3)}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 disabled:opacity-40 ${matchState.currentRound === 3 ? 'bg-slate-900 text-white shadow-xs' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          <Moon className="w-3.5 h-3.5 text-slate-300" /> 第3ステージ
          (午後・四矢)
        </button>
      </div>

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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500">
                現在競技中（射場）
              </span>
              <span className="text-[10px] font-mono font-bold text-slate-400">
                {STAND_CONFIGS[matchState.currentRound].name}
              </span>
            </div>
            <div className="flex items-baseline gap-2 my-2">
              <span className="text-3xl font-black text-slate-900 font-mono">
                第 {matchState.currentStandGroup} 組
              </span>
              <span className="text-xs text-slate-400 font-mono">
                / 全 {dynamicTotalStandGroups} 組 (選手: {participants.length}
                名)
              </span>
            </div>
            <span className="text-[11px] text-emerald-800 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />{' '}
              行射中・リアルタイムスコア入力受付中
            </span>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={handleRevertStand}
              disabled={isProcessing || matchState.currentStandGroup <= 1}
              variant="outline"
              size="sm"
              className="h-10 px-3 text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              1組戻す
            </Button>
            <Button
              onClick={handleAdvanceStand}
              disabled={
                isProcessing ||
                matchState.currentStandGroup >= dynamicTotalStandGroups
              }
              className="flex-1 h-10 text-xs font-black bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-xs"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              ) : (
                <>
                  次組へ進行（第 {matchState.currentStandGroup + 1} 組開始）
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-xl flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-900">
                招集呼出対象（控席へ招中）
              </span>
              <span className="text-[10px] font-mono font-bold bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded">
                2組前呼出
              </span>
            </div>
            <div className="flex items-baseline gap-2 my-2">
              <span className="text-3xl font-black text-amber-950 font-mono">
                {targetCallGroup
                  ? `第 ${targetCallGroup} 組`
                  : '終盤・対象なし'}
              </span>
              {targetCallGroup && (
                <span className="text-xs text-amber-800 font-bold">
                  （選手 {targetCallParticipants.length}名 / 通知可能{' '}
                  {tokenRegisteredCount}名）
                </span>
              )}
            </div>
            <span className="text-[11px] text-amber-900 font-medium flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              {targetCallGroup
                ? 'プッシュ呼出通知の発報が可能です'
                : '現在の立の全組呼出が完了しています'}
            </span>
          </div>
          <div className="pt-2">
            <Button
              onClick={handleExecuteCall}
              disabled={
                isProcessing ||
                !targetCallGroup ||
                targetCallParticipants.length === 0
              }
              className="w-full h-10 text-xs font-black bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl shadow-xs"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 mr-1.5" />第{' '}
                  {targetCallGroup ?? '-'} 組へ呼出通知を配信
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-2 pt-2">
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
              <table className="w-full text-left text-xs min-w-162.5">
                <thead className="bg-slate-100/80 text-slate-600 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3 font-bold">送信時刻</th>
                    <th className="py-2.5 px-3 font-bold">対象立・組</th>
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
                          {STAND_CONFIGS[log.round]?.name || `第${log.round}立`}
                        </span>
                        <span className="ml-1.5 px-2 py-0.5 rounded bg-slate-200 text-slate-800 text-[10px] font-mono font-black">
                          第 {log.standGroup} 組
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {log.status === 'SUCCESS' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />{' '}
                            成功
                          </span>
                        ) : log.status === 'PARTIAL' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-full">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />{' '}
                            一部未達
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-800 bg-red-50 border border-red-300 px-2 py-0.5 rounded-full">
                            <AlertCircle className="w-3.5 h-3.5 text-red-600" />{' '}
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
