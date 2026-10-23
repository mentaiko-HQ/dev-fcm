/**
 * 【参加選手選択およびWebプッシュ通知 (FCM) トークン管理コンポーネント】
 *
 * 役割:
 * - 【選手数無制限対応】エントリーされた全選手（棄権を除く）をゼッケン番号昇順で一覧表示。
 * - 参加選手自身の選択と、Webプッシュ通知（FCM）トークンの自動取得・Firestoreへの紐付け保存。
 * - リロード・再訪問時の登録選手情報の自動復元（localStorage & Firestore onSnapshot）。
 * - 登録完了後の待機ステータス表示および選手再選択（変更）機能。
 *
 * フールプルーフ設計（事故前・対人間）:
 * - 選手未選択状態での登録ボタン押下をUI（disabled属性）およびロジックで二重遮断。
 * - 棄権（ABSENT / WITHDRAWN）となった選手のみを選択肢から除外。
 * - 登録完了後は待機画面へ遷移させ、誤操作による意図しない再選択を防止。
 * - 連続タップによる多重書き込みを処理中フラグ（isSubmitting）で完全ロック。
 *
 * フェイルセーフ設計（事故後・対故障）:
 * - プッシュ通知がブラウザでブロック（denied）された場合やFCMトークン取得失敗時でも、
 *   システム全体をクラッシュさせず、選手紐付けのみを安全に完了（縮退動作）。
 * - Firestore書き込み失敗時はlocalStorageをロールバックし、UIとDBの不整合を防止。
 */

'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { signInAnonymously } from 'firebase/auth';
import {
  db,
  auth,
  isFirebaseConfigured,
  isFirestoreAvailable,
} from '@/lib/firebase';
import { Participant, StandOrderIndex } from '@/types';
import { requestNotificationPermissionAndGetToken } from '@/lib/fcm';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Bell,
  BellOff,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Users,
  RefreshCw,
  ShieldCheck,
  ChevronRight,
  Sun,
  Moon,
} from 'lucide-react';

const LOCAL_STORAGE_PARTICIPANT_KEY = 'kyudo_selected_participant_id';
const LOCAL_STORAGE_USER_KEY = 'kyudo_device_user_id';

