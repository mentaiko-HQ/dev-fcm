/**
 * 【管理者向け参加者データテーブルコンポーネント】
 * 新仕様（第1立・第2立の個別立グループ・立順設定を持つ `standAssignments`）に対応。
 * 型安全な設計と、白ベースの洗練されたUI（fluence.co.jpリファレンス）を適用。
 * 
 * 【フールプルーフ】不適切なデータ入力や存在しない立インデックスへのアクセスを防止。
 * 【フェイルセーフ】データベース読み込み時や更新時の例外を捕捉し、アプリケーションのクラッシュを防止。
 */

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
import { collection, onSnapshot, query, orderBy, writeBatch, doc, getDocs, updateDoc } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import { Participant } from "@/types/participant";
import { ProgressStatus, QualificationStatus, ShosaType, StaffRoleType, StandOrderType, HitResult, RankTitleType, CheckInStatus, StandRoundIndex } from "@/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ArrowUpDown, Search, RefreshCcw, Trophy, Download, AlertTriangle, Trash2, Filter, CheckCircle2, XCircle, Loader2, Edit2, Check, X } from "lucide-react";

/**
 * 【フールプルーフ】立順のサニタイズ処理
 * 予期せぬ値が入力された場合でも、安全な1〜5の数値にフォールバックさせます。
 */
function sanitizeStandOrder(val: unknown): StandOrderType {
  const num = typeof val === "number" ? val : Number(val);
  if (num === 1 || num === 2 || num === 3 || num === 4 || num === 5) {
    return num;
  }
  return 1;
}

/**
 * 【フールプルーフ】所作のサニタイズ処理
 */
function sanitizeShosa(val: unknown): ShosaType {
  if (val === "襷掛け") return "襷掛け";
  return "肌脱ぎ";
}

/**
 * 【フールプルーフ】称号・段位のサニタイズ処理
 */
function sanitizeRankTitle(val: unknown): RankTitleType {
  if (val === "称号を取得している" || val === "段位は四段以上" || val === "段位は三段以下") {
    return val;
  }
  return "段位は三段以下";
}

/**
 * 【フールプルーフ】役員役割のサニタイズ処理
 */
function sanitizeStaffRole(val: unknown): StaffRoleType {
  const validRoles: StaffRoleType[] = ["進行", "的前", "招集", "記録", "カメラマン", "運営", "無し"];
  if (typeof val === "string" && validRoles.includes(val as StaffRoleType)) {
    return val as StaffRoleType;
  }
  return "無し";
}

/**
 * 【フールプルーフ】進行状態のサニタイズ処理
 */
function sanitizeProgressStatus(val: unknown): ProgressStatus {
  const validStatuses: ProgressStatus[] = ["WAITING", "CALLED", "SHOOTING", "COMPLETED"];
  if (typeof val === "string" && validStatuses.includes(val as ProgressStatus)) {
    return val as ProgressStatus;
  }
  return "WAITING";
}

/**
 * 【フールプルーフ】資格・出欠状態のサニタイズ処理
 */
function sanitizeQualificationStatus(val: unknown): QualificationStatus {
  const validQuals: QualificationStatus[] = ["ACTIVE", "ABSENT", "WITHDRAWN", "DISQUALIFIED"];
  if (typeof val === "string" && validQuals.includes(val as QualificationStatus)) {
    return val as QualificationStatus;
  }
  return "ACTIVE";
}

/**
 * 【フールプルーフ】チェックイン状態のサニタイズ処理
 */
function sanitizeCheckInStatus(val: unknown): CheckInStatus {
  const validStatuses: CheckInStatus[] = ["UNCHECKED", "CHECKED_IN", "ABSENT"];
  if (typeof val === "string" && validStatuses.includes(val as CheckInStatus)) {
    return val as CheckInStatus;
  }
  return "UNCHECKED";
}

