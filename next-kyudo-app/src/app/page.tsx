/**
 * 【トップページ / 選手・応援ポータル（/standby 招集通知設定一本化導線 ＆ /results 成績速報導線統合版）】
 * / パスに対応するページコンポーネント。
 * 組番号・立順の未設定（null）データに対応。
 *
 * 【既存機能の完全維持】
 * - 大会タイトル・開催ステータスヘッダー、本部運営管理（/admin）への遷移ボタン
 * - 新規参加エントリー（/entry）カード、参加者一覧・入金確認（/admin/participants）カード
 * - エントリー済み選手一覧テーブル（ゼッケン・氏名・所属・所作/段位・入金状態）
 *
 * 【新規追加導線（/standby 一本化）】
 * - 参加選手が自身のスマートフォンでFCM招集プッシュ通知を設定・確認するための大型案内カード（/standby へ遷移）を最上段に配置。
 * - 既に /standby で選手登録済みの端末では、localStorage ('kyudo_selected_entry_id_v5') を読み取り、登録中の選手名をトップページ上にもバッジ表示。
 * - リアルタイム成績速報・立順確認（/results へ遷移）の案内カードを併設。
 *
 * 【フールプルーフ】
 * - TournamentConfig の必須プロパティ（date, venue）を完全網羅し型エラーを防止。
 * - Participant の必須プロパティ（isSokuchu 等）を安全にマッピング。
 * - バリデーションにより不適切なデータの混入を防止。
 *
 * 【フェイルセーフ】
 * - データベース接続エラーや立ち順未設定時にもアプリがクラッシュしない安全なフォールバック設計。
 */

'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  collection,
  onSnapshot,
  query,
  doc,
  orderBy,
} from 'firebase/firestore';
import { db, isFirebaseConfigured, isFirestoreAvailable } from '@/lib/firebase';
import {
  Participant,
  TournamentConfig,
  ShosaType,
  StaffRoleType,
  StandOrderIndex,
  ProgressStatus,
  RankTitleType,
  StandRoundIndex,
  CheckInStatus,
  sanitizeStandOrder,
  sanitizeStandGroup,
} from '@/types';
import { Button } from '@/components/ui/button';
import {
  ShieldAlert,
  Users,
  Calendar,
  ArrowRight,
  Award,
  BellRing,
  Target,
  CheckCircle2,
  Smartphone,
} from 'lucide-react';

const STORAGE_KEY_ENTRY_ID = 'kyudo_selected_entry_id_v5';

const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  matchId: 'match_2026_mentaiko',
  title: '第5回めんたいこ杯争奪弓道大会',
  date: '2027-01-24',
  venue: '福岡市総合体育館内 弓道場',
  totalStands: 3,
  totalArrows: 8,
  tieBreakerFormat: '射詰',
  status: 'IN_PROGRESS',
  currentStandGroup: 1,
  maxStandGroup: 4,
  entryStartDate: '2027-01-01T00:00',
  entryEndDate: '2027-03-20T23:59',
  isEntryEnabled: true,
};

function sanitizeShosa(val: unknown): ShosaType {
  if (val === '襷掛け') return '襷掛け';
  return '肌脱ぎ';
}

function sanitizeRankTitle(val: unknown): RankTitleType {
  if (
    val === '称号を取得している' ||
    val === '段位は四段以上' ||
    val === '段位は三段以下'
  ) {
    return val;
  }
  return '段位は三段以下';
}

function sanitizeStaffRole(val: unknown): StaffRoleType {
  const validRoles: StaffRoleType[] = [
    '進行',
    '的前',
    '招集',
    '記録',
    'カメラマン',
    '運営',
    '無し',
  ];
  if (typeof val === 'string' && validRoles.includes(val as StaffRoleType)) {
    return val as StaffRoleType;
  }
  return '無し';
}

function sanitizeProgressStatus(val: unknown): ProgressStatus {
  const validStatuses: ProgressStatus[] = [
    'WAITING',
    'CALLED',
    'IN_STAND',
    'SHOOTING',
    'FINISHED',
    'COMPLETED',
  ];
  if (
    typeof val === 'string' &&
    validStatuses.includes(val as ProgressStatus)
  ) {
    return val as ProgressStatus;
  }
  return 'WAITING';
}

function sanitizeCheckInStatus(val: unknown): CheckInStatus {
  const validStatuses: CheckInStatus[] = ['UNCHECKED', 'CHECKED_IN', 'ABSENT'];
  if (typeof val === 'string' && validStatuses.includes(val as CheckInStatus)) {
    return val as CheckInStatus;
  }
  return 'UNCHECKED';
}

