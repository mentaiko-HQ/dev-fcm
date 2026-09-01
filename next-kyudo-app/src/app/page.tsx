"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, query, doc, orderBy } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import {
  TournamentConfig,
  ProgressStatus,
  ShosaType,
  StaffRoleType,
  StandOrderType,
  HitResult,
  RankTitleType
} from "@/types";
import { TeamSelectForm } from "@/components/shared/TeamSelectForm";
import { AwardSummaryCard } from "@/components/admin/AwardSummaryCard";
import { setupForegroundMessageListener, playNotificationSound, triggerDeviceVibration } from "@/lib/fcm";
import { Bell, Volume2, Clock, Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";

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

function sanitizeStandOrder(val: unknown): StandOrderType {
  const num = typeof val === "number" ? val : Number(val);
  if (num === 1 || num === 2 || num === 3 || num === 4 || num === 5) {
    return num;
  }
  return 1;
}

function sanitizeShosa(val: unknown): ShosaType {
  if (val === "襷掛け") return "襷掛け";
  return "肌脱ぎ";
}

function sanitizeRankTitle(val: unknown): RankTitleType {
  if (val === "称号を取得している" || val === "段位は四段以上" || val === "段位は三段以下") {
    return val;
  }
  return "段位は三段以下";
}

function sanitizeStaffRole(val: unknown): StaffRoleType {
  const validRoles: StaffRoleType[] = ["進行", "的前", "招集", "記録", "カメラマン", "運営", "無し"];
  if (typeof val === "string" && validRoles.includes(val as StaffRoleType)) {
    return val as StaffRoleType;
  }
  return "無し";
}

function sanitizeProgressStatus(val: unknown): ProgressStatus {
  const validStatuses: ProgressStatus[] = ["WAITING", "CALLED", "SHOOTING", "COMPLETED"];
  if (typeof val === "string" && validStatuses.includes(val as ProgressStatus)) {
    return val as ProgressStatus;
  }
  return "WAITING";
}

export default function PlayerPortalPage() {
  const router = useRouter();
  const [tournamentConfig, setTournamentConfig] = useState<TournamentConfig>(DEFAULT_TOURNAMENT_CONFIG);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [bannerNotification, setBannerNotification] = useState<{ title: string; body: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");

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
            currentStandGroup: typeof data.currentStandGroup === "number" ? data.currentStandGroup : prev.currentStandGroup,
            maxStandGroup: typeof data.maxStandGroup === "number" ? data.maxStandGroup : prev.maxStandGroup,
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

  useEffect(() => {
    const unsubscribe = setupForegroundMessageListener((payload) => {
      if (payload.notification) {
        setBannerNotification({
          title: payload.notification.title || "【招集通知】",
          body: payload.notification.body || "出番が近づいています。控席へ入場してください。",
        });
      }
    });

    return () => unsubscribe();
  }, []);

  const handleTestSoundAndVibe = () => {
    playNotificationSound();
    triggerDeviceVibration([300, 100, 300, 100, 300]);
  };

  const filteredParticipants = participants.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.nameKana.toLowerCase().includes(q) ||
      p.organization.toLowerCase().includes(q) ||
      String(p.bibNumber).includes(q) ||
      (p.representativeName || "").toLowerCase().includes(q)
    );
  });

  const calledGroup = tournamentConfig.currentStandGroup + 2;

  return (
    /* 【修正ポイント】
      - 外側のラッパーを w-full min-h-screen に設定
      - flex flex-col items-center を指定し、内部の各セクション・ヘッダーを一貫して中央寄せ
      - mx-auto と適切な padding (p-4 sm:p-6 lg:p-8) を付与
    */
    <div className="w-full min-h-screen bg-slate-100 flex flex-col items-center justify-start p-4 sm:p-6 lg:p-8">
      <main className="w-full max-w-5xl flex flex-col items-center gap-6 mx-auto">
        
        {/* 招集通知ポップアップバナー */}
        {bannerNotification && (
          <div className="w-full p-4 bg-amber-500 text-white rounded-lg shadow-lg flex items-center justify-between animate-bounce">
            <div className="flex items-center gap-3">
              <Bell className="w-6 h-6 shrink-0" />
              <div>
                <p className="font-bold text-sm">{bannerNotification.title}</p>
                <p className="text-xs">{bannerNotification.body}</p>
              </div>
            </div>
            <button
              onClick={() => setBannerNotification(null)}
              className="text-xs bg-white text-amber-900 px-3 py-1 rounded font-bold hover:bg-amber-50"
            >
              閉じる
            </button>
          </div>
        )}

        {/* 選手用ヘッダー */}
        <header className="w-full pb-4 border-b border-slate-300 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">{tournamentConfig.title}</h1>
              <span className="text-xs bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded">選手用ポータル</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              個人戦（午前の部:一手2立 / 午後の部:四矢1立・全8射的中制）
            </p>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleTestSoundAndVibe}
              className="text-xs font-semibold h-8 bg-white border-slate-300"
            >
              <Volume2 className="w-3.5 h-3.5 mr-1" />
              通知音・振動テスト
            </Button>
            <a
              href="/guidelines"
              className="text-xs text-slate-600 hover:text-slate-900 underline font-medium px-2 py-1"
            >
              大会要項・規約
            </a>
            <a
              href="/admin"
              className="text-xs text-slate-400 hover:text-slate-700 underline font-medium px-2 py-1"
            >
              運営管理画面へ
            </a>
          </div>
        </header>

        {/* 射場進行ステータスボード（速報） */}
        <section className="w-full grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-col justify-between">
            <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-green-600" /> 現在競技中（射場）
            </span>
            <div className="my-2">
              <span className="text-3xl font-black text-slate-900">
                {tournamentConfig.currentStandGroup === 0 ? "開始前" : `第 ${String(tournamentConfig.currentStandGroup).padStart(2, "0")} 立グループ`}
              </span>
            </div>
            <p className="text-xs text-slate-400">全 {tournamentConfig.maxStandGroup} 立グループ</p>
          </div>

          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg shadow-sm flex flex-col justify-between">
            <span className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-amber-600" /> 控席招集中（2立前呼出）
            </span>
            <div className="my-2">
              <span className="text-3xl font-black text-amber-900">
                第 {String(calledGroup).padStart(2, "0")} 立グループ
              </span>
            </div>
            <p className="text-xs text-amber-700">該当グループの選手は速やかに弓道場控席へ入場してください</p>
          </div>
        </section>

        {/* 選手用 端末招集通知設定フォーム */}
        <section className="w-full flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">招集通知設定</h2>
          <TeamSelectForm />
        </section>

        {/* 大会表彰サマリー */}
        <section className="w-full flex flex-col gap-2">
          <AwardSummaryCard participants={participants} />
        </section>

        {/* 全選手成績速報一覧テーブル（読み取り専用・検索付き） */}
        <section className="w-full bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">競技成績速報</h2>
              <p className="text-xs text-slate-500">全選手の行射結果・的中数がリアルタイム更新されます</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="ゼッケン・名前・所属で検索..."
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 w-full text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="p-2.5">ゼッケン</th>
                  <th className="p-2.5">立グループ / 立順</th>
                  <th className="p-2.5">選手氏名</th>
                  <th className="p-2.5">所属団体</th>
                  <th className="p-2.5">所作</th>
                  <th className="p-2.5">称号・段位</th>
                  <th className="p-2.5">役員役割</th>
                  <th className="p-2.5">1立目(2射)</th>
                  <th className="p-2.5">2立目(2射)</th>
                  <th className="p-2.5">3立目(4射)</th>
                  <th className="p-2.5 text-right">総的中</th>
                  <th className="p-2.5 text-center">確定順位</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredParticipants.length > 0 ? (
                  filteredParticipants.map((p: Participant) => {
                    const s1 = (p.stand1_arrows || []).map((v: HitResult) => (v === 1 ? "〇" : "✕")).join("");
                    const s2 = (p.stand2_arrows || []).map((v: HitResult) => (v === 1 ? "〇" : "✕")).join("");
                    const s3 = (p.stand3_arrows || []).map((v: HitResult) => (v === 1 ? "〇" : "✕")).join("");

                    return (
                      <tr key={p.id} className="hover:bg-slate-50/80">
                        <td className="p-2.5 font-bold text-slate-900">No.{p.bibNumber}</td>
                        <td className="p-2.5 text-slate-700">
                          第{String(p.standGroup).padStart(2, "0")}立 - {p.standOrder}番
                        </td>
                        <td className="p-2.5">
                          <div className="font-bold text-slate-900 flex items-center gap-1">
                            {p.name}
                            {p.isPerfect && <Trophy className="w-3.5 h-3.5 text-red-600 shrink-0" />}
                            {p.needsSupport && (
                              <span className="text-[10px] bg-amber-100 text-amber-900 px-1 py-0.2 rounded font-bold">
                                サポート要
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">{p.nameKana}</div>
                        </td>
                        <td className="p-2.5 text-slate-600">{p.organization || "-"}</td>
                        <td className="p-2.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            p.shosa === "肌脱ぎ" ? "bg-slate-100 text-slate-800" : "bg-purple-100 text-purple-800"
                          }`}>
                            {p.shosa}
                          </span>
                        </td>
                        <td className="p-2.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                            p.rankTitle === "称号を取得している"
                              ? "bg-amber-100 text-amber-950 border-amber-300"
                              : p.rankTitle === "段位は四段以上"
                              ? "bg-blue-100 text-blue-950 border-blue-300"
                              : "bg-slate-100 text-slate-800 border-slate-300"
                          }`}>
                            {p.rankTitle || "段位は三段以下"}
                          </span>
                        </td>
                        <td className="p-2.5">
                          {p.staffRole !== "無し" ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                              {p.staffRole}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="p-2.5 font-mono text-slate-700">{s1 || "--"}</td>
                        <td className="p-2.5 font-mono text-slate-700">{s2 || "--"}</td>
                        <td className="p-2.5 font-mono text-slate-700">{s3 || "----"}</td>
                        <td className="p-2.5 text-right font-bold pr-3">
                          <span className="text-red-600 text-sm">{p.totalHits}</span>
                          <span className="text-slate-400 text-xs"> / 8</span>
                        </td>
                        <td className="p-2.5 text-center">
                          {p.finalRank ? (
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                              p.finalRank === 1 ? "bg-amber-100 text-amber-900 border border-amber-300 font-black" :
                              p.finalRank === 2 ? "bg-slate-200 text-slate-900 border border-slate-300" :
                              p.finalRank === 3 ? "bg-amber-50 text-amber-800 border border-amber-200" :
                              "bg-slate-100 text-slate-700"
                            }`}>
                              第 {p.finalRank} 位
                            </span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={12} className="p-6 text-center text-slate-400">
                      該当する選手が見つかりません。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}