export function ParticipantDataTable() {
  const [data, setData] = useState<Participant[]>([]);
  const [sorting, setSorting] = useState<SortingState>([{ id: "bibNumber", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState<string>("");
  const [selectedShosa, setSelectedShosa] = useState<string>("ALL");
  const [selectedRank, setSelectedRank] = useState<string>("ALL");
  const [selectedRole, setSelectedRole] = useState<string>("ALL");
  const [selectedPayment, setSelectedPayment] = useState<string>("ALL");

  const [showScoreResetModal, setShowScoreResetModal] = useState<boolean>(false);
  const [isResettingScores, setIsResettingScores] = useState<boolean>(false);
  const [resetStatusMessage, setResetStatusMessage] = useState<string>("");
  // 【フェイルセーフ】更新中の選手IDを保持し、重複リクエストやエラー時の誤動作を防止
  const [updatingPaymentId, setUpdatingPaymentId] = useState<string | null>(null);

  // 【編集機能の状態管理】現在インライン編集中の選手IDと、その編集フォームデータ
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    bibNumber: number;
    standAssignments: Record<StandRoundIndex, { standGroup: number; standOrder: 1 | 2 | 3 | 4 | 5 }>;
    name: string;
    organization: string;
    shosa: ShosaType;
    rankTitle: RankTitleType;
    representativeName: string;
    staffRole: StaffRoleType;
    staffDutyShift: string;
  }>({
    bibNumber: 1,
    standAssignments: {
      1: { standGroup: 1, standOrder: 1 },
      2: { standGroup: 1, standOrder: 1 },
      3: { standGroup: 1, standOrder: 1 },
    },
    name: "",
    organization: "",
    shosa: "肌脱ぎ",
    rankTitle: "段位は三段以下",
    representativeName: "",
    staffRole: "無し",
    staffDutyShift: "無し",
  });
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);

  /**
   * 【フェイルセーフ ＆ フールプルーフ】入金ステータス切替非同期処理
   * ネットワーク障害発生時にアプリがクラッシュしないよう例外を捕捉します。
   */
  const handleTogglePayment = async (participant: Participant) => {
    // 【フールプルーフ】Firestoreが未設定・利用不可の場合は操作を即時中断
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      alert("Firestoreデータベースが利用可能な状態ではありません。");
      return;
    }

    const nextIsPaid = !participant.isPaid;
    const now = Date.now();
    setUpdatingPaymentId(participant.id);

    try {
      const docRef = doc(db, "entries", participant.id);
      
      // Firestoreの該当エントリドキュメントを入金状態に更新
      await updateDoc(docRef, {
        isPaid: nextIsPaid,
        paidAt: nextIsPaid ? now : null,
        updatedAt: now,
      });
    } catch (err) {
      // 【フェイルセーフ】通信エラー時にアプリのクラッシュを防ぐエラーハンドリング
      console.error("【入金ステータス更新失敗】", err);
      alert("入金ステータスの更新に失敗しました。ネットワーク接続環境をご確認ください。");
    } finally {
      setUpdatingPaymentId(null);
    }
  };

  /**
   * 【インライン編集開始処理】
   * 選択された選手の現在のデータを編集フォームの状態にセットする。
   */
  const handleStartEdit = (p: Participant) => {
    setEditingId(p.id);
    const rawAssignments = p.standAssignments || {};
    setEditForm({
      bibNumber: p.bibNumber,
      standAssignments: {
        1: { standGroup: Number(rawAssignments[1]?.standGroup || 1), standOrder: sanitizeStandOrder(rawAssignments[1]?.standOrder || 1) },
        2: { standGroup: Number(rawAssignments[2]?.standGroup || 1), standOrder: sanitizeStandOrder(rawAssignments[2]?.standOrder || 1) },
        3: { standGroup: Number(rawAssignments[3]?.standGroup || 1), standOrder: sanitizeStandOrder(rawAssignments[3]?.standOrder || 1) },
      },
      name: p.name,
      organization: p.organization,
      shosa: p.shosa,
      rankTitle: p.rankTitle,
      representativeName: p.representativeName || "",
      staffRole: p.staffRole,
      staffDutyShift: p.staffDutyShift || "無し",
    });
  };

  /**
   * 【インライン編集キャンセル処理】
   */
  const handleCancelEdit = () => {
    setEditingId(null);
  };

  /**
   * 【インライン編集保存処理】
   * 編集内容をバリデーションし、Firestoreの該当ドキュメントを更新する。
   */
  const handleSaveEdit = async (participantId: string) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      alert("Firestoreデータベースが利用可能な状態ではありません。");
      return;
    }

    if (!editForm.name.trim()) {
      alert("選手氏名は必須です。");
      return;
    }

    setIsSavingEdit(true);
    const now = Date.now();

    try {
      const docRef = doc(db, "entries", participantId);
      await updateDoc(docRef, {
        bibNumber: Number(editForm.bibNumber) || 1,
        standAssignments: editForm.standAssignments,
        name: editForm.name.trim(),
        organization: editForm.organization.trim(),
        shosa: editForm.shosa,
        rankTitle: editForm.rankTitle,
        representativeName: editForm.representativeName.trim(),
        staffRole: editForm.staffRole,
        staffDutyShift: editForm.staffDutyShift,
        updatedAt: now,
      });

      setEditingId(null);
    } catch (err) {
      console.error("【選手データ更新失敗】", err);
      alert("選手データの更新に失敗しました。ネットワーク接続環境をご確認ください。");
    } finally {
      setIsSavingEdit(false);
    }
  };

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
            
            // 【フェイルセーフ】古いデータ形式や未設定の場合に備えて全3立の割り当てを安全に復元
            const rawAssignments = raw.standAssignments || {};
            const safeAssignments: Record<StandRoundIndex, { standGroup: number; standOrder: 1 | 2 | 3 | 4 | 5 }> = {
              1: {
                standGroup: Number(rawAssignments[1]?.standGroup || raw.standGroup || 1),
                standOrder: sanitizeStandOrder(rawAssignments[1]?.standOrder || raw.standOrder || 1),
              },
              2: {
                standGroup: Number(rawAssignments[2]?.standGroup || raw.standGroup || 1),
                standOrder: sanitizeStandOrder(rawAssignments[2]?.standOrder || raw.standOrder || 1),
              },
              3: {
                standGroup: Number(rawAssignments[3]?.standGroup || 1),
                standOrder: sanitizeStandOrder(rawAssignments[3]?.standOrder || 1),
              },
            };

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
              checkInStatus: sanitizeCheckInStatus(raw.checkInStatus),
              checkInAt: typeof raw.checkInAt === "number" ? raw.checkInAt : null,
              isStaffVolunteer: Boolean(raw.isStaffVolunteer),
              needsSupport: Boolean(raw.needsSupport),
              standAssignments: safeAssignments,
              progressStatus: sanitizeProgressStatus(raw.progressStatus),
              qualificationStatus: sanitizeQualificationStatus(raw.qualificationStatus),
              stand1_arrows: Array.isArray(raw.stand1_arrows) ? raw.stand1_arrows : [],
              stand2_arrows: Array.isArray(raw.stand2_arrows) ? raw.stand2_arrows : [],
              stand3_arrows: Array.isArray(raw.stand3_arrows) ? raw.stand3_arrows : [],
              totalHits: typeof raw.totalHits === "number" ? raw.totalHits : Number(raw.totalHits) || 0,
              totalShots: typeof raw.totalShots === "number" ? raw.totalShots : Number(raw.totalShots) || 8,
              isPerfect: Boolean(raw.isPerfect),
              enkinRank: typeof raw.enkinRank === "number" ? raw.enkinRank : null,
              finalRank: typeof raw.finalRank === "number" ? raw.finalRank : null,
              userId: typeof raw.userId === "string" ? raw.userId : undefined,
              representativeName: typeof raw.representativeName === "string" ? raw.representativeName : "",
              representativeEmail: typeof raw.representativeEmail === "string" ? raw.representativeEmail : "",
              representativePhone: typeof raw.representativePhone === "string" ? raw.representativePhone : "",
              representativeOrganization: typeof raw.representativeOrganization === "string" ? raw.representativeOrganization : "",
              isPaid: Boolean(raw.isPaid),
              paidAt: typeof raw.paidAt === "number" ? raw.paidAt : null,
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
    setSelectedPayment("ALL");
    setSorting([{ id: "bibNumber", desc: false }]);
  };

  const handleExecuteScoreReset = async () => {
    setData((prev) =>
      prev.map((p) => ({
        ...p,
        totalHits: 0,
        totalShots: 8,
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
          totalShots: 8,
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
      "第1立(グループ)",
      "第1立(立順)",
      "第2立(グループ)",
      "第2立(立順)",
      "選手氏名",
      "ふりがな",
      "所属団体名",
      "所作",
      "称号・段位",
      "申込代表者名",
      "代表者電話番号",
      "代表者メールアドレス",
      "入金確認状態",
      "役員役割",
      "役員担当時間帯",
      "役員協力希望",
      "サポート希望",
      "備考"
    ];
    const rows = filteredData.map((p) => {
      const a1 = p.standAssignments?.[1] || { standGroup: 1, standOrder: 1 };
      const a2 = p.standAssignments?.[2] || { standGroup: 1, standOrder: 1 };
      return [
        p.bibNumber,
        `第${String(a1.standGroup).padStart(2, "0")}立`,
        `${a1.standOrder}番`,
        `第${String(a2.standGroup).padStart(2, "0")}立`,
        `${a2.standOrder}番`,
        `"${p.name}"`,
        `"${p.nameKana}"`,
        `"${p.organization}"`,
        p.shosa,
        p.rankTitle,
        `"${p.representativeName || ""}"`,
        `"${p.representativePhone || ""}"`,
        `"${p.representativeEmail || ""}"`,
        p.isPaid ? "入金済み" : "未入金",
        p.staffRole,
        p.staffDutyShift || "無し",
        p.isStaffVolunteer ? "希望あり" : "なし",
        p.needsSupport ? "要サポート" : "不要",
        `"${(p.notes || "").replace(/"/g, '""')}"`
      ];
    });

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
        cell: ({ row }) => {
          const p = row.original;
          const isEditing = editingId === p.id;
          if (isEditing) {
            return (
              <input
                type="number"
                value={editForm.bibNumber}
                onChange={(e) => setEditForm(prev => ({ ...prev, bibNumber: Number(e.target.value) }))}
                className="w-16 p-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900 text-center font-mono"
              />
            );
          }
          return (
            <div className="font-bold text-slate-900 text-center w-14 font-mono text-xs">
              No.{row.getValue<number>("bibNumber")}
            </div>
          );
        },
      },
      {
        id: "standPosition",
        header: () => <span className="font-bold text-slate-900 text-xs">立配置 (第1 / 第2立)</span>,
        cell: ({ row }) => {
          const p = row.original;
          const isEditing = editingId === p.id;
          const a1 = p.standAssignments?.[1] || { standGroup: 1, standOrder: 1 };
          const a2 = p.standAssignments?.[2] || { standGroup: 1, standOrder: 1 };

          if (isEditing) {
            return (
              <div className="space-y-1 text-[11px]">
                <div className="flex items-center gap-1">
                  <span>第1:</span>
                  <input
                    type="number"
                    min={1}
                    value={editForm.standAssignments[1].standGroup}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setEditForm(prev => ({
                        ...prev,
                        standAssignments: {
                          ...prev.standAssignments,
                          1: { ...prev.standAssignments[1], standGroup: val }
                        }
                      }));
                    }}
                    className="w-10 p-0.5 text-center border rounded font-mono"
                  />
                  <span>立-</span>
                  <select
                    value={editForm.standAssignments[1].standOrder}
                    onChange={(e) => {
                      const val = Number(e.target.value) as 1 | 2 | 3 | 4 | 5;
                      setEditForm(prev => ({
                        ...prev,
                        standAssignments: {
                          ...prev.standAssignments,
                          1: { ...prev.standAssignments[1], standOrder: val }
                        }
                      }));
                    }}
                    className="p-0.5 border rounded"
                  >
                    <option value={1}>1番</option>
                    <option value={2}>2番</option>
                    <option value={3}>3番</option>
                    <option value={4}>4番</option>
                    <option value={5}>5番</option>
                  </select>
                </div>
                <div className="flex items-center gap-1">
                  <span>第2:</span>
                  <input
                    type="number"
                    min={1}
                    value={editForm.standAssignments[2].standGroup}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setEditForm(prev => ({
                        ...prev,
                        standAssignments: {
                          ...prev.standAssignments,
                          2: { ...prev.standAssignments[2], standGroup: val }
                        }
                      }));
                    }}
                    className="w-10 p-0.5 text-center border rounded font-mono"
                  />
                  <span>立-</span>
                  <select
                    value={editForm.standAssignments[2].standOrder}
                    onChange={(e) => {
                      const val = Number(e.target.value) as 1 | 2 | 3 | 4 | 5;
                      setEditForm(prev => ({
                        ...prev,
                        standAssignments: {
                          ...prev.standAssignments,
                          2: { ...prev.standAssignments[2], standOrder: val }
                        }
                      }));
                    }}
                    className="p-0.5 border rounded"
                  >
                    <option value={1}>1番</option>
                    <option value={2}>2番</option>
                    <option value={3}>3番</option>
                    <option value={4}>4番</option>
                    <option value={5}>5番</option>
                  </select>
                </div>
              </div>
            );
          }
          return (
            <div className="font-semibold text-slate-800 text-xs space-y-0.5 whitespace-nowrap">
              <div>第1立: 第{String(a1.standGroup).padStart(2, "0")}立 - <span className="font-bold text-slate-900">{a1.standOrder}番</span></div>
              <div>第2立: 第{String(a2.standGroup).padStart(2, "0")}立 - <span className="font-bold text-slate-900">{a2.standOrder}番</span></div>
            </div>
          );
        },
      },
      {
        accessorKey: "name",
        header: () => <span className="font-bold text-slate-900 text-xs">選手氏名</span>,
        cell: ({ row }) => {
          const p = row.original;
          const isEditing = editingId === p.id;
          if (isEditing) {
            return (
              <div className="space-y-1">
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full p-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900"
                  placeholder="選手氏名"
                />
                <div className="text-[10px] text-slate-500">{p.nameKana}</div>
              </div>
            );
          }
          return (
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
          );
        },
      },
      {
        accessorKey: "organization",
        header: () => <span className="font-bold text-slate-900 text-xs">所属団体名</span>,
        cell: ({ row }) => {
          const p = row.original;
          const isEditing = editingId === p.id;
          if (isEditing) {
            return (
              <input
                type="text"
                value={editForm.organization}
                onChange={(e) => setEditForm(prev => ({ ...prev, organization: e.target.value }))}
                className="w-full p-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900"
                placeholder="所属団体名"
              />
            );
          }
          return (
            <span className="text-xs text-slate-700 font-medium whitespace-nowrap">
              {row.getValue<string>("organization") || "-"}
            </span>
          );
        },
      },
      {
        accessorKey: "shosa",
        header: () => <span className="font-bold text-slate-900 text-xs">所作</span>,
        cell: ({ row }) => {
          const p = row.original;
          const isEditing = editingId === p.id;
          const shosa = row.getValue<ShosaType>("shosa");
          if (isEditing) {
            return (
              <select
                value={editForm.shosa}
                onChange={(e) => setEditForm(prev => ({ ...prev, shosa: e.target.value as ShosaType }))}
                className="p-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900"
              >
                <option value="肌脱ぎ">肌脱ぎ</option>
                <option value="襷掛け">襷掛け</option>
              </select>
            );
          }
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
          const p = row.original;
          const isEditing = editingId === p.id;
          const rankTitle = row.getValue<RankTitleType>("rankTitle");
          if (isEditing) {
            return (
              <select
                value={editForm.rankTitle}
                onChange={(e) => setEditForm(prev => ({ ...prev, rankTitle: e.target.value as RankTitleType }))}
                className="p-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900"
              >
                <option value="段位は三段以下">段位は三段以下</option>
                <option value="段位は四段以上">段位は四段以上</option>
                <option value="称号を取得している">称号を取得している</option>
              </select>
            );
          }
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
        cell: ({ row }) => {
          const p = row.original;
          const isEditing = editingId === p.id;
          if (isEditing) {
            return (
              <input
                type="text"
                value={editForm.representativeName}
                onChange={(e) => setEditForm(prev => ({ ...prev, representativeName: e.target.value }))}
                className="w-full p-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900"
                placeholder="申込代表者名"
              />
            );
          }
          return (
            <div className="text-xs whitespace-nowrap">
              <span className="font-medium text-slate-900">{row.original.representativeName || "-"}</span>
              {row.original.representativePhone && (
                <div className="text-[10px] text-slate-500 font-mono">{row.original.representativePhone}</div>
              )}
            </div>
          );
        },
      },
      // 【入金確認ステータスボタン列】
      {
        id: "paymentStatus",
        header: () => <span className="font-bold text-slate-900 text-xs">入金確認ステータス</span>,
        cell: ({ row }) => {
          const participant = row.original;
          const isThisUpdating = updatingPaymentId === participant.id;

          return (
            <div className="text-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isThisUpdating}
                onClick={() => handleTogglePayment(participant)}
                className={`h-7 px-2.5 text-[11px] font-bold transition-all ${
                  participant.isPaid
                    ? "bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                    : "bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100"
                }`}
              >
                {isThisUpdating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                ) : participant.isPaid ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mr-1" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-amber-600 mr-1" />
                )}
                {participant.isPaid ? "入金済み" : "未入金"}
              </Button>
            </div>
          );
        },
      },
      {
        accessorKey: "staffRole",
        header: () => <span className="font-bold text-slate-900 text-xs">役員種類・時間帯</span>,
        cell: ({ row }) => {
          const p = row.original;
          const isEditing = editingId === p.id;
          const role = row.getValue<StaffRoleType>("staffRole");
          const shift = row.original.staffDutyShift || "無し";

          if (isEditing) {
            return (
              <div className="flex flex-col gap-1">
                <select
                  value={editForm.staffRole}
                  onChange={(e) => setEditForm(prev => ({ ...prev, staffRole: e.target.value as StaffRoleType }))}
                  className="p-1 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900"
                >
                  <option value="進行">進行</option>
                  <option value="的前">的前</option>
                  <option value="招集">招集</option>
                  <option value="記録">記録</option>
                  <option value="カメラマン">カメラマン</option>
                  <option value="運営">運営</option>
                  <option value="無し">無し</option>
                </select>
                <select
                  value={editForm.staffDutyShift}
                  onChange={(e) => setEditForm(prev => ({ ...prev, staffDutyShift: e.target.value }))}
                  className="p-1 text-[10px] font-bold border border-slate-300 rounded bg-white text-slate-900"
                >
                  <option value="AM">AM</option>
                  <option value="PM">PM</option>
                  <option value="終日">終日</option>
                  <option value="無し">無し</option>
                </select>
              </div>
            );
          }

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
      // 【インライン編集操作カラム】
      {
        id: "actions",
        header: () => <span className="font-bold text-slate-900 text-xs">操作</span>,
        cell: ({ row }) => {
          const p = row.original;
          const isEditing = editingId === p.id;

          if (isEditing) {
            return (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleSaveEdit(p.id)}
                  disabled={isSavingEdit}
                  className="h-7 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px]"
                >
                  <Check className="w-3.5 h-3.5 mr-0.5" /> 保存
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCancelEdit}
                  disabled={isSavingEdit}
                  className="h-7 px-2 border-slate-300 text-slate-700 text-[11px]"
                >
                  <X className="w-3.5 h-3.5 mr-0.5" /> 取消
                </Button>
              </div>
            );
          }

          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleStartEdit(p)}
              className="h-7 px-2.5 text-[11px] font-bold border-slate-300 bg-white hover:bg-slate-50 text-slate-800"
            >
              <Edit2 className="w-3 h-3 mr-1 text-slate-600" /> 編集
            </Button>
          );
        },
      },
    ],
    [updatingPaymentId, editingId, editForm, isSavingEdit]
  );

  const filteredData = useMemo(() => {
    return data.filter((item: Participant) => {
      if (selectedShosa !== "ALL" && item.shosa !== selectedShosa) return false;
      if (selectedRank !== "ALL" && item.rankTitle !== selectedRank) return false;
      if (selectedRole !== "ALL" && item.staffRole !== selectedRole) return false;
      if (selectedPayment === "PAID" && !item.isPaid) return false;
      if (selectedPayment === "UNPAID" && item.isPaid) return false;

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
  }, [data, selectedShosa, selectedRank, selectedRole, selectedPayment, globalFilter]);

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
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              className="h-9 px-3 text-xs font-bold bg-white border-slate-300 text-slate-800 hover:bg-slate-100"
            >
              <RefreshCcw className="h-3.5 w-3.5 mr-1 text-slate-600" />
              条件リセット
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowScoreResetModal(true)}
              className="h-9 px-3 text-xs font-bold text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700 bg-white"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1 text-red-600" />
              全成績初期化 (0中)
            </Button>

            <Button
              type="button"
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
            <label className="text-slate-600 font-medium">入金状態:</label>
            <select
              value={selectedPayment}
              onChange={(e) => setSelectedPayment(e.target.value)}
              className="p-1.5 text-xs font-bold border border-slate-300 rounded bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
            >
              <option value="ALL">全入金状態</option>
              <option value="PAID">入金済み</option>
              <option value="UNPAID">未入金</option>
            </select>
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
            type="button"
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="h-8 px-2.5 text-xs font-bold border-slate-300 disabled:opacity-40"
          >
            前へ
          </Button>
          <Button
            type="button"
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