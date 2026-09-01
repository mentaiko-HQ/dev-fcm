"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, query, doc, orderBy } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import { TournamentConfig, ShosaType, StaffRoleType, StandOrderType, ProgressStatus, RankTitleType } from "@/types";
import { ParticipantDataTable } from "@/components/admin/ParticipantDataTable";
import { StandScoreContainer } from "@/components/admin/StandScoreContainer";
import { MatchControlPanel } from "@/components/admin/MatchControlPanel";
import { CSVImportScheduleWizard } from "@/components/admin/CSVImportScheduleWizard";
import { EntryPeriodConfigPanel } from "@/components/admin/EntryPeriodConfigPanel";
import { TieBreakerRankPanel } from "@/components/admin/TieBreakerRankPanel";
import { AwardSummaryCard } from "@/components/admin/AwardSummaryCard";
import { Button } from "@/components/ui/button";
import { UserCog, ArrowRight, ShieldAlert, ArrowLeft } from "lucide-react";

// フェイルセーフ: Firestore未接続またはドキュメント不在時に使用する安全側デフォルト設定
const DEFAULT_TOURNAMENT_CONFIG: TournamentConfig = {
  matchId: "match_2026_mentaiko",
  title: "第5回めんたいこ杯争奪弓道大会",
  totalStands: 3,
  totalArrows: 8,
  tieBreakerFormat: "射詰",
  status: "IN_PROGRESS",
  currentStandGroup: 1,
  maxStandGroup: 4,
  entryStartDate: "2027-01-01T00:00",
  entryEndDate: "2027-03-20T23:59",
  isEntryEnabled: true,
};

/**
 * フールプルーフ & フェイルセーフ: 立順(1〜5)の型バリデーションおよび安全側フォールバック
 */
function sanitizeStandOrder(val: unknown): StandOrderType {
  const num = typeof val === "number" ? val : Number(val);
  if (num === 1 || num === 2 || num === 3 || num === 4 || num === 5) {
    return num;
  }
  return 1;
}

/**
 * フールプルーフ & フェイルセーフ: 所作（肌脱ぎ / 襷掛け）のバリデーション
 */
function sanitizeShosa(val: unknown): ShosaType {
  if (val === "襷掛け") return "襷掛け";
  return "肌脱ぎ";
}

/**
 * フールプルーフ & フェイルセーフ: 称号・段位のバリデーション
 */
function sanitizeRankTitle(val: unknown): RankTitleType {
  if (val === "称号を取得している" || val === "段位は四段以上" || val === "段位は三段以下") {
    return val;
  }
  return "段位は三段以下";
}

/**
 * フールプルーフ & フェイルセーフ: 役員役割のバリデーション
 */
function sanitizeStaffRole(val: unknown): StaffRoleType {
  const validRoles: StaffRoleType[] = ["進行", "的前", "招集", "記録", "カメラマン", "運営", "無し"];
  if (typeof val === "string" && validRoles.includes(val as StaffRoleType)) {
    return val as StaffRoleType;
  }
  return "無し";
}

/**
 * フールプルーフ & フェイルセーフ: 進行状態のバリデーション
 */
function sanitizeProgressStatus(val: unknown): ProgressStatus {
  const validStatuses: ProgressStatus[] = ["WAITING", "CALLED", "SHOOTING", "COMPLETED"];
  if (typeof val === "string" && validStatuses.includes(val as ProgressStatus)) {
    return val as ProgressStatus;
  }
  return "WAITING";
}

