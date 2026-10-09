/**
 * 【管理者向け本部運営統合ダッシュボード】
 * /admin パスに対応するページコンポーネント。
 * 組番号・立順の未設定（null）データに対応。
 *
 * 役割:
 * - PC・タブレット端末に特化し、横幅制約（max-w）を解除して画面幅いっぱい（w-full）に情報を一覧表示。
 * 1. エントリー受付期間・状態管理 (EntryPeriodConfigPanel)
 * 2. 名簿取り込み / 立ちグループ編成 (CSVImportScheduleWizard)
 * 3. 表彰・成績サマリー (AwardSummaryCard)
 * 4. 本部進行管理 / 呼出通知トリガー (MatchControlPanel)
 * 5. 競技記録員用 スコア入力コンソール (StandScoreContainer)
 * 6. 競射判定 / 順位確定 (TieBreakerRankPanel)
 * 7. 参加者一覧 / 進行状況管理テーブル (ParticipantDataTable)
 * 8. データベース初期化・データリセット管理 (DataResetPanel)
 *
 * フールプルーフ設計:
 * - 各種サニタイズ関数により不正データの流入を遮断。
 * - Participant 型に要求される isHayaHit および null 許容 standAssignments を完全網羅。
 *
 * フェイルセーフ設計:
 * - Firestore未接続時やデータ不在時は DEFAULT_TOURNAMENT_CONFIG へ安全にフォールバック。
 * - standGroup, standOrder が null の場合でも画面クラッシュを防止。
 */

'use client';

import React, { useEffect, useState } from 'react';
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
import { ParticipantDataTable } from '@/components/admin/ParticipantDataTable';
import { StandScoreContainer } from '@/components/admin/StandScoreContainer';
import { MatchControlPanel } from '@/components/admin/MatchControlPanel';
import { CSVImportScheduleWizard } from '@/components/admin/CSVImportScheduleWizard';
import { EntryPeriodConfigPanel } from '@/components/admin/EntryPeriodConfigPanel';
import { TieBreakerRankPanel } from '@/components/admin/TieBreakerRankPanel';
import { AwardSummaryCard } from '@/components/admin/AwardSummaryCard';
import { DataResetPanel } from '@/components/admin/DataResetPanel';
import { Button } from '@/components/ui/button';
import {
  UserCog,
  ArrowRight,
  ShieldAlert,
  ArrowLeft,
  Database,
  QrCode,
} from 'lucide-react';

const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  matchId: 'match_2026_mentaiko',
  title: '第5回めんたいこ杯争奪弓道大会',
  date: '2027-01-24',
  venue: '福岡市総合体育館内 弓道場',
  totalStandGroups: 4,
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

export default function AdminConsolePage() {
  const router = useRouter();
  const [tournamentConfig, setTournamentConfig] = useState<TournamentConfig>(
    DEFAULT_TOURNAMENT_CONFIG,
  );
  const [participants, setParticipants] = useState<Participant[]>([]);

  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const matchDocRef = doc(db, 'matches', tournamentConfig.matchId);
    const unsubscribe = onSnapshot(
      matchDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setTournamentConfig((prev: TournamentConfig) => ({
            ...prev,
            title: typeof data.title === 'string' ? data.title : prev.title,
            totalStandGroups:
              typeof data.totalStandGroups === 'number'
                ? data.totalStandGroups
                : prev.totalStandGroups,
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
              userId: typeof raw.userId === 'string' ? raw.userId : undefined,
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

  return (
    <div className="w-full min-h-screen bg-[#F8FAFC] text-slate-900 p-4 sm:p-6 lg:p-8 space-y-6">
      <header className="w-full bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold bg-slate-900 text-white px-3 py-1 rounded-full flex items-center gap-1 shadow-2xs">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />{' '}
              本部運営管理コンソール
            </span>
            <span className="text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-md">
              全8射的中制（個人戦）
            </span>
          </div>
          <h1 className="text-xl md:text-2xl font-black text-slate-900 pt-1">
            {tournamentConfig.title}
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            午前の部: 一手2射 / 午後の部:
            一手2射＋四矢4射（合計8射・優勝決定射詰 / 2位以降遠近競射）
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/')}
            className="text-xs h-9 bg-white border-slate-200 text-slate-700 hover:bg-slate-50 font-bold"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1" />
            選手用ポータル
          </Button>

          <Button
            type="button"
            onClick={() => router.push('/admin/check')}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9 px-3.5 rounded-xl shadow-xs"
          >
            <QrCode className="w-3.5 h-3.5 mr-1 text-white" />
            入金・立順・QR管理
            <ArrowRight className="w-3 h-3 ml-1" />
          </Button>

          <Button
            type="button"
            onClick={() => router.push('/admin/participants')}
            className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs h-9 px-3.5 rounded-xl shadow-xs"
          >
            <UserCog className="w-3.5 h-3.5 mr-1 text-amber-400" />
            選手・役員編成
            <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </header>

      <section className="w-full flex flex-col gap-2 bg-white p-6 border border-slate-200/80 rounded-2xl shadow-sm">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          1. エントリー受付期間・状態管理
        </h2>
        <EntryPeriodConfigPanel matchId={tournamentConfig.matchId} />
      </section>

      <section className="w-full flex flex-col gap-2 bg-white p-6 border border-slate-200/80 rounded-2xl shadow-sm">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          2. 名簿取り込み / 立ちグループ編成 (CSV/Wizard)
        </h2>
        <CSVImportScheduleWizard />
      </section>

      <section className="w-full flex flex-col gap-2 bg-white p-6 border border-slate-200/80 rounded-2xl shadow-sm">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          3. 表彰・成績サマリー
        </h2>
        <AwardSummaryCard participants={participants} />
      </section>

      <section className="w-full flex flex-col gap-2 bg-white p-6 border border-slate-200/80 rounded-2xl shadow-sm">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          4. 本部進行管理 / 呼出通知トリガー (FCM連動)
        </h2>
        <MatchControlPanel matchId={tournamentConfig.matchId} />
      </section>

      <section className="w-full flex flex-col gap-2 bg-white p-6 border border-slate-200/80 rounded-2xl shadow-sm">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          5. 競技記録員用 スコア入力コンソール
        </h2>
        <StandScoreContainer tournamentConfig={tournamentConfig} />
      </section>

      <section className="w-full flex flex-col gap-2 bg-white p-6 border border-slate-200/80 rounded-2xl shadow-sm">
        <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
          6. 競射判定 / 順位確定 (射詰・遠近)
        </h2>
        <TieBreakerRankPanel matchId={tournamentConfig.matchId} />
      </section>

      <section className="w-full flex flex-col gap-2 bg-white p-6 border border-slate-200/80 rounded-2xl shadow-sm">
        <div className="flex items-center justify-between pb-2">
          <h2 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            7. 参加者一覧 / 進行状況管理テーブル
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push('/admin/check')}
            className="text-[11px] h-7 border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100 font-bold"
          >
            <QrCode className="w-3 h-3 mr-1 text-emerald-600" />
            入金確認・立順・QR発行専用ページへ
          </Button>
        </div>
        <ParticipantDataTable participants={participants} />
      </section>

      <section className="w-full flex flex-col gap-2 bg-white p-6 border border-red-200 rounded-2xl shadow-sm">
        <h2 className="text-xs font-bold text-red-600 uppercase tracking-wider flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-red-600" />
          8. データベース初期化・データリセット管理
        </h2>
        <DataResetPanel />
      </section>
    </div>
  );
}
