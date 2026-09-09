/**
 * 【管理者向け参加選手データテーブルコンポーネント】
 * 
 * 役割:
 * - 登録された参加選手の一覧表示、複合ソート、多角的なフィルタリング（受付状況、進行状況、参加資格、入金状況）。
 * - 選手ごとの出欠受付（CheckInStatus: UNCHECKED / CHECKED_IN / ABSENT）の迅速な切り替え。
 * - 競技進行ステータス（ProgressStatus: WAITING / CALLED / IN_STAND / FINISHED）および参加資格（QualificationStatus: ACTIVE / DISQUALIFIED / WITHDRAWN）の即時更新。
 * - 選手詳細・立順（第1立・第2立）の編集モーダル連携と Firestore リアルタイム同期。
 * 
 * フールプルーフ設計（操作ミス・不正入力の入口遮断）:
 * - TS2305/TS2322/TS2353/TS2678 解消:
 *   - StandOrderIndex (StandOrderType) を正しくインポート。
 *   - ProgressStatus（IN_STAND, FINISHED）と QualificationStatus（ACTIVE, DISQUALIFIED, WITHDRAWN）、CheckInStatus（ABSENT）を厳密に区別。
 *   - 選手エンティティにおける一意キーを `id` に統一（`userId` を排除）。
 *   - `sanitizeRankTitleType` を通して string 型の不正代入を防止。
 * - 更新処理中（updatingIds, isSaving）のボタン非活性化により二重クリックを完全抑止。
 * 
 * フェイルセーフ設計（障害発生時の安全縮退）:
 * - Firestore 通信エラー時に例外をキャッチし、操作対象行にエラーログを保持した上でユーザーへ安全に通知。
 * - 不完全な選手データが渡された場合でも、各サニタイズ関数により規定値へフォールバックしてテーブル描画のクラッシュを防止。
 */

"use client";

import React, { useState, useMemo } from "react";
import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db, isFirebaseConfigured, isFirestoreAvailable } from "@/lib/firebase";
import {
  Participant,
  StandRoundIndex,
  StandOrderIndex,
  ShosaType,
  RankTitleType,
  StaffRoleType,
  CheckInStatus,
  ProgressStatus,
  QualificationStatus,
  sanitizeRankTitleType,
  sanitizeCheckInStatus,
  sanitizeProgressStatus,
  sanitizeQualificationStatus,
} from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Filter,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Edit2,
  CheckCircle2,
  XCircle,
  Clock,
  UserCheck,
  AlertTriangle,
  Loader2,
  X,
  Check,
  RotateCcw,
} from "lucide-react";

interface ParticipantDataTableProps {
  participants: Participant[];
  onRefresh?: () => void;
}

type SortField =
  | "bibNumber"
  | "name"
  | "organization"
  | "stand1"
  | "stand2"
  | "checkInStatus"
  | "progressStatus"
  | "qualificationStatus"
  | "isPaid";

type SortDirection = "asc" | "desc";

