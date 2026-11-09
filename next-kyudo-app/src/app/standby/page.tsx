/**
 * 【選手用 招集通知登録・待機状況リアルタイム確認ページ（招集解除時の進行表記完全消去対応版）】
 * /standby パスに対応するページコンポーネント。
 *
 * 主要機能要件1 ＆ 要件3 の完全実装:
 * 1. 参加選手が自分の所属支部（チーム）や氏名で絞り込み、自分自身の選手データを選択して登録可能。
 * 2. 登録時に FCM トークンを取得し、Firestore の `users/{uid}` ドキュメントへ
 *    `selectedEntryId`, `teamId`, `organization`, `standAssignments`, `fcmToken` を一括保存。
 *    （Cloud Functions の 3つの抽出経路すべてに100%合致するデータ構造で保存）。
 * 3. ユーザーが明示的に「選手を変更する」ボタンを押さない限り、リロードや再アクセス時も紐付けを維持し、
 *    バックグラウンドで FCM トークン文字列のみを自動上書き更新。
 * 4. 本部の「招集ボタン」押下と連動し、選択した選手が現在「招集中」「控え待機中」「行射中」「未招集」の
 *    どれに該当するかを専用ステータスカードと全体バナーでリアルタイム表示。
 * 5. 本部で「招集解除」が実行された際（activeCallGroup === null）は、
 *    「行射中」「控え待機中」「招集中」の表記と色枠線を即座に消去し、待機表示へ戻す。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 選手登録完了後は選択フォームをロックし、ポケット内での誤タップによる選手変更事故を防止。
 * - 「選手を変更する」押下時は確認ダイアログ（window.confirm）を表示し、意図しない紐付けリセットを遮断。
 * - ensureAnonymousAuth の戻り値が string (UID直接返却) でも オブジェクト ({ uid: string }) でも安全に解決する型ガードを実装。
 * - activeCallGroup が null（招集解除中）のときは、古い progressStatus による進行表記の残留を防止。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - iOSのブラウザ制限や通知拒否設定により FCM トークンが取得できない端末でも、選手登録自体は正常に完了させ、
 *   Firestore `onSnapshot` による画面内リアルタイム招集アラートで確実に呼び出しを通知。
 */

'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  FirestoreError,
} from 'firebase/firestore';
import {
  db,
  isFirebaseConfigured,
  isFirestoreAvailable,
  ensureAnonymousAuth,
} from '@/lib/firebase';
import { requestFcmTokenSafely, subscribeForegroundMessages } from '@/lib/fcm';
import {
  Participant,
  StandRoundIndex,
  StandOrderIndex,
  STAND_CONFIGS,
  calculateGroupFromStand,
  sanitizeStandGroup,
  sanitizeStandOrder,
  sanitizeProgressStatus,
} from '@/types';
import { LiveCallStatusBanner } from '@/components/shared/LiveCallStatusBanner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BellRing,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Search,
  UserCheck,
  Target,
  ShieldAlert,
  Clock,
  ArrowLeft,
  Sparkles,
  Smartphone,
  Volume2,
  Loader2,
  Users,
} from 'lucide-react';

const DEFAULT_MATCH_ID = 'match_2026_mentaiko';
const STORAGE_KEY_ENTRY_ID = 'kyudo_selected_entry_id_v5';
const STORAGE_KEY_DEVICE_UID = 'kyudo_fallback_device_uid_v5';

interface MatchLiveProgress {
  currentRound: StandRoundIndex;
  currentStandGroup: number;
  activeCallRound: StandRoundIndex | null;
  activeCallGroup: number | null;
}

/**
 * 射位（1〜5番）の表示ラベルを取得する
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
 * 端末固有のドキュメントIDを取得する
 * ensureAnonymousAuth() が string (UID文字列) を返す仕様と User オブジェクトを返す仕様の双方に完全対応し、
 * 取得不可時は localStorage の UUID へ安全にフォールバックする。
 */