export default function PortalHomePage() {
  const router = useRouter();
  const [tournamentConfig, setTournamentConfig] = useState<TournamentConfig>(
    DEFAULT_TOURNAMENT_CONFIG,
  );
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [savedEntryId, setSavedEntryId] = useState<string | null>(null);

  // 端末に保存済みの選手ID（/standby で設定したID）を読み込み
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY_ENTRY_ID);
    if (stored && stored.trim() !== '') {
      setSavedEntryId(stored.trim());
    }
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const matchDocRef = doc(db, 'matches', tournamentConfig.matchId);
    const unsubscribe = onSnapshot(
      matchDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<TournamentConfig>;
          setTournamentConfig((prev: TournamentConfig) => ({
            ...prev,
            ...data,
            title: typeof data.title === 'string' ? data.title : prev.title,
            date: typeof data.date === 'string' ? data.date : prev.date,
            venue: typeof data.venue === 'string' ? data.venue : prev.venue,
            isEntryEnabled:
              typeof data.isEntryEnabled === 'boolean'
                ? data.isEntryEnabled
                : prev.isEntryEnabled,
          }));
        }
      },
      (error) => {
        console.error('【エラーログ】matchesドキュメント購読失敗:', error);
      },
    );

    return () => unsubscribe();
  }, [tournamentConfig.matchId]);

  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const entriesQuery = query(
      collection(db, 'entries'),
      orderBy('bibNumber', 'asc'),
    );
    const unsubscribe = onSnapshot(
      entriesQuery,
      (snapshot) => {
        if (!snapshot.empty) {
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

            const safeAssignments: Record<
              StandRoundIndex,
              { standGroup: number | null; standOrder: StandOrderIndex | null }
            > = {
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
            };

            loaded.push({
              id: docSnap.id,
              bibNumber:
                typeof raw.bibNumber === 'number'
                  ? raw.bibNumber
                  : Number(raw.bibNumber) || 1,
              name: typeof raw.name === 'string' ? raw.name : '選手名未設定',
              nameKana: typeof raw.nameKana === 'string' ? raw.nameKana : '',
              organization:
                typeof raw.organization === 'string' ? raw.organization : '',
              shosa: sanitizeShosa(raw.shosa),
              rankTitle: sanitizeRankTitle(raw.rankTitle),
              staffRole: sanitizeStaffRole(raw.staffRole),
              staffDutyShift: raw.staffDutyShift || '無し',
              checkInStatus: sanitizeCheckInStatus(raw.checkInStatus),
              checkInAt:
                typeof raw.checkInAt === 'number' ? raw.checkInAt : null,
              isStaffVolunteer: Boolean(raw.isStaffVolunteer),
              needsSupport: Boolean(raw.needsSupport),
              standAssignments: safeAssignments,
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
              enkinRank:
                typeof raw.enkinRank === 'number' ? raw.enkinRank : null,
              finalRank:
                typeof raw.finalRank === 'number' ? raw.finalRank : null,
              userId: typeof raw.userId === 'string' ? raw.userId : undefined,
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
              qrSentAt: typeof raw.qrSentAt === 'number' ? raw.qrSentAt : null,
              qrSentStatus: raw.qrSentStatus || 'UNSENT',
              qrSentError: raw.qrSentError || null,
              agreedAt:
                typeof raw.agreedAt === 'number' ? raw.agreedAt : undefined,
              updatedAt:
                typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
            });
          });
          setParticipants(loaded);
        } else {
          setParticipants([]);
        }
      },
      (error) => {
        console.error('【エラーログ】entriesコレクション購読失敗:', error);
      },
    );

    return () => unsubscribe();
  }, [tournamentConfig.matchId]);

  // この端末で既に /standby にて選択・登録されている選手情報
  const registeredPlayer = useMemo(() => {
    if (!savedEntryId) return null;
    return participants.find((p) => p.id === savedEntryId) || null;
  }, [participants, savedEntryId]);

  return (
    <main className="min-h-screen bg-[#F8FAFC] text-slate-900 p-4 md:p-8 flex flex-col items-center justify-start">
      <div className="w-full max-w-4xl space-y-6">
        {/* 1. 大会タイトル・本部運営管理ヘッダー */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold bg-slate-900 text-white px-3 py-1 rounded-full flex items-center gap-1 shadow-2xs">
                <Calendar className="w-3.5 h-3.5 text-amber-400" /> 開催中
              </span>
              <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-md">
                個人戦（全8射）
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-slate-900 pt-1">
              {tournamentConfig.title} 選手・応援ポータル
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              午前一手（第1立・2射）と午後一手（第2立・2射）および午後四矢（第3立・4射）の合計8射制。
            </p>
          </div>

          <Button
            type="button"
            onClick={() => router.push('/admin')}
            className="text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl shadow-xs"
          >
            <ShieldAlert className="w-4 h-4 mr-1.5 text-amber-400" />{' '}
            本部運営管理へ
          </Button>
        </div>

        {/* ==========================================
            2. 【最優先導線】招集通知の設定・待機状況確認（/standby へ一本化）＆ 成績速報（/results）
            ========================================== */}
        <div className="bg-amber-50/90 border-2 border-amber-400 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[11px] font-black bg-slate-900 text-amber-400 px-2.5 py-0.5 rounded-full">
                  <BellRing className="w-3 h-3" />
                  参加選手 必須設定
                </span>
                {registeredPlayer ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300 px-2.5 py-0.5 rounded-full">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    現在 No.{registeredPlayer.bibNumber} {registeredPlayer.name}{' '}
                    選手で設定中
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-white text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full">
                    <Smartphone className="w-3 h-3 text-amber-600" />
                    スマホへの招集プッシュ通知対応
                  </span>
                )}
              </div>

              <h2 className="text-lg sm:text-xl font-black text-slate-950">
                招集通知の設定・リアルタイム待機状況確認
              </h2>
              <p className="text-xs text-slate-700 font-medium leading-relaxed">
                あなたの選手名を選択しておくと、運営本部があなたの組の「招集ボタン」を押した際にお手元のスマートフォンへプッシュ通知が届きます。現在の「行射中」「控え待機中」「招集中」の組もリアルタイムで確認できます。
              </p>
            </div>

            <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 shrink-0">
              <Button
                type="button"
                onClick={() => router.push('/standby')}
                className="w-full md:w-64 h-12 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs sm:text-sm px-5 rounded-xl shadow-xs flex items-center justify-center gap-2"
              >
                <BellRing className="w-4 h-4 shrink-0" />
                <span>招集通知の設定・待機確認はこちら</span>
                <ArrowRight className="w-4 h-4 shrink-0" />
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/results')}
                className="w-full md:w-64 h-10 bg-white hover:bg-slate-50 border-slate-300 text-slate-900 font-bold text-xs px-4 rounded-xl flex items-center justify-center gap-1.5"
              >
                <Target className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span>立順・リアルタイム成績速報を見る</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </Button>
            </div>
          </div>
        </div>

        {/* 3. 新規参加エントリー ＆ 参加者一覧・入金確認（既存カード完全維持） */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-3 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-900 flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="font-black text-slate-900 text-base">
              新規参加エントリー
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              大会への参加申し込みを行います。代表者情報および選手情報を入力してエントリーを完了させてください。
            </p>
            <Button
              type="button"
              onClick={() => router.push('/entry')}
              className="w-full mt-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs py-2.5 rounded-xl"
            >
              エントリーフォームへ進む{' '}
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-3 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold">
              <Award className="w-5 h-5" />
            </div>
            <h3 className="font-black text-slate-900 text-base">
              参加者一覧・入金確認
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              現在エントリーされている選手の確認や、管理者による入金確認・立順設定の状況をご確認いただけます。
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/admin/participants')}
              className="w-full mt-2 border-slate-200 bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs py-2.5 rounded-xl"
            >
              参加者リストを表示 <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>

        {/* 4. エントリー済み選手一覧テーブル（既存テーブル完全維持） */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-700" />{' '}
              エントリー済み選手一覧（全 {participants.length} 名）
            </h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50/80 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-3">ゼッケン</th>
                  <th className="p-3">選手氏名</th>
                  <th className="p-3">所属団体名</th>
                  <th className="p-3">所作 / 段位</th>
                  <th className="p-3 text-center">入金状態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {participants.length > 0 ? (
                  participants.map((p) => (
                    <tr
                      key={p.id}
                      className="hover:bg-slate-50/60 transition-colors"
                    >
                      <td className="p-3 font-mono font-bold text-slate-900">
                        No.{p.bibNumber}
                      </td>
                      <td className="p-3 font-bold text-slate-900">
                        <div>{p.name}</div>
                        <div className="text-[10px] text-slate-400 font-normal">
                          {p.nameKana}
                        </div>
                      </td>
                      <td className="p-3 text-slate-700 font-medium">
                        {p.organization || '-'}
                      </td>
                      <td className="p-3 text-slate-600 font-medium">
                        <div>{p.shosa}</div>
                        <div className="text-[10px] text-slate-400 font-normal">
                          {p.rankTitle}
                        </div>
                      </td>
                      <td className="p-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            p.isPaid
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                              : 'bg-amber-50 text-amber-900 border border-amber-300'
                          }`}
                        >
                          {p.isPaid ? '入金済み' : '未入金'}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-12 text-center text-slate-400 font-medium"
                    >
                      現在エントリーしている選手はいません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