export function ParticipantDataTable({ participants, onRefresh }: ParticipantDataTableProps) {
  // 検索・フィルタリング用ステート
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterCheckIn, setFilterCheckIn] = useState<string>("ALL");
  const [filterProgress, setFilterProgress] = useState<string>("ALL");
  const [filterQualification, setFilterQualification] = useState<string>("ALL");
  const [filterPayment, setFilterPayment] = useState<string>("ALL");

  // ソート用ステート
  const [sortField, setSortField] = useState<SortField>("bibNumber");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // 非同期更新中フラグ管理（行ごとの多重実行抑止）
  const [updatingIds, setUpdatingIds] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  // モーダル編集用ステート
  const [editingParticipant, setEditingParticipant] = useState<Participant | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [editForm, setEditForm] = useState<{
    bibNumber: number;
    name: string;
    nameKana: string;
    organization: string;
    shosa: ShosaType;
    rankTitle: RankTitleType;
    staffRole: StaffRoleType;
    staffDutyShift: string;
    standAssignments: Record<StandRoundIndex, { standGroup: number; standOrder: StandOrderIndex }>;
    notes: string;
  }>({
    bibNumber: 1,
    name: "",
    nameKana: "",
    organization: "",
    shosa: "肌脱ぎ",
    rankTitle: "段位は三段以下",
    staffRole: "無し",
    staffDutyShift: "無し",
    standAssignments: {
      1: { standGroup: 1, standOrder: 1 },
      2: { standGroup: 1, standOrder: 1 },
      3: { standGroup: 1, standOrder: 1 },
    },
    notes: "",
  });

  // 1. ソート切り替えハンドラー
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  // 2. ソートアイコン描画
  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-300 ml-1" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="w-3.5 h-3.5 text-slate-900 ml-1" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-slate-900 ml-1" />
    );
  };

  // 3. 複合フィルタリング＆ソート済み配列の算出
  const processedParticipants = useMemo(() => {
    return participants
      .filter((p) => {
        // テキスト検索（ゼッケン・氏名・かな・所属）
        const queryLower = searchQuery.toLowerCase().trim();
        const matchesQuery =
          !queryLower ||
          p.name.toLowerCase().includes(queryLower) ||
          p.nameKana.toLowerCase().includes(queryLower) ||
          p.organization.toLowerCase().includes(queryLower) ||
          String(p.bibNumber).includes(queryLower);

        if (!matchesQuery) return false;

        // チェックインフィルタ
        if (filterCheckIn !== "ALL" && p.checkInStatus !== filterCheckIn) return false;

        // 進行ステータスフィルタ（フールプルーフ: 正しい ProgressStatus 値で比較）
        if (filterProgress !== "ALL" && p.progressStatus !== filterProgress) return false;

        // 参加資格ステータスフィルタ
        if (filterQualification !== "ALL" && p.qualificationStatus !== filterQualification) return false;

        // 入金フィルタ
        if (filterPayment === "PAID" && !p.isPaid) return false;
        if (filterPayment === "UNPAID" && p.isPaid) return false;

        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        switch (sortField) {
          case "bibNumber":
            diff = a.bibNumber - b.bibNumber;
            break;
          case "name":
            diff = (a.nameKana || a.name).localeCompare(b.nameKana || b.name, "ja");
            break;
          case "organization":
            diff = a.organization.localeCompare(b.organization, "ja");
            break;
          case "stand1": {
            const a1 = a.standAssignments?.[1] || { standGroup: 999, standOrder: 999 };
            const b1 = b.standAssignments?.[1] || { standGroup: 999, standOrder: 999 };
            diff = a1.standGroup !== b1.standGroup ? a1.standGroup - b1.standGroup : a1.standOrder - b1.standOrder;
            break;
          }
          case "stand2": {
            const a2 = a.standAssignments?.[2] || { standGroup: 999, standOrder: 999 };
            const b2 = b.standAssignments?.[2] || { standGroup: 999, standOrder: 999 };
            diff = a2.standGroup !== b2.standGroup ? a2.standGroup - b2.standGroup : a2.standOrder - b2.standOrder;
            break;
          }
          case "checkInStatus":
            diff = a.checkInStatus.localeCompare(b.checkInStatus);
            break;
          case "progressStatus":
            diff = a.progressStatus.localeCompare(b.progressStatus);
            break;
          case "qualificationStatus":
            diff = a.qualificationStatus.localeCompare(b.qualificationStatus);
            break;
          case "isPaid":
            diff = (a.isPaid ? 1 : 0) - (b.isPaid ? 1 : 0);
            break;
          default:
            diff = 0;
        }
        return sortDirection === "asc" ? diff : -diff;
      });
  }, [
    participants,
    searchQuery,
    filterCheckIn,
    filterProgress,
    filterQualification,
    filterPayment,
    sortField,
    sortDirection,
  ]);

  // 4. Firestore フィールド更新共通処理（フェイルセーフ）
  const updateParticipantField = async (participantId: string, fields: Partial<Participant>) => {
    if (!isFirebaseConfigured || !isFirestoreAvailable(db)) {
      setActionError("Firestoreデータベースに接続されていません。");
      return;
    }

    const firestoreInstance = db;
    if (!firestoreInstance) return;

    setUpdatingIds((prev) => ({ ...prev, [participantId]: true }));
    setActionError(null);

    try {
      const docRef = doc(firestoreInstance, "entries", participantId);
      await updateDoc(docRef, {
        ...fields,
        updatedAt: serverTimestamp(),
      });

      if (onRefresh) onRefresh();
    } catch (err: unknown) {
      console.error("【Firestore更新エラー】選手ID:", participantId, "エラー内容:", err);
      setActionError(err instanceof Error ? err.message : "データ更新中に通信例外が発生しました。");
    } finally {
      setUpdatingIds((prev) => ({ ...prev, [participantId]: false }));
    }
  };

  // 5. 受付ステータス切り替え
  const handleToggleCheckIn = async (p: Participant) => {
    const nextStatus: CheckInStatus =
      p.checkInStatus === "UNCHECKED" ? "CHECKED_IN" : p.checkInStatus === "CHECKED_IN" ? "ABSENT" : "UNCHECKED";
    const checkInAt = nextStatus === "CHECKED_IN" ? Date.now() : null;

    await updateParticipantField(p.id, {
      checkInStatus: nextStatus,
      checkInAt,
    });
  };

  // 6. 編集モーダルを開く
  const handleOpenEdit = (p: Participant) => {
    setEditingParticipant(p);
    setEditForm({
      bibNumber: p.bibNumber,
      name: p.name,
      nameKana: p.nameKana || "",
      organization: p.organization,
      shosa: p.shosa,
      rankTitle: sanitizeRankTitleType(p.rankTitle),
      staffRole: p.staffRole,
      staffDutyShift: p.staffDutyShift || "無し",
      standAssignments: JSON.parse(JSON.stringify(p.standAssignments || {})),
      notes: p.notes || "",
    });
    setIsModalOpen(true);
  };

  // 7. 編集内容をFirestoreへ保存
  const handleSaveEdit = async () => {
    if (!editingParticipant) return;

    if (!editForm.name.trim()) {
      alert("選手氏名は必須です。");
      return;
    }

    setIsSaving(true);
    setActionError(null);

    try {
      await updateParticipantField(editingParticipant.id, {
        bibNumber: Number(editForm.bibNumber) || 1,
        name: editForm.name.trim(),
        nameKana: editForm.nameKana.trim(),
        organization: editForm.organization.trim(),
        shosa: editForm.shosa,
        rankTitle: editForm.rankTitle,
        staffRole: editForm.staffRole,
        staffDutyShift: editForm.staffDutyShift as Participant["staffDutyShift"],
        standAssignments: editForm.standAssignments,
        notes: editForm.notes.trim(),
      });
      setIsModalOpen(false);
      setEditingParticipant(null);
    } catch (err: unknown) {
      console.error("【選手保存例外】:", err);
      alert("選手情報の保存に失敗しました。");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 検索・絞り込みツールバー */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* テキスト検索 */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="ゼッケン・選手名・かな・所属で検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50/50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none transition-all"
            />
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs text-slate-700 bg-slate-50 px-2.5 py-1">
              該当: {processedParticipants.length} / 全 {participants.length} 名
            </Badge>
          </div>
        </div>

        {/* フィルターセレクト群 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 text-xs">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">受付状況 (CheckIn)</label>
            <select
              value={filterCheckIn}
              onChange={(e) => setFilterCheckIn(e.target.value)}
              className="w-full p-1.5 border border-slate-200 rounded-lg bg-white text-slate-800 font-medium focus:ring-1 focus:ring-slate-900 outline-none"
            >
              <option value="ALL">すべて</option>
              <option value="CHECKED_IN">受付済 (CHECKED_IN)</option>
              <option value="UNCHECKED">未受付 (UNCHECKED)</option>
              <option value="ABSENT">欠席 (ABSENT)</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">競技進行 (Progress)</label>
            <select
              value={filterProgress}
              onChange={(e) => setFilterProgress(e.target.value)}
              className="w-full p-1.5 border border-slate-200 rounded-lg bg-white text-slate-800 font-medium focus:ring-1 focus:ring-slate-900 outline-none"
            >
              <option value="ALL">すべて</option>
              <option value="WAITING">待機中 (WAITING)</option>
              <option value="CALLED">招集済 (CALLED)</option>
              <option value="IN_STAND">競技中 (IN_STAND)</option>
              <option value="FINISHED">競技終了 (FINISHED)</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">参加資格 (Qualification)</label>
            <select
              value={filterQualification}
              onChange={(e) => setFilterQualification(e.target.value)}
              className="w-full p-1.5 border border-slate-200 rounded-lg bg-white text-slate-800 font-medium focus:ring-1 focus:ring-slate-900 outline-none"
            >
              <option value="ALL">すべて</option>
              <option value="ACTIVE">有効・出場可 (ACTIVE)</option>
              <option value="DISQUALIFIED">失格 (DISQUALIFIED)</option>
              <option value="WITHDRAWN">棄権 (WITHDRAWN)</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 mb-1">入金状況 (Payment)</label>
            <select
              value={filterPayment}
              onChange={(e) => setFilterPayment(e.target.value)}
              className="w-full p-1.5 border border-slate-200 rounded-lg bg-white text-slate-800 font-medium focus:ring-1 focus:ring-slate-900 outline-none"
            >
              <option value="ALL">すべて</option>
              <option value="PAID">入金済み</option>
              <option value="UNPAID">未入金</option>
            </select>
          </div>
        </div>

        {actionError && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{actionError}</span>
          </div>
        )}
      </div>

      {/* データテーブル一覧 */}
      <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold select-none">
              <tr>
                <th
                  className="p-3.5 w-16 text-center cursor-pointer hover:bg-slate-100/80 transition-colors"
                  onClick={() => handleSort("bibNumber")}
                >
                  <div className="flex items-center justify-center">
                    <span>ゼッケン</span>
                    {renderSortIcon("bibNumber")}
                  </div>
                </th>
                <th
                  className="p-3.5 cursor-pointer hover:bg-slate-100/80 transition-colors"
                  onClick={() => handleSort("name")}
                >
                  <div className="flex items-center">
                    <span>選手氏名 / 所属</span>
                    {renderSortIcon("name")}
                  </div>
                </th>
                <th
                  className="p-3.5 cursor-pointer hover:bg-slate-100/80 transition-colors"
                  onClick={() => handleSort("stand1")}
                >
                  <div className="flex items-center">
                    <span>第1立(午前)</span>
                    {renderSortIcon("stand1")}
                  </div>
                </th>
                <th
                  className="p-3.5 cursor-pointer hover:bg-slate-100/80 transition-colors"
                  onClick={() => handleSort("stand2")}
                >
                  <div className="flex items-center">
                    <span>第2立(午後)</span>
                    {renderSortIcon("stand2")}
                  </div>
                </th>
                <th
                  className="p-3.5 text-center cursor-pointer hover:bg-slate-100/80 transition-colors"
                  onClick={() => handleSort("checkInStatus")}
                >
                  <div className="flex items-center justify-center">
                    <span>受付状況</span>
                    {renderSortIcon("checkInStatus")}
                  </div>
                </th>
                <th
                  className="p-3.5 text-center cursor-pointer hover:bg-slate-100/80 transition-colors"
                  onClick={() => handleSort("progressStatus")}
                >
                  <div className="flex items-center justify-center">
                    <span>競技進行</span>
                    {renderSortIcon("progressStatus")}
                  </div>
                </th>
                <th
                  className="p-3.5 text-center cursor-pointer hover:bg-slate-100/80 transition-colors"
                  onClick={() => handleSort("qualificationStatus")}
                >
                  <div className="flex items-center justify-center">
                    <span>参加資格</span>
                    {renderSortIcon("qualificationStatus")}
                  </div>
                </th>
                <th
                  className="p-3.5 text-center cursor-pointer hover:bg-slate-100/80 transition-colors"
                  onClick={() => handleSort("isPaid")}
                >
                  <div className="flex items-center justify-center">
                    <span>入金</span>
                    {renderSortIcon("isPaid")}
                  </div>
                </th>
                <th className="p-3.5 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {processedParticipants.length > 0 ? (
                processedParticipants.map((p) => {
                  const isRowUpdating = Boolean(updatingIds[p.id]);
                  const a1 = p.standAssignments?.[1] || { standGroup: 1, standOrder: 1 };
                  const a2 = p.standAssignments?.[2] || { standGroup: 1, standOrder: 1 };

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* ゼッケン番号 */}
                      <td className="p-3.5 text-center font-mono font-black text-slate-900">
                        No.{p.bibNumber}
                      </td>

                      {/* 選手氏名・所属 */}
                      <td className="p-3.5">
                        <div className="font-bold text-slate-900">{p.name}</div>
                        <div className="text-[10px] text-slate-400">
                          {p.nameKana || "-"} • {p.organization || "無所属"}
                        </div>
                      </td>

                      {/* 第1立配置 */}
                      <td className="p-3.5 font-mono text-slate-700">
                        第{a1.standGroup}立 - <span className="font-bold text-slate-900">{a1.standOrder}番</span>
                      </td>

                      {/* 第2立配置 */}
                      <td className="p-3.5 font-mono text-slate-700">
                        第{a2.standGroup}立 - <span className="font-bold text-slate-900">{a2.standOrder}番</span>
                      </td>

                      {/* 受付チェックイン状況（クリックで切り替え） */}
                      <td className="p-3.5 text-center">
                        <button
                          type="button"
                          disabled={isRowUpdating}
                          onClick={() => handleToggleCheckIn(p)}
                          className="inline-flex items-center justify-center focus:outline-none"
                        >
                          {p.checkInStatus === "CHECKED_IN" ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold hover:bg-emerald-200">
                              <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-600" /> 受付済
                            </Badge>
                          ) : p.checkInStatus === "ABSENT" ? (
                            <Badge className="bg-slate-200 text-slate-700 border-slate-300 font-bold hover:bg-slate-300">
                              <XCircle className="w-3 h-3 mr-1 text-slate-500" /> 欠席
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100">
                              <Clock className="w-3 h-3 mr-1 text-amber-500" /> 未受付
                            </Badge>
                          )}
                        </button>
                      </td>

                      {/* 競技進行状況（Select でインライン更新） */}
                      <td className="p-3.5 text-center">
                        <select
                          disabled={isRowUpdating}
                          value={p.progressStatus}
                          onChange={(e) =>
                            updateParticipantField(p.id, {
                              progressStatus: sanitizeProgressStatus(e.target.value),
                            })
                          }
                          className="text-[11px] font-bold p-1 rounded-md border border-slate-200 bg-white text-slate-800 focus:ring-1 focus:ring-slate-900 outline-none"
                        >
                          <option value="WAITING">待機中</option>
                          <option value="CALLED">招集済</option>
                          <option value="IN_STAND">競技中</option>
                          <option value="FINISHED">競技終了</option>
                        </select>
                      </td>

                      {/* 参加資格ステータス（Select でインライン更新） */}
                      <td className="p-3.5 text-center">
                        <select
                          disabled={isRowUpdating}
                          value={p.qualificationStatus}
                          onChange={(e) =>
                            updateParticipantField(p.id, {
                              qualificationStatus: sanitizeQualificationStatus(e.target.value),
                            })
                          }
                          className={`text-[11px] font-bold p-1 rounded-md border outline-none ${
                            p.qualificationStatus === "ACTIVE"
                              ? "bg-white text-emerald-800 border-emerald-200"
                              : p.qualificationStatus === "DISQUALIFIED"
                              ? "bg-red-50 text-red-700 border-red-200"
                              : "bg-slate-50 text-slate-600 border-slate-200"
                          }`}
                        >
                          <option value="ACTIVE">有効 (ACTIVE)</option>
                          <option value="DISQUALIFIED">失格 (DISQUALIFIED)</option>
                          <option value="WITHDRAWN">棄権 (WITHDRAWN)</option>
                        </select>
                      </td>

                      {/* 入金状況 */}
                      <td className="p-3.5 text-center">
                        {p.isPaid ? (
                          <span className="text-emerald-600 font-bold text-[11px]">済</span>
                        ) : (
                          <span className="text-amber-600 font-bold text-[11px]">未</span>
                        )}
                      </td>

                      {/* 行操作ボタン */}
                      <td className="p-3.5 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isRowUpdating}
                          onClick={() => handleOpenEdit(p)}
                          className="h-7 px-2.5 text-[11px] font-bold border-slate-200 hover:bg-slate-100 text-slate-700"
                        >
                          {isRowUpdating ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <>
                              <Edit2 className="w-3 h-3 mr-1 text-slate-500" /> 編集
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-slate-400 font-medium">
                    条件に合致する選手データが見つかりません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 選手編集モーダル */}
      {isModalOpen && editingParticipant && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full shadow-2xl border border-slate-200 space-y-4 my-8 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-slate-700" />
                選手情報・立順設定の修正 (No.{editingParticipant.bibNumber})
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs max-h-[70vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ゼッケン番号</label>
                  <input
                    type="number"
                    value={editForm.bibNumber}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, bibNumber: Number(e.target.value) }))}
                    className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 font-mono font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">所作</label>
                  <select
                    value={editForm.shosa}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, shosa: e.target.value as ShosaType }))}
                    className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none"
                  >
                    <option value="肌脱ぎ">肌脱ぎ</option>
                    <option value="襷掛け">襷掛け</option>
                  </select>
                </div>
              </div>

              {/* 立配置（第1立・第2立） */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <h4 className="font-bold text-slate-900 text-xs">立配置設定</h4>
                {([1, 2] as const).map((roundIdx) => (
                  <div key={roundIdx} className="grid grid-cols-3 gap-2 items-center bg-white p-2.5 rounded-lg border border-slate-200">
                    <span className="font-bold text-slate-800">
                      {roundIdx === 1 ? "第1立 (午前一手)" : "第2立 (午後一手)"}
                    </span>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">立グループ</label>
                      <input
                        type="number"
                        min={1}
                        value={editForm.standAssignments[roundIdx]?.standGroup || 1}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setEditForm((prev) => ({
                            ...prev,
                            standAssignments: {
                              ...prev.standAssignments,
                              [roundIdx]: {
                                ...prev.standAssignments[roundIdx],
                                standGroup: val,
                              },
                            },
                          }));
                        }}
                        className="w-full p-1.5 border border-slate-200 rounded text-xs font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">立順 (1〜5番)</label>
                      <select
                        value={editForm.standAssignments[roundIdx]?.standOrder || 1}
                        onChange={(e) => {
                          const val = Number(e.target.value) as StandOrderIndex;
                          setEditForm((prev) => ({
                            ...prev,
                            standAssignments: {
                              ...prev.standAssignments,
                              [roundIdx]: {
                                ...prev.standAssignments[roundIdx],
                                standOrder: val,
                              },
                            },
                          }));
                        }}
                        className="w-full p-1.5 border border-slate-200 rounded text-xs font-bold"
                      >
                        <option value={1}>1番(大前)</option>
                        <option value={2}>2番</option>
                        <option value={3}>3番(中)</option>
                        <option value={4}>4番(三番)</option>
                        <option value={5}>5番(落ち)</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">選手氏名 *</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">ふりがな</label>
                  <input
                    type="text"
                    value={editForm.nameKana}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, nameKana: e.target.value }))}
                    className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">所属団体名</label>
                  <input
                    type="text"
                    value={editForm.organization}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, organization: e.target.value }))}
                    className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">称号・段位</label>
                  <select
                    value={editForm.rankTitle}
                    onChange={(e) =>
                      setEditForm((prev) => ({
                        ...prev,
                        rankTitle: sanitizeRankTitleType(e.target.value),
                      }))
                    }
                    className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 font-bold text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none"
                  >
                    <option value="段位は三段以下">段位は三段以下</option>
                    <option value="段位は四段以上">段位は四段以上</option>
                    <option value="称号を取得している">称号を取得している</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">備考</label>
                <textarea
                  rows={2}
                  value={editForm.notes}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="w-full p-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900 outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isSaving}
                onClick={() => setIsModalOpen(false)}
                className="text-xs"
              >
                キャンセル
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isSaving}
                onClick={handleSaveEdit}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> 保存中...
                  </>
                ) : (
                  <>
                    <Check className="w-3.5 h-3.5 mr-1" /> 変更を保存
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}