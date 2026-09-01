"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
  SortingState,
  ColumnFiltersState,
} from "@tanstack/react-table";
import { collection, onSnapshot, query, orderBy, writeBatch, doc, getDocs } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import { ProgressStatus, QualificationStatus, ShosaType, StaffRoleType, StandOrderType, HitResult, RankTitleType } from "@/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Search, RefreshCcw, Trophy, Download, AlertTriangle, Trash2, Filter } from "lucide-react";

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

function sanitizeQualificationStatus(val: unknown): QualificationStatus {
  const validQuals: QualificationStatus[] = ["ACTIVE", "ABSENT", "WITHDRAWN", "DISQUALIFIED"];
  if (typeof val === "string" && validQuals.includes(val as QualificationStatus)) {
    return val as QualificationStatus;
  }
  return "ACTIVE";
}

export function ParticipantDataTable() {
  const [data, setData] = useState<Participant[]>([]);
  const [sorting, setSorting] = useState<SortingState>([{ id: "bibNumber", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState<string>("");
  const [selectedShosa, setSelectedShosa] = useState<string>("ALL");
  const [selectedRank, setSelectedRank] = useState<string>("ALL");
  const [selectedRole, setSelectedRole] = useState<string>("ALL");
  const [selectedProgress, setSelectedProgress] = useState<string>("ALL");

  const [showScoreResetModal, setShowScoreResetModal] = useState<boolean>(false);
  const [isResettingScores, setIsResettingScores] = useState<boolean>(false);
  const [resetStatusMessage, setResetStatusMessage] = useState<string>("");

  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    const entriesQuery = query(collection(firestoreInstance, "entries"), orderBy("bibNumber", "asc"));

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
              qualificationStatus: sanitizeQualificationStatus(raw.qualificationStatus),
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
              updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
            });
          });
          setData(loaded);
        } else {
          setData([]);
        }
      },
      (error) => {
        console.warn("【警告】entriesコレクション購読失敗:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleResetFilters = () => {
    setGlobalFilter("");
    setSelectedShosa("ALL");
    setSelectedRank("ALL");
    setSelectedRole("ALL");
    setSelectedProgress("ALL");
    setSorting([{ id: "bibNumber", desc: false }]);
  };

  const handleExecuteScoreReset = async () => {
    setData((prev) =>
      prev.map((p) => ({
        ...p,
        totalHits: 0,
        totalShots: 0,
        isPerfect: false,
        enkinRank: null,
        finalRank: null,
        stand1_arrows: [],
        stand2_arrows: [],
        stand3_arrows: [],
      }))
    );

    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setShowScoreResetModal(false);
      setResetStatusMessage("【ローカル】全選手の成績数値をクリアしました。");
      return;
    }

    setIsResettingScores(true);
    setResetStatusMessage("全成績データを初期化中...");

    try {
      const firestoreInstance = db;
      const batch = writeBatch(firestoreInstance);

      const entriesSnapshot = await getDocs(collection(firestoreInstance, "entries"));
      entriesSnapshot.forEach((docSnap) => {
        batch.update(doc(firestoreInstance, "entries", docSnap.id), {
          totalHits: 0,
          totalShots: 0,
          isPerfect: false,
          enkinRank: null,
          finalRank: null,
          stand1_arrows: [],
          stand2_arrows: [],
          stand3_arrows: [],
          updatedAt: Date.now(),
        });
      });

      const scoresSnapshot = await getDocs(collection(firestoreInstance, "scores"));
      scoresSnapshot.forEach((docSnap) => {
        const scoreData = docSnap.data();
        const playerScores = scoreData.playerScores || {};
        const resetPlayerScores: Record<string, unknown> = {};

        Object.keys(playerScores).forEach((playerId) => {
          const p = playerScores[playerId];
          resetPlayerScores[playerId] = {
            ...p,
            stand1_arrows: [],
            stand2_arrows: [],
            stand3_arrows: [],
            tieBreakerArrows: [],
            totalHits: 0,
            isCompleted: false,
            isPerfect: false,
            enkinRank: null,
            updatedAt: Date.now(),
          };
        });

        batch.update(doc(firestoreInstance, "scores", docSnap.id), {
          playerScores: resetPlayerScores,
          updatedAt: Date.now(),
        });
      });

      await batch.commit();
      setShowScoreResetModal(false);
      setResetStatusMessage("【成功】全選手の成績データ（全8射分）が完全に初期化されました。");
    } catch (error: unknown) {
      console.error("【エラーログ】成績初期化失敗:", error);
      setResetStatusMessage("初期化に失敗しました。通信環境を確認してください。");
    } finally {
      setIsResettingScores(false);
    }
  };

  const getProgressBadge = (status: ProgressStatus) => {
    switch (status) {
      case "SHOOTING":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-800 border border-green-300 animate-pulse">行射中</span>;
      case "CALLED":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">招集中</span>;
      case "WAITING":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-300">待機中</span>;
      case "COMPLETED":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 border border-blue-300">競技終了</span>;
      default:
        return <span className="text-xs text-slate-400">-</span>;
    }
  };

  const getQualificationBadge = (qual: QualificationStatus) => {
    switch (qual) {
      case "ACTIVE":
        return null;
      case "ABSENT":
        return <span className="text-[10px] bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded border border-red-200">欠席</span>;
      case "WITHDRAWN":
        return <span className="text-[10px] bg-orange-100 text-orange-700 font-bold px-1.5 py-0.5 rounded border border-orange-200">棄権</span>;
      case "DISQUALIFIED":
        return <span className="text-[10px] bg-red-200 text-red-900 font-bold px-1.5 py-0.5 rounded border border-red-300">失格</span>;
      default:
        return null;
    }
  };

  const handleExportCSV = () => {
    const headers = [
      "ゼッケン番号",
      "立ちグループ",
      "立順",
      "選手氏名",
      "ふりがな",
      "所属団体名",
      "所作",
      "称号・段位",
      "申込代表者名",
      "代表者電話番号",
      "代表者メールアドレス",
      "役員役割",
      "役員担当時間帯",
      "役員協力希望",
      "サポート希望",
      "1立目(2射)",
      "2立目(2射)",
      "3立目(4射)",
      "総的中数",
      "総射数",
      "8射皆中",
      "遠近順位",
      "確定順位",
      "備考"
    ];
    const rows = filteredData.map((p) => [
      p.bibNumber,
      `第${String(p.standGroup).padStart(2, "0")}立`,
      `${p.standOrder}番`,
      `"${p.name}"`,
      `"${p.nameKana}"`,
      `"${p.organization}"`,
      p.shosa,
      p.rankTitle,
      `"${p.representativeName || ""}"`,
      `"${p.representativePhone || ""}"`,
      `"${p.representativeEmail || ""}"`,
      p.staffRole,
      p.staffDutyShift || "無し",
      p.isStaffVolunteer ? "希望あり" : "なし",
      p.needsSupport ? "要サポート" : "不要",
      `"${(p.stand1_arrows || []).map((v: HitResult) => (v === 1 ? "〇" : "✕")).join("")}"`,
      `"${(p.stand2_arrows || []).map((v: HitResult) => (v === 1 ? "〇" : "✕")).join("")}"`,
      `"${(p.stand3_arrows || []).map((v: HitResult) => (v === 1 ? "〇" : "✕")).join("")}"`,
      p.totalHits,
      p.totalShots,
      p.isPerfect ? "8射皆中" : "",
      p.enkinRank ? `${p.enkinRank}位` : "",
      p.finalRank ? `${p.finalRank}位` : "",
      `"${(p.notes || "").replace(/"/g, '""')}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `mentaiko_cup_participants_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const columns = useMemo<ColumnDef<Participant>[]>(
    () => [
      {
        accessorKey: "bibNumber",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 px-1 text-xs font-bold text-slate-900 hover:bg-slate-200"
          >
            ゼッケン
            <ArrowUpDown className="ml-1 h-3 w-3 text-slate-600" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="font-bold text-slate-900 text-center w-14 font-mono text-xs">
            No.{row.getValue<number>("bibNumber")}
          </div>
        ),
      },
      {
        id: "standPosition",
        header: () => <span className="font-bold text-slate-900 text-xs">立グループ / 立順</span>,
        cell: ({ row }) => (
          <div className="font-semibold text-slate-800 text-xs whitespace-nowrap">
            第{String(row.original.standGroup).padStart(2, "0")}立 - <span className="font-bold text-slate-900">{row.original.standOrder}番</span>
          </div>
        ),
      },
      {
        accessorKey: "name",
        header: () => <span className="font-bold text-slate-900 text-xs">選手氏名</span>,
        cell: ({ row }) => (
          <div>
            <div className="font-bold text-slate-900 text-xs flex items-center gap-1.5 flex-wrap">
              <span>{row.getValue<string>("name")}</span>
              {row.original.isPerfect && (
                <span title="8射皆中" className="inline-flex items-center">
                  <Trophy className="w-3.5 h-3.5 text-red-600 shrink-0" />
                </span>
              )}
              {row.original.needsSupport && (
                <span className="text-[10px] bg-amber-100 text-amber-900 border border-amber-300 px-1 rounded font-bold">
                  サポート要
                </span>
              )}
              {row.original.isStaffVolunteer && (
                <span className="text-[10px] bg-emerald-100 text-emerald-900 border border-emerald-300 px-1 rounded font-bold">
                  役員希望
                </span>
              )}
              {getQualificationBadge(row.original.qualificationStatus)}
            </div>
            <div className="text-[10px] text-slate-500">{row.original.nameKana}</div>
          </div>
        ),
      },
      {
        accessorKey: "organization",
        header: () => <span className="font-bold text-slate-900 text-xs">所属団体名</span>,
        cell: ({ row }) => (
          <span className="text-xs text-slate-700 font-medium whitespace-nowrap">
            {row.getValue<string>("organization") || "-"}
          </span>
        ),
      },
      {
        accessorKey: "shosa",
        header: () => <span className="font-bold text-slate-900 text-xs">所作</span>,
        cell: ({ row }) => {
          const shosa = row.getValue<ShosaType>("shosa");
          return (
            <span className={`text-xs px-2 py-0.5 rounded font-bold border ${
              shosa === "肌脱ぎ"
                ? "bg-slate-100 text-slate-800 border-slate-300"
                : "bg-purple-100 text-purple-900 border-purple-300"
            }`}>
              {shosa}
            </span>
          );
        },
      },
      {
        accessorKey: "rankTitle",
        header: () => <span className="font-bold text-slate-900 text-xs">称号・段位</span>,
        cell: ({ row }) => {
          const rankTitle = row.getValue<RankTitleType>("rankTitle");
          return (
            <span className={`text-xs px-2 py-0.5 rounded font-bold border whitespace-nowrap ${
              rankTitle === "称号を取得している"
                ? "bg-amber-100 text-amber-950 border-amber-300"
                : rankTitle === "段位は四段以上"
                ? "bg-blue-100 text-blue-950 border-blue-300"
                : "bg-slate-100 text-slate-800 border-slate-300"
            }`}>
              {rankTitle || "段位は三段以下"}
            </span>
          );
        },
      },
      {
        accessorKey: "representativeName",
        header: () => <span className="font-bold text-slate-900 text-xs">申込代表者</span>,
        cell: ({ row }) => (
          <div className="text-xs whitespace-nowrap">
            <span className="font-medium text-slate-900">{row.original.representativeName || "-"}</span>
            {row.original.representativePhone && (
              <div className="text-[10px] text-slate-500 font-mono">{row.original.representativePhone}</div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "staffRole",
        header: () => <span className="font-bold text-slate-900 text-xs">役員種類・時間帯</span>,
        cell: ({ row }) => {
          const role = row.getValue<StaffRoleType>("staffRole");
          const shift = row.original.staffDutyShift || "無し";
          return role !== "無し" ? (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs px-2 py-0.5 rounded font-bold bg-amber-100 text-amber-950 border border-amber-350 w-fit">
                {role}
              </span>
              <span className="text-[10px] text-slate-600 font-bold">
                時間帯: {shift}
              </span>
            </div>
          ) : (
            <span className="text-xs text-slate-400">-</span>
          );
        },
      },
      {
        id: "standsDetail",
        header: () => <span className="font-bold text-slate-900 text-xs">行射詳細 (1立 / 2立 / 3立)</span>,
        cell: ({ row }) => {
          const s1 = (row.original.stand1_arrows || []).map((v: HitResult) => (v === 1 ? "〇" : "✕")).join("");
          const s2 = (row.original.stand2_arrows || []).map((v: HitResult) => (v === 1 ? "〇" : "✕")).join("");
          const s3 = (row.original.stand3_arrows || []).map((v: HitResult) => (v === 1 ? "〇" : "✕")).join("");
          return (
            <span className="text-xs font-mono font-semibold text-slate-800 whitespace-nowrap">
              {s1 || "--"} / {s2 || "--"} / {s3 || "----"}
            </span>
          );
        },
      },
      {
        accessorKey: "progressStatus",
        header: () => <span className="font-bold text-slate-900 text-xs">進行状態</span>,
        cell: ({ row }) => getProgressBadge(row.getValue<ProgressStatus>("progressStatus")),
      },
      {
        accessorKey: "totalHits",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 px-1 text-xs font-bold text-slate-900 hover:bg-slate-200"
          >
            的中
            <ArrowUpDown className="ml-1 h-3 w-3 text-slate-600" />
          </Button>
        ),
        cell: ({ row }) => {
          const hits = row.getValue<number>("totalHits");
          const shots = row.original.totalShots;
          return (
            <div className="text-right font-bold pr-2 whitespace-nowrap">
              <span className="text-red-600 text-sm font-black">{hits}</span>
              <span className="text-slate-500 text-xs"> / {shots > 0 ? shots : 8}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "finalRank",
        header: () => <span className="font-bold text-slate-900 text-xs">確定順位</span>,
        cell: ({ row }) => {
          const rank = row.original.finalRank;
          return (
            <div className="text-center font-bold whitespace-nowrap">
              {rank ? (
                <span className={`text-xs px-2 py-0.5 rounded border ${
                  rank === 1 ? "bg-amber-100 text-amber-950 border-amber-400 font-black" :
                  rank === 2 ? "bg-slate-200 text-slate-950 border-slate-400 font-bold" :
                  rank === 3 ? "bg-amber-50 text-amber-900 border-amber-300 font-bold" :
                  "bg-slate-100 text-slate-800 border-slate-300"
                }`}>
                  第 {rank} 位
                </span>
              ) : (
                <span className="text-slate-400 text-xs">-</span>
              )}
            </div>
          );
        },
      },
    ],
    []
  );

  const filteredData = useMemo(() => {
    return data.filter((item: Participant) => {
      if (selectedShosa !== "ALL" && item.shosa !== selectedShosa) return false;
      if (selectedRank !== "ALL" && item.rankTitle !== selectedRank) return false;
      if (selectedRole !== "ALL" && item.staffRole !== selectedRole) return false;
      if (selectedProgress !== "ALL" && item.progressStatus !== selectedProgress) return false;
      if (globalFilter.trim().length > 0) {
        const queryStr = globalFilter.toLowerCase();
        const matchesName = (item.name || "").toLowerCase().includes(queryStr);
        const matchesKana = (item.nameKana || "").toLowerCase().includes(queryStr);
        const matchesOrg = (item.organization || "").toLowerCase().includes(queryStr);
        const matchesBib = String(item.bibNumber).includes(queryStr);
        const matchesRep = (item.representativeName || "").toLowerCase().includes(queryStr);
        if (!matchesName && !matchesKana && !matchesOrg && !matchesBib && !matchesRep) return false;
      }
      return true;
    });
  }, [data, selectedShosa, selectedRank, selectedRole, selectedProgress, globalFilter]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredData,
    columns,
    state: {
      sorting,
      columnFilters,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 10,
      },
    },
  });

  return (
    <div className="w-full bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="ゼッケン・氏名・所属・代表者名で検索..."
              value={globalFilter}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGlobalFilter(e.target.value)}
              className="pl-9 pr-4 py-2 w-full text-xs md:text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-slate-900 font-medium placeholder:text-slate-400"
            />
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              className="h-9 px-3 text-xs font-bold bg-white border-slate-300 text-slate-800 hover:bg-slate-100"
            >
              <RefreshCcw className="h-3.5 w-3.5 mr-1 text-slate-600" />
              条件リセット
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowScoreResetModal(true)}
              className="h-9 px-3 text-xs font-bold text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700 bg-white"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1 text-red-600" />
              全成績初期化 (0中)
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              className="h-9 px-3 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white border-slate-900"
            >
              <Download className="h-3.5 w-3.5 mr-1 text-amber-400" />
              CSV出力
            </Button>
          </div>
        </div>

        {/* ドロップダウンフィルターバー */}
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-md flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 font-bold text-slate-700 shrink-0">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <span>絞り込み条件:</span>
          </div>

          <div className="flex items-center gap-1">
            <label className="text-slate-600 font-medium">所作:</label>
            <select
              value={selectedShosa}
              onChange={(e) => setSelectedShosa(e.target.value)}
              className="p-1.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">全所作</option>
              <option value="肌脱ぎ">肌脱ぎ</option>
              <option value="襷掛け">襷掛け</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <label className="text-slate-600 font-medium">称号・段位:</label>
            <select
              value={selectedRank}
              onChange={(e) => setSelectedRank(e.target.value)}
              className="p-1.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">全称号・段位</option>
              <option value="段位は三段以下">段位は三段以下</option>
              <option value="段位は四段以上">段位は四段以上</option>
              <option value="称号を取得している">称号を取得している</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <label className="text-slate-600 font-medium">役員役割:</label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="p-1.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">全役員役割</option>
              <option value="進行">進行</option>
              <option value="的前">的前</option>
              <option value="招集">招集</option>
              <option value="記録">記録</option>
              <option value="カメラマン">カメラマン</option>
              <option value="運営">運営</option>
              <option value="無し">無し (一般選手)</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <label className="text-slate-600 font-medium">進行状態:</label>
            <select
              value={selectedProgress}
              onChange={(e) => setSelectedProgress(e.target.value)}
              className="p-1.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">全進行状態</option>
              <option value="WAITING">待機中</option>
              <option value="CALLED">招集中</option>
              <option value="SHOOTING">行射中</option>
              <option value="COMPLETED">競技終了</option>
            </select>
          </div>
        </div>
      </div>

      {resetStatusMessage && (
        <p className="text-xs text-center font-bold p-2.5 rounded bg-slate-100 text-slate-800 border border-slate-300">
          {resetStatusMessage}
        </p>
      )}

      <div className="rounded-md border border-slate-300 overflow-x-auto bg-white shadow-2xs">
        <Table>
          <TableHeader className="bg-slate-100 border-b border-slate-300">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-slate-100">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="p-2.5 text-slate-900 font-bold text-xs whitespace-nowrap border-r border-slate-200 last:border-r-0"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody className="divide-y divide-slate-200">
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                  className="hover:bg-slate-50 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className="p-2.5 border-r border-slate-100 last:border-r-0 text-slate-800"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-28 text-center text-slate-500 font-medium">
                  条件に該当する参加選手が見つかりません。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-600 px-1 pt-1">
        <div>
          全 <span className="font-bold text-slate-900">{filteredData.length}</span> 名中{" "}
          {filteredData.length > 0 ? table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1 : 0} -{" "}
          {Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, filteredData.length)} 名を表示
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="h-8 px-2.5 text-xs font-bold border-slate-300 disabled:opacity-40"
          >
            前へ
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="h-8 px-2.5 text-xs font-bold border-slate-300 disabled:opacity-40"
          >
            次へ
          </Button>
        </div>
      </div>

      {showScoreResetModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl border border-slate-300 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h4 className="font-bold text-slate-900 text-base">全選手の個人成績を初期化しますか？</h4>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              この操作を実行すると、<strong>全選手の入力済み的中数（全3立・計8射分）、矢の記録（〇✕）、遠近順位、確定順位が全て「0（未入力）」に初期化</strong>されます。
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowScoreResetModal(false)}
                disabled={isResettingScores}
                className="text-xs font-bold border-slate-300"
              >
                キャンセル
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleExecuteScoreReset}
                disabled={isResettingScores}
                className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs"
              >
                {isResettingScores ? "初期化中..." : "同意して全成績を0クリア"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}