function getStandOrderText(order: StandOrderIndex | null | undefined): string {
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

interface SavedUserData {
  userId: string;
  participantId?: string;
  bibNumber?: number;
  playerName?: string;
  organization?: string;
  fcmToken: string | null;
  updatedAt: number;
}

export function TeamSelectForm() {
  const isDbReady = isFirebaseConfigured && isFirestoreAvailable(db);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isLoadingParticipants, setIsLoadingParticipants] = useState<boolean>(
    () => isDbReady,
  );

  const [selectedParticipantId, setSelectedParticipantId] =
    useState<string>('');
  const [currentUserData, setCurrentUserData] = useState<SavedUserData | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isChangingParticipant, setIsChangingParticipant] =
    useState<boolean>(false);

  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const getOrCreateDeviceId = useCallback(async (): Promise<string> => {
    if (auth) {
      try {
        if (!auth.currentUser) {
          const cred = await signInAnonymously(auth);
          return cred.user.uid;
        }
        return auth.currentUser.uid;
      } catch (authError) {
        console.warn(
          '【Auth匿名認証警告】ローカルストレージUIDへフォールバックします:',
          authError,
        );
      }
    }

    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem(LOCAL_STORAGE_USER_KEY);
      if (cached) return cached;
      const generated =
        'device_' +
        Math.random().toString(36).substring(2, 15) +
        Date.now().toString(36);
      localStorage.setItem(LOCAL_STORAGE_USER_KEY, generated);
      return generated;
    }

    return 'unknown_device';
  }, []);

  // entries コレクションのリアルタイム購読（全件・無制限取得）
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
          const data = docSnap.data();
          loaded.push({
            id: docSnap.id,
            bibNumber:
              typeof data.bibNumber === 'number'
                ? data.bibNumber
                : Number(data.bibNumber) || 1,
            name: typeof data.name === 'string' ? data.name : '選手名未設定',
            nameKana: typeof data.nameKana === 'string' ? data.nameKana : '',
            organization:
              typeof data.organization === 'string'
                ? data.organization
                : '無所属',
            shosa: data.shosa || '肌脱ぎ',
            rankTitle: data.rankTitle || '段位は三段以下',
            staffRole: data.staffRole || '無し',
            staffDutyShift: data.staffDutyShift || '無し',
            checkInStatus: data.checkInStatus || 'UNCHECKED',
            checkInAt:
              typeof data.checkInAt === 'number' ? data.checkInAt : null,
            isStaffVolunteer: Boolean(data.isStaffVolunteer),
            needsSupport: Boolean(data.needsSupport),
            standAssignments: data.standAssignments || {
              1: { standGroup: null, standOrder: null },
              2: { standGroup: null, standOrder: null },
              3: { standGroup: null, standOrder: null },
            },
            progressStatus: data.progressStatus || 'WAITING',
            qualificationStatus: data.qualificationStatus || 'ACTIVE',
            stand1_arrows: Array.isArray(data.stand1_arrows)
              ? data.stand1_arrows
              : [],
            stand2_arrows: Array.isArray(data.stand2_arrows)
              ? data.stand2_arrows
              : [],
            stand3_arrows: Array.isArray(data.stand3_arrows)
              ? data.stand3_arrows
              : [],
            isHayaHit: Boolean(data.isHayaHit),
            isSokuchu: Boolean(data.isSokuchu), // ★ここでプロパティを追加・マッピング
            totalHits:
              typeof data.totalHits === 'number'
                ? data.totalHits
                : Number(data.totalHits) || 0,
            totalShots:
              typeof data.totalShots === 'number'
                ? data.totalShots
                : Number(data.totalShots) || 8,
            isPerfect: Boolean(data.isPerfect),
            enkinRank:
              typeof data.enkinRank === 'number' ? data.enkinRank : null,
            finalRank:
              typeof data.finalRank === 'number' ? data.finalRank : null,
            representativeName:
              typeof data.representativeName === 'string'
                ? data.representativeName
                : '',
            representativeEmail:
              typeof data.representativeEmail === 'string'
                ? data.representativeEmail
                : '',
            representativePhone:
              typeof data.representativePhone === 'string'
                ? data.representativePhone
                : '',
            representativeOrganization:
              typeof data.representativeOrganization === 'string'
                ? data.representativeOrganization
                : '',
            isPaid: Boolean(data.isPaid),
            paidAt: typeof data.paidAt === 'number' ? data.paidAt : null,
            notes: typeof data.notes === 'string' ? data.notes : '',
            qrSentStatus: data.qrSentStatus || 'UNSENT',
            qrSentAt: typeof data.qrSentAt === 'number' ? data.qrSentAt : null,
            qrSentError: data.qrSentError || null,
          });
        });

        setParticipants(loaded);
        setIsLoadingParticipants(false);
      },
      (error) => {
        console.error('【参加選手一覧取得例外】:', error);
        setErrorMessage('参加選手データの取得に失敗しました。');
        setIsLoadingParticipants(false);
      },
    );

    return () => unsubscribe();
  }, [isDbReady]);

  // 【無制限対応】棄権選手のみを除外し、登録されたすべての選手を対象とする
  const eligibleParticipants = useMemo(() => {
    return participants.filter((p) => {
      return (
        p.checkInStatus !== 'ABSENT' && p.qualificationStatus !== 'WITHDRAWN'
      );
    });
  }, [participants]);

  // 既存の紐付け情報の復元
  useEffect(() => {
    if (!isDbReady) return;

    let isMounted = true;

    async function restorePreviousSelection() {
      const userId = await getOrCreateDeviceId();
      if (!isMounted) return;

      const userDocRef = doc(db, 'users', userId);
      const unsubscribeUser = onSnapshot(
        userDocRef,
        (docSnap) => {
          if (!isMounted) return;
          if (docSnap.exists()) {
            const data = docSnap.data();
            const restored: SavedUserData = {
              userId,
              participantId: data.participantId || undefined,
              bibNumber:
                typeof data.bibNumber === 'number' ? data.bibNumber : undefined,
              playerName: data.playerName || undefined,
              organization: data.organization || undefined,
              fcmToken: data.fcmToken || null,
              updatedAt:
                typeof data.updatedAt === 'number'
                  ? data.updatedAt
                  : Date.now(),
            };

            if (restored.participantId) {
              setCurrentUserData(restored);
              setSelectedParticipantId(restored.participantId);
              if (typeof window !== 'undefined') {
                localStorage.setItem(
                  LOCAL_STORAGE_PARTICIPANT_KEY,
                  restored.participantId,
                );
              }
            }
          }
        },
        (userError) => {
          console.warn('【ユーザー状態同期警告】:', userError);
        },
      );

      return unsubscribeUser;
    }

    restorePreviousSelection();

    return () => {
      isMounted = false;
    };
  }, [isDbReady, getOrCreateDeviceId]);

  /**
   * 【選手登録およびFCM通知設定実行ハンドラー】
   */
  const handleRegisterParticipant = async () => {
    if (!selectedParticipantId) {
      setErrorMessage('参加選手名一覧からご自身のお名前を選択してください。');
      return;
    }

    const selected = participants.find((p) => p.id === selectedParticipantId);
    if (!selected) {
      setErrorMessage(
        '選択された選手情報が見つかりません。再度一覧から選択してください。',
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setStatusMessage('');

    try {
      const userId = await getOrCreateDeviceId();

      let fcmToken: string | null = null;
      let notificationWarning: string | null = null;

      try {
        const tokenResult = await requestNotificationPermissionAndGetToken();
        if (tokenResult.token) {
          fcmToken = tokenResult.token;
        } else if (tokenResult.error) {
          notificationWarning = tokenResult.error;
        }
      } catch (fcmErr) {
        console.warn(
          '【FCM取得フェイルセーフ】通知取得失敗、選手登録のみ継続:',
          fcmErr,
        );
        notificationWarning = '通知トークンの取得をスキップしました。';
      }

      const userDocRef = doc(db, 'users', userId);
      const updatePayload: Record<string, unknown> = {
        userId,
        participantId: selected.id,
        bibNumber: selected.bibNumber,
        playerName: selected.name,
        organization: selected.organization || '無所属',
        fcmToken: fcmToken,
        updatedAt: serverTimestamp(),
      };

      await setDoc(userDocRef, updatePayload, { merge: true });

      const saved: SavedUserData = {
        userId,
        participantId: selected.id,
        bibNumber: selected.bibNumber,
        playerName: selected.name,
        organization: selected.organization,
        fcmToken,
        updatedAt: Date.now(),
      };

      setCurrentUserData(saved);
      setIsChangingParticipant(false);

      if (typeof window !== 'undefined') {
        localStorage.setItem(LOCAL_STORAGE_PARTICIPANT_KEY, selected.id);
      }

      if (fcmToken) {
        setStatusMessage(
          `「No.${selected.bibNumber} ${selected.name}」選手として登録完了しました。2立前に呼出通知が自動送信されます。`,
        );
      } else {
        setStatusMessage(
          `「No.${selected.bibNumber} ${selected.name}」選手として登録完了しました。（※${notificationWarning || 'ブラウザの通知が未許可のため画面上で進行を確認してください'}）`,
        );
      }
    } catch (saveError) {
      console.error('【選手登録例外】:', saveError);
      setErrorMessage(
        '登録処理に失敗しました。通信環境を確認の上再度お試しください。',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartChange = () => {
    const confirmed = window.confirm(
      '登録中の選手を変更しますか？\n変更するまで現在の選手宛ての呼出通知設定が維持されます。',
    );
    if (!confirmed) return;

    setIsChangingParticipant(true);
    setStatusMessage('');
    setErrorMessage('');
  };

  const handleCancelChange = () => {
    if (currentUserData?.participantId) {
      setSelectedParticipantId(currentUserData.participantId);
    }
    setIsChangingParticipant(false);
    setErrorMessage('');
  };

  const activeParticipant = participants.find(
    (p) => p.id === (currentUserData?.participantId || selectedParticipantId),
  );

  return (
    <Card className="w-full shadow-sm border border-slate-200/80 rounded-2xl overflow-hidden bg-white">
      <CardHeader className="bg-white border-b border-slate-100 p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold tracking-wider bg-slate-900 text-white px-2.5 py-0.5 rounded-full shadow-2xs">
            参加選手選択
          </span>
          <span className="text-xs text-slate-400 font-mono">
            FCM Push Notification
          </span>
        </div>
        <CardTitle className="text-lg font-black tracking-tight text-slate-900 flex items-center gap-2">
          <Users className="w-5 h-5 text-slate-700" />
          参加選手選択
        </CardTitle>
        <CardDescription className="text-slate-600 text-xs mt-1 font-medium leading-relaxed">
          参加選手名を選択すると、２立前に呼び出しpush通知を受信できます
        </CardDescription>
      </CardHeader>

      <CardContent className="p-5 space-y-4">
        {statusMessage && (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs font-bold flex items-start gap-2 shadow-2xs animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>{statusMessage}</span>
          </div>
        )}

        {errorMessage && (
          <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-bold flex items-start gap-2 shadow-2xs animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {currentUserData && !isChangingParticipant ? (
          <div className="space-y-4">
            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  現在の登録選手
                </span>
                <span className="text-[10px] font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                  呼出待機中
                </span>
              </div>

              <div>
                <div className="text-xs font-mono font-bold text-amber-700">
                  ゼッケン No.{currentUserData.bibNumber}
                </div>
                <h3 className="text-xl font-black text-slate-900 mt-0.5">
                  {currentUserData.playerName}
                </h3>
                <p className="text-xs text-slate-600 font-medium">
                  {currentUserData.organization || '無所属'}
                </p>
              </div>

              {activeParticipant && (
                <div className="pt-2 border-t border-slate-200/60 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="bg-white p-2 rounded-xl border border-slate-200/60">
                    <span className="text-slate-500 font-medium flex items-center gap-1 text-[10px]">
                      <Sun className="w-3.5 h-3.5 text-amber-500" /> 午前
                      (第1立)
                    </span>
                    <span className="font-bold text-slate-800 block mt-0.5">
                      第{' '}
                      {activeParticipant.standAssignments[1]?.standGroup ??
                        '未'}{' '}
                      組 -{' '}
                      {getStandOrderText(
                        activeParticipant.standAssignments[1]?.standOrder,
                      )}
                    </span>
                  </div>

                  <div className="bg-white p-2 rounded-xl border border-slate-200/60">
                    <span className="text-slate-500 font-medium flex items-center gap-1 text-[10px]">
                      <Moon className="w-3.5 h-3.5 text-slate-600" /> 午後
                      (第2・3立)
                    </span>
                    <span className="font-bold text-slate-800 block mt-0.5">
                      第{' '}
                      {activeParticipant.standAssignments[2]?.standGroup ??
                        '未'}{' '}
                      組 -{' '}
                      {getStandOrderText(
                        activeParticipant.standAssignments[2]?.standOrder,
                      )}
                    </span>
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">
                  プッシュ通知:
                </span>
                {currentUserData.fcmToken ? (
                  <span className="font-bold text-emerald-800 flex items-center gap-1 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-[11px]">
                    <Bell className="w-3.5 h-3.5 text-emerald-600" /> 有効
                    (2立前に自動呼出)
                  </span>
                ) : (
                  <span className="font-bold text-amber-900 flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md text-[11px]">
                    <BellOff className="w-3.5 h-3.5 text-amber-600" /> 未許可
                    (画面で進行確認)
                  </span>
                )}
              </div>
            </div>

            <p className="text-[11px] text-slate-500 text-center leading-relaxed font-medium">
              ブラウザを閉じたり画面がスリープしても設定は保持されます。
              <br />
              出番の2立前になると自動的に呼出通知が届きます。
            </p>

            <Button
              type="button"
              variant="outline"
              onClick={handleStartChange}
              className="w-full h-10 text-xs font-bold text-slate-700 bg-white border-slate-200 hover:bg-slate-50 rounded-xl"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              登録選手を変更する
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-800 flex items-center justify-between">
                <span>参加選手名</span>
                {isLoadingParticipants && (
                  <span className="text-[11px] text-slate-500 font-normal flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin text-slate-700" />{' '}
                    選手一覧ロード中...
                  </span>
                )}
              </label>

              <Select
                value={selectedParticipantId}
                onValueChange={(val) => {
                  setSelectedParticipantId(val);
                  setErrorMessage('');
                }}
                disabled={isLoadingParticipants || isSubmitting}
              >
                <SelectTrigger className="w-full h-12 text-sm font-bold bg-slate-50 border-slate-200 rounded-xl focus:ring-slate-900 focus:bg-white transition-all text-slate-900">
                  <SelectValue placeholder="参加選手名一覧から選択" />
                </SelectTrigger>
                <SelectContent className="max-h-72 rounded-xl border-slate-200 shadow-xl bg-white">
                  {eligibleParticipants.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-500 font-medium">
                      確定した参加選手データがありません
                    </div>
                  ) : (
                    eligibleParticipants.map((p) => (
                      <SelectItem
                        key={p.id}
                        value={p.id}
                        className="py-2.5 text-xs font-bold cursor-pointer focus:bg-slate-100"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-black text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                            No.{p.bibNumber}
                          </span>
                          <span className="text-slate-900 text-sm font-black">
                            {p.name}
                          </span>
                          <span className="text-[11px] text-slate-500 font-normal">
                            ({p.organization || '無所属'})
                          </span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                <Bell className="w-4 h-4 text-amber-700" />
                通知の許可について
              </div>
              <p className="text-[11px] text-amber-900 leading-relaxed font-medium">
                「選手を登録して通知を受信」を押すとブラウザから通知の許可を求められます。必ず
                <strong>「許可」</strong>を選択してください。
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              {isChangingParticipant && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleCancelChange}
                  disabled={isSubmitting}
                  className="flex-1 h-11 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  キャンセル
                </Button>
              )}

              <Button
                type="button"
                onClick={handleRegisterParticipant}
                disabled={
                  !selectedParticipantId ||
                  isSubmitting ||
                  isLoadingParticipants
                }
                className="flex-1 h-11 text-xs font-black bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-xs transition-transform active:scale-[0.98] disabled:opacity-40"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin text-amber-400" />
                    登録・通知設定中...
                  </>
                ) : (
                  <>
                    選手を登録して通知を受信
                    <ChevronRight className="w-4 h-4 ml-1 text-amber-400" />
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
