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
import { EntryType, ProgressStatus, QualificationStatus, DivisionType } from "@/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Search, RefreshCcw, Trophy, Download, Shield, User, AlertTriangle, Trash2 } from "lucide-react";

// フールプルーフ: 初期静的データを全て的中0（未入力）として定義
const FALLBACK_PARTICIPANTS: Participant[] = [
  { id: "p1", standNumber: 1, position: "大前", entryType: "TEAM", progressStatus: "SHOOTING", qualificationStatus: "ACTIVE", teamId: "team_01", teamName: "第一立（福岡弓道倶楽部A）", playerName: "佐藤 健一", division: "一般男子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
  { id: "p2", standNumber: 1, position: "中", entryType: "TEAM", progressStatus: "SHOOTING", qualificationStatus: "ACTIVE", teamId: "team_01", teamName: "第一立（福岡弓道倶楽部A）", playerName: "鈴木 隆", division: "一般男子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
  { id: "p3", standNumber: 1, position: "落", entryType: "TEAM", progressStatus: "SHOOTING", qualificationStatus: "ACTIVE", teamId: "team_01", teamName: "第一立（福岡弓道倶楽部A）", playerName: "高橋 誠", division: "一般男子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
  { id: "p4", standNumber: 2, position: "大前", entryType: "TEAM", progressStatus: "CALLED", qualificationStatus: "ACTIVE", teamId: "team_02", teamName: "第二立（博多紅葉会）", playerName: "田中 美咲", division: "一般女子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
  { id: "p5", standNumber: 2, position: "中", entryType: "TEAM", progressStatus: "CALLED", qualificationStatus: "ABSENT", teamId: "team_02", teamName: "第二立（博多紅葉会）", playerName: "渡辺 彩花", division: "一般女子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
  { id: "p6", standNumber: 2, position: "落", entryType: "INDIVIDUAL", progressStatus: "CALLED", qualificationStatus: "ACTIVE", teamId: null, teamName: "個人枠", playerName: "小林 葵", division: "一般女子", totalHits: 0, totalShots: 0, isPerfect: false, enkinRank: null },
];

export function ParticipantDataTable() {
  const [data, setData] = useState<Participant[]>(FALLBACK_PARTICIPANTS);
  const [sorting, setSorting] = useState<SortingState>([{ id: "standNumber", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState<string>("");
  const [selectedDivision, setSelectedDivision] = useState<string>("ALL");
  const [selectedEntryType, setSelectedEntryType] = useState<string>("ALL");
  const [selectedProgress, setSelectedProgress] = useState<string>("ALL");

  // スコア全初期化モーダルの表示制御状態（フールプルーフ）
  const [showScoreResetModal, setShowScoreResetModal] = useState<boolean>(false);
  const [isResettingScores, setIsResettingScores] = useState<boolean>(false);
  const [resetStatusMessage, setResetStatusMessage] = useState<string>("");

  useEffect(() => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) return;

    const firestoreInstance = db;
    const entriesQuery = query(collection(firestoreInstance, "entries"), orderBy("standNumber", "asc"));

    const unsubscribe = onSnapshot(
      entriesQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const loaded: Participant[] = [];
          snapshot.forEach((docSnap) => {
            const raw = docSnap.data();
            loaded.push({
              id: docSnap.id,
              standNumber: Number(raw.standNumber) || 1,
              position: raw.position || "大前",
              entryType: raw.entryType || "TEAM",
              progressStatus: raw.progressStatus || "WAITING",
              qualificationStatus: raw.qualificationStatus || "ACTIVE",
              teamId: raw.teamId || null,
              teamName: raw.teamName || (raw.entryType === "INDIVIDUAL" ? "個人枠" : "所属未設定"),
              playerName: raw.playerName || "選手名未設定",
              division: raw.division || "一般男子",
              totalHits: Number(raw.totalHits) || 0,
              totalShots: Number(raw.totalShots) || 0,
              isPerfect: Boolean(raw.isPerfect),
              enkinRank: typeof raw.enkinRank === "number" ? raw.enkinRank : null,
              finalRank: typeof raw.finalRank === "number" ? raw.finalRank : null,
            });
          });
          setData(loaded);
        }
      },
      (error) => {
        console.warn("【警告】entriesコレクション購読失敗:", error);
      }
    );

    return () => unsubscribe();
  }, []);

  // 1. 検索・絞り込みフィルターのリセット処理
  const handleResetFilters = () => {
    setGlobalFilter("");
    setSelectedDivision("ALL");
    setSelectedEntryType("ALL");
    setSelectedProgress("ALL");
    setSorting([{ id: "standNumber", desc: false }]);
  };

  // 2. 全選手の成績数値（的中数・射数・矢配列・遠近順位・確定順位）のFirestore一括クリア処理（フェイルセーフ）
  const handleExecuteScoreReset = async () => {
    // ローカル State を即座にゼロ初期化（フェイルセーフ）
    setData((prev) =>
      prev.map((p) => ({
        ...p,
        totalHits: 0,
        totalShots: 0,
        isPerfect: false,
        enkinRank: null,
        finalRank: null,
        preliminaryArrows: [],
        finalArrows: [],
      }))
    );

    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setShowScoreResetModal(false);
      setResetStatusMessage("【ローカル】全選手の成績数値をクリアしました。");
      return;
    }

    setIsResettingScores(true);
    setResetStatusMessage("Firestore上の全成績データをクリア中...");

    try {
      const firestoreInstance = db;
      const batch = writeBatch(firestoreInstance);

      // A. entries コレクションのスコアフィールドを全件初期化
      const entriesSnapshot = await getDocs(collection(firestoreInstance, "entries"));
      entriesSnapshot.forEach((docSnap) => {
        batch.update(doc(firestoreInstance, "entries", docSnap.id), {
          totalHits: 0,
          totalShots: 0,
          isPerfect: false,
          enkinRank: null,
          finalRank: null,
          preliminaryArrows: [],
          finalArrows: [],
          updatedAt: Date.now(),
        });
      });

      // B. scores コレクションの各選手矢配列・的中数を全件初期化
      const scoresSnapshot = await getDocs(collection(firestoreInstance, "scores"));
      scoresSnapshot.forEach((docSnap) => {
        const scoreData = docSnap.data();
        const playerScores = scoreData.playerScores || {};
        const resetPlayerScores: Record<string, unknown> = {};

        Object.keys(playerScores).forEach((playerId) => {
          const p = playerScores[playerId];
          resetPlayerScores[playerId] = {
            ...p,
            preliminaryArrows: [],
            finalArrows: [],
            arrows: [],
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
          totalTeamHits: 0,
          updatedAt: Date.now(),
        });
      });

      await batch.commit();
      setShowScoreResetModal(false);
      setResetStatusMessage("【成功】全選手の成績データ（的中数・射数・矢配列）が完全に初期化されました。");
    } catch (error: unknown) {
      console.error("【エラーログ】成績データ初期化中に例外が発生しました:", error);
      setResetStatusMessage("成績初期化に失敗しました。通信環境を確認してください。");
    } finally {
      setIsResettingScores(false);
    }
  };

  const getProgressBadge = (status: ProgressStatus) => {
    switch (status) {
      case "SHOOTING":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-800 animate-pulse">行射中</span>;
      case "CALLED":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-amber-100 text-amber-800">招集中</span>;
      case "WAITING":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">待機中</span>;
      case "COMPLETED":
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">終了</span>;
      default:
        return <span className="text-xs text-slate-500">-</span>;
    }
  };

  const getQualificationBadge = (qual: QualificationStatus) => {
    switch (qual) {
      case "ACTIVE":
        return <span className="text-[10px] text-slate-600 font-medium">参加</span>;
      case "ABSENT":
        return <span className="text-[10px] bg-red-100 text-red-700 font-bold px-1.5 py-0.5 rounded">欠席</span>;
      case "WITHDRAWN":
        return <span className="text-[10px] bg-orange-100 text-orange-700 font-bold px-1.5 py-0.5 rounded">棄権</span>;
      case "DISQUALIFIED":
        return <span className="text-[10px] bg-red-200 text-red-900 font-bold px-1.5 py-0.5 rounded">失格</span>;
      default:
        return null;
    }
  };

  const handleExportCSV = () => {
    const headers = ["立順", "立ち位置", "区分", "所属チーム", "選手氏名", "部門", "進行状態", "資格", "的中数", "射数", "皆中", "遠近順位", "総合順位"];
    const rows = filteredData.map((p) => [
      `第${p.standNumber}立`,
      p.position,
      p.entryType === "TEAM" ? "団体" : "個人",
      `"${p.teamName}"`,
      `"${p.playerName}"`,
      p.division,
      p.progressStatus,
      p.qualificationStatus,
      p.totalHits,
      p.totalShots,
      p.isPerfect ? "皆中" : "",
      p.enkinRank ? `${p.enkinRank}位` : "",
      p.finalRank ? `${p.finalRank}位` : ""
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `kyudo_match_results_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const columns = useMemo<ColumnDef<Participant>[]>(
    () => [
      {
        accessorKey: "standNumber",
        header: ({ column }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 px-2 text-xs font-bold"
          >
            立順
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="font-bold text-slate-900 text-center w-12">
            第 {row.getValue<number>("standNumber")} 立
          </div>
        ),
      },
      {
        accessorKey: "position",
        header: "位置",
        cell: ({ row }) => (
          <span className="text-xs font-medium text-slate-600">
            {row.getValue<string>("position")}
          </span>
        ),
      },
      {
        accessorKey: "entryType",
        header: "区分",
        cell: ({ row }) => {
          const isTeam = row.getValue<EntryType>("entryType") === "TEAM";
          return (
            <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded ${
              isTeam ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-purple-50 text-purple-700 border border-purple-200"
            }`}>
              {isTeam ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
              {isTeam ? "団体" : "個人"}
            </span>
          );
        },
      },
      {
        accessorKey: "teamName",
        header: ({ column }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 px-2 text-xs font-bold"
          >
            所属チーム / 枠
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="font-semibold text-slate-800">
            {row.getValue<string>("teamName")}
          </div>
        ),
      },
      {
        accessorKey: "playerName",
        header: "選手氏名",
        cell: ({ row }) => (
          <div className="font-medium text-slate-900 flex items-center gap-1.5">
            {row.getValue<string>("playerName")}
            {row.original.isPerfect && (
              <span title="皆中" className="inline-flex items-center">
                <Trophy className="w-3.5 h-3.5 text-red-600 shrink-0" />
              </span>
            )}
            {getQualificationBadge(row.original.qualificationStatus)}
          </div>
        ),
      },
      {
        accessorKey: "division",
        header: "部門",
        cell: ({ row }) => (
          <span className="text-xs text-slate-500">
            {row.getValue<DivisionType>("division")}
          </span>
        ),
      },
      {
        accessorKey: "progressStatus",
        header: "進行状態",
        cell: ({ row }) => getProgressBadge(row.getValue<ProgressStatus>("progressStatus")),
      },
      {
        accessorKey: "totalHits",
        header: ({ column }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 px-2 text-xs font-bold"
          >
            的中
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const hits = row.getValue<number>("totalHits");
          const shots = row.original.totalShots;
          return (
            <div className="text-right font-bold pr-2">
              <span className="text-red-600">{hits}</span>
              <span className="text-slate-400 text-xs"> / {shots > 0 ? shots : "-"}</span>
            </div>
          );
        },
      },
      {
        accessorKey: "finalRank",
        header: "順位",
        cell: ({ row }) => {
          const rank = row.original.finalRank;
          return (
            <div className="text-center font-bold">
              {rank ? (
                <span className={`text-xs px-2 py-0.5 rounded ${
                  rank === 1 ? "bg-amber-100 text-amber-900 font-black border border-amber-300" :
                  rank === 2 ? "bg-slate-200 text-slate-900 border border-slate-300" :
                  rank === 3 ? "bg-amber-50 text-amber-800 border border-amber-200" :
                  "bg-slate-100 text-slate-700"
                }`}>
                  第 {rank} 位
                </span>
              ) : (
                <span className="text-slate-300 text-xs">-</span>
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
      if (selectedDivision !== "ALL" && item.division !== selectedDivision) return false;
      if (selectedEntryType !== "ALL" && item.entryType !== selectedEntryType) return false;
      if (selectedProgress !== "ALL" && item.progressStatus !== selectedProgress) return false;
      if (globalFilter.trim().length > 0) {
        const queryStr = globalFilter.toLowerCase();
        const matchesPlayer = (item.playerName || "").toLowerCase().includes(queryStr);
        const matchesTeam = (item.teamName || "").toLowerCase().includes(queryStr);
        if (!matchesPlayer && !matchesTeam) return false;
      }
      return true;
    });
  }, [data, selectedDivision, selectedEntryType, selectedProgress, globalFilter]);

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
      {/* 検索・絞り込み・各種操作バー */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="選手名・チーム名で検索..."
            value={globalFilter}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGlobalFilter(e.target.value)}
            className="pl-9 pr-4 py-2 w-full text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
          />
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={selectedEntryType}
            onChange={(e) => setSelectedEntryType(e.target.value)}
            className="p-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
          >
            <option value="ALL">全区分（団体/個人）</option>
            <option value="TEAM">団体選手のみ</option>
            <option value="INDIVIDUAL">個人選手のみ</option>
          </select>

          <select
            value={selectedDivision}
            onChange={(e) => setSelectedDivision(e.target.value)}
            className="p-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
          >
            <option value="ALL">全部門</option>
            <option value="一般男子">一般男子</option>
            <option value="一般女子">一般女子</option>
            <option value="シニア男子">シニア男子</option>
            <option value="シニア女子">シニア女子</option>
          </select>

          <select
            value={selectedProgress}
            onChange={(e) => setSelectedProgress(e.target.value)}
            className="p-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
          >
            <option value="ALL">全進行状態</option>
            <option value="WAITING">待機中</option>
            <option value="CALLED">招集中</option>
            <option value="SHOOTING">行射中</option>
            <option value="COMPLETED">競技終了</option>
          </select>

          {/* 検索・絞り込みフィルターのリセット */}
          <Button variant="outline" size="sm" onClick={handleResetFilters} className="h-9 px-3">
            <RefreshCcw className="h-3.5 w-3.5 mr-1" />
            条件リセット
          </Button>

          {/* 成績データ一括クリア（フールプルーフ確認モーダルを開く） */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowScoreResetModal(true)}
            className="h-9 px-3 text-red-600 border-red-200 hover:bg-red-50 font-semibold"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            成績全クリア
          </Button>

          <Button variant="outline" size="sm" onClick={handleExportCSV} className="h-9 px-3 font-bold">
            <Download className="h-3.5 w-3.5 mr-1" />
            CSV出力
          </Button>
        </div>
      </div>

      {resetStatusMessage && (
        <p className="text-xs text-center font-medium p-2 rounded bg-slate-100 text-slate-700 border border-slate-200">
          {resetStatusMessage}
        </p>
      )}

      {/* 参加者一覧テーブル */}
      <div className="rounded-md border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-slate-500">
                  該当する参加者・立が見つかりません。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-600 px-1">
        <div>
          全 <span className="font-semibold text-slate-900">{filteredData.length}</span> 件中{" "}
          {filteredData.length > 0 ? table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1 : 0} -{" "}
          {Math.min((table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize, filteredData.length)} 件を表示
        </div>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="h-8 px-2 text-xs"
          >
            前へ
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="h-8 px-2 text-xs"
          >
            次へ
          </Button>
        </div>
      </div>

      {/* フールプルーフ: 成績全クリア実行前の二重確認モーダル */}
      {showScoreResetModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-red-600">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h4 className="font-bold text-slate-900 text-base">全選手の成績数値をクリアしますか？</h4>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              この操作を実行すると、<strong>全選手の入力済み的中数、射数、矢の記録（〇✕）、遠近順位、確定順位が全て「0（未入力）」に初期化</strong>されます。
              この操作は取り消せません。
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowScoreResetModal(false)}
                disabled={isResettingScores}
                className="text-xs font-semibold"
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
                {isResettingScores ? "クリア実行中..." : "同意して全成績を初期化"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}