async function resolveDeviceUserId(): Promise<string> {
  const authResult: unknown = await ensureAnonymousAuth().catch(() => null);

  if (typeof authResult === 'string' && authResult.trim().length > 0) {
    return authResult.trim();
  }

  if (
    typeof authResult === 'object' &&
    authResult !== null &&
    'uid' in authResult
  ) {
    const uidVal = (authResult as { uid?: unknown }).uid;
    if (typeof uidVal === 'string' && uidVal.trim().length > 0) {
      return uidVal.trim();
    }
  }

  if (typeof window !== 'undefined') {
    const existing = window.localStorage.getItem(STORAGE_KEY_DEVICE_UID);
    if (existing) return existing;
    const generated = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(STORAGE_KEY_DEVICE_UID, generated);
    return generated;
  }

  return `dev_temp_${Date.now()}`;
}

export default function StandbyPage() {
  const router = useRouter();
  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  // 1. 選手データ・大会進行データステート
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(() => isDbReady);
  const [matchProgress, setMatchProgress] = useState<MatchLiveProgress>({
    currentRound: 1,
    currentStandGroup: 1,
    activeCallRound: null,
    activeCallGroup: null,
  });

  // 2. ユーザーの選択・登録ステート（localStorageから初期復元）
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null);
  const [candidateEntryId, setCandidateEntryId] = useState<string>('');
  const [selectedOrgFilter, setSelectedOrgFilter] = useState<string>('ALL');
  const [searchKeyword, setSearchKeyword] = useState<string>('');
  const [isSelectingMode, setIsSelectingMode] = useState<boolean>(true);

  // 3. FCMトークン・通信状態ステート
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(() =>
    !isDbReady ? 'Firebaseデータベースに接続されていません。' : null,
  );

  // 4. フォアグラウンド通知受信時のポップアップバナー
  const [foregroundAlert, setForegroundAlert] = useState<{
    title: string;
    body: string;
    receivedAt: string;
  } | null>(null);

  // 初回マウント時に localStorage から保存済みの選手IDを復元（要件1: リロードしても紐付けを維持）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedId = window.localStorage.getItem(STORAGE_KEY_ENTRY_ID);
    if (storedId && storedId.trim() !== '') {
      setSavedEntryId(storedId.trim());
      setCandidateEntryId(storedId.trim());
      setIsSelectingMode(false);
    }
  }, []);

  // Firestore `matches/match_2026_mentaiko` のリアルタイム購読
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
        const safeCurrentGroup =
          typeof data.currentStandGroup === 'number' &&
          data.currentStandGroup > 0
            ? data.currentStandGroup
            : 1;

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

        // 招集解除された場合はフォアグラウンド通知アラートもクリア
        if (safeActiveGroup === null) {
          setForegroundAlert(null);
        }

        setMatchProgress({
          currentRound: safeCurrentRound,
          currentStandGroup: safeCurrentGroup,
          activeCallRound: safeActiveRound,
          activeCallGroup: safeActiveGroup,
        });
      },
      (err: FirestoreError) => {
        console.error('【StandbyPage】matches購読エラー:', err);
      },
    );

    return () => unsubscribe();
  }, [isDbReady]);

  // Firestore `entries` コレクションのリアルタイム購読
  useEffect(() => {
    if (!isDbReady) return;

    const q = query(collection(db, 'entries'), orderBy('bibNumber', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list: Participant[] = [];
        snap.forEach((docSnap) => {
          const raw = docSnap.data();
          const rawAssign = raw.standAssignments || {};
          const pmGroup = sanitizeStandGroup(
            rawAssign[2]?.standGroup ?? rawAssign[3]?.standGroup ?? null,
          );
          const pmOrder = sanitizeStandOrder(
            rawAssign[2]?.standOrder ?? rawAssign[3]?.standOrder ?? null,
          );

          list.push({
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
                  rawAssign[1]?.standGroup ?? null,
                ),
                standOrder: sanitizeStandOrder(
                  rawAssign[1]?.standOrder ?? null,
                ),
              },
              2: { standGroup: pmGroup, standOrder: pmOrder },
              3: { standGroup: pmGroup, standOrder: pmOrder },
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
            totalHits: Number(raw.totalHits) || 0,
            totalShots: Number(raw.totalShots) || 8,
            isPerfect: Boolean(raw.isPerfect),
            enkinRank: typeof raw.enkinRank === 'number' ? raw.enkinRank : null,
            finalRank: typeof raw.finalRank === 'number' ? raw.finalRank : null,
            representativeName: raw.representativeName || '',
            representativeEmail: raw.representativeEmail || '',
            representativePhone: raw.representativePhone || '',
            representativeOrganization: raw.representativeOrganization || '',
            isPaid: Boolean(raw.isPaid),
            paidAt: typeof raw.paidAt === 'number' ? raw.paidAt : null,
            notes: raw.notes || '',
            qrSentStatus: raw.qrSentStatus || 'UNSENT',
            qrSentAt: typeof raw.qrSentAt === 'number' ? raw.qrSentAt : null,
            qrSentError: raw.qrSentError || null,
          });
        });

        setParticipants(list);
        setIsLoading(false);
      },
      (err: FirestoreError) => {
        console.error('【StandbyPage】entries購読エラー:', err);
        setErrorMessage('選手一覧データの取得に失敗しました。');
        setIsLoading(false);
      },
    );

    return () => unsubscribe();
  }, [isDbReady]);

  // フォアグラウンドでのFCMプッシュ通知受信監視
  useEffect(() => {
    let unsubscribeFn: (() => void) | null = null;
    subscribeForegroundMessages((payload) => {
      const title =
        payload.notification?.title ||
        payload.data?.title ||
        '【招集呼出】出番のお知らせ';
      const body =
        payload.notification?.body ||
        payload.data?.body ||
        'あなたの組の招集が開始されました。招集所へお集まりください。';

      setForegroundAlert({
        title,
        body,
        receivedAt: new Date().toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      });

      // 対応端末ではバイブレーションを実行
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([300, 150, 300, 150, 300]);
        } catch {
          // 無視
        }
      }
    }).then((unsub) => {
      unsubscribeFn = unsub;
    });

    return () => {
      if (unsubscribeFn) unsubscribeFn();
    };
  }, []);

  // 現在保存されている選手オブジェクト
  const registeredPlayer = useMemo(() => {
    if (!savedEntryId) return null;
    return participants.find((p) => p.id === savedEntryId) || null;
  }, [participants, savedEntryId]);

  /**
   * 【要件1: 自動トークン上書き処理】
   * 既に選手が選択・保存されている状態でページを開いた際、
   * 通知が許可されていれば既存の選手紐付けを壊さずに fcmToken と最新の立順のみを自動同期する
   */
  useEffect(() => {
    if (!isDbReady || !registeredPlayer) return;
    if (
      typeof window === 'undefined' ||
      !('Notification' in window) ||
      Notification.permission !== 'granted'
    ) {
      return;
    }

    let isCancelled = false;
    (async () => {
      try {
        const tokenRes = await requestFcmTokenSafely();
        if (isCancelled || !tokenRes.token) return;

        setFcmToken(tokenRes.token);

        const uid = await resolveDeviceUserId();
        await setDoc(
          doc(db, 'users', uid),
          {
            userId: uid,
            selectedEntryId: registeredPlayer.id,
            participantId: registeredPlayer.id,
            bibNumber: registeredPlayer.bibNumber,
            playerName: registeredPlayer.name,
            organization: registeredPlayer.organization,
            teamId: registeredPlayer.organization,
            teamName: registeredPlayer.organization,
            standAssignments: registeredPlayer.standAssignments,
            fcmToken: tokenRes.token,
            updatedAt: Date.now(),
            serverUpdatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } catch (err) {
        console.warn('【FCMトークン自動更新警告】:', err);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [isDbReady, registeredPlayer]);

  // 所属支部（チーム）の一覧リスト
  const organizationList = useMemo(() => {
    const orgSet = new Set<string>();
    participants.forEach((p) => {
      if (
        p.checkInStatus !== 'ABSENT' &&
        p.qualificationStatus !== 'WITHDRAWN'
      ) {
        if (p.organization && p.organization.trim() !== '') {
          orgSet.add(p.organization.trim());
        }
      }
    });
    return Array.from(orgSet).sort((a, b) => a.localeCompare(b, 'ja'));
  }, [participants]);

  // 絞り込み後の選択候補選手リスト
  const filteredCandidatePlayers = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return participants.filter((p) => {
      if (
        p.checkInStatus === 'ABSENT' ||
        p.qualificationStatus === 'WITHDRAWN'
      ) {
        return false;
      }
      if (
        selectedOrgFilter !== 'ALL' &&
        (p.organization || '無所属') !== selectedOrgFilter
      ) {
        return false;
      }
      if (!keyword) return true;
      return (
        p.name.toLowerCase().includes(keyword) ||
        p.nameKana.toLowerCase().includes(keyword) ||
        p.organization.toLowerCase().includes(keyword) ||
        p.bibNumber.toString().includes(keyword)
      );
    });
  }, [participants, selectedOrgFilter, searchKeyword]);

  /**
   * 選手を選択して招集通知（FCM）と端末紐付けを保存するメインハンドラー
   */
  const handleRegisterPlayerAndFcm = useCallback(async () => {
    if (!isDbReady || isRegistering) return;

    const targetPlayer = participants.find((p) => p.id === candidateEntryId);
    if (!targetPlayer) {
      setErrorMessage('登録するあなたの選手名を選択してください。');
      return;
    }

    setIsRegistering(true);
    setErrorMessage(null);
    setWarningMessage(null);
    setStatusMessage(null);

    try {
      // 1. 端末のユーザーID（匿名Auth UID）を取得
      const uid = await resolveDeviceUserId();

      // 2. FCMトークンの取得を試行（通知許可ダイアログを表示）
      const tokenResult = await requestFcmTokenSafely();
      setFcmToken(tokenResult.token);

      // 3. Firestore `users/{uid}` ドキュメントへ選手紐付け情報とトークンを保存
      // ※Cloud Functions (onMatchProgressUpdated) の経路1・経路2・経路3すべてに対応するフィールドを保存
      const userDocData: Record<string, unknown> = {
        userId: uid,
        selectedEntryId: targetPlayer.id,
        participantId: targetPlayer.id,
        bibNumber: targetPlayer.bibNumber,
        playerName: targetPlayer.name,
        organization: targetPlayer.organization || '無所属',
        teamId: targetPlayer.organization || '無所属',
        teamName: targetPlayer.organization || '無所属',
        standAssignments: targetPlayer.standAssignments,
        updatedAt: Date.now(),
        serverUpdatedAt: serverTimestamp(),
      };

      if (tokenResult.token) {
        userDocData.fcmToken = tokenResult.token;
      }

      await setDoc(doc(db, 'users', uid), userDocData, { merge: true });

      // 4. localStorage に保存し、リロード時も選択状態をロック維持
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY_ENTRY_ID, targetPlayer.id);
      }

      setSavedEntryId(targetPlayer.id);
      setIsSelectingMode(false);

      if (tokenResult.token) {
        setStatusMessage(
          `「No.${targetPlayer.bibNumber} ${targetPlayer.name}」選手として招集プッシュ通知の登録が完了しました。`,
        );
      } else {
        setStatusMessage(
          `「No.${targetPlayer.bibNumber} ${targetPlayer.name}」選手をこの端末に設定しました。`,
        );
        if (tokenResult.errorMessage) {
          setWarningMessage(tokenResult.errorMessage);
        }
      }
    } catch (err: unknown) {
      console.error('【選手・FCM登録エラー】:', err);
      setErrorMessage(
        '登録処理中にエラーが発生しました。通信環境を確認して再度お試しください。',
      );
    } finally {
      setIsRegistering(false);
    }
  }, [isDbReady, isRegistering, participants, candidateEntryId]);

  /**
   * 登録済み選手の変更（再選択）モードへ切り替えるハンドラー（フールプルーフ確認付き）
   */
  const handleUnlockReselect = () => {
    const confirmed = window.confirm(
      '現在登録されている選手の設定を変更し、別の選手を選択し直しますか？',
    );
    if (!confirmed) return;
    setIsSelectingMode(true);
    setStatusMessage(null);
  };

  /**
   * 【招集解除時の進行表記完全消去ロジック】
   * 登録されている選手が、現在のステージにおいてどの状態にあるかを判定。
   * 本部で「招集解除」が押され activeCallGroup === null になった場合は、
   * entries 側の古い progressStatus を参照せず、CALLED / STANDBY / SHOOTING の表記を即座に消去する。
   */
  const myLiveStatusInfo = useMemo(() => {
    if (!registeredPlayer) return null;

    const activeRound =
      matchProgress.activeCallRound ?? matchProgress.currentRound;
    const myStand =
      registeredPlayer.standAssignments[activeRound]?.standGroup ?? null;
    const myOrder =
      registeredPlayer.standAssignments[activeRound]?.standOrder ?? null;
    const myGroup = myStand ? calculateGroupFromStand(myStand) : null;

    // 午前（第1ステージ）と午後（第2・第3ステージ）の組・立・射位
    const amStand = registeredPlayer.standAssignments[1]?.standGroup ?? null;
    const amOrder = registeredPlayer.standAssignments[1]?.standOrder ?? null;
    const amGroup = amStand ? calculateGroupFromStand(amStand) : null;

    const pmStand = registeredPlayer.standAssignments[2]?.standGroup ?? null;
    const pmOrder = registeredPlayer.standAssignments[2]?.standOrder ?? null;
    const pmGroup = pmStand ? calculateGroupFromStand(pmStand) : null;

    let role: 'CALLED' | 'STANDBY' | 'SHOOTING' | 'FINISHED' | 'WAITING' =
      'WAITING';

    // 招集ボタンが有効（activeCallGroup !== null）な場合のみ、招集中・控え待機中・行射中を判定
    if (
      matchProgress.activeCallGroup !== null &&
      matchProgress.activeCallGroup > 0 &&
      myGroup !== null &&
      matchProgress.activeCallRound === activeRound
    ) {
      const diff = matchProgress.activeCallGroup - myGroup;
      if (diff === 0) role = 'CALLED';
      else if (diff === 1 || diff === 2) role = 'STANDBY';
      else if (diff === 3) role = 'SHOOTING';
      else if (diff >= 4) role = 'FINISHED';
      else role = 'WAITING';
    } else if (
      registeredPlayer.progressStatus === 'FINISHED' ||
      registeredPlayer.progressStatus === 'COMPLETED'
    ) {
      role = 'FINISHED';
    } else {
      // 招集解除時（activeCallGroup === null）は必ず WAITING に戻し、行射中・控え待機中・招集中の表記を消去
      role = 'WAITING';
    }

    return {
      activeRound,
      myGroup,
      myStand,
      myOrder,
      amGroup,
      amStand,
      amOrder,
      pmGroup,
      pmStand,
      pmOrder,
      role,
    };
  }, [registeredPlayer, matchProgress]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-8 text-slate-500 w-full">
        <Loader2 className="w-8 h-8 animate-spin mb-2 text-slate-900" />
        <span className="text-xs font-mono font-bold">
          招集・進行確認コンソールを読み込み中...
        </span>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 p-4 sm:p-6 lg:p-8 space-y-5 max-w-3xl mx-auto w-full">
      {/* 上部ナビゲーションヘッダー */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold bg-slate-900 text-white px-2.5 py-1 rounded-full flex items-center gap-1 shadow-2xs">
            <BellRing className="w-3 h-3 text-amber-400" />
            選手用 招集通知・待機確認
          </span>
          {fcmToken ? (
            <span className="text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
              Push通知有効
            </span>
          ) : (
            <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
              画面内リアルタイム連動中
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push('/results')}
            className="h-8 px-3 text-xs font-bold bg-white border-slate-200 text-slate-800 hover:bg-slate-50 rounded-xl"
          >
            <Target className="w-3.5 h-3.5 mr-1 text-amber-500" />
            成績速報へ
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push('/')}
            className="h-8 px-3 text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            トップへ
          </Button>
        </div>
      </div>

      {/* フォアグラウンドでプッシュ通知を受信した際の最優先アラートバナー */}
      {foregroundAlert && (
        <div className="w-full p-4 bg-amber-400 border-2 border-slate-950 rounded-2xl text-slate-950 shadow-lg space-y-1.5 animate-bounce">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-black bg-slate-950 text-amber-400 px-2.5 py-0.5 rounded-full">
              <Volume2 className="w-3.5 h-3.5" />
              プッシュ通知受信 ({foregroundAlert.receivedAt})
            </span>
            <button
              type="button"
              onClick={() => setForegroundAlert(null)}
              className="text-xs font-black underline"
            >
              閉じる
            </button>
          </div>
          <p className="text-base font-black">{foregroundAlert.title}</p>
          <p className="text-xs font-bold">{foregroundAlert.body}</p>
        </div>
      )}

      {/* ステータスメッセージ・警告・エラー表示 */}
      {statusMessage && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-2xl text-emerald-950 text-xs font-bold flex items-center gap-2 shadow-2xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}
      {warningMessage && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl text-amber-950 text-xs font-bold flex items-start gap-2 shadow-2xs">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>{warningMessage}</span>
        </div>
      )}
      {errorMessage && (
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-xs font-bold flex items-center gap-2 shadow-2xs">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ==========================================
          セクション1: あなたの専用ステータスカード（選手登録済みの場合に表示）
          ========================================== */}
      {registeredPlayer && myLiveStatusInfo && !isSelectingMode && (
        <Card
          className={`w-full rounded-2xl overflow-hidden transition-all border-2 ${
            myLiveStatusInfo.role === 'CALLED'
              ? 'border-amber-500 bg-amber-50/90 shadow-md ring-2 ring-amber-300'
              : myLiveStatusInfo.role === 'STANDBY'
                ? 'border-blue-500 bg-blue-50/80 shadow-sm'
                : myLiveStatusInfo.role === 'SHOOTING'
                  ? 'border-emerald-500 bg-emerald-50/80 shadow-sm'
                  : 'border-slate-200 bg-white shadow-sm'
          }`}
        >
          <CardHeader className="p-4 sm:p-5 border-b border-slate-200/60 bg-white/80">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black bg-slate-900 text-white px-2.5 py-0.5 rounded-full flex items-center gap-1">
                  <Smartphone className="w-3 h-3 text-amber-400" />
                  登録中のあなたの選手情報
                </span>
                <span className="font-mono text-xs font-black text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                  No.{registeredPlayer.bibNumber}
                </span>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleUnlockReselect}
                className="h-7 px-2.5 text-[11px] font-bold bg-white border-slate-300 text-slate-700 hover:bg-slate-100 rounded-lg"
              >
                選手を変更する
              </Button>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
              <div>
                <CardTitle className="text-xl font-black text-slate-900">
                  {registeredPlayer.name} 選手
                </CardTitle>
                <p className="text-xs font-bold text-slate-600 mt-0.5">
                  所属: {registeredPlayer.organization || '無所属'} / 所作:{' '}
                  {registeredPlayer.shosa}
                </p>
              </div>

              {/* 現在のあなたの進行状態ビッグバッジ（招集解除時は CALLED / STANDBY / SHOOTING が消去される） */}
              <div className="shrink-0">
                {myLiveStatusInfo.role === 'CALLED' && (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-400 text-slate-950 font-black text-xs sm:text-sm animate-pulse shadow-xs">
                    <BellRing className="w-4 h-4" />
                    現在 招集中（招集所へ移動してください）
                  </span>
                )}
                {myLiveStatusInfo.role === 'STANDBY' && (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 text-white font-black text-xs sm:text-sm shadow-xs">
                    <ShieldAlert className="w-4 h-4" />
                    控え待機中（第一・第二控）
                  </span>
                )}
                {myLiveStatusInfo.role === 'SHOOTING' && (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 text-white font-black text-xs sm:text-sm shadow-xs">
                    <Target className="w-4 h-4" />
                    現在 行射中（射場）
                  </span>
                )}
                {myLiveStatusInfo.role === 'FINISHED' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-200 text-slate-700 font-bold text-xs">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    現ステージ行射終了
                  </span>
                )}
                {myLiveStatusInfo.role === 'WAITING' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-100 text-slate-600 font-bold text-xs border border-slate-200">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    招集前（出番までお待ちください）
                  </span>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-4 sm:p-5 space-y-3 bg-white/60">
            {/* 午前・午後のあなたの組・立・射位カード */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="p-3 rounded-xl bg-white border border-slate-200/90 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 block">
                    午前（第1ステージ・一手2射）
                  </span>
                  <span className="font-mono text-sm font-black text-slate-900">
                    {myLiveStatusInfo.amGroup && myLiveStatusInfo.amStand
                      ? `第 ${myLiveStatusInfo.amGroup} 組 ・ 第 ${myLiveStatusInfo.amStand} 立`
                      : '立順未定'}
                  </span>
                </div>
                <span className="font-mono text-xs font-black text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                  {getStandOrderLabel(myLiveStatusInfo.amOrder)}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-white border border-slate-200/90 flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 block">
                    午後（第2ステージ一手 / 第3ステージ四矢）
                  </span>
                  <span className="font-mono text-sm font-black text-slate-900">
                    {myLiveStatusInfo.pmGroup && myLiveStatusInfo.pmStand
                      ? `第 ${myLiveStatusInfo.pmGroup} 組 ・ 第 ${myLiveStatusInfo.pmStand} 立`
                      : '立順未定'}
                  </span>
                </div>
                <span className="font-mono text-xs font-black text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                  {getStandOrderLabel(myLiveStatusInfo.pmOrder)}
                </span>
              </div>
            </div>

            {/* 通知許可が未設定またはブロックされている場合の再取得ボタン */}
            {!fcmToken && (
              <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-700">
                  プッシュ通知（音声・バイブ）を有効化すると、画面を閉じていても招集通知が届きます。
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={isRegistering}
                  onClick={handleRegisterPlayerAndFcm}
                  className="h-8 px-3 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg shrink-0"
                >
                  <BellRing className="w-3.5 h-3.5 mr-1 text-amber-400" />
                  通知許可を再試行する
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ==========================================
          セクション2: 選手選択 ＆ FCMプッシュ通知登録フォーム（未登録時または変更モード時に表示）
          ========================================== */}
      {(isSelectingMode || !registeredPlayer) && (
        <Card className="w-full border border-slate-200/90 rounded-2xl shadow-sm bg-white overflow-hidden">
          <CardHeader className="p-4 sm:p-5 bg-slate-900 text-white space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black bg-amber-400 text-slate-950 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                STEP 1: あなたの選手名を選択
              </span>
              {registeredPlayer && (
                <button
                  type="button"
                  onClick={() => setIsSelectingMode(false)}
                  className="text-xs font-bold text-slate-300 hover:text-white underline"
                >
                  変更をキャンセル
                </button>
              )}
            </div>
            <CardTitle className="text-base sm:text-lg font-black pt-1">
              招集プッシュ通知を受け取る選手を選択してください
            </CardTitle>
            <p className="text-xs text-slate-300 font-medium">
              一度登録すると、ページを再読み込みしてもあなたの設定が維持され、出番（招集時）にこの端末へ通知が届きます。
            </p>
          </CardHeader>

          <CardContent className="p-4 sm:p-5 space-y-4">
            {/* 1. 所属支部（チーム）フィルタ ＆ 名前検索 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  所属チーム・支部で絞り込み
                </label>
                <select
                  aria-label="所属チーム・支部で絞り込み"
                  value={selectedOrgFilter}
                  onChange={(e) => setSelectedOrgFilter(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-slate-900"
                >
                  <option value="ALL">
                    すべての所属（全 {participants.length} 名）
                  </option>
                  {organizationList.map((org) => (
                    <option key={org} value={org}>
                      {org}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 block mb-1">
                  氏名・ふりがな・ゼッケン検索
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchKeyword}
                    onChange={(e) => setSearchKeyword(e.target.value)}
                    placeholder="自分の名前やゼッケンを入力..."
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:bg-white focus:border-slate-900 font-medium"
                  />
                </div>
              </div>
            </div>

            {/* 2. 選手タップ選択リスト（スマホでタップしやすいカード形式） */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 px-1">
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-slate-400" />
                  該当選手をタップして選択（{filteredCandidatePlayers.length}
                  名）
                </span>
                {candidateEntryId && (
                  <span className="text-emerald-700 font-black">1名選択中</span>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-2xl p-2 space-y-1.5 bg-slate-50/60">
                {filteredCandidatePlayers.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400 font-medium">
                    該当する選手が見つかりません。検索条件を変更してください。
                  </div>
                ) : (
                  filteredCandidatePlayers.map((p) => {
                    const isSelected = candidateEntryId === p.id;
                    const amStand = p.standAssignments[1]?.standGroup;
                    const amGroup = amStand
                      ? calculateGroupFromStand(amStand)
                      : null;

                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setCandidateEntryId(p.id)}
                        className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'bg-amber-50 border-2 border-amber-500 shadow-2xs'
                            : 'bg-white border-slate-200/90 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`font-mono text-xs font-black px-2 py-0.5 rounded shrink-0 ${
                              isSelected
                                ? 'bg-amber-500 text-slate-950'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            No.{p.bibNumber}
                          </span>
                          <div className="min-w-0">
                            <div className="text-sm font-black text-slate-900 truncate">
                              {p.name}
                            </div>
                            <div className="text-[11px] font-bold text-slate-500 truncate">
                              所属: {p.organization || '無所属'}
                              {amGroup && amStand
                                ? ` / 午前: 第${amGroup}組(第${amStand}立)`
                                : ''}
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0">
                          {isSelected ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-black bg-slate-900 text-amber-400 px-2.5 py-1 rounded-lg">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              選択中
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold text-slate-400 px-2">
                              選択
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* 3. 確定・通知有効化ボタン */}
            <Button
              type="button"
              disabled={!candidateEntryId || isRegistering}
              onClick={handleRegisterPlayerAndFcm}
              className="w-full h-12 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-sm rounded-xl shadow-sm flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {isRegistering ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  選手情報と通知設定を登録中...
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  この選手を登録して招集プッシュ通知を受け取る
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ==========================================
          セクション3: 大会全体のリアルタイム招集中・控え待機中・行射中バナー
          ========================================== */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
            <BellRing className="w-3.5 h-3.5 text-amber-600" />
            会場全体のリアルタイム進行・招集状況
          </span>
          <span className="text-[11px] font-mono text-slate-500">
            {STAND_CONFIGS[matchProgress.currentRound].name}
          </span>
        </div>

        <LiveCallStatusBanner matchId={DEFAULT_MATCH_ID} />
      </div>
    </main>
  );
}