export default function AdminConsolePage() {
  const router = useRouter();
  const [tournamentConfig, setTournamentConfig] = useState<TournamentConfig>(DEFAULT_TOURNAMENT_CONFIG);
  const [participants, setParticipants] = useState<Participant[]>([]);

  // matches ドキュメントより大会設定・エントリー期間設定をリアルタイム購読
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const matchDocRef = doc(db, "matches", tournamentConfig.matchId);
    const unsubscribe = onSnapshot(
      matchDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<TournamentConfig>;
          setTournamentConfig((prev: TournamentConfig) => ({
            ...prev,
            ...data,
            title: typeof data.title === "string" ? data.title : prev.title,
            maxStandGroup: typeof data.maxStandGroup === "number" ? data.maxStandGroup : prev.maxStandGroup,
            currentStandGroup: typeof data.currentStandGroup === "number" ? data.currentStandGroup : prev.currentStandGroup,
            entryStartDate: typeof data.entryStartDate === "string" ? data.entryStartDate : prev.entryStartDate,
            entryEndDate: typeof data.entryEndDate === "string" ? data.entryEndDate : prev.entryEndDate,
            isEntryEnabled: typeof data.isEntryEnabled === "boolean" ? data.isEntryEnabled : prev.isEntryEnabled,
          }));
        }
      },
      (error) => {
        console.error("【エラーログ】matchesドキュメント購読失敗:", error);
      }
    );

    return () => unsubscribe();
  }, [tournamentConfig.matchId]);

  // entries コレクションより選手データを購読（rankTitle プロパティ等の型安全性を完全担保）
  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const entriesQuery = query(collection(db, "entries"), orderBy("bibNumber", "asc"));
    const unsubscribe = onSnapshot(
      entriesQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const loaded: Participant[] = [];
          snapshot.forEach((docSnap) => {
            const raw = docSnap.data();
            loaded.push({
              id: docSnap.id,
              bibNumber: typeof raw.bibNumber === "number" ? raw.bibNumber : Number(raw.bibNumber) || 1,
              name: typeof raw.name === "string" ? raw.name : "選手名未設定",
              nameKana: typeof raw.nameKana === "string" ? raw.nameKana : "",
              organization: typeof raw.organization === "string" ? raw.organization : "",
              shosa: sanitizeShosa(raw.shosa),
              rankTitle: sanitizeRankTitle(raw.rankTitle),
              staffRole: sanitizeStaffRole(raw.staffRole),
              staffDutyShift: raw.staffDutyShift || "無し",
              isStaffVolunteer: Boolean(raw.isStaffVolunteer),
              needsSupport: Boolean(raw.needsSupport),
              standGroup: typeof raw.standGroup === "number" ? raw.standGroup : Number(raw.standGroup) || 1,
              standOrder: sanitizeStandOrder(raw.standOrder),
              progressStatus: sanitizeProgressStatus(raw.progressStatus),
              qualificationStatus: raw.qualificationStatus || "ACTIVE",
              stand1_arrows: Array.isArray(raw.stand1_arrows) ? raw.stand1_arrows : [],
              stand2_arrows: Array.isArray(raw.stand2_arrows) ? raw.stand2_arrows : [],
              stand3_arrows: Array.isArray(raw.stand3_arrows) ? raw.stand3_arrows : [],
              totalHits: typeof raw.totalHits === "number" ? raw.totalHits : Number(raw.totalHits) || 0,
              totalShots: typeof raw.totalShots === "number" ? raw.totalShots : Number(raw.totalShots) || 0,
              isPerfect: Boolean(raw.isPerfect),
              enkinRank: typeof raw.enkinRank === "number" ? raw.enkinRank : null,
              finalRank: typeof raw.finalRank === "number" ? raw.finalRank : null,
              userId: typeof raw.userId === "string" ? raw.userId : undefined,
              representativeName: typeof raw.representativeName === "string" ? raw.representativeName : "",
              representativeEmail: typeof raw.representativeEmail === "string" ? raw.representativeEmail : "",
              representativePhone: typeof raw.representativePhone === "string" ? raw.representativePhone : "",
              representativeOrganization: typeof raw.representativeOrganization === "string" ? raw.representativeOrganization : "",
              notes: typeof raw.notes === "string" ? raw.notes : "",
              agreedAt: typeof raw.agreedAt === "number" ? raw.agreedAt : undefined,
              updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
            });
          });
          setParticipants(loaded);
        } else {
          setParticipants([]);
        }
      },
      (error) => {
        console.error("【エラーログ】entriesコレクション購読失敗:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  return (
    <div className="w-full min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-5xl flex flex-col gap-6 mx-auto">
        
        {/* 本部運営ヘッダー */}
        <header className="border-b border-slate-800 pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-500" />
              <h1 className="text-xl font-bold text-white">{tournamentConfig.title} - 本部運営管理</h1>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              個人戦専用（午前の部:一手2立 / 午後の部:四矢1立・全8射的中制・優勝射詰/2位以降遠近）
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/")}
              className="text-xs h-9 bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              選手用ポータルへ
            </Button>
            <Button
              type="button"
              onClick={() => router.push("/admin/participants")}
              className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs h-9 px-4 shadow shadow-amber-500/20"
            >
              <UserCog className="w-4 h-4 mr-1.5" />
              選手編成・役員シフト管理
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </header>

        {/* 1. エントリー受付期間・状態管理 */}
        <section className="flex flex-col gap-2 bg-slate-900/50 p-4 border border-slate-800 rounded-lg">
          <h2 className="text-xs font-bold text-amber-400 uppercase tracking-wider">1. エントリー受付期間・状態管理</h2>
          <EntryPeriodConfigPanel matchId={tournamentConfig.matchId} />
        </section>

        {/* 2. 名簿取り込み / 立ちグループ編成 */}
        <section className="flex flex-col gap-2 bg-slate-900/50 p-4 border border-slate-800 rounded-lg">
          <h2 className="text-xs font-bold text-amber-400 uppercase tracking-wider">2. 名簿取り込み / 立ちグループ編成 (CSV/Wizard)</h2>
          <CSVImportScheduleWizard />
        </section>

        {/* 3. 表彰・成績サマリー */}
        <section className="flex flex-col gap-2 bg-slate-900/50 p-4 border border-slate-800 rounded-lg">
          <h2 className="text-xs font-bold text-amber-400 uppercase tracking-wider">3. 表彰・成績サマリー</h2>
          <AwardSummaryCard participants={participants} />
        </section>

        {/* 4. 本部進行管理 / 呼出通知トリガー */}
        <section className="flex flex-col gap-2 bg-slate-900/50 p-4 border border-slate-800 rounded-lg">
          <h2 className="text-xs font-bold text-amber-400 uppercase tracking-wider">4. 本部進行管理 / 呼出通知トリガー (FCM連動)</h2>
          <MatchControlPanel matchId={tournamentConfig.matchId} />
        </section>

        {/* 5. 競技記録員用 スコア入力コンソール */}
        <section className="flex flex-col gap-2 bg-slate-900/50 p-4 border border-slate-800 rounded-lg">
          <h2 className="text-xs font-bold text-amber-400 uppercase tracking-wider">5. 競技記録員用 スコア入力コンソール</h2>
          <StandScoreContainer tournamentConfig={tournamentConfig} />
        </section>

        {/* 6. 競射判定 / 順位確定 */}
        <section className="flex flex-col gap-2 bg-slate-900/50 p-4 border border-slate-800 rounded-lg">
          <h2 className="text-xs font-bold text-amber-400 uppercase tracking-wider">6. 競射判定 / 順位確定 (射詰・遠近)</h2>
          <TieBreakerRankPanel matchId={tournamentConfig.matchId} />
        </section>

        {/* 7. 参加者一覧 / 進行状況管理 */}
        <section className="flex flex-col gap-2 bg-slate-900/50 p-4 border border-slate-800 rounded-lg">
          <h2 className="text-xs font-bold text-amber-400 uppercase tracking-wider">7. 参加者一覧 / 進行状況管理テーブル</h2>
          <ParticipantDataTable />
        </section>

      </div>
    </div>
  );
}